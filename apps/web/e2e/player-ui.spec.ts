import { expect, test } from "@playwright/test";

const SONG = "f-f-chopin-nocturne-m";

// Pin e2e runs to the deterministic oscillator engine so sampled-piano CDN
// fetches do not stall headless playback assertions.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!window.localStorage.getItem("keyspilli.prefs.v1")) {
      window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
    }
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

test("organ sound controls persist across reload", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Open settings" }).click();

  await page.getByRole("radio", { name: "Organ" }).click();
  await expect(page.getByRole("radio", { name: "Organ" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Sustain pedal")).toHaveCount(0);
  await page.getByRole("radio", { name: "Fast" }).click();
  await page.getByLabel("Organ drive").fill("67");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.keyboard.press("a");

  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("radio", { name: "Organ" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Fast" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Organ drive")).toHaveValue("67");
  expect(consoleErrors).toEqual([]);
});

test("switching sound modes preserves active transport", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(500);
  const seek = page.getByLabel("Seek");
  let previous = Number(await seek.inputValue());

  for (const sound of ["Organ", "Synth Piano", "Organ"]) {
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("radio", { name: sound }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const current = Number(await seek.inputValue());
    expect(current).toBeGreaterThan(previous);
    previous = current;
  }
  expect(consoleErrors).toEqual([]);
});
