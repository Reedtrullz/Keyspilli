import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  adaptNativeSymbolicBytes,
  adaptNativeSymbolicFile,
  nativeSymbolicAdapterJson,
  type NativeMidiTrackSpec,
} from "../src/native-score-adapter.js";

function varint(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw new Error("test varint must be a non-negative integer");
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return bytes;
}

function ascii(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

function meta(delta: number, type: number, payload: number[]): number[] {
  return [...varint(delta), 0xff, type, ...varint(payload.length), ...payload];
}

function noteOn(delta: number, channel: number, midi: number, velocity: number): number[] {
  return [...varint(delta), 0x90 | channel, midi, velocity];
}

function noteOff(delta: number, channel: number, midi: number, velocity = 0): number[] {
  return [...varint(delta), 0x80 | channel, midi, velocity];
}

function track(events: readonly number[]): number[] {
  return [...ascii("MTrk"), (events.length >>> 24) & 0xff, (events.length >>> 16) & 0xff, (events.length >>> 8) & 0xff, events.length & 0xff, ...events];
}

function midiFile(tracks: number[][], division = 4, format = 1): Uint8Array {
  const header = [
    ...ascii("MThd"), 0, 0, 0, 6,
    (format >>> 8) & 0xff, format & 0xff,
    (tracks.length >>> 8) & 0xff, tracks.length & 0xff,
    (division >>> 8) & 0xff, division & 0xff,
  ];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

function tempoTrack(): number[] {
  return track([
    ...meta(0, 0x01, ascii("Adapter fixture")),
    ...meta(0, 0x51, [0x07, 0xa1, 0x20]), // 120 BPM
    ...meta(0, 0x58, [4, 2, 24, 8]),
    ...meta(0, 0x59, [0xfe, 1]), // F minor
    ...meta(16, 0x2f, []),
  ]);
}

export const MIDI_TRACK_FIXTURE: NativeMidiTrackSpec = {
  name: "Lead Voice",
  events: [
    ...meta(0, 0x03, ascii("Lead Voice")),
    ...noteOn(0, 0, 60, 96),
    ...noteOff(2, 0, 60),
    ...noteOn(0, 0, 62, 88),
    ...noteOff(2, 0, 62),
    ...meta(0, 0x2f, []),
  ],
};

function buildTrack(spec: NativeMidiTrackSpec): number[] {
  return track(spec.events);
}

describe("native local symbolic adapter", () => {
  it("normalizes native MIDI into track/measure/staff/voice-aware OMR events", () => {
    const bytes = midiFile([
      tempoTrack(),
      buildTrack(MIDI_TRACK_FIXTURE),
      track([
        ...meta(0, 0x03, ascii("Left Hand")),
        ...noteOn(0, 1, 48, 72),
        ...noteOff(4, 1, 48),
        ...meta(0, 0x2f, []),
      ]),
    ]);

    const result = adaptNativeSymbolicBytes(bytes, "midi", { sourceRef: "fixture.mid" });

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed result");
    expect(result.format).toBe("midi");
    expect(result.provenance).toMatchObject({
      artifactType: "midi",
      sourceRef: "fixture.mid",
      bytes: bytes.byteLength,
      parser: { id: "keyspilli-native-symbolic", version: expect.any(String) },
    });
    expect(result.provenance).not.toHaveProperty("path");
    expect(result.score).toMatchObject({ tempoBpm: 120, timeSignature: [4, 4], keySignature: -2, title: "Adapter fixture" });
    expect(result.score.parts.map((part) => [part.id, part.name, part.role])).toEqual([
      ["track-1", "Track 1", undefined],
      ["track-2", "Lead Voice", "melody"],
      ["track-3", "Left Hand", "harmony"],
    ]);
    const lead = result.score.parts[1]!;
    const leadEvents = lead.measures.flatMap((measure) => measure.events ?? []);
    expect(leadEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ pitch: 60, onset: 0, duration: 0.5, staff: 1, voice: "1", role: "melody" }),
      expect.objectContaining({ pitch: 62, onset: 0.5, duration: 0.5, staff: 1, voice: "1", role: "melody" }),
    ]));
    const left = result.score.parts[2]!;
    expect(left.measures[0]!.events).toEqual([
      expect.objectContaining({ pitch: 48, onset: 0, duration: 1, staff: 2, voice: "2", role: "harmony" }),
    ]);
    expect(result.canonical.notationEvents.find((event) => event.midi === 60)?.source).toMatchObject({
      partId: "track-2",
      measureNumber: "1",
      staff: 1,
      voice: "1",
      role: "melody",
    });
    // Calling the byte adapter twice with the same input/options must produce
    // identical report bytes; this protects the local-evaluation contract
    // against accidental locale/time/path-dependent fields.
    expect(nativeSymbolicAdapterJson(result)).toBe(nativeSymbolicAdapterJson(adaptNativeSymbolicBytes(bytes, "midi", { sourceRef: "fixture.mid" })));
  });

  it("reuses the MusicXML adapter and keeps page, staff, voice, accidental, and tie metadata", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0">
      <work><work-title>Native XML</work-title></work>
      <part-list><score-part id="P1"><part-name>Lead Voice</part-name></score-part></part-list>
      <part id="P1"><measure number="7" page="3" system="2"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><accidental>sharp</accidental><duration>2</duration><voice>2</voice><staff>2</staff><tie type="start"/></note>
      </measure></part>
    </score-partwise>`;
    const result = adaptNativeSymbolicBytes(new TextEncoder().encode(xml), "musicxml");

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed result");
    expect(result.provenance).toMatchObject({ artifactType: "musicxml", rootFile: null });
    const event = result.score.parts[0]!.measures[0]!.events![0]!;
    expect(event).toMatchObject({ pitch: 66, accidental: "sharp", staff: 2, voice: "2", role: "melody", tie: { start: true, stop: false, continue: false } });
    expect(result.score.parts[0]!.measures[0]).toMatchObject({ number: "7", page: 3, system: 2 });
    expect(result.canonical.notationEvents[0]).toMatchObject({ midi: 66, accidental: "sharp", source: { page: 3, system: 2, staff: 2, voice: "2" } });
  });

  it("reads MXL bytes and reports MSCZ as explicitly unavailable", () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const mxl = zipSync({
      "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="scores/score.musicxml"/></rootfiles></container>'),
      "scores/score.musicxml": strToU8(xml),
    });
    const parsed = adaptNativeSymbolicBytes(mxl, "mxl");
    expect(parsed.status).toBe("parsed");
    if (parsed.status === "parsed") expect(parsed.provenance).toMatchObject({ artifactType: "mxl", rootFile: "scores/score.musicxml" });

    const unavailable = adaptNativeSymbolicBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), "mscz");
    expect(unavailable).toMatchObject({ status: "unsupported", format: "mscz", score: null });
    if (unavailable.status === "unsupported") expect(unavailable.reason).toMatch(/MSCZ|MusicXML|MIDI/i);
  });

  it("keeps malformed native input fail-closed and omits percussion from the common score", () => {
    const malformed = adaptNativeSymbolicBytes(Uint8Array.from([0x01, 0x02, 0x03]), "midi");
    expect(malformed).toMatchObject({ status: "invalid", format: "midi", score: null, canonical: null });
    if (malformed.status === "invalid") expect(malformed.error).toMatch(/MIDI|header/i);

    const percussion = midiFile([
      track([
        ...noteOn(0, 9, 36, 100),
        ...noteOff(4, 9, 36),
        ...meta(0, 0x2f, []),
      ]),
    ]);
    const result = adaptNativeSymbolicBytes(percussion, "midi");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.score.parts.flatMap((part) => part.measures.flatMap((measure) => measure.events ?? []))).toEqual([]);
      expect(result.warnings).toContain("MIDI has no tempo meta; tempo remains unavailable");
      expect(result.warnings).toContain("dropped 1 percussion MIDI note-on event");
    }
  });

  it("reads an explicitly permitted local file without copying or leaking its physical path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-adapter-"));
    try {
      const file = join(directory, "local.mid");
      const bytes = midiFile([tempoTrack(), buildTrack(MIDI_TRACK_FIXTURE)]);
      await writeFile(file, bytes);
      const result = await adaptNativeSymbolicFile(file, { sourceRef: "local.mid" });
      expect(result.status).toBe("parsed");
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(await readFile(file)).toEqual(Buffer.from(bytes));
      await expect(adaptNativeSymbolicFile("relative.mid")).rejects.toThrow(/absolute/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
