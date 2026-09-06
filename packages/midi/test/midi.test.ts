import { describe, expect, it } from "vitest";
import {
  parseMidi,
  midiBeatToNativeSeconds,
  midiTickToNativeSeconds,
  quantize,
  splitHands,
  detectKey,
  keySignature,
  chordName,
  buildVariants,
  reduceMediumRhythm,
  padPitches,
  melodyOnly,
  validateVariants,
  verifyMonotonicity,
  writeMidi,
  writeMusicXml,
  parseMusicXmlNotes,
  writeVariantArtifacts,
  validateArtifactRoundtrip,
  validateArtifactFiles,
  cleanTranscription,
  TRANSCRIPTION_CLEANUP_CONFIG,
  transcriptionMaxDurationBeats,
  sanitizeImportedNotes,
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
    expect(m.tempoMetaPresent).toBe(true);
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
    expect(m.tempoMetaPresent).toBe(false);
  });

  it("preserves native tempo events and converts beats through the tempo map", () => {
    const payload = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 BPM at beat 0
      0x00, 0x90, 0x3c, 0x64,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, // 60 BPM at beat 1
      0x00, 0x90, 0x3e, 0x64,
      0x83, 0x60, 0x80, 0x3e, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, 0x00, 0x01, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b,
      (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff,
      ...payload,
    ]);
    const parsed = parseMidi(bytes);
    expect(parsed.tempoEvents).toEqual([
      { tick: 0, beat: 0, microsecondsPerQuarter: 500_000, bpm: 120 },
      { tick: 480, beat: 1, microsecondsPerQuarter: 1_000_000, bpm: 60 },
    ]);
    expect(midiBeatToNativeSeconds(parsed, 1)).toBeCloseTo(0.5, 8);
    expect(midiBeatToNativeSeconds(parsed, 2)).toBeCloseTo(1.5, 8);
  });

  it("rejects a zero MIDI division instead of producing invalid beat coordinates", () => {
    const bytes = new Uint8Array(SCALE_MIDI);
    bytes[12] = 0;
    bytes[13] = 0;
    expect(() => parseMidi(bytes)).toThrow(/division/i);
  });

  it("uses MIDI's default 120 BPM before a tempo event that starts later", () => {
    const parsed: ParsedMidi = {
      format: 1,
      division: 480,
      tempoBpm: 60,
      tempoMetaPresent: true,
      tempoEvents: [{ tick: 480, beat: 1, microsecondsPerQuarter: 1_000_000, bpm: 60 }],
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [],
      trackNames: [],
      durationBeats: 0,
    };
    expect(midiTickToNativeSeconds(parsed, 240)).toBeCloseTo(0.25, 8);
    expect(midiTickToNativeSeconds(parsed, 720)).toBeCloseTo(1, 8);
  });

  it("consumes system-common messages before continuing with channel events", () => {
    const payload = [
      0x00, 0xf1, 0x7f,
      0x00, 0xf2, 0x01, 0x02,
      0x00, 0xf3, 0x01,
      0x00, 0xf6,
      0x00, 0x90, 0x3c, 0x64,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b,
      (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff,
      ...payload,
    ]);
    expect(parseMidi(bytes).notes.map((note) => note.midi)).toEqual([60]);
  });

  it("preserves RH/LH track labels on parsed notes", () => {
    const bytes = writeMidi(
      [
        { midi: 72, start: 0, dur: 1, vel: 90 },
        { midi: 36, start: 0, dur: 1, vel: 90 },
      ],
      {
        tempoBpm: 120,
        tracks: [
          { name: "RH", notes: [{ midi: 72, start: 0, dur: 1, vel: 90 }] },
          { name: "LH", notes: [{ midi: 36, start: 0, dur: 1, vel: 90 }] },
        ],
      },
    );
    const parsed = parseMidi(bytes);
    expect(parsed.trackNames).toEqual(["RH", "LH"]);
    expect(parsed.notes.map((n) => [n.midi, n.hand])).toEqual([
      [36, "L"],
      [72, "R"],
    ]);
  });

  it("repairs duplicated one-sided labels when track pitch ranges contradict them", () => {
    const bytes = writeMidi(
      [],
      {
        tempoBpm: 120,
        tracks: [
          { name: "Pianl LH", notes: [{ midi: 72, start: 0, dur: 1, vel: 90 }] },
          { name: "Pianl LH", notes: [{ midi: 36, start: 0, dur: 1, vel: 90 }] },
        ],
      },
    );
    const parsed = parseMidi(bytes);
    expect(parsed.notes.map((n) => [n.midi, n.hand])).toEqual([
      [36, "L"],
      [72, "R"],
    ]);
  });
});

describe("parseMidi truncated input", () => {
  function midiWithTrack(payload: number[]): Uint8Array {
    return new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // header len = 6
      0x00, 0x01,             // format 1
      0x00, 0x01,             // ntrks = 1
      0x01, 0xe0,             // division = 480
      0x4d, 0x54, 0x72, 0x6b, // "MTrk"
      (payload.length >>> 24) & 0xff,
      (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff,
      payload.length & 0xff,
      ...payload,
    ]);
  }

  it.each([
    ["delta varint", [0x81], /truncated MIDI varint/],
    ["overlong delta varint", [0x81, 0x81, 0x81, 0x81, 0x00], /invalid MIDI varint/],
    ["event status", [0x00], /truncated MIDI event/],
    ["meta type", [0x00, 0xff], /truncated MIDI meta/],
    ["meta length", [0x00, 0xff, 0x01, 0x81], /truncated MIDI varint/],
    ["meta payload", [0x00, 0xff, 0x01, 0x02, 0x41], /truncated MIDI meta payload/],
    ["sysex length", [0x00, 0xf0, 0x81], /truncated MIDI varint/],
    ["sysex payload", [0x00, 0xf0, 0x02, 0x41], /truncated MIDI sysex payload/],
    ["two-byte channel payload", [0x00, 0x90, 0x3c], /truncated MIDI channel message/],
    ["one-byte channel payload", [0x00, 0xc0], /truncated MIDI channel message/],
  ] as const)("rejects a truncated %s", (_name, payload, expected) => {
    expect(() => parseMidi(midiWithTrack([...payload]))).toThrow(expected);
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

  it("preserves overlapping same-pitch note durations", () => {
    const bytes = writeMidi(
      [
        { midi: 60, start: 0, dur: 4, vel: 80 },
        { midi: 60, start: 2, dur: 4, vel: 80 },
      ],
      { tempoBpm: 120, keySig: 0, keyMode: 0 },
    );
    const m = parseMidi(bytes);
    expect(m.notes.map((n) => [n.start, n.dur])).toEqual([
      [0, 4],
      [2, 4],
    ]);
  });

  it("preserves nested same-pitch note durations", () => {
    const bytes = writeMidi(
      [
        { midi: 60, start: 0, dur: 8, vel: 80 },
        { midi: 60, start: 2, dur: 2, vel: 70 },
      ],
      { tempoBpm: 120, keySig: 0, keyMode: 0 },
    );
    const m = parseMidi(bytes);
    expect(m.notes.map((n) => [n.start, n.dur])).toEqual([
      [0, 8],
      [2, 2],
    ]);
  });

  it("skips zero-velocity notes", () => {
    const bytes = writeMidi([{ midi: 60, start: 0, dur: 1, vel: 0 }], { tempoBpm: 120 });
    expect(parseMidi(bytes).notes).toHaveLength(0);
  });

  it("writes explicit instrument programs and channel-10 percussion tracks", () => {
    const guitar: Note[] = [{ midi: 52, start: 0, dur: 0.5, vel: 100 }];
    const drums: Note[] = [{ midi: 36, start: 0, dur: 0.125, vel: 110 }];
    const bytes = writeMidi([...guitar, ...drums], {
      tempoBpm: 160,
      tracks: [
        { name: "Rhythm Guitar", notes: guitar, channel: 1, program: 30 },
        { name: "Drums", notes: drums, percussion: true },
      ],
    });
    const parsed = parseMidi(bytes);
    expect(parsed.notes.map((note) => note.midi)).toEqual([52]);
    expect(parsed.trackNames).toEqual(["Rhythm Guitar", "Drums"]);
    expect([...bytes]).toEqual(expect.arrayContaining([0xc1, 30, 0x99, 36, 110]));
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

  it("keeps collision metadata deterministic when source notes are reordered", () => {
    const notes: Note[] = [
      { midi: 60, start: 0.01, dur: 0.4, vel: 72, hand: "R", identitySource: "guitar" },
      { midi: 60, start: 0.02, dur: 0.8, vel: 84, hand: "L", identitySource: "vocals" },
    ];
    const forward = quantize(notes, { grid: 0.25 });
    const reverse = quantize([...notes].reverse(), { grid: 0.25 });
    expect(reverse).toEqual(forward);
    expect(forward).toEqual([expect.objectContaining({
      midi: 60,
      start: 0,
      dur: 0.75,
      vel: 84,
      hand: "L",
      identitySource: "vocals",
    })]);
  });

  it("drops sub-minDur ghosts instead of inflating them", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 0.05, vel: 80 },
      { midi: 62, start: 0, dur: 0.5, vel: 80 },
      { midi: 64, start: 0.25, dur: 0.125, vel: 80 },
    ];
    const q = quantize(notes, { grid: 0.125, minDur: 0.125 });
    expect(q.map((n) => n.midi)).toEqual([62, 64]);
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

  it("uses the 25% note-count percentile directly when preferPercentile is set", () => {
    const notes: Note[] = [];
    for (let m = 36; m <= 72; m += 2) {
      notes.push({ midi: m, start: 0, dur: 1, vel: 80 });
    }
    const { lh, rh } = splitHands(notes, { preferPercentile: true });
    expect(lh.map((n) => n.midi)).toEqual([36, 38, 40, 42]);
    expect(rh).toHaveLength(15);
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

  it("revoices a one-staff chordal import for the learner profile", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 24; i++) {
      const start = i * 0.5;
      // A melody plus a low triad-like attack, all incorrectly labelled RH by
      // the source exporter. The learner profile should expose a useful LH
      // part without changing the source/default profile.
      notes.push({ midi: 72 + (i % 5), start, dur: 0.4, vel: 90, hand: "R" });
      notes.push({ midi: 48, start, dur: 0.4, vel: 70, hand: "R" });
      notes.push({ midi: 52, start, dur: 0.4, vel: 65, hand: "R" });
    }
    const input: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 100,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Piano"],
      durationBeats: 12,
    };
    const source = buildVariants(input, { title: "Source", artist: "Test" }).find((v) => v.level === "advanced")!;
    const learner = buildVariants(input, { title: "Learner", artist: "Test" }, { arrangementProfile: "learner" })
      .find((v) => v.level === "advanced")!;
    expect(source.notes.every((n) => n.hand !== "L")).toBe(true);
    expect(learner.notes.some((n) => n.hand === "L")).toBe(true);
    expect(learner.notes.some((n) => n.hand !== "L" && n.midi >= 72)).toBe(true);
  });

  it("keeps the lower principal melody when quiet high decorations alternate at the same Easy onsets", () => {
    const principal = [68, 68, 70, 68, 72, 72, 74, 72, 68, 68, 70, 68, 72, 72, 74, 72];
    const decorations = [76, 77, 76, 77, 76, 77, 76, 77, 76, 77, 76, 77, 76, 77, 76, 77];
    const notes = Array.from({ length: 16 }, (_, i) => {
      const start = i * 0.5;
      return [
        { midi: 40, start, dur: 0.4, vel: 90 },
        { midi: principal[i]!, start, dur: 0.4, vel: 105 },
        { midi: decorations[i]!, start, dur: 0.125, vel: 20 },
      ];
    }).flat();
    const variants = buildVariants(
      {
        format: 0,
        division: 480,
        tempoBpm: 120,
        keySig: 0,
        keyMode: 0,
        timeSig: [4, 4],
        notes,
        trackNames: ["Piano"],
        durationBeats: 8,
      },
      { title: "Principal melody", artist: "Test" },
      { arrangementProfile: "learner" },
    );
    const byLevel = new Map(variants.map((variant) => [variant.level, variant]));
    const rh = (level: "easy" | "medium" | "advanced") =>
      byLevel.get(level)!.notes.filter((note) => note.hand !== "L");
    const richRh = principal.flatMap((midi, i) => [midi, decorations[i]!]);

    expect(rh("advanced").map((note) => note.midi)).toEqual(richRh);
    expect(rh("medium").map((note) => note.midi)).toEqual(richRh);
    expect(rh("easy").map((note) => note.midi)).toEqual(principal);
  });

  it("does not let a sustained re-triggered pad displace a moving Easy melody", () => {
    const melody = [66, 67, 68, 69, 71, 72, 73, 74];
    const notes = melody.flatMap((midi, index) => [
      { midi, start: index * 0.5, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 70, start: index * 0.5, dur: 1, vel: 90, hand: "R" as const },
    ]);
    const variants = buildVariants(
      {
        format: 0,
        division: 480,
        tempoBpm: 120,
        keySig: 0,
        keyMode: 0,
        timeSig: [4, 4],
        notes,
        trackNames: ["Piano"],
        durationBeats: 4,
      },
      { title: "Moving melody and pad", artist: "Test" },
      { arrangementProfile: "learner", maxDurBeats: null },
    );
    const easy = variants.find((variant) => variant.level === "easy")!;
    expect(easy.notes.filter((note) => note.hand !== "L").map((note) => note.midi)).toEqual(melody);
  });

  it("preserves learner Easy harmonic pitch classes instead of collapsing every bass attack to the key", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 16; i++) {
      const start = i * 0.5;
      notes.push({ midi: 72 + (i % 2), start, dur: 0.4, vel: 90, hand: "R" });
      notes.push({ midi: i < 8 ? 48 : 55, start, dur: 0.4, vel: 70, hand: "L" });
      notes.push({ midi: i < 8 ? 52 : 59, start, dur: 0.4, vel: 65, hand: "L" });
    }
    const src: ParsedMidi = {
      format: 1,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["RH", "LH"],
      durationBeats: 8,
    };
    const variants = buildVariants(src, { title: "Learner harmony", artist: "Test", key: "C" }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
    });
    const easy = variants.find((variant) => variant.level === "easy")!;
    const medium = variants.find((variant) => variant.level === "medium")!;
    const easyLh = easy.notes.filter((note) => note.hand === "L");
    const mediumLh = medium.notes.filter((note) => note.hand === "L");
    expect(new Set(easyLh.map((note) => note.midi % 12))).toEqual(new Set(mediumLh.map((note) => note.midi % 12)));
    expect(new Set(easyLh.map((note) => note.midi % 12))).toEqual(new Set([0, 4, 7, 11]));
    expect(easyLh.length).toBeGreaterThanOrEqual(16);
  });

  it("emits deterministic learner lineage at the actual Easy boundaries", () => {
    const notes: Note[] = [
      { midi: 40, start: 0, dur: 0.4, vel: 70, hand: "L" },
      { midi: 68, start: 0, dur: 0.4, vel: 100, hand: "R" },
      { midi: 76, start: 0, dur: 0.125, vel: 20, hand: "R" },
      { midi: 70, start: 0.5, dur: 0.4, vel: 100, hand: "R" },
      { midi: 78, start: 0.5, dur: 0.125, vel: 20, hand: "R" },
    ];
    const input = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0 as const,
      timeSig: [4, 4] as [number, number],
      notes,
      trackNames: ["Piano"],
      durationBeats: 2,
    } satisfies ParsedMidi;
    const collect = (source: ParsedMidi) => {
      const trace: Array<{ key: string; stage: string; parentKeys: string[]; selected?: boolean; operation?: string; selectionReason?: string }> = [];
      buildVariants(source, { title: "Trace", artist: "Test" }, {
        arrangementProfile: "learner",
        trace: { record: (event) => trace.push(event) },
      });
      return trace;
    };
    const first = collect(input);
    const second = collect({ ...input, notes: [...notes].reverse() });
    expect(first).toEqual(second);
    expect(new Set(first.map((event) => event.stage))).toEqual(
      new Set([
        "raw", "cleaned", "learner-arranged", "advanced-candidates", "advanced-playable",
        "medium-candidates", "medium-playable", "easy-rh-input", "easy-lh-input", "onset-group",
        "selector-input", "easy-voice-selection", "decision", "easy-assembled", "easy-playable",
        "easy-ladder", "very-easy-rh-input", "very-easy-playable", "beginner-rh-input",
        "beginner-rh-selected", "beginner-assembled", "beginner-playable", "beginner-ladder",
        "beginner-final", "final", "difficulty",
      ]),
    );
    expect(first.some((event) => event.selected === false && event.stage !== "raw")).toBe(true);
    expect(first.filter((event) => event.stage !== "difficulty").every((event) => event.operation)).toBe(true);
    expect(first.filter((event) => event.selected === false).every((event) => event.selectionReason)).toBe(true);
    const lineage = first.filter((event) => event.stage !== "difficulty");
    const keys = new Set(lineage.map((event) => event.key));
    expect(lineage.every((event) => event.parentKeys.every((parent) => keys.has(parent)))).toBe(true);
    expect(first.filter((event) => event.stage === "difficulty")
      .every((event) => event.parentKeys.every((parent) => keys.has(parent)))).toBe(true);
    const easy = buildVariants(input, { title: "Trace", artist: "Test" }, {
      arrangementProfile: "learner",
      trace: { record: () => undefined },
    }).find((variant) => variant.level === "easy")!;
    expect(easy.notes.every((note) => !(note as Note & { learnerTraceRefs?: unknown }).learnerTraceRefs)).toBe(true);
  });

  it("records a collapsed parent set when quantization merges duplicate source attacks", () => {
    const input: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 60, start: 0.01, dur: 0.4, vel: 70 },
        { midi: 60, start: 0.02, dur: 0.8, vel: 80 },
        { midi: 72, start: 0.5, dur: 0.4, vel: 100 },
      ],
      trackNames: ["Piano"],
      durationBeats: 2,
    };
    const trace: Array<{ stage: string; parentKeys: string[]; operation?: string }> = [];
    buildVariants(input, { title: "Duplicate trace", artist: "Test" }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
      trace: { record: (event) => trace.push(event) },
    });
    const merged = trace.find((event) => event.stage === "learner-arranged" && event.operation === "MERGED");
    expect(merged).toBeDefined();
    expect(merged!.parentKeys).toHaveLength(2);
    expect(trace.filter((event) => event.stage === "raw")).toHaveLength(3);
  });

  it("classifies a learner range move as an octave shift", () => {
    const trace: Array<{ stage: string; operation?: string; parentKeys: string[] }> = [];
    const variants = buildVariants({
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 9, start: 0, dur: 1, vel: 90, hand: "R" },
        { midi: 60, start: 1, dur: 1, vel: 90, hand: "R" },
      ],
      trackNames: ["Range trace"],
      durationBeats: 2,
    }, { title: "Range trace", artist: "Test" }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
      trace: { record: (event) => trace.push(event) },
    });
    expect(trace.some((event) => event.operation === "OCTAVE_SHIFTED" && event.parentKeys.length > 0)).toBe(true);
    expect(variants.every((variant) => variant.notes.every((note) => note.midi >= 21 && note.midi <= 108))).toBe(true);
  });

  it("labels difficulty-stage timing changes and keeps all merged parents", () => {
    const trace: Array<{ stage: string; operation?: string; parentKeys: string[]; key: string }> = [];
    buildVariants({
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [{ midi: 60, start: 0, dur: 0.41, vel: 80, hand: "R" }],
      trackNames: ["Difficulty trace"],
      durationBeats: 2,
    }, { title: "Difficulty trace", artist: "Test" }, {
      arrangementProfile: "learner",
      trace: { record: (event) => trace.push(event) },
    });
    const changed = trace.find((event) => event.key.startsWith("difficulty:easy:"));
    expect(changed?.operation).toBe("DURATION_CHANGED");
    expect(changed?.parentKeys).toHaveLength(1);

    const mergedTrace: typeof trace = [];
    buildVariants({
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        { midi: 60, start: 0.01, dur: 0.4, vel: 70 },
        { midi: 60, start: 0.02, dur: 0.8, vel: 80 },
      ],
      trackNames: ["Difficulty merge trace"],
      durationBeats: 2,
    }, { title: "Difficulty merge trace", artist: "Test" }, {
      arrangementProfile: "learner",
      maxDurBeats: null,
      trace: { record: (event) => mergedTrace.push(event) },
    });
    const merged = mergedTrace.find((event) => event.key.startsWith("difficulty:easy:") && event.operation === "MERGED");
    expect(merged).toBeDefined();
    expect(merged?.parentKeys).toHaveLength(2);
  });

  it("keeps recurring mid-register accompaniment in the LH when the largest pitch gap is misleading", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 24; i++) {
      const start = i * 0.5;
      // This deliberately has a large bass-to-accompaniment gap. A largest-gap
      // split would cut between 35 and 47 and leave the recurring 47/54/59/64
      // chord tones in the RH. Learner rebalancing should keep those voices
      // together with the bass while leaving the high line in the RH.
      notes.push({ midi: 35, start, dur: 0.4, vel: 70 });
      notes.push({ midi: 47, start, dur: 0.4, vel: 70 });
      notes.push({ midi: 54, start, dur: 0.4, vel: 68 });
      notes.push({ midi: 59, start, dur: 0.4, vel: 66 });
      notes.push({ midi: 64, start, dur: 0.4, vel: 64 });
      notes.push({ midi: 72 + (i % 5), start, dur: 0.35, vel: 90 });
    }
    const input: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 100,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: [],
      durationBeats: 12,
    };
    notes.push({ midi: 35, start: 12.5, dur: 0.4, vel: 70 });
    const advanced = buildVariants(input, { title: "Mid accompaniment", artist: "Test" }, { arrangementProfile: "learner", audioDerived: true })
      .find((v) => v.level === "advanced")!;
    const lhGroups = new Map<number, Note[]>();
    for (const note of advanced.notes.filter((n) => n.hand === "L")) {
      const group = lhGroups.get(note.start) ?? [];
      group.push(note);
      lhGroups.set(note.start, group);
    }
    expect([...lhGroups.values()].some((group) => group.length >= 3)).toBe(true);
    expect(advanced.notes.some((n) => n.hand !== "L" && n.midi >= 72)).toBe(true);
    expect(advanced.notes.some((n) => n.start === 12.5 && n.midi === 35 && n.hand === "L")).toBe(true);
    const curated = buildVariants(input, { title: "Curated", artist: "Test" }, { arrangementProfile: "learner" })
      .find((v) => v.level === "advanced")!;
    expect(curated.warnings ?? []).not.toContain("learner inner-voice redistribution applied (inferred staff assignment)");
  });

  it("does not promote unsafe LH role evidence into generic learner Beginner", () => {
    const notes: Array<Note & { role?: string }> = [
      { midi: 72, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 74, start: 2, dur: 1, vel: 100, hand: "R" },
      { midi: 76, start: 4, dur: 1, vel: 100, hand: "R" },
      { midi: 78, start: 6, dur: 1, vel: 100, hand: "R" },
      { midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar", role: "structural-lh" },
      { midi: 41, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "guitar", role: "decorative" },
      { midi: 42, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "bass" as unknown as Note["identitySource"] },
      { midi: 42, start: 4, dur: 1, vel: 80, hand: "L", identitySource: "guitar", role: "repeated-filler" },
      { midi: 43, start: 6, dur: 1, vel: 80, hand: "L", identitySource: "guitar", role: "structural-lh" },
    ];
    const variants = buildVariants({
      format: 1,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["role-aware"],
      durationBeats: 8,
    }, { title: "Role-aware", artist: "Test" }, { arrangementProfile: "learner", maxDurBeats: null });
    const beginner = variants.find((variant) => variant.level === "beginner")!;
    expect(beginner.notes.filter((note) => note.hand === "L").map((note) => [note.start, note.midi])).toEqual([[0, 40], [6, 43]]);
  });

  it("keeps sparse semantic LH anchors in metal beginner levels without changing learner levels", () => {
    const notes: Note[] = [];
    const roots = [36, 43, 41, 48];
    for (let measure = 0; measure < 8; measure++) {
      const root = roots[measure % roots.length]!;
      for (let step = 0; step < 8; step++) {
        notes.push({
          midi: 72 + ((measure * 3 + step) % 7),
          start: measure * 4 + step * 0.5,
          dur: 0.5,
          vel: 92,
          hand: "R",
        });
      }
      // Repeated bass attacks model a driving metal part. Long tails exercise
      // the hand-aware sounding cap at the same attacks as the melody.
      for (let beat = 0; beat < 4; beat++) {
        notes.push({
          midi: root,
          start: measure * 4 + beat,
          dur: 3,
          vel: 76,
          hand: "L",
        });
      }
    }
    const input: ParsedMidi = {
      format: 1,
      division: 480,
      tempoBpm: 100,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Identity melody", "Harmony roots"],
      durationBeats: 32,
    };
    const learner = buildVariants(
      input,
      { title: "Learner", artist: "Test", key: "C" },
      { arrangementProfile: "learner" },
    );
    const metal = buildVariants(
      input,
      { title: "Metal", artist: "Test", key: "C" },
      { arrangementProfile: "metal" },
    );
    const byLevel = new Map(metal.map((variant) => [variant.level, variant]));
    const beginner = byLevel.get("beginner")!;
    const veryBeginner = byLevel.get("very-beginner")!;

    // Generic learner keeps the simplest tier melody-only, while the
    // promoted Beginner contract may add sparse structural LH anchors.
    const learnerVeryBeginner = learner.find((variant) => variant.level === "very-beginner")!;
    const learnerBeginner = learner.find((variant) => variant.level === "beginner")!;
    const learnerVeryEasy = learner.find((variant) => variant.level === "very-easy")!;
    expect(learnerVeryBeginner.notes.every((note) => note.hand !== "L")).toBe(true);
    const learnerLh = learnerBeginner.notes.filter((note) => note.hand === "L");
    expect(learnerLh).toHaveLength(8);
    expect(new Set(learnerLh.map((note) => Math.floor(note.start / 4))).size).toBe(8);
    expect(learnerLh.every((note) => learnerVeryEasy.notes.some((candidate) => (
      candidate.hand === "L"
      && candidate.start === note.start
      && candidate.midi === note.midi
      && candidate.dur === note.dur
      && candidate.vel === note.vel
    )))).toBe(true);
    expect(learnerLh.every((note) => note.identitySource !== "other" && note.identitySource !== "vocals")).toBe(true);
    // Metal levels retain one playable harmonic task for the LH.
    for (const variant of [veryBeginner, beginner]) {
      expect(variant.notes.some((note) => note.hand === "L"), variant.level).toBe(true);
      expect(variant.notes.some((note) => note.hand !== "L"), variant.level).toBe(true);
      expect(variant.bassPattern).toBe("block");
      const events = variant.notes
        .flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let sounding = 0;
      let maxSounding = 0;
      for (const [, delta] of events) {
        sounding += delta;
        maxSounding = Math.max(maxSounding, sounding);
      }
      expect(maxSounding, variant.level).toBeLessThanOrEqual(2);
      // Every sampled bass attack coincides with a protected identity attack;
      // the two-finger cap must never let its lower-pitch sort order erase RH.
      for (const lh of variant.notes.filter((note) => note.hand === "L")) {
        expect(variant.notes.some((note) => note.hand !== "L" && note.start === lh.start)).toBe(true);
      }
    }

    // The role-aware route preserves the supplied harmonic progression rather
    // than collapsing every easy-level bass pitch onto the global key tonic.
    expect(new Set(byLevel.get("easy")!.notes.filter((note) => note.hand === "L").map((note) => note.midi % 12)).size)
      .toBeGreaterThan(1);
    // LH and RH semantic anchors stay traceable through adjacent tiers.
    for (let i = 0; i < metal.length - 1; i++) {
      const harder = new Set(metal[i + 1]!.notes.map((note) => `${note.hand}:${note.midi}@${note.start.toFixed(3)}`));
      for (const note of metal[i]!.notes) {
        expect(harder.has(`${note.hand}:${note.midi}@${note.start.toFixed(3)}`), `${metal[i]!.level} ${note.hand}`).toBe(true);
      }
    }
    expect(validateVariants(metal)).toEqual([]);
    expect(verifyMonotonicity(metal)).toEqual([]);
  });

  it("does not invent metal LH attacks when coarse grids quantize accompaniment", () => {
    const notes: Note[] = [
      ...Array.from({ length: 48 }, (_, index) => ({
        midi: 72 + (index % 5),
        start: index * 0.5,
        dur: 0.35,
        vel: 90,
        hand: "R" as const,
      })),
      ...Array.from({ length: 16 }, (_, index) => ({
        midi: [36, 43, 41, 48][index % 4]!,
        // Deliberately place the bass just off the quarter grid. The
        // semantic ladder may snap it, but only to an attack in the next
        // harder level.
        start: index + 0.125,
        dur: 0.75,
        vel: 74,
        hand: "L" as const,
      })),
    ];
    const input: ParsedMidi = {
      format: 1,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Right Hand", "Left Hand"],
      durationBeats: 16,
    };
    const variants = buildVariants(input, { title: "Off-grid metal", artist: "Tests" }, { arrangementProfile: "metal" });
    for (let index = 0; index < variants.length - 1; index++) {
      const easier = variants[index]!;
      const harder = new Set(variants[index + 1]!.notes.map((note) => `${note.hand}:${note.midi}@${note.start.toFixed(3)}`));
      for (const note of easier.notes.filter((candidate) => candidate.hand === "L")) {
        expect(harder.has(`${note.hand}:${note.midi}@${note.start.toFixed(3)}`), `${easier.level} LH`).toBe(true);
      }
    }
    expect(validateVariants(variants)).toEqual([]);
  });

  it("keeps learner advanced sounding notes within an eight-finger budget", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 12; j++) {
        notes.push({ midi: 36 + j * 4, start: i, dur: 4, vel: 70, hand: j < 6 ? "L" : "R" });
      }
    }
    const input: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 90,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["LH", "RH"],
      durationBeats: 35,
    };
    const advanced = buildVariants(input, { title: "Dense", artist: "Test" }, { arrangementProfile: "learner" })
      .find((v) => v.level === "advanced")!;
    const events = advanced.notes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0;
    let max = 0;
    for (const [, delta] of events) {
      active += delta;
      max = Math.max(max, active);
    }
    expect(max).toBeLessThanOrEqual(8);
  });

  it("falls back from an implausible source tempo before validation", () => {
    const notes = Array.from({ length: 16 }, (_, i) => ({
      midi: 60 + (i % 4),
      start: i * 0.5,
      dur: 0.5,
      vel: 80,
    }));
    const variants = buildVariants(
      {
        format: 0,
        division: 480,
        tempoBpm: 16,
        keySig: 0,
        keyMode: 0,
        timeSig: [4, 4],
        notes,
        trackNames: ["Tempo fixture"],
        durationBeats: 8,
      },
      { title: "Tempo fixture", artist: "Test" },
    );
    expect(new Set(variants.map((v) => v.tempoBpm))).toEqual(new Set([120]));
    expect(validateVariants(variants)).toEqual([]);
    const overridden = buildVariants(
      {
        format: 0,
        division: 480,
        tempoBpm: 16,
        keySig: 0,
        keyMode: 0,
        timeSig: [4, 4],
        notes,
        trackNames: ["Tempo fixture"],
        durationBeats: 8,
      },
      { title: "Tempo fixture", artist: "Test", tempo: 100 },
    );
    expect(new Set(overridden.map((v) => v.tempoBpm))).toEqual(new Set([100]));
  });

  it("separates medium from advanced on a 16th-note run", () => {
    // quarter-note bass keeps the hand split gap-based (no percentile fallback)
    const notes: Note[] = [];
    for (let b = 0; b < 16; b++) notes.push({ midi: 36, start: b * 0.25, dur: 0.25, vel: 80 });
    for (let i = 0; i < 32; i++) {
      notes.push({ midi: 76, start: i * 0.125, dur: 0.125, vel: 80 });
      if (i % 2 === 1) {
        // passing inner voice (70) plus a protected bass note (67) under the top (76)
        notes.push({ midi: 71, start: i * 0.125, dur: 0.125, vel: 80 });
        notes.push({ midi: 67, start: i * 0.125, dur: 0.125, vel: 80 });
      }
    }
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Run"],
      durationBeats: 4,
    };
    const variants = buildVariants(src, { title: "Run", artist: "Test" });
    const advanced = variants.find((v) => v.level === "advanced")!;
    const medium = variants.find((v) => v.level === "medium")!;
    expect(medium.notes.length).toBeLessThan(advanced.notes.length);
    // only passing inner voices vanished; slice top (76) and bottom (67) survive,
    // and the final chord's inner voice has no following onset, so it is kept
    for (const n of advanced.notes) {
      const k = Math.round(n.start / 0.125);
      const nextOnset = advanced.notes
        .filter((m) => m.hand === n.hand && m.start > n.start + 1e-9)
        .map((m) => m.start)
        .sort((a, b) => a - b)[0];
      const isPassing = nextOnset !== undefined && nextOnset - n.start < 0.25;
      const shouldDrop = n.dur <= 0.25 && k % 2 === 1 && n.midi === 71 && isPassing;
      expect(medium.notes.some((m) => m.midi === n.midi && m.start === n.start)).toBe(!shouldDrop);
    }
  });

  it("excludes short passing tones from chord labels", () => {
    const notes: Note[] = [
      { midi: 36, start: 0, dur: 4, vel: 80 },
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 67, start: 0, dur: 1, vel: 80 },
      { midi: 62, start: 0.125, dur: 0.125, vel: 80 },
      { midi: 65, start: 1, dur: 1, vel: 80 },
      { midi: 69, start: 1, dur: 1, vel: 80 },
      { midi: 72, start: 1, dur: 1, vel: 80 },
    ];
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Pass"],
      durationBeats: 4,
    };
    for (const v of buildVariants(src, { title: "Pass", artist: "Test" })) {
      for (const c of v.chords) expect(c.notes).not.toContain(62);
    }
  });

  it("stamps generated chord provenance and keeps absolute voicings canonical", () => {
    const makeVariants = (notes: Note[]) => buildVariants({
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Generated chord"],
      durationBeats: 4,
    }, { title: "Generated chord", artist: "Test" });
    const input: Note[] = [
      { midi: 67, start: 0, dur: 1, vel: 80 },
      { midi: 60, start: 0, dur: 1, vel: 80 },
      { midi: 64, start: 0, dur: 1, vel: 80 },
      { midi: 60, start: 0, dur: 1, vel: 80 },
    ];
    const variants = makeVariants(input);
    const chords = variants.flatMap((variant) => variant.chords);
    expect(chords.length).toBeGreaterThan(0);
    expect(chords.every((chord) => chord.sourceKind === "generated")).toBe(true);
    for (const chord of chords) {
      expect(chord.notes).toEqual([...new Set(chord.notes)].sort((a, b) => a - b));
    }

    // Reordering equivalent source notes must not change the generated chord
    // event or its absolute MIDI voicing.
    const reordered = makeVariants([...input].reverse()).map((variant) => variant.chords);
    expect(reordered).toEqual(variants.map((variant) => variant.chords));
  });

  const shortLhStackSource = (notes: Note[]): ParsedMidi => ({
    format: 1,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["Piano LH"],
    durationBeats: 2,
  });

  const repeatedShortG5 = [0, 0.5, 1, 1.5].flatMap((start) => [
    { midi: 43, start, dur: 0.125, vel: 82, hand: "L" as const },
    { midi: 50, start, dur: 0.125, vel: 78, hand: "L" as const },
    { midi: 55, start, dur: 0.125, vel: 76, hand: "L" as const },
  ]);

  it("keeps stable short LH chord stacks for symbolic sources", () => {
    const advanced = buildVariants(
      shortLhStackSource(repeatedShortG5),
      { title: "Short stacks", artist: "Test" },
      { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null },
    ).find((variant) => variant.level === "advanced")!;

    expect(advanced.chords).toEqual([
      expect.objectContaining({
        beat: 0,
        name: "G5",
        notes: [43, 50, 55],
        sourceKind: "generated",
        durationBeats: 2,
      }),
    ]);
  });

  it("does not promote short LH detector stacks into generated chords", () => {
    const advanced = buildVariants(
      shortLhStackSource(repeatedShortG5),
      { title: "Detector stacks", artist: "Test" },
      { arrangementProfile: "learner", audioDerived: true },
    ).find((variant) => variant.level === "advanced")!;

    expect(advanced.chords).toEqual([]);
  });

  it("does not combine short isolated LH notes into chord churn", () => {
    const passing: Note[] = [0, 0.5, 1, 1.5].map((start, index) => ({
      midi: index % 2 ? 50 : 43,
      start,
      dur: 0.125,
      vel: 76,
      hand: "L",
    }));
    const forward = buildVariants(
      shortLhStackSource(passing),
      { title: "Passing tones", artist: "Test" },
      { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null },
    ).find((variant) => variant.level === "advanced")!;
    const reversed = buildVariants(
      shortLhStackSource([...passing].reverse()),
      { title: "Passing tones", artist: "Test" },
      { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null },
    ).find((variant) => variant.level === "advanced")!;

    expect(forward.chords).toEqual([]);
    expect(reversed.chords).toEqual(forward.chords);
  });

  it("does not use short RH notes to complete a short LH chord stack", () => {
    const notes: Note[] = [0, 0.5, 1, 1.5].flatMap((start) => [
      { midi: 43, start, dur: 0.125, vel: 78, hand: "L" },
      { midi: 50, start, dur: 0.125, vel: 78, hand: "R" },
      { midi: 55, start, dur: 0.125, vel: 78, hand: "R" },
    ]);
    const advanced = buildVariants(
      shortLhStackSource(notes),
      { title: "Mixed hands", artist: "Test" },
      { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null },
    ).find((variant) => variant.level === "advanced")!;

    expect(advanced.chords).toEqual([]);
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

    for (const [key, pitchClass] of [["F# minor", 6], ["Cb", 11]] as const) {
      const keyed = buildVariants(src, { title: key, artist: "T", key });
      for (const level of ["easy", "very-easy"] as const) {
        const bass = keyed.find((variant) => variant.level === level)!.notes.filter((note) => note.hand === "L");
        expect(bass.length).toBeGreaterThan(0);
        expect(bass.every((note) => note.midi % 12 === pitchClass)).toBe(true);
      }
    }
  });

  it("caps fast scalar variants without breaking the RH ladder", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 256; i++) {
      notes.push({ midi: 60 + (i % 8), start: i * 0.125, dur: 0.125, vel: 80 });
    }
    const fast: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 180,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Fast"],
      durationBeats: 32,
    };
    const variants = buildVariants(fast, { title: "Fast", artist: "Test" });
    expect(validateVariants(variants)).toEqual([]);
    const keys = (ns: Note[]) => new Set(ns.filter((n) => n.hand !== "L").map((n) => `${n.midi}@${n.start.toFixed(3)}`));
    for (let i = 0; i < variants.length - 1; i++) {
      const harder = keys(variants[i + 1]!.notes);
      for (const key of keys(variants[i]!.notes)) expect(harder.has(key)).toBe(true);
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

  it("keeps both hands for a dense curated Piano arrangement", () => {
    // Curated piano arrangements can have a continuous pitch range and high
    // overlap without being an AI transcription wall. The source track name
    // is the signal that this material should still receive a normal hand
    // split rather than forcing every note onto the right-hand staff.
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 75,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: Array.from({ length: 16 }, (_, i) => ({
        midi: 48 + i,
        start: 0,
        dur: 1,
        vel: 80,
      })),
      trackNames: ["Piano"],
      durationBeats: 1,
    };
    const advanced = buildVariants(src, { title: "Piano", artist: "Test" }).find((v) => v.level === "advanced")!;
    expect(advanced.notes.some((n) => n.hand === "L")).toBe(true);
    expect(advanced.notes.some((n) => n.hand === "R")).toBe(true);
  });

  it("does not replace explicit cross-handed staff labels with pitch splitting", () => {
    const src: ParsedMidi = {
      format: 1,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: [
        ...Array.from({ length: 8 }, (_, i) => ({ midi: 48 + (i % 2), start: i, dur: 0.5, vel: 80, hand: "R" as const })),
        ...Array.from({ length: 8 }, (_, i) => ({ midi: 72 + (i % 2), start: i, dur: 0.5, vel: 80, hand: "L" as const })),
      ],
      trackNames: ["RH", "LH"],
      durationBeats: 8,
    };
    const advanced = buildVariants(src, { title: "Cross-handed", artist: "Test" }).find((v) => v.level === "advanced")!;
    expect(advanced.notes.filter((n) => n.midi < 60).every((n) => n.hand === "R")).toBe(true);
    expect(advanced.notes.filter((n) => n.midi > 60).every((n) => n.hand === "L")).toBe(true);
  });

  it("does not create same-pitch overlaps while reducing a curated piano import", () => {
    // Dear God's source MIDI has clean, sequential bass re-attacks. Snapping
    // the advanced/medium LH to a quarter grid moves adjacent eighth-grid
    // attacks onto each other, so the player retriggers the same oscillator
    // while the previous one is still ringing. Keep this small fixture shaped
    // like that source to make the regression independent of the binary seed.
    const notes: Note[] = [
      { midi: 41, start: 0.125, dur: 0.375, vel: 80 },
      { midi: 41, start: 0.5, dur: 3, vel: 80 },
      ...Array.from({ length: 6 }, (_, i) => ({ midi: 43 + i, start: i + 1, dur: 0.25, vel: 80 })),
      ...Array.from({ length: 24 }, (_, i) => ({ midi: 72 + (i % 8), start: i * 0.25, dur: 0.125, vel: 80 })),
    ];
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 75,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Piano"],
      durationBeats: 8,
    };
    const overlaps = (input: Note[]) => {
      const byPitchHand = new Map<string, Note[]>();
      const out: [Note, Note][] = [];
      for (const n of input) {
        const key = `${n.midi}:${n.hand ?? "?"}`;
        const prior = byPitchHand.get(key) ?? [];
        for (const p of prior) if (p.start + p.dur > n.start + 1e-9) out.push([p, n]);
        prior.push(n);
        byPitchHand.set(key, prior);
      }
      return out;
    };
    expect(overlaps(notes)).toHaveLength(0);
    for (const variant of buildVariants(src, { title: "Dear God fixture", artist: "Dadebrayant" })) {
      expect(overlaps(variant.notes), variant.level).toHaveLength(0);
    }
  });

  it("can cap transcription tails without moving melodic attacks", () => {
    const notes: Note[] = Array.from({ length: 24 }, (_, i) => ({
      midi: 60 + (i % 8),
      start: i * 0.5,
      dur: 3,
      vel: 80,
    }));
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 75,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: [],
      durationBeats: 15,
    };
    const advanced = buildVariants(src, { title: "Audio import", artist: "Test" }, { maxDurBeats: 1.5 })
      .find((v) => v.level === "advanced")!;
    expect(Math.max(...advanced.notes.map((n) => n.dur))).toBeLessThanOrEqual(1.5);
    expect(advanced.notes.map((n) => n.start)).toContain(0);
    expect(advanced.notes.map((n) => n.start)).toContain(5.5);
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

  it("interprets inter-onset and density limits in seconds at the source tempo", () => {
    const starts = [0, 0.25, 0.5, 0.75, 1, 2, 3, 4];
    const make = (tempoBpm: number): Variant => ({
      level: "advanced",
      difficultyScore: 4.6,
      notes: starts.map((start, i) => ({ midi: 60 + i, start, dur: 0.125, vel: 80, hand: "R" as const })),
      chords: [],
      bassPattern: "none",
      key: "C",
      tempoBpm,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }],
    });
    expect(validateVariants([make(60)])).toEqual([]);
    expect(validateVariants([make(240)]).some((e) => e.includes("inter-onset"))).toBe(true);
  });
});

describe("import sanitization", () => {
  const soundingCount = (notes: Note[]) => {
    const events = notes
      .flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0;
    let max = 0;
    for (const [, delta] of events) {
      active += delta;
      max = Math.max(max, active);
    }
    return max;
  };

  it("caps long standard-import sustains before variant generation", () => {
    const notes: Note[] = [
      { midi: 34, start: 0, dur: 100, vel: 80 },
      ...Array.from({ length: 20 }, (_, i) => ({
        midi: 38 + (i % 3),
        start: i * 2,
        dur: 1,
        vel: 80,
      })),
    ];
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: [],
      durationBeats: 100,
    };
    const variants = buildVariants(src, { title: "Drone", artist: "Test" });
    expect(variants.every((v) => Math.max(...v.notes.map((n) => n.dur)) <= 8)).toBe(true);
  });

  it("preserves long human-authored sustains when the source opts out of capping", () => {
    const notes: Note[] = [
      { midi: 34, start: 0, dur: 100, vel: 80, hand: "L" },
      ...Array.from({ length: 20 }, (_, i) => ({
        midi: 72 + (i % 3),
        start: i * 2,
        dur: 1,
        vel: 80,
        hand: "R" as const,
      })),
    ];
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: ["Right Hand", "Left Hand"],
      durationBeats: 100,
    };
    const variants = buildVariants(src, { title: "Human sustain", artist: "Test" }, { maxDurBeats: null });
    const advanced = variants.find((v) => v.level === "advanced")!;
    expect(advanced.notes.some((n) => n.midi === 34 && n.dur >= 100)).toBe(true);
    expect(validateVariants(variants, { maxDurBeats: null })).toEqual([]);
  });

  it("records octave normalization instead of hiding out-of-range source pitches", () => {
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes: Array.from({ length: 8 }, (_, i) => ({ midi: i === 0 ? 12 : 60 + i, start: i, dur: 0.5, vel: 80 })),
      trackNames: [],
      durationBeats: 8,
    };
    const variants = buildVariants(src, { title: "Range", artist: "Test" });
    expect(variants.every((v) => v.warnings?.some((w) => w.includes("octave-normalized")))).toBe(true);
    expect(variants.every((v) => v.notes.every((n) => n.midi >= 21 && n.midi <= 108))).toBe(true);
  });

  it("caps staggered sounding walls without removing reasonable legato", () => {
    const wall = Array.from({ length: 16 }, (_, i) => ({
      midi: 40 + i,
      start: i * 0.5,
      dur: 8,
      vel: 80,
    }));
    const sanitized = sanitizeImportedNotes(wall, { tempoBpm: 120, maxSounding: 12 });
    expect(soundingCount(sanitized)).toBeLessThanOrEqual(12);

    const legato: Note[] = [
      { midi: 60, start: 0, dur: 4, vel: 80 },
      { midi: 64, start: 1, dur: 4, vel: 80 },
    ];
    expect(sanitizeImportedNotes(legato, { tempoBpm: 120 })).toEqual(legato);
  });

  it("preserves explicit hand labels instead of re-splitting by pitch", () => {
    const labeled: Note[] = [
      { midi: 36, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 84, start: 1, dur: 1, vel: 80, hand: "L" },
    ];
    const sanitized = sanitizeImportedNotes(labeled, { maxDurBeats: 8 });
    expect(sanitized.map((n) => [n.midi, n.hand])).toEqual([
      [36, "R"],
      [84, "L"],
    ]);
  });

  it("does not stretch short imported re-attacks to a quarter beat", () => {
    const sanitized = sanitizeImportedNotes(
      [
        { midi: 60, start: 0, dur: 4, vel: 80, hand: "R" },
        { midi: 64, start: 0.125, dur: 4, vel: 80, hand: "R" },
      ],
      { tempoBpm: 120, maxDurBeats: 2 },
    );
    expect(sanitized.find((n) => n.midi === 60)?.dur).toBeCloseTo(0.125, 6);
    expect(sanitized.find((n) => n.midi === 64)?.dur).toBeCloseTo(2, 6);
  });
});

describe("reduceMediumRhythm", () => {
  it("reduces scalar 16th-note runs to eighth notes", () => {
    const notes: Note[] = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75].map((start, i) => ({
      midi: [72, 74, 76, 77, 79, 81, 83][i]!,
      start,
      dur: 0.125,
      vel: 80,
      hand: "R" as const,
    }));
    const out = reduceMediumRhythm(notes);
    expect(out.map((n) => [n.midi, n.start])).toEqual([
      [72, 0],
      [76, 0.25],
      [79, 0.5],
      [83, 0.75],
    ]);
  });

  it("keeps LH bass roots on short off-eighth chords", () => {
    const notes: Note[] = [
      { midi: 36, start: 0.125, dur: 0.125, vel: 80, hand: "L" },
      { midi: 43, start: 0.125, dur: 0.125, vel: 80, hand: "L" },
      { midi: 50, start: 0.125, dur: 0.125, vel: 80, hand: "L" },
      { midi: 36, start: 0.25, dur: 0.125, vel: 80, hand: "L" },
      { midi: 43, start: 0.25, dur: 0.125, vel: 80, hand: "L" },
      { midi: 50, start: 0.25, dur: 0.125, vel: 80, hand: "L" },
    ];
    const out = reduceMediumRhythm(notes);
    expect(out.filter((n) => n.start === 0.125).map((n) => n.midi).sort()).toEqual([36, 50]);
    expect(out.filter((n) => n.start === 0.25)).toHaveLength(3);
  });

  it("keeps short off-eighth notes whose next same-hand onset is at least 0.25 away", () => {
    const notes: Note[] = [
      { midi: 76, start: 0.125, dur: 0.125, vel: 80, hand: "R" },
      { midi: 76, start: 0.5, dur: 0.5, vel: 80, hand: "R" },
    ];
    const out = reduceMediumRhythm(notes);
    expect(out).toHaveLength(2);
  });
});

describe("cleanTranscription", () => {
  it("keeps cleanup defaults and effective duration ceilings inspectable for provenance", () => {
    expect(TRANSCRIPTION_CLEANUP_CONFIG).toEqual({
      minVelocity: 30,
      minDurationBeats: 0.14,
      mergeWindowBeats: 0.125,
      maxPolyphony: 6,
      maxSounding: 8,
      maxDurationSec: 2.5,
    });
    expect(transcriptionMaxDurationBeats(120)).toBe(5);
    expect(transcriptionMaxDurationBeats(75)).toBe(3);
  });

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
      { midi: 67, start: 0, dur: 0.5, vel: 70 },
    ];
    const out = cleanTranscription(notes);
    expect(out.find((n) => n.midi === 60)!.dur).toBe(2);
    expect(out.find((n) => n.midi === 64)!.dur).toBe(0.5);
  });

  it("scales the duration ceiling with the median input duration", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 300, vel: 80 },
      { midi: 64, start: 0, dur: 4, vel: 70 },
      { midi: 67, start: 0, dur: 4, vel: 70 },
    ];
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0 });
    expect(out.find((n) => n.midi === 60)!.dur).toBe(8);
    expect(out.find((n) => n.midi === 64)!.dur).toBe(4);
  });

  it("honors an explicit maxDurBeats override", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 300, vel: 80 },
      { midi: 64, start: 0, dur: 4, vel: 70 },
    ];
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0, maxDurBeats: 3 });
    expect(out.find((n) => n.midi === 60)!.dur).toBe(3);
    expect(out.find((n) => n.midi === 64)!.dur).toBe(3);
  });

  it("keeps legato overlaps that stay under the duration ceiling", () => {
    const notes: Note[] = [
      { midi: 36, start: 0, dur: 3, vel: 80 },
      { midi: 76, start: 0, dur: 0.5, vel: 70 },
      { midi: 40, start: 1, dur: 1, vel: 70 },
    ];
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0, maxDurBeats: 4 });
    expect(out.find((n) => n.midi === 36)!.dur).toBe(3);
    expect(out.find((n) => n.midi === 40)!.dur).toBe(1);
  });

  it("truncates a drone past the ceiling back to the next attack", () => {
    const notes: Note[] = [
      { midi: 36, start: 0, dur: 300, vel: 80 },
      { midi: 76, start: 0, dur: 0.5, vel: 70 },
      { midi: 40, start: 1, dur: 1, vel: 70 },
    ];
    const out = cleanTranscription(notes, { minVel: 0, minDurBeats: 0, maxDurBeats: 4 });
    expect(out.find((n) => n.midi === 36)!.dur).toBe(1);
    expect(out.find((n) => n.midi === 40)!.dur).toBe(1);
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

  it("preserves short 16th-note durations in MusicXML", () => {
    const v: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 0.125, vel: 80, hand: "R" },
        { midi: 62, start: 0.125, dur: 0.125, vel: 80, hand: "R" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const parsed = parseMusicXmlNotes(writeMusicXml(v, "T", "A"));
    expect(parsed.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 0.125],
      [62, 0.125, 0.125],
    ]);
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

describe("padPitches + pad-aware voice selection", () => {
  function src(notes: Note[]): ParsedMidi {
    return {
      format: 0,
      division: 480,
      tempoBpm: 120,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: [],
      durationBeats: Math.max(...notes.map((n) => n.start + n.dur)),
    };
  }

  it("flags pitches sounding >= 30% of the song", () => {
    const notes: Note[] = [
      { midi: 88, start: 0, dur: 30, vel: 80, hand: "R" }, // 30/30 = 100%
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 62, start: 1, dur: 1, vel: 80, hand: "R" },
      { midi: 64, start: 2, dur: 1, vel: 80, hand: "R" },
      { midi: 65, start: 3, dur: 1, vel: 80, hand: "R" },
    ];
    const pads = padPitches(notes);
    expect(pads.has(88)).toBe(true);
    expect(pads.has(60)).toBe(false);
  });

  it("handles very large imported note arrays without argument-stack overflow", () => {
    const notes = Array.from({ length: 130_000 }, (_, index) => ({
      midi: 60 + (index % 12),
      start: index * 0.125,
      dur: 0.125,
      vel: 80,
    }));
    expect(() => padPitches(notes)).not.toThrow();
  });

  it("prefers a moving melody over a re-triggered pad in the same hand", () => {
    const pads = new Set([70]);
    const notes: Note[] = [
      { midi: 70, start: 1, dur: 1, vel: 90, hand: "R" },
      { midi: 66, start: 1, dur: 0.5, vel: 80, hand: "R" },
      { midi: 70, start: 2, dur: 1, vel: 90, hand: "R" },
      { midi: 67, start: 2, dur: 0.5, vel: 80, hand: "R" },
      { midi: 70, start: 3, dur: 1, vel: 90, hand: "R" },
      { midi: 68, start: 3, dur: 0.5, vel: 80, hand: "R" },
      { midi: 70, start: 9, dur: 1, vel: 90, hand: "R" },
      { midi: 70, start: 10, dur: 1, vel: 90, hand: "R" },
    ];
    const out = melodyOnly(notes, 0.125, 0.5, pads);
    const padNotes = out.filter((n) => n.midi === 70);
    // Pad is only the melody where nothing else sounds (9+).
    expect(padNotes.length).toBeGreaterThan(0);
    expect(padNotes.every((n) => n.start >= 9)).toBe(true);
    const melodyMidis = out.filter((n) => n.midi < 70).map((n) => n.midi);
    expect(melodyMidis.sort()).toEqual([66, 67, 68]);
  });

  it("ranks pad voices below real voices in the advanced variant", () => {
    const pad: Note = { midi: 88, start: 0, dur: 32, vel: 90, hand: "R" };
    const chord: Note[] = [
      { midi: 60, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 64, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 67, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 72, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 76, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 79, start: 0, dur: 4, vel: 80, hand: "R" },
    ];
    const advanced = buildVariants(src([pad, ...chord]), { title: "t", artist: "a" }).find((v) => v.level === "advanced")!;
    // Six non-pad voices sound in the slice; topVoices keeps 4 of them and the
    // pad (highest pitch) must not displace a real voice.
    expect(advanced.notes.some((n) => n.midi === 88)).toBe(false);
  });
});

describe("writeMidi same-pitch pairing", () => {
  function rt(notes: Note[]): Note[] {
    const buf = writeMidi(notes, { tempoBpm: 120 });
    return parseMidi(buf).notes;
  }

  it("preserves sequential same-pitch note durations", () => {
    const notes: Note[] = [
      { midi: 41, start: 0, dur: 8, vel: 80, hand: "R" },
      { midi: 41, start: 9, dur: 2, vel: 80, hand: "R" },
    ];
    const back = rt(notes);
    expect(back).toHaveLength(2);
    expect(back[0]!.dur).toBeCloseTo(8, 2);
    expect(back[1]!.dur).toBeCloseTo(2, 2);
    expect(back[1]!.start).toBeCloseTo(9, 2);
  });

  it("preserves a genuinely overlapping re-strike at the new attack", () => {
    const notes: Note[] = [
      { midi: 41, start: 0, dur: 8, vel: 80, hand: "R" },
      { midi: 41, start: 2, dur: 8, vel: 80, hand: "R" },
    ];
    const back = rt(notes);
    expect(back).toHaveLength(2);
    expect(back[0]!.dur).toBeCloseTo(8, 2);
    expect(back[1]!.dur).toBeCloseTo(8, 2);
  });

  it("does not stretch an ended note when a later same-pitch note starts", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 4, vel: 80, hand: "R" },
      { midi: 60, start: 10, dur: 4, vel: 80, hand: "R" },
      { midi: 60, start: 20, dur: 4, vel: 80, hand: "R" },
    ];
    const back = rt(notes);
    expect(back.map((n) => n.dur)).toEqual([4, 4, 4].map((d) => expect.closeTo(d, 2)));
  });
});

describe("artifact roundtrip validation", () => {
  it("accepts nested same-pitch MIDI and short MusicXML notes", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 8, vel: 80, hand: "R" },
        { midi: 60, start: 2, dur: 2, vel: 70, hand: "R" },
        { midi: 64, start: 0, dur: 0.125, vel: 80, hand: "R" },
        { midi: 67, start: 0.125, dur: 0.125, vel: 80, hand: "R" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
    };
    expect(validateArtifactRoundtrip(variant, "T", "A")).toEqual([]);
  });

  it("keeps fractional BPM consistent across MIDI, MusicXML, and artifact validation", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120.25,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const artifacts = writeVariantArtifacts(variant, "T", "A");
    const parsedMidi = parseMidi(artifacts.midi);
    const parsedXml = parseMusicXmlNotes(artifacts.xml);
    // SMF stores integer microseconds per quarter note, so its parsed BPM is
    // close rather than bit-identical; MusicXML preserves the decimal value.
    expect(parsedMidi.tempoBpm).toBeCloseTo(variant.tempoBpm, 3);
    expect(parsedXml.tempoBpm).toBe(variant.tempoBpm);
    expect(validateArtifactFiles(variant, artifacts)).toEqual([]);
  });

  it("rejects stale MIDI tempo metadata while allowing MIDI tempo encoding quantization", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 142,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const good = writeVariantArtifacts(variant, "T", "A");
    // MIDI's microseconds-per-quarter representation rounds the encoded BPM
    // slightly; this is valid and must not make every 142-BPM artifact fail.
    expect(validateArtifactFiles(variant, good)).toEqual([]);

    const staleMidi = writeMidi(variant.notes, { tempoBpm: 141 });
    const issues = validateArtifactFiles(variant, { ...good, midi: staleMidi });
    expect(issues.some((issue) => issue.startsWith("midi roundtrip: tempo "))).toBe(true);
  });

  it("rejects stale MusicXML metronome tempo metadata", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const good = writeVariantArtifacts(variant, "T", "A");
    const staleXml = good.xml.replace("<per-minute>120</per-minute>", "<per-minute>119</per-minute>");
    const issues = validateArtifactFiles(variant, { ...good, xml: staleXml });
    expect(issues.some((issue) => issue.startsWith("xml roundtrip: tempo "))).toBe(true);
  });
});

describe("cleanTranscription seconds-based ceiling", () => {
  function padNotes(dur: number): Note[] {
    return [
      { midi: 40, start: 0, dur, vel: 90, hand: "R" },
      { midi: 41, start: 0.5, dur, vel: 90, hand: "R" },
      { midi: 42, start: 1, dur, vel: 90, hand: "R" },
      { midi: 43, start: 1.5, dur, vel: 90, hand: "R" },
      { midi: 44, start: 2, dur, vel: 90, hand: "R" },
    ];
  }

  it("caps durations by seconds, not beats, when the tempo is known", () => {
    // 2.5s at 75 BPM = ~3 beats; at 150 BPM = ~6 beats.
    const slow = cleanTranscription(padNotes(20), { tempoBpm: 75 });
    expect(Math.max(...slow.map((n) => n.dur))).toBeLessThanOrEqual(3.01);
    const fast = cleanTranscription(padNotes(20), { tempoBpm: 150 });
    expect(Math.max(...fast.map((n) => n.dur))).toBeGreaterThan(3);
  });
});

describe("buildVariants ladder recovery", () => {
  it("does not mistake eight LH anchors for a complete semantic beginner level", () => {
    // The coarse beginner reduction can lose an off-grid RH attack while its
    // sparse LH anchors still match the harder level.  A semantic two-hand
    // fallback must recover the RH task whenever the harder tier has one;
    // counting only the combined note total would incorrectly accept an
    // LH-only learner level.
    const notes: Note[] = [
      { midi: 72, start: 0.125, dur: 0.25, vel: 80, hand: "R" },
      ...Array.from({ length: 8 }, (_, index) => ({
        midi: 36 + (index % 2) * 7,
        start: index * 4,
        dur: 1,
        vel: 72,
        hand: "L" as const,
      })),
    ];
    const variants = buildVariants(
      {
        format: 1,
        division: 480,
        tempoBpm: 120,
        keySig: 0,
        keyMode: 0,
        timeSig: [4, 4],
        notes,
        trackNames: ["Right Hand", "Left Hand"],
        durationBeats: 32,
      },
      { title: "Two-hand fallback", artist: "Test" },
      { arrangementProfile: "metal" },
    );
    for (const level of ["very-beginner", "beginner"] as const) {
      const variant = variants.find((candidate) => candidate.level === level)!;
      expect(variant.notes.filter((note) => note.hand !== "L").length, level).toBeGreaterThan(0);
      expect(variant.notes.filter((note) => note.hand === "L").length, level).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps every level publishable when quarter-grid reduction meets eighth-grid attacks", () => {
    // A dense but playable eighth-note source is a useful regression fixture:
    // beginner/very-beginner quantization lands between the harder level's
    // attacks, so strict (near-zero) ladder matching would otherwise discard
    // almost the entire RH line.
    const notes: Note[] = Array.from({ length: 96 }, (_, i) => ({
      midi: 60 + (i % 12),
      start: i * 0.125,
      dur: 0.25,
      vel: 80,
    }));
    const src: ParsedMidi = {
      format: 0,
      division: 480,
      tempoBpm: 90,
      keySig: 0,
      keyMode: 0,
      timeSig: [4, 4],
      notes,
      trackNames: [],
      durationBeats: notes.at(-1)!.start + notes.at(-1)!.dur,
    };
    const variants = buildVariants(src, { title: "Grid fixture", artist: "Test" });
    expect(variants.every((v) => v.notes.length >= 8)).toBe(true);
    expect(validateVariants(variants)).toEqual([]);
    expect(variants[0]!.notes.length).toBeLessThanOrEqual(variants[1]!.notes.length);
    expect(variants[1]!.notes.length).toBeLessThanOrEqual(variants[2]!.notes.length);
    expect(variants[2]!.notes.length).toBeLessThanOrEqual(variants[3]!.notes.length);
    expect(variants[3]!.notes.length).toBeLessThanOrEqual(variants[4]!.notes.length);
    expect(variants[4]!.notes.length).toBeLessThanOrEqual(variants[5]!.notes.length);
  });
});
