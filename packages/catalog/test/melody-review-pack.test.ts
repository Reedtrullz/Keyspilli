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

  it("merges equivalent groups deterministically even when their metadata differs", () => {
    const scores = [{
      id: "song",
      title: "Song",
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [
        group("song", 1, { id: "zeta", decision: "accepted", confidence: { min: 0.1, median: 0.4, max: 0.7 } }),
        group("song", 1, { id: "alpha", decision: "accepted", confidence: { min: 0.2, median: 0.5, max: 0.8 } }),
      ] },
    }];
    const first = buildMelodyReviewPack(input(scores));
    const second = buildMelodyReviewPack(input([{ ...scores[0], review: { regions: [...scores[0]!.review.regions].reverse() } }]));
    expect(canonicalMelodyReviewPackJson(first)).toBe(canonicalMelodyReviewPackJson(second));
    expect(first.summary.candidateUnits).toBe(1);
    expect(first.resolved[0]).toMatchObject({ decision: "accepted", unitId: "alpha", groupId: "alpha" });
  });

  it("fails closed when equivalent groups carry conflicting completed decisions", () => {
    expect(() => buildMelodyReviewPack(input([{
      id: "song",
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [
        group("song", 1, { decision: "accepted" }),
        group("song", 1, { decision: "rejected" }),
      ] },
    }]))).toThrow(/conflicting.*decision/i);
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

  it("rejects melody candidates without a stable identity instead of synthesizing one", () => {
    const report = buildMelodyReviewPack(input([{
      id: "song",
      review: { regions: [
        { role: "melody", state: "REVIEW", rootCauses: ["pitch"] },
        group("song", 1),
      ] },
    }]));
    expect(report.summary.candidateUnits).toBe(1);
    expect(report.bootstrap.decisions.map((unit) => unit.id)).toEqual(["homr:melody:song:m1"]);
  });

  it("requires exactly one correction-ledger target selector", () => {
    const result = validateMelodyCorrectionLedger({
      schemaVersion: 1,
      kind: "melody-correction-ledger",
      entries: [{
        scoreId: "song",
        scoreHash: HASH_A,
        groupId: "group",
        unitId: "unit",
        decision: "accepted",
        rationale: "human notation check",
        correctedValues: {},
      }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/exactly one.*groupId.*unitId/i);
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

  it("validates event IDs when a ledger targets an already-resolved record", () => {
    const pack = buildMelodyReviewPack(input([{
      id: "song",
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [group("song", 1, { decision: "accepted", eventIds: ["event-1", "event-2"] })] },
    }]));
    const resolved = pack.resolved[0]!;
    expect(resolved.eventIds).toEqual(["event-1", "event-2"]);
    const ledger = {
      schemaVersion: 1,
      kind: "melody-correction-ledger",
      entries: [{
        scoreId: "song",
        scoreHash: HASH_A,
        groupId: resolved.groupId,
        eventIds: ["event-missing"],
        decision: "accepted",
        rationale: "human notation check",
        correctedValues: {},
      }],
    };
    expect(() => applyMelodyCorrectionLedger(pack, ledger)).toThrow(/event IDs/i);

    const pendingPack = buildMelodyReviewPack(input([{
      id: "pending-song",
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [group("pending-song", 1, { eventIds: ["event-1", "event-2"] })] },
    }]));
    const pendingUnit = pendingPack.bootstrap.decisions[0]!;
    const validLedger = {
      ...ledger,
      entries: [{ ...ledger.entries[0], scoreId: "pending-song", groupId: pendingUnit.groupId, eventIds: ["event-1"], decision: "corrected", correctedValues: { pitch: 64 } }],
    };
    const applied = applyMelodyCorrectionLedger(pendingPack, validLedger);
    expect(applied.resolved[0]).toMatchObject({ eventIds: ["event-1", "event-2"] });
    expect(applyMelodyCorrectionLedger(applied, validLedger)).toEqual(applied);
  });

  it("recomputes bootstrap score IDs after applying corrections", () => {
    const pack = buildMelodyReviewPack(input(["a", "b", "c"].map((scoreId) => ({
      id: scoreId,
      source: { pdf: { sha256: HASH_A } },
      review: { regions: [group(scoreId, 1)] },
    }))));
    const target = pack.bootstrap.decisions.find((unit) => unit.scoreId === "a")!;
    const applied = applyMelodyCorrectionLedger(pack, {
      schemaVersion: 1,
      kind: "melody-correction-ledger",
      entries: [{
        scoreId: "a",
        scoreHash: HASH_A,
        unitId: target.id,
        decision: "accepted",
        rationale: "human notation check",
        correctedValues: {},
      }],
    });
    expect(applied.bootstrap.scoreIds).toEqual(["b", "c"]);
    expect(applied.bootstrap.scoreIds).toEqual([...new Set(applied.bootstrap.decisions.map((unit) => unit.scoreId))].sort());
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
