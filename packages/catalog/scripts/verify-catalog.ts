/**
 * Playability gate over stored artifacts. Run before shipping data/ to a
 * server, and in CI after the pipeline, so no broken song ever goes live.
 * Exits non-zero if any song fails.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER, validateVariants, Variant } from "@keyspilli/midi";
import { ROOT } from "../src/paths.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

const artifactsRoot = join(ROOT, "data", "artifacts");
const songs = await readdir(artifactsRoot);
let failed = 0;

for (const song of songs.sort()) {
  const issues: string[] = [];
  const variants: Variant[] = [];
  for (const level of LEVEL_ORDER) {
    const path = join(artifactsRoot, song, LEVEL_CODE[level]!, "notes.json");
    try {
      const v = JSON.parse(await readFile(path, "utf8")) as Variant;
      variants.push({ ...v, level });
    } catch {
      issues.push(`${level}: missing or invalid notes.json`);
    }
  }
  if (issues.length === 0) issues.push(...validateVariants(variants));
  if (issues.length) {
    failed++;
    console.log(`FAIL ${song}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }
}

console.log(`verify-catalog: ${failed} of ${songs.length} songs failed`);
if (failed) process.exitCode = 1;
