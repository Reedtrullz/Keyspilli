import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import {
  sanitizeGenericExternalUrl,
  type GenericEligibility,
  type GenericEvidenceClass,
  type GenericIdentityState,
  type GenericRole,
  type GenericRightsState,
  type GenericSourceCandidate,
  type GenericTimingClass,
  type GenericVersionState,
} from "./generic-source-ranking.js";

export const SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION = 1 as const;
export const SOURCE_CANDIDATE_HANDOFF_DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
export const SOURCE_CANDIDATE_HANDOFF_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export type SourceCandidateHandoffFormat = "midi" | "musicxml" | "mxl";
export type SourceCandidateHandoffState =
  | "DISCOVERED"
  | "AWAITING_USER_FILE"
  | "FILE_RECEIVED"
  | "INTAKE_VALIDATED"
  | "GENERATION_ACCEPTED"
  | "FILE_REJECTED"
  | "IDENTITY_UNCONFIRMED"
  | "FORMAT_MISMATCH"
  | "ALIGNMENT_REQUIRED"
  | "PLAYABILITY_REJECTED"
  | "GENERATION_FAILED"
  | "EXPIRED";

const STATES = new Set<SourceCandidateHandoffState>([
  "DISCOVERED", "AWAITING_USER_FILE", "FILE_RECEIVED", "INTAKE_VALIDATED", "GENERATION_ACCEPTED",
  "FILE_REJECTED", "IDENTITY_UNCONFIRMED", "FORMAT_MISMATCH", "ALIGNMENT_REQUIRED",
  "PLAYABILITY_REJECTED", "GENERATION_FAILED", "EXPIRED",
]);
const FORMATS = new Set<SourceCandidateHandoffFormat>(["midi", "musicxml", "mxl"]);
const EVIDENCE = new Set<GenericEvidenceClass>([
  "STRUCTURED_MIDI", "STRUCTURED_MUSICXML", "STRUCTURED_MXL", "STRUCTURED_GUITAR_PRO",
  "PIANO_SYMBOLIC", "SCORE_PDF_OR_IMAGE", "PIANO_COVER_AUDIO_OR_VIDEO", "TAB", "CHORDS",
  "LYRICS_ONLY", "GENERIC_AUDIO", "UNKNOWN",
]);
const TIMING = new Set<GenericTimingClass>([
  "NATIVE_AUTHORITATIVE", "PERFORMANCE_SYMBOLIC_POTENTIAL", "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT",
  "SEMANTIC_ONLY", "INDEPENDENT_COVER_TIMING", "UNKNOWN_TIMING",
]);
const RIGHTS = new Set<GenericRightsState>([
  "USER_SUPPLIED_PRIVATE", "OPEN_LICENSE_EXPLICIT", "PUBLIC_DOMAIN_EXPLICIT",
  "REUSE_PERMISSION_EXPLICIT", "UNKNOWN_RIGHTS", "RESTRICTED_OR_PLATFORM_CONTROLLED",
  "BENCHMARK_REFERENCE", "DIAGNOSTIC_ONLY",
]);
const ELIGIBILITY = new Set<GenericEligibility>([
  "AUTO_ACQUISITION_ELIGIBLE", "USER_MEDIATED_CANDIDATE", "SCORE_ALIGNMENT_REQUIRED",
  "SEMANTIC_SUPPORT_ONLY", "RESEARCH_LEAD_ONLY", "REJECTED",
]);
const ROLES = new Set<GenericRole>(["piano", "melody", "harmony", "bass", "guitar", "vocals", "drums", "unknown"]);
const IDENTITIES = new Set<GenericIdentityState>(["IDENTITY_EXACT", "IDENTITY_STRONG", "IDENTITY_AMBIGUOUS", "IDENTITY_MISMATCH"]);
const VERSIONS = new Set<GenericVersionState>(["VERSION_EXACT", "VERSION_COMPATIBLE", "VERSION_CLAIMED", "VERSION_AMBIGUOUS", "VERSION_MISMATCH", "VERSION_UNKNOWN"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface SourceCandidateHandoff {
  schemaVersion: typeof SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION;
  handoffId: string;
  targetSongId: string;
  targetArtist: string;
  targetTitle: string;
  candidateId: string;
  candidateUrl: string;
  provider: string;
  identity: GenericIdentityState;
  version: GenericVersionState;
  evidenceClass: GenericEvidenceClass;
  expectedFormat: SourceCandidateHandoffFormat;
  timing: GenericTimingClass;
  roles: GenericRole[];
  region: "full" | "section" | "unknown";
  rights: GenericRightsState;
  eligibility: GenericEligibility;
  state: SourceCandidateHandoffState;
  createdAt: string;
  expiresAt: string;
  userAffirmedTarget: boolean;
  discoverySourceRef: string;
  reasons: string[];
  uploadedSourceSha256?: string;
  uploadedFormat?: SourceCandidateHandoffFormat;
  intakeCandidateId?: string;
  failureReason?: string;
}

/** Additive manifest lineage; uploaded bytes remain private user material. */
export interface SourceCandidateHandoffLink {
  schemaVersion: typeof SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION;
  handoffId: string;
  selectedCandidateId: string;
  targetSongId: string;
  userAffirmedTarget: true;
  discoverySourceRef: string;
  discoveryRights: GenericRightsState;
  discoveryTiming: GenericTimingClass;
  discoveryEligibility: GenericEligibility;
  uploadedSourceSha256: string;
  uploadedFormat: SourceCandidateHandoffFormat;
  intakeCandidateId: string;
  uploadedProvenanceClass: "USER_SUPPLIED_PRIVATE";
  uploadedTimingAuthority: "NATIVE_AUTHORITATIVE";
}

export interface SourceCandidateHandoffBinding {
  handoff: SourceCandidateHandoff;
  link: SourceCandidateHandoffLink;
}

export interface SourceCandidateHandoffClientView {
  handoffId: string;
  targetSongId: string;
  targetArtist: string;
  targetTitle: string;
  candidateId: string;
  candidateUrl: string;
  provider: string;
  expectedFormat: SourceCandidateHandoffFormat;
  identity: GenericIdentityState;
  version: GenericVersionState;
  timing: GenericTimingClass;
  roles: GenericRole[];
  rights: GenericRightsState;
  eligibility: GenericEligibility;
  state: SourceCandidateHandoffState;
  expiresAt: string;
  userAffirmedTarget: boolean;
  reasons: string[];
}

function text(value: unknown, max = 200): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/(?:file:\/\/|[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|mnt|workspace|data|srv|etc)[\\/])[^\s,;)}\]]*/gi, "[redacted-path]").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function iso(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.includes("T") && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function safeCandidateId(value: unknown): string | null {
  const candidate = text(value, 120);
  return SAFE_ID.test(candidate) ? candidate : null;
}

function formatForCandidate(candidate: GenericSourceCandidate): SourceCandidateHandoffFormat | null {
  return FORMATS.has(candidate.symbolicFormat as SourceCandidateHandoffFormat)
    ? candidate.symbolicFormat as SourceCandidateHandoffFormat
    : null;
}

function candidateFailure(candidate: GenericSourceCandidate, targetSongId: string, url: string | null): string[] {
  const reasons: string[] = [];
  if (candidate.candidateClass !== "GENERATION_CANDIDATE") reasons.push(`candidate class ${candidate.candidateClass} is firewall-protected`);
  if (["BENCHMARK_REFERENCE", "DIAGNOSTIC_ONLY"].includes(candidate.rights)) reasons.push(`rights state ${candidate.rights} is firewall-protected`);
  if (candidate.identity === "IDENTITY_MISMATCH" || candidate.version === "VERSION_MISMATCH") reasons.push("identity or version mismatch");
  if (candidate.targetId !== targetSongId) reasons.push("candidate does not belong to the requested target");
  if (!formatForCandidate(candidate)) reasons.push("candidate is not one of the supported symbolic handoff formats");
  if (!url) reasons.push("candidate has no safe external source URL");
  if (candidate.eligibility === "REJECTED") reasons.push("candidate is rejected by the source firewall");
  return reasons;
}

export function createSourceCandidateHandoff(
  candidate: GenericSourceCandidate,
  options: { targetSongId: string; targetArtist: string; targetTitle: string; now?: string; handoffId?: string; ttlMs?: number },
): SourceCandidateHandoff {
  const targetSongId = safeCandidateId(options.targetSongId);
  const targetArtist = text(options.targetArtist);
  const targetTitle = text(options.targetTitle);
  if (!targetSongId || !targetArtist || !targetTitle) throw new Error("handoff target metadata is invalid");
  const url = sanitizeGenericExternalUrl(candidate.sourceRef);
  const reasons = candidateFailure(candidate, targetSongId, url);
  if (reasons.length) throw new Error(`candidate cannot be handed off: ${reasons.join("; ")}`);
  const handoffId = safeCandidateId(options.handoffId ?? randomUUID());
  if (!handoffId) throw new Error("handoff id is invalid");
  const candidateId = safeCandidateId(candidate.candidateId);
  if (!candidateId) throw new Error("candidate id is invalid");
  const now = options.now ?? new Date().toISOString();
  if (!iso(now)) throw new Error("handoff creation time is invalid");
  const ttl = options.ttlMs ?? SOURCE_CANDIDATE_HANDOFF_DEFAULT_TTL_MS;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > SOURCE_CANDIDATE_HANDOFF_MAX_TTL_MS) throw new Error("handoff TTL is invalid");
  const expiresAt = new Date(Date.parse(now) + ttl).toISOString();
  const format = formatForCandidate(candidate)!;
  const handoff: SourceCandidateHandoff = {
    schemaVersion: SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION,
    handoffId,
    targetSongId,
    targetArtist,
    targetTitle,
    candidateId,
    candidateUrl: url!,
    provider: text(candidate.provider, 160) || "unknown",
    identity: candidate.identity,
    version: candidate.version,
    evidenceClass: candidate.evidenceClass,
    expectedFormat: format,
    timing: candidate.timing,
    roles: [...candidate.roles].filter((role) => ROLES.has(role)).sort(compareText),
    region: candidate.region,
    rights: candidate.rights,
    eligibility: candidate.eligibility,
    state: "AWAITING_USER_FILE",
    createdAt: now,
    expiresAt,
    userAffirmedTarget: false,
    discoverySourceRef: url!,
    reasons: [...new Set([...candidate.reasons, ...candidate.rankingReasons])].map((reason) => text(reason, 240)).filter(Boolean).sort(compareText),
  };
  const errors = validateSourceCandidateHandoff(handoff);
  if (errors.length) throw new Error(`invalid source candidate handoff: ${errors.join("; ")}`);
  return handoff;
}

export function affirmSourceCandidateHandoff(handoff: SourceCandidateHandoff): SourceCandidateHandoff {
  assertHandoffUsable(handoff);
  if (!["AWAITING_USER_FILE", "FILE_REJECTED", "FORMAT_MISMATCH"].includes(handoff.state)) {
    throw new Error(`handoff cannot be affirmed in state ${handoff.state}`);
  }
  return { ...handoff, userAffirmedTarget: true, state: "AWAITING_USER_FILE", failureReason: undefined };
}

export function bindSourceCandidateUpload(
  handoff: SourceCandidateHandoff,
  input: { uploadedSourceSha256: string; uploadedFormat: SourceCandidateHandoffFormat; intakeCandidateId: string },
): SourceCandidateHandoffBinding {
  assertHandoffUsable(handoff);
  if (!handoff.userAffirmedTarget) throw new Error("user target confirmation is required before upload");
  const repeatedAcceptedUpload = handoff.state === "GENERATION_ACCEPTED"
    && handoff.uploadedSourceSha256 === input.uploadedSourceSha256
    && handoff.uploadedFormat === input.uploadedFormat
    && handoff.intakeCandidateId === input.intakeCandidateId;
  if (!repeatedAcceptedUpload && !["AWAITING_USER_FILE", "FILE_REJECTED", "FORMAT_MISMATCH"].includes(handoff.state)) {
    throw new Error(`handoff cannot receive a file in state ${handoff.state}`);
  }
  if (!SHA256.test(input.uploadedSourceSha256)) throw new Error("uploaded source SHA256 is invalid");
  if (!FORMATS.has(input.uploadedFormat)) throw new Error("uploaded symbolic format is unsupported");
  const intakeCandidateId = safeCandidateId(input.intakeCandidateId);
  if (!intakeCandidateId) throw new Error("intake candidate id is invalid");
  const link: SourceCandidateHandoffLink = {
    schemaVersion: SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION,
    handoffId: handoff.handoffId,
    selectedCandidateId: handoff.candidateId,
    targetSongId: handoff.targetSongId,
    userAffirmedTarget: true,
    discoverySourceRef: handoff.discoverySourceRef,
    discoveryRights: handoff.rights,
    discoveryTiming: handoff.timing,
    discoveryEligibility: handoff.eligibility,
    uploadedSourceSha256: input.uploadedSourceSha256,
    uploadedFormat: input.uploadedFormat,
    intakeCandidateId,
    uploadedProvenanceClass: "USER_SUPPLIED_PRIVATE",
    uploadedTimingAuthority: "NATIVE_AUTHORITATIVE",
  };
  const nextState: SourceCandidateHandoffState = repeatedAcceptedUpload
    ? "GENERATION_ACCEPTED"
    : input.uploadedFormat === handoff.expectedFormat ? "FILE_RECEIVED" : "FORMAT_MISMATCH";
  const next = {
    ...handoff,
    state: nextState,
    uploadedSourceSha256: input.uploadedSourceSha256,
    uploadedFormat: input.uploadedFormat,
    intakeCandidateId,
    failureReason: undefined,
    reasons: input.uploadedFormat === handoff.expectedFormat
      ? handoff.reasons
      : [...new Set([...handoff.reasons, `uploaded format ${input.uploadedFormat} differs from expected ${handoff.expectedFormat}`])].sort(compareText),
  } satisfies SourceCandidateHandoff;
  return { handoff: next, link };
}

export function acceptSourceCandidateHandoff(handoff: SourceCandidateHandoff): SourceCandidateHandoff {
  assertHandoffUsable(handoff);
  if (handoff.state === "GENERATION_ACCEPTED") return handoff;
  if (!handoff.userAffirmedTarget || !handoff.uploadedSourceSha256 || !handoff.uploadedFormat || !handoff.intakeCandidateId) {
    throw new Error("handoff file binding is incomplete");
  }
  if (!["FILE_RECEIVED", "FORMAT_MISMATCH", "INTAKE_VALIDATED"].includes(handoff.state)) {
    throw new Error(`handoff cannot be accepted in state ${handoff.state}`);
  }
  return { ...handoff, state: "GENERATION_ACCEPTED", failureReason: undefined };
}

export function rejectSourceCandidateHandoff(handoff: SourceCandidateHandoff, reason: string): SourceCandidateHandoff {
  if (handoff.state === "EXPIRED" || Date.parse(handoff.expiresAt) <= Date.now()) return { ...handoff, state: "EXPIRED" };
  return { ...handoff, state: "FILE_REJECTED", failureReason: text(reason, 240) || "upload rejected" };
}

function assertHandoffUsable(handoff: SourceCandidateHandoff): void {
  const errors = validateSourceCandidateHandoff(handoff);
  if (errors.length) throw new Error(`invalid source candidate handoff: ${errors.join("; ")}`);
  if (Date.parse(handoff.expiresAt) <= Date.now() || handoff.state === "EXPIRED") throw new Error("source candidate handoff expired");
}

export function handoffClientView(handoff: SourceCandidateHandoff): SourceCandidateHandoffClientView {
  return {
    handoffId: handoff.handoffId,
    targetSongId: handoff.targetSongId,
    targetArtist: handoff.targetArtist,
    targetTitle: handoff.targetTitle,
    candidateId: handoff.candidateId,
    candidateUrl: handoff.candidateUrl,
    provider: handoff.provider,
    expectedFormat: handoff.expectedFormat,
    identity: handoff.identity,
    version: handoff.version,
    timing: handoff.timing,
    roles: [...handoff.roles],
    rights: handoff.rights,
    eligibility: handoff.eligibility,
    state: handoff.state,
    expiresAt: handoff.expiresAt,
    userAffirmedTarget: handoff.userAffirmedTarget,
    reasons: [...handoff.reasons],
  };
}

export function validateSourceCandidateHandoffLink(value: unknown, path = "sourceCandidateHandoff"): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION) errors.push(`${path}.schemaVersion must be ${SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION}`);
  for (const key of ["handoffId", "selectedCandidateId", "targetSongId", "intakeCandidateId"] as const) {
    if (!safeCandidateId(record[key])) errors.push(`${path}.${key} must be a safe identifier`);
  }
  if (record.userAffirmedTarget !== true) errors.push(`${path}.userAffirmedTarget must be true`);
  const source = sanitizeGenericExternalUrl(record.discoverySourceRef);
  if (!source || source !== record.discoverySourceRef) errors.push(`${path}.discoverySourceRef must be a canonical external URL`);
  if (!RIGHTS.has(record.discoveryRights as GenericRightsState)) errors.push(`${path}.discoveryRights is invalid`);
  if (!TIMING.has(record.discoveryTiming as GenericTimingClass)) errors.push(`${path}.discoveryTiming is invalid`);
  if (!ELIGIBILITY.has(record.discoveryEligibility as GenericEligibility)) errors.push(`${path}.discoveryEligibility is invalid`);
  if (!SHA256.test(typeof record.uploadedSourceSha256 === "string" ? record.uploadedSourceSha256 : "")) errors.push(`${path}.uploadedSourceSha256 must be lowercase SHA256`);
  if (!FORMATS.has(record.uploadedFormat as SourceCandidateHandoffFormat)) errors.push(`${path}.uploadedFormat is invalid`);
  if (record.uploadedProvenanceClass !== "USER_SUPPLIED_PRIVATE") errors.push(`${path}.uploadedProvenanceClass must remain USER_SUPPLIED_PRIVATE`);
  if (record.uploadedTimingAuthority !== "NATIVE_AUTHORITATIVE") errors.push(`${path}.uploadedTimingAuthority must remain NATIVE_AUTHORITATIVE`);
  return errors;
}

export function validateSourceCandidateHandoff(value: unknown, path = "handoff"): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION) errors.push(`${path}.schemaVersion must be ${SOURCE_CANDIDATE_HANDOFF_SCHEMA_VERSION}`);
  for (const key of ["handoffId", "targetSongId", "candidateId"] as const) if (!safeCandidateId(record[key])) errors.push(`${path}.${key} must be a safe identifier`);
  for (const key of ["targetArtist", "targetTitle", "candidateUrl", "discoverySourceRef", "provider"] as const) if (!text(record[key])) errors.push(`${path}.${key} must be a non-empty string`);
  const candidateUrl = sanitizeGenericExternalUrl(record.candidateUrl);
  const sourceRef = sanitizeGenericExternalUrl(record.discoverySourceRef);
  if (!candidateUrl || candidateUrl !== record.candidateUrl) errors.push(`${path}.candidateUrl must be a canonical external URL`);
  if (!sourceRef || sourceRef !== record.discoverySourceRef) errors.push(`${path}.discoverySourceRef must be a canonical external URL`);
  if (candidateUrl && sourceRef && candidateUrl !== sourceRef) errors.push(`${path}.candidateUrl and discoverySourceRef must agree`);
  if (!IDENTITIES.has(record.identity as GenericIdentityState)) errors.push(`${path}.identity is invalid`);
  if (!VERSIONS.has(record.version as GenericVersionState)) errors.push(`${path}.version is invalid`);
  if (!EVIDENCE.has(record.evidenceClass as GenericEvidenceClass)) errors.push(`${path}.evidenceClass is invalid`);
  if (!FORMATS.has(record.expectedFormat as SourceCandidateHandoffFormat)) errors.push(`${path}.expectedFormat is invalid`);
  if (!TIMING.has(record.timing as GenericTimingClass)) errors.push(`${path}.timing is invalid`);
  if (!RIGHTS.has(record.rights as GenericRightsState)) errors.push(`${path}.rights is invalid`);
  if (!ELIGIBILITY.has(record.eligibility as GenericEligibility)) errors.push(`${path}.eligibility is invalid`);
  if (!(["full", "section", "unknown"] as const).includes(record.region as "full" | "section" | "unknown")) errors.push(`${path}.region is invalid`);
  if (!STATES.has(record.state as SourceCandidateHandoffState)) errors.push(`${path}.state is invalid`);
  if (!iso(record.createdAt)) errors.push(`${path}.createdAt must be an ISO timestamp`);
  if (!iso(record.expiresAt)) errors.push(`${path}.expiresAt must be an ISO timestamp`);
  if (iso(record.createdAt) && iso(record.expiresAt) && Date.parse(record.expiresAt as string) <= Date.parse(record.createdAt as string)) errors.push(`${path}.expiresAt must be after createdAt`);
  if (typeof record.userAffirmedTarget !== "boolean") errors.push(`${path}.userAffirmedTarget must be a boolean`);
  if (!Array.isArray(record.roles) || record.roles.some((role) => !ROLES.has(role as GenericRole))) errors.push(`${path}.roles must contain recognized roles`);
  if (!Array.isArray(record.reasons) || record.reasons.some((reason) => typeof reason !== "string")) errors.push(`${path}.reasons must be strings`);
  if (record.uploadedSourceSha256 !== undefined && !SHA256.test(typeof record.uploadedSourceSha256 === "string" ? record.uploadedSourceSha256 : "")) errors.push(`${path}.uploadedSourceSha256 is invalid`);
  if (record.uploadedFormat !== undefined && !FORMATS.has(record.uploadedFormat as SourceCandidateHandoffFormat)) errors.push(`${path}.uploadedFormat is invalid`);
  if (record.intakeCandidateId !== undefined && !safeCandidateId(record.intakeCandidateId)) errors.push(`${path}.intakeCandidateId is invalid`);
  if (record.state === "GENERATION_ACCEPTED" && (!record.uploadedSourceSha256 || !record.uploadedFormat || !record.intakeCandidateId || record.userAffirmedTarget !== true)) errors.push(`${path} accepted state requires a confirmed upload binding`);
  return errors;
}

export function saveSourceCandidateHandoff(handoff: SourceCandidateHandoff): void {
  const errors = validateSourceCandidateHandoff(handoff);
  if (errors.length) throw new Error(`invalid source candidate handoff: ${errors.join("; ")}`);
  getDb().prepare(`
    INSERT INTO source_candidate_handoffs (id, state, created_at, expires_at, payload)
    VALUES (@id, @state, @createdAt, @expiresAt, @payload)
    ON CONFLICT(id) DO UPDATE SET state=@state, expires_at=@expiresAt, payload=@payload
  `).run({ id: handoff.handoffId, state: handoff.state, createdAt: handoff.createdAt, expiresAt: handoff.expiresAt, payload: JSON.stringify(handoff) });
}

export function getSourceCandidateHandoff(handoffId: string): SourceCandidateHandoff | null {
  const id = safeCandidateId(handoffId);
  if (!id) return null;
  const row = getDb().prepare("SELECT payload FROM source_candidate_handoffs WHERE id = ?").get(id) as { payload?: unknown } | undefined;
  if (!row || typeof row.payload !== "string") return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    if (validateSourceCandidateHandoff(parsed).length) return null;
    const handoff = parsed as SourceCandidateHandoff;
    return Date.parse(handoff.expiresAt) <= Date.now() ? { ...handoff, state: "EXPIRED" } : handoff;
  } catch {
    return null;
  }
}

export function cleanupExpiredSourceCandidateHandoffs(now = new Date()): number {
  return getDb().prepare("DELETE FROM source_candidate_handoffs WHERE expires_at <= ?").run(now.toISOString()).changes;
}

/** Persisted handoffs are intentionally short-lived; callers should clean before listing. */
export function listSourceCandidateHandoffs(): SourceCandidateHandoff[] {
  cleanupExpiredSourceCandidateHandoffs();
  const rows = getDb().prepare("SELECT payload FROM source_candidate_handoffs ORDER BY created_at, id").all() as Array<{ payload?: unknown }>;
  return rows.flatMap((row) => {
    if (typeof row.payload !== "string") return [];
    try {
      const value = JSON.parse(row.payload) as unknown;
      return validateSourceCandidateHandoff(value).length ? [] : [value as SourceCandidateHandoff];
    } catch {
      return [];
    }
  });
}
