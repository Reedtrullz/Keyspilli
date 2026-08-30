import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { sha256Hex } from "./fixture-evidence.js";
import type { ArrangementCandidate } from "./song-research.js";

/** Version of the local native-symbolic discovery contract. */
export const NATIVE_SCORE_DISCOVERY_SCHEMA_VERSION = 1 as const;

export type NativeScoreArtifactType = "midi" | "musicxml" | "mxl" | "mscz";

export type NativeScoreAccess =
  | "local-file"
  | "source-page"
  | "source-research"
  | "sidecar"
  | "embedded-pdf"
  | "unknown";

export type NativeScoreHashStatus = "verified" | "supplied" | "unavailable";

export type NativeScoreDiscoveryStatus =
  | "native-symbolic"
  | "ambiguous"
  | "omr-consensus"
  | "single-omr"
  | "review-required"
  | "failed";

export interface NativeScorePdfMetadata {
  title?: string | null;
  author?: string | null;
  subject?: string | null;
  keywords?: string | readonly string[] | null;
  pages?: number | null;
  sourcePage?: string | null;
  /** Optional metadata-only hints emitted by a permitted source researcher. */
  nativeArtifacts?: readonly NativeScoreArtifactInput[];
}

/**
 * An artifact candidate is intentionally metadata-first. A URL is never
 * fetched by this module; only an explicitly permitted local path can be
 * hashed and considered for native selection.
 */
export interface NativeScoreArtifactInput {
  id?: string | null;
  path?: string | null;
  url?: string | null;
  sourcePage?: string | null;
  sourceUrl?: string | null;
  artifactType?: NativeScoreArtifactType | string | null;
  /** `type` is accepted as a convenient sidecar alias. */
  type?: NativeScoreArtifactType | string | null;
  provenance?: unknown;
  version?: string | null;
  versionIdentity?: string | null;
  accessMethod?: NativeScoreAccess | string | null;
  page?: number | null;
  pageNumber?: number | null;
  bytes?: number | null;
  sha256?: string | null;
  permitted?: boolean;
  confidence?: number | null;
  /** Optional logical source identity from a research candidate. */
  sourceRef?: string | null;
  /** Internal caller metadata is retained only after safe normalization. */
  label?: string | null;
}

export interface NativeScoreSidecarInput {
  path?: string | null;
  metadata?: NativeScoreArtifactInput | null;
  candidates?: readonly NativeScoreArtifactInput[];
}

export type NativeScoreSidecar = string | NativeScoreSidecarInput | NativeScoreArtifactInput;

export interface NativeScoreResearchCandidate {
  id?: string | null;
  sourceType?: string | null;
  localPath?: string | null;
  url?: string | null;
  title?: string | null;
  provenance?: unknown;
  version?: string | null;
  confidence?: number | null;
  selection?: string | null;
  permitted?: boolean;
}

export interface NativeScoreOmrInput {
  id?: string | null;
  backend?: string | null;
  version?: string | null;
  status?: string | null;
  confidence?: number | null;
  sourcePage?: string | null;
}

export interface NativeScoreDiscoveryInput {
  /** Physical PDF is read only for metadata/hash evidence; never copied. */
  pdfPath?: string | null;
  pdfMetadata?: NativeScorePdfMetadata | null;
  sidecars?: readonly NativeScoreSidecar[];
  nativeArtifacts?: readonly NativeScoreArtifactInput[];
  /** Alias for callers that use the plan's terminology. */
  permittedArtifacts?: readonly NativeScoreArtifactInput[];
  sourceResearchCandidates?: readonly (NativeScoreResearchCandidate | ArrangementCandidate)[];
  /** Alias for a source-research result's candidate list. */
  candidates?: readonly (NativeScoreResearchCandidate | ArrangementCandidate)[];
  omr?: readonly NativeScoreOmrInput[];
}

export interface NativeScoreDiscoveryOptions {
  /** Network access is deliberately unsupported, regardless of this flag. */
  allowNetwork?: false;
  /** Absolute roots allowed for explicitly permitted local artifacts. */
  allowedRoots?: readonly string[];
  /** Maximum local artifact size read for hashing. */
  maxArtifactBytes?: number;
  /** Include a safe logical basename in the report (never a physical path). */
  includeLogicalNames?: boolean;
}

export interface NativeScoreEvidence {
  id: string;
  artifactType: NativeScoreArtifactType;
  provenance: string | null;
  version: string | null;
  access: NativeScoreAccess;
  /** Alias retained for callers that use the input field name. */
  accessMethod: NativeScoreAccess;
  sourcePage: string | null;
  page: number | null;
  bytes: number | null;
  sha256: string | null;
  hashStatus: NativeScoreHashStatus;
  confidence: number | null;
  trusted: boolean;
  /** Optional logical basename; no directory is ever emitted. */
  logicalName?: string;
  /** Whether this row was derived from a source-research or sidecar hint. */
  discoveredFrom: "native-artifact" | "sidecar" | "source-research" | "pdf-metadata";
}

export interface NativeScoreRejectedEvidence {
  id: string;
  reason:
    | "remote artifact access is disabled"
    | "local artifact is not explicitly permitted"
    | "protected artifact path"
    | "relative artifact path"
    | "artifact is not a regular file"
    | "artifact exceeds local size limit"
    | "unsupported artifact type"
    | "invalid artifact format"
    | "native artifact requires provenance and version"
    | "untrusted native candidate"
    | "invalid artifact metadata";
}

export interface NativeScoreOmrEvidence {
  id: string;
  backend: string;
  version: string | null;
  status: string | null;
  confidence: number | null;
  sourcePage: string | null;
}

export interface NativeScorePdfEvidence {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string[];
  pages: number | null;
  bytes: number | null;
  sha256: string | null;
  logicalName?: string;
}

export interface NativeScoreDiscoveryReport {
  schemaVersion: typeof NATIVE_SCORE_DISCOVERY_SCHEMA_VERSION;
  status: NativeScoreDiscoveryStatus;
  selectionReason: string;
  pdf: NativeScorePdfEvidence | null;
  selected: NativeScoreEvidence | null;
  candidates: NativeScoreEvidence[];
  rejected: NativeScoreRejectedEvidence[];
  omr: NativeScoreOmrEvidence[];
  errors: string[];
}

export type NativeSymbolicArtifact = NativeScoreEvidence;
export type NativeScoreDiscoveryResult = NativeScoreDiscoveryReport;

const ARTIFACT_EXTENSIONS: Readonly<Record<string, NativeScoreArtifactType>> = {
  ".mid": "midi",
  ".midi": "midi",
  ".musicxml": "musicxml",
  ".xml": "musicxml",
  ".mxl": "mxl",
  ".mscz": "mscz",
};

const SAFE_HASH = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_PDF_BYTES = 32 * 1024 * 1024;
const PATH_PREFIX = /^(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/]|[\\])/;
const PATHISH_TEXT = /(?:^|[\s"'(:])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/|\\)|(?:^|[\s"'(:])[^\s"']+\.(?:mid|midi|musicxml|xml|mxl|mscz|pdf|json|wav|mp3|flac|pem|key)(?:$|[\s"'),:])/i;
const PROTECTED_SEGMENT = /^(?:\.ssh|\.gnupg|\.aws|\.azure|\.config|keychain|wallets?|secrets?|credentials?|tokens?|passwords?)$/i;
const PROTECTED_FILE = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys|.*\.(?:pem|key|p12|pfx))$/i;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value as readonly T[] : [];
}

function positiveInteger(value: unknown): number | null {
  return finite(value) && value >= 1 && Number.isInteger(value) ? value : null;
}

function clampConfidence(value: unknown): number | null {
  return finite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeWhitespace(value);
  if (!text || PATHISH_TEXT.test(text) || text.includes("/") || text.includes("\\")) return null;
  return text;
}

function safeLogicalName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeWhitespace(value);
  if (!text || PATH_PREFIX.test(text)) return null;
  const name = basename(text);
  if (name !== text || name === "." || name === "..") return null;
  return name.slice(0, 160);
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function pdfLiteral(value: string): string | null {
  const decoded = value
    .replace(/\\([\\()])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ");
  return safeText(decoded);
}

/** Read only the small, conventional Info dictionary fields from a PDF. */
function parsePdfMetadata(data: Uint8Array): NativeScorePdfMetadata {
  const text = Buffer.from(data).toString("latin1");
  const field = (name: string): string | null => {
    const match = text.match(new RegExp(`/${name}\\s*\\(([^)]*)\\)`));
    return match?.[1] ? pdfLiteral(match[1]) : null;
  };
  const pageMatches = text.match(/\/Type\s*\/Page(?:\s|\/|>|$)/g)?.length ?? 0;
  return {
    title: field("Title"),
    author: field("Author"),
    subject: field("Subject"),
    keywords: field("Keywords"),
    pages: pageMatches > 0 ? pageMatches : null,
  };
}

function safeId(value: unknown, fallback: string): string {
  const text = safeText(value);
  if (!text) return fallback;
  const id = text.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return id || fallback;
}

function artifactType(value: unknown, path?: string | null): NativeScoreArtifactType | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["midi", "mid"].includes(normalized)) return "midi";
  if (["musicxml", "xml"].includes(normalized)) return "musicxml";
  if (normalized === "mxl") return "mxl";
  if (normalized === "mscz") return "mscz";
  const extension = typeof path === "string" ? extname(path).toLowerCase() : "";
  return ARTIFACT_EXTENSIONS[extension] ?? null;
}

function hasNativeFormatSignature(data: Uint8Array, type: NativeScoreArtifactType): boolean {
  if (type === "midi") {
    const bytes = Buffer.from(data);
    if (bytes.length < 14 || bytes.subarray(0, 4).toString("ascii") !== "MThd") return false;
    const headerLength = bytes.readUInt32BE(4);
    const format = bytes.readUInt16BE(8);
    const trackCount = bytes.readUInt16BE(10);
    const division = bytes.readUInt16BE(12);
    return headerLength >= 6
      && headerLength <= bytes.length - 8
      && format <= 2
      && trackCount >= 1
      && division !== 0;
  }
  if (type === "mxl" || type === "mscz") {
    if (data.byteLength < 4) return false;
    const signature = Buffer.from(data.subarray(0, 4)).toString("ascii");
    return signature === "PK\u0003\u0004" || signature === "PK\u0005\u0006" || signature === "PK\u0007\u0008";
  }
  const head = Buffer.from(data.subarray(0, Math.min(data.byteLength, 4096))).toString("utf8").replace(/^\uFEFF/, "");
  return /<score-(?:partwise|timewise)(?:\s|>)/i.test(head);
}

function provenanceText(value: unknown): string | null {
  if (typeof value === "string") return safeText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  for (const key of ["provenance", "kind", "acquiredVia", "sourceRef"]) {
    const text = safeText(raw[key]);
    if (text) return text;
  }
  return null;
}

function sourcePage(value: NativeScoreArtifactInput): string | null {
  return safeUrl(value.sourcePage ?? value.sourceUrl ?? value.url);
}

function accessMethod(value: unknown, fallback: NativeScoreAccess): NativeScoreAccess {
  if (value === "local-file" || value === "source-page" || value === "source-research" || value === "sidecar" || value === "embedded-pdf") return value;
  return fallback;
}

function isProtectedPath(path: string): boolean {
  const absolute = resolve(path);
  const segments = absolute.split(/[\\/]+/).filter(Boolean);
  const standardMacPrivatePrefix = /^\/private\/(?:tmp|var(?:\/folders)?)(?:\/|$)/i.test(absolute);
  return segments.some((segment, index) =>
    PROTECTED_SEGMENT.test(segment)
    || PROTECTED_FILE.test(segment)
    || (segment.toLowerCase() === "private" && !(standardMacPrivatePrefix && index === 0)));
}

function pathInsideRoot(path: string, root: string): boolean {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  return absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot.replace(/[\\/]$/, "")}/`);
}

function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const safe = safeText(message);
  if (!safe || /(?:password|token|secret|cookie|authorization)/i.test(safe)) return fallback;
  return safe.slice(0, 240) || fallback;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

/** Stable path-free JSON intended for deterministic local reports. */
export function nativeScoreDiscoveryJson(report: NativeScoreDiscoveryReport): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

function baseId(input: NativeScoreArtifactInput, index: number): string {
  return safeId(input.id ?? input.label, `native-${index + 1}`);
}

function nativeInputFromResearch(candidate: NativeScoreResearchCandidate | ArrangementCandidate): NativeScoreArtifactInput | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const sourceType = typeof candidate.sourceType === "string" ? candidate.sourceType.toLowerCase() : "";
  const localPath = "localPath" in candidate && typeof candidate.localPath === "string" ? candidate.localPath : null;
  const url = "url" in candidate && typeof candidate.url === "string" ? candidate.url : null;
  const type = sourceType === "musicxml" ? "musicxml" : sourceType === "midi" ? "midi" : undefined;
  if (!type && !localPath && !url) return null;
  return {
    id: "id" in candidate ? candidate.id : null,
    path: localPath,
    url,
    artifactType: type,
    provenance: "provenance" in candidate ? candidate.provenance : null,
    version: "version" in candidate ? candidate.version : null,
    confidence: "confidence" in candidate ? candidate.confidence : null,
    permitted: "permitted" in candidate ? candidate.permitted === true : false,
    accessMethod: "source-research",
  };
}

function sidecarCandidates(value: unknown): NativeScoreArtifactInput[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  const candidates = Array.isArray(object.candidates) ? object.candidates : null;
  if (candidates) return candidates.filter((item): item is NativeScoreArtifactInput => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (object.artifactType || object.type || object.path || object.url || object.sourcePage) return [object as NativeScoreArtifactInput];
  return [];
}

function sidecarName(path: string): string | null {
  const name = basename(path);
  return name.toLowerCase().endsWith(".json") ? name.slice(0, -5) : null;
}

function metadataMatchesArtifact(metadata: NativeScoreArtifactInput, artifact: NativeScoreArtifactInput, sidecarPath: string | null, artifactCount: number): boolean {
  const explicitPath = typeof metadata.path === "string" ? metadata.path : null;
  if (explicitPath && typeof artifact.path === "string") return resolve(explicitPath) === resolve(artifact.path);
  if (metadata.id && artifact.id) return metadata.id === artifact.id;
  const named = sidecarPath ? sidecarName(sidecarPath) : null;
  if (named && artifact.path) return basename(artifact.path).toLowerCase() === named.toLowerCase();
  return artifactCount === 1;
}

function mergeInputs(base: NativeScoreArtifactInput, metadata: NativeScoreArtifactInput): NativeScoreArtifactInput {
  return {
    ...metadata,
    ...base,
    sourcePage: base.sourcePage ?? metadata.sourcePage,
    sourceUrl: base.sourceUrl ?? metadata.sourceUrl,
    artifactType: base.artifactType ?? base.type ?? metadata.artifactType ?? metadata.type,
    provenance: base.provenance ?? metadata.provenance,
    version: base.version ?? base.versionIdentity ?? metadata.version ?? metadata.versionIdentity,
    versionIdentity: base.versionIdentity ?? metadata.versionIdentity,
    accessMethod: base.accessMethod ?? metadata.accessMethod,
    page: base.page ?? base.pageNumber ?? metadata.page ?? metadata.pageNumber,
    confidence: base.confidence ?? metadata.confidence,
    label: base.label ?? metadata.label,
  };
}

function trustedProvenance(value: string | null): boolean {
  if (!value) return true;
  return !/(?:unknown|untrusted|unauthorized|fan[- ]?made|pirated|leak|torrent|scrape|random)/i.test(value);
}

function evidenceSort(left: NativeScoreEvidence, right: NativeScoreEvidence): number {
  return (right.trusted ? 1 : 0) - (left.trusted ? 1 : 0)
    || (right.hashStatus === "verified" ? 1 : 0) - (left.hashStatus === "verified" ? 1 : 0)
    || (right.confidence ?? -1) - (left.confidence ?? -1)
    || compareText(left.artifactType, right.artifactType)
    || compareText(left.id, right.id)
    || compareText(left.sha256 ?? "", right.sha256 ?? "")
    || compareText(left.discoveredFrom, right.discoveredFrom);
}

function normalizeOmr(input: readonly NativeScoreOmrInput[] | undefined): NativeScoreOmrEvidence[] {
  const byId = new Map<string, NativeScoreOmrEvidence>();
  for (const [index, item] of (input ?? []).entries()) {
    if (!item || typeof item !== "object") continue;
    const id = safeId(item.id ?? item.backend, `omr-${index + 1}`);
    const backend = safeText(item.backend) ?? id;
    const existing = byId.get(id);
    if (existing) continue;
    byId.set(id, {
      id,
      backend,
      version: safeText(item.version),
      status: safeText(item.status),
      confidence: clampConfidence(item.confidence),
      sourcePage: safeUrl(item.sourcePage),
    });
  }
  return [...byId.values()].sort((a, b) => compareText(a.id, b.id));
}

async function inspectPdf(pdfPath: string | null | undefined, metadata: NativeScorePdfMetadata | null | undefined, options: NativeScoreDiscoveryOptions): Promise<{ evidence: NativeScorePdfEvidence | null; errors: string[] }> {
  const errors: string[] = [];
  let detected: NativeScorePdfMetadata = {};
  let bytes: number | null = null;
  let sha256: string | null = null;
  let logicalName: string | null = null;
  if (pdfPath) {
    if (!isAbsolute(pdfPath)) {
      errors.push("PDF path must be absolute");
    } else if (isProtectedPath(pdfPath)) {
      errors.push("protected PDF path");
    } else {
      try {
        const physicalPath = await realpath(pdfPath);
        if (isProtectedPath(physicalPath)) {
          errors.push("protected PDF path");
          return { evidence: null, errors };
        }
        const info = await stat(physicalPath);
        if (!info.isFile()) errors.push("PDF is not a regular file");
        else if (info.size > DEFAULT_MAX_PDF_BYTES) errors.push("PDF exceeds local size limit");
        else {
          const data = await readFile(physicalPath);
          bytes = data.byteLength;
          sha256 = sha256Hex(data);
          logicalName = safeLogicalName(basename(physicalPath));
          detected = parsePdfMetadata(data);
        }
      } catch (error) {
        errors.push(safeError(error, "PDF metadata unavailable"));
      }
    }
  }
  const supplied = { ...detected, ...(metadata ?? {}) };
  const title = safeText(supplied.title);
  const author = safeText(supplied.author);
  const subject = safeText(supplied.subject);
  const keywords = typeof supplied.keywords === "string"
    ? supplied.keywords.split(/[,;]+/).map((value) => safeText(value)).filter((value): value is string => Boolean(value)).sort(compareText)
    : asArray<unknown>(supplied.keywords).map((value) => safeText(value)).filter((value): value is string => Boolean(value)).sort(compareText);
  const pages = positiveInteger(supplied.pages);
  if (!pdfPath && !title && !author && !subject && !keywords.length && pages === null) return { evidence: null, errors };
  return {
    evidence: {
      title,
      author,
      subject,
      keywords,
      pages,
      bytes,
      sha256,
      ...(options.includeLogicalNames && logicalName ? { logicalName } : {}),
    },
    errors,
  };
}

async function readSidecar(path: string, options: NativeScoreDiscoveryOptions): Promise<{ candidates: NativeScoreArtifactInput[]; errors: string[] }> {
  const errors: string[] = [];
  if (!isAbsolute(path)) return { candidates: [], errors: ["sidecar path must be absolute"] };
  if (isProtectedPath(path)) return { candidates: [], errors: ["protected sidecar path"] };
  try {
    const physicalPath = await realpath(path);
    if (isProtectedPath(physicalPath)) return { candidates: [], errors: ["protected sidecar path"] };
    const info = await stat(physicalPath);
    if (!info.isFile()) return { candidates: [], errors: ["sidecar is not a regular file"] };
    const maxSidecarBytes = finite(options.maxArtifactBytes) && options.maxArtifactBytes > 0
      ? Math.min(options.maxArtifactBytes, 4 * 1024 * 1024)
      : 4 * 1024 * 1024;
    if (info.size > maxSidecarBytes) return { candidates: [], errors: ["sidecar exceeds local size limit"] };
    const raw = JSON.parse((await readFile(physicalPath, "utf8")) as string) as unknown;
    return { candidates: sidecarCandidates(raw), errors };
  } catch (error) {
    void error;
    return { candidates: [], errors: ["sidecar metadata is malformed"] };
  }
}

async function inspectArtifact(
  input: NativeScoreArtifactInput,
  index: number,
  discoveredFrom: NativeScoreEvidence["discoveredFrom"],
  options: NativeScoreDiscoveryOptions,
): Promise<{ evidence: NativeScoreEvidence | null; rejected: NativeScoreRejectedEvidence | null }> {
  const id = baseId(input, index);
  const path = typeof input.path === "string" && input.path.trim() ? input.path.trim() : null;
  const url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : null;
  if (url && !path) return { evidence: null, rejected: { id, reason: "remote artifact access is disabled" } };
  if (!path) {
    const type = artifactType(input.artifactType ?? input.type);
    if (!type) return { evidence: null, rejected: { id, reason: "unsupported artifact type" } };
    const provenance = provenanceText(input.provenance);
    if (!trustedProvenance(provenance)) return { evidence: null, rejected: { id, reason: "untrusted native candidate" } };
    const suppliedHash = typeof input.sha256 === "string" && SAFE_HASH.test(input.sha256) ? input.sha256.toLowerCase() : null;
    return {
      evidence: {
        id,
        artifactType: type,
        provenance,
        version: safeText(input.version ?? input.versionIdentity),
        access: accessMethod(input.accessMethod, discoveredFrom === "sidecar" ? "sidecar" : "source-page"),
        accessMethod: accessMethod(input.accessMethod, discoveredFrom === "sidecar" ? "sidecar" : "source-page"),
        sourcePage: sourcePage(input),
        page: positiveInteger(input.page ?? input.pageNumber),
        bytes: finite(input.bytes) && input.bytes >= 0 ? input.bytes : null,
        sha256: suppliedHash,
        hashStatus: suppliedHash ? "supplied" : "unavailable",
        confidence: clampConfidence(input.confidence),
        trusted: false,
        ...(safeLogicalName(input.label) ? { logicalName: safeLogicalName(input.label)! } : {}),
        discoveredFrom,
      },
      rejected: null,
    };
  }
  if (!isAbsolute(path)) return { evidence: null, rejected: { id, reason: "relative artifact path" } };
  if (isProtectedPath(path)) return { evidence: null, rejected: { id, reason: "protected artifact path" } };
  if (input.permitted !== true) return { evidence: null, rejected: { id, reason: "local artifact is not explicitly permitted" } };
  let physicalPath: string;
  try {
    physicalPath = await realpath(path);
  } catch (error) {
    void error;
    return { evidence: null, rejected: { id, reason: "artifact is not a regular file" } };
  }
  if (isProtectedPath(physicalPath)) return { evidence: null, rejected: { id, reason: "protected artifact path" } };
  const roots = options.allowedRoots;
  if (roots?.length && !roots.some((root) => typeof root === "string" && isAbsolute(root) && pathInsideRoot(physicalPath, root))) {
    return { evidence: null, rejected: { id, reason: "local artifact is not explicitly permitted" } };
  }
  let info;
  try {
    info = await stat(physicalPath);
  } catch (error) {
    return { evidence: null, rejected: { id, reason: "artifact is not a regular file" } };
  }
  if (!info.isFile()) return { evidence: null, rejected: { id, reason: "artifact is not a regular file" } };
  const maxBytes = finite(options.maxArtifactBytes) && options.maxArtifactBytes > 0
    ? options.maxArtifactBytes
    : DEFAULT_MAX_ARTIFACT_BYTES;
  if (info.size > maxBytes) return { evidence: null, rejected: { id, reason: "artifact exceeds local size limit" } };
  const type = artifactType(input.artifactType ?? input.type, path);
  if (!type) return { evidence: null, rejected: { id, reason: "unsupported artifact type" } };
  const provenance = provenanceText(input.provenance);
  const version = safeText(input.version ?? input.versionIdentity);
  if (!trustedProvenance(provenance)) return { evidence: null, rejected: { id, reason: "untrusted native candidate" } };
  if (!provenance || !version) return { evidence: null, rejected: { id, reason: "native artifact requires provenance and version" } };
  try {
    const data = await readFile(physicalPath);
    if (!hasNativeFormatSignature(data, type)) return { evidence: null, rejected: { id, reason: "invalid artifact format" } };
    const hash = sha256Hex(data);
    const suppliedHash = typeof input.sha256 === "string" && SAFE_HASH.test(input.sha256) ? input.sha256.toLowerCase() : null;
    const trusted = suppliedHash === null || suppliedHash === hash;
    if (!trusted) return { evidence: null, rejected: { id, reason: "invalid artifact metadata" } };
    const logicalName = safeLogicalName(input.label) ?? safeLogicalName(basename(physicalPath));
    return {
      evidence: {
        id,
        artifactType: type,
        provenance,
        version,
        access: "local-file",
        accessMethod: "local-file",
        sourcePage: sourcePage(input),
        page: positiveInteger(input.page ?? input.pageNumber),
        bytes: data.byteLength,
        sha256: hash,
        hashStatus: "verified",
        confidence: clampConfidence(input.confidence),
        trusted: true,
        ...(options.includeLogicalNames && logicalName ? { logicalName } : {}),
        discoveredFrom,
      },
      rejected: null,
    };
  } catch (error) {
    return { evidence: null, rejected: { id, reason: "artifact is not a regular file" } };
  }
}

function deduplicateEvidence(candidates: readonly NativeScoreEvidence[]): NativeScoreEvidence[] {
  const byKey = new Map<string, NativeScoreEvidence>();
  for (const candidate of candidates) {
    const key = candidate.sha256 ? `${candidate.artifactType}:${candidate.sha256}` : `${candidate.id}:${candidate.artifactType}`;
    const previous = byKey.get(key);
    if (!previous || evidenceSort(candidate, previous) < 0) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort(evidenceSort);
}

function chooseNative(candidates: readonly NativeScoreEvidence[]): { selected: NativeScoreEvidence | null; status: NativeScoreDiscoveryStatus; reason: string } {
  const verified = candidates.filter((candidate) => candidate.trusted && candidate.hashStatus === "verified");
  if (!verified.length) return { selected: null, status: "review-required", reason: candidates.length ? "native artifact metadata requires local verification" : "no verified native symbolic artifact" };
  const sorted = [...verified].sort(evidenceSort);
  const first = sorted[0]!;
  const rank = (candidate: NativeScoreEvidence): string => JSON.stringify([
    candidate.trusted,
    candidate.hashStatus,
    candidate.confidence,
    candidate.artifactType,
    candidate.access,
  ]);
  const peers = sorted.filter((candidate) => rank(candidate) === rank(first));
  if (peers.length > 1) return { selected: null, status: "ambiguous", reason: "multiple native symbolic versions are similarly plausible" };
  return { selected: first, status: "native-symbolic", reason: "verified native symbolic artifact outranks OMR" };
}

function chooseOmr(omr: readonly NativeScoreOmrEvidence[]): { selected: null; status: NativeScoreDiscoveryStatus; reason: string } {
  if (omr.length >= 2) {
    const consensus = omr.filter((item) => item.status === "consensus" || item.status === "trusted-consensus").length;
    if (consensus || omr.every((item) => item.status === "pass" || item.status === "ok")) return { selected: null, status: "omr-consensus", reason: "independent OMR evidence is available" };
  }
  if (omr.length) return { selected: null, status: "single-omr", reason: "only one OMR evidence lane is available" };
  return { selected: null, status: "failed", reason: "no trusted native or OMR evidence" };
}

/**
 * Discover source-native symbolic evidence without downloading or publishing
 * musical artifacts. All physical paths are consumed only for local reads and
 * are absent from the returned report.
 */
export async function discoverNativeScoreArtifacts(
  input: NativeScoreDiscoveryInput = {},
  options: NativeScoreDiscoveryOptions = {},
): Promise<NativeScoreDiscoveryReport> {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const config = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const errors: string[] = [];
  const pdfResult = await inspectPdf(request.pdfPath, request.pdfMetadata, config);
  errors.push(...pdfResult.errors);

  const directArtifacts = [
    ...asArray<NativeScoreArtifactInput>(request.nativeArtifacts).map((value) => ({ value, from: "native-artifact" as const })),
    ...asArray<NativeScoreArtifactInput>(request.permittedArtifacts).map((value) => ({ value, from: "native-artifact" as const })),
    ...asArray<NativeScoreArtifactInput>(request.pdfMetadata?.nativeArtifacts).map((value) => ({ value, from: "pdf-metadata" as const })),
  ].filter((item): item is { value: NativeScoreArtifactInput; from: "native-artifact" | "pdf-metadata" } => Boolean(item.value && typeof item.value === "object" && !Array.isArray(item.value)));
  const sidecarMetadata: Array<{ metadata: NativeScoreArtifactInput; path: string | null }> = [];
  for (const [index, sidecar] of asArray<NativeScoreSidecar>(request.sidecars).entries()) {
    if (typeof sidecar === "string") {
      const result = await readSidecar(sidecar, config);
      errors.push(...result.errors);
      for (const candidate of result.candidates) sidecarMetadata.push({ metadata: candidate, path: sidecar });
    } else if (sidecar && typeof sidecar === "object") {
      const sidecarPath = typeof sidecar.path === "string" ? sidecar.path : null;
      const sidecarArtifact = sidecar as NativeScoreArtifactInput;
      if (sidecarArtifact.artifactType || sidecarArtifact.type || sidecarArtifact.sourcePage || sidecarArtifact.sourceUrl) {
        sidecarMetadata.push({ metadata: sidecarArtifact, path: null });
      }
      if (sidecarPath) {
        const result = await readSidecar(sidecarPath, config);
        errors.push(...result.errors);
        for (const candidate of result.candidates) sidecarMetadata.push({ metadata: candidate, path: sidecarPath });
      }
      if ("metadata" in sidecar && sidecar.metadata && typeof sidecar.metadata === "object") sidecarMetadata.push({ metadata: sidecar.metadata, path: sidecarPath });
      if ("candidates" in sidecar) for (const candidate of asArray<NativeScoreArtifactInput>(sidecar.candidates)) {
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) sidecarMetadata.push({ metadata: candidate, path: sidecarPath });
      }
    } else {
      errors.push(`sidecar ${index + 1} metadata is malformed`);
    }
  }

  const mergedArtifacts = directArtifacts.map((item) => {
    const metadata = sidecarMetadata.find((entry) => metadataMatchesArtifact(entry.metadata, item.value, entry.path, sidecarMetadata.length));
    return { value: metadata ? mergeInputs(item.value, metadata.metadata) : item.value, from: item.from };
  });
  const consumedMetadata = new Set(sidecarMetadata.filter((entry) => mergedArtifacts.some((artifact) => metadataMatchesArtifact(entry.metadata, artifact.value, entry.path, sidecarMetadata.length))).map((entry) => entry.metadata));
  const sidecarOnly = sidecarMetadata.filter((entry) => !consumedMetadata.has(entry.metadata)).map((entry) => ({
    ...entry.metadata,
    accessMethod: entry.metadata.accessMethod ?? "sidecar",
  }));

  const research = [
    ...asArray<NativeScoreResearchCandidate | ArrangementCandidate>(request.sourceResearchCandidates),
    ...asArray<NativeScoreResearchCandidate | ArrangementCandidate>(request.candidates),
  ].map(nativeInputFromResearch).filter((item): item is NativeScoreArtifactInput => Boolean(item));

  const evidence: NativeScoreEvidence[] = [];
  const rejected: NativeScoreRejectedEvidence[] = [];
  const inputs: Array<{ value: NativeScoreArtifactInput; from: NativeScoreEvidence["discoveredFrom"] }> = [
    ...mergedArtifacts.map((item) => ({ value: item.value, from: item.from })),
    ...sidecarOnly.map((value) => ({ value, from: "sidecar" as const })),
    ...research.map((value) => ({ value, from: "source-research" as const })),
  ];
  for (const [index, item] of inputs.entries()) {
    const result = await inspectArtifact(item.value, index, item.from, config);
    if (result.evidence) evidence.push(result.evidence);
    if (result.rejected) rejected.push(result.rejected);
  }

  const candidates = deduplicateEvidence(evidence);
  const omr = normalizeOmr(asArray<NativeScoreOmrInput>(request.omr));
  let selection = chooseNative(candidates);
  let selected = selection.selected;
  if (!selected && selection.status === "review-required" && !candidates.length) {
    selection = chooseOmr(omr);
    selected = null;
  }
  const report: NativeScoreDiscoveryReport = {
    schemaVersion: NATIVE_SCORE_DISCOVERY_SCHEMA_VERSION,
    status: selection.status,
    selectionReason: selection.reason,
    pdf: pdfResult.evidence,
    selected,
    candidates,
    rejected: rejected.sort((a, b) => compareText(a.id, b.id) || compareText(a.reason, b.reason)),
    omr,
    errors: [...new Set(errors)].sort(compareText),
  };
  if (report.status === "review-required" && report.errors.length && !report.candidates.length && !report.omr.length) report.status = "failed";
  return report;
}

/** Short alias for callers that prefer the noun used in the design brief. */
export const discoverNativeSymbolicArtifacts = discoverNativeScoreArtifacts;
export const discoverNativeSymbolicScore = discoverNativeScoreArtifacts;
export const discoverNativeScore = discoverNativeScoreArtifacts;

/** Metadata-only pure ranking helper for already-normalized native evidence. */
export function rankNativeScoreCandidates(candidates: readonly NativeScoreEvidence[]): NativeScoreEvidence[] {
  return deduplicateEvidence(candidates);
}
