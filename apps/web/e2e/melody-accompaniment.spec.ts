import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openPlayerTool } from "./player-tools";

const SONG_ID = "the-beatles-blackbird-a-scratch";
const HELL_SONG_ID = "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-a-scratch";
const SIDECAR_KEY = `keyspilli.melody-accompaniment.v1:${SONG_ID}`;
const HELL_SIDECAR_KEY = `keyspilli.melody-accompaniment.v1:${HELL_SONG_ID}`;

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
  await seek.fill(String(startSeconds));
  await expect(seek).toHaveValue(String(startSeconds));
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

async function selectArrangement(page: Page, mode: "Original arrangement" | "Chord mode", melody?: "Automatic melody" | "Use right-hand part"): Promise<void> {
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: mode, exact: true }).click();
  if (melody) await dialog.getByRole("radio", { name: melody, exact: true }).click();
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
}

async function bootAudio(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
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
    generatorVersion: "melody-accompaniment.v1",
    selection: "right-hand",
    provenance: { selectionProvenance: "user-confirmed" },
  });
  expect(sidecar?.sourceFingerprint).toContain("variant:the-beatles-blackbird:a:");
  expect(sidecar?.provenance?.sourceSupportNoteCount).toBeGreaterThan(0);
  expect(sidecar?.provenance?.generatedNoteCount).toBe(0);

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
  await expect(page.getByTestId("melody-accompaniment-ambiguity")).toContainText("19.3–20.6 beats");
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
  expect(fundamentalMidis(hellCorrected)).not.toEqual(fundamentalMidis(hellAutomatic));
  const correctedAmbiguityMidis = [...new Set(hellCorrected.events
    .filter((event) => event.type === "triangle" && event.relativeWhen > 0.65 && event.relativeWhen < 1.45 && event.midi !== null)
    .map((event) => event.midi as number))].sort((a, b) => a - b);
  expect(correctedAmbiguityMidis).toEqual(expect.arrayContaining([44, 48, 51, 55]));
  const automaticAmbiguityMidis = [...new Set(hellAutomatic.events
    .filter((event) => event.type === "triangle" && event.relativeWhen > 0.65 && event.relativeWhen < 1.45 && event.midi !== null)
    .map((event) => event.midi as number))];
  expect(automaticAmbiguityMidis).not.toEqual(expect.arrayContaining([44, 48, 51, 55]));

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
