import { expect, test } from "@playwright/test";

test("sort alone keeps the empty-library action and URL filters reach the catalog", async ({ page }) => {
  await page.route("**/api/songs?**", route => route.fulfill({json:{songs:[],total:0}}));
  await page.goto("/songs?sort=title");
  await expect(page.getByText("Your library is empty.", {exact:true})).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", {name:"Add a song",exact:true})).toBeVisible();
  await page.unroute("**/api/songs?**");
  await page.goto("/songs?style=classical&mood=peaceful&category=Test");
  await expect(page.getByRole("status")).toHaveText("60 of 250 songs");
  const filtered = page.waitForRequest(request => new URL(request.url()).pathname === "/api/songs");
  await page.goto("/songs?style=rock&mood=peaceful&category=Test");
  const params = new URL((await filtered).url()).searchParams;
  expect(params.get("style")).toBe("rock");expect(params.get("mood")).toBe("peaceful");expect(params.get("category")).toBe("Test");
  await expect(page.getByText("No songs match these filters.", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Reset filters",exact:true}).click();
  await expect(page).toHaveURL("/songs");await expect(page.getByRole("status")).toHaveText("60 of 250 songs");
});

test("250 groups, off-page favorites, malformed storage and URL navigation stay coherent", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("keyspilli.favorites", JSON.stringify(["roadmap-249-easy", ...Array.from({ length: 600 }, (_, index) => `removed-${index}`)]));
    localStorage.setItem("keyspilli.learned", JSON.stringify({ malformed: true }));
  });
  await page.goto("/songs?sort=title&page=5");
  await expect(page.getByRole("status")).toHaveText("10 of 250 songs");
  await expect(page.getByRole("link", { name: "roadmap-249", exact: true })).toBeVisible();
  await page.getByLabel("Favorites only").check();
  await expect(page.getByRole("status")).toHaveText("1 of 1 songs");
  await expect(page.getByRole("link", { name: "roadmap-249", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/favorites=1/);
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("1 of 1 songs");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.getByRole("status")).toHaveText("60 of 250 songs");
  await page.goBack();
  await expect(page.getByLabel("Favorites only")).toBeChecked();
  await expect(page.getByRole("status")).toHaveText("1 of 1 songs");
  await page.getByLabel("Search songs").fill("no matches");
  await expect(page.getByText("No available songs match your favorites and filters.")).toBeVisible();
  await page.goto("/songs?sort=title");
  const names: string[] = [];
  for (let number = 1; number <= 5; number++) {
    await expect(page.getByRole("status")).toHaveText(`${number === 5 ? 10 : 60} of 250 songs`);
    names.push(...await page.locator('.library-results a[href^="/player/"]').filter({ hasText: /^roadmap-\d{3}$/ }).allTextContents());
    if (number < 5) await page.getByRole("button", { name: "Next page" }).click();
  }
  expect(names).toHaveLength(250);
  expect(new Set(names).size).toBe(250);
  await page.evaluate(() => localStorage.setItem("keyspilli.favorites", JSON.stringify({ malformed: true })));
  // addInitScript intentionally runs on reload, so remove it by using the storage event in this document.
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "keyspilli.favorites" })));
  await page.getByLabel("Favorites only").check();
  await expect(page.getByText(/You have no favorites yet/)).toBeVisible();
});
