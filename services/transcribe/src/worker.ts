/**
 * YouTube conversion worker: polls conversion_jobs, downloads audio with
 * yt-dlp, transcribes with Basic Pitch (python venv), ingests the resulting
 * MIDI into the catalog, and marks the job done/error.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  claimJob,
  getDb,
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
  parseYoutubeMetaFile,
} from "@keyspilli/catalog";
import { buildMetalArrangement, parseMidi, transcriptionMaxDurationBeats, writeMidi } from "@keyspilli/midi";
import { assessMetalRouting } from "./metal-routing.js";
import { stemPipelineConfigFromEnv, transcribePitchedStems } from "./stem-pipeline.js";
import { normalizeYoutubeImportUrl } from "./youtube-url.js";
import {
  isYoutubeBotChallenge,
  sanitizeProcessError,
  YOUTUBE_BOT_BLOCK_MESSAGE,
} from "./errors.js";

const execFileP = promisify(execFile);
const POLL_MS = Number(process.env.KEYSPILLI_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.KEYSPILLI_MAX_ATTEMPTS ?? 2);
const BP_TIMEOUT_MS = Number(process.env.KEYSPILLI_BP_TIMEOUT_MS ?? 900_000);
const MAX_VIDEO_DURATION_SEC = Number(process.env.KEYSPILLI_MAX_VIDEO_DURATION_SEC ?? "600");
const TEMPO_TIMEOUT_MS = 60_000;
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const BASIC_PITCH = join(dirname(PYTHON), "basic-pitch");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");
const TEMPO_OVERRIDE = process.env.KEYSPILLI_TEMPO_OVERRIDE?.trim() || undefined;
const BASIC_PITCH_SERIALIZATION = process.env.KEYSPILLI_BP_SERIALIZATION ?? "";
const BASIC_PITCH_VERSION = process.env.KEYSPILLI_BP_VERSION ?? process.env.BASIC_PITCH_VERSION ?? "unknown";
const ONSET_THRESHOLD = process.env.KEYSPILLI_ONSET ?? "0.65";
const FRAME_THRESHOLD = process.env.KEYSPILLI_FRAME ?? "0.45";
const STEM_PIPELINE_CONFIG = stemPipelineConfigFromEnv(process.env, {
  root: ROOT,
  python: PYTHON,
  basicPitch: BASIC_PITCH,
});

async function persistMetalArrangement(dir: string, midi: Uint8Array): Promise<void> {
  const arrangedDir = join(dir, "arranged");
  await mkdir(arrangedDir, { recursive: true });
  const finalPath = join(arrangedDir, "arrangement.mid");
  const stagePath = join(arrangedDir, `.arrangement-${process.pid}-${Date.now()}.mid`);
  await writeFile(stagePath, midi);
  await rename(stagePath, finalPath);
}

/** Per-job transcription tuning. Loaded lazily so a worker can pick up edits
 * without a restart; keyed by job id or song base id, whichever matches first.
 * Values are optional and fall back to the global env defaults. */
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
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw sanitizeProcessError(error);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const YT_COOKIE_FILE = process.env.KEYSPILLI_YT_COOKIES ?? "";
const YT_PROXY = process.env.KEYSPILLI_YT_PROXY ?? "";

interface YoutubeMeta {
  title: string;
  uploader: string;
  durationSec: number;
  acquisition: "downloaded" | "pre-seeded";
}

function ytNetworkFlags(): string[] {
  return [
    ...(YT_COOKIE_FILE ? ["--cookies", YT_COOKIE_FILE] : []),
    ...(YT_PROXY ? ["--proxy", YT_PROXY] : []),
  ];
}

async function ytDlp(args: string[], timeoutMs = 300_000): Promise<string> {
  if (!args.includes("--")) {
    throw new Error("yt-dlp invocation must include an end-of-options marker");
  }
  // Client fallback chain (default -> android -> tv), an explicit JS
  // runtime, and optional cookie/proxy flags. YouTube bot-challenges
  // datacenter IPs on the default client; android/tv usually bypass it and
  // cookies/proxy cover the rest.
  const YT_CLIENTS = ["", "youtube:player_client=android", "youtube:player_client=tv"];
  let lastError: unknown = null;
  for (const client of YT_CLIENTS) {
    try {
      const full = ["--js-runtimes", "node", ...ytNetworkFlags()];
      if (client) full.push("--extractor-args", client);
      // Keep the end-of-options marker after all worker-controlled flags. A
      // job URL is validated before this function is called, but the marker
      // also prevents yt-dlp from interpreting a future URL-like argument as
      // an option; --no-playlist avoids accidental playlist expansion.
      full.push(...args);
      return await run("yt-dlp", full, timeoutMs);
    } catch (e) {
      if (isYoutubeBotChallenge(e)) throw new Error(YOUTUBE_BOT_BLOCK_MESSAGE);
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("yt-dlp failed on all clients");
}

async function fetchYoutubeMeta(jobId: string, dir: string, youtubeUrl: string): Promise<YoutubeMeta> {
  // Operator escape hatch for datacenter IPs that YouTube bot-blocks:
  // stage audio.mp3 plus a meta.json sidecar and the worker skips yt-dlp
  // entirely. The sidecar is validated so incomplete metadata cannot enter
  // the catalog silently.
  const sidecar = parseYoutubeMetaFile(dir);
  if (sidecar) {
    console.log(`[worker] ${jobId} using pre-seeded audio + meta.json`);
    return { ...sidecar, acquisition: "pre-seeded" };
  }
  const info = await ytDlp(["--no-playlist", "--skip-download", "--print", "%(title)s\u001f%(uploader)s\u001f%(duration)s", "--", youtubeUrl], 60_000);
  const parts = info.trim().split("\u001f").map((s) => s?.trim() ?? "");
  const title = parts[0] ?? "";
  const uploader = parts[1] ?? "";
  const durationRaw = parts[2] ?? "";
  const duration = Number(durationRaw);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`video duration unavailable (${durationRaw || "unknown"})`);
  }
  return { title: title || "YouTube conversion", uploader: uploader || "YouTube", durationSec: duration, acquisition: "downloaded" };
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
  // Separation plus three pitched-stem transcriptions can legitimately run
  // much longer than the database's orphan threshold. Refresh the existing
  // started_at lease so a worker restart cannot requeue and duplicate an
  // active job. The status guard prevents this timer from reviving a job that
  // has already transitioned to queued/error/done.
  const heartbeat = setInterval(() => {
    try {
      getDb()
        .prepare("UPDATE conversion_jobs SET started_at = datetime('now') WHERE id = ? AND status = 'processing'")
        .run(jobId);
    } catch (error) {
      console.warn(`[worker] ${jobId} heartbeat failed: ${(error as Error).message}`);
    }
  }, 60_000);
  heartbeat.unref();
  try {
    await mkdir(dir, { recursive: true });
    const ov = getOverride(jobId);
    const dense = ov.denseBand === true;
    const onsetTh = requirePositiveFloat("override.onsetThreshold", String(ov.onsetThreshold ?? (dense ? 0.4 : ONSET_THRESHOLD)));
    const frameTh = requirePositiveFloat("override.frameThreshold", String(ov.frameThreshold ?? (dense ? 0.25 : FRAME_THRESHOLD)));
    const onsetMatch = requirePositiveFloat("override.onsetMatchSec", String(ov.onsetMatchSec ?? (dense ? 0.35 : ONSET_MATCH_SEC)));
    const youtubeUrl = normalizeYoutubeImportUrl(job.youtubeUrl);
    const meta = await fetchYoutubeMeta(jobId, dir, youtubeUrl);
    if (meta.durationSec > MAX_VIDEO_DURATION_SEC) {
      throw new Error(`video longer than ${MAX_VIDEO_DURATION_SEC}s (${meta.durationSec}s)`);
    }
    if (meta.acquisition === "downloaded") {
      await ytDlp(["--no-playlist", "-x", "--audio-format", "mp3", "--max-filesize", "80M", "-o", join(dir, "audio.%(ext)s"), "--", youtubeUrl]);
    }
    // Do not feed a partially downloaded `audio.mp3.part` (or a stale
    // sidecar) to tempo detection/Basic Pitch after a retried yt-dlp run.
    const audioPath = await resolveYoutubeAudio(dir);
    if (!audioPath) throw new Error("no audio file produced");
    // Basic Pitch silently produces empty MIDI from truncated/unplayable files.
    // Reject files that are too small to contain valid audio.
    const { size: audioSize } = await stat(audioPath);
    if (audioSize < 1024) throw new Error(`audio file too small (${audioSize} bytes), likely corrupt download`);
    // Keep the canonical artifact tied to the actual source recording rather
    // than to whichever derived MIDI a transcription strategy happened to
    // publish. The hash is streamed so an 80 MB download does not become a
    // second full in-memory buffer on the worker.
    const sourceArtifactHash = await sha256File(audioPath);
    const tempo = ov.tempoBpm != null ? String(ov.tempoBpm) : ((TEMPO_OVERRIDE ?? (await run(PYTHON, [TEMPO_PY, audioPath], TEMPO_TIMEOUT_MS).catch((e) => {
      console.warn(`[worker] ${jobId} tempo detection failed: ${(e as Error).message}`);
      return "";
    })))).trim();
    const transcribedAt = new Date().toISOString();
    const detectedTempo = tempo ? Number(tempo) : undefined;
    let midi: Uint8Array | undefined;
    let chords: ReturnType<typeof buildMetalArrangement>["chords"] | undefined;
    let separation: TranscriptionProvenance["separation"] | undefined;
    let metalArrangement: TranscriptionProvenance["metalArrangement"] | undefined;
    let stemRoleThresholds: TranscriptionProvenance["stemRoleThresholds"] | undefined;
    let usedMetalArrangement = false;
    let filterApplied = false;

    if (STEM_PIPELINE_CONFIG.mode !== "legacy") {
      try {
        const stemResult = await transcribePitchedStems(audioPath, dir, {
          ...STEM_PIPELINE_CONFIG,
          onsetThreshold: onsetTh,
          frameThreshold: frameTh,
        }, {
          ...(typeof detectedTempo === "number" && Number.isFinite(detectedTempo) ? { tempo: detectedTempo } : {}),
        }, {
          basicPitchVersion: BASIC_PITCH_VERSION,
        });
        const parsedStems = stemResult.stems.map((stem) => ({
          role: stem.role,
          midi: parseMidi(stem.midi),
        }));
        const routing = assessMetalRouting(parsedStems, { force: dense });
        if (STEM_PIPELINE_CONFIG.mode === "auto") {
          if (!routing.eligible) throw new Error(routing.message);
        }
        const detectedCounts = new Map(Object.entries(routing.features.counts) as Array<[string, number]>);
        const arranged = buildMetalArrangement({
          stems: parsedStems,
          title: existing?.title ?? meta.title,
        });
        // A bass-only or bleed-only result is structurally valid MIDI but not
        // a recognizable cover. In auto mode this gate deliberately falls
        // back to the established full-mix path instead of publishing it.
        if (arranged.stats.identityNotes < 8 || arranged.parsed.notes.length < 16) {
          throw new Error(
            `metal arranger produced too little identity (${arranged.stats.identityNotes} identity, `
            + `${arranged.parsed.notes.length} total notes)`,
          );
        }
        midi = writeMidi(arranged.parsed.notes, {
          tempoBpm: arranged.parsed.tempoBpm,
          timeSig: arranged.parsed.timeSig,
          keySig: arranged.parsed.keySig,
          keyMode: arranged.parsed.keyMode,
          tracks: [
            { name: "Right Hand Vocals", notes: arranged.parsed.notes.filter((note) => note.hand === "R" && note.identitySource === "vocals") },
            { name: "Right Hand Guitar", notes: arranged.parsed.notes.filter((note) => note.hand === "R" && note.identitySource === "guitar") },
            { name: "Right Hand Other", notes: arranged.parsed.notes.filter((note) => note.hand === "R" && note.identitySource === "other") },
            { name: "Right Hand", notes: arranged.parsed.notes.filter((note) => note.hand === "R" && !note.identitySource) },
            { name: "Left Hand", notes: arranged.parsed.notes.filter((note) => note.hand === "L") },
          ],
        });
        await persistMetalArrangement(dir, midi);
        chords = arranged.chords;
        const stemCounts = detectedCounts;
        separation = {
          separator: stemResult.report.separator.engine,
          version: stemResult.report.separator.version,
          model: stemResult.report.separator.model,
          device: stemResult.report.separator.device,
          stems: [
            { role: "vocals", noteCount: stemCounts.get("vocals") ?? 0 },
            { role: "bass", noteCount: stemCounts.get("bass") ?? 0 },
            // Provenance keeps the canonical harmonic-residual role for
            // backward compatibility; the model and role thresholds record
            // whether a dedicated guitar lane fed the arranger.
            { role: "other", noteCount: stemCounts.get("guitar") ?? 0 },
            { role: "drums", noteCount: stemCounts.get("drums") ?? 0 },
          ],
        };
        stemRoleThresholds = stemResult.report.transcriber.roleThresholds;
        const usedSources = arranged.ir.sections.flatMap((section) => {
          if (section.source === "rest") return [];
          if (section.source === "mixed") return ["vocals", "other"] as const;
          return [section.source === "vocals" ? "vocals" : "other"] as const;
        });
        const distinctSources = new Set(usedSources);
        const confidence = arranged.ir.sections.length
          ? arranged.ir.sections.reduce((sum, section) => sum + section.confidence, 0) / arranged.ir.sections.length
          : undefined;
        metalArrangement = {
          arranger: "keyspilli-metal-arranger",
          version: "4",
          strategy: "piano-realistic-phrase-fused-vocal-lead-rhythm-gate-power-chord",
          ...(distinctSources.size > 1
            ? { identitySource: "mixed" as const }
            : distinctSources.has("vocals")
              ? { identitySource: "vocals" as const }
              : { identitySource: "other" as const }),
          ...(confidence !== undefined && Number.isFinite(confidence) ? { confidence } : {}),
          ...(arranged.warnings.length ? { warnings: arranged.warnings } : {}),
        };
        usedMetalArrangement = true;
        console.log(
          `[worker] ${jobId} metal arrangement: ${arranged.stats.identityNotes} identity, `
          + `${arranged.stats.leftHandNotes} LH, ${arranged.stats.chordEvents} chords`,
        );
      } catch (error) {
        if (STEM_PIPELINE_CONFIG.mode === "metal") throw error;
        // transcribePitchedStems publishes its small diagnostic MIDIs before
        // the musical routing gate runs. Remove them (and any arrangement
        // from a prior failed attempt) when auto mode selects the legacy
        // result, so rebuild code cannot mistake stale stem output for the
        // source that was actually published.
        await Promise.all([
          rm(join(dir, "stem-midi"), { recursive: true, force: true }),
          rm(join(dir, "arranged"), { recursive: true, force: true }),
        ]);
        stemRoleThresholds = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        const warning = "automatic metal stem route was unavailable or unsuitable; published legacy full-mix transcription";
        console.warn(`[worker] ${jobId} ${warning}: ${detail}`);
        metalArrangement = {
          arranger: "keyspilli-metal-arranger",
          version: "1",
          strategy: "legacy-full-mix-fallback",
          identitySource: "fallback-full-mix",
          warnings: [warning],
        };
      }
    }

    if (!midi) {
      const bpArgs = [dir, audioPath, "--save-midi", "--onset-threshold", String(onsetTh), "--frame-threshold", String(frameTh)];
      if (tempo) bpArgs.push("--midi-tempo", tempo);
      if (BASIC_PITCH_SERIALIZATION) bpArgs.push("--model-serialization", BASIC_PITCH_SERIALIZATION);
      await run(BASIC_PITCH, bpArgs, BP_TIMEOUT_MS);
      // Validate the root candidate through the shared resolver. This keeps a
      // retry from ingesting a corrupt/partial sidecar and gives the worker the
      // same candidate semantics as catalog rebuilds.
      const source = await resolveYoutubeSource(dir, "root");
      if (!source) throw new Error("basic_pitch produced no usable root MIDI/audio pair");
      midi = await filterTranscription(new Uint8Array(await readFile(source.midiPath)), source.audioPath, {
        skipOnsetFilter: ov.skipOnsetFilter === true || dense,
        onsetMatchSec: onsetMatch,
        collapseOctaveDoubles: ov.collapseOctaveDoubles,
        trimIntroBeats: ov.trimIntroBeats,
        thinBassMinGapBeats: ov.thinBassMinGapBeats,
      });
      filterApplied = !(ov.skipOnsetFilter === true || dense);
    }
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
      ...(stemRoleThresholds ? { stemRoleThresholds } : {}),
      ...(typeof detectedTempo === "number" && Number.isFinite(detectedTempo) ? { tempo: detectedTempo } : {}),
      audioAcquisition: meta.acquisition,
      tempoSource: TEMPO_OVERRIDE ? "override" : tempo ? "detected" : "default",
      audioSource: "youtube",
      transcribedAt,
      pipeline: TRANSCRIPTION_PIPELINE_CONFIG,
      postProcessing: {
        filterApplied,
        cleanupApplied: !usedMetalArrangement,
        onsetMatchSec: onsetMatch,
        onsetDetector: AUDIO_ONSET_DETECTOR_CONFIG,
        minVelocity: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minVelocity,
        minDurationBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minDurationBeats,
        mergeWindowBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.mergeWindowBeats,
        maxPolyphony: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxPolyphony,
        maxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxSounding,
        maxDurationSec: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxDurationSec,
        maxDurationBeats: transcriptionMaxDurationBeats(filteredTempo),
        importedMaxDurationBeats: usedMetalArrangement ? null : MAX_YOUTUBE_IMPORT_DUR_BEATS,
        importedMaxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.importedMaxSounding,
      },
      ...(separation ? { separation } : {}),
      ...(metalArrangement ? { metalArrangement } : {}),
    };
    // If the job points at an existing song, replace that base (stable URLs)
    // and keep its metadata; otherwise create a fresh entry from the video.
    const result = await ingestSource({
      buf: new Uint8Array(midi),
      sourceArtifactHash,
      title: existing?.title ?? meta.title,
      artist: existing?.artist ?? meta.uploader,
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
      style: existing?.style ?? (usedMetalArrangement ? "metal" : undefined),
      mood: existing?.mood,
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: youtubeUrl,
      sourceRef: `youtube-job:${jobId}`,
      baseId: existing?.baseId,
      // The metal arranger already emits a deliberately piano-shaped RH/LH
      // score. Running the generic ghost-note cleaner again would erase or
      // relabel authored accompaniment. The legacy path keeps that cleaner.
      cleanTranscription: !usedMetalArrangement,
      arrangementProfile: usedMetalArrangement ? "metal" : "learner",
      ...(chords ? { chords } : {}),
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
    const detail = e instanceof Error ? e.message : String(e);
    const msg = `attempt ${attempts}: ${detail}`;
    // A YouTube bot challenge is tied to the worker's egress/session. Retrying
    // the same URL immediately with another attempt only hammers the blocked
    // IP, so surface an actionable terminal error instead.
    if (!isYoutubeBotChallenge(e) && attempts < MAX_ATTEMPTS) {
      updateJob(jobId, { status: "queued", error: msg, attempts });
      console.warn(`[worker] ${jobId} attempt ${attempts}/${MAX_ATTEMPTS} failed, requeued: ${detail}`);
    } else {
      updateJob(jobId, { status: "error", error: msg, attempts, finishedAt: new Date().toISOString() });
      console.error(`[worker] ${jobId} failed after ${attempts} attempts: ${detail}`);
    }
  } finally {
    clearInterval(heartbeat);
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
