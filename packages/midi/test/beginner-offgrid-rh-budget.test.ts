import { describe, expect, it } from "vitest";
import {
  assessBeginnerOffGridCandidate,
  buildVariants,
  selectBeginnerOffGridRhCandidates,
  validateVariants,
  verifyMonotonicity,
  type Note,
  type ParsedMidi,
} from "../src/index.js";

function parsed(notes: Note[]): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["synthetic beginner off-grid fixture"],
    durationBeats: 8,
  };
}

function eventKey(note: Note): string {
  return JSON.stringify([
    note.hand ?? "R",
    note.midi,
    note.start.toFixed(6),
    note.dur.toFixed(6),
    note.vel,
    note.identitySource ?? "",
  ]);
}

function beginner(notes: Note[]): Note[] {
  return buildVariants(parsed(notes), { title: "Synthetic", artist: "Keyspilli" }, {
    arrangementProfile: "learner",
    maxDurBeats: null,
  }).find((variant) => variant.level === "beginner")!.notes;
}

describe("generic Beginner sparse off-grid RH budget", () => {
  it("admits the frozen Candidate-A winner at most once per meter window without retiming or touching LH", () => {
    const grid: Note[] = [
      0, 1, 2, 3, 4, 5, 6, 7,
    ].map((start, index) => ({ midi: 60 + (index % 4), start, dur: 0.5, vel: 80, hand: "R" }));
    const source: Note[] = [
      ...grid,
      { midi: 67, start: 1.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 67, start: 1.375, dur: 0.5, vel: 120, hand: "R" },
      { midi: 72, start: 4.125, dur: 0.5, vel: 120, hand: "R" },
    ];

    const variants = buildVariants(parsed(source), { title: "Synthetic", artist: "Keyspilli" }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
    });
    const after = variants.find((variant) => variant.level === "beginner")!.notes;
    const addedRh = after.filter((note) => note.hand !== "L" && [1.125, 1.375, 4.125].includes(note.start));

    expect(addedRh.map((note) => note.start).sort((a, b) => a - b)).toEqual([1.125, 4.125]);
    expect(addedRh.filter((note) => Math.floor(note.start / 4) === 0)).toHaveLength(1);
    expect(addedRh.every((note) => note.start % 0.25 !== 0)).toBe(true);
    expect(addedRh.find((note) => note.start === 1.125)).toMatchObject({ midi: 67, dur: 0.5, vel: 120, hand: "R" });
    expect(after.map((note) => note.start)).toEqual([...after].map((note) => note.start).sort((a, b) => a - b));
    expect(after.filter((note) => note.hand === "L").map(eventKey)).toEqual([]);
    expect(after.filter((note) => note.hand !== "L" && Number.isInteger(note.start)).map((note) => [note.midi, note.start]))
      .toEqual(grid.map((note) => [note.midi, note.start]));
    expect(validateVariants(variants, { maxDurBeats: null })).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("keeps Candidate B closed and rejects an event whose only legal space is occupied by LH", () => {
    const baseline: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 70, hand: "L" },
    ];
    const candidates: Note[] = [
      { midi: 64, start: 0.125, dur: 0.25, vel: 127, hand: "R" },
      { midi: 65, start: 0.375, dur: 0.25, vel: 127, hand: "R" },
    ];
    const assessed = assessBeginnerOffGridCandidate(candidates[0]!, baseline, baseline, {
      tempoBpm: 120,
      durationBeats: 4,
    });
    expect(assessed.legal).toBe(false);
    expect(assessed.blocker).toBe("BLOCKED_BY_CURRENT_LH");

    const selected = selectBeginnerOffGridRhCandidates({
      sourceNotes: [...baseline, ...candidates],
      baselineNotes: baseline,
      rejected: candidates.map((note, index) => ({ note, sourceKey: `source-${index}` })),
      timeSig: [4, 4],
      durationBeats: 4,
      isLegal: () => true,
    });
    expect(selected.emitted).toHaveLength(1);
    expect(selected.emitted[0]?.note.start).toBe(0.375);
  });

  it("uses a 4.5-beat measure window for 9/8", () => {
    const baseline: Note[] = Array.from({ length: 9 }, (_, index) => ({
      midi: 60 + (index % 3), start: index, dur: 0.5, vel: 80, hand: "R" as const,
    }));
    const rejected = [4.125, 4.375, 4.625].map((start, index) => ({
      note: { midi: 72 + index, start, dur: 0.5, vel: 127, hand: "R" as const },
      sourceKey: `off-grid-${index}`,
    }));
    const selected = selectBeginnerOffGridRhCandidates({
      sourceNotes: [...baseline, ...rejected.map(({ note }) => note)],
      baselineNotes: baseline,
      rejected,
      timeSig: [9, 8],
      durationBeats: 9,
      isLegal: () => true,
    });

    expect(selected.emitted.map(({ note }) => note.start).sort((a, b) => a - b)).toEqual([4.125, 4.625]);
    expect(selected.discardedByWindowBudget).toBe(1);
  });

  it("keeps Candidate A confined to the learner arrangement profile", () => {
    const notes: Note[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        midi: 60 + (index % 4), start: index, dur: 0.5, vel: 80, hand: "R" as const,
      })),
      { midi: 67, start: 1.125, dur: 0.5, vel: 120, hand: "R" },
      { midi: 67, start: 1.375, dur: 0.5, vel: 120, hand: "R" },
    ];
    const profiles = ["source", "metal"] as const;
    for (const arrangementProfile of profiles) {
      const variants = buildVariants(parsed(notes), { title: arrangementProfile, artist: "Tests" }, {
        arrangementProfile,
        maxDurBeats: null,
      });
      const beginnerNotes = variants.find((variant) => variant.level === "beginner")!.notes;
      expect(beginnerNotes.some((note) => note.hand !== "L" && note.start === 1.125), arrangementProfile).toBe(false);
    }
  });

  it("returns the selected Beginner notes in playback order", () => {
    const baseline: Note[] = [
      { midi: 60, start: 4, dur: 0.5, vel: 80, hand: "R" },
    ];
    const candidate: Note = { midi: 67, start: 1.125, dur: 0.5, vel: 120, hand: "R" };
    const selected = selectBeginnerOffGridRhCandidates({
      sourceNotes: [...baseline, candidate],
      baselineNotes: baseline,
      rejected: [{ note: candidate, sourceKey: "early-candidate" }],
      timeSig: [4, 4],
      durationBeats: 8,
      isLegal: () => true,
    });

    expect(selected.selected.map((note) => note.start)).toEqual([1.125, 4]);
  });
});
