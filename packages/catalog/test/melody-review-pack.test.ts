import { describe, expect, it } from "vitest";
import {
  applyMelodyCorrectionLedger,
  buildMelodyReviewPack,
  canonicalMelodyReviewPackJson,
  validateMelodyCorrectionLedger,
  type MelodyReviewInput,
} from "../src/melody-review-pack.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function group(scoreId: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `homr:melody:${scoreId}:m${index}`,
    role: "melody",
    backendId: "homr",
    backendVersion: "1.0",
    measureIds: [`m${index}`],
    firstMeasureIndex: index,
    lastMeasureIndex: index,
    startBeat: index * 4,
    endBeat: index * 4 + 4,
    rootCauses: ["impossible-leap"],
    priorityClass: "high",
    memberCount: 1,
    estimatedEventCount: 2,
    confidence: { min: 0.2, median: 0.5, max: 0.8 },
    ...overrides,
  };
}

function input(scores: unknown[]): MelodyReviewInput {
  return { kind: "local-reference-readiness", scores };
}

describe("melody review pack", () => {
  it("ranks deterministically regardless of score and group order", () => {
    const scores = [
      { id: "zeta", artist: "Artist", title: "Zeta", source: { pdf: { sha256: HASH_B } }, review: { regions: [group("zeta", 3), group("zeta", 1, { rootCauses: ["pitch"] })] } },
      { id: "alpha", artist: "Artist", title: "Alpha", source: { pdf: { sha256: HASH_A } }, review: { regions: [group("alpha", 2), group("alpha", 1)] } },
    ];
    const first = buildMelodyReviewPack(input(scores));
    const second = buildMelodyReviewPack(input([...scores].reverse().map((score) => ({ ...score, review: { regions: [...(score as { review: { regions: unknown[] } }).review.regions].reverse() } }))));
    expect(canonicalMelodyReviewPackJson(first)).toBe(canonicalMelodyReviewPackJson(second));
    expect(first.bootstrap.decisions.map((item) => item.id)).toEqual(expect.arrayContaining(["homr:melody:alpha:m1", "homr:melody:zeta:m1"]));
  });

  it("deduplicates equivalent groups and caps bootstrap work at twenty across three scores", () => {
    const scores = ["a", "b", "c", "d"].map((id) => ({
      id,
      title: id,
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [
        ...Array.from({ length: 12 }, (_, index) => group(id, index + 1)),
        group(id, 1),
      ] },
    }));
    const report = buildMelodyReviewPack(input(scores));
    expect(report.summary.candidateUnits).toBe(48);
    expect(report.bootstrap.decisions).toHaveLength(20);
    expect(new Set(report.bootstrap.decisions.map((item) => item.scoreId)).size).toBe(3);
    expect(report.deferred).toHaveLength(28);
  });

  it("groups duplicate role items while preserving melody-only evidence", () => {
    const report = buildMelodyReviewPack(input([{
      id: "song",
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [
        group("song", 2, { id: "same", rootCauses: ["pitch"] }),
        group("song", 2, { id: "same", rootCauses: ["timing"] }),
        group("song", 3, { role: "harmony" }),
      ] },
    }]));
    expect(report.summary.candidateUnits).toBe(1);
    expect(report.bootstrap.decisions[0]).toMatchObject({ measureIds: ["m2"], reasonCategories: ["pitch", "timing"] });
  });

  it("rejects a correction ledger whose score hash is stale and applies a valid ledger idempotently", () => {
    const pack = buildMelodyReviewPack(input([{ id: "song", source: { pdf: { sha256: HASH_A } }, review: { regions: [group("song", 1)] } }]));
    const stale = { schemaVersion: 1, kind: "melody-correction-ledger", entries: [{ scoreId: "song", scoreHash: HASH_B, groupId: pack.bootstrap.decisions[0]!.id, decision: "corrected", rationale: "human notation check", correctedValues: { pitch: 64 } }] };
    expect(() => applyMelodyCorrectionLedger(pack, stale)).toThrow(/stale|hash/i);
    const valid = { ...stale, entries: [{ ...stale.entries[0], scoreHash: HASH_A }] };
    expect(validateMelodyCorrectionLedger(valid)).toMatchObject({ valid: true });
    const once = applyMelodyCorrectionLedger(pack, valid);
    const twice = applyMelodyCorrectionLedger(once, valid);
    expect(twice).toEqual(once);
    expect(once.resolved[0]).toMatchObject({ decision: "corrected", unitId: pack.bootstrap.decisions[0]!.id });
  });

  it("redacts physical paths and never emits raw note payloads", () => {
    const report = buildMelodyReviewPack(input([{
      id: "/Users/reidar/private/song",
      artist: "/Users/reidar/artist",
      title: "file:///tmp/source.pdf",
      source: { pdf: { sha256: HASH_A, label: "/Users/reidar/source.pdf" } },
      review: { regions: [group("/Users/reidar/private/song", 1, { evidence: ["/Users/reidar/source.pdf", "pitch"] })] },
    }]));
    const json = canonicalMelodyReviewPackJson(report);
    expect(json).not.toContain("/Users/");
    expect(json).not.toContain("file:");
    expect(json).not.toContain("pitch: 64");
  });

  it("returns an honest unavailable report for empty or non-melody input", () => {
    expect(buildMelodyReviewPack({})).toMatchObject({ status: "UNAVAILABLE", bootstrap: { decisions: [] }, summary: { candidateUnits: 0 } });
    const report = buildMelodyReviewPack(input([{ id: "harmony", review: { regions: [group("harmony", 1, { role: "harmony" })] } }]));
    expect(report.status).toBe("UNAVAILABLE");
    expect(report.nonClaims.some((claim) => /fabricat|human/i.test(claim))).toBe(true);
  });
});
