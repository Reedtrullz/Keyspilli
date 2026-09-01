import { createHash } from "node:crypto";
import { adaptNativeSymbolicBytes, adaptNativeSymbolicFile, type NativeSymbolicAdapterResult } from "./native-score-adapter.js";
import { assertGenerationEvidence, type EvidenceClass, type EvidencePurpose, type EvidenceRole, type ExternalEvidenceCandidate } from "./external-evidence.js";
import { createSongIdentity, type SongIdentity, type SongIdentityInput } from "./song-research.js";
import type { CanonicalScore } from "./omr-canonical.js";
import type { OmrEventInput, OmrPartInput, OmrRole, OmrScoreInput } from "./omr-consensus.js";

export const EXTERNAL_RESEARCH_SCHEMA_VERSION = 1 as const;

export type ExternalResearchParserStatus = "not-attempted" | "parsed" | "unsupported" | "invalid";
export type ExternalResearchAcquisitionStatus = "not-supplied" | "local-bytes" | "local-file" | "rejected";
export type ExternalResearchAlignmentStatus = "not-attempted" | "aligned" | "partial" | "ambiguous" | "unavailable" | "rejected";
/** Identity is intentionally conservative: parsing alone never verifies a song edition. */
export type ExternalResearchIdentityStatus = "EXACT_VERSION" | "LIKELY_VERSION" | "PARTIAL_ARRANGEMENT" | "COVER_VERSION" | "DIFFERENT_VERSION" | "UNKNOWN";
export type ExternalResearchVersionStatus = "EXACT" | "CLAIMED" | "AMBIGUOUS" | "UNKNOWN";

export interface ExternalResearchDiscoveryRecord {
  id?: string | null;
  title?: string | null;
  provider?: string | null;
  artist?: string | null;
  version?: string | null;
  durationSeconds?: number | null;
  sourceRef?: string | null;
  sourcePage?: string | null;
  url?: string | null;
  format?: string | null;
  purpose?: EvidencePurpose;
  evidenceClass?: EvidenceClass;
  metadata?: Record<string, unknown>;
}

export interface ExternalResearchLocalInput {
  id?: string | null;
  bytes?: Uint8Array | ArrayBuffer;
  /** Alias accepted for callers that use `filePath` terminology. */
  filePath?: string | null;
  localFilePath?: string | null;
  path?: string | null;
  format?: string | null;
  artifactType?: string | null;
  title?: string | null;
  provider?: string | null;
  artist?: string | null;
  version?: string | null;
  durationSeconds?: number | null;
  sourceRef?: string | null;
  sourcePage?: string | null;
  purpose?: EvidencePurpose;
  evidenceClass?: EvidenceClass;
  /** Explicit target-recording alignment evidence supplied by a trusted local aligner. */
  alignment?: {
    status?: ExternalResearchAlignmentStatus;
    reason?: string | null;
  };
}

export interface ExternalRoleDiagnostic {
  partId: string;
  partName: string | null;
  role: EvidenceRole;
  confidence: number;
  certainty: "certain" | "uncertain" | "ambiguous";
  signals: string[];
  eventCount: number;
  pitchRange: [number, number] | null;
  monophonic: boolean | null;
  density: number | null;
  percussion: boolean;
  timingOnly: boolean;
  alternatives: EvidenceRole[];
}

export interface ExternalResearchParserMetadata {
  status: ExternalResearchParserStatus;
  format: string | null;
  adapter: string | null;
  warnings: string[];
  error: string | null;
}

export interface ExternalResearchRecord {
  id: string;
  songId: string;
  title: string | null;
  provider: string | null;
  evidenceClass: EvidenceClass;
  purpose: EvidencePurpose;
  identityStatus: ExternalResearchIdentityStatus;
  versionStatus: ExternalResearchVersionStatus;
  identityReasons: string[];
  discovery: {
    status: "metadata-only" | "local-supplied";
    sourceRef: string | null;
    sourcePage: string | null;
  };
  acquisition: {
    status: ExternalResearchAcquisitionStatus;
    method: "local-bytes" | "local-file" | null;
  };
  content: {
    sha256: string | null;
    byteLength: number | null;
    mediaType: string | null;
  };
  parser: ExternalResearchParserMetadata;
  roles: ExternalRoleDiagnostic[];
  alignment: {
    status: ExternalResearchAlignmentStatus;
    reason: string | null;
  };
  generationUsable: boolean;
  rejectionReasons: string[];
  candidate: ExternalEvidenceCandidate | null;
  /** Normalized score/canonical are available to local callers, not JSON summaries. */
  score: OmrScoreInput | null;
  canonical: CanonicalScore | null;
}

export interface ExternalResearchInventory {
  schemaVersion: typeof EXTERNAL_RESEARCH_SCHEMA_VERSION;
  song: SongIdentity;
  records: ExternalResearchRecord[];
  discoveryErrors: string[];
}

export interface ExternalSymbolicCandidateInput extends ExternalResearchLocalInput {
  id?: string | null;
}

export interface ExternalSymbolicIngestionResult {
  status: ExternalResearchParserStatus;
  format: string | null;
  candidate: ExternalEvidenceCandidate | null;
  score: OmrScoreInput | null;
  /** Alias for consumers that distinguish normalized from source score. */
  normalizedScore: OmrScoreInput | null;
  identityStatus?: ExternalResearchIdentityStatus;
  versionStatus?: ExternalResearchVersionStatus;
  identityReasons?: string[];
  canonical: CanonicalScore | null;
  provenance: NativeSymbolicAdapterResult["provenance"] | null;
  roles: ExternalRoleDiagnostic[];
  warnings: string[];
  rejectionReasons: string[];
  error: string | null;
}

export interface ExternalResearchOptions {
  discoveryRecords?: readonly ExternalResearchDiscoveryRecord[];
  /** Alias for discoveryRecords used by older research callers. */
  discovery?: readonly ExternalResearchDiscoveryRecord[];
  discoveryCandidates?: readonly ExternalResearchDiscoveryRecord[];
  localInputs?: readonly ExternalResearchLocalInput[];
  /** Alias for localInputs. */
  localCandidates?: readonly ExternalResearchLocalInput[];
  localByteInputs?: readonly ExternalResearchLocalInput[];
  discoveryErrors?: readonly string[];
}

const NATIVE_FORMATS = new Set(["midi", "mid", "musicxml", "xml", "mxl", "mscz"]);
const ALIGNMENT_STATUSES = new Set<ExternalResearchAlignmentStatus>(["not-attempted", "aligned", "partial", "ambiguous", "unavailable", "rejected"]);
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  midi: "audio/midi",
  mid: "audio/midi",
  musicxml: "application/vnd.recordare.musicxml+xml",
  xml: "application/vnd.recordare.musicxml+xml",
  mxl: "application/vnd.recordare.musicxml",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  return clean || fallback;
}

function identityText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

interface ExternalIdentityAssessment {
  identityStatus: ExternalResearchIdentityStatus;
  versionStatus: ExternalResearchVersionStatus;
  identityReasons: string[];
}

function assessExternalIdentity(
  song: SongIdentity,
  input: Pick<ExternalResearchLocalInput | ExternalResearchDiscoveryRecord, "title" | "artist" | "version" | "durationSeconds">,
  score: OmrScoreInput | null,
): ExternalIdentityAssessment {
  const sourceText = identityText([input.title, input.artist, score?.title].filter(Boolean).join(" "));
  const title = identityText(song.title);
  const artist = identityText(song.artist);
  const titleMatch = Boolean(title && sourceText.includes(title));
  const artistMatch = Boolean(artist && sourceText.includes(artist));
  const sourceVersion = identityText(input.version);
  const targetVersion = identityText(song.version);
  const cover = /\b(?:cover|piano|tutorial|synthesia|arrangement)\b/.test(sourceText);
  const partial = typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
    && typeof song.durationSeconds === "number" && Number.isFinite(song.durationSeconds)
    && input.durationSeconds > 0 && song.durationSeconds > 0 && input.durationSeconds < song.durationSeconds * 0.8;
  const reasons: string[] = [];
  if (titleMatch) reasons.push("title matches target identity");
  if (artistMatch) reasons.push("artist matches target identity");
  if (cover) reasons.push("cover/arrangement metadata indicates a derived version");
  if (partial) reasons.push("source duration indicates partial arrangement");
  let versionStatus: ExternalResearchVersionStatus = "UNKNOWN";
  if (sourceVersion && targetVersion && sourceVersion === targetVersion) versionStatus = "EXACT";
  else if (sourceVersion) versionStatus = "CLAIMED";
  else if (/\b(?:live|remix|edit|acoustic|instrumental|cover|arrangement|version)\b/.test(sourceText)) versionStatus = "AMBIGUOUS";
  let identityStatus: ExternalResearchIdentityStatus = "UNKNOWN";
  if (partial) identityStatus = "PARTIAL_ARRANGEMENT";
  else if (cover) identityStatus = "COVER_VERSION";
  else if (titleMatch && artistMatch && versionStatus === "EXACT") identityStatus = "EXACT_VERSION";
  else if (titleMatch && (artistMatch || !artist)) identityStatus = "LIKELY_VERSION";
  else if (sourceText && !titleMatch && /\b(?:different|alternate|other)\b/.test(sourceText)) identityStatus = "DIFFERENT_VERSION";
  return { identityStatus, versionStatus, identityReasons: reasons.length ? reasons : ["insufficient identity metadata"] };
}

function hasSensitiveLogicalRef(value: string): boolean {
  const trimmed = value.trim();
  if (/[?#]/.test(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return true;
  } catch {
    // Opaque provider schemes are checked by the credential-shaped fallback.
  }
  return /(?:^|\/\/)[^/\s:@]+(?::[^/\s@]*)?@/i.test(trimmed);
}

function logicalRef(value: unknown): string | null {
  const clean = text(value);
  if (!clean || /^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(clean)
    || /(?:^|[\\/])[^\\/]+\.(?:mid|midi|musicxml|xml|mxl|mscz|wav|mp3)$/i.test(clean)) return null;
  // HTTP(S) references are useful logical labels, but retain only their
  // public origin/path.  Opaque logical refs carrying locator data are
  // rejected so signed tokens cannot become candidate provenance.
  if (/^https?:\/\//i.test(clean)) return safePage(clean);
  if (hasSensitiveLogicalRef(clean)) return null;
  return clean;
}

function safePage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeFormat(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/^\./, "") : "";
  return normalized || null;
}

function alignmentFromInput(input: ExternalResearchLocalInput): { status: ExternalResearchAlignmentStatus; reason: string | null; valid: boolean } {
  const supplied = input.alignment;
  if (supplied === undefined) return { status: "not-attempted", reason: "target alignment is required before generation", valid: true };
  const status = supplied && typeof supplied === "object" && ALIGNMENT_STATUSES.has(supplied.status as ExternalResearchAlignmentStatus)
    ? supplied.status as ExternalResearchAlignmentStatus
    : "rejected";
  const reason = typeof supplied?.reason === "string" ? text(supplied.reason) : supplied?.reason === null ? null : status === "rejected" ? "invalid alignment evidence" : null;
  return { status, reason, valid: status !== "rejected" || Boolean(supplied?.status === "rejected") };
}

function stableId(value: unknown, fallback: string): string {
  const clean = text(value);
  if (!clean || /^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(clean)) return fallback;
  return clean.replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || fallback;
}

function hashBytes(input: Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(input instanceof Uint8Array ? input : new Uint8Array(input)).digest("hex");
}

function errorText(error: unknown): string {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "external symbolic ingestion failed";
  return redactPhysicalText(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || "external symbolic ingestion failed";
}

/** Redact physical locators while preserving logical refs and HTTP(S) URLs. */
function redactPhysicalText(value: string): string {
  if (/^https?:\/\//i.test(value.trim())) return value;
  const physical = /(?:file:\/\/[^\s,;)}\]]+|\\\\[^\s,;)}\]]+|(?<![A-Za-z0-9:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?:Users|private|tmp|var|home|Volumes|workspace|opt|root|srv|etc|mnt|data)(?:[\\/]|$))[^\s,;)}\]]*|(?<![A-Za-z0-9:/])\/(?=[^\s,;)}\]]*\/)[^\s,;)}\]]+\.(?:mid|midi|musicxml|mxl|mscz|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?|(?<![A-Za-z0-9:/])\/(?=[^\s,;)}\]]*\/)[^\s,;)}\]]+)/gi;
  return value.replace(physical, "[redacted-path]");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(0.9, Math.round(value * 1000) / 1000));
}

function partEvents(part: OmrPartInput): OmrEventInput[] {
  const events = (part.measures ?? []).flatMap((measure) => {
    const direct = Array.isArray(measure.events) ? measure.events : [];
    const staves = (measure.staves ?? []).flatMap((staff) => [
      ...(staff.events ?? []),
      ...(staff.voices ?? []).flatMap((voice) => voice.events ?? []),
    ]);
    const voices = (measure.voices ?? []).flatMap((voice) => voice.events ?? []);
    return direct.length ? direct : [...staves, ...voices];
  });
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.onset, event.duration, event.pitch, event.staff ?? "", event.voice ?? "", event.role ?? ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nameSignal(name: string): { role: EvidenceRole; signal: string } | null {
  const value = name.toLowerCase();
  if (/drum|percussion|kit|beat/.test(value)) return { role: "timing-only", signal: "percussion metadata" };
  if (/melody|lead|vocal|voice|solo|soprano|treble|right hand/.test(value)) return { role: "melody", signal: "melody metadata" };
  if (/bass|low|lower|bass root/.test(value)) return { role: "bass-root", signal: "bass/register metadata" };
  if (/harmony|chord|accomp|piano|strings|pad|left hand/.test(value)) return { role: "harmony", signal: "harmony metadata" };
  return null;
}

function monophonic(events: readonly OmrEventInput[]): boolean | null {
  if (!events.length) return null;
  const ordered = [...events].sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.onset < ordered[index - 1]!.onset + ordered[index - 1]!.duration - 1e-6) return false;
  }
  return true;
}

/** Produce role evidence without ever upgrading metadata to certainty. */
export function classifyExternalRoles(score: OmrScoreInput): ExternalRoleDiagnostic[] {
  const parts = Array.isArray(score.parts) ? score.parts : [];
  return parts.map((part, index) => {
    const events = partEvents(part).filter((event) => Number.isFinite(event.pitch) && Number.isFinite(event.onset) && Number.isFinite(event.duration));
    const pitches = events.map((event) => event.pitch).sort((a, b) => a - b);
    const minPitch = pitches[0] ?? null;
    const maxPitch = pitches.at(-1) ?? null;
    const average = pitches.length ? pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length : null;
    const totalDuration = part.measures.reduce((sum, measure) => sum + (Number.isFinite(measure.durationBeats) ? measure.durationBeats! : 0), 0);
    const density = totalDuration > 0 ? Math.round((events.length / totalDuration) * 1000) / 1000 : null;
    const named = nameSignal(part.name ?? "");
    const metadata = isRecord(score.metadata) ? score.metadata : {};
    const metadataPercussion = Array.isArray(metadata.trackNames) && metadata.trackNames.some((item) => typeof item === "string" && /drum|percussion/i.test(item) && (part.name === item || part.id.includes(String(index + 1))));
    const percussion = Boolean(named?.role === "timing-only" || metadataPercussion || (!events.length && /drum|percussion|kit/i.test(part.name ?? "")));
    let role: EvidenceRole = "timing-only";
    const signals: string[] = [];
    if (percussion) {
      role = "timing-only";
      signals.push(named?.signal ?? "percussion evidence");
    } else if (named) {
      role = named.role;
      signals.push(named.signal);
    } else if (!events.length) {
      role = "timing-only";
      signals.push("no pitched events");
    } else if (average !== null && average < 57 && maxPitch !== null && maxPitch < 67) {
      role = "bass-root";
      signals.push("low register");
    } else if (monophonic(events) === true && (average ?? 0) >= 60) {
      role = "melody";
      signals.push("monophonic upper register");
    } else {
      role = "harmony";
      signals.push("polyphonic or mixed register");
    }
    if (monophonic(events) === true) signals.push("monophonic evidence");
    if (density !== null) signals.push(`density:${density}`);
    if (minPitch !== null && maxPitch !== null) signals.push(`register:${minPitch}-${maxPitch}`);
    const alternatives: EvidenceRole[] = role === "timing-only" ? ["rhythm"] : role === "melody" ? ["harmony"] : role === "bass-root" ? ["harmony"] : ["melody", "bass-root"];
    const confidence = clamp((named || events.length ? 0.72 : 0.35) + (monophonic(events) === true ? 0.08 : 0) + (percussion ? 0.04 : 0));
    return {
      partId: text(part.id, `part-${index + 1}`)!,
      partName: text(part.name),
      role,
      confidence,
      certainty: named || events.length ? "uncertain" : "ambiguous",
      signals: [...new Set(signals)].sort(),
      eventCount: events.length,
      pitchRange: minPitch === null || maxPitch === null ? null : [minPitch, maxPitch],
      monophonic: monophonic(events),
      density,
      percussion,
      timingOnly: role === "timing-only",
      alternatives,
    };
  });
}

function candidateClass(input: ExternalSymbolicCandidateInput, format: string): EvidenceClass {
  return input.evidenceClass ?? (format === "midi" || format === "musicxml" || format === "mxl" ? "VERIFIED_NATIVE_SYMBOLIC" : "PIANO_COVER_SYMBOLIC");
}

function candidatePurpose(input: ExternalSymbolicCandidateInput): EvidencePurpose {
  return input.purpose ?? "RESEARCH_LEAD";
}

function buildCandidate(input: ExternalSymbolicCandidateInput, format: string, result: Extract<NativeSymbolicAdapterResult, { status: "parsed" }>, roles: ExternalRoleDiagnostic[]): { candidate: ExternalEvidenceCandidate | null; rejectionReasons: string[] } {
  const hash = result.provenance.sha256.toLowerCase();
  const sourceRef = logicalRef(input.sourceRef) ?? `external:${hash.slice(0, 24)}`;
  const purpose = candidatePurpose(input);
  const candidate: ExternalEvidenceCandidate = {
    id: stableId(input.id, `external:${hash.slice(0, 24)}`),
    evidenceClass: candidateClass(input, format),
    purpose,
    provenance: {
      sourceRef,
      ...(text(input.provider) ? { provider: text(input.provider)! } : {}),
      acquiredVia: result.provenance.accessMethod,
      ...(safePage(input.sourcePage) ? { sourcePage: safePage(input.sourcePage)! } : {}),
    },
    content: { sha256: hash, byteLength: result.provenance.bytes, ...(MEDIA_TYPES[format] ? { mediaType: MEDIA_TYPES[format] } : {}) },
    confidence: { parse: 0.9, identity: 0.5, role: roles.length ? Math.max(...roles.map((role) => role.confidence)) : 0 },
    roles: roles.map(({ role, confidence, signals }) => ({ role, confidence, signals })),
    status: "parsed",
  };
  try {
    return { candidate: assertGenerationEvidence(candidate), rejectionReasons: [] };
  } catch (error) {
    return { candidate: null, rejectionReasons: [errorText(error)] };
  }
}

function safeResultProvenance(provenance: NativeSymbolicAdapterResult["provenance"], input: ExternalSymbolicCandidateInput): NativeSymbolicAdapterResult["provenance"] {
  return {
    ...provenance,
    sourceRef: logicalRef(input.sourceRef) ?? `external:${provenance.sha256.slice(0, 24)}`,
    rootFile: null,
  };
}

/** Ingest only explicitly provided local symbolic bytes/files through the native adapter. */
export async function ingestExternalSymbolicCandidate(input: ExternalSymbolicCandidateInput): Promise<ExternalSymbolicIngestionResult> {
  const bytes = input.bytes;
  const path = text(input.filePath ?? input.localFilePath ?? input.path);
  const formatInput = normalizeFormat(input.format ?? input.artifactType);
  const rejectionReasons: string[] = [];
  if (bytes !== undefined && path) {
    return { status: "invalid", format: formatInput, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: null, roles: [], warnings: [], rejectionReasons: ["provide either local bytes or a local file, not both"], error: "ambiguous local input" };
  }
  if (bytes !== undefined && !(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer)) {
    return { status: "invalid", format: formatInput, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: null, roles: [], warnings: [], rejectionReasons: ["local bytes must be a Uint8Array or ArrayBuffer"], error: "invalid local bytes" };
  }
  if (bytes === undefined && !path) {
    return { status: "not-attempted", format: formatInput, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: null, roles: [], warnings: [], rejectionReasons: ["explicit local bytes or absolute local file are required"], error: "no local input supplied" };
  }
  if (!path && (!formatInput || !NATIVE_FORMATS.has(formatInput))) {
    return { status: "unsupported", format: formatInput, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: null, roles: [], warnings: [], rejectionReasons: [`unsupported symbolic format: ${formatInput ?? "unknown"}`], error: `unsupported symbolic format: ${formatInput ?? "unknown"}` };
  }
  let result: NativeSymbolicAdapterResult;
  try {
    result = path
      ? await adaptNativeSymbolicFile(path, { sourceRef: logicalRef(input.sourceRef) ?? undefined, sourcePage: input.sourcePage ?? undefined })
      : adaptNativeSymbolicBytes(bytes!, formatInput!, { sourceRef: logicalRef(input.sourceRef) ?? undefined, sourcePage: input.sourcePage ?? undefined });
  } catch (error) {
    const message = errorText(error);
    return { status: "invalid", format: formatInput, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: null, roles: [], warnings: [], rejectionReasons: [message], error: message };
  }
  const format = result.format;
  if (result.status !== "parsed") {
    const reasons = [result.status === "unsupported" ? result.reason : result.error];
    return { status: result.status, format, candidate: null, score: null, normalizedScore: null, canonical: null, provenance: safeResultProvenance(result.provenance, input), roles: [], warnings: result.warnings, rejectionReasons: reasons, error: result.status === "invalid" ? result.error : result.reason };
  }
  const roles = classifyExternalRoles(result.score);
  const built = buildCandidate(input, format, result, roles);
  const provenance = safeResultProvenance(result.provenance, input);
  return {
    status: "parsed",
    format,
    candidate: built.candidate,
    score: result.score,
    normalizedScore: result.score,
    canonical: result.canonical,
    provenance,
    roles,
    warnings: result.warnings,
    rejectionReasons: built.rejectionReasons,
    error: built.rejectionReasons.length ? built.rejectionReasons[0]! : null,
  };
}

function recordFromDiscovery(song: SongIdentity, discovery: ExternalResearchDiscoveryRecord): ExternalResearchRecord {
  const format = normalizeFormat(discovery.format);
  const purpose = discovery.purpose ?? "RESEARCH_LEAD";
  const evidenceClass = discovery.evidenceClass ?? (format && ["midi", "mid", "musicxml", "xml", "mxl"].includes(format) ? "VERIFIED_NATIVE_SYMBOLIC" : "PIANO_COVER_SYMBOLIC");
  const reasons = purpose === "BENCHMARK_REFERENCE" || evidenceClass === "BENCHMARK_REFERENCE" ? ["benchmark/reference evidence is evaluation-only"] : [];
  const identity = assessExternalIdentity(song, discovery, null);
  return {
    id: stableId(discovery.id, `discovery:${stableId(discovery.sourceRef, "unknown")}`),
    songId: song.id,
    title: text(discovery.title),
    provider: text(discovery.provider),
    evidenceClass,
    purpose,
    ...identity,
    discovery: { status: "metadata-only", sourceRef: logicalRef(discovery.sourceRef), sourcePage: safePage(discovery.sourcePage ?? discovery.url) },
    acquisition: { status: "not-supplied", method: null },
    content: { sha256: null, byteLength: null, mediaType: format ? MEDIA_TYPES[format] ?? null : null },
    parser: { status: "not-attempted", format, adapter: null, warnings: [], error: null },
    roles: [],
    alignment: { status: "not-attempted", reason: null },
    generationUsable: false,
    rejectionReasons: reasons,
    candidate: null,
    score: null,
    canonical: null,
  };
}

function recordFromIngestion(song: SongIdentity, input: ExternalResearchLocalInput, result: ExternalSymbolicIngestionResult, fallbackId: string): ExternalResearchRecord {
  const purpose = input.purpose ?? "RESEARCH_LEAD";
  const candidate = result.candidate;
  const rejectionReasons = [...result.rejectionReasons];
  if (purpose === "BENCHMARK_REFERENCE" && !rejectionReasons.some((reason) => /benchmark|reference/i.test(reason))) rejectionReasons.push("benchmark/reference evidence is evaluation-only");
  const evidenceClass = input.evidenceClass === "BENCHMARK_REFERENCE"
    ? input.evidenceClass
    : result.status === "parsed" ? (input.evidenceClass ?? candidate?.evidenceClass ?? "VERIFIED_NATIVE_SYMBOLIC") : "TAB_OR_CHORD_EVIDENCE";
  const identity = assessExternalIdentity(song, input, result.score);
  const alignment = alignmentFromInput(input);
  if (!alignment.valid) rejectionReasons.push("invalid alignment evidence");
  if (purpose === "GENERATION_CANDIDATE" && alignment.status !== "aligned" && !rejectionReasons.some((reason) => /alignment/i.test(reason))) {
    rejectionReasons.push(`alignment is ${alignment.status}; aligned status is required before generation`);
  }
  return {
    id: stableId(input.id, candidate?.id ?? fallbackId),
    songId: song.id,
    title: text(input.title) ?? song.title,
    provider: text(input.provider),
    evidenceClass,
    purpose,
    ...identity,
    discovery: { status: "local-supplied", sourceRef: logicalRef(input.sourceRef) ?? candidate?.provenance.sourceRef ?? null, sourcePage: safePage(input.sourcePage) },
    acquisition: { status: result.provenance?.accessMethod === "local-file" ? "local-file" : result.provenance?.accessMethod === "local-bytes" ? "local-bytes" : "rejected", method: result.provenance?.accessMethod === "local-file" || result.provenance?.accessMethod === "local-bytes" ? result.provenance.accessMethod : null },
    content: { sha256: result.provenance?.sha256 ?? null, byteLength: result.provenance?.bytes ?? null, mediaType: result.format ? MEDIA_TYPES[result.format] ?? null : null },
    parser: { status: result.status, format: result.format, adapter: result.provenance?.parser.id ?? null, warnings: [...result.warnings].sort(), error: result.error },
    roles: result.roles,
    alignment: { status: alignment.status, reason: alignment.reason },
    generationUsable: Boolean(candidate) && purpose === "GENERATION_CANDIDATE" && alignment.status === "aligned" && alignment.valid,
    rejectionReasons: [...new Set(rejectionReasons)].sort(),
    candidate,
    score: result.score,
    canonical: result.canonical,
  };
}

/** Build a provider-neutral inventory; all discovery and acquisition inputs are injected. */
export async function researchExternalCandidates(songInput: SongIdentityInput | SongIdentity, options: ExternalResearchOptions = {}): Promise<ExternalResearchInventory> {
  const song = "id" in songInput && typeof songInput.id === "string" ? songInput as SongIdentity : createSongIdentity(songInput);
  const discovery = [...(options.discoveryRecords ?? options.discoveryCandidates ?? options.discovery ?? [])].sort((a, b) => stableId(a.id, "").localeCompare(stableId(b.id, "")));
  const localInputs = [...(options.localInputs ?? options.localByteInputs ?? options.localCandidates ?? [])].sort((a, b) => stableId(a.id, "").localeCompare(stableId(b.id, ""))
    || String(a.sourceRef ?? "").localeCompare(String(b.sourceRef ?? ""))
    || (a.bytes !== undefined && b.bytes !== undefined ? hashBytes(a.bytes).localeCompare(hashBytes(b.bytes)) : 0));
  const records = new Map<string, ExternalResearchRecord>();
  for (const item of discovery) records.set(stableId(item.id, `discovery:${records.size + 1}`), recordFromDiscovery(song, item));
  for (const [index, input] of localInputs.entries()) {
    const sourceRef = logicalRef(input.sourceRef);
    const requestedId = stableId(input.id, stableId(sourceRef, input.bytes !== undefined ? `local:${hashBytes(input.bytes).slice(0, 24)}` : `local:${index + 1}`));
    const baseByIdentity = records.get(requestedId)
      ?? (sourceRef ? [...records.values()].find((record) => record.discovery.sourceRef === sourceRef) : undefined);
    const protectedDiscovery = baseByIdentity && (baseByIdentity.purpose === "BENCHMARK_REFERENCE" || baseByIdentity.evidenceClass === "BENCHMARK_REFERENCE");
    const ingestionInput = baseByIdentity
      ? { ...input, purpose: protectedDiscovery ? baseByIdentity.purpose : input.purpose ?? baseByIdentity.purpose, evidenceClass: protectedDiscovery ? baseByIdentity.evidenceClass : input.evidenceClass ?? baseByIdentity.evidenceClass }
      : input;
    const result = await ingestExternalSymbolicCandidate(ingestionInput);
    const contentHash = result.provenance?.sha256 ?? null;
    const id = stableId(input.id, stableId(sourceRef, contentHash ? `local:${contentHash.slice(0, 24)}` : `local:${index + 1}`));
    const baseEntry = baseByIdentity
      ? [...records.entries()].find(([, record]) => record === baseByIdentity)
      : contentHash ? [...records.entries()].find(([, record]) => record.content.sha256 === contentHash) : undefined;
    const base = baseEntry?.[1];
    // Build the record from the effective metadata used for ingestion.  A
    // discovery row may supply the generation purpose while the local bytes
    // only supply content/alignment; using the original local input here
    // would later relabel the record without recomputing generationUsable.
    const record = recordFromIngestion(song, ingestionInput, result, id);
    if (base && baseEntry) {
      record.id = base.id;
      record.title = record.title === song.title ? base.title : record.title;
      record.provider = record.provider ?? base.provider;
      record.evidenceClass = protectedDiscovery ? base.evidenceClass : input.evidenceClass ?? base.evidenceClass;
      record.purpose = protectedDiscovery ? base.purpose : input.purpose ?? base.purpose;
      record.discovery.sourceRef = record.discovery.sourceRef ?? base.discovery.sourceRef;
      record.discovery.sourcePage = record.discovery.sourcePage ?? base.discovery.sourcePage;
      if (record.purpose === "BENCHMARK_REFERENCE" && !record.rejectionReasons.some((reason) => /benchmark|reference/i.test(reason))) record.rejectionReasons.push("benchmark/reference evidence is evaluation-only");
      if (protectedDiscovery && (input.purpose !== undefined || input.evidenceClass !== undefined)
        && (input.purpose !== base.purpose || input.evidenceClass !== base.evidenceClass)) record.rejectionReasons.push("local metadata cannot override benchmark/reference discovery");
      record.generationUsable = record.generationUsable && record.purpose !== "BENCHMARK_REFERENCE";
      records.set(baseEntry[0], record);
    } else records.set(id, record);
  }
  return {
    schemaVersion: EXTERNAL_RESEARCH_SCHEMA_VERSION,
    song,
    records: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
    discoveryErrors: [...new Set((options.discoveryErrors ?? []).map(errorText))].sort(),
  };
}

function safeSummary(value: unknown, key = ""): unknown {
  if (/(?:notes?|events?|canonical|score|bytes|path|file|locator|artifact)/i.test(key)) {
    if (/^(?:sha256|byteLength|parser)$/i.test(key)) return undefined;
    return undefined;
  }
  if (Array.isArray(value)) return value.map((item) => safeSummary(item, key)).filter((item) => item !== undefined);
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value.trim())) return value;
    if (/^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(value)) return "[redacted-path]";
    return redactPhysicalText(value);
  }
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((childKey) => [childKey, safeSummary(value[childKey], childKey)]).filter(([, item]) => item !== undefined));
  return value;
}

/** Stable path-safe inventory JSON; score note/event arrays are deliberately omitted. */
export function serializeExternalResearchInventory(inventory: ExternalResearchInventory): string {
  return `${JSON.stringify(safeSummary(inventory), null, 2)}\n`;
}
