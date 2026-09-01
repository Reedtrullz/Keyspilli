import { describe, expect, it } from "vitest";
import {
  assertGenerationEvidence,
  canonicalEvidenceCandidateSet,
  evidenceCandidateSetDigest,
  type ExternalEvidenceCandidate,
} from "../src/external-evidence.js";

function candidate(overrides: Partial<ExternalEvidenceCandidate> = {}): ExternalEvidenceCandidate {
  return {
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
    purpose: "GENERATION_CANDIDATE",
    provenance: {
      sourceRef: "youtube:abc123",
      provider: "example",
      acquiredVia: "local-import",
      acquisition: "local-analysis",
      physicalPath: "/Users/reidar/private/reference.mid",
    },
    content: { sha256: "a".repeat(64), byteLength: 12, mediaType: "audio/midi" },
    confidence: { source: 0.9, parse: 1, identity: 0.8, alignment: 0.7 },
    roles: [{ role: "melody", confidence: 0.8 }],
    status: "parsed",
    notes: [{ pitch: 60 }],
    ...overrides,
  };
}

describe("external evidence firewall", () => {
  it("accepts a parsed, locally acquired generation candidate", () => {
    expect(assertGenerationEvidence(candidate())).toEqual(expect.objectContaining({ status: "parsed" }));
  });

  it("rejects benchmark-purpose evidence at the generation boundary", () => {
    expect(() => assertGenerationEvidence(candidate({ purpose: "BENCHMARK_REFERENCE" }))).toThrow(/benchmark/i);
  });

  it("rejects missing hashes, disallowed acquisition, and failed parsing", () => {
    expect(() => assertGenerationEvidence(candidate({ content: { byteLength: 12 } }))).toThrow(/hash/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "x", acquisition: "remote-only" } }))).toThrow(/acqui/i);
    expect(() => assertGenerationEvidence(candidate({ status: "parse-failed" }))).toThrow(/parse/i);
  });

  it("canonicalizes metadata without note arrays or physical paths", () => {
    const [canonical] = canonicalEvidenceCandidateSet([candidate()]);
    expect(canonical).not.toHaveProperty("notes");
    expect(JSON.stringify(canonical)).not.toContain("private/reference.mid");
    expect(canonical).toMatchObject({ content: { sha256: "a".repeat(64) }, provenance: { sourceRef: "youtube:abc123" } });
  });

  it("produces an order-invariant candidate-set digest", () => {
    const first = candidate({ provenance: { sourceRef: "youtube:a", provider: "x", acquisition: "local-analysis" } });
    const second = candidate({ provenance: { sourceRef: "youtube:b", provider: "x", acquisition: "local-analysis" } });
    expect(evidenceCandidateSetDigest([first, second])).toBe(evidenceCandidateSetDigest([second, first]));
  });
});
