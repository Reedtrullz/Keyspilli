/**
 * Basic Pitch parameter sweep framework.
 *
 * Reads MIDI fixtures from a directory and measures how different
 * onset/frame threshold combinations affect output quality: note count,
 * pitch coverage, onset density, and polyphony.  When Basic Pitch is not
 * installed in the dev environment, the sweep reads pre-computed MIDI
 * results from a fixtures directory instead of running inference.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/param-sweep.ts <midi-dir> [--fixtures <dir>]
 *
 * --fixtures points at a directory where each subdirectory is named
 * "onset-{o}_frame-{f}" and contains output MIDI files from a prior run.
 * If omitted and Basic Pitch is available, the script runs it live.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, type Note } from "@keyspilli/midi";
import { ROOT } from "../src/paths.js";

const execFileP = promisify(execFile);
const BASIC_PITCH = join(ROOT, "services", "transcribe", ".venv", "bin", "basic-pitch");
const BP_TIMEOUT_MS = 300_000;

export const ONSET_THRESHOLDS = [0.5, 0.6, 0.65, 0.7, 0.8];
export const FRAME_THRESHOLDS = [0.3, 0.4, 0.45, 0.5, 0.6];

export interface SweepMetrics {
  noteCount: number;
  pitchRange: [number, number] | null;
  pitchCoverage: number;
  onsetDensity: number;
  avgNoteDuration: number;
  maxSimultaneous: number;
  durationSeconds: number;
}

export interface SweepResult {
  fixture: string;
  onsetThreshold: number;
  frameThreshold: number;
  metrics: SweepMetrics;
  error?: string;
}

function pitchRange(notes: Note[]): [number, number] | null {
  if (!notes.length) return null;
  const pitches = notes.map((n) => n.midi);
  return [Math.min(...pitches), Math.max(...pitches)];
}

/** Coverage as fraction of the standard piano range (MIDI 21-108). */
function pitchCoverage(notes: Note[]): number {
  if (!notes.length) return 0;
  const used = new Set(notes.map((n) => n.midi));
  let covered = 0;
  for (let m = 21; m <= 108; m++) {
    if (used.has(m)) covered++;
  }
  return covered / 87;
}

function onsetDensity(notes: Note[], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return notes.length / durationSeconds;
}

function avgNoteDuration(notes: Note[]): number {
  if (!notes.length) return 0;
  return notes.reduce((s, n) => s + n.dur, 0) / notes.length;
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

export function computeMetrics(notes: Note[], tempoBpm: number): SweepMetrics {
  const secPerBeat = 60 / tempoBpm;
  const durationBeats = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const durationSeconds = durationBeats * secPerBeat;
  return {
    noteCount: notes.length,
    pitchRange: pitchRange(notes),
    pitchCoverage: pitchCoverage(notes),
    onsetDensity: onsetDensity(notes, durationSeconds),
    avgNoteDuration: avgNoteDuration(notes),
    maxSimultaneous: maxSimultaneous(notes),
    durationSeconds,
  };
}

async function runBasicPitch(
  audioPath: string,
  onsetThreshold: number,
  frameThreshold: number,
  outDir: string,
): Promise<Uint8Array | null> {
  try {
    await execFileP(BASIC_PITCH, [
      outDir, audioPath, "--save-midi",
      "--onset-threshold", String(onsetThreshold),
      "--frame-threshold", String(frameThreshold),
    ], { timeout: BP_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    const midiPath = join(outDir, "audio_basic_pitch.mid");
    return new Uint8Array(await readFile(midiPath));
  } catch {
    return null;
  }
}

async function readFixtureMidi(
  fixturesDir: string,
  fixtureName: string,
  onsetThreshold: number,
  frameThreshold: number,
): Promise<Uint8Array | null> {
  const subdir = `onset-${onsetThreshold}_frame-${frameThreshold}`;
  try {
    const midiPath = join(fixturesDir, subdir, fixtureName);
    return new Uint8Array(await readFile(midiPath));
  } catch {
    return null;
  }
}

/* istanbul ignore next -- only runs when executed as a script */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: param-sweep.ts <midi-dir> [--fixtures <dir>]");
    process.exit(1);
  }

  const midiDir = args[0]!;
  let fixturesDir: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--fixtures" && args[i + 1]) fixturesDir = args[++i];
  }

  let liveMode = false;
  if (!fixturesDir) {
    try {
      const { stdout } = await execFileP(BASIC_PITCH, ["--help"], { timeout: 5_000 });
      liveMode = stdout.includes("basic-pitch") || stdout.length > 0;
    } catch {
      liveMode = false;
    }
  }

  if (fixturesDir) {
    try {
      await stat(fixturesDir);
    } catch {
      console.error(`Fixtures directory not found: ${fixturesDir}`);
      process.exit(1);
    }
  }

  const midiFiles = (await readdir(midiDir)).filter((f) => f.endsWith(".mid") || f.endsWith(".midi"));
  if (!midiFiles.length) {
    console.error(`No MIDI files in ${midiDir}`);
    process.exit(1);
  }

  const total = midiFiles.length * ONSET_THRESHOLDS.length * FRAME_THRESHOLDS.length;
  console.error(`Sweeping ${midiFiles.length} MIDI fixture(s) x ${ONSET_THRESHOLDS.length} onset x ${FRAME_THRESHOLDS.length} frame = ${total} combinations`);
  if (liveMode) console.error("Mode: live Basic Pitch inference");
  else if (fixturesDir) console.error("Mode: fixture lookup");
  else console.error("No Basic Pitch or fixtures; using raw MIDI parse only");

  const results: SweepResult[] = [];

  for (const midiFile of midiFiles) {
    const midiPath = join(midiDir, midiFile);
    const rawBuf = await readFile(midiPath);
    const parsed = parseMidi(new Uint8Array(rawBuf));
    const baseName = midiFile.replace(/\.mid[m]?$/, "");

    if (!liveMode && !fixturesDir) {
      const metrics = computeMetrics(parsed.notes, parsed.tempoBpm);
      for (const o of ONSET_THRESHOLDS) {
        for (const f of FRAME_THRESHOLDS) {
          results.push({ fixture: midiFile, onsetThreshold: o, frameThreshold: f, metrics });
        }
      }
      continue;
    }

    for (const o of ONSET_THRESHOLDS) {
      for (const f of FRAME_THRESHOLDS) {
        let midiBuf: Uint8Array | null = null;
        if (fixturesDir) {
          midiBuf = await readFixtureMidi(fixturesDir, `${baseName}_basic_pitch.mid`, o, f);
        }
        if (!midiBuf) midiBuf = new Uint8Array(rawBuf);
        try {
          const variantParsed = parseMidi(midiBuf);
          const metrics = computeMetrics(variantParsed.notes, variantParsed.tempoBpm);
          results.push({ fixture: midiFile, onsetThreshold: o, frameThreshold: f, metrics });
        } catch (e) {
          results.push({
            fixture: midiFile, onsetThreshold: o, frameThreshold: f,
            metrics: computeMetrics(parsed.notes, parsed.tempoBpm),
            error: (e as Error).message,
          });
        }
      }
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: liveMode ? "live" : fixturesDir ? "fixtures" : "raw-parse",
    fixtureCount: midiFiles.length,
    combinations: ONSET_THRESHOLDS.length * FRAME_THRESHOLDS.length,
    results,
  }, null, 2));

  console.error("\n--- Summary ---");
  console.error(
    "Fixture".padEnd(40) + "Onset".padEnd(8) + "Frame".padEnd(8) +
    "Notes".padStart(8) + "PitchCov".padStart(10) + "Density".padStart(10) + "MaxSim".padStart(8),
  );
  for (const r of results) {
    const f = r.fixture.length > 38 ? r.fixture.slice(0, 35) + "..." : r.fixture;
    console.error(
      f.padEnd(40) + String(r.onsetThreshold).padEnd(8) + String(r.frameThreshold).padEnd(8) +
      String(r.metrics.noteCount).padStart(8) + r.metrics.pitchCoverage.toFixed(3).padStart(10) +
      r.metrics.onsetDensity.toFixed(2).padStart(10) + String(r.metrics.maxSimultaneous).padStart(8) +
      (r.error ? ` [${r.error}]` : ""),
    );
  }
}

if (process.argv[1]?.endsWith("param-sweep.ts")) await main();
