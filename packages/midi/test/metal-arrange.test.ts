import { describe, expect, it } from "vitest";
import { buildMetalArrangement, buildVariants, parseChordSymbol, validateVariants, verifyMonotonicity } from "../src/index.js";
import type { Note, ParsedMidi } from "../src/index.js";

function midi(notes: Note[], durationBeats = 16): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["stem"],
    durationBeats,
  };
}

describe("metal piano arranger", () => {
  it("selects vocals then a guitar riff, infers power chords, and never pitches drums", () => {
    const vocals = Array.from({ length: 8 }, (_, i) => ({ midi: 67 + (i % 3), start: i, dur: 0.8, vel: 100 }));
    const guitar: Note[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ midi: 48 + (i % 2) * 7, start: i * 0.5, dur: 0.4, vel: 84 })),
      ...Array.from({ length: 16 }, (_, i) => ({ midi: 64 + (i % 4), start: 8 + i * 0.5, dur: 0.4, vel: 96 })),
    ];
    const bass = [0, 4, 8, 12].map((start, i) => ({ midi: [36, 41, 43, 36][i]!, start, dur: 4, vel: 92 }));
    const drums = Array.from({ length: 32 }, (_, i) => ({ midi: 35, start: i * 0.5, dur: 0.1, vel: 120 }));
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(vocals) },
        { role: "guitar", midi: midi(guitar) },
        { role: "bass", midi: midi(bass) },
        { role: "drums", midi: midi(drums) },
      ],
    });

    expect(result.ir.sections.map((section) => section.source)).toEqual(["vocals", "guitar"]);
    expect(result.parsed.notes.filter((note) => note.hand === "R").some((note) => note.start >= 8)).toBe(true);
    expect(result.parsed.notes.every((note) => note.hand === "R" || note.hand === "L")).toBe(true);
    expect(result.parsed.notes.some((note) => note.midi === 35)).toBe(false);
    expect(result.ir.rhythmicAccents.length).toBe(32);
    expect(result.chords[0]?.name).toBe("C5");
    expect(parseChordSymbol(result.chords[0]!.name).quality).toBe("5");
    expect(result.parsed.notes.filter((note) => note.hand === "L").length).toBeGreaterThan(0);
  });

  it("does not let a single-pitch vocal bleed lane mask a moving guitar riff", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(Array.from({ length: 32 }, (_, i) => ({ midi: 72, start: i * 0.5, dur: 0.4, vel: 96 }))) },
        { role: "guitar", midi: midi(Array.from({ length: 32 }, (_, i) => ({ midi: 52 + (i % 4) * 2, start: i * 0.5, dur: 0.4, vel: 84 }))) },
        { role: "bass", midi: midi([{ midi: 40, start: 0, dur: 8, vel: 88 }]) },
      ],
    });

    expect(result.ir.sections).toHaveLength(2);
    expect(result.ir.sections.every((section) => section.source === "guitar")).toBe(true);
    expect(result.ir.identity).toHaveLength(32);
    expect(new Set(result.ir.identity.map((note) => note.midi)).size).toBeGreaterThan(1);
  });

  it("fuses a trustworthy vocal phrase with denser lead guitar in the same section", () => {
    const vocals: Note[] = [
      { midi: 76, start: 0, dur: 0.35, vel: 96 },
      { midi: 77, start: 2, dur: 0.35, vel: 96 },
      { midi: 79, start: 4, dur: 0.35, vel: 96 },
    ];
    const guitar = Array.from({ length: 16 }, (_, index) => ({
      midi: 60 + (index % 5),
      start: index * 0.5,
      dur: 0.35,
      vel: 88,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "guitar", midi: midi(guitar, 8) },
      ],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh).toHaveLength(16);
    expect(rh.find((note) => note.start === 0)?.midi).toBe(76);
    expect(rh.find((note) => note.start === 2)?.midi).toBe(77);
    expect(rh.find((note) => note.start === 4)?.midi).toBe(79);
    expect(rh.some((note) => note.start === 0.5 && note.midi === 61)).toBe(true);
    expect(new Set(rh.map((note) => note.start.toFixed(3))).size).toBe(rh.length);
    expect(result.ir.sections[0]?.source).toBe("mixed");
  });

  it("keeps vocals with long breaths and rejects isolated vocal bleed over a usable guitar", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 76, start: 0, dur: 0.35, vel: 96 },
          { midi: 77, start: 3.5, dur: 0.35, vel: 96 },
          { midi: 79, start: 7, dur: 0.35, vel: 96 },
          { midi: 84, start: 11.5, dur: 0.1, vel: 40 },
        ], 12) },
        { role: "guitar", midi: midi(Array.from({ length: 24 }, (_, index) => ({
          midi: 60 + (index % 4), start: index * 0.5, dur: 0.35, vel: 88,
        })), 12) },
      ],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.find((note) => note.start === 0)?.midi).toBe(76);
    expect(rh.find((note) => note.start === 3.5)?.midi).toBe(77);
    expect(rh.find((note) => note.start === 7)?.midi).toBe(79);
    expect(rh.some((note) => note.midi === 84)).toBe(false);
  });

  it("fills only genuine rests around a sustained vocal and keeps the RH non-overlapping", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 72, start: 0, dur: 1.5, vel: 96 },
          { midi: 74, start: 2, dur: 1.5, vel: 96 },
        ], 5) },
        { role: "guitar", midi: midi([
          { midi: 67, start: 0.5, dur: 0.2, vel: 88 },
          { midi: 69, start: 1.6, dur: 0.2, vel: 88 },
          { midi: 71, start: 3.5, dur: 0.2, vel: 88 },
          { midi: 72, start: 4.4, dur: 0.2, vel: 88 },
        ], 5) },
      ],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.some((note) => note.start === 0.5)).toBe(false);
    expect(rh.some((note) => note.start === 1.6)).toBe(true);
    expect(rh.some((note) => note.start === 3.5)).toBe(true);
    expect(rh.some((note) => note.start === 4.4)).toBe(true);
    for (let index = 1; index < rh.length; index++) {
      expect(rh[index - 1]!.start + rh[index - 1]!.dur).toBeLessThanOrEqual(rh[index]!.start + 1e-6);
    }
  });

  it("prefers a plausible upper lead over lower accompaniment after a rest", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 0.25, vel: 80 },
        { midi: 64, start: 2, dur: 0.5, vel: 100 },
        { midi: 78, start: 2, dur: 0.5, vel: 65 },
      ], 4) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.find((note) => note.start === 2)?.midi).toBe(78);
  });

  it("keeps fast lead attacks through medium and contour-thins easy", () => {
    const guitar = Array.from({ length: 64 }, (_, index) => ({
      midi: 64 + (index % 7),
      start: index * 0.125,
      dur: 0.1,
      vel: 88,
    }));
    const sourceMidi = midi(guitar, 8);
    sourceMidi.tempoBpm = 60;
    const arranged = buildMetalArrangement({ stems: [{ role: "guitar", midi: sourceMidi }] });
    const variants = buildVariants(arranged.parsed, { title: "Solo", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: false,
      chords: arranged.chords,
    });
    const expectedStarts = guitar.map((note) => note.start.toFixed(3));
    for (const level of ["advanced", "medium"] as const) {
      const rhStarts = variants
        .find((variant) => variant.level === level)!
        .notes.filter((note) => note.hand === "R")
        .map((note) => note.start.toFixed(3));
      expect(rhStarts).toEqual(expectedStarts);
    }
    const easyStarts = variants
      .find((variant) => variant.level === "easy")!
      .notes.filter((note) => note.hand === "R")
      .map((note) => note.start.toFixed(3));
    expect(easyStarts.length).toBeLessThan(expectedStarts.length);
    expect(easyStarts.every((start) => expectedStarts.includes(start))).toBe(true);
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("is deterministic and supplies authoritative chords to all playable levels", () => {
    const input = {
      stems: [
        { role: "guitar" as const, midi: midi(Array.from({ length: 32 }, (_, i) => ({ midi: 60 + (i % 5), start: i * 0.5, dur: 0.4, vel: 90 }))) },
        { role: "bass" as const, midi: midi([0, 4, 8, 12].map((start, i) => ({ midi: [45, 41, 43, 45][i]!, start, dur: 4, vel: 80 }))) },
      ],
    };
    const first = buildMetalArrangement(input);
    const second = buildMetalArrangement({ stems: [...input.stems].reverse() });
    expect(second.parsed.notes).toEqual(first.parsed.notes);
    expect(second.chords).toEqual(first.chords);

    const variants = buildVariants(first.parsed, { title: "Metal", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: false,
      chords: first.chords,
    });
    expect(validateVariants(variants)).toEqual([]);
    expect(variants).toHaveLength(6);
    for (const variant of variants) {
      expect(variant.chords).toEqual(first.chords);
      expect(variant.notes.some((note) => note.hand === "R")).toBe(true);
      expect(variant.notes.some((note) => note.hand === "L")).toBe(true);
    }
  });

  it("lets fresh bass attacks change harmony and clips identity at role boundaries", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([{ midi: 67, start: 7.5, dur: 2, vel: 100 }]) },
        { role: "guitar", midi: midi(Array.from({ length: 16 }, (_, i) => ({ midi: 64 + (i % 2), start: 8 + i * 0.5, dur: 0.4, vel: 92 }))) },
        { role: "bass", midi: midi([
          { midi: 36, start: 0, dur: 4, vel: 80 },
          { midi: 38, start: 2, dur: 2, vel: 90 },
        ]) },
      ],
    });
    expect(result.chords.slice(0, 2).map((chord) => chord.name)).toEqual(["C5", "D5"]);
    const vocalTail = result.parsed.notes.find((note) => note.hand === "R" && note.start === 7.5)!;
    expect(vocalTail.start + vocalTail.dur).toBeLessThanOrEqual(8);
    expect(result.parsed.notes.some((note) => note.hand === "R" && note.start === 8)).toBe(true);
  });

  it("octave-folds implausible short-window identity leaps", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 0.4, vel: 90 },
        { midi: 84, start: 0.5, dur: 0.4, vel: 90 },
      ]) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh).toHaveLength(2);
    expect(Math.abs(rh[1]!.midi - rh[0]!.midi)).toBeLessThanOrEqual(12);
  });

  it("keeps generated chord spans and final measures aligned to source duration", () => {
    const notes: Note[] = [];
    for (let beat = 0; beat < 4; beat++) {
      for (const [midiNote, hand] of [[48, "L"], [60, "R"], [64, "R"], [67, "R"], [72, "R"]] as const) {
        notes.push({ midi: midiNote, start: beat, dur: 1, vel: 80, hand });
      }
    }
    for (let beat = 4; beat < 8; beat++) {
      for (const [midiNote, hand] of [[43, "L"], [55, "R"], [59, "R"], [62, "R"], [67, "R"]] as const) {
        notes.push({ midi: midiNote, start: beat, dur: 1, vel: 80, hand });
      }
    }
    const variants = buildVariants(midi(notes, 16), { title: "Spans", artist: "Fixture" }, { maxDurBeats: null });
    const advanced = variants.find((variant) => variant.level === "advanced")!;
    expect(advanced.chords.map((chord) => [chord.beat, chord.durationBeats])).toEqual([[0, 4], [4, 12]]);
    expect(advanced.measures.at(-1)).toEqual({ index: 3, startBeat: 12, endBeat: 16 });
  });

  it("does not turn a malformed meter denominator into an empty arrangement", () => {
    const malformed = midi(
      Array.from({ length: 8 }, (_, index) => ({ midi: 60 + index, start: index, dur: 0.5, vel: 80 })),
      8,
    );
    malformed.timeSig = [4, 0];
    const result = buildMetalArrangement({ stems: [{ role: "guitar", midi: malformed }] });
    expect(result.ir.sections.length).toBeGreaterThan(0);
    expect(result.parsed.notes.length).toBeGreaterThan(0);
  });
});
