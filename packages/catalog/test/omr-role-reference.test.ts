import { describe, expect, it } from "vitest";
import {
  buildOmrConsensus,
  canonicalOmrConsensusJson,
  type OmrConsensusReport,
  type OmrScoreInput,
} from "../src/omr-consensus.js";
import {
  buildTrustedPartialReference,
  groupOmrReviewRegions,
  type RoleAlignmentRegion,
} from "../src/omr-role-reference.js";

function score(overrides: Partial<OmrScoreInput> = {}): OmrScoreInput {
  return {
    title: "Synthetic role reference",
    parts: [{
      id: "P1",
      name: "Piano",
      measures: [
        {
          id: "m1",
          number: "1",
          page: 1,
          system: 1,
          durationBeats: 4,
          timeSignature: [4, 4],
          events: [
            { onset: 0, duration: 1, pitch: 72, role: "melody", staff: 1, voice: "upper" },
            { onset: 0, duration: 2, pitch: 48, role: "harmony", staff: 2, voice: "lower" },
            { onset: 2, duration: 1, pitch: 36, role: "rhythm", staff: 2, voice: "lower" },
          ],
        },
        {
          id: "m2",
          number: "2",
          page: 1,
          system: 1,
          startBeat: 4,
          durationBeats: 4,
          timeSignature: [4, 4],
          events: [
            { onset: 0, duration: 1, pitch: 74, role: "melody", staff: 1, voice: "upper" },
            { onset: 2, duration: 1, pitch: 50, role: "harmony", staff: 2, voice: "lower" },
          ],
        },
      ],
    }],
    ...overrides,
  };
}

function dualReport(candidate: OmrScoreInput = score(), reference: OmrScoreInput = score()): OmrConsensusReport {
  return buildOmrConsensus({
    engines: [
      { id: "audiveris", version: "5.11.0", independenceGroup: "audiveris", score: reference },
      { id: "homr", version: "0.4.0", independenceGroup: "homr", score: candidate },
    ],
  });
}

describe("OMR role-specific partial references", () => {
  it("projects trusted role lanes while masking only the disagreeing role", () => {
    const candidate = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: (measure.events ?? []).map((event) => event.role === "harmony" ? { ...event, pitch: event.pitch + 1 } : event),
        })),
      }],
    });
    const report = dualReport(candidate);
    const reference = buildTrustedPartialReference(report, {
      score: { id: "synthetic-role-score", title: "Role reference" },
      source: { sha256: "abc123", artifactType: "omr", accessMethod: "synthetic" },
    });

    expect(reference.measureOrder).toEqual(["P1:m1", "P1:m2"]);
    expect(reference.lanes.melody).toHaveLength(2);
    expect(reference.lanes.harmony).toHaveLength(0);
    expect(reference.regions[0]?.roles.melody.state).toBe("TRUSTED_CONSENSUS");
    expect(reference.regions[0]?.roles.harmony.state).toBe("UNKNOWN");
    expect(reference.unknownMasks.filter((mask) => mask.role === "harmony")).toEqual(expect.arrayContaining([
      expect.objectContaining({ measureIds: ["P1:m1"], reason: "review-required" }),
      expect.objectContaining({ measureIds: ["P1:m2"], reason: "review-required" }),
    ]));
    expect(reference.coverage.melody.coverage).toBe(1);
    expect(reference.coverage.harmony.coverage).toBe(0);
  });

  it("keeps unknown role events out of every lane and never turns them into rests", () => {
    const input = score({
      parts: [{
        ...score().parts[0]!,
        measures: [{
          ...score().parts[0]!.measures[0]!,
          events: [{ onset: 0, duration: 1, pitch: 60 }],
        }],
      }],
    });
    const report = buildOmrConsensus({ engines: [{ id: "single", version: "1", score: input }] });
    const reference = buildTrustedPartialReference(report);

    expect(reference.lanes.melody).toEqual([]);
    expect(reference.lanes.harmony).toEqual([]);
    expect(reference.lanes.rhythm).toEqual([]);
    expect(reference.unknownMasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "melody", reason: "role-unassigned" }),
      expect.objectContaining({ role: "harmony", reason: "role-unassigned" }),
      expect.objectContaining({ role: "rhythm", reason: "role-unassigned" }),
    ]));
    expect(JSON.stringify(reference)).not.toContain('"type":"rest"');
  });

  it("retains native provenance and trusted native role states", () => {
    const nativeHash = "a".repeat(64);
    const report = buildOmrConsensus({
      native: {
        id: "native-score",
        version: "2026.1",
        score: score(),
        provenance: { artifactType: "musicxml", accessMethod: "permitted-local-source", sha256: nativeHash },
      },
      engines: [{ id: "homr", version: "0.4.0", score: score({ title: "wrong" }) }],
    });
    const reference = buildTrustedPartialReference(report);

    expect(reference.regions[0]?.roles.melody.state).toBe("TRUSTED_NATIVE");
    expect(reference.regions[0]?.roles.melody.provenance).toMatchObject({
      kind: "native",
      engineIds: ["native-score"],
      versions: ["2026.1"],
      sourceSha256: nativeHash,
    });
    expect(reference.source).toMatchObject({ artifactType: "musicxml", accessMethod: "permitted-local-source" });
  });

  it("fails closed for caller-supplied native provenance hashes", () => {
    const report = buildOmrConsensus({
      native: {
        id: "native-score",
        version: "2026.1",
        score: score(),
        provenance: { artifactType: "musicxml", accessMethod: "permitted-local-source", sha256: "a".repeat(64) },
      },
      engines: [{ id: "homr", version: "0.4.0", score: score({ title: "wrong" }) }],
    });
    const path = "/Users/reidar/private/native.musicxml";
    const malformed = "caller-controlled-native-label";
    const untrustedReport = {
      ...report,
      native: {
        ...report.native!,
        provenance: { ...report.native!.provenance, sha256: path },
      },
    };
    const untrustedReference = buildTrustedPartialReference(untrustedReport);
    expect(untrustedReference.source.sha256).toBeNull();
    expect(untrustedReference.regions[0]?.roles.melody.provenance.sourceSha256).toBeNull();
    expect(JSON.stringify(untrustedReference)).not.toContain(path);

    const malformedReport = {
      ...report,
      native: {
        ...report.native!,
        provenance: { ...report.native!.provenance, sha256: malformed },
      },
    };
    const malformedReference = buildTrustedPartialReference(malformedReport);
    expect(malformedReference.source.sha256).toBeNull();
    expect(malformedReference.regions[0]?.roles.melody.provenance.sourceSha256).toBeNull();
    expect(JSON.stringify(malformedReference)).not.toContain(malformed);
  });

  it("uses the optional alignment adapter and remains deterministic under input reordering", () => {
    const report = dualReport();
    const alignedRegions: RoleAlignmentRegion[] = [
      { id: "aligned-1", canonicalMeasureIds: ["P1:m1", "P1:m2"], sourceMeasureIds: { audiveris: ["x", "y"] }, startBeat: 0, endBeat: 8, confidence: 1, status: "aligned" },
    ];
    const first = buildTrustedPartialReference(report, { alignedRegions });
    const reorderedReport = { ...report, measures: [...report.measures].reverse() };
    const second = buildTrustedPartialReference(reorderedReport, { alignedRegions });

    expect(first.regions[0]?.id).toBe("aligned-1");
    expect(first).toEqual(second);
    expect(canonicalOmrConsensusJson(first)).toBe(canonicalOmrConsensusJson(second));
    expect(first.alignment).toBe("hierarchical");
  });

  it("groups adjacent structured disagreements while splitting unmatched or different root causes", () => {
    const base = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({ ...measure, events: (measure.events ?? []).filter((event) => event.role === "melody") })),
      }],
    });
    const report = dualReport(score({
      parts: [{
        ...base.parts[0]!,
        measures: base.parts[0]!.measures.map((measure) => ({ ...measure, events: [] })),
      }],
    }), base);
    const groups = groupOmrReviewRegions(report);

    expect(report.reviewItems).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      measureIds: ["P1:m1", "P1:m2"],
      memberItems: ["P1:m1", "P1:m2"],
      rootCauses: ["structure", "melody-pitch", "rhythm"],
      roles: ["melody"],
      memberCount: 2,
    });
    expect(groups[0]?.confidence.min).toBeLessThanOrEqual(groups[0]!.confidence.median);
    expect(groups[0]?.confidence.median).toBeLessThanOrEqual(groups[0]!.confidence.max);

    const splitReport = { ...report, measures: report.measures.map((measure, index) => index === 1 ? { ...measure, agreement: null, reviewReasons: [] } : measure) };
    expect(groupOmrReviewRegions(splitReport)).toHaveLength(2);
  });

  it("emits empty lanes with explicit unknown coverage for roles with no evidence", () => {
    const melodyOnly = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({ ...measure, events: (measure.events ?? []).filter((event) => event.role === "melody") })),
      }],
    });
    const reference = buildTrustedPartialReference(buildOmrConsensus({ engines: [{ id: "single", version: "1", score: melodyOnly }] }));

    expect(reference.lanes.harmony).toEqual([]);
    expect(reference.coverage.harmony.trustedEventCount).toBe(0);
    expect(reference.coverage.harmony.unknownBeatSpan).toBe(8);
    expect(reference.coverage.harmony.coverage).toBeNull();
    expect(reference.regions.every((region) => region.roles.harmony.state === "UNKNOWN")).toBe(true);
  });

  it("counts omitted role events rather than mask rows and keeps role-unassigned masks off trusted lanes", () => {
    const candidate = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({
          ...measure,
          events: (measure.events ?? []).map((event) => event.role === "harmony" ? { ...event, pitch: event.pitch + 1 } : event),
        })),
      }],
    });
    const harmonyReference = buildTrustedPartialReference(dualReport(candidate));
    expect(harmonyReference.coverage.harmony.unknownEventCount).toBe(2);

    const unassigned = score({
      parts: [{
        ...score().parts[0]!,
        measures: [{
          ...score().parts[0]!.measures[0]!,
          events: [
            { onset: 0, duration: 1, pitch: 72, role: "melody" },
            { onset: 1, duration: 1, pitch: 60 },
          ],
        }],
      }],
    });
    const unassignedReference = buildTrustedPartialReference(buildOmrConsensus({ engines: [{ id: "single", version: "1", score: unassigned }] }));
    expect(unassignedReference.regions[0]?.roles.melody.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(unassignedReference.regions[0]?.unknownRoles).not.toContain("melody");
    expect(unassignedReference.coverage.melody.unknownBeatSpan).toBe(0);
    expect(unassignedReference.coverage.melody.unknownEventCount).toBe(0);
  });

  it("records only the engines that participate in the trusted consensus alignment", () => {
    const report = buildOmrConsensus({
      engines: [
        { id: "engine-a", version: "1", independenceGroup: "group-a", score: score() },
        { id: "engine-b", version: "1", independenceGroup: "group-b", score: score() },
        { id: "engine-c", version: "1", independenceGroup: "group-c", score: score() },
      ],
    });
    const reference = buildTrustedPartialReference(report);

    expect(reference.regions[0]?.roles.melody.provenance).toMatchObject({
      kind: "dual-omr-consensus",
      engineIds: ["engine-a", "engine-b"],
      independenceGroups: ["group-a", "group-b"],
    });
    expect(reference.regions[0]?.roles.melody.provenance.engineIds).not.toContain("engine-c");
  });

  it("is deterministic for reordered report events and fails closed for malformed reports", () => {
    const report = dualReport();
    const reordered = {
      ...report,
      measures: report.measures.map((measure) => ({ ...measure, events: [...measure.events].reverse() })).reverse(),
    };
    expect(buildTrustedPartialReference(report)).toEqual(buildTrustedPartialReference(reordered));
    expect(buildTrustedPartialReference(null as unknown as OmrConsensusReport).lanes).toEqual({ melody: [], harmony: [], rhythm: [] });
    expect(groupOmrReviewRegions({ measures: [null], reviewItems: [null] } as unknown as OmrConsensusReport)).toEqual([]);
  });

  it("never groups adjacent review items across rejected alignment regions", () => {
    const base = score({
      parts: [{
        ...score().parts[0]!,
        measures: score().parts[0]!.measures.map((measure) => ({ ...measure, events: (measure.events ?? []).filter((event) => event.role === "melody") })),
      }],
    });
    const report = dualReport(score({
      parts: [{ ...base.parts[0]!, measures: base.parts[0]!.measures.map((measure) => ({ ...measure, events: [] })) }],
    }), base);
    const alignedRegions: RoleAlignmentRegion[] = report.measures.map((measure) => ({
      id: `rejected-${measure.id}`,
      canonicalMeasureIds: [measure.id],
      sourceMeasureIds: {},
      startBeat: measure.startBeat,
      endBeat: measure.startBeat + measure.durationBeats,
      confidence: 0.2,
      status: "ambiguous",
    }));
    expect(report.reviewItems).toHaveLength(2);
    expect(groupOmrReviewRegions(report, { alignedRegions })).toHaveLength(2);
  });
});
