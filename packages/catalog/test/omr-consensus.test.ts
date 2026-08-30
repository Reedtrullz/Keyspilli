import { describe, expect, it } from "vitest";
import {
  DEFAULT_OMR_CONSENSUS_THRESHOLDS,
  alignOmrScores,
  buildOmrConsensus,
  canonicalOmrConsensusJson,
  canonicalOmrRasterizationConfigJson,
  compareOmrMeasures,
  normalizeOmrRasterizationConfig,
  normalizeOmrScore,
  selectOmrConsensusEvents,
  type OmrBackendRun,
  type OmrScoreInput,
} from "../src/omr-consensus.js";

function score(overrides: Partial<OmrScoreInput> = {}): OmrScoreInput {
  return {
    title: "Synthetic score",
    tempoBpm: 110,
    parts: [{
      id: "P1",
      name: "Piano",
      measures: [
        {
          id: "m1",
          number: "1",
          durationBeats: 4,
          timeSignature: [4, 4],
          events: [
            { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1" },
            { onset: 1, duration: 1, pitch: 62, role: "melody", staff: 1, voice: "1" },
            { onset: 2, duration: 2, pitch: 48, role: "harmony", staff: 2, voice: "1" },
          ],
        },
        {
          id: "m2",
          number: "2",
          durationBeats: 4,
          timeSignature: [4, 4],
          events: [
            { onset: 0, duration: 1, pitch: 64, role: "melody", staff: 1, voice: "1" },
            { onset: 2, duration: 1, pitch: 65, role: "melody", staff: 1, voice: "1" },
          ],
        },
      ],
    }],
    ...overrides,
  };
}

describe("dual OMR consensus core", () => {
  it("normalizes event ordering and harmless voice/staff representation differences deterministically", () => {
    const first = normalizeOmrScore(score());
    const reordered = normalizeOmrScore({
      ...score(),
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: [...(measure.events ?? [])].reverse(),
        })),
      }],
    });

    expect(reordered.measures).toEqual(first.measures);
    expect(reordered.warnings).toEqual([]);
  });

  it("normalizes harmless part ordering by stable part identity", () => {
    const base = score({
      parts: [
        { id: "P2", name: "Bass", role: "harmony", measures: [{ number: "1", durationBeats: 4, events: [{ onset: 0, duration: 4, pitch: 40, role: "harmony" }] }] },
        { id: "P1", name: "Lead", role: "melody", measures: [{ number: "1", durationBeats: 4, events: [{ onset: 0, duration: 4, pitch: 72, role: "melody" }] }] },
      ],
    });
    const normalized = normalizeOmrScore(base);

    expect(normalized.parts.map((part) => part.id)).toEqual(["P1", "P2"]);
    expect(normalized.measures.map((measure) => measure.partId)).toEqual(["P1", "P2"]);
  });

  it("aligns measures by structure rather than measure labels", () => {
    const reference = normalizeOmrScore(score());
    const candidate = normalizeOmrScore({
      ...score(),
      parts: [{
        ...score().parts[0]!,
        measures: [
          { ...score().parts[0]!.measures[0]!, id: "pickup", number: "0", durationBeats: 1, events: [{ onset: 0, duration: 1, pitch: 55, role: "harmony" }] },
          { ...score().parts[0]!.measures[0]!, id: "candidate-1", number: "12" },
          { ...score().parts[0]!.measures[1]!, id: "candidate-2", number: "13" },
        ],
      }],
    });

    const alignment = alignOmrScores(reference, candidate);

    expect(alignment.matches.map((match) => [match.referenceIndex, match.candidateIndex])).toEqual([[0, 1], [1, 2]]);
    expect(alignment.unmatchedCandidate).toEqual([0]);
    expect(alignment.matches[0]?.confidence).toBeGreaterThan(0.7);
  });

  it("scores structure, rhythm, pitch, and role-specific agreement separately", () => {
    const reference = normalizeOmrScore(score());
    const candidate = normalizeOmrScore({
      ...score(),
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure, index) => ({
          ...measure,
          events: (measure.events ?? []).map((event) => event.role === "melody" && index === 0 ? { ...event, pitch: event.pitch + 1 } : event),
        })),
      }],
    });

    const agreement = compareOmrMeasures(reference.measures[0]!, candidate.measures[0]!);

    expect(agreement.structural).toBe(1);
    expect(agreement.rhythm).toBe(1);
    expect(agreement.pitch).toBeLessThan(1);
    expect(agreement.roles.melody.score).toBeLessThan(1);
    expect(agreement.roles.harmony.score).toBe(1);
    expect(agreement.overall).toBeGreaterThan(0.5);
  });

  it("localizes a pitch disagreement instead of poisoning neighboring consensus measures", () => {
    const reference = score();
    const candidate = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure, index) => index === 0 ? {
          ...measure,
          events: (measure.events ?? []).map((event) => event.role === "melody" ? { ...event, pitch: event.pitch + 1 } : event),
        } : measure),
      }],
    });
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: reference },
        { id: "homr", version: "0.3.0", score: candidate },
      ],
    });

    expect(report.measures[0]?.state).toBe("REVIEW_REQUIRED");
    expect(report.measures[1]?.state).toBe("TRUSTED_CONSENSUS");
    expect(report.summary.reviewRequiredMeasures).toBe(1);
    expect(report.summary.trustedMeasures).toBe(1);
    expect(report.eligibility.melody.coverage).toBeGreaterThan(0);
  });

  it("keeps a trusted melody region selectable when only harmony disagrees", () => {
    const reference = score();
    const candidate = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: (measure.events ?? []).map((event) => event.role === "harmony" ? { ...event, pitch: event.pitch + 1 } : event),
        })),
      }],
    });
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: reference },
        { id: "homr", version: "0.3.0", score: candidate },
      ],
    });

    expect(report.measures[0]?.state).toBe("TRUSTED_CONSENSUS");
    expect(report.measures[0]?.roles.melody.state).toBe("TRUSTED_CONSENSUS");
    expect(selectOmrConsensusEvents(report).filter((event) => event.role === "melody")).toHaveLength(4);
    expect(selectOmrConsensusEvents(report, "melody")).toHaveLength(4);
    expect(selectOmrConsensusEvents(report).filter((event) => event.role === "harmony")).toHaveLength(0);
  });

  it("does not select a role event when that role has no trusted confidence", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: score() },
        { id: "homr", version: "5.11.0", score: score() },
      ],
    });
    report.measures[0]!.roles.harmony = { state: null, confidence: null };

    expect(selectOmrConsensusEvents(report).filter((event) => event.role === "melody")).toHaveLength(4);
    expect(selectOmrConsensusEvents(report).filter((event) => event.role === "harmony")).toHaveLength(0);
  });

  it("preserves trusted role evidence from an otherwise failed measure", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: score() },
        { id: "homr", version: "5.11.0", score: score() },
      ],
    });
    report.measures[0]!.state = "FAILED";
    report.measures[0]!.roles.melody = { state: "TRUSTED_CONSENSUS", confidence: 1 };
    report.measures[0]!.roles.harmony = { state: "FAILED", confidence: 0 };

    expect(selectOmrConsensusEvents(report).filter((event) => event.measureId === "P1:m1" && event.role === "melody")).toHaveLength(2);
    expect(selectOmrConsensusEvents(report).filter((event) => event.measureId === "P1:m1" && event.role === "harmony")).toHaveLength(0);
  });

  it("gives a legitimate native score priority over both OMR engines", () => {
    const native = score({ title: "Native" });
    const wrongOmr = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: (measure.events ?? []).map((event) => ({ ...event, pitch: event.pitch + 5 })),
        })),
      }],
    });
    const report = buildOmrConsensus({
      native: { id: "native-score", version: "1", score: native, provenance: { sourcePage: "logical-score-page", artifactType: "musicxml", accessMethod: "permitted-local-source" } },
      engines: [
        { id: "audiveris", version: "5.11.0", score: wrongOmr },
        { id: "homr", version: "0.3.0", score: wrongOmr },
      ],
    });

    expect(report.measures.every((measure) => measure.state === "TRUSTED_NATIVE")).toBe(true);
    expect(report.nativePriority).toBe(true);
    expect(selectOmrConsensusEvents(report).map((event) => event.pitch)).toContain(60);
  });

  it("falls back to a single validated engine and marks an unavailable backend explicitly", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: score() },
        { id: "homr", version: "unavailable", status: "unavailable", error: "optional backend not installed" },
      ],
    });

    expect(report.backends.find((backend) => backend.id === "homr")).toMatchObject({ status: "unavailable" });
    expect(report.measures.every((measure) => measure.state === "TRUSTED_SINGLE_ENGINE")).toBe(true);
    expect(report.summary.fallbackWindows).toBe(2);
  });

  it("records the thresholds used for trust and does not treat shared backend groups as independent", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", independenceGroup: "same-run", score: score() },
        { id: "homr", version: "0.3.0", independenceGroup: "same-run", score: score() },
      ],
      options: { consensusTrust: 0.9, eligibleCoverage: 0.75 },
    });

    expect(report.thresholds).toEqual({ consensusTrust: 0.9, reviewRequired: 0.4, eligibleCoverage: 0.75, onsetToleranceBeats: 0.08 });
    expect(report.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.measures.every((measure) => measure.state === "TRUSTED_SINGLE_ENGINE")).toBe(true);
    expect(report.backends.every((backend) => backend.independenceGroup === "same-run")).toBe(true);
  });

  it("keeps role eligibility on the single independent evidence lane", () => {
    const report = buildOmrConsensus({
      engines: [
        // These are two wrappers of the same underlying run. They must not
        // manufacture consensus, but the remaining lane is still valid
        // single-engine evidence for each role it actually contains.
        { id: "audiveris-first", version: "5.11.0", independenceGroup: "audiveris-run", score: score() },
        { id: "audiveris-retry", version: "5.11.0", independenceGroup: "audiveris-run", score: score() },
      ],
    });

    expect(report.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.measures[0]?.roles.melody.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.measures[0]?.roles.harmony.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.eligibility.melody.coverage).toBe(1);
    expect(report.eligibility.harmony.coverage).toBe(1);
  });

  it("does not call a single engine trustworthy when normalization discarded evidence", () => {
    const malformed = score({
      parts: [{
        ...score().parts[0]!,
        measures: [{
          ...score().parts[0]!.measures[0]!,
          events: [
            ...score().parts[0]!.measures[0]!.events!,
            { onset: -1, duration: 1, pitch: 60, role: "melody" },
          ],
        }],
      }],
    });
    const report = buildOmrConsensus({ engines: [{ id: "audiveris", version: "5.11.0", score: malformed }] });

    expect(report.measures[0]?.state).toBe("REVIEW_REQUIRED");
    expect(report.summary.state).toBe("REVIEW_REQUIRED");
  });

  it("does not let malformed native evidence outrank a validated OMR run", () => {
    const malformedNative = score({
      parts: [{
        ...score().parts[0]!,
        measures: [{
          ...score().parts[0]!.measures[0]!,
          events: [{ onset: 0, duration: 1, pitch: 200, role: "melody" }],
        }],
      }],
    });
    const report = buildOmrConsensus({
      native: { id: "native-score", version: "1", score: malformedNative, provenance: { artifactType: "musicxml" } },
      engines: [{ id: "audiveris", version: "5.11.0", score: score() }],
    });

    expect(report.nativePriority).toBe(false);
    expect(report.measures[0]?.state).toBe("TRUSTED_SINGLE_ENGINE");
  });

  it("does not trust native payloads without explicit provenance and version", () => {
    const withoutProvenance = buildOmrConsensus({
      native: { id: "native-score", version: "1", score: score(), provenance: undefined as never },
      engines: [{ id: "audiveris", version: "5.11.0", score: score() }],
    });
    const withoutVersion = buildOmrConsensus({
      native: { id: "native-score", version: "", score: score(), provenance: { artifactType: "musicxml" } },
      engines: [{ id: "audiveris", version: "5.11.0", score: score() }],
    });

    expect(withoutProvenance.nativePriority).toBe(false);
    expect(withoutProvenance.measures.every((measure) => measure.state === "TRUSTED_SINGLE_ENGINE")).toBe(true);
    expect(withoutVersion.nativePriority).toBe(false);
    expect(withoutVersion.measures.every((measure) => measure.state === "TRUSTED_SINGLE_ENGINE")).toBe(true);
  });

  it("keeps role coverage independent and exposes eligibility only for sufficiently trusted regions", () => {
    const melodyOnly = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: (measure.events ?? []).filter((event) => event.role === "melody"),
        })),
      }],
    });
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: melodyOnly },
        { id: "homr", version: "5.11.0", score: melodyOnly },
      ],
    });

    expect(report.eligibility.melody.eligible).toBe(true);
    expect(report.eligibility.harmony.eligible).toBe(false);
    expect(report.eligibility.harmony.coverage).toBeNull();
  });

  it("prioritizes melody pitch disagreement above engraving-level differences", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: score() },
        { id: "homr", version: "5.11.0", score: score({ parts: [{ ...score().parts[0]!, measures: score().parts[0]!.measures.map((measure) => ({ ...measure, events: (measure.events ?? []).map((event) => event.role === "melody" ? { ...event, pitch: event.pitch + 2 } : event) })) }] }) },
      ],
    });

    expect(report.reviewItems[0]?.priorityClass).toBe("high");
    expect(report.reviewItems[0]?.reasons.some((reason) => reason.includes("melody pitch"))).toBe(true);
  });

  it("produces path-safe deterministic serialization and stable raster configuration", () => {
    const config = normalizeOmrRasterizationConfig({ dpi: 300, format: "png", renderer: { id: "pdftoppm", version: "24.04" }, outputDirectory: "/Users/reidar/secret/pages" });
    expect(config).toEqual({ dpi: 300, format: "png", renderer: { id: "pdftoppm", version: "24.04" }, crop: null, rotation: 0, pages: null });
    expect(canonicalOmrRasterizationConfigJson(config)).toBe('{"crop":null,"dpi":300,"format":"png","pages":null,"renderer":{"id":"pdftoppm","version":"24.04"},"rotation":0}');

    const report = buildOmrConsensus({
      engines: [{ id: "audiveris", version: "5.11.0", score: score({ metadata: { sourcePath: "/Users/reidar/private/score.pdf", generatedAt: "now", logicalLabel: "score" } }) }],
      metadata: { outputDirectory: "/private/tmp/omr-output", generatedAt: "2026-08-30T00:00:00.000Z" },
    });
    const canonical = canonicalOmrConsensusJson(report);
    expect(canonical).not.toContain("/Users/reidar");
    expect(canonical).not.toContain("/private/tmp");
    expect(canonical).not.toContain("generatedAt");
    expect(canonical).toBe(canonicalOmrConsensusJson(JSON.parse(canonical)));
  });

  it("fails closed for malformed optional backend payloads without throwing", () => {
    expect(() => normalizeOmrScore(null as unknown as OmrScoreInput)).not.toThrow();
    const report = buildOmrConsensus({
      engines: [
        { id: "audiveris", version: "5.11.0", score: { parts: null } as unknown as OmrScoreInput },
        { id: "homr", version: "0.3.0", status: "unavailable", error: "optional backend not installed" },
      ],
    });
    expect(report.summary.state).toBe("FAILED");
    expect(report.backends[0]).toMatchObject({ status: "available", measureCount: 0 });
    expect(report.backends[1]).toMatchObject({ status: "unavailable" });
  });

  it("normalizes malformed nested roles/rests and invalid backend entries without throwing", () => {
    const malformed = score({
      parts: [{
        id: "P1",
        measures: [{
          id: "m1",
          durationBeats: 4,
          rests: [null as unknown as { onset: number; duration: number }],
          events: [{ onset: 0, duration: 1, pitch: 60, role: "not-a-role" as unknown as "melody" }],
        }],
      }],
    });
    expect(() => normalizeOmrScore(malformed)).not.toThrow();
    expect(normalizeOmrScore(malformed).measures[0]?.events[0]?.role).toBeNull();

    expect(() => buildOmrConsensus({ engines: [null as unknown as { id: string; version: string }] })).not.toThrow();
  });

  it("ignores an empty engine when a later engine provides usable evidence", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "empty", version: "1", score: { parts: [] } },
        { id: "usable", version: "1", score: score() },
      ],
    });

    expect(report.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.measures[0]?.source).toBe("usable");
    expect(report.backends.find((backend) => backend.id === "empty")).toMatchObject({ measureCount: 0 });
  });

  it("drops array-shaped parts and measures instead of creating phantom identifiers", () => {
    const normalized = normalizeOmrScore({
      parts: [
        [] as unknown as OmrScoreInput["parts"][number],
        {
          id: "P1",
          measures: [
            [] as unknown as OmrScoreInput["parts"][number]["measures"][number],
            { id: "m1", durationBeats: 4, events: [] },
          ],
        },
      ],
    });

    expect(normalized.parts.map((part) => part.id)).toEqual(["P1"]);
    expect(normalized.measures.map((measure) => measure.id)).toEqual(["P1:m1"]);
    expect(normalized.warnings).toEqual([
      "dropped invalid measure in P1",
      "dropped invalid part at index 1",
    ]);
  });

  it("does not penalize two measures that both omit a time signature", () => {
    const reference = normalizeOmrScore({ parts: [{ id: "P1", measures: [{ durationBeats: 4, events: [] }] }] });
    const candidate = normalizeOmrScore({ parts: [{ id: "P1", measures: [{ durationBeats: 4, events: [] }] }] });

    expect(compareOmrMeasures(reference.measures[0]!, candidate.measures[0]!).structural).toBe(1);
  });

  it("redacts URL credentials in canonical metadata", () => {
    const canonical = canonicalOmrConsensusJson({ source: "https://user:secret@example.test/score.xml", nested: { url: "file:///Users/reidar/score.xml" } });

    expect(canonical).not.toContain("secret");
    expect(canonical).not.toContain("user:");
    expect(canonical).not.toContain("/Users/reidar");
  });

  it("normalizes a malformed raster config without throwing", () => {
    expect(normalizeOmrRasterizationConfig(null as unknown as never)).toEqual({
      dpi: 300,
      format: "png",
      renderer: { id: "pdftoppm", version: "unknown" },
      crop: null,
      rotation: 0,
      pages: null,
    });
  });

  it("keeps returned consensus metadata path-safe, not only its canonical hash", () => {
    const report = buildOmrConsensus({
      engines: [{
        id: "audiveris",
        version: "5.11.0",
        score: score(),
      }],
      metadata: {
        sourcePath: "/Users/reidar/private/score.pdf",
        nested: { outputDirectory: "/private/tmp/omr", label: "score" },
      },
      native: {
        id: "native-score",
        version: "1",
        score: score(),
        provenance: { artifactType: "musicxml", sourcePath: "/Users/reidar/private/native.musicxml" },
      },
    });

    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
    expect(JSON.stringify(report)).not.toContain("/private/tmp");
  });

  it("uses centralized conservative thresholds", () => {
    expect(DEFAULT_OMR_CONSENSUS_THRESHOLDS.consensusTrust).toBeGreaterThan(0.7);
    expect(DEFAULT_OMR_CONSENSUS_THRESHOLDS.reviewRequired).toBeLessThan(DEFAULT_OMR_CONSENSUS_THRESHOLDS.consensusTrust);
    expect(DEFAULT_OMR_CONSENSUS_THRESHOLDS.eligibleCoverage).toBeGreaterThanOrEqual(0.8);
  });

  it("preserves sanitized HOMR health, page, invocation, and model metadata", () => {
    const homr = {
      id: "homr",
      version: "0.4.0",
      score: score(),
      health: "partially-available",
      pages: [
        { page: 2, status: "available", elapsedMs: 120, musicXmlGenerated: true, stderrSummary: "cache /Users/reidar/.cache/homr" },
        { page: 1, status: "failed", elapsedMs: Number.NaN, musicXmlGenerated: false, stderrSummary: "failed" },
      ],
      invocation: { command: "uvx", args: ["--from", "homr==0.4.0", "homr", "/private/input/page-1.png"] },
      model: { id: "homr-default", version: "2026.08", weightsPath: "/private/cache/homr/model.bin" },
    } as unknown as OmrBackendRun;
    const report = buildOmrConsensus({ engines: [homr] });
    const backend = report.backends[0]!;

    expect(backend).toMatchObject({
      health: "partially-available",
      pages: [
        { page: 1, status: "failed", elapsedMs: null, musicXmlGenerated: false, stderrSummary: "failed" },
        { page: 2, status: "available", elapsedMs: 120, musicXmlGenerated: true, stderrSummary: "[redacted-path]" },
      ],
      invocation: { command: "uvx", args: ["--from", "homr==0.4.0", "homr", "[redacted-path]"] },
      model: { id: "homr-default", version: "2026.08", weightsPath: "[redacted-path]" },
    });
    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
    expect(JSON.stringify(report)).not.toContain("/private/input");
  });

  it("ignores invalid backend health metadata without changing consensus semantics", () => {
    const homr = {
      id: "homr",
      version: "0.4.0",
      score: score(),
      health: "healthy-but-not-a-contract-state",
      invocation: "uvx",
      model: "homr-default",
    } as unknown as OmrBackendRun;
    const report = buildOmrConsensus({ engines: [homr] });

    expect(report.backends[0]).not.toHaveProperty("health");
    expect(report.backends[0]).toMatchObject({ invocation: "uvx", model: "homr-default" });
    expect(report.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
  });
});
