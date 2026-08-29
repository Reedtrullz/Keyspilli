import { canonicalizeSourceProvenance, canonicalYoutubeUrl, extractYoutubeVideoId, type SourceProvenance } from "./provenance.js";
import { buildYoutubeQueries } from "./youtube-discovery.js";

export type ArrangementSourceType =
  | "midi" | "musicxml" | "guitar-pro" | "structured-tab"
  | "piano-cover-video" | "piano-tutorial-video" | "piano-cover-audio"
  | "metal-transcription" | "unknown";

/** Extraction lanes used by the piano research/import pipeline. */
export type PianoExtractionStrategy = "symbolic" | "audio-transcription" | "visual-midi" | "audio-midi" | "none";
/** Historical name retained for callers of the original research API. */
export type ExtractionStrategy = PianoExtractionStrategy;
export type CandidateSelection = "preferred" | "fallback";

export type PianoCandidateClassification = "solo-piano" | "tutorial" | "synthesia" | "bad-cover" | "ambiguous";

/**
 * Metadata-only analysis. This is intentionally not a claim about the audio:
 * callers must still validate downloaded media and extracted notes.
 */
export interface PianoCandidateAnalysis {
  candidateId: string;
  classification: PianoCandidateClassification;
  strategy: PianoExtractionStrategy;
  signals: string[];
  /** Logical/public identity only; physical artifact paths are never exposed. */
  provenance: Pick<SourceProvenance, "kind" | "acquiredVia" | "sourceRef" | "sourceYoutubeUrl">;
}

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
  /** Direct transcription is explicitly a fallback, never implicit truth. */
  selection?: CandidateSelection;
  fallbackTier?: number | null;
  /** Optional provider/channel metadata retained for research reports. */
  provider?: string;
  viewCount?: number;
  isLive?: boolean;
}

export interface ClassifiedCandidate extends ArrangementCandidate {
  sourceType: ArrangementSourceType;
  extractionStrategy: ExtractionStrategy;
  signals: string[];
  selection: CandidateSelection;
}

export interface ClassifierOptions {
  /** Metadata classification may override an explicit source type only when requested. */
  overrideSourceType?: boolean;
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

function tokens(value: string): string[] {
  return clean(value).split(" ").filter(Boolean);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeCoverage(value: CandidateCoverage | null | undefined): CandidateCoverage | null {
  if (!value || typeof value !== "object") return null;
  const startSeconds = finiteInRange(value.startSeconds, 0, Number.MAX_SAFE_INTEGER);
  const endSeconds = finiteInRange(value.endSeconds, 0, Number.MAX_SAFE_INTEGER);
  const completeness = finiteInRange(value.completeness, 0, 1);
  if (startSeconds === null || endSeconds === null || endSeconds < startSeconds || completeness === null) return null;
  return { startSeconds, endSeconds, completeness };
}

function normalizeCandidate(candidate: ArrangementCandidate): ArrangementCandidate {
  const durationSeconds = finitePositive(candidate.durationSeconds);
  const confidence = candidate.confidence === undefined
    ? undefined
    : typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
      ? Math.max(0, Math.min(1, candidate.confidence))
      : undefined;
  const coverage = normalizeCoverage(candidate.coverage);
  const score = typeof candidate.score === "number" && Number.isFinite(candidate.score) ? candidate.score : undefined;
  const scoreBreakdown = candidate.scoreBreakdown && typeof candidate.scoreBreakdown === "object"
    ? Object.fromEntries(Object.entries(candidate.scoreBreakdown).filter(([, item]) => typeof item === "number" && Number.isFinite(item)))
    : undefined;
  const provider = typeof candidate.provider === "string" && candidate.provider.trim() ? candidate.provider.trim() : undefined;
  const viewCount = typeof candidate.viewCount === "number" && Number.isFinite(candidate.viewCount) && candidate.viewCount >= 0 ? candidate.viewCount : undefined;
  const isLive = typeof candidate.isLive === "boolean" ? candidate.isLive : undefined;
  return {
    ...candidate,
    ...(durationSeconds === null ? { durationSeconds: null } : { durationSeconds }),
    confidence,
    ...(candidate.coverage === undefined ? {} : { coverage }),
    ...(candidate.fallbackTier === undefined ? {} : { fallbackTier: candidate.fallbackTier === null ? null : Math.max(0, Math.floor(finiteInRange(candidate.fallbackTier, 0, Number.MAX_SAFE_INTEGER) ?? 0)) }),
    score,
    scoreBreakdown,
    ...(provider ? { provider } : {}),
    ...(viewCount !== undefined ? { viewCount } : {}),
    ...(isLive !== undefined ? { isLive } : {}),
  };
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
    durationSeconds: finitePositive(input.durationSeconds),
    version: input.version?.trim() || null,
  };
}

export function buildResearchQueries(song: SongIdentity): string[] {
  const compatible = buildYoutubeQueries({
    baseId: song.id,
    title: song.title,
    artist: song.artist,
    sourceYoutubeUrl: song.sourceYoutubeUrl,
  });
  const base = `${song.artist} ${song.title}`;
  return [...new Set([
    ...compatible,
    `${base} Synthesia`,
    `${base} MIDI`,
  ])];
}

function strategyFor(sourceType: ArrangementSourceType): ExtractionStrategy {
  if (["midi", "musicxml", "guitar-pro", "structured-tab"].includes(sourceType)) return "symbolic";
  if (sourceType === "piano-tutorial-video") return "visual-midi";
  if (sourceType === "piano-cover-video") return "audio-midi";
  if (sourceType === "piano-cover-audio") return "audio-midi";
  if (sourceType === "metal-transcription") return "audio-transcription";
  return "none";
}

function inferredType(haystack: string): { sourceType: ArrangementSourceType; extractionStrategy: ExtractionStrategy; signal: string } | null {
  if (/synthesia|tutorial|falling notes|visual midi/.test(haystack)) return { sourceType: "piano-tutorial-video", extractionStrategy: "visual-midi", signal: "tutorial/synthesia" };
  if (/piano|keyboard/.test(haystack) && !/\b(?:official(?:\s+(?:music|lyric|audio))?\s+video|official\s+audio|(?:music|lyric)\s+video|karaoke|lyrics?)\b/.test(haystack)) return { sourceType: "piano-cover-video", extractionStrategy: "audio-midi", signal: "piano performance" };
  if (/metal transcription|ai transcription|direct transcription/.test(haystack)) return { sourceType: "metal-transcription", extractionStrategy: "audio-transcription", signal: "direct fallback" };
  if (/\.(?:mid|midi)(?:$|[?#])/.test(haystack)) return { sourceType: "midi", extractionStrategy: "symbolic", signal: "symbolic source" };
  return null;
}

function safeAnalysisProvenance(candidate: ArrangementCandidate): PianoCandidateAnalysis["provenance"] {
  const provenance = canonicalCandidateProvenance(candidate);
  const safe: PianoCandidateAnalysis["provenance"] = {};
  for (const key of ["kind", "acquiredVia", "sourceRef", "sourceYoutubeUrl"] as const) {
    const value = provenance[key];
    if (typeof value !== "string" || !value.trim()) continue;
    // sourceRef is useful only as a logical identity. Never leak a local path
    // from a sidecar into an analysis record intended for reports/API payloads.
    if (key === "sourceRef" && !isLogicalSourceRef(value)) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Classify a candidate from stable metadata in a fixed precedence order.
 * Metadata is evidence for choosing a lane, not proof that the media is
 * actually solo piano; the import stage remains responsible for validation.
 */
export function analyzePianoCandidate(candidate: ArrangementCandidate): PianoCandidateAnalysis {
  const haystack = clean(`${candidate.title} ${candidate.url ?? ""}`);
  const signals: string[] = [];
  let classification: PianoCandidateClassification = "ambiguous";

  if (/\b(?:synthesia|falling notes|visual midi)\b/.test(haystack)) {
    classification = "synthesia";
    signals.push("synthesia/visual-midi metadata");
  } else if (/\b(?:piano\s+)?tutorial\b|how to play|lesson/.test(haystack)) {
    classification = "tutorial";
    signals.push("tutorial metadata");
  } else if (/\b(?:karaoke|reaction|remix|mashup|nightcore|slowed|sped up|lyrics?)\b/.test(haystack)
    || /\b(?:with|feat(?:uring)?|and)\s+(?:vocals?|drums?)\b/.test(haystack)
    || /\bpiano\s+(?:cover|performance)\b.*\b(?:vocals?|drums?)\b/.test(haystack)) {
    classification = "bad-cover";
    signals.push("non-solo cover metadata");
  } else if (candidate.sourceType === "piano-cover-video" || candidate.sourceType === "piano-cover-audio"
    || /\bsolo\s+piano\b|\bpiano\s+instrumental\b|\binstrumental\s+piano\b/.test(haystack)) {
    classification = "solo-piano";
    signals.push(candidate.sourceType.startsWith("piano-cover") ? "piano cover source" : "solo piano metadata");
  } else if (["midi", "musicxml", "guitar-pro", "structured-tab"].includes(candidate.sourceType)) {
    classification = "solo-piano";
    signals.push("symbolic source metadata");
  } else {
    signals.push("insufficient piano metadata");
  }

  return {
    candidateId: candidate.id,
    classification,
    strategy: selectPianoExtractionStrategy({ classification, strategy: "none" }),
    signals,
    provenance: safeAnalysisProvenance(candidate),
  };
}

/** Select an extraction lane without trusting caller-provided strategy fields. */
export function selectPianoExtractionStrategy(
  input: Pick<PianoCandidateAnalysis, "classification" | "strategy"> | ArrangementCandidate,
): PianoExtractionStrategy {
  if ("classification" in input) {
    if (input.classification === "synthesia" || input.classification === "tutorial") return "visual-midi";
    if (input.classification === "solo-piano") return "audio-midi";
    return "none";
  }
  return strategyFor(input.sourceType);
}

export function classifyArrangementCandidate(candidate: ArrangementCandidate, options: ClassifierOptions = {}): ClassifiedCandidate {
  const haystack = `${candidate.title} ${candidate.url ?? ""}`.toLowerCase();
  const signals: string[] = [];
  let sourceType = candidate.sourceType;
  const inferred = inferredType(haystack);
  if (options.overrideSourceType && inferred) {
    sourceType = inferred.sourceType;
    signals.push(inferred.signal);
  } else if (inferred && strategyFor(sourceType) === "symbolic" && sourceType === "midi") {
    signals.push("explicit symbolic source");
  }
  const extractionStrategy = strategyFor(sourceType);
  const selection = sourceType === "metal-transcription" ? "fallback" : candidate.selection ?? "preferred";
  const normalizedTier = candidate.fallbackTier === null || candidate.fallbackTier === undefined
    ? null
    : Math.max(0, Math.floor(finiteInRange(candidate.fallbackTier, 0, Number.MAX_SAFE_INTEGER) ?? 0));
  const fallbackTier = sourceType === "metal-transcription"
    ? Math.max(1, normalizedTier ?? 1)
    : normalizedTier ?? (selection === "fallback" ? 1 : null);
  return { ...normalizeCandidate({ ...candidate, sourceType, extractionStrategy, selection, fallbackTier }), sourceType, extractionStrategy, selection, signals };
}

function containsTokenSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) return true;
  }
  return false;
}

function score(candidate: ClassifiedCandidate, song: SongIdentity): { value: number; breakdown: Record<string, number>; reasons: string[] } {
  const haystack = `${candidate.title} ${candidate.url ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};
  const add = (key: string, amount: number, reason?: string) => {
    const finiteAmount = Number.isFinite(amount) ? amount : 0;
    breakdown[key] = finiteAmount;
    if (reason) reasons.push(reason);
  };
  const titleTokens = tokens(song.normalizedTitle).filter((token) => token.length > 1);
  const haystackTokens = new Set(tokens(haystack));
  const matched = titleTokens.filter((token) => haystackTokens.has(token)).length;
  add("exactTitle", matched === titleTokens.length ? RESEARCH_SCORE_WEIGHTS.exactTitle : -20, `${matched}/${titleTokens.length} title tokens`);
  const artistMatch = containsTokenSequence(tokens(haystack), tokens(song.normalizedArtist));
  add("artist", artistMatch ? RESEARCH_SCORE_WEIGHTS.artist : -18, artistMatch ? "artist match" : "artist mismatch");
  if (/piano|keyboard/.test(haystack)) add("piano", RESEARCH_SCORE_WEIGHTS.piano, "piano signal");
  if (/tutorial/.test(haystack)) add("tutorial", RESEARCH_SCORE_WEIGHTS.tutorial, "tutorial signal");
  if (/synthesia/.test(haystack)) add("synthesia", RESEARCH_SCORE_WEIGHTS.synthesia, "Synthesia signal");
  if (["midi", "musicxml", "guitar-pro", "structured-tab"].includes(candidate.sourceType)) add("symbolic", RESEARCH_SCORE_WEIGHTS.symbolic, "symbolic source");
  if (candidate.sourceType === "metal-transcription") add("directFallback", RESEARCH_SCORE_WEIGHTS.directFallback, "direct transcription fallback");
  if (/reaction|review|lesson|karaoke|mashup|remix|nightcore|sped up|slowed/.test(haystack)) add("negativeSignal", RESEARCH_SCORE_WEIGHTS.negativeSignal, "negative search signal");
  const songDuration = finitePositive(song.durationSeconds);
  if (songDuration !== null && candidate.durationSeconds && candidate.durationSeconds > 0) {
    const drift = Math.abs(candidate.durationSeconds - songDuration) / songDuration;
    add("coherentDuration", drift <= 0.15 ? RESEARCH_SCORE_WEIGHTS.coherentDuration : -10, `duration drift ${(drift * 100).toFixed(0)}%`);
  }
  if (candidate.coverage && candidate.coverage.completeness < 0.9) add("partialCoverage", RESEARCH_SCORE_WEIGHTS.partialCoverage * (1 - candidate.coverage.completeness), "partial coverage");
  if (candidate.version && song.version && candidate.version !== song.version) add("versionMismatch", RESEARCH_SCORE_WEIGHTS.versionMismatch, "version mismatch");
  if (candidate.confidence !== undefined) add("confidence", Math.max(0, Math.min(1, candidate.confidence)) * RESEARCH_SCORE_WEIGHTS.confidence, "source confidence");
  const value = Object.values(breakdown).reduce((sum, item) => sum + item, 0);
  return { value, breakdown, reasons };
}

function canonicalCandidateProvenance(candidate: ArrangementCandidate): SourceProvenance {
  const candidateYoutubeUrl = canonicalYoutubeUrl(candidate.url);
  const raw = candidate.provenance && typeof candidate.provenance === "object" && !Array.isArray(candidate.provenance)
    ? candidate.provenance as SourceProvenance
    : {};
  // A concrete candidate URL is the strongest identity available. In
  // particular, do not let a stale sidecar URL change the candidate's key.
  return canonicalizeSourceProvenance(
    candidateYoutubeUrl ? { ...raw, sourceYoutubeUrl: candidateYoutubeUrl } : raw,
    candidateYoutubeUrl ? { sourceYoutubeUrl: candidateYoutubeUrl } : {},
  );
}

export function rankArrangementCandidates(song: SongIdentity, candidates: readonly ArrangementCandidate[]): ClassifiedCandidate[] {
  return mergeArrangementCandidates(candidates).map((raw) => {
    const candidate = classifyArrangementCandidate({ ...raw, provenance: canonicalCandidateProvenance(raw) });
    const result = score(candidate, song);
    return { ...candidate, score: result.value, scoreBreakdown: result.breakdown, reasons: result.reasons };
  }).sort((a, b) => (b.score! - a.score!) || a.id.localeCompare(b.id) || canonicalCandidateKey(a).localeCompare(canonicalCandidateKey(b)) || stableJson(a).localeCompare(stableJson(b)));
}

/** Stable logical key used to collapse repeated search results and aliases. */
export function canonicalCandidateKey(candidate: ArrangementCandidate): string {
  const provenance = canonicalCandidateProvenance(candidate);
  const logical = provenance.sourceRef ?? canonicalYoutubeUrl(candidate.url) ?? candidate.id;
  return `${candidate.sourceType}|${logical}`;
}

function candidateRichness(candidate: ArrangementCandidate): number {
  return Object.entries(candidate).reduce((score, [, value]) => score + (value === null || value === undefined || value === "" ? 0 : Array.isArray(value) && value.length === 0 ? 0 : 1), 0)
    + (candidate.confidence ?? 0) * 10;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

/** Merge canonical aliases without making input/search order observable. */
export function mergeArrangementCandidates(candidates: readonly ArrangementCandidate[]): ArrangementCandidate[] {
  const groups = new Map<string, ArrangementCandidate[]>();
  for (const raw of candidates) {
    const candidate = normalizeCandidate(raw);
    const key = canonicalCandidateKey(candidate);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => {
    const ordered = [...group].sort((left, right) => (candidateRichness(right) - candidateRichness(left)) || stableJson(left).localeCompare(stableJson(right)));
    const first = ordered[0]!;
    const url = canonicalYoutubeUrl(first.url) ?? first.url ?? null;
    const confidence = Math.max(...group.map((item) => item.confidence ?? 0));
    const mergedProvenance = canonicalCandidateProvenance({ ...first, url });
    return {
      ...first,
      ...(url === null ? { url: null } : { url }),
      provenance: mergedProvenance,
      ...(group.some((item) => item.confidence !== undefined) ? { confidence } : {}),
    };
  });
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential|cookie|session)/i;
const PATH_KEY = /(?:path|filename|file|artifactref)/i;
const URL_KEY = /(?:url|uri|href|sourceYoutubeUrl)$/i;
const SENSITIVE_QUERY = /^(?:token|access_token|refresh_token|api_key|apikey|key|secret|password|passwd|auth|authorization|cookie|session|sig|signature|.*(?:token|secret|password|credential|auth|api[_-]?key|signature).*)$/i;

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return null;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE_QUERY.test(key)) url.searchParams.delete(key);
    if (SENSITIVE_QUERY.test(url.hash.replace(/^#/, ""))) url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isLogicalSourceRef(value: string): boolean {
  if (/^(?:file|https?|ftp|ssh):/i.test(value)) return false;
  return /^(?:youtube|catalog|upload|midi-pack|seed|manifest|reconstructed-upload|stored-advanced):[A-Za-z0-9_-]+$/i.test(value)
    || /^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9_-]+$/.test(value);
}

function isPathLikeSourceRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isLogicalSourceRef(trimmed)) return false;
  return /^(?:file:|[~.]?[\/]|[A-Za-z]:[\\/])/.test(trimmed)
    || /[\\/]/.test(trimmed)
    || /[?#@]/.test(trimmed)
    || /\.(?:mid|midi|musicxml|xml|gp|gpx|mp3|wav|flac|json)$/i.test(trimmed);
}

function sanitizeManifestValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (PATH_KEY.test(key)) return undefined;
  if (/^sourceRef$/i.test(key) && typeof value === "string" && isPathLikeSourceRef(value)) return undefined;
  if (typeof value === "string") {
    if (/^file:/i.test(value) || /^(?:\/|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/])/.test(value)) return undefined;
    if (URL_KEY.test(key) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return safeUrl(value) ?? undefined;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeManifestValue(item, key)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeManifestValue(childValue, childKey);
      if (sanitized !== undefined) output[childKey] = sanitized;
    }
    return output;
  }
  return value;
}

export function serializeResearchManifest(song: SongIdentity, candidates: readonly ArrangementCandidate[]): string {
  const pathFree = mergeArrangementCandidates(candidates).map((candidate) => sanitizeManifestValue(candidate));
  const safeSong = sanitizeManifestValue(song);
  return JSON.stringify(stable({ schemaVersion: 1, song: safeSong, candidates: pathFree }), null, 2) + "\n";
}
