import { describe, expect, it } from "vitest";
import {
  DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS,
  evaluateOmrRoleQuality,
  groupOmrRoleQualityReviewRegions,
  canonicalOmrRoleQualityJson,
  type OmrRoleQualityInput,
} from "../src/omr-role-quality.js";
import type { OmrScoreInput } from "../src/omr-consensus.js";

function backend(score: OmrScoreInput, id = "audiveris"): NonNullable<OmrRoleQualityInput["engines"]>[number] {
  return { id, version: "5.11.0", score };
}

function score(measures: Array<Record<string, unknown>>): OmrScoreInput {
  return {
    title: "Synthetic role quality",
    parts: [{ id: "P1", name: "Piano", measures: measures as OmrScoreInput["parts"][number]["measures"] }],
  };
}

function measure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    number: "1",
    page: 1,
    system: 1,
    durationBeats: 4,
    timeSignature: [4, 4],
    events: [
      { onset: 0, duration: 1, pitch: 72, role: "melody", staff: 1, voice: "1", accidental: "natural" },
      { onset: 1, duration: 1, pitch: 74, role: "melody", staff: 1, voice: "1", accidental: "natural" },
      { onset: 2, duration: 2, pitch: 76, role: "melody", staff: 1, voice: "1", accidental: "natural" },
      { onset: 0, duration: 4, pitch: 48, role: "harmony", staff: 2, voice: "1", accidental: "natural" },
    ],
    ...overrides,
  };
}

describe("independent role-level OMR quality", () => {
  it("keeps melody ready when harmony is broken and does not require engine agreement", () => {
    const report = evaluateOmrRoleQuality({
      engines: [backend(score([
        measure(),
        measure({ id: "m2", number: "2", startBeat: 4, events: [
          { onset: 0, duration: 1, pitch: 74, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 1, duration: 1, pitch: 76, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 2, duration: 2, pitch: 77, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 0, duration: 5, pitch: 49, role: "harmony", staff: 2, voice: "1", accidental: "natural" },
        ] }),
      ]))],
    });

    const melody = report.backendSummaries.find((row) => row.role === "melody")!;
    const harmony = report.backendSummaries.find((row) => row.role === "harmony")!;
    const melodyRows = report.measures.filter((row) => row.role === "melody");
    expect(report.consensusClaim).toBe(false);
    expect(melody.referenceState).toBe("MELODY_REFERENCE_READY");
    expect(melody.readiness).toBe("READY");
    expect(melody.coverage).toBe(1);
    expect(harmony.referenceState).toBe("HARMONY_REFERENCE_NOT_READY");
    expect(harmony.readiness).toBe("REVIEW_REQUIRED");
    expect(melodyRows.every((row) => row.state === "AUTO_ACCEPT" || row.state === "LIKELY_OK")).toBe(true);
    expect(report.measures.filter((row) => row.role === "harmony").some((row) => row.state === "BROKEN" || row.state === "REVIEW")).toBe(true);
    expect(melodyRows.flatMap((row) => row.eventIds)).toEqual(["P1:m1:e1", "P1:m1:e2", "P1:m1:e3", "P1:m2:e1", "P1:m2:e2", "P1:m2:e3"]);
  });

  it("marks a role with no evidence unavailable instead of fabricating notes", () => {
    const input = score([measure({ events: [
      { onset: 0, duration: 4, pitch: 48, role: "harmony", staff: 2, voice: "1" },
    ] })]);
    const report = evaluateOmrRoleQuality({ engines: [backend(input)] });
    const rhythm = report.backendSummaries.find((row) => row.role === "rhythm")!;

    expect(rhythm.readiness).toBe("UNAVAILABLE");
    expect(rhythm.referenceState).toBe("UNAVAILABLE");
    expect(rhythm.coverage).toBeNull();
    expect(report.measures.filter((row) => row.role === "rhythm")).toHaveLength(1);
    expect(report.measures.find((row) => row.role === "rhythm")?.eventIds).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('"role":"rhythm","eventIds":["');
  });

  it("localizes adjacent melody issues into one review region and keeps root causes separate", () => {
    const bad = (id: string, number: string, startBeat: number) => measure({
      id,
      number,
      startBeat,
      events: [
        { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1", accidental: "natural" },
        { onset: 1, duration: 1, pitch: 110, role: "melody", staff: 1, voice: "1", accidental: "natural" },
      ],
    });
    const report = evaluateOmrRoleQuality({ engines: [backend(score([bad("m1", "1", 0), bad("m2", "2", 4), measure({ id: "m3", number: "3", startBeat: 8, events: [
      { onset: 0, duration: 1, pitch: 60, role: "harmony", staff: 2, voice: "1", accidental: "natural" },
    ] })]))] });
    const groups = groupOmrRoleQualityReviewRegions(report).filter((group) => group.role === "melody");

    expect(report.roleReadiness.melody.readiness).toBe("REVIEW_REQUIRED");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ role: "melody", measureIds: ["P1:m1", "P1:m2"], rootCauses: ["pitch"] });
    expect(groups[0]?.priorityClass).toBe("high");
    expect(groups[0]?.startBeat).toBe(0);
    expect(groups[0]?.endBeat).toBe(8);
    expect(groups[1]?.measureIds).toEqual(["P1:m3"]);
  });

  it("is deterministic under backend, measure, event, and role ordering", () => {
    const originalMeasures = [measure(), measure({ id: "m2", number: "2", startBeat: 4 })];
    const reorderedMeasures = originalMeasures.map((value) => ({ ...value, events: [...(value.events as Array<Record<string, unknown>>)].reverse() }));
    const first = evaluateOmrRoleQuality({ engines: [backend(score(originalMeasures), "audiveris"), backend(score([measure()]), "homr")] });
    const second = evaluateOmrRoleQuality({ engines: [backend(score([measure({ events: [...(measure().events as Array<Record<string, unknown>>)].reverse() })]), "homr"), backend(score(reorderedMeasures), "audiveris")] });

    expect(canonicalOmrRoleQualityJson(first)).toBe(canonicalOmrRoleQualityJson(second));
    expect(DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS.minReadyCoverage).toBeGreaterThanOrEqual(0.8);
    expect(DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS.autoAcceptScore).toBeGreaterThan(DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS.likelyOkScore);
  });
});
