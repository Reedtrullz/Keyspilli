import { describe, expect, it } from "vitest";
import {
  createLegacyBootstrapManifest,
  parseTempoProvenance,
  parseArrangementManifest,
  parseTranscriptionProvenance,
  resolveArtifactPlaybackTempo,
  TEMPO_MIRROR_TOLERANCE,
  temposAgree,
  transcriptionConfigForFingerprint,
  validateTranscriptionProvenance,
  validateTempoProvenance,
  validateArrangementManifest,
} from "../src/artifact-manifest.js";

const now = "2026-08-16T17:30:00.000Z";

describe("artifact arrangement manifest", () => {
  it("validates the role-tagged tempo provenance copied into notes.json", () => {
    const manifest = createLegacyBootstrapManifest("test-song", 120, now);
    expect(parseTempoProvenance(manifest.tempo, "provenance.tempo")).toEqual(manifest.tempo);
    expect(validateTempoProvenance({
      ...manifest.tempo,
      playback: { ...manifest.tempo.playback, role: "source-calibration" },
    }, "provenance.tempo")).toEqual([
      "provenance.tempo.playback.role must be playback",
    ]);
    expect(validateTempoProvenance(undefined, "provenance.tempo")).toEqual([
      "provenance.tempo must be an object",
    ]);
  });

  it("creates a legacy bootstrap with both tempo roles and no false provenance", () => {
    const manifest = createLegacyBootstrapManifest("test-song", 120, now);
    expect(manifest.identityStatus).toBe("legacy-bootstrap");
    expect(manifest.tempo.calibration).toMatchObject({ bpm: 120, source: "legacy", role: "source-calibration" });
    expect(manifest.tempo.playback).toMatchObject({ bpm: 120, source: "legacy", role: "playback" });
    expect(manifest.artifactWrittenAt).toBe(now);
    expect(manifest.sourceArtifactHash).toBeUndefined();
  });

  it("requires source/config identity for current and migrated artifacts", () => {
    const base = createLegacyBootstrapManifest("test-song", 120, now);
    expect(validateArrangementManifest({ ...base, identityStatus: "current" })).toEqual([
      "sourceArtifactHash is required for current artifacts",
      "configFingerprint is required for current artifacts",
    ]);
    expect(validateArrangementManifest({
      ...base,
      identityStatus: "migrated",
      sourceArtifactHash: "sha256:audio",
      configFingerprint: "sha256:config",
    })).toEqual([]);
  });

  it("fails closed on malformed tempo roles or status", () => {
    const manifest = createLegacyBootstrapManifest("test-song", 120, now);
    const errors = validateArrangementManifest({
      ...manifest,
      identityStatus: "unknown",
      tempo: { ...manifest.tempo, playback: { ...manifest.tempo.playback, role: "source-calibration" } },
    });
    expect(errors).toEqual(expect.arrayContaining([
      "identityStatus must be legacy-bootstrap, current, or migrated",
      "tempo.playback.role must be playback",
    ]));
  });

  it("round-trips a current manifest through strict parsing", () => {
    const manifest = {
      ...createLegacyBootstrapManifest("test-song", 120, now),
      identityStatus: "current" as const,
      sourceArtifactHash: "sha256:audio",
      configFingerprint: "sha256:config",
      arrangementProfile: "learner",
    };
    expect(parseArrangementManifest(manifest)).toEqual(manifest);
  });

  it("round-trips complete audio transcription provenance and rejects drift", () => {
    const transcription = {
      basicPitchVersion: "0.3.0",
      modelSerialization: "onnx",
      onsetThreshold: 0.65,
      frameThreshold: 0.45,
      tempo: 142,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
    };
    const manifest = {
      ...createLegacyBootstrapManifest("test-song", 142, now),
      identityStatus: "current" as const,
      sourceArtifactHash: "sha256:audio",
      configFingerprint: "sha256:config",
      transcription,
    };
    expect(parseTranscriptionProvenance(transcription)).toEqual(transcription);
    expect(transcriptionConfigForFingerprint(transcription)).toEqual({
      basicPitchVersion: "0.3.0",
      modelSerialization: "onnx",
      onsetThreshold: 0.65,
      frameThreshold: 0.45,
      tempo: 142,
      tempoSource: "detected",
      audioSource: "youtube",
    });
    expect(parseArrangementManifest(manifest).transcription).toEqual(transcription);
    expect(validateTranscriptionProvenance({ ...transcription, onsetThreshold: 1.01 })).toContain(
      "transcription.onsetThreshold must be a finite number between 0 and 1",
    );
    expect(validateArrangementManifest({
      ...manifest,
      transcription: { ...transcription, transcribedAt: "not-a-time" },
    })).toContain("transcription.transcribedAt must be an ISO timestamp");
  });

  it("records the effective cleanup and pipeline identities without losing legacy compatibility", () => {
    const transcription = {
      basicPitchVersion: "0.3.0",
      modelSerialization: "onnx",
      onsetThreshold: 0.65,
      frameThreshold: 0.45,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
      pipeline: {
        filterVersion: "audio-onset-filter-v1",
        normalizerId: "midi-normalizer-v2",
        gridPolicyId: "beat-grid-v2",
        variantPolicyId: "learner-variant-ladder-v3",
      },
      postProcessing: {
        filterApplied: true,
        cleanupApplied: true,
        onsetMatchSec: 0.15,
        onsetDetector: { sampleRate: 22050, hopLength: 512, backtrack: true, delta: 0.07 },
        minVelocity: 30,
        minDurationBeats: 0.14,
        mergeWindowBeats: 0.125,
        maxPolyphony: 6,
        maxSounding: 8,
        maxDurationSec: 2.5,
        maxDurationBeats: 5,
        importedMaxDurationBeats: 1.5,
        importedMaxSounding: 12,
      },
    };
    expect(parseTranscriptionProvenance(transcription)).toEqual(transcription);
    const fingerprintConfig = transcriptionConfigForFingerprint(transcription) as Record<string, unknown>;
    expect(fingerprintConfig.transcribedAt).toBeUndefined();
    expect(fingerprintConfig.pipeline).toMatchObject({
      filterVersion: "audio-onset-filter-v1",
      normalizerId: "midi-normalizer-v2",
      gridPolicyId: "beat-grid-v2",
    });
    expect(fingerprintConfig.postProcessing).toMatchObject({
      minVelocity: 30,
      minDurationBeats: 0.14,
      maxPolyphony: 6,
      maxSounding: 8,
    });
    expect(validateTranscriptionProvenance({
      ...transcription,
      postProcessing: { ...transcription.postProcessing, maxSounding: 0 },
    })).toContain("transcription.postProcessing.maxSounding must be a positive integer");
    expect(validateTranscriptionProvenance({
      ...transcription,
      pipeline: { ...transcription.pipeline, filterVersion: "" },
    })).toContain("transcription.pipeline.filterVersion must be a non-empty string");
  });

  it("uses the selected legacy notes tempo only when no manifest exists", () => {
    expect(resolveArtifactPlaybackTempo(null, 118, 118)).toEqual({
      status: "legacy",
      bpm: 118,
      errors: [],
    });
    expect(resolveArtifactPlaybackTempo(null, 118, 120)).toMatchObject({
      status: "invalid",
      errors: ["legacy tempo mismatch: notes.json=118, database=120"],
    });
  });

  it("keeps fractional BPM mirrors consistent while rejecting real drift", () => {
    const manifest = createLegacyBootstrapManifest("fractional-tempo", 120.25, now);
    expect(temposAgree(120.25, 120.25 + TEMPO_MIRROR_TOLERANCE / 2)).toBe(true);
    expect(temposAgree(120.25, 120.25 + TEMPO_MIRROR_TOLERANCE * 2)).toBe(false);
    expect(resolveArtifactPlaybackTempo(manifest, 120.25, 120.25 + TEMPO_MIRROR_TOLERANCE / 2)).toMatchObject({
      status: "valid",
      bpm: 120.25,
    });
    expect(resolveArtifactPlaybackTempo(manifest, 120.25, 120.26)).toMatchObject({
      status: "invalid",
      errors: ["tempo mismatch: manifest playback=120.25, database=120.26"],
    });
  });

  it("treats the manifest playback BPM as authority and fails closed on mirror drift", () => {
    const manifest = createLegacyBootstrapManifest("test-song", 120, now);
    expect(resolveArtifactPlaybackTempo(manifest, 120, 120)).toEqual({
      status: "valid",
      bpm: 120,
      manifest,
      errors: [],
    });
    expect(resolveArtifactPlaybackTempo(manifest, 118, 120)).toMatchObject({
      status: "invalid",
      bpm: null,
      errors: ["tempo mismatch: manifest playback=120, notes.json=118"],
    });
    expect(resolveArtifactPlaybackTempo(manifest, 120, 118)).toMatchObject({
      status: "invalid",
      bpm: null,
      errors: ["tempo mismatch: manifest playback=120, database=118"],
    });
  });

  it("rejects a missing or out-of-range selected notes tempo", () => {
    expect(resolveArtifactPlaybackTempo(null, undefined)).toMatchObject({
      status: "invalid",
      errors: ["selected notes.json must contain tempoBpm between 20 and 300"],
    });
    expect(resolveArtifactPlaybackTempo(null, 301)).toMatchObject({
      status: "invalid",
      errors: ["selected notes.json must contain tempoBpm between 20 and 300"],
    });
  });
});
