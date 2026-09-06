import { describe, expect, it } from "vitest";
import { LEVEL_ORDER, PUBLIC_DIFFICULTY_ORDER, type Note, type Variant } from "@keyspilli/midi";
import { evaluateDifficultyContract } from "../src/difficulty-contract-audit.js";

function notes(count = 8, midi = 60): Note[] {
  return Array.from({ length: count }, (_, index) => ({
    midi: midi + (index % 3),
    start: index,
    dur: 0.5,
    vel: 88,
    hand: "R" as const,
    identitySource: "vocals" as const,
  }));
}

function variant(level: Variant["level"], count = 8, score = 1): Variant {
  return {
    level,
    difficultyScore: score,
    notes: notes(count),
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
  };
}

function fullLadder(): Variant[] {
  return LEVEL_ORDER.map((level, index) => variant(level, 8 + index, 1 + index));
}

describe("difficulty contract audit", () => {
  it("passes the six-level contract and the public five-level contract on a nested ladder", () => {
    const result = evaluateDifficultyContract(fullLadder());

    expect(result.physical.order).toEqual(LEVEL_ORDER);
    expect(result.physical.pass).toBe(true);
    expect(result.public.order).toEqual(PUBLIC_DIFFICULTY_ORDER);
    expect(result.public.pass).toBe(true);
    expect(result.veryEasyIndependent).toMatchObject({ present: true, pass: true, validationErrors: [] });
  });

  it("removes only the legacy VE-to-E edge from the public diagnostic", () => {
    const variants = fullLadder().map((item) => item.level === "very-easy"
      ? variant("very-easy", 20, 3)
      : item.level === "easy" ? variant("easy", 12, 4) : item);
    const result = evaluateDifficultyContract(variants);

    expect(result.physical.pass).toBe(false);
    expect(result.physical.edgeErrors["very-easy->easy"]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^note count increased/),
    ]));
    expect(result.public.pass).toBe(true);
    expect(result.public.edgeErrors["beginner->easy"]).toEqual([]);
    expect(result.veryEasyIndependent.pass).toBe(true);
  });

  it("still rejects a public RH ancestry break and score inversion", () => {
    const variants = fullLadder().map((item) => item.level === "medium"
      ? { ...item, difficultyScore: 2, notes: notes(10, 72) }
      : item);
    const result = evaluateDifficultyContract(variants);

    expect(result.public.pass).toBe(false);
    expect(result.public.edgeErrors["easy->medium"]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^difficulty score decreased/),
      expect.stringMatching(/RH note .* missing/),
    ]));
  });

  it("is deterministic when variant and note order are reversed", () => {
    const first = evaluateDifficultyContract(fullLadder());
    const reversed = evaluateDifficultyContract(fullLadder().reverse().map((item) => ({
      ...item,
      notes: [...item.notes].reverse(),
    })));

    expect(reversed).toEqual(first);
  });

  it("reports an invalid legacy VE independently of the public edges", () => {
    const variants = fullLadder().map((item) => item.level === "very-easy" ? variant("very-easy", 2, 3) : item);
    const result = evaluateDifficultyContract(variants);

    expect(result.public.pass).toBe(true);
    expect(result.veryEasyIndependent.pass).toBe(false);
    expect(result.veryEasyIndependent.validationErrors).toContain("very-easy: only 2 notes");
  });
});
