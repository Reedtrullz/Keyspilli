import { describe, expect, it } from "vitest";
import {
  evaluateBeginnerGates,
  fixtureHashGate,
  groupOnsets,
  resolveOutputPath,
  selectAnchors,
  structuralClass,
} from "../scripts/lower-tier-task2-evaluator.js";

type Note = { midi: number; start: number; dur: number; vel: number; hand?: string; identitySource?: string };

const note = (start: number, midi = 40, identitySource?: Note["identitySource"]): Note => ({
  midi,
  start,
  dur: 0.5,
  vel: 80,
  hand: "L",
  identitySource,
});

describe("lower-tier Task 2 evaluator contracts", () => {
  it("uses production toFixed(3) onset buckets", () => {
    expect(groupOnsets([note(0.1), note(0.1004), note(0.1006)])).toHaveLength(2);
    expect(groupOnsets([note(0.1), note(0.1004)])[0]).toHaveLength(2);
  });

  it("selects one anchor from a close-start onset group", () => {
    const choices = selectAnchors([note(0.1, 40, "guitar"), note(0.1004, 41, "guitar")], 4);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.first.midi).toBe(40);
  });

  it("fails closed for missing, other, and unknown LH provenance", () => {
    expect(structuralClass(note(0, 40, "guitar"), true)).toBe("STRUCTURAL_LH");
    expect(structuralClass(note(0, 40, "other"), true)).toBe("UNKNOWN_UNSAFE");
    expect(structuralClass(note(0), true)).toBe("UNKNOWN_UNSAFE");
    expect(structuralClass(note(0, 40, "guitar"), false)).toBe("UNKNOWN_UNSAFE");
  });

  it("turns beginner grid and density violations into a failed gate", () => {
    const gates = evaluateBeginnerGates([
      { midi: 64, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 65, start: 0.13, dur: 1, vel: 80, hand: "R" },
      { midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
    ], 120);
    expect(gates.grid.pass).toBe(false);
    expect(gates.density.pass).toBe(false);
    expect(gates.allPass).toBe(false);
  });

  it("rejects a preregistration fixture hash mismatch", () => {
    expect(fixtureHashGate("expected", "actual")).toEqual({ expected: "expected", actual: "actual", matches: false });
  });

  it("defaults output to a temp path, never argv[0]", () => {
    const output = resolveOutputPath(["/node", "/evaluator.ts"]);
    expect(output).not.toBe("/node");
    expect(output).toContain("lower-tier-evaluator");
  });
});
