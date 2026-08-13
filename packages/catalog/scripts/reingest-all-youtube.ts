/**
 * Re-run the worker pipeline in place for YouTube bases: detect tempo from
 * the audio, rescale the raw Basic Pitch MIDI's beats to that tempo (the raw
 * beats are seconds-derived at 120 BPM, so without rescaling playback speed
 * and the onset filter would both be wrong), onset-filter, and re-ingest with
 * stable base ids (player URLs stay stable).
 *
 * Usage: npx tsx packages/catalog/scripts/reingest-all-youtube.ts [--dry-run] [--keep-existing-tempo] [baseId...]
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
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepExistingTempo = args.includes("--keep-existing-tempo");
const onlyBases = args.filter((a) => !a.startsWith("--"));
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");

async function detectTempo(audioPath: string): Promise<number> {
  if (process.env.KEYSPILLI_TEMPO_OVERRIDE) return Number(process.env.KEYSPILLI_TEMPO_OVERRIDE);
  if (!existsSync(TEMPO_PY)) return 120;
  const { stdout } = await execFileP(PYTHON, [TEMPO_PY, audioPath], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const bpm = Number((stdout.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return bpm >= 20 && bpm <= 300 ? bpm : 120;
}

/** Prefer the real files; the data volume carries macOS AppleDouble junk (._*). */
function pickFiles(files: string[]): { midi?: string; audio?: string } {
  const clean = files.filter((f) => !f.startsWith("._"));
  const midi = clean.find((f) => f === "audio_basic_pitch.mid") ?? clean.find((f) => f.endsWith("_basic_pitch.mid"));
  const audio = clean.find((f) => f === "audio.mp3") ?? clean.find((f) => f.startsWith("audio.") && !f.endsWith(".part"));
  return { midi, audio };
}

async function findSource(jobId: string | undefined, baseId: string): Promise<{ midi: string; audio: string } | undefined> {
  const candidates: string[] = [];
  if (jobId) candidates.push(join(transcribedDir(), jobId));
  // Fallback: any dir whose name contains the job id or song id.
  for (const name of await readdir(transcribedDir())) {
    if (name.includes(jobId ?? "\u0000") || name.includes(baseId)) candidates.push(join(transcribedDir(), name));
  }
  for (const dir of candidates) {
    const files = await readdir(dir).catch(() => [] as string[]);
    const { midi, audio } = pickFiles(files);
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

const rows = getDb().prepare("SELECT DISTINCT base_id FROM songs WHERE content_type='youtube' ORDER BY base_id").all() as { base_id: string }[];
const bases = onlyBases.length ? rows.filter((r) => onlyBases.includes(r.base_id)) : rows;
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
  let detected: number;
  try {
    detected = await detectTempo(src.audio);
  } catch (err) {
    skipped++;
    console.warn(`x ${base}: tempo detection failed, skipped: ${(err as Error).message}`);
    continue;
  }
  // Non-120 DB tempos are manual corrections (the old pipeline always stored
  // 120); keep them when asked so the VPS preserves e.g. Dear God's 75 BPM.
  const tempo = keepExistingTempo && song.tempo && song.tempo !== 120 ? song.tempo : detected;
  let raw;
  try {
    raw = parseMidi(new Uint8Array(await readFile(src.midi)));
  } catch (err) {
    skipped++;
    console.warn(`x ${base}: raw midi unreadable (${src.midi}): ${(err as Error).message}`);
    continue;
  }
  // Raw beats are calibrated to the source MIDI's tempo (120); rescale so the
  // absolute seconds stay identical while the beat unit matches the new tempo.
  const factor = tempo / raw.tempoBpm;
  const notes = raw.notes.map((n) => ({ ...n, start: n.start * factor, dur: n.dur * factor }));
  const rewritten = writeMidi(notes, {
    tempoBpm: tempo,
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
  console.log(`~ ${base}: tempo ${raw.tempoBpm} -> ${tempo}${keepExistingTempo && tempo !== detected ? ` (kept ${tempo}, detected ${detected})` : ""}, notes ${raw.notes.length} -> ${filteredNotes}`);
  if (dryRun) {
    console.log(`? ${base}: would re-ingest (before a-notes ${before ?? "n/a"})`);
    continue;
  }
  const r = await ingestSource({
    buf: new Uint8Array(filtered),
    title: song.title,
    artist: song.artist,
    category: song.category,
    style: song.style,
    mood: song.mood,
    key: song.key,
    tempo,
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
    console.log(`+ ${base}: a-notes ${before ?? "n/a"} -> ${after ?? "n/a"}, ${tempo} BPM`);
  }
}

console.log(`re-ingested ${ok}, skipped ${skipped}${dryRun ? " (dry run)" : ""}`);
