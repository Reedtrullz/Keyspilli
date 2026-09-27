/** Completed symbolic input -> both modes, portable bundle, fresh import and idempotence.
 * tsx apps/web/scripts/prepare-song.mts INPUT.mid|INPUT.musicxml NEW_RUN_DIR TITLE ARTIST
 * Acquisition/arranging happens before this command; output remains provisional until reviewed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
const [inputArg, runArg, title, artist] = process.argv.slice(2);
assert(inputArg && runArg && title && artist, "INPUT NEW_RUN_DIR TITLE ARTIST");
const run = resolve(runArg), rel = relative(process.cwd(), run);
assert(rel && rel !== ".." && !rel.startsWith("../"), "run directory must be inside checkout");
assert(!existsSync(run), "run already exists; preserve existing work");
const buf = readFileSync(resolve(inputArg)), baseId = "upload-" + createHash("sha256").update(buf).digest("hex");
mkdirSync(run, { recursive: true });
process.env.KEYSPILLI_DATA_DIR = join(run, "data");
process.env.KEYSPILLI_CHORD_SOURCE_MAP = join(run, "empty-map.json");
writeFileSync(process.env.KEYSPILLI_CHORD_SOURCE_MAP, JSON.stringify({ schemaVersion: 1, entries: [] }));
const { ingestSource } = await import("../../../packages/catalog/src/ingest.js");
const result = await ingestSource({ buf, baseId, title, artist, contentType: "upload", acquiredVia: "upload", cleanTranscription: false, maxDurBeats: null, arrangementProfile: "source" });
assert(!result.error && result.songIds.length === 6, result.error ?? "incomplete import");
const inventory = join(run, "inventory.json"), prepared = join(run, "prepared"), bundle = join(run, "bundle"), installed = join(run, "installed");
writeFileSync(inventory, JSON.stringify([{ representative: { baseId, title, artist } }]));
const call = (script: string, args: string[], env = process.env) => execFileSync(process.execPath, ["--import", "tsx", `apps/web/scripts/${script}.mts`, ...args], { env, stdio: "inherit" });
call("prepare-catalog-chords", [inventory, prepared, "--repair"]);
call("song-bundle", ["pack", baseId, prepared, bundle]);
call("song-bundle", ["install", bundle, installed]);
call("song-bundle", ["install", bundle, installed]);
writeFileSync(join(run, "result.json"), JSON.stringify({ baseId, sourceSha256: baseId.slice(7), bundle, installed,
  checks: { freshImport: true, musicalIdempotence: true }, status: "provisional", remaining: "reference/audio assessment; not automatically musically approved" }, null, 2));
console.log(`Prepared both modes for ${title}: ${bundle}`);
