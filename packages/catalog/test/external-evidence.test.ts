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
      physicalPath: "/tmp/example/source.mid",
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
    expect(() => assertGenerationEvidence(candidate({ status: "discovered" }))).toThrow(/parsed|status/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "x", acquisition: "local-analysis", acquiredVia: "provider-export" } }))).toThrow(/acqui/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "x", acquisition: { remote: true }, acquiredVia: "local-import" } as never }))).toThrow(/acqui/i);
  });

  it("canonicalizes metadata without note arrays or physical paths", () => {
    const [canonical] = canonicalEvidenceCandidateSet([candidate()]);
    expect(canonical).not.toHaveProperty("notes");
    expect(JSON.stringify(canonical)).not.toContain("/tmp/example/reference.mid");
    expect(canonical).toMatchObject({ content: { sha256: "a".repeat(64) }, provenance: { sourceRef: "youtube:abc123" } });
  });

  it("redacts nested and logical path-like values case-insensitively", () => {
    const [canonical] = canonicalEvidenceCandidateSet([candidate({
      provenance: { sourceRef: "file:///tmp/example/My Folder/source.xml", acquisition: "local-analysis", physical_path: "/tmp/source.mid", sourceArtifactRef: "/tmp/artifact.mid" },
      lineage: { localPath: "/tmp/lineage.mid", rootFile: "file:///tmp/root file.mid", noteEvents: [{ pitch: 60 }], nested: { FILEPATH: "/tmp/nested.mid" } },
    })]);
    expect(JSON.stringify(canonical)).not.toContain("/tmp/");
    expect(JSON.stringify(canonical)).not.toContain("noteEvents");
  });

  it("rejects benchmark markers hidden in provenance or lineage", () => {
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "benchmark:fixture-1", acquisition: "local-analysis" } }))).toThrow(/benchmark/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { sourceRef: "evaluation-only/reference", stage: "reference" } }))).toThrow(/benchmark|reference|evaluation/i);
    expect(() => assertGenerationEvidence(candidate({ benchmarkReferenceHashes: ["a".repeat(64)] }))).toThrow(/benchmark|reference/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "fixture-reference", acquisition: "local-analysis" } }))).toThrow(/benchmark|reference/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { id: "my_reference_id" } }))).toThrow(/benchmark|reference/i);
    expect(() => assertGenerationEvidence(candidate({ metadata: { protectedMarker: true } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { artifactPath: "/tmp/benchmark.mid" } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ metadata: { fileName: "reference.mid" } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { locator: "reference" } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { artifact: { nested: { benchmark: true } } } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ metadata: { file: { protected: true } } }))).toThrow(/benchmark|reference|protected/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { artifactRef: { nested: "benchmark" }, acquisition: "local-analysis", sourceRef: "youtube:abc" } }))).toThrow(/benchmark|reference|protected/i);
  });

  it("produces an order-invariant candidate-set digest", () => {
    const first = candidate({ provenance: { sourceRef: "youtube:a", provider: "x", acquisition: "local-analysis" } });
    const second = candidate({ provenance: { sourceRef: "youtube:b", provider: "x", acquisition: "local-analysis" } });
    expect(evidenceCandidateSetDigest([first, second])).toBe(evidenceCandidateSetDigest([second, first]));
  });

  it("normalizes uppercase SHA-256 and keeps its digest equivalent", () => {
    const upper = candidate({ content: { sha256: "A".repeat(64), byteLength: 12, mediaType: "audio/midi" } });
    expect(assertGenerationEvidence(upper).content.sha256).toBe("a".repeat(64));
    expect(evidenceCandidateSetDigest([upper])).toBe(evidenceCandidateSetDigest([candidate()]));
  });

  it("rejects physical source references and explicit null acquisition fields", () => {
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "/tmp/example.mid", acquisition: "local-analysis" } }))).toThrow(/logical|source/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "file:///tmp/example.mid", acquisition: "local-analysis" } }))).toThrow(/logical|source/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "youtube:abc", acquisition: null, acquiredVia: "local-import" } }))).toThrow(/acqui/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "youtube:abc", acquisition: "local-exfiltration" } }))).toThrow(/acqui/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "youtube:abc", acquisition: "unknown-local-policy" } }))).toThrow(/acqui/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "song.mid?x=1", acquisition: "local-import" } }))).toThrow(/logical|source/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "song.mid#section", acquisition: "local-import" } }))).toThrow(/logical|source/i);
  });

  it("redacts embedded physical paths while retaining surrounding logical text", () => {
    const [canonical] = canonicalEvidenceCandidateSet([candidate({ description: "prefix /private/example.mid suffix" })]);
    expect(canonical!.description).toBe("prefix [redacted-path] suffix");
    const [fileUrl] = canonicalEvidenceCandidateSet([candidate({ description: "prefix file:///tmp/My Folder/example.MIDI suffix" })]);
    expect(fileUrl!.description).toBe("prefix [redacted-path] suffix");
    const [backslash] = canonicalEvidenceCandidateSet([candidate({ description: "prefix C:\\\\My Folder\\\\example.MID suffix" })]);
    expect(backslash!.description).toBe("prefix [redacted-path] suffix");
    const noExtension = [
      "prefix file:///tmp/private suffix",
      "prefix /tmp/private suffix",
      "prefix C:\\\\Temp\\\\private suffix",
      "prefix ~/private suffix",
    ];
    for (const description of noExtension) {
      const [redacted] = canonicalEvidenceCandidateSet([candidate({ description })]);
      expect(redacted!.description).toBe("prefix [redacted-path] suffix");
    }
    const logical = ["https://example.com/docs", "youtube:abc/section", "provider:catalog/song", "A/B test", "file://logical-id"];
    for (const description of logical) {
      const [preserved] = canonicalEvidenceCandidateSet([candidate({ description })]);
      expect(preserved!.description).toBe(description);
    }
  });
});
