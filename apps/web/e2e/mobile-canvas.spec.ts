import { expect, test } from "@playwright/test";

test("falling canvas fits the 390px mobile viewport without horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/songs");
  const firstPlayer = page.locator("a[href^='/player/']").first();
  await firstPlayer.click();
  await expect(page.locator("canvas").first()).toBeVisible();

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(metrics).not.toBeNull();
  if (!metrics) throw new Error("canvas not found");
  expect(metrics.horizontalOverflow).toBe(false);
  expect(metrics.left).toBeGreaterThanOrEqual(-0.5);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 0.5);
  expect(metrics.width).toBeGreaterThan(0);
  await ctx.close();
});
