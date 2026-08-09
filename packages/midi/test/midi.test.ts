import { describe, expect, it } from "vitest";
import {
  parseMidi,
  quantize,
  splitHands,
  detectKey,
  chordName,
  buildVariants,
  writeMidi,
  writeMusicXml,
  LEVEL_ORDER,
  Note,
} from "../src/index.js";

const HEX = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

/** Format-0 SMF: C major scale, 120 BPM, 4/4, division 480, quarter-note length. */
const SCALE_MIDI = HEX(`
  4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
  4d 54 72 6b 00 00 00 6c
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
    expect(detectKey(notes).name).toBe("A");
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
});

describe("buildVariants", () => {
  const src = parseMidi(SCALE_MIDI);
  it("produces 6 levels with monotonic simplification", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    expect(variants.map((v) => v.level)).toEqual(LEVEL_ORDER);
    // Every easier level is a note-subset of the next harder level.
    const keys = (notes: Note[]) =>
      new Set(notes.map((n) => `${n.midi}@${n.start.toFixed(2)}`));
    for (let i = 0; i < variants.length - 1; i++) {
      for (const k of keys(variants[i]!.notes)) {
        expect(keys(variants[i + 1]!.notes).has(k)).toBe(true);
      }
    }
    expect(variants[0]!.notes.every((n) => n.hand === "R")).toBe(true);
    expect(variants[5]!.notes.length).toBeGreaterThan(0);
  });
  it("scores are monotonic", () => {
    const variants = buildVariants(src, { title: "Scale", artist: "Test" });
    const scores = variants.map((v) => v.difficultyScore);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
});

describe("writeMusicXml", () => {
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
});
