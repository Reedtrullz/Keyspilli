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

/**
 * Local/open-corpus truth is generation-safe for shadow engineering runs,
 * but remains a distinct purpose from a real-song generation candidate.  It
 * is intentionally not folded into BENCHMARK_REFERENCE: benchmark material
 * remains evaluation-only at every generation boundary.
 */
export const SHADOW_GENERATION_TRUTH = "SHADOW_GENERATION_TRUTH" as const;
export const EVIDENCE_PURPOSES = ["GENERATION_CANDIDATE", "RESEARCH_LEAD", "BENCHMARK_REFERENCE", SHADOW_GENERATION_TRUTH] as const;
export type EvidencePurpose = (typeof EVIDENCE_PURPOSES)[number];

export const CANDIDATE_STATUSES = ["discovered", "acquired", "parsed", "rejected", "parse-failed"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const EVIDENCE_ROLES = ["melody", "harmony", "bass-root", "rhythm", "timing-only"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export interface EvidenceProvenance {
  sourceRef: string;
  provider?: string;
  acquiredVia?: unknown;
  acquisition?: unknown;
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

/** Hashes, paths, and lineage identifiers that belong to evaluation-only data. */
export interface BenchmarkReferenceManifest {
  sha256?: readonly string[];
  paths?: readonly string[];
  lineage?: readonly string[];
}

/** Optional explicit reference registry used by generation callers. */
export interface EvidenceFirewallOptions {
  benchmarkReferenceManifest?: BenchmarkReferenceManifest;
  /** Aliases keep the boundary usable by callers that already name this registry. */
  protectedSha256?: readonly string[];
  benchmarkSha256?: readonly string[];
  protectedPaths?: readonly string[];
  benchmarkPaths?: readonly string[];
  protectedLineage?: readonly string[];
  benchmarkLineage?: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isOneOf = <T extends readonly string[]>(value: unknown, choices: T): value is T[number] => typeof value === "string" && choices.includes(value);

const LOGICAL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const LOGICAL_SOURCE_KEY = /^(?:canonical)?sourceRef$/i;
const PHYSICAL_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\\\\)/;
const PHYSICAL_FILE_URI = /^file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/])|[^\\/\\\s]+[\\/])/i;
const RELATIVE_MEDIA_FILE = /(?:^|[\\/])[^\\/]+\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#].*)?$/i;
const GENERIC_REFERENCE_MARKER = /benchmark|reference|evaluation[-_ ]?only|eval[_-]?only|protected/i;

function isPhysicalSourceReference(value: string): boolean {
  const trimmed = value.trim();
  if (PHYSICAL_FILE_URI.test(trimmed) || PHYSICAL_ROOT.test(trimmed)) return true;
  if (LOGICAL_SCHEME.test(trimmed)) return false;
  return RELATIVE_MEDIA_FILE.test(trimmed);
}

/**
 * A provenance source reference is a logical identifier, not a transport
 * locator.  Query strings, fragments, and URL credentials can contain signed
 * tokens or account identifiers, so they must never cross the generation
 * boundary.  HTTP(S) callers may sanitize these values in their retrieval
 * adapter, but direct evidence callers fail closed here.
 */
function hasSensitiveSourceReference(value: string): boolean {
  const trimmed = value.trim();
  if (/[?#]/.test(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return true;
  } catch {
    // Opaque logical schemes (for example provider:track-1) are handled by
    // the conservative credential-shaped fallback below.
  }
  return /(?:^|\/\/)[^/\s:@]+(?::[^/\s@]*)?@/i.test(trimmed);
}

function isLogicalLabel(value: string): boolean {
  const trimmed = value.trim();
  return !isPhysicalSourceReference(trimmed) && LOGICAL_SCHEME.test(trimmed);
}

function finite(value: unknown): unknown {
  if (typeof value !== "number") return value;
  return Number.isFinite(value) ? value : null;
}

function normalize(value: unknown): unknown {
  if (typeof value === "number") return finite(value);
  if (Array.isArray(value)) {
    return value.map(normalize).sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
}

function canonicalMetadata(candidate: ExternalEvidenceCandidate): Record<string, unknown> {
  // Exclude both row-oriented payloads and columnar symbolic adapter output.
  // The latter must be exact so typed fields such as durationBeats remain
  // available to callers while arbitrary payload arrays do not enter a digest.
  const excluded = /(?:path|file|notes?|events?|artifact|locator)/i;
  const rawScoreArrayKey = /^(?:pitches|starts|durations|midiMeta)$/i;
  const pathLike = /^(?:file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/]))|[A-Za-z]:[\\/]|[\\/]|~[\\/])|(?:[\\/]\S+\.(?:mid|midi|musicxml|mxl|wav|mp3|json))(?:$|[?#])/i;
  const pathLikeSubstring = /(?:file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/]))|[A-Za-z]:[\\/]|~[\\/]|\\\\|\/)[^,;)}\]]*?\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?/gi;
  const pathPrefixSubstring = /(?:file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/]))[^\s,;)}\]]+|(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\|~[\\/])[^\s,;)}\]]+|\/(?:Users|private|tmp|var|home|Volumes)(?:[\\/][^\s,;)}\]]+)+)/gi;
  // Extensionless paths may contain spaces. Require another separator after
  // the known physical root, then redact through the next structural
  // delimiter. A simple `/tmp/private suffix` remains compatible with the
  // narrower path-prefix rule above, while `/Users/reidar/My Folder/private`
  // cannot leak its path tail.
  const spacedPathSubstring = /(?:file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/])|[^\\/\\\s]+[\\/])|\/(?:Users|private|tmp|var|home|Volumes)[\\/])(?!(?:[^,;)}\]]*\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?)(?:$|[\s,;)}\]]))(?=[^,;)}\]]*[\\/])(?=[^,;)}\]]*(?:[\\/][^,;)}\]]*[\\/]|\s[^,;)}\]]*[\\/]))[^,;)}\]]*|(?<![A-Za-z0-9:/])\/(?!Users[\\/]|private[\\/]|tmp[\\/]|var[\\/]|home[\\/]|Volumes[\\/])(?!(?:[^,;)}\]]*\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?)(?:$|[\s,;)}\]]))(?=[^,;)}\]]*[\\/])(?=[^,;)}\]]*(?:[\\/][^,;)}\]]*[\\/]|\s[^,;)}\]]*[\\/]))[^,;)}\]]*/gi;
  // Keep the regular one-token file-URI rule below from treating the second
  // slash in `file:///...` as an arbitrary absolute path after a spaced-path
  // match has intentionally declined the extensionless case.
  const fileUriPathSubstring = /file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/])|[^\\/\\\s]+[\\/])(?!(?:[^,;)}\]]*\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?)(?:$|[\s,;)}\]]))[^\s,;)}\]]+/gi;
  const spacedFileUriPathSubstring = /file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/])|[^\\/\\\s]+[\\/])(?!(?:[^,;)}\]]*\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?)(?:$|[\s,;)}\]]))(?=[^,;)}\]]*[\\/])(?=[^,;)}\]]*[\\/][^,;)}\]]*[\\/])[^,;)}\]]*/gi;
  const relativeMediaPathSubstring = /(?<![A-Za-z0-9_:/])(?:\.{0,2}[\\/]|[A-Za-z0-9._~-]+[\\/])[^,;)}\]]*?\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?/gi;
  const spacedWindowsPathSubstring = /(?:[A-Za-z]:[\\/]|\\\\|~[\\/])(?!(?:[^,;)}\]]*\.(?:musicxml|midi|mid|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?)(?:$|[\s,;)}\]]))(?=[^,;)}\]]*\s[^,;)}\]]*[\\/])[^,;)}\]]*/gi;
  const strip = (value: unknown, key = ""): unknown => {
    if (Array.isArray(value)) return normalize(value.map((item) => strip(item, key)));
    if (typeof value === "string") {
      if (LOGICAL_SOURCE_KEY.test(key)) {
        if (isPhysicalSourceReference(value)) return "[redacted-path]";
        if (GENERIC_REFERENCE_MARKER.test(value)) return "[redacted-reference]";
        return hasSensitiveSourceReference(value) ? "[redacted-source-ref]" : value;
      }
      if (GENERIC_REFERENCE_MARKER.test(value)) return "[redacted-reference]";
      if (isLogicalLabel(value)) return value;
      if (isPhysicalSourceReference(value)) return "[redacted-path]";
      if (pathLike.test(value)) return "[redacted-path]";
      const logicalLabels: string[] = [];
      const protectedValue = value.replace(/(?<![A-Za-z0-9])(?!(?:file):\/\/)(?:[A-Za-z][A-Za-z0-9+.-]*:)[^\s,;)}\]]+/gi, (match) => {
        if (!isLogicalLabel(match)) return match;
        logicalLabels.push(match);
        return `__LOGICAL_LABEL_${logicalLabels.length - 1}__`;
      });
      const redacted = protectedValue
        // Run the extensionless-space rule first so the narrower one-token
        // rules cannot leave the tail of a UNC or rooted path behind. Media
        // extensions are excluded here and handled by the precise matcher.
        .replace(spacedFileUriPathSubstring, "[redacted-path]")
        .replace(fileUriPathSubstring, "[redacted-path]")
        .replace(spacedPathSubstring, "[redacted-path]")
        .replace(spacedWindowsPathSubstring, "[redacted-path]")
        .replace(pathLikeSubstring, "[redacted-path]")
        .replace(pathPrefixSubstring, "[redacted-path]")
        .replace(relativeMediaPathSubstring, "[redacted-path]");
      return redacted.replace(/__LOGICAL_LABEL_(\d+)__/g, (_match, index: string) => logicalLabels[Number(index)] ?? "[redacted-path]");
    }
    if (!isRecord(value)) return finite(value);
    const entries = Object.keys(value).sort()
      .filter((childKey) => !excluded.test(childKey) && !rawScoreArrayKey.test(childKey))
      .map((childKey) => [childKey, childKey.toLowerCase() === "sha256" && typeof value[childKey] === "string" ? value[childKey].toLowerCase() : strip(value[childKey], childKey)] as const)
      .filter(([, child]) => child !== undefined);
    return entries.length || Object.keys(value).length === 0 ? Object.fromEntries(entries) : undefined;
  };
  return strip(candidate) as Record<string, unknown>;
}

function normalizedHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function physicalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/]))/i.test(trimmed)) return trimmed.replace(/^file:\/\//i, "").replaceAll("\\", "/").toLowerCase();
  if (/^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\\\\)/.test(trimmed)) return trimmed.replace(/^~(?=\/)/, "").replaceAll("\\", "/").toLowerCase();
  return null;
}

function pathMatches(candidatePath: string, protectedPath: string): boolean {
  const candidateNormalized = physicalPath(candidatePath);
  const protectedNormalized = physicalPath(protectedPath);
  if (!candidateNormalized || !protectedNormalized) return false;
  return candidateNormalized === protectedNormalized || candidateNormalized.startsWith(`${protectedNormalized.replace(/\/+$/, "")}/`);
}

function manifestValues(options: EvidenceFirewallOptions | undefined): { hashes: string[]; paths: string[]; lineage: string[] } {
  const manifest = options?.benchmarkReferenceManifest ?? {};
  const hashes = [...(manifest.sha256 ?? []), ...(options?.protectedSha256 ?? []), ...(options?.benchmarkSha256 ?? [])].map(normalizedHash);
  const invalidHash = hashes.some((value) => value === null);
  if (invalidHash) throw new Error("benchmark reference manifest contains an invalid SHA-256 hash");
  const paths = [...(manifest.paths ?? []), ...(options?.protectedPaths ?? []), ...(options?.benchmarkPaths ?? [])].filter((value): value is string => typeof value === "string");
  const lineage = [...(manifest.lineage ?? []), ...(options?.protectedLineage ?? []), ...(options?.benchmarkLineage ?? [])].filter((value): value is string => typeof value === "string");
  return { hashes: [...new Set(hashes as string[])], paths, lineage };
}

function includesProtectedRegistryValue(candidate: unknown, options: EvidenceFirewallOptions | undefined): boolean {
  const { hashes, paths, lineage } = manifestValues(options);
  let matched = false;
  const visit = (value: unknown, key = ""): void => {
    if (matched) return;
    if (typeof value === "string") {
      const hash = normalizedHash(value);
      if (hash && hashes.includes(hash)) matched = true;
      if (paths.some((path) => pathMatches(value, path))) matched = true;
      if (lineage.some((item) => item === value || item.toLowerCase() === value.toLowerCase())) matched = true;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (isRecord(value)) Object.entries(value).forEach(([entryKey, entryValue]) => visit(entryValue, entryKey));
  };
  visit(candidate);
  return matched;
}

/** Validate and return a generation-safe candidate. Benchmark and remote-only evidence fails closed. */
export function assertGenerationEvidence(candidate: ExternalEvidenceCandidate, options?: EvidenceFirewallOptions): ExternalEvidenceCandidate {
  if (!isRecord(candidate)) throw new Error("evidence candidate must be an object");
  if (!isOneOf(candidate.evidenceClass, EVIDENCE_CLASSES) || candidate.evidenceClass === "BENCHMARK_REFERENCE") throw new Error("invalid or benchmark evidence class");
  if (!isOneOf(candidate.purpose, EVIDENCE_PURPOSES) || candidate.purpose === "BENCHMARK_REFERENCE") throw new Error("benchmark evidence cannot enter generation");
  if (!isOneOf(candidate.status, CANDIDATE_STATUSES) || candidate.status !== "parsed") throw new Error("candidate parse status is not generation-safe; status must be parsed");
  if (!isRecord(candidate.provenance) || typeof candidate.provenance.sourceRef !== "string" || candidate.provenance.sourceRef.trim() === "") throw new Error("candidate requires a logical source reference");
  if (isPhysicalSourceReference(candidate.provenance.sourceRef)) throw new Error("candidate source reference must be logical, not a physical path");
  if (hasSensitiveSourceReference(candidate.provenance.sourceRef)) throw new Error("candidate source reference must not contain credentials, query, or fragment data");
  for (const key of ["canonicalSourceRef", "physicalPath", "sourceArtifactRef"] as const) {
    if (!Object.hasOwn(candidate.provenance, key)) continue;
    const value = candidate.provenance[key];
    if (typeof value !== "string" || value.trim() === "") throw new Error(`candidate provenance.${key} must be a non-empty string when supplied`);
    if (key === "canonicalSourceRef" && (isPhysicalSourceReference(value) || hasSensitiveSourceReference(value))) {
      throw new Error("candidate canonicalSourceRef must be logical and locator-free");
    }
  }
  const acquisitionKeys = ["acquisition", "acquiredVia"] as const;
  const allowedAcquisitions = new Set(["local-analysis", "local-import", "local-file", "local-bytes"]);
  const suppliedAcquisitions = acquisitionKeys.flatMap((key) => Object.hasOwn(candidate.provenance, key) ? [candidate.provenance[key]] : []);
  const acquisitions = suppliedAcquisitions.filter((value): value is string => typeof value === "string");
  if (suppliedAcquisitions.length === 0 || acquisitions.length !== suppliedAcquisitions.length || acquisitions.some((value) => !allowedAcquisitions.has(value.toLowerCase()))) throw new Error("candidate acquisition is not permitted for local analysis");
  const distinctAcquisitions = new Set(acquisitions.map((value) => value.toLowerCase()));
  // `local-analysis` is a compatibility umbrella for older adapters. Two
  // concrete acquisition mechanisms must never disagree at this boundary.
  if (distinctAcquisitions.size > 1 && !distinctAcquisitions.has("local-analysis")) throw new Error("conflicting candidate acquisition declarations");
  if (!isRecord(candidate.content) || typeof candidate.content.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.content.sha256)) throw new Error("candidate requires a SHA-256 content hash");
  const containsProtectedMarker = (value: unknown, key = ""): boolean => {
    if (GENERIC_REFERENCE_MARKER.test(key)) return true;
    if (typeof value === "string") return GENERIC_REFERENCE_MARKER.test(value);
    if (Array.isArray(value)) return value.some((item) => containsProtectedMarker(item));
    if (isRecord(value)) return Object.entries(value).some(([entryKey, entryValue]) => containsProtectedMarker(entryValue, entryKey));
    return false;
  };
  if (containsProtectedMarker(candidate)) {
    throw new Error("benchmark/reference evidence cannot enter generation");
  }
  if (includesProtectedRegistryValue(candidate, options)) {
    throw new Error("candidate matches a protected benchmark reference manifest");
  }
  const normalizedCandidate = { ...candidate, content: { ...candidate.content, sha256: candidate.content.sha256.toLowerCase() } };
  // Validation is also the generation boundary: callers must not receive a
  // candidate that still carries physical acquisition locators or raw note
  // payloads which canonical metadata deliberately excludes.
  return canonicalMetadata(normalizedCandidate) as ExternalEvidenceCandidate;
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
