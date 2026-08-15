/**
 * Playability gate over stored artifacts. Run before shipping data/ to a
 * server, and in CI after the pipeline, so no broken song ever goes live.
 * Exits non-zero if any song fails.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER, validateArtifactFiles, validateVariants, Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { MAX_YOUTUBE_IMPORT_DUR_BEATS } from "../src/ingest.js";
import { dataDir } from "../src/paths.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

// Resolve through the shared data-dir helper so the same gate works both in
// the repository checkout and inside the production worker container, where
// KEYSPILLI_DATA_DIR=/data is mounted separately from the application code.
const artifactsRoot = join(dataDir(), "artifacts");
const db = getDb();
// A targeted rebuild can verify only the base it touched; the default remains
// the fail-closed full-catalog gate used by CI and release checks.
const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
const linkedRows = db
  .prepare("SELECT DISTINCT base_id AS baseId FROM songs WHERE base_id IS NOT NULL AND base_id <> ''")
  .all() as { baseId: string }[];
const allLinkedBases = linkedRows.map((row) => row.baseId).filter(Boolean).sort();
const linkedBases = requested.size ? allLinkedBases.filter((baseId) => requested.has(baseId)) : allLinkedBases;
const linkedSet = new Set(allLinkedBases);
const artifactEntries = await readdir(artifactsRoot, { withFileTypes: true }).catch(() => []);
const artifactBases = artifactEntries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && (!requested.size || requested.has(entry.name)))
  .map((entry) => entry.name)
  .sort();
const orphanBases = artifactBases.filter((baseId) => !linkedSet.has(baseId));
let failed = 0;
let warnings = 0;

// Artifact directories can outlive their database rows after a failed or
// interrupted rebuild. They are useful for cleanup diagnostics, but must not
// fail the release gate: only database-linked bases are public catalog rows.
for (const orphan of orphanBases) {
  console.log(`WARN orphan artifact directory ${orphan} (not linked from songs table)`);
}

for (const song of linkedBases) {
  const issues: string[] = [];
  const warns: string[] = [];
  const row = db.prepare("SELECT content_type FROM songs WHERE base_id = ? LIMIT 1").get(song) as
    | { content_type?: string }
    | undefined;
  // Match ingestSource's source-aware sustain policy. Human-authored standard
  // and upload arrangements may contain intentional multi-measure holds;
  // YouTube/audio imports must satisfy the explicit tail ceiling.
  const maxDurBeats = row?.content_type === "youtube" ? MAX_YOUTUBE_IMPORT_DUR_BEATS : null;
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
    issues.push(...validateVariants(variants, { maxDurBeats }));
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

const orphanSuffix = orphanBases.length ? `, ${orphanBases.length} orphan artifact dirs ignored` : "";
console.log(`verify-catalog: ${failed} of ${linkedBases.length} songs failed, ${warnings} data warnings${orphanSuffix}`);
if (failed) process.exitCode = 1;
