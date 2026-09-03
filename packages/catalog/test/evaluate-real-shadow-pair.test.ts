import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  canonicalRealShadowPairJson,
  compareRealShadowOnsets,
  evaluateRealShadowPair,
  parseRealShadowPairArgs,
} from "../scripts/evaluate-real-shadow-pair.js";

function wavPcm16(sampleRate = 1_000, channels = 1, frames = 1_125): Uint8Array {
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string): void => {
    [...Buffer.from(value, "ascii")].forEach((byte, index) => bytes[offset + index] = byte);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function fixtureMidi(): Uint8Array {
  return writeMidi([
    { midi: 60, start: 0, dur: 0.25, vel: 96 },
    { midi: 64, start: 1, dur: 0.25, vel: 96 },
    { midi: 67, start: 2, dur: 0.25, vel: 96 },
  ], {
    tempoBpm: 120,
    title: "real shadow synthetic fixture",
    tracks: [{
      name: "Guitar",
      notes: [
        { midi: 60, start: 0, dur: 0.25, vel: 96 },
        { midi: 64, start: 1, dur: 0.25, vel: 96 },
        { midi: 67, start: 2, dur: 0.25, vel: 96 },
      ],
    }],
  });
}

function richFixtureMidi(): Uint8Array {
  const notes = Array.from({ length: 16 }, (_, index) => ({
    midi: 60 + (index % 7),
    start: index * 0.5,
    dur: 0.25,
    vel: 96,
  }));
  return writeMidi(notes, {
    tempoBpm: 120,
    title: "real shadow rich synthetic fixture",
    tracks: [{ name: "Guitar", notes }],
  });
}

describe("real Guitar-TECHS shadow-pair evaluator", () => {
  it("parses bounded local CLI arguments and compares production filter timing", () => {
    const options = parseRealShadowPairArgs([
      "--manifest", "/private/tmp/guitar-techs-manifest.json",
      "--item", "p3-music-08",
      "--truth", "/private/tmp/p3-music-08/midi_08.mid",
      "--audio", "/private/tmp/p3-music-08/directinput_08.wav",
      "--out", "/private/tmp/real-shadow/report.json",
      "--native-midi",
    ]);
    expect(options).toMatchObject({
      manifest: "/private/tmp/guitar-techs-manifest.json",
      itemId: "p3-music-08",
      truth: "/private/tmp/p3-music-08/midi_08.mid",
      audio: "/private/tmp/p3-music-08/directinput_08.wav",
      out: "/private/tmp/real-shadow/report.json",
      nativeMidiTiming: true,
    });

    const comparison = compareRealShadowOnsets(
      [
        { midi: 60, start: 0, dur: 0.25, vel: 96 },
        { midi: 64, start: 1, dur: 0.25, vel: 96 },
        { midi: 67, start: 2, dur: 0.25, vel: 96 },
      ],
      120,
      [0.01, 0.51, 1.7],
      0.15,
    );
    expect(comparison).toMatchObject({
      noteCount: 3,
      matchedNoteCount: 2,
      unmatchedNoteCount: 1,
      audioOnsetCount: 3,
    });
    expect(comparison.naive.firstNoteSeconds).toBe(0);
    expect(comparison.naive.lastNoteSeconds).toBe(1);
  });

  it("routes a local pair through external intake and pure shadow evaluation without leaking paths or notes", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-real-shadow-test-"));
    try {
      const truthPath = join(root, "midi_08.mid");
      const audioPath = join(root, "directinput_08.wav");
      const manifestPath = join(root, "guitar-techs-manifest.json");
      await writeFile(truthPath, fixtureMidi());
      await writeFile(audioPath, wavPcm16());
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        dataset: {
          name: "Guitar-TECHS",
          version: "v1",
          license: "CC BY 4.0",
          record: "14963133",
          recordUrl: "https://zenodo.org/records/14963133",
          paperUrl: "https://arxiv.org/html/2501.03720",
        },
        items: [{
          id: "p3-music-08",
          performanceId: "P3",
          stem: "08",
          techniques: ["musical-excerpt"],
          local: { truth: truthPath, di: audioPath },
          truthMetadata: { tempoBpm: 110, durationBeats: 2.25, noteCount: 3 },
          audioMetadata: { di: { durationSec: 2, secondsPerBeat: 0.5 } },
        }],
      }));

      const report = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p3-music-08",
        truth: truthPath,
        audio: audioPath,
        onsetRunner: async () => [0.01, 0.51, 1.01],
      });
      expect(report).toMatchObject({
        kind: "guitar-techs-real-shadow-pair",
        item: { id: "p3-music-08", performanceId: "P3" },
        externalIntake: {
          status: "parsed",
          purpose: "SHADOW_GENERATION_TRUTH",
          generationUsable: false,
        },
          shadow: {
          adapter: { status: "ready" },
          downstream: {
            status: "blocked",
            physicalVariantCount: 6,
            physicalVariants: expect.arrayContaining([
              expect.objectContaining({
                level: "very-beginner",
                midi: expect.objectContaining({ status: "validated" }),
                musicXml: expect.objectContaining({ status: "validated" }),
              }),
              expect.objectContaining({
                level: "advanced",
                midi: expect.objectContaining({ status: "validated" }),
                musicXml: expect.objectContaining({ status: "validated" }),
              }),
            ]),
            publicProjection: expect.objectContaining({
              status: "complete",
              method: "projectPublicSongRows",
              levels: expect.arrayContaining([
                expect.objectContaining({ level: "very-beginner" }),
                expect.objectContaining({ level: "beginner" }),
                expect.objectContaining({ level: "easy" }),
                expect.objectContaining({ level: "medium" }),
                expect.objectContaining({ level: "advanced" }),
              ]),
            }),
            catalog: {
              status: "validated",
              groupedSongCount: 1,
              publicGroupedSongCount: 1,
              publicLevelCount: 5,
              representativeLevel: "easy",
            },
            player: {
              status: "NOT_EXERCISED",
            },
          },
        },
        timing: {
          detector: { status: "parsed", onsetCount: 3 },
          productionOnsetFilter: { matchedNoteCount: 3 },
          audioSymbolicAlignment: { status: "aligned", production: { method: "seconds-per-beat" } },
        },
      });
      expect(report.blockers.join(" ")).toMatch(/advanced|medium|easy/i);
      const serialized = canonicalRealShadowPairJson(report);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toMatch(/"(?:notes|parsed|canonical)"\s*:/i);
      expect(serialized).toContain("sha256");

      const native = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p3-music-08",
        truth: truthPath,
        audio: audioPath,
        nativeMidiTiming: true,
        onsetRunner: async () => [0.01, 0.51, 1.01],
      });
      expect(native.timing.audioSymbolicAlignment).toMatchObject({
        evidence: "native-midi-tempo-map",
        production: { method: "native-tempo-map" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps detector failure explicit and still emits source and parser metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-real-shadow-test-"));
    try {
      const truthPath = join(root, "midi_08.mid");
      const audioPath = join(root, "directinput_08.wav");
      const manifestPath = join(root, "guitar-techs-manifest.json");
      await writeFile(truthPath, fixtureMidi());
      await writeFile(audioPath, wavPcm16());
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        dataset: { name: "Guitar-TECHS", version: "v1", license: "CC BY 4.0", record: "14963133" },
        items: [{ id: "p3-music-08", local: { truth: truthPath, di: audioPath } }],
      }));
      const report = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p3-music-08",
        truth: truthPath,
        audio: audioPath,
        onsetRunner: async () => { throw new Error("python unavailable at /private/tmp/transcribe/bin/python"); },
      });
      expect(report.timing.detector).toMatchObject({ status: "unavailable", onsetCount: null });
      expect(report.blockers.join(" ")).toMatch(/onset detector unavailable/i);
      expect(report.timing.audioSymbolicAlignment.evidence).toBe("duration-derived-audio-seconds-per-beat");
      expect(report.blockers.join(" ")).toMatch(/duration-derived|independent timing/i);
      expect(canonicalRealShadowPairJson(report)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a fully validated six-level in-memory product path for a sufficient shadow source", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-real-shadow-downstream-test-"));
    try {
      const truthPath = join(root, "midi_08.mid");
      const audioPath = join(root, "directinput_08.wav");
      const manifestPath = join(root, "guitar-techs-manifest.json");
      await writeFile(truthPath, richFixtureMidi());
      await writeFile(audioPath, wavPcm16(1_000, 1, 9_000));
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        dataset: { name: "Guitar-TECHS", version: "v1", license: "CC BY 4.0", record: "14963133" },
        items: [{ id: "p3-music-08", local: { truth: truthPath, di: audioPath } }],
      }));

      const report = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p3-music-08",
        truth: truthPath,
        audio: audioPath,
        alignment: { secondsPerBeat: 0.5, beatZeroAudioSeconds: 0 },
        onsetRunner: async () => Array.from({ length: 16 }, (_, index) => index * 0.25),
      });

      expect(report.shadow.downstream.status).toBe("validated");
      expect(report.shadow.downstream.arrangement.status).toBe("built");
      expect(report.shadow.downstream.physicalVariantCount).toBe(6);
      expect(report.shadow.downstream.physicalVariants).toHaveLength(6);
      expect(report.shadow.downstream.physicalVariants.every((variant) =>
        variant.midi.status === "validated" && variant.musicXml.status === "validated",
      )).toBe(true);
      expect(report.shadow.downstream.publicProjection).toMatchObject({
        status: "complete",
        method: "projectPublicSongRows",
        expectedLevelCount: 5,
      });
      expect(report.shadow.downstream.catalog).toMatchObject({
        status: "validated",
        groupedSongCount: 1,
        publicGroupedSongCount: 1,
        publicLevelCount: 5,
        representativeLevel: "easy",
      });
      expect(report.shadow.downstream.player.status).toBe("NOT_EXERCISED");
      expect(report.shadow.downstream.publicProjection.levels.map((level) => level.level)).toEqual([
        "very-beginner", "beginner", "easy", "medium", "advanced",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks duration-derived alignment and redacts path-bearing manifest text", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-real-shadow-path-test-"));
    try {
      const truthPath = join(root, "midi_08.mid");
      const audioPath = join(root, "directinput_08.wav");
      const manifestPath = join(root, "guitar-techs-manifest.json");
      await writeFile(truthPath, fixtureMidi());
      await writeFile(audioPath, wavPcm16());
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        dataset: {
          name: "/Users/reidar/private/dataset-name",
          version: "../private/version.mid",
          license: "CC BY 4.0",
          record: "/private/tmp/record-id",
        },
        items: [{
          id: "p1-scale-c",
          performanceId: "/private/tmp/performance.mid",
          stem: "../audio/stem.wav",
          reason: "source /Users/reidar/private/reason.txt",
          techniques: ["/private/tmp/technique.txt"],
          local: { truth: truthPath, di: audioPath },
        }],
      }));

      const report = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p1-scale-c",
        truth: truthPath,
        audio: audioPath,
        onsetRunner: async () => [0, 0.5, 1],
      });

      expect(report.status).toBe("blocked");
      expect(report.blockers.join(" ")).toMatch(/duration-derived|independent timing/i);
      expect(report.timing.audioSymbolicAlignment.evidence).toBe("duration-derived-audio-seconds-per-beat");
      expect(report.dataset.name).toBe("[redacted-path]");
      expect(report.item.performanceId).toBe("[redacted-path]");
      expect(report.item.stem).toBe("[redacted-path]");
      expect(report.item.reason).toBe("[redacted-path]");
      expect(report.item.techniques).toEqual(["[redacted-path]"]);
      const serialized = canonicalRealShadowPairJson(report);
      expect(serialized).not.toMatch(/reidar|performance\.mid|stem\.wav|reason\.txt|technique\.txt|record-id/);
      expect(serialized).toContain("[redacted-path]");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses independent onset timing evidence for alignment before shadow generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-real-shadow-aligned-test-"));
    try {
      const truthPath = join(root, "midi_08.mid");
      const audioPath = join(root, "directinput_08.wav");
      const manifestPath = join(root, "guitar-techs-manifest.json");
      await writeFile(truthPath, fixtureMidi());
      await writeFile(audioPath, wavPcm16());
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        dataset: { name: "Guitar-TECHS", version: "v1", license: "CC BY 4.0", record: "14963133" },
        items: [{ id: "p1-scale-c", local: { truth: truthPath, di: audioPath } }],
      }));

      const report = await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p1-scale-c",
        truth: truthPath,
        audio: audioPath,
        alignment: { secondsPerBeat: 0.5, beatZeroAudioSeconds: 0 },
        onsetRunner: async () => [0, 0.5, 1],
      });

      expect(report.externalIntake.alignment.status).toBe("aligned");
      expect(report.timing.alignment.status).toBe("aligned");
      expect(report.timing.alignment.production?.metrics.f1).toBe(1);
      expect(report.timing.alignment.naive?.metrics.f1).toBe(1);
      expect(report.shadow.pureEvaluation.item.determinism).toMatch(/^[a-f0-9]{64}$/);
      expect(canonicalRealShadowPairJson(report)).toBe(canonicalRealShadowPairJson(await evaluateRealShadowPair({
        manifest: manifestPath,
        itemId: "p1-scale-c",
        truth: truthPath,
        audio: audioPath,
        alignment: { secondsPerBeat: 0.5, beatZeroAudioSeconds: 0 },
        onsetRunner: async () => [0, 0.5, 1],
      })));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("matches duplicate symbolic notes to distinct audio onsets one-to-one", () => {
    const comparison = compareRealShadowOnsets([
      { midi: 60, start: 0, dur: 0.25, vel: 96 },
      { midi: 60, start: 0, dur: 0.5, vel: 96 },
    ], 120, [0.01], 0.15);
    expect(comparison.matchedNoteCount).toBe(1);
    expect(comparison.matchedAudioOnsetCount).toBe(1);
    expect(comparison.unmatchedNoteCount).toBe(1);
  });
});
