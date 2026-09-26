import { describe, expect, it } from "vitest";
import { resolveAccompaniment, type Note } from "../src/index.js";

const bars = (count: number, length = 4) =>
  Array.from({ length: count }, (_, i) => ({ startBeat: i * length, endBeat: (i + 1) * length }));
const left = (starts: number[], midi = 46): Note[] => starts.map((start) => ({ midi, start, dur: 0.5, vel: 70, hand: "L" }));
const strikes = (notes: Note[], chords: Array<{ beat: number; name: string; durationBeats: number; strikeSpacingBeats?: number }>, measures = bars(4)) =>
  resolveAccompaniment(notes, chords.map((chord) => ({ ...chord, notes: [] })), "bass-chords", { durationBeats: 16, sourceRhythmMeasures: measures })
    .chords.map((chord) => [chord.beat, chord.name]);

describe("bass + chords in the source rhythm", () => {
  it("leaves the source pianist's release gap while keeping repeated bass attacks", () => {
    const source = left([0, 1, 2]).map((item) => ({ ...item, dur: 0.25 }));
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 3, name: "Bb", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 3, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map(({ beat, durationBeats }) => [beat, durationBeats])).toEqual([
      [0, 0.75], [1, 0.75], [2, 0.75],
    ]);
    expect(result.displayChords[0]).toMatchObject({ beat: 0, durationBeats: 3 });

    const generated = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 3, name: "Bb", notes: [], sourceKind: "generated" },
    ], "bass-chords", { durationBeats: 3, sourceRhythmMeasures: bars(1) });
    expect(generated.chords.map((chord) => chord.durationBeats)).toEqual([1, 1, 1]);
  });

  it("skips a bass-only re-strike under a sustained source chord but keeps the next authored hit", () => {
    const source: Note[] = [
      { midi: 36, start: 0, dur: 0.5, vel: 70, hand: "L" },
      ...[60, 64, 67].map((midi) => ({ midi, start: 0, dur: 2, vel: 70, hand: "R" as const })),
      { midi: 48, start: 1, dur: 0.5, vel: 70, hand: "L" },
      { midi: 36, start: 2, dur: 0.5, vel: 70, hand: "L" },
      ...[60, 64, 67].map((midi) => ({ midi, start: 2, dur: 1, vel: 70, hand: "R" as const })),
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 2, name: "C", notes: [], sourceKind: "authored" },
      { beat: 2, durationBeats: 2, name: "C", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 4, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map(({ beat, durationBeats }) => [beat, durationBeats])).toEqual([[0, 2], [2, 1.75]]);
    expect(result.displayChords.map(({ beat, durationBeats }) => [beat, durationBeats])).toEqual([[0, 2], [2, 2]]);
  });

  it("does not mistake simultaneous melody notes for a held chord stack", () => {
    const source: Note[] = [
      { midi: 36, start: 0, dur: 0.25, vel: 70, hand: "L" },
      { midi: 61, start: 0, dur: 2, vel: 70, hand: "R" },
      { midi: 65, start: 0, dur: 2, vel: 70, hand: "R" },
      { midi: 48, start: 1, dur: 0.25, vel: 70, hand: "L" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 2, name: "C", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 2, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map(({ beat, durationBeats }) => [beat, durationBeats])).toEqual([[0, 0.75], [1, 0.75]]);
  });

  it("skips a single fifth in the bass arpeggio but keeps the repeated root", () => {
    const source: Note[] = [
      { midi: 49, start: 0, dur: 0.75, vel: 70, hand: "L" },
      { midi: 56, start: 1, dur: 0.75, vel: 70, hand: "L" },
      { midi: 49, start: 2, dur: 0.5, vel: 70, hand: "L" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 4, name: "C#m", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 4, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map(({ beat, durationBeats }) => [beat, durationBeats])).toEqual([[0, 1.75], [2, 1.75]]);
  });

  it("does not turn a softer upper root octave in a bass arpeggio into a full-chord hit", () => {
    const source: Note[] = [
      { midi: 47, start: 0, dur: 0.5, vel: 85, hand: "L" },
      { midi: 78, start: 0, dur: 0.5, vel: 76, hand: "R" },
      { midi: 54, start: 0.5, dur: 1, vel: 85, hand: "L" },
      { midi: 59, start: 1, dur: 0.375, vel: 65, hand: "L" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 2, name: "B", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 2, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map((chord) => chord.beat)).toEqual([0]);
  });

  it("keeps a separate upper-octave bass attack without an intervening arpeggio tone", () => {
    const source: Note[] = [
      { midi: 47, start: 0, dur: 0.5, vel: 85, hand: "L" },
      { midi: 59, start: 1, dur: 0.375, vel: 65, hand: "L" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 2, name: "B", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 2, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map((chord) => chord.beat)).toEqual([0, 1]);
  });

  it("keeps a syncopated chord hit with an octave-spread right-hand shape", () => {
    const source: Note[] = [
      { midi: 38, start: 0, dur: 1, vel: 70, hand: "L" },
      { midi: 57, start: 2, dur: 1, vel: 70, hand: "L" },
      ...[66, 74, 78].map((midi) => ({ midi, start: 2, dur: 1, vel: 70, hand: "R" as const })),
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 4, name: "D", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 4, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map((chord) => chord.beat)).toEqual([0, 2]);
  });

  it("does not invent a barline re-strike while the source chord stack is still held", () => {
    const source: Note[] = [
      { midi: 36, start: 0, dur: 0.5, vel: 70, hand: "L" },
      ...[60, 64, 67].map((midi) => ({ midi, start: 0, dur: 6, vel: 70, hand: "R" as const })),
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 8, name: "C", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 8, sourceRhythmMeasures: bars(2) });
    expect(result.chords.map((chord) => chord.beat)).toEqual([0]);
  });

  it("allows a barline re-strike when only one pitch class remains held", () => {
    const source: Note[] = [
      { midi: 36, start: 0, dur: 8, vel: 70, hand: "L" },
      { midi: 60, start: 0, dur: 8, vel: 70, hand: "R" },
      { midi: 64, start: 0, dur: 2, vel: 70, hand: "R" },
      { midi: 67, start: 0, dur: 2, vel: 70, hand: "R" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 8, name: "C", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 8, sourceRhythmMeasures: bars(2) });
    expect(result.chords.map((chord) => chord.beat)).toEqual([0, 4]);
  });

  it("releases the full chord when only a bass octave continues to ring", () => {
    const source: Note[] = [
      { midi: 36, start: 0, dur: 8, vel: 70, hand: "L" },
      { midi: 60, start: 0, dur: 8, vel: 70, hand: "R" },
      { midi: 64, start: 0, dur: 2, vel: 70, hand: "R" },
      { midi: 67, start: 0, dur: 2, vel: 70, hand: "R" },
    ];
    const result = resolveAccompaniment(source, [
      { beat: 0, durationBeats: 4, name: "C", notes: [], sourceKind: "authored" },
    ], "bass-chords", { durationBeats: 4, sourceRhythmMeasures: bars(1) });
    expect(result.chords.map((chord) => chord.durationBeats)).toEqual([3.75]);
  });

  it("re-strikes a held chord where the pianist's left hand strikes, at most once a beat", () => {
    const pulse = left([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5]);
    expect(strikes(pulse, [{ beat: 0, name: "Bb", durationBeats: 8 }], bars(2))).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((beat) => [beat, "Bb"]));
  });

  it("prefers a strong downbeat bass over its short pickup without erasing a real syncopation", () => {
    const pulse: Note[] = [0, 4].flatMap((bar) => [
      { midi: 38, start: bar, dur: 1.25, vel: 83, hand: "L" },
      { midi: 38, start: bar + 1.5, dur: 0.375, vel: 70, hand: "L" },
      { midi: 38, start: bar + 2, dur: 1.875, vel: 83, hand: "L" },
    ]);
    expect(strikes(pulse, [{ beat: 0, name: "D", durationBeats: 8 }], bars(2)))
      .toEqual([[0, "D"], [2, "D"], [4, "D"], [6, "D"]]);

    const aroundThirtySixSeconds: Note[] = [
      { midi: 38, start: 0, dur: 1.375, vel: 80, hand: "L" },
      { midi: 38, start: 1.5, dur: 0.375, vel: 70, hand: "L" },
      { midi: 50, start: 2, dur: 2, vel: 80, hand: "L" },
      { midi: 38, start: 2.75, dur: 0.25, vel: 70, hand: "L" },
      { midi: 57, start: 3, dur: 1, vel: 80, hand: "L" },
    ];
    expect(strikes(aroundThirtySixSeconds, [{ beat: 0, name: "D", durationBeats: 4 }], bars(1)))
      .toEqual([[0, "D"], [2, "D"], [3, "D"]]);

    const syncopated: Note[] = [
      { midi: 38, start: 0, dur: 1, vel: 80, hand: "L" },
      { midi: 38, start: 1.5, dur: 1.5, vel: 80, hand: "L" },
      { midi: 38, start: 2, dur: 0.25, vel: 60, hand: "L" },
    ];
    expect(strikes(syncopated, [{ beat: 0, name: "D", durationBeats: 4 }], bars(1)))
      .toEqual([[0, "D"], [1.5, "D"]]);
  });

  it("follows a stronger bass attack after a short pickup on an offset beat grid", () => {
    const source: Note[] = [
      { midi: 49, start: 0, dur: 1.5, vel: 75, hand: "L" },
      { midi: 49, start: 2.5, dur: 0.125, vel: 75, hand: "L" },
      { midi: 37, start: 2.625, dur: 0.5, vel: 65, hand: "L" },
    ];
    expect(strikes(source, [{ beat: 0, name: "C#m", durationBeats: 4 }], bars(1)))
      .toEqual([[0, "C#m"], [2.625, "C#m"]]);
  });

  it("widens only a curated chord's re-strike spacing while keeping later chord attacks", () => {
    const source = left([0, 1, 2, 3, 4, 5]);
    expect(strikes(source, [
      { beat: 0, name: "C#m", durationBeats: 4, strikeSpacingBeats: 2 },
      { beat: 4, name: "F#m", durationBeats: 2 },
    ], bars(2))).toEqual([[0, "C#m"], [2, "C#m"], [4, "F#m"], [5, "F#m"]]);
    expect(strikes(left([0, 0.5, 1, 1.5]), [
      { beat: 0, name: "C#m", durationBeats: 2, strikeSpacingBeats: 0.5 },
    ], bars(1))).toEqual([[0, "C#m"], [1, "C#m"]]);
  });

  it("strikes each downbeat when the left hand is silent for longer than a bar", () => {
    expect(strikes(left([0]), [{ beat: 0, name: "C", durationBeats: 12 }])).toEqual([[0, "C"], [4, "C"], [8, "C"]]);
    // A left-hand strike just after a bar line moves the fill to the next bar line.
    expect(strikes(left([0, 4.5]), [{ beat: 0, name: "C", durationBeats: 12 }])).toEqual([[0, "C"], [4.5, "C"], [8, "C"]]);
  });

  it("leaves a beat before the next chord and keeps chord changes where they are", () => {
    expect(strikes(left([0, 1, 2, 3.5]), [{ beat: 0, name: "C", durationBeats: 4 }, { beat: 4, name: "G", durationBeats: 4 }], bars(2)))
      .toEqual([[0, "C"], [1, "C"], [2, "C"], [4, "G"]]);
  });

  it("follows the bass line when the source has no hands", () => {
    const unhanded: Note[] = [
      { midi: 36, start: 0, dur: 1, vel: 70 }, { midi: 64, start: 0.5, dur: 1, vel: 80 },
      { midi: 43, start: 2, dur: 1, vel: 70 }, { midi: 67, start: 2, dur: 1, vel: 80 },
    ];
    expect(strikes(unhanded, [{ beat: 0, name: "C", durationBeats: 4 }], bars(1))).toEqual([[0, "C"], [2, "C"]]);
  });
});
