import { type Page } from "@playwright/test";
import { playbackMeasures, type SongData } from "@keyspilli/player-core";

export async function seekToBar(page: Page, bar: number | "last") {
  const id = new URL(page.url()).pathname.split("/")[2]!;
  const response = await page.request.get(`/api/songs/${id}`);
  if (!response.ok()) throw new Error("Could not load test arrangement measures");
  const { data } = await response.json() as { data: SongData };
  const measures = playbackMeasures(data);
  const index = bar === "last" ? measures.length - 1 : bar - 1;
  const context = await page.getByLabel("Practice key and tempo", { exact: true }).textContent();
  const bpm = Number(context?.match(/([\d.]+) practice BPM/)?.[1]);
  if (!measures[index] || !bpm) throw new Error("No measured test passage or effective tempo");
  await page.getByRole("slider", { name: "Seek", exact: true }).fill((Math.ceil(measures[index]!.startBeat * 60 / bpm * 100) / 100).toFixed(2));
  return index + 1;
}
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
