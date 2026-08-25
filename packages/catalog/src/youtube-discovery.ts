import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface YoutubeDiscoveryCandidate {
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  durationSeconds: number;
  viewCount?: number;
  isLive: boolean;
}

/** A song's searchable identity plus its currently imported recording. */
export interface YoutubeDiscoveryTarget {
  baseId: string;
  title: string;
  artist: string;
  sourceYoutubeUrl?: string | null;
}

interface YtDlpEntry {
  id?: unknown;
  title?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  view_count?: unknown;
  is_live?: unknown;
  live_status?: unknown;
}

const STOP_TOKENS = new Set([
  "piano", "cover", "tutorial", "video", "with", "lyrics", "performed", "by",
  "and", "the", "of", "for", "official", "sheet", "music", "full", "album",
  "version", "audio", "hq", "hd", "4k",
]);

function slugTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_TOKENS.has(token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TITLE_NOISE =
  /piano|cover|tutorial|transcription|synthesia|karaoke|lyrics|official|video|audio|hd|hq|4k/i;

/**
 * Reduce a catalog title copied from an upload into searchable song text.
 */
export function cleanCatalogTitle(title: string, artist: string): string {
  const stripped = title.replace(/\([^()]*\)/g, " ").replace(/\[[^\[\]]*\]/g, " ");
  const segments = stripped.split(/\s*(?:[-\u2013\u2014]|\|)\s*/).map((s) => s.trim()).filter(Boolean);
  const meaningful = segments.filter((segment) => !TITLE_NOISE.test(segment));
  const withoutArtist = meaningful.filter(
    (segment, index) =>
      !(index === 0 && meaningful.length > 1 && segment.toLowerCase() === artist.trim().toLowerCase()),
  );
  return (withoutArtist.length ? withoutArtist : meaningful).join(" ").trim() || title.trim();
}

/**
 * Build a small set of complementary queries. The first is a precise
 * artist/title/piano query; the second catches uploads labeled as
 * transcriptions or performances; the third is a sparse-title fallback.
 */
export function buildYoutubeQueries(target: YoutubeDiscoveryTarget): string[] {
  const artist = target.artist.trim();
  const title = cleanCatalogTitle(target.title, artist);
  if (!artist || !title) throw new Error("discovery target requires both artist and title");
  const queries = [
    `${artist} ${title} piano`,
    `${artist} ${title} transcription`,
  ];
  const core = [...new Set(slugTokens(title))].slice(0, 6).join(" ");
  const plainQuery = `${artist} ${title}`.toLowerCase();
  if (core && core !== plainQuery) queries.push(`${core} ${artist} piano`);
  return [...new Set(queries)];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseYtDlpSearchOutput(stdout: string): YoutubeDiscoveryCandidate[] {
  const byId = new Map<string, YoutubeDiscoveryCandidate>();
  for (const line of stdout.split("\n")) {
    let raw: YtDlpEntry;
    try {
      // yt-dlp prints bare NA for fields a search result does not provide.
      raw = JSON.parse(line.replace(/:\s*NA(?=[,}\]])/g, ":null")) as YtDlpEntry;
    } catch {
      continue;
    }
    const id = asString(raw.id);
    const title = asString(raw.title);
    if (!id || !title || !/^[\w-]{11}$/.test(id)) continue;
    // Search result pages can repeat an item; keep the first, richest
    // record instead of letting a sparse duplicate overwrite it.
    if (byId.has(id)) continue;
    const duration = asNumber(raw.duration);
    const viewCount = asNumber(raw.view_count);
    byId.set(id, {
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title,
      uploader: asString(raw.uploader) ?? asString(raw.channel) ?? "unknown",
      durationSeconds: Math.max(0, Math.round(duration ?? 0)),
      ...(viewCount !== undefined ? { viewCount } : {}),
      isLive: raw.is_live === true || asString(raw.live_status) === "is_live",
    });
  }
  return [...byId.values()];
}

/** Duration bounds and comparison reference for candidate ranking. */
export interface RankOptions {
  maxDurationSeconds?: number;
  /** Lower bound for usable solo performances. */
  minDurationSeconds?: number;
  referenceDurationSeconds?: number;
}

export interface ScoredCandidate extends YoutubeDiscoveryCandidate {
  score: number;
  reasons: string[];
}

/**
 * Deterministic, explainable ranking. Piano/performance signals dominate;
 * views only break ties so popular-but-wrong uploads cannot win.
 */
export function scoreCandidate(
  candidate: YoutubeDiscoveryCandidate,
  target: YoutubeDiscoveryTarget,
  options: RankOptions = {},
): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;
  const haystack = candidate.title.toLowerCase();
  const identityHaystack = `${candidate.title} ${candidate.uploader}`.toLowerCase();
  if (/piano|keyboard/.test(haystack)) { score += 30; reasons.push("piano signal"); }
  if (/cover|performance|transcription|arrangement|play(ed|ing)? by|synthesia/.test(identityHaystack)) {
    score += 15;
    reasons.push("performance signal");
  }
  if (/reaction|review|lesson|how to|tutorial|mashup|remix|karaoke|instrumental|8d audio|sped up|slowed|nightcore/.test(haystack)) {
    score -= 40;
    reasons.push("negative signal");
  }

  const titleTokens = slugTokens(cleanCatalogTitle(target.title, target.artist));
  const matchedTitleTokens = titleTokens.filter((token) => haystack.includes(token));
  const tokenRatio = titleTokens.length ? matchedTitleTokens.length / titleTokens.length : 0;
  // Hard relevance floor: a candidate must carry most of the song identity.
  // This keeps YouTube query drift from surfacing unrelated uploads by the
  // same performer.
  const minTokenRatio = titleTokens.length <= 3 ? 1 : 0.6;
  if (tokenRatio < minTokenRatio) {
    score -= 1000;
    reasons.push(`insufficient song-token match ${matchedTitleTokens.length}/${titleTokens.length}`);
  }
  score += tokenRatio * 25;
  if (matchedTitleTokens.length >= 2) reasons.push(`title match ${matchedTitleTokens.length}/${titleTokens.length}`);

  const minDuration = options.minDurationSeconds ?? 45;
  const maxDuration = options.maxDurationSeconds ?? 300;
  if (candidate.isLive || candidate.durationSeconds < minDuration || candidate.durationSeconds > maxDuration) {
    score -= 1000;
    reasons.push("duration/live ineligible");
  } else {
    const reference = options.referenceDurationSeconds;
    if (reference && reference > 0) {
      const drift = Math.abs(candidate.durationSeconds - reference) / reference;
      score += Math.max(0, 10 - drift * 20);
      reasons.push(`duration drift ${(drift * 100).toFixed(0)}%`);
    }
    const views = candidate.viewCount ?? 0;
    const popularity = views > 0 ? Math.min(5, Math.log10(views + 1) - 3) : 0;
    if (popularity > 0) { score += popularity; reasons.push("popular upload"); }
  }
  return { ...candidate, score, reasons };
}

/** Search adapter kept out of pure ranking logic and tests. */
export async function searchYoutubeCandidates(
  query: string,
  limit = 8,
): Promise<YoutubeDiscoveryCandidate[]> {
  const { stdout } = await execFileP(
    process.env.KEYSPILLI_YTDLP ?? "yt-dlp",
    [
      "--flat-playlist",
      "--print", `{"id":%(id)j,"title":%(title)j,"uploader":%(uploader)j,"channel":%(channel)j,"duration":%(duration)j,"view_count":%(view_count)j,"is_live":%(is_live)j,"live_status":%(live_status)j}`,
      "--no-warnings",
      "--quiet",
      `ytsearch${limit}:${query}`,
    ],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return parseYtDlpSearchOutput(stdout);
}
