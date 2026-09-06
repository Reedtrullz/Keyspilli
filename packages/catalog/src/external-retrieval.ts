import { sha256Hex } from "./fixture-evidence.js";
import type { ExternalResearchDiscoveryRecord } from "./external-research.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Version of the metadata-first external retrieval contract. */
export const EXTERNAL_RETRIEVAL_SCHEMA_VERSION = 1 as const;

/** Product-facing states. None of these states imply that an arrangement is musically accepted. */
export const EXTERNAL_RETRIEVAL_STATUSES = [
  "FOUND_ACCESSIBLE_SYMBOLIC",
  "FOUND_METADATA_ONLY",
  "FOUND_PIANO_COVER",
  "NO_EXTERNAL_SOURCE",
  "USER_EVIDENCE_AVAILABLE",
] as const;
export type ExternalRetrievalStatus = (typeof EXTERNAL_RETRIEVAL_STATUSES)[number];
export type ExternalRetrievalClassificationStatus = ExternalRetrievalStatus;
export type ExternalRetrievalState = ExternalRetrievalStatus;

export type ExternalRetrievalFormat = "midi" | "musicxml" | "mxl" | null;
export type ExternalRetrievalMagicKind = "midi" | "musicxml" | "mxl" | "html" | "empty" | "unknown";

export type ExternalRetrievalBody =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null;

export type ExternalRetrievalHeaders =
  | Headers
  | Readonly<Record<string, string | readonly string[] | null | undefined>>;

export interface ExternalRetrievalRedirect {
  url?: string | null;
  location?: string | null;
  status?: number | null;
}

/** A response-shaped seam keeps tests and local research independent of fetch. */
export interface ExternalRetrievalResponseInput {
  status?: number | null;
  /** Alias retained for acquisition logs that use the explicit name. */
  httpStatus?: number | null;
  ok?: boolean;
  url?: string | null;
  finalUrl?: string | null;
  redirected?: boolean;
  headers?: ExternalRetrievalHeaders | null;
  contentType?: string | null;
  contentLength?: number | string | null;
  redirects?: readonly (string | ExternalRetrievalRedirect)[];
  authRequired?: boolean;
  bytes?: ExternalRetrievalBody;
  body?: ExternalRetrievalBody;
  payload?: ExternalRetrievalBody;
  content?: ExternalRetrievalBody;
}

/**
 * Metadata and bytes supplied by a caller. The classifier never discovers a
 * URL, invokes a parser, or silently downloads a source. `response` is a
 * convenience for callers that already have a Response-like record.
 */
export interface ExternalRetrievalInput {
  id?: string | null;
  initialUrl?: string | null;
  /** Alias accepted by callers that use `url` for the first request URL. */
  url?: string | null;
  finalUrl?: string | null;
  status?: number | null;
  /** Alias for status used by acquisition logs. */
  httpStatus?: number | null;
  ok?: boolean;
  headers?: ExternalRetrievalHeaders | null;
  contentType?: string | null;
  contentLength?: number | string | null;
  redirects?: readonly (string | ExternalRetrievalRedirect)[];
  bytes?: ExternalRetrievalBody;
  body?: ExternalRetrievalBody;
  payload?: ExternalRetrievalBody;
  content?: ExternalRetrievalBody;
  response?: ExternalRetrievalResponseInput | null;
  filename?: string | null;
  extension?: string | null;
  format?: string | null;
  title?: string | null;
  artist?: string | null;
  provider?: string | null;
  description?: string | null;
  sourceRef?: string | null;
  /** Local path aliases are accepted for metadata-only inspection only; this
   * module never reads or emits the physical path. */
  path?: string | null;
  filePath?: string | null;
  localFilePath?: string | null;
  sourceType?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  /** Explicit user-provided material; it is never inferred from a local path. */
  userSupplied?: boolean;
  provenanceClass?: string | null;
  source?: "user" | "external" | "local" | string | null;
  purpose?: string | null;
  evidenceClass?: string | null;
  /** Explicit marker used by callers carrying an evaluation-only manifest. */
  benchmarkReference?: boolean;
  evaluationOnly?: boolean;
  authRequired?: boolean;
  error?: string | null;
}

export interface ExternalAcquisitionDiagnostics {
  initialUrl: string | null;
  /** HTTP response status, if one was supplied. */
  status: number | null;
  /** Alias retained for reports that name this field `httpStatus`. */
  httpStatus: number | null;
  redirects: string[];
  finalUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  /** Short, non-binary header/sniff marker (`MThd`, `score-partwise`, `html`, ...). */
  magic: string;
  /** Normalized interpretation of `magic`. */
  magicKind: ExternalRetrievalMagicKind;
  /** Extension-derived hint, without a leading dot. */
  extension: string | null;
  /** Whether body/headers/status indicate login, paywall, or authorization. */
  authRequired: boolean;
}

export interface ExternalRetrievalClassification {
  schemaVersion: typeof EXTERNAL_RETRIEVAL_SCHEMA_VERSION;
  id?: string | null;
  status: ExternalRetrievalStatus;
  /** Alias useful to callers that use `classification` for the product state. */
  classification: ExternalRetrievalStatus;
  format: ExternalRetrievalFormat;
  detectedFormat: ExternalRetrievalFormat;
  diagnostics: ExternalAcquisitionDiagnostics;
  /** Alias for acquisition-oriented consumers. */
  acquisition: ExternalAcquisitionDiagnostics;
  /** Alias retained for report builders that use the full field name. */
  acquisitionDiagnostics: ExternalAcquisitionDiagnostics;
  title: string | null;
  artist: string | null;
  provider: string | null;
  sourceRef: string | null;
  contentSha256: string | null;
  byteLength: number | null;
  /** True for HTML/metadata pages; false for no source and symbolic bytes. */
  metadataOnly: boolean;
  /** A strict byte-signature gate. This does not parse or validate a score. */
  parserEligible: boolean;
  /** Always false here until an independent alignment/candidate-freeze step runs. */
  generationEligible: boolean;
  userEvidence: boolean;
  /** Alias for callers that use a status-oriented field name. */
  userEvidenceAvailable: boolean;
  benchmarkProtected: boolean;
  reasons: string[];
  warnings: string[];
  rejectionReasons: string[];
  /** Available only when requested via retrieveExternalSource({ retainBytes: true }); never serialized. */
  readonly bytes?: Uint8Array;
}

export type ExternalRetrievalResult = ExternalRetrievalClassification;
export type ExternalRetrievalDiagnostics = ExternalAcquisitionDiagnostics;
export type ExternalAcquisitionDiagnostic = ExternalAcquisitionDiagnostics;

export interface ExternalRetrievalOptions {
  /** Network access is opt-in and has no credential/header escape hatch. */
  allowNetwork?: boolean;
  /** Test seam or a locally wrapped fetch implementation. */
  fetch?: typeof globalThis.fetch;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** Keep the bounded payload on the result for the parser/intake seam. */
  retainBytes?: boolean;
}

export type ExternalRetrievalRequest = ExternalRetrievalInput;

const MAX_SNIFF_BYTES = 128 * 1024;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const SYMBOLIC_EXTENSIONS: Readonly<Record<string, ExternalRetrievalFormat>> = {
  mid: "midi",
  midi: "midi",
  musicxml: "musicxml",
  xml: "musicxml",
  mxl: "mxl",
};
const SYMBOLIC_MIME: Readonly<Record<string, ExternalRetrievalFormat>> = {
  "audio/midi": "midi",
  "audio/mid": "midi",
  "audio/x-midi": "midi",
  "application/x-midi": "midi",
  "application/midi": "midi",
  "application/vnd.recordare.musicxml+xml": "musicxml",
  "application/vnd.recordare.musicxml": "mxl",
  "application/xml": "musicxml",
  "text/xml": "musicxml",
  "application/octet-stream": null,
  "binary/octet-stream": null,
};

function cleanText(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    // Query strings frequently contain signed URLs, tokens, or user IDs. The
    // path and host are enough for diagnostics and remain stable between runs.
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Return the URL used for an explicitly authorised fetch. Credentials are
 * never sent from this seam, but query parameters must remain intact because
 * signed/download URLs commonly carry their authorisation in the query.
 * Diagnostics use publicUrl(), which deliberately removes query/hash data.
 */
function operationalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function privateNetworkUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" || hostname === "::") return true;
    if (/^(?:10|127)\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) return true;
    const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((octet) => octet > 255)) return true;
      if (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) return true;
    }
    // Node exposes IPv4-mapped IPv6 literals as `::ffff:a.b.c.d`. Treat the
    // mapped address as its IPv4 target so loopback/private destinations cannot
    // bypass the egress guard with bracketed IPv6 syntax.
    const mapped = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mapped && privateNetworkUrl(`http://${mapped}/`)) return true;
    // WHATWG URL normalizes the dotted spelling above to hexadecimal groups
    // (for example `::ffff:127.0.0.1` becomes `::ffff:7f00:1`). Decode that
    // representation before applying the same IPv4 policy.
    const mappedHex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1]!, 16);
      const low = Number.parseInt(mappedHex[2]!, 16);
      const dotted = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
      if (privateNetworkUrl(`http://${dotted}/`)) return true;
    }
    return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(hostname);
  } catch {
    return true;
  }
}

/** Resolve a redirect for the next request while keeping signed query data. */
function operationalRedirectUrl(value: string | ExternalRetrievalRedirect, base: string | null): string | null {
  const raw = typeof value === "string" ? value : value.url ?? value.location;
  if (!raw) return null;
  try {
    return operationalUrl(base ? new URL(raw, base).toString() : raw);
  } catch {
    return operationalUrl(raw);
  }
}

function hasSensitiveLogicalSourceRef(value: string): boolean {
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

function logicalSourceRef(value: unknown): string | null {
  const clean = cleanText(value);
  if (/^https?:\/\//i.test(clean ?? "")) return publicUrl(clean);
  if (clean && hasSensitiveLogicalSourceRef(clean)) return null;
  const logicalScheme = clean ? /^[A-Za-z][A-Za-z0-9+.-]*:/.test(clean) : false;
  if (!clean || /^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])/.test(clean)
    || (logicalScheme && /:\s*(?:[\\/]|~[\\/]|\.{1,2}[\\/])/.test(clean))
    || (!logicalScheme && /(?:^|[\\/])[^\\/]+\.(?:mid|midi|musicxml|xml|mxl|wav|mp3|json)(?:[?#].*)?$/i.test(clean))) return null;
  return clean;
}

function headerValue(headers: ExternalRetrievalHeaders | null | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return cleanText((headers as Headers).get(name));
  }
  const wanted = name.toLowerCase();
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(raw)) return cleanText(raw[0]);
    return cleanText(raw);
  }
  return null;
}

function normalizeMime(value: unknown): string | null {
  const clean = cleanText(value, 160)?.toLowerCase();
  if (!clean) return null;
  return clean.split(";", 1)[0]!.trim() || null;
}

function normalizeExtension(value: unknown): string | null {
  const clean = cleanText(value, 120)?.toLowerCase().replace(/^\./, "");
  if (!clean) return null;
  return SYMBOLIC_EXTENSIONS[clean] ? clean : clean.match(/^[a-z0-9]{1,12}$/)?.[0] ?? null;
}

function extensionFrom(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const source = value.trim();
  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    pathname = source.split(/[?#]/, 1)[0]!;
  }
  const match = pathname.match(/\.([A-Za-z0-9]{1,12})$/);
  return normalizeExtension(match?.[1]);
}

function formatHint(value: unknown): ExternalRetrievalFormat {
  const normalized = normalizeExtension(value);
  return normalized ? SYMBOLIC_EXTENSIONS[normalized] ?? null : null;
}

function formatFromMime(value: string | null): ExternalRetrievalFormat {
  return value ? SYMBOLIC_MIME[value] ?? null : null;
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (typeof value === "string") return new TextEncoder().encode(value);
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function validMidiHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || ascii(bytes, 0, 4) !== "MThd") return false;
  const headerLength = (((bytes[4]! << 24) >>> 0) + (bytes[5]! << 16) + (bytes[6]! << 8) + bytes[7]!);
  const format = (bytes[8]! << 8) | bytes[9]!;
  const tracks = (bytes[10]! << 8) | bytes[11]!;
  const division = (bytes[12]! << 8) | bytes[13]!;
  // This is only a bounded signature check; native-score-adapter remains the
  // authority for strict MIDI parsing after retrieval classification.
  return headerLength === 6 && format <= 2 && tracks > 0 && tracks <= 512 && division !== 0;
}

function u16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0;
}

/**
 * Check the bounded ZIP structure expected by compressed MusicXML (MXL).
 * A four-byte PK prefix is not enough: accepting it would mark arbitrary ZIP
 * downloads parser-eligible and defer the failure to a later parser. We do
 * not decompress entries here; the native adapter remains responsible for
 * parsing the container contents.
 */
function validMxlContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) return false;
  const searchStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return false;
  const disk = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const entries = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  const commentLength = u16(bytes, eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entries || entries === null || entries === 0
    || centralSize === null || centralOffset === null || commentLength === null
    || eocd + 22 + commentLength > bytes.length
    || centralOffset + centralSize > eocd) return false;

  let offset = centralOffset;
  let parsedEntries = 0;
  let hasContainer = false;
  let hasRootMusicXml = false;
  const decoder = new TextDecoder();
  while (parsedEntries < entries) {
    if (u32(bytes, offset) !== 0x02014b50 || offset + 46 > bytes.length) return false;
    const compressedSize = u32(bytes, offset + 20);
    const filenameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLengthEntry = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    if (compressedSize === null || filenameLength === null || extraLength === null || commentLengthEntry === null || localOffset === null) return false;
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLengthEntry;
    if (entryEnd > bytes.length || entryEnd > centralOffset + centralSize || localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50) return false;
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + filenameLength)).replaceAll("\\", "/").toLowerCase();
    if (!name || name.endsWith("/")) return false;
    if (name === "meta-inf/container.xml") hasContainer = true;
    if (name !== "meta-inf/container.xml" && /\.(?:xml|musicxml)$/.test(name)) hasRootMusicXml = true;
    // The central directory's compressed size must fit after its local header
    // when the entry uses the normal non-ZIP64 representation. ZIP64 values
    // are rejected here and can be handled by a future bounded adapter.
    const localFilenameLength = u16(bytes, localOffset + 26);
    const localExtraLength = u16(bytes, localOffset + 28);
    if (localFilenameLength === null || localExtraLength === null
      || localOffset + 30 + localFilenameLength + localExtraLength + compressedSize > bytes.length) return false;
    offset = entryEnd;
    parsedEntries += 1;
  }
  return offset === centralOffset + centralSize && hasContainer && hasRootMusicXml;
}

interface MagicDetection {
  kind: ExternalRetrievalMagicKind;
  marker: string;
  valid: boolean;
}

function detectMagic(bytes: Uint8Array | null): MagicDetection {
  if (!bytes || bytes.length === 0) return { kind: "empty", marker: "empty", valid: false };
  if (ascii(bytes, 0, 4) === "MThd") {
    return validMidiHeader(bytes)
      ? { kind: "midi", marker: "MThd", valid: true }
      : { kind: "unknown", marker: "MThd", valid: false };
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08))) {
    return validMxlContainer(bytes)
      ? { kind: "mxl", marker: "PK", valid: true }
      : { kind: "unknown", marker: "PK", valid: false };
  }
  const text = new TextDecoder().decode(bytes.slice(0, MAX_SNIFF_BYTES)).replace(/^\uFEFF/, "");
  const trimmed = text.trimStart();
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(trimmed)
    || /<\/(?:html|body)>/i.test(text) && /<(?:html|body)\b/i.test(text)) {
    return { kind: "html", marker: "html", valid: false };
  }
  if (/<score-partwise\b/i.test(text) && /<\/score-partwise\s*>/i.test(text)) {
    return { kind: "musicxml", marker: "score-partwise", valid: true };
  }
  return { kind: "unknown", marker: /<\?xml\b/i.test(text) ? "xml" : "unknown", valid: false };
}

function normalizeStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) return null;
  return value;
}

function normalizeLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(value);
}

function parseLength(value: unknown): number | null {
  if (typeof value === "number") return normalizeLength(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return normalizeLength(Number(value.trim()));
  return null;
}

function redirectUrl(value: string | ExternalRetrievalRedirect, base: string | null): string | null {
  const raw = typeof value === "string" ? value : value.url ?? value.location;
  if (!raw) return null;
  try {
    return publicUrl(base ? new URL(raw, base).toString() : raw);
  } catch {
    return publicUrl(raw);
  }
}

function normalizedRedirects(values: readonly (string | ExternalRetrievalRedirect)[] | undefined, initialUrl: string | null): { values: string[]; malformed: boolean } {
  const output: string[] = [];
  let malformed = false;
  let base = initialUrl;
  for (const value of values ?? []) {
    if (typeof value !== "string" && (!value || typeof value !== "object" || Array.isArray(value))) {
      malformed = true;
      continue;
    }
    const raw = typeof value === "string" ? value : value.url ?? value.location;
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      malformed = true;
      continue;
    }
    const next = redirectUrl(value, base);
    if (!next || output.at(-1) === next) {
      if (!next) malformed = true;
      if (next) base = next;
      continue;
    }
    output.push(next);
    base = next;
  }
  return { values: output, malformed };
}

function metadataText(input: ExternalRetrievalInput, bodyText: string): string {
  const values: unknown[] = [input.title, input.artist, input.description, input.sourceType, input.provider, input.initialUrl, input.url, input.finalUrl];
  if (input.metadata) values.push(...Object.values(input.metadata));
  values.push(bodyText.slice(0, 16_000));
  return values.filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
}

function hasPianoCoverSignal(input: ExternalRetrievalInput, bodyText: string): boolean {
  const haystack = metadataText(input, bodyText);
  return /\b(?:piano\s+(?:cover|tutorial|performance|version)|solo\s+piano|keyboard\s+(?:cover|performance)|synthesia|falling\s+notes|piano-cover-video|piano-cover-audio)\b/i.test(haystack)
    || input.sourceType === "piano-cover-video"
    || input.sourceType === "piano-cover-audio"
    || input.sourceType === "piano-cover";
}

function authSignal(input: ExternalRetrievalInput, diagnostics: Pick<ExternalAcquisitionDiagnostics, "status" | "finalUrl">, headers: ExternalRetrievalHeaders | null | undefined, bodyText: string): boolean {
  if (input.authRequired === true) return true;
  if (diagnostics.status === 401 || diagnostics.status === 403 || diagnostics.status === 407) return true;
  if (headerValue(headers, "www-authenticate")) return true;
  const url = diagnostics.finalUrl ?? input.initialUrl ?? input.url ?? "";
  if (/\/(?:login|log-in|signin|sign-in|auth|account|subscribe|subscription|paywall|premium)(?:[/?#]|$)/i.test(url)) return true;
  // Keep this bounded to avoid echoing or persisting an entire remote page.
  return /\b(?:please\s+sign\s*in|sign\s*in\s+to|log\s*in\s+to|login\s+required|authentication\s+required|unauthori[sz]ed|paywall|premium\s+(?:access|required)|subscription\s+required|captcha)\b/i.test(bodyText.slice(0, 16_000));
}

function protectedMarker(input: ExternalRetrievalInput): boolean {
  // Marker fields are a trust boundary. A malformed truthy/falsy value must
  // not be coerced into an unprotected retrieval result.
  if (input.benchmarkReference !== undefined && typeof input.benchmarkReference !== "boolean") return true;
  if (input.evaluationOnly !== undefined && typeof input.evaluationOnly !== "boolean") return true;
  if (input.benchmarkReference === true || input.evaluationOnly === true) return true;
  if (input.purpose !== undefined && input.purpose !== null && (typeof input.purpose !== "string" || input.purpose.trim().toUpperCase() === "BENCHMARK_REFERENCE")) return true;
  if (input.evidenceClass !== undefined && input.evidenceClass !== null && (typeof input.evidenceClass !== "string" || input.evidenceClass.trim().toUpperCase() === "BENCHMARK_REFERENCE")) return true;
  return false;
}

function safeReason(value: string): string {
  return value
    // Redact complete spaced file URIs before the narrower token rule below;
    // otherwise `file:///private/My Folder/...` would leave `Folder/...`.
    .replace(/file:\/\/(?:(?:[A-Za-z]:[\\/])|(?:[\\/])|(?:~[\\/])|[^\\/\\\s]+[\\/])(?=[^,;)}\]]*[\\/])[^,;)}\]]*/gi, "[redacted-path]")
    .replace(/(?<![A-Za-z0-9:/])\/(?=[^,;)}\]]*[\\/])[^,;)}\]]*/gi, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\|~[\\/])(?=[^,;)}\]]*\s[^,;)}\]]*[\\/])[^,;)}\]]*/gi, "[redacted-path]")
    .replace(/file:\/\/[^\s,;)}\]]+/gi, "[redacted-path]")
    .replace(/((?:^|[\s"'(:]))(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/(?:Users|private|tmp|var|home|Volumes|workspace|opt|root|srv|etc|mnt|data)(?:[\\/]|$))[^\s,;)}\]]+/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?)(?:\?[^\s#]*)/gi, "$1")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map(safeReason).filter(Boolean))].sort(compareText);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function mergedResponse(input: ExternalRetrievalInput): ExternalRetrievalResponseInput {
  return input.response ?? {};
}

function retainBytes(result: ExternalRetrievalClassification, value: unknown): ExternalRetrievalClassification {
  const bytes = asBytes(value);
  if (result.parserEligible && bytes) Object.defineProperty(result, "bytes", { value: bytes, enumerable: false });
  return result;
}

/**
 * Classify an already supplied response or local byte buffer. This function is
 * deliberately parser-free: only a bounded signature sniff can promote a
 * response to accessible symbolic evidence.
 */
export function classifyExternalRetrieval(input: ExternalRetrievalInput | string = {}, responseInput?: ExternalRetrievalResponseInput): ExternalRetrievalClassification {
  const request: ExternalRetrievalInput = typeof input === "string"
    ? { initialUrl: input, response: responseInput ?? null }
    : input;
  const response = mergedResponse(request);
  const initialUrl = publicUrl(request.initialUrl ?? request.url);
  const responseFinalUrl = publicUrl(response.finalUrl ?? response.url);
  const finalUrl = publicUrl(request.finalUrl) ?? responseFinalUrl ?? initialUrl;
  const status = normalizeStatus(request.httpStatus ?? request.status ?? response.httpStatus ?? response.status)
    ?? (request.ok === true || response.ok === true ? 200 : null);
  const responseFailed = request.ok === false || response.ok === false;
  const headers = request.headers ?? response.headers;
  const contentType = normalizeMime(request.contentType ?? headerValue(headers, "content-type") ?? response.contentType);
  const suppliedBody = request.bytes ?? request.body ?? request.payload ?? request.content
    ?? response.bytes ?? response.body ?? response.payload ?? response.content;
  const bytes = asBytes(suppliedBody);
  const magic = detectMagic(bytes);
  const bodyText = bytes ? new TextDecoder().decode(bytes.slice(0, MAX_SNIFF_BYTES)) : "";
  const extension = normalizeExtension(request.extension) ?? extensionFrom(request.filename) ?? extensionFrom(finalUrl) ?? extensionFrom(initialUrl);
  const explicitFormat = formatHint(request.format);
  const mimeFormat = formatFromMime(contentType);
  const extensionFormat = extension ? SYMBOLIC_EXTENSIONS[extension] ?? null : null;
  const detectedFormat: ExternalRetrievalFormat = magic.valid
    ? magic.kind === "midi" ? "midi" : magic.kind === "musicxml" ? "musicxml" : magic.kind === "mxl" ? "mxl" : null
    : null;
  const format = detectedFormat ?? explicitFormat ?? mimeFormat ?? extensionFormat;
  const contentLength = parseLength(request.contentLength ?? response.contentLength)
    ?? parseLength(headerValue(headers, "content-length"))
    ?? (bytes ? bytes.byteLength : null);
  const normalized = normalizedRedirects(request.redirects ?? response.redirects, initialUrl);
  const redirects = normalized.values;
  if (!redirects.length && initialUrl && finalUrl && initialUrl !== finalUrl && (request.finalUrl || response.redirected || responseFinalUrl)) redirects.push(finalUrl);
  const diagnostics: ExternalAcquisitionDiagnostics = {
    initialUrl,
    status,
    httpStatus: status,
    redirects,
    finalUrl,
    contentType,
    contentLength,
    magic: magic.marker,
    magicKind: magic.kind,
    extension,
    authRequired: false,
  };
  diagnostics.authRequired = authSignal({ ...request, authRequired: request.authRequired === true || response.authRequired === true }, diagnostics, headers, bodyText);

  const benchmarkProtected = protectedMarker(request);
  const userEvidence = request.userSupplied === true || request.source === "user" || request.provenanceClass === "USER_SUPPLIED_GENERATION_EVIDENCE";
  const sourceExists = Boolean(initialUrl || finalUrl || request.title || request.provider || request.sourceRef || request.sourceType
    || request.path || request.filePath || request.localFilePath || status !== null || bytes);
  const httpSuccess = !responseFailed && (status === null || (status >= 200 && status < 300));
  const httpMissing = status === 404 || status === 410;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rejectionReasons: string[] = [];

  if (responseFailed) reasons.push("response was marked not ok");
  if (normalized.malformed) {
    reasons.push("redirect metadata was malformed or invalid");
    rejectionReasons.push("malformed redirect metadata");
  }
  if (status !== null && !httpSuccess) reasons.push(`HTTP status ${status} did not return an accessible response`);
  if (httpMissing) reasons.push("external source was not found");
  if (request.error) reasons.push(`retrieval error: ${safeReason(cleanText(request.error, 180) ?? "unknown error")}`);
  if (diagnostics.authRequired) {
    reasons.push("authentication or paywall is required; acquisition was not bypassed");
    rejectionReasons.push("authentication-required source is metadata-only");
  }
  if (bytes?.byteLength === 0) reasons.push("response body is empty");
  if (magic.kind === "html") {
    reasons.push("response body is HTML, not symbolic bytes; parser was not invoked");
    rejectionReasons.push("HTML or landing-page response is metadata-only");
  }
  if (magic.marker === "MThd" && !magic.valid) {
    reasons.push("MIDI header marker is present but the bounded header check is invalid");
    rejectionReasons.push("invalid MIDI magic/header");
  }
  if (bytes && magic.kind === "unknown" && bytes.byteLength > 0) {
    reasons.push("response bytes do not have a recognized MIDI, MusicXML, or MXL header");
    rejectionReasons.push("invalid symbolic magic/header");
  }
  if (mimeFormat && !magic.valid && bytes && bytes.byteLength > 0) {
    reasons.push(`Content-Type ${contentType} claims ${mimeFormat} but magic/header validation failed`);
  }
  if (detectedFormat && contentType && mimeFormat !== detectedFormat && !SYMBOLIC_MIME[contentType]) {
    reasons.push(`Content-Type ${contentType} does not identify ${detectedFormat}; magic/header is authoritative`);
    warnings.push("symbolic bytes were identified despite a non-symbolic MIME type");
  } else if (detectedFormat && !contentType) {
    warnings.push("response omitted Content-Type; magic/header was used");
  }
  if (detectedFormat && extensionFormat && extensionFormat !== detectedFormat) {
    reasons.push(`file extension suggests ${extensionFormat} but magic/header identifies ${detectedFormat}`);
    warnings.push("magic/header took precedence over the file extension");
  }
  if (bytes && contentLength !== null && contentLength !== bytes.byteLength) {
    reasons.push(`Content-Length ${contentLength} differs from received body length ${bytes.byteLength}`);
    warnings.push("received body length differs from Content-Length");
  }
  if (redirects.length) warnings.push(`followed ${redirects.length} redirect${redirects.length === 1 ? "" : "s"}`);
  if (benchmarkProtected) {
    reasons.push("benchmark/reference evidence is protected and cannot enter retrieval or generation");
    rejectionReasons.push("benchmark/reference evidence cannot enter generation");
  }

  const accessibleSymbolic = Boolean(magic.valid && detectedFormat && httpSuccess && !diagnostics.authRequired && !benchmarkProtected && !request.error && !normalized.malformed);
  const pianoCover = Boolean(!accessibleSymbolic && httpSuccess && !diagnostics.authRequired && !benchmarkProtected && !httpMissing && hasPianoCoverSignal(request, bodyText));
  let resultStatus: ExternalRetrievalStatus;
  if (accessibleSymbolic && userEvidence) resultStatus = "USER_EVIDENCE_AVAILABLE";
  else if (accessibleSymbolic) resultStatus = "FOUND_ACCESSIBLE_SYMBOLIC";
  else if (pianoCover) resultStatus = "FOUND_PIANO_COVER";
  // A discovered URL that cannot be fetched (including the default
  // no-network mode) remains metadata-only. `NO_EXTERNAL_SOURCE` is reserved
  // for an absent source or an explicit not-found response.
  else if (!sourceExists || httpMissing) resultStatus = "NO_EXTERNAL_SOURCE";
  else resultStatus = "FOUND_METADATA_ONLY";

  const parserEligible = accessibleSymbolic || (Boolean(magic.valid && detectedFormat && httpSuccess && !diagnostics.authRequired && !request.error) && userEvidence && !benchmarkProtected);
  const result: ExternalRetrievalClassification = {
    schemaVersion: EXTERNAL_RETRIEVAL_SCHEMA_VERSION,
    id: cleanText(request.id),
    status: resultStatus,
    classification: resultStatus,
    format,
    detectedFormat,
    diagnostics,
    acquisition: diagnostics,
    acquisitionDiagnostics: diagnostics,
    title: cleanText(request.title),
    artist: cleanText(request.artist),
    provider: cleanText(request.provider),
    sourceRef: logicalSourceRef(request.sourceRef),
    contentSha256: bytes && bytes.byteLength ? sha256Hex(bytes) : null,
    byteLength: bytes?.byteLength ?? null,
    metadataOnly: resultStatus === "FOUND_METADATA_ONLY" || resultStatus === "FOUND_PIANO_COVER",
    parserEligible,
    // A retrieval result is never an alignment attestation. The separate
    // external-research/candidate-freeze boundary remains authoritative.
    generationEligible: false,
    userEvidence,
    userEvidenceAvailable: userEvidence,
    benchmarkProtected,
    reasons: uniqueSorted(reasons),
    warnings: uniqueSorted(warnings),
    rejectionReasons: uniqueSorted(rejectionReasons),
  };
  return result;
}

/** Alias for code that names the input a response rather than a retrieval. */
export const classifyExternalResponse = classifyExternalRetrieval;
/** Alias retained for callers that use a longer function name. */
export const classifyExternalRetrievalResponse = classifyExternalRetrieval;
export const classifyExternalSource = classifyExternalRetrieval;
export const classifyRetrievedExternalSource = classifyExternalRetrieval;
export const inspectExternalRetrieval = classifyExternalRetrieval;

function fetchBodyLimit(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array | null; truncated: boolean }> {
  const length = parseLength(response.headers.get("content-length"));
  if (length !== null && length > maxBytes) return Promise.resolve({ bytes: null, truncated: true });
  if (!response.body || typeof response.body.getReader !== "function") {
    return response.arrayBuffer().then((buffer) => {
      if (buffer.byteLength > maxBytes) return { bytes: null, truncated: true };
      return { bytes: new Uint8Array(buffer), truncated: false };
    });
  }
  return (async () => {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { bytes: null, truncated: true };
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, truncated: false };
  })();
}

function maxBound(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

/**
 * Optional public fetch adapter. Callers must explicitly opt in to network
 * access. Redirects are followed one at a time so the complete chain and
 * final URL can be recorded, and response bodies are bounded before sniffing.
 */
export async function retrieveExternalSource(input: ExternalRetrievalInput | string, options: ExternalRetrievalOptions = {}): Promise<ExternalRetrievalClassification> {
  const request: ExternalRetrievalInput = typeof input === "string" ? { initialUrl: input } : input;
  if (request.response || request.bytes !== undefined || request.body !== undefined || request.payload !== undefined || request.content !== undefined) {
    const supplied = request.bytes ?? request.body ?? request.payload ?? request.content
      ?? request.response?.bytes ?? request.response?.body ?? request.response?.payload ?? request.response?.content;
    const suppliedBytes = asBytes(supplied);
    const maxBytes = maxBound(options.maxBytes, DEFAULT_MAX_BYTES, 1, 128 * 1024 * 1024);
    if (suppliedBytes && suppliedBytes.byteLength > maxBytes) {
      const response = request.response
        ? { ...request.response, bytes: null, body: null, payload: null, content: null }
        : undefined;
      const result = classifyExternalRetrieval({
        ...request,
        bytes: null,
        body: null,
        payload: null,
        content: null,
        ...(response ? { response } : {}),
        error: `response exceeded the ${maxBytes}-byte retrieval limit`,
      });
      result.reasons = uniqueSorted([...result.reasons, "response body exceeded the bounded retrieval limit"]);
      result.rejectionReasons = uniqueSorted([...result.rejectionReasons, "response body was not retained because it exceeded the retrieval limit"]);
      return result;
    }
    const result = classifyExternalRetrieval(request);
    return options.retainBytes ? retainBytes(result, supplied) : result;
  }
  const requestUrl = operationalUrl(request.initialUrl ?? request.url);
  if (!requestUrl || options.allowNetwork !== true) {
    return classifyExternalRetrieval({ ...request, error: requestUrl ? "network acquisition is disabled by default" : request.error });
  }
  if (privateNetworkUrl(requestUrl)) {
    return classifyExternalRetrieval({ ...request, error: "network target is local or private and is blocked" });
  }
  if (protectedMarker(request)) return classifyExternalRetrieval(request);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return classifyExternalRetrieval({ ...request, error: "network fetch implementation is unavailable" });
  const maxBytes = maxBound(options.maxBytes, DEFAULT_MAX_BYTES, 1, 128 * 1024 * 1024);
  const maxRedirects = maxBound(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 10);
  const redirects: string[] = [];
  let current = requestUrl;
  const visitedOperationalUrls = new Set<string>([current]);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetchImpl(current, { redirect: "manual", signal: options.signal });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        const next = operationalRedirectUrl(location, current);
        const diagnosticNext = next ? publicUrl(next) : null;
        if (!next || privateNetworkUrl(next) || !diagnosticNext || visitedOperationalUrls.has(next)) {
          return classifyExternalRetrieval({ ...request, initialUrl: requestUrl, finalUrl: current, status: response.status, headers: response.headers, redirects, error: "redirect chain is invalid or cyclic" });
        }
        redirects.push(diagnosticNext);
        visitedOperationalUrls.add(next);
        current = next;
        continue;
      }
      const loaded = await fetchBodyLimit(response, maxBytes);
      const result = classifyExternalRetrieval({
        ...request,
        initialUrl: requestUrl,
        finalUrl: publicUrl(response.url) ?? current,
        status: response.status,
        headers: response.headers,
        redirects,
        bytes: loaded.bytes,
        error: loaded.truncated ? `response exceeded the ${maxBytes}-byte retrieval limit` : request.error,
      });
      if (loaded.truncated) {
        result.reasons = uniqueSorted([...result.reasons, "response body exceeded the bounded retrieval limit"]);
        result.rejectionReasons = uniqueSorted([...result.rejectionReasons, "response body was not retained because it exceeded the retrieval limit"]);
      }
      return options.retainBytes ? retainBytes(result, loaded.bytes) : result;
    }
    return classifyExternalRetrieval({ ...request, initialUrl: requestUrl, finalUrl: current, redirects, error: "redirect limit exceeded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network retrieval failed";
    return classifyExternalRetrieval({ ...request, initialUrl: requestUrl, finalUrl: current, redirects, error: message });
  }
}

export const fetchExternalRetrieval = retrieveExternalSource;
export const retrieveExternalArtifact = retrieveExternalSource;
export const retrieveExternalSymbolicCandidate = retrieveExternalSource;

/** Convert a retrieval result into the existing metadata-only discovery seam. */
export function toExternalResearchDiscoveryRecord(
  result: ExternalRetrievalClassification,
  input: Pick<ExternalRetrievalInput, "id" | "title" | "artist" | "provider" | "sourceRef" | "initialUrl" | "url" | "purpose" | "evidenceClass"> & { id?: string | null } = {},
): ExternalResearchDiscoveryRecord {
  const title = result.title ?? cleanText(input.title) ?? "External source";
  const sourceUrl = result.diagnostics.finalUrl ?? result.diagnostics.initialUrl ?? publicUrl(input.initialUrl ?? input.url);
  const sourceRef = result.sourceRef ?? logicalSourceRef(input.sourceRef) ?? (sourceUrl ? `url:${sourceUrl}` : "external:unknown");
  const symbolic = result.format !== null;
  const piano = result.status === "FOUND_PIANO_COVER";
  const benchmarkProtected = result.benchmarkProtected
    || input.purpose === "BENCHMARK_REFERENCE"
    || input.evidenceClass === "BENCHMARK_REFERENCE";
  return {
    id: cleanText(input.id),
    title,
    provider: result.provider ?? cleanText(input.provider),
    artist: cleanText(input.artist),
    sourceRef,
    sourcePage: sourceUrl,
    url: sourceUrl,
    format: symbolic ? result.format : piano ? "piano-cover" : null,
    purpose: benchmarkProtected ? "BENCHMARK_REFERENCE" : "RESEARCH_LEAD",
    evidenceClass: benchmarkProtected ? "BENCHMARK_REFERENCE" : symbolic ? "VERIFIED_NATIVE_SYMBOLIC" : piano ? "PIANO_COVER_SYMBOLIC" : "TAB_OR_CHORD_EVIDENCE",
    metadata: {
      retrievalStatus: result.status,
      benchmarkProtected,
      authRequired: result.diagnostics.authRequired,
      parserEligible: result.parserEligible,
      contentSha256: result.contentSha256,
      reasons: result.reasons,
    },
  };
}

/** Stable path-safe JSON; binary payloads are intentionally absent. */
export function serializeExternalRetrieval(result: ExternalRetrievalClassification): string {
  return `${JSON.stringify(stable(result), null, 2)}\n`;
}
