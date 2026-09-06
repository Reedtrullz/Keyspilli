import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptShadowCorpusMidiBytes,
  buildShadowCorpusItem,
  shadowCorpusAdapterJson,
  type ShadowCorpusAdapterReport,
} from "../src/shadow-corpus-adapter.js";
import { buildShadowCorpus, parseBuildShadowCorpusArgs } from "../scripts/build-shadow-corpus.js";

function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function ascii(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

function meta(delta: number, type: number, payload: number[]): number[] {
  return [...vlq(delta), 0xff, type, ...vlq(payload.length), ...payload];
}

function noteOn(delta: number, channel: number, midi: number, velocity: number): number[] {
  return [...vlq(delta), 0x90 | channel, midi, velocity];
}

function noteOff(delta: number, channel: number, midi: number): number[] {
  return [...vlq(delta), 0x80 | channel, midi, 0];
}

function program(delta: number, channel: number, value: number): number[] {
  return [...vlq(delta), 0xc0 | channel, value];
}

function track(events: readonly number[]): number[] {
  return [
    ...ascii("MTrk"),
    (events.length >>> 24) & 0xff,
    (events.length >>> 16) & 0xff,
    (events.length >>> 8) & 0xff,
    events.length & 0xff,
    ...events,
  ];
}

function midiFile(tracks: readonly number[][], division = 480): Uint8Array {
  const header = [
    ...ascii("MThd"), 0, 0, 0, 6,
    0, 1,
    (tracks.length >>> 8) & 0xff, tracks.length & 0xff,
    (division >>> 8) & 0xff, division & 0xff,
  ];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

function pitchedTrack(name: string, channel: number, midi: number, programNumber: number, durationTicks = 480): number[] {
  return track([
    ...meta(0, 0x03, ascii(name)),
    ...program(0, channel, programNumber),
    ...noteOn(0, channel, midi, 96),
    ...noteOff(durationTicks, channel, midi),
    ...meta(0, 0x2f, []),
  ]);
}

function fullBandFixture(): Uint8Array {
  const tempo = track([
    ...meta(0, 0x01, ascii("Shadow fixture")),
    ...meta(0, 0x51, [0x07, 0xa1, 0x20]),
    ...meta(0, 0x58, [4, 2, 24, 8]),
    ...meta(0, 0x2f, []),
  ]);
  const drums = track([
    ...meta(0, 0x03, ascii("Drums")),
    ...program(0, 9, 0),
    ...noteOn(0, 9, 36, 100),
    ...noteOff(240, 9, 36),
    ...noteOn(240, 9, 42, 90),
    ...noteOff(240, 9, 42),
    ...meta(0, 0x2f, []),
  ]);
  return midiFile([
    tempo,
    pitchedTrack("Piano", 0, 60, 0, 960),
    pitchedTrack("Bass", 1, 36, 32, 1920),
    pitchedTrack("Guitar", 2, 64, 24, 480),
    pitchedTrack("Synth Pad", 3, 72, 88, 480),
    drums,
  ]);
}

describe("shadow corpus MIDI adapter", () => {
  it("parses tempo, duration, track/program metadata, percussion, and deterministic family roles", () => {
    const bytes = fullBandFixture();
    const first = adaptShadowCorpusMidiBytes(bytes, { logicalRef: "shadow:fixture:full-band" });
    const second = adaptShadowCorpusMidiBytes(bytes, { logicalRef: "shadow:fixture:full-band" });

    expect(first.status).toBe("parsed");
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tempoBpm).toBe(120);
    expect(first.durationBeats).toBe(4);
    expect(first.notes).toHaveLength(4);
    expect(first.tracks.map((value) => value.role)).toEqual(["other", "piano", "bass", "guitar", "other", "drums"]);
    expect(first.tracks.find((value) => value.role === "drums")).toMatchObject({
      name: "Drums",
      percussion: true,
      percussionNoteCount: 2,
      pitchedNoteCount: 0,
      programs: [0],
    });
    expect(first.tracks.find((value) => value.role === "bass")).toMatchObject({
      name: "Bass",
      channels: [1],
      programs: [32],
      pitchedNoteCount: 1,
    });
    expect(first.tracks.find((value) => value.role === "guitar")).toMatchObject({ programs: [24] });
    expect(first.tracks.find((value) => value.role === "piano")).toMatchObject({ programs: [0] });
    expect(first.roleDiagnostics).toHaveLength(first.tracks.length);
    expect(first.roleDiagnostics.find((value) => value.partName === "Drums")).toMatchObject({ role: "timing-only", percussion: true, timingOnly: true });
    expect(first).toEqual(second);
  });

  it("treats rhythm guitar labels as guitar rather than percussion", () => {
    const parsed = adaptShadowCorpusMidiBytes(midiFile([
      pitchedTrack("Rhythm Guitar", 0, 64, 29),
    ]));

    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]).toMatchObject({
      name: "Rhythm Guitar",
      role: "guitar",
      percussion: false,
      percussionNoteCount: 0,
    });
  });

  it("keeps pitched GM programs 112 and 119 out of percussion without drum evidence", () => {
    const parsed = adaptShadowCorpusMidiBytes(midiFile([
      pitchedTrack("", 0, 64, 112),
      pitchedTrack("", 1, 67, 119),
    ]));

    expect(parsed.notes).toHaveLength(2);
    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        programs: [112],
        role: "other",
        percussion: false,
        percussionNoteCount: 0,
        pitchedNoteCount: 1,
      }),
      expect.objectContaining({
        programs: [119],
        role: "other",
        percussion: false,
        percussionNoteCount: 0,
        pitchedNoteCount: 1,
      }),
    ]));
  });

  it("bounds in-memory symbolic and audio inputs before parsing or hashing", async () => {
    const bytes = fullBandFixture();
    await expect(buildShadowCorpusItem({
      id: "oversized-symbolic",
      symbolicBytes: bytes,
    }, { maxBytes: bytes.byteLength - 1 })).rejects.toThrow(/byte limit/i);
    await expect(buildShadowCorpusItem({
      id: "oversized-audio",
      symbolicBytes: bytes,
      audioBytes: new Uint8Array(bytes.byteLength + 1),
    }, { maxBytes: bytes.byteLength })).rejects.toThrow(/byte limit/i);
  });

  it("rejects unsupported item schema versions instead of coercing them", async () => {
    await expect(buildShadowCorpusItem({
      schemaVersion: 2,
      id: "unsupported-version",
      symbolicBytes: fullBandFixture(),
    } as never)).rejects.toThrow(/schemaVersion.*unsupported/i);
  });

  it("does not grant generation truth to path-only or credential-only source records", async () => {
    const cases = [
      { path: "/private/tmp/shadow/source.mid" },
      { url: "https://user:secret@example.com/source.mid" },
      "/private/tmp/shadow/source.mid",
      "https://user:secret@example.com/source.mid",
    ];
    for (const sourceRecord of cases) {
      const item = await buildShadowCorpusItem({
        id: "untrusted-source",
        license: "CC BY 4.0",
        sourceRecord,
        symbolicBytes: fullBandFixture(),
        audioBytes: Uint8Array.from([1, 2, 3]),
      });
      expect(item.sourceRecord).toBeNull();
      expect(item.generationEligibility.eligible).toBe(false);
      expect(item.eligibilityReasons).toEqual(expect.arrayContaining([expect.stringMatching(/source/i)]));
    }

    const trusted = await buildShadowCorpusItem({
      id: "trusted-source",
      license: "CC BY 4.0",
      sourceRecord: { provider: "zenodo", recordId: "3371780" },
      symbolicBytes: fullBandFixture(),
      audioBytes: Uint8Array.from([1, 2, 3]),
    });
    expect(trusted.sourceRecord).toMatchObject({ provider: "zenodo", recordId: "3371780" });
    expect(trusted.generationEligibility.eligible).toBe(true);
  });

  it("redacts path text without leaking replacement-group placeholders", () => {
    const serialized = shadowCorpusAdapterJson({
      schemaVersion: 1,
      adapterVersion: "shadow-corpus-adapter-v1",
      status: "failed",
      itemCount: 0,
      parsedItemCount: 0,
      failedItemCount: 1,
      generationTruthCount: 0,
      items: [],
      errors: [{ id: "x", code: "io-failed", message: "failed /Users/reidar/private/source.mid and C:\\Users\\reidar\\source.mid" }],
      outputPath: "/private/tmp/report.json",
    } satisfies ShadowCorpusAdapterReport);
    expect(serialized).not.toContain("$1");
    expect(serialized).not.toContain("/Users/reidar");
    expect(serialized).not.toContain("C:\\Users\\reidar");
    expect(serialized).toContain("[redacted-path]");
  });

  it("returns shadow generation truth only with symbolic plus audio and provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-shadow-adapter-"));
    try {
      const symbolic = join(root, "item", "mix.mid");
      const audio = join(root, "item", "mix.wav");
      await mkdir(join(root, "item"), { recursive: true });
      await writeFile(symbolic, fullBandFixture());
      await writeFile(audio, Buffer.from("RIFF shadow audio fixture"));

      const item = await buildShadowCorpusItem({
        id: "fixture-full-band",
        corpus: "synthetic-shadow",
        datasetVersion: "fixture-v1",
        license: "CC BY 4.0",
        sourceRecord: { provider: "local-fixture", recordId: "fixture-full-band" },
        symbolicPath: symbolic,
        audioPath: audio,
      });

      expect(item).toMatchObject({
        id: "fixture-full-band",
        generationEligibility: { eligible: true, purpose: "SHADOW_GENERATION_TRUTH" },
        evaluationEligibility: { eligible: true, status: "SHADOW_GENERATION_TRUTH" },
        symbolic: { status: "available", byteLength: (await readFile(symbolic)).byteLength },
        audio: { status: "available", byteLength: (await readFile(audio)).byteLength },
      });
      expect(item.symbolic.sha256).toMatch(/^[a-f0-9]{64}$/);
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain("mix.mid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps incomplete provenance explicitly ineligible", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-shadow-adapter-metadata-"));
    try {
      const symbolic = join(root, "only.mid");
      await writeFile(symbolic, fullBandFixture());
      const item = await buildShadowCorpusItem({ id: "metadata-only", symbolicPath: symbolic });
      expect(item.generationEligibility).toMatchObject({ eligible: false, purpose: "SHADOW_GENERATION_TRUTH" });
      expect(item.evaluationEligibility).toMatchObject({ eligible: false, status: "METADATA_ONLY" });
      expect(item.audio.status).toBe("not-provided");
      expect(item.symbolic.status).toBe("available");
      expect(item.eligibilityReasons).toEqual(expect.arrayContaining([
        expect.stringMatching(/audio/i),
        expect.stringMatching(/license/i),
        expect.stringMatching(/source/i),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed/non-MIDI bytes before creating generation metadata", () => {
    expect(() => adaptShadowCorpusMidiBytes(Uint8Array.from([1, 2, 3]), { logicalRef: "shadow:bad" })).toThrow(/MIDI/i);
  });

  it("builds a bounded path-redacted report from a local root", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-shadow-adapter-cli-"));
    try {
      await writeFile(join(root, "manifest.json"), JSON.stringify({
        corpus: "synthetic-shadow",
        datasetVersion: "fixture-v1",
        license: "CC BY 4.0",
        sourceRecord: { provider: "local-fixture", recordId: "manifest" },
        items: [{ id: "fixture-full-band", symbolic: "mix.mid", audio: "mix.wav" }],
      }));
      await writeFile(join(root, "mix.mid"), fullBandFixture());
      await writeFile(join(root, "mix.wav"), Buffer.from("RIFF shadow audio fixture"));
      const out = join(root, "report.json");
      expect(parseBuildShadowCorpusArgs(["--root", root, "--out", out])).toMatchObject({ root, out, limit: 20 });
      const report = await buildShadowCorpus({ root, out });
      const text = await readFile(report.outputPath, "utf8");
      const parsed = JSON.parse(text) as ShadowCorpusAdapterReport;
      expect(parsed).toMatchObject({ status: "ready", itemCount: 1, items: [{ id: "fixture-full-band", generationEligibility: { eligible: true, purpose: "SHADOW_GENERATION_TRUTH" } }] });
      expect(text).not.toContain(root);
      expect(shadowCorpusAdapterJson(report)).toBe(text);
      await expect(buildShadowCorpus({ root, out, limit: 21 })).rejects.toThrow(/limit|20/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed instead of filtering malformed rows from an array manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-shadow-adapter-malformed-array-"));
    try {
      await writeFile(join(root, "manifest.json"), JSON.stringify([{ id: "valid" }, null]));
      const out = join(root, "report.json");

      await expect(buildShadowCorpus({ root, out })).rejects.toThrow(/manifest row 1.*object/i);
      await expect(readFile(out, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed instead of filtering malformed rows from an items manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-shadow-adapter-malformed-items-"));
    try {
      await writeFile(join(root, "manifest.json"), JSON.stringify({ items: [{ id: "valid" }, "malformed"] }));
      const out = join(root, "report.json");

      await expect(buildShadowCorpus({ root, out })).rejects.toThrow(/manifest row 1.*object/i);
      await expect(readFile(out, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
