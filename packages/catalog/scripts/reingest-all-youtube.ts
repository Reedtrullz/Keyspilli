/**
 * Re-run the worker pipeline in place for YouTube bases: detect tempo from
 * the audio, rescale the raw Basic Pitch MIDI's beats to that tempo (the raw
 * beats are seconds-derived at 120 BPM, so without rescaling playback speed
 * and the onset filter would both be wrong), onset-filter, and re-ingest with
 * stable base ids (player URLs stay stable).
 *
 * Usage: npx tsx packages/catalog/scripts/reingest-all-youtube.ts [--dry-run] [--keep-existing-tempo] [--preserve-melody] [--source=root|strict|auto] [baseId...]
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, transcriptionMaxDurationBeats, writeMidi } from "@keyspilli/midi";
import {
  AUDIO_ONSET_DETECTOR_CONFIG,
  filterTranscription,
  getDb,
  getSongsByBase,
  ingestSource,
  MAX_YOUTUBE_IMPORT_DUR_BEATS,
  ONSET_MATCH_SEC,
  parseYoutubeSourceArgs,
  resolveYoutubeSource,
  TRANSCRIPTION_PIPELINE_CONFIG,
  TRANSCRIPTION_POST_PROCESSING_DEFAULTS,
  transcribedDir,
  type TranscriptionProvenance,
} from "../src/index.js";
import { artifactsDir, ROOT, seedMidiDir } from "../src/paths.js";

const execFileP = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepExistingTempo = args.includes("--keep-existing-tempo");
// The normal onset gate is conservative and remains the default. This
// explicit canary mode keeps the rescaled Basic Pitch source intact so the
// learner arranger can recover continuity-supported melody/inner voices before
// we decide whether the source is safe to publish.
const preserveMelody = args.includes("--preserve-melody");
const { selection: sourceSelection, positionalArgs: onlyBases } = parseYoutubeSourceArgs(args, "root");
if (preserveMelody && onlyBases.length !== 1) {
  console.error("--preserve-melody requires exactly one target base id; refusing a full-catalog raw transcription run");
  process.exit(1);
}
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");
const BASIC_PITCH_VERSION = process.env.KEYSPILLI_BP_VERSION ?? process.env.BASIC_PITCH_VERSION ?? "unknown";
const BASIC_PITCH_SERIALIZATION = process.env.KEYSPILLI_BP_SERIALIZATION ?? "default";
const ONSET_THRESHOLD = Number(process.env.KEYSPILLI_ONSET ?? 0.65);
const FRAME_THRESHOLD = Number(process.env.KEYSPILLI_FRAME ?? 0.45);

/** Per-base transcription tuning. Keyed by base id or job id; values fall
 * back to the global env defaults when omitted. */
interface TranscriptionOverride {
  denseBand?: boolean;
  onsetThreshold?: number;
  frameThreshold?: number;
  skipOnsetFilter?: boolean;
  onsetMatchSec?: number;
  collapseOctaveDoubles?: boolean;
  thinBassMinGapBeats?: number;
  trimIntroBeats?: number;
  tempoBpm?: number;
}
function getOverride(baseId: string, jobId?: string): TranscriptionOverride {
  try {
    const map = JSON.parse(readFileSync(join(ROOT, "catalog", "transcription-overrides.json"), "utf8"));
    return (jobId && map[jobId]) || map[baseId] || {};
  } catch {
    return {};
  }
}

async function detectTempo(audioPath: string): Promise<number> {
  if (process.env.KEYSPILLI_TEMPO_OVERRIDE) return Number(process.env.KEYSPILLI_TEMPO_OVERRIDE);
  if (!existsSync(TEMPO_PY)) return 120;
  const { stdout } = await execFileP(PYTHON, [TEMPO_PY, audioPath], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const bpm = Number((stdout.match(/\d+(?:\.\d+)?/) ?? [])[0]);
  return bpm >= 20 && bpm <= 300 ? bpm : 120;
}

type ResolvedYoutubeSource = NonNullable<Awaited<ReturnType<typeof resolveYoutubeSource>>>;

interface SelectedYoutubeSource {
  candidate: ResolvedYoutubeSource;
  sourceId: string;
}

async function findSource(
  jobId: string | undefined,
  baseId: string,
): Promise<SelectedYoutubeSource | undefined> {
  const candidates: string[] = [];
  if (jobId) candidates.push(join(transcribedDir(), jobId));
  // Fallback: any dir whose name contains the job id, song id, or the first
  // two slug words from the base id. The latter catches operator-named repair
  // sources like re3-levva-low for a base titled levva-livet that do not
  // carry the full base-id or job-id strings.
  const baseSlugWords = baseId.split("-").filter(Boolean).slice(0, 2);
  const shortBaseKey = baseSlugWords.length === 2 ? baseSlugWords.join("-") : undefined;
  for (const name of await readdir(transcribedDir())) {
    if (
      name.includes(jobId ?? "\u0000") ||
      name.includes(baseId) ||
      (shortBaseKey && name.toLowerCase().includes(shortBaseKey))
    ) {
      candidates.push(join(transcribedDir(), name));
    }
  }
  for (const dir of candidates) {
    const source = await resolveYoutubeSource(dir, sourceSelection);
    if (source) return { candidate: source, sourceId: basename(dir) };
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
  const selected = await findSource(job?.id, base);
  const src = selected?.candidate;
  const selectedSourceId = selected?.sourceId;
  const selectedJob = jobs.find((candidate) => candidate.id === selectedSourceId) ?? job;
  const ov = getOverride(base, job?.id);
  const dense = ov.denseBand === true || ov.skipOnsetFilter === true;
  // The raw BP MIDI on disk was produced with whatever thresholds the original
  // worker run used; re-running Basic Pitch here would be expensive and the
  // stored source may already be the best available. Apply only the onset
  // match override to the existing source, but record BP thresholds in
  // provenance so a future re-transcription knows what was used.
  const onsetMatch = ov.onsetMatchSec ?? (dense ? 0.35 : ONSET_MATCH_SEC);
  const collapseOctaves = ov.collapseOctaveDoubles;
  const thinBassGap = ov.thinBassMinGapBeats;
  const trimIntroBeats = ov.trimIntroBeats;
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
    var tempoOv = getOverride(base, job?.id);
    detected = tempoOv.tempoBpm ?? await detectTempo(src.audioPath);
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
  const tempo = tempoOv?.tempoBpm ?? (keepExistingTempo && song.tempo && song.tempo !== 120 ? song.tempo : detected);
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
    filtered = preserveMelody || dense
      ? rewritten
      : await filterTranscription(rewritten, src.audioPath, { onsetMatchSec: onsetMatch, trimIntroBeats, collapseOctaveDoubles: collapseOctaves, thinBassMinGapBeats: thinBassGap });
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
  console.log(`~ ${base}: source=${src.sourceKind}${alternateKinds.length ? ` (also available: ${alternateKinds.join(",")})` : ""}, tempo ${raw.tempoBpm} -> ${tempo}${keepExistingTempo && tempo !== detected ? ` (kept ${tempo}, detected ${detected})` : ""}, notes ${raw.notes.length} -> ${filteredNotes}${preserveMelody ? " (melody-preserving; onset filter bypassed)" : ""}`);
  if (dryRun) {
    console.log(`? ${base}: would re-ingest (before a-notes ${before ?? "n/a"})`);
    continue;
  }
  const sourceStat = await stat(src.midiPath).catch(() => undefined);
  const transcription: TranscriptionProvenance = {
    basicPitchVersion: BASIC_PITCH_VERSION,
    modelSerialization: BASIC_PITCH_SERIALIZATION,
    onsetThreshold: ov.onsetThreshold ?? ONSET_THRESHOLD,
    frameThreshold: ov.frameThreshold ?? FRAME_THRESHOLD,
    tempo,
    tempoSource: process.env.KEYSPILLI_TEMPO_OVERRIDE
      ? "override"
      : keepExistingTempo && tempo !== detected
        ? "manual"
        : "detected",
    audioSource: "youtube",
    transcribedAt: sourceStat?.mtime.toISOString() ?? new Date().toISOString(),
    pipeline: TRANSCRIPTION_PIPELINE_CONFIG,
    postProcessing: {
      filterApplied: !preserveMelody,
      cleanupApplied: true,
      onsetMatchSec: onsetMatch,
      onsetDetector: AUDIO_ONSET_DETECTOR_CONFIG,
      minVelocity: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minVelocity,
      minDurationBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minDurationBeats,
      mergeWindowBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.mergeWindowBeats,
      maxPolyphony: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxPolyphony,
      maxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxSounding,
      maxDurationSec: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxDurationSec,
      maxDurationBeats: transcriptionMaxDurationBeats(tempo),
      importedMaxDurationBeats: MAX_YOUTUBE_IMPORT_DUR_BEATS,
      importedMaxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.importedMaxSounding,
    },
  };
  const r = await ingestSource({
    buf: new Uint8Array(filtered),
    title: song.title,
    artist: song.artist,
    category: song.category,
    style: song.style,
    mood: song.mood,
    key: song.key,
    // The rewritten MIDI already carries the resolved calibration tempo. Do
    // not pass a second override here: ingestSource would otherwise label the
    // manifest as "override" while this transcription block says detected or
    // manual. One parsed MIDI tempo is the authority at this seam.
    tempo: undefined,
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceYoutubeUrl: selectedJob?.youtube_url ?? song.sourceYoutubeUrl ?? null,
    sourceRef: selectedSourceId
      ? `${selectedJob?.id === selectedSourceId ? "youtube-job" : "youtube-source"}:${selectedSourceId}`
      : "youtube-source:unknown",
    baseId: base,
    // Run the conservative ghost-note pass in ingestSource. In the explicit
    // melody-preserving canary the audio-onset gate was bypassed above, so the
    // provenance block records that choice instead of silently calling it a
    // filtered transcription.
    cleanTranscription: true,
    transcription,
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
