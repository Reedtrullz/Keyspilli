import { describe, expect, it } from "vitest";
import {
  groupAttackClusters,
  inferPianoHarmony,
  realizePianoAccompaniment,
  simplifyPianoAccompaniment,
} from "../src/piano-accompaniment.js";
import type { Note } from "../src/types.js";

function note(midi: number, start = 0, dur = 1, vel = 96, identitySource: Note["identitySource"] = "other"): Note {
  return { midi, start, dur, vel, identitySource };
}

function stack(pitches: number[], start: number, dur = 1): Note[] {
  return pitches.map((midi, index) => note(midi, start + index * 0.01, dur, 96 - index * 3));
}

describe("conservative piano accompaniment", () => {
  it("groups jittered attacks deterministically", () => {
    const ordered = [
      ...stack([40, 47, 52], 0),
      ...stack([43, 50], 1),
    ];
    const clusters = groupAttackClusters(ordered);
    const reversed = groupAttackClusters([...ordered].reverse());

    expect(clusters.map((cluster) => [cluster.start, cluster.notes.map((item) => item.midi)])).toEqual([
      [0, [40, 47, 52]],
      [1, [43, 50]],
    ]);
    expect(reversed).toEqual(clusters);
  });

  it("reduces an E-minor six-note stack to a conservative open accompaniment", () => {
    const input = [40, 52, 59, 64, 67, 71].map((midi) => note(midi, 0, 2, 100, "guitar"));
    const result = simplifyPianoAccompaniment(input);

    expect(result.harmony[0]).toMatchObject({ rootPc: 4, quality: "minor" });
    expect(result.harmony[0]!.confidence).toBeGreaterThan(0.65);
    expect(result.notes.map((item) => item.midi)).toEqual([40, 47]);
    expect(result.notes.every((item) => item.start === 0 && item.dur === 2)).toBe(true);
    expect(result.notes.every((item) => item.identitySource === "guitar")).toBe(true);
  });

  it("opens a low close-position triad but preserves a high triad", () => {
    const low = simplifyPianoAccompaniment([note(36), note(40), note(43)]);
    const high = simplifyPianoAccompaniment([note(60), note(64), note(67)]);

    expect(low.notes.map((item) => item.midi)).toEqual([36, 43]);
    expect(high.notes.map((item) => item.midi)).toEqual([60, 64, 67]);
  });

  it("does not promote a weak or conflicting third into a confident triad", () => {
    const weakThird = inferPianoHarmony(groupAttackClusters([
      note(48, 0, 1, 112),
      note(55, 0.02, 1, 108),
      note(51, 0.04, 0.12, 28),
    ]));
    const conflictingThird = inferPianoHarmony(groupAttackClusters([
      note(48, 0, 1, 100),
      note(55, 0.01, 1, 100),
      note(51, 0.02, 0.8, 92),
      note(52, 0.03, 0.8, 92),
    ]));

    expect(weakThird[0]).toMatchObject({ rootPc: 0, quality: "power" });
    expect(conflictingThird[0]!.quality).toBe("unknown");
    expect(conflictingThird[0]!.confidence).toBeLessThan(0.8);
    expect(realizePianoAccompaniment(weakThird).map((item) => item.midi)).toEqual([48, 55]);
  });

  it("ignores a passing bass note, accepts a sustained root change, and fills a missing root", () => {
    const attacks = groupAttackClusters([
      ...stack([48, 55], 0),
      ...stack([48, 55], 1),
      ...stack([43, 50], 2),
      ...stack([43, 50], 3),
    ]);
    const bass = [
      note(43, 0, 0.2, 120, "other"),
      note(36, 0.5, 3.5, 80, "other"),
      note(43, 2, 2, 90, "other"),
    ];
    const harmony = inferPianoHarmony(attacks, bass);

    expect(harmony.map((event) => event.rootPc)).toEqual([0, 0, 7, 7]);
    expect(harmony[0]!.rootStability).toBeGreaterThan(0.5);

    const missingRoot = inferPianoHarmony(
      groupAttackClusters([note(52, 0, 1, 100, "guitar"), note(55, 0.01, 1, 100, "guitar")]),
      [note(36, 0, 2, 100, "other")],
    );
    expect(missingRoot[0]).toMatchObject({ rootPc: 0, quality: "major" });
    expect(missingRoot[0]!.confidence).toBeGreaterThan(0.5);
  });

  it("preserves repeated attack timing and source tags while capping the low hand", () => {
    const input = [0, 1, 2].flatMap((start) => [
      note(40, start, 0.25, 100, "guitar"),
      note(47, start + 0.02, 0.2, 80, "guitar"),
      note(52, start + 0.03, 0.2, 76, "guitar"),
    ]);
    const result = simplifyPianoAccompaniment(input);
    const starts = [...new Set(result.notes.map((item) => item.start))].sort((a, b) => a - b);

    expect(starts).toEqual([0, 1, 2]);
    expect(result.notes.every((item) => item.identitySource === "guitar")).toBe(true);
    expect(result.notes.every((item) => item.midi >= 0 && item.midi <= 127)).toBe(true);
    expect(result.diagnostics.maxLeftHandNotesPerAttack).toBeLessThanOrEqual(3);
  });

  it("is invariant to note ordering", () => {
    const input = [
      ...stack([40, 47, 52, 59], 0),
      ...stack([43, 50, 55], 1),
      ...stack([40, 47, 52], 2),
    ];
    const first = simplifyPianoAccompaniment(input);
    const second = simplifyPianoAccompaniment([...input].reverse());

    expect(second).toEqual(first);
  });

  it("does not trust an isolated quiet third as major or minor evidence", () => {
    const harmony = inferPianoHarmony(groupAttackClusters([
      note(48, 0, 1, 100),
      note(55, 0.01, 1, 100),
      note(52, 0.02, 1, 10),
    ]));

    expect(harmony[0]?.quality).toBe("power");
  });

  it("does not stabilize roots across a phrase break", () => {
    const harmony = inferPianoHarmony(groupAttackClusters([
      ...stack([48, 55], 0),
      ...stack([43, 50], 10),
      ...stack([48, 55], 20),
    ]));

    expect(harmony.map((event) => event.rootPc)).toEqual([0, 7, 0]);
  });

  it("keeps protected melody out of inferred left-hand evidence", () => {
    const melody = note(64, 0, 2, 110, "guitar");
    const result = simplifyPianoAccompaniment([
      melody,
      note(48, 0, 2, 80, "guitar"),
      note(55, 0, 2, 80, "guitar"),
    ], { protectedNotes: [melody] });

    expect(result.notes.some((item) => item.hand === "L" && item.midi === 64)).toBe(false);
  });
});
