/**
 * Re-ingest curated bases from their seed MIDI files. A base is "curated"
 * when data/seed-midi/<baseId>.mid exists (e.g. Dear God's hand-fixed
 * arrangement). Transcription re-ingests skip curated bases; this restores
 * them from the seed so the curated arrangement wins.
 *
 * Manifest metadata (key/tempo/title/...) is preferred when available; the
 * worker container has no catalog/manifest.json, so it falls back to the DB
 * row's metadata there.
 *
 * Usage: npx tsx packages/catalog/scripts/restore-curated.ts [--dry-run]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSongsByBase, ingestSource } from "../src/index.js";
import { ROOT, seedMidiDir } from "../src/paths.js";

interface ManifestEntry {
  id: string;
  title?: string;
  artist?: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
}

const dryRun = process.argv.includes("--dry-run");
const manifest = (await readFile(join(ROOT, "catalog", "manifest.json"), "utf8")
  .then((s) => JSON.parse(s) as { songs: ManifestEntry[] })
  .catch(() => null))?.songs ?? [];
const byId = new Map(manifest.map((s) => [s.id, s]));
const files = (await readdir(seedMidiDir()).catch(() => [] as string[])).filter((f) => f.endsWith(".mid"));
let restored = 0;

for (const f of files) {
  const baseId = f.slice(0, -4);
  const row = getSongsByBase(baseId)[0];
  if (!row) continue;
  const entry = byId.get(baseId);
  const buf = new Uint8Array(await readFile(join(seedMidiDir(), f)));
  if (dryRun) {
    restored++;
    console.log(`? ${baseId}: would restore from seed (${buf.length} bytes)`);
    continue;
  }
  const r = await ingestSource({
    buf,
    title: entry?.title ?? row.title,
    artist: entry?.artist ?? row.artist,
    category: entry?.category ?? row.category ?? "Standard",
    style: entry?.style ?? row.style,
    mood: entry?.mood ?? row.mood,
    key: entry?.key,
    tempo: entry?.tempo,
    contentType: "standard",
    acquiredVia: row.acquiredVia ?? null,
    sourceYoutubeUrl: row.sourceYoutubeUrl ?? null,
    baseId,
  });
  if (r.error) {
    console.warn(`x ${baseId}: ${r.error}`);
  } else {
    restored++;
    console.log(`+ ${baseId}: restored from seed`);
  }
}

console.log(`restored ${restored}${dryRun ? " (dry run)" : ""}`);
