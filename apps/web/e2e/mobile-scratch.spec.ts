import { expect, test } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

test("synthetic mobile player keeps controls reachable and modal focus usable", async ({ page, request }) => {
  const response = await request.get("/api/songs?q=Scratch%20MusicXML&limit=20");
  const songs = (await response.json()).songs as Array<{ id: string; difficulty: string }>;
  const id = songs.find((song) => song.difficulty === "easy")?.id;
  expect(id).toBeTruthy();
  await page.goto(`/player/${id}`);
  await expect(page.getByRole("button", { name: "Piano keyboard", exact: true })).toBeVisible();
  await openPlayerTool(page, "Display");
  const display = page.getByRole("dialog", { name: "Display settings" });
  await display.getByRole("button", { name: "Transpose up" }).click();
  await expect(display.getByLabel("Transpose", { exact: true })).toContainText("(+1)");
  await display.getByRole("button", { name: "Close tools" }).click();
  await page.locator(".player-song-actions summary").click();
  await page.getByRole("button", { name: /Download sheet music and MIDI/ }).click();
  const download = page.getByRole("dialog", { name: "Download sheet music or MIDI" });
  await expect(download).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(download).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(428);
});
