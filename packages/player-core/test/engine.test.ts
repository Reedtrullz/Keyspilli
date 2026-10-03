import { describe, expect, it, vi } from "vitest";
import { PlaybackEngine, type AudioLike } from "../src/engine.js";
import { filterAccompanimentChords, resolveAccompaniment } from "../src/accompaniment.js";
import { DEFAULT_SETTINGS } from "../src/prefs.js";
import type { PlayerSettings } from "../src/types.js";
import { dedupeChords, secPerBeat, type TimedNote } from "../src/timeline.js";

class FakeAudio implements AudioLike {
  noteOns: { midi: number; when: number; fromInput?: boolean }[] = [];
  events: TimedNote[] = [];
  noteOffs: number[] = [];
  ensured = 0;
  cancelled = 0;
  clicks: number[] = [];
  playedChords: { midiNotes: number[]; when: number; durationSec: number }[] = [];
  gains: { voice: number; piano: number }[] = [];
  organControls: { rotary: "slow" | "fast"; drive: number; space: number }[] = [];
  ensure(): unknown {
    this.ensured++;
    return {};
  }
  noteOn(n: TimedNote, when = 0): void {
    this.events.push(n);
    this.noteOns.push({ midi: n.midi, when, fromInput: n.fromInput });
  }
  noteOff(midi: number): void {
    this.noteOffs.push(midi);
  }
  metronomeClick(beat: number): void {
    this.clicks.push(beat);
  }
  playChord(midiNotes: number[], when: number, durationSec: number): void {
    this.playedChords.push({ midiNotes, when, durationSec });
  }
  cancelAll(): void {
    this.cancelled++;
  }
  setGains(voice: number, piano: number): void {
    this.gains.push({ voice, piano });
  }
  setOrganControls(rotary: "slow" | "fast", drive: number, space: number): void {
    this.organControls.push({ rotary, drive, space });
  }
  dispose(): void {}
  sustainPedal = true;
}

const SONG = { tempoBpm: 120, timeSig: [4, 4] as [number, number] };
const notes: TimedNote[] = [
  { midi: 60, startSec: 0, durSec: 0.5, vel: 80 },
  { midi: 62, startSec: 0.5, durSec: 0.5, vel: 80 },
  { midi: 64, startSec: 1.0, durSec: 0.5, vel: 80 },
];

function engine(over: Partial<PlayerSettings> = {}, chords: { beat: number; name: string; notes: number[] }[] = []): { eng: PlaybackEngine; audio: FakeAudio } {
  const audio = new FakeAudio();
  const eng = new PlaybackEngine(audio, notes, 1.5, SONG, { ...DEFAULT_SETTINGS, ...over }, chords);
  return { eng, audio };
}

describe("PlaybackEngine", () => {
  it("start ensures audio, schedules the first window, and ticks time", () => {
    const { eng, audio } = engine();
    const snaps: number[] = [];
    eng.onChange = (s) => snaps.push(s.time);
    eng.start();
    expect(eng.playing).toBe(true);
    expect(audio.ensured).toBe(1);
    expect(audio.noteOns).toEqual([{ midi: 60, when: 0 }]);
    eng.tick(0.25);
    eng.tick(0.25);
    expect(eng.time).toBeCloseTo(0.5, 5);
    expect(audio.noteOns.map((n) => n.midi)).toContain(62);
    expect(snaps).toContain(0.5);
  });

  it("stop cancels audio and makes tick a no-op", () => {
    const { eng, audio } = engine();
    eng.start();
    eng.stop();
    expect(eng.playing).toBe(false);
    expect(audio.cancelled).toBe(1);
    const before = audio.noteOns.length;
    eng.tick(1);
    expect(eng.time).toBe(0);
    expect(audio.noteOns.length).toBe(before);
  });

  it("never schedules a note twice across frames", () => {
    const { eng, audio } = engine();
    eng.start();
    for (let i = 0; i < 60; i++) eng.tick(0.02);
    const count = audio.noteOns.filter((n) => n.midi === 60).length;
    expect(count).toBe(1);
  });

  it("wraps loops and silences the wrap without losing time", () => {
    const { eng, audio } = engine();
    eng.setLoop({ startSec: 0, endSec: 1.2 });
    eng.start();
    eng.tick(0.5);
    eng.tick(0.5);
    eng.tick(0.5); // 1.5 > loop end -> preserve 0.3s overshoot
    expect(eng.time).toBeCloseTo(0.3);
    expect(audio.cancelled).toBeGreaterThan(0);
    expect(eng.playing).toBe(true);
  });

  it("stops and seeks to 0 at the end of the song", () => {
    const { eng } = engine();
    eng.start();
    // Tick enough to reach the end (dt is clamped to 0.5s)
    for (let i = 0; i < 5; i++) eng.tick(0.5);
    expect(eng.playing).toBe(false);
    expect(eng.time).toBe(0);
  });

  it("setNotes mid-playback reschedules from the current time", () => {
    const { eng, audio } = engine();
    eng.start();
    eng.tick(0.2);
    audio.noteOns = [];
    const shifted = notes.map((n) => ({ ...n, startSec: n.startSec + 0.3 }));
    eng.setNotes(shifted, 1.8);
    eng.tick(0.02);
    // note 60 (now at 0.3s) is still ahead: scheduled, not yet past
    expect(audio.noteOns.some((n) => n.midi === 60 && n.when > 0)).toBe(true);
  });

  it("seeking during playback cancels the old horizon and schedules the new one", () => {
    const { eng, audio } = engine();
    eng.start();
    eng.tick(0.2);
    const before = audio.cancelled;
    audio.noteOns = [];
    eng.seek(0.95);
    expect(audio.cancelled).toBeGreaterThan(before);
    expect(audio.noteOns).toEqual([{ midi: 64, when: expect.closeTo(0.05, 5) }]);
  });

  it("previewPlan returns no fabricated notes for an empty passage", () => {
    const { eng } = engine();
    eng.setNotes([{ midi: 60, startSec: 0, durSec: 0.1, vel: 80 }], 1);
    expect(eng.previewPlan(0.2, 0.4)).toEqual({ notes: [], chords: [] });
    expect(eng.previewPlan(10, 11)).toEqual({ notes: [], chords: [] });
  });

  it("keeps the grader in sync when wait mode is toggled", () => {
    const { eng } = engine();
    eng.startGrading(false);
    eng.setWaitMode(true);
    expect(eng.waitNote?.midi).toBe(60);
    expect(eng.handleNoteOn(64)).toBe(false);
    expect(eng.handleNoteOn(60)).toBe(true);
    eng.setWaitMode(false);
    expect(eng.waitNote).toBeNull();
  });

  it("emits after microphone input so wait progress can render", () => {
    const { eng } = engine();
    const snapshots: number[] = [];
    eng.onChange = (snap) => snapshots.push(snap.time);
    eng.startGrading(true);
    snapshots.length = 0;
    eng.handleMicNote(60);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(eng.waitNote?.midi).toBe(62);
  });

  it("uses finite microphone feedback and starts no voice after final grading completion", () => {
    const { eng, audio } = engine();
    eng.startGrading(true, { startSec: 0, endSec: 1.5 });
    eng.handleMicNote(70); // wrong pitch still gets brief feedback
    eng.handleMicNote(70); // a repeated detection never owns a held key
    eng.handleMicNote(60);
    eng.handleMicNote(62);
    const beforeFinal = audio.events.length;
    eng.handleMicNote(64);
    expect(eng.grader).toBeNull();
    expect(audio.events).toHaveLength(beforeFinal);
    expect(audio.events.filter(note => note.vel === 90).every(note => note.durSec === 0.35 && note.fromInput !== true)).toBe(true);
    expect(audio.cancelled).toBeGreaterThan(0);
  });

  it("cancels scheduled audio when metronome or pedal settings change", () => {
    const { eng, audio } = engine({ metronome: true });
    eng.start();
    const before = audio.cancelled;
    eng.setSettings({ ...eng.settings, metronome: false });
    expect(audio.cancelled).toBeGreaterThan(before);
    const afterMetronome = audio.cancelled;
    eng.setSettings({ ...eng.settings, sustainPedal: !eng.settings.sustainPedal });
    expect(audio.cancelled).toBeGreaterThan(afterMetronome);
  });

  it("forwards organ controls through the existing settings path", () => {
    const { eng, audio } = engine();
    eng.setSettings({ ...eng.settings, organRotary: "fast", organDrive: 0.65, organSpace: 0.72 });
    expect(audio.organControls).toEqual([{ rotary: "fast", drive: 0.65, space: 0.72 }]);
  });

  it.each([
    { voiceGain: 1, pianoGain: 1 },
    { voiceGain: 0.83, pianoGain: 0.57 },
  ])("initializes and resynchronizes hand gains on an engine recreation (%o)", (gains) => {
    const { eng, audio } = engine(gains);
    expect(audio.gains).toEqual([{ voice: gains.voiceGain, piano: gains.pianoGain }]);
    eng.setSettings(eng.settings);
    expect(audio.gains).toEqual([
      { voice: gains.voiceGain, piano: gains.pianoGain },
      { voice: gains.voiceGain, piano: gains.pianoGain },
    ]);
  });

  it("grades input through the engine and finishes with a result", () => {
    const { eng } = engine();
    eng.startGrading(true);
    expect(eng.grader).not.toBeNull();
    expect(eng.waitNote?.midi).toBe(60);
    expect(eng.handleNoteOn(64)).toBe(false); // wrong note, wait mode
    expect(eng.handleNoteOn(60)).toBe(true);
    const result = eng.finishGrading();
    expect(result).not.toBeNull();
    expect(result!.hit).toBe(1);
    expect(eng.grader).toBeNull();
  });

  it("grades only the requested passage without rewinding", () => {
    const { eng } = engine();
    eng.startGrading(true, { startSec: 0.5, endSec: 1.5 });
    expect(eng.time).toBe(0.5);
    expect(eng.finishGrading()?.total).toBe(2);
  });

  it("rejects invalid and empty passages before mutating transport or grading", () => {
    const { eng, audio } = engine();
    eng.startGrading(false);
    eng.start();
    eng.tick(0.25);
    const grader = eng.grader;
    const cancelled = audio.cancelled;
    for (const range of [
      { startSec: NaN, endSec: 1 }, { startSec: 0, endSec: Infinity },
      { startSec: 1, endSec: 0 }, { startSec: 2, endSec: 3 },
      { startSec: 0.1, endSec: 0.4 },
    ]) expect(() => eng.startGrading(true, range)).toThrow(RangeError);
    expect(eng.time).toBe(0.25);
    expect(eng.playing).toBe(true);
    expect(eng.grader).toBe(grader);
    expect(eng.waitMode).toBe(false);
    expect(audio.cancelled).toBe(cancelled);
  });

  it("does not start an ornament-only passage or emit stale completion when repeating", () => {
    const { eng, audio } = engine();
    eng.setNotes([{ midi: 70, startSec: 0, durSec: 0.03, vel: 80 }], 1.5);
    expect(() => eng.startGrading(true, { startSec: 0, endSec: 1 })).toThrow("No playable notes in this passage");
    expect(audio.ensured).toBe(0);
    expect(eng.grader).toBeNull();
    eng.setNotes(notes, 1.5);
    eng.startGrading(false, { startSec: 0, endSec: 0.5 });
    eng.finishGrading();
    eng.start();
    const results: unknown[] = [];
    eng.onChange = () => results.push(eng.gradeResult);
    eng.startGrading(false, { startSec: 0.5, endSec: 1 });
    expect(results).toEqual([null]);
  });

  it("clamps passage bounds and excludes the end onset and ornaments", () => {
    const { eng } = engine();
    eng.setNotes([...notes, { midi: 70, startSec: 0.25, durSec: 0.03, vel: 80 }], 1.5);
    eng.startGrading(false, { startSec: -1, endSec: 0.5 });
    expect(eng.gradingRange).toEqual({ startSec: 0, endSec: 0.5 });
    expect(eng.finishGrading()?.total).toBe(1);
    eng.startGrading(false, { startSec: 1, endSec: 10 });
    expect(eng.gradingRange).toEqual({ startSec: 1, endSec: 1.5 });
    expect(eng.gradeResult).toBeNull();
  });

  it.each([0.5, 10])("finishes a bounded run across a %s second tick and restores looping", (dt) => {
    const { eng, audio } = engine();
    const loop = { startSec: 0, endSec: 0.6 };
    eng.setLoop(loop);
    eng.startGrading(false, { startSec: 0.5, endSec: 1 });
    eng.start();
    eng.tick(0.4);
    expect(eng.time).toBe(0.9);
    expect(audio.noteOns.some(n => n.midi === 64)).toBe(false);
    eng.tick(dt);
    expect(eng.time).toBe(1);
    expect(eng.playing).toBe(false);
    expect(eng.grader).toBeNull();
    expect(eng.gradeResult?.total).toBe(1);
    expect(eng.finishGrading()).toBe(eng.gradeResult);
    expect(eng.loop).toBe(loop);
    eng.seek(0.5);
    eng.start();
    eng.tick(0.2);
    expect(eng.time).toBeCloseTo(0.1);
  });

  it.each(["keyboard", "microphone"])("advances %s wait input without a UI read and retains completion", (input) => {
    const { eng, audio } = engine();
    eng.startGrading(true, { startSec: 0.5, endSec: 1.25 });
    const play = (midi: number) => input === "keyboard" ? eng.handleNoteOn(midi) : eng.handleMicNote(midi);
    play(70);
    expect(eng.time).toBe(0.5);
    expect(audio.noteOns.filter(n => n.fromInput).length).toBe(0);
    play(62);
    expect(eng.time).toBe(1);
    play(64);
    expect(eng.time).toBe(1.25);
    expect(eng.grader).toBeNull();
    expect(eng.waitMode).toBe(false);
    expect(eng.gradeResult).toMatchObject({ hit: 2, wrong: 1, missed: 0 });
  });

  it("startGrading skips grace notes", () => {
    const { eng } = engine();
    eng.setNotes([...notes, { midi: 70, startSec: 0.25, durSec: 0.03, vel: 80 }], 1.5);
    eng.startGrading(true);
    expect(eng.waitNote?.midi).toBe(60);
    expect(eng.handleNoteOn(60)).toBe(true);
    expect(eng.waitNote?.midi).toBe(62); // the grace note at 0.25s is skipped
  });

  it("startGrading stops playback and resets position", () => {
    const { eng, audio } = engine();
    eng.start();
    eng.tick(0.5);
    eng.startGrading(false);
    expect(eng.playing).toBe(false);
    expect(eng.time).toBe(0);
    expect(audio.cancelled).toBeGreaterThan(0);
  });

  it("does not treat a left-hand label as replaceable accompaniment", () => {
    const sourceNotes: TimedNote[] = [
      { midi: 60, startSec: 0, durSec: 0.5, vel: 80, hand: "R" },
      { midi: 48, startSec: 0, durSec: 0.5, vel: 80, hand: "L" },
      { midi: 62, startSec: 0.5, durSec: 0.5, vel: 80, hand: "R" },
    ];
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(
      audio,
      sourceNotes,
      1,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      [
        { beat: 0, name: "C", notes: [48, 52, 55] },
        { beat: 1, name: "Dm", notes: [50, 53, 57] },
      ],
    );
    eng.start();
    expect(audio.playedChords).toEqual([{ midiNotes: [48, 52, 55], when: 0, durationSec: 1 }]);
    expect(audio.noteOns.map((n) => n.midi)).toContain(48);
    eng.tick(0.5);
    expect(audio.playedChords.map((c) => c.midiNotes)).toContainEqual([50, 53, 57]);
  });

  it("grades fully replaced and hand-filtered resolved guidance without duplicating scheduled audio", () => {
    const source = [0, 1, 2, 3].map((start) => ({ midi: 72, start, dur: 0.5, vel: 80 }));
    const chords = [0, 1, 2, 3].map((beat, index) => ({
      beat,
      durationBeats: 1,
      name: ["C", "F", "G7", "C"][index]!,
      notes: [],
    }));
    const resolved = resolveAccompaniment(source, chords, "bass-chords", { durationBeats: 4 });
    const timed = (note: { midi: number; start: number; dur: number; vel: number; hand?: "L" | "R" }) => ({
      midi: note.midi,
      startSec: note.start * 0.5,
      durSec: note.dur * 0.5,
      vel: note.vel,
      hand: note.hand,
    });
    const guidance = resolved.guidanceNotes.map(timed);
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(
      audio,
      resolved.notes.map(timed),
      2,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      resolved.chords,
      guidance,
    );

    expect(resolved.notes).toHaveLength(0);
    eng.startGrading(true);
    expect(eng.grader?.currentWait?.midi).toBe(guidance[0]!.midi);
    expect(eng.finishGrading()?.total).toBe(guidance.length);
    expect(audio.playedChords).toHaveLength(0);

    const rightGuidance = resolved.guidanceNotes.filter((note) => note.hand === "R").map(timed);
    const rightAudio = new FakeAudio();
    const right = new PlaybackEngine(
      rightAudio,
      [],
      2,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord", hand: "R" },
      filterAccompanimentChords(resolved.chords, "R"),
      rightGuidance,
    );
    right.startGrading(true);
    expect(right.finishGrading()?.total).toBe(rightGuidance.length);
  });

  it("falls back to piano scheduling when chord mode has no timeline", () => {
    const audio = new FakeAudio();
    const sourceNotes: TimedNote[] = [
      { midi: 48, startSec: 0, durSec: 0.5, vel: 80, hand: "L" },
    ];
    const eng = new PlaybackEngine(audio, sourceNotes, 0.5, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" });
    eng.start();
    expect(audio.noteOns.map((n) => n.midi)).toEqual([48]);
    expect(audio.playedChords).toHaveLength(0);
  });

  it("resumes the recorded left hand in an uncovered hybrid gap", () => {
    const audio = new FakeAudio();
    const sourceNotes: TimedNote[] = [
      { midi: 48, startSec: 3, durSec: 0.5, vel: 80, hand: "L" }, // beat 6 at 120 BPM
    ];
    const eng = new PlaybackEngine(
      audio,
      sourceNotes,
      5,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      [
        { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" },
        // Deliberate uncovered interval from beat 4 through beat 8.
        { beat: 8, durationBeats: 4, name: "G", notes: [43, 47, 50], sourceKind: "generated" },
      ],
    );
    eng.start();
    audio.noteOns = [];
    audio.playedChords = [];
    eng.seek(3);
    expect(audio.noteOns).toEqual([{ midi: 48, when: 0 }]);
    expect(audio.playedChords).toHaveLength(0);
  });

  it("cancels and reschedules chord audio when seeking during playback", () => {
    const { eng, audio } = engine({ backgroundMode: "chord" }, [
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 1, name: "Dm", notes: [50, 53, 57] },
    ]);
    eng.start();
    const before = audio.cancelled;
    eng.seek(0.6);
    expect(audio.cancelled).toBeGreaterThan(before);
    expect(audio.playedChords.length).toBeGreaterThan(1);
  });

  it("rebuilds a generated voicing from the beginning when seeking", () => {
    const source = [
      { midi: 72, start: 0, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 72, start: 1, dur: 0.5, vel: 80, hand: "R" as const },
    ];
    const chords = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 1, name: "C", notes: [] },
      { beat: 1, durationBeats: 1, name: "F", notes: [] },
    ], "bass-chords", { durationBeats: 2 }).chords;
    const settings = { ...DEFAULT_SETTINGS, backgroundMode: "chord" as const };
    const continuousAudio = new FakeAudio();
    const continuous = new PlaybackEngine(continuousAudio, [], 1, SONG, settings, chords);
    continuous.start();
    continuous.tick(0.5);
    const continuousF = continuousAudio.playedChords.at(-1)?.midiNotes;

    const seekAudio = new FakeAudio();
    const seeked = new PlaybackEngine(seekAudio, [], 1, SONG, settings, chords);
    seeked.seek(0.5);
    seeked.start();
    expect(seekAudio.playedChords.at(-1)?.midiNotes).toEqual(continuousF);
  });

  it.each([-24, 24])("keeps generated chord MIDI valid at transpose %s", (transpose) => {
    const source = [{ midi: 72, start: 0, dur: 0.5, vel: 80, hand: "R" as const }];
    const chords = resolveAccompaniment(source, [{ beat: 0, durationBeats: 1, name: "B", notes: [] }], "bass-chords", { durationBeats: 1 }).chords;
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [], 0.5, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord", transpose }, chords);
    eng.start();
    expect(audio.playedChords[0]?.midiNotes.every((midi) => midi >= 0 && midi <= 127)).toBe(true);
  });

  it("passes sorted absolute MIDI voicings, preserving octaves and collapsing exact duplicates", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(
      audio,
      [],
      1,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord", transpose: 2 },
      [{ beat: 0, name: "C", notes: [67, 48, 60, 60, 48, 72] }],
    );
    eng.start();
    expect(audio.playedChords).toEqual([{ midiNotes: [50, 62, 69, 74], when: 0, durationSec: 1 }]);
  });

  it("converts chord duration beats using tempo and playback speed", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(
      audio,
      [],
      2,
      SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord", speed: 2 },
      [{ beat: 0, name: "C", notes: [48, 55, 60], durationBeats: 4 }],
    );
    eng.start();
    expect(audio.playedChords).toEqual([{ midiNotes: [48, 55, 60], when: 0, durationSec: 1 }]);
  });

  it("plays only the remaining chord tail after seeking and leaves a rest silent", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [], 3, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      [{ beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55] }]);
    eng.seek(1.9);
    eng.start();
    expect(audio.playedChords).toEqual([{ midiNotes: [48, 52, 55], when: 0, durationSec: expect.closeTo(0.1, 6) }]);
    audio.playedChords.length = 0;
    eng.seek(2.1);
    expect(audio.playedChords).toHaveLength(0);
  });

  it("clips notes and chords at the loop end and rejects attacks after it", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [
      { midi: 60, startSec: 0.96, durSec: 0.4, vel: 80 },
      { midi: 62, startSec: 1.02, durSec: 0.2, vel: 80 },
    ], 2, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord", metronome: true },
    [{ beat: 1.9, durationBeats: 1, name: "C", notes: [48] },
      { beat: 2.04, durationBeats: 1, name: "G", notes: [43] }]);
    eng.setLoop({ startSec: 0, endSec: 1 });
    eng.seek(0.95);
    eng.start();
    expect(audio.events).toEqual([{ midi: 60, startSec: 0.96, durSec: expect.closeTo(0.04, 6), vel: 80 }]);
    expect(audio.playedChords).toEqual([{ midiNotes: [48], when: 0, durationSec: expect.closeTo(0.05, 6) }]);
    expect(audio.noteOns.map((note) => note.midi)).not.toContain(62);
    expect(audio.clicks).toHaveLength(0);
  });

  it("keeps 0.125-second chords in playback and bounded previews", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [], 1, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      [{ beat: 0, durationBeats: 0.25, name: "C", notes: [48, 52, 55] }]);
    eng.start();
    expect(audio.playedChords[0]?.durationSec).toBeCloseTo(0.125);
    expect(eng.previewPlan(0, 0.125).chords[0]?.durationSec).toBeCloseTo(0.125);
    expect(eng.previewPlan(0.05, 0.1).chords[0]?.durationSec).toBeCloseTo(0.05);
  });

  it("does not send out-of-MIDI-range transposed pitches to audio or previews", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [{ midi: -1, startSec: 0, durSec: 0.5, vel: 80 }], 1, SONG,
      { ...DEFAULT_SETTINGS, backgroundMode: "chord", transpose: -24 },
      [{ beat: 0, durationBeats: 1, name: "C", notes: [0, 60] }]);
    eng.start();
    expect(audio.noteOns).toHaveLength(0);
    expect(audio.playedChords[0]?.midiNotes).toEqual([36]);
    expect(eng.previewPlan(0, 0.5).notes).toHaveLength(0);
  });

  it("converts a deduped next-onset span at the active tempo", () => {
    const chords = dedupeChords([
      { beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "generated" as const },
      { beat: 2, name: "G", notes: [43, 47, 50], sourceKind: "generated" as const },
    ]);
    expect(chords[0]!.durationBeats).toBe(2);

    const fastAudio = new FakeAudio();
    const fast = new PlaybackEngine(
      fastAudio,
      [],
      2,
      { tempoBpm: 120, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      chords,
    );
    fast.start();
    expect(fastAudio.playedChords[0]!.durationSec).toBeCloseTo(1, 5);

    const slowAudio = new FakeAudio();
    const slow = new PlaybackEngine(
      slowAudio,
      [],
      2,
      { tempoBpm: 60, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      chords,
    );
    slow.start();
    expect(slowAudio.playedChords[0]!.durationSec).toBeCloseTo(2, 5);
  });
  it("skips forward on tab-background dt jumps without replaying notes", () => {
    const { eng } = engine();
    eng.setNotes([...notes], 20); // This case skips within a song; end-of-song has its own regression.
    eng.start();
    eng.tick(10); // huge dt (simulating background tab)
    expect(eng.time).toBeCloseTo(10, 1); // playhead advances by the full gap
    expect(eng.playing).toBe(true);
  });

  it("setTimeline updates notes and chords atomically", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, notes, 1.5, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, []);
    eng.start();
    eng.tick(0.2);
    const timeBefore = eng.time;
    const cancelledBefore = audio.cancelled;
    audio.noteOns = [];
    audio.playedChords = [];
    eng.setTimeline(
      [{ midi: 72, startSec: 0.25, durSec: 0.5, vel: 80 }],
      1,
      [{ beat: 1, durationBeats: 1, name: "C", notes: [60, 64, 67] }],
    );
    expect(eng.time).toBeCloseTo(timeBefore, 5);
    expect(eng.settings.backgroundMode).toBe("chord");
    expect(audio.cancelled).toBeGreaterThan(cancelledBefore);
    expect(audio.noteOns).toEqual([{ midi: 72, when: expect.closeTo(0.05, 5) }]);
    expect(audio.playedChords).toHaveLength(0);
  });

  it("noteOff only targets input-originated voices", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, notes, 1.5, SONG, DEFAULT_SETTINGS);
    eng.handleNoteOn(60);
    expect(audio.noteOns.filter(n => n.midi === 60 && n.fromInput === true).length).toBe(1);
    // Song-scheduled noteOn should NOT have fromInput.
    eng.start();
    eng.tick(0.01);
    expect(audio.noteOns.some(n => n.midi === 60 && n.fromInput !== true)).toBe(true);
    // Microphone feedback is a bounded note, never a held physical key.
    eng.handleMicNote(62);
    expect(audio.events.some(n => n.midi === 62 && n.vel === 90 && n.fromInput !== true && n.durSec === 0.35)).toBe(true);
  });

  it("hidden-tab skip cancels audio and does not replay missed notes", () => {
    const { eng, audio } = engine();
    eng.setNotes([...notes], 20); // This case skips within a song; end-of-song has its own regression.
    eng.start();
    eng.tick(0.5); // advance normally to t=0.5
    const before = audio.noteOns.length;
    eng.tick(3.0); // dt > clamp -> skip forward
    expect(eng.time).toBeCloseTo(3.5, 1);
    const newOns = audio.noteOns.slice(before);
    const replayed = newOns.filter((n) => n.when === 0 && n.midi >= 62 && n.midi <= 64);
    expect(replayed).toHaveLength(0);
    expect(audio.cancelled).toBeGreaterThan(0);
  });
});

describe("chord silence across transport changes", () => {
  const chords = [
    { beat: 0, name: "C", notes: [48, 52, 55], durationBeats: 4 },
    { beat: 4, name: "G", notes: [43, 47, 50], durationBeats: 4 },
  ];

  it("seeking during playback cancels stale chord voices", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, [], 4, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, chords);
    eng.start();
    expect(audio.playedChords.length).toBeGreaterThan(0);
    const before = audio.cancelled;
    audio.playedChords.length = 0;
    eng.seek(2.1);
    expect(audio.cancelled).toBeGreaterThan(before);
    eng.tick(0.02);
    // Re-scheduling sounds the active chord at the new playhead exactly once.
    expect(audio.playedChords.length).toBe(1);
  });

  it("pausing cancels scheduled chords and resume does not double-fire", () => {
    const { eng, audio } = engine({ backgroundMode: "chord" }, chords);
    eng.start();
    eng.tick(0.05);
    const beforePause = audio.playedChords.length;
    eng.stop();
    expect(audio.cancelled).toBeGreaterThan(0);
    audio.playedChords.length = 0;
    eng.start();
    for (let i = 0; i < 10; i++) eng.tick(0.02);
    expect(audio.playedChords.length).toBeLessThanOrEqual(beforePause);
  });

  it("loop wrap cancels the outgoing chord horizon before restarting", () => {
    const { eng, audio } = engine({ backgroundMode: "chord" }, chords);
    eng.setLoop({ startSec: 0, endSec: 1.2 });
    eng.start();
    eng.tick(0.5);
    eng.tick(0.5);
    const before = audio.cancelled;
    eng.tick(0.5); // crosses loop end
    expect(audio.cancelled).toBeGreaterThan(before);
    expect(eng.time).toBeCloseTo(0.3);
  });
});

describe("speed-stable loops", () => {
  function makeLoopEngine(speed: number) {
    const beatSec = secPerBeat(120, speed);
    const songNotes: TimedNote[] = [
      { midi: 60, startSec: beatSec, durSec: 0.25, vel: 80 },
      { midi: 64, startSec: beatSec * 3, durSec: 0.25, vel: 80 },
    ];
    const audio = new FakeAudio();
    return { audio, eng: new PlaybackEngine(audio, songNotes, 6, SONG, { ...DEFAULT_SETTINGS, speed }) };
  }

  it("reprojects a beat-based loop when speed halves", () => {
    const fast = makeLoopEngine(1);
    fast.eng.setLoop({ startSec: 0, endSec: secPerBeat(120, 1) * 4 }); // beats 1-4 at x1
    fast.eng.start();
    let wrapsFast = 0;
    let lastFast = 0;
    for (let i = 0; i < 200; i++) {
      fast.eng.tick(0.1);
      if (fast.eng.time < lastFast) wrapsFast++;
      lastFast = fast.eng.time;
    }
    expect(wrapsFast).toBeGreaterThan(0);

    const slow = makeLoopEngine(0.5);
    slow.eng.setLoop({ startSec: 0, endSec: secPerBeat(120, 0.5) * 4 }); // same beats at x0.5
    slow.eng.start();
    let elapsedToWrap = 0;
    let lastSlow = 0;
    while (elapsedToWrap < 20) {
      slow.eng.tick(0.1);
      elapsedToWrap += 0.1;
      if (slow.eng.time < lastSlow) break;
      lastSlow = slow.eng.time;
    }
    // 4 beats at 120bpm spans 2s at x1 and must span exactly 4s at x0.5.
    expect(elapsedToWrap).toBeCloseTo(4, 1);
  });
});

it("schedules the chosen other hand without adding wait targets, including overlapping pitches and loops", async()=>{
 const {selectHandNotes}=await import("../src/timeline.js");
 const source:TimedNote[]=[{midi:60,startSec:0,durSec:.5,vel:80,hand:"R"},{midi:60,startSec:0,durSec:.5,vel:70,hand:"L"},{midi:62,startSec:1,durSec:.5,vel:80,hand:"R"},{midi:50,startSec:1,durSec:.5,vel:70,hand:"L"}];
 const targets=selectHandNotes(source,"L"),audible=selectHandNotes(source,"L",true),audio=new FakeAudio();
 expect(targets).toHaveLength(2);expect(audible).toHaveLength(4);expect(selectHandNotes(source,"L")).toEqual(targets);
 const eng=new PlaybackEngine(audio,audible,2,{tempoBpm:120,timeSig:[4,4]},{...DEFAULT_SETTINGS,hand:"L"},[],targets);
 eng.setLoop({startSec:0,endSec:2});eng.seek(0);eng.startGrading(true,{startSec:0,endSec:2});
 expect(eng.waitNotes.map(note=>note.hand)).toEqual(["L"]);expect(eng.handleNoteOn(60)).toBe(true);
 expect(eng.waitNotes.map(note=>note.midi)).toEqual([50]);expect(eng.handleNoteOn(50)).toBe(true);
 expect(eng.gradeResult).toMatchObject({total:2,hit:2,wrong:0});
 eng.setTimeline(audible,2,[],selectHandNotes(source,"R"));eng.seek(1);eng.start();
 expect(audio.events.some(note=>note.hand==="L"&&note.midi===50)).toBe(true);expect(audio.events.some(note=>note.hand==="R"&&note.midi===62)).toBe(true);
 eng.stop();eng.setTimeline(audible,2,[],[]);expect(()=>eng.startGrading(true)).toThrow("No playable notes");eng.stop();
});

it("keeps articulation separate from onset and observes physical release before pedal audio cleanup",()=>{
 let now=1000;const clock=vi.spyOn(performance,"now").mockImplementation(()=>now);
 try {
 const engine=new PlaybackEngine(new FakeAudio(),[{midi:60,startSec:0,durSec:1,vel:80}],1,SONG,DEFAULT_SETTINGS);
 expect(()=>engine.startGrading(true,{startSec:0,endSec:1},150)).toThrow();
 engine.startGrading(false,{startSec:0,endSec:1},150);engine.start();
 const event=(timestampMs:number)=>({timestampMs,timingSource:"event" as const,velocity:80,deviceId:"fixture",channel:0});
 engine.handleNoteOn(60,event(now));engine.observeKeyPress("key",event(now));
 now=1020;engine.observeKeyRelease("key",event(now));
 now=2100;engine.tick(1.1);expect(engine.grader).not.toBeNull();
 now=2401;engine.tick(.301);
 expect(engine.gradeResult).toMatchObject({accuracyPct:100,articulation:{observed:1,shortHolds:1,earlyReleases:1,unobserved:0}});
 // A safety release without an input timestamp never fabricates a successful hold.
 now=3000;engine.startGrading(false,{startSec:0,endSec:1},150);engine.start();engine.handleNoteOn(60,event(now));engine.observeKeyPress("key",event(now));
 engine.handleNoteOff(60);engine.observeKeyRelease("key",undefined);
 expect(engine.finishGrading()).toMatchObject({accuracyPct:100,articulation:{observed:0,unobserved:1}});
 } finally {clock.mockRestore();}
});
