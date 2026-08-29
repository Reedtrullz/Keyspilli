import { describe, expect, it } from "vitest";
import {
  buildResearchQueries,
  classifyArrangementCandidate,
  createSongIdentity,
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
      "Sabaton Defence Of Moscow Synthesia",
      "Sabaton Defence Of Moscow MIDI",
    ]);
    expect(buildResearchQueries(identity)).toEqual(buildResearchQueries({ ...identity }));
  });

  it("classifies piano, tutorial, synthesia and direct fallback candidates", () => {
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow Synthesia piano tutorial" }))).toMatchObject({
      sourceType: "piano-tutorial-video",
      extractionStrategy: "visual-midi",
    });
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow piano cover performance" })).sourceType).toBe("piano-cover-video");
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow metal transcription" })).sourceType).toBe("metal-transcription");
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
});
