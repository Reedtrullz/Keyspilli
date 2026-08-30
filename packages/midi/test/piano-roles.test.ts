import { describe, expect, it } from "vitest";
import type { Note } from "../src/types.js";
import { splitPianoRoles } from "../src/piano-roles.js";

function note(midi: number, start: number, dur = 1, vel = 80, hand?: Note["hand"]): Note {
  return { midi, start, dur, vel, ...(hand ? { hand } : {}) };
}

describe("splitPianoRoles", () => {
  it("protects a continuous upper voice while leaving polyphonic support notes as accompaniment", () => {
    const notes: Note[] = [
      note(48, 0, 2, 62, "L"),
      note(60, 0, 2, 66),
      note(64, 0, 2, 66),
      note(72, 0, 1, 104, "R"),
      note(50, 2, 2, 62, "L"),
      note(62, 2, 2, 66),
      note(65, 2, 2, 66),
      note(74, 2, 1, 104, "R"),
      note(52, 4, 2, 62, "L"),
      note(64, 4, 2, 66),
      note(67, 4, 2, 66),
      note(76, 4, 1, 104, "R"),
    ];
    const before = structuredClone(notes);

    const split = splitPianoRoles(notes);

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([72, 74, 76]);
    expect(split.melody.map((entry) => entry.midi)).toEqual([72, 74, 76]);
    expect(split.accompaniment.map((entry) => entry.midi)).toEqual([48, 60, 64, 50, 62, 65, 52, 64, 67]);
    expect(notes).toEqual(before);
    expect(split.protectedMelody.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it("does not promote lower accompaniment when a stable upper line is present", () => {
    const notes: Note[] = [
      note(36, 0, 1.5, 110, "L"),
      note(43, 0, 1.5, 92, "L"),
      note(67, 0, 0.75, 84),
      note(38, 1.5, 1.5, 110, "L"),
      note(45, 1.5, 1.5, 92, "L"),
      note(69, 1.5, 0.75, 84),
      note(40, 3, 1.5, 110, "L"),
      note(47, 3, 1.5, 92, "L"),
      note(71, 3, 0.75, 84),
    ];

    const split = splitPianoRoles(notes);

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([67, 69, 71]);
    expect(split.protectedMelody.every((entry) => entry.midi > 60)).toBe(true);
    expect(split.accompaniment.map((entry) => entry.midi)).toEqual([36, 43, 38, 45, 40, 47]);
  });

  it("keeps repeated contour tones in the same protected line", () => {
    const notes: Note[] = [
      note(60, 0, 1.5, 64),
      note(67, 0, 0.5, 96),
      note(62, 1, 1.5, 64),
      note(67, 1, 0.5, 96),
      note(64, 2, 1.5, 64),
      note(69, 2, 0.5, 96),
      note(62, 3, 1.5, 64),
      note(67, 3, 0.5, 96),
    ];

    const split = splitPianoRoles(notes);

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([67, 67, 69, 67]);
    expect(split.protectedMelody.map((entry) => entry.start)).toEqual([0, 1, 2, 3]);
  });

  it("selects a top voice from a high-register triad instead of treating the whole right hand as melody", () => {
    const notes: Note[] = [
      note(72, 0, 2, 84, "R"),
      note(76, 0, 2, 84, "R"),
      note(79, 0, 1, 84, "R"),
      note(74, 2, 2, 84, "R"),
      note(77, 2, 2, 84, "R"),
      note(81, 2, 1, 84, "R"),
    ];

    const split = splitPianoRoles(notes);

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([79, 81]);
    expect(split.protectedMelody).toHaveLength(2);
    expect(split.accompaniment).toHaveLength(4);
  });

  it("is deterministic when equivalent notes arrive in a different input order", () => {
    const ordered: Note[] = [
      note(48, 0, 2, 60),
      note(60, 0, 2, 64),
      note(72, 0, 1, 100),
      note(50, 2, 2, 60),
      note(62, 2, 2, 64),
      note(74, 2, 1, 100),
    ];
    const reordered = [ordered[4]!, ordered[2]!, ordered[0]!, ordered[5]!, ordered[1]!, ordered[3]!];

    const first = splitPianoRoles(ordered);
    const second = splitPianoRoles(reordered);

    const protectedById = (split: ReturnType<typeof splitPianoRoles>) =>
      split.protectedMelody.map((entry) => [entry.identity, entry.midi, entry.start] as const);
    expect(protectedById(second)).toEqual(protectedById(first));
    expect(second.melody.map((entry) => entry.midi)).toEqual(first.melody.map((entry) => entry.midi));
    expect(second.accompaniment.map((entry) => entry.midi)).toEqual(first.accompaniment.map((entry) => entry.midi));
    expect(new Set(second.protectedMelody.map((entry) => entry.sourceIndex))).toEqual(new Set([1, 3]));
  });
});
