import { describe, expect, it } from "vitest";
import type { Note } from "../src/types.js";
import {
  melodyContinuity,
  rhLhBalance,
  soundingDensity,
  arrangementQualityReport,
} from "../src/index.js";

const stepwise: Note[] = [
  { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
  { midi: 62, start: 1, dur: 1, vel: 80, hand: "R" },
  { midi: 64, start: 2, dur: 1, vel: 80, hand: "R" },
  { midi: 65, start: 3, dur: 1, vel: 80, hand: "R" },
  { midi: 67, start: 4, dur: 1, vel: 80, hand: "R" },
];

const jumping: Note[] = [
  { midi: 36, start: 0, dur: 0.5, vel: 80, hand: "R" },
  { midi: 96, start: 0.2, dur: 0.5, vel: 80, hand: "R" },
  { midi: 36, start: 1, dur: 0.5, vel: 80, hand: "R" },
  { midi: 96, start: 1.1, dur: 0.5, vel: 80, hand: "R" },
  { midi: 36, start: 2, dur: 0.5, vel: 80, hand: "R" },
];

describe("melodyContinuity", () => {
  it("returns 0 for empty input", () => {
    expect(melodyContinuity([])).toBe(0);
  });

  it("returns 1 for a single note", () => {
    expect(melodyContinuity([{ midi: 60, start: 0, dur: 1, vel: 80 }])).toBe(1);
  });

  it("scores stepwise melodies higher than large-jump melodies", () => {
    const sw = melodyContinuity(stepwise);
    const jp = melodyContinuity(jumping);
    expect(sw).toBeGreaterThan(jp);
    expect(sw).toBeGreaterThan(0.7);
  });

  it("scores regular rhythms higher than irregular ones", () => {
    const regular: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 62, start: 1, dur: 1, vel: 80 },
      { midi: 64, start: 2, dur: 1, vel: 80 },
      { midi: 65, start: 3, dur: 1, vel: 80 },
    ];
    const irregular: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 62, start: 0.3, dur: 1, vel: 80 },
      { midi: 64, start: 3.5, dur: 1, vel: 80 },
      { midi: 65, start: 3.8, dur: 1, vel: 80 },
    ];
    expect(melodyContinuity(regular)).toBeGreaterThan(melodyContinuity(irregular));
  });
});

describe("rhLhBalance", () => {
  it("returns zero ratios for empty input", () => {
    const b = rhLhBalance([]);
    expect(b.rhRatio).toBe(0);
    expect(b.lhRatio).toBe(0);
    expect(b.crossingCount).toBe(0);
  });

  it("computes ratio from hand labels", () => {
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 74, start: 0.5, dur: 1, vel: 80, hand: "R" },
      { midi: 48, start: 0, dur: 2, vel: 80, hand: "L" },
      { midi: 50, start: 1, dur: 1, vel: 80, hand: "L" },
    ];
    const b = rhLhBalance(notes);
    expect(b.rhRatio).toBeCloseTo(0.5);
    expect(b.lhRatio).toBeCloseTo(0.5);
    expect(b.crossingCount).toBe(0);
  });

  it("detects hand-crossing events", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 70, start: 0.3, dur: 1, vel: 80, hand: "R" },
      { midi: 80, start: 0.5, dur: 1, vel: 80, hand: "L" }, // LH above RH: crossing 1
      { midi: 65, start: 1, dur: 1, vel: 80, hand: "R" },   // RH below LH: crossing 2
    ];
    const b = rhLhBalance(notes);
    expect(b.crossingCount).toBe(2);
  });

  it("infers hand from pitch when hand label is absent", () => {
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 1, vel: 80 },  // above middle C -> R
      { midi: 48, start: 0, dur: 1, vel: 80 },  // below middle C -> L
    ];
    const b = rhLhBalance(notes);
    expect(b.rhRatio).toBeCloseTo(0.5);
    expect(b.lhRatio).toBeCloseTo(0.5);
  });

  it("flags unbalanced distribution", () => {
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 74, start: 1, dur: 1, vel: 80, hand: "R" },
      { midi: 76, start: 2, dur: 1, vel: 80, hand: "R" },
      { midi: 77, start: 3, dur: 1, vel: 80, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 80, hand: "L" },
    ];
    const b = rhLhBalance(notes);
    expect(b.rhRatio).toBeGreaterThan(0.7);
    expect(b.lhRatio).toBeLessThan(0.3);
  });
});

describe("soundingDensity", () => {
  it("returns 0 for empty input", () => {
    expect(soundingDensity([], 8)).toBe(0);
  });

  it("returns 0 for zero duration", () => {
    expect(soundingDensity(stepwise, 0)).toBe(0);
  });

  it("computes correct density for a single note", () => {
    // One note covering beats 0-1 in a 4-beat span => 0.25 sounding on average
    const notes: Note[] = [{ midi: 60, start: 0, dur: 1, vel: 80 }];
    expect(soundingDensity(notes, 4)).toBeCloseTo(0.25);
  });

  it("computes correct density for overlapping notes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 2, vel: 80 },
      { midi: 64, start: 0, dur: 2, vel: 80 },
      { midi: 67, start: 0, dur: 2, vel: 80 },
    ];
    // 3 notes sounding for 2 beats out of 4 = 1.5 average
    expect(soundingDensity(notes, 4)).toBeCloseTo(1.5);
  });
});

describe("arrangementQualityReport", () => {
  it("returns all three metrics and empty flags for a healthy arrangement", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 62, start: 1, dur: 1, vel: 80, hand: "R" },
      { midi: 64, start: 2, dur: 1, vel: 80, hand: "R" },
      { midi: 65, start: 3, dur: 1, vel: 80, hand: "R" },
      { midi: 48, start: 0, dur: 2, vel: 80, hand: "L" },
      { midi: 50, start: 2, dur: 2, vel: 80, hand: "L" },
    ];
    const report = arrangementQualityReport(notes, 4);
    expect(report.melodyContinuity).toBeGreaterThan(0.5);
    expect(report.balance.rhRatio).toBeCloseTo(2 / 3);
    expect(report.balance.lhRatio).toBeCloseTo(1 / 3);
    expect(report.density).toBeGreaterThan(0);
    expect(report.flags).not.toContain("unbalanced");
    expect(report.flags).not.toContain("thin melody");
    expect(report.flags).not.toContain("unplayable texture");
  });

  it("flags thin melody for very discontinuous input", () => {
    // Large pitch jumps and irregular timing -> low continuity
    const notes: Note[] = [
      { midi: 36, start: 0, dur: 0.1, vel: 80 },
      { midi: 96, start: 0.1, dur: 0.1, vel: 80 },
      { midi: 36, start: 1.5, dur: 0.1, vel: 80 },
      { midi: 96, start: 1.6, dur: 0.1, vel: 80 },
      { midi: 36, start: 3.0, dur: 0.1, vel: 80 },
      { midi: 96, start: 3.1, dur: 0.1, vel: 80 },
    ];
    const report = arrangementQualityReport(notes, 4);
    expect(report.flags).toContain("thin melody");
  });

  it("flags unplayable texture for high density", () => {
    // Create 10 simultaneous notes spanning the full duration
    const notes: Note[] = Array.from({ length: 10 }, (_, i) => ({
      midi: 60 + i,
      start: 0,
      dur: 8,
      vel: 80,
      hand: "R" as const,
    }));
    const report = arrangementQualityReport(notes, 8);
    expect(report.flags).toContain("unplayable texture");
    expect(report.density).toBeGreaterThan(8);
  });

  it("flags unbalanced when one hand is very thin", () => {
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 0.5, vel: 80, hand: "R" },
      { midi: 74, start: 0.5, dur: 0.5, vel: 80, hand: "R" },
      { midi: 76, start: 1, dur: 0.5, vel: 80, hand: "R" },
      { midi: 77, start: 1.5, dur: 0.5, vel: 80, hand: "R" },
      { midi: 79, start: 2, dur: 0.5, vel: 80, hand: "R" },
      { midi: 81, start: 2.5, dur: 0.5, vel: 80, hand: "R" },
      { midi: 83, start: 3, dur: 0.5, vel: 80, hand: "R" },
      { midi: 84, start: 3.5, dur: 0.5, vel: 80, hand: "R" },
      { midi: 86, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 48, start: 0, dur: 4, vel: 80, hand: "L" },
    ];
    const report = arrangementQualityReport(notes, 4);
    expect(report.flags).toContain("unbalanced");
  });
});
