/**
 * YouTube conversion worker: polls conversion_jobs, downloads audio with
 * yt-dlp, transcribes with Basic Pitch (python venv), ingests the resulting
 * MIDI into the catalog, and marks the job done/error.
 */
import { resolveTutorialLink } from "./tutorial-route.js";
import { loadAutomaticSourceIndex, resolveAutomaticSymbolic } from "./automatic-symbolic.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { mkdir, readFile, rename, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  tutorialImportsEnabled,
  claimJob,
  renewJobLease,
  ownsJobLease,
  getQueuedJobs,
  requeueOrphaned,
  updateJob,
  getJob,
  getSong,
  getSongsByBase,
  readArrangementManifest,
  validateStagedArtifactTree,
  artifactsDir,
  resolveYoutubeAudio,
  transcribedDir,
  ROOT,
  seedMidiDir,
  ingestSource,
  filterTranscription,
  AUDIO_ONSET_DETECTOR_CONFIG,
  MAX_YOUTUBE_IMPORT_DUR_BEATS,
  TRANSCRIPTION_PIPELINE_CONFIG,
  TRANSCRIPTION_POST_PROCESSING_DEFAULTS,
  type TranscriptionProvenance,
  resolveYoutubeSource,
  parseYoutubeMetaFile,
} from "@keyspilli/catalog";
import { buildMetalArrangement, parseMidi, transcriptionMaxDurationBeats, writeMidi } from "@keyspilli/midi";
import { assessMetalRouting } from "./metal-routing.js";
import { stemPipelineConfigFromEnv, transcribePitchedStems } from "./stem-pipeline.js";
import { finiteNumberSetting, workerNumericConfigFromEnv } from "./worker-config.js";
import { runWorkerLoop, type WorkerProgress } from "./worker-runtime.js";
import { invalidateWorkerHealthSnapshot, workerHealthFilePath, writeWorkerHealthSnapshot } from "./worker-health.js";
import { metalArrangementTracks } from "./metal-midi.js";
import { normalizeYoutubeImportUrl, ytNetworkFlags } from "./youtube-url.js";
import {
  isYoutubeBotChallenge,
  sanitizeProcessError,
  YOUTUBE_BOT_BLOCK_MESSAGE,
} from "./errors.js";

const execFileP = promisify(execFile);
const WORKER_NUMERIC = workerNumericConfigFromEnv(process.env);
const POLL_MS = WORKER_NUMERIC.pollMs;
const MAX_ATTEMPTS = WORKER_NUMERIC.maxAttempts;
const MAX_VIDEO_DURATION_SEC = WORKER_NUMERIC.maxVideoDurationSec;
const TEMPO_TIMEOUT_MS = 60_000;
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const BASIC_PITCH = join(dirname(PYTHON), "basic-pitch");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");
const TEMPO_OVERRIDE = WORKER_NUMERIC.tempoOverride;
const BASIC_PITCH_SERIALIZATION = process.env.KEYSPILLI_BP_SERIALIZATION ?? "";
const BASIC_PITCH_VERSION = process.env.KEYSPILLI_BP_VERSION ?? process.env.BASIC_PITCH_VERSION ?? "unknown";
const STEM_PIPELINE_CONFIG = stemPipelineConfigFromEnv(process.env, {
  root: ROOT,
  python: PYTHON,
  basicPitch: BASIC_PITCH,
});
const BP_TIMEOUT_MS = STEM_PIPELINE_CONFIG.basicPitchTimeoutMs;
const ONSET_THRESHOLD = STEM_PIPELINE_CONFIG.onsetThreshold;
const FRAME_THRESHOLD = STEM_PIPELINE_CONFIG.frameThreshold;

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
  accompanimentOnly?: boolean;
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

async function run(cmd: string, args: string[], timeoutMs = 300_000, signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    });
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

interface YoutubeMeta {
  title: string;
  uploader: string;
  durationSec: number;
  acquisition: "downloaded" | "pre-seeded";
}

async function ytDlp(args: string[], timeoutMs = 300_000, signal?: AbortSignal): Promise<string> {
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
    if (signal?.aborted) throw new Error("worker shutdown cancelled yt-dlp");
    try {
      const full = ["--js-runtimes", "node", ...ytNetworkFlags()];
      if (client) full.push("--extractor-args", client);
      // Keep the end-of-options marker after all worker-controlled flags. A
      // job URL is validated before this function is called, but the marker
      // also prevents yt-dlp from interpreting a future URL-like argument as
      // an option; --no-playlist avoids accidental playlist expansion.
      full.push(...args);
      return await run("yt-dlp", full, timeoutMs, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      if (isYoutubeBotChallenge(e)) throw new Error(YOUTUBE_BOT_BLOCK_MESSAGE);
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("yt-dlp failed on all clients");
}

async function fetchYoutubeMeta(jobId: string, dir: string, youtubeUrl: string, signal?: AbortSignal): Promise<YoutubeMeta> {
  // Operator escape hatch for datacenter IPs that YouTube bot-blocks:
  // stage audio.mp3 plus a meta.json sidecar and the worker skips yt-dlp
  // entirely. The sidecar is validated so incomplete metadata cannot enter
  // the catalog silently.
  const sidecar = parseYoutubeMetaFile(dir);
  if (sidecar) {
    console.log(`[worker] ${jobId} using pre-seeded audio + meta.json`);
    return { ...sidecar, acquisition: "pre-seeded" };
  }
  const info = await ytDlp(["--no-playlist", "--skip-download", "--print", "%(title)s\u001f%(uploader)s\u001f%(duration)s", "--", youtubeUrl], 60_000, signal);
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

export async function processJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (stage: WorkerProgress) => void;
    registerGraceExpired?: (handler: (stage: WorkerProgress | null) => void) => void;
  } = {},
): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  // Atomic claim: another worker may have taken it while we read metadata.
  const owner = claimJob(jobId);
  if (!owner) return;
  const updateOwnedJob = (patch: Parameters<typeof updateJob>[1]) => {
    if (!updateJob(jobId, patch, owner)) throw new Error(`job ${jobId} ownership changed before update`);
  };
  const existing = job.songId ? getSong(job.songId) : undefined;
  if (existing && existsSync(join(seedMidiDir(), `${existing.baseId}.mid`))) {
    updateOwnedJob({ status: "done", songId: existing.id, finishedAt: new Date().toISOString() });
    console.log(`[worker] ${jobId} curated base (${existing.baseId}), kept existing artifacts`);
    return;
  }
  const dir = join(transcribedDir(), jobId);
  const heartbeat = setInterval(() => {
    try {
      if (!renewJobLease(jobId, owner)) console.warn(`[worker] ${jobId} lost job lease; publication is disabled`);
    } catch (error) {
      console.warn(`[worker] ${jobId} heartbeat failed: ${(error as Error).message}`);
    }
  }, 60_000);
  heartbeat.unref();
  let publicationFencePassed = false;
  // Before the swap fence, expiry clears this owner's lease and requeues
  // without consuming an attempt. If the atomic swap was already authorized,
  // keep its processing row fenced from another claimant until it completes
  // or its lease expires into the existing journal recovery path.
  options.registerGraceExpired?.((stage) => {
    clearInterval(heartbeat);
    if (stage === "publishing" && publicationFencePassed) return;
    if (!ownsJobLease(jobId, owner)) return;
    if (!updateJob(jobId, { status: "queued", error: null }, owner) && ownsJobLease(jobId, owner)) {
      throw new Error("worker shutdown lease fence failed");
    }
  });
  let publishing = false;
  const checkNotShuttingDown = () => {
    if (options.signal?.aborted) throw new Error("worker shutdown requested");
  };
  try {
    checkNotShuttingDown();
    options.onProgress?.("checking-disk");
    await mkdir(dir, { recursive: true });
    const disk = await statfs(dir);
    if (disk.bavail * disk.bsize < STEM_PIPELINE_CONFIG.minFreeBytes) {
      throw new Error("SOURCE_REVIEW_REQUIRED: insufficient free disk space; reclaim space before retrying");
    }
    if ((process.env.KEYSPILLI_TUTORIAL_BETA === "1" || process.env.KEYSPILLI_TUTORIAL_PREVIEW === "1") && !tutorialImportsEnabled())
      throw new Error("SOURCE_REVIEW_REQUIRED: tutorial imports require an enabled runtime flag and data directory");
    if (tutorialImportsEnabled()) {
      if (existing) throw new Error("SOURCE_REVIEW_REQUIRED: tutorial preview cannot replace existing songs");
      const checkActive = () => {
        if (!ownsJobLease(jobId, owner) || getJob(jobId)?.status !== "processing") throw new Error("tutorial job cancelled");
      };
      const onProgress = (stage: string) => {
        checkActive();
        const progressPath = join(dir, "progress.json");
        writeFileSync(progressPath + ".tmp", JSON.stringify({stage}));
        renameSync(progressPath + ".tmp", progressPath);
        options.onProgress?.(stage === "publishing" ? "publishing"
          : stage.includes("download") || stage === "identifying" ? "downloading"
            : stage.includes("extract") || stage.includes("separat") ? "extracting"
              : stage === "validating" ? "finalizing" : "transcribing");
      };
      const candidate = await resolveTutorialLink(normalizeYoutubeImportUrl(job.youtubeUrl), join(dir, "tutorial-" + randomUUID()), {checkActive,onProgress,signal: options.signal});
      if (candidate.status !== "local-listening-candidate") throw new Error(candidate.attempts?.length ? "SOURCE_REVIEW_REQUIRED: tutorial extraction failed" : "SOURCE_REVIEW_REQUIRED: no matching tutorial found");
      const buf = await readFile(candidate.midiPath);
      const evidence = JSON.parse(await readFile(candidate.midiPath.replace(/\.mid$/, ".json"), "utf8"));
      const baseId = "preview-" + jobId;
      const sourceArrangement = {
        beta: true as const, requestedUrl: job.youtubeUrl, actualSourceUrl: candidate.selectedUrl,
        sourceSha256: evidence.sourceSha256, realizationSha256: createHash("sha256").update(buf).digest("hex"),
        sourceKind: "tutorial-preview" as const, arrangementTitle: candidate.candidates.find((c: {url: string}) => c.url === candidate.selectedUrl)!.title,
        artist: candidate.identity.artist, title: candidate.identity.title, timingOwner: "selected-arrangement" as const,
        containsMelody: null, license: "unverified", licenseEvidenceUrl: "", verificationEvidenceUrl: candidate.selectedUrl,
        candidateSetDigest: createHash("sha256").update(JSON.stringify(candidate.candidates)).digest("hex"),
      };
      onProgress("publishing");
      checkNotShuttingDown();
      publishing = true;
      const imported = await ingestSource({buf, baseId, title: candidate.identity.title, artist: candidate.identity.artist,
        category: "Tutorial preview", contentType: "youtube", acquiredVia: "colored-keyboard-video",
        sourceRef: candidate.selectedUrl, sourceArtifactHash: evidence.sourceSha256, sourceArrangement,
        cleanTranscription: false, maxDurBeats: null, arrangementProfile: "source",
      }, {job: {id: jobId, owner}, beforeReplace: () => {
        checkNotShuttingDown();
        if (!ownsJobLease(jobId, owner) || getJob(jobId)?.status !== "processing" || getSongsByBase(baseId).length)
          throw new Error("tutorial publication cancelled or already exists");
        publicationFencePassed = true;
      }});
      if (imported.error) throw new Error(imported.code ? `${imported.code}: ${imported.error}` : imported.error);
      return;
    }
    if (process.env.KEYSPILLI_SOURCE_ASSISTED_BETA === "1") {
      options.onProgress?.("transcribing");
      if (existing) throw new Error("SOURCE_REVIEW_REQUIRED: beta imports cannot replace an existing song");
      const indexPath = process.env.KEYSPILLI_VERIFIED_SOURCE_INDEX;
      if (!indexPath) throw new Error("SOURCE_REVIEW_REQUIRED: no verified source index is configured");
      const native = await resolveAutomaticSymbolic(normalizeYoutubeImportUrl(job.youtubeUrl), await loadAutomaticSourceIndex(indexPath), { accompanimentOnly: getOverride(jobId).accompanimentOnly === true });
      await writeFile(join(dir, "source-route.json"), JSON.stringify(native.status === "candidate"
        ? { status: native.status, provenance: native.provenance, attempts: native.attempts }
        : native, null, 2));
      if (native.status !== "candidate") throw new Error(`SOURCE_REVIEW_REQUIRED: ${native.reason}; ${native.attempts.map((a) => a.reason).join("; ")}`);
      const baseId = `beta-native-${native.provenance.sourceSha256.slice(0, 24)}`;
      const prior = getSongsByBase(baseId);
      if (prior.length) {
        const saved = await readArrangementManifest(baseId);
        if (saved.status !== "valid" || saved.manifest.sourceArrangement?.sourceSha256 !== native.provenance.sourceSha256
          || saved.manifest.sourceArrangement?.realizationSha256 !== native.provenance.realizationSha256
          || ["vb", "b", "e", "m", "a"].some((level) => !prior.some((song) => song.level === level))
          || (await validateStagedArtifactTree(artifactsDir(baseId, ""), saved.manifest)).length) {
          throw new Error("SOURCE_REVIEW_REQUIRED: existing source artifacts are incomplete or inconsistent; retained for review");
        }
        updateOwnedJob({ status: "done", songId: prior.find((song) => song.id.endsWith("-e"))?.id ?? prior[0]!.id, finishedAt: new Date().toISOString() });
        return;
      }
      await writeFile(join(dir, "selected-source.mid"), native.sourceBytes);
      const canonical = native.arrangement.canonical!;
      const buf = writeMidi(canonical.notes, { tempoBpm: canonical.tempoBpm, timeSig: canonical.timeSig,
        tracks: metalArrangementTracks(canonical.notes) });
      options.onProgress?.("publishing");
      checkNotShuttingDown();
      publishing = true;
      const imported = await ingestSource({ buf, baseId, sourceArtifactHash: native.provenance.sourceSha256,
        title: native.provenance.arrangementTitle, artist: native.provenance.artist, category: "Source-assisted beta",
        contentType: "youtube", acquiredVia: "verified-native-midi", sourceRef: `indexed:${native.provenance.sourceSha256}`,
        cleanTranscription: false, maxDurBeats: null, arrangementProfile: "source", sourceArrangement: native.provenance,
      }, { job: {id: jobId, owner}, beforeReplace: () => {
        checkNotShuttingDown();
        const latest = getJob(jobId);
        if (!ownsJobLease(jobId, owner) || !latest || latest.status !== "processing" || latest.songId !== job.songId || getSongsByBase(baseId).length) throw new Error("native publication cancelled or already exists");
        publicationFencePassed = true;
      } });
      if (imported.error) throw new Error(imported.code ? `${imported.code}: ${imported.error}` : imported.error);
      return;
    }

    const ov = getOverride(jobId);
    const dense = ov.denseBand === true;
    const onsetTh = finiteNumberSetting("override.onsetThreshold", String(ov.onsetThreshold ?? (dense ? 0.4 : ONSET_THRESHOLD)), { min: 0, max: 1 });
    const frameTh = finiteNumberSetting("override.frameThreshold", String(ov.frameThreshold ?? (dense ? 0.25 : FRAME_THRESHOLD)), { min: 0, max: 1 });
    const onsetMatch = finiteNumberSetting("override.onsetMatchSec", String(ov.onsetMatchSec ?? (dense ? 0.35 : WORKER_NUMERIC.onsetMatchSec)), { min: 0.001, max: 10 });
    const tempoOverride = ov.tempoBpm == null ? TEMPO_OVERRIDE : finiteNumberSetting("override.tempoBpm", String(ov.tempoBpm), { min: 20, max: 400 });
    if (ov.trimIntroBeats != null) finiteNumberSetting("override.trimIntroBeats", String(ov.trimIntroBeats), { min: 0, max: 32 });
    if (ov.thinBassMinGapBeats != null) finiteNumberSetting("override.thinBassMinGapBeats", String(ov.thinBassMinGapBeats), { min: 0, max: 16 });
    const youtubeUrl = normalizeYoutubeImportUrl(job.youtubeUrl);
    checkNotShuttingDown();
    options.onProgress?.("downloading");
    const meta = await fetchYoutubeMeta(jobId, dir, youtubeUrl, options.signal);
    if (meta.durationSec > MAX_VIDEO_DURATION_SEC) {
      throw new Error(`video longer than ${MAX_VIDEO_DURATION_SEC}s (${meta.durationSec}s)`);
    }
    if (meta.acquisition === "downloaded") {
      await ytDlp(["--no-playlist", "-x", "--audio-format", "mp3", "--max-filesize", "80M", "-o", join(dir, "audio.%(ext)s"), "--", youtubeUrl], 300_000, options.signal);
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
    options.onProgress?.("transcribing");
    const tempo = tempoOverride != null ? String(tempoOverride) : ((await run(PYTHON, [TEMPO_PY, audioPath], TEMPO_TIMEOUT_MS, options.signal).catch((e) => {
      console.warn(`[worker] ${jobId} tempo detection failed: ${(e as Error).message}`);
      return "";
    }))).trim();
    const transcribedAt = new Date().toISOString();
    checkNotShuttingDown();
    const detectedTempo = tempo ? finiteNumberSetting("detected tempo", tempo, { min: 20, max: 400 }) : undefined;
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
          signal: options.signal,
        });
        const parsedStems = stemResult.stems.map((stem) => ({
          role: stem.role,
          sourceStem: stem.noteSource,
          midi: parseMidi(stem.midi),
        }));
        const routing = assessMetalRouting(parsedStems, { force: dense });
        if (STEM_PIPELINE_CONFIG.mode === "auto") {
          if (!routing.eligible) throw new Error(routing.message);
        }
        // Routing counts intentionally cover only the core eligibility roles;
        // count every parsed stem separately for provenance so a dedicated
        // residual `other` lane is not silently reported as zero.
        const detectedCounts = new Map(parsedStems.map((stem) => [stem.role, stem.midi.notes.length] as const));
        const arranged = buildMetalArrangement({
          stems: parsedStems,
          title: existing?.title ?? meta.title,
        });
        // A bass-only or bleed-only result is structurally valid MIDI but not
        // a recognizable cover. Reject it without silently switching sources.
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
          tracks: metalArrangementTracks(arranged.parsed.notes),
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
            // Keep one canonical residual role in the manifest while
            // accounting for both the dedicated guitar and six-source
            // `other` evidence that fed the arranger.
            { role: "other", noteCount: (stemCounts.get("guitar") ?? 0) + (stemCounts.get("other") ?? 0) },
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
        const detail = error instanceof Error ? error.message : String(error);
        // No full-mix fallback has passed the musical route gate. Preserve
        // diagnostics and surface review instead of silently publishing it.
        throw new Error(`SOURCE_REVIEW_REQUIRED: stem transcription unavailable or unsuitable: ${detail}. Use a verified native arrangement or supported source.`);
      }
    }

    if (!midi) {
      const bpArgs = [dir, audioPath, "--save-midi", "--onset-threshold", String(onsetTh), "--frame-threshold", String(frameTh)];
      if (tempo) bpArgs.push("--midi-tempo", String(detectedTempo));
      if (BASIC_PITCH_SERIALIZATION) bpArgs.push("--model-serialization", BASIC_PITCH_SERIALIZATION);
      await run(BASIC_PITCH, bpArgs, BP_TIMEOUT_MS, options.signal);
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
    options.onProgress?.("publishing");
    checkNotShuttingDown();
    publishing = true;
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
      job: {id: jobId, owner},
      // Re-check the owned lease under the artifact lock before swapping, so
      // cancellation or deletion cannot resurrect a base.
      beforeReplace: () => {
        checkNotShuttingDown();
        const latest = getJob(jobId);
        if (!ownsJobLease(jobId, owner) || !latest || latest.status !== "processing" || latest.songId !== job.songId) {
          throw new Error("conversion job was deleted or cancelled before publication");
        }
        publicationFencePassed = true;
      },
    });
    if (result.error) throw new Error(result.code ? `${result.code}: ${result.error}` : result.error);
    // Keep the conversion job pointed at the stable easy variant by its
    // level suffix; array order is an implementation detail of the ladder.
    const songId = result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0]!;
    console.log(`[worker] ${jobId} done → ${songId}`);
  } catch (e) {
    if (!ownsJobLease(jobId, owner)) {
      console.warn(`[worker] ${jobId} no longer owns the job; retained current owner and status`);
      return;
    }
    if (options.signal?.aborted && !publishing) {
      try {
        updateOwnedJob({ status: "queued", error: null });
        console.warn(`[worker] ${jobId} released for shutdown without consuming an attempt`);
      } catch {
        console.warn(`[worker] ${jobId} shutdown recovery deferred to lease expiry`);
      }
      return;
    }
    const attempts = (job.attempts ?? 0) + 1;
    const detail = e instanceof Error ? e.message : String(e);
    const msg = `attempt ${attempts}: ${detail}`;
    // A YouTube bot challenge is tied to the worker's egress/session. Retrying
    // the same URL immediately with another attempt only hammers the blocked
    // IP, so surface an actionable terminal error instead.
    if (!detail.startsWith("SOURCE_REVIEW_REQUIRED:") && !detail.startsWith("ARTIFACT_RECONCILIATION_REQUIRED:") && !isYoutubeBotChallenge(e) && attempts < MAX_ATTEMPTS) {
      updateOwnedJob({ status: "queued", error: msg, attempts });
      console.warn(`[worker] ${jobId} attempt ${attempts}/${MAX_ATTEMPTS} failed, requeued: ${detail}`);
    } else {
      updateOwnedJob({ status: "error", error: msg, attempts, finishedAt: new Date().toISOString() });
      console.error(`[worker] ${jobId} failed after ${attempts} attempts: ${detail}`);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function loop(): Promise<void> {
  const capabilityRevision = createHash("sha256").update(JSON.stringify({
    mode: STEM_PIPELINE_CONFIG.mode,
    device: STEM_PIPELINE_CONFIG.demucsDevice,
    tutorial: process.env.KEYSPILLI_TUTORIAL_BETA === "1" || process.env.KEYSPILLI_TUTORIAL_PREVIEW === "1",
    sourceAssisted: process.env.KEYSPILLI_SOURCE_ASSISTED_BETA === "1",
    numeric: WORKER_NUMERIC,
  })).digest("hex").slice(0, 16);
  const controller = new AbortController();
  const sigterm = () => controller.abort();
  const sigint = () => controller.abort();
  process.once("SIGTERM", sigterm);
  process.once("SIGINT", sigint);
  try {
    const outcome = await runWorkerLoop({
      signal: controller.signal,
      pollMs: POLL_MS,
      heartbeatMs: WORKER_NUMERIC.heartbeatMs,
      shutdownGraceMs: WORKER_NUMERIC.shutdownGraceMs,
      capabilityRevision,
      startup: async (signal) => {
        const orphaned = requeueOrphaned();
        if (orphaned) console.log(`[worker] requeued ${orphaned} orphaned job(s)`);
        try {
          const version = await run("yt-dlp", ["--version"], 10_000, signal);
          console.log(`[worker] yt-dlp version: ${version.trim()}`);
        } catch {
          if (!signal.aborted) console.warn("[worker] could not determine yt-dlp version");
        }
        console.log(`[worker] polling every ${POLL_MS}ms`);
      },
      getQueuedJobs: () => {
        requeueOrphaned();
        return getQueuedJobs().map(({ id, createdAt }) => ({ id, createdAt }));
      },
      processJob: (job, signal, progress, registerGraceExpired) => processJob(job.id, {
        signal,
        onProgress: progress,
        registerGraceExpired,
      }),
      onHealth: (snapshot) => {
        const healthPath = workerHealthFilePath(dirname(transcribedDir()));
        try {
          writeWorkerHealthSnapshot(healthPath, snapshot);
        } catch {
          invalidateWorkerHealthSnapshot(healthPath);
          throw new Error("worker health snapshot write failed");
        }
        console.log(`[worker-health] ${JSON.stringify(snapshot)}`);
      },
      onError: (kind) => console.error(kind === "shutdown grace expired"
        ? "[worker] shutdown grace expired; owned job recovery is pending"
        : kind === "health"
          ? "[worker] health snapshot write failed"
          : kind === "grace fence"
            ? "[worker] shutdown lease fence failed"
            : `[worker] ${kind} failed`),
    });
    if (outcome !== "stopped") process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", sigterm);
    process.removeListener("SIGINT", sigint);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void loop().catch(() => {
    console.error("[worker] stopped after startup failure");
    process.exitCode = 1;
  });
}
