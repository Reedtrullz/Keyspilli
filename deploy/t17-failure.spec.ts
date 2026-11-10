import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { perfViewport } from "./perf-viewport";

const viewport = perfViewport(process.env.KEYSPILLI_PERF_VIEWPORT);
const stress = process.env.KEYSPILLI_PERF_STRESS === "1" || process.env.KEYSPILLI_PERF_STRESS === "span";

function scoreXml(shape: "small" | "span" | "stress"): string {
  const spec = shape === "small" ? { measures: 160, notes: 4, beats: 4 } : shape === "span" ? { measures: 2048, notes: 2, beats: 2 } : { measures: 500, notes: 40, beats: 5 };
  return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: spec.measures }, (_, index) => {
    const attributes = index === 0 ? `<attributes><divisions>${shape === "small" ? 1 : 2}</divisions><time><beats>${spec.beats}</beats><beat-type>4</beat-type></time></attributes>` : "";
    const notes = shape === "small"
      ? ["C", "D", "E", "G"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")
      : Array.from({ length: shape === "span" ? 1 : 10 }, () => (shape === "span" ? ["C", "E"] : ["C", "E", "G", "C"]).map((step, pitch) => `<note>${pitch ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${pitch === 3 ? 5 : 4}</octave></pitch><duration>${shape === "span" ? 4 : 1}</duration><type>${shape === "span" ? "half" : "eighth"}</type></note>`).join("")).join("");
    return `<measure number="${index + 1}">${attributes}${notes}</measure>`;
  }).join("")}</part></score-partwise>`;
}

async function install(browser: import("@playwright/test").Browser, renderer: "worker" | "main") {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(forced => {
    localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "both" }));
    if (forced === "main") {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
      Object.defineProperty(window, "Worker", { configurable: true, value: class { constructor() { throw new Error("Controlled worker unavailability"); } } });
    }
  }, renderer);
  return { context, page, errors };
}

async function choose(page: import("@playwright/test").Page, current: string, next: RegExp): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^View\\s*${current}$`) }).click();
  await page.getByRole("menuitemradio", { name: next }).click();
}

async function waitSheet(page: import("@playwright/test").Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const state = window as unknown as { __sheetReady?: boolean; __sheetError?: string };
    if (state.__sheetError) throw new Error(state.__sheetError);
    return state.__sheetReady;
  }), { timeout: stress ? 40_000 : 8_000 }).toBe(true);
}

test("Task 17 malformed input, cancellation, switching and disposal stay bounded", async ({ browser, request }, info) => {
  test.setTimeout(stress ? 600_000 : 180_000);
  const shape = (process.env.KEYSPILLI_T17_SHAPE ?? "small") as "small" | "span" | "stress";
  const headers = { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" };
  const malformed = await request.post("/api/uploads?title=Malformed&artist=Task17", { headers, data: Buffer.from("<score-partwise>") });
  expect(malformed.ok()).toBe(false);
  const oversized = await request.post("/api/uploads?title=Oversized&artist=Task17", { headers, data: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41) });
  expect([400, 413]).toContain(oversized.status());
  const xml = scoreXml(shape);
  const created = await request.post("/api/uploads?title=Performance%20Failure%20Fixture&artist=Authored", { headers, data: Buffer.from(xml) });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json();
  const id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  const scenarios: Record<string, unknown>[] = [];
  try {
    {
      const { context, page, errors } = await install(browser, "worker");
      let delay = true;
      await page.route(`**/api/v1/sheet/${id}*`, async route => {
        if (delay) { delay = false; await new Promise(resolve => setTimeout(resolve, 750)); }
        await route.continue();
      });
      await page.goto(`/player/${id}/beginner`);
      await expect(page.getByRole("button", { name: /^View\s*Note letters$/ })).toBeVisible();
      await choose(page, "Note letters", /Sheet Music/);
      await expect(page.getByRole("button", { name: /^View\s*Sheet Music$/ })).toBeVisible();
      await choose(page, "Sheet Music", /Note letters/);
      await expect(page.getByLabel("Note letters view")).toBeVisible();
      await page.waitForTimeout(900);
      expect(await page.locator(".sheet-svg").count()).toBe(0);
      expect(errors).toEqual([]);
      scenarios.push({ name: "cancellation-and-stale-navigation", status: "passed" });
      await context.close();
    }
    {
      const { context, page, errors } = await install(browser, "worker");
      await page.goto(`/player/${id}/beginner`);
      await expect(page.getByRole("button", { name: /^View\s*Note letters$/ })).toBeVisible();
      const observations: unknown[] = [];
      for (let index = 0; index < 4; index++) {
        await choose(page, index ? "Note letters" : "Note letters", /Sheet Music/);
        await waitSheet(page);
        observations.push(await page.evaluate(() => {
          const state = window as unknown as { __sheetRenderedPages: number; __sheetRetainedSvgBytes: number; __sheetRenderer: string };
          return { pages: state.__sheetRenderedPages, bytes: state.__sheetRetainedSvgBytes, renderer: state.__sheetRenderer };
        }));
        await choose(page, "Sheet Music", /Note letters/);
        await expect(page.getByLabel("Note letters view")).toBeVisible();
      }
      expect(observations).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ renderer: "worker" })));
      expect((observations as { pages: number; bytes: number }[]).every(row => row.pages <= 5 && row.bytes <= 4 * 1024 * 1024)).toBe(true);
      await choose(page, "Note letters", /Sheet Music/);
      await waitSheet(page);
      await choose(page, "Sheet Music", /Note letters/);
      await expect(page.locator(".sheet-svg")).toHaveCount(0);
      expect(errors).toEqual([]);
      scenarios.push({ name: "repeated-mode-switching-and-disposal", observations, status: "passed" });
      await context.close();
    }
    {
      const { context, page, errors } = await install(browser, "main");
      await page.goto(`/player/${id}/sheet`);
      await waitSheet(page);
      expect(await page.evaluate(() => (window as unknown as { __sheetRenderer: string }).__sheetRenderer)).toBe("main");
      expect(errors).toEqual([]);
      scenarios.push({ name: "worker-failure-main-fallback", status: "passed" });
      await context.close();
    }
    for (const [name, body] of [["malformed-score", "not-musicxml"], ["oversized-score", "x".repeat(4 * 1024 * 1024 + 1)]] as const) {
      const { context, page, errors } = await install(browser, "worker");
      await page.route(`**/api/v1/sheet/${id}*`, route => route.fulfill({ status: 200, contentType: "application/vnd.recordare.musicxml+xml", body }));
      await page.goto(`/player/${id}/sheet`);
      await expect(page.locator(".sheet-svg__error")).toContainText("Unable to engrave this score");
      expect(await page.evaluate(() => (window as unknown as { __sheetReady: boolean }).__sheetReady)).toBe(false);
      expect(errors).toEqual([]);
      scenarios.push({ name, status: "passed" });
      await context.close();
    }
    const result = { schema: "keyspilli-task17-failure/v1", shape, viewport, fixtureSha256: createHash("sha256").update(xml).digest("hex"), scenarios };
    const output = info.outputPath("t17-failure.json");
    await writeFile(output, JSON.stringify(result, null, 2) + "\n");
    await info.attach("t17-failure.json", { path: output, contentType: "application/json" });
  } finally {
    expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers: { Authorization: "Bearer test-token-for-e2e" } })).ok()).toBe(true);
  }
});
