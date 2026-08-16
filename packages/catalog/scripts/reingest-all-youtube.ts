/**
 * Re-run the worker pipeline in place for YouTube bases: detect tempo from
 * the audio, rescale the raw Basic Pitch MIDI's beats to that tempo (the raw
 * beats are seconds-derived at 120 BPM, so without rescaling playback speed
 * and the onset filter would both be wrong), onset-filter, and re-ingest with
 * stable base ids (player URLs stay stable).
 *
 * Usage: npx tsx packages/catalog/scripts/reingest-all-youtube.ts [--dry-run] [--keep-existing-tempo] [--source=root|strict|auto] [baseId...]
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import {
  filterTranscription,
  getDb,
  getSongsByBase,
  ingestSource,
  parseYoutubeSourceArgs,
  resolveYoutubeSource,
  transcribedDir,
} from "../src/index.js";
import { artifactsDir, ROOT, seedMidiDir } from "../src/paths.js";

const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepExistingTempo = args.includes("--keep-existing-tempo");
const { selection: sourceSelection, positionalArgs: onlyBases } = parseYoutubeSourceArgs(args, "root");
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");

async function detectTempo(audioPath: string): Promise<number> {
  if (process.env.KEYSPILLI_TEMPO_OVERRIDE) return Number(process.env.KEYSPILLI_TEMPO_OVERRIDE);
  if (!existsSync(TEMPO_PY)) return 120;
  const { stdout } = await execFileP(PYTHON, [TEMPO_PY, audioPath], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const bpm = Number((stdout.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return bpm >= 20 && bpm <= 300 ? bpm : 120;
}

async function findSource(
  jobId: string | undefined,
  baseId: string,
): Promise<Awaited<ReturnType<typeof resolveYoutubeSource>> | undefined> {
  const candidates: string[] = [];
  if (jobId) candidates.push(join(transcribedDir(), jobId));
  // Fallback: any dir whose name contains the job id or song id.
  for (const name of await readdir(transcribedDir())) {
    if (name.includes(jobId ?? "\u0000") || name.includes(baseId)) candidates.push(join(transcribedDir(), name));
  }
  for (const dir of candidates) {
    const source = await resolveYoutubeSource(dir, sourceSelection);
    if (source) return source;
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
let failed = 0;
const failOnMissingSource = sourceSelection === "strict" || onlyBases.length > 0;

for (const { base_id: base } of bases) {
  const song = getSongsByBase(base)[0];
  const jobs = getDb()
    // Reprocessed jobs are newer and exist specifically to replace broken
    // first-pass transcriptions. Always prefer the newest completed source;
    // selecting the oldest row can silently resurrect the artifact this
    // rebuild is meant to repair. Tie-break by id for deterministic runs.
    .prepare("SELECT * FROM conversion_jobs WHERE song_id = ? OR song_id LIKE ? ORDER BY created_at DESC, id DESC")
    .all(`${base}-e`, `${base}-%`) as { id: string; youtube_url: string }[];
  const job = jobs[0];
  const src = await findSource(job?.id, base);
  if (existsSync(join(seedMidiDir(), `${base}.mid`))) {
    skipped++;
    console.log(`- ${base}: curated seed exists, skipped (restore-curated.ts owns it)`);
    continue;
  }
  if (!song || !src) {
    skipped++;
    const message = `- ${base}: no db row or raw source (job ${job?.id ?? "none"})`;
    if (failOnMissingSource) {
      failed++;
      console.error(message);
    } else {
      console.log(message);
    }
    continue;
  }
  const before = await variantCount(base);
  let detected: number;
  try {
    detected = await detectTempo(src.audioPath);
  } catch (err) {
    skipped++;
    const message = `x ${base}: tempo detection failed, skipped: ${(err as Error).message}`;
    if (failOnMissingSource) {
      failed++;
      console.error(message);
    } else {
      console.warn(message);
    }
    continue;
  }
  // Non-120 DB tempos are manual corrections (the old pipeline always stored
  // 120); keep them when asked so the VPS preserves e.g. Dear God's 75 BPM.
  const tempo = keepExistingTempo && song.tempo && song.tempo !== 120 ? song.tempo : detected;
  let raw;
  try {
    raw = parseMidi(new Uint8Array(await readFile(src.midiPath)));
  } catch (err) {
    skipped++;
    const message = `x ${base}: raw midi unreadable (${src.midiPath}): ${(err as Error).message}`;
    if (failOnMissingSource) {
      failed++;
      console.error(message);
    } else {
      console.warn(message);
    }
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
    filtered = await filterTranscription(rewritten, src.audioPath);
  } catch (err) {
    skipped++;
    const message = `x ${base}: onset filter failed: ${(err as Error).message}`;
    if (failOnMissingSource) {
      failed++;
      console.error(message);
    } else {
      console.warn(message);
    }
    continue;
  }
  const filteredNotes = parseMidi(new Uint8Array(filtered)).notes.length;
  const alternateKinds = src.availableKinds.filter((kind) => kind !== src.sourceKind);
  console.log(`~ ${base}: source=${src.sourceKind}${alternateKinds.length ? ` (also available: ${alternateKinds.join(",")})` : ""}, tempo ${raw.tempoBpm} -> ${tempo}${keepExistingTempo && tempo !== detected ? ` (kept ${tempo}, detected ${detected})` : ""}, notes ${raw.notes.length} -> ${filteredNotes}`);
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
    sourceYoutubeUrl: job?.youtube_url ?? song.sourceYoutubeUrl ?? null,
    sourceRef: `youtube-job:${job?.id ?? "unknown"}`,
    baseId: base,
    // Keep the audio-onset filter and run the conservative ghost-note pass in
    // ingestSource as well; real-onset misclicks can survive the first filter.
    cleanTranscription: true,
  });
  const after = await variantCount(base);
  if (r.error) {
    failed++;
    console.warn(`x ${base}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${base}: a-notes ${before ?? "n/a"} -> ${after ?? "n/a"}, ${tempo} BPM`);
  }
}

console.log(`re-ingested ${ok}, skipped ${skipped}, failed ${failed}${dryRun ? " (dry run)" : ""}`);
if (failed) process.exitCode = 1;
