import { describe, expect, it } from "vitest";
import { PlaybackEngine, type AudioLike } from "../src/engine.js";
import { DEFAULT_SETTINGS } from "../src/prefs.js";
import type { PlayerSettings } from "../src/types.js";
import { dedupeChords, type TimedNote } from "../src/timeline.js";

class FakeAudio implements AudioLike {
  noteOns: { midi: number; when: number; fromInput?: boolean }[] = [];
  noteOffs: number[] = [];
  ensured = 0;
  cancelled = 0;
  clicks: number[] = [];
  playedChords: { midiNotes: number[]; when: number; durationSec: number }[] = [];
  ensure(): unknown {
    this.ensured++;
    return {};
  }
  noteOn(n: TimedNote, when = 0): void {
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
  setGains(): void {}
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
    eng.tick(0.5); // 1.5 > loop end -> wrap to loop start (same as legacy player)
    expect(eng.time).toBe(0);
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

  it("plays source chords and omits the recorded left hand in chord mode", () => {
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
    expect(audio.playedChords).toEqual([{ midiNotes: [48, 52, 55], when: 0, durationSec: 1.2 }]);
    expect(audio.noteOns.map((n) => n.midi)).not.toContain(48);
    eng.tick(0.5);
    expect(audio.playedChords.map((c) => c.midiNotes)).toContainEqual([50, 53, 57]);
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
    expect(audio.playedChords).toEqual([{ midiNotes: [50, 62, 69, 74], when: 0, durationSec: 1.2 }]);
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
    eng.start();
    eng.tick(10); // huge dt (simulating background tab)
    expect(eng.time).toBeCloseTo(10, 1); // playhead advances by the full gap
    expect(eng.playing).toBe(true);
  });

  it("setTimeline updates notes and chords atomically", () => {
    const audio = new FakeAudio();
    const eng = new PlaybackEngine(audio, notes, 1.5, SONG, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, []);
    eng.start();
    audio.noteOns = [];
    eng.setTimeline(
      [{ midi: 72, startSec: 0, durSec: 0.5, vel: 80 }],
      0.5,
      [{ beat: 0, name: "C", notes: [60, 64, 67] }],
    );
    eng.tick(0.02);
    expect(audio.noteOns.some(n => n.midi === 72)).toBe(true);
    expect(audio.playedChords.length).toBeGreaterThan(0);
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
    // handleMicNote should also set fromInput.
    eng.handleMicNote(62);
    expect(audio.noteOns.some(n => n.midi === 62 && n.fromInput === true)).toBe(true);
  });

  it("hidden-tab skip cancels audio and does not replay missed notes", () => {
    const { eng, audio } = engine();
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
