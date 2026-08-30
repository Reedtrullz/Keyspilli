import { describe, expect, it } from "vitest";
import {
  buildOriginalRecordingQueries,
  classifyRecordingCandidate,
  discoverOriginalRecordings,
  selectOriginalRecording,
  type RecordingDiscoveryCandidate,
} from "../src/recording-discovery.js";

const target = {
  artist: "Sabaton",
  title: "Defence Of Moscow",
  durationSeconds: 255.792,
  sourceYoutubeUrl: "https://www.youtube.com/watch?v=9TjXanLjpTU",
};

function candidate(overrides: Partial<RecordingDiscoveryCandidate> = {}): RecordingDiscoveryCandidate {
  return {
    videoId: "abc12345678",
    url: "https://www.youtube.com/watch?v=abc12345678",
    title: "Sabaton - Defence Of Moscow (Official Audio)",
    uploader: "Sabaton",
    durationSeconds: 256,
    isLive: false,
    ...overrides,
  };
}

describe("metadata-only original recording discovery", () => {
  it("builds deterministic original-recording queries rather than piano-search queries", () => {
    expect(buildOriginalRecordingQueries(target)).toEqual([
      "Sabaton Defence Of Moscow official audio",
      "Sabaton Defence Of Moscow official music video",
      "Sabaton Defence Of Moscow studio recording",
    ]);
  });

  it("classifies an artist-published official audio candidate with finite confidence", () => {
    expect(classifyRecordingCandidate(candidate(), target)).toMatchObject({
      id: "youtube:abc12345678",
      recordingKind: "official-studio",
      confidence: expect.any(Number),
      versionAmbiguity: "none",
    });
    expect(classifyRecordingCandidate(candidate(), target)!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("rejects live, cover, and wrong-song candidates from an original selection", () => {
    const result = selectOriginalRecording(target, [
      candidate({ videoId: "live1234567", title: "Sabaton Defence Of Moscow live", uploader: "Sabaton", isLive: true }),
      candidate({ videoId: "cover123456", title: "Sabaton Defence Of Moscow piano cover", uploader: "Cover Artist" }),
      candidate({ videoId: "wrong123456", title: "Sabaton The Final Solution (Official Audio)" }),
    ]);
    expect(result.recommendation).toBeNull();
    expect(result.status).toBe("no-match");
  });

  it("fails closed when two official-like versions are similarly plausible", () => {
    const result = selectOriginalRecording(target, [
      candidate({ videoId: "audio123456", title: "Sabaton Defence Of Moscow (Official Audio)" }),
      candidate({ videoId: "lyric123456", title: "SABATON - Defence Of Moscow (Official Lyric Video)" }),
    ]);
    expect(result.status).toBe("ambiguous");
    expect(result.recommendation).toBeNull();
    expect(result.versionAmbiguity).toMatch(/multiple|ambiguous/i);
    expect(result.candidates.every((item) => item.url.startsWith("https://www.youtube.com/watch?v="))).toBe(true);
  });

  it("selects one clearly stronger official candidate and never returns the submitted source", async () => {
    const queries: string[] = [];
    const result = await discoverOriginalRecordings(target, {
      limit: 3,
      search: async (query) => {
        queries.push(query);
        return query.endsWith("official audio")
          ? [candidate()]
          : [candidate({ videoId: "9TjXanLjpTU", title: "SABATON - Defence Of Moscow (Official Music Video)" })];
      },
    });
    expect(queries).toEqual(buildOriginalRecordingQueries(target));
    expect(result.status).toBe("selected");
    expect(result.recommendation).toBe("youtube:abc12345678");
    expect(result.candidates.some((item) => item.videoId === "9TjXanLjpTU")).toBe(false);
    expect(result.candidates[0]).toMatchObject({ recordingKind: "official-studio" });
  });

  it("does not expose local paths or malformed candidate URLs", () => {
    const result = selectOriginalRecording(target, [candidate({
      videoId: "bad/../../x",
      url: "/Users/reidar/private.mp3",
      title: "/Users/reidar/private.mp3",
      uploader: "../../secret",
    })]);
    expect(result.candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/Users\/reidar|private\.mp3|secret/);
  });
});
