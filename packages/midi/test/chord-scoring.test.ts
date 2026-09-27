import { describe, expect, it } from "vitest";
import { chordsFromBlocks, chordsFromLabels, rootOfPitchClasses, scoreChords } from "../src/chord-scoring.js";
import type { Note } from "../src/index.js";

const block = (start: number, dur: number, pitches: number[]): Note[] => pitches.map((midi) => ({ midi, start, dur, vel: 80 }));
const label = (beat: number, name: string, durationBeats?: number) => ({ beat, name, notes: [], ...(durationBeats ? { durationBeats } : {}) });

describe("chord scoring", () => {
  it("names block-chord roots, including inversions and sevenths", () => {
    expect(rootOfPitchClasses([4, 7, 0])).toBe(0);
    expect(rootOfPitchClasses([7, 11, 2, 5])).toBe(7);
    expect(rootOfPitchClasses([0, 1])).toBeNull();
  });

  it("scores root, major/minor, sevenths and boundaries over time", () => {
    const reference = chordsFromBlocks([...block(0, 4, [48, 52, 55]), ...block(4, 4, [43, 47, 50, 53]), ...block(8, 4, [45, 48, 52])]);
    expect(reference.map((chord) => chord.root)).toEqual([0, 7, 9]);

    const perfect = scoreChords(reference, chordsFromLabels([label(0, "C"), label(4, "G7"), label(8, "Am")], 12), 12);
    expect(perfect).toEqual({ beats: 12, root: 1, majMin: 1, sevenths: 1, segmentation: 1 });

    // G instead of G7 is right for major/minor, wrong for sevenths; A instead of Am only has the root.
    const partial = scoreChords(reference, chordsFromLabels([label(0, "C"), label(4, "G"), label(8, "A")], 12), 12);
    expect(partial).toMatchObject({ root: 1, majMin: 2 / 3, sevenths: 1 / 3 });

    // A power chord has no third: right root, wrong major/minor.
    const power = scoreChords(reference, chordsFromLabels([label(0, "C5"), label(4, "G7"), label(8, "Am")], 12), 12);
    expect(power).toMatchObject({ root: 1, majMin: 2 / 3 });

    // Late changes cost boundary agreement.
    const late = scoreChords(reference, chordsFromLabels([label(0, "C"), label(6, "G7"), label(8, "Am")], 12), 12);
    expect(late.root).toBeCloseTo(10 / 12);
    expect(late.segmentation).toBeCloseTo(1 - 2 / 12);
  });

  it("treats gaps and N.C. as no chord", () => {
    const reference = chordsFromBlocks(block(4, 4, [48, 52, 55]));
    const score = scoreChords(reference, chordsFromLabels([label(0, "N.C.", 4), label(4, "C", 4)], 8), 8);
    expect(score).toMatchObject({ root: 1, majMin: 1 });
  });
});
