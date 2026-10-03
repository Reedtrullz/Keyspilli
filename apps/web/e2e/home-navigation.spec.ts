import { expect, test, type Page } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
      const navigationEvents: boolean[] = [];
      (window as unknown as { navigationEvents: boolean[] }).navigationEvents = navigationEvents;
      window.addEventListener("keyspilli:navigation", event => navigationEvents.push((event as CustomEvent<boolean>).detail));
      const input = { id: "navigation-midi", name: "Navigation MIDI fixture", state: "connected", onmidimessage: null as ((event: { data: Uint8Array; timeStamp: number }) => void) | null };
      Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => ({ inputs: new Map([[input.id, input]]), onstatechange: null }) });
      (window as unknown as { sendNavigationMidi: (on: boolean) => void }).sendNavigationMidi = on => input.onmidimessage?.({ data: new Uint8Array([on ? 0x90 : 0x80, 60, on ? 80 : 0]), timeStamp: performance.now() });
      const active = new Set<AudioScheduledSourceNode>();
      Object.defineProperty(window, "activeAudioSources", { get: () => active.size });
      for (const type of [OscillatorNode, AudioBufferSourceNode]) {
        const start = type.prototype.start, stop = type.prototype.stop;
        Object.defineProperty(type.prototype, "start", { configurable: true, value: function(this: AudioScheduledSourceNode, ...args: number[]) {
          active.add(this); this.addEventListener("ended", () => active.delete(this), { once: true });
          return Reflect.apply(start, this, args);
        }});
        Object.defineProperty(type.prototype, "stop", { configurable: true, value: function(this: AudioScheduledSourceNode, when = 0) {
          if (when <= this.context.currentTime) active.delete(this);
          return Reflect.apply(stop, this, [when]);
        }});
      }
      const timing = { click: 0, feedback: 0 };
      (window as unknown as { navigationTiming: typeof timing }).navigationTiming = timing;
      document.addEventListener("click", event => {
        if ((event.target as Element)?.closest('a[href="/"]')) timing.click = performance.now();
      }, true);
      new MutationObserver(() => {
        if (timing.click && !timing.feedback && [...document.querySelectorAll('[role="status"]')].some(el => el.textContent?.includes("Opening Home"))) timing.feedback = performance.now();
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
});

async function holdHome(page: Page) {
  let release!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === "/" && url.searchParams.has("_rsc"), async route => {
    requests++; await pending; await route.continue();
  });
  return { release, requests: () => requests };
}
const sources = (page: Page) => page.evaluate(() => (window as unknown as { activeAudioSources: number }).activeAudioSources);

for (const [name, keyboard] of [["Home", false], ["Keyspilli", true], ["Return to library", false]] as const) {
  test(`${name} acknowledges a delayed Home route and releases playback from one activation`, async ({ page }) => {
    const hold = await holdHome(page);
    await page.goto("/player/ui-fixture-m");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByLabel("Playback status", { exact: true })).toContainText("Playing");
    await expect.poll(() => sources(page)).toBeGreaterThan(0);
    try {
      const link = page.getByRole("link", { name, exact: true }).first();
      if (keyboard) await link.press("Enter"); else await link.click();
      await expect(page.getByRole("status").filter({ hasText: "Opening Home" })).toBeVisible();
      const delay = await page.evaluate(() => {
        const timing = (window as unknown as { navigationTiming: { click: number; feedback: number } }).navigationTiming;
        return timing.feedback - timing.click;
      });
      expect(delay).toBeGreaterThanOrEqual(0); expect(delay).toBeLessThan(100);
      console.log(JSON.stringify({ exit: name, feedbackMs: Math.round(delay) }));
      await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
      await expect.poll(() => sources(page)).toBe(0);
      if (name === "Home") {
        await page.getByRole("button", { name: "Play", exact: true }).click();
        await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
        expect(await sources(page)).toBe(0);
        await openPlayerTool(page, "Sound");
        await page.getByRole("button", { name: "Preview sound", exact: true }).click();
        expect(await sources(page)).toBe(0);
        await page.getByRole("button", { name: "Close tools", exact: true }).click();
        await link.click(); await link.click();
        await expect.poll(hold.requests).toBe(1);
      }
      hold.release();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { name: "Explore your library", exact: true })).toBeVisible();
    } finally { hold.release(); }
  });
}


test("pending Home stops rhythm audio and tap capture", async ({ page }) => {
  const hold = await holdHome(page);
  try {
    await page.goto("/player/ui-fixture-m/beginner");
    const coach = page.getByLabel("Rhythm-only passage coach");
    await coach.locator("summary").click();
    await coach.getByLabel("Rhythm cues", { exact: true }).selectOption("quarter");
    await coach.getByRole("button", { name: "Start rhythm-only attempt" }).click();
    await expect(coach.getByRole("button", { name: "Stop rhythm attempt" })).toBeVisible();
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opening Home" })).toBeVisible();
    await expect(coach.getByLabel("Rhythm status")).toContainText("interrupted");
    await expect(coach.getByRole("button", { name: "Rhythm tap", exact: true })).toHaveCount(0);
    await expect.poll(() => sources(page)).toBe(0);
  } finally { hold.release(); }
});

test("pending Home cancels heard chords and blocks fresh MIDI, then restores input on cancelled navigation", async ({ page }) => {
  const hold = await holdHome(page);
  try {
    await page.goto("/player/ui-fixture-m");
    await openPlayerTool(page, "Input");
    await page.getByRole("button", { name: "Connect MIDI", exact: true }).click();
    await page.getByRole("button", { name: "Close tools", exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    await page.getByRole("dialog", { name: "Set up practice" }).getByRole("button", { name: "Chord practice", exact: true }).click();
    const chords = page.getByRole("region", { name: "Chord practice", exact: true });
    await chords.getByRole("button", { name: "Hear chord", exact: true }).click();
    await expect.poll(() => sources(page)).toBeGreaterThan(0);
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opening Home" })).toBeVisible();
    await expect(chords).toHaveCount(0);
    await expect.poll(() => sources(page)).toBe(0);
    await page.evaluate(() => (window as unknown as { sendNavigationMidi: (on: boolean) => void }).sendNavigationMidi(true));
    expect(await sources(page)).toBe(0);
    await page.evaluate(() => (window as unknown as { sendNavigationMidi: (on: boolean) => void }).sendNavigationMidi(false));
    await page.getByRole("link", { name: "Medium", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opening Home" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { navigationEvents: boolean[] }).navigationEvents.at(-1))).toBe(false);
    await page.evaluate(() => (window as unknown as { sendNavigationMidi: (on: boolean) => void }).sendNavigationMidi(true));
    await expect.poll(() => sources(page)).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as { sendNavigationMidi: (on: boolean) => void }).sendNavigationMidi(false));
    await expect.poll(() => sources(page)).toBe(0);
  } finally { hold.release(); }
});

for (const [level, ready] of [["e", false], ["a", true]] as const) {
  test(`Home releases Grand Piano while ${ready ? "ready on Advanced" : "loading on Easy"}`, async ({ page }) => {
    const home = await holdHome(page);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const wav = Buffer.alloc(44 + 960);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(960, 40);
    for (let i = 0; i < 480; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
    await page.route("https://smpldsnds.github.io/**", async route => { await pending; await route.fulfill({ contentType: "audio/wav", body: wav }); });
    try {
      await page.goto(`/player/ui-fixture-${level}`); await openPlayerTool(page, "Sound");
      await page.getByRole("radio", { name: "Grand Piano", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("loading");
      if (ready) { release(); await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("ready"); }
      await page.getByRole("button", { name: "Close tools", exact: true }).click();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => sources(page)).toBeGreaterThan(0);
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Opening Home" })).toBeVisible();
      await expect.poll(() => sources(page)).toBe(0);
      release();
      await openPlayerTool(page, "Sound");
      await expect(page.getByRole("status").filter({ hasText: "Samples:" })).toContainText("ready");
      expect(await sources(page)).toBe(0);
      await page.getByRole("button", { name: "Close tools", exact: true }).click();
      home.release(); await expect(page).toHaveURL("/");
    } finally { release(); home.release(); }
  });
}
