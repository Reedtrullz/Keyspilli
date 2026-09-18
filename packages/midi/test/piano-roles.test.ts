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

  it("collapses transitive onset jitter into one protected melody attack", () => {
    const split = splitPianoRoles([
      note(60, 0),
      note(62, 0.07),
      note(64, 0.13),
    ]);

    expect(split.protectedMelody).toHaveLength(1);
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

  it("allows a held melody to rest while backing attacks underneath it", () => {
    const split = splitPianoRoles([
      note(72, 0, 2, 100),
      note(48, 0, 0.5, 60),
      note(50, 1, 0.5, 60),
      note(74, 2, 1, 100),
      note(52, 2, 0.5, 60),
    ], { allowRests: true, preferSustainedLine: true });

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([72, 74]);
    expect(split.protectedMelody.map((entry) => entry.start)).toEqual([0, 2]);
  });

  it("keeps a true rest before a later melodic re-entry", () => {
    const split = splitPianoRoles([
      note(72, 0, 1, 100),
      note(50, 1, 0.5, 60),
      note(74, 2, 1, 100),
    ], { allowRests: true, preferSustainedLine: true });

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([72, 74]);
    expect(split.protectedMelody.map((entry) => entry.start)).toEqual([0, 2]);
  });

  it("retains competing-voice history through multiple rests before re-entry", () => {
    const split = splitPianoRoles([
      note(60, 0, 1, 92),
      note(72, 0, 0.5, 100),
      note(48, 1, 0.25, 60),
      note(50, 2, 0.25, 60),
      note(62, 3, 1, 92),
      note(74, 3, 0.5, 100),
    ], { allowRests: true, preferSustainedLine: true });

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([72, 74]);
    expect(split.protectedMelody.map((entry) => entry.start)).toEqual([0, 3]);
  });

  it("keeps a crossing melody when short upper decorations change hands", () => {
    const split = splitPianoRoles([
      note(60, 0, 1.5, 100, "L"),
      note(76, 0, 0.125, 60, "R"),
      note(62, 1, 1.5, 100, "R"),
      note(77, 1, 0.125, 60, "R"),
    ], { allowRests: true, preferSustainedLine: true });

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([60, 62]);
    expect(split.protectedMelody.map((entry) => entry.hand)).toEqual(["L", "R"]);
  });

  it("reports near-tied selected-path alternatives instead of raw top-pitch warnings", () => {
    const split = splitPianoRoles([
      note(48, 0, 1, 60), note(60, 0, 1, 80), note(61, 0, 1, 80),
      note(48, 1, 1, 60), note(60, 1, 1, 80), note(61, 1, 1, 80),
    ]);

    expect(split.pathEvidence.length).toBeGreaterThan(0);
    expect(split.pathEvidence[0]).toMatchObject({
      selectedIdentity: expect.any(String),
      alternativeIdentity: expect.any(String),
    });
    expect(split.pathEvidence.every((span) => span.scoreMargin >= 0)).toBe(true);
  });

  it("uses later continuation to resolve a locally competitive onset", () => {
    const prefix = [note(60, 0, 3, 80), note(64, 0, 0.5, 80)];
    const local = splitPianoRoles(prefix, { preferSustainedLine: true });
    const full = splitPianoRoles([
      ...prefix,
      note(64, 1, 1, 80),
      note(65, 2, 1, 80),
    ], { preferSustainedLine: true });

    expect(local.melody.map((entry) => entry.midi)).toEqual([60]);
    expect(full.melody.map((entry) => [entry.midi, entry.start])).toEqual([[64, 0], [64, 1], [65, 2]]);
    expect(full.pathEvidence.some((span) => span.startBeat === 0)).toBe(false);
  });

  it("keeps exact unison duplicates audibly equivalent while retaining one source lineage", () => {
    const split = splitPianoRoles([
      note(60, 0, 1, 80),
      note(60, 0, 1, 80),
      note(62, 1, 1, 80),
    ]);

    expect(split.protectedMelody.map((entry) => entry.midi)).toEqual([60, 62]);
    expect(split.protectedMelody.map((entry) => entry.sourceIndex)).toHaveLength(2);
    expect(split.accompaniment.filter((entry) => entry.midi === 60)).toHaveLength(1);
    expect(split.pathEvidence.some((span) => span.selectedIdentity && span.alternativeIdentity)).toBe(true);
  });
});
