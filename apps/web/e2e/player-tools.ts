import { type Page } from "@playwright/test";
export async function openPlayerTool(page: Page, name: "Display" | "Sound" | "Input") {
  const panel = page.locator("#player-tool-panel");
  if (await panel.isVisible()) { await panel.getByRole("button", { name, exact: true }).click(); return; }
  const compact = page.getByRole("button", { name: "Tools", exact: true });
  if (await compact.isVisible()) {
    await compact.click();
    await panel.getByRole("button", { name, exact: true }).click();
  } else await page.locator(".player-tool-triggers").getByRole("button", { name, exact: true }).click();
}
