import { describe, expect, it } from "vitest";
import { PlaybackEngine, type AudioLike } from "../src/engine.js";
import { DEFAULT_SETTINGS } from "../src/prefs.js";
import type { PlayerSettings } from "../src/types.js";
import type { TimedNote } from "../src/timeline.js";

class FakeAudio implements AudioLike {
  noteOns: { midi: number; when: number }[] = [];
  noteOffs: number[] = [];
  ensured = 0;
  cancelled = 0;
  clicks: number[] = [];
  playedChords: { pitchClasses: number[]; bassMidi: number; when: number }[] = [];
  ensure(): unknown {
    this.ensured++;
    return {};
  }
  noteOn(n: TimedNote, when = 0): void {
    this.noteOns.push({ midi: n.midi, when });
  }
  noteOff(midi: number): void {
    this.noteOffs.push(midi);
  }
  metronomeClick(beat: number): void {
    this.clicks.push(beat);
  }
  playChord(pitchClasses: number[], bassMidi: number, when = 0): void {
    this.playedChords.push({ pitchClasses, bassMidi, when });
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
    eng.tick(2);
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
    expect(audio.playedChords).toEqual([{ pitchClasses: [0, 4, 7], bassMidi: 48, when: 0 }]);
    expect(audio.noteOns.map((n) => n.midi)).not.toContain(48);
    eng.tick(0.5);
    expect(audio.playedChords.map((c) => c.pitchClasses)).toContainEqual([2, 5, 9]);
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
});
