import { openPlayerTool, seekToBar } from "./player-tools";
import { expect, test } from "@playwright/test";

const SONG = "f-f-chopin-nocturne-m";

// Pin e2e runs to the deterministic oscillator engine so sampled-piano CDN
// fetches do not stall headless playback assertions.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!window.localStorage.getItem("keyspilli.prefs.v1")) {
      window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
    }
  });
});

test("transport UI advances during playback without pause", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await expect(page.locator("canvas").first()).toBeVisible();

  const timer = page.getByRole("timer");
  const before = await timer.textContent();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await page.waitForTimeout(1500);
  const after = await timer.textContent();
  expect(after).not.toBe(before);

  const seekValue = Number(await page.getByRole("slider", { name: "Seek", exact: true }).inputValue());
  expect(seekValue).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("sections bar collapses, persists, and expands", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const nav = page.getByRole("navigation", { name: "Song sections" });
  await expect(nav).toBeVisible();

  const pillCount = await nav.locator("span").count();
  expect(pillCount).toBeGreaterThan(1);

  const toggle = nav.getByRole("button", { name: /Sections/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav.locator("span")).toHaveCount(1);

  await page.reload();
  const navAfterReload = page.getByRole("navigation", { name: "Song sections" });
  const toggleAfterReload = navAfterReload.getByRole("button", { name: /Sections/ });
  await expect(toggleAfterReload).toHaveAttribute("aria-expanded", "false");
  await expect(navAfterReload.locator("span")).toHaveCount(1);

  await toggleAfterReload.click();
  await expect(toggleAfterReload).toHaveAttribute("aria-expanded", "true");
  await expect(navAfterReload.locator("span")).toHaveCount(pillCount);
});

test("full width mode expands the player and persists across reload", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const root = page.locator("main > div").first();
  await expect(root).toBeVisible();

  await expect(root).toHaveClass(/max-w-6xl/);

  await openPlayerTool(page, "Display");
  await page.getByRole("button", { name: "Full width" }).click();
  await expect(root).toHaveClass(/w-full/);
  await expect(root).not.toHaveClass(/max-w-6xl/);

  await page.reload();
  const rootAfterReload = page.locator("main > div").first();
  // Saved preferences are applied after hydration; wait for the rendered state.
  await expect(rootAfterReload).toHaveClass(/w-full/);
  await expect(rootAfterReload).not.toHaveClass(/max-w-6xl/);
});

test("full width player fits the 390px mobile viewport without horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`/player/${SONG}`);
  await expect(page.locator("canvas").first()).toBeVisible();

  await openPlayerTool(page, "Display");
  await page.getByRole("button", { name: "Full width" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await ctx.close();
});

test("organ sound controls persist across reload", async ({ page }) => {
  await page.setViewportSize({ width: 428, height: 562 });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`/player/${SONG}`);
  await openPlayerTool(page, "Sound");

  await page.getByRole("radio", { name: "Organ" }).click();
  await expect(page.getByRole("radio", { name: "Organ" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Sustain pedal")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Rock", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Fast" }).click();
  await page.getByLabel("Organ drive").fill("67");
  await page.getByRole("radio", { name: "Cathedral", exact: true }).click();
  const registration = await page.getByRole("radiogroup", { name: "Cathedral registration" }).boundingBox();
  expect(registration!.x).toBeGreaterThanOrEqual(0);
  expect(registration!.x + registration!.width).toBeLessThanOrEqual(428);
  await expect(page.getByLabel("Organ drive")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Rotary" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Full", exact: true }).click();
  await page.getByLabel("Organ reverb").fill("78");
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.keyboard.press("a");

  await page.reload();
  await openPlayerTool(page, "Sound");
  await expect(page.getByRole("radio", { name: "Organ" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Cathedral", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Full", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Organ reverb")).toHaveValue("78");
  await page.getByRole("radio", { name: "Rock", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Fast" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Organ drive")).toHaveValue("67");
  await page.getByRole("radio", { name: "Cathedral", exact: true }).click();
  await expect(page.getByLabel("Organ reverb")).toHaveValue("78");
  expect(consoleErrors).toEqual([]);
});

test("switching sound modes preserves active transport", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(500);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  let previous = Number(await seek.inputValue());

  for (const sound of ["Organ", "Synth Piano", "Organ"]) {
    await openPlayerTool(page, "Sound");
    await page.getByRole("radio", { name: sound }).click();
    await page.getByRole("button", { name: "Close tools", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const current = Number(await seek.inputValue());
    expect(current).toBeGreaterThan(previous);
    previous = current;
  }
  expect(consoleErrors).toEqual([]);
});

test("switching Organ styles preserves active transport", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await openPlayerTool(page, "Sound");
  await page.getByRole("radio", { name: "Organ" }).click();
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(500);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  let previous = Number(await seek.inputValue());

  for (const style of ["Cathedral", "Rock", "Cathedral"]) {
    await openPlayerTool(page, "Sound");
    await page.getByRole("radio", { name: style, exact: true }).click();
    await page.getByRole("button", { name: "Close tools", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const current = Number(await seek.inputValue());
    expect(current).toBeGreaterThan(previous);
    previous = current;
  }
  await openPlayerTool(page, "Sound");
  await page.getByRole("radio", { name: "Warm", exact: true }).click();
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(Number(await seek.inputValue())).toBeGreaterThan(previous);
});

test("practice setup preserves the selected position", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto(`/player/${SONG}`);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.fill("20");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up practice" })).toBeVisible();
  await expect(seek).toHaveValue("20");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(seek).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("seek slider is keyboard operable without a separate bar jump", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.focus();
  await seek.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "Bar", exact: true })).toHaveCount(0);
  expect(Number(await page.getByRole("slider", { name: "Seek", exact: true }).inputValue())).toBeGreaterThan(0);
});


for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`focus keeps the keyboard visible at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/player/${SONG}`);
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    const canvas = page.getByLabel("Falling notes player");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const before = await canvas.getAttribute("height");
    await page.setViewportSize({ ...viewport, height: viewport.height + 120 });
    await expect(canvas).not.toHaveAttribute("height", before!);
  });
}

test("a scoped attempt retains its result and repeats the same passage", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.fill("20");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Behavior", { exact: true }).selectOption("wait");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(seek).toHaveValue("20");
  await expect(seek).toBeDisabled();
  await expect(page.getByRole("button", { name: "Increase speed" })).toBeDisabled();
  await page.getByRole("button", { name: "Finish practice", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Repeat passage", exact: true })).toBeVisible();
  await seek.fill("35");
  await page.getByRole("button", { name: "Repeat passage", exact: true }).click();
  await expect(seek).toHaveValue("20");
  await page.getByRole("button", { name: "Finish practice", exact: true }).first().click();
});

test("microphone stays opt-in and permission denial allows keyboard recovery", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    } });
  });
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Input", { exact: true }).selectOption("microphone");
  await expect(page.getByRole("button", { name: "Start practice", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Enable microphone", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up practice" }).getByRole("alert")).toContainText(/keyboard|permission/i);
  await page.getByLabel("Input", { exact: true }).selectOption("keyboard");
  await expect(page.getByRole("button", { name: "Start practice", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});


test("count-in cancellation cannot start a delayed attempt", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.fill("20");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Count-in", { exact: true }).selectOption("4");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await page.keyboard.press("a");
  await expect(seek).toHaveValue("20");
  await page.getByRole("button", { name: "Cancel count-in", exact: true }).click();
  await page.waitForTimeout(4200);
  await expect(seek).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Practice grading" })).toHaveCount(0);
});

test("loop bar bounds define a single scored passage", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.locator(".player-loop-controls summary").click();
  await page.getByLabel("Loop start bar", { exact: true }).fill("2");
  await page.getByLabel("Loop start bar", { exact: true }).press("Enter");
  await page.getByLabel("Loop end bar", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply loop", exact: true }).click();
  await expect(page.locator(".player-loop-controls summary")).toContainText("Bars 2–2");
  await page.getByLabel("Loop end bar", { exact: true }).fill("1");
  await page.getByLabel("Loop end bar", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Apply loop", exact: true })).toBeDisabled();
  await page.getByLabel("Loop end bar", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Apply loop", exact: true }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Passage", { exact: true }).selectOption("loop");
  await page.getByLabel("Behavior", { exact: true }).selectOption("wait");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Seek", exact: true })).toHaveAttribute("aria-valuetext", /^Bar 2 of /);
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Repeat passage" })).toBeVisible();
});

test("computer keys reach chord-practice targets", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const panel = page.getByTestId("chord-practice-panel");
  await expect(panel).toContainText("up to 4 bars");
  const before = await panel.getByRole("status").textContent();
  const target = (before!.split("Still needed: ")[1]!.split(" · ")[0]!);
  const keys: Record<string, string> = { C:"a", "C#":"w", D:"s", "D#":"e", E:"d", F:"f", "F#":"t", G:"g", "G#":"y", A:"h", "A#":"u", B:"j" };
  await page.keyboard.press(keys[target]!);
  await expect(panel.getByRole("status")).not.toHaveText(before!);
});

test("sound preview pauses without moving the song position", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  const seek = page.getByRole("slider", { name: "Seek", exact: true });
  await seek.fill("20");
  await openPlayerTool(page, "Sound");
  await page.getByRole("button", { name: "Preview sound" }).click();
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect(seek).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("practice remains keyboard accessible with reduced motion and 200% CSS zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/player/${SONG}`);
  await page.locator("body").evaluate((body) => { body.style.zoom = "2"; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const practice = page.getByRole("button", { name: "Practice", exact: true });
  await practice.press("Enter");
  const input = page.getByLabel("Input", { exact: true });
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  // Native dialogs may expose browser chrome at the tab boundary, but never the underlying player.
  await expect(practice).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Set up practice" })).toHaveCount(0);
  await expect(practice).toBeFocused();
});

for (const playing of [false, true]) {
  test(`speed preserves the musical position while ${playing ? "playing" : "paused"}`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.goto(`/player/${SONG}`);
    await expect(page.getByRole("slider", { name: "Seek", exact: true })).toBeEnabled();
    await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
    await page.getByRole("slider", { name: "Seek", exact: true }).fill("20");
    if (playing) await page.getByRole("button", { name: "Play", exact: true }).click();
    const seek = page.getByRole("slider", { name: "Seek", exact: true });
    const originalBar = (await seek.getAttribute("aria-valuetext"))!.match(/^Bar \d+ of \d+/)![0];
    for (const [label, speed] of [["50%", 0.5], ["75%", 0.75], ["100%", 1]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      if (playing) await page.clock.runFor(200);
      await expect(seek).toHaveAttribute("aria-valuetext", new RegExp(`^${originalBar}`));
      const musicalSeconds = Number(await page.getByRole("slider", { name: "Seek", exact: true }).inputValue()) * speed;
      expect(musicalSeconds).toBeGreaterThanOrEqual(19.99);
      expect(musicalSeconds).toBeLessThan(22);
      await expect(page.getByRole("button", { name: playing ? "Pause" : "Play", exact: true })).toBeVisible();
    }
  });
}

for (const width of [390, 1280]) {
  test(`note letters stays readable and follows inside the panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/player/f-f-chopin-nocturne-a/beginner');
    const panel = page.getByRole('region', { name: 'Notes in this bar, scroll horizontally' });
    await expect(panel).toBeVisible();
    const badges = panel.locator('[data-midi]');
    expect(await badges.count()).toBeGreaterThan(10);
    const layout = await badges.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, font: parseFloat(getComputedStyle(node).fontSize) };
    }));
    for (let i = 0; i < layout.length; i++) {
      expect(layout[i]!.font).toBeGreaterThanOrEqual(14);
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i]!, b = layout[j]!;
        expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('4');
    if (width === 390) await expect.poll(() => panel.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    const active = panel.locator('th[aria-current]');
    await expect(active).toHaveCount(1);
    const panelBox = await panel.boundingBox();
    const activeBox = await active.boundingBox();
    expect(activeBox!.x).toBeGreaterThanOrEqual(panelBox!.x + 70);
    expect(activeBox!.x + activeBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
    await page.getByRole('slider', { name: 'Seek', exact: true }).fill('0');
    await expect.poll(() => panel.evaluate((node) => node.scrollLeft)).toBe(0);
  });
}


test("loop shortcuts retain their musical range and respect the last bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/player/${SONG}`);
  await expect(page.getByRole("slider", { name: "Seek", exact: true })).toBeEnabled();
  await seekToBar(page, 3);
  await page.locator(".player-loop-controls summary").click();
  await page.getByRole("button", { name: "Loop current bar", exact: true }).click();
  await expect(page.getByLabel("Loop range: bars 3–3")).toBeVisible();
  const marker = page.getByLabel("Loop range: bars 3–3");
  const rangeStyle = await marker.getAttribute("style");
  await page.getByRole("combobox", { name: "Practice speed", exact: true }).selectOption("0.5");
  await expect(marker).toHaveAttribute("style", rangeStyle!);
  await page.getByRole("button", { name: "Loop next 4 bars", exact: true }).click();
  await expect(page.getByLabel("Loop range: bars 3–6")).toBeVisible();
  await page.getByRole("button", { name: "Clear loop", exact: true }).click();
  const max = await seekToBar(page, "last");
  await page.getByRole("button", { name: "Loop next 4 bars", exact: true }).click();
  await expect(page.getByLabel(`Loop range: bars ${max}–${max}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("slider", { name: "Seek", exact: true })).toHaveAttribute("aria-valuetext", new RegExp(`Bar ${max} of ${max}`));
});

test("chord guide explains its markers and preserves the existing preference", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await openPlayerTool(page, "Display");
  const guide = page.getByRole("button", { name: "Chord guide", exact: true });
  await expect(guide).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#chord-guide-description")).toContainText("not notes to press now");
  await guide.click();
  await expect(guide).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await openPlayerTool(page, "Display");
  await expect(guide).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#chord-guide-description")).toContainText("Colored strips at the top of keys show upcoming notes");
  await guide.click();
  await expect(guide).toHaveAttribute("aria-pressed", "true");
});

test("falling view omits the redundant chord sequence on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/player/${SONG}`);
  await expect(page.getByLabel("Falling notes player", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Chord sequence" })).toHaveCount(0);
  await expect(page.locator(".chord-progression-details")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1740, height: 1370 }]) {
  test(`normal player uses the viewport at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/player/${SONG}`);
    await page.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(page.locator(".player-tempo-notice")).toHaveCount(0);
    const canvas = page.getByLabel("Falling notes player");
    await expect(canvas).toBeVisible();
    const box = await page.locator(".falling-canvas").boundingBox();
    expect(box!.height).toBeGreaterThan(viewport.height * 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    const play = await page.getByRole("button", { name: "Play", exact: true }).boundingBox();
    const adjust = await page.locator(".player-tools").boundingBox();
    expect(Math.abs(play!.y - adjust!.y)).toBeLessThan(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Fit passage keeps keyboard labels fixed across bars and speed changes", async ({ page }) => {
  await page.addInitScript(() => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      this.canvas.dataset.keyboardLabels = "[]";
      return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (args[2] === this.canvas.clientHeight - 18) {
        const labels = JSON.parse(this.canvas.dataset.keyboardLabels ?? "[]");
        labels.push([args[0], args[1]]);
        this.canvas.dataset.keyboardLabels = JSON.stringify(labels);
      }
      return text.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await openPlayerTool(page, "Display");
  const allKeys = page.getByRole("button", { name: "88 keys", exact: true });
  if (await allKeys.isVisible()) await allKeys.click();
  await expect(page.getByRole("button", { name: "Fit passage", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close tools" }).click();
  const canvas = page.getByLabel("Falling notes player");
  // Compare rendered key names and positions; active-note colors may change on seek.
  const labels = async () => {
    await canvas.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return canvas.getAttribute("data-keyboard-labels");
  };
  await expect.poll(labels).toMatch(/^\[\[/);
  const before = await labels();
  for (const value of [4, "last"] as const) {
    await seekToBar(page, value);
    await expect.poll(labels).toBe(before);
  }
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Decrease speed", exact: true }).click();
  await expect.poll(labels).toBe(before);
});
