import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ParsedMidi } from "@keyspilli/midi";
import {
  assertGenerationEvidence,
  canonicalEvidenceCandidateSet,
  SHADOW_GENERATION_TRUTH,
  type ExternalEvidenceCandidate,
  type EvidenceFirewallOptions,
} from "./external-evidence.js";
import { sha256Hex } from "./fixture-evidence.js";

/** Version of the provider-neutral, metadata-only shadow corpus contract. */
export const SHADOW_CORPUS_SCHEMA_VERSION = 1 as const;

/** Re-export the purpose alongside the shadow manifest APIs. */
export { SHADOW_GENERATION_TRUTH } from "./external-evidence.js";

export const SHADOW_CORPUS_MEDIA_STATUSES = [
  "available",
  "present",
  "metadata-only",
  "unavailable",
  "missing",
  "invalid",
  "not-provided",
] as const;
export type ShadowCorpusMediaStatus = (typeof SHADOW_CORPUS_MEDIA_STATUSES)[number];

export type ShadowCorpusPurpose = typeof SHADOW_GENERATION_TRUTH | "BENCHMARK_REFERENCE";

/** A path-free media identity. `path`/`physicalPath` are input-only helpers. */
export interface ShadowCorpusMediaRecord {
  status: ShadowCorpusMediaStatus;
  sha256: string | null;
  byteLength: number | null;
  logicalRef: string;
  /** Local convenience fields are omitted from canonical output. */
  path?: string;
  physicalPath?: string;
  [key: string]: unknown;
}

/** Alias used by adapters that call the records simply media entries. */
export type ShadowCorpusMedia = ShadowCorpusMediaRecord;

/** Source identity is provider-neutral; URLs and provider URIs are logical refs. */
export type ShadowCorpusSourceRecord = string | Record<string, unknown>;
export type ShadowCorpusLicense = string | Record<string, unknown>;

export type ShadowCorpusTrackRole =
  | "drums"
  | "bass"
  | "guitar"
  | "piano"
  | "other"
  | "melody"
  | "harmony"
  | "lead"
  | "riff"
  | "bass-root"
  | "timing-only"
  | string;

/** Provider-neutral track/instrument metadata; note payloads do not belong here. */
export interface ShadowCorpusTrack {
  id?: string;
  index?: number;
  name: string;
  instrumentClass?: string;
  /** Accepted input alias for an instrument class. */
  class?: string;
  /** Semantic role assigned by an adapter, when available. */
  role?: ShadowCorpusTrackRole;
  program?: number | null;
  channel?: number | null;
  percussion?: boolean;
  noteCount?: number;
  durationBeats?: number;
  [key: string]: unknown;
}

/** Eligibility carries policy state, never a claim that a song is production-ready. */
export interface ShadowCorpusEligibility {
  eligible: boolean;
  purpose?: ShadowCorpusPurpose | string;
  status?: string;
  reason?: string | null;
  [key: string]: unknown;
}

export interface ShadowCorpusItem {
  /** Item schema is additive; manifests also carry this version. */
  schemaVersion?: typeof SHADOW_CORPUS_SCHEMA_VERSION;
  id: string;
  corpus: string;
  datasetVersion: string;
  license: ShadowCorpusLicense;
  sourceRecord: ShadowCorpusSourceRecord;
  audio: ShadowCorpusMediaRecord;
  symbolic: ShadowCorpusMediaRecord;
  tracks: readonly ShadowCorpusTrack[];
  durationBeats: number;
  generationEligibility: ShadowCorpusEligibility;
  evaluationEligibility: ShadowCorpusEligibility;
  /** Optional candidate identity for callers that also feed the evidence firewall. */
  candidate?: ExternalEvidenceCandidate;
  evidenceCandidate?: ExternalEvidenceCandidate;
  /** Accepted only as a local adapter convenience and omitted from canonical output. */
  parsedMidi?: ParsedMidi;
  [key: string]: unknown;
}

export interface ShadowCorpusManifest {
  schemaVersion: typeof SHADOW_CORPUS_SCHEMA_VERSION;
  items: readonly ShadowCorpusItem[];
  /** Optional defaults for manifests that group one provider/version/license. */
  corpus?: string;
  datasetVersion?: string;
  license?: ShadowCorpusLicense;
  sourceRecord?: ShadowCorpusSourceRecord;
  [key: string]: unknown;
}

export type ShadowCorpusItemInput = Partial<ShadowCorpusItem> & {
  /** Parsed metadata can supply duration and named tracks when present. */
  parsedMidi?: ParsedMidi;
  midiMetadata?: ParsedMidi;
};

export type ShadowCorpusManifestInput = Omit<Partial<ShadowCorpusManifest>, "items"> & {
  items: readonly ShadowCorpusItemInput[];
};

export interface ShadowCorpusValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ShadowCorpusValidationOptions extends EvidenceFirewallOptions {
  /** Repository root used to reject local media paths that resolve inside it. */
  repositoryRoot?: string;
  /** Useful for callers that prefer a throwing read/validation boundary. */
  throwOnError?: boolean;
}

export interface ShadowCorpusManifestRead {
  status: "valid" | "missing" | "invalid";
  path: string;
  manifest?: ShadowCorpusManifest;
  errors?: string[];
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const MEDIA_STATUS_SET = new Set<string>(SHADOW_CORPUS_MEDIA_STATUSES);

function assertSupportedSchemaVersion(value: unknown, field: string): void {
  if (value !== undefined && value !== SHADOW_CORPUS_SCHEMA_VERSION) {
    throw new Error(`${field}.schemaVersion is unsupported`);
  }
}

/*
 * A path-like key is local convenience data.  It is removed rather than
 * retained as a redacted value so a canonical manifest cannot be used to
 * recover a machine's directory layout.
 */
const LOCAL_PATH_KEY_RE = /(?:^|[_-])(?:absolute|physical|local)?path$|(?:path|filename|file|locator|artifact)(?:ref|path|name)?$/i;
const LOCAL_BINARY_KEY_RE = /^(?:bytes|data|raw|rawBytes|payload|notes|events|parsedMidi|midiMetadata|audioBytes|symbolicBytes)$/i;

const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/|file:\/\/(?:[A-Za-z]:[\\/]|[\\/]?~[\\/]|\/))/i;
const EMBEDDED_PATH_RE = /(?:file:\/\/(?:[A-Za-z]:[\\/]|[\\/]?~[\\/]|\/)|(?:[A-Za-z]:[\\/])|(?:\\\\)|(?:~[\\/])|\/(?:Users|private|tmp|var|home|Volumes|opt|etc|System|Applications)(?:[\\/]))[^\s"'<>;,)}\]]*/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, max = 400): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || CONTROL_RE.test(value)) {
    throw new Error(`${field} must be a non-empty safe string`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, max = 400): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, field, max);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isAbsolutePathLike(value: string): boolean {
  return ABSOLUTE_PATH_RE.test(value.trim());
}

function normalizePathValue(value: string): string {
  const trimmed = value.trim();
  if (/^file:\/\//i.test(trimmed)) return trimmed.slice("file://".length).replaceAll("\\", "/");
  return trimmed.replaceAll("\\", "/");
}

function pathInside(candidate: string, root: string): boolean {
  const normalized = normalizePathValue(candidate);
  const candidateIsAbsolute = isAbsolute(normalized);
  const candidatePath = candidateIsAbsolute ? resolve(normalized) : resolve(root, normalized);
  const rootPath = resolve(root);
  const remainder = relative(rootPath, candidatePath);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

function containsEmbeddedPath(value: string): boolean {
  return isAbsolutePathLike(value) || EMBEDDED_PATH_RE.test(value);
}

function redactPathText(value: string): string {
  if (isAbsolutePathLike(value)) return "[redacted-path]";
  return value.replace(EMBEDDED_PATH_RE, "[redacted-path]");
}

function hash(value: unknown, field: string, allowNull = true): string | null {
  if (value === null && allowNull) return null;
  if (typeof value !== "string" || !SHA256_RE.test(value.trim())) throw new Error(`${field} must be a SHA-256 hash`);
  return value.trim().toLowerCase();
}

function byteCount(value: unknown, field: string, allowNull = true): number | null {
  if (value === null && allowNull) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer byte count`);
  return value;
}

function byteView(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function sourceIdentity(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const key of ["id", "recordId", "sourceRef", "uri", "url", "provider", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function normalizeSourceRecord(value: unknown, field = "sourceRecord"): ShadowCorpusSourceRecord {
  if (typeof value === "string") return text(value, field);
  if (!isRecord(value) || !sourceIdentity(value)) throw new Error(`${field} is missing a logical source identity`);
  return { ...value };
}

function normalizeLicense(value: unknown, field = "license"): ShadowCorpusLicense {
  if (typeof value === "string") return text(value, field, 800);
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error(`${field} is missing`);
  if (!sourceIdentity(value)) throw new Error(`${field} must include a license identity`);
  return { ...value };
}

function normalizeMedia(value: unknown, field: string): ShadowCorpusMediaRecord {
  if (!isRecord(value)) throw new Error(`${field} is missing`);
  const rawBytes = byteView(value.bytes ?? value.data);
  const rawHash = value.sha256 ?? value.hash ?? (rawBytes ? sha256Hex(rawBytes) : undefined);
  const rawLength = value.byteLength ?? (rawBytes ? rawBytes.byteLength : undefined);
  const logicalRef = optionalText(value.logicalRef ?? value.logicalPath, `${field}.logicalRef`, 1_000);
  if (!logicalRef) throw new Error(`${field}.logicalRef is missing`);
  const status = value.status;
  if (typeof status !== "string" || !MEDIA_STATUS_SET.has(status)) throw new Error(`${field}.status is invalid`);
  const normalizedHash = rawHash === undefined ? null : hash(rawHash, `${field}.sha256`);
  const normalizedLength = rawLength === undefined ? null : byteCount(rawLength, `${field}.byteLength`);
  return {
    status: status as ShadowCorpusMediaStatus,
    sha256: normalizedHash,
    byteLength: normalizedLength,
    logicalRef,
  };
}

function normalizeTrack(value: unknown, index: number): ShadowCorpusTrack {
  if (!isRecord(value)) throw new Error(`tracks[${index}] must be an object`);
  const id = optionalText(value.id ?? value.trackId, `tracks[${index}].id`, 160) ?? `track-${index + 1}`;
  const name = optionalText(value.name ?? value.trackName ?? value.label, `tracks[${index}].name`, 300) ?? "";
  const result: Record<string, unknown> = { ...value, id, name };
  const instrumentClass = optionalText(value.instrumentClass ?? value.class ?? value.instrument, `tracks[${index}].instrumentClass`, 160);
  if (instrumentClass !== undefined) result.instrumentClass = instrumentClass;
  if (value.role !== undefined) result.role = optionalText(value.role, `tracks[${index}].role`, 160);
  return result as ShadowCorpusTrack;
}

function normalizeEligibility(value: unknown, field: string): ShadowCorpusEligibility {
  if (!isRecord(value)) throw new Error(`${field} is missing`);
  let eligible = value.eligible;
  if (typeof eligible !== "boolean" && (value.status === "eligible" || value.status === "ineligible")) eligible = value.status === "eligible";
  if (typeof eligible !== "boolean") throw new Error(`${field}.eligible must be boolean`);
  const result: Record<string, unknown> = { ...value, eligible };
  if (result.reason !== undefined && result.reason !== null) result.reason = text(result.reason, `${field}.reason`, 1_000);
  return result as ShadowCorpusEligibility;
}

function parsedMidiFrom(value: Record<string, unknown>): ParsedMidi | undefined {
  const candidate = value.parsedMidi ?? value.midiMetadata;
  return isRecord(candidate) ? candidate as unknown as ParsedMidi : undefined;
}

function normalizeItem(value: unknown, defaults?: Partial<ShadowCorpusManifest>): ShadowCorpusItem {
  if (!isRecord(value)) throw new Error("shadow corpus item must be an object");
  assertSupportedSchemaVersion(value.schemaVersion, "item");
  const parsed = parsedMidiFrom(value);
  const sourceRecord = normalizeSourceRecord(value.sourceRecord ?? defaults?.sourceRecord, "sourceRecord");
  const sourceRecordObject = isRecord(sourceRecord) ? sourceRecord : undefined;
  const id = text(value.id ?? sourceRecordObject?.id ?? sourceRecordObject?.recordId, "item.id", 240);
  const corpus = text(value.corpus ?? defaults?.corpus, "item.corpus", 240);
  const datasetVersion = text(value.datasetVersion ?? defaults?.datasetVersion, "item.datasetVersion", 240);
  const license = normalizeLicense(value.license ?? defaults?.license, "item.license");
  const audio = normalizeMedia(value.audio, "audio");
  const symbolic = normalizeMedia(value.symbolic, "symbolic");
  const rawTracks = value.tracks ?? (parsed?.trackNames ?? []).map((name, index) => ({ id: `track-${index + 1}`, index, name, instrumentClass: "other" }));
  if (!Array.isArray(rawTracks)) throw new Error("tracks must be an array");
  const tracks = rawTracks.map(normalizeTrack);
  const rawDuration = value.durationBeats ?? parsed?.durationBeats;
  if (typeof rawDuration !== "number" || !Number.isFinite(rawDuration) || rawDuration < 0) throw new Error("durationBeats must be a finite non-negative number");
  const generationEligibility = normalizeEligibility(value.generationEligibility, "generationEligibility");
  const evaluationEligibility = normalizeEligibility(value.evaluationEligibility, "evaluationEligibility");
  const candidate = value.candidate ?? value.evidenceCandidate;

  const normalized: Record<string, unknown> = {
    schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION,
    id,
    corpus,
    datasetVersion,
    license,
    sourceRecord,
    audio,
    symbolic,
    tracks,
    durationBeats: rawDuration,
    generationEligibility,
    evaluationEligibility,
  };
  if (candidate !== undefined) normalized.candidate = candidate;

  const localKeys = new Set(["schemaVersion", "id", "corpus", "datasetVersion", "license", "sourceRecord", "audio", "symbolic", "tracks", "durationBeats", "generationEligibility", "evaluationEligibility", "candidate", "evidenceCandidate", "parsedMidi", "midiMetadata"]);
  for (const [key, item] of Object.entries(value)) {
    if (localKeys.has(key) || LOCAL_PATH_KEY_RE.test(key) || LOCAL_BINARY_KEY_RE.test(key)) continue;
    if (item !== undefined) normalized[key] = item;
  }
  return normalized as ShadowCorpusItem;
}

function normalizeManifest(value: unknown): ShadowCorpusManifest {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("shadow corpus manifest items must be an array");
  assertSupportedSchemaVersion(value.schemaVersion, "manifest");
  const defaults: Partial<ShadowCorpusManifest> = {
    corpus: typeof value.corpus === "string" ? value.corpus : undefined,
    datasetVersion: typeof value.datasetVersion === "string" ? value.datasetVersion : undefined,
    license: value.license as ShadowCorpusLicense | undefined,
    sourceRecord: value.sourceRecord as ShadowCorpusSourceRecord | undefined,
  };
  const items = value.items.map((item) => normalizeItem(item, defaults));
  const normalized: Record<string, unknown> = { schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items };
  for (const [key, item] of Object.entries(value)) {
    if (key === "schemaVersion" || key === "items" || LOCAL_PATH_KEY_RE.test(key) || LOCAL_BINARY_KEY_RE.test(key)) continue;
    if (item !== undefined) normalized[key] = item;
  }
  return normalized as ShadowCorpusManifest;
}

function addPathErrors(value: unknown, context: string, repositoryRoot: string, errors: string[], visited = new WeakSet<object>()): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => addPathErrors(item, `${context}[${index}]`, repositoryRoot, errors, visited));
    return;
  }
  if (!isRecord(value)) return;
  if (visited.has(value)) return;
  visited.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && (LOCAL_PATH_KEY_RE.test(key) || isAbsolutePathLike(nested))) {
      if (pathInside(nested, repositoryRoot)) errors.push(`${context}.${key} resolves inside the repository`);
    }
    addPathErrors(nested, `${context}.${key}`, repositoryRoot, errors, visited);
  }
}

function validateMedia(value: unknown, field: string, repositoryRoot: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} is missing`);
    return;
  }
  const status = value.status;
  if (typeof status !== "string" || !MEDIA_STATUS_SET.has(status)) errors.push(`${field}.status is invalid`);
  if (typeof value.logicalRef !== "string" || value.logicalRef.trim() === "") errors.push(`${field}.logicalRef is missing`);
  else if (CONTROL_RE.test(value.logicalRef) || isAbsolutePathLike(value.logicalRef)) errors.push(`${field}.logicalRef must be a logical, non-absolute reference`);
  if (!Object.hasOwn(value, "sha256")) errors.push(`${field}.sha256 is missing`);
  else if (value.sha256 !== null && (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256.trim()))) errors.push(`${field}.sha256 must be a SHA-256 hash or null`);
  if (!Object.hasOwn(value, "byteLength")) errors.push(`${field}.byteLength is missing`);
  else if (value.byteLength !== null && (typeof value.byteLength !== "number" || !Number.isInteger(value.byteLength) || value.byteLength < 0)) errors.push(`${field}.byteLength must be a non-negative integer or null`);
  if (status === "available") {
    if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256.trim())) errors.push(`${field}.sha256 is required for available media`);
    if (typeof value.byteLength !== "number" || !Number.isInteger(value.byteLength) || value.byteLength <= 0) errors.push(`${field}.byteLength must be positive for available media`);
  }
  addPathErrors(value, field, repositoryRoot, errors);
}

function validateSourceRecord(value: unknown, field: string, errors: string[]): void {
  if (typeof value === "string") {
    if (!value.trim() || CONTROL_RE.test(value) || isAbsolutePathLike(value)) errors.push(`${field} must be a logical source record`);
    return;
  }
  if (!isRecord(value) || !sourceIdentity(value)) errors.push(`${field} is missing a logical source identity`);
}

function validateLicense(value: unknown, field: string, errors: string[]): void {
  if (typeof value === "string") {
    if (!value.trim() || CONTROL_RE.test(value)) errors.push(`${field} is missing`);
    return;
  }
  if (!isRecord(value) || Object.keys(value).length === 0 || !sourceIdentity(value)) errors.push(`${field} is missing a license identity`);
}

function validateTracks(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field} must contain track metadata`);
    return;
  }
  const ids = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (typeof raw.name !== "string" || raw.name.trim() === "") errors.push(`${path}.name is missing`);
    const hasClass = [raw.instrumentClass, raw.class, raw.instrument, raw.role].some((item) => typeof item === "string" && item.trim() !== "");
    const hasProgram = raw.program !== undefined && raw.program !== null;
    const hasPercussion = raw.percussion !== undefined;
    if (!hasClass && !hasProgram && !hasPercussion) errors.push(`${path} is missing instrument/role metadata`);
    if (raw.id !== undefined) {
      if (typeof raw.id !== "string" || raw.id.trim() === "") errors.push(`${path}.id is invalid`);
      else if (ids.has(raw.id.trim())) errors.push(`duplicate track id: ${raw.id.trim()}`);
      else ids.add(raw.id.trim());
    }
    for (const key of ["index", "noteCount"] as const) {
      if (raw[key] !== undefined && (typeof raw[key] !== "number" || !Number.isInteger(raw[key]) || raw[key] < 0)) errors.push(`${path}.${key} must be a non-negative integer`);
    }
    if (raw.program !== undefined && raw.program !== null && (typeof raw.program !== "number" || !Number.isInteger(raw.program) || raw.program < 0 || raw.program > 127)) errors.push(`${path}.program must be in MIDI range`);
    if (raw.channel !== undefined && raw.channel !== null && (typeof raw.channel !== "number" || !Number.isInteger(raw.channel) || raw.channel < 0 || raw.channel > 15)) errors.push(`${path}.channel must be in MIDI channel range`);
    if (raw.percussion !== undefined && typeof raw.percussion !== "boolean") errors.push(`${path}.percussion must be boolean`);
    if (raw.durationBeats !== undefined && (typeof raw.durationBeats !== "number" || !Number.isFinite(raw.durationBeats) || raw.durationBeats < 0)) errors.push(`${path}.durationBeats must be finite and non-negative`);
  }
}

function validateEligibility(value: unknown, field: string, generation: boolean, audio: unknown, symbolic: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} is missing`);
    return;
  }
  if (typeof value.eligible !== "boolean") errors.push(`${field}.eligible must be boolean`);
  if (generation) {
    if (value.purpose === "BENCHMARK_REFERENCE") errors.push("BENCHMARK_REFERENCE cannot enter shadow generation");
    else if (value.purpose !== SHADOW_GENERATION_TRUTH) errors.push(`${field}.purpose must be ${SHADOW_GENERATION_TRUTH}`);
    if (value.eligible === true) {
      if (!isRecord(audio) || audio.status !== "available") errors.push("shadow generation requires available audio");
      if (!isRecord(symbolic) || symbolic.status !== "available") errors.push("shadow generation requires available symbolic media");
    }
  }
}

function validateCandidate(value: unknown, field: string, options: ShadowCorpusValidationOptions, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${field} must be an evidence candidate object`);
    return;
  }
  if (value.purpose === "BENCHMARK_REFERENCE" || value.evidenceClass === "BENCHMARK_REFERENCE") {
    errors.push(`${field} BENCHMARK_REFERENCE is evaluation-only`);
    return;
  }
  try {
    if (value.purpose !== SHADOW_GENERATION_TRUTH) throw new Error(`${field}.purpose must be ${SHADOW_GENERATION_TRUTH}`);
    assertShadowGenerationTruth(value as unknown as ExternalEvidenceCandidate, options);
  } catch (error) {
    errors.push(`${field} is not generation-safe: ${error instanceof Error ? error.message : "invalid evidence"}`);
  }
}

function validateItem(
  value: unknown,
  index: number,
  ids: Set<string>,
  options: ShadowCorpusValidationOptions,
  errors: string[],
  defaults: Partial<ShadowCorpusManifest> = {},
): void {
  const field = `items[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return;
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== SHADOW_CORPUS_SCHEMA_VERSION) errors.push(`${field}.schemaVersion is unsupported`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const corpusValue = value.corpus ?? defaults.corpus;
  const corpus = typeof corpusValue === "string" ? corpusValue.trim() : "";
  if (!id || CONTROL_RE.test(id)) errors.push(`${field}.id is missing or unsafe`);
  const key = `${corpus}\u0000${id}`;
  if (id && ids.has(key)) errors.push(`duplicate shadow corpus item id: ${corpus}/${id}`);
  else if (id) ids.add(key);
  if (!corpus || CONTROL_RE.test(corpus)) errors.push(`${field}.corpus is missing or unsafe`);
  const datasetVersion = value.datasetVersion ?? defaults.datasetVersion;
  if (typeof datasetVersion !== "string" || !datasetVersion.trim() || CONTROL_RE.test(datasetVersion)) errors.push(`${field}.datasetVersion is missing or unsafe`);
  validateLicense(value.license ?? defaults.license, `${field}.license`, errors);
  validateSourceRecord(value.sourceRecord ?? defaults.sourceRecord, `${field}.sourceRecord`, errors);
  validateMedia(value.audio, `${field}.audio`, options.repositoryRoot ?? process.cwd(), errors);
  validateMedia(value.symbolic, `${field}.symbolic`, options.repositoryRoot ?? process.cwd(), errors);
  validateTracks(value.tracks, `${field}.tracks`, errors);
  if (typeof value.durationBeats !== "number" || !Number.isFinite(value.durationBeats) || value.durationBeats < 0) errors.push(`${field}.durationBeats must be finite and non-negative`);
  validateEligibility(value.generationEligibility, `${field}.generationEligibility`, true, value.audio, value.symbolic, errors);
  validateEligibility(value.evaluationEligibility, `${field}.evaluationEligibility`, false, value.audio, value.symbolic, errors);
  const candidate = value.candidate ?? value.evidenceCandidate;
  if (candidate !== undefined) validateCandidate(candidate, `${field}.candidate`, options, errors);
  addPathErrors(value, field, options.repositoryRoot ?? process.cwd(), errors);
}

/**
 * Validate an evidence candidate explicitly marked as shadow generation truth.
 * The benchmark-purpose branch is checked before the generic generation
 * assertion and therefore cannot be weakened by the additional purpose.
 */
export function assertShadowGenerationTruth(candidate: ExternalEvidenceCandidate, options?: EvidenceFirewallOptions): ExternalEvidenceCandidate {
  if (!isRecord(candidate)) throw new Error("shadow evidence candidate must be an object");
  if (candidate.purpose === "BENCHMARK_REFERENCE" || candidate.evidenceClass === "BENCHMARK_REFERENCE") {
    throw new Error("BENCHMARK_REFERENCE evidence cannot enter shadow generation");
  }
  if (candidate.purpose !== SHADOW_GENERATION_TRUTH) throw new Error(`shadow evidence purpose must be ${SHADOW_GENERATION_TRUTH}`);
  return assertGenerationEvidence(candidate, options);
}

/** Validate without mutating the caller's object; malformed input fails closed. */
export function validateShadowCorpusManifest(value: unknown, options: ShadowCorpusValidationOptions = {}): ShadowCorpusValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) errors.push("shadow corpus manifest must be an object");
  else {
    if (value.schemaVersion !== SHADOW_CORPUS_SCHEMA_VERSION) errors.push(`schemaVersion must be ${SHADOW_CORPUS_SCHEMA_VERSION}`);
    if (!Array.isArray(value.items)) errors.push("shadow corpus manifest items must be an array");
    else {
      const ids = new Set<string>();
      const defaults: Partial<ShadowCorpusManifest> = {
        corpus: typeof value.corpus === "string" ? value.corpus : undefined,
        datasetVersion: typeof value.datasetVersion === "string" ? value.datasetVersion : undefined,
        license: value.license as ShadowCorpusLicense | undefined,
        sourceRecord: value.sourceRecord as ShadowCorpusSourceRecord | undefined,
      };
      value.items.forEach((item, index) => validateItem(item, index, ids, options, errors, defaults));
      if (value.items.length === 0) warnings.push("shadow corpus manifest contains no items");
    }
    if (value.corpus !== undefined && (typeof value.corpus !== "string" || !value.corpus.trim() || CONTROL_RE.test(value.corpus))) errors.push("manifest.corpus is unsafe");
    if (value.datasetVersion !== undefined && (typeof value.datasetVersion !== "string" || !value.datasetVersion.trim() || CONTROL_RE.test(value.datasetVersion))) errors.push("manifest.datasetVersion is unsafe");
    if (value.license !== undefined) validateLicense(value.license, "manifest.license", errors);
    if (value.sourceRecord !== undefined) validateSourceRecord(value.sourceRecord, "manifest.sourceRecord", errors);
    addPathErrors(value, "manifest", options.repositoryRoot ?? process.cwd(), errors);
  }
  const result = { valid: errors.length === 0, errors: [...new Set(errors)].sort(compareText), warnings: [...new Set(warnings)].sort(compareText) };
  if (options.throwOnError && !result.valid) throw new Error(`invalid shadow corpus manifest: ${result.errors.join("; ")}`);
  return result;
}

/** Construct and validate one normalized item. */
export function createShadowCorpusItem(input: ShadowCorpusItemInput): ShadowCorpusItem {
  const normalized = normalizeItem(input);
  const validation = validateShadowCorpusManifest({ schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items: [normalized] });
  if (!validation.valid) throw new Error(`invalid shadow corpus item: ${validation.errors.join("; ")}`);
  return normalized;
}

/** Construct and validate a complete manifest from item inputs. */
export function createShadowCorpusManifest(input: ShadowCorpusManifestInput): ShadowCorpusManifest {
  if (!input || !Array.isArray(input.items)) throw new Error("shadow corpus manifest items must be an array");
  assertSupportedSchemaVersion((input as unknown as Record<string, unknown>).schemaVersion, "manifest");
  const defaults: Partial<ShadowCorpusManifest> = {
    corpus: typeof input.corpus === "string" ? input.corpus : undefined,
    datasetVersion: typeof input.datasetVersion === "string" ? input.datasetVersion : undefined,
    license: input.license as ShadowCorpusLicense | undefined,
    sourceRecord: input.sourceRecord as ShadowCorpusSourceRecord | undefined,
  };
  const items = input.items.map((item) => {
    const inherited: Record<string, unknown> = { ...item };
    for (const [key, value] of Object.entries(defaults)) if (value !== undefined && inherited[key] === undefined) inherited[key] = value;
    return createShadowCorpusItem(inherited);
  });
  const result: Record<string, unknown> = { schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items };
  for (const [key, value] of Object.entries(input)) if (key !== "schemaVersion" && key !== "items" && value !== undefined) result[key] = value;
  const manifest = result as ShadowCorpusManifest;
  const validation = validateShadowCorpusManifest(manifest);
  if (!validation.valid) throw new Error(`invalid shadow corpus manifest: ${validation.errors.join("; ")}`);
  return manifest;
}

function canonicalizeValue(value: unknown, key = "", visited = new WeakSet<object>()): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (LOCAL_PATH_KEY_RE.test(key)) return undefined;
    return redactPathText(value);
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return undefined;
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item, key, visited)).filter((item) => item !== undefined);
  if (!isRecord(value)) return value;
  if (visited.has(value)) return "[cycle]";
  visited.add(value);
  const result: Record<string, unknown> = {};
  for (const childKey of Object.keys(value).sort(compareText)) {
    if (LOCAL_PATH_KEY_RE.test(childKey) || LOCAL_BINARY_KEY_RE.test(childKey)) continue;
    const child = canonicalizeValue(value[childKey], childKey, visited);
    if (child !== undefined) {
      const normalizedChild = /sha256/i.test(childKey) && typeof child === "string" ? child.toLowerCase() : child;
      result[childKey] = normalizedChild;
    }
  }
  visited.delete(value);
  return result;
}

function itemSortKey(value: unknown): string {
  if (!isRecord(value)) return "\uFFFF";
  const corpus = typeof value.corpus === "string" ? value.corpus : "";
  const id = typeof value.id === "string" ? value.id : "";
  return `${corpus}\u0000${id}`;
}

function trackSortKey(value: unknown, index: number): string {
  if (!isRecord(value)) return `\uFFFF${index}`;
  const id = typeof value.id === "string" ? value.id : "";
  const trackIndex = typeof value.index === "number" && Number.isFinite(value.index) ? String(value.index).padStart(8, "0") : "\uFFFF";
  const name = typeof value.name === "string" ? value.name : "";
  return `${id}\u0000${trackIndex}\u0000${name}\u0000${index}`;
}

/** Return a stable, path-redacted object used as the manifest identity. */
export function canonicalShadowCorpus(manifest: ShadowCorpusManifest | unknown): Record<string, unknown> {
  const root = isRecord(manifest) ? manifest : { schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items: [] };
  const rawItems = Array.isArray(root.items) ? [...root.items] : [];
  rawItems.sort((left, right) => compareText(itemSortKey(left), itemSortKey(right)));
  const items = rawItems.map((raw) => {
    if (!isRecord(raw)) return raw;
    const projection: Record<string, unknown> = { ...raw };
    if (Array.isArray(projection.tracks)) {
      projection.tracks = [...projection.tracks].sort((left, right) => compareText(trackSortKey(left, 0), trackSortKey(right, 0)));
    }
    const candidate = projection.candidate ?? projection.evidenceCandidate;
    if (isRecord(candidate)) {
      const [canonicalCandidate] = canonicalEvidenceCandidateSet([candidate as unknown as ExternalEvidenceCandidate]);
      projection.candidate = canonicalCandidate;
      delete projection.evidenceCandidate;
    }
    return projection;
  });
  const projection: Record<string, unknown> = { ...root, schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items };
  return (canonicalizeValue(projection) ?? {}) as Record<string, unknown>;
}

/** Stable compact JSON; no local path or binary payload is emitted. */
export function canonicalShadowCorpusJson(manifest: ShadowCorpusManifest | unknown): string {
  return JSON.stringify(canonicalShadowCorpus(manifest));
}

/** Alias matching the naming used by other catalog manifest modules. */
export const canonicalShadowCorpusManifestJson = canonicalShadowCorpusJson;

/** Digest a validated manifest (or an item array) using its path-free canonical JSON. */
export function shadowCorpusDigest(manifest: ShadowCorpusManifest | readonly ShadowCorpusItem[]): string {
  const candidate = Array.isArray(manifest) ? { schemaVersion: SHADOW_CORPUS_SCHEMA_VERSION, items: manifest } : manifest;
  const validation = validateShadowCorpusManifest(candidate);
  if (!validation.valid) throw new Error(`cannot hash invalid shadow corpus manifest: ${validation.errors.join("; ")}`);
  return createHash("sha256").update(canonicalShadowCorpusJson(candidate), "utf8").digest("hex");
}

/** Read, parse, normalize, and validate a local JSON manifest. */
export async function readShadowCorpusManifest(pathValue: string, options: ShadowCorpusValidationOptions = {}): Promise<ShadowCorpusManifest> {
  const path = text(pathValue, "manifest path", 4_000);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`unable to read shadow corpus manifest: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const validation = validateShadowCorpusManifest(raw, options);
  if (!validation.valid) throw new Error(`invalid shadow corpus manifest: ${validation.errors.join("; ")}`);
  return normalizeManifest(raw);
}

/** Non-throwing read wrapper for CLIs that need a status report. */
export async function readShadowCorpusManifestResult(pathValue: string, options: ShadowCorpusValidationOptions = {}): Promise<ShadowCorpusManifestRead> {
  const path = typeof pathValue === "string" ? pathValue : String(pathValue);
  try {
    return { status: "valid", path, manifest: await readShadowCorpusManifest(path, options) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || /ENOENT/.test(error instanceof Error ? error.message : "")) return { status: "missing", path };
    return { status: "invalid", path, errors: [error instanceof Error ? error.message : "unable to read shadow corpus manifest"] };
  }
}

/** Throwing parse helper for callers that already have JSON data. */
export function parseShadowCorpusManifest(value: unknown, options: ShadowCorpusValidationOptions = {}): ShadowCorpusManifest {
  const validation = validateShadowCorpusManifest(value, options);
  if (!validation.valid) throw new Error(`invalid shadow corpus manifest: ${validation.errors.join("; ")}`);
  return normalizeManifest(value);
}
