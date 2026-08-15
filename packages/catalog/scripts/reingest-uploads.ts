/**
 * Re-ingest stored upload sources with the current pipeline while keeping
 * base ids (so player URLs stay stable). Sources are persisted by
 * ingestSource for contentType "upload".
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSongsByBase, uploadsDir, ingestSource } from "../src/index.js";

let ok = 0;
let skipped = 0;
for (const f of (await readdir(uploadsDir())).sort()) {
  const m = f.match(/^(.*)\.(mid|midi|xml|musicxml|mxl)$/i);
  if (!m) {
    skipped++;
    continue;
  }
  const baseId = m[1]!;
  const song = getSongsByBase(baseId)[0];
  if (!song) {
    skipped++;
    console.warn(`x ${baseId}: no db row for stored source`);
    continue;
  }
  const buf = await readFile(join(uploadsDir(), f));
  const r = await ingestSource({
    buf: new Uint8Array(buf),
    title: song.title,
    artist: song.artist,
    category: "Upload",
    contentType: "upload",
    acquiredVia: "upload",
    sourceRef: `upload:${f}`,
    baseId,
  });
  if (r.error) {
    skipped++;
    console.warn(`x ${baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${baseId}`);
  }
}
console.log(`re-ingested ${ok}, skipped ${skipped}`);
