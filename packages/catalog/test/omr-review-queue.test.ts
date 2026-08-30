import { describe, expect, it } from "vitest";
import { buildOmrReviewQueue, omrReviewQueueJson } from "../src/omr-review-queue.js";
import * as catalog from "../src/index.js";

const measure = (overrides: Record<string, unknown> = {}) => ({
  id: "score-a:m1", index: 0, number: "1", page: 2, system: 1,
  state: "REVIEW", confidence: 0.3, source: "backend-a",
  timeSignature: [4, 4], keySignature: 2, durationBeats: 4,
  agreement: { disagreements: [
    { kind: "melody-pitch", role: "melody", severity: 0.8, detail: "A=60 B=62" },
    { kind: "melody-pitch", role: "melody", severity: 0.7, detail: "A=64 B=65" },
    { kind: "structure", role: null, severity: 1, detail: "underfull" },
  ] },
  roles: { melody: { state: "REVIEW_REQUIRED", confidence: 0.3 }, harmony: { state: null, confidence: null }, rhythm: { state: null, confidence: null } },
  events: [], reviewReasons: [], ...overrides,
});

describe("OMR review queue", () => {
  it("groups structural and role-specific evidence into localized items", () => {
    const queue = buildOmrReviewQueue({ metadata: { scoreId: "score-a" }, measures: [measure()] });
    expect(queue.items).toHaveLength(2);
    expect(queue.items[0]).toMatchObject({ scoreId: "score-a", page: 2, measureId: "score-a:m1", role: "melody", reasonCategory: "pitch", priorityClass: "high" });
    expect(queue.items[0]?.backendValues).toEqual({ "backend-a": ["A=60 B=62", "A=64 B=65"] });
    expect(queue.items[1]).toMatchObject({ role: "unknown", reasonCategory: "structure" });
  });

  it("is deterministic, redacts unsafe values, and fails closed on malformed rows", () => {
    const input = { metadata: { scoreId: "/Users/reidar/private", source: "https://u:p@example.test/x" }, measures: [measure(), null, { nope: true }] };
    const reversed = { ...input, measures: [...input.measures].reverse() };
    const first = buildOmrReviewQueue(input);
    expect(omrReviewQueueJson(first)).toBe(omrReviewQueueJson(buildOmrReviewQueue(reversed)));
    expect(omrReviewQueueJson(first)).not.toContain("/Users/reidar");
    expect(omrReviewQueueJson(first)).not.toContain("https://u:p@");
    expect(first.nonClaims).toContain("This queue is not automatic musical pitch correction.");
  });

  it("is publicly re-exported and consumes independent quality diagnostics", () => {
    expect(catalog.buildOmrReviewQueue).toBe(buildOmrReviewQueue);
    const queue = buildOmrReviewQueue({ scoreId: "quality-score", measures: [{
      backendId: "homr", backendVersion: "1", backendStatus: "available", sourceLabel: "homr",
      page: 3, system: 2, measureId: "P1:m3", measureNumber: "3", startBeat: 8, durationBeats: 4,
      state: "BROKEN", diagnostics: ["impossible-leap"],
      categories: {
        pitchPlausibility: { score: 0, flags: ["impossible-leap"] },
        rhythmicValidity: { score: 0.5, flags: ["underfull-measure"] },
        structuralValidity: { score: 0.8, flags: ["normalization-warning"] },
      },
    }] });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ measureId: "P1:m3", measureNumber: "3", state: "BROKEN", role: "unknown", reasonCategory: "pitch" });
    expect(queue.items[0]?.context.structural).toEqual({ agreement: 0.8, evidence: ["normalization-warning"] });
  });

  it("preserves separate backend A/B values and interpretations", () => {
    const queue = buildOmrReviewQueue({ scoreId: "s", measures: [measure({ agreement: { disagreements: [{
      kind: "melody-pitch", role: "melody", backendA: "audiveris", valueA: "60", interpretationA: "C4",
      backendB: "homr", valueB: "62", interpretationB: "D4", detail: "pitch disagreement",
    }] } })] });
    expect(queue.items[0]?.backendValues).toEqual({ audiveris: ["60"], homr: ["62"] });
    expect(queue.items[0]?.backendInterpretations).toEqual({ audiveris: ["C4"], homr: ["D4"] });
  });

  it("fails closed for unknown states and redacts every identifier field", () => {
    const queue = buildOmrReviewQueue({ scoreId: "/private/tmp/score https://u:p@example.test/x", measures: [{
      id: "/private/tmp/raw.bin", number: "1", page: 1, source: "/var/lib/backend", state: "unexpected",
      agreement: { disagreements: [{ kind: "melody-pitch", role: "melody", detail: "bad" }] },
    }] });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.state).toBe("BROKEN");
    const json = omrReviewQueueJson(queue);
    expect(json).not.toContain("/private/tmp");
    expect(json).not.toContain("/var/lib");
    expect(json).not.toContain("https://u:p@");
  });

  it("uses content tie-breakers for duplicate regions", () => {
    const rows = [measure({ id: "m", agreement: { disagreements: [{ kind: "melody-pitch", role: "melody", detail: "z" }] } }), measure({ id: "m", agreement: { disagreements: [{ kind: "melody-pitch", role: "melody", detail: "a" }] } })];
    const first = buildOmrReviewQueue({ scoreId: "s", measures: rows });
    const second = buildOmrReviewQueue({ scoreId: "s", measures: [...rows].reverse() });
    expect(omrReviewQueueJson(first)).toBe(omrReviewQueueJson(second));
  });
});
