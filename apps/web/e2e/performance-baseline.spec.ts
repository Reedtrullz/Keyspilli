import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// ponytail: three local Chromium samples; establish device budgets only after owner-device baselines.
const measures = 160;
const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: measures }, (_, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${['C','D','E','G'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure>`).join('')}</part></score-partwise>`;

test("record local library, upload, playback, sheet/PDF and retained-page baselines", async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const samples: Record<string, unknown>[] = [];
  const headers = { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" };
  const uploadStart = performance.now();
  const created = await request.post("/api/uploads?title=Performance%20Fixture&artist=Authored", { headers, data: Buffer.from(xml) });
  expect(created.ok(), await created.text()).toBe(true);
  const uploadMs = performance.now() - uploadStart;
  const receipt = await created.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  try {
    for (let sample = 0; sample < 3; sample++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "both" }));
        const state = window as unknown as { __longTasks: number[]; __firstScheduledNote?: number };
        state.__longTasks = [];
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          new PerformanceObserver(list => state.__longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: "longtask", buffered: true });
        }
        const original = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (when?: number) { state.__firstScheduledNote ??= performance.now(); return original.call(this, when); };
      });
      const library: number[] = [];
      for (const cache of ["cold", "warm"]) {
        const start = performance.now(); await page.goto("/");
        await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
        library.push(performance.now() - start);
      }
      await page.goto(`/player/${id}/beginner`);
      const noteStart = await page.evaluate(() => performance.now());
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __firstScheduledNote?: number }).__firstScheduledNote ?? 0)).toBeGreaterThan(0);
      const firstScheduledNoteMs = await page.evaluate(start => (window as unknown as { __firstScheduledNote: number }).__firstScheduledNote - start, noteStart);
      const sheet: number[] = [];
      for (let visit = 0; visit < 2; visit++) {
        if (visit) await page.goto("/");
        const start = performance.now(); await page.goto(`/player/${id}/sheet`);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __sheetReady?: boolean }).__sheetReady)).toBe(true);
        sheet.push(performance.now() - start);
      }
      const count = await page.evaluate(() => (window as unknown as { __sheetPageCount: number }).__sheetPageCount);
      expect(count).toBeGreaterThan(5);
      const retention: Record<string, unknown>[] = [];
      for (const number of [...Array.from({ length: count }, (_, i) => i + 1), 1, count, 1]) {
        const start = performance.now();
        const group = page.getByRole("group", { name: `Sheet music page ${number} of ${count}`, exact: true });
        await group.scrollIntoViewIfNeeded(); await expect(group.locator(":scope > svg")).toBeVisible();
        retention.push(await page.evaluate(({ number, elapsed }) => {
          const state = window as unknown as { __sheetRenderedPages: number; __sheetRetainedSvgBytes: number; __sheetFallbackSvgBytes: number; __sheetRenderer: string };
          return { page: number, renderMs: elapsed, pages: state.__sheetRenderedPages, estimatedStringBytes: state.__sheetRetainedSvgBytes, fallbackBytes: state.__sheetFallbackSvgBytes, renderer: state.__sheetRenderer };
        }, { number, elapsed: performance.now() - start }));
      }
      const pdfStart = performance.now();
      const pdf = await request.get(`/api/song/${id}/export?type=pdf&layout=classic&revision=${receipt.publicationRevision}`);
      expect(pdf.ok(), await pdf.text()).toBe(true); const pdfMs = performance.now() - pdfStart;
      const runtime = await page.evaluate(() => {
        const state = window as unknown as { __longTasks: number[] };
        return { userAgent: navigator.userAgent, longTasksMs: state.__longTasks, heapBytes: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null };
      });
      samples.push({ sample, libraryMs: library, uploadMs: sample === 0 ? uploadMs : null, firstScheduledNoteMs, sheetMs: sheet, pdfMs, retention, ...runtime });
      await context.close();
    }
    const receiptData = { schemaVersion: 1, engravingVersion: "6.3.0", runtime: process.version, browser: browser.version(), viewport: { width: 1280, height: 800 }, fixture: { sha256: createHash("sha256").update(xml).digest("hex"), notes: measures * 4, measures }, sampleCount: samples.length, samples, limitations: ["Local Chromium; audio scheduled, not speaker latency", "String bytes and Chromium heap estimate exclude WASM/native memory", "No device or production budget adopted", "Bounded 640-note fixture; maximum-source stress run remains separate"] };
    const output = info.outputPath("performance-baseline.json");
    await writeFile(output, JSON.stringify(receiptData, null, 2));
    await info.attach("performance-baseline.json", { path: output, contentType: "application/json" });
  } finally { expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers })).ok()).toBe(true); }
});
