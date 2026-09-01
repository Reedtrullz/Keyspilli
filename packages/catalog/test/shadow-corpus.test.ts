import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHADOW_GENERATION_TRUTH,
  assertShadowGenerationTruth,
  canonicalShadowCorpusJson,
  createShadowCorpusItem,
  createShadowCorpusManifest,
  parseShadowCorpusManifest,
  readShadowCorpusManifest,
  shadowCorpusDigest,
  validateShadowCorpusManifest,
  type ShadowCorpusItem,
  type ShadowCorpusManifest,
} from "../src/shadow-corpus.js";
import { assertGenerationEvidence, type ExternalEvidenceCandidate } from "../src/external-evidence.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function shadowItem(overrides: Partial<ShadowCorpusItem> = {}): ShadowCorpusItem {
  return {
    schemaVersion: 1,
    id: "song-001",
    corpus: "slakh2100",
    datasetVersion: "shadow-v1",
    license: "CC BY 4.0",
    sourceRecord: { provider: "slakh2100", recordId: "song-001", sourceRef: "slakh:song-001" },
    audio: { status: "available", sha256: HASH_A, byteLength: 128, logicalRef: "audio/song-001.wav" },
    symbolic: { status: "available", sha256: HASH_B, byteLength: 256, logicalRef: "symbolic/song-001.mid" },
    tracks: [
      { id: "track-1", index: 0, name: "Piano", instrumentClass: "piano", program: 0, channel: 0, percussion: false, noteCount: 8, durationBeats: 16 },
    ],
    durationBeats: 16,
    generationEligibility: { eligible: true, purpose: SHADOW_GENERATION_TRUTH },
    evaluationEligibility: { eligible: true },
    ...overrides,
  };
}

function shadowManifest(items: readonly ShadowCorpusItem[] = [shadowItem()]): ShadowCorpusManifest {
  return { schemaVersion: 1, items };
}

function evidence(overrides: Partial<ExternalEvidenceCandidate> = {}): ExternalEvidenceCandidate {
  return {
    id: "slakh-song-001",
    evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC",
    purpose: SHADOW_GENERATION_TRUTH,
    provenance: {
      sourceRef: "slakh:song-001",
      provider: "slakh2100",
      acquisition: "local-import",
      acquiredVia: "local-import",
    },
    content: { sha256: HASH_B, byteLength: 256, mediaType: "audio/midi" },
    status: "parsed",
    roles: [{ role: "melody", confidence: 1 }],
    ...overrides,
  };
}

describe("shadow corpus manifest", () => {
  it("rejects unsupported schema versions instead of coercing them", () => {
    const unsupportedItem = shadowItem({ schemaVersion: 2 } as unknown as Partial<ShadowCorpusItem>);
    expect(() => createShadowCorpusItem(unsupportedItem)).toThrow(/schemaVersion.*unsupported/i);
    expect(() => createShadowCorpusManifest({ schemaVersion: 2, items: [shadowItem()] } as never)).toThrow(/schemaVersion.*unsupported/i);
    expect(() => parseShadowCorpusManifest({ schemaVersion: 2, items: [shadowItem()] })).toThrow(/schemaVersion.*(?:unsupported|must be 1)/i);
    expect(validateShadowCorpusManifest({ schemaVersion: 2, items: [shadowItem()] }).valid).toBe(false);
  });

  it("accepts shadow generation truth while the benchmark purpose remains blocked", () => {
    const accepted = assertShadowGenerationTruth(evidence());
    expect(accepted.purpose).toBe(SHADOW_GENERATION_TRUTH);
    expect(() => assertGenerationEvidence(evidence({ purpose: "BENCHMARK_REFERENCE" }))).toThrow(/benchmark/i);
    expect(() => assertShadowGenerationTruth(evidence({ purpose: "BENCHMARK_REFERENCE" }))).toThrow(/benchmark/i);

    const benchmarkItem = shadowManifest([shadowItem({
      generationEligibility: { eligible: true, purpose: "BENCHMARK_REFERENCE" },
    })]);
    expect(validateShadowCorpusManifest(benchmarkItem)).toMatchObject({ valid: false });
    expect(validateShadowCorpusManifest(benchmarkItem).errors.join(" ")).toMatch(/benchmark/i);
  });

  it("validates a complete item and rejects missing media or track metadata", () => {
    expect(validateShadowCorpusManifest(shadowManifest()).valid).toBe(true);

    const missingHash = shadowManifest([shadowItem({ audio: { status: "available", sha256: null, byteLength: 128, logicalRef: "audio/song-001.wav" } })]);
    expect(validateShadowCorpusManifest(missingHash)).toMatchObject({ valid: false });
    expect(validateShadowCorpusManifest(missingHash).errors.join(" ")).toMatch(/sha256|hash/i);

    const missingTrackMetadata = shadowManifest([shadowItem({ tracks: [{ id: "track-1" }] as never })]);
    expect(validateShadowCorpusManifest(missingTrackMetadata).valid).toBe(false);
    expect(validateShadowCorpusManifest(missingTrackMetadata).errors.join(" ")).toMatch(/track/i);
  });

  it("produces the same digest for reordered items and tracks", () => {
    const first = shadowItem({ id: "a" });
    const second = shadowItem({ id: "b", audio: { status: "available", sha256: HASH_B, byteLength: 128, logicalRef: "audio/song-002.wav" } });
    const reordered = shadowManifest([
      { ...second, tracks: [...second.tracks].reverse() },
      { ...first, tracks: [...first.tracks].reverse() },
    ]);
    expect(shadowCorpusDigest(shadowManifest([first, second]))).toBe(shadowCorpusDigest(reordered));
  });

  it("normalizes a valid item and rejects repository-resident media paths", () => {
    const created = createShadowCorpusItem(shadowItem({
      audio: { status: "available", sha256: HASH_A.toUpperCase(), byteLength: 128, logicalRef: "audio/song-001.wav" },
    }));
    expect(created.schemaVersion).toBe(1);
    expect(created.audio.sha256).toBe(HASH_A);

    const repositoryPath = `${process.cwd()}/.tmp-shadow/song-001.mid`;
    const unsafe = shadowManifest([shadowItem({
      symbolic: { status: "available", sha256: HASH_B, byteLength: 256, logicalRef: "symbolic/song-001.mid", path: repositoryPath },
    })]);
    const result = validateShadowCorpusManifest(unsafe, { repositoryRoot: process.cwd() });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/repository/i);
  });

  it("redacts absolute paths from canonical JSON while retaining logical references", () => {
    const item = shadowItem({
      audio: { status: "available", sha256: HASH_A, byteLength: 128, logicalRef: "audio/song-001.wav", path: "/Users/reidar/Projectos/Keyspilli/private/song-001.wav" },
      sourceRecord: { provider: "slakh2100", recordId: "song-001", sourceRef: "slakh:song-001", localPath: "/private/tmp/slakh/song-001" },
    });
    const canonical = canonicalShadowCorpusJson(shadowManifest([item]));
    expect(canonical).toContain("audio/song-001.wav");
    expect(canonical).not.toContain("/Users/reidar");
    expect(canonical).not.toContain("/private/tmp");
    expect(canonical).not.toContain('"path"');
    expect(canonical).not.toContain('"localPath"');
  });

  it("round-trips a manifest through the fail-closed JSON reader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-shadow-corpus-"));
    const path = join(directory, "manifest.json");
    try {
      const manifest = shadowManifest();
      await writeFile(path, `${JSON.stringify(manifest)}\n`, "utf8");
      const loaded = await readShadowCorpusManifest(path);
      expect(shadowCorpusDigest(loaded)).toBe(shadowCorpusDigest(manifest));
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ schemaVersion: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
