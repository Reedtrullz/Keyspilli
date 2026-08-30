import { describe, expect, it } from "vitest";
import type { Note, ParsedMidi } from "@keyspilli/midi";
import { buildSectionAwarePianoCandidate, type PianoSectionBuildInput } from "../src/piano-section-builder.js";

function parsed(notes: Note[], tempoBpm = 120): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm,
    keySig: 0,
    keyMode: 1,
    timeSig: [4, 4],
    notes,
    trackNames: ["Imported piano"],
    durationBeats: Math.max(8, ...notes.map((note) => note.start + note.dur)),
    title: "synthetic piano candidate",
  };
}

const cMelody: Note[] = [
  { midi: 72, start: 0, dur: 1, vel: 104 },
  { midi: 74, start: 1, dur: 1, vel: 104 },
  { midi: 76, start: 2, dur: 1, vel: 104 },
  { midi: 74, start: 3, dur: 1, vel: 104 },
  { midi: 72, start: 4, dur: 1, vel: 104 },
  { midi: 74, start: 5, dur: 1, vel: 104 },
  { midi: 76, start: 6, dur: 1, vel: 104 },
  { midi: 74, start: 7, dur: 1, vel: 104 },
];

const cHarmony: Note[] = [
  { midi: 48, start: 0, dur: 1, vel: 70 },
  { midi: 52, start: 0, dur: 1, vel: 70 },
  { midi: 55, start: 0, dur: 1, vel: 70 },
  { midi: 50, start: 1, dur: 1, vel: 70 },
  { midi: 53, start: 1, dur: 1, vel: 70 },
  { midi: 57, start: 1, dur: 1, vel: 70 },
  { midi: 43, start: 2, dur: 1, vel: 70 },
  { midi: 47, start: 2, dur: 1, vel: 70 },
  { midi: 50, start: 2, dur: 1, vel: 70 },
  { midi: 45, start: 3, dur: 1, vel: 70 },
  { midi: 48, start: 3, dur: 1, vel: 70 },
  { midi: 52, start: 3, dur: 1, vel: 70 },
];

const dSolo: Note[] = [
  { midi: 84, start: 4, dur: 1, vel: 110 },
  { midi: 86, start: 5, dur: 1, vel: 110 },
  { midi: 88, start: 6, dur: 1, vel: 110 },
  { midi: 86, start: 7, dur: 1, vel: 110 },
];

function input(overrides: Partial<PianoSectionBuildInput> = {}): PianoSectionBuildInput {
  return {
    primary: { id: "C", parsed: parsed([...cMelody, ...cHarmony]) },
    alternates: [{
      id: "D",
      parsed: parsed(dSolo),
      selection: { windowScores: { opening: 0.05, solo: 1 } },
    }],
    windows: [
      { id: "opening", startBeat: 0, endBeat: 4 },
      { id: "solo", startBeat: 4, endBeat: 8 },
    ],
    selectionOptions: { switchPenalty: 0, hysteresis: 0 },
    ...overrides,
  };
}

describe("buildSectionAwarePianoCandidate", () => {
  it("protects the primary melody and substitutes an aligned alternate only in its selected region", () => {
    const result = buildSectionAwarePianoCandidate(input());

    expect(result.cOriginal.parsed.notes).toHaveLength(20);
    expect(result.cMelodyOnly.parsed.notes.map((note) => note.midi)).toEqual(cMelody.map((note) => note.midi));
    expect(result.cMelodyOnly.parsed.notes.every((note) => note.hand === "R")).toBe(true);
    expect(result.selection.selectedCandidateIds).toEqual(["C", "D"]);
    expect(result.selection.regions).toEqual([
      expect.objectContaining({ candidateId: "C", startBeat: 0, endBeat: 4 }),
      expect.objectContaining({ candidateId: "D", startBeat: 4, endBeat: 8 }),
    ]);

    const selected = result.cdSelectedMelodyOnly.parsed.notes;
    expect(selected.filter((note) => note.start < 4).map((note) => note.midi)).toEqual([72, 74, 76, 74]);
    expect(selected.filter((note) => note.start >= 4).map((note) => note.midi)).toEqual([84, 86, 88, 86]);
    expect(selected.every((note) => note.hand === "R")).toBe(true);

    const easy = result.cdFusedEasy.parsed.notes;
    expect(easy.some((note) => note.hand === "L")).toBe(true);
    expect(easy.filter((note) => note.hand === "R").map((note) => note.midi)).toEqual(selected.map((note) => note.midi));
    expect(result.diagnostics.primary.protectedMelodyCount).toBe(8);
    expect(result.diagnostics.outputs.cdFusedEasy!.protectedMelodyCount).toBe(8);
  });

  it("keeps semantic accompaniment separate from the protected melody and produces a medium variant", () => {
    const result = buildSectionAwarePianoCandidate(input());
    const medium = result.cdFusedMedium.parsed.notes;
    const right = medium.filter((note) => note.hand === "R");
    const left = medium.filter((note) => note.hand === "L");

    expect(right).toHaveLength(8);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((note) => note.midi < 72)).toBe(true);
    expect(result.diagnostics.accompaniment.medium.qualityCounts).toEqual(expect.objectContaining({
      major: expect.any(Number),
      minor: expect.any(Number),
      power: expect.any(Number),
    }));
    expect(result.diagnostics.outputs.cdFusedMedium!.noteCount).toBe(medium.length);
  });

  it("is deterministic under reordered source notes and candidate declarations", () => {
    const base = buildSectionAwarePianoCandidate(input());
    const reordered = buildSectionAwarePianoCandidate(input({
      primary: { id: "C", parsed: parsed([...cMelody, ...cHarmony].reverse()) },
      alternates: [{
        id: "D",
        parsed: parsed([...dSolo].reverse()),
        selection: { windowScores: { opening: 0.05, solo: 1 } },
      }],
    }));

    expect(reordered.cdFusedEasy.parsed.notes).toEqual(base.cdFusedEasy.parsed.notes);
    expect(reordered.cdFusedMedium.bytes).toEqual(base.cdFusedMedium.bytes);
    expect(reordered.diagnostics).toEqual(base.diagnostics);
  });

  it("applies only the explicit alternate alignment and rejects direct-metal sources", () => {
    const shifted = dSolo.map((note) => ({ ...note, start: note.start + 2 }));
    const result = buildSectionAwarePianoCandidate(input({
      alternates: [{
        id: "D",
        parsed: parsed(shifted),
        alignment: { offsetBeats: 2 },
        selection: { windowScores: { opening: 0.05, solo: 1 } },
      }],
    }));
    expect(result.cdSelectedMelodyOnly.notes.filter((note) => note.start >= 4).map((note) => note.start)).toEqual([4, 5, 6, 7]);
    expect(result.diagnostics.candidates.D!.aligned).toBe(true);

    expect(() => buildSectionAwarePianoCandidate(input({
      primary: { id: "C", sourceType: "direct-metal", parsed: parsed([...cMelody, ...cHarmony]) },
    }))).toThrow(/direct-metal/i);
  });

  it("clips an aligned alternate note that crosses the zero-beat boundary once", () => {
    const crossing: Note = { midi: 84, start: 0, dur: 1, vel: 110 };
    const result = buildSectionAwarePianoCandidate(input({
      primary: {
        id: "C",
        parsed: parsed([...cMelody, ...cHarmony]),
        selection: { windowScores: { opening: 0 } },
      },
      alternates: [{
        id: "D",
        parsed: parsed([crossing]),
        alignment: { offsetBeats: 0.25 },
        selection: { windowScores: { opening: 1 } },
      }],
      windows: [{ id: "opening", startBeat: 0, endBeat: 2 }],
    }));

    const selected = result.cdSelectedMelodyOnly.notes;
    expect(selected.filter((note) => note.midi === 84)).toEqual([
      expect.objectContaining({ start: 0, dur: 0.75, hand: "R" }),
    ]);
    expect(selected.filter((note) => note.midi === 84)).toHaveLength(1);
    expect(result.diagnostics.boundaries.clippedAlternateNoteCount).toBe(1);
  });

  it("fails closed on malformed or duplicate explicit windows", () => {
    expect(() => buildSectionAwarePianoCandidate(input({
      windows: [{ id: "bad", startBeat: 4, endBeat: 4 }],
    }))).toThrow(/invalid beat bounds/i);
    expect(() => buildSectionAwarePianoCandidate(input({
      windows: [
        { id: "same", startBeat: 0, endBeat: 4 },
        { id: "same", startBeat: 4, endBeat: 8 },
      ],
    }))).toThrow(/duplicate/i);
    expect(() => buildSectionAwarePianoCandidate(input({
      windows: [
        { id: "first", startBeat: 0, endBeat: 5 },
        { id: "overlap", startBeat: 4, endBeat: 8 },
      ],
    }))).toThrow(/overlapping/i);
  });
});
