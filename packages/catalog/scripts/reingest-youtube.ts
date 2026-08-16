/**
 * Re-ingest existing YouTube transcriptions with the ghost-note cleanup and
 * keep the SAME base ids (so player URLs stay stable). Used after pipeline
 * changes that affect transcription handling.
 *
 * Usage: tsx scripts/reingest-youtube.ts [--dry-run] [--source=root|strict|auto]
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  filterTranscription,
  getJob,
  getSong,
  ingestSource,
  parseYoutubeSourceArgs,
  resolveYoutubeSource,
  transcribedDir,
} from "../src/index.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const { selection: sourceSelection } = parseYoutubeSourceArgs(args, "auto");
const jobs = await readdir(transcribedDir());
let ok = 0;
let skipped = 0;
let failed = 0;
for (const jobId of jobs) {
  const dir = join(transcribedDir(), jobId);
  const source = await resolveYoutubeSource(dir, sourceSelection);
  if (!source) {
    skipped++;
    if (sourceSelection === "strict") {
      failed++;
      console.error(`x ${jobId}: requested strict source is unavailable`);
    }
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
  console.log(`~ ${song.baseId}: source=${source.sourceKind}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) continue;
  let buf: Uint8Array;
  try {
    buf = await filterTranscription(new Uint8Array(await readFile(source.midiPath)), source.audioPath);
  } catch (error) {
    failed++;
    console.error(`x ${song.baseId}: onset filter failed: ${(error as Error).message}`);
    continue;
  }
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
    cleanTranscription: false,
  });
  if (r.error) {
    failed++;
    console.warn(`x ${song.baseId}: ${r.error}`);
  } else {
    ok++;
    console.log(`+ ${song.baseId} (cleaned, source=${source.sourceKind})`);
  }
}
console.log(`re-ingested ${ok}, skipped ${skipped}, failed ${failed}${dryRun ? " (dry run)" : ""}`);
if (failed) process.exitCode = 1;
