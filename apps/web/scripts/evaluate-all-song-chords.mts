/**
 * Read-only Chords backing report for every visible song, replaying the
 * Player's own load and backing path. Opens the catalogue database read-only;
 * point KEYSPILLI_DATA_DIR at a frozen snapshot to evaluate production input.
 *
 *   npx tsx apps/web/scripts/evaluate-all-song-chords.mts [--rows] [--gate]
 *
 * `--gate` lists songs failing CHORDS_TUNING.gate and exits 1 if any do.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { artifactsDir, blockedLearnerBases, dataDir, dbPath, disabledManifestBases } from "@keyspilli/catalog";
import { loadSongArtifact, withChordSources } from "../src/lib/catalog-api";
import { evaluateVisibleChords, type AdvancedLoader, type AdvancedRow } from "../src/lib/chords-evaluation";

const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
const songs = db.prepare("SELECT id, base_id AS baseId, level, tempo, acquired_via AS acquiredVia FROM songs").all() as AdvancedRow[];
db.close();

const hidden = new Set([...blockedLearnerBases(), ...disabledManifestBases()]);
const advanced = new Map<string, AdvancedRow | null>();
for (const song of songs) {
  if (hidden.has(song.baseId)) continue;
  if (song.level === "a") advanced.set(song.baseId, song);
  else if (!advanced.has(song.baseId)) advanced.set(song.baseId, null);
}
const known = new Set(songs.map((song) => song.baseId));
const artifactBases = readdirSync(join(dataDir(), "artifacts"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(artifactsDir(entry.name, "a"), "notes.json")))
  .map((entry) => entry.name);

const load: AdvancedLoader = async (song) => {
  const path = join(artifactsDir(song.baseId, song.level), "notes.json");
  const notesSha256 = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
  const loaded = await loadSongArtifact(song);
  return loaded.data
    ? { data: await withChordSources(loaded.data, song.baseId, song.level), errors: [], notesSha256 }
    : { data: null, errors: loaded.artifact.errors, notesSha256 };
};

const report = await evaluateVisibleChords(advanced, load, {
  hiddenAdvancedArtifacts: artifactBases.filter((id) => hidden.has(id)).length,
  orphanAdvancedArtifacts: artifactBases.filter((id) => !known.has(id)).length,
});
console.log(JSON.stringify(process.argv.includes("--rows") ? report : report.summary, null, 2));
if (process.argv.includes("--gate")) {
  // CHORDS_TUNING.gate decides; failing songs are listed with their reasons.
  const failed = report.rows.filter((row) => row.status !== "evaluated" || !row.backing?.gate.passed);
  for (const row of failed) console.error(`${row.baseId}: ${row.status === "evaluated" ? row.backing!.gate.reasons.join("; ") : row.status}`);
  console.error(`${report.rows.length - failed.length} of ${report.rows.length} visible songs pass the Chords gate`);
  if (failed.length) process.exitCode = 1;
}
