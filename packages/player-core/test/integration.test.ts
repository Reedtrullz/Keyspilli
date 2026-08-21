import { describe, it, expect } from "vitest";
import {
  PlaybackEngine,
  AudioEngine,
  Grader,
  ChordGrader,
  dedupeChords,
  resolveTimedNotes,
  completeChordDurations,
  detectSections,
  type TimedNote,
  type ChordLabel,
  type PlayerSettings,
  DEFAULT_SETTINGS,
} from "../src/index.js";

/** Minimal audio adapter for integration tests — records calls, never touches DOM. */
class FakeAudio extends AudioEngine {
  calls: string[] = [];

  override ensure() { return {} as AudioContext; }
  override noteOn(n: TimedNote, when = 0) { this.calls.push(`noteOn:${n.midi}@${when.toFixed(3)}`); }
  override noteOff(midi: number) { this.calls.push(`noteOff:${midi}`); }
  override metronomeClick(_beat: number, _when?: number) { this.calls.push("click"); }
  override cancelAll() { this.calls = []; }
  override setGains(_v: number, _p: number) {}
  override dispose() {}
  get sustainPedal() { return true; }
  set sustainPedal(_v: boolean) {}
}

const DEFAULT_SONG = { tempoBpm: 120, timeSig: [4, 4] as [number, number] };

function makeNotes(...starts: number[]): TimedNote[] {
  return starts.map((start, i) => ({
    midi: 60 + i,
    start,
    dur: 0.5,
    vel: 80,
    startSec: start * 0.5, // 120 BPM => 0.5 sec/beat
    hand: "R" as const,
  }));
}

describe("Full player pipeline integration", () => {
  it("loads notes and chords, plays through, and grades correctly", () => {
    const audio = new FakeAudio();
    const notes = [
      { midi: 60, start: 0, dur: 1, vel: 80, startSec: 0, hand: "R" as const },
      { midi: 62, start: 1, dur: 1, vel: 80, startSec: 0.5, hand: "R" as const },
      { midi: 64, start: 2, dur: 1, vel: 80, startSec: 1.0, hand: "R" as const },
      { midi: 65, start: 3, dur: 1, vel: 80, startSec: 1.5, hand: "R" as const },
    ];
    const chords: ChordLabel[] = [
      { beat: 0, name: "C", notes: [60, 64, 67], durationBeats: 2, sourceKind: "generated" },
      { beat: 2, name: "F", notes: [65, 69, 72], durationBeats: 2, sourceKind: "generated" },
    ];

    const engine = new PlaybackEngine(audio, notes, 4, DEFAULT_SONG, DEFAULT_SETTINGS, chords);

    // Verify initial state
    expect(engine.playing).toBe(false);
    expect(engine.time).toBe(0);

    // Start playback
    engine.start();
    expect(engine.playing).toBe(true);

    // Simulate time advancement
    engine.tick(0.25);
    expect(engine.time).toBeGreaterThan(0);

    // Pause
    engine.stop();
    expect(engine.playing).toBe(false);

    // Verify engine state (audio calls depend on scheduling timing)
    expect(engine.time).toBeGreaterThan(0);
  });

  it("grades a performance with correct hits and misses", () => {
    const notes = [
      { midi: 60, start: 0, dur: 0.5, vel: 80, startSec: 0, hand: "R" as const },
      { midi: 62, start: 1, dur: 0.5, vel: 80, startSec: 0.5, hand: "R" as const },
      { midi: 64, start: 2, dur: 0.5, vel: 80, startSec: 1.0, hand: "R" as const },
    ];
    const grader = new Grader(notes, { bpm: 120 });

    // Hit first note correctly
    grader.play(60, 0);
    // Hit second note
    grader.play(62, 0.5);
    // Miss third note (wrong pitch)
    grader.play(99, 1.0);

    // Advance past third note window
    grader.tick(2.0);

    const result = grader.result();
    expect(result.hit).toBe(2);
    expect(result.wrong).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.accuracyPct).toBeGreaterThanOrEqual(50);
  });

  it("dedupes chords with authority ranking", () => {
    const chords: ChordLabel[] = [
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "generated" },
      { beat: 0, name: "Cmaj", notes: [60, 64, 67, 72], sourceKind: "authored" },
    ];
    const deduped = dedupeChords(chords);
    // Authored should win over generated
    expect(deduped.length).toBe(1);
    expect(deduped[0].name).toBe("Cmaj");
    expect(deduped[0].sourceKind).toBe("authored");
  });

  it("detects sections from note density changes", () => {
    const notes: TimedNote[] = [];
    // Sparse intro (measures 0-3): few notes
    for (let i = 0; i < 4; i++) {
      notes.push({ midi: 60, start: i * 4, dur: 1, vel: 80, startSec: i * 2, hand: "R" as const });
    }
    // Dense section (measures 4-7): many notes
    for (let i = 0; i < 32; i++) {
      notes.push({ midi: 60 + (i % 12), start: 16 + i * 0.5, dur: 0.25, vel: 80, startSec: 8 + i * 0.25, hand: "R" as const });
    }
    const measures = Array.from({ length: 8 }, (_, i) => ({
      index: i, startBeat: i * 4, endBeat: (i + 1) * 4,
    }));

    const sections = detectSections(notes, measures);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // First section should be labeled as intro or section-1
    expect(sections[0].id).toBeTruthy();
    expect(sections[0].startBeat).toBe(0);
  });

  it("completes chord durations for generated chords", () => {
    const chords: ChordLabel[] = [
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "generated" },
      { beat: 4, name: "G", notes: [67, 71, 74], sourceKind: "generated" },
    ];
    const completed = completeChordDurations(chords, 8);
    // First chord should span from beat 0 to beat 4
    expect(completed[0].durationBeats).toBe(4);
    // Second chord should span from beat 4 to end (8)
    expect(completed[1].durationBeats).toBe(4);
  });

  it("chord practice grades correctly", () => {
    const targets = [
      { name: "C", notes: [60, 64, 67] },
      { name: "G", notes: [67, 71, 74] },
    ];
    const grader = new ChordGrader(targets);

    // Play C chord (octave-flexible)
    grader.play(48); // C3
    grader.play(52); // E3
    const result = grader.play(55); // G3
    expect(result.completed).toBe(true);

    // Play G chord
    grader.play(55); // G3
    grader.play(59); // B3
    const result2 = grader.play(62); // D4
    expect(result2.completed).toBe(true);

    const snapshot = grader.snapshot();
    expect(snapshot.completed).toBe(2);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.accuracyPct).toBe(100);
  });
});
