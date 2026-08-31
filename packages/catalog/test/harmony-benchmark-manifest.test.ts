import { describe, expect, it } from "vitest";
import {
  HARMONY_BENCHMARK_SCORE_IDS,
  canonicalHarmonyBenchmarkManifestJson,
  normalizeHarmonyBenchmarkManifest,
  type HarmonyBenchmarkManifestInput,
} from "../src/harmony-benchmark-manifest.js";

const hash = (char: string) => char.repeat(64);

function score(id: string, overrides: Partial<HarmonyBenchmarkManifestInput["scores"][number]> = {}) {
  return {
    id,
    title: `${id} title`,
    artist: `${id} artist`,
    sourcePdf: { sha256: hash("a"), bytes: 100, pages: 2, title: "Source" },
    reference: {
      selectedOmr: { backendId: "homr", version: "1.0" },
      trustedCoverage: { maskSha256: hash("b"), referenceSha256: hash("c"), windows: [{ id: "intro", startBeat: 0, endBeat: 8 }] },
      excludedRegions: [{ id: "bad-1", startBeat: 8, endBeat: 9, reason: "uncertain" }],
    },
    candidate: { status: "unavailable" as const, reason: "not supplied" },
    recording: { status: "unavailable" as const, reason: "not supplied" },
    ...overrides,
  };
}

function input(ids: string[] = [...HARMONY_BENCHMARK_SCORE_IDS]): HarmonyBenchmarkManifestInput {
  return { schemaVersion: 1, scores: ids.map((id) => score(id)) };
}

describe("harmony benchmark manifest", () => {
  it("normalizes six identities deterministically and never emits paths or note arrays", () => {
    const first = normalizeHarmonyBenchmarkManifest(input([
      "unknown-free-bird",
      "sabaton-gott-mit-uns",
      "sleep-token-take-me-back-to-eden",
      "sabaton-1916",
      "sabaton-the-caroleans-prayer",
      "sabaton-christmas-truce",
    ]));
    const second = normalizeHarmonyBenchmarkManifest(input());
    expect(first.status).toBe("unavailable");
    expect(first.scores.map((row) => row.id)).toEqual([...HARMONY_BENCHMARK_SCORE_IDS].sort());
    expect(canonicalHarmonyBenchmarkManifestJson(first)).toBe(canonicalHarmonyBenchmarkManifestJson(second));
    expect(canonicalHarmonyBenchmarkManifestJson(first)).not.toMatch(/\/Users|[A-Za-z]:\\|notes|\.mid|\.pdf/);
    expect(first.scores[0]?.candidate.status).toBe("unavailable");
  });

  it("fails closed when candidate or recording evidence is missing", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(input());
    expect(normalized.status).toBe("unavailable");
    expect(normalized.eligible).toBe(false);
    expect(normalized.diagnostics).toContain("candidate evidence unavailable for sabaton-1916");
    expect(normalized.diagnostics).toContain("recording evidence unavailable for sabaton-1916");
  });

  it("rejects malformed hashes, IDs, windows, and non-path-safe fields", () => {
    expect(() => normalizeHarmonyBenchmarkManifest(input([
      "bad-id",
      "sabaton-christmas-truce",
      "sabaton-gott-mit-uns",
      "sabaton-the-caroleans-prayer",
      "sleep-token-take-me-back-to-eden",
      "unknown-free-bird",
    ]))).toThrow(/six|identit/i);
    const malformed = input();
    malformed.scores[0]!.sourcePdf.sha256 = "bad";
    expect(() => normalizeHarmonyBenchmarkManifest(malformed)).toThrow(/sha256/i);
    const overlap = input();
    overlap.scores[0]!.reference.trustedCoverage.windows = [{ id: "intro", startBeat: 3, endBeat: 2 }];
    expect(() => normalizeHarmonyBenchmarkManifest(overlap)).toThrow(/window/i);
    const path = input();
    (path.scores[0]!.sourcePdf as unknown as Record<string, unknown>).path = "/private/reference.pdf";
    expect(() => normalizeHarmonyBenchmarkManifest(path)).toThrow(/path/i);
  });

  it("requires trusted coverage and rejects duplicate or cross-set overlapping windows", () => {
    const empty = input();
    empty.scores[0]!.reference.trustedCoverage.windows = [];
    expect(() => normalizeHarmonyBenchmarkManifest(empty)).toThrow(/trusted.*window/i);

    const duplicate = input();
    duplicate.scores[0]!.reference.trustedCoverage.windows = [
      { id: "same", startBeat: 0, endBeat: 2 },
      { id: "same", startBeat: 2, endBeat: 4 },
    ];
    expect(() => normalizeHarmonyBenchmarkManifest(duplicate)).toThrow(/duplicate.*window/i);

    const crossSet = input();
    crossSet.scores[0]!.reference.excludedRegions = [{ id: "excluded", startBeat: 1, endBeat: 3, reason: "uncertain" }];
    expect(() => normalizeHarmonyBenchmarkManifest(crossSet)).toThrow(/overlap/i);
  });

  it("preserves a safe selectedAt timestamp and rejects relative path-like text", () => {
    const withTimestamp = input();
    withTimestamp.scores[0]!.reference.selectedOmr.selectedAt = "2026-08-31T12:34:56.000Z";
    const normalized = normalizeHarmonyBenchmarkManifest(withTimestamp);
    expect(normalized.scores[0]?.reference.selectedOmr.selectedAt).toBe("2026-08-31T12:34:56.000Z");

    const relativePath = input();
    (relativePath.scores[0]!.reference.selectedOmr as unknown as Record<string, unknown>).selectedAt = "../private/reference.pdf";
    expect(() => normalizeHarmonyBenchmarkManifest(relativePath)).toThrow(/path/i);
  });

  it("canonicalizes a runtime manifest through the allowlist before serializing", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(input());
    const runtime = structuredClone(normalized) as unknown as Record<string, unknown>;
    runtime.runtimePath = "/Users/reidar/private/reference.mid";
    const runtimeScore = (runtime.scores as Array<Record<string, unknown>>)[0]!;
    runtimeScore.notes = [{ midi: 60, path: "../private/note.mid" }];
    (runtimeScore.sourcePdf as Record<string, unknown>).path = "../private/reference.pdf";

    const canonical = canonicalHarmonyBenchmarkManifestJson(runtime as never);
    expect(canonical).toBe(canonicalHarmonyBenchmarkManifestJson(normalized));
    expect(canonical).not.toMatch(/runtimePath|private|notes|\.mid|\.pdf/);
  });
});
