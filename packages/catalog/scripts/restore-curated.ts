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
 * Usage: npx tsx packages/catalog/scripts/restore-curated.ts [--dry-run] [baseId...]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSongsByBase, ingestSource, MAX_YOUTUBE_IMPORT_DUR_BEATS } from "../src/index.js";
import { ROOT, dataDir, seedMidiDir } from "../src/paths.js";

interface ManifestEntry {
  id: string;
  title?: string;
  artist?: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  sourceUrl?: string;
  contentType?: "standard" | "youtube" | "upload";
  acquiredVia?: string | null;
}

const dryRun = process.argv.includes("--dry-run");
const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
const manifest = (await readFile(join(dataDir(), "manifest.json"), "utf8")
  .then((s) => JSON.parse(s) as { songs: ManifestEntry[] })
  .catch(() => null))?.songs ??
  (await readFile(join(ROOT, "catalog", "manifest.json"), "utf8")
    .then((s) => JSON.parse(s) as { songs: ManifestEntry[] })
    .catch(() => null))?.songs ?? [];
const byId = new Map(manifest.map((s) => [s.id, s]));
const files = (await readdir(seedMidiDir()).catch(() => [] as string[])).filter((f) => f.endsWith(".mid"));
let restored = 0;

for (const f of files) {
  const baseId = f.slice(0, -4);
  if (requested.size && !requested.has(baseId)) continue;
  const row = getSongsByBase(baseId)[0];
  const entry = byId.get(baseId);
  // A newly added tracked seed may not have a DB row yet. Manifest metadata
  // is sufficient to publish it; older seed files without a manifest entry
  // remain ignored rather than inventing catalogue metadata.
  if (!row && !entry) continue;
  const buf = new Uint8Array(await readFile(join(seedMidiDir(), f)));
  if (dryRun) {
    restored++;
    console.log(`? ${baseId}: would restore from seed (${buf.length} bytes)`);
    continue;
  }
  // A curated seed may have been stored as `standard` by an older restore,
  // while acquiredVia still records that it came from YouTube. Keep that
  // provenance when restoring so later rebuild stages can identify and skip
  // the curated source without a song-specific allowlist.
  const manifestYoutube = /(?:youtube\.com|youtu\.be)/i.test(entry?.sourceUrl ?? "");
  const contentType = entry?.contentType ?? (row?.contentType === "upload"
    ? "upload"
    : row?.contentType === "youtube" || row?.acquiredVia === "youtube"
      ? "youtube"
      : manifestYoutube
        ? "youtube"
        : "standard");
  const acquiredVia = entry?.acquiredVia ?? row?.acquiredVia ?? (manifestYoutube ? "youtube" : null);
  const r = await ingestSource({
    buf,
    title: entry?.title ?? row?.title ?? baseId,
    artist: entry?.artist ?? row?.artist ?? "Unknown",
    category: entry?.category ?? row?.category ?? "Standard",
    style: entry?.style ?? row?.style ?? "classical",
    mood: entry?.mood ?? row?.mood ?? "peaceful",
    key: entry?.key ?? row?.key,
    tempo: entry?.tempo ?? row?.tempo,
    contentType,
    acquiredVia,
    sourceYoutubeUrl: manifestYoutube ? entry?.sourceUrl : row?.sourceYoutubeUrl ?? null,
    sourceRef: `seed:${f}`,
    baseId,
    // Keep the source-aware tail ceiling for curated YouTube imports while
    // disabling ghost-note cleanup (the seed is already hand-curated).
    cleanTranscription: contentType === "youtube" ? false : undefined,
    maxDurBeats: contentType === "youtube" ? MAX_YOUTUBE_IMPORT_DUR_BEATS : undefined,
  });
  if (r.error) {
    console.warn(`x ${baseId}: ${r.error}`);
  } else {
    restored++;
    console.log(`+ ${baseId}: restored from seed`);
  }
}

console.log(`restored ${restored}${dryRun ? " (dry run)" : ""}`);
