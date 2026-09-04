import { describe, expect, it } from "vitest";
import {
  PLAYABILITY_LIMITS,
  assessPlayability,
  measurePlayability,
  type Note,
} from "../src/index.js";

function note(midi: number, start: number, hand: "R" | "L" = "R", dur = 0.125): Note {
  return { midi, start, dur, vel: 90, hand };
}

function chordHeavy(): Note[] {
  return [0, 1, 2, 3].flatMap((start) => [60, 64, 67, 72].map((midi) => note(midi, start)));
}

function rapidMonophonic(): Note[] {
  return Array.from({ length: 10 }, (_, index) => note(60 + (index % 5), index * 0.125));
}

function alternatingHands(): Note[] {
  return Array.from({ length: 10 }, (_, index) => note(60 + (index % 5), index * 0.125, index % 2 ? "L" : "R"));
}

function sparseMelodyDenseAccompaniment(): Note[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => note(72 + index, index * 8, "R")),
    ...Array.from({ length: 10 }, (_, index) => note(36 + (index % 3), index * 0.125, "L")),
  ];
}

describe("playability audit diagnostics", () => {
  it("counts chord attacks once while retaining simultaneous-note evidence", () => {
    const metrics = measurePlayability(chordHeavy(), 120);

    expect(metrics.noteCount).toBe(16);
    expect(metrics.global.onsetCount).toBe(4);
    expect(metrics.global.medianIoiSeconds).toBeCloseTo(0.5, 6);
    expect(metrics.global.maxSimultaneous).toBe(4);
    expect(metrics.global.maxSounding).toBe(4);
    expect(metrics.simultaneousChordAttacks).toBe(4);
  });

  it("identifies a true one-hand rapid line as dense", () => {
    const metrics = measurePlayability(rapidMonophonic(), 120);
    const assessment = assessPlayability(metrics, "medium");

    expect(metrics.global.medianIoiSeconds).toBeCloseTo(0.0625, 6);
    expect(metrics.hands.R.medianIoiSeconds).toBeCloseTo(0.0625, 6);
    expect(metrics.bursts.rapidIoiFraction).toBe(1);
    expect(assessment.passes.medianIoi).toBe(false);
    expect(assessment.failures.some((failure) => failure.includes("median inter-onset below floor"))).toBe(true);
  });

  it("keeps hand-aware IOI diagnostic separate from the global gate", () => {
    const metrics = measurePlayability(alternatingHands(), 120);

    expect(metrics.global.medianIoiSeconds).toBeCloseTo(0.0625, 6);
    expect(metrics.hands.R.medianIoiSeconds).toBeCloseTo(0.125, 6);
    expect(metrics.hands.L.medianIoiSeconds).toBeCloseTo(0.125, 6);
    expect(metrics.alternatingHandAttacks).toBe(9);
  });

  it("reports burst runs and distinguishes density from IOI", () => {
    const metrics = measurePlayability(sparseMelodyDenseAccompaniment(), 120);
    const assessment = assessPlayability(metrics, "easy");

    expect(metrics.global.medianIoiSeconds).toBeCloseTo(0.0625, 6);
    expect(metrics.global.attacksPerSecond).toBeLessThan(12);
    expect(metrics.bursts.longestRapidRun).toBeGreaterThan(4);
    expect(assessment.passes.maxDensity).toBe(true);
    expect(assessment.passes.medianIoi).toBe(false);
  });

  it("converts the same beat pattern consistently across tempo", () => {
    const notes = [note(60, 0), note(62, 0.25), note(64, 0.5), note(65, 0.75)];

    expect(measurePlayability(notes, 60).global.medianIoiSeconds).toBeCloseTo(0.25, 6);
    expect(measurePlayability(notes, 120).global.medianIoiSeconds).toBeCloseTo(0.125, 6);
    expect(measurePlayability(notes, 240).global.medianIoiSeconds).toBeCloseTo(0.0625, 6);
  });

  it("keeps the diagnostic contract tied to the existing level limits", () => {
    const metrics = measurePlayability(rapidMonophonic(), 120);
    const assessment = assessPlayability(metrics, "medium");

    expect(assessment.limits).toEqual(PLAYABILITY_LIMITS.medium);
    expect(assessment.status).toBe("fail");
    expect(assessment.passes.maxSim).toBe(true);
  });
});
