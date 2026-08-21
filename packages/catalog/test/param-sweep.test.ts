import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import {
  computeMetrics,
  FRAME_THRESHOLDS,
  ONSET_THRESHOLDS,
} from "../scripts/param-sweep.js";

const sampleNotes: Note[] = [
  { midi: 60, start: 0, dur: 1, vel: 80 },
  { midi: 64, start: 1, dur: 1, vel: 80 },
  { midi: 67, start: 2, dur: 2, vel: 80 },
  { midi: 72, start: 4, dur: 1, vel: 80 },
];

describe("param-sweep thresholds", () => {
  it("has 5 onset and 5 frame thresholds (25 combinations)", () => {
    expect(ONSET_THRESHOLDS).toHaveLength(5);
    expect(FRAME_THRESHOLDS).toHaveLength(5);
    expect(ONSET_THRESHOLDS.length * FRAME_THRESHOLDS.length).toBe(25);
  });
});

describe("computeMetrics", () => {
  it("computes note count", () => {
    const m = computeMetrics(sampleNotes, 120);
    expect(m.noteCount).toBe(4);
  });

  it("computes pitch range and coverage", () => {
    const m = computeMetrics(sampleNotes, 120);
    expect(m.pitchRange).toEqual([60, 72]);
    // 4 distinct pitches out of 87 in the piano range
    expect(m.pitchCoverage).toBeCloseTo(4 / 87, 5);
  });

  it("computes duration and onset density", () => {
    // Last note starts at 4, dur 1, so max end = beat 5; at 120bpm that's 2.5 seconds.
    const m = computeMetrics(sampleNotes, 120);
    expect(m.durationSeconds).toBeCloseTo(2.5, 5);
    expect(m.onsetDensity).toBeCloseTo(4 / 2.5, 5);
  });

  it("computes average note duration", () => {
    // Durations: 1 + 1 + 2 + 1 = 5 beats / 4 notes = 1.25 beats avg
    const m = computeMetrics(sampleNotes, 120);
    expect(m.avgNoteDuration).toBeCloseTo(1.25, 5);
  });

  it("computes max simultaneous correctly", () => {
    // No overlaps in the sample -> max simultaneous is 1
    const m = computeMetrics(sampleNotes, 120);
    expect(m.maxSimultaneous).toBe(1);

    // Add an overlapping note to get 2
    const withOverlap = [
      ...sampleNotes,
      { midi: 55, start: 0.5, dur: 1, vel: 80 } as Note,
    ];
    const m2 = computeMetrics(withOverlap, 120);
    expect(m2.maxSimultaneous).toBe(2);
  });

  it("handles empty notes", () => {
    const m = computeMetrics([], 120);
    expect(m.noteCount).toBe(0);
    expect(m.pitchRange).toBeNull();
    expect(m.pitchCoverage).toBe(0);
    expect(m.durationSeconds).toBe(0);
    expect(m.onsetDensity).toBe(0);
  });
});
