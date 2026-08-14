/**
 * Playability gate over stored artifacts. Run before shipping data/ to a
 * server, and in CI after the pipeline, so no broken song ever goes live.
 * Exits non-zero if any song fails.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER, validateArtifactFiles, validateVariants, Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
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
let warnings = 0;

for (const song of songs.sort()) {
  const issues: string[] = [];
  const warns: string[] = [];
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
  if (issues.length === 0) {
    issues.push(...validateVariants(variants));
    for (const v of variants) {
      const code = LEVEL_CODE[v.level]!;
      try {
        const midi = new Uint8Array(await readFile(join(artifactsRoot, song, code, "variant.mid")));
        const xml = await readFile(join(artifactsRoot, song, code, "variant.xml"), "utf8");
        for (const issue of validateArtifactFiles(v, { midi, xml })) issues.push(`${v.level}: ${issue}`);
      } catch (e) {
        issues.push(`${v.level}: artifact missing or invalid: ${(e as Error).message}`);
      }
    }
  }
  // Data-level quality checks for AI-transcribed songs: warnings, not gate
  // failures, because they are fixable by re-ingest rather than a code change.
  const row = getDb().prepare("SELECT content_type FROM songs WHERE base_id = ? LIMIT 1").get(song) as
    | { content_type?: string }
    | undefined;
  const dataLevel = row?.content_type === "youtube" || row?.content_type === "upload";
  if (dataLevel && issues.length === 0) {
    const long = variants.filter((v) => v.notes.some((n) => n.dur > 8)).map((v) => v.level);
    if (long.length) warns.push(`note > 8 beats in ${long.join(", ")}`);
    const a = variants.find((v) => v.level === "advanced");
    const m = variants.find((v) => v.level === "medium");
    if (a && m && a.notes.length === m.notes.length) warns.push("advanced and medium note counts equal");
    if (variants.some((v) => v.tempoBpm < 20 || v.tempoBpm > 300)) warns.push("tempo outside 20-300 BPM");
  }
  if (issues.length) {
    failed++;
    console.log(`FAIL ${song}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }
  if (warns.length) {
    warnings += warns.length;
    console.log(`WARN ${song}`);
    for (const w of warns) console.log(`  - ${w}`);
  }
}

console.log(`verify-catalog: ${failed} of ${songs.length} songs failed, ${warnings} data warnings`);
if (failed) process.exitCode = 1;
