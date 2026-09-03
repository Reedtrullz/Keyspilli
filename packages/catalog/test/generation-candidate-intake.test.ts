import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import { intakeGenerationCandidate } from "../src/generation-candidate-intake.js";

const bytes = writeMidi([{ midi: 60, start: 0, dur: 1, vel: 90 }], { tempoBpm: 120 });
const emptyBytes = writeMidi([], { tempoBpm: 120 });
const musicXml = `<?xml version="1.0"?><score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
  </measure></part>
</score-partwise>`;

describe("generation candidate intake", () => {
  it("accepts a bounded local symbolic file and rejects an undersized limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-intake-test-"));
    const path = join(root, "candidate.mid");
    try {
      await writeFile(path, bytes);
      const accepted = await intakeGenerationCandidate({
        id: "local-file",
        path,
        sourceRef: "user:local-file",
        version: "v1",
        provenanceClass: "USER_SUPPLIED_PRIVATE",
        maxBytes: bytes.byteLength + 1,
      });
      expect(accepted).toMatchObject({ transport: "LOCAL_FILE", readiness: "ready", format: "midi" });

      const rejected = await intakeGenerationCandidate({
        id: "local-file-too-large",
        path,
        sourceRef: "user:local-file-too-large",
        version: "v1",
        provenanceClass: "USER_SUPPLIED_PRIVATE",
        maxBytes: 1,
      });
      expect(rejected.readiness).toBe("rejected");
      expect(rejected.failureReasons.join(" ")).toMatch(/size|limit|exceed/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts explicitly supplied local bytes but requires alignment before generation", async () => {
    const result = await intakeGenerationCandidate({
      id: "lead",
      bytes,
      format: "midi",
      sourceRef: "provider:lead",
      version: "v1",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
    });
    expect(result).toMatchObject({
      id: "lead",
      candidateClass: "GENERATION_CANDIDATE",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
      sourceKind: "local",
      sourceOrigin: "bytes",
      userSupplied: true,
      projectOwned: false,
      remoteApproved: false,
      transport: "LOCAL_BYTES",
      parseStatus: "parsed",
      summary: { tempoBpm: 120, noteCount: 1, trackCount: 1 },
      alignmentRequirement: { required: true, status: "not-attempted" },
      readiness: "ready",
      readinessCode: "READY_FOR_ALIGNMENT",
      format: "midi",
      generationEligibility: { eligible: false },
    });
    expect(result.candidate).toMatchObject({ status: "parsed", purpose: "GENERATION_CANDIDATE", evidenceClass: "VERIFIED_NATIVE_SYMBOLIC" });
    expect(result.failureReasons).toEqual([]);
  });

  it("accepts valid MusicXML through the same canonical intake contract", async () => {
    const result = await intakeGenerationCandidate({
      id: "xml-lead",
      bytes: new TextEncoder().encode(musicXml),
      format: "musicxml",
      sourceRef: "project:xml-lead",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
    });
    expect(result).toMatchObject({ format: "musicxml", parseStatus: "parsed", sourceKind: "local", sourceOrigin: "bytes", summary: { noteCount: 1, trackCount: 1 } });
  });

  it("only marks a known, aligned candidate ready for generation", async () => {
    const result = await intakeGenerationCandidate({
      id: "owned-lead",
      bytes,
      format: "midi",
      sourceRef: "project:owned-lead",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
      alignment: { status: "aligned" },
    });
    expect(result.readinessCode).toBe("READY_FOR_GENERATION");
    expect(result.generationEligibility).toMatchObject({ eligible: true, code: "READY_FOR_GENERATION" });
  });

  it("does not silently make unknown provenance generation-eligible", async () => {
    const result = await intakeGenerationCandidate({
      id: "unknown",
      bytes,
      format: "midi",
      sourceRef: "provider:unknown",
      version: "v1",
    });
    expect(result.provenanceClass).toBe("UNKNOWN");
    expect(result.readinessCode).toBe("PROVENANCE_BLOCKED");
    expect(result.generationEligibility.eligible).toBe(false);
  });

  it("rejects content hashes listed in the benchmark firewall", async () => {
    const hash = (await intakeGenerationCandidate({
      id: "hash-source",
      bytes,
      format: "midi",
      sourceRef: "project:hash-source",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
    })).provenance.sha256;
    const result = await intakeGenerationCandidate({
      id: "protected-hash",
      bytes,
      format: "midi",
      sourceRef: "project:protected-hash",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
      firewall: { protectedSha256: hash ? [hash] : [] },
    });
    expect(result.readinessCode).toBe("FIREWALL_REJECTED");
    expect(result.candidate).toBeNull();
  });

  it("classifies supplied response bytes and rejects HTML or benchmark markers", async () => {
    const html = await intakeGenerationCandidate({ id: "page", version: "v1", response: { status: 200, contentType: "text/html", body: "<html>login</html>" }, sourceRef: "https://example.test/score" });
    expect(html.readiness).toBe("rejected");
    expect(html.failureReasons.join(" ")).toMatch(/HTML|symbolic|metadata/i);
    const benchmark = await intakeGenerationCandidate({ id: "reference", version: "v1", bytes, format: "midi", sourceRef: "provider:reference", purpose: "BENCHMARK_REFERENCE" });
    expect(benchmark.readiness).toBe("rejected");
    expect(benchmark.failureReasons.join(" ")).toMatch(/benchmark/i);
    expect(benchmark.readinessCode).toBe("BENCHMARK_PROTECTED");
  });

  it("accepts an already-approved remote URL response without exposing query data", async () => {
    const result = await intakeGenerationCandidate({ id: "remote", version: "v1", url: "https://example.test/score?sig=secret", response: { status: 200, bytes, contentType: "audio/midi" }, sourceRef: "provider:remote", sourcePage: "https://example.test/page?token=secret", provenanceClass: "REMOTE_APPROVED" });
    expect(result).toMatchObject({ readiness: "ready", transport: "REMOTE_RESPONSE", provenanceClass: "REMOTE_APPROVED", provenance: { sourcePage: "https://example.test/page" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("fetches an approved direct symbolic URL only through the opt-in fetch seam", async () => {
    const result = await intakeGenerationCandidate({
      id: "remote-fetch",
      version: "v1",
      url: "https://example.test/score.mid?sig=secret",
      sourceRef: "provider:remote-fetch",
      provenanceClass: "REMOTE_APPROVED",
      allowNetwork: true,
      fetch: async () => new Response(Buffer.from(bytes), { status: 200, headers: { "content-type": "application/octet-stream" } }),
      alignment: { status: "aligned" },
    });
    expect(result).toMatchObject({ transport: "REMOTE_RESPONSE", readinessCode: "READY_FOR_GENERATION", generationEligibility: { eligible: true }, format: "midi" });
    expect(JSON.stringify(result)).not.toContain("sig=secret");
  });

  it("rejects non-native classes without pretending they are parsed", async () => {
    const result = await intakeGenerationCandidate({ id: "cover", version: "v1", bytes, format: "midi", sourceRef: "provider:cover", candidateClass: "FALLBACK_AMT" });
    expect(result.readinessCode).toBe("UNSUPPORTED_CLASS");
    expect(result.candidate).toBeNull();
  });

  it("fail-closes every non-generation contract class", async () => {
    for (const candidateClass of ["BENCHMARK_REFERENCE", "DIAGNOSTIC_ONLY", "FALLBACK_AMT"] as const) {
      const result = await intakeGenerationCandidate({ id: candidateClass, version: "v1", bytes, sourceRef: `provider:${candidateClass}`, candidateClass });
      expect(result.readiness).toBe("rejected");
      expect(result.candidate).toBeNull();
    }
  });

  it("redacts unsafe source references in rejected readiness", async () => {
    const result = await intakeGenerationCandidate({ id: "unsafe", version: "v1", bytes, format: "midi", sourceRef: "/Users/reidar/private/secret.mid?token=x" });
    expect(result.readinessCode).toBe("FIREWALL_REJECTED");
    expect(result.provenance.sourceRef).toBe("[redacted-source-ref]");
    expect(JSON.stringify(result)).not.toContain("secret.mid");
  });

  it("rejects an otherwise parseable symbolic file with no pitched musical events", async () => {
    const result = await intakeGenerationCandidate({
      id: "empty",
      bytes: emptyBytes,
      format: "midi",
      sourceRef: "project:empty",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
      alignment: { status: "aligned" },
    });

    expect(result.readiness).toBe("rejected");
    expect(result.readinessCode).toBe("NO_USABLE_MUSICAL_EVENTS");
    expect(result.generationEligibility.eligible).toBe(false);
  });

  it("applies the default 16 MiB bound when callers omit maxBytes", async () => {
    const oversized = new Uint8Array(16 * 1024 * 1024 + 1);
    oversized.set(bytes);
    const result = await intakeGenerationCandidate({
      id: "oversized",
      bytes: oversized,
      format: "midi",
      sourceRef: "project:oversized",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
    });

    expect(result.readiness).toBe("rejected");
    expect(result.failureReasons.join(" ")).toMatch(/size|limit|exceed/i);
  });

  it("fails closed instead of throwing for malformed runtime id and format values", async () => {
    const malformedId = await intakeGenerationCandidate({
      id: 42,
      bytes,
      format: "midi",
      sourceRef: "project:malformed-id",
      version: "v1",
    } as never);
    expect(malformedId.readiness).toBe("rejected");
    expect(malformedId.readinessCode).toBe("MISSING_INPUT");

    const malformedMetadata = await intakeGenerationCandidate({
      id: "malformed-metadata",
      bytes,
      format: "midi",
      sourceRef: 42,
      version: 42,
    } as never);
    expect(malformedMetadata.readiness).toBe("rejected");
    expect(malformedMetadata.readinessCode).toBe("MISSING_INPUT");

    const unsupportedFormat = await intakeGenerationCandidate({
      id: "unsupported-format",
      bytes,
      format: "wav",
      sourceRef: "project:unsupported-format",
      version: "v1",
    });
    expect(unsupportedFormat.readiness).toBe("rejected");
    expect(unsupportedFormat.readinessCode).toBe("UNSUPPORTED_FORMAT");
  });

  it("recognizes MSCZ as unsupported instead of claiming a MuseScore parser", async () => {
    const result = await intakeGenerationCandidate({
      id: "musescore-container",
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      format: "mscz",
      sourceRef: "project:musescore-container",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
    });
    expect(result.readinessCode).toBe("UNSUPPORTED_FORMAT");
    expect(result.candidate).toBeNull();
  });

  it("keeps adapter score and canonical metadata path-safe", async () => {
    const pathNamedBytes = writeMidi([{ midi: 60, start: 0, dur: 1, vel: 90 }], {
      tempoBpm: 120,
      tracks: [{ name: "/Users/reidar/private/sensitive.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90 }] }],
    });
    const result = await intakeGenerationCandidate({
      id: "path-safe",
      bytes: pathNamedBytes,
      format: "midi",
      sourceRef: "project:path-safe",
      version: "v1",
      provenanceClass: "PROJECT_OWNED",
    });

    expect(JSON.stringify(result)).not.toContain("/Users/reidar/private/sensitive.mid");
    expect(JSON.stringify(result.score)).not.toContain("/Users/reidar");
    expect(JSON.stringify(result.canonical)).not.toContain("/Users/reidar");
  });
});
