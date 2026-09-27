import { describe, expect, it } from "vitest";
import { inferHarmonyTimeline, type Note } from "../src/index.js";

const bars = (count: number, length = 4, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ startBeat: from + i * length, endBeat: from + (i + 1) * length }));
const arpeggio = (start: number, pitches: number[], step = 1): Note[] =>
  pitches.map((midi, i) => ({ midi, start: start + i * step, dur: step, vel: 70, hand: "L" as const }));
const labels = (notes: Note[], measures = bars(4), key = "C") =>
  inferHarmonyTimeline(notes, measures, { key }).map((chord) => [chord.beat, chord.name]);

describe("inferHarmonyTimeline", () => {
  it("follows chord changes in single-note arpeggios", () => {
    const notes = [
      ...arpeggio(0, [48, 52, 55, 60]),
      ...arpeggio(4, [41, 45, 48, 53]),
      ...arpeggio(8, [43, 47, 50, 55]),
      ...arpeggio(12, [48, 52, 55, 60]),
    ];
    expect(labels(notes)).toEqual([[0, "C"], [4, "F"], [8, "G"], [12, "C"]]);
  });

  it("names the third from the melody over a bare left-hand fifth", () => {
    const notes: Note[] = [
      { midi: 45, start: 0, dur: 4, vel: 70, hand: "L" },
      { midi: 52, start: 0, dur: 4, vel: 70, hand: "L" },
      { midi: 72, start: 0, dur: 2, vel: 90, hand: "R" },
      { midi: 69, start: 2, dur: 2, vel: 90, hand: "R" },
    ];
    expect(labels(notes, bars(1))).toEqual([[0, "Am"]]);
  });

  it("changes at the half bar and leaves a silent bar as N.C.", () => {
    const notes = [...arpeggio(0, [48, 52]), ...arpeggio(2, [43, 47, 50], 2 / 3), ...arpeggio(8, [48, 52, 55, 60])];
    expect(labels(notes, bars(3))).toEqual([[0, "C"], [2, "G"], [4, "N.C."], [8, "C"]]);
  });

  it("keeps each bar's own phase through a pickup and a meter change", () => {
    const measures = [{ startBeat: 0, endBeat: 1 }, ...bars(2, 3, 1), ...bars(1, 4, 7)];
    const notes = [
      { midi: 67, start: 0, dur: 1, vel: 80, hand: "R" as const },
      ...arpeggio(1, [48, 52, 55]),
      ...arpeggio(4, [43, 47, 50]),
      ...arpeggio(7, [48, 52, 55, 60]),
    ];
    const timeline = inferHarmonyTimeline(notes, measures, { key: "C" });
    expect(timeline.map((chord) => chord.beat)).toEqual([0, 1, 4, 7]);
    expect(timeline.slice(1).map((chord) => chord.name)).toEqual(["C", "G", "C"]);
    expect(timeline.at(-1)).toMatchObject({ durationBeats: 4, sourceKind: "generated", inferenceType: "harmony-window" });
  });

  it("spells roots for the key", () => {
    const eb = [...arpeggio(0, [51, 55, 58, 63])];
    expect(labels(eb, bars(1), "Bb")).toEqual([[0, "Eb"]]);
    const gSharpMinor = [...arpeggio(0, [56, 59, 63, 68])];
    expect(labels(gSharpMinor, bars(1), "E")).toEqual([[0, "G#m"]]);
  });
});

// Original, deliberately small counterexamples; not golden-corpus calibration songs.
it("grounds backing harmony in played stacks, including off-grid inversions, sevenths and rests", () => {
  const stack = (start: number, pitches: number[], dur = 0.75): Note[] =>
    pitches.map(midi => ({ midi, start, dur, vel: 75, hand: start < 2 ? "L" : "R" }));
  const notes = [
    ...stack(0.5, [48, 52, 55]),
    ...stack(2.25, [52, 55, 60]),
    ...stack(3.5, [43, 47, 50, 53], 0.5),
    { midi: 81, start: 0, dur: 4, vel: 100, identitySource: "vocals" as const },
  ];
  const timeline = inferHarmonyTimeline(notes, bars(2), { key: "C", backingOnly: true });
  expect(timeline.filter(c => c.notes.length).map(c => [c.beat, c.name, c.durationBeats]))
    .toEqual([[0.5, "C", 0.75], [2.25, "C/E", 0.75], [3.5, "G7", 0.5]]);
  expect(timeline.find(c => c.beat === 4)).toMatchObject({ name: "N.C.", notes: [] });
  expect(inferHarmonyTimeline([...notes].reverse(), bars(2), { key: "C", backingOnly: true })).toEqual(timeline);
});

it("abstains on a solo line instead of inventing a major third, and distinguishes it from silence", () => {
  const notes = arpeggio(0, [72, 74, 76, 79]).map(n => ({ ...n, hand: "R" as const }));
  const timeline = inferHarmonyTimeline(notes, bars(2), { key: "C", backingOnly: true });
  expect(timeline.every(c => c.notes.length === 0)).toBe(true);
  expect(timeline[0]?.reviewReason).toMatch(/harmon|accompaniment/i);
  expect(timeline.find(c => c.beat === 4)?.reviewReason).toBeUndefined();
  // Ingest may assign a solo line to LH by register; that is not role proof.
  expect(inferHarmonyTimeline(notes.map(n => ({ ...n, hand: "L" })), bars(2), { key: "C", backingOnly: true })
    .every(c => c.notes.length === 0)).toBe(true);
});

it("recognizes overlapping broken chords without simultaneous attacks", () => {
  const notes = arpeggio(0, [48, 52, 55, 60], 0.5).map(n => ({ ...n, dur: 1.5 }));
  const timeline = inferHarmonyTimeline(notes, bars(1), { key: "C", backingOnly: true });
  expect(timeline.some(c => c.name === "C" && c.notes.length > 0)).toBe(true);
  expect(timeline.filter(c => c.beat < 2).every(c => !c.reviewReason)).toBe(true);
});

it("keeps one harmony across short articulation gaps without hiding the final rest", () => {
  const notes = Array.from({ length: 4 }, (_, i) => [48, 52, 55].map(midi => ({ midi, start: i, dur: 0.75, vel: 70, hand: "L" as const }))).flat();
  const timeline = inferHarmonyTimeline(notes, bars(1), { key: "C", backingOnly: true });
  expect(timeline.filter(c => c.notes.length).map(c => [c.beat, c.name, c.durationBeats])).toEqual([[0, "C", 3.75]]);
  expect(timeline.at(-1)).toMatchObject({ beat: 3.75, name: "N.C." });
});
