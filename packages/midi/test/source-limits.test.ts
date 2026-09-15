import { describe, expect, it } from "vitest";
import { assertSourceWorkload, buildVariants } from "../src/simplify.js";
import type { ParsedMidi } from "../src/types.js";
const source: ParsedMidi = { format: 1, division: 480, tempoBpm: 120, keySig: 0, keyMode: 0,
  timeSig: [4, 4], trackNames: [], durationBeats: 4,
  notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }] };
describe("source workload limits", () => {
  it("accepts ordinary sources but rejects sparse extreme timelines before allocation", () => {
    expect(() => assertSourceWorkload(source)).not.toThrow();
    for (const durationBeats of [Infinity, NaN, 1e9, -1]) {
      expect(() => buildVariants({ ...source, durationBeats }, { title: "Test", artist: "Test" }))
        .toThrow(/source workload/);
    }
    expect(() => assertSourceWorkload({ ...source, notes: [{ ...source.notes[0]!, start: 1e9 }] }))
      .toThrow(/source workload/);
  });
  it("bounds notes, measure count, and grid work", () => {
    expect(() => assertSourceWorkload({ ...source, notes: Array(20_001).fill(source.notes[0]) })).toThrow(/source workload/);
    expect(() => assertSourceWorkload({ ...source, durationBeats: 4000, timeSig: [1, 128] })).toThrow(/source workload/);
    expect(() => assertSourceWorkload(source, 0)).toThrow(/source workload/);
    expect(() => assertSourceWorkload({ ...source, durationBeats: 4000, notes: Array(20_000).fill(source.notes[0]) }))
      .toThrow(/source workload/);
  });
});
