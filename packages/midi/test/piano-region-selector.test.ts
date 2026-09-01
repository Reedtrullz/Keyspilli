import { describe, expect, it } from "vitest";
import type { Note } from "../src/types.js";
import {
  assessPianoRegionCoverage,
  clipRegionNotes,
  scorePianoRegion,
  selectPianoMelodyRegions,
  type CandidateRegion,
  type CandidateCoverageWindow,
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

  it("honors an explicit window candidate lock while allowing legacy score selection to opt out", () => {
    const primary: PianoRegionCandidate = {
      id: "primary",
      notes: line(0, [60, 60, 60, 60]),
    };
    const alternate: PianoRegionCandidate = {
      id: "alternate",
      notes: line(0, [72, 74, 76, 77]),
    };
    const window = { id: "section", startBeat: 0, endBeat: 4, candidateId: "primary" };

    const locked = selectPianoMelodyRegions([primary, alternate], [window]);
    expect(locked.selectedCandidateIds).toEqual(["primary"]);
    expect(locked.notes.map((note) => note.midi)).toEqual([60, 60, 60, 60]);
    expect(locked.scores.find((score) => score.candidateId === "alternate")?.usable).toBe(false);

    const legacy = selectPianoMelodyRegions([primary, alternate], [window], { respectWindowCandidateId: false });
    expect(legacy.selectedCandidateIds).toEqual(["alternate"]);
    expect(legacy.notes.map((note) => note.midi)).toEqual([72, 74, 76, 77]);
  });

  it("restricts a window to its candidate allow-list without changing unlocked windows", () => {
    const primary: PianoRegionCandidate = { id: "primary", notes: line(0, [60, 62, 64, 65]) };
    const alternate: PianoRegionCandidate = { id: "alternate", notes: line(0, [72, 74, 76, 77]) };
    const allowListed = selectPianoMelodyRegions(
      [primary, alternate],
      [{ id: "section", startBeat: 0, endBeat: 4, candidateIds: ["alternate"] }],
    );
    expect(allowListed.selectedCandidateIds).toEqual(["alternate"]);
    expect(allowListed.notes.every((note) => note.midi >= 72)).toBe(true);
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

  it("clusters transitive jittered onsets into one attack", () => {
    const clustered: PianoRegionCandidate = {
      id: "clustered",
      notes: [
        makeNote(60, 0, 0.5),
        makeNote(72, 0.07, 0.5),
        makeNote(64, 0.13, 0.5),
      ],
    };

    const selection = selectPianoMelodyRegions(
      [clustered],
      [{ id: "phrase", startBeat: 0, endBeat: 1 }],
    );

    expect(selection.notes).toHaveLength(1);
    expect(selection.notes[0]).toMatchObject({ midi: 72, start: 0.07 });

    const reordered = selectPianoMelodyRegions(
      [{ ...clustered, notes: [...(clustered.notes ?? [])].reverse() }],
      [{ id: "phrase", startBeat: 0, endBeat: 1 }],
    );
    expect(reordered).toEqual(selection);
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

  it("fails closed when explicit coverage says a note-bearing intro is not the submitted song", () => {
    const coverage: CandidateCoverageWindow = {
      windowId: "opening",
      startBeat: 0,
      endBeat: 4,
      hasSourceMaterial: true,
      alignmentConfidence: 0.12,
      chromaAgreement: 0.18,
      attackAgreement: 0.08,
      melodicAgreement: 0.1,
      usable: false,
      rejectionReasons: ["custom intro does not match submitted song"],
    };
    const selection = selectPianoMelodyRegions(
      [{ id: "custom-intro", notes: line(0, [60, 62, 64, 65]), coverageWindows: [coverage] }],
      [{ id: "opening", startBeat: 0, endBeat: 4 }],
      { coverageGate: {} },
    );

    expect(selection.notes).toEqual([]);
    expect(selection.regions).toEqual([]);
    expect(selection.uncoveredWindows).toEqual([{
      windowId: "opening",
      startBeat: 0,
      endBeat: 4,
      reasons: ["custom intro does not match submitted song"],
    }]);
    expect(selection.scores[0]?.usable).toBe(false);
  });

  it("marks a missing candidate intro uncovered while retaining a covered later phrase", () => {
    const missingOpening: CandidateCoverageWindow = {
      windowId: "opening", startBeat: 0, endBeat: 4, hasSourceMaterial: false,
      alignmentConfidence: 0, chromaAgreement: 0, attackAgreement: 0,
      melodicAgreement: 0, usable: false, rejectionReasons: ["candidate starts at verse"],
    };
    const coveredVerse: CandidateCoverageWindow = {
      windowId: "verse", startBeat: 4, endBeat: 8, hasSourceMaterial: true,
      alignmentConfidence: 0.9, chromaAgreement: 0.88, attackAgreement: 0.86,
      melodicAgreement: 0.84, usable: true, rejectionReasons: [],
    };
    const selection = selectPianoMelodyRegions(
      [{ id: "verse-only", notes: line(4, [67, 69, 71, 72]), coverageWindows: [missingOpening, coveredVerse] }],
      [{ id: "opening", startBeat: 0, endBeat: 4 }, { id: "verse", startBeat: 4, endBeat: 8 }],
      { coverageGate: {} },
    );

    expect(selection.regions.map((region) => [region.candidateId, region.startBeat, region.endBeat])).toEqual([
      ["verse-only", 4, 8],
    ]);
    expect(selection.notes.map((note) => note.midi)).toEqual([67, 69, 71, 72]);
    expect(selection.uncoveredWindows).toEqual([{
      windowId: "opening",
      startBeat: 0,
      endBeat: 4,
      reasons: ["candidate starts at verse"],
    }]);
  });

  it("returns an explicit uncovered region instead of inventing a melody when no candidate passes coverage", () => {
    const selection = selectPianoMelodyRegions(
      [],
      [{ id: "opening", startBeat: 0, endBeat: 4 }],
      { coverageGate: {} },
    );

    expect(selection.notes).toEqual([]);
    expect(selection.regions).toEqual([]);
    expect(selection.selectedCandidateIds).toEqual([]);
    expect(selection.uncoveredWindows).toEqual([{
      windowId: "opening",
      startBeat: 0,
      endBeat: 4,
      reasons: ["no candidate passed coverage gate"],
    }]);
    expect(selection.diagnostics.uncoveredWindows).toEqual(selection.uncoveredWindows);
  });

  it("selects different candidates by locally covered region instead of trusting global note presence", () => {
    const cOpening: CandidateCoverageWindow = {
      windowId: "opening", startBeat: 0, endBeat: 4, hasSourceMaterial: true,
      alignmentConfidence: 0.93, chromaAgreement: 0.9, attackAgreement: 0.88,
      melodicAgreement: 0.86, usable: true, rejectionReasons: [],
    };
    const cSolo: CandidateCoverageWindow = {
      windowId: "solo", startBeat: 4, endBeat: 8, hasSourceMaterial: true,
      alignmentConfidence: 0.22, chromaAgreement: 0.25, attackAgreement: 0.2,
      melodicAgreement: 0.18, usable: false, rejectionReasons: ["unrelated solo"],
    };
    const dOpening: CandidateCoverageWindow = {
      windowId: "opening", startBeat: 0, endBeat: 4, hasSourceMaterial: true,
      alignmentConfidence: 0.2, chromaAgreement: 0.22, attackAgreement: 0.15,
      melodicAgreement: 0.2, usable: false, rejectionReasons: ["different intro"],
    };
    const dSolo: CandidateCoverageWindow = {
      windowId: "solo", startBeat: 4, endBeat: 8, hasSourceMaterial: true,
      alignmentConfidence: 0.91, chromaAgreement: 0.86, attackAgreement: 0.84,
      melodicAgreement: 0.92, usable: true, rejectionReasons: [],
    };
    const selection = selectPianoMelodyRegions(
      [
        { id: "C", notes: [...line(0, [60, 62, 64, 65]), ...line(4, [60, 62, 64, 65])], coverageWindows: [cOpening, cSolo] },
        { id: "D", notes: [...line(0, [72, 74, 76, 77]), ...line(4, [72, 74, 76, 77])], coverageWindows: [dOpening, dSolo] },
      ],
      [{ id: "opening", startBeat: 0, endBeat: 4 }, { id: "solo", startBeat: 4, endBeat: 8 }],
      { coverageGate: {} },
    );

    expect(selection.regions.map((region) => [region.candidateId, region.startBeat, region.endBeat])).toEqual([
      ["C", 0, 4],
      ["D", 4, 8],
    ]);
    expect(selection.notes.map((note) => note.midi)).toEqual([60, 62, 64, 65, 72, 74, 76, 77]);
    expect(selection.uncoveredWindows).toEqual([]);
  });

  it("rejects note-bearing coverage without agreement evidence when strict gating is enabled", () => {
    const selection = selectPianoMelodyRegions(
      [{ id: "unverified", notes: line(0, [60, 62, 64, 65]) }],
      [{ id: "opening", startBeat: 0, endBeat: 4 }],
      { coverageGate: { requireEvidence: true } },
    );

    expect(selection.notes).toEqual([]);
    expect(selection.uncoveredWindows[0]?.reasons).toEqual(expect.arrayContaining([
      "alignment confidence unavailable",
      "chroma agreement unavailable",
      "attack agreement unavailable",
    ]));
  });

  it("reports role-specific coverage without treating accompaniment activity as melody coverage", () => {
    const candidate: PianoRegionCandidate = {
      id: "split",
      notes: line(0, [60, 62, 64, 65]),
      melodyNotes: line(0, [72, 74, 76, 77]),
      accompanimentNotes: [makeNote(36, 0, 4), makeNote(43, 4, 4)],
      roleCoverage: { melody: 0.92, accompaniment: 0.28 },
    };
    const melody = scorePianoRegion(candidate, { id: "phrase", startBeat: 0, endBeat: 4 }, { role: "melody" });
    const accompaniment = scorePianoRegion(candidate, { id: "phrase", startBeat: 0, endBeat: 4 }, { role: "accompaniment" });

    expect(melody.roleCoverage).toBeCloseTo(0.92, 6);
    expect(accompaniment.roleCoverage).toBeCloseTo(0.28, 6);
    expect(melody.noteCount).toBe(4);
    expect(accompaniment.noteCount).toBe(1);
  });

  it("exposes deterministic coverage metrics for a candidate/window pair", () => {
    const result = assessPianoRegionCoverage(
      { id: "lead", notes: line(0, [60, 62, 64, 65]) },
      {
        id: "phrase", startBeat: 0, endBeat: 4,
        targetNotes: line(0, [60, 62, 64, 65]),
      },
    );

    expect(result).toMatchObject({
      startBeat: 0,
      endBeat: 4,
      hasSourceMaterial: true,
      chromaAgreement: 1,
      attackAgreement: 1,
      melodicAgreement: 1,
      usable: true,
      rejectionReasons: [],
    });
  });

  it("accepts partial explicit agreement evidence without requiring optional melodic agreement", () => {
    const result = assessPianoRegionCoverage(
      {
        id: "partial-evidence",
        notes: line(0, [60, 62, 64, 65]),
        coverageWindows: [{
          alignmentConfidence: 0.92,
          chromaAgreement: 0.86,
          attackAgreement: 0.8,
        }],
      },
      { id: "phrase", startBeat: 0, endBeat: 4 },
      { coverageGate: {} },
    );

    expect(result).toMatchObject({
      alignmentConfidence: 0.92,
      chromaAgreement: 0.86,
      attackAgreement: 0.8,
      usable: true,
      rejectionReasons: [],
    });
    expect(result).not.toHaveProperty("melodicAgreement");
  });

  it("still applies the melodic threshold when optional evidence is provided", () => {
    const result = assessPianoRegionCoverage(
      {
        id: "weak-melody-evidence",
        notes: line(0, [60, 62, 64, 65]),
        coverageWindows: [{
          alignmentConfidence: 0.92,
          chromaAgreement: 0.86,
          attackAgreement: 0.8,
          melodicAgreement: 0.2,
        }],
      },
      { id: "phrase", startBeat: 0, endBeat: 4 },
      { coverageGate: {} },
    );

    expect(result.usable).toBe(false);
    expect(result.rejectionReasons).toContain("melodic agreement below threshold");
    expect(result.melodicAgreement).toBe(0.2);
  });
});
