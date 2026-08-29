import { describe, expect, it } from "vitest";
import {
  buildResearchQueries,
  classifyArrangementCandidate,
  createSongIdentity,
  mergeArrangementCandidates,
  rankArrangementCandidates,
  serializeResearchManifest,
  type ArrangementCandidate,
} from "../src/song-research.js";

const identity = createSongIdentity({
  title: "Sabaton - Defence Of Moscow (Official Music Video)",
  artist: "Sabaton",
  sourceYoutubeUrl: "https://youtu.be/9TjXanLjpTU?t=2",
  durationSeconds: 255.792,
});

function candidate(overrides: Partial<ArrangementCandidate> = {}): ArrangementCandidate {
  return {
    id: "candidate-a",
    sourceType: "midi",
    title: "Defence Of Moscow piano transcription",
    url: "https://example.test/defence.mid",
    provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:defence" },
    durationSeconds: 255,
    coverage: { startSeconds: 0, endSeconds: 255, completeness: 1 },
    ...overrides,
  };
}

describe("song research foundation", () => {
  it("normalizes song identity and canonical YouTube provenance", () => {
    expect(identity).toMatchObject({
      title: "Defence Of Moscow",
      artist: "Sabaton",
      normalizedTitle: "defence of moscow",
      normalizedArtist: "sabaton",
      youtubeVideoId: "9TjXanLjpTU",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=9TjXanLjpTU",
    });
  });

  it("builds stable, deduplicated query variants", () => {
    expect(buildResearchQueries(identity)).toEqual([
      "Sabaton Defence Of Moscow piano",
      "Sabaton Defence Of Moscow transcription",
      "defence moscow Sabaton piano",
      "Sabaton Defence Of Moscow Synthesia",
      "Sabaton Defence Of Moscow MIDI",
    ]);
    expect(buildResearchQueries(identity)).toEqual(buildResearchQueries({ ...identity }));
  });

  it("classifies piano, tutorial, synthesia and direct fallback candidates", () => {
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow Synthesia piano tutorial" }), { overrideSourceType: true })).toMatchObject({
      sourceType: "piano-tutorial-video",
      extractionStrategy: "visual-midi",
    });
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow Synthesia piano tutorial" })).sourceType).toBe("midi");
    expect(classifyArrangementCandidate(candidate({ extractionStrategy: "not-a-strategy" as never })).extractionStrategy).toBe("symbolic");
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow piano cover performance" }), { overrideSourceType: true }).sourceType).toBe("piano-cover-video");
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow metal transcription" }), { overrideSourceType: true })).toMatchObject({
      sourceType: "metal-transcription",
      extractionStrategy: "audio-transcription",
      selection: "fallback",
    });
  });

  it("ranks with inspectable reasons and keeps direct transcription as fallback", () => {
    const ranked = rankArrangementCandidates(identity, [
      candidate({ id: "direct", sourceType: "metal-transcription", title: "direct AI transcription", confidence: 0.4 }),
      candidate({ id: "piano", sourceType: "piano-cover-video", title: "Sabaton Defence Of Moscow piano cover", confidence: 0.8 }),
      candidate({ id: "partial", title: "Sabaton Defence Of Moscow piano", durationSeconds: 80, coverage: { startSeconds: 0, endSeconds: 80, completeness: 0.3 } }),
    ]);
    expect(ranked[0]?.id).toBe("piano");
    expect(ranked.find((item) => item.id === "direct")!.reasons!.join(" ")).toMatch(/fallback|transcription/i);
    expect(ranked.find((item) => item.id === "partial")!.score!).toBeLessThan(ranked[0]!.score!);
    expect(ranked[0]?.scoreBreakdown).toBeDefined();
  });

  it("matches title and artist tokens at boundaries", () => {
    const ranked = rankArrangementCandidates(identity, [
      candidate({ id: "substring", title: "Defence Of Moscowian piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:substring" } }),
      candidate({ id: "exact", title: "Sabaton Defence Of Moscow piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:exact" } }),
    ]);
    expect(ranked.find((item) => item.id === "exact")!.score!).toBeGreaterThan(ranked.find((item) => item.id === "substring")!.score!);
    expect(ranked.find((item) => item.id === "substring")!.reasons!.join(" ")).toMatch(/title tokens|0\/3|1\/3/i);
  });

  it("merges canonical duplicates and is deterministic for equal ids", () => {
    const one = candidate({ id: "same", url: "https://youtu.be/abc12345678?t=4", title: "Defence Of Moscow piano", confidence: 0.4 });
    const two = candidate({ id: "same", url: "https://www.youtube.com/watch?v=abc12345678", title: "Defence Of Moscow piano cover", confidence: 0.9 });
    const merged = mergeArrangementCandidates([one, two]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "same", url: "https://www.youtube.com/watch?v=abc12345678", confidence: 0.9 });
    expect(mergeArrangementCandidates([one, two])).toEqual(mergeArrangementCandidates([two, one]));
    expect(rankArrangementCandidates(identity, [two, one])).toEqual(rankArrangementCandidates(identity, [one, two]));
  });

  it("normalizes invalid numeric metadata instead of emitting NaN or out-of-range values", () => {
    const invalid = candidate({
      durationSeconds: Number.NaN,
      confidence: 4,
      coverage: { startSeconds: -10, endSeconds: 2, completeness: 4 },
    });
    const normalized = rankArrangementCandidates(identity, [invalid])[0]!;
    expect(normalized.durationSeconds).toBeNull();
    expect(normalized.confidence).toBe(1);
    expect(normalized.coverage).toBeNull();
    expect(JSON.stringify(normalized)).not.toMatch(/NaN|Infinity/);
  });

  it("serializes a stable path-free manifest", () => {
    const manifestCandidates = [
      candidate({ id: "zeta", localPath: "/Users/reidar/Downloads/secret.mid" }),
      candidate({ id: "alpha", localPath: "/tmp/other.mid" }),
    ];
    const manifest = serializeResearchManifest(identity, manifestCandidates);
    expect(manifest).not.toContain("/Users/reidar");
    expect(JSON.parse(manifest)).toMatchObject({ schemaVersion: 1, song: { normalizedTitle: "defence of moscow" } });
    expect(serializeResearchManifest(identity, [...manifestCandidates].reverse())).toBe(manifest);
  });

  it("redacts nested paths, URL userinfo, and credential-like query values", () => {
    const nestedCandidate = {
      ...candidate({
      id: "nested",
      url: "https://user:password@example.test/defence.mid?token=secret&v=abc12345678",
      provenance: {
        kind: "midi",
        acquiredVia: "upload",
        sourceRef: "upload:local",
        sourceArtifactRef: "/Users/reidar/Downloads/private.mid",
        nested: { absolutePath: "/tmp/private.mid", credential: "secret", client_secret: "also-secret" },
      } as never,
      }),
      extra: { arbitrary: "/tmp/hidden" },
    } as ArrangementCandidate;
    const manifest = serializeResearchManifest(identity, [nestedCandidate]);
    expect(manifest).not.toMatch(/password|secret|\/Users\/reidar|\/tmp\/private/);
    expect(manifest).toContain("example.test");
    expect(manifest).toContain("v=abc12345678");
  });
});
