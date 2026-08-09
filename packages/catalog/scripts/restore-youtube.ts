/**
 * Restore specific songs to their original YouTube transcription
 * (used when a sheet-music replacement turned out to be truncated).
 * Usage: tsx scripts/restore-youtube.ts <baseId> [<baseId> ...]
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getJob, getSong, transcribedDir, ingestSource } from "../src/index.js";

const targets = new Set(process.argv.slice(2));
if (!targets.size) { console.error("usage: tsx scripts/restore-youtube.ts <baseId> ..."); process.exit(1); }

const jobs = await readdir(transcribedDir());
let ok = 0;
for (const jobId of jobs) {
  const job = getJob(jobId);
  if (!job?.songId) continue;
  const song = getSong(job.songId);
  if (!song || !targets.has(song.baseId)) continue;
  const dir = join(transcribedDir(), jobId);
  const files = await readdir(dir).catch(() => []);
  const reDir = join(dir, "re");
  const reFiles = await readdir(reDir).catch(() => []);
  const midiName = reFiles.find((f) => f.endsWith("_basic_pitch.mid")) ?? files.find((f) => f.endsWith("_basic_pitch.mid"));
  if (!midiName) continue;
  const srcDir = reFiles.length ? reDir : dir;
  const buf = await readFile(join(srcDir, midiName));
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
  if (r.error) console.warn(`x ${song.baseId}: ${r.error}`);
  else { ok++; console.log(`+ ${song.baseId} restored`); }
}
console.log(`restored ${ok}`);
