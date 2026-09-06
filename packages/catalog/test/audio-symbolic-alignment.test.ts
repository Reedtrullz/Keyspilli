import { describe, expect, it } from "vitest";
import {
  canonicalAudioSymbolicAlignmentJson,
  evaluateAudioSymbolicAlignment,
  type AudioBeatAnchor,
  type AudioSymbolicAlignmentInput,
} from "../src/audio-symbolic-alignment.js";

function input(overrides: Partial<AudioSymbolicAlignmentInput> = {}): AudioSymbolicAlignmentInput {
  return {
    symbolicNotes: [
      { midi: 60, start: 0, dur: 0.5, vel: 100 },
      { midi: 62, start: 1, dur: 0.5, vel: 100 },
      { midi: 64, start: 2, dur: 0.5, vel: 100 },
    ],
    audioOnsetSeconds: [0, 0.5, 1],
    tempoBpm: 100,
    anchors: [
      { id: "start", audioSeconds: 0, beat: 0 },
      { id: "end", audioSeconds: 1, beat: 2 },
    ],
    ...overrides,
  };
}

describe("real audio to symbolic timing evidence", () => {
  it("maps independently anchored audio onsets and compares them with the naive tempo baseline", () => {
    const result = evaluateAudioSymbolicAlignment(input({ audioOnsetSeconds: [0.02, 0.53, 1.01] }));

    expect(result.status).toBe("aligned");
    expect(result.production).not.toBeNull();
    const production = result.production!;
    expect(production.mapping.method).toBe("anchors");
    expect(production.metrics.matchedOnsets).toBe(3);
    expect(production.metrics.errorBeats.p95).toBeLessThanOrEqual(0.08);
    expect(production.metrics.f1).toBe(1);
    expect(production.mapping.segments).toHaveLength(1);
    expect(result.naive?.metrics.errorBeats.p95 ?? 0).toBeGreaterThan(production.metrics.errorBeats.p95 ?? 0);
    expect(production.confidence).toBeGreaterThan(result.naive?.confidence ?? 0);
  });

  it("represents piecewise timing drift instead of hiding it in one global tempo", () => {
    const anchors: AudioBeatAnchor[] = [
      { id: "a", audioSeconds: 0, beat: 0 },
      { id: "b", audioSeconds: 0.5, beat: 1 },
      { id: "c", audioSeconds: 1.1, beat: 2 },
      { id: "d", audioSeconds: 1.7, beat: 3 },
    ];
    const result = evaluateAudioSymbolicAlignment(input({
      audioOnsetSeconds: [0, 0.5, 1.1, 1.7],
      anchors,
      symbolicNotes: [
        { midi: 60, start: 0, dur: 0.25, vel: 100 },
        { midi: 62, start: 1, dur: 0.25, vel: 100 },
        { midi: 64, start: 2, dur: 0.25, vel: 100 },
        { midi: 65, start: 3, dur: 0.25, vel: 100 },
      ],
    }));

    expect(result.status).toBe("aligned");
    expect(result.production).not.toBeNull();
    const production = result.production!;
    expect(production.mapping.segments).toHaveLength(3);
    expect(production.mapping.drift.segmentCount).toBe(3);
    expect(production.mapping.drift.maxRelativeChange).toBeGreaterThan(0);
    expect(production.metrics.errorBeats.p95).toBe(0);
  });

  it("supports explicit seconds-per-beat evidence without pretending candidate tempo is independent", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      anchors: undefined,
      tempoBpm: 120,
      secondsPerBeat: 0.6,
      beatZeroAudioSeconds: 0.1,
      audioOnsetSeconds: [0.1, 0.7, 1.3],
    }));

    expect(result.status).toBe("aligned");
    expect(result.production).not.toBeNull();
    const production = result.production!;
    expect(production.mapping.method).toBe("seconds-per-beat");
    expect(production.metrics.errorBeats.p95).toBe(0);
    expect(result.naive?.metrics.matchedOnsets).toBeLessThan(production.metrics.matchedOnsets);
  });

  it("uses an explicitly supplied native tempo map without collapsing tempo changes", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      anchors: undefined,
      tempoBpm: 120,
      nativeTempoEvents: [
        { beat: 0, bpm: 120 },
        { beat: 1, bpm: 60 },
      ],
      beatZeroAudioSeconds: 0,
      audioOnsetSeconds: [0, 0.5, 1.5],
      symbolicNotes: [
        { midi: 60, start: 0, dur: 0.25, vel: 100 },
        { midi: 62, start: 1, dur: 0.25, vel: 100 },
        { midi: 64, start: 2, dur: 0.25, vel: 100 },
      ],
    }));

    expect(result.status).toBe("aligned");
    expect(result.production?.mapping.method).toBe("native-tempo-map");
    expect(result.production?.mapping.segments).toHaveLength(2);
    expect(result.production?.metrics.errorSeconds.p95).toBe(0);
  });

  it("uses a single explicit beat anchor to phase-lock a seconds-per-beat map", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      anchors: [{ id: "phase", audioSeconds: 0.75, beat: 1 }],
      secondsPerBeat: 0.5,
      beatZeroAudioSeconds: undefined,
      tempoBpm: undefined,
      audioOnsetSeconds: [0.75, 1.25, 1.75],
      symbolicNotes: [
        { midi: 60, start: 1, dur: 0.25, vel: 100 },
        { midi: 62, start: 2, dur: 0.25, vel: 100 },
        { midi: 64, start: 3, dur: 0.25, vel: 100 },
      ],
    }));

    expect(result.status).toBe("aligned");
    expect(result.production?.metrics.f1).toBe(1);
  });

  it("fails closed for malformed, non-monotonic, and insufficient timing evidence", () => {
    const malformed = evaluateAudioSymbolicAlignment(input({
      audioOnsetSeconds: [0, Number.NaN, 0.5],
      anchors: [{ id: "bad", audioSeconds: 0, beat: 0 }],
    }));
    expect(malformed.status).toBe("invalid");
    expect(malformed.production).toBeNull();
    expect(malformed.diagnostics.join(" ")).toMatch(/audio onset|anchor/i);

    const nonMonotonic = evaluateAudioSymbolicAlignment(input({
      anchors: [
        { id: "a", audioSeconds: 0, beat: 0 },
        { id: "b", audioSeconds: 1, beat: 2 },
        { id: "c", audioSeconds: 2, beat: 1 },
      ],
    }));
    expect(nonMonotonic.status).toBe("invalid");

    const insufficient = evaluateAudioSymbolicAlignment(input({ anchors: undefined, tempoBpm: undefined, secondsPerBeat: undefined }));
    expect(insufficient.status).toBe("insufficient-evidence");
    expect(insufficient.production).toBeNull();
    expect(insufficient.confidence).toBe(0);
  });

  it("rejects numerically pathological seconds-per-beat evidence", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      anchors: undefined,
      tempoBpm: undefined,
      secondsPerBeat: 1e-100,
    }));
    expect(result.status).toBe("invalid");
    expect(result.production).toBeNull();
    expect(result.diagnostics.join(" ")).toMatch(/secondsPerBeat|0\.001/i);
  });

  it("does not serialize an infinite slope from pathological anchors", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      anchors: [
        { id: "a", audioSeconds: 0, beat: 0 },
        { id: "b", audioSeconds: 1, beat: Number.MAX_VALUE },
      ],
      audioOnsetSeconds: [0, 1],
    }));
    expect(result.production).toBeNull();
    expect(result.status).toBe("insufficient-evidence");
    expect(canonicalAudioSymbolicAlignmentJson(result)).not.toMatch(/Infinity|NaN/);
  });

  it("is deterministic when symbolic notes, audio onsets, and anchors arrive in another order", () => {
    const first = evaluateAudioSymbolicAlignment(input({
      symbolicNotes: [
        { midi: 64, start: 2, dur: 0.5, vel: 100 },
        { midi: 60, start: 0, dur: 0.5, vel: 100 },
        { midi: 62, start: 1, dur: 0.5, vel: 100 },
      ],
      audioOnsetSeconds: [1, 0, 0.5],
      anchors: [
        { id: "end", audioSeconds: 1, beat: 2 },
        { id: "start", audioSeconds: 0, beat: 0 },
      ],
    }));
    const second = evaluateAudioSymbolicAlignment(input());

    expect(second).toEqual(first);
    expect(canonicalAudioSymbolicAlignmentJson(first)).toBe(canonicalAudioSymbolicAlignmentJson(second));
    expect(canonicalAudioSymbolicAlignmentJson(first)).not.toMatch(/generatedAt|\/Users\/|\/private\/tmp/);
  });

  it("uses one-to-one onset matching and reports unmatched coverage", () => {
    const result = evaluateAudioSymbolicAlignment(input({
      audioOnsetSeconds: [0, 0.01, 0.5, 1.8],
      anchors: [
        { id: "start", audioSeconds: 0, beat: 0 },
        { id: "end", audioSeconds: 1.8, beat: 3.6 },
      ],
    }));

    expect(result.production).not.toBeNull();
    const production = result.production!;
    expect(production.metrics.audioOnsetCount).toBe(3);
    expect(production.metrics.matchedOnsets).toBeLessThanOrEqual(3);
    expect(production.metrics.matchedOnsets).toBeGreaterThan(0);
    expect(production.metrics.coverage.audioRatio).toBeLessThan(1);
    expect(production.metrics.coverage.symbolicRatio).toBeLessThan(1);
  });
});
