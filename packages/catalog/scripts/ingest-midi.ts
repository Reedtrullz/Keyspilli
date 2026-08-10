/**
 * Ingest a raw transcription MIDI in place for an existing base
 * (used for tuned-threshold re-transcriptions).
 * Usage: tsx scripts/ingest-midi.ts <baseId> <midiPath> <sourceUrl>
 */
import { readFile } from "node:fs/promises";
import { getSongsByBase, ingestSource } from "../src/index.js";
const [baseId, midiPath, sourceUrl] = process.argv.slice(2);
if (!baseId || !midiPath) {
  console.error("usage: tsx scripts/ingest-midi.ts <baseId> <midiPath> [sourceUrl]");
  process.exit(1);
}
const row = getSongsByBase(baseId)[0]!;
const buf = await readFile(midiPath);
const r = await ingestSource({
  buf: new Uint8Array(buf),
  title: row.title,
  artist: row.artist,
  category: row.category,
  contentType: "youtube",
  acquiredVia: "youtube",
  sourceYoutubeUrl: sourceUrl ?? row.sourceYoutubeUrl ?? undefined,
  baseId,
});
console.log(r.error ? `FAIL ${r.error}` : `OK ${baseId}`);
