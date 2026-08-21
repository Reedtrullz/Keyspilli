import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import { computeMetrics, mockResult } from "../scripts/audio-ab.js";

describe("mockResult", () => {
  it("produces deterministic metrics for a given file+condition", () => {
    const r1 = mockResult("song.mp3", "raw");
    const r2 = mockResult("song.mp3", "raw");
    expect(r1.metrics.noteCount).toBe(r2.metrics.noteCount);
    expect(r1.metrics.pitchCoverage).toBe(r2.metrics.pitchCoverage);
    expect(r1.error).toBe("mock-data");
    expect(r1.condition).toBe("raw");
    expect(r1.audioFile).toBe("song.mp3");
  });

  it("has the expected ABResult structure for all conditions", () => {
    for (const cond of ["raw", "normalized", "highpass"] as const) {
      const r = mockResult("test.wav", cond);
      expect(r).toHaveProperty("audioFile");
      expect(r).toHaveProperty("condition");
      expect(r).toHaveProperty("runtimeMs");
      expect(r).toHaveProperty("metrics");
      expect(r.runtimeMs).toBe(0);
      expect(typeof r.metrics.noteCount).toBe("number");
      expect(typeof r.metrics.pitchCoverage).toBe("number");
      expect(typeof r.metrics.onsetDensity).toBe("number");
      expect(typeof r.metrics.maxSimultaneous).toBe("number");
      expect(typeof r.metrics.durationSeconds).toBe("number");
      expect(r.metrics.noteCount).toBeGreaterThan(0);
      expect(r.metrics.pitchCoverage).toBeGreaterThan(0);
      expect(r.metrics.durationSeconds).toBeGreaterThan(0);
    }
  });

  it("varies output across different files", () => {
    const a = mockResult("a.wav", "raw").metrics;
    const b = mockResult("bbbbb.wav", "raw").metrics;
    // Different seeds -> very likely different note counts
    expect(a.noteCount).not.toBe(b.noteCount);
  });
});

describe("computeMetrics (audio-ab)", () => {
  it("computes pitch coverage over the standard piano range", () => {
    const ns: Note[] = [
      { midi: 21, start: 0, dur: 1, vel: 80 },
      { midi: 108, start: 1, dur: 1, vel: 80 },
    ];
    const m = computeMetrics(ns, 120);
    expect(m.pitchCoverage).toBeCloseTo(2 / 87, 5);
  });

  it("returns zero coverage and density for empty notes", () => {
    const m = computeMetrics([], 120);
    expect(m.noteCount).toBe(0);
    expect(m.pitchCoverage).toBe(0);
    expect(m.onsetDensity).toBe(0);
    expect(m.maxSimultaneous).toBe(0);
    expect(m.durationSeconds).toBe(0);
  });

  it("computes onset density from duration at the given tempo", () => {
    // One note of 4 beats at 60bpm -> 4 seconds, density = 0.25
    const ns: Note[] = [{ midi: 60, start: 0, dur: 4, vel: 80 }];
    const m = computeMetrics(ns, 60);
    expect(m.durationSeconds).toBeCloseTo(4, 5);
    expect(m.onsetDensity).toBeCloseTo(0.25, 5);
  });
});
