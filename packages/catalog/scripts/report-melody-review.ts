#!/usr/bin/env node
/** Emit a deterministic, local-only melody bootstrap review artifact. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMelodyCorrectionLedger,
  buildMelodyReviewPack,
  canonicalMelodyReviewPackJson,
  melodyReviewPackHtml,
  melodyReviewPackMarkdown,
  type MelodyReviewPack,
} from "../src/melody-review-pack.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface MelodyReviewCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface MelodyReviewCliOptions {
  input: string;
  out?: string;
  ledger?: string;
  format: "json" | "markdown" | "html";
  help: boolean;
}

function usage(): string {
  return [
    "Usage: report-melody-review.ts --input FILE [options]",
    "",
    "Required:",
    "  --input FILE       local readiness/corpus JSON projection",
    "",
    "Options:",
    "  --format FORMAT    json, markdown (default), or html",
    "  --out FILE         write the path-redacted artifact outside the repository",
    "  --ledger FILE      apply an explicit local correction ledger after planning",
    "  --help             show this help",
    "",
    "The command reads JSON only. It does not read/copy source PDFs, MIDI, MusicXML,",
    "or raw notes; it does not write the catalog or contact production.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function localPath(value: string, flag: string): string {
  if (!value.trim() || !isAbsolute(value) || /[\u0000\r\n]/.test(value)) throw new Error(`${flag} must be an absolute local path without NUL/newline characters`);
  return resolve(value);
}

/** Parse arguments without touching the filesystem. */
export function parseMelodyReviewArgs(argv: readonly string[]): MelodyReviewCliOptions {
  const result: MelodyReviewCliOptions = { input: "", format: "markdown", help: false };
  let inputSeen = false;
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
        if (inputSeen) throw new Error("--input/--report may be supplied only once");
        result.input = localPath(value(), flag);
        inputSeen = true;
        break;
      case "--out": result.out = localPath(value(), flag); break;
      case "--ledger": result.ledger = localPath(value(), flag); break;
      case "--format": {
        const format = value().toLowerCase();
        if (format !== "json" && format !== "markdown" && format !== "html") throw new Error("--format must be json, markdown, or html");
        result.format = format;
        break;
      }
      case "--help":
      case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!result.help && !result.input) throw new Error(`--input is required\n\n${usage()}`);
  return result;
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function existingInput(value: string): Promise<string> {
  let resolved: string;
  try { resolved = await realpath(value); } catch { throw new Error("--input/--ledger could not be resolved"); }
  const info = await stat(resolved);
  if (!info.isFile() || inside(REPOSITORY_ROOT, resolved)) throw new Error("--input/--ledger must be a regular file outside the repository");
  return resolved;
}

async function outputPath(value: string): Promise<string> {
  const resolved = resolve(value);
  if (inside(REPOSITORY_ROOT, resolved)) throw new Error("--out must be outside the repository");
  let parent = dirname(resolved);
  while (parent !== dirname(parent)) {
    try {
      const realParent = await realpath(parent);
      if (inside(REPOSITORY_ROOT, realParent)) throw new Error("--out must be outside the repository");
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes("--out")) throw error;
      parent = dirname(parent);
    }
  }
  return resolved;
}

function publicError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:file:\/\/)?(?:\/(?:Users|private|tmp|var|home|Volumes|root|opt|mnt|workspace|data|srv|etc)\/[^\s"'<>;,)]*|[A-Za-z]:[\\/][^\s"'<>;,)]*)/gi, "[redacted-path]")
    .replace(/[\u0000\r\n]+/g, " ").slice(0, 500);
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function output(pack: MelodyReviewPack, format: MelodyReviewCliOptions["format"]): string {
  if (format === "json") return canonicalMelodyReviewPackJson(pack);
  if (format === "html") return `${melodyReviewPackHtml(pack)}\n`;
  return melodyReviewPackMarkdown(pack);
}

/** Execute without process.exit so tests and local orchestration can embed it. */
export async function runMelodyReviewCli(
  argv: readonly string[],
  io: MelodyReviewCliIo = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) },
): Promise<number> {
  let options: MelodyReviewCliOptions;
  try {
    options = parseMelodyReviewArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) io.stdout(`${message}\n`); else io.stderr(`report-melody-review: ${publicError(message)}\n`);
    return message === usage() ? 0 : 2;
  }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  try {
    const input = JSON.parse(await readFile(await existingInput(options.input), "utf8")) as unknown;
    let pack = buildMelodyReviewPack(input);
    if (options.ledger) {
      const ledger = JSON.parse(await readFile(await existingInput(options.ledger), "utf8")) as unknown;
      pack = applyMelodyCorrectionLedger(pack, ledger);
    }
    const contents = output(pack, options.format);
    if (options.out) await atomicWrite(await outputPath(options.out), contents); else io.stdout(contents);
    return pack.status === "READY" ? 0 : 1;
  } catch (error) {
    io.stderr(`report-melody-review: ${publicError(error)}\n`);
    return 1;
  }
}

export const parseMelodyReviewPackArgs = parseMelodyReviewArgs;
export const runMelodyReviewPackCli = runMelodyReviewCli;

if (process.argv[1] && (process.argv[1].endsWith("report-melody-review.ts") || process.argv[1].endsWith("report-melody-review.js"))) {
  void runMelodyReviewCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
