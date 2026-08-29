import { canonicalizeSourceProvenance, canonicalYoutubeUrl, extractYoutubeVideoId, type SourceProvenance } from "./provenance.js";

export type ArrangementSourceType =
  | "midi" | "musicxml" | "guitar-pro" | "structured-tab"
  | "piano-cover-video" | "piano-tutorial-video" | "piano-cover-audio"
  | "metal-transcription";

export type ExtractionStrategy = "symbolic" | "audio-transcription" | "visual-midi" | "audio-midi" | "none";

export interface SongIdentityInput {
  title: string;
  artist: string;
  sourceYoutubeUrl?: string | null;
  durationSeconds?: number | null;
  version?: string | null;
}

export interface SongIdentity {
  id: string;
  title: string;
  artist: string;
  normalizedTitle: string;
  normalizedArtist: string;
  sourceYoutubeUrl: string | null;
  youtubeVideoId: string | null;
  durationSeconds: number | null;
  version: string | null;
}

export interface CandidateCoverage {
  startSeconds: number;
  endSeconds: number;
  completeness: number;
}

export interface ArrangementCandidate {
  id: string;
  sourceType: ArrangementSourceType;
  title: string;
  url?: string | null;
  localPath?: string | null;
  provenance: SourceProvenance;
  durationSeconds?: number | null;
  coverage?: CandidateCoverage | null;
  confidence?: number;
  extractionStrategy?: ExtractionStrategy;
  version?: string | null;
  score?: number;
  scoreBreakdown?: Record<string, number>;
  reasons?: string[];
}

export interface ClassifiedCandidate extends ArrangementCandidate {
  sourceType: ArrangementSourceType;
  extractionStrategy: ExtractionStrategy;
  signals: string[];
}

export const RESEARCH_SCORE_WEIGHTS = Object.freeze({
  exactTitle: 30,
  artist: 18,
  piano: 26,
  tutorial: 8,
  synthesia: 10,
  symbolic: 18,
  coherentDuration: 12,
  confidence: 14,
  partialCoverage: -18,
  versionMismatch: -16,
  negativeSignal: -35,
  directFallback: -28,
});

const NOISE = /\b(official|music|video|audio|hd|hq|4k|lyrics|cover|piano|tutorial|transcription|synthesia|midi|arrangement|instrumental)\b/i;

function clean(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[()[\]{}]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleWithoutNoise(title: string, artist: string): string {
  const artistClean = clean(artist);
  const parts = clean(title).split(" ").filter(Boolean).filter((token) => !NOISE.test(token));
  while (parts.join(" ").startsWith(`${artistClean} `)) parts.splice(0, artistClean.split(" ").length);
  return parts.join(" ").trim() || clean(title);
}

function slug(value: string): string {
  return clean(value).replace(/\s+/g, "-");
}

export function createSongIdentity(input: SongIdentityInput): SongIdentity {
  const title = titleWithoutNoise(input.title.trim(), input.artist.trim());
  const artist = input.artist.trim();
  const sourceYoutubeUrl = canonicalYoutubeUrl(input.sourceYoutubeUrl);
  const youtubeVideoId = extractYoutubeVideoId(sourceYoutubeUrl);
  const normalizedTitle = title;
  const normalizedArtist = clean(artist);
  return {
    id: `${slug(normalizedArtist)}-${slug(normalizedTitle)}`,
    title: title.split(" ").map((word) => word ? word[0]!.toUpperCase() + word.slice(1) : word).join(" "),
    artist,
    normalizedTitle,
    normalizedArtist,
    sourceYoutubeUrl,
    youtubeVideoId,
    durationSeconds: typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) ? input.durationSeconds : null,
    version: input.version?.trim() || null,
  };
}

export function buildResearchQueries(song: SongIdentity): string[] {
  const title = song.title;
  const base = `${song.artist} ${title}`;
  return [...new Set([
    `${base} piano`, `${base} transcription`, `${base} Synthesia`, `${base} MIDI`,
  ])];
}

export function classifyArrangementCandidate(candidate: ArrangementCandidate): ClassifiedCandidate {
  const haystack = `${candidate.title} ${candidate.url ?? ""}`.toLowerCase();
  const signals: string[] = [];
  let sourceType = candidate.sourceType;
  let extractionStrategy = candidate.extractionStrategy ?? "none";
  if (/synthesia|tutorial|falling notes|visual midi/.test(haystack)) {
    sourceType = "piano-tutorial-video"; extractionStrategy = "visual-midi"; signals.push("tutorial/synthesia");
  } else if (/piano|keyboard/.test(haystack) && /cover|performance|play(ed|ing)?/.test(haystack)) {
    sourceType = "piano-cover-video"; extractionStrategy = "audio-midi"; signals.push("piano performance");
  } else if (/metal transcription|ai transcription|direct transcription/.test(haystack)) {
    sourceType = "metal-transcription"; extractionStrategy = "audio-transcription"; signals.push("direct fallback");
  } else if (candidate.sourceType === "midi" || /\.mid(i)?(?:$|\?)/.test(haystack)) {
    extractionStrategy = "symbolic"; signals.push("symbolic source");
  }
  return { ...candidate, sourceType, extractionStrategy, signals };
}

function score(candidate: ClassifiedCandidate, song: SongIdentity): { value: number; breakdown: Record<string, number>; reasons: string[] } {
  const haystack = `${candidate.title} ${candidate.url ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  const add = (key: string, amount: number, reason?: string) => { breakdown[key] = amount; if (reason) reasons.push(reason); };
  const titleTokens = song.normalizedTitle.split(" ").filter((token) => token.length > 1);
  const matched = titleTokens.filter((token) => haystack.includes(token)).length;
  add("exactTitle", matched === titleTokens.length ? RESEARCH_SCORE_WEIGHTS.exactTitle : -20, `${matched}/${titleTokens.length} title tokens`);
  add("artist", haystack.includes(song.normalizedArtist) ? RESEARCH_SCORE_WEIGHTS.artist : -18, haystack.includes(song.normalizedArtist) ? "artist match" : "artist mismatch");
  if (/piano|keyboard/.test(haystack)) add("piano", RESEARCH_SCORE_WEIGHTS.piano, "piano signal");
  if (/tutorial/.test(haystack)) add("tutorial", RESEARCH_SCORE_WEIGHTS.tutorial, "tutorial signal");
  if (/synthesia/.test(haystack)) add("synthesia", RESEARCH_SCORE_WEIGHTS.synthesia, "Synthesia signal");
  if (["midi", "musicxml", "guitar-pro", "structured-tab"].includes(candidate.sourceType)) add("symbolic", RESEARCH_SCORE_WEIGHTS.symbolic, "symbolic source");
  if (candidate.sourceType === "metal-transcription") add("directFallback", RESEARCH_SCORE_WEIGHTS.directFallback, "direct transcription fallback");
  if (/reaction|review|lesson|karaoke|mashup|remix|nightcore|sped up|slowed/.test(haystack)) add("negativeSignal", RESEARCH_SCORE_WEIGHTS.negativeSignal, "negative search signal");
  if (song.durationSeconds && candidate.durationSeconds && candidate.durationSeconds > 0) {
    const drift = Math.abs(candidate.durationSeconds - song.durationSeconds) / song.durationSeconds;
    add("coherentDuration", drift <= 0.15 ? RESEARCH_SCORE_WEIGHTS.coherentDuration : -10, `duration drift ${(drift * 100).toFixed(0)}%`);
  }
  if (candidate.coverage && candidate.coverage.completeness < 0.9) add("partialCoverage", RESEARCH_SCORE_WEIGHTS.partialCoverage * (1 - candidate.coverage.completeness), "partial coverage");
  if (candidate.version && song.version && candidate.version !== song.version) add("versionMismatch", RESEARCH_SCORE_WEIGHTS.versionMismatch, "version mismatch");
  if (candidate.confidence !== undefined) add("confidence", Math.max(0, Math.min(1, candidate.confidence)) * RESEARCH_SCORE_WEIGHTS.confidence, "source confidence");
  const value = Object.values(breakdown).reduce((sum, item) => sum + item, 0);
  return { value, breakdown, reasons };
}

export function rankArrangementCandidates(song: SongIdentity, candidates: readonly ArrangementCandidate[]): ClassifiedCandidate[] {
  return candidates.map((raw) => {
    const candidate = classifyArrangementCandidate({ ...raw, provenance: canonicalizeSourceProvenance(raw.provenance, { sourceYoutubeUrl: raw.url }) });
    const result = score(candidate, song);
    return { ...candidate, score: result.value, scoreBreakdown: result.breakdown, reasons: result.reasons };
  }).sort((a, b) => (b.score! - a.score!) || a.id.localeCompare(b.id));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function serializeResearchManifest(song: SongIdentity, candidates: readonly ArrangementCandidate[]): string {
  const pathFree = candidates
    .map(({ localPath: _localPath, ...candidate }) => candidate)
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(stable({ schemaVersion: 1, song, candidates: pathFree }), null, 2) + "\n";
}
