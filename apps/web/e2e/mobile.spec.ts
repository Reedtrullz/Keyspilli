import { expect, test } from "@playwright/test";

test("mobile viewport: home, library and player render", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Play the songs you love/ })).toBeVisible();
  await page.goto("/songs");
  await expect(page.locator("a[href^='/player/']").first()).toBeVisible();
  await page.goto("/player/f-f-chopin-nocturne-m");
  await expect(page.locator("canvas")).toBeVisible();
  // No horizontal overflow on the player shell
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await ctx.close();
});

test("PWA manifest is served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  expect((await res.json()).name).toBe("Keyspilli");
});
