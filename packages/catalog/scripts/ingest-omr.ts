/**
 * Ingest sheet-music (OMR'd MusicXML) as a 'standard' song, replacing an
 * existing base id (keeps player URLs stable).
 *
 * Usage: tsx scripts/ingest-omr.ts <baseId> <xmlPath> [key] [tempo]
 *   - key defaults to the existing song row when omitted.
 *   - tempo defaults to the value embedded in the MusicXML (per-minute);
 *     pass a number to override.
 */
import { readFile } from "node:fs/promises";
import { getSongsByBase, ingestSource } from "../src/index.js";

const [baseId, xmlPath, keyArg, tempoArg] = process.argv.slice(2);
if (!baseId || !xmlPath) {
  console.error("usage: tsx scripts/ingest-omr.ts <baseId> <xmlPath> [key] [tempo]");
  process.exit(1);
}

const existing = getSongsByBase(baseId);
if (existing.length === 0) {
  console.error(`no existing songs for base ${baseId} (check base id)`);
  process.exit(1);
}
const row = existing[0]!;
const key = keyArg ?? row.key ?? undefined;
const tempo = tempoArg ? parseInt(tempoArg, 10) : undefined;

const buf = await readFile(xmlPath);
const r = await ingestSource({
  buf: new Uint8Array(buf),
  title: row.title,
  artist: row.artist,
  category: row.category,
  style: row.style,
  mood: row.mood,
  key,
  tempo,
  contentType: "standard",
  acquiredVia: "omr",
  sourceRef: `omr:${xmlPath.split("/").at(-1) ?? "unknown"}`,
  baseId,
});
if (r.error) {
  console.error(`FAIL ${baseId}: ${r.error}`);
  process.exit(1);
}
console.log(`OK ${baseId} -> ${r.songIds.join(", ")} (key=${key} tempo=${tempo})`);
