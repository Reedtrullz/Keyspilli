import { describe, expect, it } from "vitest";
import type { Note, Variant } from "@keyspilli/midi";
import {
  canonicalBeginnerOffGridRhFrontierJson,
  evaluateBeginnerOffGridRhFrontier,
  type BeginnerOffGridRhFrontierInput,
} from "../src/index.js";

function variant(level: Variant["level"], notes: Note[], tempoBpm = 120): Variant {
  return {
    level,
    difficultyScore: { "very-beginner": 1, beginner: 1.4, "very-easy": 2, easy: 2.6, medium: 3.4, advanced: 4.6 }[level],
    notes: notes.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
  };
}

function input(source: Note[], beginner: Note[], easy = source): BeginnerOffGridRhFrontierInput {
  return {
    fixture: { id: "synthetic" },
    sourceNotes: source,
    rejectedRhNotes: source,
    variants: [
      variant("very-beginner", beginner, 60),
      variant("beginner", beginner, 60),
      variant("very-easy", source, 60),
      variant("easy", easy, 60),
    ],
  };
}

describe("Beginner off-grid RH frontier", () => {
  it("selects only structurally supported attacks and enforces one/two-per-window budgets", () => {
    const source: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 80, hand: "R" },
      { midi: 62, start: 0.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 64, start: 0.375, dur: 0.75, vel: 110, hand: "R" },
      { midi: 65, start: 1, dur: 0.25, vel: 80, hand: "R" },
      { midi: 67, start: 2, dur: 0.25, vel: 80, hand: "R" },
      { midi: 69, start: 3, dur: 0.25, vel: 80, hand: "R" },
    ];
    const report = evaluateBeginnerOffGridRhFrontier(input(source, source.filter((note) => note.start % 1 === 0)));
    expect(report.candidates.baseline.emitted).toBe(0);
    expect(report.candidates["candidate-a"].emitted).toBe(1);
    expect(report.candidates["candidate-b"].emitted).toBe(2);
    expect(report.candidates["candidate-a"].discardedByWindowBudget).toBe(1);
    expect(report.candidates["candidate-a"].eligible).toBe(2);
    expect(report.candidates["candidate-a"].emittedStarts).toEqual([0.125]);
    expect(report.candidates["candidate-a"].lhNotes).toBe(report.candidates.baseline.lhNotes);
  });

  it("blocks a candidate whose extra sounding note would collide with frozen LH", () => {
    const baseline: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 70, hand: "L" },
    ];
    const source = [...baseline, { midi: 64, start: 0.125, dur: 0.25, vel: 127, hand: "R" as const }];
    const report = evaluateBeginnerOffGridRhFrontier(input(source, baseline));
    expect(report.candidates["candidate-a"].emitted).toBe(0);
    expect(report.candidates["candidate-a"].blockers.BLOCKED_BY_CURRENT_LH).toBe(1);
    expect(report.candidates["candidate-a"].metrics.maxSimultaneity).toBe(2);
    expect(report.controls.lhUnchanged).toBe(true);
  });

  it("reports timing complexity and stays deterministic under reordered notes", () => {
    const source: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 80, hand: "R" },
      { midi: 62, start: 0.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 64, start: 1, dur: 0.25, vel: 80, hand: "R" },
    ];
    const first = evaluateBeginnerOffGridRhFrontier(input(source, source.filter((note) => note.start === 0)));
    const second = evaluateBeginnerOffGridRhFrontier({
      ...input(source, source.filter((note) => note.start === 0)),
      sourceNotes: [...source].reverse(),
      variants: input(source, source.filter((note) => note.start === 0)).variants.map((item) => ({ ...item, notes: [...item.notes].reverse() })),
    });
    expect(first.candidates["candidate-a"].timing.offGridFraction).toBeGreaterThan(0);
    expect(first.candidates["candidate-a"].timing.offGridAttacksPerMinute).toBeGreaterThan(0);
    expect(first.candidates["candidate-a"].timing.minimumSubdivisionBeats).toBe(0.125);
    expect(canonicalBeginnerOffGridRhFrontierJson(first)).toBe(canonicalBeginnerOffGridRhFrontierJson(second));
  });

  it("uses beginner-ladder first-loss trace events as the frozen rejection pool", () => {
    const source: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 80, hand: "R" },
      { midi: 62, start: 0.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 64, start: 0.375, dur: 0.5, vel: 120, hand: "R" },
    ];
    const report = evaluateBeginnerOffGridRhFrontier({
      ...input(source, [source[0]!]),
      trace: [
        { key: "raw-lost", stage: "raw", note: source[1], selected: true },
        { key: "lost", stage: "beginner-ladder", parentKeys: ["raw-lost"], note: source[1], selected: false, operation: "REJECTED" },
      ],
    });
    expect(report.lineage.traceAvailable).toBe(true);
    expect(report.lineage.rejectedEvents).toBe(1);
    expect(report.candidates["candidate-b"].eligible).toBe(1);
  });

  it("resolves a quantized rejection through its raw off-grid ancestor", () => {
    const raw: Note = { midi: 64, start: 0.125, dur: 0.5, vel: 120, hand: "R" };
    const quantized: Note = { ...raw, start: 0.25 };
    const report = evaluateBeginnerOffGridRhFrontier({
      ...input([raw, { midi: 67, start: 1, dur: 0.5, vel: 80, hand: "R" }], [{ midi: 60, start: 0, dur: 0.5, vel: 80, hand: "R" }]),
      trace: [
        { key: "raw-lead", stage: "raw", parentKeys: [], note: raw, selected: true },
        { key: "beginner-rejection", stage: "beginner-ladder", parentKeys: ["raw-lead"], note: quantized, selected: false, operation: "REJECTED" },
      ],
    });
    expect(report.candidates["candidate-a"].eligible).toBe(1);
    expect(report.candidates["candidate-a"].emittedStarts).toEqual([0.125]);
    expect(report.config.gridToleranceBeats).toBe(0.01);
  });

  it("fails closed for ambiguous ancestry and malformed trace notes", () => {
    const source: Note[] = [
      { midi: 60, start: 0, dur: 0.25, vel: 80, hand: "R" },
      { midi: 62, start: 0.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 64, start: 0.375, dur: 0.5, vel: 120, hand: "R" },
    ];
    const report = evaluateBeginnerOffGridRhFrontier({
      ...input(source, [source[0]!]),
      trace: [
        { key: "raw-a", stage: "raw", note: source[1], selected: true },
        { key: "raw-b", stage: "raw", note: source[2], selected: true },
        { key: "ambiguous", stage: "beginner-ladder", parentKeys: ["raw-a", "raw-b"], note: source[1], selected: false, operation: "REJECTED" },
        { key: "malformed", stage: "beginner-ladder", parentKeys: ["raw-a"], note: { ...source[1]!, midi: 128 }, selected: false, operation: "REJECTED" },
        { key: "contradictory", stage: "beginner-ladder", parentKeys: ["raw-a"], note: source[1], selected: true, operation: "REJECTED" },
      ],
    });
    expect(report.lineage.rejectedEvents).toBe(2);
    expect(report.lineage.resolvedRejectedEvents).toBe(0);
    expect(report.lineage.unresolvedRejectedEvents).toBe(2);
    expect(report.candidates["candidate-a"].eligible).toBe(0);
  });

  it("fails closed without lineage or an explicit frozen rejection set", () => {
    const source: Note[] = [{ midi: 60, start: 0.125, dur: 0.5, vel: 120, hand: "R" }];
    const report = evaluateBeginnerOffGridRhFrontier({ fixture: { id: "synthetic" }, sourceNotes: source, variants: [variant("beginner", []), variant("very-easy", source), variant("easy", source)] });
    expect(report.lineage.traceAvailable).toBe(false);
    expect(report.lineage.rejectedEvents).toBe(0);
    expect(report.candidates["candidate-b"].eligible).toBe(0);
  });
});
