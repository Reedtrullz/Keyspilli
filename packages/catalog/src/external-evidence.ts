import { createHash } from "node:crypto";

export const EVIDENCE_CLASSES = [
  "VERIFIED_NATIVE_SYMBOLIC",
  "VERIFIED_STRUCTURED_BAND_SYMBOLIC",
  "PIANO_COVER_SYMBOLIC",
  "PIANO_COVER_AUDIO",
  "TAB_OR_CHORD_EVIDENCE",
  "AUDIO_AMT_FALLBACK",
  "BENCHMARK_REFERENCE",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const EVIDENCE_PURPOSES = ["GENERATION_CANDIDATE", "RESEARCH_LEAD", "BENCHMARK_REFERENCE"] as const;
export type EvidencePurpose = (typeof EVIDENCE_PURPOSES)[number];

export const CANDIDATE_STATUSES = ["discovered", "acquired", "parsed", "rejected", "parse-failed"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const EVIDENCE_ROLES = ["melody", "harmony", "bass-root", "rhythm", "timing-only"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export interface EvidenceProvenance {
  sourceRef: string;
  provider?: string;
  acquiredVia?: string;
  acquisition?: string;
  canonicalSourceRef?: string;
  /** Physical locators are accepted for input but never included in canonical metadata. */
  physicalPath?: string;
  sourceArtifactRef?: string;
  [key: string]: unknown;
}

export interface EvidenceContent {
  sha256?: string | null;
  byteLength?: number;
  mediaType?: string;
  [key: string]: unknown;
}

export interface EvidenceConfidence {
  source?: number;
  parse?: number;
  identity?: number;
  alignment?: number;
  role?: number;
  [key: string]: number | undefined;
}

export interface EvidenceRoleRecord {
  role: EvidenceRole;
  confidence?: number;
  [key: string]: unknown;
}

export interface ExternalEvidenceCandidate {
  id?: string;
  evidenceClass: EvidenceClass;
  purpose: EvidencePurpose;
  provenance: EvidenceProvenance;
  content: EvidenceContent;
  confidence?: EvidenceConfidence;
  roles?: readonly EvidenceRoleRecord[];
  status: CandidateStatus;
  rejectionReasons?: readonly string[];
  notes?: readonly unknown[];
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isOneOf = <T extends readonly string[]>(value: unknown, choices: T): value is T[number] => typeof value === "string" && choices.includes(value);

function finite(value: unknown): unknown {
  if (typeof value !== "number") return value;
  return Number.isFinite(value) ? value : null;
}

function normalize(value: unknown): unknown {
  if (typeof value === "number") return finite(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
}

function canonicalMetadata(candidate: ExternalEvidenceCandidate): Record<string, unknown> {
  const excluded = /(?:path|file|notes?|events?)/i;
  const pathLike = /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])|(?:[\\/]\S+\.(?:mid|midi|musicxml|mxl|wav|mp3|json))(?:$|[?#])/i;
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (typeof value === "string" && pathLike.test(value)) return "[redacted-path]";
    if (!isRecord(value)) return finite(value);
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !excluded.test(key)).map((key) => [key, strip(value[key])]));
  };
  return strip(candidate) as Record<string, unknown>;
}

/** Validate and return a generation-safe candidate. Benchmark and remote-only evidence fails closed. */
export function assertGenerationEvidence(candidate: ExternalEvidenceCandidate): ExternalEvidenceCandidate {
  if (!isRecord(candidate)) throw new Error("evidence candidate must be an object");
  if (!isOneOf(candidate.evidenceClass, EVIDENCE_CLASSES) || candidate.evidenceClass === "BENCHMARK_REFERENCE") throw new Error("invalid or benchmark evidence class");
  if (!isOneOf(candidate.purpose, EVIDENCE_PURPOSES) || candidate.purpose === "BENCHMARK_REFERENCE") throw new Error("benchmark evidence cannot enter generation");
  if (!isOneOf(candidate.status, CANDIDATE_STATUSES) || candidate.status === "parse-failed" || candidate.status === "rejected") throw new Error("candidate parse status is not generation-safe");
  if (!isRecord(candidate.provenance) || typeof candidate.provenance.sourceRef !== "string" || candidate.provenance.sourceRef.trim() === "") throw new Error("candidate requires a logical source reference");
  const acquisitions = [candidate.provenance.acquisition, candidate.provenance.acquiredVia].filter((value): value is string => typeof value === "string");
  if (acquisitions.length === 0 || acquisitions.some((value) => !/^local(?:-|$)/i.test(value) || /remote|benchmark|protected|download|provider-export/i.test(value))) throw new Error("candidate acquisition is not permitted for local analysis");
  if (!isRecord(candidate.content) || typeof candidate.content.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.content.sha256)) throw new Error("candidate requires a SHA-256 content hash");
  const protectedFields = [candidate.provenance, candidate.lineage, candidate.protectedMarker, candidate.benchmarkReferenceHash, candidate.benchmarkReferenceHashes];
  const containsProtectedMarker = (value: unknown, key = ""): boolean => {
    if (/benchmark|reference|evaluation[-_ ]?only|protected/i.test(key)) return true;
    if (typeof value === "string") return /benchmark|evaluation[-_ ]?only|protected/i.test(value) || /(?:^|[/:])reference(?:$|[/:])/i.test(value);
    if (Array.isArray(value)) return value.some((item) => containsProtectedMarker(item));
    if (isRecord(value)) return Object.entries(value).some(([entryKey, entryValue]) => containsProtectedMarker(entryValue, entryKey));
    return false;
  };
  if (Object.keys(candidate).some((key) => /benchmark|reference|evaluation[-_ ]?only|protected/i.test(key)) || protectedFields.some((value) => containsProtectedMarker(value))) {
    throw new Error("benchmark/reference evidence cannot enter generation");
  }
  return candidate;
}

/** Stable, path-safe metadata records for a candidate set. */
export function canonicalEvidenceCandidateSet(candidates: readonly ExternalEvidenceCandidate[]): Record<string, unknown>[] {
  return candidates.map(canonicalMetadata).sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** Digest of canonical candidate metadata; note arrays and physical paths are intentionally excluded. */
export function evidenceCandidateSetDigest(candidates: readonly ExternalEvidenceCandidate[]): string {
  const canonical = JSON.stringify(canonicalEvidenceCandidateSet(candidates));
  return createHash("sha256").update(canonical).digest("hex");
}
