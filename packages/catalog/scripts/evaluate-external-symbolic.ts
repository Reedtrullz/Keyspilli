#!/usr/bin/env node
/** Local-only seven-song external symbolic benchmark report. */
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  buildExternalBenchmarkReport,
  canonicalExternalBenchmarkJson,
  type ExternalBenchmarkInput,
} from "../src/external-benchmark.js";

export interface ExternalSymbolicCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface ExternalSymbolicCliOptions { manifest: string; out?: string; help: boolean }

function usage(): string {
  return [
    "Usage: evaluate-external-symbolic.ts --manifest /absolute/local/manifest.json [--out /absolute/local/output]",
    "",
    "The manifest contains an explicit { songs: [...] } array. Candidate and",
    "reference inputs must be local absolute file paths or inline bytes supplied",
    "by an embedding caller. This command never downloads, uploads, copies, or",
    "publishes benchmark/reference material; output is deterministic JSON only.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function localPath(value: string, flag: string): string {
  if (!value.trim() || value.includes("\0") || /[\r\n]/.test(value)) throw new Error(`${flag} contains an unsafe path value`);
  if (!isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) throw new Error(`${flag} must be an absolute local path`);
  return resolve(value);
}

export function parseExternalSymbolicArgs(argv: readonly string[]): ExternalSymbolicCliOptions {
  const options: ExternalSymbolicCliOptions = { manifest: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    const value = (): string => {
      if (inline !== undefined) { if (!inline) throw new Error(`${flag} requires a value`); return inline; }
      const pair = nextValue(argv, index, flag); index = pair[1]; return pair[0];
    };
    if (flag === "--manifest") options.manifest = localPath(value(), "--manifest");
    else if (flag === "--out") options.out = localPath(value(), "--out");
    else if (flag === "--json") { /* JSON is always the output format. */ }
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!options.help && !options.manifest) throw new Error(`--manifest is required\n\n${usage()}`);
  return options;
}

function redact(value: string): string {
  return value
    .replace(/file:\/\/[^\s,;)}\]]+/gi, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$)|~[\\/])[^\s,;)}\]]*/gi, "[redacted-path]")
    .replace(/[\u0000\r\n]+/g, " ").slice(0, 500);
}

async function readManifest(path: string): Promise<ExternalBenchmarkInput> {
  let resolved: string;
  try { resolved = await realpath(path); } catch { throw new Error("manifest does not exist or could not be resolved"); }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("manifest must be a regular file");
  let value: unknown;
  try { value = JSON.parse(await readFile(resolved, "utf8")); } catch { throw new Error("manifest is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as { songs?: unknown }).songs)) throw new Error("manifest must contain a songs array");
  return value as ExternalBenchmarkInput;
}

async function assertOutput(path: string): Promise<void> {
  try {
    const existing = await realpath(path);
    if ((await stat(existing)).isDirectory()) throw new Error("--out must name a file, not a directory");
  } catch (error) {
    if (error instanceof Error && error.message.includes("must name")) throw error;
    // A new output is fine; only its parent must be a directory.
    try { if (!(await stat(dirname(path))).isDirectory()) throw new Error("--out parent must be a directory"); } catch { throw new Error("--out parent does not exist"); }
  }
}

/** Execute without process.exit so tests and local embedding can inspect failures. */
export async function runExternalSymbolicCli(
  argv: readonly string[],
  io: ExternalSymbolicCliIo = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) },
): Promise<number> {
  let options: ExternalSymbolicCliOptions;
  try { options = parseExternalSymbolicArgs(argv); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Usage:")) io.stdout(`${message}\n`); else io.stderr(`${redact(message)}\n`);
    return message.includes("Usage:") ? 0 : 2;
  }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  let input: ExternalBenchmarkInput;
  try { input = await readManifest(options.manifest); }
  catch (error) { io.stderr(`${redact(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  let report;
  try { report = await buildExternalBenchmarkReport(input); }
  catch (error) { io.stderr(`${redact(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  const output = `${JSON.stringify(JSON.parse(canonicalExternalBenchmarkJson(report)), null, 2)}\n`;
  if (options.out) {
    try { await assertOutput(options.out); await writeFile(options.out, output, "utf8"); }
    catch (error) { io.stderr(`${redact(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  }
  io.stdout(output);
  return 0;
}

/* istanbul ignore next -- process entry point */
if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) {
  runExternalSymbolicCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
