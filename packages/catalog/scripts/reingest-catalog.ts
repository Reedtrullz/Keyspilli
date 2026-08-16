/**
 * Rebuild every catalog base from the best source currently available.
 *
 * Run with --dry-run before a production rebuild. Base ids are preserved and
 * ingestSource publishes each six-level set atomically.
 *
 * Usage: npx tsx packages/catalog/scripts/reingest-catalog.ts [--dry-run]
 *   [--skip-youtube] [--allow-unfiltered-youtube] [--source=root|strict|auto]
 *   [baseId...]
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalizeTempoBpm, parseMidi, writeMidi } from "@keyspilli/midi";
import {
  filterTranscription,
  getDb,
  getSongsByBase,
  ingestSource,
  removeSongsByBase,
  parseYoutubeSourceArgs,
  resolveYoutubeSource,
} from "../src/index.js";
import { artifactsDir, dataDir, ROOT, seedMidiDir, transcribedDir, uploadsDir } from "../src/paths.js";

const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipYoutube = args.includes("--skip-youtube");
const allowUnfilteredYoutube = args.includes("--allow-unfiltered-youtube");
// Keep the full-catalog rebuild root-only by default. Operators can opt into
// a validated re/ candidate explicitly, while auto retains the helper
// scripts' strict-when-present fallback behavior.
const { selection: sourceSelection, positionalArgs: onlyBases } = parseYoutubeSourceArgs(args, "root");
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");

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
  sourceUrl?: string;
  contentType?: "standard" | "youtube" | "upload";
  acquiredVia?: string | null;
  disabled?: boolean;
}

interface CatalogMeta {
  baseId: string;
  title: string;
  artist: string;
  category: string;
  style: string;
  mood: string;
  key?: string;
  tempo?: number;
  contentType: "standard" | "youtube" | "upload";
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
}

interface YoutubeSource {
  midi: string;
  audio: string;
  jobUrl: string | null;
  sourceKind: "root" | "re";
  availableKinds: ("root" | "re")[];
}

const seedAliases: Record<string, string> = {
  "taylor-swift-love-story": "love-story-where-do-i-begin.mid",
};
const storedAdvancedFallbacks = new Set(["kamerat-mot-kamerat", "red-sun-in-the-sky"]);

// Production worker images intentionally omit the repository's catalog/
// directory. The workflow copies manifest.json into the mounted data volume,
// so prefer that path and retain the checkout path for local runs.
const manifestRaw = await readFile(join(dataDir(), "manifest.json"), "utf8")
  .catch(() => readFile(join(ROOT, "catalog", "manifest.json"), "utf8"))
  .then((raw) => JSON.parse(raw) as { songs?: ManifestSong[] })
  .catch(() => ({ songs: [] as ManifestSong[] }));
const manifest = new Map((manifestRaw.songs ?? []).map((song) => [song.id, song]));

// A persistent production volume can outlive a manifest entry. Reconcile
// explicitly disabled bases before selecting rebuild work so a full rebuild
// cannot leave stale songs publicly reachable. Targeting a disabled base will
// then fail closed below because it no longer has catalog metadata.
for (const song of manifest.values()) {
  if (!song.disabled) continue;
  if (dryRun) {
    if (getSongsByBase(song.id).length) console.log(`? ${song.id}: would remove disabled catalogue rows`);
    continue;
  }
  const removed = removeSongsByBase(song.id);
  if (removed) console.log(`- ${song.id}: disabled, removed ${removed} stale database rows`);
}

function getCatalogBases(): string[] {
  const rows = getDb().prepare("SELECT DISTINCT base_id AS base_id FROM songs ORDER BY base_id").all() as { base_id: string }[];
  return rows.map((row) => row.base_id);
}

function metadataFor(baseId: string): CatalogMeta | undefined {
  const row = getSongsByBase(baseId)[0];
  if (!row) return undefined;
  const fromManifest = manifest.get(baseId);
  const manifestYoutube = /(?:youtube\.com|youtu\.be)/i.test(fromManifest?.sourceUrl ?? "");
  const contentType = fromManifest?.contentType ?? (row.contentType === "upload"
    ? "upload"
    : row.contentType === "youtube" || row.acquiredVia === "youtube"
      ? "youtube"
      : manifestYoutube
        ? "youtube"
        : "standard");
  return {
    baseId,
    title: fromManifest?.title ?? row.title,
    artist: fromManifest?.artist ?? row.artist,
    category: fromManifest?.category ?? row.category,
    style: fromManifest?.style ?? row.style,
    mood: fromManifest?.mood ?? row.mood,
    key: fromManifest?.key ?? row.key,
    tempo: fromManifest?.tempo ?? row.tempo,
    contentType,
    acquiredVia: fromManifest?.acquiredVia ?? row.acquiredVia ?? (manifestYoutube ? "youtube" : null),
    sourceYoutubeUrl: manifestYoutube ? fromManifest?.sourceUrl ?? row.sourceYoutubeUrl : row.sourceYoutubeUrl,
  };
}

async function findSeed(baseId: string): Promise<{ path: string; alias: boolean } | undefined> {
  const exact = join(seedMidiDir(), baseId + ".mid");
  if (existsSync(exact)) return { path: exact, alias: false };
  const alias = seedAliases[baseId];
  if (alias) {
    const aliasPath = join(seedMidiDir(), alias);
    if (existsSync(aliasPath)) return { path: aliasPath, alias: true };
  }
  return undefined;
}

async function findUpload(baseId: string): Promise<string | undefined> {
  const files = await readdir(uploadsDir()).catch(() => [] as string[]);
  const prefix = baseId.toLowerCase() + ".";
  const name = files.find((file) => file.toLowerCase().startsWith(prefix) && /\.(mid|midi|xml|musicxml|mxl)$/i.test(file));
  return name ? join(uploadsDir(), name) : undefined;
}

async function findYoutubeSource(baseId: string): Promise<YoutubeSource | undefined> {
  // Prefer the newest completed transcription.  Reprocessed jobs (for
  // example the `re2-*` runs kept in data/transcribed/) exist specifically to
  // replace the first Basic Pitch pass; choosing the oldest row silently
  // resurrects the broken import we are trying to repair.
  const jobs = getDb().prepare("SELECT id, youtube_url FROM conversion_jobs WHERE song_id = ? OR song_id LIKE ? ORDER BY created_at DESC")
    .all(baseId + "-e", baseId + "-%") as { id: string; youtube_url: string }[];
  const candidates: { dir: string; jobUrl: string | null }[] = jobs.map((job) => ({ dir: join(transcribedDir(), job.id), jobUrl: job.youtube_url }));
  for (const name of await readdir(transcribedDir()).catch(() => [] as string[])) {
    if (name.includes(baseId)) candidates.push({ dir: join(transcribedDir(), name), jobUrl: null });
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.dir)) continue;
    seen.add(candidate.dir);
    const source = await resolveYoutubeSource(candidate.dir, sourceSelection);
    if (!source) continue;
    return {
      midi: source.midiPath,
      audio: source.audioPath,
      jobUrl: candidate.jobUrl,
      sourceKind: source.sourceKind,
      availableKinds: source.availableKinds,
    };
  }
  return undefined;
}

function describeYoutubeSource(source: YoutubeSource): string {
  const alternateKinds = source.availableKinds.filter((kind) => kind !== source.sourceKind);
  return `youtube:${source.sourceKind}:${source.midi}${alternateKinds.length ? ` (also available: ${alternateKinds.join(",")})` : ""}`;
}

async function detectTempo(audioPath: string): Promise<number> {
  if (process.env.KEYSPILLI_TEMPO_OVERRIDE) return normalizeTempoBpm(Number(process.env.KEYSPILLI_TEMPO_OVERRIDE));
  if (!existsSync(TEMPO_PY) || !existsSync(PYTHON)) return 120;
  const result = await execFileP(PYTHON, [TEMPO_PY, audioPath], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const bpm = Number((result.stdout.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return normalizeTempoBpm(bpm);
}

async function prepareYoutubeMidi(source: YoutubeSource, tempo: number): Promise<{ buf: Uint8Array; filtered: boolean }> {
  const raw = parseMidi(new Uint8Array(await readFile(source.midi)));
  const rawTempo = normalizeTempoBpm(raw.tempoBpm);
  const factor = tempo / rawTempo;
  const notes = raw.notes.map((note) => ({ ...note, start: note.start * factor, dur: note.dur * factor }));
  const rewritten = writeMidi(notes, { tempoBpm: tempo, timeSig: raw.timeSig, keySig: raw.keySig, keyMode: raw.keyMode });
  try {
    return { buf: await filterTranscription(rewritten, source.audio), filtered: true };
  } catch (error) {
    if (!allowUnfilteredYoutube) throw error;
    console.warn("! allowing unfiltered YouTube source: " + (error as Error).message);
    return { buf: rewritten, filtered: false };
  }
}

async function storedAdvancedMidi(baseId: string, fallbackTempo: number): Promise<Uint8Array> {
  const stored = JSON.parse(await readFile(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
    notes: Parameters<typeof writeMidi>[0];
    tempoBpm?: number;
    timeSig?: [number, number];
  };
  if (!Array.isArray(stored.notes) || stored.notes.length < 8) throw new Error("stored advanced notes missing or too short");
  return writeMidi(stored.notes, { tempoBpm: normalizeTempoBpm(fallbackTempo || stored.tempoBpm), timeSig: stored.timeSig });
}

async function sourcePathFor(baseId: string, meta: CatalogMeta): Promise<string> {
  if (meta.contentType === "upload") {
    const path = await findUpload(baseId);
    if (path) return "upload:" + path;
    const reconstructed = join(artifactsDir(baseId, "a"), "notes.json");
    if (existsSync(reconstructed)) return "reconstructed-upload:" + reconstructed;
    throw new Error("persisted upload source missing");
  }
  const seed = await findSeed(baseId);
  if (seed) return (seed.alias ? "alias:" : "seed:") + seed.path;
  if (meta.contentType === "youtube") {
    const youtube = await findYoutubeSource(baseId);
    if (!youtube) throw new Error("raw YouTube transcription source missing");
    return describeYoutubeSource(youtube);
  }
  if (storedAdvancedFallbacks.has(baseId)) {
    const path = join(artifactsDir(baseId, "a"), "notes.json");
    if (existsSync(path)) return "stored-advanced-fallback:" + path;
  }
  throw new Error("no source file or approved fallback");
}

async function sourceFor(baseId: string, meta: CatalogMeta): Promise<{ buf: Uint8Array; source: string; sourceRef?: string; cleanTranscription?: boolean; sourceYoutubeUrl?: string | null; tempo?: number }> {
  if (meta.contentType === "upload") {
    const path = await findUpload(baseId);
    if (path) return { buf: new Uint8Array(await readFile(path)), source: "upload:" + path, sourceRef: `upload:${baseId}` };
    // The original upload may have been pruned while the repaired artifact
    // set remained. Reconstruct a deterministic MIDI source from the
    // validated advanced notes so this base can still be rebuilt and the
    // reconstructed source is persisted by ingestSource for future runs.
    return {
      buf: await storedAdvancedMidi(baseId, meta.tempo ?? 120),
      source: "reconstructed-upload:" + join(artifactsDir(baseId, "a"), "notes.json"),
      sourceRef: `reconstructed-upload:${baseId}`,
    };
  }
  const seed = await findSeed(baseId);
  if (seed) {
    return {
      buf: new Uint8Array(await readFile(seed.path)),
      source: (seed.alias ? "alias:" : "seed:") + seed.path,
      sourceRef: `seed:${seed.alias ? seedAliases[baseId] : baseId + ".mid"}`,
      cleanTranscription: meta.contentType === "youtube" ? false : undefined,
    };
  }
  if (meta.contentType === "youtube") {
    const youtube = await findYoutubeSource(baseId);
    if (!youtube) throw new Error("raw YouTube transcription source missing");
    const tempo = await detectTempo(youtube.audio);
    const prepared = await prepareYoutubeMidi(youtube, tempo);
    return {
      buf: prepared.buf,
      source: describeYoutubeSource(youtube),
      sourceRef: `youtube:${baseId}`,
      sourceYoutubeUrl: youtube.jobUrl ?? meta.sourceYoutubeUrl,
      tempo,
      // The onset filter removes notes with no audio attack. Keep the second,
      // deliberately conservative ghost-note pass as well: it catches short
      // low-velocity misclicks that happen on a real onset (the common Hozier
      // “extra note” failure) without touching curated seed restores.
      cleanTranscription: true,
    };
  }
  if (storedAdvancedFallbacks.has(baseId)) {
    return { buf: await storedAdvancedMidi(baseId, meta.tempo ?? 120), source: "stored-advanced-fallback", sourceRef: `stored-advanced:${baseId}` };
  }
  throw new Error("no source file or approved fallback");
}

const bases = (onlyBases.length ? onlyBases : getCatalogBases()).sort();
let ok = 0;
let failed = 0;
let skipped = 0;

for (const baseId of bases) {
  const meta = metadataFor(baseId);
  if (!meta) {
    skipped++;
    if (onlyBases.length) failed++;
    console.warn("- " + baseId + ": no catalog metadata");
    continue;
  }
  // Curated YouTube seeds retain their source provenance, so this pass cannot
  // overwrite a repaired seed after restore-curated.ts runs.
  if (skipYoutube && meta.contentType === "youtube") {
    skipped++;
    console.log("- " + baseId + ": skipped YouTube");
    continue;
  }
  try {
    if (dryRun) {
      const source = await sourcePathFor(baseId, meta);
      console.log("~ " + baseId + ": " + source);
      continue;
    }
    const src = await sourceFor(baseId, meta);
    console.log("~ " + baseId + ": " + src.source);
    const result = await ingestSource({
      buf: src.buf,
      title: meta.title,
      artist: meta.artist,
      category: meta.category,
      style: meta.style,
      mood: meta.mood,
      key: meta.key,
      tempo: src.tempo ?? meta.tempo,
      contentType: meta.contentType,
      acquiredVia: meta.acquiredVia,
      sourceYoutubeUrl: src.sourceYoutubeUrl ?? meta.sourceYoutubeUrl,
      sourceRef: src.sourceRef,
      baseId,
      cleanTranscription: src.cleanTranscription,
    });
    if (result.error) {
      failed++;
      console.error("x " + baseId + ": " + result.error);
    } else {
      ok++;
      console.log("+ " + baseId + ": " + result.songIds.length + " variants");
    }
  } catch (error) {
    failed++;
    console.error("x " + baseId + ": " + (error as Error).message);
  }
}

console.log("reingest-catalog: " + ok + " ok, " + failed + " failed, " + skipped + " skipped" + (dryRun ? " (dry run)" : ""));
// Dry-run is a preflight gate: missing rows/sources must fail before an
// operator trusts the subsequent production rebuild steps.
if (failed) process.exitCode = 1;
