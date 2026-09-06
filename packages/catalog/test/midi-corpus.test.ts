import { describe, expect, it } from "vitest";
import {
  auditMidiBytes,
  normalizeMidiBytes,
  type MidiCorpusResult,
} from "../src/midi-corpus.js";

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return out;
}

function meta(delta: number, type: number, payload: number[]): number[] {
  return [...vlq(delta), 0xff, type, ...vlq(payload.length), ...payload];
}

function track(events: number[]): number[] {
  return [0x4d, 0x54, 0x72, 0x6b, (events.length >>> 24) & 0xff, (events.length >>> 16) & 0xff, (events.length >>> 8) & 0xff, events.length & 0xff, ...events];
}

function midiFile(tracks: number[][], division = 480, format = 1): Uint8Array {
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    (format >>> 8) & 0xff, format & 0xff, (tracks.length >>> 8) & 0xff, tracks.length & 0xff,
    (division >>> 8) & 0xff, division & 0xff,
    ...tracks.flat(),
  ]);
}

function ascii(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

describe("midi corpus audit and normalizer", () => {
  it("preserves track, channel, program, percussion, and note metadata", () => {
    const bytes = midiFile([
      track([
        ...meta(0, 0x01, ascii("Corpus fixture")),
        ...meta(0, 0x03, ascii("Conductor")),
        ...meta(0, 0x51, [0x07, 0xa1, 0x20]),
        ...meta(0, 0x58, [3, 2, 24, 8]),
        ...meta(0, 0x59, [0xff, 0,]),
        ...meta(8, 0x2f, []),
      ]),
      track([
        ...meta(0, 0x03, ascii("Piano and drums")),
        0, 0xc2, 5,
        0, 0x92, 64, 90,
        ...vlq(480), 0x82, 64, 0,
        0, 0x99, 36, 100,
        ...vlq(240), 0x89, 36, 0,
        ...meta(0, 0x2f, []),
      ]),
    ]);

    const result = auditMidiBytes(bytes);
    expect(result.status).toBe("valid");
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.normalizedBytes).toBeUndefined();
    expect(result.normalization).toMatchObject({ status: "not-needed", beforeBytes: bytes.length, afterBytes: bytes.length, droppedEvents: 0 });
    if (result.status !== "valid") throw new Error("expected valid corpus result");
    expect(result.canonical).toMatchObject({
      format: 1,
      division: 480,
      title: "Corpus fixture",
      tempos: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, signature: [3, 4] }],
      keySignatures: [{ tick: 0, fifths: -1, mode: 0 }],
    });
    expect(result.canonical.tracks[1]).toMatchObject({
      index: 1,
      name: "Piano and drums",
      channels: [2, 9],
      programs: [{ tick: 0, channel: 2, program: 5 }],
      percussion: true,
    });
    expect(result.canonical.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ trackIndex: 1, channel: 2, midi: 64, velocity: 90, startTick: 0, endTick: 480, program: 5, percussion: false }),
      expect.objectContaining({ trackIndex: 1, channel: 9, midi: 36, velocity: 100, startTick: 480, endTick: 720, program: 0, percussion: true }),
    ]));
  });

  it("rejects format-0 headers that advertise multiple tracks", () => {
    const bytes = midiFile([
      track([...meta(0, 0x2f, [])]),
      track([...meta(0, 0x2f, [])]),
    ], 480, 0);

    const strict = auditMidiBytes(bytes);
    expect(strict.status).toBe("invalid");
    expect(strict.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-format-track-count", severity: "error" }),
    ]));

    const normalized = normalizeMidiBytes(bytes);
    expect(normalized.status).toBe("invalid");
    expect(normalized.normalization.status).toBe("blocked");
  });

  it("reports malformed tempo, time-signature, and key-signature payloads", () => {
    const cases: Array<{ type: number; payload: number[]; code: string }> = [
      { type: 0x51, payload: [0, 1], code: "invalid-tempo-payload" },
      { type: 0x58, payload: [4, 2], code: "invalid-time-signature-payload" },
      { type: 0x59, payload: [0, 2], code: "invalid-key-signature-payload" },
    ];

    for (const value of cases) {
      const bytes = midiFile([track([
        ...meta(0, value.type, value.payload),
        ...meta(0, 0x2f, []),
      ])]);
      const strict = auditMidiBytes(bytes);
      expect(strict.status).toBe("invalid");
      expect(strict.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: value.code, severity: "error" }),
      ]));
      const normalized = normalizeMidiBytes(bytes);
      expect(normalized.status).toBe("invalid");
      expect(normalized.normalization.status).toBe("blocked");
    }
  });

  it("rejects bytes after the declared track chunks", () => {
    const valid = midiFile([track([...meta(0, 0x2f, [])])]);
    const bytes = Uint8Array.from([...valid, 0]);

    const strict = auditMidiBytes(bytes);
    expect(strict.status).toBe("invalid");
    expect(strict.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "trailing-data", severity: "error", byteOffset: valid.length }),
    ]));

    const normalized = normalizeMidiBytes(bytes);
    expect(normalized.status).toBe("invalid");
    expect(normalized.normalization.status).toBe("blocked");
  });

  it("salvages an out-of-range data byte by dropping only that event and reports loss", () => {
    const bytes = midiFile([track([
      0, 0x90, 60, 0x80,
      0, 0x90, 62, 80,
      ...vlq(480), 0x80, 62, 0,
      ...meta(0, 0x2f, []),
    ])]);

    const strict = auditMidiBytes(bytes);
    expect(strict.status).toBe("invalid");
    expect(strict.issues.some((issue) => issue.code === "data-byte-out-of-range")).toBe(true);

    const normalized = normalizeMidiBytes(bytes);
    expect(normalized.status).toBe("normalized");
    expect(normalized.normalizedBytes).toBeInstanceOf(Uint8Array);
    expect(normalized.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "data-byte-out-of-range", severity: "error" }),
      expect.objectContaining({ code: "dropped-malformed-event", severity: "warning" }),
    ]));
    expect(normalized.normalization).toMatchObject({ status: "normalized", droppedEvents: 1, droppedIssueCodes: ["data-byte-out-of-range"], affectedTicks: [0] });
    if (normalized.status !== "normalized" || !normalized.normalizedBytes) throw new Error("expected normalized bytes");
    const reparsed = auditMidiBytes(normalized.normalizedBytes);
    expect(reparsed.status).toBe("valid");
    if (reparsed.status !== "valid") throw new Error("expected normalized bytes to be strict-valid");
    expect(reparsed.canonical.notes.map((note) => [note.midi, note.startTick, note.endTick])).toEqual([[62, 0, 480]]);
    expect(normalized.normalizedSha256).toBe(reparsed.inputSha256);
  });

  it("strictly rejects an out-of-range program number", () => {
    const bytes = midiFile([track([
      0, 0xc0, 255,
      0, 0x90, 60, 80,
      ...vlq(480), 0x80, 60, 0,
      ...meta(0, 0x2f, []),
    ])]);
    const strict = auditMidiBytes(bytes);
    expect(strict.status).toBe("invalid");
    expect(strict.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "data-byte-out-of-range", severity: "error" }),
    ]));

    const normalized = normalizeMidiBytes(bytes);
    expect(normalized.status).toBe("normalized");
    if (normalized.status !== "normalized") throw new Error("expected normalized program fixture");
    expect(normalized.canonical.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ midi: 60, channel: 0, program: 0 }),
    ]));
  });

  it("fails closed on irrecoverable track truncation and is deterministic", () => {
    const bytes = midiFile([track([0, 0x90, 60])], 480).slice(0, -1);
    const first = normalizeMidiBytes(bytes);
    const second = normalizeMidiBytes(bytes);
    expect(first.status).toBe("invalid");
    expect(first.normalizedBytes).toBeUndefined();
    expect(first.normalization.status).toBe("blocked");
    expect(first).toEqual(second);
    expect(first.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "truncated-track", severity: "error" }),
    ]));
  });

  it("does not turn a structurally incomplete track into a normalized artifact", () => {
    const bytes = midiFile([track([0, 0x90, 60, 80, ...vlq(480), 0x80, 60, 0])]);
    const result = normalizeMidiBytes(bytes);
    expect(result.status).toBe("invalid");
    expect(result.normalizedBytes).toBeUndefined();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-end-of-track", severity: "error" }),
    ]));
  });

  it("applies explicit byte and event bounds without reading paths", () => {
    const bytes = midiFile([track([...meta(0, 0x2f, [])])]);
    const result: MidiCorpusResult = auditMidiBytes(bytes, { maxBytes: bytes.length - 1 });
    expect(result.status).toBe("invalid");
    expect(result.issues[0]).toMatchObject({ code: "input-too-large" });
    expect(JSON.stringify(result)).not.toMatch(/\b(?:Users|private|tmp|home)\b/);
  });
});
