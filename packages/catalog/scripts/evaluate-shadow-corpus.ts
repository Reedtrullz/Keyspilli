#!/usr/bin/env node

/**
 * Local-only evaluator for the bounded shadow corpus.
 *
 * The CLI intentionally accepts an explicit manifest path and never performs
 * discovery, downloading, catalog writes, or production calls.  Symbolic
 * paths are read only to build an in-memory item; the emitted report contains
 * logical ids and metrics, not physical paths or note payloads.
 *
 * Example:
 *   node --import tsx packages/catalog/scripts/evaluate-shadow-corpus.ts \
 *     --manifest /private/tmp/shadow/manifest.json \
 *     --item synthetic-full-band \
 *     --out /private/tmp/shadow/report.json
 */
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi, type ParsedMidi } from "@keyspilli/midi";
import {
  canonicalShadowEvaluationJson,
  evaluateShadowCorpus,
  type ShadowCorpusItemInput,
  type ShadowCorpusManifestInput,
} from "../src/shadow-evaluation.js";

interface CliOptions {
  manifest: string;
  out?: string;
  itemIds: string[];
}

/** Status is authoritative for shell callers: ready=0, not-ready=1, blocked=2. */
function statusExitCode(status: unknown): number {
  return status === "SHADOW_ENGINEERING_READY" ? 0
    : status === "SHADOW_ENGINEERING_NOT_READY" ? 1
      : 2;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(): string {
  return [
    "Usage: evaluate-shadow-corpus.ts --manifest FILE [options]",
    "  --manifest FILE   explicit local shadow manifest JSON",
    "  --item ID         evaluate one item (repeatable); default is all",
    "  --out FILE        write deterministic JSON here; otherwise stdout",
  ].join("\n");
}

function nextValue(args: string[], index: number, option: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = { manifest: "", itemIds: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const option = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const [next, nextIndex] = nextValue(argv, index, option);
      index = nextIndex;
      return next;
    };
    switch (option) {
      case "--manifest": result.manifest = value(); break;
      case "--item": result.itemIds.push(value()); break;
      case "--out": result.out = value(); break;
      case "--help": case "-h": console.log(usage()); process.exit(0); break;
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!result.manifest) throw new Error("--manifest is required\n" + usage());
  if (result.itemIds.some((id) => !id.trim())) throw new Error("--item ids must be non-empty");
  return result;
}

function rejectRepositoryPath(path: string, label: string): void {
  const repoRelative = relative(REPO_ROOT, path);
  if (repoRelative === "" || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))) {
    throw new Error(`${label} must be outside the repository; keep shadow media local-only`);
  }
}

async function regularFile(path: string, label: string): Promise<string> {
  const resolved = await realpath(resolve(path));
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  return resolved;
}

async function outputFile(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("--out must be an absolute local path outside the repository");
  const resolved = resolve(path);
  rejectRepositoryPath(resolved, "shadow report");
  try {
    const existing = await realpath(resolved);
    rejectRepositoryPath(existing, "shadow report");
    if ((await stat(existing)).isDirectory()) throw new Error("--out must name a report file, not a directory");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("--out")) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw new Error("--out could not be inspected");
  }
  await mkdir(dirname(resolved), { recursive: true });
  const parent = await realpath(dirname(resolved));
  rejectRepositoryPath(parent, "shadow report");
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function localPath(value: unknown, baseDirectory: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const resolved = resolve(baseDirectory, value);
  rejectRepositoryPath(resolved, "shadow media");
  return resolved;
}

async function parseLocalMidi(path: string): Promise<ParsedMidi> {
  const bytes = new Uint8Array(await readFile(path));
  return parseMidi(bytes);
}

/** Resolve adapter-only local paths without adding them to report data. */
async function hydrateItem(raw: ShadowCorpusItemInput, baseDirectory: string): Promise<ShadowCorpusItemInput> {
  const item = { ...raw };
  const rawRecord = raw as Record<string, unknown>;
  // Manifests written for the local adapter commonly use the concise
  // `symbolic: "relative/path.mid"` form. Normalize that form to the same
  // private media record used by the richer `{ path, status }` shape before
  // validating the item; the physical path never reaches the report.
  const symbolicRecord = isRecord(raw.symbolic)
    ? { ...raw.symbolic }
    : typeof rawRecord.symbolic === "string"
      ? { path: rawRecord.symbolic }
      : raw.symbolic;
  const audioRecord = isRecord(raw.audio)
    ? { ...raw.audio }
    : typeof rawRecord.audio === "string"
      ? { path: rawRecord.audio }
      : raw.audio;
  const symbolicPath = localPath(
    (isRecord(symbolicRecord) ? symbolicRecord.path : undefined)
      ?? raw.symbolicPath
      ?? rawRecord.symbolicFile,
    baseDirectory,
  );
  if (symbolicPath && isRecord(symbolicRecord)) {
    const parsed = await parseLocalMidi(symbolicPath);
    const status = typeof symbolicRecord.status === "string" ? symbolicRecord.status : "available";
    item.symbolic = { ...symbolicRecord, parsed, status } as ShadowCorpusItemInput["symbolic"];
    item.parsed = parsed;
  } else if (symbolicPath) {
    item.parsed = await parseLocalMidi(symbolicPath);
  }
  if (isRecord(audioRecord)) item.audio = audioRecord as ShadowCorpusItemInput["audio"];
  if (Array.isArray(raw.tracks)) {
    const tracks = [];
    for (const track of raw.tracks) {
      if (!track || typeof track !== "object") {
        tracks.push(track);
        continue;
      }
      const copy = { ...track } as NonNullable<ShadowCorpusItemInput["tracks"]>[number];
      const trackPath = localPath((track as { path?: unknown }).path, baseDirectory);
      if (trackPath) {
        copy.parsed = await parseLocalMidi(trackPath);
        copy.notes = copy.parsed.notes;
      }
      tracks.push(copy);
    }
    item.tracks = tracks;
  }
  return item;
}

async function run(options: CliOptions): Promise<string> {
  const manifestPath = await regularFile(options.manifest, "shadow manifest");
  rejectRepositoryPath(manifestPath, "shadow manifest");
  const outputPathValue = options.out ? await outputFile(options.out) : undefined;
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("shadow manifest must be a JSON object");
  if (!Array.isArray(raw.items)) throw new Error("shadow manifest items must be an array");
  const hydratedItems = await Promise.all(raw.items.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return item as ShadowCorpusItemInput;
    return hydrateItem(item as unknown as ShadowCorpusItemInput, dirname(manifestPath));
  }));
  const manifest = { ...raw, items: hydratedItems } as unknown as ShadowCorpusManifestInput;
  const report = evaluateShadowCorpus(manifest, options.itemIds.length ? { itemIds: options.itemIds } : {});
  const output = `${canonicalShadowEvaluationJson(report)}\n`;
  if (outputPathValue) await writeFile(outputPathValue, output, "utf8");
  return output;
}

export async function runEvaluateShadowCorpusCli(argv: readonly string[]): Promise<number> {
  try {
    const output = await run(parseArgs([...argv]));
    process.stdout.write(output);
    let status: unknown;
    try {
      status = (JSON.parse(output) as { status?: unknown }).status;
    } catch {
      return 2;
    }
    return statusExitCode(status);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runEvaluateShadowCorpusCli(process.argv.slice(2));
}
