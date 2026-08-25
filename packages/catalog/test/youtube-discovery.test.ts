import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildYoutubeQueries,
  cleanCatalogTitle,
  parseYtDlpSearchOutput,
  scoreCandidate,
  type YoutubeDiscoveryCandidate,
} from "../src/youtube-discovery.js";

const target = {
  baseId: "test-song",
  title: "En Livstid I Krig",
  artist: "Sabaton",
};

function candidate(overrides: Partial<YoutubeDiscoveryCandidate> = {}): YoutubeDiscoveryCandidate {
  return {
    videoId: "aaaaaaaaaaa",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    title: "Song piano cover",
    uploader: "Pianist",
    durationSeconds: 200,
    isLive: false,
    ...overrides,
  };
}

describe("youtube source discovery", () => {
  it("cleans uploaded catalog titles without erasing real names", () => {
    expect(cleanCatalogTitle(
      "Sabaton - En Livstid I Krig (A Lifetime of War) - Piano cover",
      "Dorelia Bast",
    )).toBe("Sabaton En Livstid I Krig");
    expect(cleanCatalogTitle("Song | Piano Tutorial | Synthesia HD", "Artist")).toBe("Song");
  });

  it("builds complementary queries without duplicating them", () => {
    expect(buildYoutubeQueries(target)).toEqual([
      "Sabaton En Livstid I Krig piano",
      "Sabaton En Livstid I Krig transcription",
      "en livstid krig Sabaton piano",
    ]);
  });

  it("requires searchable song metadata", () => {
    expect(() => buildYoutubeQueries({ baseId: "x", title: "", artist: "A" })).toThrow(/artist and title/);
  });

  it("parses newline-delimited yt-dlp JSON and deduplicates by video id", () => {
    const stdout = [
      `{"id":"1huc0zY6Mqo","title":"En Livstid piano","uploader":"A","duration":353,"view_count":100395}`,
      `{"id":"uHfdTulhEEw","title":"En Livstid (Piano)","uploader":null,"channel":"B","duration":348}`,
      `{"id":"wYOdxNlqXhQ","title":"En Livstid tutorial","uploader":null,"duration":NA,"view_count":NA,"is_live":NA}`,
      `{"id":"1huc0zY6Mqo","title":"duplicate","duration":null}`,
      "not-json",
    ].join("\n");
    const parsed = parseYtDlpSearchOutput(stdout);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      videoId: "1huc0zY6Mqo",
      uploader: "A",
      viewCount: 100395,
    });
    expect(parsed[1]).toMatchObject({ videoId: "uHfdTulhEEw", uploader: "B", durationSeconds: 348 });
    expect(parsed[2]).toMatchObject({ videoId: "wYOdxNlqXhQ", durationSeconds: 0, isLive: false });
  });

  it("ranks relevant piano performances above popular but irrelevant uploads", () => {
    const good = scoreCandidate(candidate({
      videoId: "good",
      title: "Sabaton - En Livstid I Krig - Piano cover",
      viewCount: 1000,
    }), target);
    const wrong = scoreCandidate(candidate({
      videoId: "wrong",
      title: "Totally different reaction video",
      viewCount: 10_000_000,
      durationSeconds: 240,
    }), target);
    expect(good.score).toBeGreaterThan(wrong.score);
    expect(good.reasons).toContain("piano signal");
    expect(wrong.reasons.join("|")).toContain("insufficient song-token match");
  });

  it("rejects query drift to unrelated songs by the same performer", () => {
    const drifted = scoreCandidate(candidate({
      videoId: "drifted",
      title: "In Flames - Only for the Weak - Piano cover",
    }), {
      ...target,
      title: "Sabaton - En Livstid I Krig (A Lifetime of War) - Piano cover",
    });
    expect(drifted.reasons.join("|")).toContain("insufficient song-token match");
  });

  it("marks live and out-of-range candidates as ineligible", () => {
    const live = scoreCandidate(candidate({ title: "piano", isLive: true }), target);
    const long = scoreCandidate(candidate({ title: "piano", durationSeconds: 601 }), target);
    expect(live.reasons).toContain("duration/live ineligible");
    expect(long.score).toBeLessThan(-500);
  });

  it("prefers durations near the currently imported recording", () => {
    const rankOptions = { referenceDurationSeconds: 200 };
    const close = scoreCandidate(candidate({ title: "piano", durationSeconds: 210 }), target, rankOptions);
    const far = scoreCandidate(candidate({ title: "piano", durationSeconds: 120 }), target, rankOptions);
    expect(close.score).toBeGreaterThan(far.score);
  });
});
