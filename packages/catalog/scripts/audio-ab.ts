/**
 * Audio conditioning A/B testing.
 *
 * Compares transcription quality across raw, level-normalized, and
 * high-pass-filtered audio.  Measures note count, pitch coverage,
 * onset density, and runtime for each conditioning variant.
 *
 * When actual audio files are not available, the script synthesizes
 * mock metrics so the output format can be validated in CI.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/audio-ab.ts <audio-dir> [--basic-pitch <path>]
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, type Note } from "@keyspilli/midi";
import { ROOT } from "../src/paths.js";

const execFileP = promisify(execFile);
const BASIC_PITCH = process.env.KEYSPILLI_BASIC_PITCH ?? join(ROOT, "services", "transcribe", ".venv", "bin", "basic-pitch");
const BP_TIMEOUT_MS = 300_000;

export type ConditionName = "raw" | "normalized" | "highpass";

export interface ABMetrics {
  noteCount: number;
  pitchCoverage: number;
  onsetDensity: number;
  maxSimultaneous: number;
  durationSeconds: number;
}

export interface ABResult {
  audioFile: string;
  condition: ConditionName;
  runtimeMs: number;
  metrics: ABMetrics;
  midiPath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Metric helpers (inlined for script independence)
// ---------------------------------------------------------------------------

function pitchCoverage(notes: Note[]): number {
  if (!notes.length) return 0;
  const used = new Set(notes.map((n) => n.midi));
  let covered = 0;
  for (let m = 21; m <= 108; m++) {
    if (used.has(m)) covered++;
  }
  return covered / 87;
}

function maxSimultaneous(notes: Note[]): number {
  const events: Array<[number, number]> = [];
  for (const n of notes) {
    events.push([n.start, 1]);
    events.push([n.start + n.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let mx = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > mx) mx = cur;
  }
  return mx;
}

export function computeMetrics(notes: Note[], tempoBpm: number): ABMetrics {
  const secPerBeat = 60 / tempoBpm;
  const durationBeats = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const durationSeconds = durationBeats * secPerBeat;
  return {
    noteCount: notes.length,
    pitchCoverage: pitchCoverage(notes),
    onsetDensity: durationSeconds > 0 ? notes.length / durationSeconds : 0,
    maxSimultaneous: maxSimultaneous(notes),
    durationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Audio conditioning
// ---------------------------------------------------------------------------

async function normalizeAudio(input: string, outDir: string): Promise<string> {
  const out = join(outDir, "normalized.wav");
  await execFileP("ffmpeg", [
    "-y", "-i", input,
    "-af", "loudnorm=I=-1.0:TP=-1.5:LRA=11",
    "-ar", "22050", "-ac", "1", out,
  ], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return out;
}

async function highpassAudio(input: string, outDir: string): Promise<string> {
  const out = join(outDir, "highpass.wav");
  await execFileP("ffmpeg", [
    "-y", "-i", input,
    "-af", "highpass=f=100",
    "-ar", "22050", "-ac", "1", out,
  ], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return out;
}

async function runBP(audioPath: string, outDir: string): Promise<Uint8Array> {
  await execFileP(BASIC_PITCH, [
    outDir, audioPath, "--save-midi",
    "--onset-threshold", "0.65",
    "--frame-threshold", "0.45",
  ], { timeout: BP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  const midiPath = join(outDir, "audio_basic_pitch.mid");
  return new Uint8Array(await readFile(midiPath));
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

export function mockResult(audioFile: string, condition: ConditionName): ABResult {
  const seed = audioFile.length + condition.length;
  const notes = 80 + (seed * 17) % 200;
  const tempo = 90 + (seed * 13) % 60;
  const secPerBeat = 60 / tempo;
  const durationBeats = 100 + (seed * 7) % 100;
  const durationSec = durationBeats * secPerBeat;
  return {
    audioFile,
    condition,
    runtimeMs: 0,
    metrics: {
      noteCount: notes,
      pitchCoverage: 0.15 + (seed % 20) / 100,
      onsetDensity: notes / durationSec,
      maxSimultaneous: 1 + (seed % 5),
      durationSeconds: durationSec,
    },
    error: "mock-data",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/* istanbul ignore next -- only runs when executed as a script */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: audio-ab.ts <audio-dir> [--basic-pitch <path>]");
    process.exit(1);
  }

  const audioDir = args[0]!;

  let audioFiles: string[];
  try {
    const entries = await readdir(audioDir);
    audioFiles = entries.filter((f) => /\.(mp3|m4a|wav|flac|ogg|webm)$/i.test(f));
  } catch {
    console.error(`Audio directory not found: ${audioDir}`);
    process.exit(1);
  }

  if (!audioFiles.length) {
    console.error(`No audio files in ${audioDir}`);
    process.exit(1);
  }

  let ffmpegOk = false;
  try {
    await execFileP("ffmpeg", ["-version"], { timeout: 5_000 });
    ffmpegOk = true;
  } catch { /* not available */ }

  let bpOk = false;
  try {
    await execFileP(BASIC_PITCH, ["--help"], { timeout: 5_000 });
    bpOk = true;
  } catch { /* not available */ }

  const useMocks = !ffmpegOk || !bpOk;
  if (useMocks) console.error("ffmpeg or Basic Pitch not available; using mock data");

  const conditions: ConditionName[] = ["raw", "normalized", "highpass"];
  const results: ABResult[] = [];

  for (const audioFile of audioFiles) {
    const audioPath = join(audioDir, audioFile);
    const baseName = audioFile.replace(/\.[^.]+$/, "");

    if (useMocks) {
      for (const cond of conditions) {
        results.push(mockResult(audioFile, cond));
      }
      continue;
    }

    const tmpDir = join(audioDir, `.ab-tmp-${baseName}`);
    await execFileP("mkdir", ["-p", tmpDir]);

    const sources: Record<ConditionName, () => Promise<string>> = {
      raw: async () => audioPath,
      normalized: async () => normalizeAudio(audioPath, tmpDir),
      highpass: async () => highpassAudio(audioPath, tmpDir),
    };

    for (const cond of conditions) {
      const t0 = Date.now();
      try {
        const src = await sources[cond]();
        const midiBuf = await runBP(src, tmpDir);
        const parsed = parseMidi(midiBuf);
        const metrics = computeMetrics(parsed.notes, parsed.tempoBpm);
        results.push({ audioFile, condition: cond, runtimeMs: Date.now() - t0, metrics });
      } catch (e) {
        results.push({
          audioFile, condition: cond, runtimeMs: Date.now() - t0,
          metrics: computeMetrics([], 120),
          error: (e as Error).message,
        });
      }
    }

    await execFileP("rm", ["-rf", tmpDir]).catch(() => {});
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: useMocks ? "mock" : "live",
    audioFileCount: audioFiles.length,
    conditions,
    results,
  }, null, 2));

  console.error("\n--- A/B Summary ---");
  console.error(
    "File".padEnd(35) + "Condition".padEnd(14) +
    "Notes".padStart(8) + "PitchCov".padStart(10) +
    "Density".padStart(10) + "MaxSim".padStart(8) + "Runtime".padStart(10),
  );
  for (const r of results) {
    const f = r.audioFile.length > 33 ? r.audioFile.slice(0, 30) + "..." : r.audioFile;
    console.error(
      f.padEnd(35) + r.condition.padEnd(14) +
      String(r.metrics.noteCount).padStart(8) + r.metrics.pitchCoverage.toFixed(3).padStart(10) +
      r.metrics.onsetDensity.toFixed(2).padStart(10) + String(r.metrics.maxSimultaneous).padStart(8) +
      (r.runtimeMs > 0 ? `${r.runtimeMs}ms` : "mock").padStart(10) +
      (r.error ? ` [${r.error}]` : ""),
    );
  }
}

if (process.argv[1]?.endsWith("audio-ab.ts")) await main();
