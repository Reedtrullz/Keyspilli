#!/usr/bin/env node
/**
 * Local-only six-score harmony benchmark.
 *
 * The manifest is metadata-only. Explicit local reference/candidate MIDI
 * paths are accepted through a sidecar and are rejected when they resolve
 * into this repository. The report contains metrics and hashes only; it
 * never copies, uploads, or embeds source notes.
 *
 *   pnpm exec tsx packages/catalog/scripts/benchmark-harmony.ts \
 *     --manifest /private/tmp/harmony/manifest.json \
 *     --sidecar /private/tmp/harmony/inputs.json \
 *     --out /private/tmp/harmony/report
 */
import { runHarmonyBenchmark } from "../src/harmony-benchmark.js";

function argument(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`Usage: benchmark-harmony.ts --manifest FILE [--sidecar FILE] --out DIR`);
  return value;
}

export async function runHarmonyBenchmarkCli(args: readonly string[]): Promise<{ path: string; json: string }> {
  const manifestPath = argument(args, "--manifest");
  const sidecarPath = argument(args, "--sidecar", false);
  const out = argument(args, "--out");
  const result = await runHarmonyBenchmark({ manifestPath: manifestPath!, ...(sidecarPath ? { sidecarPath } : {}), out: out! });
  return { path: result.path, json: result.json };
}

if (process.argv[1]?.endsWith("benchmark-harmony.ts") || process.argv[1]?.endsWith("benchmark-harmony.js")) {
  runHarmonyBenchmarkCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${result.path}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
