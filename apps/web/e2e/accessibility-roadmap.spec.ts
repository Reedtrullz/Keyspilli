import { test, expect, type Page, type Locator } from "@playwright/test";
const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${['C','D','E','F','G','A','B','C'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`;
async function tabTo(page: Page, target: Locator, reverse = false) {
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
  }
  throw new Error("Target is unreachable by forward Tab");
}
test("learning views retain keyboard practice, text targets and dialogs at CSS 200% zoom", async ({ page, request }) => {
  test.setTimeout(120_000);
  const headers = { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" };
  const created = await request.post("/api/uploads?title=A%20long%20authored%20accessibility%20fixture%20with%20an%20unusually%20long%20title&artist=Author", { headers, data: Buffer.from(xml) });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  await page.setViewportSize({ width: 780, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.addInitScript(() => {
    localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "R" }));
    addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = "2"; });
  });
  try {
    for (const mode of ["falling", "beginner", "leadsheet", "sheet"]) {
      await page.goto(`/player/${id}/${mode}`);
      if (mode === "sheet") {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __sheetReady?: boolean }).__sheetReady)).toBe(true);
        const controls = page.getByRole("button", { name: "Load practice controls", exact: true });
        await tabTo(page, controls); await page.keyboard.press("Enter");
      }
      const practice = page.getByRole("button", { name: "Practice", exact: true });
      await expect(practice).toBeVisible(); await tabTo(page, practice); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Set up practice" });
      await expect(dialog).toBeVisible();
      await tabTo(page, dialog.getByLabel("Behavior")); await page.keyboard.press("w"); await page.keyboard.press("Tab"); await expect(dialog.getByLabel("Behavior")).toHaveValue("wait");
      await tabTo(page, dialog.getByLabel("Count-in", { exact: true })); await page.keyboard.press("Home");
      await tabTo(page, dialog.getByRole("button", { name: "Start practice", exact: true })); await page.keyboard.press("Enter");
      const grading = page.getByRole("region", { name: "Practice grading" });
      await expect(grading.getByRole("status")).toContainText("Play:");
      await expect(grading.getByRole("status")).toContainText("C4");
      await expect(page.locator(".player-stage")).toBeFocused();
      for (const [pitch, key] of [["C4","a"],["D4","s"],["E4","d"],["F4","f"],["G4","g"],["A4","h"],["B4","j"],["C4","a"]] as const) {
        await expect(grading.getByRole("status")).toContainText(pitch);
        await page.keyboard.press(key!);
      }
      await expect(grading.getByRole("status")).toContainText("100% onset accuracy");
      const download = page.getByRole("button", { name: "Download sheet music and MIDI" });
      await tabTo(page, download); await page.keyboard.press("Enter");
      const exportDialog = page.getByRole("dialog", { name: "Download sheet music or MIDI" });
      await expect(exportDialog).toBeVisible(); await page.keyboard.press("Escape");
      await expect(download).toBeFocused();
      const focused = await download.evaluate(element => { const style = getComputedStyle(element); return { outline: style.outlineStyle, shadow: style.boxShadow, rect: element.getBoundingClientRect().toJSON() }; });
      expect(focused.rect.width).toBeGreaterThan(0);
      expect(focused.outline !== "none" || focused.shadow !== "none").toBe(true);
      await infoSnapshot(page, mode);
    }
  } finally { expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers })).ok()).toBe(true); }
});
async function infoSnapshot(page: Page, mode: string) {
  await test.info().attach(`keyboard-${mode}.aria.txt`, { body: await page.locator("main").ariaSnapshot(), contentType: "text/plain" });
}
