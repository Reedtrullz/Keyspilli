#!/usr/bin/env node
/** Build a local-only deterministic 90–150 second blind A/B listening bundle. */
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createFluidSynthRenderer, type MidiAudioRenderer } from "../src/midi-renderer.js";
import {
  buildRotatingListeningBundle,
  type RotatingListeningBundleOptions,
  type RotatingListeningSongDescriptor,
} from "../src/rotating-listening-bundle.js";

interface CliOptions {
  songs: string;
  out: string;
  help?: boolean;
  seed?: string;
  targetSeconds?: number;
  minSeconds?: number;
  maxSeconds?: number;
  soundfont?: string;
  executable?: string;
  sampleRate?: number;
  gain?: number;
  targetPeak?: number;
}

function usage(): string {
  return [
    "Usage: build-rotating-listening-bundle.ts --songs FILE --out DIR [options]",
    "",
    "--songs FILE          JSON array (or {songs: [...]}) of explicit song descriptors",
    "--out DIR             Derived output directory outside this repository",
    "--seed VALUE          Stable rotation seed (default default)",
    "--target-seconds N    Target listening duration (default 120; bounded 90–150)",
    "--min-seconds N       Minimum listening duration (default 90)",
    "--max-seconds N       Maximum listening duration (default 150)",
    "--soundfont FILE      Local SoundFont (or KEYSPILLI_SOUNDFONT)",
    "--executable FILE     FluidSynth executable (or KEYSPILLI_FLUIDSYNTH)",
    "--sample-rate N       Output sample rate (default 44100)",
    "--gain N              FluidSynth gain (default 1)",
    "--target-peak N       PCM peak target 0..1 (default 0.95)",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function pathValue(value: string, flag: string): string {
  if (!isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`${flag} must be an absolute local path without NUL/newline characters`);
  return resolve(value);
}

function numberValue(value: string, flag: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${flag} must be finite`);
  return result;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const result: CliOptions = { songs: "", out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const equals = argument.indexOf("=");
    const flag = equals >= 0 ? argument.slice(0, equals) : argument;
    const inline = equals >= 0 ? argument.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--songs": result.songs = pathValue(value(), flag); break;
      case "--out": result.out = pathValue(value(), flag); break;
      case "--seed": result.seed = value(); break;
      case "--target-seconds": result.targetSeconds = numberValue(value(), flag); break;
      case "--min-seconds": result.minSeconds = numberValue(value(), flag); break;
      case "--max-seconds": result.maxSeconds = numberValue(value(), flag); break;
      case "--soundfont": result.soundfont = pathValue(value(), flag); break;
      case "--executable": result.executable = pathValue(value(), flag); break;
      case "--sample-rate": result.sampleRate = numberValue(value(), flag); break;
      case "--gain": result.gain = numberValue(value(), flag); break;
      case "--target-peak": result.targetPeak = numberValue(value(), flag); break;
      case "--help": case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${argument}`);
    }
  }
  if (result.help) return result;
  if (!result.songs || !result.out) throw new Error(`--songs and --out are required\n\n${usage()}`);
  return result;
}

function pathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent).replace(/[\\/]$/, "");
  return c === p || c.startsWith(`${p}${sep}`);
}

async function rejectRepositoryInput(path: string): Promise<void> {
  const repository = await realpath(resolve(dirname(new URL(import.meta.url).pathname), "../../.."));
  const canonical = await realpath(path).catch(async () => join(await realpath(dirname(path)), path.slice(dirname(path).length + 1)));
  if (pathInside(canonical, repository)) throw new Error("--songs must be outside the repository");
  const info = await stat(canonical).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`songs descriptor is unavailable: ${path}`);
}

function descriptorList(value: unknown): RotatingListeningSongDescriptor[] {
  const source = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { songs?: unknown }).songs) ? (value as { songs: unknown[] }).songs : null;
  if (!source) throw new Error("songs descriptor must be a JSON array or an object containing songs");
  return source as RotatingListeningSongDescriptor[];
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  await rejectRepositoryInput(options.songs);
  const songs = descriptorList(JSON.parse(await readFile(options.songs, "utf8")) as unknown);
  let renderer: MidiAudioRenderer | undefined;
  const soundfont = options.soundfont ?? process.env.KEYSPILLI_SOUNDFONT;
  if (soundfont || options.executable || process.env.KEYSPILLI_FLUIDSYNTH) {
    renderer = createFluidSynthRenderer({
      ...(soundfont ? { soundfontPath: soundfont } : {}),
      ...(options.executable ? { executable: options.executable } : {}),
      ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
      ...(options.gain !== undefined ? { gain: options.gain } : {}),
      ...(options.targetPeak !== undefined ? { targetPeak: options.targetPeak } : {}),
    });
  }
  const buildOptions: RotatingListeningBundleOptions = {
    songs,
    outputRoot: options.out,
    seed: options.seed,
    targetSeconds: options.targetSeconds,
    minSeconds: options.minSeconds,
    maxSeconds: options.maxSeconds,
    ...(options.sampleRate !== undefined ? { normalization: { sampleRate: options.sampleRate } } : {}),
  };
  const result = await buildRotatingListeningBundle(buildOptions, { renderer });
  process.stdout.write(`${JSON.stringify({ manifest: result.manifestPath, blindMap: result.blindMapPath, worksheet: result.worksheetPath, status: result.manifest.status, totalSeconds: result.manifest.totalSeconds }, null, 2)}\n`);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
