/**
 * Re-ingest existing YouTube transcriptions with the ghost-note cleanup and
 * keep the SAME base ids (so player URLs stay stable). Used after pipeline
 * changes that affect transcription handling.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJob, getSong, transcribedDir, ingestSource, filterTranscription } from "../src/index.js";

const jobs = await readdir(transcribedDir());
let ok = 0;
let skipped = 0;
for (const jobId of jobs) {
  const dir = join(transcribedDir(), jobId);
  const files = await readdir(dir).catch(() => []);
  // Prefer the strict-threshold re-transcription when present.
  const reDir = join(dir, "re");
  const reFiles = await readdir(reDir).catch(() => []);
  const reMidi = reFiles.find((f) => f.endsWith("_basic_pitch.mid"));
  const srcDir = reMidi ? reDir : dir;
  const midiName = reMidi ?? files.find((f) => f.endsWith("_basic_pitch.mid"));
  if (!midiName) {
    skipped++;
    continue;
  }
  const audioName = reFiles.find((f) => f.startsWith("audio.")) ?? files.find((f) => f.startsWith("audio."));
  if (!audioName) {
    skipped++;
    continue;
  }
  const job = getJob(jobId);
  if (!job?.songId) {
    skipped++;
    continue;
  }
  const song = getSong(job.songId);
  if (!song) {
    skipped++;
    continue;
  }
  const buf = await filterTranscription(new Uint8Array(await readFile(join(srcDir, midiName))), join(srcDir, audioName));
  const r = await ingestSource({
    buf,
    title: song.title,
    artist: song.artist,
    category: song.category,
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceYoutubeUrl: job.youtubeUrl,
    baseId: song.baseId,
    cleanTranscription: false,
  });
  if (r.error) {
    console.warn(`x ${song.baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${song.baseId} (cleaned)`);
  }
}
console.log(`re-ingested ${ok}, skipped ${skipped}`);
