/**
 * Discover alternate YouTube piano recordings for imported YouTube bases.
 *
 * Read-only against YouTube and the catalog DB; writes one review manifest
 * with ranked candidates. It never downloads audio or replaces artifacts, so
 * an operator can compare sources before any targeted re-transcription.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/discover-youtube-sources.ts [--limit N] [baseId...]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../src/db.js";
import { ROOT } from "../src/paths.js";
import {
  buildYoutubeQueries,
  extractYoutubeVideoId,
  searchYoutubeCandidates,
  scoreCandidate,
} from "../src/index.js";

const args = process.argv.slice(2);
const limitArgIndex = args.indexOf("--limit");
let perBaseLimit = 5;
if (limitArgIndex >= 0) {
  const raw = args[limitArgIndex + 1];
  const parsed = Number(raw);
  if (!raw || !Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    console.error("--limit requires an integer between 1 and 20");
    process.exit(1);
  }
  perBaseLimit = parsed;
  args.splice(limitArgIndex, 2);
}
const onlyBases = args;

interface DiscoveredCandidateJson {
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  durationSeconds: number;
  viewCount?: number;
  isLive: boolean;
  score: number;
  reasons: string[];
}

function referenceDurationSeconds(row: { duration: number } | undefined): number | undefined {
  return row?.duration && row.duration > 0 ? row.duration : undefined;
}

async function main(): Promise<void> {
  const db = getDb();
  const rows = onlyBases.length
    ? db.prepare(
        `SELECT base_id AS baseId, title, artist, duration, source_youtube_url AS sourceYoutubeUrl
         FROM songs WHERE content_type = 'youtube' AND base_id IN (${onlyBases.map(() => "?").join(",")})
         GROUP BY base_id ORDER BY base_id`,
      ).all(...onlyBases)
    : db.prepare(
        `SELECT base_id AS baseId, title, artist, duration, source_youtube_url AS sourceYoutubeUrl
         FROM songs WHERE content_type = 'youtube'
         GROUP BY base_id ORDER BY base_id`,
      ).all();

  const targets = rows as Array<{
    baseId: string;
    title: string;
    artist: string;
    duration: number;
    sourceYoutubeUrl: string | null;
  }>;
  if (onlyBases.length) {
    const found = new Set(targets.map((row) => row.baseId));
    for (const base of onlyBases) {
      if (!found.has(base)) console.error(`x ${base}: no youtube catalog row`);
    }
  }
  if (!targets.length) throw new Error("no discovery targets found");

  const generatedAt = new Date().toISOString();
  let discoveredCount = 0;
  let ok = 0;
  let failed = 0;
  const results: Record<string, unknown> = {};
  for (const target of targets) {
    const queries = buildYoutubeQueries(target);
    const currentVideoId = extractYoutubeVideoId(target.sourceYoutubeUrl);
    const errors: string[] = [];
    const byId = new Map<string, ReturnType<typeof scoreCandidate>>();
    for (const query of queries) {
      try {
        for (const candidate of await searchYoutubeCandidates(query)) {
          if (candidate.videoId === currentVideoId) continue;
          const scored = scoreCandidate(candidate, target, {
            referenceDurationSeconds: referenceDurationSeconds(target),
          });
          const previous = byId.get(scored.videoId);
          if (!previous || scored.score > previous.score) byId.set(scored.videoId, scored);
        }
      } catch (error) {
        errors.push(`${query}: ${(error as Error).message}`);
      }
    }
    const ranked: DiscoveredCandidateJson[] = [...byId.values()]
      .sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId))
      .slice(0, currentVideoId ? perBaseLimit + 1 : perBaseLimit)
      .map((candidate) => ({ ...candidate }));
    results[target.baseId] = {
      title: target.title,
      artist: target.artist,
      currentVideoId,
      queries,
      candidates: ranked.map((candidate) => ({
        ...("viewCount" in candidate ? candidate : {}),
        videoId: candidate.videoId,
        url: candidate.url,
        title: candidate.title,
        uploader: candidate.uploader,
        durationSeconds: candidate.durationSeconds,
        isLive: candidate.isLive,
        score: Math.round(candidate.score * 100) / 100,
        reasons: candidate.reasons,
      })).filter((candidate) => candidate.videoId !== currentVideoId).slice(0, perBaseLimit),
      errors,
    };
    discoveredCount += ranked.length;
    if (ranked.length || errors.length === 0) ok++;
    else failed++;
    console.log(`~ ${target.baseId}: ${ranked.length} candidates${errors.length ? `, ${errors.length} query error(s)` : ""}`);
  }

  const outputDir = join(ROOT, "catalog", "youtube-source-candidates");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, "candidates.json");
  let previousTargets: Record<string, unknown> = {};
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8")) as { targets?: Record<string, unknown> };
    if (previous.targets && typeof previous.targets === "object") previousTargets = previous.targets;
  } catch (error) {
    // A missing file is normal on first run; a malformed file should not be
    // silently overwritten.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`existing candidates.json is not valid JSON: ${(error as Error).message}`);
    }
  }
  const payload = {
    version: 1,
    generatedAt,
    targets: { ...previousTargets, ...results },
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${outputPath}: ${targets.length} bases, ${discoveredCount} candidates, ok ${ok}, failed ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
