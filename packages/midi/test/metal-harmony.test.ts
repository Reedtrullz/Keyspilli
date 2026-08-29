import { describe, expect, it } from "vitest";
import { buildMetalArrangement, buildVariants, validateVariants, verifyMonotonicity, parseChordSymbol } from "../src/index.js";
import type { Note, ParsedMidi } from "../src/index.js";

function midi(notes: Note[], durationBeats = 12): ParsedMidi {
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

function harmonyStats(result: ReturnType<typeof buildMetalArrangement>): any {
  return (result.stats as any).guitarHarmony;
}

describe("semantic guitar harmony", () => {
  it("collapses octave/fifth stacks into semantic attacks and keeps the lead", () => {
    const guitar: Note[] = [];
    for (let beat = 0; beat < 8; beat += 1) {
      guitar.push(
        { midi: 48, start: beat, dur: 0.7, vel: 96 },
        { midi: 55, start: beat + 0.01, dur: 0.65, vel: 84 },
        { midi: 60, start: beat + 0.02, dur: 0.65, vel: 82 },
        { midi: 72 + (beat % 3), start: beat, dur: 0.55, vel: 104 },
      );
    }
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "bass", midi: midi([{ midi: 36, start: 0, dur: 8, vel: 100 }], 8) },
      ],
      harmonyBeats: 1,
    });
    const stats = harmonyStats(result);
    expect(stats.semanticAttackCount).toBeGreaterThan(0);
    expect(stats.onsetClusterCount).toBe(stats.semanticAttackCount);
    expect(stats.collapsedUnisonOctaveFifth).toBeGreaterThan(0);
    expect(result.ir.identity.some((note) => note.identitySource === "guitar" && note.midi >= 72)).toBe(true);
  });

  it("keeps a selected upper fifth as harmonic evidence", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 55, start: 0, dur: 1, vel: 80 },
        // The selector prefers this upper fifth as the RH lead, but the
        // semantic pass must still use it to identify the G power attack.
        { midi: 62, start: 0.01, dur: 1, vel: 120 },
      ], 2) }],
      harmonyBeats: 1,
    });
    expect(result.chords[0]?.name).toBe("G5");
    expect(harmonyStats(result).qualityCounts.power).toBeGreaterThan(0);
    expect(result.ir.identity).toEqual([
      expect.objectContaining({ midi: 62, identitySource: "guitar" }),
    ]);
    const sourceRootsAtAttack = result.parsed.notes.filter((note) => note.hand === "L" && note.start === 0 && note.midi % 12 === 7);
    expect(sourceRootsAtAttack, "semantic root should replace an octave-voiced shell, not duplicate it").toHaveLength(1);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toEqual([
      expect.objectContaining({ midi: 43, start: 0 }),
    ]);
  });

  it.each([
    ["minor", [48, 51, 55], "Cm"],
    ["major", [48, 52, 55], "C"],
    ["sus2", [48, 50, 55], "Csus2"],
    ["sus4", [48, 53, 55], "Csus4"],
  ])("infers a stable %s quality from repeated attacks", (_label, pitches, expected) => {
    const guitar = Array.from({ length: 4 }, (_, index) => pitches.map((midi) => ({ midi, start: index * 2, dur: 1.5, vel: 98 })) ).flat();
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "bass", midi: midi([{ midi: 36, start: 0, dur: 8, vel: 100 }], 8) },
      ],
      harmonyBeats: 2,
    });
    expect(result.chords[0]?.name).toBe(expected);
    expect(harmonyStats(result).qualityCounts[_label]).toBeGreaterThan(0);
  });

  it("does not let an isolated third override a repeated power attack", () => {
    const guitar = [0, 2, 4, 6].flatMap((start, index) => [
      { midi: 48, start, dur: 1.2, vel: 98 },
      { midi: 55, start: start + 0.01, dur: 1.1, vel: 94 },
      ...(index === 1 ? [{ midi: 52, start: start + 0.02, dur: 0.15, vel: 35 }] : []),
    ]);
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "bass", midi: midi([{ midi: 36, start: 0, dur: 8, vel: 100 }], 8) },
      ],
      harmonyBeats: 2,
    });
    expect(result.chords[0]?.name).toBe("C5");
    expect(harmonyStats(result).rejectedWeakThirds).toBeGreaterThan(0);
  });

  it("uses guitar evidence when bass omits the root and ignores a passing bass note", () => {
    const guitar = Array.from({ length: 4 }, (_, index) => [48, 55].map((midi) => ({ midi, start: index * 2, dur: 1.4, vel: 100 }))).flat();
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "bass", midi: midi([{ midi: 43, start: 0, dur: 0.25, vel: 110 }, { midi: 36, start: 0.5, dur: 7.5, vel: 80 }], 8) },
      ],
      harmonyBeats: 2,
    });
    expect(result.chords[0]?.name).toBe("C5");
    expect(harmonyStats(result).bassSupportedRoots).toBeGreaterThan(0);
    expect(harmonyStats(result).stabilizedTransitions).toBe(0);
  });

  it("keeps real root changes but ignores a one-attack passing root", () => {
    const stack = (root: number, fifth: number, start: number) => [
      { midi: root, start, dur: 0.8, vel: 100 },
      { midi: fifth, start: start + 0.01, dur: 0.8, vel: 96 },
    ];
    const changed = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack(48, 55, 0), ...stack(48, 55, 1),
        ...stack(43, 50, 2), ...stack(43, 50, 3),
      ], 4) }],
      harmonyBeats: 1,
    });
    expect(changed.chords.map((chord) => chord.name)).toEqual(["C5", "C5", "G5", "G5"]);

    const passing = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack(48, 55, 0), ...stack(43, 50, 1), ...stack(48, 55, 2),
      ], 3) }],
      harmonyBeats: 1,
    });
    expect(passing.chords.map((chord) => chord.name)).toEqual(["C5", "C5", "C5"]);
    expect(harmonyStats(passing).stabilizedTransitions).toBeGreaterThan(0);

    const afterPhraseBreak = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack(48, 55, 0),
        ...stack(43, 50, 4),
      ], 5) }],
      harmonyBeats: 4,
    });
    expect(afterPhraseBreak.chords.map((chord) => chord.name)).toEqual(["C5", "G5"]);
  });

  it("holds one-off third qualities but accepts repeated quality changes", () => {
    const stack = (quality: "major" | "minor", start: number) => [
      { midi: 48, start, dur: 0.8, vel: 100 },
      { midi: quality === "major" ? 52 : 51, start: start + 0.01, dur: 0.8, vel: 100 },
      { midi: 55, start: start + 0.02, dur: 0.8, vel: 96 },
    ];
    const oneOff = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack("major", 0), ...stack("minor", 1), ...stack("major", 2), ...stack("major", 3),
      ], 4) }],
      harmonyBeats: 1,
    });
    expect(oneOff.chords.slice(0, 4).map((chord) => chord.name)).toEqual(["C", "C", "C", "C"]);
    expect(harmonyStats(oneOff).qualityCounts).toMatchObject({ major: 4, minor: 0 });

    const suspensionOneOff = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack("major", 0),
        { midi: 48, start: 1, dur: 0.8, vel: 100 },
        { midi: 50, start: 1.01, dur: 0.8, vel: 100 },
        { midi: 55, start: 1.02, dur: 0.8, vel: 96 },
        ...stack("major", 2), ...stack("major", 3),
      ], 4) }],
      harmonyBeats: 1,
    });
    expect(suspensionOneOff.chords.slice(0, 4).map((chord) => chord.name)).toEqual(["C", "C", "C", "C"]);
    expect(harmonyStats(suspensionOneOff).qualityCounts).toMatchObject({ major: 4, sus2: 0 });

    const repeated = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        ...stack("major", 0), ...stack("minor", 1), ...stack("minor", 2), ...stack("major", 3), ...stack("major", 4),
      ], 5) }],
      harmonyBeats: 1,
    });
    expect(repeated.chords.slice(0, 5).map((chord) => chord.name)).toEqual(["C", "Cm", "Cm", "C", "C"]);
    expect(harmonyStats(repeated).qualityCounts).toMatchObject({ major: 3, minor: 2 });
    expect(harmonyStats(oneOff).stabilizedTransitions).toBeGreaterThan(0);
  });

  it("preserves single and unknown semantic qualities without invalid labels", () => {
    const unison = [0, 2].flatMap((start) => [48, 60].map((midi) => ({ midi, start, dur: 0.8, vel: 96 })));
    const single = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi(unison, 4) }],
      harmonyBeats: 2,
    });
    expect(single.chords[0]?.name).toBe("C");
    expect(single.chords[0]?.notes).toEqual([36]);
    expect(parseChordSymbol(single.chords[0]!.name).quality).toBe("major");
    expect(harmonyStats(single).qualityCounts.single).toBeGreaterThan(0);

    const ambiguous = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 48, start: 0, dur: 0.8, vel: 96 },
        { midi: 54, start: 0.01, dur: 0.8, vel: 96 },
      ], 2) }],
      harmonyBeats: 2,
    });
    expect(ambiguous.chords[0]?.name).toBe("C5");
    expect(harmonyStats(ambiguous).qualityCounts.unknown).toBeGreaterThan(0);
  });

  it("does not turn an unrelated tritone singleton into an LH root", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 48, start: 0, dur: 0.8, vel: 96 },
        { midi: 66, start: 0.02, dur: 0.8, vel: 96 },
      ], 2) }],
      harmonyBeats: 1,
    });
    expect(harmonyStats(result).semanticAttackCount).toBe(0);
    expect(harmonyStats(result).emittedLeftHandEvents).toBe(0);
  });

  it("rejects conflicting thirds and lets compatible bass evidence fill a missing root", () => {
    const conflicting = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 48, start: 0, dur: 0.8, vel: 96 },
        { midi: 51, start: 0.01, dur: 0.8, vel: 96 },
        { midi: 52, start: 0.02, dur: 0.8, vel: 96 },
        { midi: 55, start: 0.03, dur: 0.8, vel: 96 },
      ], 2) }],
      harmonyBeats: 1,
    });
    expect(conflicting.chords[0]?.name).toBe("C5");
    expect(harmonyStats(conflicting).qualityCounts.unknown).toBeGreaterThan(0);
    expect(harmonyStats(conflicting).rejectedWeakThirds).toBeGreaterThan(0);

    // The guitar supplies E/G but omits C. A sustained bass C may complete
    // the major chord, but it must not be treated as an unconditional root
    // override when the guitar says something else.
    const missingRoot = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi([
          { midi: 52, start: 0, dur: 1, vel: 100 },
          { midi: 55, start: 0.01, dur: 1, vel: 100 },
        ], 2) },
        { role: "bass", midi: midi([{ midi: 36, start: 0, dur: 2, vel: 100 }], 2) },
      ],
      harmonyBeats: 1,
    });
    expect(missingRoot.chords[0]?.name).toBe("C");
    expect(harmonyStats(missingRoot).bassSupportedRoots).toBeGreaterThan(0);
    expect(missingRoot.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar"))
      .toHaveLength(1);
  });

  it("clusters jittered stack attacks and counts only harmonic duplicates", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 48, start: 0, dur: 0.7, vel: 100 },
        { midi: 55, start: 0.04, dur: 0.7, vel: 90 },
        { midi: 60, start: 0.07, dur: 0.7, vel: 88 },
        { midi: 48, start: 0.2, dur: 0.7, vel: 100 },
        { midi: 55, start: 0.24, dur: 0.7, vel: 90 },
      ], 3) }],
      harmonyBeats: 1,
    });
    const stats = harmonyStats(result);
    expect(stats.onsetClusterCount).toBe(2);
    expect(stats.semanticAttackCount).toBe(2);
    expect(stats.collapsedUnisonOctaveFifth).toBe(3);
    expect(stats.emittedLeftHandEvents).toBe(2);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar" && note.midi % 12 === 0))
      .toHaveLength(2);
  });

  it("uses strict residual harmony fallback only for a coherent other lane", () => {
    const coherent = [64, 65, 67, 69, 67, 65].flatMap((midi, index) => [
      { midi, start: index, dur: 0.5, vel: 84 },
      { midi: midi - 12, start: index + 0.01, dur: 0.5, vel: 80 },
    ]);
    const result = buildMetalArrangement({
      stems: [{ role: "other", midi: midi(coherent, 8) }],
      harmonyBeats: 2,
    });
    expect(result.ir.identity.every((note) => note.identitySource !== "guitar")).toBe(true);
    expect(harmonyStats(result).fallbackWindows).toBeGreaterThan(0);
    expect(harmonyStats(result).semanticAttackCount).toBeGreaterThan(0);
    expect(harmonyStats(result).qualityCounts.single).toBeGreaterThan(0);

    const wall = buildMetalArrangement({
      stems: [{ role: "other", midi: midi(Array.from({ length: 16 }, (_, index) => ({ midi: 57, start: index * 0.5, dur: 0.25, vel: 118 })), 8) }],
    });
    expect(harmonyStats(wall).source).toBeUndefined();
    expect(harmonyStats(wall).fallbackWindows).toBeGreaterThan(0);
    expect(harmonyStats(wall).semanticAttackCount).toBe(0);
  });

  it("keeps semantic LH roots deduped and variants structurally valid", () => {
    const guitar = Array.from({ length: 8 }, (_, index) => [48, 55, 60, 72].map((midi, offset) => ({
      midi: midi + (offset === 3 ? index % 2 : 0),
      start: index,
      dur: 0.6,
      vel: 92 - offset * 3,
    }))).flat();
    const vocals = [79, 81, 79, 81].map((midi, index) => ({ midi, start: index * 2, dur: 0.4, vel: 104 }));
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "drums", midi: midi([{ midi: 35, start: 0, dur: 0.1, vel: 127 }], 8) },
      ],
      harmonyBeats: 2,
    });
    const variants = buildVariants(result.parsed, { title: "semantic", artist: "fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
      chords: result.chords,
    });
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
    const sourceLH = result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar");
    expect(harmonyStats(result).emittedLeftHandEvents).toBeLessThanOrEqual(sourceLH.length);
    expect(result.parsed.notes.some((note) => note.midi === 35)).toBe(false);
    expect(result.ir.identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual(vocals.map((note) => note.midi));
  });

  it("is deterministic and never promotes drum pitches", () => {
    const stems = [
      { role: "guitar" as const, midi: midi([{ midi: 48, start: 0, dur: 1, vel: 90 }, { midi: 55, start: 0.01, dur: 1, vel: 80 }]) },
      { role: "drums" as const, midi: midi([{ midi: 35, start: 0, dur: 0.1, vel: 127 }]) },
    ];
    const first = buildMetalArrangement({ stems });
    const second = buildMetalArrangement({
      stems: stems
        .map((stem) => ({ ...stem, midi: { ...stem.midi, notes: [...stem.midi.notes].reverse() } }))
        .reverse(),
    });
    expect(harmonyStats(first)).toEqual(harmonyStats(second));
    expect(first.parsed.notes.some((note) => note.midi === 35)).toBe(false);
  });
});
