/**
 * YouTube conversion worker: polls conversion_jobs, downloads audio with
 * yt-dlp, transcribes with Basic Pitch (python venv), ingests the resulting
 * MIDI into the catalog, and marks the job done/error.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  claimJob,
  getQueuedJobs,
  requeueOrphaned,
  updateJob,
  getJob,
  getSong,
  resolveYoutubeAudio,
  transcribedDir,
  ROOT,
  seedMidiDir,
  ingestSource,
  filterTranscription,
  AUDIO_ONSET_DETECTOR_CONFIG,
  MAX_YOUTUBE_IMPORT_DUR_BEATS,
  ONSET_MATCH_SEC,
  TRANSCRIPTION_PIPELINE_CONFIG,
  TRANSCRIPTION_POST_PROCESSING_DEFAULTS,
  type TranscriptionProvenance,
  resolveYoutubeSource,
} from "@keyspilli/catalog";
import { parseMidi, transcriptionMaxDurationBeats } from "@keyspilli/midi";

const execFileP = promisify(execFile);
const POLL_MS = Number(process.env.KEYSPILLI_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.KEYSPILLI_MAX_ATTEMPTS ?? 2);
const BP_TIMEOUT_MS = Number(process.env.KEYSPILLI_BP_TIMEOUT_MS ?? 900_000);
const MAX_VIDEO_DURATION_SEC = Number(process.env.KEYSPILLI_MAX_VIDEO_DURATION_SEC ?? "300");
const TEMPO_TIMEOUT_MS = 60_000;
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const BASIC_PITCH = join(dirname(PYTHON), "basic-pitch");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");
const TEMPO_OVERRIDE = process.env.KEYSPILLI_TEMPO_OVERRIDE;
const BASIC_PITCH_SERIALIZATION = process.env.KEYSPILLI_BP_SERIALIZATION ?? "";
const BASIC_PITCH_VERSION = process.env.KEYSPILLI_BP_VERSION ?? process.env.BASIC_PITCH_VERSION ?? "unknown";
const ONSET_THRESHOLD = process.env.KEYSPILLI_ONSET ?? "0.65";
const FRAME_THRESHOLD = process.env.KEYSPILLI_FRAME ?? "0.45";

/** Per-job transcription tuning. Loaded lazily so a worker can pick up edits
 * without a restart; keyed by job id or song base id, whichever matches first.
 * Values are optional and fall back to the global env defaults. */
interface TranscriptionOverride {
  onsetThreshold?: number;
  frameThreshold?: number;
  onsetMatchSec?: number;
  collapseOctaveDoubles?: boolean;
  thinBassMinGapBeats?: number;
  trimIntroBeats?: number;
  tempoBpm?: number;
}
let overrideCache: { path: string; mtimeMs: number; map: Record<string, TranscriptionOverride> } | undefined;
function getOverride(jobId: string): TranscriptionOverride {
  const path = join(ROOT, "catalog", "transcription-overrides.json");
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (!overrideCache || overrideCache.path !== path || overrideCache.mtimeMs !== mtimeMs) {
      overrideCache = { path, mtimeMs, map: JSON.parse(readFileSync(path, "utf8")) };
    }
    return overrideCache.map[jobId] ?? {};
  } catch {
    return {};
  }
}

// Validate numeric env vars at startup to fail fast on misconfiguration
function requirePositiveFloat(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number, got "${value}"`);
  }
  return parsed;
}
requirePositiveFloat("KEYSPILLI_ONSET_MATCH_SEC", process.env.KEYSPILLI_ONSET_MATCH_SEC ?? "0.15");
requirePositiveFloat("KEYSPILLI_ONSET", ONSET_THRESHOLD);
requirePositiveFloat("KEYSPILLI_FRAME", FRAME_THRESHOLD);

async function run(cmd: string, args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await execFileP(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

/**
 * yt-dlp with a client fallback chain (default -> android -> tv) plus an
 * explicit JS runtime. YouTube bot-challenges datacenter IPs on the default
 * client; the android/tv clients usually bypass it.
 */
const YT_CLIENTS = ["", "youtube:player_client=android", "youtube:player_client=tv"];

async function ytDlp(args: string[], timeoutMs = 300_000): Promise<string> {
  let lastError: unknown = null;
  for (const client of YT_CLIENTS) {
    try {
      const full = ["--js-runtimes", "node", ...args];
      if (client) full.push("--extractor-args", client);
      return await run("yt-dlp", full, timeoutMs);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("yt-dlp failed on all clients");
}

async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  // Atomic claim: another worker may have taken it while we read metadata.
  if (!claimJob(jobId)) return;
  const existing = job.songId ? getSong(job.songId) : undefined;
  if (existing && existsSync(join(seedMidiDir(), `${existing.baseId}.mid`))) {
    updateJob(jobId, { status: "done", songId: existing.id, finishedAt: new Date().toISOString() });
    console.log(`[worker] ${jobId} curated base (${existing.baseId}), kept existing artifacts`);
    return;
  }
  const dir = join(transcribedDir(), jobId);
  try {
    await mkdir(dir, { recursive: true });
    const ov = getOverride(jobId);
    const onsetTh = requirePositiveFloat("override.onsetThreshold", String(ov.onsetThreshold ?? ONSET_THRESHOLD));
    const frameTh = requirePositiveFloat("override.frameThreshold", String(ov.frameThreshold ?? FRAME_THRESHOLD));
    const onsetMatch = requirePositiveFloat("override.onsetMatchSec", String(ov.onsetMatchSec ?? ONSET_MATCH_SEC));
    const info = await ytDlp(["--skip-download", "--print", "%(title)s\x1f%(uploader)s\x1f%(duration)s", job.youtubeUrl], 60_000);
    const [title, uploader, durationRaw] = info.trim().split("\x1f").map((s) => s?.trim() ?? "");
    const duration = Number(durationRaw);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`video duration unavailable (${durationRaw || "unknown"})`);
    if (duration > MAX_VIDEO_DURATION_SEC) {
      throw new Error(`video longer than ${MAX_VIDEO_DURATION_SEC}s (${durationRaw}s)`);
    }
    await ytDlp(["-x", "--audio-format", "mp3", "--max-filesize", "80M", "-o", join(dir, "audio.%(ext)s"), job.youtubeUrl]);
    // Do not feed a partially downloaded `audio.mp3.part` (or a stale
    // sidecar) to tempo detection/Basic Pitch after a retried yt-dlp run.
    const audioPath = await resolveYoutubeAudio(dir);
    if (!audioPath) throw new Error("no audio file produced");
    // Basic Pitch silently produces empty MIDI from truncated/unplayable files.
    // Reject files that are too small to contain valid audio.
    const { size: audioSize } = await stat(audioPath);
    if (audioSize < 1024) throw new Error(`audio file too small (${audioSize} bytes), likely corrupt download`);
    const bpArgs = [dir, audioPath, "--save-midi", "--onset-threshold", String(onsetTh), "--frame-threshold", String(frameTh)];
    const tempo = ov.tempoBpm != null ? String(ov.tempoBpm) : ((TEMPO_OVERRIDE ?? (await run(PYTHON, [TEMPO_PY, audioPath], TEMPO_TIMEOUT_MS).catch((e) => {
      console.warn(`[worker] ${jobId} tempo detection failed: ${(e as Error).message}`);
      return "";
    })))).trim();
    if (tempo) bpArgs.push("--midi-tempo", tempo);
    if (BASIC_PITCH_SERIALIZATION) bpArgs.push("--model-serialization", BASIC_PITCH_SERIALIZATION);
    const transcribedAt = new Date().toISOString();
    const detectedTempo = tempo ? Number(tempo) : undefined;
    await run(BASIC_PITCH, bpArgs, BP_TIMEOUT_MS);
    // Validate the root candidate through the shared resolver. This keeps a
    // retry from ingesting a corrupt/partial sidecar and gives the worker the
    // same candidate semantics as catalog rebuilds.
    const source = await resolveYoutubeSource(dir, "root");
    if (!source) throw new Error("basic_pitch produced no usable root MIDI/audio pair");
    const midi = await filterTranscription(new Uint8Array(await readFile(source.midiPath)), source.audioPath, {
      onsetMatchSec: onsetMatch,
      collapseOctaveDoubles: ov.collapseOctaveDoubles,
      trimIntroBeats: ov.trimIntroBeats,
      thinBassMinGapBeats: ov.thinBassMinGapBeats,
    });
    // Read the post-filter MIDI tempo because this is the exact tempo passed
    // to ingestSource and therefore the tempo used by cleanTranscription's
    // seconds-to-beats sustain calculation.
    const filteredTempo = parseMidi(midi).tempoBpm;
    const transcription: TranscriptionProvenance = {
      basicPitchVersion: BASIC_PITCH_VERSION,
      // Basic Pitch chooses its own default when this flag is absent. Record
      // that fact instead of making a missing env var indistinguishable from
      // an old artifact that never recorded transcription settings.
      modelSerialization: BASIC_PITCH_SERIALIZATION || "default",
      onsetThreshold: onsetTh,
      frameThreshold: frameTh,
      ...(typeof detectedTempo === "number" && Number.isFinite(detectedTempo) ? { tempo: detectedTempo } : {}),
      tempoSource: TEMPO_OVERRIDE ? "override" : tempo ? "detected" : "default",
      audioSource: "youtube",
      transcribedAt,
      pipeline: TRANSCRIPTION_PIPELINE_CONFIG,
      postProcessing: {
        filterApplied: true,
        cleanupApplied: true,
        onsetMatchSec: onsetMatch,
        onsetDetector: AUDIO_ONSET_DETECTOR_CONFIG,
        minVelocity: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minVelocity,
        minDurationBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minDurationBeats,
        mergeWindowBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.mergeWindowBeats,
        maxPolyphony: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxPolyphony,
        maxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxSounding,
        maxDurationSec: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxDurationSec,
        maxDurationBeats: transcriptionMaxDurationBeats(filteredTempo),
        importedMaxDurationBeats: MAX_YOUTUBE_IMPORT_DUR_BEATS,
        importedMaxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.importedMaxSounding,
      },
    };
    // If the job points at an existing song, replace that base (stable URLs)
    // and keep its metadata; otherwise create a fresh entry from the video.
    const result = await ingestSource({
      buf: new Uint8Array(midi),
      title: existing?.title ?? (title || "YouTube conversion"),
      artist: existing?.artist ?? (uploader || "YouTube"),
      category: existing?.category ?? "YouTube",
      key: existing?.key,
      // Do not reuse the previous catalog row's tempo here. Basic Pitch note
      // positions are expressed in beats at the tempo written into the newly
      // transcribed MIDI. Overriding that tempo with an older curated row
      // changes the real-time timeline (for example, a 120 BPM transcription
      // rendered with a stale 75 BPM row tempo plays at only 62.5% of its
      // intended speed). Let
      // ingestSource read and normalize the tempo from this MIDI instead.
      tempo: undefined,
      style: existing?.style,
      mood: existing?.mood,
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: job.youtubeUrl,
      sourceRef: `youtube-job:${jobId}`,
      baseId: existing?.baseId,
      // filterTranscription removes audio-unmatched notes and trims silence.
      // Keep the conservative ingest cleaner enabled too; it only removes
      // short/quiet re-strikes and catches misclicks that share a real onset.
      cleanTranscription: true,
      transcription,
    }, {
      // DELETE removes the queued job while holding the same base artifact
      // lock used by ingestSource. Re-check inside that lock immediately
      // before the swap so an already-claimed worker cannot resurrect a base
      // after deletion has completed.
      beforeReplace: () => {
        const latest = getJob(jobId);
        if (!latest || latest.status !== "processing" || latest.songId !== job.songId) {
          throw new Error("conversion job was deleted or cancelled before publication");
        }
      },
    });
    if (result.error) throw new Error(result.error);
    // Keep the conversion job pointed at the stable easy variant by its
    // level suffix; array order is an implementation detail of the ladder.
    const songId = result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0]!;
    updateJob(jobId, { status: "done", songId, finishedAt: new Date().toISOString() });
    console.log(`[worker] ${jobId} done → ${songId}`);
  } catch (e) {
    const attempts = (job.attempts ?? 0) + 1;
    const msg = `attempt ${attempts}: ${(e as Error).message}`;
    if (attempts < MAX_ATTEMPTS) {
      updateJob(jobId, { status: "queued", error: msg, attempts });
      console.warn(`[worker] ${jobId} attempt ${attempts}/${MAX_ATTEMPTS} failed, requeued: ${(e as Error).message}`);
    } else {
      updateJob(jobId, { status: "error", error: msg, attempts, finishedAt: new Date().toISOString() });
      console.error(`[worker] ${jobId} failed after ${attempts} attempts: ${(e as Error).message}`);
    }
  }
}

async function loop(): Promise<void> {
  const orphaned = requeueOrphaned();
  if (orphaned) console.log(`[worker] requeued ${orphaned} orphaned job(s)`);
  try {
    const version = await run("yt-dlp", ["--version"], 10_000);
    console.log(`[worker] yt-dlp version: ${version.trim()}`);
  } catch {
    console.warn("[worker] could not determine yt-dlp version");
  }
  console.log(`[worker] polling every ${POLL_MS}ms`);
  for (;;) {
    try {
      const jobs = getQueuedJobs();
      for (const j of jobs) await processJob(j.id);
    } catch (e) {
      console.error("[worker] poll error:", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void loop();
