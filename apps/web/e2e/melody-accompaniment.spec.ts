import { expect, test } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

const SONG_ID = "the-beatles-blackbird-a-scratch";
const SIDECAR_KEY = `keyspilli.melody-accompaniment.v1:${SONG_ID}`;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("keyspilli.tempo-semantics.v1", "true");
    if (!window.localStorage.getItem("keyspilli.prefs.v1")) {
      window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
    }
  });
});

test("real artifact produces, previews, plays, corrects, and reloads melody support", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  const canvas = page.getByLabel("Falling notes player");
  await expect(canvas).toBeVisible();
  const original = await canvas.screenshot({ path: testInfo.outputPath("melody-original-source.png") });

  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Chord mode", exact: true }).click();
  await expect(dialog.getByTestId("melody-accompaniment-controls")).toBeVisible();
  await expect(dialog.getByTestId("melody-accompaniment-coverage")).toContainText("generated");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  const automatic = await canvas.screenshot({ path: testInfo.outputPath("melody-automatic-candidate.png") });
  expect(automatic.equals(original)).toBe(false);

  await dialog.getByRole("radio", { name: "Use right-hand part", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("User melody");
  await expect(dialog.getByRole("button", { name: "Reset saved selection", exact: true })).toBeVisible();
  const corrected = await canvas.screenshot({ path: testInfo.outputPath("melody-user-corrected-candidate.png") });
  expect(corrected.equals(automatic)).toBe(false);

  const sidecar = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), SIDECAR_KEY) as {
    generatorVersion?: string;
    selection?: string;
    sourceFingerprint?: string;
    provenance?: { selectionProvenance?: string; generatedBeats?: number };
  } | null;
  expect(sidecar).toMatchObject({
    generatorVersion: "melody-accompaniment.v1",
    selection: "right-hand",
    provenance: { selectionProvenance: "user-confirmed" },
  });
  expect(sidecar?.sourceFingerprint).toContain("variant:the-beatles-blackbird:a:");
  expect(sidecar?.provenance?.generatedBeats).toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "Preview arrangement", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await page.reload();
  await expect(canvas).toBeVisible();
  await openPlayerTool(page, "Sound");
  const reloadedDialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(reloadedDialog.getByTestId("melody-accompaniment-controls")).toBeVisible();
  await expect(reloadedDialog.getByRole("radio", { name: "Use right-hand part", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("User melody");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("real artifact keeps arrangement controls usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();

  await openPlayerTool(page, "Sound");
  let dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Chord mode", exact: true }).click();
  await expect(dialog.getByTestId("melody-accompaniment-controls")).toBeVisible();
  await dialog.getByRole("radio", { name: "Use right-hand part", exact: true }).click();
  await dialog.getByRole("button", { name: "Preview arrangement", exact: true }).click();
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();

  const seek = page.getByLabel("Seek");
  await seek.fill("1");
  await expect(seek).toHaveValue("1");
  await page.getByRole("button", { name: "Left hand", exact: true }).click();
  await page.getByRole("button", { name: "Right hand", exact: true }).click();
  await page.getByRole("button", { name: "Both hands", exact: true }).click();
  await openPlayerTool(page, "Display");
  dialog = page.getByRole("dialog", { name: "Display settings" });
  await dialog.getByRole("button", { name: "Transpose up", exact: true }).click();
  await expect(dialog.getByText(/Key .* \(\+1\)/)).toBeVisible();
  await dialog.getByRole("button", { name: "Reset transpose", exact: true }).click();
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();

  await page.locator(".player-loop-controls summary").click();
  await page.getByRole("button", { name: "Loop current bar", exact: true }).click();
  await expect(page.getByLabel(/Loop range: bars/)).toBeVisible();
  await page.getByRole("button", { name: "Clear loop", exact: true }).click();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const practice = page.getByRole("dialog", { name: "Set up practice" });
  await expect(practice.getByRole("button", { name: "Start practice", exact: true })).toBeEnabled();
  await practice.getByRole("button", { name: "Chord practice", exact: true }).click();
  await expect(page.getByTestId("chord-practice-panel")).toBeVisible();
  await page.getByTestId("chord-practice-panel").getByRole("button", { name: "Close", exact: true }).click();

  await openPlayerTool(page, "Sound");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(dialog.getByRole("radio", { name: "Use right-hand part", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
