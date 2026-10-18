import { describe, expect, it } from "vitest";
import { functionalDegree, validKeyRegions } from "../src/functional-harmony.js";
import { dedupeChords } from "../src/timeline.js";

// Worst-case inputs for patterns CodeQL flagged as polynomial ReDoS
// (alerts #7, #8, #9). With the old regular expressions these took seconds;
// they must now finish well inside the budget.
const BUDGET_MS = 500;
function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

describe("ReDoS regressions", () => {
  it("parses key names with long whitespace runs in linear time", () => {
    const hostile = `C${" ".repeat(100_000)}x`;
    const { value, ms } = timed(() => functionalDegree("C", hostile));
    expect(value).toBeNull();
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("keeps the major/minor key suffix behaviour", () => {
    expect(functionalDegree("C", "C major")?.roman).toBe("I");
    expect(functionalDegree("C", "A   minor")?.roman).toBe("III");
    expect(functionalDegree("C", "c MAJOR")?.roman).toBe("I");
    expect(validKeyRegions([{ startBeat: 0, endBeat: 4, key: "A minor" }], 8)).toBe(true);
  });

  it("derives chord qualities from long chord names in linear time", () => {
    const hostile = `A${" ".repeat(50_000)}x`;
    const { value, ms } = timed(() => dedupeChords([
      { beat: 0, name: hostile, notes: [], sourceKind: "authored" },
      { beat: 1, name: hostile, notes: [], sourceKind: "authored" },
    ]));
    expect(value).toEqual([{ beat: 0, name: hostile, notes: [], sourceKind: "authored", durationBeats: 2 }]);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
