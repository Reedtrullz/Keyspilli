import { expect, it } from "vitest";
import { normalizeSheetNavigationUrl, takeFreshNavigationPrefetch } from "../../public/verovio/sheet-navigation-prefetch.mjs";

it("accepts only same-origin direct Sheet Music navigation URLs", () => {
  expect(normalizeSheetNavigationUrl("/player/song-a/sheet", "http://example.test")).toBe("http://example.test/player/song-a/sheet");
  expect(normalizeSheetNavigationUrl("http://evil.test/player/song-a/sheet", "http://example.test")).toBeNull();
  expect(normalizeSheetNavigationUrl("/player/song-a/beginner", "http://example.test")).toBeNull();
  expect(normalizeSheetNavigationUrl("/player/song-a/sheet?next=/outside", "http://example.test")).toBeNull();
});

it("returns a fresh one-use navigation response and rejects stale entries", () => {
  const response = new Response("<html>sheet</html>", { status: 200, headers: { "content-type": "text/html" } });
  const entry = { url: "http://example.test/player/song-a/sheet", expiresAt: 2_000, response };
  expect(takeFreshNavigationPrefetch(entry, entry.url, 1_000)?.status).toBe(200);
  expect(takeFreshNavigationPrefetch(entry, entry.url, 2_001)).toBeNull();
  expect(takeFreshNavigationPrefetch(entry, "http://example.test/player/song-b/sheet", 1_000)).toBeNull();
});
