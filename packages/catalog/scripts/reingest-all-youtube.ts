/**
 * Re-run the worker pipeline in place for every YouTube base: detect tempo
 * from the audio, rewrite the raw Basic Pitch MIDI's tempo meta, onset-filter,
 * and re-ingest with stable base ids (player URLs stay stable).
 *
 * Usage: npx tsx packages/catalog/scripts/reingest-all-youtube.ts [--dry-run]
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import { filterTranscription, getDb, getSongsByBase, ingestSource, transcribedDir } from "../src/index.js";
import { artifactsDir, ROOT } from "../src/paths.js";

const execFileP = promisify(execFile);
const dryRun = process.argv.includes("--dry-run");
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");

async function detectTempo(audioPath: string): Promise<number> {
  if (process.env.KEYSPILLI_TEMPO_OVERRIDE) return Number(process.env.KEYSPILLI_TEMPO_OVERRIDE);
  // The tempo lane owns tempo.py; until it lands, keep Basic Pitch's default.
  if (!existsSync(TEMPO_PY)) return 120;
  const { stdout } = await execFileP(PYTHON, [TEMPO_PY, audioPath], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const bpm = Number((stdout.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return bpm >= 20 && bpm <= 300 ? bpm : 120;
}

async function findSource(jobId: string | undefined, baseId: string): Promise<{ midi: string; audio: string } | undefined> {
  const candidates: string[] = [];
  if (jobId) candidates.push(join(transcribedDir(), jobId));
  // Fallback: any dir whose name contains the job id or song id.
  for (const name of await readdir(transcribedDir())) {
    if (name.includes(jobId ?? "\u0000") || name.includes(baseId)) candidates.push(join(transcribedDir(), name));
  }
  for (const dir of candidates) {
    // Prefer the strict-threshold re-transcription when present.
    const reFiles = await readdir(join(dir, "re")).catch(() => [] as string[]);
    const reMidi = reFiles.find((f) => f.endsWith("_basic_pitch.mid"));
    const reAudio = reFiles.find((f) => f.startsWith("audio."));
    if (reMidi && reAudio) return { midi: join(dir, "re", reMidi), audio: join(dir, "re", reAudio) };
    const files = await readdir(dir).catch(() => [] as string[]);
    const midi = files.find((f) => f.endsWith("_basic_pitch.mid"));
    const audio = files.find((f) => f.startsWith("audio."));
    if (midi && audio) return { midi: join(dir, midi), audio: join(dir, audio) };
  }
  return undefined;
}

async function variantCount(baseId: string): Promise<number | undefined> {
  try {
    const j = JSON.parse(await readFile(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as { notes: unknown[] };
    return j.notes.length;
  } catch {
    return undefined;
  }
}

const bases = getDb().prepare("SELECT DISTINCT base_id FROM songs WHERE content_type='youtube' ORDER BY base_id").all() as { base_id: string }[];
let ok = 0;
let skipped = 0;

for (const { base_id: base } of bases) {
  const song = getSongsByBase(base)[0];
  const jobs = getDb()
    .prepare("SELECT * FROM conversion_jobs WHERE song_id = ? OR song_id LIKE ? ORDER BY created_at")
    .all(`${base}-e`, `${base}-%`) as { id: string; youtube_url: string }[];
  const job = jobs[0];
  const src = await findSource(job?.id, base);
  if (!song || !src) {
    skipped++;
    console.log(`- ${base}: no db row or raw source (job ${job?.id ?? "none"})`);
    continue;
  }
  const before = await variantCount(base);
  const bpm = await detectTempo(src.audio);
  const raw = parseMidi(new Uint8Array(await readFile(src.midi)));
  const rewritten = writeMidi(raw.notes, {
    tempoBpm: bpm,
    timeSig: raw.timeSig,
    keySig: raw.keySig,
    keyMode: raw.keyMode,
  });
  let filtered: Uint8Array;
  try {
    filtered = await filterTranscription(rewritten, src.audio);
  } catch (err) {
    skipped++;
    console.warn(`x ${base}: onset filter failed: ${(err as Error).message}`);
    continue;
  }
  const filteredNotes = parseMidi(new Uint8Array(filtered)).notes.length;
  console.log(`~ ${base}: tempo ${raw.tempoBpm} -> ${bpm}, notes ${raw.notes.length} -> ${filteredNotes}`);
  if (dryRun) {
    console.log(`? ${base}: would re-ingest (before a-notes ${before ?? "n/a"})`);
    continue;
  }
  const r = await ingestSource({
    buf: new Uint8Array(filtered),
    title: song.title,
    artist: song.artist,
    category: song.category,
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceYoutubeUrl: job?.youtube_url ?? song.sourceYoutubeUrl ?? "",
    baseId: base,
  });
  const after = await variantCount(base);
  if (r.error) {
    skipped++;
    console.warn(`x ${base}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${base}: a-notes ${before ?? "n/a"} -> ${after ?? "n/a"}, ${bpm} BPM`);
  }
}

console.log(`re-ingested ${ok}, skipped ${skipped}${dryRun ? " (dry run)" : ""}`);
