/**
 * Re-ingest songs acquired from a MIDI pack using the current pipeline while
 * keeping base ids (player URLs stay stable). Sources are copied into
 * data/seed-midi so they are available for future re-validation.
 *
 * Usage: tsx scripts/reingest-midi-pack.ts "/path/to/pack" [base-id...]
 */
import { copyFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getDb, getSongsByBase, seedMidiDir, ingestSource } from "../src/index.js";

const packDir = process.argv[2] ?? "/Users/reidar/Downloads/Top MIDI Tracks Pack (Free)";
const only = new Set(process.argv.slice(3));

const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const tokens = (s: string) => new Set(slug(s).split("-").filter((t) => t.length > 1));

const files = (await readdir(packDir)).filter((f) => /\.(mid|midi)$/i.test(f));
const fileIndex = files.map((f) => ({ f, slug: slug(f.replace(/\.[^.]+$/, "")), tokens: tokens(f) }));

function findFile(baseId: string, title?: string): string | undefined {
  const exact = fileIndex.find((x) => x.slug === baseId);
  if (exact) return exact.f;
  const t = tokens(baseId);
  if (t.size >= 2) {
    const byTokens = fileIndex.find((x) => [...t].every((tok) => x.tokens.has(tok)));
    if (byTokens) return byTokens.f;
  }
  if (title) {
    const ts = slug(title);
    if (ts.length >= 6) {
      const byTitle = fileIndex.find((x) => x.slug.includes(ts) || ts.includes(x.slug));
      if (byTitle) return byTitle.f;
    }
  }
  return undefined;
}

const midiPackRows = getDb()
  .prepare("SELECT DISTINCT base_id FROM songs WHERE acquired_via = 'midi-pack' ORDER BY base_id")
  .all() as { base_id: string }[];

let ok = 0;
let skipped = 0;
for (const { base_id: baseId } of midiPackRows) {
  if (only.size && !only.has(baseId)) continue;
  const song = getSongsByBase(baseId)[0];
  const file = findFile(baseId, song?.title);
  if (!song) {
    skipped++;
    console.warn(`x ${baseId}: no db row`);
    continue;
  }
  if (!file) {
    skipped++;
    console.warn(`x ${baseId}: no pack file found`);
    continue;
  }
  await copyFile(join(packDir, file), join(seedMidiDir(), `${baseId}.mid`));
  const buf = await readFile(join(packDir, file));
  const r = await ingestSource({
    buf: new Uint8Array(buf),
    title: song.title,
    artist: song.artist,
    category: song.category,
    style: song.style,
    mood: song.mood,
    key: song.key,
    tempo: song.tempo,
    contentType: "standard",
    acquiredVia: "midi-pack",
    baseId,
  });
  if (r.error) {
    skipped++;
    console.warn(`x ${baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${baseId} (${file})`);
  }
}
console.log(`re-ingested ${ok}, skipped ${skipped}`);
