import { describe, expect, it } from "vitest";
import type { ChordLabel, Note } from "@keyspilli/midi";
import { resolveAccompaniment, resolveSharedBackingCandidate } from "../src/accompaniment.js";

const coverage = [{ startBeat: 0, endBeat: 12 }];
const options = { durationBeats: 12, authoredChartCoverage: coverage };
const source: Note[] = [
  { midi: 67, start: 0, dur: 3, vel: 80, identitySource: "vocals", hand: "L" },
  { midi: 48, start: 0, dur: 3, vel: 80, identitySource: "guitar", hand: "L" },
];

describe("resolveSharedBackingCandidate", () => {
  it("uses covered authored chart boundaries and excludes generated stale labels", () => {
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 8, name: "C", notes: [], sourceKind: "authored" },
      { beat: 3, durationBeats: 2, name: "D", notes: [], sourceKind: "generated" },
      { beat: 8, durationBeats: 4, name: "G", notes: [], sourceKind: "authored" },
    ];
    const candidate = resolveSharedBackingCandidate(source, chords, options);

    expect(candidate.chords.map(({ beat, durationBeats, name }) => ({ beat, durationBeats, name })))
      .toEqual([{ beat: 0, durationBeats: 8, name: "C" }, { beat: 8, durationBeats: 4, name: "G" }]);
    expect(candidate.notes).toEqual([]);
    expect(candidate.guidanceNotes).toHaveLength(candidate.chords.reduce((n, chord) => n + chord.notes.length, 0));
    expect(resolveAccompaniment(source, chords, "bass-chords", options).chords).toHaveLength(3);
  });

  it("keeps authored N.C. silent and reports uncovered pickup/chart time", () => {
    const candidate = resolveSharedBackingCandidate(source, [
      { beat: 0, durationBeats: 1, name: "C", notes: [], sourceKind: "authored" },
      { beat: 1, durationBeats: 2, name: "N.C.", notes: [], sourceKind: "authored" },
      { beat: 3, durationBeats: 2, name: "G", notes: [], sourceKind: "authored" },
    ], { durationBeats: 5, authoredChartCoverage: [{ startBeat: 1, endBeat: 5 }] });

    expect(candidate.chords.map((chord) => chord.name)).toEqual(["G"]);
    expect(candidate.displayChords).toEqual(candidate.chords);
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 1, endBeat: 3, reason: "explicit no-chord" });
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 1, reason: "no chord coverage" });
  });

  it("uses event beat lengths for held voicings and never copies mixed-role source notes", () => {
    const candidate = resolveSharedBackingCandidate(source, [
      { beat: 0.5, durationBeats: 1.5, name: "C/E", notes: [], sourceKind: "authored" },
      { beat: 2, durationBeats: 2, name: "Am", notes: [], sourceKind: "authored" },
    ], { durationBeats: 4, authoredChartCoverage: [{ startBeat: 0, endBeat: 4 }] });

    expect(candidate.chords.map((chord) => [chord.beat, chord.durationBeats])).toEqual([[0.5, 1.5], [2, 2]]);
    expect(candidate.chords[0]!.notes[0]! % 12).toBe(4);
    expect(candidate.notes).toEqual([]);
    expect(candidate.guidanceNotes.every((note) => note.identitySource === undefined)).toBe(true);
    expect(candidate.guidanceNotes.every((note) => note.dur === (note.start < 2 ? 1.5 : 2))).toBe(true);
  });

  it("rejects the long generated Oops label despite changing low source notes", () => {
    const lowChanges: Note[] = [48, 50, 48, 45, 44].map((midi, index) => ({
      midi, start: 48 + index * 2, dur: 1.5, vel: 76,
    }));
    const candidate = resolveSharedBackingCandidate(lowChanges, [
      { beat: 7, durationBeats: 41, name: "B5", notes: [], sourceKind: "generated" },
    ], { durationBeats: 112, authoredChartCoverage: [{ startBeat: 0, endBeat: 112 }] });

    expect(candidate.chords).toEqual([]);
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 112, reason: "no chord coverage" });
  });

  it("keeps authored off-grid boundaries and source silence without imposing a meter pulse", () => {
    const candidate = resolveSharedBackingCandidate([
      { midi: 55, start: 6, dur: 1.5, vel: 70 },
    ], [
      { beat: 6, durationBeats: 1.5, name: "Dm", notes: [], sourceKind: "authored" },
      { beat: 9, durationBeats: 1.5, name: "G", notes: [], sourceKind: "authored" },
    ], { durationBeats: 12, authoredChartCoverage: [{ startBeat: 6, endBeat: 10.5 }] });

    expect(candidate.chords.map(({ beat, durationBeats }) => [beat, durationBeats]))
      .toEqual([[6, 1.5], [9, 1.5]]);
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 6, reason: "no chord coverage" });
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 7.5, endBeat: 9, reason: "no chord coverage" });
  });

  it("does not admit authored labels outside declared chart coverage", () => {
    const candidate = resolveSharedBackingCandidate([], [
      { beat: 4, durationBeats: 4, name: "F", notes: [], sourceKind: "authored" },
    ], { durationBeats: 8, authoredChartCoverage: [{ startBeat: 0, endBeat: 4 }] });

    expect(candidate.chords).toEqual([]);
    expect(candidate.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 8, reason: "no chord coverage" });
  });

  it("resolves a representative 1,200-note source without source-by-event work", () => {
    const longNotes: Note[] = Array.from({ length: 1_200 }, (_, index) => ({
      midi: 48 + index % 36, start: index / 4, dur: 0.25, vel: 72,
    }));
    const longChart: ChordLabel[] = Array.from({ length: 300 }, (_, index) => ({
      beat: index, durationBeats: 1, name: index % 2 ? "G" : "C", notes: [], sourceKind: "authored",
    }));
    const start = performance.now();
    const candidate = resolveSharedBackingCandidate(longNotes, longChart, {
      durationBeats: 300,
      authoredChartCoverage: [{ startBeat: 0, endBeat: 300 }],
    });

    expect(longNotes).toHaveLength(1_200);
    expect(candidate.chords).toHaveLength(300);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
