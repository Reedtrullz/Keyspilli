import { describe, expect, it } from "vitest";
import type { Note } from "../src/types.js";
import {
  clipRegionNotes,
  scorePianoRegion,
  selectPianoMelodyRegions,
  type CandidateRegion,
  type PianoRegionCandidate,
} from "../src/piano-region-selector.js";

const makeNote = (
  midi: number,
  start: number,
  dur = 0.75,
  extra: Partial<Note> = {},
): Note => ({ midi, start, dur, vel: 88, ...extra });

const line = (start: number, pitches: number[], step = 1): Note[] =>
  pitches.map((midi, index) => makeNote(midi, start + index * step));

const windows = [
  { id: "opening", startBeat: 0, endBeat: 4 },
  { id: "middle", startBeat: 4, endBeat: 8 },
  { id: "ending", startBeat: 8, endBeat: 12 },
];

function regionsOf(selection: { regions: CandidateRegion[] }) {
  return selection.regions.map(({ candidateId, startBeat, endBeat }) => ({
    candidateId,
    startBeat,
    endBeat,
  }));
}

describe("selectPianoMelodyRegions", () => {
  it("prefers a coherent melody over a denser but pathological candidate", () => {
    const melodic: PianoRegionCandidate = {
      id: "coherent",
      notes: line(0, [60, 62, 64, 65, 67, 69, 71, 72]),
      confidence: 0.9,
    };
    const dense: PianoRegionCandidate = {
      id: "dense",
      notes: Array.from({ length: 32 }, (_, index) =>
        makeNote(index % 2 === 0 ? 36 : 96, index * 0.25, 0.24),
      ),
      confidence: 0.95,
    };

    const selection = selectPianoMelodyRegions([dense, melodic], windows.slice(0, 2));

    expect(regionsOf(selection)).toEqual([
      { candidateId: "coherent", startBeat: 0, endBeat: 8 },
    ]);
    expect(selection.notes.map((note) => note.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it("does not jitter when adjacent candidates differ by only a tiny score", () => {
    const base = line(0, [60, 62, 64, 65, 67, 69, 71, 72]);
    const selection = selectPianoMelodyRegions(
      [
        { id: "primary", notes: base, quality: 0.701, confidence: 0.9 },
        { id: "near-tie", notes: base.map((note) => ({ ...note, vel: 89 })), quality: 0.7, confidence: 0.9 },
      ],
      windows.slice(0, 2),
      { minRegionBeats: 2, switchPenalty: 0.03, hysteresis: 0.025 },
    );

    expect(regionsOf(selection)).toEqual([
      { candidateId: "primary", startBeat: 0, endBeat: 8 },
    ]);
  });

  it("allows a clearly stronger alternate lead to win a sustained region", () => {
    const primary: PianoRegionCandidate = {
      id: "primary",
      notes: [...line(0, [60, 62, 64, 65]), ...line(4, [60, 60, 48, 96], 1), ...line(8, [67, 69, 71, 72])],
      confidence: 0.95,
    };
    const alternate: PianoRegionCandidate = {
      id: "alternate",
      notes: [...line(0, [60, 60, 48, 96]), ...line(4, [72, 74, 76, 77]), ...line(8, [67, 67, 48, 96])],
      confidence: 0.95,
    };

    const selection = selectPianoMelodyRegions([primary, alternate], windows, {
      minRegionBeats: 4,
      switchPenalty: 0.02,
      hysteresis: 0.01,
    });

    expect(regionsOf(selection)).toEqual([
      { candidateId: "primary", startBeat: 0, endBeat: 4 },
      { candidateId: "alternate", startBeat: 4, endBeat: 8 },
      { candidateId: "primary", startBeat: 8, endBeat: 12 },
    ]);
    const scoreSum = selection.diagnostics.windowSelections.reduce((sum, item) => sum + item.score, 0);
    expect(selection.diagnostics.totalScore).toBeCloseTo(scoreSum - selection.diagnostics.switchCount * 0.02, 7);
  });

  it("suppresses a one-window alternate when the minimum region duration is longer", () => {
    const primary: PianoRegionCandidate = {
      id: "primary",
      notes: line(0, [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]),
      confidence: 0.92,
    };
    const alternate: PianoRegionCandidate = {
      id: "alternate",
      notes: [...line(0, [60, 62]), ...line(2, [96, 36]), ...line(4, [67, 69]), ...line(8, [74, 76])],
      confidence: 0.95,
    };

    const selection = selectPianoMelodyRegions([primary, alternate], windows, {
      minRegionBeats: 8,
      switchPenalty: 0,
      hysteresis: 0,
    });

    expect(regionsOf(selection)).toEqual([
      { candidateId: "primary", startBeat: 0, endBeat: 12 },
    ]);
  });

  it("clips crossing notes at a boundary without duplicates or hanging tails", () => {
    const crossing: Note & { id: string } = {
      id: "crossing",
      ...makeNote(72, 3.5, 2),
    };
    const clipped = clipRegionNotes(
      [crossing, crossing, makeNote(60, 4, 1.5)],
      { candidateId: "primary", startBeat: 0, endBeat: 4, score: 1, reason: [] },
      new Set(["crossing"]),
    );

    expect(clipped).toHaveLength(1);
    expect(clipped[0]).toMatchObject({ id: "crossing", midi: 72, start: 3.5, dur: 0.5 });
    expect(clipped.every((note) => note.start >= 0 && note.start + note.dur <= 4)).toBe(true);
  });

  it("uses shifted aligned windows and remains deterministic under input reordering", () => {
    const shiftedWindows = [
      { id: "late-b", startBeat: 12, endBeat: 16 },
      { id: "late-a", startBeat: 8, endBeat: 12 },
    ];
    const first: PianoRegionCandidate = { id: "a", notes: line(8, [60, 62, 64, 65, 67, 69, 71, 72]) };
    const second: PianoRegionCandidate = { id: "b", notes: line(8, [72, 60, 96, 36, 72, 60, 96, 36]) };
    const one = selectPianoMelodyRegions([first, second], shiftedWindows);
    const two = selectPianoMelodyRegions(
      [second, first].map((candidate) => ({ ...candidate, notes: [...(candidate.notes ?? [])].reverse() })),
      [...shiftedWindows].reverse(),
    );

    expect(one).toEqual(two);
    expect(regionsOf(one)).toEqual([{ candidateId: "a", startBeat: 8, endBeat: 16 }]);
  });

  it("selects an alternate melody while leaving its accompaniment out of melody-only output", () => {
    const primary: PianoRegionCandidate = {
      id: "primary",
      notes: line(0, [60, 62, 64, 65]),
      melodyNotes: line(0, [60, 62, 64, 65]),
      accompanimentNotes: [makeNote(36, 0, 4), makeNote(43, 4, 4)],
    };
    const alternate: PianoRegionCandidate = {
      id: "lead-only",
      notes: [
        ...line(0, [60, 62, 64, 65]),
        ...line(4, [72, 74, 76, 77]),
      ],
      melodyNotes: [...line(0, [60, 60, 48, 96]), ...line(4, [72, 74, 76, 77])],
      accompanimentNotes: [makeNote(38, 0, 8), makeNote(45, 0, 8)],
      confidence: 0.65,
    };

    const selection = selectPianoMelodyRegions([primary, alternate], windows.slice(0, 2), {
      role: "melody",
      minRegionBeats: 4,
      initialCandidateId: "primary",
    });

    expect(regionsOf(selection)).toEqual([
      { candidateId: "primary", startBeat: 0, endBeat: 4 },
      { candidateId: "lead-only", startBeat: 4, endBeat: 8 },
    ]);
    expect(selection.notes.every((note) => note.midi >= 60)).toBe(true);
    expect(selection.notes).not.toContainEqual(expect.objectContaining({ midi: 38 }));
    expect(selection.notes).not.toContainEqual(expect.objectContaining({ midi: 45 }));
  });

  it("preserves repeated same-pitch attacks instead of merging their timing", () => {
    const repeated: PianoRegionCandidate = {
      id: "primary",
      notes: [makeNote(60, 0, 1), makeNote(60, 1, 1), makeNote(60, 2, 1)],
    };

    const selection = selectPianoMelodyRegions(
      [repeated],
      [{ id: "phrase", startBeat: 0, endBeat: 3 }],
    );

    expect(selection.notes).toHaveLength(3);
    expect(selection.notes.map((note) => ({ start: note.start, dur: note.dur }))).toEqual([
      { start: 0, dur: 1 },
      { start: 1, dur: 1 },
      { start: 2, dur: 1 },
    ]);
  });

  it("counts candidate switches from adjacent selected IDs, not region gaps", () => {
    const primary: PianoRegionCandidate = {
      id: "primary",
      notes: [...line(0, [60, 62, 64, 65]), ...line(8, [67, 69, 71, 72])],
    };

    const selection = selectPianoMelodyRegions(
      [primary],
      [
        { id: "first", startBeat: 0, endBeat: 4 },
        { id: "second", startBeat: 8, endBeat: 12 },
      ],
    );

    expect(selection.regions).toHaveLength(2);
    expect(selection.regions.map((region) => region.candidateId)).toEqual(["primary", "primary"]);
    expect(selection.diagnostics.switchCount).toBe(0);
  });

  it("throws on an invalid selection window instead of silently dropping it", () => {
    expect(() => selectPianoMelodyRegions(
      [{ id: "primary", notes: line(0, [60, 62]) }],
      [{ id: "invalid", startBeat: 4, endBeat: 4 }],
    )).toThrow(/invalid.*window/i);
  });

  it("rejects negative selection-window starts", () => {
    expect(() => selectPianoMelodyRegions(
      [{ id: "primary", notes: line(0, [60, 62]) }],
      [{ id: "negative", startBeat: -1, endBeat: 1 }],
    )).toThrow(/invalid.*window/i);
  });

  it("keeps single-region scoring fail-closed without throwing for an invalid window", () => {
    const score = scorePianoRegion(
      { id: "primary", notes: line(0, [60, 62]) },
      { id: "invalid", startBeat: 4, endBeat: 4 },
    );

    expect(score.score).toBe(0);
    expect(score.reasons).toContain("invalid window");
  });

  it("fails closed for a negative window in direct scoring", () => {
    const score = scorePianoRegion(
      { id: "primary", notes: line(0, [60, 62]) },
      { id: "negative", startBeat: -1, endBeat: 1 },
    );

    expect(score.score).toBe(0);
    expect(score.reasons).toContain("invalid window");
  });

  it("rejects duplicate and overlapping windows before selection", () => {
    const candidate: PianoRegionCandidate = { id: "primary", notes: line(0, [60, 62, 64, 65]) };
    expect(() => selectPianoMelodyRegions([candidate], [
      { id: "same", startBeat: 0, endBeat: 2 },
      { id: "same", startBeat: 2, endBeat: 4 },
    ])).toThrow(/duplicate.*window/i);
    expect(() => selectPianoMelodyRegions([candidate], [
      { id: "first", startBeat: 0, endBeat: 3 },
      { id: "overlap", startBeat: 2, endBeat: 4 },
    ])).toThrow(/overlap.*window/i);
  });

  it("assigns stable identities to anonymous empty candidates", () => {
    const high: PianoRegionCandidate = { notes: [], windowScores: { phrase: 0.9 } };
    const low: PianoRegionCandidate = { notes: [], windowScores: { phrase: 0.1 } };
    const aligned = [{ id: "phrase", startBeat: 0, endBeat: 4 }];
    const one = selectPianoMelodyRegions([high, low], aligned);
    const two = selectPianoMelodyRegions([low, high], aligned);

    expect(one).toEqual(two);
    expect(one.selectedCandidateIds).toEqual([one.regions[0]?.candidateId]);
  });
});
