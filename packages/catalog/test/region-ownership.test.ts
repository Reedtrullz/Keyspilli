import { describe, expect, it } from "vitest";
import {
  mergeRegionEvidenceDecisions,
  regionAllowsSourceEvent,
  resolveRegionEvidence,
  type RegionEvidenceClaim,
} from "../src/region-ownership.js";

function claim(overrides: Partial<RegionEvidenceClaim> = {}): RegionEvidenceClaim {
  return {
    id: "melody-a",
    candidateId: "candidate-a",
    sourceClass: "GENERATION_CANDIDATE",
    provenanceClass: "PROJECT_OWNED",
    role: "melody",
    timingAuthority: "NATIVE_AUTHORITATIVE",
    alignmentState: "NATIVE",
    sourceRegion: { startBeat: 0, endBeat: 4 },
    ...overrides,
  };
}

describe("region ownership contract", () => {
  it("owns native and high-confidence aligned regions", () => {
    const result = resolveRegionEvidence([
      claim(),
      claim({ id: "aligned-b", candidateId: "candidate-b", timingAuthority: "ALIGNED_HIGH_CONFIDENCE", alignmentState: "ALIGNED_HIGH_CONFIDENCE", sourceRegion: { startBeat: 4, endBeat: 8 } }),
    ]);

    expect(result.readiness).toBe("GENERATION_READY");
    expect(result.decisions.map((decision) => decision.ownershipState)).toEqual(["OWNED", "OWNED"]);
    expect(result.merged).toHaveLength(2);
  });

  it("withholds partial melody timing but retains explicit semantic support", () => {
    const result = resolveRegionEvidence([
      claim({ timingAuthority: "ALIGNED_PARTIAL", alignmentState: "ALIGNED_PARTIAL" }),
      claim({ id: "harmony-partial", candidateId: "candidate-a", role: "harmony", timingAuthority: "ALIGNED_PARTIAL", alignmentState: "ALIGNED_PARTIAL", semanticOnly: true }),
    ]);

    expect(result.decisions.find((decision) => decision.id === "melody-a")?.ownershipState).toBe("WITHHELD");
    expect(result.decisions.find((decision) => decision.id === "melody-a")?.reasonCodes).toContain("PARTIAL_ALIGNMENT");
    expect(result.decisions.find((decision) => decision.id === "harmony-partial")?.ownershipState).toBe("PARTIAL_SUPPORT");
    expect(result.readiness).toBe("GENERATION_BLOCKED");
  });

  it("enforces benchmark, diagnostic, and unknown-provenance firewalls", () => {
    const result = resolveRegionEvidence([
      claim({ id: "benchmark", sourceClass: "BENCHMARK_REFERENCE" }),
      claim({ id: "diagnostic", sourceClass: "DIAGNOSTIC_ONLY" }),
      claim({ id: "unknown", provenanceClass: "UNKNOWN" }),
    ]);

    expect(result.readiness).toBe("GENERATION_BLOCKED");
    expect(result.decisions.every((decision) => decision.ownershipState === "WITHHELD")).toBe(true);
    expect(result.decisions.flatMap((decision) => decision.reasonCodes).join(" ")).toMatch(/BENCHMARK_FIREWALL|DIAGNOSTIC_FIREWALL|PROVENANCE_BLOCKED/);
  });

  it("lets fallback own an uncovered role but never override a primary overlap", () => {
    const fallback = claim({ id: "fallback", candidateId: "amt", sourceClass: "FALLBACK_AMT", sourceRegion: { startBeat: 0, endBeat: 4 } });
    const primary = claim({ id: "primary", candidateId: "native", sourceRegion: { startBeat: 0, endBeat: 4 }, confidence: 0.5 });
    const fallbackOnly = resolveRegionEvidence([fallback]);
    const primaryAndFallback = resolveRegionEvidence([fallback, primary]);

    expect(fallbackOnly.decisions[0]?.ownershipState).toBe("FALLBACK_OWNED");
    expect(primaryAndFallback.decisions.find((decision) => decision.id === "primary")?.ownershipState).toBe("OWNED");
    expect(primaryAndFallback.decisions.find((decision) => decision.id === "fallback")?.ownershipState).toBe("WITHHELD");
    expect(primaryAndFallback.decisions.find((decision) => decision.id === "fallback")?.reasonCodes).toContain("FALLBACK_LOWER_PRIORITY");
  });

  it("allows drum timing-only evidence and rejects pitched drum ownership", () => {
    const timing = claim({ id: "drums", candidateId: "drums", role: "timing-only", isDrum: true });
    const pitched = claim({ id: "drum-melody", candidateId: "drums", isDrum: true });
    const result = resolveRegionEvidence([timing, pitched]);

    expect(result.decisions.find((decision) => decision.id === "drums")?.ownershipState).toBe("OWNED");
    expect(result.decisions.find((decision) => decision.id === "drum-melody")?.ownershipState).toBe("WITHHELD");
    expect(result.decisions.find((decision) => decision.id === "drum-melody")?.reasonCodes).toContain("DRUM_TIMING_ONLY");
  });

  it("resolves overlaps and output order independently of input order", () => {
    const primary = claim({ id: "z-primary", candidateId: "z", confidence: 0.8, sourceRegion: { startBeat: 0, endBeat: 2 } });
    const loser = claim({ id: "a-loser", candidateId: "a", confidence: 0.7, sourceRegion: { startBeat: 1, endBeat: 3 } });
    const forward = resolveRegionEvidence([loser, primary]);
    const reverse = resolveRegionEvidence([primary, loser]);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
    expect(forward.decisions.find((decision) => decision.id === "z-primary")?.ownershipState).toBe("OWNED");
    expect(forward.decisions.find((decision) => decision.id === "a-loser")?.ownershipState).toBe("WITHHELD");
    expect(forward.diagnostics.overlapWithheldCount).toBe(1);
  });

  it("merges adjacent compatible regions without crossing owner or source boundaries", () => {
    const resolved = resolveRegionEvidence([
      claim({ id: "a", sourceRegion: { startBeat: 0, endBeat: 2 }, sourceEventIds: ["2"] }),
      claim({ id: "b", sourceRegion: { startBeat: 2, endBeat: 4 }, sourceEventIds: ["1"] }),
      claim({ id: "c", candidateId: "other", sourceRegion: { startBeat: 4, endBeat: 6 } }),
    ]);

    expect(resolved.merged).toHaveLength(2);
    expect(resolved.merged[0]?.sourceRegion).toEqual({ startBeat: 0, endBeat: 4 });
    expect(resolved.merged[0]?.sourceEventIds).toEqual(["1", "2"]);
    expect(mergeRegionEvidenceDecisions(resolved.decisions)).toHaveLength(2);
  });

  it("does not merge confidence or provenance boundaries", () => {
    const resolved = resolveRegionEvidence([
      claim({ id: "high", confidence: 0.9, sourceRegion: { startBeat: 0, endBeat: 2 } }),
      claim({ id: "lower", confidence: 0.8, sourceRegion: { startBeat: 2, endBeat: 4 } }),
      claim({ id: "open", provenanceClass: "OPEN_LICENSE", sourceRegion: { startBeat: 4, endBeat: 6 } }),
    ]);

    expect(resolved.merged).toHaveLength(3);
  });

  it("fails closed for malformed regions and denies unclaimed source events", () => {
    const resolved = resolveRegionEvidence([
      claim({ id: "bad", sourceRegion: { startBeat: -1, endBeat: 0 } }),
      claim({ id: "good", sourceRegion: { startBeat: 2, endBeat: 4 } }),
    ]);

    expect(resolved.decisions.find((decision) => decision.id === "bad")?.ownershipState).toBe("WITHHELD");
    expect(regionAllowsSourceEvent(resolved, "candidate-a", "melody", 2.5)).toBe(true);
    expect(regionAllowsSourceEvent(resolved, "candidate-a", "melody", 0.5)).toBe(false);
    expect(regionAllowsSourceEvent(resolved, "other-candidate", "melody", 2.5)).toBe(false);
  });

  it("accepts candidateClass as a runtime alias and remains deterministic", () => {
    const result = resolveRegionEvidence([{ ...claim(), sourceClass: undefined as never, candidateClass: "GENERATION_CANDIDATE" }]);
    expect(result.decisions[0]?.ownershipState).toBe("OWNED");
    expect(JSON.stringify(result)).toBe(JSON.stringify(resolveRegionEvidence([{ ...claim(), sourceClass: undefined as never, candidateClass: "GENERATION_CANDIDATE" }])));
  });

  it("withholds a generation claim when provenance is omitted", () => {
    const value = { ...claim(), provenanceClass: undefined } as unknown as RegionEvidenceClaim;
    const result = resolveRegionEvidence([value]);

    expect(result.readiness).toBe("GENERATION_BLOCKED");
    expect(result.decisions[0]?.ownershipState).toBe("WITHHELD");
    expect(result.decisions[0]?.reasonCodes).toContain("PROVENANCE_BLOCKED");
  });
});
