import { test, expect, type BrowserContext } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { perfViewport } from "./perf-viewport";
import { canonicalPdfSha256 } from "./t17-evidence.mjs";

const viewport = perfViewport(process.env.KEYSPILLI_PERF_VIEWPORT);
const span = process.env.KEYSPILLI_PERF_STRESS === "span";
const stress = process.env.KEYSPILLI_PERF_STRESS === "1" || span;
const measures = span ? 2048 : stress ? 500 : 160;
const notesPerMeasure = span ? 2 : stress ? 40 : 4;
const beatsPerMeasure = span ? 2 : stress ? 5 : 4;
const renderers = stress ? ["worker", "main"] as const : ["worker"] as const;
test.use({ trace: "off" });

function fixtureXml(): string {
  const measuresXml = Array.from({ length: measures }, (_, index) => {
    const attributes = index === 0 ? `<attributes><divisions>${stress ? 2 : 1}</divisions><time><beats>${beatsPerMeasure}</beats><beat-type>4</beat-type></time></attributes>` : "";
    const notes = stress
      ? Array.from({ length: span ? 1 : 10 }, () => (span ? ["C", "E"] : ["C", "E", "G", "C"]).map((step, pitch) => `<note>${pitch ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${pitch === 3 ? 5 : 4}</octave></pitch><duration>${span ? 4 : 1}</duration><type>${span ? "half" : "eighth"}</type></note>`).join("")).join("")
      : ["C", "D", "E", "G"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("");
    return `<measure number="${index + 1}">${attributes}${notes}</measure>`;
  }).join("");
  return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measuresXml}</part></score-partwise>`;
}

function sha(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function waitForSheetIdle(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window as unknown as { __workerPending?: number; __workerIdleSince?: number; __lastLongTaskAt?: number };
    const quietSince = Math.max(state.__workerIdleSince ?? 0, state.__lastLongTaskAt ?? 0);
    return (state.__workerPending ?? 0) === 0 && performance.now() - quietSince >= 1_500;
  }, undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) return;
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Verovio worker did not become idle"));
      }, 30_000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        channel.port1.close();
        resolve();
      };
      channel.port1.start();
      worker.postMessage({ id: 2_147_483_647, type: "warm" }, [channel.port2]);
    });
    const state = window as unknown as { __workerIdleSince?: number };
    state.__workerIdleSince = performance.now();
  });
  await page.waitForFunction(() => {
    const state = window as unknown as { __workerPending?: number; __workerIdleSince?: number; __lastLongTaskAt?: number };
    const quietSince = Math.max(state.__workerIdleSince ?? 0, state.__lastLongTaskAt ?? 0);
    return (state.__workerPending ?? 0) === 0 && performance.now() - quietSince >= 1_500;
  }, undefined, { timeout: 30_000 });
}

test("record local library, playback, sheet, PDF and retained-page baselines", async ({ browser, request }, info) => {
  test.setTimeout(stress ? 600_000 : 180_000);
  const xml = fixtureXml();
  const fixture = {
    sha256: sha(xml), notes: measures * notesPerMeasure, measures,
    beats: measures * beatsPerMeasure,
    gridNotePairs: measures * beatsPerMeasure * 4 * measures * notesPerMeasure,
  };
  const created = await request.post("/api/uploads?title=Performance%20Fixture&artist=Authored", {
    headers: { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" }, data: Buffer.from(xml),
  });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json();
  const id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  const samples: Record<string, unknown>[] = [];
  let trace: { context: BrowserContext; path: string } | null = null;
  try {
    for (const renderer of renderers) for (let sample = 0; sample < 3; sample++) {
      console.log(JSON.stringify({ phase: "context-start", renderer, sample }));
      const context = await browser.newContext({ viewport });
      console.log(JSON.stringify({ phase: "context-ready", renderer, sample }));
      if (process.env.KEYSPILLI_PERF_TRACE === "1" && renderer === "worker" && sample === 0) {
        const path = info.outputPath("t17-sizing.trace.zip");
        await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
        trace = { context, path };
      }
      const page = await context.newPage();
      const observedPaths: string[] = [];
      page.on("response", response => observedPaths.push(new URL(response.url()).pathname));
      const cdp = await context.newCDPSession(page);
      const requestPaths = new Map<string, string>();
      const transferred = new Map<string, number>();
      cdp.on("Network.responseReceived", event => requestPaths.set(event.requestId, new URL(event.response.url).pathname));
      cdp.on("Network.loadingFinished", event => {
        const path = requestPaths.get(event.requestId);
        if (path && (path.startsWith("/verovio/") || path.startsWith("/api/v1/sheet/") || path.includes("/export"))) {
          transferred.set(path, (transferred.get(path) ?? 0) + event.encodedDataLength);
        }
      });
      await cdp.send("Network.enable");
      await page.addInitScript(forced => {
        const state = window as unknown as Record<string, number | number[] | boolean | null>;
        state.__longTasks = [];
        state.__workerPending = 0;
        state.__workerIdleSince = performance.now();
        state.__lastLongTaskAt = 0;
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          new PerformanceObserver(list => {
            state.__lastLongTaskAt = performance.now();
            (state.__longTasks as number[]).push(...list.getEntries().map(entry => entry.duration));
          })
            .observe({ type: "longtask", buffered: true });
        }
        localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "both" }));
        window.addEventListener("click", event => {
          if (!event.isTrusted || state.__t17PlayClickAt !== undefined) return;
          const button = event.composedPath().find(target => target instanceof HTMLButtonElement);
          if (button instanceof HTMLButtonElement && (button.getAttribute("aria-label") ?? button.textContent?.trim()) === "Play") {
            state.__t17PlayClickAt = event.timeStamp;
          }
        }, true);
        const originalStart = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (when?: number) {
          if (typeof state.__t17PlayClickAt === "number") state.__firstScheduledNote ??= performance.now();
          return originalStart.call(this, when);
        };
        if (forced === "main") {
          Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
          Object.defineProperty(window, "Worker", { configurable: true, value: class { constructor() { throw new Error("Controlled worker unavailability"); } } });
          return;
        }
        if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("controllerchange", () => { state.__serviceWorkerControlled = Boolean(navigator.serviceWorker.controller); });
        const NativeWorker = window.Worker;
        const MeasuredWorker = new Proxy(NativeWorker, {
          construct(target, args: [string | URL, WorkerOptions?]) {
            const worker = Reflect.construct(target, args) as Worker;
            state.__workerCreatedAt = performance.now();
            worker.addEventListener("message", event => {
              if (typeof event.data?.id === "number") {
                state.__workerPending = Math.max(0, Number(state.__workerPending ?? 0) - 1);
                if (state.__workerPending === 0) state.__workerIdleSince = performance.now();
              }
              if (event.data?.type === "prepared") state.__workerPreparedAt = performance.now();
              if (event.data?.type === "page" && event.data.page === 1) state.__workerFirstPageAt = performance.now();
            });
            const postMessage = worker.postMessage.bind(worker);
            Object.defineProperty(worker, "postMessage", {
              configurable: true,
              value: (message: unknown, transfer?: Transferable[]) => {
                if (typeof (message as { id?: number } | undefined)?.id === "number") {
                  state.__workerPending = Number(state.__workerPending ?? 0) + 1;
                  state.__workerIdleSince = null;
                }
                if ((message as { type?: string } | undefined)?.type === "open") state.__workerOpenAt = performance.now();
                transfer ? postMessage(message, transfer) : postMessage(message);
              },
            });
            return worker;
          },
        });
        Object.defineProperty(window, "Worker", { configurable: true, value: MeasuredWorker });
      }, renderer);

      const takeLongTasks = () => page.evaluate(() => {
        const state = window as unknown as { __longTasks: number[] };
        const values = state.__longTasks.splice(0);
        return { count: values.length, durationMs: values.reduce((sum, value) => sum + value, 0) };
      });
      const library: number[] = [];
      for (const _cache of ["cold", "warm"]) {
        const start = performance.now();
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
        library.push(performance.now() - start);
      }

      const playerStart = performance.now();
      await page.goto(`/player/${id}/beginner`);
      await expect(page.getByRole("button", { name: /^View\s*Note letters$/ })).toBeVisible();
      const playerViewMs = performance.now() - playerStart;
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __firstScheduledNote?: number }).__firstScheduledNote ?? 0)).toBeGreaterThan(0);
      const firstScheduledNoteMs = await page.evaluate(() => {
        const { __t17PlayClickAt: click, __firstScheduledNote: note } = window as unknown as {
          __t17PlayClickAt?: number; __firstScheduledNote?: number;
        };
        if (click === undefined || note === undefined || !Number.isFinite(click) || !Number.isFinite(note) || click <= 0 || note < click) {
          throw new Error("missing or invalid Play click/oscillator timing");
        }
        return note - click;
      });
      const playerLongTasks = await takeLongTasks();

      const openSheet = async () => {
        const started = performance.now();
        await page.getByRole("button", { name: /^View\s*Note letters$/ }).click();
        await page.getByRole("menuitemradio", { name: /Sheet Music/ }).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __sheetReady?: boolean }).__sheetReady), { timeout: stress ? 40_000 : 5_000 }).toBe(true);
        return performance.now() - started;
      };
      const openLetters = async () => {
        await page.getByRole("button", { name: /^View\s*Sheet Music$/ }).click();
        await page.getByRole("menuitemradio", { name: /Note letters/ }).click();
        await expect(page.getByLabel("Note letters view")).toBeVisible();
      };
      const inPageFirstSheetMs = await openSheet();
      for (let warmup = 0; warmup < 2; warmup++) { await openLetters(); await openSheet(); }
      await openLetters();
      const inPageWarmSheetMs = await openSheet();
      const warmWorkerTiming = await page.evaluate(() => {
        const state = window as unknown as Record<string, number | undefined>;
        return { created: state.__workerCreatedAt ?? null, opened: state.__workerOpenAt ?? null, prepared: state.__workerPreparedAt ?? null, firstPage: state.__workerFirstPageAt ?? null };
      });
      const sheetLongTasks = await takeLongTasks();
      const pageCount = await page.evaluate(() => (window as unknown as { __sheetPageCount: number }).__sheetPageCount);
      expect(pageCount).toBeGreaterThan(5);

      let scoreXmlSha256: string | null = null;
      const sheet: number[] = [];
      for (let visit = 0; visit < 2; visit++) {
        if (visit) await page.goto("/");
        const started = performance.now();
        const [response] = await Promise.all([
          page.waitForResponse(candidate => new URL(candidate.url()).pathname === `/api/v1/sheet/${id}`),
          page.goto(`/player/${id}/sheet`),
        ]);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __sheetReady?: boolean }).__sheetReady), { timeout: stress ? 40_000 : 5_000 }).toBe(true);
        sheet.push(performance.now() - started);
        if (!scoreXmlSha256) scoreXmlSha256 = sha(await response.body());
      }
      const directLongTasks = await takeLongTasks();
      const count = await page.evaluate(() => (window as unknown as { __sheetPageCount: number }).__sheetPageCount);
      expect(count).toBeGreaterThan(5);

      const retention: Record<string, unknown>[] = [];
      for (const number of stress ? [1, Math.ceil(count / 2), count, 1, count, 1] : Array.from({ length: count }, (_, i) => i + 1).concat(1, count, 1)) {
        const started = performance.now();
        const group = page.getByRole("group", { name: `Sheet music page ${number} of ${count}`, exact: true });
        await group.scrollIntoViewIfNeeded();
        await expect(group.locator(":scope > svg")).toBeVisible();
        const current = await page.evaluate(({ number, elapsed }) => {
          const state = window as unknown as { __sheetRenderedPages: number; __sheetRetainedSvgBytes: number; __sheetFallbackSvgBytes: number; __sheetRenderer: string };
          return { page: number, renderMs: elapsed, pages: state.__sheetRenderedPages, estimatedStringBytes: state.__sheetRetainedSvgBytes, fallbackBytes: state.__sheetFallbackSvgBytes, renderer: state.__sheetRenderer };
        }, { number, elapsed: performance.now() - started });
        expect(current.renderer).toBe(renderer);
        expect(current.pages).toBeLessThanOrEqual(5);
        expect(current.estimatedStringBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
        expect(current.fallbackBytes).toBe(0);
        retention.push(current);
      }

      await waitForSheetIdle(page);
      const pdfStart = performance.now();
      const pdf = await request.get(`/api/song/${id}/export?type=pdf&layout=classic&revision=${receipt.publicationRevision}`);
      expect(pdf.ok()).toBe(true);
      const pdfBytes = await pdf.body();
      const pdfMs = performance.now() - pdfStart;
      const directWorkerTiming = await page.evaluate(async () => {
        const state = window as unknown as Record<string, number | boolean | string | undefined>;
        const registration = await navigator.serviceWorker?.getRegistration();
        return { created: state.__workerCreatedAt ?? null, opened: state.__workerOpenAt ?? null, prepared: state.__workerPreparedAt ?? null, firstPage: state.__workerFirstPageAt ?? null, renderer: state.__sheetRenderer ?? null, serviceWorkerActive: Boolean(registration?.active), serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller) };
      });
      const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => {
        const resource = entry as PerformanceResourceTiming;
        return { name: resource.name, initiatorType: resource.initiatorType, durationMs: resource.duration, transferSize: resource.transferSize, encodedBodySize: resource.encodedBodySize };
      }).filter(entry => entry.name.includes("/verovio/") || entry.name.includes("/api/v1/sheet/") || entry.name.includes("/export?")));
      await cdp.send("HeapProfiler.collectGarbage");
      const { usedSize: heapBytes } = await cdp.send("Runtime.getHeapUsage");
      expect(Number.isFinite(heapBytes) && heapBytes > 0).toBe(true);
      const memory = { heapBytes };
      expect(directWorkerTiming.renderer).toBe(renderer);
      if (renderer === "worker") expect(directWorkerTiming.opened !== null || directWorkerTiming.serviceWorkerActive).toBe(true);
      expect(observedPaths.includes("/verovio/verovio-module.mjs") || directWorkerTiming.serviceWorkerActive).toBe(true);
      samples.push({
        renderer, sample, libraryMs: library, playerViewMs, firstScheduledNoteMs,
        inPageFirstSheetMs, inPageWarmSheetMs, sheetMs: sheet, pdfMs, pageCount: count, retention,
        longTasks: { player: playerLongTasks, sheet: sheetLongTasks, direct: directLongTasks },
        workerTiming: { warm: warmWorkerTiming, direct: directWorkerTiming }, resources,
        memory, transferredBytes: Object.fromEntries(transferred), semantic: {
          scoreXmlSha256, pdfSha256: sha(pdfBytes), pdfCanonicalSha256: canonicalPdfSha256(pdfBytes), pdfBytes: pdfBytes.byteLength,
        },
      });
      console.log(JSON.stringify({ renderer, sample, sheetMs: sheet, inPageWarmSheetMs, pdfMs, retainedPages: Math.max(...retention.map(row => Number(row.pages))) }));
      if (trace?.context === context) {
        await trace.context.tracing.stop({ path: trace.path });
        trace = null;
      }
      console.log(JSON.stringify({ phase: "sample-complete", renderer, sample }));
      await context.close();
      console.log(JSON.stringify({ phase: "context-closed", renderer, sample }));
    }
    const output = info.outputPath(span ? "performance-span.json" : stress ? "performance-stress.json" : "performance-baseline.json");
    await writeFile(output, JSON.stringify({
      schemaVersion: 3, engravingVersion: "6.3.0", runtime: process.version, browser: browser.version(), viewport,
      fixture, sampleCount: samples.length, samples,
      limitations: ["Local Chromium; trusted Play click to first oscillator scheduling, not speaker latency", "Live page JavaScript heap after GC; excludes WASM/native memory and separate worker isolates", "No device or production budget adopted", "Browser timestamps are not CPU profiles"],
    }, null, 2));
    await info.attach(span ? "performance-span.json" : stress ? "performance-stress.json" : "performance-baseline.json", { path: output, contentType: "application/json" });
  } finally {
    if (trace) {
      await trace.context.tracing.stop({ path: trace.path }).catch(() => undefined);
      await trace.context.close().catch(() => undefined);
      trace = null;
    }
    expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers: { Authorization: "Bearer test-token-for-e2e" } })).ok()).toBe(true);
  }
});
