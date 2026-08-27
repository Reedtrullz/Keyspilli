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

    // A present-but-empty value is one malformed field, not both a missing
    // required identity and a second non-empty-string violation.
    expect(validateArrangementManifest({
      ...base,
      identityStatus: "current",
      sourceArtifactHash: "",
      configFingerprint: "",
    })).toEqual([
      "sourceArtifactHash is required for current artifacts",
      "configFingerprint is required for current artifacts",
    ]);
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

  it("validates audio acquisition values and strict date-time timestamps", () => {
    const transcription = {
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      stemRoleThresholds: {
        vocals: { onsetThreshold: 0.5, frameThreshold: 0.3 },
        bass: { onsetThreshold: 0.65, frameThreshold: 0.45 },
        guitar: { onsetThreshold: 0.45, frameThreshold: 0.3 },
      },
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
    };
    for (const audioAcquisition of ["downloaded", "pre-seeded", "upload"] as const) {
      expect(validateTranscriptionProvenance({ ...transcription, audioAcquisition })).toEqual([]);
    }
    expect(validateTranscriptionProvenance({ ...transcription, audioAcquisition: "playlist" })).toContain(
      "transcription.audioAcquisition must be downloaded, pre-seeded, or upload when present",
    );

    for (const accepted of [
      "2026-08-27T10:00:00Z",
      "2026-08-27T10:00:00.1+02:00",
      "2026-08-27T10:00:00.123456789-05:30",
    ]) {
      expect(validateTranscriptionProvenance({ ...transcription, transcribedAt: accepted }), accepted).toEqual([]);
    }
    for (const rejected of [
      "2026-08-27",
      "August 27, 2026",
      "2026-08-27 10:00:00",
      "2026-02-30T10:00:00.000Z",
    ]) {
      expect(validateTranscriptionProvenance({ ...transcription, transcribedAt: rejected }), rejected).toContain(
        "transcription.transcribedAt must be an ISO timestamp",
      );
    }
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

  it("round-trips path-free metal separation and arrangement provenance", () => {
    const transcription = {
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      stemRoleThresholds: {
        vocals: { onsetThreshold: 0.5, frameThreshold: 0.3 },
        bass: { onsetThreshold: 0.65, frameThreshold: 0.45 },
        guitar: { onsetThreshold: 0.45, frameThreshold: 0.3 },
      },
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
      separation: {
        separator: "demucs",
        version: "4.0.1",
        model: "htdemucs",
        device: "cpu" as const,
        stems: [
          { role: "vocals" as const, noteCount: 24, confidence: 0.83 },
          { role: "bass" as const, noteCount: 16, confidence: 0.76 },
          { role: "drums" as const, noteCount: 0 },
          { role: "other" as const, noteCount: 48, confidence: 0.71 },
        ],
      },
      metalArrangement: {
        arranger: "keyspilli-metal",
        version: "metal-arranger-v1",
        strategy: "vocal-then-riff",
        identitySource: "mixed" as const,
        confidence: 0.78,
        warnings: ["uncertain harmony at beats 12-16"],
      },
    };
    expect(parseTranscriptionProvenance(transcription)).toEqual(transcription);
    expect(transcriptionConfigForFingerprint(transcription)).toEqual({
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      stemRoleThresholds: {
        vocals: { onsetThreshold: 0.5, frameThreshold: 0.3 },
        bass: { onsetThreshold: 0.65, frameThreshold: 0.45 },
        guitar: { onsetThreshold: 0.45, frameThreshold: 0.3 },
      },
      tempoSource: "detected",
      audioSource: "youtube",
      separation: { separator: "demucs", version: "4.0.1", model: "htdemucs", device: "cpu" },
      metalArrangement: { arranger: "keyspilli-metal", version: "metal-arranger-v1", strategy: "vocal-then-riff" },
    });
    expect(transcriptionConfigForFingerprint({
      ...transcription,
      transcribedAt: "2026-08-27T10:00:00.000Z",
      separation: {
        ...transcription.separation,
        stems: transcription.separation.stems.map((stem) => ({ ...stem, noteCount: stem.noteCount + 100, confidence: 0.01 })),
      },
      metalArrangement: {
        ...transcription.metalArrangement,
        identitySource: "vocals",
        confidence: 0.01,
        warnings: ["different run evidence"],
      },
    })).toEqual(transcriptionConfigForFingerprint(transcription));
    expect(validateTranscriptionProvenance({
      ...transcription,
      stemRoleThresholds: {
        ...transcription.stemRoleThresholds,
        guitar: { onsetThreshold: -0.1, frameThreshold: 0.3 },
      },
    })).toContain("transcription.stemRoleThresholds.guitar.onsetThreshold must be a finite number between 0 and 1");
  });

  it("fails closed on malformed or path-bearing metal provenance", () => {
    const transcription = {
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
      separation: {
        separator: "demucs",
        version: "4.0.1",
        model: "htdemucs",
        stems: [
          { role: "vocals", noteCount: 3, confidence: 1.1, path: "/tmp/vocals.wav" },
          { role: "vocals", noteCount: -1 },
        ],
      },
      metalArrangement: {
        arranger: "keyspilli-metal",
        version: "metal-arranger-v1",
        strategy: "vocal-then-riff",
        identitySource: "guitars",
        warnings: [""],
      },
    };
    expect(validateTranscriptionProvenance(transcription)).toEqual(expect.arrayContaining([
      "transcription.separation.stems[0].path is not a supported stem field",
      "transcription.separation.stems[0].confidence must be a finite number between 0 and 1 when present",
      "transcription.separation.stems must not contain duplicate role vocals",
      "transcription.separation.stems[1].noteCount must be a non-negative integer",
      "transcription.metalArrangement.identitySource must be vocals, other, mixed, or fallback-full-mix when present",
      "transcription.metalArrangement.warnings must be an array of non-empty strings when present",
    ]));
  });

  it("requires the canonical four separation roles", () => {
    const transcription = {
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
      separation: {
        separator: "demucs",
        version: "4.0.1",
        model: "htdemucs",
        stems: [
          { role: "vocals" as const, noteCount: 3 },
          { role: "other" as const, noteCount: 2 },
        ],
      },
    };
    expect(validateTranscriptionProvenance(transcription)).toEqual(expect.arrayContaining([
      "transcription.separation.stems must contain exactly one vocals, bass, drums, and other stem",
      "transcription.separation.stems is missing required role bass",
      "transcription.separation.stems is missing required role drums",
    ]));
  });

  it("validates separation device identity when present", () => {
    const transcription = {
      basicPitchVersion: "0.4.0",
      modelSerialization: "default",
      onsetThreshold: 0.5,
      frameThreshold: 0.35,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: now,
      separation: {
        separator: "demucs",
        version: "4.0.1",
        model: "htdemucs",
        device: "tpu",
        stems: [
          { role: "vocals" as const, noteCount: 3 },
          { role: "bass" as const, noteCount: 2 },
          { role: "drums" as const, noteCount: 0 },
          { role: "other" as const, noteCount: 4 },
        ],
      },
    };
    expect(validateTranscriptionProvenance(transcription)).toContain(
      "transcription.separation.device must be cpu, cuda, or mps when present",
    );
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
