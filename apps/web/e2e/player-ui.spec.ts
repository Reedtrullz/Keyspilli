import { expect, test } from "@playwright/test";

const SONG = "f-f-chopin-nocturne-m";

// Pin e2e runs to the deterministic oscillator engine so sampled-piano CDN
// fetches do not stall headless playback assertions.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
  });
});

test("transport UI advances during playback without pause", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await expect(page.locator("canvas").first()).toBeVisible();

  const timer = page.getByRole("timer");
  const before = await timer.textContent();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await page.waitForTimeout(1500);
  const after = await timer.textContent();
  expect(after).not.toBe(before);

  const seekValue = Number(await page.getByLabel("Seek").inputValue());
  expect(seekValue).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("sections bar collapses, persists, and expands", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const nav = page.getByRole("navigation", { name: "Song sections" });
  await expect(nav).toBeVisible();

  const pillCount = await nav.locator("span").count();
  expect(pillCount).toBeGreaterThan(1);

  const toggle = nav.getByRole("button", { name: /Sections/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.locator("span")).toHaveCount(1);

  await page.reload();
  const navAfterReload = page.getByRole("navigation", { name: "Song sections" });
  const toggleAfterReload = navAfterReload.getByRole("button", { name: /Sections/ });
  await expect(toggleAfterReload).toHaveAttribute("aria-expanded", "false");
  await expect(navAfterReload.locator("span")).toHaveCount(1);

  await toggleAfterReload.click();
  await expect(toggleAfterReload).toHaveAttribute("aria-expanded", "true");
  await expect(navAfterReload.locator("span")).toHaveCount(pillCount);
});

test("full width mode expands the player and persists across reload", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const root = page.locator("main > div").first();
  await expect(root).toBeVisible();

  const defaultClass = await root.getAttribute("class");
  expect(defaultClass).toContain("max-w-6xl");

  await page.getByRole("button", { name: "Full width" }).click();
  const expandedClass = await root.getAttribute("class");
  expect(expandedClass).toContain("w-full");
  expect(expandedClass).not.toContain("max-w-6xl");

  await page.reload();
  const rootAfterReload = page.locator("main > div").first();
  const persistedClass = await rootAfterReload.getAttribute("class");
  expect(persistedClass).toContain("w-full");
  expect(persistedClass).not.toContain("max-w-6xl");
});

test("full width player fits the 390px mobile viewport without horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/player/${SONG}`);
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.getByRole("button", { name: "Full width" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await ctx.close();
});
