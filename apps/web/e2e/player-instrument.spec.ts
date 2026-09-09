import { expect, test } from "@playwright/test";
import { keyboardRects } from "@keyspilli/player-core";
import { openPlayerTool } from "./player-tools";
let pageErrors: string[] = [];
test.afterEach(() => expect(pageErrors).toEqual([]));
const song = "/player/f-f-chopin-nocturne-m";

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("keyspilli.tempo-semantics.v1", "true");
    if (!localStorage.getItem("keyspilli.prefs.v1")) localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", showAllKeys: true }));
  });
});

for (const width of [1440, 1024, 390]) {
  test(`tools preserve stage geometry and restore focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(song);
    const notice = page.getByRole("button", { name: "Got it", exact: true });
    if (await notice.isVisible()) await notice.click();
    const canvas = page.getByLabel("Falling notes player");
    await expect(canvas).toBeVisible();
    await canvas.screenshot();
    const before = (await canvas.boundingBox())!;
    for (const name of ["Display", "Sound", "Input"] as const) {
      await openPlayerTool(page, name);
      const panel = page.locator("#player-tool-panel");
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      const after = (await canvas.boundingBox())!;
      for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
      if (width === 390) {
        await expect(panel).toHaveAttribute("aria-modal", "true");
        await panel.getByRole("button", { name: "Close tools" }).focus();
        await page.keyboard.press("Tab");
        expect(await panel.evaluate(node => node.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(width < 1100 ? page.getByRole("button", { name: "Tools", exact: true }) : page.locator(".player-tool-triggers").getByRole("button", { name, exact: true })).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("display preferences persist; octave is session-only; MIDI requests are explicit", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { midiRequests: 0 });
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => {
      (window as unknown as { midiRequests: number }).midiRequests++;
      throw new Error("denied");
    } });
  });
  await page.goto(song);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { midiRequests: number }).midiRequests)).toBe(0);
  await openPlayerTool(page, "Display");
  await page.getByLabel("Key labels", { exact: true }).selectOption("octaves");
  await page.getByLabel("Stage appearance", { exact: true }).selectOption("charcoal");
  await page.getByLabel("Computer-key hints", { exact: true }).check();
  await openPlayerTool(page, "Input");
  await page.getByRole("button", { name: "Raise input octave" }).click();
  await expect(page.getByLabel("Computer key mapping")).toContainText("A · C5");
  await page.getByRole("button", { name: "Connect MIDI" }).click();
  await expect(page.locator("#player-tool-panel")).toContainText("No MIDI keyboard available");
  expect(await page.evaluate(() => (window as unknown as { midiRequests: number }).midiRequests)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".piano-input-status")).toContainText("C5–E6");
  await page.reload();
  await expect(page.locator(".piano-input-status")).toContainText("C4–E5");
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("Key labels", { exact: true })).toHaveValue("octaves");
  await expect(page.getByLabel("Stage appearance", { exact: true })).toHaveValue("charcoal");
  await expect(page.getByLabel("Computer-key hints", { exact: true })).toBeChecked();
});

test("mouse and computer keys share notes, drag to black keys, and release outside", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(song);
  const piano = page.getByRole("button", { name: "Piano keyboard", exact: true });
  await expect(piano).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.getByLabel("Falling notes player").screenshot();
  const box = (await piano.boundingBox())!;
  const keys = keyboardRects({ width: box.width, whiteHeight: box.height, lowMidi: 21, highMidi: 108 });
  const c = keys.whites.find(key => key.midi === 60)!;
  const sharp = keys.blacks.find(key => key.midi === 61)!;
  const canvas = page.getByLabel("Falling notes player");
  const baseline = await canvas.screenshot();
  await page.keyboard.down("a");
  const pressed = await canvas.screenshot();
  expect(pressed.equals(baseline)).toBe(false);
  await page.mouse.move(box.x + c.x + c.w / 2, box.y + box.height - 8);
  await page.mouse.down();
  await page.keyboard.up("a");
  expect((await canvas.screenshot()).equals(pressed)).toBe(true);
  await page.mouse.move(box.x + sharp.x + sharp.w / 2, box.y + 8);
  expect((await canvas.screenshot()).equals(pressed)).toBe(false);
  await page.mouse.move(box.x - 20, box.y - 20);
  await expect.poll(async () => (await canvas.screenshot()).equals(baseline)).toBe(true);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await piano.focus();
  const focused = await canvas.screenshot();
  await page.keyboard.down("Enter");
  expect((await canvas.screenshot()).equals(focused)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(async () => (await canvas.screenshot()).equals(focused)).toBe(true);
  await page.keyboard.up("Enter");
});

test("two touch contacts release independently and touch cancellation clears notes", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 600 });
  await page.goto(song);
  const piano = page.getByRole("button", { name: "Piano keyboard", exact: true });
  await page.getByLabel("Falling notes player").screenshot();
  await piano.scrollIntoViewIfNeeded();
  const box = (await piano.boundingBox())!;
  const canvas = page.getByLabel("Falling notes player");
  const keys = keyboardRects({ width: box.width, whiteHeight: box.height, lowMidi: 21, highMidi: 108 });
  const point = (midi: number, id: number) => { const key = keys.whites.find(key => key.midi === midi)!; return { x: box.x + key.x + key.w / 2, y: box.y + box.height - 8, id }; };
  const client = await page.context().newCDPSession(page);
  const baseline = await canvas.screenshot();
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(60, 1), point(64, 2)] });
  const both = await canvas.screenshot();
  expect(both.equals(baseline)).toBe(false);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [point(64, 2)] });
  const one = await canvas.screenshot();
  expect(one.equals(both)).toBe(false);
  expect(one.equals(baseline)).toBe(false);
  await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect.poll(async () => (await canvas.screenshot()).equals(baseline)).toBe(true);
});

test("bar progress follows seeking and speed; count-in uses the existing countdown", async ({ page }) => {
  await page.goto(song);
  const progress = page.locator(".piano-input-status progress");
  await expect(progress).toHaveAttribute("aria-label", "Bar 1 progress");
  const bar = page.getByRole("spinbutton", { name: "Bar", exact: true });
  await bar.fill("3"); await bar.press("Enter");
  await expect(progress).toHaveAttribute("aria-label", "Bar 3 progress");
  const value = await progress.evaluate((node: HTMLProgressElement) => node.value);
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await expect.poll(() => progress.evaluate((node: HTMLProgressElement) => node.value)).toBeCloseTo(value, 5);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Count-in", { exact: true }).selectOption("4");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.locator(".piano-input-status")).toContainText("Count in:");
  await expect(page.getByRole("button", { name: "Piano keyboard", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("desktop tools keep their exit visible at 200 percent zoom", async ({ page }) => {
  await page.goto(song);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  await openPlayerTool(page, "Display");
  const panel = page.locator("#player-tool-panel");
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await panel.getByRole("button", { name: "Close tools" }).click();
  await expect(panel).toHaveCount(0);
});
