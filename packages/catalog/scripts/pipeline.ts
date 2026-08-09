/**
 * Arrangement pipeline: for every song in catalog/manifest.json, parse the
 * seed MIDI, generate 6 difficulty variants, write artifacts
 * (data/artifacts/{baseId}/{level}/{variant.mid,variant.xml,notes.json})
 * and upsert one Song row per variant. Idempotent.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER } from "@keyspilli/midi";
import { countSongs, getSongsByBase } from "../src/db.js";
import { ingestSource } from "../src/ingest.js";
import { ROOT, seedMidiDir } from "../src/paths.js";

interface ManifestSong {
  id: string;
  title: string;
  artist: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  sourceFile: string;
  sourceUrl: string;
  license: string;
  instrument?: string;
}

const manifest: { songs: ManifestSong[] } = JSON.parse(
  await readFile(join(ROOT, "catalog", "manifest.json"), "utf8"),
);

async function processSong(s: ManifestSong): Promise<{ ok: boolean; error?: string; variants: number }> {
  const midiPath = join(seedMidiDir(), s.sourceFile);
  let buf: Buffer;
  try {
    buf = await readFile(midiPath);
  } catch {
    return { ok: false, error: "missing midi file", variants: 0 };
  }
  const r = await ingestSource({
    buf: new Uint8Array(buf),
    title: s.title,
    artist: s.artist,
    category: s.category,
    style: s.style,
    mood: s.mood,
    key: s.key,
    tempo: s.tempo,
    contentType: "standard",
    baseId: s.id,
  });
  if (r.error) return { ok: false, error: r.error, variants: 0 };
  return { ok: true, variants: r.songIds.length };
}

let ok = 0;
let failed = 0;
const failures: string[] = [];
const t0 = Date.now();
for (const s of manifest.songs) {
  const r = await processSong(s);
  if (r.ok) {
    ok++;
    process.stdout.write(`+ ${s.id} (${r.variants} variants)\n`);
  } else {
    failed++;
    failures.push(`${s.id}: ${r.error}`);
    process.stdout.write(`x ${s.id}: ${r.error}\n`);
  }
}
console.log(`\npipeline done: ${ok} ok, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) console.log(failures.join("\n"));
console.log(`songs in db: ${countSongs()}`);

// sanity: every variant has artifacts + db row
let missing = 0;
for (const s of manifest.songs) {
  const rows = getSongsByBase(s.id);
  if (rows.length !== LEVEL_ORDER.length) missing++;
}
console.log(`bases with incomplete variant sets: ${missing}`);
