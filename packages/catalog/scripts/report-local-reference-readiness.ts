#!/usr/bin/env node
/**
 * Aggregate local PDF/native/OMR/review/listening reports into one
 * deterministic readiness hand-off.
 *
 * This command is deliberately a file-based adapter. It reads only explicit
 * JSON reports, never opens a source PDF/MIDI, never contacts the network, and
 * refuses repository paths so copyrighted source material is not accidentally
 * turned into a tracked artifact. The output contains logical references and
 * hashes only; physical paths are not emitted.
 */
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalReferenceReadiness,
  localReferenceReadinessJson,
  localReferenceReadinessMarkdown,
  type LocalReferenceReadinessInput,
} from "../src/local-reference-readiness.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface LocalReferenceReadinessCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface LocalReferenceReadinessCliOptions {
  input: string;
  out?: string;
  format: "json" | "markdown";
  listening?: string;
  humanDecisions?: string;
  help: boolean;
}

function usage(): string {
  return [
    "Usage: report-local-reference-readiness.ts --input FILE [options]",
    "",
    "Required:",
    "  --input FILE             local JSON from build-local-reference/corpus reports",
    "                           (--report is accepted as an alias)",
    "",
    "Optional local evidence:",
    "  --listening FILE         JSON listening-bundle report or score map",
    "  --human-decisions FILE   JSON array/map of actual reviewer decisions",
    "  --format json|markdown   output format (default json)",
    "  --out FILE               write output outside the repository",
    "  --help                   show this help",
    "",
    "The command is local-only. It does not read source PDFs/MIDI, use the network,",
    "write the catalog, or modify production. Gate status is diagnostic and does",
    "not turn automated evidence into a human recognizability claim.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function cliPath(value: string, flag: string): string {
  if (!value.trim() || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`${flag} contains an unsafe path value`);
  }
  if (!isAbsolute(value)) throw new Error(`${flag} must be an absolute local path`);
  return resolve(value);
}

/** Parse arguments without touching the filesystem. */
export function parseLocalReferenceReadinessArgs(argv: readonly string[]): LocalReferenceReadinessCliOptions {
  const result: LocalReferenceReadinessCliOptions = { input: "", format: "json", help: false };
  let sawInput = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) {
        if (!inline) throw new Error(`${flag} requires a value`);
        return inline;
      }
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--input":
      case "--report":
        if (sawInput) throw new Error("--input/--report may be supplied only once");
        result.input = cliPath(value(), flag);
        sawInput = true;
        break;
      case "--out":
        result.out = cliPath(value(), "--out");
        break;
      case "--listening":
        result.listening = cliPath(value(), "--listening");
        break;
      case "--human-decisions":
        result.humanDecisions = cliPath(value(), "--human-decisions");
        break;
      case "--format": {
        const format = value().toLowerCase();
        if (format !== "json" && format !== "markdown") throw new Error("--format must be json or markdown");
        result.format = format;
        break;
      }
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  if (result.help) return result;
  if (!result.input) throw new Error(`--input is required\n\n${usage()}`);
  return result;
}

function pathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

async function existingJsonPath(value: string, label: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(value);
  } catch {
    throw new Error(`${label} does not exist or could not be resolved`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  if (pathInside(REPOSITORY_ROOT, resolved)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

async function outputPath(value: string): Promise<string> {
  const resolved = resolve(value);
  if (pathInside(REPOSITORY_ROOT, resolved)) throw new Error("--out must be outside the repository");
  try {
    const existing = await realpath(resolved);
    if (pathInside(REPOSITORY_ROOT, existing)) throw new Error("--out must be outside the repository");
    const info = await stat(existing);
    if (info.isDirectory()) throw new Error("--out must name a file, not a directory");
  } catch (error) {
    if (error instanceof Error && error.message.includes("--out must")) throw error;
    // The output may be new. Check the nearest existing parent to prevent a
    // symlinked path from placing artifacts in the repository.
    let parent = dirname(resolved);
    while (parent !== dirname(parent)) {
      try {
        const realParent = await realpath(parent);
        if (pathInside(REPOSITORY_ROOT, realParent)) throw new Error("--out must be outside the repository");
        break;
      } catch (parentError) {
        if (parentError instanceof Error && parentError.message.includes("--out must")) throw parentError;
        parent = dirname(parent);
      }
    }
  }
  return resolved;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not be read as JSON: ${message}`);
  }
}

function withSupplement(base: unknown, listening: unknown, decisions: unknown): LocalReferenceReadinessInput {
  const source: Record<string, unknown> = Array.isArray(base) ? { scores: base } : { ...record(base) };
  if (listening !== undefined) {
    const value = record(listening);
    if (Array.isArray(listening)) source.listening = listening;
    else if (Array.isArray(value.listening)) source.listening = value.listening;
    else if (value.listening && typeof value.listening === "object") source.listening = value.listening;
    else if (value.listeningBundles && typeof value.listeningBundles === "object") source.listeningBundles = value.listeningBundles;
    else source.listening = value;
  }
  if (decisions !== undefined) {
    const value = record(decisions);
    source.humanDecisions = Array.isArray(decisions)
      ? decisions
      : Array.isArray(value.humanDecisions) ? value.humanDecisions
        : Array.isArray(value.decisions) ? value.decisions : [];
  }
  return source as LocalReferenceReadinessInput;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:file:\/\/)?(?:\/(?:Users|private|tmp|var|home|Volumes|root|opt|mnt|workspace|etc|srv|data|app)\/[^\s"'<>;,)]*|[A-Za-z]:[\\/][^\s"'<>;,)]*)/gi, "[redacted-path]")
    .replace(/[\0\r\n]+/g, " ")
    .slice(0, 500);
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Execute the CLI without process.exit, for tests and local orchestration. */
export async function runLocalReferenceReadinessCli(
  argv: readonly string[],
  io: LocalReferenceReadinessCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: LocalReferenceReadinessCliOptions;
  try {
    options = parseLocalReferenceReadinessArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) io.stdout(`${message}\n`);
    else io.stderr(`${safeError(message)}\n`);
    return message === usage() ? 0 : 2;
  }
  if (options.help) {
    io.stdout(`${usage()}\n`);
    return 0;
  }
  try {
    const inputPath = await existingJsonPath(options.input, "--input");
    const listeningPath = options.listening ? await existingJsonPath(options.listening, "--listening") : undefined;
    const decisionsPath = options.humanDecisions ? await existingJsonPath(options.humanDecisions, "--human-decisions") : undefined;
    const base = await readJson(inputPath, "--input");
    const listening = listeningPath ? await readJson(listeningPath, "--listening") : undefined;
    const decisions = decisionsPath ? await readJson(decisionsPath, "--human-decisions") : undefined;
    const report = buildLocalReferenceReadiness(withSupplement(base, listening, decisions));
    const contents = options.format === "markdown" ? localReferenceReadinessMarkdown(report) : localReferenceReadinessJson(report);
    if (options.out) {
      const destination = await outputPath(options.out);
      await writeAtomic(destination, contents);
      io.stdout(`local reference readiness report written (${options.format})\n`);
    } else {
      io.stdout(contents);
    }
    return 0;
  } catch (error) {
    io.stderr(`${safeError(error)}\n`);
    return 2;
  }
}

async function main(): Promise<void> {
  const code = await runLocalReferenceReadinessCli(process.argv.slice(2));
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
