import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import { analyzeTempo, recommendTempo } from "../scripts/tempo-robustness.js";

function notes(n: number, opts?: { startBeat?: number; durBeat?: number; pitch?: number }): Note[] {
  const { startBeat = 0.5, durBeat = 0.25, pitch = 60 } = opts ?? {};
  return Array.from({ length: n }, (_, i) => ({
    midi: pitch + (i % 12),
    start: i * startBeat,
    dur: durBeat,
    vel: 80,
  }));
}

describe("analyzeTempo", () => {
  it("does not flag normal-density MIDI", () => {
    // 40 notes over ~20 beats at 120bpm -> ~4 nps (within [1,8])
    const ns = notes(40);
    const a = analyzeTempo(ns, 120);
    expect(a.candidates).toHaveLength(0);
    expect(a.noteCount).toBe(40);
  });

  it("flags very sparse MIDI as likely 2x too slow", () => {
    // 3 notes spread over 30 beats at 120bpm -> 0.04 nps (below 1)
    const ns: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 10, dur: 1, vel: 80 },
      { midi: 67, start: 20, dur: 1, vel: 80 },
    ];
    const a = analyzeTempo(ns, 120);
    expect(a.candidates.length).toBeGreaterThan(0);
    expect(a.candidates[0]!.factor).toBe("2x");
    const rec = recommendTempo(a);
    expect(rec.tempo).toBe(240);
  });

  it("flags very dense MIDI as likely 0.5x too fast", () => {
    // Many short notes packed into few beats at 60bpm -> high nps
    const ns = Array.from({ length: 200 }, (_, i) => ({
      midi: 48 + (i % 36),
      start: i * 0.0625,
      dur: 0.03125,
      vel: 80,
    }));
    const a = analyzeTempo(ns, 60);
    expect(a.densityNps).toBeGreaterThan(8);
    expect(a.candidates.some((c) => c.factor === "0.5x")).toBe(true);
    const rec = recommendTempo(a);
    expect(rec.tempo).toBe(30);
  });

  it("handles empty note list without recommending tempo change", () => {
    const a = analyzeTempo([], 120);
    expect(a.noteCount).toBe(0);
    expect(a.densityNps).toBe(0);
    expect(a.candidates).toHaveLength(0);
    const rec = recommendTempo(a);
    expect(rec.tempo).toBe(120);
    expect(rec.confidence).toBe("high");
  });

  it("handles a single note", () => {
    const ns: Note[] = [{ midi: 60, start: 0, dur: 2, vel: 80 }];
    const a = analyzeTempo(ns, 120);
    expect(a.noteCount).toBe(1);
    expect(a.distinctPitches).toBe(1);
    expect(Number.isFinite(a.medianIoiSec)).toBe(false);
  });

  it("computes distinct pitches and max simultaneous correctly", () => {
    const ns: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 0.5, dur: 0.5, vel: 80 },
    ];
    const a = analyzeTempo(ns, 120);
    expect(a.distinctPitches).toBe(3);
    expect(a.maxSimultaneous).toBe(3);
  });
});
