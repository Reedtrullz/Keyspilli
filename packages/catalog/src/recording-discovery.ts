import {
  cleanCatalogTitle,
  searchYoutubeCandidates,
  type YoutubeDiscoveryCandidate,
} from "./youtube-discovery.js";
import { canonicalYoutubeUrl, extractYoutubeVideoId } from "./provenance.js";

/** Version for the path-free, metadata-only recording discovery report. */
export const RECORDING_DISCOVERY_SCHEMA_VERSION = 1 as const;

export type RecordingKind =
  | "official-studio"
  | "official-music-video"
  | "official-lyric-video"
  | "live"
  | "cover"
  | "reupload"
  | "unknown";

export type RecordingDiscoveryStatus = "selected" | "ambiguous" | "no-match" | "failed";

/** The input shape deliberately remains the existing yt-dlp metadata shape. */
export type RecordingDiscoveryCandidate = YoutubeDiscoveryCandidate;

export interface RecordingDiscoveryTarget {
  artist: string;
  title: string;
  durationSeconds?: number | null;
  sourceYoutubeUrl?: string | null;
}

export interface ClassifiedRecordingCandidate {
  id: string;
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  durationSeconds: number;
  isLive: boolean;
  recordingKind: RecordingKind;
  versionAmbiguity: string;
  confidence: number;
  score: number;
  reasons: string[];
  discoveredBy?: string[];
}

export interface OriginalRecordingDiscoveryReport {
  schemaVersion: typeof RECORDING_DISCOVERY_SCHEMA_VERSION;
  artist: string;
  title: string;
  durationSeconds: number | null;
  queries: string[];
  status: RecordingDiscoveryStatus;
  recommendation: string | null;
  versionAmbiguity: string;
  candidates: ClassifiedRecordingCandidate[];
  errors: string[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const AMBIGUITY_MARGIN = 0.12;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clean(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): string[] {
  return clean(value).split(" ").filter((token) => token.length > 1);
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) return true;
  }
  return false;
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!text) return fallback;
  // Network metadata is untrusted. Do not let a malicious title/uploader turn
  // into a local path in an otherwise path-free report.
  if (/^(?:file:|[~/]|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(text)) return "[redacted]";
  return text;
}

function targetTitle(target: RecordingDiscoveryTarget): string {
  return cleanCatalogTitle(target.title.trim(), target.artist.trim());
}

/**
 * Build queries for the original recording lane. This is intentionally
 * separate from the piano-cover queries used by the arrangement researcher.
 */
export function buildOriginalRecordingQueries(target: RecordingDiscoveryTarget): string[] {
  const artist = target.artist.trim();
  const title = targetTitle(target);
  if (!artist || !title) throw new Error("recording discovery target requires both artist and title");
  return [
    `${artist} ${title} official audio`,
    `${artist} ${title} official music video`,
    `${artist} ${title} studio recording`,
  ];
}

function titleIdentity(candidate: RecordingDiscoveryCandidate, target: RecordingDiscoveryTarget): {
  ratio: number;
  artistMatch: boolean;
  exactTitle: boolean;
} {
  const titleTokens = tokens(targetTitle(target));
  const candidateTokens = tokens(candidate.title);
  const matched = titleTokens.filter((token) => candidateTokens.includes(token)).length;
  const ratio = titleTokens.length ? matched / titleTokens.length : 0;
  return {
    ratio,
    artistMatch: containsSequence(tokens(`${candidate.title} ${candidate.uploader}`), tokens(target.artist)),
    exactTitle: titleTokens.length > 0 && matched === titleTokens.length,
  };
}

function classifyKind(candidate: RecordingDiscoveryCandidate, identity: ReturnType<typeof titleIdentity>): RecordingKind {
  const haystack = clean(`${candidate.title} ${candidate.uploader}`);
  if (candidate.isLive || /\blive\b|concert|festival|tour recording/.test(haystack)) return "live";
  if (/reupload|re-upload|fan upload|unofficial upload/.test(haystack)) return "reupload";
  if (/cover|karaoke|piano|remix|mashup|nightcore|sped up|slowed|reaction/.test(haystack)) return "cover";
  if (/official\s+(?:lyric\s+)?video|lyric\s+video/.test(haystack) && /official|sabaton|artist/.test(haystack)) {
    return /lyric/.test(haystack) ? "official-lyric-video" : "official-music-video";
  }
  if (/official\s+audio|official\s+soundtrack|studio|album|official/.test(haystack)
    || (identity.artistMatch && identity.exactTitle)) return "official-studio";
  return "unknown";
}

function candidateAmbiguity(
  candidate: RecordingDiscoveryCandidate,
  target: RecordingDiscoveryTarget,
  kind: RecordingKind,
  identity: ReturnType<typeof titleIdentity>,
): string {
  if (identity.ratio < (tokens(targetTitle(target)).length <= 3 ? 1 : 0.6)) return "song identity mismatch";
  if (kind === "live") return "live performance rather than a stable studio version";
  if (kind === "cover" || kind === "reupload") return "non-original or reuploaded recording";
  if (kind === "unknown") return "insufficient official/studio metadata";
  const duration = finite(candidate.durationSeconds) && candidate.durationSeconds > 0 ? candidate.durationSeconds : null;
  const reference = finite(target.durationSeconds) && target.durationSeconds > 0 ? target.durationSeconds : null;
  if (duration !== null && reference !== null) {
    const drift = Math.abs(duration - reference) / reference;
    if (drift > 0.2) return `duration mismatch (${round(drift * 100, 1)}%)`;
  }
  return "none";
}

function candidateReasons(
  candidate: RecordingDiscoveryCandidate,
  target: RecordingDiscoveryTarget,
  kind: RecordingKind,
  identity: ReturnType<typeof titleIdentity>,
): string[] {
  const reasons: string[] = [];
  if (identity.exactTitle) reasons.push("exact song-title tokens");
  else reasons.push(`song-title match ${Math.round(identity.ratio * 100)}%`);
  if (identity.artistMatch) reasons.push("artist metadata match");
  if (kind.startsWith("official")) reasons.push("official/studio signal");
  if (kind === "live") reasons.push("live signal");
  if (kind === "cover") reasons.push("cover/non-original signal");
  if (kind === "reupload") reasons.push("reupload signal");
  if (finite(candidate.durationSeconds) && candidate.durationSeconds > 0 && finite(target.durationSeconds) && target.durationSeconds > 0) {
    reasons.push(`duration ${(Math.abs(candidate.durationSeconds - target.durationSeconds) / target.durationSeconds * 100).toFixed(0)}% drift`);
  } else {
    reasons.push("duration unavailable");
  }
  return reasons;
}

/** Convert untrusted yt-dlp metadata into a stable, path-free review record. */
export function classifyRecordingCandidate(
  candidate: RecordingDiscoveryCandidate,
  target: RecordingDiscoveryTarget,
): ClassifiedRecordingCandidate | null {
  if (!candidate || !VIDEO_ID.test(candidate.videoId)) return null;
  const identity = titleIdentity(candidate, target);
  const kind = classifyKind(candidate, identity);
  const ambiguity = candidateAmbiguity(candidate, target, kind, identity);
  const durationSeconds = finite(candidate.durationSeconds) && candidate.durationSeconds >= 0 ? candidate.durationSeconds : 0;
  const officialSignal = kind.startsWith("official") ? 0.2 : 0;
  const artistSignal = identity.artistMatch ? 0.2 : 0;
  const durationReference = finite(target.durationSeconds) && target.durationSeconds > 0 ? target.durationSeconds : null;
  const durationClose = durationReference !== null && durationSeconds > 0
    ? Math.max(0, 1 - Math.abs(durationSeconds - durationReference) / durationReference)
    : 0;
  let confidence = 0.2 + identity.ratio * 0.35 + artistSignal + officialSignal + durationClose * 0.15;
  if (kind === "live") confidence *= 0.35;
  if (kind === "cover" || kind === "reupload") confidence *= 0.2;
  if (kind === "unknown") confidence *= 0.55;
  if (ambiguity === "song identity mismatch") confidence *= 0.2;
  confidence = round(clamp(confidence, 0, 1));
  const score = round(confidence * 100 + (kind.startsWith("official") ? 5 : 0));
  const title = safeText(candidate.title, "untitled recording");
  const uploader = safeText(candidate.uploader, "unknown uploader");
  const url = canonicalYoutubeUrl(candidate.videoId)!;
  return {
    id: `youtube:${candidate.videoId}`,
    videoId: candidate.videoId,
    url,
    title,
    uploader,
    durationSeconds: round(durationSeconds),
    isLive: candidate.isLive === true,
    recordingKind: kind,
    versionAmbiguity: ambiguity,
    confidence,
    score,
    reasons: candidateReasons(candidate, target, kind, identity),
  };
}

function candidateSortKey(candidate: RecordingDiscoveryCandidate): string {
  return JSON.stringify({
    id: candidate.videoId,
    title: safeText(candidate.title, ""),
    uploader: safeText(candidate.uploader, ""),
    duration: finite(candidate.durationSeconds) ? candidate.durationSeconds : 0,
    viewCount: finite(candidate.viewCount) ? candidate.viewCount : 0,
  });
}

function eligible(candidate: ClassifiedRecordingCandidate): boolean {
  return candidate.recordingKind.startsWith("official")
    && candidate.versionAmbiguity === "none"
    && candidate.confidence >= 0.75;
}

/** Select one recording only when metadata makes the version unambiguous. */
export function selectOriginalRecording(
  target: RecordingDiscoveryTarget,
  candidates: readonly RecordingDiscoveryCandidate[],
): Omit<OriginalRecordingDiscoveryReport, "schemaVersion" | "artist" | "title" | "durationSeconds" | "queries" | "errors"> & {
  candidates: ClassifiedRecordingCandidate[];
} {
  const byId = new Map<string, RecordingDiscoveryCandidate>();
  for (const candidate of candidates) {
    if (!VIDEO_ID.test(candidate.videoId)) continue;
    const previous = byId.get(candidate.videoId);
    if (!previous || candidateSortKey(candidate) < candidateSortKey(previous)) byId.set(candidate.videoId, candidate);
  }
  const classified = [...byId.values()]
    .map((candidate) => classifyRecordingCandidate(candidate, target))
    .filter((candidate): candidate is ClassifiedRecordingCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score || compareText(left.id, right.id));
  const eligibleCandidates = classified.filter(eligible);
  if (!eligibleCandidates.length) {
    return {
      status: "no-match",
      recommendation: null,
      versionAmbiguity: classified.length ? "no eligible official/studio candidate" : "no recording candidates found",
      candidates: classified,
    };
  }
  const first = eligibleCandidates[0]!;
  const second = eligibleCandidates[1];
  if (second && first.score - second.score <= AMBIGUITY_MARGIN * 100) {
    return {
      status: "ambiguous",
      recommendation: null,
      versionAmbiguity: "multiple official/studio versions are similarly plausible",
      candidates: classified,
    };
  }
  return {
    status: "selected",
    recommendation: first.id,
    versionAmbiguity: "none",
    candidates: classified,
  };
}

function safeDiscoveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message || /(?:password|token|secret|cookie|authorization|--proxy|(?:https?|socks5h?):\/\/[^\s/@]+:[^\s/@]+@|(?:^|[\s"'(:])(?:[A-Za-z]:[\\/]|~?[\\/]\.?.*[\\/]))/i.test(message)) {
    return "recording metadata search failed";
  }
  return message.replace(/[\r\n]+/g, " ").slice(0, 240) || "recording metadata search failed";
}

/**
 * Search only public metadata. The adapter invokes yt-dlp's flat search mode;
 * it never downloads media or writes an audio artifact.
 */
export async function discoverOriginalRecordings(
  target: RecordingDiscoveryTarget,
  options: {
    limit?: number;
    currentVideoId?: string | null;
    search?: (query: string, limit: number) => Promise<readonly RecordingDiscoveryCandidate[]>;
  } = {},
): Promise<OriginalRecordingDiscoveryReport> {
  const queries = buildOriginalRecordingQueries(target);
  const search = options.search ?? searchYoutubeCandidates;
  const limit = finite(options.limit) ? Math.max(1, Math.min(20, Math.floor(options.limit!))) : 8;
  const currentVideoId = options.currentVideoId ?? extractYoutubeVideoId(target.sourceYoutubeUrl);
  const found = new Map<string, { candidate: RecordingDiscoveryCandidate; queries: Set<string> }>();
  const errors: string[] = [];
  for (const query of queries) {
    try {
      const rows = await search(query, limit);
      if (!Array.isArray(rows)) throw new Error("metadata search returned a non-array result");
      for (const candidate of rows) {
        if (!candidate || !VIDEO_ID.test(candidate.videoId) || candidate.videoId === currentVideoId) continue;
        const previous = found.get(candidate.videoId);
        if (!previous || candidateSortKey(candidate) < candidateSortKey(previous.candidate)) {
          found.set(candidate.videoId, { candidate, queries: previous?.queries ?? new Set<string>() });
        }
        found.get(candidate.videoId)!.queries.add(query);
      }
    } catch (error) {
      errors.push(`${query}: ${safeDiscoveryError(error)}`);
    }
  }
  const selected = selectOriginalRecording(target, [...found.values()].map((entry) => entry.candidate));
  const candidates = selected.candidates.map((candidate) => {
    const querySet = found.get(candidate.videoId)?.queries;
    return querySet?.size ? { ...candidate, discoveredBy: [...querySet].sort(compareText) } : candidate;
  });
  const status: RecordingDiscoveryStatus = !candidates.length && errors.length ? "failed" : selected.status;
  const versionAmbiguity = status === "failed" ? "metadata search failed" : selected.versionAmbiguity;
  return {
    schemaVersion: RECORDING_DISCOVERY_SCHEMA_VERSION,
    artist: safeText(target.artist, "unknown artist"),
    title: safeText(targetTitle(target), "unknown title"),
    durationSeconds: finite(target.durationSeconds) && target.durationSeconds! >= 0 ? round(target.durationSeconds!) : null,
    queries,
    status,
    recommendation: selected.recommendation,
    versionAmbiguity,
    candidates,
    errors: [...new Set(errors)].sort(compareText),
  };
}
