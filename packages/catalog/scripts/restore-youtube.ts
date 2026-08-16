/**
 * Restore specific songs to their original YouTube transcription
 * (used when a sheet-music replacement turned out to be truncated).
 * Usage: tsx scripts/restore-youtube.ts [--dry-run] [--source=root|strict|auto] <baseId> [<baseId> ...]
 */
import { readFile, readdir } from "node:fs/promises";
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
const { selection: sourceSelection, positionalArgs: targetArgs } = parseYoutubeSourceArgs(args, "auto");
const targets = new Set(targetArgs);
if (!targets.size) { console.error("usage: tsx scripts/restore-youtube.ts [--dry-run] [--source=root|strict|auto] <baseId> ..."); process.exit(1); }

type RestoreCandidate = {
  jobId: string;
  job: NonNullable<ReturnType<typeof getJob>>;
  song: NonNullable<ReturnType<typeof getSong>>;
};

const latestByBase = new Map<string, RestoreCandidate>();
for (const jobId of await readdir(transcribedDir())) {
  const job = getJob(jobId);
  if (!job?.songId) continue;
  const song = getSong(job.songId);
  if (!song || !targets.has(song.baseId)) continue;
  const previous = latestByBase.get(song.baseId);
  if (!previous || job.createdAt > previous.job.createdAt || (job.createdAt === previous.job.createdAt && jobId > previous.jobId)) {
    latestByBase.set(song.baseId, { jobId, job, song });
  }
}

let ok = 0;
let failed = 0;
const matchedTargets = new Set<string>();
for (const [baseId, candidate] of latestByBase) {
  const { jobId, job, song } = candidate;
  matchedTargets.add(baseId);
  const dir = join(transcribedDir(), jobId);
  const source = await resolveYoutubeSource(dir, sourceSelection);
  if (!source) {
    failed++;
    console.error(`x ${song.baseId}: requested ${sourceSelection} source is unavailable`);
    continue;
  }
  console.log(`~ ${song.baseId}: source=${source.sourceKind}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) continue;
  let filtered: Uint8Array;
  try {
    filtered = await filterTranscription(new Uint8Array(await readFile(source.midiPath)), source.audioPath);
  } catch (error) {
    failed++;
    console.error(`x ${song.baseId}: onset filter failed: ${(error as Error).message}`);
    continue;
  }
  const r = await ingestSource({
    buf: filtered,
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
  }
  else { ok++; console.log(`+ ${song.baseId} restored (source=${source.sourceKind})`); }
}
for (const target of targets) {
  if (!matchedTargets.has(target)) {
    failed++;
    console.error(`x ${target}: no matching YouTube conversion job`);
  }
}
console.log(`restored ${ok}, failed ${failed}${dryRun ? " (dry run)" : ""}`);
if (failed) process.exitCode = 1;
