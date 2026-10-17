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
  const songLinks = page.locator('.library-results a[href^="/player/"]').filter({ hasText: /^roadmap-\d{3}$/ });
  let previousFirst: string | null = null;
  for (let number = 1; number <= 5; number++) {
    // "60 of 250 songs" reads the same on pages 1-4, so it cannot prove the
    // next page has rendered. Wait for state that is unique to this page:
    // the page indicator and URL, a settled (non-busy) list, and a first
    // song that differs from the previous page's first song.
    await expect(page.getByText(`Page ${number} of 5`, { exact: true })).toBeVisible();
    if (number > 1) await expect(page).toHaveURL(new RegExp(`[?&]page=${number}(?:&|$)`));
    await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("status")).toHaveText(`${number === 5 ? 10 : 60} of 250 songs`);
    if (previousFirst !== null) await expect(songLinks.first()).not.toHaveText(previousFirst);
    const pageNames = await songLinks.allTextContents();
    expect(pageNames).toHaveLength(number === 5 ? 10 : 60);
    previousFirst = pageNames[0] ?? null;
    names.push(...pageNames);
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
