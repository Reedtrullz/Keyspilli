import { describe, expect, it } from "vitest";
import {
  capoChordSymbol,
  chordPitchClasses,
  chordToNoteEvents,
  chordToNotes,
  parseChordSymbol,
  transposeChordSymbol,
  tryParseChordSymbol,
} from "../src/index.js";

describe("chord symbols", () => {
  it("parses qualities and slash basses", () => {
    expect(parseChordSymbol("C")).toMatchObject({ root: "C", rootPc: 0, quality: "major" });
    expect(parseChordSymbol("C5")).toMatchObject({ root: "C", rootPc: 0, quality: "5" });
    expect(parseChordSymbol("Am7")).toMatchObject({ root: "A", rootPc: 9, quality: "m7" });
    expect(parseChordSymbol("F#maj7/A#")).toMatchObject({
      root: "F#",
      rootPc: 6,
      quality: "maj7",
      bass: "A#",
      bassPc: 10,
    });
    expect(parseChordSymbol("Bb add9 / D")).toMatchObject({ root: "Bb", quality: "add9", bass: "D" });
    expect(parseChordSymbol("Dsus").quality).toBe("sus4");
  });

  it("covers the supported chord pitch classes", () => {
    expect(chordPitchClasses("C")).toEqual([0, 4, 7]);
    expect(chordPitchClasses("C5")).toEqual([0, 7]);
    expect(chordPitchClasses("Cm")).toEqual([0, 3, 7]);
    expect(chordPitchClasses("C7")).toEqual([0, 4, 7, 10]);
    expect(chordPitchClasses("Cmaj7")).toEqual([0, 4, 7, 11]);
    expect(chordPitchClasses("Cm7")).toEqual([0, 3, 7, 10]);
    expect(chordPitchClasses("C6")).toEqual([0, 4, 7, 9]);
    expect(chordPitchClasses("Csus2")).toEqual([0, 2, 7]);
    expect(chordPitchClasses("Csus4")).toEqual([0, 5, 7]);
    expect(chordPitchClasses("Cdim")).toEqual([0, 3, 6]);
    expect(chordPitchClasses("Caug")).toEqual([0, 4, 8]);
    expect(chordPitchClasses("Cadd9")).toEqual([0, 4, 7, 2]);
    expect(chordPitchClasses("C/B")).toEqual([0, 4, 7, 11]);
  });

  it("generates compact root-position MIDI notes and slash basses", () => {
    expect(chordToNotes("C", { octave: 4 })).toEqual([60, 64, 67]);
    expect(chordToNotes("C5", { octave: 4 })).toEqual([60, 67]);
    expect(chordToNotes("C/E", { octave: 4, bassOctave: 3 })).toEqual([52, 60, 64, 67]);
    expect(chordToNotes("C", { octave: 4, includeBass: true, bassOctave: 3 })).toEqual([48, 60, 64, 67]);
    expect(chordToNotes("Cadd9", { octave: 4 })).toEqual([60, 64, 67, 74]);
    expect(chordToNoteEvents("Am", { octave: 3, start: 2, dur: 2, vel: 72 }).map((n) => [n.midi, n.start, n.dur, n.vel])).toEqual([
      [57, 2, 2, 72],
      [60, 2, 2, 72],
      [64, 2, 2, 72],
    ]);
  });

  it("applies capo and transposition to roots and slash basses", () => {
    expect(parseChordSymbol("C/G", { capo: 2 })).toMatchObject({ root: "D", bass: "A", rootPc: 2, bassPc: 9 });
    expect(chordToNotes("B", { octave: 4, transpose: 1 })).toEqual([72, 76, 79]);
    expect(transposeChordSymbol("Bb7/D", 2)).toBe("C7/E");
    expect(capoChordSymbol("G", 2)).toBe("A");
  });

  it("fails closed for malformed or unsupported symbols", () => {
    expect(() => parseChordSymbol("H7")).toThrow(/root/);
    expect(() => parseChordSymbol("C9")).toThrow(/Unsupported/);
    expect(() => parseChordSymbol("C//E")).toThrow(/Invalid/);
    expect(tryParseChordSymbol("not a chord")).toBeNull();
  });
});
