import { expect, test } from "@playwright/test";

const SONG = "f-f-chopin-nocturne-m";
const UG_SONG = "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a";

// Pin e2e runs to the deterministic oscillator engine so sampled-piano CDN
// fetches do not stall headless playback assertions.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
  });
});

test("home page shows the catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Play the songs you love/ })).toBeVisible();
  await expect(page.locator("a[href^='/player/']").first()).toBeVisible();
});

test("song library filters by difficulty", async ({ page }) => {
  await page.goto("/songs");
  await page.getByLabel("Difficulty", { exact: true }).selectOption("beginner");
  await expect(page.locator("a[href^='/player/']").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Beginner level" }).first()).toBeVisible();
});

test("song library groups difficulty levels into one card per song", async ({ page }) => {
  await page.goto("/songs");
  await page.getByLabel("Sort").selectOption("title");
  const vocalise = page.getByText("Vocalise № 1", { exact: true });
  await expect(vocalise).toHaveCount(1);
  const levels = page.getByRole("group", { name: /Difficulty levels for Vocalise/ });
  await expect(levels.getByRole("link", { name: "Open Very Beginner level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Beginner level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Easy level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Advanced level" })).toBeVisible();
  await expect(levels.getByRole("link")).toHaveCount(6);
});

test("catalog API reports the full grouped total independently of page size", async ({ request }) => {
  const res = await request.get("/api/songs?group=1&limit=1");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { songs: unknown[]; total: number };
  expect(body.songs).toHaveLength(1);
  expect(body.total).toBeGreaterThan(body.songs.length);
});

test("player loads and switches views", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await expect(page.getByRole("heading", { name: "Nocturne" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  // view switcher
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Beginner/ }).click();
  await expect(page.getByLabel("Beginner notes view")).toBeVisible();
  // lead sheet
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Lead Sheet/ }).click();
  await expect(page.getByLabel("Lead sheet view")).toBeVisible();
  // sheet music via Verovio
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Sheet Music/ }).click();
  await expect(page.locator(".sheet-svg svg").first()).toBeVisible({ timeout: 30_000 });
  const scorePages = page.locator(".sheet-svg__page");
  await expect(scorePages.first()).toBeVisible({ timeout: 30_000 });
  expect(await scorePages.count()).toBeGreaterThan(1);
  const scoreGeometry = await page.locator(".sheet-svg svg").first().evaluate((svg) => ({
    width: Number.parseFloat(svg.getAttribute("width") ?? "0"),
    height: Number.parseFloat(svg.getAttribute("height") ?? "0"),
    viewBox: svg.getAttribute("viewBox"),
    renderedHeight: svg.getBoundingClientRect().height,
  }));
  expect(scoreGeometry.width).toBeGreaterThan(100);
  expect(scoreGeometry.height).toBeGreaterThan(100);
  expect(scoreGeometry.renderedHeight).toBeGreaterThan(100);
  expect(scoreGeometry.viewBox).toBeTruthy();
  expect(await page.evaluate(() => (window as unknown as { __sheetError?: string }).__sheetError)).toBeFalsy();
});

test("Your Song Sheet Music renders all pages with notation glyphs", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Sheet Music/ }).click();

  const pages = page.locator(".sheet-svg__page");
  await expect(page.locator(".sheet-svg svg").first()).toBeVisible({ timeout: 30_000 });
  // Page count is layout-engine/font dependent (the same target renders 12–13
  // pages across supported builds), but rendering more than one page proves we
  // are exercising the multipage path rather than the old single-strip output.
  await expect.poll(() => pages.count(), { timeout: 30_000 }).toBeGreaterThan(1);

  const score = await pages.evaluateAll((elements) => {
    const markup = elements.map((element) => element.innerHTML).join("\n");
    const svgs = elements.flatMap((element) => Array.from(element.querySelectorAll("svg")));
    return {
      pages: elements.length,
      svgCount: svgs.length,
      hasNotationGlyph: /(?:tie|slur)/i.test(markup),
      hasStaffContent: /(?:staff|measure|note)/i.test(markup),
      minHeight: Math.min(...svgs.map((svg) => svg.getBoundingClientRect().height)),
    };
  });
  expect(score.pages).toBeGreaterThan(1);
  expect(score.svgCount).toBeGreaterThanOrEqual(score.pages);
  expect(score.hasNotationGlyph).toBe(true);
  expect(score.hasStaffContent).toBe(true);
  expect(score.minHeight).toBeGreaterThan(100);
  expect(await page.evaluate(() => (window as unknown as { __sheetError?: string }).__sheetError)).toBeFalsy();
});

test("player controls: loop, tempo, transpose, hands", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: /LOOP OFF/ }).click();
  await expect(page.getByRole("button", { name: /LOOP ON/ })).toBeVisible();
  await page.getByRole("button", { name: "Decrease speed" }).click();
  await expect(page.getByText("90%")).toBeVisible();
  await page.getByRole("button", { name: "R", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  // seek bar + spacebar play/pause
  const seek = page.getByRole("slider", { name: "Seek" });
  await expect(seek).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await expect(page.getByText("Playing — click anywhere to pause")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByText("Playing — click anywhere to pause")).not.toBeVisible();
});

test("chord mode distinguishes strict UG coverage from hybrid Auto", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Player settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Chord mode" }).click();
  await expect(dialog.getByText("Chord source")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "UG timeline" })).toBeEnabled();
  await dialog.getByRole("button", { name: "UG timeline" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("chord-mode-status")).toHaveText("UG opening (partial)");

  await page.getByRole("button", { name: "Open settings" }).click();
  const hybridDialog = page.getByRole("dialog", { name: "Player settings" });
  await hybridDialog.getByRole("button", { name: "Auto" }).click();
  await hybridDialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("chord-mode-status")).toHaveText("UG + generated fallback");
});

test("practice mode starts and exits cleanly", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice mode" })).toBeVisible();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice mode" })).not.toBeVisible();
});

test("chord practice shows a compact target and advances by chord", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const panel = page.getByTestId("chord-practice-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Play the chord together" })).toBeVisible();
  await expect(panel.getByLabel("Target notes")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Hear chord" })).toBeVisible();
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel.getByText(/Chord 2 of/)).toBeVisible();
  await page.getByRole("button", { name: "Exit chord practice", exact: true }).click();
  await expect(panel).not.toBeVisible();
});

test("download dialog offers free exports", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: /Download sheet music and MIDI/ }).click();
  await expect(page.getByRole("dialog", { name: /Download sheet music or MIDI/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /MIDI/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Simplify PDF/ })).toBeVisible();
});

test("MIDI export returns a file", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=midi`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("audio/midi");
});

test("simplify PDF export generates a PDF", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=simplify`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("classic PDF export renders engraved score", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=classic`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("Your Song PDF export works for both layouts", async ({ request }) => {
  for (const layout of ["simplify", "classic"] as const) {
    const res = await request.get(`/api/song/${UG_SONG}/export?type=pdf&layout=${layout}`);
    expect(res.status(), `${layout} PDF status`).toBe(200);
    expect(res.headers()["content-type"], `${layout} PDF content type`).toContain("application/pdf");
    const body = await res.body();
    expect(body.byteLength, `${layout} PDF size`).toBeGreaterThan(1000);
    expect(body.subarray(0, 5).toString(), `${layout} PDF header`).toBe("%PDF-");
  }
});

test("PDF export rejects unknown layouts with a stable safe error", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=unknown`);
  expect(res.status()).toBe(400);
  await expect(res.json()).resolves.toEqual({ error: "unknown PDF layout" });
});

test("upload flow creates a playable song", async ({ request }) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync("../../data/seed-midi/f-abt-vocalise-o-1.mid");
  const res = await request.post("/api/uploads?title=Upload Test&artist=Keyspilli", {
    data: buf,
    headers: { authorization: "Bearer test-token-for-e2e" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { songIds: string[] };
  expect(body.songIds.length).toBe(6);
});

test("uploads page shows the wizard", async ({ page }) => {
  await page.goto("/uploads");
  await expect(page.getByText("Drop your .mid, .midi, .musicxml or .mxl here")).toBeVisible();
});

test("youtube page validates URLs", async ({ page }) => {
  await page.goto("/youtube");
  await page.getByPlaceholder(/youtube\.com/).fill("https://example.com/not-a-video");
  await page.getByRole("button", { name: "Convert" }).click();
  await expect(page.getByText(/valid YouTube URL|paste a valid/i)).toBeVisible();
});
