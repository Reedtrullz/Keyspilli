/**
 * Re-transcribe all YouTube conversion audio with stricter Basic Pitch
 * detection thresholds (less ghost noise), clean the notes, and re-ingest
 * with the SAME base ids so player URLs stay stable.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  filterTranscription,
  getJob,
  getSong,
  ingestSource,
  resolveYoutubeAudio,
  resolveYoutubeSource,
  transcribedDir,
} from "../src/index.js";
import { ROOT } from "../src/paths.js";

const execFileP = promisify(execFile);
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const BASIC_PITCH = join(dirname(PYTHON), "basic-pitch");
const ONSET = process.env.KEYSPILLI_ONSET ?? "0.65";
const FRAME = process.env.KEYSPILLI_FRAME ?? "0.45";

const jobs = await readdir(transcribedDir());
let ok = 0;
let skipped = 0;
let failed = 0;
for (const jobId of jobs) {
  const dir = join(transcribedDir(), jobId);
  const audioPath = await resolveYoutubeAudio(dir);
  const job = getJob(jobId);
  if (!audioPath || !job?.songId) {
    skipped++;
    continue;
  }
  const song = getSong(job.songId);
  if (!song) {
    skipped++;
    continue;
  }
  const outDir = join(dir, "re");
  await mkdir(outDir, { recursive: true });
  const args = [
    outDir,
    audioPath,
    "--save-midi",
    "--onset-threshold",
    ONSET,
    "--frame-threshold",
    FRAME,
  ];
  if (process.env.KEYSPILLI_BP_SERIALIZATION) args.push("--model-serialization", process.env.KEYSPILLI_BP_SERIALIZATION);
  await execFileP(BASIC_PITCH, args, { timeout: 900_000, maxBuffer: 32 * 1024 * 1024 });
  // The strict output is persisted under re/. Resolve it through the same
  // validator used by restore/re-ingest so a stale or corrupt sidecar cannot
  // be mistaken for the result of this run. Keep the original root audio for
  // onset matching: Basic Pitch does not create a second recording here.
  const source = await resolveYoutubeSource(dir, "strict");
  if (!source) {
    skipped++;
    failed++;
    console.error(`x ${jobId}: Basic Pitch did not produce a usable strict MIDI`);
    continue;
  }
  const buf = await filterTranscription(new Uint8Array(await readFile(source.midiPath)), audioPath);
  const r = await ingestSource({
    buf,
    title: song.title,
    artist: song.artist,
    category: song.category,
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceYoutubeUrl: job.youtubeUrl,
    sourceRef: `youtube-job:${jobId}`,
    baseId: song.baseId,
    // filterTranscription removes audio-unmatched notes; the conservative
    // ingest cleaner then catches short misclicks on genuine onsets.
    cleanTranscription: true,
  });
  if (r.error) {
    failed++;
    console.warn(`x ${song.baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${song.baseId}`);
  }
}
console.log(`re-transcribed ${ok}, skipped ${skipped}, failed ${failed}`);
if (failed) process.exitCode = 1;
