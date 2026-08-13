/**
 * YouTube conversion worker: polls conversion_jobs, downloads audio with
 * yt-dlp, transcribes with Basic Pitch (python venv), ingests the resulting
 * MIDI into the catalog, and marks the job done/error.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { claimJob, getQueuedJobs, requeueOrphaned, updateJob, getJob, getSong, transcribedDir, ROOT, seedMidiDir, ingestSource, filterTranscription } from "@keyspilli/catalog";

const execFileP = promisify(execFile);
const POLL_MS = Number(process.env.KEYSPILLI_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.KEYSPILLI_MAX_ATTEMPTS ?? 2);
const BP_TIMEOUT_MS = Number(process.env.KEYSPILLI_BP_TIMEOUT_MS ?? 900_000);
const TEMPO_TIMEOUT_MS = 60_000;
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const BASIC_PITCH = join(dirname(PYTHON), "basic-pitch");
const TEMPO_PY = join(ROOT, "services", "transcribe", "src", "tempo.py");
const TEMPO_OVERRIDE = process.env.KEYSPILLI_TEMPO_OVERRIDE;
const BASIC_PITCH_SERIALIZATION = process.env.KEYSPILLI_BP_SERIALIZATION ?? "";
const ONSET_THRESHOLD = process.env.KEYSPILLI_ONSET ?? "0.65";
const FRAME_THRESHOLD = process.env.KEYSPILLI_FRAME ?? "0.45";

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
    const info = await ytDlp(["--skip-download", "--print", "%(title)s\x1f%(uploader)s\x1f%(duration)s", job.youtubeUrl], 60_000);
    const [title, uploader, durationRaw] = info.trim().split("\x1f").map((s) => s?.trim() ?? "");
    if (Number(durationRaw) > 300) throw new Error(`video longer than 300s (${durationRaw}s)`);
    await ytDlp(["-x", "--audio-format", "mp3", "--max-filesize", "80M", "-o", join(dir, "audio.%(ext)s"), job.youtubeUrl]);
    const files = await readdir(dir);
    const audio = files.find((f) => f.startsWith("audio."));
    if (!audio) throw new Error("no audio file produced");
    const audioPath = join(dir, audio);
    const bpArgs = [dir, audioPath, "--save-midi", "--onset-threshold", ONSET_THRESHOLD, "--frame-threshold", FRAME_THRESHOLD];
    const tempo = TEMPO_OVERRIDE ?? (await run(PYTHON, [TEMPO_PY, audioPath], TEMPO_TIMEOUT_MS).catch((e) => {
      console.warn(`[worker] ${jobId} tempo detection failed: ${(e as Error).message}`);
      return "";
    })).trim();
    if (tempo) bpArgs.push("--midi-tempo", tempo);
    if (BASIC_PITCH_SERIALIZATION) bpArgs.push("--model-serialization", BASIC_PITCH_SERIALIZATION);
    await run(BASIC_PITCH, bpArgs, BP_TIMEOUT_MS);
    const midiName = (await readdir(dir)).find((f) => f.endsWith("_basic_pitch.mid"));
    if (!midiName) throw new Error("basic_pitch produced no MIDI");
    const midiOut = join(dir, midiName);
    const midi = await filterTranscription(new Uint8Array(await readFile(midiOut)), audioPath);
    // If the job points at an existing song, replace that base (stable URLs)
    // and keep its metadata; otherwise create a fresh entry from the video.
    const result = await ingestSource({
      buf: new Uint8Array(midi),
      title: existing?.title ?? (title || "YouTube conversion"),
      artist: existing?.artist ?? (uploader || "YouTube"),
      category: existing?.category ?? "YouTube",
      key: existing?.key,
      tempo: existing?.tempo,
      style: existing?.style,
      mood: existing?.mood,
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: job.youtubeUrl,
      baseId: existing?.baseId,
    });
    if (result.error) throw new Error(result.error);
    const songId = result.songIds[3] ?? result.songIds[0]!; // point at the "easy" variant when available
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
