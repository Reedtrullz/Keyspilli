import { describe, expect, it } from "vitest";
import {
  LEVEL_ORDER,
  PUBLIC_DIFFICULTY_ORDER,
  validateVariants,
  verifyMonotonicity,
  type DifficultyLevel,
  type Note,
  type Variant,
} from "../src/index.js";
import { BEGINNER_OFFGRID_CANDIDATE } from "../src/validate.js";

function notes(count: number, midiOffset = 0): Note[] {
  return Array.from({ length: count }, (_, index) => ({
    midi: 60 + midiOffset + (index % 5),
    start: index,
    dur: 0.5,
    vel: 88,
    hand: "R" as const,
  }));
}

function variant(level: DifficultyLevel, count: number, score: number, source = notes(count)): Variant {
  return {
    level,
    difficultyScore: score,
    notes: source.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "none",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: Math.max(8, count) }],
  };
}

function sixLevelSet(): Variant[] {
  return [
    variant("very-beginner", 8, 1),
    variant("beginner", 9, 1.4),
    // Deliberately larger than Easy: this is a valid legacy physical row but
    // it must not constrain the public five-level ordering.
    variant("very-easy", 20, 3),
    variant("easy", 10, 2.6),
    variant("medium", 11, 3.4),
    variant("advanced", 12, 4.6),
  ];
}

describe("production difficulty contract", () => {
  it("keeps six physical rows while validating public five-level ancestry", () => {
    const variants = sixLevelSet();

    expect(variants.map((item) => item.level)).toEqual(LEVEL_ORDER);
    expect(PUBLIC_DIFFICULTY_ORDER).toEqual([
      "very-beginner",
      "beginner",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("does not let a Very Easy RH mismatch affect public validation", () => {
    const variants = sixLevelSet();
    const veryEasy = variants.find((item) => item.level === "very-easy")!;
    veryEasy.notes.push({ midi: 95, start: 20, dur: 0.5, vel: 88, hand: "R" });

    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("still rejects a public Beginner to Easy RH ancestry break", () => {
    const beginnerNotes = [...notes(8), { midi: 72, start: 8, dur: 0.5, vel: 88, hand: "R" as const }];
    const easyNotes = [...notes(8), { midi: 73, start: 9, dur: 0.5, vel: 88, hand: "R" as const }];
    const variants = [
      variant("very-beginner", 8, 1),
      variant("beginner", beginnerNotes.length, 1.4, beginnerNotes),
      variant("easy", easyNotes.length, 2.6, easyNotes),
      variant("medium", 10, 3.4),
      variant("advanced", 11, 4.6),
    ];

    expect(validateVariants(variants)).toEqual(expect.arrayContaining([
      "beginner: note 72@8.00 missing from easy (ladder broken)",
    ]));
  });

  it("keeps Very Easy individual playability validation fail-closed", () => {
    const variants = sixLevelSet();
    const veryEasy = variants.find((item) => item.level === "very-easy")!;
    veryEasy.notes = veryEasy.notes.slice(0, 7);

    expect(validateVariants(variants)).toEqual(expect.arrayContaining([
      "very-easy: only 7 notes",
    ]));
  });

  it("continues honoring the Beginner off-grid exception on the public edge", () => {
    const beginnerNotes = notes(8);
    const offGrid = { midi: 79, start: 8.125, dur: 0.5, vel: 120, hand: "R" as const };
    Object.defineProperty(offGrid, BEGINNER_OFFGRID_CANDIDATE, { value: true, enumerable: true });
    beginnerNotes.push(offGrid);
    const variants = [
      variant("very-beginner", 8, 1),
      variant("beginner", beginnerNotes.length, 1.4, beginnerNotes),
      variant("easy", 8, 2.6),
      variant("medium", 9, 3.4),
      variant("advanced", 10, 4.6),
    ];

    expect(validateVariants(variants)).toEqual([]);
  });

  it("keeps public difficulty score monotonicity independent of Very Easy", () => {
    const variants = sixLevelSet();
    variants.find((item) => item.level === "very-easy")!.difficultyScore = 99;

    expect(verifyMonotonicity(variants)).toEqual([]);
    variants.find((item) => item.level === "medium")!.difficultyScore = 2;
    expect(verifyMonotonicity(variants)).toEqual(expect.arrayContaining([
      "easy difficultyScore 2.6 > medium difficultyScore 2",
    ]));
  });
});
