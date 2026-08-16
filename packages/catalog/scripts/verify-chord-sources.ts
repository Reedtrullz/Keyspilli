/** Validate checked-in chord source metadata and normalized timeline artifacts. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  dataDir,
  getDb,
  loadChordSourceMap,
  parseChordTimeline,
  resolveChordSourceArtifact,
  resolveChordTimeline,
  ROOT,
} from "../src/index.js";

const map = await loadChordSourceMap();
let failed = 0;
let artifacts = 0;
for (const entry of map.entries) {
  for (const source of entry.sources) {
    if (!source.artifactPath) continue;
    const path = resolveChordSourceArtifact(source);
    if (!path) {
      failed++;
      console.log(`FAIL ${entry.baseId}/${source.id}: artifact path is outside the catalog root`);
      continue;
    }
    try {
      const artifact = parseChordTimeline(JSON.parse(await readFile(path, "utf8")), { source });
      if (artifact.baseId !== entry.baseId) throw new Error(`baseId ${artifact.baseId} does not match mapping ${entry.baseId}`);
      artifacts++;
      console.log(`OK ${entry.baseId}/${source.id}: ${artifact.chords.length} chords, ${artifact.durationBeats} beats`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${entry.baseId}/${source.id}: ${(error as Error).message}`);
    }
  }
}
console.log(`verify-chord-sources: ${failed} failures, ${artifacts} artifacts`);
if (failed) process.exitCode = 1;

// The source map is intentionally sparse: only charts that have been
// curated and normalized are mapped. Every other catalogue song must still
// have a usable generated-chord fallback, otherwise selecting chord mode
// would silently turn into a broken/empty background. CI runs this sweep
// after the catalog pipeline with --require-catalog; local metadata-only runs
// can omit the flag when no database has been built yet.
const requireCatalog = process.argv.includes("--require-catalog");
const db = getDb();
const linkedBases = (db
  .prepare("SELECT DISTINCT base_id AS baseId FROM songs WHERE base_id IS NOT NULL AND base_id <> ''")
  .all() as { baseId: string }[])
  .map((row) => row.baseId)
  .filter(Boolean)
  .sort();

if (linkedBases.length === 0) {
  const message = "verify-chord-sources: catalogue fallback sweep skipped (no songs database rows)";
  console.log(message);
  if (requireCatalog) {
    console.error("verify-chord-sources: --require-catalog requested but the catalog database is empty");
    process.exitCode = 1;
  }
} else {
  const fallbackFailures: string[] = [];
  let chartSources = 0;
  let generatedSources = 0;
  let emptyChordTimelines = 0;
  const advancedDir = (baseId: string) => join(dataDir(), "artifacts", baseId, "a");

  for (const baseId of linkedBases) {
    try {
      const notes = JSON.parse(await readFile(join(advancedDir(baseId), "notes.json"), "utf8")) as { chords?: unknown };
      if (!Array.isArray(notes.chords)) {
        fallbackFailures.push(`${baseId}: advanced notes.json has no chords array`);
      } else if (notes.chords.length === 0) {
        emptyChordTimelines++;
      }
    } catch (error) {
      fallbackFailures.push(`${baseId}: advanced notes.json is missing or invalid (${(error as Error).message})`);
      continue;
    }

    const resolution = await resolveChordTimeline(baseId, {
      catalogRoot: ROOT,
      runtimeDataDir: dataDir(),
      fallbackLevel: "a",
    });
    if (!resolution) {
      fallbackFailures.push(`${baseId}: no chart or generated fallback timeline resolved`);
    } else if (resolution.source.kind === "chart") {
      chartSources++;
    } else {
      generatedSources++;
    }
  }

  console.log(
    `verify-chord-sources: catalogue sweep ${linkedBases.length}/${linkedBases.length} resolved `
      + `(${chartSources} chart, ${generatedSources} generated fallback, ${emptyChordTimelines} empty chord timelines)`,
  );
  for (const issue of fallbackFailures) console.log(`FAIL ${issue}`);
  if (fallbackFailures.length) process.exitCode = 1;
}
