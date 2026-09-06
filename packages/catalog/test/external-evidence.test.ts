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

  it("omits arbitrary raw score arrays while preserving typed metadata", () => {
    const typed = candidate({ metadata: { label: "typed-candidate" } });
    const raw = candidate({ metadata: {
      label: "typed-candidate",
      payload: { pitches: [60, 64], starts: [0, 1], durations: [1, 2], midiMeta: [{ channel: 1 }] },
    } });
    const [canonical] = canonicalEvidenceCandidateSet([raw]);

    expect(canonical).toMatchObject({ metadata: { label: "typed-candidate" } });
    expect(canonical?.metadata).not.toHaveProperty("payload");
    expect(JSON.stringify(canonical)).not.toMatch(/pitches|starts|durations|midiMeta/);
    expect(evidenceCandidateSetDigest([raw])).toBe(evidenceCandidateSetDigest([typed]));
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

  it("rejects credentials and locator secrets in logical source references", () => {
    for (const sourceRef of [
      "https://provider.example/song?token=secret",
      "https://user:secret@provider.example/song",
      "provider:catalog/song?signature=secret",
      "provider://user:secret@example/song",
    ]) {
      expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef, acquisition: "local-analysis" } }))).toThrow(/credential|query|fragment|source/i);
    }

    const [canonical] = canonicalEvidenceCandidateSet([candidate({
      provenance: { sourceRef: "provider:catalog/song?token=secret", acquisition: "local-analysis" },
    })]);
    expect((canonical?.provenance as Record<string, unknown>)?.sourceRef).toBe("[redacted-source-ref]");
    expect(JSON.stringify(canonical)).not.toContain("secret");
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

  it("preserves logical source labels while omitting physical artifact references", () => {
    const logicalSourceRef = "provider:catalog/song.mid";
    const logicalUrl = "https://example.com/download/song.mid";
    const [canonical] = canonicalEvidenceCandidateSet([candidate({
      provenance: {
        sourceRef: logicalSourceRef,
        acquisition: "local-analysis",
        sourceArtifactRef: "file:///tmp/My Folder/source.mid",
      },
      description: logicalUrl,
    })]);

    const provenance = canonical!.provenance as Record<string, unknown>;
    expect(provenance.sourceRef).toBe(logicalSourceRef);
    expect(provenance).not.toHaveProperty("sourceArtifactRef");
    expect(canonical!.description).toBe(logicalUrl);
    expect(JSON.stringify(canonical)).not.toContain("My Folder");
  });

  it("accepts extension-bearing logical source references with an explicit scheme", () => {
    expect(() => assertGenerationEvidence(candidate({
      provenance: { sourceRef: "provider:catalog/song.mid", acquisition: "local-analysis" },
    }))).not.toThrow();
  });

  it("rejects protected hashes, paths, and lineage from an explicit benchmark manifest", () => {
    const protectedHash = "b".repeat(64);
    const protectedPath = "/tmp/corpus-a";
    const protectedLineage = "fixture-set:opaque-1";
    const manifest = { benchmarkReferenceManifest: { sha256: [protectedHash], paths: [protectedPath], lineage: [protectedLineage] } };
    expect(() => assertGenerationEvidence(candidate({ content: { sha256: protectedHash } }), manifest)).toThrow(/benchmark|protected|reference/i);
    expect(() => assertGenerationEvidence(candidate({ provenance: { sourceRef: "provider:opaque", acquisition: "local-import", physicalPath: `${protectedPath}/song.mid` } }), manifest)).toThrow(/benchmark|protected|reference/i);
    expect(() => assertGenerationEvidence(candidate({ lineage: { parent: protectedLineage } }), manifest)).toThrow(/benchmark|protected|reference/i);
  });

  it("rejects an evaluation-only manifest role without relying on a song title", () => {
    expect(() => assertGenerationEvidence(candidate({ manifestRole: "EVAL_ONLY" }))).toThrow(/benchmark|evaluation|reference/i);
  });

  it("rejects conflicting acquisition declarations", () => {
    expect(() => assertGenerationEvidence(candidate({
      provenance: { sourceRef: "youtube:abc", acquisition: "local-import", acquiredVia: "local-file" },
    }))).toThrow(/acqui|conflict/i);
  });

  it("rejects malformed acquisition and locator fields instead of silently dropping them", () => {
    for (const field of ["acquisition", "acquiredVia", "sourceArtifactRef", "physicalPath", "canonicalSourceRef"] as const) {
      for (const value of [null, 42, {}, [], undefined]) {
        const provenance = {
          sourceRef: "youtube:abc",
          acquisition: "local-analysis",
          [field]: value,
        } as never;
        expect(() => assertGenerationEvidence(candidate({ provenance }))).toThrow(/acqui|provenance|locator|source/i);
      }
    }
  });

  it("keeps physical locators and generic reference markers out of canonical generation metadata", () => {
    const sourceArtifactRef = "/Users/reidar/My Folder/private artifact";
    const [canonical] = canonicalEvidenceCandidateSet([candidate({
      provenance: {
        sourceRef: "youtube:abc",
        acquisition: "local-analysis",
        sourceArtifactRef,
        physicalPath: sourceArtifactRef,
      },
      lineage: { id: "my_reference_id", label: "fixture-reference" },
      description: `file:///private/My Folder/private artifact`,
    })]);
    const serialized = JSON.stringify(canonical);
    expect(serialized).not.toContain(sourceArtifactRef);
    expect(serialized).not.toContain("My Folder");
    expect(serialized).not.toContain("fixture-reference");
    expect(serialized).not.toContain("my_reference_id");

    for (const description of [
      "prefix /unknown-root/My Folder/private artifact suffix",
      "prefix file://host/share/My Folder/private artifact suffix",
      "prefix \\\\server\\share\\My Folder\\private artifact suffix",
    ]) {
      const [redacted] = canonicalEvidenceCandidateSet([candidate({ description })]);
      expect(JSON.stringify(redacted)).not.toContain("My Folder");
      expect(JSON.stringify(redacted)).not.toContain("private artifact");
    }
  });

  it("returns a generation-safe provenance projection without physical artifact fields", () => {
    const accepted = assertGenerationEvidence(candidate({
      provenance: {
        sourceRef: "youtube:abc",
        acquisition: "local-analysis",
        acquiredVia: "local-import",
        sourceArtifactRef: "/Users/reidar/My Folder/private artifact",
        physicalPath: "/private/My Folder/private artifact",
      },
    }));
    expect(accepted.provenance).not.toHaveProperty("sourceArtifactRef");
    expect(accepted.provenance).not.toHaveProperty("physicalPath");
    expect(JSON.stringify(accepted)).not.toContain("My Folder");
  });

  it("keeps digest stable when role metadata order and object insertion order differ", () => {
    const first = candidate({
      roles: [{ role: "melody", confidence: 0.8 }, { role: "harmony", confidence: 0.7 }],
      metadata: { provider: "example", source: "symbolic" },
    });
    const second = candidate({
      roles: [{ confidence: 0.7, role: "harmony" }, { confidence: 0.8, role: "melody" }],
      metadata: { source: "symbolic", provider: "example" },
    });
    expect(evidenceCandidateSetDigest([first])).toBe(evidenceCandidateSetDigest([second]));
  });
});
