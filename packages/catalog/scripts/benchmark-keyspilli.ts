#!/usr/bin/env node
/**
 * Local-only Keyspilli regression runner.
 *
 * The manifest contains normalized candidate notes and trusted partial role
 * references produced by the local OMR workflow. It does not invoke OMR,
 * render audio, access the network, or copy protected score artifacts.
 *
 *   pnpm exec tsx packages/catalog/scripts/benchmark-keyspilli.ts \
 *     --manifest /private/tmp/keyspilli/manifest.json --out /private/tmp/keyspilli/report
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runKeyspilliRegression, writeKeyspilliRegressionReport, type KeyspilliRegressionSong } from "../src/keyspilli-regression.js";

function usage(): never {
  throw new Error("Usage: benchmark-keyspilli.ts --manifest FILE --out DIR");
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) usage();
  return value;
}

export interface KeyspilliRegressionManifest {
  schemaVersion?: number;
  songs: KeyspilliRegressionSong[];
}

export async function runKeyspilliRegressionCli(args: readonly string[]): Promise<{ path: string; json: string }> {
  const manifestPath = resolve(argument([...args], "--manifest"));
  const outputDirectory = resolve(argument([...args], "--out"));
  const input = JSON.parse(await readFile(manifestPath, "utf8")) as KeyspilliRegressionManifest;
  if (!input || !Array.isArray(input.songs)) throw new Error("manifest.songs must be an array");
  const report = runKeyspilliRegression(input.songs);
  return writeKeyspilliRegressionReport(outputDirectory, report);
}

if (process.argv[1]?.endsWith("benchmark-keyspilli.ts") || process.argv[1]?.endsWith("benchmark-keyspilli.js")) {
  runKeyspilliRegressionCli(process.argv.slice(2))
    .then((written) => process.stdout.write(`${written.path}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
