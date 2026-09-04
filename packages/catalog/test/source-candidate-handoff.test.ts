import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readArrangementManifest } from "../src/artifact-manifest.js";
import { ingestSource } from "../src/ingest.js";
import { writeMidi } from "@keyspilli/midi";
import {
  affirmSourceCandidateHandoff,
  bindSourceCandidateUpload,
  cleanupExpiredSourceCandidateHandoffs,
  createSourceCandidateHandoff,
  getSourceCandidateHandoff,
  handoffClientView,
  saveSourceCandidateHandoff,
  sanitizeGenericExternalUrl,
  type GenericSourceCandidateInput,
  classifyGenericSourceCandidate,
  type GenericSongTarget,
  getDb,
} from "../src/index.js";

const dataRoot = mkdtempSync(join(tmpdir(), "keyspilli-handoff-"));
const previousDataRoot = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = dataRoot;

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataRoot;
  await rm(dataRoot, { recursive: true, force: true });
});

const target: GenericSongTarget = { id: "open-song", artist: "Open Band", title: "Open Song" };

function candidate(overrides: Partial<GenericSourceCandidateInput> = {}) {
  return classifyGenericSourceCandidate(target, {
    candidateId: "lead-1",
    sourceRef: "https://example.test/open-song.mid?token=drop-me",
    resultTitle: "Open Band - Open Song MIDI",
    provider: "approved-metadata",
    apparentFormat: "mid",
    access: "PUBLIC_PAGE_NO_DIRECT_FILE",
    rights: "UNKNOWN_RIGHTS",
    timing: "UNKNOWN_TIMING",
    parseStatus: "metadata-only",
    ...overrides,
  });
}

describe("source candidate handoff", () => {
  beforeEach(() => {
    // Keep the persistence assertions independent of prior handoff ids.
    getDb().prepare("DELETE FROM source_candidate_handoffs").run();
  });

  it("sanitizes public URLs and rejects local/private destinations", () => {
    expect(sanitizeGenericExternalUrl("https://user:secret@example.test/a.mid?token=x#frag")).toBe("https://example.test/a.mid");
    expect(sanitizeGenericExternalUrl("http://127.0.0.1/a.mid")).toBeNull();
    expect(sanitizeGenericExternalUrl("http://[::ffff:127.0.0.1]/a.mid")).toBeNull();
    expect(sanitizeGenericExternalUrl("http://[fc00::1]/a.mid")).toBeNull();
    expect(sanitizeGenericExternalUrl("file:///tmp/a.mid")).toBeNull();
  });

  it("creates a user-mediated handoff without promoting discovery timing", () => {
    const handoff = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-1",
      now: "2026-09-05T12:00:00.000Z",
    });
    expect(handoff).toMatchObject({
      state: "AWAITING_USER_FILE",
      userAffirmedTarget: false,
      timing: "UNKNOWN_TIMING",
      candidateUrl: "https://example.test/open-song.mid",
    });
    expect(handoffClientView(handoff)).not.toHaveProperty("uploadedSourceSha256");
  });

  it("repeats deterministic handoff metadata for the same selected lead", () => {
    const options = {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-deterministic",
      now: "2026-09-05T12:00:00.000Z",
    };
    expect(createSourceCandidateHandoff(candidate(), options)).toEqual(createSourceCandidateHandoff(candidate(), options));
  });

  it("requires explicit target affirmation and binds a separate private upload", () => {
    const initial = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-2",
      now: "2026-09-05T12:00:00.000Z",
    });
    expect(() => bindSourceCandidateUpload(initial, {
      uploadedSourceSha256: "a".repeat(64),
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${"a".repeat(64)}`,
    })).toThrow(/confirmation/i);
    const affirmed = affirmSourceCandidateHandoff(initial);
    const binding = bindSourceCandidateUpload(affirmed, {
      uploadedSourceSha256: "a".repeat(64),
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${"a".repeat(64)}`,
    });
    expect(binding.handoff.state).toBe("FILE_RECEIVED");
    expect(binding.link).toMatchObject({
      selectedCandidateId: "lead-1",
      discoveryTiming: "UNKNOWN_TIMING",
      uploadedProvenanceClass: "USER_SUPPLIED_PRIVATE",
      uploadedTimingAuthority: "NATIVE_AUTHORITATIVE",
    });
  });

  it("keeps an explicit format mismatch visible without accepting protected leads", () => {
    const handoff = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-3",
      now: "2026-09-05T12:00:00.000Z",
    });
    const binding = bindSourceCandidateUpload(affirmSourceCandidateHandoff(handoff), {
      uploadedSourceSha256: "b".repeat(64),
      uploadedFormat: "musicxml",
      intakeCandidateId: `upload-${"b".repeat(64)}`,
    });
    expect(binding.handoff.state).toBe("FORMAT_MISMATCH");
    expect(() => createSourceCandidateHandoff(candidate({ candidateClass: "BENCHMARK_REFERENCE" }), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-protected",
      now: "2026-09-05T12:00:00.000Z",
    })).toThrow(/firewall|protected/i);
  });

  it("allows an exact accepted upload retry but rejects a different file", () => {
    const handoff = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-retry",
      now: "2026-09-05T12:00:00.000Z",
    });
    const hash = "c".repeat(64);
    const binding = bindSourceCandidateUpload(affirmSourceCandidateHandoff(handoff), {
      uploadedSourceSha256: hash,
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${hash}`,
    });
    const accepted = { ...binding.handoff, state: "GENERATION_ACCEPTED" as const };
    expect(bindSourceCandidateUpload(accepted, {
      uploadedSourceSha256: hash,
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${hash}`,
    }).handoff.state).toBe("GENERATION_ACCEPTED");
    expect(() => bindSourceCandidateUpload(accepted, {
      uploadedSourceSha256: "d".repeat(64),
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${"d".repeat(64)}`,
    })).toThrow(/cannot receive/i);
  });

  it("round-trips the handoff through the catalog database", () => {
    const handoff = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-db",
      now: "2026-09-05T12:00:00.000Z",
    });
    saveSourceCandidateHandoff(handoff);
    expect(getSourceCandidateHandoff(handoff.handoffId)).toEqual(handoff);
  });

  it("expires abandoned handoffs and cleans their persisted rows", () => {
    const handoff = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-expiring",
      now: "2020-01-01T00:00:00.000Z",
      ttlMs: 60_000,
    });
    saveSourceCandidateHandoff(handoff);
    expect(getSourceCandidateHandoff(handoff.handoffId)?.state).toBe("EXPIRED");
    expect(cleanupExpiredSourceCandidateHandoffs(new Date("2020-01-01T00:01:01.000Z"))).toBe(1);
    expect(getSourceCandidateHandoff(handoff.handoffId)).toBeNull();
  });

  it("persists the handoff lineage in an atomic symbolic ingest", async () => {
    const bytes = writeMidi(Array.from({ length: 12 }, (_, index) => ({ midi: 60 + index, start: index, dur: 0.5, vel: 90 })), { tempoBpm: 120 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const initial = createSourceCandidateHandoff(candidate(), {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
      handoffId: "handoff-ingest",
      now: "2026-09-05T12:00:00.000Z",
    });
    const binding = bindSourceCandidateUpload(affirmSourceCandidateHandoff(initial), {
      uploadedSourceSha256: hash,
      uploadedFormat: "midi",
      intakeCandidateId: `upload-${hash}`,
    });
    const result = await ingestSource({
      buf: bytes,
      baseId: `upload-${hash}`,
      title: target.title,
      artist: target.artist,
      contentType: "upload",
      sourceCandidateHandoff: binding.link,
    });
    expect(result.error).toBeUndefined();
    const manifest = await readArrangementManifest(result.baseId, dataRoot);
    expect(manifest.status).toBe("valid");
    if (manifest.status === "valid") expect(manifest.manifest.sourceCandidateHandoff).toEqual(binding.link);
  });
});
