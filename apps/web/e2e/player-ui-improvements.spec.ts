import { expect, test } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

const song = "/player/ui-fixture-m";
const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: 80 }, (_, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ""}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join("")}</part></score-partwise>`;
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem("keyspilli.prefs.v1")) localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
  });
});

test("paused Grand Piano selection prepares one sample set and reuses it after a warm switch", async ({ page }) => {
  const wav = Buffer.alloc(44 + 960);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(960, 40);
  for (let i = 0; i < 480; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  let requests = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://smpldsnds.github.io/**", async route => {
    requests++; await pending;
    await route.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto(song); await openPlayerTool(page, "Sound");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  expect(requests).toBe(0); // A restored Synth choice must not preload the SSR default.
  try {
    await page.getByRole("radio", { name: "Grand Piano", exact: true }).click();
    await expect.poll(() => requests).toBe(226);
    await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("loading");
    await page.getByRole("radio", { name: "Synth Piano", exact: true }).click();
    await page.getByRole("radio", { name: "Grand Piano", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("loading");
    expect(requests).toBe(226);
    release();
    await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("ready");
    await expect(page.getByLabel("Playback status", { exact: true })).toContainText("Ready");
    await page.getByRole("radio", { name: "Synth Piano", exact: true }).click();
    await page.getByRole("radio", { name: "Grand Piano", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("ready");
    expect(requests).toBe(226);
  } finally { release(); }
});

test("Charcoal appearance is shared by player and app, persists and returns to Light", async ({ page }) => {
  await page.goto(song);
  await page.getByRole("button", { name: "Charcoal mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "charcoal");
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("App appearance", { exact: true })).toHaveValue("charcoal");
  await page.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.goto("/songs");
  await expect(page.getByRole("button", { name: "Charcoal mode", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(21, 24, 28)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "charcoal");
  await page.getByRole("button", { name: "Charcoal mode", exact: true }).click();
  await page.goto(song);
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("App appearance", { exact: true })).toHaveValue("light");
  await page.getByLabel("App appearance", { exact: true }).selectOption("charcoal");
  await expect(page.getByRole("button", { name: "Charcoal mode", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("loop editing stages both endpoints until Apply or Cancel", async ({ page }) => {
  await page.goto(song);
  await page.locator(".player-loop-controls summary").click();
  await page.getByRole("button", { name: "Loop next 4 bars", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Loop start bar" }).fill("8");
  await page.getByRole("spinbutton", { name: "Loop end bar" }).fill("10");
  await expect(page.locator(".player-loop-controls summary")).toContainText("Bars 1–4");
  await expect(page.getByRole("img", { name: "Draft loop range: bars 8–10" })).toBeVisible();
  await page.getByRole("button", { name: "Apply loop" }).click();
  await expect(page.locator(".player-loop-controls summary")).toContainText("Bars 8–10");
  await page.getByRole("spinbutton", { name: "Loop start bar" }).fill("12");
  await expect(page.getByRole("button", { name: "Apply loop" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel loop edits" }).click();
  await expect(page.getByRole("spinbutton", { name: "Loop start bar" })).toHaveValue("8");
});

test("preview can be stopped beside the stage after Tools closes", async ({ page }) => {
  await page.goto(song);
  await openPlayerTool(page, "Sound");
  await page.getByRole("button", { name: "Preview sound", exact: true }).click();
  await page.getByRole("button", { name: "Close tools" }).click();
  const status = page.getByLabel("Playback status", { exact: true });
  await expect(status).toContainText("Preview");
  await status.getByRole("button", { name: "Stop preview" }).click();
  await expect(status).toContainText("Stopped");
});

test("setup summary uses the submitted bars, hands, key and speed", async ({ page }) => {
  await page.goto(song);
  await openPlayerTool(page, "Display");
  await page.getByRole("button", { name: "Transpose up", exact: true }).click();
  await page.getByRole("button", { name: "Transpose up", exact: true }).click();
  await page.getByRole("button", { name: "Close tools" }).click();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Decrease speed", exact: true }).click();
  await page.getByRole("slider", { name: "Seek", exact: true }).fill("56");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Passage", { exact: true }).selectOption("bars");
  await expect(page.getByLabel("Practice setup summary")).toContainText("Bars 15–16");
  await expect(page.getByLabel("Practice setup summary")).toContainText("Playback D");
  await expect(page.getByLabel("Practice setup summary")).toContainText("60 practice BPM");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Seek", exact: true })).toHaveValue("56");
});

test("display tools expose only active-view controls and explicit hand recovery", async ({ page }) => {
  await page.goto(`${song}/leadsheet`);
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("Key labels", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Stage appearance", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close tools" }).click();
  await page.getByRole("button", { name: "Left hand", exact: true }).click();
  await expect(page.getByLabel("View selection notice")).toContainText("right-hand");
  await page.getByRole("button", { name: "Show both hands", exact: true }).click();
  await expect(page.getByLabel("View selection notice")).toHaveCount(0);
});

test("manual browsing stays put until Resume following", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${song}/beginner`);
  const scroller = page.getByRole("region", { name: "Notes in this bar, scroll horizontally" });
  await scroller.hover();
  await page.mouse.wheel(250, 0);
  await expect(page.getByRole("button", { name: "Resume following", exact: true })).toBeVisible();
  const left = await scroller.evaluate(el => el.scrollLeft);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(2300);
  expect(await scroller.evaluate(el => el.scrollLeft)).toBe(left);
  await expect(page.getByLabel("Note letters view")).toContainText("Bar 1 of");
  await page.getByRole("button", { name: "Resume following", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause following", exact: true })).toBeVisible();
});

test("sheet-only entry retains zoom and its reader position after failure, retry and controls load", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/v1/sheet/*", route => route.fulfill({ contentType: "application/xml", body: sheetXml }));
  await page.route(url => url.pathname === "/api/songs/ui-fixture-m", async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, body: "unavailable" });
    await route.continue();
  });
  await page.goto(`${song}/sheet`);
  await expect(page.getByLabel("Score zoom", { exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel("Score zoom", { exact: true }).selectOption("150");
  await page.getByRole("button", { name: "Load practice controls", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByLabel("Score zoom", { exact: true })).toHaveValue("150");
  const secondPage = page.locator('.sheet-svg [data-page="2"]');
  await secondPage.scrollIntoViewIfNeeded();
  await expect(page.locator(".sheet-svg")).toHaveAttribute("data-active-page", "2");
  const offset = await secondPage.evaluate(el => el.getBoundingClientRect().top);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await retry.evaluate(el => el.focus({ preventScroll: true }));
  await retry.press("Enter");
  await expect(page.getByRole("button", { name: "Practice", exact: true })).toBeVisible();
  await expect(page.getByLabel("Score zoom", { exact: true })).toHaveValue("150");
  await expect(page.getByRole("button", { name: "Practice", exact: true })).toBeFocused();
  await expect.poll(async () => Math.abs(await secondPage.evaluate(el => el.getBoundingClientRect().top) - offset)).toBeLessThan(5);
  expect(requests).toBe(2);
});

test("falling canvas renders notes and animates while playback advances", async ({ page }) => {
  await page.goto(song);
  const canvas = page.getByLabel("Falling notes player", { exact: true });
  await expect(canvas).toBeVisible();
  const pixels = () => canvas.evaluate((node: HTMLCanvasElement) => {
    const values = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
    let colored = 0, checksum = 0;
    for (let i = 0; i < values.length; i += 128) {
      if (values[i] !== values[i + 1] || values[i + 1] !== values[i + 2]) colored++;
      checksum = (checksum + values[i]! * (i + 1)) % 2147483647;
    }
    return { colored, checksum };
  });
  const initial = await pixels();
  expect(initial.colored).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await pixels()).checksum).not.toBe(initial.checksum);
});

test("tool panel stays inside the desktop viewport", async ({ page }) => {
  await page.goto(song);
  await page.getByRole("button", { name: "Tools", exact: true }).or(page.locator(".player-tool-triggers").getByRole("button", { name: "Display", exact: true })).filter({ visible: true }).click();
  const panel = page.getByRole("dialog", { name: "Display settings", exact: true });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  await page.screenshot({ path: "output/playwright/display-tools.png" });
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
});

test("lead annotations wrap without semantic text collisions at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${song}/leadsheet`);
  const region = page.getByRole("region", { name: "Lead sheet events", exact: true });
  await expect(region).toBeVisible();
  const boxes = await region.locator(".lead-pitch, .lead-lyric, .lead-chord").evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false);
  }
  await page.screenshot({ path: "output/playwright/lead-390.png" });
});

test("controls and dense lead annotations reflow at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of [song, `${song}/leadsheet`]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.evaluate(() => { document.body.style.zoom = "2"; });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Set up practice" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("reading window affects only Display and preserves transport and key range", async ({ page }) => {
  await page.goto(song);
  await expect(page.getByRole("button", { name: "Piano keyboard", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
  });
  const keyboard = await page.getByRole("button", { name: "Piano keyboard", exact: true }).boundingBox();
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("Reading window", { exact: true })).toHaveValue("3.2");
  await page.getByLabel("Reading window", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "Close tools" }).click();
  expect(await page.getByRole("button", { name: "Piano keyboard", exact: true }).boundingBox()).toEqual(keyboard);
  await expect(page.getByRole("slider", { name: "Seek", exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "View", exact: false }).click();
  await page.getByRole("menuitemradio", { name: /Note letters/ }).click();
  await openPlayerTool(page, "Display");
  await expect(page.getByLabel("Reading window", { exact: true })).toHaveCount(0);
});

for (const [width, height] of [[320, 640], [390, 844], [844, 390], [1024, 768], [1440, 900]] as const) {
  test(`player controls, lyrics and focus fit ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(song);
    await expect(page.locator("canvas").first()).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Bar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Previous|Next) measure$/ })).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Current and next chord", exact: true })).toHaveCount(0);
    await expect(page.locator(".chord-progression-details")).toHaveCount(0);
    await expect(page.getByLabel("Current lyrics")).toContainText("Simultaneous");
    await expect(page.getByRole("link", { name: "Return to library", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Practice", exact: true })).toBeVisible();
    if (width >= 900 || width === 844) {
      await expect.poll(async () => {
        const play = await page.getByRole("button", { name: "Play", exact: true }).boundingBox();
        const focus = await page.getByRole("button", { name: "Focus", exact: true }).boundingBox();
        return Math.abs(play!.y + play!.height / 2 - focus!.y - focus!.height / 2);
      }).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const navigation = await page.locator(".player-navigation").boundingBox();
    expect(navigation!.height).toBeLessThan(width > 640 ? 100 : 130);
    await page.screenshot({ path: `output/playwright/player-${width}x${height}.png` });
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Player UI fixture/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to library", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exit focus", exact: true })).toBeVisible();
    await page.screenshot({ path: `output/playwright/player-focus-${width}x${height}.png` });
  });
}
