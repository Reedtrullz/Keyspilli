/**
 * Re-ingest existing YouTube transcriptions with the ghost-note cleanup and
 * keep the SAME base ids (so player URLs stay stable). Used after pipeline
 * changes that affect transcription handling.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJob, getSong, transcribedDir, ingestSource } from "../src/index.js";

const jobs = await readdir(transcribedDir());
let ok = 0;
let skipped = 0;
for (const jobId of jobs) {
  const dir = join(transcribedDir(), jobId);
  const files = await readdir(dir).catch(() => []);
  const midiName = files.find((f) => f.endsWith("_basic_pitch.mid"));
  if (!midiName) {
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
  const buf = await readFile(join(dir, midiName));
  const r = await ingestSource({
    buf: new Uint8Array(buf),
    title: song.title,
    artist: song.artist,
    category: song.category,
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceYoutubeUrl: job.youtubeUrl,
    baseId: song.baseId,
  });
  if (r.error) {
    console.warn(`x ${song.baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${song.baseId} (cleaned)`);
  }
}
console.log(`re-ingested ${ok}, skipped ${skipped}`);
