import { describe, expect, it } from "vitest";
import {
  buildVariants,
  LEVEL_ORDER,
  verifyMonotonicity,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import {
  canonicalDifficultyLadderJson,
  evaluateDifficultyLadder,
  type ProvenanceTraceEvent,
} from "../src/arrangement-evaluation.js";

function sourceNotes(): Note[] {
  const melody = [60, 60, 62, 64, 65, 64, 62, 60].map((midi, index) => ({
    midi,
    start: index,
    dur: 0.75,
    vel: index === 0 ? 108 : 88,
    hand: "R" as const,
    identitySource: "vocals" as const,
  }));
  const roots = [36, 36, 43, 43].map((midi, index) => ({
    midi,
    start: index * 2,
    dur: 1.5,
    vel: 86,
    hand: "L" as const,
    identitySource: "guitar" as const,
  }));
  return [...melody, ...roots];
}

function parsed(notes: Note[]): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["synthetic ladder"],
    durationBeats: 8,
    title: "Synthetic ladder",
  };
}

function learnerVariants(notes = sourceNotes()): { variants: Variant[]; trace: ProvenanceTraceEvent[] } {
  const trace: ProvenanceTraceEvent[] = [];
  const variants = buildVariants(parsed(notes), { title: "Synthetic ladder", artist: "Test" }, {
    arrangementProfile: "learner",
    maxDurBeats: null,
    trace: { record: (event) => trace.push(event) },
  });
  return { variants, trace };
}

function manualVariant(level: Variant["level"], notes: Note[], score: number): Variant {
  return {
    level,
    difficultyScore: score,
    notes: notes.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
  };
}

function sameNotesVariants(notes: Note[] = sourceNotes()): Variant[] {
  return LEVEL_ORDER.map((level, index) => manualVariant(level, notes, [1, 1.4, 2, 2.6, 3.4, 4.6][index]!));
}

describe("difficulty ladder calibration", () => {
  it("uses the canonical six-level order and emits deterministic all-level diagnostics", () => {
    const first = learnerVariants();
    const second = learnerVariants([...sourceNotes()].reverse());
    const firstReport = evaluateDifficultyLadder({
      fixture: { id: "synthetic-ladder" },
      sourceNotes: sourceNotes(),
      variants: first.variants,
      trace: first.trace,
    });
    const secondReport = evaluateDifficultyLadder({
      fixture: { id: "synthetic-ladder" },
      sourceNotes: [...sourceNotes()].reverse(),
      variants: first.variants.map((variant) => ({ ...variant, notes: [...variant.notes].reverse() })),
      trace: [...first.trace].reverse(),
    });

    expect(firstReport.order).toEqual(LEVEL_ORDER);
    expect(firstReport.transitions).toHaveLength(5);
    expect(firstReport.levels.advanced?.difficultyScore).toBe(4.6);
    expect(firstReport.levels.advanced?.identity.sourceRhOnsetCoverage).toBe(1);
    expect(firstReport.levels["very-easy"]?.harmonicRootChanges).toBeGreaterThan(0);
    expect(firstReport.levels["very-easy"]?.repeatedAttackRate).toBeGreaterThanOrEqual(0);
    expect(firstReport.levels.easy?.lineage.traceAvailable).toBe(true);
    expect(firstReport.levels.easy?.lineage.operationCounts).toBeDefined();
    expect(canonicalDifficultyLadderJson(firstReport)).toBe(canonicalDifficultyLadderJson(secondReport));
    expect(verifyMonotonicity(first.variants)).toEqual([]);
  });

  it("counts difficulty operations and exposes a stable identity/harmony lineage", () => {
    const notes = [...sourceNotes(), { midi: 60, start: 0.25, dur: 0.125, vel: 86, hand: "R" as const, identitySource: "vocals" as const }];
    const variants = sameNotesVariants(notes);
    const trace: ProvenanceTraceEvent[] = [
      { key: "difficulty:easy:octave", stage: "difficulty", operation: "OCTAVE_SHIFTED", selected: true },
      { key: "difficulty:medium:merge", stage: "difficulty", operation: "MERGED", selected: true },
    ];
    const report = evaluateDifficultyLadder({ fixture: { id: "lineage" }, sourceNotes: notes, variants, trace });

    expect(report.levels.easy?.lineage.operationCounts).toEqual({ OCTAVE_SHIFTED: 1 });
    expect(report.levels.medium?.lineage.operationCounts).toEqual({ MERGED: 1 });
    expect(report.levels.advanced?.lineage.sourceNotesMatched).toBe(notes.length);
    expect(report.levels["very-easy"]?.harmonicRootChanges).toBe(1);
    expect(report.levels["very-easy"]?.repeatedAttackRate).toBeGreaterThan(0);
    expect(report.transitions.every((transition) => transition.classification === "REDUNDANT_LEVEL")).toBe(true);
    expect(report.transitions.every((transition) => transition.violations.length === 0)).toBe(true);
  });

  it("classifies a missing identity edge as a non-monotonic transition", () => {
    const notes = sourceNotes();
    const variants = sameNotesVariants(notes);
    const veryEasy = variants.find((variant) => variant.level === "very-easy")!;
    veryEasy.notes.push({ midi: 72, start: 8, dur: 0.5, vel: 70, hand: "R", identitySource: "vocals" });
    const report = evaluateDifficultyLadder({ fixture: { id: "cliff" }, sourceNotes: notes, variants });
    const transition = report.transitions.find((entry) => entry.harder === "easy" && entry.easier === "very-easy");

    expect(transition?.violations).toContain("note count increased");
    expect(transition?.classification).toBe("NON_MONOTONIC");
  });

  it("rejects duplicate level records instead of silently overwriting diagnostics", () => {
    const variants = sameNotesVariants();
    expect(() => evaluateDifficultyLadder({
      fixture: { id: "duplicate" },
      sourceNotes: sourceNotes(),
      variants: [variants[0]!, variants[0]!],
    })).toThrow(/duplicate difficulty level/i);
  });

  it("keeps omitted levels explicit in the report order", () => {
    const variants = sameNotesVariants().filter((variant) => variant.level !== "beginner");
    const report = evaluateDifficultyLadder({ fixture: { id: "partial" }, sourceNotes: sourceNotes(), variants });
    expect(report.order).toEqual(["very-beginner", "very-easy", "easy", "medium", "advanced"]);
    expect(report.transitions).toHaveLength(3);
  });

  it("counts the final phrase group as an anchor", () => {
    const notes = [0, 1, 2, 6].map((start) => ({
      midi: 60,
      start,
      dur: 0.25,
      vel: 80,
      hand: "R" as const,
      identitySource: "vocals" as const,
    }));
    const variants = sameNotesVariants(notes).map((variant) => ({
      ...variant,
      notes: variant.notes.filter((note) => note.start < 6),
    }));
    const report = evaluateDifficultyLadder({ fixture: { id: "phrase-end" }, sourceNotes: notes, variants });
    expect(report.levels.advanced?.identity.anchorSurvival).toBe(0.5);
  });
});
