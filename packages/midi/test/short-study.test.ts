import { describe, expect, it } from "vitest";
import { buildShortStudyVariants, shortStudyKind, validateShortStudySource, validateVariants, type Note, type ParsedMidi } from "../src/index.js";

const makeSource = (notes: Note[]): ParsedMidi => ({
  format: 1,
  division: 480,
  tempoBpm: 120,
  keySig: 0,
  keyMode: 0,
  timeSig: [4, 4],
  notes,
  trackNames: ["Owner-authored study"],
  durationBeats: Math.max(0, ...notes.map((note) => note.start + note.dur)),
});

describe("explicit short-study variants", () => {
  const studies: Array<[string, Note[]]> = [
    ["one-note", [{ midi: 60, start: 0, dur: 1, vel: 80 }]],
    ["triad", [60, 64, 67].map((midi) => ({ midi, start: 0, dur: 1, vel: 80 }))],
    ["four-note-phrase", [60, 62, 64, 65].map((midi, index) => ({ midi, start: index, dur: 0.5, vel: 80 }))],
  ];

  for (const [kind, notes] of studies) {
    it(`admits an exact ${kind} only through the explicit study gate`, () => {
      const source = makeSource(notes);
      expect(shortStudyKind(source.notes)).toBe(kind);
      expect(validateShortStudySource(source.notes)).toEqual([]);
      expect(validateVariants([{ ...buildShortStudyVariants(source, { title: "Study", artist: "Owner" })[0]!, notes }])).toContainEqual(expect.stringMatching(/only \d+ notes/));
      const variants = buildShortStudyVariants(source, { title: "Study", artist: "Owner" });
      expect(validateVariants(variants, { shortStudy: true })).toEqual([]);
      expect(variants.every((variant) => JSON.stringify(variant.notes.map(({ midi, start, dur, vel }) => [midi, start, dur, vel]))
        === JSON.stringify(notes.map(({ midi, start, dur, vel }) => [midi, start, dur, vel])))).toBe(true);
    });
  }

  it("rejects empty, malformed, overlong, and non-study sources", () => {
    expect(validateShortStudySource([])).not.toEqual([]);
    expect(validateShortStudySource([{ midi: 60, start: 0, dur: 1, vel: 80 }, { midi: 62, start: 1, dur: 1, vel: 80 }])).not.toEqual([]);
    expect(validateShortStudySource([{ midi: 120, start: 0, dur: 1, vel: 80 }]).join(" ")).toMatch(/piano range/);
    expect(validateShortStudySource([{ midi: 60, start: 0, dur: 0, vel: 80 }]).join(" ")).toMatch(/duration/);
    expect(validateVariants([{ ...buildShortStudyVariants(makeSource(studies[0]![1]), { title: "Study", artist: "Owner" })[0]!, notes: [] }], { shortStudy: true }))
      .not.toEqual([]);
  });
});
