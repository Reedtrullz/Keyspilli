import { describe, expect, it } from "vitest";
import type { ChordLabel, Note } from "@keyspilli/midi";
import {
  filterAccompanimentChords,
  resolveAccompaniment,
  sourceNoteIds,
  type AccompanimentStyle,
} from "../src/accompaniment.js";

const chordTimeline: ChordLabel[] = [
  { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" },
  { beat: 4, durationBeats: 4, name: "G", notes: [43, 47, 50], sourceKind: "authored" },
];

function note(midi: number, start: number, dur = 1, hand?: Note["hand"]): Note {
  return { midi, start, dur, vel: 80, ...(hand ? { hand } : {}) };
}

function resolve(
  notes: Note[],
  chords: ChordLabel[] = chordTimeline,
  style: AccompanimentStyle = "melody-accompaniment",
  replaceableSourceIds?: ReadonlySet<string>,
  durationBeats = 8,
) {
  return resolveAccompaniment(notes, chords, style, { durationBeats, replaceableSourceIds });
}

describe("resolveAccompaniment", () => {
  it("realizes a supported chart event without source-note ownership", () => {
    const result = resolve([], [{ beat: 0, durationBeats: 2, name: "C", notes: [] }], "bass-chords", undefined, 2);

    expect(result.notes).toEqual([]);
    expect(result.chords).toHaveLength(1);
    expect(result.guidanceNotes.map((item) => item.midi)).toEqual(result.chords[0]!.notes);
    expect(result.fallbackSpans).toEqual([]);
  });

  it("does not retain a source note that crosses a backed chord boundary", () => {
    const result = resolve(
      [note(60, 0, 4)],
      [
        { beat: 0, durationBeats: 2, name: "C", notes: [] },
        { beat: 2, durationBeats: 2, name: "G", notes: [] },
      ],
      "bass-chords",
      undefined,
      4,
    );

    expect(result.notes).toEqual([]);
    expect(result.chords).toHaveLength(2);
    expect(result.fallbackSpans).toEqual([]);
  });

  it("omits source notes when backing is unsupported or uncovered", () => {
    const result = resolve(
      [note(60, 0), note(62, 2)],
      [{ beat: 0, durationBeats: 1, name: "C9", notes: [] }],
      "bass-chords",
      undefined,
      4,
    );

    expect(result.notes).toEqual([]);
    expect(result.chords).toEqual([]);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 1, reason: "unsupported chord" });
    expect(result.fallbackSpans).toContainEqual({ startBeat: 1, endBeat: 4, reason: "no chord coverage" });
  });

  it("preserves an unknown melody arrangement instead of guessing from hand labels", () => {
    const notes = [note(72, 0, 1, "L"), note(74, 1, 1, "R")];

    const result = resolve(notes);

    expect(result.notes).toEqual(notes);
    expect(result.chords).toEqual([]);
    expect(result.displayChords.map((chord) => chord.name)).toEqual(["C", "G"]);
    expect(result.fallbackSpans).toEqual([
      { startBeat: 0, endBeat: 4, reason: "accompaniment ownership unavailable" },
      { startBeat: 4, endBeat: 8, reason: "accompaniment ownership unavailable" },
    ]);
  });

  it("replaces only explicitly owned source notes, regardless of hand labels", () => {
    const notes = [note(72, 0, 1, "L"), note(48, 0, 1, "R"), note(50, 1, 1, "R"), note(48, 6, 1, "L")];
    const ids = sourceNoteIds(notes);

    const result = resolve(notes, chordTimeline, "melody-accompaniment", new Set([ids[1]!, ids[2]! ]));

    expect(result.notes).toEqual([notes[0], notes[3]]);
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]).toMatchObject({ beat: 0, name: "C", durationBeats: 4 });
    expect(result.chords[0]!.notes.map((midi) => midi % 12)).toEqual([7, 0, 4]);
  });

  it("omits a sustained source note and keeps the backed chord across a boundary", () => {
    const notes = [note(60, 1, 4, "R")];
    const chords = [{ beat: 2, durationBeats: 2, name: "C", notes: [48, 52, 55] }];

    const result = resolve(notes, chords, "bass-chords");

    expect(result.notes).toEqual([]);
    expect(result.chords).toHaveLength(1);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 2, reason: "no chord coverage" });
    expect(result.fallbackSpans).toContainEqual({ startBeat: 4, endBeat: 8, reason: "no chord coverage" });
  });

  it("lets later no-chord events end earlier chord coverage", () => {
    const notes = [note(60, 0), note(62, 4.5)];
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 8, name: "C", notes: [48, 52, 55] },
      { beat: 4, durationBeats: 4, name: "N.C.", notes: [] },
    ];

    const result = resolve(notes, chords, "bass-chords");

    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]).toMatchObject({ beat: 0, durationBeats: 4 });
    expect(result.notes).toEqual([]);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 4, endBeat: 8, reason: "explicit no-chord" });
  });

  it("realizes bass plus chords as deterministic two-hand voicings", () => {
    const notes = [note(72, 0), note(72, 1), note(72, 2), note(72, 3)];
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 1, name: "C", notes: [] },
      { beat: 1, durationBeats: 1, name: "F", notes: [] },
      { beat: 2, durationBeats: 1, name: "G7", notes: [] },
      { beat: 3, durationBeats: 1, name: "C", notes: [] },
    ];

    const result = resolve(notes, chords, "bass-chords", undefined, 4);
    const repeated = resolve(notes, chords, "bass-chords", undefined, 4);

    expect(result.chords).toHaveLength(4);
    expect(result.chords).toEqual(repeated.chords);
    for (const chord of result.chords) {
      const upper = chord.notes.slice(1);
      expect(chord.notes.every((midi) => midi >= 21 && midi <= 127)).toBe(true);
      expect(upper.every((midi) => midi >= 60 && midi <= 96)).toBe(true);
      expect(Math.max(...upper) - Math.min(...upper)).toBeLessThanOrEqual(12);
    }
    expect(result.chords.map((chord) => chord.notes[0])).toEqual([36, 41, 43, 36]);
    expect(result.chords.every((chord) => chord.suggestedHands[0] === "L" && chord.suggestedHands.slice(1).every((hand) => hand === "R"))).toBe(true);
    expect(new Set(result.chords[2]!.notes.map((midi) => midi % 12))).toEqual(new Set([7, 11, 2, 5]));
    expect(result.guidanceNotes.filter((source) => source.hand === "L")).toHaveLength(4);
    expect(result.guidanceNotes.filter((source) => source.hand === "R")).toHaveLength(13);
  });

  it("keeps slash-chord bass identity and supported minor/suspended shapes", () => {
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 1, name: "C/E", notes: [] },
      { beat: 1, durationBeats: 1, name: "Am", notes: [] },
      { beat: 2, durationBeats: 1, name: "Asus4", notes: [] },
    ];
    const result = resolve([note(72, 0), note(72, 1), note(72, 2)], chords, "bass-chords", undefined, 3);

    expect(result.chords.map((chord) => chord.notes[0])).toEqual([40, 45, 45]);
    expect(result.chords.every((chord) => chord.notes.length >= 3)).toBe(true);
  });

  it("keeps chord extensions when a slash bass consumes a voicing slot", () => {
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 1, name: "Cadd9", notes: [] },
      { beat: 1, durationBeats: 1, name: "C7/E", notes: [] },
      { beat: 2, durationBeats: 1, name: "Cmaj7/G", notes: [] },
    ];
    const result = resolve([note(72, 0), note(72, 1), note(72, 2)], chords, "bass-chords", undefined, 3);

    expect(new Set(result.chords[0]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 2, 4, 7]));
    expect(new Set(result.chords[1]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 4, 7, 10]));
    expect(new Set(result.chords[2]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 4, 7, 11]));
    expect(result.chords.every((chord) => chord.inferred === true && chord.inferenceType === "voicing")).toBe(true);
  });

  it("keeps repeated chord events as separate deterministic changes", () => {
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 1, name: "C", notes: [] },
      { beat: 1, durationBeats: 1, name: "C", notes: [] },
    ];
    const result = resolve([note(72, 0), note(72, 1)], chords, "bass-chords", undefined, 2);

    expect(result.chords).toHaveLength(2);
    expect(result.chords[0]!.notes).toEqual(result.chords[1]!.notes);
    expect(result.chords[0]!.suggestedHands).toEqual(result.chords[1]!.suggestedHands);
  });

  it("keeps fallback source labels beside realized voicings", () => {
    const result = resolve(
      [note(72, 0), note(72, 2)],
      [
        { beat: 0, durationBeats: 2, name: "C9", notes: [48, 52, 55], sourceKind: "authored" },
        { beat: 2, durationBeats: 2, name: "C", notes: [], sourceKind: "authored" },
      ],
      "bass-chords",
      undefined,
      4,
    );

    expect(result.chords).toHaveLength(1);
    expect(result.displayChords.map((chord) => chord.name)).toEqual(["C9", "C"]);
    expect(result.displayChords[0]).toMatchObject({ beat: 0, durationBeats: 2, notes: [48, 52, 55] });
    expect(result.displayChords[1]).toMatchObject({ beat: 2, durationBeats: 2, notes: result.chords[0]!.notes });
  });

  it("filters generated chord tones by their suggestions rather than source hand", () => {
    const result = resolve([note(72, 0)], [{ beat: 0, durationBeats: 1, name: "C", notes: [] }], "bass-chords", undefined, 1);

    expect(filterAccompanimentChords(result.chords, "L")[0]?.notes).toEqual([36]);
    expect(filterAccompanimentChords(result.chords, "R")[0]?.notes.length).toBe(3);
  });

  it("fails closed for missing source, unsupported, no-chord, and chart gaps", () => {
    const notes = [note(60, 1), note(62, 5), note(64, 10)];
    const chords: ChordLabel[] = [
      { beat: 0, durationBeats: 2, name: "C9", notes: [] },
      { beat: 2, durationBeats: 2, name: "N.C.", notes: [] },
      { beat: 8, durationBeats: 2, name: "C", notes: [60, 64, 67] },
    ];

    const result = resolve(notes, chords, "bass-chords", new Set(sourceNoteIds(notes)), 10);

    expect(result.notes).toEqual([]);
    expect(result.chords).toHaveLength(1);
    expect(result.fallbackSpans).toEqual([
      { startBeat: 0, endBeat: 2, reason: "unsupported chord" },
      { startBeat: 2, endBeat: 4, reason: "explicit no-chord" },
      { startBeat: 4, endBeat: 8, reason: "no chord coverage" },
    ]);

    const noSource = resolve([], [{ beat: 0, durationBeats: 2, name: "C", notes: [] }], "bass-chords", undefined, 4);
    expect(noSource.notes).toEqual([]);
    expect(noSource.chords).toHaveLength(1);
    expect(noSource.fallbackSpans).toContainEqual({ startBeat: 2, endBeat: 4, reason: "no chord coverage" });
  });
});
