import { describe, expect, it } from "vitest";
import { buildMetalArrangement, buildVariants, parseChordSymbol, selectGuitarLeadPath, validateVariants, verifyMonotonicity } from "../src/index.js";
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

  it("routes wide alternating low roots before they octave-fold into RH", () => {
    const lowPulse = Array.from({ length: 20 }, (_, index) => ({
      // Detector partials can alternate by a full octave, so these notes do
      // not form one fixed-pitch run even though they are one rhythm wall.
      midi: index % 2 === 0 ? 50 : 60,
      start: index * 0.5,
      dur: 0.25,
      vel: index % 4 === 0 ? 84 : 72,
    }));
    const highLead = Array.from({ length: 10 }, (_, index) => ({
      midi: 72 + (index % 4),
      start: index,
      dur: 0.5,
      vel: 92,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowPulse, ...highLead], 10) }],
    });
    const guitarRh = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitarRh.every((note) => note.midi >= 72), "wide low rhythm wall leaked into RH").toBe(true);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar").length).toBeGreaterThanOrEqual(10);
  });

  it("uses residual upper evidence to keep a melody while moving dense guitar rhythm to LH", () => {
    const lowGuitarWall = Array.from({ length: 24 }, (_, index) => ({
      midi: index % 2 === 0 ? 45 : 52,
      start: index * 0.5,
      dur: 0.25,
      vel: 76,
    }));
    const residualLead = Array.from({ length: 12 }, (_, index) => ({
      midi: [72, 74, 76, 77, 76, 74][index % 6]!,
      start: index,
      dur: 0.6,
      vel: 88,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(lowGuitarWall, 12) },
        { role: "other", midi: midi(residualLead, 12) },
      ],
    });

    const identity = result.ir.identity;
    expect(identity.filter((note) => note.identitySource === "other").length).toBeGreaterThanOrEqual(8);
    expect(identity.some((note) => note.identitySource === "other" && note.midi >= 72)).toBe(true);
    expect(identity.filter((note) => note.identitySource === "guitar" && note.midi <= 62)).toHaveLength(0);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar").length).toBeGreaterThanOrEqual(8);
  });

  it("prefers a coherent residual lead over a denser zig-zag guitar stem", () => {
    const noisyGuitar = Array.from({ length: 32 }, (_, index) => ({
      midi: [72, 84, 63, 81, 66, 87, 64, 82][index % 8]!,
      start: index * 0.25,
      dur: 0.12,
      vel: 58,
    }));
    const coherentOther = Array.from({ length: 12 }, (_, index) => ({
      midi: [72, 74, 76, 77, 76, 74][index % 6]!,
      start: index * 0.75,
      dur: 0.55,
      vel: 92,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(noisyGuitar, 10) },
        { role: "other", midi: midi(coherentOther, 10) },
      ],
    });
    const identity = result.ir.identity.filter((note) => note.identitySource !== "vocals");
    const other = identity.filter((note) => note.identitySource === "other");
    const guitar = identity.filter((note) => note.identitySource === "guitar");
    expect(other.length).toBeGreaterThanOrEqual(8);
    expect(guitar.filter((note) => note.midi < 68).length).toBe(0);
    expect(guitar.length).toBeLessThan(other.length);
    expect(other.map((note) => note.midi).slice(0, 6)).toEqual([72, 74, 76, 77, 76, 74]);
  });

  it("does not mistake a repeated upper guitar wall for the lead when residual contour is coherent", () => {
    const guitarWall = Array.from({ length: 16 }, (_, index) => ({
      midi: 64,
      start: index * 0.5,
      dur: 0.25,
      vel: 60,
    }));
    const residualLead = [64, 65, 67, 69, 67, 65, 64, 62].map((midi, index) => ({
      midi,
      start: index,
      dur: 0.5,
      vel: 64,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 8,
      stems: [
        { role: "guitar", midi: midi(guitarWall, 8) },
        { role: "other", midi: midi(residualLead, 8) },
      ],
    });
    const identity = result.ir.identity.filter((note) => note.start < 8);
    expect(identity.filter((note) => note.identitySource === "other").map((note) => note.midi))
      .toEqual(residualLead.map((note) => note.midi));
    expect(identity.some((note) => note.identitySource === "guitar"), "repeated guitar wall won the RH lane")
      .toBe(false);
  });

  it("lets a coherent residual contour beat a guitar wall inside vocal rests", () => {
    const vocals = [0, 2, 4, 6].map((start, index) => ({
      midi: 76 + (index % 2),
      start,
      dur: 0.25,
      vel: 110,
    }));
    const guitarWall = Array.from({ length: 16 }, (_, index) => ({
      midi: 64,
      start: 0.5 + index * 0.5,
      dur: 0.25,
      vel: 118,
    }));
    const residualLead = [64, 65, 67, 69, 67, 65, 64, 62].map((midi, index) => ({
      midi,
      start: 0.5 + index,
      dur: 0.5,
      vel: 64,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 8,
      stems: [
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "guitar", midi: midi(guitarWall, 8) },
        { role: "other", midi: midi(residualLead, 8) },
      ],
    });
    const identity = result.ir.identity.filter((note) => note.start < 8);
    expect(identity.filter((note) => note.identitySource === "other").map((note) => note.midi))
      .toEqual(residualLead.map((note) => note.midi));
    expect(identity.filter((note) => note.identitySource === "guitar"), "guitar wall won a vocal rest")
      .toHaveLength(0);
    expect(identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi))
      .toEqual(vocals.map((note) => note.midi));
  });

  it("keeps one coherent instrumental lane through vocal rests", () => {
    const vocals: Note[] = [
      { midi: 79, start: 0, dur: 0.35, vel: 100 },
      { midi: 81, start: 2, dur: 0.35, vel: 100 },
      { midi: 79, start: 4, dur: 0.35, vel: 100 },
    ];
    const guitar = [72, 74, 76, 75, 73, 72].map((midi, index) => ({
      midi,
      start: 0.75 + index * 0.5,
      dur: 0.35,
      vel: 86,
    }));
    // Residual separation can contain many upper chord partials. They are
    // evidence, but should not be interleaved into every vocal rest when a
    // connected guitar lead is already available for that phrase.
    const residualOther = Array.from({ length: 24 }, (_, index) => ({
      midi: [67, 76, 81, 72][index % 4]!,
      start: 0.5 + index * 0.125,
      dur: 0.1,
      vel: 54,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "other", midi: midi(residualOther, 8) },
      ],
    });
    const section = result.ir.identity.filter((note) => note.start >= 0.5 && note.start < 4);
    expect(section.some((note) => note.identitySource === "guitar")).toBe(true);
    expect(section.some((note) => note.identitySource === "other")).toBe(false);
    expect(result.ir.identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([79, 81, 79]);
  });

  it("does not reintroduce residual spikes when a sparse guitar lane owns the section", () => {
    const guitar: Note[] = [
      { midi: 72, start: 1, dur: 0.4, vel: 90 },
      { midi: 74, start: 3, dur: 0.4, vel: 90 },
      { midi: 76, start: 5, dur: 0.4, vel: 90 },
    ];
    // Residual/full-mix chatter is dense and high, but it is not a second
    // authored melody. The selected guitar lane must remain the only
    // instrumental source used by sparse top-line recovery.
    const residual = Array.from({ length: 32 }, (_, index) => ({
      midi: index % 2 ? 64 : 84,
      start: 0.5 + index * 0.25,
      dur: 0.08,
      vel: 52,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 16,
      stems: [
        { role: "guitar", midi: midi(guitar, 16) },
        { role: "other", midi: midi(residual, 16) },
      ],
    });
    const identity = result.ir.identity;
    expect(identity.filter((note) => note.identitySource === "other"), "residual lane leaked into sparse inference").toHaveLength(0);
    expect(identity.filter((note) => note.identitySource === "guitar").length).toBeGreaterThanOrEqual(3);
  });

  it("decodes a dense residual lane into a stepwise upper contour", () => {
    const lead = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69, 71, 69, 67, 65];
    const residual: Note[] = [];
    for (let index = 0; index < lead.length; index++) {
      const start = index * 0.5;
      residual.push({ midi: lead[index]!, start, dur: 0.42, vel: 66 });
      // This is the kind of residual chord partial that currently wins an
      // otherwise empty onset and makes the generated RH sound like scattered
      // detector hits rather than a playable line.
      residual.push({ midi: index % 2 ? 81 : 76, start: start + 0.18, dur: 0.08, vel: 44 });
      residual.push({ midi: index % 3 ? 74 : 79, start: start + 0.31, dur: 0.07, vel: 42 });
    }
    const lowWall = Array.from({ length: 24 }, (_, index) => ({
      midi: 57,
      start: index * 0.25,
      dur: 0.12,
      vel: 82,
    }));
    const result = buildMetalArrangement({
      stems: [
        { role: "guitar", midi: midi(lowWall, 8) },
        { role: "other", midi: midi(residual, 8) },
      ],
    });
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    expect(other.length, "residual chord partials were promoted as melody").toBeLessThanOrEqual(18);
    expect(other.map((note) => note.midi).filter((pitch) => pitch === 76 || pitch === 81 || pitch === 79)).toHaveLength(0);
    expect(other.map((note) => note.midi).slice(0, 4)).toEqual(lead.slice(0, 4));
    expect(other.map((note) => note.midi).every((pitch) => lead.includes(pitch))).toBe(true);
    expect(other.map((note) => note.midi).filter((pitch) => pitch >= 62 && pitch <= 71).length).toBeGreaterThanOrEqual(12);
  });

  it("keeps a medium-density residual contour on a playable beat floor", () => {
    const pitches = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69, 71, 69, 67, 65, 64, 65, 67, 69];
    const residual = pitches.map((midi, index) => ({
      midi,
      start: index * 0.6,
      dur: 0.35,
      vel: 70,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 16,
      stems: [{ role: "other", midi: midi(residual, 16) }],
    });
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const gaps = other.slice(1).map((note, index) => note.start - other[index]!.start);
    expect(other.length).toBeGreaterThanOrEqual(8);
    expect(Math.min(...gaps), "residual fallback kept sub-beat chatter").toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it("regularizes fragmented residual phrases across detector gaps", () => {
    const residual: Note[] = [
      { midi: 64, start: 0, dur: 0.45, vel: 72 },
      { midi: 65, start: 0.5, dur: 0.45, vel: 70 },
      // A detector gap can split what is still one residual phrase. The
      // learner path should not preserve a fast pair on either side of that
      // bookkeeping gap when a beat-level contour is available.
      { midi: 67, start: 2.25, dur: 0.45, vel: 72 },
      { midi: 69, start: 2.75, dur: 0.45, vel: 70 },
      { midi: 67, start: 4.5, dur: 0.45, vel: 72 },
      { midi: 65, start: 5, dur: 0.45, vel: 70 },
    ];
    const result = buildMetalArrangement({
      sectionBeats: 8,
      stems: [{ role: "other", midi: midi(residual, 8) }],
    });
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const gaps = other.slice(1).map((note, index) => note.start - other[index]!.start);
    expect(other.length, "fragmented residual chatter was retained").toBeLessThanOrEqual(4);
    expect(Math.min(...gaps), "fragmented residual phrase kept a sub-beat pair").toBeGreaterThanOrEqual(1 - 1e-6);
    expect(other.map((note) => note.midi)).toEqual([64, 69, 65]);
  });

  it("regularizes a sparse residual phrase onto supported beat positions", () => {
    const lead = [64, 64, 62, 62, 64, 64, 64, 64, 65, 65, 64, 64, 62, 62, 62, 62];
    const offsets = [0.06, -0.18, 0.11, -0.07, 0.2, -0.16, 0.09, -0.22, 0.12, -0.08, 0.17, -0.14, 0.05, -0.19, 0.13, -0.06];
    const residual: Note[] = [];
    for (let index = 0; index < lead.length; index++) {
      const start = index + offsets[index]!;
      residual.push({ midi: lead[index]!, start, dur: 0.35, vel: 62 });
      // Dense residual chord partials should not become the melody merely
      // because they are a little louder or happen between beat attacks.
      residual.push({ midi: [78, 81, 74, 79][index % 4]!, start: start + 0.12, dur: 0.08, vel: 44 });
      residual.push({ midi: [76, 80, 77][index % 3]!, start: start + 0.31, dur: 0.07, vel: 43 });
    }
    const result = buildMetalArrangement({
      sectionBeats: 32,
      stems: [{ role: "other", midi: midi(residual, 20) }],
    });
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const gaps = other.slice(1).map((note, index) => note.start - other[index]!.start);
    expect(other.length).toBeGreaterThanOrEqual(12);
    expect(other.length).toBeLessThanOrEqual(18);
    expect(Math.min(...gaps), "residual beat phrase kept detector chatter").toBeGreaterThanOrEqual(0.55 - 1e-6);
    expect(other.every((note) => lead.includes(note.midi)), "residual chord partial became melody").toBe(true);

    const variants = buildVariants(
      result.parsed,
      { title: "residual coverage", artist: "Fixture", tempo: 120, key: "C" },
      { arrangementProfile: "metal", chords: result.chords },
    );
    for (const level of ["easy", "medium"] as const) {
      const melody = variants.find((variant) => variant.level === level)!.notes
        .filter((note) => note.hand === "R" && note.identitySource === "other")
        .sort((a, b) => a.start - b.start);
      const variantGaps = melody.slice(1).map((note, index) => note.start - melody[index]!.start);
      expect(melody.length, `${level} discarded the supported residual coverage`).toBeGreaterThanOrEqual(12);
      expect(Math.min(...variantGaps), `${level} reintroduced residual chatter`).toBeGreaterThanOrEqual(0.55 - 1e-6);
    }
  });

  it("regularizes a moderately dense opening residual phrase without promoting partials", () => {
    const lead = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69, 71, 69, 67, 65];
    const makeResidual = (offset: number): Note[] => lead.flatMap((pitch, index) => {
      const start = offset + index * 0.72;
      return [
        { midi: pitch, start, dur: 0.35, vel: 62 },
        // Same-onset detector partials are intentionally short and quiet.
        { midi: [78, 81, 74, 79][index % 4]!, start: start + 0.12, dur: 0.08, vel: 44 },
        { midi: [76, 80, 77][index % 3]!, start: start + 0.31, dur: 0.07, vel: 43 },
      ];
    });
    const build = (offset: number) => buildMetalArrangement({
      sectionBeats: 32,
      stems: [{ role: "other", midi: midi(makeResidual(offset), offset + 32) }],
    });
    const result = build(0);
    const shifted = build(16);
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const shiftedOther = shifted.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const gaps = other.slice(1).map((note, index) => note.start - other[index]!.start);
    expect(other.length, "moderately dense residual phrase was not recovered").toBeLessThanOrEqual(14);
    expect(other.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...gaps), "residual opening kept detector partial chatter").toBeGreaterThanOrEqual(0.55 - 1e-6);
    expect(other.every((note) => lead.includes(note.midi)), "residual partial became the melody").toBe(true);
    expect(shiftedOther.map((note) => ({ start: Number((note.start - 16).toFixed(6)), midi: note.midi })))
      .toEqual(other.map((note) => ({ start: Number(note.start.toFixed(6)), midi: note.midi })));
  });

  it("keeps jittered residual opening attacks off a sub-half-beat floor", () => {
    const lead = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69, 71, 69, 67, 65];
    const starts = [0.119, 1.538, 1.969, 2.381, 3.264, 4.426, 5.549, 6.966, 7.627, 8.936, 9.326, 10.515, 11.747, 12.982, 13.314, 13.706];
    const residual = starts.flatMap((start, index) => [
      { midi: lead[index]!, start, dur: 0.35, vel: 62 },
      { midi: [78, 81, 74, 79][index % 4]!, start: start + 0.12, dur: 0.08, vel: 44 },
      { midi: [76, 80, 77][index % 3]!, start: start + 0.31, dur: 0.07, vel: 43 },
    ]);
    const result = buildMetalArrangement({
      sectionBeats: 32,
      stems: [{ role: "other", midi: midi(residual, 24) }],
    });
    const other = result.ir.identity
      .filter((note) => note.identitySource === "other")
      .sort((a, b) => a.start - b.start);
    const gaps = other.slice(1).map((note, index) => note.start - other[index]!.start);
    expect(Math.min(...gaps), "jittered residual decoder kept a sub-half-beat attack pair")
      .toBeGreaterThanOrEqual(0.55 - 1e-6);
    expect(other.every((note) => lead.includes(note.midi)), "jittered residual partial became melody").toBe(true);
  });

  it("preserves the residual role when no dedicated guitar stem exists", () => {
    const lead = [64, 65, 67, 69, 67, 65, 64, 62, 64, 65, 67, 69].map((midi, index) => ({
      midi,
      start: index * 0.5,
      dur: 0.42,
      vel: 72,
    }));
    const lowWall = Array.from({ length: 24 }, (_, index) => ({
      midi: 57,
      start: index * 0.25,
      dur: 0.12,
      vel: 82,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "other", midi: midi([...lowWall, ...lead], 8) }],
    });

    const identity = result.ir.identity;
    expect(identity.some((note) => note.identitySource === "other" && note.midi >= 62)).toBe(true);
    expect(identity.some((note) => note.identitySource === "guitar"), "residual-only input was aliased to guitar").toBe(false);
    expect(identity.some((note) => note.identitySource === "other" && note.midi <= 60), "raw low residual wall leaked into RH").toBe(false);
    expect(result.parsed.notes.some((note) => note.hand === "L" && note.identitySource === "other"), "residual low wall was not retained as LH accompaniment").toBe(true);
  });

  it("keeps a residual-only low wall in LH instead of promoting it into RH", () => {
    const lowWall = Array.from({ length: 16 }, (_, index) => ({
      midi: 57,
      start: index * 0.5,
      dur: 0.25,
      vel: 118,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "other", midi: midi(lowWall, 8) }],
    });

    expect(result.ir.identity.filter((note) => note.identitySource === "other")).toHaveLength(0);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "other").length).toBeGreaterThanOrEqual(8);
  });

  it("uses the residual decoder when a routing-compatible guitar role came from other", () => {
    const lead = [64, 65, 67, 69, 67, 65, 64, 62].map((midi, index) => ({
      midi,
      start: index * 0.5,
      dur: 0.42,
      vel: 72,
    }));
    const lowWall = Array.from({ length: 16 }, (_, index) => ({
      midi: 57,
      start: index * 0.25,
      dur: 0.12,
      vel: 82,
    }));
    const routingCompatibleResidual = {
      role: "guitar" as const,
      sourceStem: "other" as const,
      midi: midi([...lowWall, ...lead], 8),
    };
    const result = buildMetalArrangement({ stems: [routingCompatibleResidual] });

    const identity = result.ir.identity;
    expect(identity.some((note) => note.identitySource === "other" && note.midi >= 62)).toBe(true);
    expect(identity.some((note) => note.identitySource === "guitar"), "other provenance was treated as guitar").toBe(false);
    expect(identity.some((note) => note.identitySource === "other" && note.midi <= 60), "raw low residual wall leaked into RH").toBe(false);
  });

  it("keeps a coherent residual opening contour before upper evidence appears", () => {
    const opening = [55, 57, 59, 60].map((midi, index) => ({
      midi,
      start: index,
      dur: 0.4,
      vel: 80,
    }));
    const laterUpper = [72, 74, 76, 77].map((midi, index) => ({
      midi,
      start: 8 + index,
      dur: 0.4,
      vel: 80,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "other", midi: midi([...opening, ...laterUpper], 12) }],
    });

    const openingIdentity = result.ir.identity
      .filter((note) => note.identitySource === "other" && note.start < 4)
      .sort((a, b) => a.start - b.start);
    expect(openingIdentity.map((note) => note.midi), "residual opening contour was dropped before upper evidence").toEqual(opening.map((note) => note.midi));
  });

  it("carries a coherent guitar phrase across vocal gaps and section seams", () => {
    const vocals = [0, 2, 4, 6].map((start, index) => ({
      midi: 76 + (index % 2),
      start,
      dur: 0.35,
      vel: 104,
    }));
    const guitarPitches = [72, 74, 75, 74, 72, 74, 75, 74];
    const guitar = guitarPitches.map((midi, index) => ({
      midi,
      start: 0.75 + index * 0.75,
      dur: 0.35,
      vel: 84,
    }));
    // The residual lane is intentionally denser and louder in the middle
    // gap. A phrase-level source carry should keep the connected guitar line
    // rather than flipping to `other` for one vocal rest or at beat 4.
    const residual = Array.from({ length: 12 }, (_, index) => ({
      midi: [84, 82, 86, 81][index % 4]!,
      start: 2.5 + index * 0.125,
      dur: 0.18,
      vel: 112,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 4,
      stems: [
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "other", midi: midi(residual, 8) },
      ],
    });
    const instrumental = result.ir.identity
      .filter((note) => note.start >= 0.5 && note.start < 8 && note.identitySource !== "vocals")
      .sort((a, b) => a.start - b.start);
    expect(instrumental.some((note) => note.identitySource === "guitar")).toBe(true);
    expect(instrumental.some((note) => note.identitySource === "other"), "source flipped to residual lane inside the guitar phrase").toBe(false);
    expect(result.ir.identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi)).toEqual([76, 77, 76, 77]);
  });

  it("does not carry a repeated guitar wall over a residual lead at a section seam", () => {
    const guitarWall = Array.from({ length: 16 }, (_, index) => ({
      midi: 64,
      start: index * 0.5,
      dur: 0.25,
      vel: 70,
    }));
    const residualLead = [72, 74, 76, 77].map((midi, index) => ({
      midi,
      start: 4 + index,
      dur: 0.5,
      vel: 80,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 4,
      stems: [
        { role: "guitar", midi: midi(guitarWall, 8) },
        { role: "other", midi: midi(residualLead, 8) },
      ],
    });

    const secondSection = result.ir.identity
      .filter((note) => note.start >= 4 && note.start < 8)
      .sort((a, b) => a.start - b.start);
    expect(secondSection.filter((note) => note.identitySource === "other").map((note) => note.midi))
      .toEqual(residualLead.map((note) => note.midi));
    expect(secondSection.some((note) => note.identitySource === "guitar"), "the carried guitar wall overrode the residual lane")
      .toBe(false);
  });

  it("does not carry a guitar wall through vocal rests at a section seam", () => {
    const vocals = [
      { midi: 79, start: 0, dur: 0.35, vel: 110 },
      { midi: 81, start: 2, dur: 0.35, vel: 110 },
      { midi: 79, start: 4, dur: 0.35, vel: 110 },
    ];
    const guitar = [
      { midi: 72, start: 0.75, dur: 0.35, vel: 90 },
      { midi: 74, start: 1.5, dur: 0.35, vel: 90 },
      { midi: 76, start: 2.25, dur: 0.35, vel: 90 },
      { midi: 75, start: 3, dur: 0.35, vel: 90 },
      ...Array.from({ length: 8 }, (_, index) => ({
        midi: 64,
        start: 4 + index * 0.5,
        dur: 0.25,
        vel: 118,
      })),
    ];
    const residualLead = [72, 74, 76, 77].map((midi, index) => ({
      midi,
      start: 4 + index,
      dur: 0.5,
      vel: 80,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 4,
      stems: [
        { role: "vocals", midi: midi(vocals, 8) },
        { role: "guitar", midi: midi(guitar, 8) },
        { role: "other", midi: midi(residualLead, 8) },
      ],
    });

    const secondSection = result.ir.identity
      .filter((note) => note.start >= 4 && note.start < 8)
      .sort((a, b) => a.start - b.start);
    // The first residual attack shares the vocal's onset and is intentionally
    // occupied by that hard vocal anchor; the remaining contour must still
    // beat the carried guitar wall.
    expect(secondSection.filter((note) => note.identitySource === "other").map((note) => note.midi))
      .toEqual(residualLead.filter((note) => note.start > 4).map((note) => note.midi));
    expect(secondSection.filter((note) => note.identitySource === "guitar"), "the carried guitar wall overrode a vocal-rest lane")
      .toHaveLength(0);
    expect(result.ir.identity.filter((note) => note.identitySource === "vocals").map((note) => note.midi))
      .toEqual(vocals.map((note) => note.midi));
  });

  it("does not let an isolated residual upper spike route a low guitar contour into LH", () => {
    const guitarContour = [50, 52, 54, 52, 50, 52].map((midi, index) => ({
      midi,
      start: index,
      dur: 0.4,
      vel: 90,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 8,
      stems: [
        { role: "guitar", midi: midi(guitarContour, 8) },
        // This spike is intentionally too weak/short to become residual
        // melody evidence, but it must not be used as guitar context.
        { role: "other", midi: midi([{ midi: 72, start: 0, dur: 0.05, vel: 30 }], 8) },
      ],
    });

    const guitarIdentity = result.ir.identity
      .filter((note) => note.identitySource === "guitar")
      .sort((a, b) => a.start - b.start);
    expect(guitarIdentity.map((note) => note.start)).toEqual(guitarContour.map((note) => note.start));
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toHaveLength(0);

    const sameStemSpikeResult = buildMetalArrangement({
      sectionBeats: 8,
      stems: [{
        role: "guitar",
        midi: midi([
          ...guitarContour,
          { midi: 72, start: 0, dur: 0.05, vel: 30 },
        ], 8),
      }],
    });
    expect(
      sameStemSpikeResult.ir.identity
        .filter((note) => note.identitySource === "guitar")
        .sort((a, b) => a.start - b.start)
        .map((note) => note.start),
      "an unsupported same-source spike altered low-contour routing",
    ).toEqual(guitarContour.map((note) => note.start));
    expect(sameStemSpikeResult.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toHaveLength(0);
  });

  it("does not route a moving raw-low contour because of unrelated upper evidence", () => {
    const contour = [50, 52, 54, 52, 50, 52].map((midi, index) => ({
      midi,
      start: index,
      dur: 0.4,
      vel: 90,
    }));
    const result = buildMetalArrangement({
      sectionBeats: 12,
      stems: [{
        role: "guitar",
        midi: midi([
          ...contour,
          // Supported, but not co-onset: this must not classify the
          // preceding moving low contour as accompaniment.
          { midi: 72, start: 8, dur: 0.5, vel: 90 },
        ], 10),
      }],
    });
    const guitarIdentity = result.ir.identity
      .filter((note) => note.identitySource === "guitar")
      .sort((a, b) => a.start - b.start);
    expect(guitarIdentity.map((note) => note.start)).toEqual([
      ...contour.map((note) => note.start),
      8,
    ]);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar"))
      .toHaveLength(0);
  });

  it("uses contour continuity when a polyphonic onset offers a quiet step and a loud distant spike", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 72, start: 0, dur: 0.5, vel: 92 },
        { midi: 84, start: 0.5, dur: 0.5, vel: 120 },
        { midi: 74, start: 0.5, dur: 0.5, vel: 58 },
        { midi: 76, start: 1, dur: 0.5, vel: 92 },
      ], 3) }],
    });
    const guitar = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(guitar.map((note) => note.midi)).toEqual([72, 74, 76]);
  });

  it("recovers a sparse upper line from repeated quiet harmonic evidence without inventing notes", () => {
    const lowRhythm = Array.from({ length: 12 }, (_, index) => ({
      midi: 45,
      start: index,
      dur: 0.35,
      vel: 118,
    }));
    const quietUpper = Array.from({ length: 12 }, (_, index) => ({
      midi: [64, 65, 67, 65][index % 4]!,
      start: index + 0.02,
      dur: 0.45,
      vel: 32,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowRhythm, ...quietUpper], 12) }],
    });
    const identity = result.ir.identity.filter((note) => note.identitySource === "guitar");
    const upper = identity.filter((note) => note.midi >= 64);
    expect(upper.length, "quiet repeated upper evidence was discarded before identity selection").toBeGreaterThanOrEqual(6);
    expect(identity.filter((note) => note.midi <= 54), "low rhythm wall leaked into RH").toHaveLength(0);
    expect(result.parsed.notes.some((note) => note.hand === "L" && note.identitySource === "guitar" && note.midi <= 54)).toBe(true);
  });

  it("does not fill a low-only phrase when no upper harmonic evidence exists", () => {
    const lowOnly = Array.from({ length: 12 }, (_, index) => ({
      midi: index % 2 ? 45 : 52,
      start: index * 0.5,
      dur: 0.25,
      vel: 118,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi(lowOnly, 6) }],
    });
    const identity = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(identity.length).toBeGreaterThan(0);
    expect(identity.every((note) => note.midi < 64), "low-only evidence must not be promoted into an invented upper melody").toBe(true);
    expect(result.warnings.some((warning) => warning.includes("upper harmonic evidence"))).toBe(false);
  });

  it("does not promote one isolated quiet upper spike into a melody", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 45, start: 0, dur: 0.25, vel: 112 },
        { midi: 45, start: 1, dur: 0.25, vel: 112 },
        { midi: 78, start: 1.02, dur: 0.08, vel: 28 },
        { midi: 45, start: 2, dur: 0.25, vel: 112 },
        { midi: 45, start: 3, dur: 0.25, vel: 112 },
      ], 4) }],
    });
    expect(result.ir.identity.some((note) => note.midi >= 64)).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("upper harmonic evidence"))).toBe(false);
  });

  it("keeps detector lows below the playable register out of RH after octave registration", () => {
    const lowDetector = Array.from({ length: 8 }, (_, index) => ({
      midi: index % 2 ? 41 : 29,
      start: index * 0.5,
      dur: 0.25,
      vel: 112,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi(lowDetector, 4) }],
    });
    expect(result.ir.identity.filter((note) => note.identitySource === "guitar")).toHaveLength(0);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toHaveLength(8);
  });

  it("drops a sustained sub-register vocal drone without dropping a moving low vocal phrase", () => {
    const droneAndHook: Note[] = [
      { midi: 29, start: 0, dur: 6.5, vel: 78 },
      { midi: 72, start: 7, dur: 0.5, vel: 98 },
      { midi: 74, start: 8, dur: 0.5, vel: 96 },
    ];
    const droneResult = buildMetalArrangement({
      stems: [
        { role: "vocals", midi: midi(droneAndHook, 10) },
        { role: "guitar", midi: midi([{ midi: 64, start: 7.5, dur: 0.5, vel: 84 }], 10) },
      ],
    });
    const vocalIdentity = droneResult.ir.identity.filter((note) => note.identitySource === "vocals");
    expect(vocalIdentity.some((note) => note.start < 1), "raw low vocal drone was promoted into RH").toBe(false);
    expect(vocalIdentity.map((note) => note.midi)).toEqual([72, 74]);

    const movingLow = [42, 44, 47, 49].map((midi, index) => ({
      midi,
      start: index * 0.5,
      dur: 0.35,
      vel: 84,
    }));
    const movingResult = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi(movingLow, 3) }],
    });
    expect(movingResult.ir.identity.filter((note) => note.identitySource === "vocals")).toHaveLength(4);
  });

  it("does not promote a short repeated sub-register vocal wall", () => {
    const vocalWall = Array.from({ length: 8 }, (_, index) => ({
      midi: 41,
      start: index * 0.5,
      dur: 0.25,
      vel: 84,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi(vocalWall, 4) }],
    });
    expect(result.ir.identity.filter((note) => note.identitySource === "vocals"), "short low vocal wall was promoted into RH").toHaveLength(0);
  });

  it("does not promote short low vocal walls across the detector sub-register", () => {
    for (const rawMidi of [45, 57]) {
      const vocalWall = Array.from({ length: 8 }, (_, index) => ({
        midi: rawMidi,
        start: index * 0.5,
        dur: 0.25,
        vel: 84,
      }));
      const result = buildMetalArrangement({
        stems: [{ role: "vocals", midi: midi(vocalWall, 4) }],
      });
      expect(
        result.ir.identity.filter((note) => note.identitySource === "vocals"),
        `raw vocal wall ${rawMidi} was promoted into RH`,
      ).toHaveLength(0);
    }

    const movingLow = [45, 47, 49, 47].map((midi, index) => ({
      midi,
      start: index * 0.75,
      dur: 0.35,
      vel: 84,
    }));
    const movingResult = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi(movingLow, 4) }],
    });
    expect(movingResult.ir.identity.filter((note) => note.identitySource === "vocals")).toHaveLength(4);
  });

  it("preserves moving low vocal phrases and isolated low anchors", () => {
    const movingLow = [41, 43, 44, 46].map((midi, index) => ({
      midi,
      start: index * 0.5,
      dur: 0.35,
      vel: 84,
    }));
    const movingResult = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi(movingLow, 3) }],
    });
    expect(movingResult.ir.identity.filter((note) => note.identitySource === "vocals")).toHaveLength(4);

    const anchorResult = buildMetalArrangement({
      stems: [{ role: "vocals", midi: midi([{ midi: 41, start: 0, dur: 0.5, vel: 110 }], 2) }],
    });
    expect(anchorResult.ir.identity.filter((note) => note.identitySource === "vocals")).toHaveLength(1);
  });

  it("preserves a repeated upper MIDI 62 hook instead of classifying it as low pulse", () => {
    const hook = Array.from({ length: 8 }, (_, index) => ({
      midi: index % 4 < 2 ? 62 : 64,
      start: index,
      dur: 0.6,
      vel: 86,
    }));
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi(hook, 8) }],
    });
    const pitches = result.ir.identity.filter((note) => note.identitySource === "guitar").map((note) => note.midi);
    expect(pitches.filter((pitch) => pitch === 62).length).toBeGreaterThanOrEqual(3);
  });

  it("routes isolated raw guitar notes below the RH floor while preserving low contours and MIDI 62 hooks", () => {
    const lowSubRegister = [52, 52, 54].map((midi, index) => ({
      midi,
      start: index * 1.5,
      dur: 0.3,
      vel: 88,
    }));
    const lowContour = [55, 57, 59, 60, 59].map((midi, index) => ({
      midi,
      start: 4.5 + index * 0.75,
      dur: 0.45,
      vel: 86,
    }));
    const upperHook = [
      // Keep the upper evidence close enough to establish a separate lead
      // for the raw 52/54 partials, but outside the later low contour so the
      // latter remains a valid melodic motif.
      { midi: 62, start: 0.25, dur: 0.5, vel: 84 },
      ...[62, 62, 64].map((midi, index) => ({
        midi,
        start: 14.25 + index * 0.75,
        dur: 0.5,
        vel: 84,
      })),
    ];
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([...lowSubRegister, ...lowContour, ...upperHook], 17) }],
    });

    const identity = result.ir.identity.filter((note) => note.identitySource === "guitar");
    expect(identity.some((note) => [0, 1.5, 3].includes(note.start)), "raw <55 guitar note folded into RH").toBe(false);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar" && [0, 1.5, 3].includes(note.start))).toHaveLength(3);
    expect(identity.filter((note) => note.start >= 4.5 && note.start < 14.25).map((note) => note.midi)).toEqual([55, 57, 59, 60, 59]);
    expect(identity.filter((note) => note.midi === 62).length).toBeGreaterThanOrEqual(2);
  });

  it("routes a low power root that shares an onset with the lead into LH", () => {
    const notes = Array.from({ length: 8 }, (_, index) => [
      { midi: 45, start: index, dur: 0.25, vel: 112 },
      { midi: 74 + (index % 3), start: index, dur: 0.5, vel: 92 },
    ]).flat();
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi(notes, 8) }],
    });
    expect(result.ir.identity.some((note) => note.midi <= 60 && note.identitySource === "guitar")).toBe(false);
    expect(result.parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toHaveLength(8);
    expect(result.ir.identity.filter((note) => note.identitySource === "guitar" && note.midi >= 74).length).toBeGreaterThanOrEqual(6);
  });

  it("routes a low co-onset dyad even when no upper detector note was returned", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 52, start: 0, dur: 0.25, vel: 112 },
        { midi: 60, start: 0, dur: 0.25, vel: 56 },
      ], 2) }],
    });
    expect(result.ir.identity.some((note) => note.identitySource === "guitar")).toBe(false);
    expect(result.parsed.notes.some((note) => note.hand === "L" && note.identitySource === "guitar" && note.start === 0)).toBe(true);
  });

  it("routes a lone low root beside one upper lead attack into LH", () => {
    const result = buildMetalArrangement({
      stems: [{ role: "guitar", midi: midi([
        { midi: 52, start: 0, dur: 0.25, vel: 112 },
        { midi: 72, start: 0, dur: 0.5, vel: 64 },
      ], 2) }],
    });
    expect(result.ir.identity.some((note) => note.identitySource === "guitar" && note.midi === 72)).toBe(true);
    expect(result.ir.identity.some((note) => note.identitySource === "guitar" && note.midi <= 60)).toBe(false);
    expect(result.parsed.notes.some((note) => note.hand === "L" && note.identitySource === "guitar" && note.start === 0)).toBe(true);
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

  it("applies the playable contour guard to residual upper lanes", () => {
    const source = midi([
      { midi: 64, start: 0.25, dur: 0.5, vel: 92, hand: "R", identitySource: "other" },
      { midi: 69, start: 0.75, dur: 0.5, vel: 92, hand: "R", identitySource: "other" },
      { midi: 78, start: 1.25, dur: 0.125, vel: 48, hand: "R", identitySource: "other" },
      { midi: 74, start: 1.75, dur: 0.5, vel: 92, hand: "R", identitySource: "other" },
      { midi: 75, start: 2.25, dur: 0.5, vel: 92, hand: "R", identitySource: "other" },
    ], 3.25);
    const variants = buildVariants(source, { title: "Residual contour", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes.filter((note) => note.hand !== "L");
      expect(notes.some((note) => note.identitySource === "other" && note.start === 1.25), `${level} kept residual contour spike`).toBe(false);
      expect(notes.filter((note) => note.identitySource === "other").map((note) => note.midi)).toEqual([64, 69, 74, 75]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes.filter((note) => note.hand !== "L");
    expect(advanced.some((note) => note.identitySource === "other" && note.start === 1.25)).toBe(true);
  });

  it("drops a quiet residual spike after a long gap without changing Advanced detail", () => {
    const source = midi([
      { midi: 62, start: 1, dur: 0.5, vel: 72, hand: "R", identitySource: "other" },
      // The preceding lead attack is more than the old local-detour window
      // away. This weak short residual spike should not become a learner
      // melody solely because the next upper attack is nearby.
      { midi: 72, start: 2, dur: 0.25, vel: 44, hand: "R", identitySource: "other" },
      { midi: 64, start: 2.75, dur: 0.5, vel: 72, hand: "R", identitySource: "other" },
    ], 3.5);
    const variants = buildVariants(source, { title: "Residual gap spike", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    for (const level of ["medium", "easy"] as const) {
      const notes = variants.find((variant) => variant.level === level)!.notes
        .filter((note) => note.hand !== "L" && note.identitySource === "other");
      expect(notes.some((note) => note.midi === 72 && note.start === 2), `${level} kept residual gap spike`).toBe(false);
      expect(notes.map((note) => note.midi)).toEqual([62, 64]);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "other");
    expect(advanced.some((note) => note.midi === 72 && note.start === 2)).toBe(true);
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

  it("keeps learner coverage across a shifted stepwise guitar phrase", () => {
    const starts = [16, 16.25, 16.5, 16.75, 17.25, 17.5, 17.75, 18, 18.25, 19,
      19.5, 20, 20.25, 20.5, 20.75, 21, 21.25, 21.5, 21.75, 22, 22.75, 23.25];
    const pitches = [76, 72, 67, 64, 64, 67, 69, 69, 71, 64, 67, 69,
      69, 72, 69, 69, 69, 67, 65, 67, 72, 64];
    const source = midi(pitches.map((midi, index) => ({
      midi,
      start: starts[index]!,
      dur: 0.25,
      vel: 80,
      hand: "R" as const,
      identitySource: "guitar" as const,
    })), 24);
    const variants = buildVariants(source, { title: "Shifted lead coverage", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    const count = (level: "easy" | "medium" | "advanced") => variants
      .find((variant) => variant.level === level)!.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "guitar" && note.start >= 16);
    expect(count("advanced").length).toBe(pitches.length);
    // The old salience-only scheduler keeps 11 Medium / 9 Easy attacks here;
    // a connected shifted phrase should retain at least twelve supported
    // landings without restoring the quarter-beat ornament wholesale.
    expect(count("medium").length, "medium dropped too much of a connected lead phrase").toBeGreaterThanOrEqual(12);
    expect(count("easy").length, "easy lost the phrase contour").toBeGreaterThanOrEqual(12);
    for (const level of ["easy", "medium"] as const) {
      const notes = count(level);
      expect(notes[0]?.midi, `${level} lost the phrase landing`).toBe(76);
      expect(notes.at(-1)?.midi, `${level} lost the terminal landing`).toBe(64);
      expect(notes.some((note) => note.midi === 69 && note.start >= 20), `${level} lost a middle connector`).toBe(true);
      const gaps = notes.slice(1).map((note, index) => note.start - notes[index]!.start);
      expect(Math.min(...gaps), `${level} violated the half-beat learner floor`).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
    expect(count("easy").every((note) => count("medium").some((sourceNote) => sourceNote.start === note.start && sourceNote.midi === note.midi))).toBe(true);
  });

  it("preserves a connected lead through vocal gaps instead of collapsing it to sparse landings", () => {
    const starts = [
      0.375, 1.125, 1.375, 2.125, 2.5, 2.875, 3.625, 3.875, 4.5, 4.875,
      5.5, 6.125, 6.875, 7.375, 8.125, 8.625, 9, 9.375, 10, 10.5, 10.75,
      11.5, 11.875, 12.625, 12.875, 13.125, 13.75, 14.125, 14.875, 15.625,
      16.25, 16.5, 17, 17.625, 17.875, 18.5, 18.75, 19.5, 20.25, 20.5, 21.125,
      21.625, 22.25, 22.875, 23.625, 23.875, 24.25, 24.875, 25.5, 26.125, 26.75,
      27, 27.375, 27.625, 27.875, 28.625, 29.375, 29.625, 30, 30.375, 30.625,
      31, 31.625,
    ];
    const pitches = [
      65, 67, 69, 67, 69, 71, 69, 67, 69, 71, 69, 67, 65, 64, 64, 65,
      64, 64, 65, 65, 67, 69, 71, 72, 74, 76, 77, 76, 77, 79, 77, 79,
      79, 77, 79, 77, 79, 77, 79, 79, 79, 79, 77, 79, 79, 77, 76, 77,
      79, 77, 76, 74, 76, 74, 76, 74, 76, 77, 79, 79, 77, 76, 74,
    ];
    const velocities = [
      68, 81, 79, 64, 71, 85, 64, 61, 81, 65, 80, 69, 88, 60, 71, 69,
      76, 60, 70, 57, 86, 75, 65, 75, 82, 72, 59, 57, 58, 55, 68, 69,
      64, 59, 88, 84, 75, 78, 77, 84, 75, 63, 68, 74, 86, 83, 79, 63,
      81, 82, 61, 72, 70, 59, 79, 88, 83, 62, 83, 71, 83, 72, 59,
    ];
    const guitar = starts.map((start, index) => ({
      midi: pitches[index]!,
      start,
      dur: 0.25,
      vel: velocities[index]!,
      hand: "R" as const,
      identitySource: "guitar" as const,
    }));
    const vocals = [3.5, 11.5, 19.5, 27.5].map((start, index) => ({
      midi: 79 + (index % 3),
      start,
      dur: 0.35,
      vel: 104,
      hand: "R" as const,
      identitySource: "vocals" as const,
    }));
    const source = midi([...guitar, ...vocals], 32);
    const variants = buildVariants(source, { title: "Vocal-gap lead coverage", artist: "Fixture" }, {
      arrangementProfile: "metal",
      audioDerived: true,
    });
    expect(validateVariants(variants)).toEqual([]);
    expect(verifyMonotonicity(variants)).toEqual([]);
    const sourceGuitarKeys = new Set(guitar.map((note) => `${note.start}:${note.midi}`));
    const sourceVocalKeys = vocals.map((note) => `${note.start}:${note.midi}`);
    for (const level of ["medium", "easy"] as const) {
      const variant = variants.find((candidate) => candidate.level === level)!;
      const notes = variant.notes
        .filter((note) => note.hand !== "L" && note.identitySource === "guitar");
      // The source supplies a connected, stepwise lead through every vocal
      // gap. Keep a useful existing-note contour rather than only a handful
      // of phrase endpoints; no new attacks or pitches may be invented.
      // Four vocal anchors leave a substantial set of feasible guitar
      // attacks once the half-beat learner floor and vocal spacing guards are
      // applied. The recovery pass must keep at least 35 without inventing
      // notes.
      expect(notes.length, `${level} collapsed the connected lead through vocal gaps`).toBeGreaterThanOrEqual(35);
      expect(notes.some((note) => note.start < 4), `${level} lost the opening lead`).toBe(true);
      expect(notes.some((note) => note.start >= 16 && note.start < 24), `${level} lost the middle lead`).toBe(true);
      expect(notes.some((note) => note.start >= 28), `${level} lost the closing lead`).toBe(true);
      const gaps = notes.slice(1).map((note, index) => note.start - notes[index]!.start);
      expect(Math.min(...gaps), `${level} violated the half-beat floor`).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(notes.every((note) => sourceGuitarKeys.has(`${note.start}:${note.midi}`)), `${level} invented a guitar attack`).toBe(true);
      expect(new Set(notes.map((note) => `${note.start}:${note.midi}`)).size, `${level} duplicated a guitar attack`).toBe(notes.length);
      expect(variant.notes.filter((note) => note.hand !== "L" && note.identitySource === "vocals").map((note) => `${note.start}:${note.midi}`)).toEqual(sourceVocalKeys);
    }
    const advancedVariant = variants.find((variant) => variant.level === "advanced")!;
    const advanced = advancedVariant.notes
      .filter((note) => note.hand !== "L" && note.identitySource === "guitar");
    expect(advanced.length).toBeGreaterThanOrEqual(guitar.length - 9);
    expect(advanced.every((note) => sourceGuitarKeys.has(`${note.start}:${note.midi}`))).toBe(true);
    expect(advancedVariant.notes.filter((note) => note.hand !== "L" && note.identitySource === "vocals").map((note) => `${note.start}:${note.midi}`)).toEqual(sourceVocalKeys);
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

  it("selects a coherent guitar contour from harmonic stack candidates", () => {
    const contour = [64, 65, 67, 69, 71, 72, 74, 76];
    const candidates = contour.flatMap((pitch, index) => {
      const start = index * 0.5;
      return [
        { midi: pitch, start, dur: 0.45, vel: 72, identitySource: "guitar" as const },
        // Loud, short octave/fifth partials are deliberately more salient
        // than the intended line; the path must use neighbouring contour
        // support rather than velocity alone.
        { midi: pitch + 12, start: start + 0.03, dur: 0.06, vel: 118, identitySource: "guitar" as const },
        { midi: pitch + 7, start: start + 0.06, dur: 0.06, vel: 110, identitySource: "guitar" as const },
      ];
    });
    const result = selectGuitarLeadPath(candidates, { minimumSpacingBeats: 0.45 });
    expect(result.notes.map((note) => note.midi)).toEqual(contour);
    expect(result.notes.map((note) => note.start)).toEqual(contour.map((_, index) => index * 0.5));
    expect(result.notes.every((note) => note.identitySource === "guitar")).toBe(true);
    expect(result.diagnostics.harmonicGroupCount).toBe(contour.length);
    expect(result.diagnostics.harmonicRejectedCount).toBeGreaterThan(0);
  });

  it("keeps an articulated expressive leap and a fast scalar run", () => {
    const leap = selectGuitarLeadPath([
      { midi: 64, start: 0, dur: 0.5, vel: 100, identitySource: "guitar" as const },
      { midi: 84, start: 1, dur: 0.9, vel: 120, identitySource: "guitar" as const },
      { midi: 72, start: 2, dur: 0.5, vel: 100, identitySource: "guitar" as const },
      { midi: 75, start: 3, dur: 0.5, vel: 100, identitySource: "guitar" as const },
    ], { minimumSpacingBeats: 0.5 });
    expect(leap.notes.some((note) => note.start === 1 && note.midi === 84)).toBe(true);

    const runPitches = [64, 65, 67, 69, 71, 72, 74, 76, 74, 72, 71, 69];
    const run = selectGuitarLeadPath(runPitches.map((midi, index) => ({
      midi,
      start: index * 0.25,
      dur: 0.2,
      vel: 100,
      identitySource: "guitar" as const,
    })), { minimumSpacingBeats: 0.125 });
    expect(run.notes.map((note) => note.midi)).toEqual(runPitches);
    expect(run.notes).toHaveLength(runPitches.length);
  });

  it("recovers an existing bridge candidate but rejects a weak chromatic gap spike", () => {
    const bridge = selectGuitarLeadPath([
      { midi: 64, start: 0, dur: 0.5, vel: 110, identitySource: "guitar" as const },
      { midi: 68, start: 1.25, dur: 0.4, vel: 96, identitySource: "guitar" as const },
      { midi: 72, start: 2.5, dur: 0.5, vel: 110, identitySource: "guitar" as const },
    ], { minimumSpacingBeats: 1.5, phraseBreakBeats: 3 });
    expect(bridge.notes.map((note) => note.start)).toEqual([0, 1.25, 2.5]);
    expect(bridge.diagnostics.recoveredCount).toBe(1);

    const bad = selectGuitarLeadPath([
      { midi: 64, start: 0, dur: 0.5, vel: 110, identitySource: "guitar" as const },
      { midi: 84, start: 1.25, dur: 0.05, vel: 30, identitySource: "guitar" as const },
      { midi: 72, start: 2.5, dur: 0.5, vel: 110, identitySource: "guitar" as const },
    ], { minimumSpacingBeats: 1.5, phraseBreakBeats: 3 });
    expect(bad.notes.some((note) => note.start === 1.25)).toBe(false);
  });

  it("keeps guitar lead selection source-locked and deterministic", () => {
    const notes: Note[] = [
      { midi: 64, start: 0, dur: 0.5, vel: 90, identitySource: "guitar" },
      { midi: 67, start: 0.5, dur: 0.5, vel: 92, identitySource: "guitar" },
      { midi: 69, start: 1, dur: 0.5, vel: 94, identitySource: "guitar" },
      { midi: 84, start: 0.25, dur: 0.5, vel: 120, identitySource: "vocals" },
      { midi: 36, start: 0, dur: 2, vel: 120, identitySource: undefined },
      { midi: 35, start: 0.25, dur: 0.1, vel: 120, identitySource: undefined },
      { midi: 76, start: 0.75, dur: 0.1, vel: 40, identitySource: "other" },
    ];
    const first = selectGuitarLeadPath(notes, { minimumSpacingBeats: 0.25 });
    const second = selectGuitarLeadPath([...notes].reverse(), { minimumSpacingBeats: 0.25 });
    expect(second).toEqual(first);
    expect(first.notes.every((note) => note.identitySource === "guitar")).toBe(true);
    expect(first.notes.some((note) => note.midi === 36 || note.midi === 35 || note.midi === 84 || note.midi === 76)).toBe(false);
  });
});
