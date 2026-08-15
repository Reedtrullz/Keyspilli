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
  contentType?: "standard" | "youtube" | "upload";
  acquiredVia?: string | null;
  sourceRef?: string | null;
  license: string;
  instrument?: string;
  disabled?: boolean;
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
  // A manifest source URL is part of the canonical provenance. In
  // particular, a curated seed can still be an audio-derived YouTube source;
  // treating every manifest row as generic standard MIDI would re-enable the
  // old restore/reingest overwrite bug.
  const youtubeSource = /(?:youtube\.com|youtu\.be)/i.test(s.sourceUrl ?? "");
  const contentType = s.contentType ?? (youtubeSource ? "youtube" : "standard");
  const acquiredVia = s.acquiredVia ?? (youtubeSource ? "youtube" : null);
  const r = await ingestSource({
    buf: new Uint8Array(buf),
    title: s.title,
    artist: s.artist,
    category: s.category,
    style: s.style,
    mood: s.mood,
    key: s.key,
    tempo: s.tempo,
    contentType,
    acquiredVia,
    sourceYoutubeUrl: youtubeSource ? s.sourceUrl : null,
    sourceRef: s.sourceRef ?? `manifest:${s.sourceFile}`,
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
  if (s.disabled) {
    process.stdout.write(`- ${s.id}: disabled, skipped\n`);
    continue;
  }
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
if (failures.length) {
  console.log(failures.join("\n"));
  process.exitCode = 1;
}
console.log(`songs in db: ${countSongs()}`);

// sanity: every variant has artifacts + db row
let missing = 0;
for (const s of manifest.songs) {
  if (s.disabled) continue;
  const rows = getSongsByBase(s.id);
  if (rows.length !== LEVEL_ORDER.length) missing++;
}
console.log(`bases with incomplete variant sets: ${missing}`);
if (missing) process.exitCode = 1;
