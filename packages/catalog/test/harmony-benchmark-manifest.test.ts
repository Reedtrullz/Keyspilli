import { describe, expect, it } from "vitest";
import {
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

function input(ids = ["a", "b", "c", "d", "e", "f"]): HarmonyBenchmarkManifestInput {
  return { schemaVersion: 1, scores: ids.map((id) => score(id)) };
}

describe("harmony benchmark manifest", () => {
  it("normalizes six identities deterministically and never emits paths or note arrays", () => {
    const first = normalizeHarmonyBenchmarkManifest(input(["f", "a", "e", "b", "d", "c"]));
    const second = normalizeHarmonyBenchmarkManifest(input());
    expect(first.status).toBe("unavailable");
    expect(first.scores.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(canonicalHarmonyBenchmarkManifestJson(first)).toBe(canonicalHarmonyBenchmarkManifestJson(second));
    expect(canonicalHarmonyBenchmarkManifestJson(first)).not.toMatch(/\/Users|[A-Za-z]:\\|notes|\.mid|\.pdf/);
    expect(first.scores[0]?.candidate.status).toBe("unavailable");
  });

  it("fails closed when candidate or recording evidence is missing", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(input());
    expect(normalized.status).toBe("unavailable");
    expect(normalized.eligible).toBe(false);
    expect(normalized.diagnostics).toContain("candidate evidence unavailable for a");
    expect(normalized.diagnostics).toContain("recording evidence unavailable for a");
  });

  it("rejects malformed hashes, IDs, windows, and non-path-safe fields", () => {
    expect(() => normalizeHarmonyBenchmarkManifest(input(["bad id", "b", "c", "d", "e", "f"]))).toThrow(/id/i);
    const malformed = input();
    malformed.scores[0]!.sourcePdf.sha256 = "bad";
    expect(() => normalizeHarmonyBenchmarkManifest(malformed)).toThrow(/sha256/i);
    const overlap = input();
    overlap.scores[0]!.reference.trustedCoverage.windows = [{ id: "w", startBeat: 3, endBeat: 2 }];
    expect(() => normalizeHarmonyBenchmarkManifest(overlap)).toThrow(/window/i);
    const path = input();
    (path.scores[0]!.sourcePdf as unknown as Record<string, unknown>).path = "/private/reference.pdf";
    expect(() => normalizeHarmonyBenchmarkManifest(path)).toThrow(/path/i);
  });
});
