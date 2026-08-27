import { describe, expect, it } from "vitest";
import { normalizeYoutubeImportUrl } from "../src/youtube-url.js";

describe("normalizeYoutubeImportUrl", () => {
  it("canonicalizes supported HTTPS video URL forms", () => {
    expect(normalizeYoutubeImportUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(normalizeYoutubeImportUrl("https://youtu.be/dQw4w9WgXcQ?t=12"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(normalizeYoutubeImportUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(normalizeYoutubeImportUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it.each([
    "https://youtube.com/playlist?list=PL1234567890",
    "https://youtube.com/",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "--config-location=/etc/shadow",
  ])("rejects unsafe or non-video input %s", (value) => {
    expect(() => normalizeYoutubeImportUrl(value)).toThrow();
  });
});
