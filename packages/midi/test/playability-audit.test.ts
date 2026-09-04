import { describe, expect, it } from "vitest";
import {
  analyzeDensityAttacks,
  boundedDensityDeletionOracle,
  compareDensityAttackSets,
  PLAYABILITY_LIMITS,
  selectProtectedSemanticLocalThinning,
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

describe("report-only density normalization diagnostics", () => {
  it("models chords as one attack and protects principal melody/phrase anchors", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 90, hand: "L" },
      { midi: 64, start: 0, dur: 0.25, vel: 90, hand: "R" },
      { midi: 65, start: 0.125, dur: 0.125, vel: 70, hand: "L" },
      { midi: 67, start: 0.25, dur: 0.125, vel: 70, hand: "L" },
    ];
    const analyses = analyzeDensityAttacks(notes);

    expect(analyses).toHaveLength(3);
    expect(analyses[0]!.semantics.noteCount).toBe(2);
    expect(analyses[0]!.semantics.principalMelody).toBe(true);
    expect(analyses[0]!.semantics.phraseBoundary).toBe(true);
    expect(analyses[0]!.semantics.removable).toBe(false);
  });

  it("thins only removable rapid support attacks without retiming or creating notes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 100, hand: "R" },
      { midi: 36, start: 0.125, dur: 0.125, vel: 50, hand: "L" },
      { midi: 62, start: 0.25, dur: 0.25, vel: 100, hand: "R" },
      { midi: 38, start: 0.375, dur: 0.125, vel: 50, hand: "L" },
      { midi: 64, start: 0.5, dur: 0.25, vel: 100, hand: "R" },
    ];
    const result = selectProtectedSemanticLocalThinning(notes, 120, "easy");

    expect(result.removedAttackIndexes.length).toBeGreaterThan(0);
    expect(result.notes.filter((note) => note.hand !== "L").map((note) => note.start)).toEqual([0, 0.25, 0.5]);
    expect(result.retimedEvents).toBe(0);
    expect(result.createdEvents).toBe(0);
    expect(result.notes.every((note) => notes.includes(note) || notes.some((source) => JSON.stringify(source) === JSON.stringify(note)))).toBe(true);
  });

  it("is a no-op for an arrangement that already passes the unchanged validator", () => {
    const notes = [note(60, 0), note(62, 1), note(64, 2)];
    const result = selectProtectedSemanticLocalThinning(notes, 120, "easy");

    expect(result.removedAttackIndexes).toEqual([]);
    expect(result.notes).toEqual(notes);
  });

  it("keeps the attack differential deterministic and reports rapid-gap resolution", () => {
    const harder: Note[] = [
      { midi: 60, start: 0, dur: 0.125, vel: 90, hand: "R" },
      { midi: 36, start: 0.125, dur: 0.125, vel: 50, hand: "L" },
      { midi: 62, start: 0.25, dur: 0.125, vel: 90, hand: "R" },
    ];
    const easier = [harder[0]!, harder[2]!];
    const first = compareDensityAttackSets(harder, easier, 120, "easy");
    const second = compareDensityAttackSets([...harder].reverse(), [...easier].reverse(), 120, "easy");

    expect(first.harderAttacks).toBe(3);
    expect(first.easierAttacks).toBe(2);
    expect(first.removed[0]!.hand).toBe("L");
    expect(first.directResolutions).toBe(1);
    expect(second).toEqual(first);
  });

  it("bounds the deletion oracle at the supplied lower-level note floor", () => {
    const notes: Note[] = Array.from({ length: 12 }, (_, index) => ({
      midi: index % 2 ? 36 : 60 + index,
      start: index * 0.125,
      dur: 0.1,
      vel: index % 2 ? 45 : 95,
      hand: index % 2 ? "L" as const : "R" as const,
    }));
    const result = boundedDensityDeletionOracle(notes, 120, "easy", notes.length - 2);

    expect(result.notes.length).toBeGreaterThanOrEqual(notes.length - 2);
    expect(result.retimedEvents).toBe(0);
    expect(result.createdEvents).toBe(0);
    expect(result.finalAssessment.status).toBe("fail");
    expect(result.exhausted).toBe(true);
  });
});
