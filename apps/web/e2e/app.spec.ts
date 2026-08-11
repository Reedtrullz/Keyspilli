import { expect, test } from "@playwright/test";

const SONG = "f-f-chopin-nocturne-m";

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
});

test("player controls: loop, tempo, transpose, hands", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: /LOOP OFF/ }).click();
  await expect(page.getByRole("button", { name: /LOOP ON/ })).toBeVisible();
  await page.getByRole("button", { name: "−" }).first().click();
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

test("practice mode starts and exits cleanly", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice mode" })).toBeVisible();
  await page.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Practice mode" })).not.toBeVisible();
});

test("download dialog offers free exports", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: /Download Sheet & MIDI/ }).click();
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

test("upload flow creates a playable song", async ({ request }) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync("../../data/seed-midi/f-abt-vocalise-o-1.mid");
  const res = await request.post("/api/uploads?title=Upload Test&artist=Keyspilli", { data: buf });
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
