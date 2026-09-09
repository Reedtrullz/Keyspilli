import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 428, height: 700 }, { width: 926, height: 320 }]) {
  test(`mobile piano fits without Focus at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("keyspilli.tempo-semantics.v1", "true"));
    await page.goto("/player/f-f-chopin-nocturne-a");
    const keyboard = page.getByRole("button", { name: "Piano keyboard", exact: true });
    await expect(keyboard).toBeVisible();
    const box = await keyboard.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.height).toBeGreaterThanOrEqual(65);
    const stage = await page.locator(".falling-canvas").boundingBox();
    expect(stage!.height).toBeGreaterThanOrEqual(viewport.height * 0.48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByRole("button", { name: "Tools", exact: true })).toBeVisible();
  });
}

test("piano and organ request a playback audio session", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: { type: "auto" } });
    localStorage.setItem("keyspilli.tempo-semantics.v1", "true");
  });
  await page.goto("/player/f-f-chopin-nocturne-a");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(await page.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type)).toBe("playback");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const { openPlayerTool } = await import("./player-tools");
  await openPlayerTool(page, "Sound");
  await page.evaluate(() => { (navigator as Navigator & { audioSession: { type: string } }).audioSession.type = "auto"; });
  await page.getByRole("radio", { name: "Organ", exact: true }).click();
  await page.getByRole("radio", { name: "Cathedral", exact: true }).click();
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(await page.evaluate(() => (navigator as Navigator & { audioSession: { type: string } }).audioSession.type)).toBe("playback");
});
