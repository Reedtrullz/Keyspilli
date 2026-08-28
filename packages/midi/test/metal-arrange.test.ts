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

  it("suppresses repeated low guitar pulses while preserving lead and vocal anchors", () => {
    const pulsePitches = [57, 57, 59, 57, 57, 60, 57, 62];
    const lowPulse = Array.from({ length: 12 }, (_, index) => ({
      midi: pulsePitches[index % pulsePitches.length]!,
      start: index * 0.75,
      dur: 0.5,
      vel: index % 4 === 0 ? 88 : 64,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi([
          ...lowPulse,
          { midi: 72, start: 12, dur: 0.5, vel: 92 },
          { midi: 74, start: 12.75, dur: 0.5, vel: 90 },
        ], 12) },
        { role: "vocals", midi: midi([
          { midi: 79, start: 14, dur: 0.5, vel: 100 },
          { midi: 81, start: 14.75, dur: 0.5, vel: 98 },
        ], 16) },
      ],
    });
    const identity = result.ir.identity;
    const lowGuitar = identity.filter((note) => note.identitySource === "guitar" && note.midi <= 60);
    expect(lowGuitar.length).toBeLessThanOrEqual(3);
    expect(identity.some((note) => note.identitySource === "guitar" && note.start === 12 && note.midi === 72)).toBe(true);
    expect(identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([79, 81]);
  });

  it("suppresses low pulse subsequences even when high guitar landings are interleaved", () => {
    const lowPulse = Array.from({ length: 16 }, (_, index) => ({
      midi: index % 5 === 0 ? 59 : 57,
      start: index * 0.75,
      dur: 0.35,
      vel: index % 4 === 0 ? 86 : 64,
    }));
    const highLead = Array.from({ length: 6 }, (_, index) => ({
      midi: 68 + (index % 4),
      start: 0.375 + index * 1.5,
      dur: 0.3,
      vel: 92,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowPulse, ...highLead], 14) }],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.filter((note) => note.midi <= 60).length).toBeLessThanOrEqual(5);
    expect(guitar.filter((note) => note.midi >= 68).length).toBeGreaterThanOrEqual(5);
  });

  it("routes a stable low guitar pulse into the LH instead of RH identity", () => {
    const lowPulse = Array.from({ length: 16 }, (_, index) => ({
      midi: 57,
      start: index * 0.5,
      dur: 0.25,
      vel: index % 4 === 0 ? 86 : 72,
    }));
    const highLead = Array.from({ length: 8 }, (_, index) => ({
      midi: 72 + (index % 4),
      start: index,
      dur: 0.5,
      vel: 92,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowPulse, ...highLead], 8) }],
    });
    const identityLow = result.ir.identity.filter((note) => note.identitySource === "guitar" && note.midi <= 62);
    const rhythmLow = result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar");
    expect(identityLow, "stable rhythm pulse leaked into RH identity").toHaveLength(0);
    expect(rhythmLow.length, "stable rhythm pulse was dropped instead of moved to LH").toBeGreaterThanOrEqual(8);
    expect(rhythmLow.every((note) => note.midi <= 54)).toBe(true);
    expect(result.ir.identity.some((note) => note.identitySource === "guitar" && note.midi >= 72)).toBe(true);

    const variants = buildVariants(result.parsed, { title: "Routed guitar pulse", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
      chords: result.chords,
    });
    for (const level of ["advanced", "medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes;
      expect(notes.some((note) => note.hand === "R" && note.identitySource === "guitar" && note.midi <= 62), `${level} leaked low pulse into RH`).toBe(false);
      expect(notes.some((note) => note.hand === "L" && note.identitySource === "guitar"), `${level} lost LH pulse representation`).toBe(true);
    }
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("routes alternating low power roots into the LH while keeping the lead in RH", () => {
    const lowPulse = Array.from({ length: 16 }, (_, index) => ({
      midi: index % 2 === 0 ? 45 : 52,
      start: index * 0.5,
      dur: 0.25,
      vel: index % 4 === 0 ? 86 : 72,
    }));
    const highLead = Array.from({ length: 8 }, (_, index) => ({
      midi: 72 + (index % 4),
      start: index,
      dur: 0.5,
      vel: 92,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowPulse, ...highLead], 8) }],
    });
    const rhythmLow = result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar");
    expect(rhythmLow.length, "alternating power-root pulse was not routed to LH").toBeGreaterThanOrEqual(8);
    expect(rhythmLow.every((note) => note.midi <= 54)).toBe(true);
    expect(result.ir.identity.some((note) => note.identitySource === "guitar" && note.midi >= 72)).toBe(true);
  });

  it("thins routed metal rhythm attacks as difficulty becomes easier", () => {
    const lowPulse = Array.from({ length: 24 }, (_, index) => ({
      midi: index % 2 === 0 ? 45 : 52,
      start: index * 0.25,
      dur: 0.2,
      vel: 72,
    }));
    const highLead = Array.from({ length: 16 }, (_, index) => ({
      midi: 72 + (index % 4),
      start: index * 0.75,
      dur: 0.5,
      vel: 96,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowPulse, ...highLead], 12) }],
    });
    const variants = buildVariants(result.parsed, { title: "Routed rhythm ladder", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
      chords: result.chords,
    });
    const rhythmGaps = (level: "advanced" | "medium" | "easy") => {
      const starts = variants.find((variant) => variant.level === level)!.notes
        .filter((note) => note.hand === "L" && note.identitySource === "guitar")
        .map((note) => note.start)
        .sort((a, b) => a - b);
      return starts.slice(1).map((start, index) => start - starts[index]!);
    };
    expect(Math.min(...rhythmGaps("advanced"))).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(Math.min(...rhythmGaps("medium"))).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(Math.min(...rhythmGaps("easy"))).toBeGreaterThanOrEqual(0.75 - 1e-9);
    expect(validateVariants(variants)).toEqual([]);
  });

  it("keeps a repeated-note low guitar motif when it has a real melodic contour", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 0.5, vel: 88 },
        { midi: 57, start: 0.75, dur: 0.5, vel: 86 },
        { midi: 59, start: 1.5, dur: 0.5, vel: 84 },
        { midi: 57, start: 2.25, dur: 0.5, vel: 82 },
        { midi: 55, start: 3, dur: 0.5, vel: 80 },
        { midi: 57, start: 3.75, dur: 0.5, vel: 78 },
        { midi: 59, start: 4.5, dur: 0.5, vel: 76 },
        { midi: 57, start: 5.25, dur: 0.5, vel: 74 },
      ], 7) }],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.map((note) => note.start)).toEqual([0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25]);
  });

  it("keeps a moving low guitar contour instead of treating it as a pulse", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 0.5, vel: 88 },
        { midi: 57, start: 0.75, dur: 0.5, vel: 86 },
        { midi: 59, start: 1.5, dur: 0.5, vel: 84 },
        { midi: 61, start: 2.25, dur: 0.5, vel: 82 },
        { midi: 63, start: 3, dur: 0.5, vel: 80 },
        { midi: 65, start: 3.75, dur: 0.5, vel: 78 },
      ], 5) }],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.map((note) => note.start)).toEqual([0, 0.75, 1.5, 2.25, 3, 3.75]);
  });

  it("keeps a gently turning low lead instead of thinning it as a repeated pulse", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 0.5, vel: 88 },
        { midi: 57, start: 0.75, dur: 0.5, vel: 86 },
        { midi: 59, start: 1.5, dur: 0.5, vel: 84 },
        { midi: 60, start: 2.25, dur: 0.5, vel: 82 },
        { midi: 59, start: 3, dur: 0.5, vel: 80 },
        { midi: 60, start: 3.75, dur: 0.5, vel: 78 },
      ], 5) }],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.map((note) => note.start)).toEqual([0, 0.75, 1.5, 2.25, 3, 3.75]);
  });

  it("routes low guitar filler out of learner RH when an upper lead contour is present", () => {
    const highLead = [74, 76, 77, 75, 77, 76, 74, 72];
    const guitar = Array.from({ length: 16 }, (_, index) => ({
      midi: index % 2 === 0 ? highLead[index / 2]! : 58,
      start: index * 0.5,
      dur: 0.25,
      vel: index % 2 === 0 ? 90 : 70,
      hand: "R" as const,
      identitySource: "guitar" as const,
    }));
    const variants = buildVariants(midi(guitar, 8), { title: "Upper lead with low riff", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const rh = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand === "R");
      expect(rh.filter((note) => note.identitySource === "guitar" && note.midi <= 62), `${level} kept low rhythm filler`).toHaveLength(0);
      expect(rh.filter((note) => note.identitySource === "guitar" && note.midi >= 72).map((note) => note.midi)).toEqual(highLead);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand === "R");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.midi === 58)).toBe(true);
  });

  it("preserves a high lead landing instead of folding it into the middle register", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 72, start: 0, dur: 0.5, vel: 88 },
        { midi: 95, start: 1, dur: 1, vel: 108 },
        { midi: 74, start: 2.5, dur: 0.5, vel: 90 },
      ], 4) }],
    });
    const landing = result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 1);
    expect(landing?.midi).toBe(95);
  });

  it("preserves a quiet but sustained high lead landing", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 72, start: 0, dur: 0.5, vel: 88 },
        // Separation can under-report velocity on a phrase landing even
        // though its sustained duration makes it useful melody evidence.
        { midi: 95, start: 1, dur: 0.75, vel: 44 },
        { midi: 74, start: 2.5, dur: 0.5, vel: 90 },
      ], 4) }],
    });
    const landing = result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 1);
    expect(landing?.midi).toBe(95);
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
    const firstGuitarFill = rh.find((note) => note.start === 0.5)!;
    expect(firstGuitarFill.midi % 12).toBe(1);
    expect(Math.abs(firstGuitarFill.midi - 76)).toBeLessThanOrEqual(7);
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

  it("keeps playable advanced detail and progressively thins machine-fast metal attacks", () => {
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
    const startsFor = (level: string) => variants
      .find((variant) => variant.level === level)!
      .notes.filter((note) => note.hand === "R")
      .map((note) => note.start.toFixed(3));
    const advancedStarts = startsFor("advanced");
    const mediumStarts = startsFor("medium");
    const easyStarts = startsFor("easy");
    const veryEasyStarts = startsFor("very-easy");
    expect(advancedStarts).toEqual(expectedStarts);
    expect(mediumStarts.length).toBeLessThan(advancedStarts.length);
    expect(easyStarts.length).toBeLessThanOrEqual(mediumStarts.length);
    expect(veryEasyStarts.length).toBeLessThan(easyStarts.length);
    expect(mediumStarts.every((start) => advancedStarts.includes(start))).toBe(true);
    expect(easyStarts.every((start) => mediumStarts.includes(start))).toBe(true);
    expect(veryEasyStarts.every((start) => easyStarts.includes(start))).toBe(true);
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
  });

  it("removes rapid return spikes and enforces a tempo-aware local piano rate", () => {
    const scattered: Note[] = [
      { midi: 64, start: 0, dur: 0.2, vel: 90, hand: "R" },
      { midi: 76, start: 0.125, dur: 0.1, vel: 72, hand: "R" },
      { midi: 65, start: 0.25, dur: 0.2, vel: 88, hand: "R" },
      ...Array.from({ length: 29 }, (_, index) => ({
        midi: 66 + (index % 5), start: 0.375 + index * 0.125, dur: 0.1, vel: 84, hand: "R" as const,
      })),
    ];
    const source = midi(scattered, 4);
    source.tempoBpm = 120;
    const variants = buildVariants(source, { title: "Scattered lead", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: false,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand === "R");
    const easy = variants.find((variant) => variant.level === "easy")!.notes.filter((note) => note.hand === "R");
    expect(advanced.some((note) => note.start === 0.125 && note.midi === 76)).toBe(false);
    expect(advanced.length).toBeLessThan(scattered.length);
    expect(easy.length).toBeLessThan(advanced.length);
    for (let index = 1; index < easy.length; index++) {
      expect((easy[index]!.start - easy[index - 1]!.start) * 60 / 120).toBeGreaterThanOrEqual(0.25 - 1e-9);
    }
    expect(easy.every((note) => advanced.some((source) => source.start === note.start && source.midi === note.midi))).toBe(true);
  });

  it("drops an eighth-note guitar detour between nearby lead pitches", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      // This low, short chord-tone hit is typical of a separated guitar
      // partial, not a useful piano melody note between 64 and 67.
      { midi: 55, start: 0.625, dur: 0.5, vel: 52, hand: "R", identitySource: "guitar" },
      { midi: 67, start: 1.25, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 2);
    const variants = buildVariants(source, { title: "Lead detour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["advanced", "medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.start === 0.625 && note.midi === 55), `${level} kept detector detour`).toBe(false);
    }
  });

  it("drops a quiet five-semitone guitar U-turn but preserves vocal contour", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      // A quiet partial between nearby lead pitches is not useful piano
      // melody when it reverses immediately.
      { midi: 58, start: 0.5, dur: 0.5, vel: 42, hand: "R", identitySource: "guitar" },
      { midi: 63, start: 1, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      // Vocal contour is identity-bearing and must not be smoothed away.
      { midi: 72, start: 2, dur: 0.5, vel: 92, hand: "R", identitySource: "vocals" },
      { midi: 65, start: 2.5, dur: 0.5, vel: 42, hand: "R", identitySource: "vocals" },
      { midi: 71, start: 3, dur: 0.5, vel: 92, hand: "R", identitySource: "vocals" },
    ], 4);
    const variants = buildVariants(source, { title: "Quiet guitar U-turn", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["advanced", "medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 58), `${level} kept quiet guitar U-turn`).toBe(false);
      expect(notes.some((note) => note.identitySource === "vocals" && note.start === 2.5 && note.midi === 65), `${level} removed vocal contour`).toBe(true);
    }
  });

  it("removes selected low guitar contour detours while retaining high lead landings", () => {
    const source = midi([
      { midi: 76, start: 0, dur: 0.5, vel: 88, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 0.375, dur: 0.25, vel: 88, hand: "R", identitySource: "guitar" },
      { midi: 75, start: 1, dur: 0.5, vel: 88, hand: "R", identitySource: "guitar" },
      { midi: 66, start: 1.375, dur: 0.25, vel: 88, hand: "R", identitySource: "guitar" },
      { midi: 74, start: 2, dur: 0.5, vel: 88, hand: "R", identitySource: "guitar" },
      { midi: 79, start: 2.5, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
    ], 4);
    const variants = buildVariants(source, { title: "Guitar contour detours", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 64)).toBe(false);
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 66)).toBe(false);
      expect(notes.filter((note) => note.identitySource === "guitar").map((note) => note.midi)).toEqual([76, 75, 74]);
      expect(notes.some((note) => note.identitySource === "vocals" && note.midi === 79)).toBe(true);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.filter((note) => note.identitySource === "guitar").map((note) => note.midi)).toEqual([76, 64, 75, 66, 74]);
  });

  it("smooths a guitar detour across an interleaved vocal anchor", () => {
    const source = midi([
      { midi: 76, start: 0, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      // This short middle attack is only a detector excursion when the
      // guitar lane is considered on its own. The vocal anchor at beat 1
      // must not hide the guitar neighbours from the cleanup pass.
      { midi: 64, start: 0.5, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 1, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 75, start: 1.5, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 3);
    const variants = buildVariants(source, { title: "Interleaved guitar contour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 64), `${level} kept interleaved guitar detour`).toBe(false);
      expect(notes.some((note) => note.identitySource === "vocals" && note.start === 1 && note.midi === 64), `${level} removed vocal anchor`).toBe(true);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 64)).toBe(true);
  });

  it("cleans a guitar detour before vocal spacing can hide its next neighbour", () => {
    const source = midi([
      { midi: 76, start: 0, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 0.5, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      // The vocal keeps the next guitar attack out of the learner spacing
      // scheduler, so a post-selection pass alone cannot see the full U-turn.
      { midi: 64, start: 1.25, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 75, start: 1.5, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 3.5);
    const variants = buildVariants(source, { title: "Preselection guitar contour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 64), `${level} kept preselection guitar detour`).toBe(false);
      expect(notes.some((note) => note.identitySource === "vocals" && note.start === 1.25 && note.midi === 64), `${level} removed vocal anchor`).toBe(true);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 64)).toBe(true);
  });

  it("prefers a stepwise guitar contour over a quiet short large leap", () => {
    const source = midi([
      { midi: 64, start: 0.25, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 69, start: 0.75, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      // This isolated high hit is short and quiet; retaining it creates the
      // kind of wide, scattered jump that makes a learner melody feel
      // unplayable even when the attack rate is within the piano floor.
      { midi: 78, start: 1.25, dur: 0.125, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 74, start: 1.75, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 75, start: 2.25, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 3.25);
    const variants = buildVariants(source, { title: "Stepwise guitar contour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 1.25 && note.midi === 78), `${level} kept quiet large leap`).toBe(false);
      expect(notes.filter((note) => note.identitySource === "guitar").map((note) => note.midi)).toEqual([64, 69, 74, 75]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 1.25 && note.midi === 78)).toBe(true);
  });

  it("retains enough connected landings from a dense stepwise solo phrase", () => {
    const starts = [0, 0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2, 2.25, 3, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.75, 7.25];
    const pitches = [76, 72, 67, 64, 64, 67, 69, 69, 71, 64, 67, 69, 69, 72, 69, 69, 69, 67, 65, 67, 72, 64];
    const source = midi(pitches.map((midi, index) => ({
      midi,
      start: starts[index]!,
      dur: 0.25,
      vel: 80,
      hand: "R" as const,
      identitySource: "guitar" as const,
    })), 8);
    const variants = buildVariants(source, { title: "Reference-shaped solo", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const guitar = variants.find((variant) => variant.level === level)!.notes
        .filter((note) => note.hand !== "L" && note.identitySource === "guitar");
      // At a half-beat learner floor, an eight-beat phrase should retain a
      // connected set of landings. The exact quarter-beat ornament is a
      // harder-level detail; the learner path must keep the opening descent
      // within a comfortable octave instead of jumping straight to a low
      // detector partial.
      // The reference keeps a connected upper figure through this whole
      // eight-beat phrase. Learner levels may remove quarter-beat ornaments,
      // but should not collapse the phrase to isolated landings when a
      // stepwise candidate exists at the half-beat floor.
      expect(guitar.length, `${level} collapsed the solo contour`).toBeGreaterThanOrEqual(level === "medium" ? 10 : 8);
      expect(Math.abs(guitar[1]!.midi - guitar[0]!.midi), `${level} lost the connected opening descent`).toBeLessThanOrEqual(9);
      expect(guitar.some((note) => (note.midi === 67 || note.midi === 71) && note.start >= 1.5 && note.start <= 2.25), `${level} lost the phrase middle`).toBe(true);
      expect(guitar.some((note) => note.midi === 64 && note.start >= 7), `${level} lost the phrase landing`).toBe(true);
    }
  });

  it("scores guitar contour through a vocal handoff instead of its adjacent vocal pitch", () => {
    const source = midi([
      { midi: 64, start: 0.25, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 69, start: 0.75, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 78, start: 1.25, dur: 0.125, vel: 48, hand: "R", identitySource: "guitar" },
      // This vocal pitch is deliberately higher than the quiet guitar hit;
      // an adjacent-neighbour test would therefore miss the guitar peak.
      { midi: 80, start: 1.75, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 74, start: 2.25, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 3.25);
    const variants = buildVariants(source, { title: "Vocal handoff contour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 1.25 && note.midi === 78), `${level} kept handoff guitar spike`).toBe(false);
      expect(notes.some((note) => note.identitySource === "vocals" && note.start === 1.75 && note.midi === 80), `${level} removed vocal handoff`).toBe(true);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 1.25 && note.midi === 78)).toBe(true);
  });

  it("drops a weak guitar handoff that would make the vocal melody leap", () => {
    const source = midi([
      { midi: 83, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      // This is an isolated, low, quiet guitar partial between two vocal
      // anchors. Keeping it forces an 19-semitone handoff in a learner RH.
      { midi: 64, start: 0.75, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 84, start: 1.5, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
      { midi: 65, start: 2.25, dur: 0.5, vel: 72, hand: "R", identitySource: "guitar" },
    ], 3.25);
    const variants = buildVariants(source, { title: "Vocal guitar handoff", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.75), `${level} kept weak vocal handoff`).toBe(false);
      expect(notes.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([83, 84]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 0.75)).toBe(true);
  });

  it("drops only an isolated redundant guitar singleton between vocal anchors", () => {
    const source = midi([
      { midi: 72, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      // This attack is a redundant guitar hit between two vocal anchors. It
      // should not make the learner switch sources for one note, while the
      // vocal contour remains identity-bearing.
      { midi: 72, start: 0.5, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 74, start: 1, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
      // These two guitar attacks form a connected pickup and must survive the
      // singleton gate even though they sit between vocal phrases.
      { midi: 67, start: 1.5, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 69, start: 2, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 76, start: 2.75, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
    ], 3.5);
    const variants = buildVariants(source, { title: "Vocal bracket singleton", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.5), `${level} kept redundant guitar singleton`).toBe(false);
      expect(notes.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([72, 74, 76]);
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 1.5), `${level} removed connected guitar pickup`).toBe(true);
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 2), `${level} removed connected guitar continuation`).toBe(true);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.start === 0.5)).toBe(true);
  });

  it("drops an isolated large-hop guitar handoff after candidate scheduling", () => {
    const source = midi([
      { midi: 72, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      // The second quiet guitar candidate keeps the pre-selection guard from
      // treating the first attack as unsupported. Spacing selects only one of
      // them; the post-selection gate must then judge the played singleton.
      { midi: 64, start: 0.5, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 65, start: 0.625, dur: 0.125, vel: 40, hand: "R", identitySource: "guitar" },
      { midi: 84, start: 1, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
    ], 2);
    const variants = buildVariants(source, { title: "Post-selection handoff", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.filter((note) => note.identitySource === "guitar")).toHaveLength(0);
      expect(notes.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([72, 84]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && (note.start === 0.5 || note.start === 0.625))).toBe(true);
  });

  it("keeps a quiet guitar bridge that improves a vocal leap", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      // Each guitar leg is wide, but the bridge halves the direct vocal
      // leap. It is a useful playable handoff, not a disposable singleton.
      { midi: 72, start: 0.5, dur: 0.25, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 80, start: 1, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
    ], 2);
    const variants = buildVariants(source, { title: "Vocal bridge", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 72), `${level} removed useful vocal bridge`).toBe(true);
    }
  });

  it("drops a weak terminal guitar step when it worsens the vocal handoff", () => {
    const source = midi([
      { midi: 83, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 72, start: 0.5, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 70, start: 1, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      // This final, quiet step adds three semitones to the next vocal jump
      // without carrying a new lead contour, so it should not be played.
      { midi: 65, start: 1.5, dur: 0.125, vel: 48, hand: "R", identitySource: "guitar" },
      { midi: 84, start: 2, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
    ], 3);
    const variants = buildVariants(source, { title: "Terminal guitar step", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 65), `${level} kept terminal handoff step`).toBe(false);
      expect(notes.filter((note) => note.identitySource === "guitar").map((note) => note.midi)).toEqual([72, 70]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "guitar" && note.midi === 65)).toBe(true);
  });

  it("keeps a connected guitar run through a vocal bracket", () => {
    const source = midi([
      { midi: 83, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 70, start: 0.5, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 71, start: 1, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 84, start: 1.75, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
    ], 2.5);
    const variants = buildVariants(source, { title: "Connected guitar bracket", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 70), `${level} removed the guitar run entrance`).toBe(true);
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 71), `${level} removed the guitar run continuation`).toBe(true);
      expect(notes.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([83, 84]);
    }
  });

  it("keeps a descending guitar pickup even when its final handoff is wide", () => {
    const source = midi([
      { midi: 74, start: 0, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 67, start: 0.5, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
      { midi: 84, start: 1, dur: 0.5, vel: 96, hand: "R", identitySource: "vocals" },
      // Keep a later guitar attack so the cleanup pass sees the full
      // guitar-vocal-guitar neighbourhood rather than a terminal phrase.
      { midi: 75, start: 1.75, dur: 0.25, vel: 62, hand: "R", identitySource: "guitar" },
    ], 2.5);
    const variants = buildVariants(source, { title: "Descending guitar pickup", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 74), `${level} removed the pickup entrance`).toBe(true);
      expect(notes.some((note) => note.identitySource === "guitar" && note.midi === 67), `${level} removed the pickup landing`).toBe(true);
      expect(notes.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([84]);
    }
  });

  it("keeps a strong high guitar landing while smoothing quiet contour noise", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
      { midi: 79, start: 0.5, dur: 0.5, vel: 108, hand: "R", identitySource: "guitar" },
      { midi: 65, start: 1, dur: 0.5, vel: 92, hand: "R", identitySource: "guitar" },
    ], 2);
    const variants = buildVariants(source, { title: "Strong guitar landing", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "guitar" && note.start === 0.5 && note.midi === 79), `${level} removed strong guitar landing`).toBe(true);
    }
  });

  it("ties contiguous same-pitch vocal fragments without erasing real re-attacks", () => {
    const source = midi([
      { midi: 72, start: 0, dur: 0.25, vel: 72, hand: "R", identitySource: "vocals" },
      { midi: 72, start: 0.25, dur: 0.25, vel: 88, hand: "R", identitySource: "vocals" },
      { midi: 72, start: 0.5, dur: 0.25, vel: 80, hand: "R", identitySource: "vocals" },
      { midi: 74, start: 1, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
      // The gap makes this a deliberate re-attack rather than a detector
      // fragment of the preceding sustained syllable.
      { midi: 74, start: 2, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
    ], 3);
    const variants = buildVariants(source, { title: "Vocal ties", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L");
    expect(advanced.filter((note) => note.midi === 72)).toHaveLength(1);
    expect(advanced.find((note) => note.midi === 72)?.dur).toBeGreaterThanOrEqual(0.75);
    expect(advanced.filter((note) => note.midi === 74).map((note) => note.start)).toEqual([1, 2]);
  });

  it("ties a one-grid vocal fragment gap but preserves a real vocal re-attack", () => {
    const source = midi([
      { midi: 72, start: 0, dur: 0.25, vel: 72, hand: "R", identitySource: "vocals" },
      // Quantization can leave one 32nd-note grid gap between fragments of
      // the same sung syllable. At 120 BPM this is only 62.5 ms.
      { midi: 72, start: 0.375, dur: 0.25, vel: 88, hand: "R", identitySource: "vocals" },
      { midi: 74, start: 1, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
      // A half-beat silence is a real re-attack, not a detector fragment.
      { midi: 74, start: 1.75, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
    ], 3);
    const variants = buildVariants(source, { title: "Vocal gap bound", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "vocals");
    expect(advanced.filter((note) => note.midi === 72)).toHaveLength(1);
    expect(advanced.find((note) => note.midi === 72)?.dur).toBeGreaterThanOrEqual(0.625);
    expect(advanced.filter((note) => note.midi === 74).map((note) => note.start)).toEqual([1, 1.75]);
  });

  it("does not tie contiguous same-pitch guitar re-attacks in the advanced lane", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.25, vel: 84, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 0.25, dur: 0.25, vel: 88, hand: "R", identitySource: "guitar" },
    ], 2);
    const variants = buildVariants(source, { title: "Guitar re-attacks", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "guitar");
    expect(advanced.map((note) => note.start)).toEqual([0, 0.25]);
  });

  it("drops a quiet short vocal detour in learner levels but keeps Advanced detail", () => {
    const source = midi([
      { midi: 84, start: 0, dur: 0.5, vel: 100, hand: "R", identitySource: "vocals" },
      // A weak, short lower fragment between matching vocal pitches is more
      // likely a Basic Pitch contour flicker than a syllable the learner must
      // re-articulate. Advanced remains the source-detail reference.
      { midi: 81, start: 0.5, dur: 0.125, vel: 43, hand: "R", identitySource: "vocals" },
      { midi: 84, start: 0.75, dur: 0.75, vel: 57, hand: "R", identitySource: "vocals" },
    ], 2);
    const variants = buildVariants(source, { title: "Vocal contour detour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes
        .filter((note) => note.hand !== "L" && note.identitySource === "vocals");
      expect(notes.some((note) => note.midi === 81), `${level} kept quiet vocal detour`).toBe(false);
      expect(notes.filter((note) => note.midi === 84).length).toBe(2);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "vocals");
    expect(advanced.some((note) => note.midi === 81 && note.start === 0.5)).toBe(true);
  });

  it("ties same-pitch vocal fragments across interleaved guitar attacks", () => {
    const source = midi([
      { midi: 72, start: 0, dur: 0.25, vel: 72, hand: "R", identitySource: "vocals" },
      { midi: 64, start: 0.125, dur: 0.125, vel: 84, hand: "R", identitySource: "guitar" },
      { midi: 72, start: 0.25, dur: 0.25, vel: 88, hand: "R", identitySource: "vocals" },
      { midi: 74, start: 0.75, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
      { midi: 65, start: 0.875, dur: 0.125, vel: 84, hand: "R", identitySource: "guitar" },
      // A real vocal gap must remain a separate re-attack even when guitar
      // events occur between the two same-pitch notes.
      { midi: 74, start: 1.5, dur: 0.25, vel: 90, hand: "R", identitySource: "vocals" },
    ], 2);
    const variants = buildVariants(source, { title: "Interleaved vocal ties", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "vocals");
    const tied = advanced.filter((note) => note.midi === 72);
    expect(tied).toHaveLength(1);
    expect(tied[0]!.start).toBe(0);
    expect(tied[0]!.dur).toBeGreaterThanOrEqual(0.5);
    expect(advanced.filter((note) => note.midi === 74).map((note) => note.start)).toEqual([0.75, 1.5]);
  });

  it("ties overlapping repeated guitar articulations in legato learner levels", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.75, vel: 72, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 0.5, dur: 0.75, vel: 84, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 1, dur: 0.75, vel: 78, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 1.5, dur: 0.75, vel: 80, hand: "R", identitySource: "guitar" },
    ], 3);
    const variants = buildVariants(source, { title: "Guitar articulations", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.identitySource === "guitar");
    const medium = variants.find((variant) => variant.level === "medium")!.notes
      .filter((note) => note.identitySource === "guitar");
    expect(advanced).toHaveLength(4);
    expect(medium).toHaveLength(1);
    expect(medium[0]!.dur).toBeGreaterThanOrEqual(2.25);
  });

  it("ties a short guitar fragment gap but preserves a long overlapping re-attack", () => {
    const source = midi([
      { midi: 64, start: 0, dur: 0.25, vel: 72, hand: "R", identitySource: "guitar" },
      { midi: 64, start: 0.625, dur: 0.25, vel: 84, hand: "R", identitySource: "guitar" },
      { midi: 67, start: 4, dur: 4, vel: 82, hand: "R", identitySource: "guitar" },
      { midi: 67, start: 6, dur: 0.5, vel: 96, hand: "R", identitySource: "guitar" },
    ], 8);
    const variants = buildVariants(source, { title: "Guitar gap policy", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const medium = variants.find((variant) => variant.level === "medium")!.notes
      .filter((note) => note.identitySource === "guitar");
    expect(medium.filter((note) => note.midi === 64)).toHaveLength(1);
    expect(medium.find((note) => note.midi === 64)?.dur).toBeGreaterThanOrEqual(0.875);
    expect(medium.filter((note) => note.midi === 67)).toHaveLength(2);
  });

  it("keeps medium metal lead attacks on a half-beat piano floor", () => {
    const source = midi(Array.from({ length: 32 }, (_, index) => ({
      midi: 72 + (index % 5),
      start: index * 0.125,
      dur: 0.1,
      vel: 82,
      hand: "R" as const,
      identitySource: "guitar" as const,
    })), 4.5);
    const variants = buildVariants(source, { title: "Dense guitar lead", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const medium = variants.find((variant) => variant.level === "medium")!.notes
      .filter((note) => note.hand !== "L");
    const starts = medium.map((note) => note.start);
    expect(starts.length).toBeGreaterThan(1);
    for (let index = 1; index < starts.length; index++) {
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });

  it("stabilizes exact-octave vocal and guitar flicker without changing vocal anchors", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 76, start: 0, dur: 0.2, vel: 98 },
          { midi: 77, start: 1, dur: 0.2, vel: 98 },
          { midi: 79, start: 2, dur: 0.2, vel: 98 },
        ], 3) },
        { role: "guitar", midi: midi([
          { midi: 64, start: 0.25, dur: 0.15, vel: 86 },
          { midi: 76, start: 0.5, dur: 0.15, vel: 86 },
          { midi: 64, start: 0.75, dur: 0.15, vel: 86 },
          { midi: 65, start: 1.25, dur: 0.15, vel: 86 },
          { midi: 77, start: 1.5, dur: 0.15, vel: 86 },
        ], 3) },
      ],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.find((note) => note.start === 0)?.midi).toBe(76);
    expect(rh.find((note) => note.start === 1)?.midi).toBe(77);
    for (let index = 1; index < rh.length; index++) {
      if (rh[index]!.start - rh[index - 1]!.start <= 0.5) {
        expect(Math.abs(rh[index]!.midi - rh[index - 1]!.midi)).toBeLessThan(12);
      }
    }
  });

  it("folds machine-fast exact-octave flips inside a trusted vocal phrase", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi([
        { midi: 66, start: 0, dur: 0.2, vel: 98 },
        { midi: 78, start: 0.25, dur: 0.15, vel: 96 },
        { midi: 67, start: 0.5, dur: 0.2, vel: 98 },
      ], 2) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.map((note) => note.start)).toEqual([0, 0.25, 0.5]);
    expect(rh[1]?.midi).toBe(66);
    expect(rh.every((note) => note.identitySource === "vocals")).toBe(true);
  });

  it("preserves slower vocal octave contours before they become anchors", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi([
        { midi: 64, start: 0, dur: 0.4, vel: 98 },
        { midi: 76, start: 0.625, dur: 0.4, vel: 96 },
        { midi: 65, start: 1.25, dur: 0.4, vel: 98 },
      ]) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.map((note) => note.midi)).toEqual([64, 76, 65]);
  });

  it("preserves a deliberate vocal octave leap at phrase tempo", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi([
        { midi: 60, start: 0, dur: 0.6, vel: 98 },
        { midi: 72, start: 1, dur: 0.6, vel: 98 },
        { midi: 60, start: 2, dur: 0.6, vel: 98 },
      ], 3) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.map((note) => note.midi)).toEqual([60, 72, 60]);
  });

  it("keeps register smoothing active across a long sustained note", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 64, start: 0, dur: 3, vel: 92 },
        { midi: 76, start: 2.5, dur: 0.2, vel: 84 },
        { midi: 65, start: 2.75, dur: 0.2, vel: 90 },
      ], 4) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.find((note) => note.start === 2.5)?.midi).toBe(64);
    expect(Math.abs(rh[1]!.midi - rh[0]!.midi)).toBeLessThan(12);
  });

  it("does not let a vocal anchor revoice a guitar phrase after a real rest", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 80, start: 0, dur: 0.3, vel: 100 },
          { midi: 81, start: 1, dur: 0.3, vel: 100 },
          { midi: 82, start: 2, dur: 0.3, vel: 100 },
        ]) },
        { role: "guitar", midi: midi([
          { midi: 57, start: 2.8, dur: 0.3, vel: 90 },
          { midi: 69, start: 3.6, dur: 0.3, vel: 90 },
          { midi: 57, start: 4.4, dur: 0.3, vel: 90 },
        ]) },
      ],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.map((note) => note.midi)).toEqual([57, 57, 57]);
  });

  it("does not trade a raw-register step for a fast octave-up flicker", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 52, start: 0, dur: 0.3, vel: 90 },
        { midi: 45, start: 0.16, dur: 0.3, vel: 90 },
      ], 2) }],
    });
    expect(result.ir.identity.map((note) => note.midi)).toEqual([64, 57]);
  });

  it("keeps a rapid adjacent-register guitar figure from bouncing by octave", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 52, start: 0, dur: 0.3, vel: 90 },
        { midi: 45, start: 0.16, dur: 0.3, vel: 90 },
        { midi: 52, start: 0.32, dur: 0.3, vel: 90 },
      ], 2) }],
    });
    expect(result.ir.identity.map((note) => note.midi)).toEqual([64, 57, 64]);
  });

  it("keeps fused vocal-to-guitar handoffs within one piano octave", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 84, start: 0, dur: 0.5, vel: 98 },
          { midi: 82, start: 1, dur: 0.5, vel: 98 },
          { midi: 80, start: 2, dur: 0.5, vel: 98 },
        ]) },
        { role: "guitar", midi: midi([{ midi: 60, start: 1.75, dur: 0.25, vel: 90 }]) },
      ],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh.find((note) => note.start === 1.75)?.midi).toBe(72);
  });

  it("does not insert a low guitar bleed attack directly before a vocal entrance", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 84, start: 1, dur: 0.5, vel: 98 },
          { midi: 82, start: 2, dur: 0.5, vel: 98 },
          { midi: 80, start: 3, dur: 0.5, vel: 98 },
        ]) },
        { role: "guitar", midi: midi([{ midi: 59, start: 0.75, dur: 0.25, vel: 40 }]) },
      ],
    });
    const guitarBleed = result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 0.75);
    expect(guitarBleed).toBeUndefined();
  });

  it("does not insert a quiet low guitar bleed attack directly after a vocal ending", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 71, start: 1, dur: 0.5, vel: 98 },
          { midi: 73, start: 3, dur: 0.5, vel: 98 },
          { midi: 75, start: 5, dur: 0.5, vel: 98 },
        ]) },
        { role: "guitar", midi: midi([{ midi: 55, start: 2, dur: 0.25, vel: 40 }]) },
      ],
    });
    const guitarBleed = result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 2);
    expect(guitarBleed).toBeUndefined();
  });

  it("uses raw guitar pitch when rejecting re-registered bleed before vocals", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 84, start: 1, dur: 0.5, vel: 98 },
          { midi: 82, start: 2, dur: 0.5, vel: 98 },
          { midi: 80, start: 3, dur: 0.5, vel: 98 },
        ]) },
        { role: "guitar", midi: midi([
          { midi: 84, start: 0.5, dur: 0.2, vel: 86 },
          { midi: 55, start: 0.75, dur: 0.2, vel: 40 },
        ]) },
      ],
    });
    expect(result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 0.75)).toBeUndefined();
  });

  it("filters a quiet low guitar attack across a vocal section boundary", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(Array.from({ length: 8 }, (_, index) => ({
          midi: 84 - (index % 4), start: 8 + index, dur: 0.5, vel: 98,
        })), 16) },
        { role: "guitar", midi: midi([{ midi: 55, start: 7.75, dur: 0.2, vel: 40 }], 16) },
      ],
    });
    expect(result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 7.75)).toBeUndefined();
    expect(result.ir.sections[0]?.source).toBe("rest");
    const variants = buildVariants(result.parsed, { title: "Boundary bleed", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: false,
      chords: result.chords,
    });
    expect(variants).toHaveLength(6);
    expect(validateVariants(variants)).toEqual([]);
  });

  it("filters a quiet low guitar attack after a vocal section boundary", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(Array.from({ length: 8 }, (_, index) => ({
          midi: 72 + (index % 4), start: index, dur: 0.5, vel: 98,
        })), 16) },
        { role: "guitar", midi: midi([{ midi: 55, start: 8.25, dur: 0.2, vel: 40 }], 16) },
      ],
    });
    expect(result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 8.25)).toBeUndefined();
  });

  it("filters a quiet low guitar attack while a sustained vocal crosses a section boundary", () => {
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi([
          { midi: 72, start: 6, dur: 0.5, vel: 98 },
          { midi: 74, start: 7.5, dur: 2, vel: 98 },
          { midi: 76, start: 10, dur: 0.5, vel: 98 },
        ], 16) },
        { role: "guitar", midi: midi([{ midi: 55, start: 8.25, dur: 0.2, vel: 40 }], 16) },
      ],
    });
    expect(result.ir.identity.find((note) => note.identitySource === "guitar" && note.start === 8.25)).toBeUndefined();
  });

  it("retains interior vocal anchors while progressively reducing guitar filler", () => {
    const notes = Array.from({ length: 13 }, (_, index) => ({
      midi: 64 + (index % 4),
      start: index * 0.25,
      dur: 0.2,
      vel: 84,
      hand: "R" as const,
      identitySource: index === 1 || index === 5 || index === 9 ? "vocals" as const : "guitar" as const,
    }));
    notes[1]!.midi = 72;
    notes[5]!.midi = 74;
    notes[9]!.midi = 76;
    const variants = buildVariants(midi(notes, 4), { title: "Vocal anchors", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: false,
    });
    for (const level of ["medium", "easy"]) {
      const rh = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand === "R");
      for (const anchor of notes.filter((note) => note.identitySource === "vocals")) {
        expect(rh.some((note) => note.start === anchor.start && note.midi === anchor.midi)).toBe(true);
      }
    }
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

  it("keeps one-beat octave-equivalent lead travel in one piano register", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 84, start: 0, dur: 0.5, vel: 90 },
        { midi: 60, start: 0.75, dur: 0.5, vel: 90 },
      ]) }],
    });
    const rh = result.parsed.notes.filter((note) => note.hand === "R");
    expect(rh).toHaveLength(2);
    expect(rh.map((note) => note.midi)).toEqual([84, 72]);
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
