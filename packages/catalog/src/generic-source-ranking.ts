import { sha256Hex } from "./fixture-evidence.js";
import type { GenerationCandidateClass } from "./generation-candidate-intake.js";

/** Metadata-only source discovery. It never fetches or parses candidate bytes. */
export const GENERIC_SOURCE_DISCOVERY_SCHEMA_VERSION = 1 as const;

export type GenericEvidenceClass =
  | "STRUCTURED_MIDI" | "STRUCTURED_MUSICXML" | "STRUCTURED_MXL" | "STRUCTURED_GUITAR_PRO"
  | "PIANO_SYMBOLIC" | "SCORE_PDF_OR_IMAGE" | "PIANO_COVER_AUDIO_OR_VIDEO" | "TAB"
  | "CHORDS" | "LYRICS_ONLY" | "GENERIC_AUDIO" | "UNKNOWN";
export type GenericTimingClass =
  | "NATIVE_AUTHORITATIVE" | "PERFORMANCE_SYMBOLIC_POTENTIAL" | "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT"
  | "SEMANTIC_ONLY" | "INDEPENDENT_COVER_TIMING" | "UNKNOWN_TIMING";
export type GenericRightsState =
  | "USER_SUPPLIED_PRIVATE" | "OPEN_LICENSE_EXPLICIT" | "PUBLIC_DOMAIN_EXPLICIT"
  | "REUSE_PERMISSION_EXPLICIT" | "UNKNOWN_RIGHTS" | "RESTRICTED_OR_PLATFORM_CONTROLLED"
  | "BENCHMARK_REFERENCE" | "DIAGNOSTIC_ONLY";
export type GenericAccessMode =
  | "DIRECT_FILE_PUBLIC" | "PUBLIC_PAGE_WITH_DOWNLOAD" | "PUBLIC_PAGE_NO_DIRECT_FILE"
  | "LOGIN_REQUIRED" | "PAYWALL_OR_PURCHASE" | "BLOCKED_OR_CAPTCHA" | "SEARCH_RESULT_ONLY" | "UNAVAILABLE";
export type GenericIdentityState = "IDENTITY_EXACT" | "IDENTITY_STRONG" | "IDENTITY_AMBIGUOUS" | "IDENTITY_MISMATCH";
export type GenericVersionState = "VERSION_EXACT" | "VERSION_COMPATIBLE" | "VERSION_CLAIMED" | "VERSION_AMBIGUOUS" | "VERSION_MISMATCH" | "VERSION_UNKNOWN";
export type GenericEligibility =
  | "AUTO_ACQUISITION_ELIGIBLE" | "USER_MEDIATED_CANDIDATE" | "SCORE_ALIGNMENT_REQUIRED"
  | "SEMANTIC_SUPPORT_ONLY" | "RESEARCH_LEAD_ONLY" | "REJECTED";
export type GenericRole = "piano" | "melody" | "harmony" | "bass" | "guitar" | "vocals" | "drums" | "unknown";
export type GenericParseStatus = "parsed" | "metadata-only" | "invalid" | "unsupported" | "unknown";
export type GenericSourceKind = "REMOTE_METADATA" | "LOCAL_SYMBOLIC" | "USER_SUPPLIED";

export interface GenericSongTarget {
  id: string;
  artist: string;
  title: string;
}

export interface GenericSourceCandidateInput {
  candidateId: string;
  sourceRef: string;
  sourceSHA256?: string | null;
  byteLength?: number | null;
  resultTitle: string;
  resultSnippet?: string | null;
  provider: string;
  candidateArtist?: string | null;
  candidateTitle?: string | null;
  apparentFormat?: string | null;
  mediaType?: string | null;
  bodyPrefix?: string | null;
  access?: GenericAccessMode;
  rights?: GenericRightsState;
  timing?: GenericTimingClass;
  evidenceClass?: GenericEvidenceClass;
  identity?: GenericIdentityState;
  version?: GenericVersionState;
  candidateClass?: GenerationCandidateClass;
  sourceKind?: GenericSourceKind;
  sourceOrigin?: "search" | "local" | "remote" | "user";
  parseStatus?: GenericParseStatus;
  roles?: readonly GenericRole[];
  region?: "full" | "section" | "unknown";
  searchRank?: number;
  query?: string | null;
  noteCount?: number | null;
  trackCount?: number | null;
  durationBeats?: number | null;
  tempoBpm?: number | null;
  versionLabel?: string | null;
  candidateVersionQualifiers?: readonly string[];
  userSupplied?: boolean;
  projectOwned?: boolean;
  remoteApproved?: boolean;
}

export interface GenericSourceCandidate {
  schemaVersion: typeof GENERIC_SOURCE_DISCOVERY_SCHEMA_VERSION;
  candidateId: string;
  targetId: string;
  candidateClass: GenerationCandidateClass;
  sourceKind: GenericSourceKind;
  sourceOrigin: "search" | "local" | "remote" | "user";
  sourceRef: string;
  sourceSHA256: string | null;
  byteLength: number | null;
  mediaType: string | null;
  symbolicFormat: "midi" | "musicxml" | "mxl" | "guitar-pro" | "score" | "tab" | "chords" | "audio" | "unknown";
  resultTitle: string;
  resultSnippet: string | null;
  provider: string;
  candidateVersionQualifiers: string[];
  identityConfidence: number;
  versionConfidence: number;
  formatConfidence: number;
  roleConfidence: number;
  identity: GenericIdentityState;
  version: GenericVersionState;
  evidenceClass: GenericEvidenceClass;
  timing: GenericTimingClass;
  rights: GenericRightsState;
  access: GenericAccessMode;
  roles: GenericRole[];
  region: "full" | "section" | "unknown";
  parseStatus: GenericParseStatus;
  userSupplied: boolean;
  projectOwned: boolean;
  remoteApproved: boolean;
  alignmentRequired: boolean;
  generationReady: boolean;
  eligibility: GenericEligibility;
  searchRank: number;
  reasons: string[];
  rankingReasons: string[];
  rankingTier: number;
  metadata: {
    candidateArtist: string | null;
    candidateTitle: string | null;
    query: string | null;
    noteCount: number | null;
    trackCount: number | null;
    durationBeats: number | null;
    tempoBpm: number | null;
    versionLabel: string | null;
  };
}

export interface GenericDiscoveryResult {
  schemaVersion: typeof GENERIC_SOURCE_DISCOVERY_SCHEMA_VERSION;
  candidates: GenericSourceCandidate[];
  automatic: GenericSourceCandidate[];
  bestRelevantCandidateId: string | null;
  bestAutomaticCandidateId: string | null;
}

export interface GenericDiscoverySummary {
  songs: number;
  discoveredSongs: number;
  structuredSongs: number;
  strongStructuredSongs: number;
  automaticSongs: number;
  userMediatedSongs: number;
  scoreAlignmentSongs: number;
  semanticSupportSongs: number;
  rejectedSongs: number;
  candidateCount: number;
}

const STRUCTURED = new Set<GenericEvidenceClass>([
  "STRUCTURED_MIDI", "STRUCTURED_MUSICXML", "STRUCTURED_MXL", "PIANO_SYMBOLIC",
]);
const EVIDENCE_RANK: Record<GenericEvidenceClass, number> = {
  STRUCTURED_MIDI: 0,
  STRUCTURED_MUSICXML: 1,
  STRUCTURED_MXL: 2,
  PIANO_SYMBOLIC: 3,
  STRUCTURED_GUITAR_PRO: 4,
  SCORE_PDF_OR_IMAGE: 5,
  PIANO_COVER_AUDIO_OR_VIDEO: 6,
  TAB: 7,
  CHORDS: 8,
  LYRICS_ONLY: 9,
  GENERIC_AUDIO: 10,
  UNKNOWN: 11,
};
const ELIGIBILITY_RANK: Record<GenericEligibility, number> = {
  AUTO_ACQUISITION_ELIGIBLE: 0,
  USER_MEDIATED_CANDIDATE: 1,
  SCORE_ALIGNMENT_REQUIRED: 2,
  SEMANTIC_SUPPORT_ONLY: 3,
  RESEARCH_LEAD_ONLY: 4,
  REJECTED: 5,
};
const IDENTITY_RANK: Record<GenericIdentityState, number> = {
  IDENTITY_EXACT: 0,
  IDENTITY_STRONG: 1,
  IDENTITY_AMBIGUOUS: 2,
  IDENTITY_MISMATCH: 3,
};
const VERSION_RANK: Record<GenericVersionState, number> = {
  VERSION_EXACT: 0,
  VERSION_COMPATIBLE: 1,
  VERSION_CLAIMED: 2,
  VERSION_AMBIGUOUS: 3,
  VERSION_UNKNOWN: 4,
  VERSION_MISMATCH: 5,
};
const TIMING_RANK: Record<GenericTimingClass, number> = {
  NATIVE_AUTHORITATIVE: 0,
  PERFORMANCE_SYMBOLIC_POTENTIAL: 1,
  SCORE_SYMBOLIC_REQUIRES_ALIGNMENT: 2,
  SEMANTIC_ONLY: 3,
  INDEPENDENT_COVER_TIMING: 4,
  UNKNOWN_TIMING: 5,
};
const RIGHTS_RANK: Record<GenericRightsState, number> = {
  OPEN_LICENSE_EXPLICIT: 0,
  PUBLIC_DOMAIN_EXPLICIT: 1,
  REUSE_PERMISSION_EXPLICIT: 2,
  USER_SUPPLIED_PRIVATE: 3,
  UNKNOWN_RIGHTS: 4,
  RESTRICTED_OR_PLATFORM_CONTROLLED: 5,
  BENCHMARK_REFERENCE: 6,
  DIAGNOSTIC_ONLY: 7,
};
const ACCESS_RANK: Record<GenericAccessMode, number> = {
  DIRECT_FILE_PUBLIC: 0,
  PUBLIC_PAGE_WITH_DOWNLOAD: 1,
  PUBLIC_PAGE_NO_DIRECT_FILE: 2,
  SEARCH_RESULT_ONLY: 3,
  LOGIN_REQUIRED: 4,
  PAYWALL_OR_PURCHASE: 5,
  BLOCKED_OR_CAPTCHA: 6,
  UNAVAILABLE: 7,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function cleanIdentity(value: unknown): string {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finiteOrNull(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : null;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "[redacted-source-ref]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return /^(?:[A-Za-z][A-Za-z0-9+.-]*):[A-Za-z0-9_-]+$/.test(value) ? value : "[redacted-source-ref]";
  }
}

/**
 * Return a path-free HTTP(S) source URL suitable for an owner-facing handoff.
 * Query strings, fragments, credentials, and local/private hosts are never
 * carried into durable metadata. Opaque logical source refs intentionally do
 * not qualify as an "Open source" link.
 */
export function sanitizeGenericExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" ||
    hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "169.254.169.254" ||
    /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) return null;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isHtml(input: GenericSourceCandidateInput): boolean {
  return Boolean(/^text\/html(?:;|$)/i.test(text(input.mediaType)) || /<!doctype\s+html|<html[\s>]/i.test(text(input.bodyPrefix)));
}

function inferEvidence(input: GenericSourceCandidateInput): { evidence: GenericEvidenceClass; format: GenericSourceCandidate["symbolicFormat"] } {
  if (isHtml(input)) return { evidence: "UNKNOWN", format: "unknown" };
  const format = text(input.apparentFormat).toLowerCase();
  const haystack = cleanIdentity(`${input.resultTitle} ${input.candidateTitle ?? ""} ${input.apparentFormat ?? ""}`);
  if (input.evidenceClass) {
    const evidence = input.evidenceClass;
    return { evidence, format: symbolicFormatFor(evidence) };
  }
  if (["mid", "midi", "smf"].includes(format) || /\b(?:midi|\.mid|\.midi)\b/.test(haystack)) return { evidence: "STRUCTURED_MIDI", format: "midi" };
  if (["musicxml", "xml"].includes(format) || /musicxml/.test(haystack)) return { evidence: "STRUCTURED_MUSICXML", format: "musicxml" };
  if (format === "mxl" || /\bmxl\b/.test(haystack)) return { evidence: "STRUCTURED_MXL", format: "mxl" };
  if (["gp", "gpx", "guitar-pro", "guitarpro"].includes(format) || /guitar pro|guitarpro/.test(haystack)) return { evidence: "STRUCTURED_GUITAR_PRO", format: "guitar-pro" };
  if (/\b(?:tab|tabs|tablature)\b/.test(haystack)) return { evidence: "TAB", format: "tab" };
  if (/\bchords?\b/.test(haystack)) return { evidence: "CHORDS", format: "chords" };
  if (/\b(?:sheet|score|pdf|notation)\b/.test(haystack)) return { evidence: "SCORE_PDF_OR_IMAGE", format: "score" };
  if (/\b(?:piano cover|piano tutorial|piano performance|keyboard cover)\b/.test(haystack)) return { evidence: "PIANO_COVER_AUDIO_OR_VIDEO", format: "audio" };
  if (/\b(?:lyrics?|lyric video)\b/.test(haystack)) return { evidence: "LYRICS_ONLY", format: "unknown" };
  if (/\b(?:audio|mp3|wav|video)\b/.test(haystack)) return { evidence: "GENERIC_AUDIO", format: "audio" };
  return { evidence: "UNKNOWN", format: "unknown" };
}

function symbolicFormatFor(evidence: GenericEvidenceClass): GenericSourceCandidate["symbolicFormat"] {
  if (evidence === "STRUCTURED_MIDI") return "midi";
  if (evidence === "STRUCTURED_MUSICXML") return "musicxml";
  if (evidence === "STRUCTURED_MXL") return "mxl";
  if (evidence === "STRUCTURED_GUITAR_PRO") return "guitar-pro";
  if (evidence === "SCORE_PDF_OR_IMAGE") return "score";
  if (evidence === "TAB") return "tab";
  if (evidence === "CHORDS") return "chords";
  if (evidence === "PIANO_COVER_AUDIO_OR_VIDEO" || evidence === "GENERIC_AUDIO") return "audio";
  return "unknown";
}

function inferIdentity(target: GenericSongTarget, input: GenericSourceCandidateInput): GenericIdentityState {
  if (input.identity) return input.identity;
  const targetArtist = cleanIdentity(target.artist);
  const targetTitle = cleanIdentity(target.title);
  const candidateArtist = cleanIdentity(input.candidateArtist);
  const candidateTitle = cleanIdentity(input.candidateTitle);
  const result = cleanIdentity(input.resultTitle);
  const artistPresent = Boolean(targetArtist && (candidateArtist === targetArtist || result.includes(targetArtist)));
  const titlePresent = Boolean(targetTitle && (candidateTitle === targetTitle || result.includes(targetTitle)));
  if (candidateArtist && candidateArtist !== targetArtist) return "IDENTITY_MISMATCH";
  if (!artistPresent && !titlePresent) return "IDENTITY_MISMATCH";
  if (artistPresent && titlePresent) {
    const versionWords = /\b(?:live|remix|acoustic|demo|edit|cover|karaoke|instrumental|arrangement|tutorial)\b/i.test(`${input.resultTitle} ${input.versionLabel ?? ""}`);
    return versionWords ? "IDENTITY_STRONG" : "IDENTITY_EXACT";
  }
  return "IDENTITY_STRONG";
}

function inferVersion(input: GenericSourceCandidateInput, identity: GenericIdentityState): GenericVersionState {
  if (input.version) return input.version;
  if (identity === "IDENTITY_MISMATCH") return "VERSION_MISMATCH";
  const words = cleanIdentity(`${input.resultTitle} ${input.versionLabel ?? ""}`);
  if (/\b(?:live|remix|acoustic|demo|edit|cover|karaoke|instrumental|arrangement|tutorial)\b/.test(words)) return "VERSION_AMBIGUOUS";
  return identity === "IDENTITY_EXACT" ? "VERSION_COMPATIBLE" : "VERSION_UNKNOWN";
}

function versionQualifiers(input: GenericSourceCandidateInput): string[] {
  const known = new Set(["live", "remix", "acoustic", "demo", "edit", "cover", "karaoke", "instrumental", "arrangement", "tutorial", "excerpt", "partial"]);
  const qualifiers = (input.candidateVersionQualifiers ?? []).map((value) => cleanIdentity(value)).filter((value) => known.has(value));
  const haystack = cleanIdentity(`${input.resultTitle} ${input.versionLabel ?? ""}`);
  for (const word of haystack.split(" ")) if (known.has(word)) qualifiers.push(word);
  return [...new Set(qualifiers)].sort(compareText);
}

function identityConfidence(identity: GenericIdentityState): number {
  return identity === "IDENTITY_EXACT" ? 1 : identity === "IDENTITY_STRONG" ? 0.8 : identity === "IDENTITY_AMBIGUOUS" ? 0.4 : 0;
}

function versionConfidence(version: GenericVersionState): number {
  return version === "VERSION_EXACT" ? 1 : version === "VERSION_COMPATIBLE" ? 0.85 : version === "VERSION_CLAIMED" ? 0.65 : version === "VERSION_AMBIGUOUS" ? 0.35 : 0;
}

function inferRoles(input: GenericSourceCandidateInput, evidence: GenericEvidenceClass): GenericRole[] {
  const supplied = [...new Set((input.roles ?? []).filter((role): role is GenericRole => ["piano", "melody", "harmony", "bass", "guitar", "vocals", "drums", "unknown"].includes(role)))];
  if (supplied.length) return supplied.sort(compareText);
  if (evidence === "TAB" || evidence === "STRUCTURED_GUITAR_PRO") return ["guitar"];
  if (evidence === "PIANO_SYMBOLIC" || evidence === "PIANO_COVER_AUDIO_OR_VIDEO") return ["piano", "melody"];
  return ["unknown"];
}

function inferTiming(input: GenericSourceCandidateInput, evidence: GenericEvidenceClass): GenericTimingClass {
  if (input.timing) return input.timing;
  if (evidence === "TAB" || evidence === "CHORDS" || evidence === "LYRICS_ONLY") return "SEMANTIC_ONLY";
  if (evidence === "PIANO_COVER_AUDIO_OR_VIDEO") return "INDEPENDENT_COVER_TIMING";
  if (STRUCTURED.has(evidence)) return "UNKNOWN_TIMING";
  return "UNKNOWN_TIMING";
}

function inferRights(input: GenericSourceCandidateInput): GenericRightsState {
  return input.rights ?? (input.sourceKind === "LOCAL_SYMBOLIC" || input.sourceKind === "USER_SUPPLIED" ? "USER_SUPPLIED_PRIVATE" : "UNKNOWN_RIGHTS");
}

function inferAccess(input: GenericSourceCandidateInput): GenericAccessMode {
  return input.access ?? (input.sourceOrigin === "search" ? "SEARCH_RESULT_ONLY" : "UNAVAILABLE");
}

function classifyEligibility(candidate: Omit<GenericSourceCandidate, "eligibility" | "generationReady" | "reasons" | "rankingReasons" | "rankingTier"> & { html: boolean }): { eligibility: GenericEligibility; generationReady: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (candidate.html) return { eligibility: "REJECTED", generationReady: false, reasons: ["HTML/error content is not symbolic"] };
  if (candidate.candidateClass !== "GENERATION_CANDIDATE") return { eligibility: "REJECTED", generationReady: false, reasons: [`candidate class ${candidate.candidateClass} is firewall-protected`] };
  if (candidate.rights === "BENCHMARK_REFERENCE" || candidate.rights === "DIAGNOSTIC_ONLY") return { eligibility: "REJECTED", generationReady: false, reasons: [`rights state ${candidate.rights} is not generation input`] };
  if (candidate.identity === "IDENTITY_MISMATCH" || candidate.version === "VERSION_MISMATCH") return { eligibility: "REJECTED", generationReady: false, reasons: ["identity or version mismatch"] };
  if (["TAB", "CHORDS", "LYRICS_ONLY"].includes(candidate.evidenceClass)) return { eligibility: "SEMANTIC_SUPPORT_ONLY", generationReady: false, reasons: ["semantic evidence is not a structured generation source"] };
  if (candidate.evidenceClass === "STRUCTURED_GUITAR_PRO") return { eligibility: "RESEARCH_LEAD_ONLY", generationReady: false, reasons: ["Guitar Pro is outside the bounded intake formats"] };
  if (!STRUCTURED.has(candidate.evidenceClass)) return { eligibility: "RESEARCH_LEAD_ONLY", generationReady: false, reasons: ["no supported structured symbolic evidence"] };
  if (candidate.parseStatus === "invalid" || candidate.parseStatus === "unsupported") return { eligibility: "REJECTED", generationReady: false, reasons: ["candidate parser status is not usable"] };
  if (candidate.parseStatus !== "parsed") return { eligibility: "USER_MEDIATED_CANDIDATE", generationReady: false, reasons: ["candidate bytes have not been parsed"] };
  if (candidate.identity === "IDENTITY_AMBIGUOUS") return { eligibility: "RESEARCH_LEAD_ONLY", generationReady: false, reasons: ["identity is ambiguous"] };
  const localPrivate = (candidate.sourceKind === "LOCAL_SYMBOLIC" || candidate.sourceKind === "USER_SUPPLIED") && candidate.rights === "USER_SUPPLIED_PRIVATE";
  const rightsExplicit = localPrivate || ["OPEN_LICENSE_EXPLICIT", "PUBLIC_DOMAIN_EXPLICIT", "REUSE_PERMISSION_EXPLICIT"].includes(candidate.rights);
  if (!candidate.remoteApproved && !localPrivate) return { eligibility: "USER_MEDIATED_CANDIDATE", generationReady: false, reasons: ["remote source is not explicitly approved"] };
  const direct = candidate.access === "DIRECT_FILE_PUBLIC" || candidate.access === "PUBLIC_PAGE_WITH_DOWNLOAD";
  if (!rightsExplicit || !direct) {
    reasons.push(!rightsExplicit ? "rights are not explicit" : "public direct acquisition is unavailable");
    return { eligibility: "USER_MEDIATED_CANDIDATE", generationReady: false, reasons };
  }
  if (candidate.timing === "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT") return { eligibility: "SCORE_ALIGNMENT_REQUIRED", generationReady: false, reasons: ["score timing requires independent alignment"] };
  if (candidate.timing !== "NATIVE_AUTHORITATIVE") return { eligibility: "USER_MEDIATED_CANDIDATE", generationReady: false, reasons: ["timing authority is not native"] };
  return { eligibility: "AUTO_ACQUISITION_ELIGIBLE", generationReady: true, reasons: ["supported structured source with explicit rights and native timing"] };
}

function normalizeCandidate(target: GenericSongTarget, input: GenericSourceCandidateInput): GenericSourceCandidate {
  const { evidence, format } = inferEvidence(input);
  const identity = inferIdentity(target, input);
  const candidateClass = input.candidateClass ?? "GENERATION_CANDIDATE";
  const sourceKind = input.sourceKind ?? "REMOTE_METADATA";
  const sourceOrigin = input.sourceOrigin ?? (sourceKind === "LOCAL_SYMBOLIC" ? "local" : "search");
  const parseStatus = isHtml(input) ? "invalid" : input.parseStatus ?? "metadata-only";
  const version = inferVersion(input, identity);
  const timing = inferTiming(input, evidence);
  const rights = inferRights(input);
  const access = inferAccess(input);
  const roles = inferRoles(input, evidence);
  const base = {
    schemaVersion: GENERIC_SOURCE_DISCOVERY_SCHEMA_VERSION,
    candidateId: text(input.candidateId) || "candidate",
    targetId: target.id,
    candidateClass,
    sourceKind,
    sourceOrigin,
    sourceRef: safeUrl(text(input.sourceRef)),
    sourceSHA256: /^[a-f0-9]{64}$/i.test(text(input.sourceSHA256)) ? text(input.sourceSHA256).toLowerCase() : null,
    byteLength: finiteOrNull(input.byteLength),
    mediaType: text(input.mediaType) || (format === "midi" ? "audio/midi" : format === "musicxml" ? "application/vnd.recordare.musicxml+xml" : format === "mxl" ? "application/vnd.recordare.musicxml" : null),
    symbolicFormat: format,
    resultTitle: /(?:^|[\\/])Users(?:[\\/])|(?:^|[\\/])private(?:[\\/])/i.test(text(input.resultTitle)) ? "[redacted]" : text(input.resultTitle),
    resultSnippet: text(input.resultSnippet) || null,
    provider: text(input.provider) || "unknown",
    candidateVersionQualifiers: versionQualifiers(input),
    identityConfidence: identityConfidence(identity),
    versionConfidence: versionConfidence(version),
    formatConfidence: input.evidenceClass ? 1 : evidence === "UNKNOWN" ? 0 : 0.8,
    roleConfidence: input.roles?.length ? 1 : evidence === "UNKNOWN" ? 0.1 : 0.5,
    identity,
    version,
    evidenceClass: evidence,
    timing,
    rights,
    access,
    roles,
    region: input.region ?? "unknown",
    parseStatus: parseStatus as GenericParseStatus,
    userSupplied: input.userSupplied ?? (sourceKind === "USER_SUPPLIED" || sourceKind === "LOCAL_SYMBOLIC"),
    projectOwned: input.projectOwned ?? false,
    remoteApproved: input.remoteApproved ?? (rights === "OPEN_LICENSE_EXPLICIT" || rights === "PUBLIC_DOMAIN_EXPLICIT" || rights === "REUSE_PERMISSION_EXPLICIT"),
    alignmentRequired: timing === "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT",
    searchRank: Number.isFinite(input.searchRank) && (input.searchRank ?? 0) >= 0 ? Math.floor(input.searchRank!) : 999,
    metadata: {
      candidateArtist: text(input.candidateArtist) || null,
      candidateTitle: text(input.candidateTitle) || null,
      query: text(input.query) || null,
      noteCount: finiteOrNull(input.noteCount),
      trackCount: finiteOrNull(input.trackCount),
      durationBeats: finiteOrNull(input.durationBeats),
      tempoBpm: finiteOrNull(input.tempoBpm),
      versionLabel: text(input.versionLabel) || null,
    },
  };
  const decision = classifyEligibility({ ...base, html: isHtml(input) });
  return { ...base, eligibility: decision.eligibility, generationReady: decision.generationReady, reasons: decision.reasons, rankingReasons: decision.reasons, rankingTier: ELIGIBILITY_RANK[decision.eligibility] };
}

function relevanceVector(candidate: GenericSourceCandidate): readonly (number | string)[] {
  // Relevance answers "which result most deserves investigation?" and keeps
  // provider rank ahead of rights/access. Acquisition ranking below remains
  // strict about eligibility, provenance, and directness.
  return [IDENTITY_RANK[candidate.identity], VERSION_RANK[candidate.version], EVIDENCE_RANK[candidate.evidenceClass], candidate.roles.includes("melody") || candidate.roles.includes("piano") ? 0 : 1, TIMING_RANK[candidate.timing], candidate.searchRank, RIGHTS_RANK[candidate.rights], ACCESS_RANK[candidate.access], candidate.sourceRef, candidate.candidateId];
}

function rankingVector(candidate: GenericSourceCandidate): readonly (number | string)[] {
  return [ELIGIBILITY_RANK[candidate.eligibility], IDENTITY_RANK[candidate.identity], VERSION_RANK[candidate.version], EVIDENCE_RANK[candidate.evidenceClass], candidate.roles.includes("melody") || candidate.roles.includes("piano") ? 0 : 1, TIMING_RANK[candidate.timing], RIGHTS_RANK[candidate.rights], ACCESS_RANK[candidate.access], candidate.searchRank, candidate.sourceRef, candidate.candidateId];
}

function compareVector(left: readonly (number | string)[], right: readonly (number | string)[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
    const comparison = compareText(String(a ?? ""), String(b ?? ""));
    if (comparison) return comparison;
  }
  return 0;
}

export function classifyGenericSourceCandidate(target: GenericSongTarget, input: GenericSourceCandidateInput): GenericSourceCandidate {
  return normalizeCandidate(target, input);
}

export function rankGenericSourceCandidates(target: GenericSongTarget, inputs: readonly GenericSourceCandidateInput[]): GenericDiscoveryResult {
  const unique = new Map<string, GenericSourceCandidate>();
  for (const input of inputs) {
    const candidate = normalizeCandidate(target, input);
    const previous = unique.get(candidate.candidateId);
    if (!previous || compareVector(relevanceVector(candidate), relevanceVector(previous)) < 0) unique.set(candidate.candidateId, candidate);
  }
  const candidates = [...unique.values()].sort((left, right) => compareVector(rankingVector(left), rankingVector(right)));
  const automatic = candidates.filter((candidate) => candidate.eligibility === "AUTO_ACQUISITION_ELIGIBLE");
  const relevance = [...candidates].sort((left, right) => compareVector(relevanceVector(left), relevanceVector(right)));
  return {
    schemaVersion: GENERIC_SOURCE_DISCOVERY_SCHEMA_VERSION,
    candidates,
    automatic,
    bestRelevantCandidateId: relevance[0]?.candidateId ?? null,
    bestAutomaticCandidateId: automatic[0]?.candidateId ?? null,
  };
}

export function summarizeGenericDiscovery(items: readonly { target: GenericSongTarget; result: GenericDiscoveryResult }[]): GenericDiscoverySummary {
  const rows = items.map(({ target, result }) => ({ target, result, candidates: result.candidates }));
  const count = (predicate: (candidate: GenericSourceCandidate) => boolean) => new Set(rows.flatMap(({ target, candidates }) => candidates.some(predicate) ? [target.id] : [])).size;
  const structured = (candidate: GenericSourceCandidate) => STRUCTURED.has(candidate.evidenceClass) && candidate.identity !== "IDENTITY_MISMATCH" && candidate.parseStatus !== "invalid" && candidate.parseStatus !== "unsupported";
  return {
    songs: new Set(rows.map(({ target }) => target.id)).size,
    discoveredSongs: count(() => true),
    structuredSongs: count(structured),
    strongStructuredSongs: count((candidate) => structured(candidate) && ["IDENTITY_EXACT", "IDENTITY_STRONG"].includes(candidate.identity)),
    automaticSongs: count((candidate) => candidate.eligibility === "AUTO_ACQUISITION_ELIGIBLE"),
    userMediatedSongs: count((candidate) => candidate.eligibility === "USER_MEDIATED_CANDIDATE"),
    scoreAlignmentSongs: count((candidate) => candidate.eligibility === "SCORE_ALIGNMENT_REQUIRED"),
    semanticSupportSongs: count((candidate) => candidate.eligibility === "SEMANTIC_SUPPORT_ONLY"),
    rejectedSongs: count((candidate) => candidate.eligibility === "REJECTED"),
    candidateCount: rows.reduce((sum, row) => sum + row.candidates.length, 0),
  };
}

function sanitize(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (/(?:password|token|secret|credential|authorization)/i.test(key)) return undefined;
    if (/(?:path|filename|filepath|sourcepath|localpath)/i.test(key) || /(?:^|[\\/])(?:Users|private|tmp|var|home)[\\/]/i.test(value)) return "[redacted-path]";
    if (/^(?:https?|ftp):\/\//i.test(value) && /(?:source|url|uri|ref)/i.test(key)) return safeUrl(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === "object") {
    const object: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right))) {
      const sanitized = sanitize(childValue, childKey);
      if (sanitized !== undefined) object[childKey] = sanitized;
    }
    return object;
  }
  return value;
}

export function canonicalGenericDiscoveryJson(value: unknown): string {
  return JSON.stringify(sanitize(value)) + "\n";
}

export function genericDiscoveryDigest(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalGenericDiscoveryJson(value)));
}
