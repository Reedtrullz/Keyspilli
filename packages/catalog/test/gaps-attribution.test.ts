import { describe, expect, it } from "vitest";
import {
  GAPS_ATTRIBUTION_SCHEMA_VERSION,
  assembleGapsAttributionReport,
  classifyGapsDecision,
  canonicalGapsEvaluation,
  evaluateGapsAttribution,
  hashCanonicalGapsEvaluation,
  normalizeGapsBeatTimeline,
  normalizeGapsRouteCandidate,
  validateGapsProvenance,
  type GapsAttributionInput,
  type GapsProvenance,
} from "../src/gaps-attribution.js";

const checkpoint = { id: "gaps-test", sha256: "a".repeat(64), sizeBytes: 4096 };
const provenance: GapsProvenance = {
  schemaVersion: GAPS_ATTRIBUTION_SCHEMA_VERSION,
  backend: { id: "gaps", version: "1.0.0", checkpoint, config: { device: "cpu", sampleRate: 22050 } },
  preRegistration: {
    dataset: "synthetic-guitar-v1",
    itemIds: ["item-a", "item-b", "item-c"],
    techniques: ["chord", "palm-mute", "single-note"],
  },
};

const truth = (technique: string, midi: number) => ({
  notes: [{ midi, start: 0, dur: 1, technique }],
  metadata: { technique, durationBeats: 2, tempoBpm: 120 },
});

function input(gaps: number[][], current: number[][] = gaps.map((entry) => [entry[0]!])): GapsAttributionInput {
  return {
    provenance,
    items: ["single-note", "palm-mute", "chord"].map((technique, index) => ({
      id: `item-${String.fromCharCode(97 + index)}`,
      truth: truth(technique, 60 + index),
      current: normalizeGapsRouteCandidate("current-guitar-amt", [{ midi: current[index]![0]!, start: 0, dur: 1 }]),
      gaps: normalizeGapsRouteCandidate("gaps", [{ midi: gaps[index]![0]!, start: 0, dur: 1 }]),
    })),
  };
}

describe("GAPS evaluation tie-breaker", () => {
  it("validates pinned checkpoint size/hash and pre-registration", () => {
    expect(validateGapsProvenance(provenance)).toEqual(provenance);
    expect(() => validateGapsProvenance({ ...provenance, backend: { ...provenance.backend, checkpoint: { ...checkpoint, sizeBytes: 0 } } })).toThrow(/size/i);
    expect(() => validateGapsProvenance({ ...provenance, backend: { ...provenance.backend, checkpoint: { ...checkpoint, sha256: "bad" } } })).toThrow(/sha256/i);
    expect(() => validateGapsProvenance({ ...provenance, preRegistration: { ...provenance.preRegistration, itemIds: [] } })).toThrow(/item/i);
    expect(() => validateGapsProvenance({ ...provenance, backend: { ...provenance.backend, id: "other" } })).toThrow(/backend/i);
  });

  it("normalizes parsed notes into the existing upstream route candidate shape", () => {
    expect(normalizeGapsRouteCandidate("gaps", [{ midi: 60, start: 0, dur: 1, vel: 90 }], { durationBeats: 2 })).toEqual({
      route: "gaps", durationBeats: 2, notes: [{ midi: 60, start: 0, dur: 1 }],
    });
  });

  it("normalizes the fixed 120 BPM writer timeline without changing pitch", () => {
    expect(normalizeGapsBeatTimeline([{ midi: 64, start: 2, dur: 0.5 }], 60)).toEqual([
      { midi: 64, start: 1, dur: 0.25 },
    ]);
    expect(() => normalizeGapsBeatTimeline([{ midi: 64, start: -1, dur: 1 }], 60)).toThrow(/start/i);
  });

  it("keeps onset-only routes valid through aggregate evaluation", () => {
    const onsetRoute = (route: string, midi: number) => normalizeGapsRouteCandidate(route, [{ midi, onset: 0, dur: 1 }]);
    const report = evaluateGapsAttribution({
      ...input([[60], [61], [62]]),
      items: input([[60], [61], [62]]).items.map((item, index) => ({
        ...item,
        current: onsetRoute("current-guitar-amt", 60 + index),
        gaps: onsetRoute("gaps", 60 + index),
      })),
    });
    expect(report.aggregate.routes.gaps.status).toBe("available");
  });

  it("returns each conservative decision exactly once", () => {
    const validationThresholds = { materialExactGain: 0, materialPcGain: 0, techniqueExactGain: 0, techniquePcGain: 0, requiredTechniqueGains: 1 };
    const validated = evaluateGapsAttribution({ ...input([[60], [61], [62]], [[60], [63], [64]]), thresholds: validationThresholds });
    expect(validated.decision).toBe("GUITAR_SPECIFIC_AMT_VALIDATED");
    expect(validated.decisions).toEqual(["GUITAR_SPECIFIC_AMT_VALIDATED"]);

    const mixed = evaluateGapsAttribution({ ...input([[60], [61], [62]], [[60], [63], [64]]), thresholds: { ...validationThresholds, materialExactGain: 1, requiredTechniqueGains: 3 } });
    expect(mixed.decision).toBe("GUITAR_SPECIFIC_AMT_MIXED");
    expect(mixed.decisions).toEqual(["GUITAR_SPECIFIC_AMT_MIXED"]);

    const insufficient = evaluateGapsAttribution(input([[61], [62], [63]], [[64], [65], [66]]));
    expect(insufficient.decision).toBe("CURRENT_GUITAR_AMT_INSUFFICIENT");
    expect(insufficient.decisions).toEqual(["CURRENT_GUITAR_AMT_INSUFFICIENT"]);

    const unavailable = evaluateGapsAttribution({ ...input([[60], [61], [62]]), items: input([[60], [61], [62]]).items.map((item) => ({ ...item, gaps: { route: "gaps", status: "unavailable", notes: [] } })) });
    expect(unavailable.decision).toBe("GAPS_BACKEND_NOT_EVALUATED");
    expect(unavailable.decisions).toEqual(["GAPS_BACKEND_NOT_EVALUATED"]);
  });

  it("is deterministic, aggregates techniques, and rejects a third backend", () => {
    const first = evaluateGapsAttribution(input([[60], [61], [62]]));
    const second = evaluateGapsAttribution({ ...input([[60], [61], [62]]), items: [...input([[60], [61], [62]]).items].reverse() });
    expect(canonicalGapsEvaluation(first)).toBe(canonicalGapsEvaluation(second));
    expect(hashCanonicalGapsEvaluation(first)).toBe(hashCanonicalGapsEvaluation(second));
    expect(Object.keys(first.aggregate.routes)).toEqual(["current-guitar-amt", "gaps"]);
    expect(Object.keys(first.aggregate.techniques)).toEqual(["chord", "palm-mute", "single-note"]);
    expect(() => classifyGapsDecision({ ...first, aggregate: { ...first.aggregate, routes: { ...first.aggregate.routes, third: first.aggregate.routes.gaps } as never } })).toThrow(/third|route|backend/i);
  });

  it("redacts path-like values and can assemble a frozen metric pair", () => {
    const first = evaluateGapsAttribution({
      ...input([[60], [61], [62]], [[60], [63], [64]]),
      thresholds: { materialExactGain: 0, materialPcGain: 0, techniqueExactGain: 0, techniquePcGain: 0, requiredTechniqueGains: 1 },
    });
    const assembled = assembleGapsAttributionReport({
      provenance,
      items: first.items,
      aggregate: { current: first.aggregate.routes["current-guitar-amt"], gaps: first.aggregate.routes.gaps },
      thresholds: { materialExactGain: 0, materialPcGain: 0, techniqueExactGain: 0, techniquePcGain: 0, requiredTechniqueGains: 1 },
    });
    expect(assembled.decision).toBe(first.decision);
    const canonical = canonicalGapsEvaluation({ sourceRef: "/Users/reidar/private/file.mid", backend: { config: { weightsPath: "/tmp/weights" } } });
    expect(canonical).not.toContain("/Users/reidar/private/file.mid");
    expect(canonical).not.toContain("weightsPath");
  });
});
