/**
 * YouTube conversion worker: polls conversion_jobs, downloads audio with
 * yt-dlp, transcribes with Basic Pitch (python venv), ingests the resulting
 * MIDI into the catalog, and marks the job done/error.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getQueuedJobs, updateJob, getJob, transcribedDir, ROOT, ingestSource } from "@keyspilli/catalog";

const execFileP = promisify(execFile);
const POLL_MS = Number(process.env.KEYSPILLI_POLL_MS ?? 5000);
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");

async function run(cmd: string, args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await execFileP(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "queued") return;
  updateJob(jobId, { status: "processing" });
  const dir = join(transcribedDir(), jobId);
  await mkdir(dir, { recursive: true });
  try {
    const info = await run("yt-dlp", ["--skip-download", "--print", "%(title)s|%(uploader)s", job.youtubeUrl], 60_000);
    const [title, uploader] = info.trim().split("|").map((s) => s?.trim() ?? "");
    await run("yt-dlp", ["-x", "--audio-format", "mp3", "--max-filesize", "80M", "-o", join(dir, "audio.%(ext)s"), job.youtubeUrl]);
    const files = await readdir(dir);
    const audio = files.find((f) => f.startsWith("audio."));
    if (!audio) throw new Error("no audio file produced");
    const audioPath = join(dir, audio);
    const midiOut = join(dir, "transcribed.mid");
    await run(PYTHON, ["-m", "basic_pitch", audioPath, "--midi", midiOut], 600_000);
    const midi = await readFile(midiOut);
    const result = await ingestSource({
      buf: new Uint8Array(midi),
      title: title || "YouTube conversion",
      artist: uploader || "YouTube",
      category: "YouTube",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: job.youtubeUrl,
    });
    if (result.error) throw new Error(result.error);
    const songId = result.songIds[3] ?? result.songIds[0]!; // point at the "easy" variant when available
    updateJob(jobId, { status: "done", songId, finishedAt: new Date().toISOString() });
    console.log(`[worker] ${jobId} done → ${songId}`);
  } catch (e) {
    updateJob(jobId, { status: "error", error: (e as Error).message, finishedAt: new Date().toISOString() });
    console.error(`[worker] ${jobId} failed: ${(e as Error).message}`);
  }
}

async function loop(): Promise<void> {
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
