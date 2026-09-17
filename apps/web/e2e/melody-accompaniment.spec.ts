import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ChordLabel, Note } from "@keyspilli/midi";
import { buildMelodyAccompaniment } from "@keyspilli/player-core";
import { openPlayerTool } from "./player-tools";

const SONG_ID = "the-beatles-blackbird-a-scratch";
const UG_SONG_ID = "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a-scratch";
const OOPS_SONG_ID = "britney-spears-oops-i-did-it-again-a-scratch";
const HELL_SONG_ID = "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-a-scratch";
const SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${SONG_ID}`;
const OOPS_SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${OOPS_SONG_ID}`;
const HELL_SIDECAR_KEY = `keyspilli.melody-accompaniment.v2:${HELL_SONG_ID}`;
const FROZEN_CANDIDATE_COMMIT = "ea68729045e82ef9ced14e0e0916c86991eeba4a";
const RESERVED_FIXTURE_ROOT = "/Users/reidar/.codex/worktrees/musically-useful-chords-mode/docs/superpowers/evidence/2026-09-17-chords-v2-evaluation-fixtures";
const RESERVED_CANDIDATES = [
  {
    id: "w-h-doane-near-the-cross-a-scratch",
    title: "Near the Cross",
    artist: "W. H. Doane",
    bpm: 112,
    sourceNotesHash: "da39379165b5d13a03ef188a230765f3b08c1cc356d105766246b48a9a88b80e",
    sourceArtifactHash: "09d4a33ac39f9429f3fdf3a45377a7010b36a1f501194b2dba10e91e45d51a0d",
    sourceFingerprint: "variant:w-h-doane-near-the-cross:a:w-h-doane-near-the-cross-a:09d4a33ac39f9429f3fdf3a45377a7010b36a1f501194b2dba10e91e45d51a0d:notes:764b13112b7bc753a393262bf34b4d1aa60a3ec50c5b2356187f1213b1c96304",
    window: { startBeat: 24, endBeat: 48, measures: 4, meter: "6/4", notes: 50, attacks: 13, mixedOnset: 0.923, held: 0.62, offgrid: null, upperDecoration: null },
    selectionBasis: "source-only max mixed-onset four-measure window",
    retrospectiveAdditionalWindow: {
      startBeat: 0,
      endBeat: 24,
      measures: 4,
      meter: "6/4",
      selectionBasis: "retrospective non-overlapping control window selected after primary freeze; not an untouched holdout",
    },
  },
  {
    id: "c-v-alkan-prelude-a-scratch",
    title: "Prélude",
    artist: "C.-V. Alkan",
    bpm: 60,
    sourceNotesHash: "7fe0f9b6464a1727c74f3f25d1f81777d2e916b6c7e11ebeaf9733cc5043b05d",
    sourceArtifactHash: "ae68944db2e646e14e0923a79b95b3a6e2658432e384e8741f3ab108dbc5ac80",
    sourceFingerprint: "variant:c-v-alkan-prelude:a:c-v-alkan-prelude-a:ae68944db2e646e14e0923a79b95b3a6e2658432e384e8741f3ab108dbc5ac80:notes:50a78996e80fa2731574f881d0eabb3bfb75045069e1f046bc6a24b1e0753098",
    window: { startBeat: 16, endBeat: 32, measures: 4, meter: "4/4", notes: 115, attacks: 28, mixedOnset: 1, held: null, offgrid: 0.252, upperDecoration: 0.569 },
    selectionBasis: "source-only max upper-decoration/off-grid four-measure window",
    retrospectiveAdditionalWindow: {
      startBeat: 0,
      endBeat: 16,
      measures: 4,
      meter: "4/4",
      selectionBasis: "retrospective non-overlapping control window selected after primary freeze; not an untouched holdout",
    },
  },
  {
    id: "beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-a-scratch",
    title: "Easy Piano Jumbo Songbook - Pay Me My Money Down",
    artist: "Beginner Piano Tutorial",
    bpm: 152,
    sourceNotesHash: "587458f078cc1f1248f9d8ebfe2079ab36e471de4d29a596631ee401e9dab4bf",
    sourceArtifactHash: "0b034323353ce167cf24664a17bda435c963f58d75c40d75d3860804bb475677",
    sourceFingerprint: "variant:beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940:a:beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-a:0b034323353ce167cf24664a17bda435c963f58d75c40d75d3860804bb475677:notes:a39db919f07c250adba174560d3882882178dd942a37b136bfd870f490383f9e",
    window: { startBeat: 28, endBeat: 44, measures: 4, meter: "4/4", notes: 35, attacks: 19, mixedOnset: 0.368, held: 0.314, offgrid: 0.514, upperDecoration: null },
    selectionBasis: "source-only max mixed/off-grid four-measure window among usable Pay Me windows",
    retrospectiveAdditionalWindow: {
      startBeat: 0,
      endBeat: 16,
      measures: 4,
      meter: "4/4",
      selectionBasis: "retrospective non-overlapping control window selected after primary freeze; not an untouched holdout",
    },
  },
  {
    id: "dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-a-scratch",
    title: "Avenged Sevenfold - Dear God - Piano Cover",
    artist: "Dadebrayant",
    bpm: 75,
    sourceNotesHash: "0e2b1ba6166434cb23ccf022440f4a9a4caff6f6a60f74b9bc4f84dabf636cde",
    sourceArtifactHash: "8e4d4b9114800d69904dc4af35376b95ccd1d8c537aac3adbe812c72f0cf482e",
    sourceFingerprint: "variant:dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo:a:dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-a:8e4d4b9114800d69904dc4af35376b95ccd1d8c537aac3adbe812c72f0cf482e:notes:7f0ce6f0afdd4a7b6c04c1158339bb3440894cd5f77b686308a99fbe3d24b0b",
    window: { startBeat: 96, endBeat: 128, measures: 8, meter: "4/4", notes: 166, attacks: 75, mixedOnset: 0.453, held: null, offgrid: 0.476, upperDecoration: 0.525 },
    selectionBasis: "source-only max mixed/off-grid/upper-decoration eight-measure window",
    retrospectiveAdditionalWindow: {
      startBeat: 64,
      endBeat: 96,
      measures: 8,
      meter: "4/4",
      selectionBasis: "retrospective non-overlapping control window selected after primary freeze; not an untouched holdout",
    },
  },
] as const;

type AudioCapture = {
  mimeType: string;
  bytes: number;
  base64: string;
  signal: { rms: number; peak: number; samples: number };
  decodedPcm: { sampleRate: number; samples: number; stride: number; values: number[] };
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

async function installWorkerPostMessageFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (message && typeof message === "object" && "requestKey" in message) throw new Error("e2e worker postMessage failure");
      return Reflect.apply(originalPostMessage, this, [message, ...rest]);
    };
  });
}

async function installDelayedWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
      if (message && typeof message === "object" && "requestKey" in message) {
        setTimeout(() => {
          try { Reflect.apply(originalPostMessage, this, [message, ...rest]); } catch {}
        }, 1_000);
        return;
      }
      return Reflect.apply(originalPostMessage, this, [message, ...rest]);
    };
  });
}

async function installStorageValue(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(({ key: storageKey, value: storageValue }) => {
    window.localStorage.setItem(storageKey, storageValue);
  }, { key, value });
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
      let decodedPcm = { sampleRate: 0, samples: 0, stride: 128, values: [] as number[] };
      try {
        const decoded = await session.context.decodeAudioData(buffer.slice(0));
        const samples = decoded.getChannelData(0);
        const stride = 128;
        const values = [];
        for (let index = 0; index < samples.length; index += stride) values.push(Number((samples[index] ?? 0).toFixed(6)));
        decodedPcm = { sampleRate: decoded.sampleRate, samples: samples.length, stride, values };
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
      return { mimeType: blob.type, bytes: blob.size, base64: btoa(binary), signal, decodedPcm, events };
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
  assertCompleteDecodedCapture(capture, durationMs, label);
  const audio = Buffer.from(capture.base64, "base64");
  saveCapture(testInfo, label, capture, audio);
  return { ...capture, sha256: createHash("sha256").update(audio).digest("hex") };
}

const CAPTURE_DURATION_TOLERANCE_SECONDS = 0.25;

function decodedDurationSeconds(capture: AudioCapture): number {
  return capture.decodedPcm.sampleRate > 0
    ? capture.decodedPcm.samples / capture.decodedPcm.sampleRate
    : 0;
}

function assertCompleteDecodedCapture(capture: AudioCapture, durationMs: number, label: string): void {
  const requestedSeconds = durationMs / 1000;
  const decodedSeconds = decodedDurationSeconds(capture);
  if (!Number.isFinite(decodedSeconds) || decodedSeconds + CAPTURE_DURATION_TOLERANCE_SECONDS < requestedSeconds) {
    throw new Error(`${label}: incomplete decoded capture (${decodedSeconds.toFixed(3)}s decoded; ${requestedSeconds.toFixed(3)}s requested)`);
  }
}

async function captureReservedArrangement(
  page: Page,
  testInfo: { outputPath: (path: string) => string },
  label: string,
  startSeconds: number,
  durationMs: number,
): Promise<AudioCapture & { sha256: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await captureArrangement(page, testInfo, label, startSeconds, durationMs);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(250);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

type PcmComparison = {
  sampleRate: number;
  stride: number;
  shiftBins: number;
  shiftSamples: number;
  overlap: number;
  meanAbsoluteError: number;
  rmsError: number;
  maxAbsoluteError: number;
  rmsTolerance: number;
  withinTolerance: boolean;
};

type ProducerOutcome = {
  eventCount: number;
  eventMultisetHash: string;
  changedFromOriginal: boolean;
  windowStartBeat: number;
  windowEndBeat: number;
  arrangementEndBeats: number;
};

function canonicalProducerEventMultiset(
  notes: readonly Note[],
  window: { startBeat: number; endBeat: number },
): string[] {
  return notes.flatMap((note) => {
    const start = Math.max(note.start, window.startBeat);
    const end = Math.min(note.start + note.dur, window.endBeat);
    return end > start ? [[note.midi, start, end - start, note.vel].join("|")] : [];
  }).sort();
}

function producerOutcome(
  notes: readonly Note[],
  original: readonly Note[],
  window: { startBeat: number; endBeat: number },
  arrangementEndBeats: number,
): ProducerOutcome {
  const eventMultiset = canonicalProducerEventMultiset(notes, window);
  return {
    eventCount: eventMultiset.length,
    eventMultisetHash: createHash("sha256").update(JSON.stringify(eventMultiset)).digest("hex"),
    changedFromOriginal: JSON.stringify(eventMultiset) !== JSON.stringify(canonicalProducerEventMultiset(original, window)),
    windowStartBeat: window.startBeat,
    windowEndBeat: window.endBeat,
    arrangementEndBeats,
  };
}

type ProducerOutcomes = { original: ProducerOutcome; automatic: ProducerOutcome; manual: ProducerOutcome };

function reservedProducerOutcomes(candidate: typeof RESERVED_CANDIDATES[number]): ProducerOutcomes & {
  retrospectiveAdditionalEvaluation: ProducerOutcomes & { selectionBasis: string };
} {
  const baseId = candidate.id.replace(/-a-scratch$/, "");
  const source = JSON.parse(readFileSync(join(RESERVED_FIXTURE_ROOT, baseId, "a", "notes.json"), "utf8")) as {
    notes: Note[];
    chords: ChordLabel[];
    sourceFingerprint?: string;
    measures: Array<{ endBeat: number }>;
  };
  const arrangementEndBeats = Math.max(
    0,
    ...source.notes.map((note) => note.start + note.dur),
    ...source.measures.map((measure) => measure.endBeat),
  );
  const build = (selection: "automatic" | "right-hand") => buildMelodyAccompaniment(source.notes, source.chords, {
    durationBeats: arrangementEndBeats,
    sourceFingerprint: source.sourceFingerprint,
    selection,
    allowRests: true,
    soundingPolicy: "coherent-phrase",
    phraseOverrides: [],
  });
  const automaticNotes = build("automatic").notes;
  const manualNotes = build("right-hand").notes;
  const evaluate = (window: { startBeat: number; endBeat: number }): ProducerOutcomes => ({
    original: producerOutcome(source.notes, source.notes, window, arrangementEndBeats),
    automatic: producerOutcome(automaticNotes, source.notes, window, arrangementEndBeats),
    manual: producerOutcome(manualNotes, source.notes, window, arrangementEndBeats),
  });
  return {
    ...evaluate(candidate.window),
    retrospectiveAdditionalEvaluation: {
      selectionBasis: candidate.retrospectiveAdditionalWindow.selectionBasis,
      ...evaluate(candidate.retrospectiveAdditionalWindow),
    },
  };
}

function canonicalScheduledEventMultiset(capture: AudioCapture): string[] {
  const firstWhen = Math.min(...capture.events.map((event) => event.relativeWhen));
  return capture.events
    .map((event) => `${event.type}|${event.midi ?? "null"}|${Math.round((event.relativeWhen - firstWhen) * 100)}`)
    .sort();
}

function scheduledEventMultisetHash(capture: AudioCapture): string {
  return createHash("sha256").update(JSON.stringify(canonicalScheduledEventMultiset(capture))).digest("hex");
}

function compareDecodedPcm(original: AudioCapture, candidate: AudioCapture): PcmComparison {
  const source = original.decodedPcm;
  const output = candidate.decodedPcm;
  if (!source.values.length || !output.values.length || source.sampleRate !== output.sampleRate || source.stride !== output.stride) {
    throw new Error("Decoded PCM comparison requires matching non-empty sample grids");
  }
  let best: PcmComparison | undefined;
  const maxShiftBins = Math.min(32, Math.floor(Math.min(source.values.length, output.values.length) / 4));
  for (let shiftBins = -maxShiftBins; shiftBins <= maxShiftBins; shiftBins++) {
    const sourceStart = Math.max(0, shiftBins);
    const outputStart = Math.max(0, -shiftBins);
    const overlap = Math.min(source.values.length - sourceStart, output.values.length - outputStart);
    if (overlap <= 0) continue;
    let absolute = 0;
    let squared = 0;
    let maximum = 0;
    for (let index = 0; index < overlap; index++) {
      const error = Math.abs((source.values[sourceStart + index] ?? 0) - (output.values[outputStart + index] ?? 0));
      absolute += error;
      squared += error * error;
      maximum = Math.max(maximum, error);
    }
    const comparison: PcmComparison = {
      sampleRate: source.sampleRate,
      stride: source.stride,
      shiftBins,
      shiftSamples: shiftBins * source.stride,
      overlap,
      meanAbsoluteError: absolute / overlap,
      rmsError: Math.sqrt(squared / overlap),
      maxAbsoluteError: maximum,
      rmsTolerance: 0.02,
      withinTolerance: false,
    };
    if (!best || comparison.rmsError < best.rmsError) best = comparison;
  }
  if (!best) throw new Error("Decoded PCM comparison had no overlapping samples");
  return { ...best, withinTolerance: best.rmsError <= best.rmsTolerance };
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
  await expect(page.getByTestId("chord-mode-status")).toHaveText("Chords estimated from notes");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  await expect(page.getByTestId("melody-phrase-summary").locator("summary")).toHaveText(/Phrases: \d+ changed · \d+ unchanged · \d+ already simple/);
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
    provenance?: { selectionProvenance?: string; sourceSupportNoteCount?: number; generatedNoteCount?: number; supportModes?: string[] };
  } | null;
  expect(sidecar).toMatchObject({
    generatorVersion: "melody-accompaniment.v2",
    selection: "right-hand",
    provenance: { selectionProvenance: "user-confirmed" },
  });
  expect(sidecar?.sourceFingerprint).toContain("variant:the-beatles-blackbird:a:");
  expect(sidecar?.provenance?.sourceSupportNoteCount).toBeGreaterThan(0);
  expect(sidecar?.provenance?.generatedNoteCount).toBe(0);
  expect(sidecar?.provenance?.supportModes).not.toContain("sparse-harmonic");

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
  await page.goto(`/player/${UG_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();

  let traces = await melodyTrace(page);
  expect(traces.some((event) => event.phase === "source-view" && event.execution === "source")).toBe(true);
  expect(traces.some((event) => event.phase === "sync-start")).toBe(false);

  await selectArrangement(page, "Chord mode");
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  traces = await melodyTrace(page);
  expect(traces.some((event) => event.phase === "worker-request" && event.execution === "worker")).toBe(true);
  expect(traces.some((event) => event.phase === "worker-ready" && event.execution === "worker")).toBe(true);
  expect(traces.some((event) => event.phase === "sync-start")).toBe(false);

  const firstRequestKey = traces.find((event) => event.phase === "worker-request")?.key;
  expect(firstRequestKey).toBeTruthy();
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "UG timeline", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody");
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  const changedSourceTraces = await melodyTrace(page);
  const requestKeys = changedSourceTraces.filter((event) => event.phase === "worker-request").map((event) => event.key);
  expect(new Set(requestKeys).size).toBeGreaterThan(1);
  expect(requestKeys.at(-1)).not.toBe(firstRequestKey);
  expect(changedSourceTraces.some((event) => event.phase === "sync-start")).toBe(false);
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
  await expect(page.getByTestId("melody-accompaniment-status")).toHaveText("Original retained · arrangement unavailable");
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

test("worker postMessage failure keeps Original playback and a truthful retry state", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Audio and worker failure assertions use the Chromium harness");
  await installAudioProbe(page);
  await installMelodyTrace(page);
  await installWorkerPostMessageFailure(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Chord mode", "Automatic melody", { waitForArrangement: false });
  const error = page.getByTestId("melody-accompaniment-error");
  await expect(error).toContainText("e2e worker postMessage failure");
  await expect(error).toContainText("Original playback is retained");
  await expect(page.getByTestId("melody-accompaniment-status")).toHaveText("Original retained · arrangement unavailable");
  expect((await melodyTrace(page)).some((event) => event.phase === "worker-error" && event.error?.includes("postMessage failure"))).toBe(true);
  await bootAudio(page);
  const fallback = await captureArrangement(page, testInfo, "worker-post-message-original-fallback", 1, 1_200);
  expect(fallback.bytes).toBeGreaterThan(0);
  expect(fallback.events.filter((event) => event.type === "triangle")).not.toHaveLength(0);
  await selectArrangement(page, "Original arrangement");
  await expect(page.getByTestId("melody-accompaniment-status")).toHaveCount(0);
  await expect(page.getByTestId("melody-accompaniment-error")).toHaveCount(0);
});

test("stale worker replies cannot replace the latest source-keyed request", async ({ page }) => {
  await installMelodyTrace(page);
  await installDelayedWorker(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${UG_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Chord mode", "Automatic melody", { waitForArrangement: false });
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "UG timeline", exact: true }).click();
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("Inferred melody", { timeout: 5_000 });
  const traces = await melodyTrace(page);
  const requests = traces.filter((event) => event.phase === "worker-request").map((event) => event.key).filter((key): key is string => !!key);
  const ready = traces.filter((event) => event.phase === "worker-ready").at(-1);
  expect(new Set(requests).size).toBeGreaterThanOrEqual(2);
  expect(ready?.key).toBe(requests.at(-1));
});

test("stale cross-variant melody storage is ignored and Original has no derived status", async ({ page }) => {
  await installStorageValue(page, HELL_SIDECAR_KEY, JSON.stringify({
    schemaVersion: 2,
    generatorVersion: "melody-accompaniment.v2",
    sourceFingerprint: "variant:other-level:notes:stale",
    selection: "right-hand",
    provenance: { selection: "right-hand", selectionProvenance: "user-confirmed" },
  }));
  await installStorageValue(page, SIDECAR_KEY, JSON.stringify({
    schemaVersion: 2,
    generatorVersion: "melody-accompaniment.v2",
    sourceFingerprint: "a-different-variant",
    selection: "right-hand",
    provenance: { selection: "right-hand", selectionProvenance: "user-confirmed" },
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${HELL_SONG_ID}`);
  await expect(page.getByLabel("Falling notes player")).toBeVisible();
  await selectArrangement(page, "Chord mode");
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(dialog.getByRole("radio", { name: "Automatic melody", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("button", { name: "Reset saved selection", exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), HELL_SIDECAR_KEY)).not.toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), SIDECAR_KEY)).not.toBeNull();
  await expect(page.getByTestId("chord-mode-status")).toHaveText("Chords estimated from notes");
  await dialog.getByRole("button", { name: "Close tools", exact: true }).click();
  await selectArrangement(page, "Original arrangement");
  await expect(page.getByTestId("melody-accompaniment-status")).toHaveCount(0);
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

test("derived guidance stays pitch-consistent in the visual view after transpose and hand filtering", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/player/${SONG_ID}/beginner`);
  const view = page.getByLabel("Note letters view");
  await expect(view).toBeVisible();
  await selectArrangement(page, "Chord mode", "Automatic melody");
  await page.getByLabel("Seek").fill("3");
  const badges = view.locator("[data-midi]");
  await expect(badges.first()).toBeVisible();
  const automatic = (await badges.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-midi"))))).sort((a, b) => a - b);
  expect(automatic.length).toBeGreaterThan(0);

  await openPlayerTool(page, "Display");
  const display = page.getByRole("dialog", { name: "Display settings" });
  await display.getByRole("button", { name: "Transpose up", exact: true }).click();
  await display.getByRole("button", { name: "Close tools", exact: true }).click();
  await expect.poll(async () => badges.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-midi"))).sort((a, b) => a - b))).toEqual(automatic.map((midi) => midi + 1));

  await openPlayerTool(page, "Display");
  await page.getByRole("dialog", { name: "Display settings" }).getByRole("button", { name: "Reset transpose", exact: true }).click();
  await page.getByRole("dialog", { name: "Display settings" }).getByRole("button", { name: "Close tools", exact: true }).click();
  await page.getByRole("button", { name: "Right hand", exact: true }).click();
  const rightHand = (await badges.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-midi"))))).sort((a, b) => a - b);
  expect(rightHand.length).toBeGreaterThan(0);
  expect(rightHand.every((midi) => automatic.includes(midi))).toBe(true);
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
  const keyboard = page.getByRole("button", { name: "Piano keyboard", exact: true });
  await expect(keyboard).toBeVisible();
  await expect(keyboard).toHaveAttribute("aria-disabled", "false");
  await keyboard.focus();
  await expect(keyboard).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(keyboard).toBeFocused();

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
  await expect(page.getByTestId("melody-accompaniment-status")).toContainText("User melody");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

type ReservedCaptureOutcome = {
  status: "captured" | "error";
  modeLabel: string;
  humanRating: "pending";
  seekSeconds: number;
  durationMs: number;
  audioPath?: string;
  metadataPath?: string;
  bytes?: number;
  oscillatorEvents?: number;
  triangleOscillatorEvents?: number;
  fundamentalMidis?: number[];
  sha256?: string;
  signal?: AudioCapture["signal"];
  decodedDurationSeconds?: number;
  requestedDurationSeconds?: number;
  producerEventCount?: number;
  producerEventMultisetHash?: string;
  producerEventMultisetChanged?: boolean;
  canonicalScheduledEventCount?: number;
  canonicalScheduledEventHash?: string;
  scheduledEventMultisetChanged?: boolean;
  alignedPcmComparison?: PcmComparison;
  error?: string;
};

function reservedCaptureSummary(
  label: string,
  capture: AudioCapture & { sha256: string },
  originalCapture: (AudioCapture & { sha256: string }) | undefined,
  seekSeconds: number,
  durationMs: number,
  modeLabel: string,
  producer: ProducerOutcome | undefined = undefined,
  relativeDirectory = "captures",
): ReservedCaptureOutcome {
  const canonicalEvents = canonicalScheduledEventMultiset(capture);
  const originalCanonicalEvents = originalCapture ? canonicalScheduledEventMultiset(originalCapture) : undefined;
  const alignedPcmComparison = originalCapture ? compareDecodedPcm(originalCapture, capture) : undefined;
  const scheduledEventMultisetChanged = originalCanonicalEvents ? JSON.stringify(canonicalEvents) !== JSON.stringify(originalCanonicalEvents) : false;
  return {
    status: "captured",
    modeLabel,
    humanRating: "pending",
    seekSeconds,
    durationMs,
    audioPath: `${relativeDirectory}/${label}.webm`,
    metadataPath: `${relativeDirectory}/${label}.json`,
    bytes: capture.bytes,
    oscillatorEvents: capture.events.length,
    triangleOscillatorEvents: capture.events.filter((event) => event.type === "triangle").length,
    fundamentalMidis: fundamentalMidis(capture),
    sha256: capture.sha256,
    signal: capture.signal,
    decodedDurationSeconds: decodedDurationSeconds(capture),
    requestedDurationSeconds: durationMs / 1000,
    producerEventCount: producer?.eventCount,
    producerEventMultisetHash: producer?.eventMultisetHash,
    producerEventMultisetChanged: producer?.changedFromOriginal,
    canonicalScheduledEventCount: canonicalEvents.length,
    canonicalScheduledEventHash: scheduledEventMultisetHash(capture),
    scheduledEventMultisetChanged,
    alignedPcmComparison,
  };
}

test("reserved evaluation captures complete phrases with automatic and manual outcomes separate", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  await installAudioProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const outcomes = RESERVED_CANDIDATES.map((candidate) => {
    const seekSeconds = Math.max(0, candidate.window.startBeat * 60 / candidate.bpm - 0.5);
    const durationMs = Math.ceil((candidate.window.endBeat - candidate.window.startBeat) * 60 / candidate.bpm * 1000 + 1_000);
    return {
      candidate: {
        id: candidate.id,
        title: candidate.title,
        artist: candidate.artist,
        bpm: candidate.bpm,
        sourceNotesHash: candidate.sourceNotesHash,
        sourceArtifactHash: candidate.sourceArtifactHash,
        sourceFingerprint: candidate.sourceFingerprint,
        window: candidate.window,
        selectionBasis: candidate.selectionBasis,
        retrospectiveAdditionalWindow: candidate.retrospectiveAdditionalWindow,
      },
      seekSeconds,
      durationMs,
      producer: reservedProducerOutcomes(candidate),
      original: null as ReservedCaptureOutcome | null,
      automatic: null as ReservedCaptureOutcome | null,
      manual: null as ReservedCaptureOutcome | null,
    };
  });
  const originalCaptures = new Map<string, AudioCapture & { sha256: string }>();
  const controlStartSeconds = 2;
  const controlDurationMs = 2_500;
  let controlOriginal: AudioCapture & { sha256: string } | undefined;
  let controlOriginalOutcome: ReservedCaptureOutcome | null = null;
  let controlRepeatOutcome: ReservedCaptureOutcome | null = null;

  for (const [key, label] of [["first", "control-blackbird-original-a"], ["repeat", "control-blackbird-original-b"]] as const) {
    try {
      await page.goto(`/player/${SONG_ID}`);
      await expect(page.getByLabel("Falling notes player")).toBeVisible();
      await selectArrangement(page, "Original arrangement");
      await bootAudio(page);
      const capture = await captureReservedArrangement(page, testInfo, label, controlStartSeconds, controlDurationMs);
      audible(capture);
      const summary = reservedCaptureSummary(label, capture, controlOriginal, controlStartSeconds, controlDurationMs, "Original development repeat control", undefined, "controls");
      if (key === "first") {
        controlOriginal = capture;
        controlOriginalOutcome = summary;
      } else {
        controlRepeatOutcome = summary;
      }
    } catch (error) {
      const summary: ReservedCaptureOutcome = {
        status: "error",
        modeLabel: "Original development repeat control",
        humanRating: "pending",
        seekSeconds: controlStartSeconds,
        durationMs: controlDurationMs,
        error: error instanceof Error ? error.message : String(error),
      };
      if (key === "first") controlOriginalOutcome = summary;
      else controlRepeatOutcome = summary;
    }
  }

  for (const outcome of outcomes) {
    const candidate = RESERVED_CANDIDATES.find((item) => item.id === outcome.candidate.id)!;
    const labelPrefix = `reserved-${candidate.id.replace(/-a-scratch$/, "")}`;
    const modes = [
      { key: "original" as const, selection: "Original arrangement" as const, melody: undefined, label: "Original full arrangement" },
      { key: "automatic" as const, selection: "Chord mode" as const, melody: "Automatic melody" as const, label: "Automatic melody plus accompaniment" },
      { key: "manual" as const, selection: "Chord mode" as const, melody: "Use right-hand part" as const, label: "User-confirmed right-hand melody plus accompaniment" },
    ];
    for (const mode of modes) {
      try {
        await page.goto(`/player/${candidate.id}`);
        await expect(page.getByLabel("Falling notes player")).toBeVisible();
        await selectArrangement(page, mode.selection, mode.melody);
        await bootAudio(page);
        const label = `${labelPrefix}-${mode.key}`;
        const capture = await captureReservedArrangement(page, testInfo, label, outcome.seekSeconds, outcome.durationMs);
        audible(capture);
        const summary = reservedCaptureSummary(label, capture, originalCaptures.get(candidate.id), outcome.seekSeconds, outcome.durationMs, mode.label, outcome.producer[mode.key]);
        outcome[mode.key] = summary;
        if (mode.key === "original") originalCaptures.set(candidate.id, capture);
      } catch (error) {
        outcome[mode.key] = {
          status: "error",
          modeLabel: mode.label,
          humanRating: "pending",
          seekSeconds: outcome.seekSeconds,
          durationMs: outcome.durationMs,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const packet = {
    schemaVersion: 2,
    candidateCommit: FROZEN_CANDIDATE_COMMIT,
    instrument: "browser AudioEngine synth",
    sourceSelectionFrozenBeforeCandidatePlayback: true,
    tuningPerformedOnReservedOutputs: false,
    humanRating: "pending",
    repeatControl: {
      songId: SONG_ID,
      mode: "Original arrangement",
      seekSeconds: controlStartSeconds,
      durationMs: controlDurationMs,
      first: controlOriginalOutcome,
      repeat: controlRepeatOutcome,
      interpretation: controlRepeatOutcome?.status === "captured"
        && !controlRepeatOutcome.scheduledEventMultisetChanged
        && controlRepeatOutcome.alignedPcmComparison?.withinTolerance
        ? "Repeat metrics stayed within tolerance; capture metrics are a secondary check."
        : "Repeat metrics varied; capture metrics are observed capture variation only. Arrangement change relies on deterministic producer [midi,start,dur,vel] multisets.",
    },
    outcomes,
  };
  writeFileSync(testInfo.outputPath("reserved-evaluation-outcomes.json"), JSON.stringify(packet, null, 2));
  expect(controlOriginalOutcome?.status, "Original repeat control first capture").toBe("captured");
  expect(controlRepeatOutcome?.status, "Original repeat control repeat capture").toBe("captured");
  for (const outcome of outcomes) {
    expect(outcome.original?.status, `${outcome.candidate.id} Original`).toBe("captured");
    expect(outcome.automatic?.status, `${outcome.candidate.id} automatic`).toBe("captured");
    expect(outcome.manual?.status, `${outcome.candidate.id} manual`).toBe("captured");
    expect(outcome.automatic?.producerEventMultisetChanged, `${outcome.candidate.id} automatic producer output must change deterministically`).toBe(true);
    const additional = outcome.producer.retrospectiveAdditionalEvaluation;
    expect(additional.selectionBasis).toContain("not an untouched holdout");
    expect(additional.automatic.windowEndBeat <= outcome.candidate.window.startBeat
      || additional.automatic.windowStartBeat >= outcome.candidate.window.endBeat).toBe(true);
  }
});
