import { describe, expect, it } from "vitest";
import { normalizeCanonicalScore } from "../src/omr-canonical.js";
import { alignOmrScores, normalizeOmrScore } from "../src/omr-consensus.js";
import {
  alignHierarchicalOmrScores,
  type OmrHierarchicalAlignment,
} from "../src/omr-hierarchical-alignment.js";
import type { OmrMeasureInput, OmrScoreInput } from "../src/omr-consensus.js";

type Event = { onset: number; duration: number; pitch: number; staff?: number; role?: "melody" | "harmony" | "rhythm"; tie?: "start" | "stop" | "continue"; tuplet?: boolean };

function measure(id: string, number: string | number, startBeat: number, durationBeats: number, events: Event[] = [], extra: Partial<OmrMeasureInput> = {}): OmrMeasureInput {
  return { id, number, page: extra.page, startBeat, durationBeats, timeSignature: [4, 4], events, ...extra };
}

function score(parts: OmrScoreInput["parts"]): OmrScoreInput {
  return { parts };
}

function singlePart(id: string, measures: OmrMeasureInput[], role?: "melody" | "harmony" | "rhythm"): OmrScoreInput["parts"][number] {
  return { id, role, measures };
}

function run(reference: OmrScoreInput, candidate: OmrScoreInput, options?: Parameters<typeof alignHierarchicalOmrScores>[2]): OmrHierarchicalAlignment {
  return alignHierarchicalOmrScores(normalizeCanonicalScore(reference), normalizeCanonicalScore(candidate), options);
}

describe("hierarchical OMR alignment", () => {
  it("pairs explicit pages first and remains deterministic when IDs and input order change", () => {
    const reference = score([
      singlePart("ref", [
        measure("r2", 2, 4, 4, [{ onset: 0, duration: 1, pitch: 62 }], { page: 1 }),
        measure("r1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }], { page: 1 }),
        measure("r4", 4, 12, 4, [{ onset: 0, duration: 1, pitch: 65 }], { page: 2 }),
        measure("r3", 3, 8, 4, [{ onset: 0, duration: 1, pitch: 64 }], { page: 2 }),
      ]),
    ]);
    const candidate = score([
      singlePart("candidate", [
        measure("c3", "third", 8, 4, [{ onset: 0, duration: 1, pitch: 64 }], { page: 2 }),
        measure("c1", "first", 0, 4, [{ onset: 0, duration: 1, pitch: 60, staff: 9 }], { page: 1 }),
        measure("c4", "fourth", 12, 4, [{ onset: 0, duration: 1, pitch: 65 }], { page: 2 }),
        measure("c2", "second", 4, 4, [{ onset: 0, duration: 1, pitch: 62, staff: 9 }], { page: 1 }),
      ]),
    ]);

    const first = run(reference, candidate);
    const second = run(reference, { parts: [...candidate.parts].reverse() });
    expect(first).toEqual(second);
    expect(first.pages.map((page) => [page.reference?.page, page.candidate?.page])).toEqual([[1, 1], [2, 2]]);
    expect(first.measures.every((region) => region.referenceMeasureIndices.every((index) => first.pages.find((page) => page.referenceMeasureIndices.includes(index)) !== undefined))).toBe(true);
    expect(first.diagnostics.join(" ")).not.toContain("cross-page");
  });

  it("maps musical lanes despite renamed IDs and reports role-null inference", () => {
    const reference = score([
      singlePart("upper", [measure("u", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 76, staff: 1, role: "melody" }], { page: 1 })], "melody"),
      singlePart("lower", [measure("l", 1, 0, 4, [{ onset: 0, duration: 2, pitch: 40, staff: 2 }], { page: 1 })]),
    ]);
    const candidate = score([
      singlePart("part-z", [measure("z", "one", 0, 4, [{ onset: 0, duration: 2, pitch: 40, staff: 8 }], { page: 1 })]),
      singlePart("part-a", [measure("a", "one", 0, 4, [{ onset: 0, duration: 1, pitch: 76, staff: 4, role: "melody" }], { page: 1 })], "melody"),
    ]);
    const result = run(reference, candidate);
    expect(result.staffMappings.some((mapping) => mapping.reference.staff === 1 && mapping.candidate.staff === 4 && mapping.status === "mapped")).toBe(true);
    expect(result.staffMappings.some((mapping) => mapping.reference.staff === 2 && mapping.candidate.staff === 8)).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("inferred");
  });

  it("fails closed for indistinguishable candidate lanes", () => {
    const lane = (id: string, staff: number) => singlePart(id, [measure(`${id}-m`, 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60, staff }], { page: 1 })]);
    const result = run(score([lane("r", 1)]), score([lane("c1", 4), lane("c2", 7)]));
    expect(result.staffMappings.some((mapping) => mapping.status === "ambiguous")).toBe(true);
    expect(result.diagnostics.join(" ")).toContain("ambiguous");
  });

  it("keeps later measures aligned when the candidate deletes a middle measure", () => {
    const reference = score([singlePart("r", [
      measure("r1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }], { page: 1 }),
      measure("r2", 2, 4, 4, [{ onset: 0, duration: 1, pitch: 62 }], { page: 1 }),
      measure("r3", 3, 8, 4, [{ onset: 0, duration: 1, pitch: 64 }], { page: 1 }),
    ])]);
    const candidate = score([singlePart("c", [
      measure("c1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }], { page: 1 }),
      measure("c3", 3, 8, 4, [{ onset: 0, duration: 1, pitch: 64 }], { page: 1 }),
    ])]);
    const result = run(reference, candidate);
    expect(result.measures.map((region) => region.relation)).toContain("candidate-insertion");
    expect(result.measures.filter((region) => region.candidateMeasureIds.includes("c:c3"))).toHaveLength(1);
    expect(result.unmatchedReferenceMeasures).toHaveLength(1);
  });

  it("accepts guarded 1:2 splits and 2:1 merges with local event offsets", () => {
    const reference = score([singlePart("r", [
      measure("r1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }, { onset: 2, duration: 1, pitch: 64 }], { page: 1 }),
      measure("r2", 2, 4, 4, [{ onset: 0, duration: 1, pitch: 65 }, { onset: 2, duration: 1, pitch: 67 }], { page: 1 }),
    ])]);
    const split = score([singlePart("c", [
      measure("c1a", 1, 0, 2, [{ onset: 0, duration: 1, pitch: 60 }], { page: 1 }),
      measure("c1b", "1b", 2, 2, [{ onset: 0, duration: 1, pitch: 64 }], { page: 1 }),
      measure("c2a", 2, 4, 2, [{ onset: 0, duration: 1, pitch: 65 }], { page: 1 }),
      measure("c2b", "2b", 6, 2, [{ onset: 0, duration: 1, pitch: 67 }], { page: 1 }),
    ])]);
    const splitResult = run(reference, split);
    expect(splitResult.measures.some((region) => region.relation === "reference-split" && region.candidateMeasureIds.length === 2)).toBe(true);
    expect(splitResult.measures.find((region) => region.relation === "reference-split")?.eventAlignment?.matched).toHaveLength(2);

    const merge = score([singlePart("c", [measure("merged", 1, 0, 8, [
      { onset: 0, duration: 1, pitch: 60 }, { onset: 2, duration: 1, pitch: 64 },
      { onset: 4, duration: 1, pitch: 65 }, { onset: 6, duration: 1, pitch: 67 },
    ], { page: 1 })])]);
    const mergeResult = run(reference, merge);
    expect(mergeResult.measures.some((region) => region.relation === "candidate-merge" && region.referenceMeasureIds.length === 2)).toBe(true);
  });

  it("rejects false splits when duration or boundary attacks disagree", () => {
    const reference = score([singlePart("r", [measure("r1", 1, 0, 4, [
      { onset: 0, duration: 1, pitch: 60 }, { onset: 2, duration: 1, pitch: 64 },
    ], { page: 1 })])]);
    const candidate = score([singlePart("c", [
      measure("c1a", 1, 0, 1, [{ onset: 0, duration: 1, pitch: 60 }], { page: 1 }),
      measure("c1b", "1b", 1, 1, [{ onset: 0, duration: 1, pitch: 61 }], { page: 1 }),
    ])]);
    const result = run(reference, candidate);
    expect(result.measures.some((region) => region.relation === "reference-split")).toBe(false);
  });

  it("does not invent page correspondence for missing metadata unless ordinal fallback is enabled", () => {
    const reference = score([singlePart("r", [measure("r1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }])])]);
    const candidate = score([singlePart("c", [measure("c1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }])])]);
    const unavailable = run(reference, candidate);
    expect(unavailable.pages.every((page) => page.status === "unmatched")).toBe(true);
    expect(unavailable.diagnostics.join(" ")).toContain("page metadata");
    const fallback = run(reference, candidate, { allowPageOrdinalFallback: true });
    expect(fallback.pages).toHaveLength(1);
    expect(fallback.pages[0]!.status).toBe("aligned");
    expect(fallback.pages[0]!.diagnostics.join(" ")).toContain("ordinal-fallback");
  });

  it("reports malformed page metadata and stays bounded at the page cell limit", () => {
    const bad = normalizeCanonicalScore(score([singlePart("r", [measure("r1", 1, 0, 4)])]));
    bad.measures[0]!.page = Number.NaN;
    const candidate = normalizeCanonicalScore(score([singlePart("c", [measure("c1", 1, 0, 4, [], { page: 1 })])]));
    const malformed = alignHierarchicalOmrScores(bad, candidate);
    expect(malformed.diagnostics.join(" ")).toContain("invalid page");

    const many = Array.from({ length: 8 }, (_, index) => measure(`r${index}`, index + 1, index * 4, 4, [{ onset: 0, duration: 1, pitch: 60 + (index % 4) }], { page: 1 }));
    const bounded = alignHierarchicalOmrScores(normalizeCanonicalScore(score([singlePart("r", many)])), normalizeCanonicalScore(score([singlePart("c", many)])), { maxPageCells: 9 });
    expect(bounded.pages[0]!.status).toBe("ambiguous");
    expect(bounded.pages[0]!.diagnostics.join(" ")).toContain("cell limit");
  });

  it("aligns performed tie-safe events while preserving notation disagreement diagnostics", () => {
    const reference = score([singlePart("r", [measure("r1", 1, 0, 2, [
      { onset: 0, duration: 1, pitch: 60, tie: "start", tuplet: true },
      { onset: 1, duration: 1, pitch: 60, tie: "stop", tuplet: true },
    ], { page: 1 })])]);
    const candidate = score([singlePart("c", [measure("c1", 1, 0, 2, [
      { onset: 0, duration: 2, pitch: 60, tuplet: true },
    ], { page: 1, rests: [{ onset: 0, duration: 2 }] })])]);
    const result = run(reference, candidate);
    expect(result.measures[0]!.eventAlignment?.matched[0]!.pitchEqual).toBe(true);
    expect(result.measures[0]!.eventAlignment?.unmatchedReferenceEventIds).toHaveLength(0);
    expect(result.measures[0]!.diagnostics.join(" ")).toContain("tie");
  });

  it("keeps flat consensus alignment defaults untouched", () => {
    const referenceInput = score([singlePart("r", [measure("r1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }])])]);
    const candidateInput = score([singlePart("c", [measure("c1", 1, 0, 4, [{ onset: 0, duration: 1, pitch: 60 }])])]);
    const reference = normalizeOmrScore(referenceInput);
    const candidate = normalizeOmrScore(candidateInput);
    const before = alignOmrScores(reference, candidate);
    const canonicalReference = normalizeCanonicalScore(referenceInput);
    const canonicalCandidate = normalizeCanonicalScore(candidateInput);
    alignHierarchicalOmrScores(canonicalReference, canonicalCandidate);
    expect(alignOmrScores(reference, candidate)).toEqual(before);
  });
});
