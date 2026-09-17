import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

const SONG_ID = "the-beatles-blackbird-a-scratch";
const OOPS_SONG_ID = "britney-spears-oops-i-did-it-again-a-scratch";
const HELL_SONG_ID = "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-a-scratch";
const SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${SONG_ID}`;
const OOPS_SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${OOPS_SONG_ID}`;
const HELL_SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${HELL_SONG_ID}`;

type AudioCapture = {
  mimeType: string;
  bytes: number;
  base64: string;
  signal: { rms: number; peak: number; samples: number };
  events: Array<{ type: string; frequency: number; midi: number | null; relativeWhen: number }>;
};

type AudioProbeWindow = Window & {
  __keyspilliAudioStart: () => Promise<void>;
  __keyspilliAudioStop: () => Promise<AudioCapture>;
};

type MelodyArrangementTrace = {
  phase: string;
  execution: string;
  noteCount: number;
  key?: string;
  error?: string;
};

type MelodyTraceWindow = Window & {
  __keyspilliMelodyArrangementTraceEvents: MelodyArrangementTrace[];
};

async function installMelodyTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as MelodyTraceWindow & {
      __keyspilliMelodyArrangementTrace: (event: MelodyArrangementTrace) => void;
    };
    target.__keyspilliMelodyArrangementTraceEvents = [];
    target.__keyspilliMelodyArrangementTrace = (event) => target.__keyspilliMelodyArrangementTraceEvents.push(event);
  });
}

async function installWorkerConstructorFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as Window & { __keyspilliOriginalWorker?: typeof Worker };
    target.__keyspilliOriginalWorker = window.Worker;
    const failure = function WorkerConstructorFailure(): never {
      throw new Error("e2e worker constructor failure");
    };
    Object.defineProperty(window, "Worker", { configurable: true, value: failure });
  });
}

async function restoreWorkerConstructor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as Window & { __keyspilliOriginalWorker?: typeof Worker };
    if (target.__keyspilliOriginalWorker) Object.defineProperty(window, "Worker", { configurable: true, value: target.__keyspilliOriginalWorker });
  });
}

async function installResumePolicyOverride(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (message && typeof message === "object" && "options" in message) {
        const request = message as { options?: Record<string, unknown> };
        if (request.options) {
          message = { ...request, options: { ...request.options, soundingPolicy: "resume" } };
        }
      }
      return Reflect.apply(originalPostMessage, this, [message, ...rest]);
    };
  });
}

async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Probe = { destination: MediaStreamAudioDestinationNode; events: Array<{ type: string; frequency: number; when: number }> };
    const contexts = new WeakMap<BaseAudioContext, Probe>();
    let current: AudioContext | null = null;
    let capture: { context: AudioContext; probe: Probe; startIndex: number; startTime: number; recorder: MediaRecorder; chunks: Blob[] } | null = null;
    const OriginalAudioContext = window.AudioContext;
    const OriginalConnect: Function = AudioNode.prototype.connect;
    const OriginalOscillatorStart: Function = OscillatorNode.prototype.start;

    (AudioNode.prototype as unknown as { connect: Function }).connect = function (destination: unknown, ...args: unknown[]) {
      const result = Reflect.apply(OriginalConnect, this, [destination, ...args]);
      const context = (this as AudioNode).context;
      const probe = contexts.get(context);
      if (probe && destination === context.destination) {
        try { Reflect.apply(OriginalConnect, this, [probe.destination]); } catch {}
      }
      return result;
    };
    (OscillatorNode.prototype as unknown as { start: Function }).start = function (when?: number) {
      const oscillator = this as OscillatorNode;
      const probe = contexts.get(oscillator.context);
      if (probe) probe.events.push({ type: oscillator.type, frequency: oscillator.frequency.value, when: when ?? oscillator.context.currentTime });
      return Reflect.apply(OriginalOscillatorStart, this, [when ?? 0]);
    };

    class ProbedAudioContext extends OriginalAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const probe = { destination: this.createMediaStreamDestination(), events: [] };
        contexts.set(this, probe);
        current = this;
      }
    }
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = ProbedAudioContext;
    const exposed = window as unknown as Partial<AudioProbeWindow>;
    exposed.__keyspilliAudioStart = async () => {
      if (!current) throw new Error("No Web Audio context exists; start playback before capturing");
      if (capture) throw new Error("Audio capture already running");
      const context = current;
      await context.resume();
      const probe = contexts.get(context);
      if (!probe) throw new Error("Web Audio probe was not installed");
      const recorder = new MediaRecorder(probe.destination.stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      capture = { context, probe, startIndex: probe.events.length, startTime: context.currentTime, recorder, chunks };
    };
    exposed.__keyspilliAudioStop = async () => {
      if (!capture) throw new Error("Audio capture is not running");
      const session = capture;
      capture = null;
      const blob = await new Promise<Blob>((resolve) => {
        session.recorder.addEventListener("stop", () => resolve(new Blob(session.chunks, { type: session.recorder.mimeType || "audio/webm" })), { once: true });
        session.recorder.stop();
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0));
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      let signal = { rms: 0, peak: 0, samples: 0 };
      try {
        const decoded = await session.context.decodeAudioData(buffer.slice(0));
        const samples = decoded.getChannelData(0);
        const step = Math.max(1, Math.ceil(samples.length / 250_000));
        let sum = 0;
        let peak = 0;
        let count = 0;
        for (let index = 0; index < samples.length; index += step) {
          const value = samples[index] ?? 0;
          sum += value * value;
          peak = Math.max(peak, Math.abs(value));
          count++;
        }
        signal = { rms: count ? Math.sqrt(sum / count) : 0, peak, samples: count };
      } catch {}
      const events = session.probe.events.slice(session.startIndex).map((event) => {
        const midi = 69 + 12 * Math.log2(event.frequency / 440);
        return { type: event.type, frequency: event.frequency, midi: Number.isFinite(midi) ? Math.round(midi) : null, relativeWhen: Number((event.when - session.startTime).toFixed(4)) };
      });
      return { mimeType: blob.type, bytes: blob.size, base64: btoa(binary), signal, events };
    };
  });
}

async function captureArrangement(page: Page, testInfo: { outputPath: (path: string) => string }, label: string, startSeconds: number, durationMs = 2_000): Promise<AudioCapture & { sha256: string }> {
  const seek = page.getByLabel("Seek");
  const seekValue = Number(startSeconds.toFixed(2));
  await seek.fill(String(seekValue));
  await expect(seek).toHaveValue(String(seekValue));
  await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStart());
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(durationMs);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const capture = await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStop());
  const audio = Buffer.from(capture.base64, "base64");
  saveCapture(testInfo, label, capture, audio);
  return { ...capture, sha256: createHash("sha256").update(audio).digest("hex") };
}

function saveCapture(testInfo: { outputPath: (path: string) => string }, label: string, capture: AudioCapture, audio = Buffer.from(capture.base64, "base64")): void {
  writeFileSync(testInfo.outputPath(`${label}.webm`), audio);
  writeFileSync(testInfo.outputPath(`${label}.json`), JSON.stringify({ ...capture, base64: undefined }, null, 2));
}

function audible(capture: AudioCapture & { sha256: string }): void {
  expect(capture.bytes).toBeGreaterThan(0);
  expect(capture.signal.samples).toBeGreaterThan(0);
  expect(capture.signal.peak).toBeGreaterThan(0.001);
  expect(capture.signal.rms).toBeGreaterThan(0.00001);
  expect(capture.events.filter((event) => event.type === "triangle")).not.toHaveLength(0);
}

function fundamentalMidis(capture: AudioCapture, endSeconds = Number.POSITIVE_INFINITY): number[] {
  return [...new Set(capture.events.filter((event) => event.type === "triangle" && event.midi !== null && event.relativeWhen < endSeconds).map((event) => event.midi as number))].sort((a, b) => a - b);
}

async function selectArrangement(
  page: Page,
  mode: "Original arrangement" | "Chord mode",
  melody?: "Automatic melody" | "Use right-hand part",
  options: { waitForArrangement?: boolean } = {},
): Promise<void> {
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: mode, exact: true }).click();
  if (melody) await dialog.getByRole("radio", { name: melody, exact: true }).click();
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  if (mode === "Chord mode" && options.waitForArrangement !== false) {
    await expect(page.getByTestId("melody-accompaniment-status")).toContainText(melody === "Use right-hand part" ? "User melody" : "Inferred melody");
  }
}

async function bootAudio(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
}

async function capturePreviewRole(
  page: Page,
  testInfo: { outputPath: (path: string) => string },
  dialog: Locator,
  role: "Full" | "Melody" | "Accompaniment",
  label: string,
): Promise<AudioCapture & { sha256: string }> {
  await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStart());
  await dialog.getByRole("button", { name: role, exact: true }).click();
  await page.waitForTimeout(2_200);
  const capture = await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStop());
  const audio = Buffer.from(capture.base64, "base64");
  saveCapture(testInfo, label, capture, audio);
  return { ...capture, sha256: createHash("sha256").update(audio).digest("hex") };
}

async function melodyTrace(page: Page): Promise<MelodyArrangementTrace[]> {
  return page.evaluate(() => (window as unknown as MelodyTraceWindow).__keyspilliMelodyArrangementTraceEvents);
}

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
  await expect(dialog.getByTestId("melody-accompaniment-coverage")).toContainText("source support");
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
    provenance?: { selectionProvenance?: string; sourceSupportNoteCount?: number; generatedNoteCount?: number };
  } | null;
  expect(sidecar).toMatchObject({
    generatorVersion: "melody-accompaniment.v2",
    selection: "right-hand",
    provenance: { selectionProvenance: "user-confirmed" },
  });
  expect(sidecar?.sourceFingerprint).toContain("variant:the-beatles-blackbird:a:");
  expect(sidecar?.provenance?.sourceSupportNoteCount).toBeGreaterThan(0);
  expect(sidecar?.provenance?.generatedNoteCount).toBeGreaterThan(0);

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
  await reloadedDialog.getByRole("button", { name: "Reset saved selection", exact: true }).click();
  await expect(reloadedDialog.getByRole("radio", { name: "Automatic melody", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate((key) => localStorage.getItem(key), SIDECAR_KEY)).toBeNull();
  await reloadedDialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await openPlayerTool(page, "Sound");
  const resetDialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(resetDialog.getByRole("radio", { name: "Automatic melody", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("browser trace keeps Original and large arrangements off the main-thread producer", async ({ page }) => {
  await installMelodyTrace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();

  let traces = await melodyTrace(page);
  expect(traces.some((event) => event.phase === "source-view" && event.execution === "source")).toBe(true);
  expect(traces.some((event) => event.phase === "sync-start")).toBe(false);

  await selectArrangement(page, "Chord mode", "Automatic melody");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  traces = await melodyTrace(page);
  expect(traces.some((event) => event.phase === "worker-request" && event.execution === "worker")).toBe(true);
  expect(traces.some((event) => event.phase === "worker-ready" && event.execution === "worker")).toBe(true);
  expect(traces.some((event) => event.phase === "sync-start")).toBe(false);
});

test("role audition renders three audible stems and preserves A/B position", async ({ page }, testInfo) => {
  await installAudioProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Chord mode", "Automatic melody");
  await bootAudio(page);

  const seek = page.getByLabel("Seek");
  await seek.fill("2");
  const positionBefore = await seek.inputValue();
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(dialog.getByTestId("melody-audition-controls")).toBeVisible();

  const full = await capturePreviewRole(page, testInfo, dialog, "Full", "blackbird-preview-full");
  const melody = await capturePreviewRole(page, testInfo, dialog, "Melody", "blackbird-preview-melody");
  const accompaniment = await capturePreviewRole(page, testInfo, dialog, "Accompaniment", "blackbird-preview-accompaniment");
  for (const capture of [full, melody, accompaniment]) audible(capture);
  expect(new Set([full.sha256, melody.sha256, accompaniment.sha256]).size).toBeGreaterThan(1);
  expect(await seek.inputValue()).toBe(positionBefore);

  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await selectArrangement(page, "Original arrangement");
  await expect.poll(() => seek.inputValue()).toBe(positionBefore);
  await selectArrangement(page, "Chord mode", "Automatic melody");
  await expect.poll(() => seek.inputValue()).toBe(positionBefore);
});

test("worker constructor failure retains real Original audio, retries, and clears on mode change", async ({ page }, testInfo) => {
  await installAudioProbe(page);
  await installMelodyTrace(page);
  await installWorkerConstructorFailure(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Chord mode", "Automatic melody", { waitForArrangement: false });
  const error = page.getByTestId("melody-accompaniment-error");
  await expect(error).toContainText("Original playback is retained");
  await expect(error.getByRole("button", { name: "Retry arrangement", exact: true })).toBeVisible();
  expect((await melodyTrace(page)).some((event) => event.phase === "worker-error" && event.error?.includes("constructor failure"))).toBe(true);

  await bootAudio(page);
  const fallback = await captureArrangement(page, testInfo, "worker-failure-original-fallback", 1, 1_200);
  audible(fallback);
  await error.getByRole("button", { name: "Retry arrangement", exact: true }).click();
  await expect(error).toContainText("Original playback is retained");

  await selectArrangement(page, "Original arrangement");
  await expect(page.getByTestId("melody-accompaniment-error")).toHaveCount(0);
  await selectArrangement(page, "Chord mode", "Automatic melody", { waitForArrangement: false });
  await expect(page.getByTestId("melody-accompaniment-error")).toContainText("Original playback is retained");
  await restoreWorkerConstructor(page);
  await page.getByTestId("melody-accompaniment-error").getByRole("button", { name: "Retry arrangement", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  await expect(page.getByTestId("melody-accompaniment-error")).toHaveCount(0);
});

test("complete Oops phrase captures Original, coherent and resume candidates with the same synth", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installAudioProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${OOPS_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Original arrangement");
  await bootAudio(page);
  const startSeconds = 64 * 60 / 95 - 0.5;
  const durationMs = Math.ceil((108 - 64) * 60 / 95 * 1000 + 1_000);
  const original = await captureArrangement(page, testInfo, "oops-section-2-original", startSeconds, durationMs);
  audible(original);

  await selectArrangement(page, "Chord mode", "Automatic melody");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  const coherent = await captureArrangement(page, testInfo, "oops-section-2-coherent", startSeconds, durationMs);
  audible(coherent);

  const resumePage = await page.context().newPage();
  try {
    await installAudioProbe(resumePage);
    await installResumePolicyOverride(resumePage);
    await resumePage.setViewportSize({ width: 1440, height: 900 });
    await resumePage.goto(`/player/${OOPS_SONG_ID}`);
    await expect(resumePage.getByLabel("Falling notes player")).toBeVisible();
    await selectArrangement(resumePage, "Chord mode", "Automatic melody");
    await expect(resumePage.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
    await bootAudio(resumePage);
    const resume = await captureArrangement(resumePage, testInfo, "oops-section-2-resume", startSeconds, durationMs);
    audible(resume);
    expect(coherent.sha256).not.toBe(original.sha256);
    expect(resume.sha256).not.toBe(coherent.sha256);
    expect(coherent.events.length).toBeLessThan(resume.events.length);
    writeFileSync(testInfo.outputPath("oops-section-2-audio-comparison.json"), JSON.stringify({
      sourceFingerprint: "variant:britney-spears-oops-i-did-it-again:a:britney-spears-oops-i-did-it-again-a:64d18aa4c23f7625a6eb0a7a234843a7a2278003d75cba9ea04efde7d8225ad4:notes:84153b6de3857351ce92086c8f5a28f9147073070948ed96fd39e6d6f8f212ae",
      window: { startBeat: 64, endBeat: 108, bpm: 95 },
      instrument: "browser AudioEngine synth",
      candidates: {
        original: { sha256: original.sha256, bytes: original.bytes, events: original.events.length, signal: original.signal },
        coherent: { sha256: coherent.sha256, bytes: coherent.bytes, events: coherent.events.length, signal: coherent.signal },
        resume: { sha256: resume.sha256, bytes: resume.bytes, events: resume.events.length, signal: resume.signal },
      },
      humanListening: "pending",
    }, null, 2));
  } finally {
    await resumePage.close();
  }
});

test("real audio events cover mode, hand filtering, seek, transpose, correction, and practice flow", async ({ page }, testInfo) => {
  await installAudioProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();

  await selectArrangement(page, "Original arrangement");
  await bootAudio(page);
  const original = await captureArrangement(page, testInfo, "blackbird-original", 7);
  audible(original);

  await selectArrangement(page, "Chord mode", "Automatic melody");
  const automatic = await captureArrangement(page, testInfo, "blackbird-automatic", 7);
  audible(automatic);
  expect(fundamentalMidis(automatic)).not.toEqual(fundamentalMidis(original));
  expect(automatic.events.length).not.toBe(original.events.length);
  expect(automatic.events.some((event) => event.type === "triangle" && event.relativeWhen >= 0 && event.relativeWhen < 0.25)).toBe(true);

  await page.getByRole("button", { name: "Left hand", exact: true }).click();
  const leftHand = await captureArrangement(page, testInfo, "blackbird-left-hand", 7, 1_400);
  audible(leftHand);
  await page.getByRole("button", { name: "Both hands", exact: true }).click();
  const bothHands = await captureArrangement(page, testInfo, "blackbird-both-hands", 7, 1_400);
  audible(bothHands);
  expect(leftHand.events.filter((event) => event.type === "triangle").length).toBeLessThan(bothHands.events.filter((event) => event.type === "triangle").length);

  await openPlayerTool(page, "Display");
  const display = page.getByRole("dialog", { name: "Display settings" });
  await display.getByRole("button", { name: "Transpose up", exact: true }).click();
  await display.getByRole("button", { name: "Close tools", exact: true }).click();
  const transposed = await captureArrangement(page, testInfo, "blackbird-transposed", 7, 1_400);
  audible(transposed);
  // Compare the same requested window; Web Audio may expose starts scheduled after pause.
  expect(fundamentalMidis(transposed, 1.4)).toEqual(fundamentalMidis(bothHands, 1.4).map((midi) => midi + 1));
  await openPlayerTool(page, "Display");
  await page.getByRole("dialog", { name: "Display settings" }).getByRole("button", { name: "Reset transpose", exact: true }).click();
  await page.getByRole("dialog", { name: "Display settings" }).getByRole("button", { name: "Close tools", exact: true }).click();

  await page.goto(`/player/${HELL_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await openPlayerTool(page, "Sound");
  let dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Chord mode", exact: true }).click();
  await dialog.getByRole("radio", { name: "Automatic melody", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-ambiguity")).toContainText(process.env.KEYSPILLI_T1_MODE === "1" ? "18.5–19.8 beats" : "19.4–20.4 beats");
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await bootAudio(page);

  const hellAutomatic = await captureArrangement(page, testInfo, "hell-automatic-ambiguous", 10.7, 2_200);
  audible(hellAutomatic);
  await openPlayerTool(page, "Sound");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Use right-hand part", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-ambiguity")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  const hellCorrected = await captureArrangement(page, testInfo, "hell-right-hand-corrected", 10.7, 2_200);
  audible(hellCorrected);
  // Source-note playback can preserve some of the same aggregate pitch set in both modes;
  // compare the first captured attack where the user-confirmed selection changes the notes.
  const firstAttackMidis = (capture: AudioCapture): number[] => [...new Set(capture.events
    .filter((event) => event.type === "triangle" && event.relativeWhen < 0.4 && event.midi !== null)
    .map((event) => event.midi as number))].sort((a, b) => a - b);
  expect(firstAttackMidis(hellCorrected)).toEqual(expect.arrayContaining([72]));
  expect(firstAttackMidis(hellAutomatic)).not.toContain(72);

  const sidecar = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), HELL_SIDECAR_KEY) as { selection?: string; provenance?: { selectionProvenance?: string } } | null;
  expect(sidecar).toMatchObject({ selection: "right-hand", provenance: { selectionProvenance: "user-confirmed" } });
  await page.reload();
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await openPlayerTool(page, "Sound");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(dialog.getByRole("radio", { name: "Use right-hand part", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("User melody");
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await bootAudio(page);

  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const panel = page.getByTestId("chord-practice-panel");
  await expect(panel.getByLabel("Target notes")).toBeVisible();
  const before = await panel.getByRole("status").textContent();
  const firstPitchClass = before?.split("Still needed: ")[1]?.split(" · ")[0]?.trim();
  const keys: Record<string, string> = { C: "a", "C#": "w", D: "s", "D#": "e", E: "d", F: "f", "F#": "t", G: "g", "G#": "y", A: "h", "A#": "u", B: "j" };
  expect(firstPitchClass && keys[firstPitchClass]).toBeTruthy();
  await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStart());
  await page.keyboard.press(keys[firstPitchClass!]!);
  await page.waitForTimeout(200);
  const practiceCapture = await page.evaluate(() => (window as unknown as AudioProbeWindow).__keyspilliAudioStop());
  saveCapture(testInfo, "hell-chord-practice-accepted", practiceCapture);
  audible({ ...practiceCapture, sha256: createHash("sha256").update(Buffer.from(practiceCapture.base64, "base64")).digest("hex") });
  await expect(panel.getByRole("status")).not.toHaveText(before!);
});

test("T1 freezes the Oops intro control only", async ({ page }, testInfo) => {
  test.skip(process.env.KEYSPILLI_T1_MODE !== "1", "T1 production fixtures are not loaded");
  await installAudioProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${OOPS_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();

  await selectArrangement(page, "Original arrangement");
  await bootAudio(page);
  const original = await captureArrangement(page, testInfo, "oops-original", 0, 2_400);
  audible(original);

  await selectArrangement(page, "Chord mode", "Automatic melody");
  const automatic = await captureArrangement(page, testInfo, "oops-automatic", 0, 2_400);
  audible(automatic);

  await selectArrangement(page, "Chord mode", "Use right-hand part");
  const rightHand = await captureArrangement(page, testInfo, "oops-right-hand", 0, 2_400);
  audible(rightHand);

  const sidecar = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), OOPS_SIDECAR_KEY) as {
    selection?: string;
    provenance?: { selectionProvenance?: string };
  } | null;
  expect(sidecar).toMatchObject({ selection: "right-hand", provenance: { selectionProvenance: "user-confirmed" } });
  writeFileSync(testInfo.outputPath("oops-summary.json"), JSON.stringify({
    source: { bytes: original.bytes, events: original.events.length, sha256: original.sha256 },
    automatic: { bytes: automatic.bytes, events: automatic.events.length, sha256: automatic.sha256 },
    rightHand: { bytes: rightHand.bytes, events: rightHand.events.length, sha256: rightHand.sha256 },
    sidecar,
  }, null, 2));
});

const OOPS_PHRASE_WINDOWS = [
  { id: "intro-control", startBeat: 0, endBeat: 16, sourceSectionId: "section-1", sourceSectionLabel: "Intro 1", provisionalLabel: "control" },
  { id: "intro-development", startBeat: 16, endBeat: 32, sourceSectionId: "section-1", sourceSectionLabel: "Intro 1", provisionalLabel: "development" },
  { id: "section-2", startBeat: 64, endBeat: 108, sourceSectionId: "section-2", sourceSectionLabel: "Section 2", provisionalLabel: "verse; semantic label unverified" },
  { id: "section-3-transition", startBeat: 108, endBeat: 124, sourceSectionId: "section-3", sourceSectionLabel: "Section 3", provisionalLabel: "transition; semantic label unverified" },
  { id: "section-4", startBeat: 124, endBeat: 188, sourceSectionId: "section-4", sourceSectionLabel: "Section 4", provisionalLabel: "chorus; semantic label unverified" },
  { id: "section-2-ambiguity", startBeat: 83.5, endBeat: 89.5, sourceSectionId: "section-2", sourceSectionLabel: "Section 2", provisionalLabel: "reported ambiguity" },
] as const;
const OOPS_BPM = 95;
const OOPS_CAPTURE_MODES = [
  { id: "original", selection: "Original arrangement" as const, label: "Original full mix" },
  { id: "automatic", selection: "Chord mode" as const, melody: "Automatic melody" as const, label: "Automatic full mix" },
  { id: "right-hand", selection: "Chord mode" as const, melody: "Use right-hand part" as const, label: "User-confirmed right-hand melody" },
] as const;

type OopsPhraseManifestEntry = {
  mode: string;
  modeLabel: string;
  window: (typeof OOPS_PHRASE_WINDOWS)[number];
  fixture: string;
  source: "production-equivalent API fixture";
  seekSeconds: number;
  durationMs: number;
  audioPath: string;
  metadataPath: string;
  bytes: number;
  events: number;
  sha256: string;
  signal: AudioCapture["signal"];
};

function appendOopsPhraseManifest(testInfo: { outputDir: string }, entry: OopsPhraseManifestEntry): void {
  const manifestPath = process.env.KEYSPILLI_T1_MANIFEST_PATH ?? join(testInfo.outputDir, "oops-phrase-captures.json");
  let manifest: { schemaVersion: number; fixture: string; source: string; entries: OopsPhraseManifestEntry[] } = {
    schemaVersion: 1,
    fixture: OOPS_SONG_ID,
    source: "production-equivalent API fixture; full-mix browser captures",
    entries: [],
  };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch {}
  manifest.entries = manifest.entries.filter((existing) => !(existing.mode === entry.mode && existing.window.id === entry.window.id));
  manifest.entries.push(entry);
  manifest.entries.sort((left, right) => `${left.mode}:${left.window.id}`.localeCompare(`${right.mode}:${right.window.id}`));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

if (process.env.KEYSPILLI_T1_MODE === "1") {
  for (const mode of OOPS_CAPTURE_MODES) {
    for (const window of OOPS_PHRASE_WINDOWS) {
      test(`T1 captures Oops ${mode.id} ${window.id}`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        await installAudioProbe(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/player/${OOPS_SONG_ID}`);
        await expect(page.getByLabel("Falling notes player")).toBeVisible();

        if (mode.selection === "Chord mode") await selectArrangement(page, mode.selection, mode.melody);
        else await selectArrangement(page, mode.selection);
        await bootAudio(page);
        const seekSeconds = Math.max(0, window.startBeat * 60 / OOPS_BPM - 0.5);
        const durationMs = Math.ceil((window.endBeat - window.startBeat) * 60 / OOPS_BPM * 1000 + 1_000);
        const label = `oops-${mode.id}-${window.id}`;
        const capture = await captureArrangement(page, testInfo, label, seekSeconds, durationMs);
        audible(capture);
        appendOopsPhraseManifest(testInfo, {
          mode: mode.id,
          modeLabel: mode.label,
          window,
          fixture: OOPS_SONG_ID,
          source: "production-equivalent API fixture",
          seekSeconds,
          durationMs,
          audioPath: testInfo.outputPath(`${label}.webm`),
          metadataPath: testInfo.outputPath(`${label}.json`),
          bytes: capture.bytes,
          events: capture.events.length,
          sha256: capture.sha256,
          signal: capture.signal,
        });
      });
    }
  }

  test("T1 captures Oops automatic chorus with left-hand UI filter", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const window = OOPS_PHRASE_WINDOWS.find((candidate) => candidate.id === "section-4")!;
    await installAudioProbe(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/player/${OOPS_SONG_ID}`);
    await expect(page.getByLabel("Falling notes player")).toBeVisible();
    await selectArrangement(page, "Chord mode", "Automatic melody");
    await page.getByRole("button", { name: "Left hand", exact: true }).click();
    await bootAudio(page);
    const seekSeconds = Math.max(0, window.startBeat * 60 / OOPS_BPM - 0.5);
    const durationMs = Math.ceil((window.endBeat - window.startBeat) * 60 / OOPS_BPM * 1000 + 1_000);
    const label = "oops-automatic-left-filtered-section-4";
    const capture = await captureArrangement(page, testInfo, label, seekSeconds, durationMs);
    audible(capture);
    appendOopsPhraseManifest(testInfo, {
      mode: "automatic-left-filtered",
      modeLabel: "Automatic melody with Left hand UI filter; not an isolated stem",
      window,
      fixture: OOPS_SONG_ID,
      source: "production-equivalent API fixture",
      seekSeconds,
      durationMs,
      audioPath: testInfo.outputPath(`${label}.webm`),
      metadataPath: testInfo.outputPath(`${label}.json`),
      bytes: capture.bytes,
      events: capture.events.length,
      sha256: capture.sha256,
      signal: capture.signal,
    });
  });
}

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
