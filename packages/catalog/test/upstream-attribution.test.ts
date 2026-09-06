import { describe, expect, it } from "vitest";
import {
  canonicalUpstreamReport,
  compareUpstreamRoutes,
  evaluateUpstreamRoute,
  hashCanonicalUpstreamReport,
  normalizeUpstreamTruth,
  type UpstreamRouteCandidate,
} from "../src/upstream-attribution.js";

const truthInput = [
  { midi: 64, start: 1, dur: 0.5, technique: "palm-mute", string: 2, fret: 5 },
  { midi: 60, start: 0, dur: 1, technique: "single-note", string: 6, fret: 0 },
];

const truth = normalizeUpstreamTruth(truthInput, {
  performanceId: "take-1",
  technique: "mixed",
  durationBeats: 3,
  tempoBpm: 120,
  sourceHash: "abc123",
});

describe("upstream attribution evaluator", () => {
  it("strictly validates truth and canonicalizes note order", () => {
    const reordered = normalizeUpstreamTruth([...truthInput].reverse(), {
      performanceId: "take-1",
      technique: "mixed",
      durationBeats: 3,
      tempoBpm: 120,
      sourceHash: "abc123",
    });
    expect(reordered).toEqual(truth);
    expect(() => normalizeUpstreamTruth([{ midi: 60, start: -1, dur: 1 }], {})).toThrow(/start/i);
    expect(() => normalizeUpstreamTruth([{ midi: 200, start: 0, dur: 1 }], {})).toThrow(/midi|pitch/i);
    expect(() => normalizeUpstreamTruth([{ midi: 60, start: 0, dur: 0 }], {})).toThrow(/duration|dur/i);
  });

  it("applies a performance technique to otherwise-unlabelled truth notes", () => {
    const labelled = normalizeUpstreamTruth([{ midi: 60, start: 0, dur: 1 }], { technique: "palm-mute" });
    expect(labelled.notes[0]?.technique).toBe("palm-mute");
  });

  it("matches duplicate onsets one-to-one with exact, PC, octave, and duration metrics", () => {
    const duplicateTruth = normalizeUpstreamTruth([
      { midi: 60, start: 0.1, dur: 1 },
      { midi: 60, start: 0.15, dur: 0.5 },
    ], { durationBeats: 2 });
    const result = evaluateUpstreamRoute(duplicateTruth, {
      route: "di",
      notes: [
        { midi: 60, start: 0.04, dur: 1.1 },
        { midi: 72, start: 0.14, dur: 0.25 },
      ],
    }, { onsetToleranceBeats: 0.06, durationToleranceBeats: 0.2 });

    expect(result.status).toBe("available");
    expect(result.exactPitch.matches).toBe(1);
    expect(result.onset.matches).toBe(2);
    expect(result.pitchClass.matches).toBe(2);
    expect(result.octaveDisplaced.matches).toBe(1);
    expect(result.duration.matched).toBe(2);
    expect(result.duration.meanAbsoluteErrorBeats).toBeCloseTo(0.175);
  });

  it("reports unsupported rate, candidate density, residuals, and technique aggregates", () => {
    const result = evaluateUpstreamRoute(truth, {
      route: "amp",
      durationBeats: 3,
      notes: [
        { midi: 60, start: 0.02, dur: 1 },
        { midi: 76, start: 1.01, dur: 0.25 },
        { midi: 200, start: 2, dur: 0.1 },
      ],
    }, { onsetToleranceBeats: 0.05 });

    expect(result.exactPitch.matches).toBe(1);
    expect(result.pitchClass.matches).toBe(2);
    expect(result.octaveDisplaced.matches).toBe(1);
    expect(result.unsupported).toEqual({ count: 1, rate: expect.closeTo(1 / 3), perSecond: expect.closeTo(2 / 3) });
    expect(result.candidateDensity.perBeat).toBeCloseTo(1);
    expect(result.onsetResidual.meanAbsoluteBeats).toBeCloseTo(0.015);
    expect(result.techniques["single-note"]?.exactPitch.matches).toBe(1);
    expect(result.techniques["palm-mute"]?.pitchClass.matches).toBe(1);
  });

  it("applies the configured onset tolerance to technique metrics", () => {
    const techniqueTruth = normalizeUpstreamTruth([
      { midi: 60, start: 0, dur: 1, technique: "single-note" },
    ], { durationBeats: 2 });
    const result = evaluateUpstreamRoute(techniqueTruth, {
      route: "di",
      notes: [{ midi: 60, start: 0.06, dur: 1 }],
    }, { onsetToleranceBeats: 0.05 });

    expect(result.onset.matches).toBe(0);
    expect(result.techniques["single-note"]?.onset.matches).toBe(0);
    expect(result.techniques["single-note"]?.exactPitch.matches).toBe(0);
  });

  it("keeps unavailable routes explicit and decomposes paired route losses", () => {
    const routes: Record<string, UpstreamRouteCandidate | null> = {
      di: { route: "di", notes: truth.notes },
      amp: { route: "amp", notes: [{ midi: 60, start: 0, dur: 1 }] },
      mixture: { route: "mixture", notes: [] },
      demucs: null,
    };
    const report = compareUpstreamRoutes(truth, routes);
    expect(report.routes.map((route) => route.route)).toEqual(["amp", "demucs", "di", "mixture"]);
    expect(report.routes.find((route) => route.route === "demucs")?.status).toBeNull();
    expect(report.loss.transcriptionFloor).toBe(1);
    expect(report.loss.timbreLoss).toBeGreaterThan(0);
    expect(report.loss.mixtureLoss).toBeGreaterThan(0);
    expect(report.decisions).toContain("TIMBRE_LIMITED");
  });

  it("recognizes descriptive local route IDs in loss decomposition", () => {
    const report = compareUpstreamRoutes(truth, {
      "di-basic-pitch": { route: "di-basic-pitch", notes: truth.notes },
      "amp-mic-basic-pitch": { route: "amp-mic-basic-pitch", notes: [{ midi: 60, start: 0, dur: 1 }] },
      "mixture-basic-pitch": { route: "mixture-basic-pitch", notes: [] },
    });
    expect(report.loss.transcriptionFloor).toBe(1);
    expect(report.loss.timbreLoss).toBeGreaterThan(0);
    expect(report.loss.mixtureLoss).toBeGreaterThan(0);
    expect(report.decisions).toContain("TIMBRE_LIMITED");
  });

  it("serializes and hashes reports without paths or runtime timestamps", () => {
    const report = compareUpstreamRoutes(truth, {
      di: { route: "di", notes: truth.notes, sourcePath: "/Users/example/private/take.mid", generatedAt: "2026-09-01T10:00:00Z" },
    });
    const changed = { ...report, generatedAt: "2026-09-01T11:00:00Z", runtimePath: "/tmp/other" };
    expect(canonicalUpstreamReport(report)).toBe(canonicalUpstreamReport(changed));
    expect(canonicalUpstreamReport(report)).toBe(canonicalUpstreamReport({ ...report, routes: [...report.routes].reverse() }));
    expect(canonicalUpstreamReport(report)).not.toMatch(/Users|private|tmp|generatedAt|runtimePath/);
    expect(hashCanonicalUpstreamReport(report)).toBe(hashCanonicalUpstreamReport(changed));
  });

  it("redacts path-like values even when their keys are not path-shaped", () => {
    const canonical = canonicalUpstreamReport({
      sourceRef: "/var/folders/keyspilli/take.mid",
      traceSource: "file:///Users/example/take.mid",
      ordinaryUrl: "https://example.com/reference",
    });

    expect(canonical).not.toMatch(/var|Users|reidar|take\.mid/);
    expect(canonical).toContain("https://example.com/reference");
  });
});
