import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import { arithmeticMeasures, type SongData } from "@keyspilli/player-core";
import { projectChordSources } from "../../lib/catalog-api";
import { replayChordsBacking } from "./chords-backing";

const stack = (pitches: number[], start: number, dur: number): Note[] =>
  pitches.map((midi, index) => ({ midi, start, dur, vel: 80, hand: index === 0 ? "L" : "R" }));
const song = (notes: Note[]): SongData => ({
  notes, chords: [], key: "C", tempoBpm: 60, timeSig: [4, 4],
  measures: arithmeticMeasures(8, [4, 4]),
});
const replay = (notes: Note[]) => replayChordsBacking(projectChordSources(song(notes), null));
const pitchClasses = (pitches: number[]) => [...new Set(pitches.map(midi => midi % 12))].sort((a, b) => a - b);

// Authored synthetic source gestures, not accepted song/golden replacements.
const qualities = [
  { name: "C", pitches: [48, 52, 55] },
  { name: "Cm", pitches: [48, 51, 55] },
  { name: "C7", pitches: [48, 52, 55, 58] },
  { name: "Cm7", pitches: [48, 51, 55, 58] },
  { name: "Cmaj7", pitches: [48, 52, 55, 59] },
  { name: "Csus4", pitches: [48, 53, 55] },
  { name: "Cdim", pitches: [48, 51, 54] },
  { name: "C/E", pitches: [52, 55, 60] },
  { name: "C7/E", pitches: [52, 55, 58, 60] },
  { name: "Am7/C", pitches: [48, 52, 55, 57] },
];

describe("held source harmony through generated Chords playback", () => {
  it.each(qualities.flatMap(quality => [
    { ...quality, start: 0, dur: 4 },
    { ...quality, start: 0.5, dur: 6.75 },
  ]))("keeps $name at $start for $dur beats without grid or bar re-strikes", ({ name, pitches, start, dur }) => {
    const { resolution } = replay(stack(pitches, start, dur));
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[start, name, dur]]);
    const chord = resolution.chords[0]!;
    expect(pitchClasses(chord.notes)).toEqual(pitchClasses(pitches));
    expect(chord.notes[0]! % 12).toBe(pitches[0]! % 12);
    expect(resolution.notes).toEqual([]);
    expect(resolution.guidanceNotes.every(note => note.start === start && note.dur === dur)).toBe(true);
    expect(resolution.fallbackSpans.some(span => span.startBeat < start + dur && span.endBeat > start)).toBe(false);
  });

  it("ends a held seventh at an off-grid source release and leaves the following rest empty", () => {
    const { resolution } = replay(stack([48, 52, 55, 58], 0.25, 2.125));
    expect(resolution.chords.map(chord => [chord.beat, chord.durationBeats])).toEqual([[0.25, 2.125]]);
    expect(resolution.fallbackSpans).toContainEqual({ startBeat: 2.375, endBeat: 8, reason: "explicit no-chord" });
  });

  it("changes on a new source harmony instead of carrying the old seventh through it", () => {
    const { resolution } = replay([
      ...stack([48, 52, 55, 58], 0.5, 2),
      ...stack([50, 53, 57], 2.5, 2),
    ]);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[0.5, "C7", 2], [2.5, "Dm", 2]]);
  });

  it("lets a new complete source stack replace overlapping older harmony", () => {
    const { resolution } = replay([
      ...stack([48, 52, 55, 58], 0, 4),
      ...stack([50, 53, 57], 1.5, 4.5),
    ]);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[0, "C7", 1.5], [1.5, "Dm", 4.5]]);
  });

  it("keeps a complete held stack through an unrelated upper-note attack", () => {
    const { resolution } = replay([
      ...stack([48, 52, 55, 58], 0, 4),
      { midi: 77, start: 2, dur: 0.25, vel: 70, hand: "R" },
    ]);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[0, "C7", 4]]);
  });

  it("keeps actual repeated source attacks and their release gaps", () => {
    const { resolution } = replay([0, 1.5, 3].flatMap(start => stack([48, 52, 55, 58], start, 1.25)));
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[0, "C7", 1.25], [1.5, "C7", 1.25], [3, "C7", 1.25]]);
  });

  it("does not hold a released seventh tone or invent a replacement attack", () => {
    const notes = stack([48, 52, 55, 58], 0, 4).map(note => note.midi === 58 ? { ...note, dur: 1.5 } : note);
    const { resolution } = replay(notes);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[0, "C7", 1.5]]);
    expect(resolution.fallbackSpans.some(span => span.startBeat === 1.5 && span.endBeat >= 4)).toBe(true);
  });

  it("ends an inversion when its bass releases even if that pitch class remains above it", () => {
    const notes = stack([52, 55, 60, 64], 0, 4).map(note => note.midi === 52 ? { ...note, dur: 1.5 } : note);
    const { resolution } = replay(notes);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[0, "C/E", 1.5]]);
    expect(resolution.fallbackSpans.some(span => span.startBeat === 1.5 && span.endBeat >= 4)).toBe(true);
  });

  it.each([
    { name: "C", pitches: [48, 52, 55], release: 48 },
    { name: "C", pitches: [48, 52, 55], release: 52 },
    { name: "C", pitches: [48, 52, 55], release: 55 },
    { name: "Cm", pitches: [48, 51, 55], release: 51 },
    { name: "Cm", pitches: [48, 51, 55], release: 55 },
    { name: "C/E", pitches: [52, 55, 60], release: 52 },
  ])("ends the played $name when MIDI $release releases even if the contextual label is unchanged", ({ name, pitches, release }) => {
    const notes = stack(pitches, 0, 4).map(note => note.midi === release ? { ...note, dur: 1.5 } : note);
    const { resolution } = replay(notes);
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[0, name, 1.5]]);
    expect(resolution.guidanceNotes.every(note => note.start + note.dur <= 1.5)).toBe(true);
    expect(resolution.fallbackSpans).toContainEqual({ startBeat: 1.5, endBeat: 4, reason: "no supported source attack" });
  });

  it("reports the released support until the next real attack, without filling that gap", () => {
    const notes = stack([48, 52, 55], 0, 4).map(note => note.midi === 52 ? { ...note, dur: 1.5 } : note);
    const { resolution } = replay([...notes, ...stack([48, 52, 55], 2.25, 1.75)]);
    expect(resolution.chords.map(chord => [chord.beat, chord.durationBeats])).toEqual([[0, 1.5], [2.25, 1.75]]);
    expect(resolution.fallbackSpans).toContainEqual({ startBeat: 1.5, endBeat: 2.25, reason: "no supported source attack" });
  });

  it("preserves authored harmony and explicit no-chord spans over conflicting source holds", () => {
    const data: SongData = {
      ...song(stack([48, 52, 55, 58], 0, 8)),
      chords: [
        { beat: 0, durationBeats: 4, name: "F", notes: [], sourceKind: "authored" },
        { beat: 4, durationBeats: 4, name: "N.C.", notes: [], sourceKind: "authored" },
      ],
    };
    const { resolution } = replayChordsBacking(projectChordSources(data, null));
    expect(resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[0, "F", 4]]);
    expect(resolution.fallbackSpans).toContainEqual({ startBeat: 4, endBeat: 8, reason: "explicit no-chord" });
  });

  it("does not turn an explicitly vocal held stack into accompaniment", () => {
    const { resolution } = replay(stack([48, 52, 55, 58], 0, 8).map(note => ({ ...note, identitySource: "vocals" })));
    expect(resolution.chords).toEqual([]);
    expect(resolution.notes).toEqual([]);
  });
});
