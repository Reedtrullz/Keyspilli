import { type Page } from "@playwright/test";
export async function openPlayerTool(page: Page, name: "Display" | "Sound" | "Input") {
  const panel = page.locator("#player-tool-panel");
  if (await panel.isVisible()) { await panel.getByRole("button", { name, exact: true }).click(); return; }
  await page.getByRole("button", { name: "Tools", exact: true })
    .or(page.locator(".player-tool-triggers").getByRole("button", { name, exact: true }))
    .filter({ visible: true }).click();
  await panel.getByRole("button", { name, exact: true }).click();
}

export async function openAdvancedArrangementControls(page: Page): Promise<void> {
  const disclosure = page.getByTestId("advanced-arrangement-controls");
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").click();
}
