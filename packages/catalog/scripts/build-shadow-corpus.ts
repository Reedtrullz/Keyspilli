#!/usr/bin/env node

/**
 * Build a bounded, local-only shadow-corpus metadata report.
 *
 * Inputs are an explicitly supplied directory and, optionally, a manifest.json
 * below that directory.  The command never downloads, copies, uploads, or
 * mutates catalog data.  Source media stay in place; only hashes and
 * path-redacted metadata are written to --out.
 */

import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION,
  SHADOW_CORPUS_ADAPTER_VERSION,
  buildShadowCorpusItem,
  shadowCorpusAdapterJson,
  type ShadowCorpusAdapterErrorRecord,
  type ShadowCorpusAdapterPathOptions,
  type ShadowCorpusAdapterReport,
  type ShadowCorpusItemInput,
} from "../src/shadow-corpus-adapter.js";

export const DEFAULT_SHADOW_CORPUS_LIMIT = 20 as const;
export const MAX_SHADOW_CORPUS_LIMIT = 20 as const;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIDI_EXTENSIONS = new Set([".mid", ".midi"]);
const MANIFEST_NAMES = ["shadow-manifest.json", "manifest.json", "corpus.json", "items.json"] as const;
const SYMBOLIC_NAMES = ["symbolic.mid", "symbolic.midi", "midi.mid", "midi.midi", "mixture.mid", "mixture.midi", "mix.mid", "mix.midi"] as const;
const AUDIO_NAMES = ["audio.wav", "audio.flac", "audio.mp3", "mix.wav", "mix.flac", "mix.mp3", "mixture.wav", "mixture.flac"] as const;

export interface BuildShadowCorpusOptions {
  root: string;
  out: string;
  limit?: number;
  repositoryRoot?: string;
}

export interface BuildShadowCorpusCliOptions extends BuildShadowCorpusOptions {
  help: boolean;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface ManifestContext {
  corpus?: string | null;
  datasetVersion?: string | null;
  license?: string | null;
  sourceRecord?: unknown;
}

interface ManifestRow extends JsonRecord {
  id?: unknown;
}

interface ResolvedManifest {
  context: ManifestContext;
  rows: ManifestRow[];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathInside(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function redactedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/file:\/\/[^\s"']+/gi, "[redacted-path]")
    .replace(/(^|[\s(=,:])\/(?:[^\s"'<>;,)]*\/)?(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/[^\s"'<>;,)]*/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(^|[\s(=,:])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "shadow corpus build failed";
}

function usage(): string {
  return [
    "Usage: build-shadow-corpus.ts --root DIR --out FILE [--limit N]",
    "  --root DIR       explicit local corpus directory (outside the repository)",
    "  --out FILE       path-redacted JSON report (outside the repository)",
    "  --limit N        maximum items to parse (default 20; maximum 20)",
    "  --help           show this help",
    "",
    "The command is local-only and never downloads or copies corpus media.",
  ].join("\n");
}

function optionValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("--limit must be a positive integer no greater than 20");
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SHADOW_CORPUS_LIMIT) {
    throw new Error("--limit must be a positive integer no greater than 20");
  }
  return limit;
}

export function parseBuildShadowCorpusArgs(argv: readonly string[]): BuildShadowCorpusCliOptions {
  const result: BuildShadowCorpusCliOptions = {
    root: "",
    out: "",
    limit: DEFAULT_SHADOW_CORPUS_LIMIT,
    repositoryRoot: REPOSITORY_ROOT,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = optionValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--root": result.root = value(); break;
      case "--out": result.out = value(); break;
      case "--limit": result.limit = parseLimit(value()); break;
      case "--repository-root": result.repositoryRoot = value(); break;
      case "--help":
      case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (result.help) return result;
  if (!result.root) throw new Error(`--root is required\n${usage()}`);
  if (!result.out) throw new Error(`--out is required\n${usage()}`);
  return result;
}

async function validateDirectory(value: string, label: string, repositoryRoot: string): Promise<string> {
  if (!value || !isAbsolute(value)) throw new Error(`${label} must be an absolute local path`);
  if (value.includes("\u0000") || /[\r\n]/.test(value)) throw new Error(`${label} contains unsafe characters`);
  let resolved: string;
  try {
    resolved = await realpath(value);
  } catch {
    throw new Error(`${label} does not exist or could not be resolved`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`${label} is not a regular directory`);
  if (pathInside(repositoryRoot, resolved)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

async function validateOutput(value: string, repositoryRoot: string): Promise<string> {
  if (!value || !isAbsolute(value)) throw new Error("--out must be an absolute local path");
  if (value.includes("\u0000") || /[\r\n]/.test(value)) throw new Error("--out contains unsafe characters");
  const resolved = resolve(value);
  if (pathInside(repositoryRoot, resolved)) throw new Error("--out must be outside the repository");
  try {
    // Resolve an existing output before writing so a symlink cannot redirect
    // the report back into the repository after the lexical check above.
    const existing = await realpath(resolved);
    if (pathInside(repositoryRoot, existing)) throw new Error("--out must be outside the repository");
    const info = await stat(existing);
    if (info.isDirectory()) throw new Error("--out must name a report file, not a directory");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("--out")) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw new Error("--out could not be inspected");
    // A not-yet-created report is valid; its parent is checked below.
  }
  const parent = dirname(resolved);
  await mkdir(parent, { recursive: true });
  let parentReal: string;
  try {
    parentReal = await realpath(parent);
  } catch {
    throw new Error("--out parent does not exist or could not be created");
  }
  if (pathInside(repositoryRoot, parentReal)) throw new Error("--out must be outside the repository");
  return resolved;
}

async function optionalFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`shadow corpus manifest is not valid JSON: ${redactedError(error)}`);
  }
}

function manifestRows(value: unknown): ManifestRow[] {
  if (!Array.isArray(value)) throw new Error("shadow corpus manifest items must be an array");
  return value.map((row, index) => {
    if (!isRecord(row)) throw new Error(`shadow corpus manifest row ${index} must be an object`);
    return row as ManifestRow;
  });
}

function rowsFromManifest(raw: unknown): { context: ManifestContext; rows: ManifestRow[] } {
  if (Array.isArray(raw)) {
    return {
      context: {},
      rows: manifestRows(raw),
    };
  }
  if (!isRecord(raw)) throw new Error("shadow corpus manifest must be an object or item array");
  const context: ManifestContext = {
    corpus: typeof raw.corpus === "string" ? raw.corpus : null,
    datasetVersion: typeof raw.datasetVersion === "string" ? raw.datasetVersion : null,
    license: typeof raw.license === "string" ? raw.license : null,
    sourceRecord: raw.sourceRecord,
  };
  const value = raw.items ?? raw.entries ?? raw.sources;
  if (value === undefined && raw.id !== undefined) return { context, rows: [raw as ManifestRow] };
  return { context, rows: manifestRows(value) };
}

async function loadManifest(root: string): Promise<ResolvedManifest | null> {
  for (const name of MANIFEST_NAMES) {
    const path = join(root, name);
    if (!(await optionalFile(path))) continue;
    const parsed = rowsFromManifest(await readJsonFile(path));
    return { context: parsed.context, rows: parsed.rows };
  }
  return null;
}

function valuePath(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return undefined;
  for (const key of ["path", "file", "localPath", "symbolicPath", "audioPath"]) {
    if (typeof value[key] === "string" && value[key].trim()) return String(value[key]).trim();
  }
  return undefined;
}

function rowString(row: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function rejectUrl(value: string, label: string): void {
  if (/^(?:https?|ftp):\/\//i.test(value)) throw new Error(`${label} must be a local path; downloads are disabled`);
}

function resolveCorpusPath(value: string, root: string, label: string): string {
  rejectUrl(value, label);
  const resolved = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!pathInside(root, resolved)) throw new Error(`${label} must remain inside the supplied corpus root`);
  return resolved;
}

async function directoryCandidate(row: JsonRecord, root: string): Promise<string> {
  const value = rowString(row, "directory", "itemDirectory", "dir", "itemPath");
  if (!value) return root;
  const resolved = resolveCorpusPath(value, root, "shadow item directory");
  try {
    if ((await stat(resolved)).isDirectory()) return resolved;
  } catch {
    // The adapter will report a path-free missing-file error below.
  }
  return root;
}

async function findNamedFile(directory: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    const path = join(directory, name);
    if (await optionalFile(path)) return path;
  }
  return undefined;
}

async function mediaPath(
  row: JsonRecord,
  root: string,
  directory: string,
  keys: readonly string[],
  names: readonly string[],
  label: string,
): Promise<string | undefined> {
  for (const key of keys) {
    const value = valuePath(row[key]);
    if (!value) continue;
    return resolveCorpusPath(value, root, label);
  }
  const candidate = await findNamedFile(directory, names);
  return candidate ? resolveCorpusPath(candidate, root, label) : undefined;
}

async function itemInput(row: ManifestRow, context: ManifestContext, root: string): Promise<ShadowCorpusItemInput> {
  const directory = await directoryCandidate(row, root);
  const symbolicPath = await mediaPath(row, root, directory,
    ["symbolicPath", "symbolic", "midiPath", "midi", "symbolicFile", "file"], SYMBOLIC_NAMES, "symbolic MIDI input");
  const audioPath = await mediaPath(row, root, directory,
    ["audioPath", "audio", "mix", "audioFile", "mixPath"], AUDIO_NAMES, "shadow audio input");
  const idValue = rowString(row, "id", "name", "slug") ?? (directory === root ? undefined : basename(directory));
  if (!idValue) throw new Error("shadow corpus item requires an id");
  return {
    id: idValue,
    corpus: row.corpus === undefined ? context.corpus : typeof row.corpus === "string" ? row.corpus : null,
    datasetVersion: row.datasetVersion === undefined ? context.datasetVersion : typeof row.datasetVersion === "string" ? row.datasetVersion : null,
    license: row.license === undefined ? context.license : typeof row.license === "string" ? row.license : null,
    sourceRecord: row.sourceRecord === undefined ? context.sourceRecord as ShadowCorpusItemInput["sourceRecord"] : row.sourceRecord as ShadowCorpusItemInput["sourceRecord"],
    sourceRef: rowString(row, "sourceRef", "logicalRef"),
    symbolicPath,
    audioPath,
  };
}

async function discoverRows(root: string): Promise<ResolvedManifest> {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) => compareText(left.name, right.name));
  const rows: ManifestRow[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      let metadata: JsonRecord = {};
      for (const name of ["metadata.json", "item.json"]) {
        const path = join(root, entry.name, name);
        if (await optionalFile(path)) {
          const raw = await readJsonFile(path);
          if (!isRecord(raw)) throw new Error(`metadata for ${entry.name} must be an object`);
          metadata = raw;
          break;
        }
      }
      rows.push({ ...metadata, id: metadata.id ?? entry.name, directory: entry.name });
    } else if (entry.isFile() && MIDI_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      const stem = entry.name.replace(/\.(?:mid|midi)$/i, "");
      const audio = await findNamedFile(root, [`${stem}.wav`, `${stem}.flac`, `${stem}.mp3`]);
      rows.push({ id: stem, symbolic: entry.name, ...(audio ? { audio } : {}) });
    }
  }
  if (!rows.length) throw new Error("shadow corpus root contains no local item directories or MIDI files");
  return { context: {}, rows };
}

function normalizeRows(rows: readonly ManifestRow[]): ManifestRow[] {
  const normalized = rows.slice().sort((left, right) => compareText(String(left.id ?? ""), String(right.id ?? "")));
  const ids = new Set<string>();
  for (const row of normalized) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) throw new Error("shadow corpus items require non-empty ids");
    if (ids.has(id)) throw new Error(`duplicate shadow corpus item id: ${id}`);
    ids.add(id);
  }
  return normalized;
}

function buildError(id: string, error: unknown): ShadowCorpusAdapterErrorRecord {
  const message = redactedError(error);
  const code: ShadowCorpusAdapterErrorRecord["code"] = /MIDI|parse|header|track|variable-length/i.test(message)
    ? "parse-failed"
    : /exist|regular file|input|required|path/i.test(message) ? "missing-symbolic" : "io-failed";
  return { id, code, message };
}

/** Build and persist a deterministic, path-redacted shadow-corpus report. */
export async function buildShadowCorpus(options: BuildShadowCorpusOptions): Promise<ShadowCorpusAdapterReport> {
  const limit = options.limit ?? DEFAULT_SHADOW_CORPUS_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SHADOW_CORPUS_LIMIT) throw new Error("shadow corpus limit must be between 1 and 20");
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const root = await validateDirectory(options.root, "--root", repositoryRoot);
  const outputPath = await validateOutput(options.out, repositoryRoot);
  const discovered = await loadManifest(root) ?? await discoverRows(root);
  const rows = normalizeRows(discovered.rows).slice(0, limit);
  const items = [] as ShadowCorpusAdapterReport["items"];
  const errors: ShadowCorpusAdapterErrorRecord[] = [];
  const pathOptions: ShadowCorpusAdapterPathOptions = { repositoryRoot, allowedRoot: root };
  for (const row of rows) {
    const id = String(row.id);
    try {
      const input = await itemInput(row, discovered.context, root);
      items.push(await buildShadowCorpusItem(input, pathOptions));
    } catch (error) {
      errors.push(buildError(id, error));
    }
  }
  items.sort((left, right) => compareText(left.id, right.id));
  errors.sort((left, right) => compareText(left.id, right.id));
  const generationTruthCount = items.filter((item) => item.generationEligibility.eligible && item.generationEligibility.purpose === "SHADOW_GENERATION_TRUTH").length;
  const status: ShadowCorpusAdapterReport["status"] = errors.length
    ? items.length ? "partial" : "failed"
    : generationTruthCount > 0 && generationTruthCount === items.length ? "ready" : "metadata-only";
  const report: ShadowCorpusAdapterReport = {
    schemaVersion: SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION,
    adapterVersion: SHADOW_CORPUS_ADAPTER_VERSION,
    status,
    itemCount: rows.length,
    parsedItemCount: items.length,
    failedItemCount: errors.length,
    generationTruthCount,
    items,
    errors,
    outputPath,
  };
  await writeFile(outputPath, shadowCorpusAdapterJson(report), "utf8");
  return report;
}

export async function runBuildShadowCorpusCli(argv: readonly string[]): Promise<number> {
  const options = parseBuildShadowCorpusArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  try {
    const report = await buildShadowCorpus(options);
    process.stdout.write(`shadow corpus: ${report.status}; items=${report.itemCount}; parsed=${report.parsedItemCount}; failed=${report.failedItemCount}\n`);
    if (report.status === "ready") return report.errors.length ? 2 : 0;
    // Metadata-only and partial reports are useful diagnostics, but they are
    // not generation-ready and must not look successful to automation.
    return report.status === "metadata-only" ? 1 : 2;
  } catch (error) {
    process.stderr.write(`build-shadow-corpus: ${redactedError(error)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runBuildShadowCorpusCli(process.argv.slice(2));
}
