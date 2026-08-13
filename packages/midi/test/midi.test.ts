import { describe, expect, it } from "vitest";
import {
  parseMidi,
  quantize,
  splitHands,
  detectKey,
  keySignature,
  chordName,
  buildVariants,
  validateVariants,
  writeMidi,
  writeMusicXml,
  cleanTranscription,
  LEVEL_ORDER,
  Note,
  ParsedMidi,
  Variant,
} from "../src/index.js";

const HEX = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

/** Format-0 SMF: C major scale, 120 BPM, 4/4, division 480, quarter-note length. */
const SCALE_MIDI = HEX(`
  4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
  4d 54 72 6b 00 00 00 64
  00 ff 51 03 07 a1 20
  00 ff 58 04 04 02 18 08
  00 ff 59 02 00 00
  00 c0 00
  00 90 3c 64 83 60 80 3c 40
  00 90 3e 64 83 60 80 3e 40
  00 90 40 64 83 60 80 40 40
  00 90 41 64 83 60 80 41 40
  00 90 43 64 83 60 80 43 40
  00 90 45 64 83 60 80 45 40
  00 90 47 64 83 60 80 47 40
  00 90 48 64 83 60 80 48 40
  00 ff 2f 00
`);

describe("parseMidi", () => {
  it("parses a hand-built scale fixture", () => {
    const m = parseMidi(SCALE_MIDI);
    expect(m.tempoBpm).toBe(120);
    expect(m.timeSig).toEqual([4, 4]);
    expect(m.keySig).toBe(0);
    expect(m.notes).toHaveLength(8);
    expect(m.notes.map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(m.notes[0]!.start).toBe(0);
    expect(m.notes[0]!.dur).toBeCloseTo(1, 3);
    expect(m.notes[1]!.start).toBeCloseTo(1, 3);
  });

  it("rejects non-MIDI input", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("sign-extends flat key signatures", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 0a
      00 ff 59 02 ff 01
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.keySig).toBe(-1);
    expect(m.keyMode).toBe(1);
  });

  it("keeps running status across meta events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 1b
      00 90 3c 64
      00 ff 51 03 07 a1 20
      00 3e 64
      83 60 80 3c 40
      00 80 3e 40
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 1],
      [62, 0, 1],
    ]);
  });

  it("skips drum channel (10) note events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 16
      00 99 24 60
      83 60 89 24 40
      00 90 3c 64
      83 60 80 3c 40
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.notes.map((n) => n.midi)).toEqual([60]);
  });

  it("rejects truncated tracks and invalid headers with clear errors", () => {
    expect(() => parseMidi(new Uint8Array(4))).toThrow(/MThd/);
    const truncated = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 30
      00 90 3c 64
    `);
    expect(() => parseMidi(truncated)).toThrow(/truncated track/);
    expect(() => parseMidi(HEX(`4d 54 68 64 00 00 00 08 00 00 00 01 01 e0`))).toThrow(/header/);
  });

  it("ignores zero-duration tempo meta events", () => {
    const buf = HEX(`
      4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
      4d 54 72 6b 00 00 00 0b
      00 ff 51 03 00 00 00
      00 ff 2f 00
    `);
    const m = parseMidi(buf);
    expect(m.tempoBpm).toBe(120);
  });
});

describe("writeMidi roundtrip", () => {
  it("write -> parse preserves notes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 1, dur: 0.5, vel: 70 },
    ];
    const buf = writeMidi(notes, { tempoBpm: 100, timeSig: [3, 4], keySig: 1, keyMode: 0, title: "Test" });
    const m = parseMidi(buf);
    expect(m.tempoBpm).toBe(100);
    expect(m.timeSig).toEqual([3, 4]);
    expect(m.notes).toHaveLength(3);
    expect(m.notes[0]!.midi).toBe(60);
    expect(m.notes[0]!.start).toBeCloseTo(0, 3);
    expect(m.notes[0]!.dur).toBeCloseTo(1, 3);
    expect(m.notes[2]!.midi).toBe(67);
    expect(m.notes[2]!.start).toBeCloseTo(1, 3);
    expect(m.notes[2]!.dur).toBeCloseTo(0.5, 3);
  });

  it("does not cut short a same-pitch re-strike", () => {
    const bytes = writeMidi(
      [
        { midi: 60, start: 0, dur: 4, vel: 80 },
        { midi: 60, start: 2, dur: 4, vel: 80 },
      ],
      { tempoBpm: 120, keySig: 0, keyMode: 0 },
    );
    const m = parseMidi(bytes);
    expect(m.notes.map((n) => [n.start, n.dur])).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("skips zero-velocity notes", () => {
    const bytes = writeMidi([{ midi: 60, start: 0, dur: 1, vel: 0 }], { tempoBpm: 120 });
    expect(parseMidi(bytes).notes).toHaveLength(0);
  });
});

describe("quantize", () => {
  it("snaps to grid and merges unisons", () => {
    const notes: Note[] = [
      { midi: 60, start: 0.11, dur: 0.48, vel: 80 },
      { midi: 60, start: 0.12, dur: 0.3, vel: 60 },
      { midi: 62, start: 0.31, dur: 0.9, vel: 80 },
    ];
    const q = quantize(notes, { grid: 0.25 });
    expect(q).toHaveLength(2);
    expect(q[0]!.start).toBe(0);
    expect(q.find((n) => n.midi === 60)!.dur).toBeGreaterThanOrEqual(0.48);
    expect(q.find((n) => n.midi === 62)!.start).toBe(0.25);
  });
});

describe("splitHands", () => {
  it("splits high and low clusters", () => {
    const notes: Note[] = [
      { midi: 48, start: 0, dur: 1, vel: 80 },
      { midi: 52, start: 0, dur: 1, vel: 80 },
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 1, dur: 1, vel: 80 },
      { midi: 72, start: 1, dur: 1, vel: 80 },
    ];
    const { lh, rh } = splitHands(notes);
    expect(lh.map((n) => n.midi)).toEqual([48, 52]);
    expect(rh.map((n) => n.midi)).toEqual([60, 64, 67, 72]);
  });

  it("falls back to a percentile split for continuous-range material", () => {
    const notes: Note[] = [];
    for (let m = 36; m <= 72; m += 2) {
      notes.push({ midi: m, start: 0, dur: 1, vel: 80 });
    }
    const { lh, rh } = splitHands(notes);
    expect(lh.length).toBeGreaterThan(0);
    expect(rh.length).toBeGreaterThan(0);
    expect(lh.length / notes.length).toBeGreaterThan(0.1);
    expect(lh.length / notes.length).toBeLessThan(0.9);
  });
});

describe("detectKey", () => {
  it("detects C major from scale notes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 4, vel: 80 },
      { midi: 62, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 65, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 0, dur: 3, vel: 80 },
      { midi: 69, start: 0, dur: 1, vel: 80 },
      { midi: 71, start: 0, dur: 1, vel: 80 },
    ];
    expect(detectKey(notes).name).toBe("C");
  });
  it("detects A minor", () => {
    const notes: Note[] = [
      { midi: 57, start: 0, dur: 4, vel: 80 },
      { midi: 59, start: 0, dur: 1, vel: 80 },
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 62, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 3, vel: 80 },
      { midi: 65, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 0, dur: 1, vel: 80 },
    ];
    expect(detectKey(notes).name).toBe("Am");
  });
});

describe("keySignature", () => {
  it("maps major and minor key names to fifths and mode", () => {
    expect(keySignature("C")).toEqual({ fifths: 0, mode: 0 });
    expect(keySignature("G")).toEqual({ fifths: 1, mode: 0 });
    expect(keySignature("F")).toEqual({ fifths: -1, mode: 0 });
    expect(keySignature("Am")).toEqual({ fifths: 0, mode: 1 });
    expect(keySignature("Dm")).toEqual({ fifths: -1, mode: 1 });
    expect(keySignature("Ebm")).toEqual({ fifths: -6, mode: 1 });
    expect(keySignature("F#m")).toEqual({ fifths: 3, mode: 1 });
  });

  it("maps a space-separated minor key name", () => {
    expect(keySignature("A minor")).toEqual({ fifths: 0, mode: 1 });
  });

  it("maps a space-separated major key name", () => {
    expect(keySignature("F# major")).toEqual({ fifths: 6, mode: 0 });
  });
});

describe("chordName", () => {
  it("names common triads and sevenths", () => {
    expect(chordName([0, 4, 7])).toBe("C");
    expect(chordName([0, 3, 7])).toBe("Cm");
    expect(chordName([0, 4, 7, 10])).toBe("C7");
    expect(chordName([0, 4, 7, 11])).toBe("Cmaj7");
    expect(chordName([0, 3, 6])).toBe("Cdim");
    expect(chordName([2, 7, 9])).toBe("Dsus4");
  });

  it("labels power chords and drops unlabelable dyads", () => {
    expect(chordName([0, 7])).toBe("C5"); // root + fifth
    expect(chordName([0, 7, 10])).toBe("C7"); // seventh dyad keeps its name
    expect(chordName([0, 4])).toBe(""); // root + third: no chord name
    expect(chordName([0, 1])).toBe(""); // chromatic clash: no chord name
    expect(chordName([0, 3, 8], 8)).toBe("G#");
  });
});

describe("buildVariants", () => {
  const src = parseMidi(SCALE_MIDI);
  it("produces 6 levels with monotonic simplification", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    expect(variants.map((v) => v.level)).toEqual(LEVEL_ORDER);
    // Every easier level preserves the melody: RH notes are a subset of the
    // next harder level's RH notes (LH roots are intentionally re-voiced).
    const keys = (notes: Note[]) =>
      new Set(notes.map((n) => `${n.midi}@${n.start.toFixed(2)}`));
    for (let i = 0; i < variants.length - 1; i++) {
      const rhNow = variants[i]!.notes.filter((n) => n.hand !== "L");
      for (const k of keys(rhNow)) {
        expect(keys(variants[i + 1]!.notes.filter((n) => n.hand !== "L")).has(k)).toBe(true);
      }
    }
    expect(variants[0]!.notes.every((n) => n.hand === "R")).toBe(true);
    expect(variants[5]!.notes.length).toBeGreaterThan(0);
  });
  it("roots easy-variant bass notes to the song key", () => {
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 1,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 71, start: 0, dur: 1, vel: 80 },
        { midi: 55, start: 0, dur: 1, vel: 80 },
        { midi: 67, start: 1, dur: 1, vel: 80 },
        { midi: 50, start: 1, dur: 1, vel: 80 },
      ],
      trackNames: ["Test"],
      durationBeats: 4,
    };
    const variants = buildVariants(src, { title: "G", artist: "T", key: "G" });
    for (const level of ["easy", "very-easy"] as const) {
      const v = variants.find((x) => x.level === level)!;
      const bass = v.notes.filter((n) => n.hand === "L");
      expect(bass.length).toBeGreaterThan(0);
      expect(bass.every((n) => n.midi % 12 === 7)).toBe(true);
    }
  });
  it("scores are monotonic", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    const scores = variants.map((v) => v.difficultyScore);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it("keeps hand labels on the advanced variant", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    const advanced = variants[variants.length - 1]!;
    expect(advanced.notes.some((n) => n.hand === "L")).toBe(true);
    expect(advanced.notes.some((n) => n.hand === "R")).toBe(true);
  });

  it("caps advanced/medium polyphony so band MIDIs stay playable", () => {
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        ...([60, 62, 64, 65, 67, 69, 71, 74] as const).map((midi) => ({ midi, start: 0, dur: 1, vel: 80 })),
        ...([36, 38, 40, 41, 43] as const).map((midi) => ({ midi, start: 0, dur: 1, vel: 80 })),
      ],
      trackNames: ["Band"],
      durationBeats: 4,
    };
    const variants = buildVariants(src, { title: "Band", artist: "Test" });
    const maxSim = (notes: Note[]) => {
      const by = new Map<string, number>();
      for (const n of notes) {
        const k = n.start.toFixed(3);
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      return Math.max(...by.values());
    };
    const advanced = variants[5]!;
    const medium = variants[4]!;
    expect(maxSim(advanced.notes)).toBeLessThanOrEqual(8);
    expect(maxSim(medium.notes)).toBeLessThanOrEqual(6);
    expect(medium.notes.length).toBeLessThan(advanced.notes.length);
  });

  it("keeps sounding hand spans within a physical reach", () => {
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 91, start: 0, dur: 1, vel: 80 },
        { midi: 79, start: 0, dur: 1, vel: 80 },
        { midi: 67, start: 0, dur: 1, vel: 80 },
        { midi: 55, start: 0, dur: 1, vel: 80 },
        { midi: 36, start: 0, dur: 1, vel: 80 },
        { midi: 50, start: 0, dur: 1, vel: 80 },
        { midi: 86, start: 0.25, dur: 0.5, vel: 80 },
      ],
      trackNames: ["Band"],
      durationBeats: 4,
    };
    const variants = buildVariants(src, { title: "Band", artist: "Test" });
    for (const variant of variants) {
      for (const hand of ["L", "R"] as const) {
        const hn = variant.notes.filter((x) => x.hand === hand);
        const events: [number, number, number][] = [];
        for (const n of hn) {
          events.push([n.start, 1, n.midi]);
          events.push([n.start + n.dur, -1, n.midi]);
        }
        events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const active = new Set<number>();
        let maxSpan = 0;
        for (const [, kind, midi] of events) {
          if (kind === 1) active.add(midi);
          else active.delete(midi);
          if (active.size > 1) maxSpan = Math.max(maxSpan, Math.max(...active) - Math.min(...active));
        }
        expect(maxSpan).toBeLessThanOrEqual(12);
      }
    }
  });

  it("validateVariants accepts built variants and rejects unplayable ones", () => {
    const notes: Note[] = [];
    for (let b = 0; b < 16; b++) {
      notes.push({ midi: 60 + (b % 8), start: b, dur: 1, vel: 80 });
      notes.push({ midi: 36, start: b, dur: 1, vel: 80 });
      notes.push({ midi: 43, start: b, dur: 1, vel: 80 });
    }
    // one dense band chord in the middle, like a multitrack studio MIDI
    for (const midi of [38, 40, 41, 62, 64, 65, 67, 69, 71, 74, 76]) notes.push({ midi, start: 4, dur: 1, vel: 80 });
    const denseSrc: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Band"],
      durationBeats: 16,
    };
    expect(validateVariants(buildVariants(denseSrc, { title: "Band", artist: "Test" }))).toEqual([]);

    const bad = buildVariants(denseSrc, { title: "Band", artist: "Test" });
    const advanced = bad[5]!;
    advanced.notes = [
      ...advanced.notes,
      ...[77, 79, 81, 83, 84, 86, 88, 89, 91, 93].map((midi) => ({ midi, start: 4, dur: 1, vel: 80, hand: "R" as const })),
    ];
    advanced.tempoBpm = 400;
    advanced.timeSig = [3, 3];
    const errors = validateVariants(bad);
    expect(errors.some((e) => e.includes("simultaneous notes"))).toBe(true);
    expect(errors.some((e) => e.includes("tempo 400"))).toBe(true);
    expect(errors.some((e) => e.includes("bad time signature 3/3"))).toBe(true);
  });

  it("dedupes consecutive same-name chords in built variants", () => {
    const notes: Note[] = [];
    for (let b = 0; b < 16; b++) {
      notes.push({ midi: 60, start: b * 0.25, dur: 0.25, vel: 80 });
      notes.push({ midi: 64, start: b * 0.25, dur: 0.25, vel: 80 });
      notes.push({ midi: 67, start: b * 0.25, dur: 0.25, vel: 80 });
    }
    for (let b = 16; b < 24; b++) {
      notes.push({ midi: 55, start: b * 0.25, dur: 0.25, vel: 80 });
      notes.push({ midi: 59, start: b * 0.25, dur: 0.25, vel: 80 });
      notes.push({ midi: 62, start: b * 0.25, dur: 0.25, vel: 80 });
    }
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Test"],
      durationBeats: 24,
    };
    for (const v of buildVariants(src, { title: "T", artist: "A" })) {
      const names = v.chords.map((c) => c.name);
      for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
      expect(v.chords.length).toBeLessThan(8); // 24 slices collapsed into changes
    }
  });

  it("validateVariants rejects variants with a frantic median inter-onset interval", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    const vb = variants[0]!;
    vb.notes = Array.from({ length: 10 }, (_, i) => ({ midi: 60, start: i * 0.1, dur: 0.5, vel: 80, hand: "R" as const }));
    expect(validateVariants(variants).some((e) => e.includes("inter-onset"))).toBe(true);
  });
});

describe("cleanTranscription", () => {
  it("drops quiet and ultra-short ghost notes, keeps real notes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 0.5, vel: 80 },
      { midi: 62, start: 0, dur: 0.05, vel: 60 },
      { midi: 64, start: 0.5, dur: 0.5, vel: 20 },
    ];
    const out = cleanTranscription(notes);
    expect(out).toHaveLength(1);
    expect(out[0]!.midi).toBe(60);
  });

  it("merges near-duplicate re-triggers and caps polyphony", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 0.5, vel: 80 },
      { midi: 60, start: 0.05, dur: 0.3, vel: 70 },
      { midi: 64, start: 0, dur: 0.5, vel: 60 },
      { midi: 67, start: 0.01, dur: 0.5, vel: 40 },
      { midi: 72, start: 0, dur: 0.5, vel: 30 },
      { midi: 55, start: 0.02, dur: 0.5, vel: 20 },
    ];
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0, maxPolyphony: 3 });
    // duplicate C merged; 6 distinct pitches capped to 3 loudest
    expect(out).toHaveLength(3);
    expect(out[0]!.midi).toBe(60);
    expect(out[0]!.vel).toBe(80);
    expect(out.every((n) => n.vel >= 40)).toBe(true);
  });

  it("caps simultaneously sounding notes to what two hands can play", () => {
    const notes: Note[] = Array.from({ length: 12 }, (_, i) => ({
      midi: 60 + i,
      start: 0,
      dur: 1,
      vel: 20 + i * 5,
    }));
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0, maxPolyphony: 12, maxSounding: 8 });
    expect(out).toHaveLength(8);
    expect(Math.min(...out.map((n) => n.vel))).toBeGreaterThanOrEqual(20 + 4 * 5);
  });

  it("caps sustained pads so notes don't drone for minutes", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 300, vel: 80 },
      { midi: 64, start: 0, dur: 0.5, vel: 70 },
    ];
    const out = cleanTranscription(notes);
    expect(out.find((n) => n.midi === 60)!.dur).toBe(3);
    expect(out.find((n) => n.midi === 64)!.dur).toBe(0.5);
  });
});

describe("writeMusicXml", () => {
  it("writes correct note types for common durations", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 0.5, vel: 80, hand: "R" },
        { midi: 62, start: 0.5, dur: 1, vel: 80, hand: "R" },
        { midi: 64, start: 1.5, dur: 2, vel: 80, hand: "L" },
        { midi: 48, start: 3.5, dur: 4, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<type>eighth</type>");
    expect(xml).toContain("<type>quarter</type>");
    expect(xml).toContain("<type>half</type>");
    expect(xml).toContain("<type>whole</type>");
    expect(xml).not.toContain("<dots>");
    expect(xml).toContain("<staves>2</staves>");
  });

  it("writes dotted notes as a direct <dot/>", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1.5, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<type>quarter</type><dot/>");
    expect(xml).not.toContain("<dots>");
  });

  it("produces valid-looking score-partwise XML with colors", () => {
    const src = parseMidi(SCALE_MIDI);
    const variant = buildVariants(src, { title: "Scale", artist: "Test" })[1]!;
    const xml = writeMusicXml(variant, "Scale", "Test");
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain('<part id="P1">');
    expect(xml).toContain('<clef number="1"><sign>G</sign>');
    expect(xml).toContain('color="#');
    expect(xml).toContain("<metronome>");
    expect((xml.match(/<note/g) ?? []).length).toBeGreaterThanOrEqual(variant.notes.length);
  });

  it("writes minor key signatures", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "Dm",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(v, "T", "A");
    expect(xml).toContain("<key><fifths>-1</fifths><mode>minor</mode></key>");
  });
});
