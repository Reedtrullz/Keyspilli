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
  cancelAll(): void {
    this.cancelled++;
  }
  setGains(): void {}
  dispose(): void {}
}

const SONG = { tempoBpm: 120, timeSig: [4, 4] as [number, number] };
const notes: TimedNote[] = [
  { midi: 60, startSec: 0, durSec: 0.5, vel: 80 },
  { midi: 62, startSec: 0.5, durSec: 0.5, vel: 80 },
  { midi: 64, startSec: 1.0, durSec: 0.5, vel: 80 },
];

function engine(over: Partial<PlayerSettings> = {}): { eng: PlaybackEngine; audio: FakeAudio } {
  const audio = new FakeAudio();
  const eng = new PlaybackEngine(audio, notes, 1.5, SONG, { ...DEFAULT_SETTINGS, ...over });
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

  it("startGrading stops playback and resets position", () => {
    const { eng, audio } = engine();
    eng.start();
    eng.tick(0.5);
    eng.startGrading(false);
    expect(eng.playing).toBe(false);
    expect(eng.time).toBe(0);
    expect(audio.cancelled).toBeGreaterThan(0);
  });
});
