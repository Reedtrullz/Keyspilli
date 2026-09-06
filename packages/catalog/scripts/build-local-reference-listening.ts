#!/usr/bin/env node
/**
 * Materialize local listening renders for an explicitly supplied reference
 * MIDI. This is intentionally separate from catalog ingestion and the
 * symbolic reference builder: it reads local files, writes derived evidence
 * below --out, and never uploads, downloads, or mutates the source.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFluidSynthRenderer,
  type MidiAudioRenderer,
} from "../src/midi-renderer.js";
import {
  buildLocalReferenceListening,
  localReferenceListeningJson,
  type LocalReferenceListeningInput,
  type LocalReferenceListeningReport,
} from "../src/local-reference-listening.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface LocalReferenceListeningCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface LocalReferenceListeningCliOptions {
  out: string;
  referenceMidi: string;
  id: string;
  title?: string;
  reviewQueue?: string;
  soundfont?: string;
  executable?: string;
  sampleRate?: number;
  gain?: number;
  targetPeak?: number;
  timeoutMs: number;
  excerptSeconds?: number;
  help: boolean;
}

export interface LocalReferenceListeningCliDependencies {
  /** Test seam; normal CLI execution constructs the local FluidSynth adapter. */
  renderer?: MidiAudioRenderer;
}

function usage(): string {
  return [
    "Usage: build-local-reference-listening.ts --reference-midi FILE --out DIR [options]",
    "",
    "Required:",
    "  --reference-midi FILE  explicit local MIDI reference (read-only)",
    "  --out DIR              derived listening output root (outside repository)",
    "",
    "Metadata and review:",
    "  --id ID                 logical score id (default: reference)",
    "  --title TEXT            logical title shown in the review index",
    "  --review-queue FILE    optional local OMR review queue JSON",
    "",
    "Renderer settings:",
    "  --soundfont FILE       local SoundFont (or KEYSPILLI_SOUNDFONT)",
    "  --executable FILE      FluidSynth executable (or KEYSPILLI_FLUIDSYNTH)",
    "  --sample-rate N        PCM sample rate (default 44100)",
    "  --gain N               FluidSynth gain (default 1)",
    "  --target-peak N        normalized peak target (default 0.95)",
    "  --timeout-ms N         bounded renderer timeout (default 600000)",
    "  --excerpt-seconds N    opening excerpt length (default 30)",
    "  --help                 show this help",
    "",
    "The command is local-only. It never writes to the source MIDI, catalog, or production runtime.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function logicalId(value: string): string {
  const id = value.trim();
  if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\") || /[\0\r\n]/.test(id)) {
    throw new Error("--id must be a non-empty path-safe logical id");
  }
  return id;
}

function logicalTitle(value: string): string {
  const title = value.replace(/[\0\r\n]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.includes("/") || title.includes("\\") || /^file:/i.test(title)) {
    throw new Error("--title must be a logical label, not a path");
  }
  return title.slice(0, 240);
}

function localPath(value: string, flag: string): string {
  if (!value.trim() || value.includes("\0") || /[\r\n]/.test(value)) throw new Error(`${flag} contains an unsafe path value`);
  if (!isAbsolute(value)) throw new Error(`${flag} must be an absolute local path`);
  return value;
}

function finiteNumber(value: string, flag: string, valid: (candidate: number) => boolean): number {
  const candidate = Number(value);
  if (!Number.isFinite(candidate) || !valid(candidate)) throw new Error(`${flag} is invalid`);
  return candidate;
}

function integerTimeout(value: string): number {
  return finiteNumber(value, "--timeout-ms", (candidate) => Number.isInteger(candidate) && candidate > 0 && candidate <= MAX_TIMEOUT_MS);
}

/** Parse CLI arguments without touching the filesystem. */
export function parseLocalReferenceListeningArgs(argv: readonly string[]): LocalReferenceListeningCliOptions {
  const result: LocalReferenceListeningCliOptions = {
    out: "",
    referenceMidi: "",
    id: "reference",
    timeoutMs: 600_000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--out": result.out = localPath(value(), "--out"); break;
      case "--reference-midi": result.referenceMidi = localPath(value(), "--reference-midi"); break;
      case "--id": result.id = logicalId(value()); break;
      case "--title": result.title = logicalTitle(value()); break;
      case "--review-queue": result.reviewQueue = localPath(value(), "--review-queue"); break;
      case "--soundfont": result.soundfont = localPath(value(), "--soundfont"); break;
      case "--executable": result.executable = localPath(value(), "--executable"); break;
      case "--sample-rate": result.sampleRate = finiteNumber(value(), "--sample-rate", (candidate) => Number.isInteger(candidate) && candidate >= 8_000 && candidate <= 192_000); break;
      case "--gain": result.gain = finiteNumber(value(), "--gain", (candidate) => candidate > 0 && candidate <= 10); break;
      case "--target-peak": result.targetPeak = finiteNumber(value(), "--target-peak", (candidate) => candidate > 0 && candidate <= 1); break;
      case "--timeout-ms": result.timeoutMs = integerTimeout(value()); break;
      case "--excerpt-seconds": result.excerptSeconds = finiteNumber(value(), "--excerpt-seconds", (candidate) => candidate > 0 && candidate <= 24 * 60 * 60); break;
      case "--help": case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (result.help) return result;
  if (!result.out) throw new Error(`--out is required\n\n${usage()}`);
  if (!result.referenceMidi) throw new Error(`--reference-midi is required\n\n${usage()}`);
  return result;
}

function sanitizeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(?:file:\/\/)?(?:\/(?:Users|private|tmp|var|home|Volumes)\/[^\s"']+|[A-Za-z]:[\\/][^\s"']+)/g, "[redacted-path]")
    .replace(/[\0\r\n]+/g, " ")
    .slice(0, 500);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].sort();
}

function stringRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string[]> = {};
  for (const [key, entries] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const values = stringList(entries);
    if (values.length) output[key.trim() || "unknown"] = values;
  }
  return output;
}

function reviewContext(value: unknown): Record<string, unknown> {
  const source = record(value) ?? {};
  const structural = record(source.structural) ?? {};
  const timeSig = Array.isArray(source.timeSignature) && source.timeSignature.length === 2
    && finiteOrNull(source.timeSignature[0]) !== null && finiteOrNull(source.timeSignature[1]) !== null
    ? [source.timeSignature[0], source.timeSignature[1]]
    : null;
  return {
    keySignature: finiteOrNull(source.keySignature),
    timeSignature: timeSig,
    startBeat: finiteOrNull(source.startBeat) ?? 0,
    durationBeats: Math.max(0, finiteOrNull(source.durationBeats) ?? 0),
    structural: {
      agreement: finiteOrNull(structural.agreement),
      evidence: stringList(structural.evidence),
    },
  };
}

async function loadReviewQueue(path: string | undefined): Promise<LocalReferenceListeningInput["reviewQueue"]> {
  if (!path) return null;
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const source = record(parsed);
  if (!source || !Array.isArray(source.items)) throw new Error("review queue must contain an items array");
  const items = source.items.map((value, index) => {
    const item = record(value);
    if (!item) throw new Error(`review queue item ${index + 1} is malformed`);
    const evidence = Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === "string") : [];
    return {
      id: stringValue(item.id, `review-${index + 1}`),
      page: typeof item.page === "number" && Number.isFinite(item.page) ? item.page : null,
      system: typeof item.system === "number" && Number.isFinite(item.system) ? item.system : null,
      measureId: stringValue(item.measureId, stringValue(item.id, `measure-${index + 1}`)),
      measureNumber: stringValue(item.measureNumber, "unknown"),
      role: stringValue(item.role, "unknown"),
      evidence,
      reasonCategory: stringValue(item.reasonCategory, "unknown"),
      backendValues: stringRecord(item.backendValues),
      backendInterpretations: stringRecord(item.backendInterpretations),
      context: reviewContext(item.context),
      recommendedAction: stringValue(item.recommendedAction, "Human-review this unresolved region."),
    } as never;
  });
  const unresolvedRegions = Array.isArray(source.unresolvedRegions)
    ? source.unresolvedRegions.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { items, unresolvedRegions };
}

export async function runLocalReferenceListeningCli(
  argv: readonly string[],
  io: LocalReferenceListeningCliIo = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(`${value}\n`) },
  dependencies: LocalReferenceListeningCliDependencies = {},
): Promise<number> {
  let options: LocalReferenceListeningCliOptions;
  try {
    options = parseLocalReferenceListeningArgs(argv);
  } catch (error) {
    io.stderr(sanitizeError(error));
    return 2;
  }
  if (options.help) {
    io.stdout(`${usage()}\n`);
    return 0;
  }
  try {
    const reviewQueue = await loadReviewQueue(options.reviewQueue);
    const renderer = dependencies.renderer ?? createFluidSynthRenderer({
      soundfontPath: options.soundfont,
      executable: options.executable,
      sampleRate: options.sampleRate,
      gain: options.gain,
      targetPeak: options.targetPeak,
      timeoutMs: options.timeoutMs,
    });
    const report: LocalReferenceListeningReport = await buildLocalReferenceListening({
      scoreId: options.id,
      ...(options.title ? { title: options.title } : {}),
      referenceMidiPath: options.referenceMidi,
      reviewQueue,
    }, {
      outputRoot: options.out,
      repositoryRoot: REPOSITORY_ROOT,
      renderer,
      ...(options.excerptSeconds === undefined ? {} : { excerptSeconds: options.excerptSeconds }),
    });
    io.stdout(localReferenceListeningJson(report));
    return report.status === "UNAVAILABLE" ? 1 : 0;
  } catch (error) {
    io.stderr(sanitizeError(error));
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runLocalReferenceListeningCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
