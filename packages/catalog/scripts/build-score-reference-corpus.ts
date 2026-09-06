#!/usr/bin/env node
/**
 * Build a deterministic, local-only readiness report for an explicit score
 * reference manifest.  This is intentionally separate from the legacy
 * build-score-corpus benchmark and from catalog ingestion.
 *
 * The manifest contains logical score rows.  Each row may point at a local
 * PDF/native/OMR input, but no input is fetched or copied into the repository.
 * Missing optional files are represented in the report so a nine-score run is
 * still useful before all source material has been recovered.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localScoreReferenceCorpusJson,
  runLocalScoreReferenceCorpus,
  type ScoreReferenceCorpusInput,
} from "../src/score-reference-corpus.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ScoreReferenceCorpusCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface ScoreReferenceCorpusCliOptions {
  manifest: string;
  out: string;
  repositoryRoot: string;
  help: boolean;
}

function usage(): string {
  return [
    "Usage: build-score-reference-corpus.ts --manifest FILE --out DIR [options]",
    "",
    "Required:",
    "  --manifest FILE          JSON manifest with a scores array (local-only)",
    "  --out DIR                derived output root (must be outside repository)",
    "",
    "Options:",
    "  --repository-root DIR   repository safety boundary (default: this repository)",
    "  --help                  show this help",
    "",
    "Each score may include pdfPath/pdf, nativeArtifacts/native, and OMR rows",
    "with inline score data or an absolute local MusicXML/JSON path. Missing",
    "inputs become structured unavailable states; no network or catalog writes occur.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function localPath(value: string, flag: string): string {
  if (!value.trim() || /[\u0000\r\n]/.test(value) || !isAbsolute(value)) throw new Error(`${flag} must be an absolute local path without NUL/newline characters`);
  return resolve(value);
}

/** Parse CLI arguments without touching the filesystem. */
export function parseScoreReferenceCorpusArgs(argv: readonly string[]): ScoreReferenceCorpusCliOptions {
  const result: ScoreReferenceCorpusCliOptions = { manifest: "", out: "", repositoryRoot: REPOSITORY_ROOT, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const flag = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--manifest": result.manifest = localPath(value(), "--manifest"); break;
      case "--out": result.out = localPath(value(), "--out"); break;
      case "--repository-root": result.repositoryRoot = localPath(value(), "--repository-root"); break;
      case "--help": case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (result.help) return result;
  if (!result.manifest) throw new Error(`--manifest is required\n\n${usage()}`);
  if (!result.out) throw new Error(`--out is required\n\n${usage()}`);
  return result;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/file:\/\/[^\s"']+/gi, "[redacted-path]")
    .replace(/(?:^|[\s(=:])\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/[^\s"')]+/gi, "$1[redacted-path]")
    .replace(/[\u0000\r\n]+/g, " ")
    .slice(0, 500);
}

function manifestValue(value: unknown): ScoreReferenceCorpusInput {
  if (Array.isArray(value)) return { schemaVersion: 1, scores: value as ScoreReferenceCorpusInput["scores"] };
  if (!value || typeof value !== "object") throw new Error("manifest must be a JSON object containing a scores array");
  return value as ScoreReferenceCorpusInput;
}

/** Execute the corpus runner without calling process.exit, for tests/embedding. */
export async function runScoreReferenceCorpusCli(
  argv: readonly string[],
  io: ScoreReferenceCorpusCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: ScoreReferenceCorpusCliOptions;
  try {
    options = parseScoreReferenceCorpusArgs(argv);
  } catch (error) {
    io.stderr(`build-score-reference-corpus: ${publicError(error)}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout(`${usage()}\n`);
    return 0;
  }
  try {
    const parsed = JSON.parse(await readFile(options.manifest, "utf8")) as unknown;
    const report = await runLocalScoreReferenceCorpus(manifestValue(parsed), {
      outputRoot: options.out,
      repositoryRoot: options.repositoryRoot,
    });
    const json = localScoreReferenceCorpusJson(report);
    io.stdout(json);
    return report.status === "READY" ? 0 : 1;
  } catch (error) {
    io.stderr(`build-score-reference-corpus: ${publicError(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && (process.argv[1].endsWith("build-score-reference-corpus.ts") || process.argv[1].endsWith("build-score-reference-corpus.js"))) {
  void runScoreReferenceCorpusCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
