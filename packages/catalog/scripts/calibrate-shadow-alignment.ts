/**
 * Run the deterministic symbolic-alignment corruption/recovery calibration.
 *
 * The generated report is synthetic-only and contains no benchmark paths or
 * media.  Ground-truth transforms are retained in fixture memory and are
 * compared only after the blind aligner call returns.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/calibrate-shadow-alignment.ts [--out report.json]
 */
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { calibrateShadowAlignment } from "../src/shadow-alignment.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function rejectRepositoryPath(path: string): void {
  const remainder = relative(REPOSITORY_ROOT, path);
  if (remainder === "" || (!remainder.startsWith(`..${sep}`) && remainder !== ".." && !isAbsolute(remainder))) {
    throw new Error("--out must be outside the repository");
  }
}

async function validateOutputPath(value: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error("--out must be an absolute local path outside the repository");
  const resolved = resolve(value);
  rejectRepositoryPath(resolved);
  try {
    const existing = await realpath(resolved);
    rejectRepositoryPath(existing);
    if ((await stat(existing)).isDirectory()) throw new Error("--out must name a report file, not a directory");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("--out")) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw new Error("--out could not be inspected");
  }
  await mkdir(dirname(resolved), { recursive: true });
  rejectRepositoryPath(await realpath(dirname(resolved)));
  return resolved;
}

function outputPath(args: readonly string[]): string | undefined {
  const index = args.indexOf("--out");
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--out requires an explicit output path");
  return value;
}

function usage(): string {
  return "Usage: calibrate-shadow-alignment.ts [--out report.json]";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length !== 1) throw new Error(usage());
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.some((arg) => arg !== "--out" && arg !== outputPath(args))) {
    throw new Error(usage());
  }
  const report = calibrateShadowAlignment();
  const json = JSON.stringify(report, null, 2) + "\n";
  const destination = outputPath(args);
  if (destination) await writeFile(await validateOutputPath(destination), json, { encoding: "utf8" });
  process.stdout.write(json);
}

/* istanbul ignore next -- only runs when executed as a script */
if (process.argv[1]?.endsWith("calibrate-shadow-alignment.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
