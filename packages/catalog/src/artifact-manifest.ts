import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.js";
import type { SourceProvenance } from "./provenance.js";

export const ARRANGEMENT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type IdentityStatus = "legacy-bootstrap" | "current" | "migrated";
export type TempoRole = "source-calibration" | "playback";
export type TempoSource = "override" | "detected" | "midi-meta" | "manifest" | "database" | "default" | "legacy" | "manual";

/** Versioned transformation identities used by audio-derived ingestion. */
export interface TranscriptionPipelineProvenance {
  /** Audio-onset filter implementation/version. */
  filterVersion: string;
  /** MIDI normalization implementation/version. */
  normalizerId: string;
  /** Beat-grid policy implementation/version. */
  gridPolicyId: string;
  /** Difficulty/variant ladder implementation/version. */
  variantPolicyId: string;
}

/** Effective cleanup settings applied after Basic Pitch inference. */
export interface TranscriptionPostProcessing {
  /** Whether the real-audio onset filter ran for this source. */
  filterApplied: boolean;
  /** Whether the Basic Pitch note cleanup pass ran for this source. */
  cleanupApplied: boolean;
  /** Maximum distance between audio and inferred note onsets, in seconds. */
  onsetMatchSec: number;
  /** Effective librosa onset detector settings, when recorded. */
  onsetDetector?: {
    sampleRate: number;
    hopLength: number;
    backtrack: boolean;
    delta: number;
  };
  /** Basic Pitch cleanup velocity floor. */
  minVelocity: number;
  /** Basic Pitch cleanup duration floor, in beats. */
  minDurationBeats: number;
  /** Same-pitch retrigger merge window, in beats. */
  mergeWindowBeats: number;
  /** Per-onset polyphony cap used by the cleanup pass. */
  maxPolyphony: number;
  /** Simultaneous-sounding-note cap used by the cleanup pass. */
  maxSounding: number;
  /** Tempo-aware sustain ceiling input used by cleanup, in seconds. */
  maxDurationSec: number;
  /** Effective tempo-derived sustain ceiling, in beats, when known. */
  maxDurationBeats?: number;
  /** Import-stage sustain ceiling applied by the variant builder. */
  importedMaxDurationBeats?: number | null;
  /** Import-stage simultaneous-sounding-note cap. */
  importedMaxSounding?: number;
}

/**
 * Effective settings used to turn an audio source into the MIDI that is
 * ingested.  This is deliberately separate from the source URL/label
 * provenance in notes.json: the latter tells us where the material came
 * from, while this block tells us how an audio transcription was produced.
 *
 * The block is optional because ordinary MIDI/MusicXML uploads do not have a
 * Basic Pitch run to describe.  Once present, the fields are intentionally
 * complete enough to reproduce or compare the transcription configuration.
 * A worker that cannot discover a runtime version should use the literal
 * value "unknown" rather than omitting the identity field.
 */
export interface TranscriptionProvenance {
  basicPitchVersion: string;
  modelSerialization: string;
  onsetThreshold: number;
  frameThreshold: number;
  /** BPM explicitly supplied to the transcription, when one was available. */
  tempo?: number;
  /** How the audio entered the worker: downloaded, operator-seeded, or upload. */
  audioAcquisition?: "downloaded" | "pre-seeded" | "upload";
  tempoSource: TempoSource;
  audioSource: string;
  transcribedAt: string;
  /** Optional on legacy provenance; current workers write this block. */
  pipeline?: TranscriptionPipelineProvenance;
  /** Optional on legacy provenance; current workers write this block. */
  postProcessing?: TranscriptionPostProcessing;
}

/**
 * Return the stable part of transcription provenance for cache identity.
 * `transcribedAt` records when a run happened, not how it was configured, so
 * it must not make two otherwise identical rebuilds acquire different
 * fingerprints.
 */
export function transcriptionConfigForFingerprint(
  value: TranscriptionProvenance,
): Omit<TranscriptionProvenance, "transcribedAt"> {
  const { transcribedAt: _transcribedAt, ...config } = value;
  return config;
}

export interface ResolvedTempo {
  bpm: number;
  source: TempoSource;
  /** For legacy bootstrap this is adoption time, not the original detection time. */
  resolvedAt: string;
  role: TempoRole;
}

/**
 * Role-tagged tempo provenance mirrored into each generated notes.json.
 *
 * The artifact-local arrangement manifest remains the runtime authority. This
 * per-variant copy is intentionally diagnostic and lets an individual notes
 * artifact explain how its beat coordinates and playback mirrors were made
 * without requiring a separate manifest read. Legacy files may omit it.
 */
export interface TempoProvenance {
  calibration: ResolvedTempo;
  playback: ResolvedTempo;
}

export interface ArrangementManifest {
  schemaVersion: typeof ARRANGEMENT_MANIFEST_SCHEMA_VERSION;
  baseId: string;
  identityStatus: IdentityStatus;
  /** Required for current/migrated artifacts; absent only for legacy bootstrap. */
  sourceArtifactHash?: string;
  /** Required for current/migrated artifacts; absent only for legacy bootstrap. */
  configFingerprint?: string;
  arrangementProfile?: string;
  /** Canonical logical source identity plus optional physical source locator. */
  source?: SourceProvenance;
  tempo: TempoProvenance;
  /** Absent for standard MIDI/MusicXML uploads without an audio transcription. */
  transcription?: TranscriptionProvenance;
  artifactWrittenAt: string;
}

export type ArrangementManifestRead =
  | { status: "missing"; path: string }
  | { status: "valid"; path: string; manifest: ArrangementManifest }
  | { status: "invalid"; path: string; errors: string[] };

export type ArtifactTempoResolution =
  | {
      status: "legacy";
      bpm: number;
      errors: [];
    }
  | {
      status: "valid";
      bpm: number;
      manifest: ArrangementManifest;
      errors: [];
    }
  | {
      status: "invalid";
      bpm: null;
      errors: string[];
    };

const BASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const IDENTITY_STATUSES = new Set<IdentityStatus>(["legacy-bootstrap", "current", "migrated"]);
const TEMPO_ROLES = new Set<TempoRole>(["source-calibration", "playback"]);
const TEMPO_SOURCES = new Set<TempoSource>([
  "override",
  "detected",
  "midi-meta",
  "manifest",
  "database",
  "default",
  "legacy",
  "manual",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function validBpm(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 20 && value <= 300;
}

/**
 * Compare denormalized tempo mirrors without treating harmless IEEE-754 or
 * decimal-parser noise as a stale artifact. The MIDI writer has a separate
 * (larger) round-trip tolerance because SMF stores integer microseconds; this
 * tighter tolerance is only for notes.json, manifest, and database mirrors.
 */
export const TEMPO_MIRROR_TOLERANCE = 1e-6;

export function temposAgree(left: unknown, right: unknown): boolean {
  return validBpm(left) && validBpm(right) && Math.abs(left - right) <= TEMPO_MIRROR_TOLERANCE;
}

function validateTranscriptionPipeline(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  for (const key of ["filterVersion", "normalizerId", "gridPolicyId", "variantPolicyId"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      errors.push(`${path}.${key} must be a non-empty string`);
    }
  }
  return errors;
}

function validateTranscriptionPostProcessing(value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  for (const key of ["filterApplied", "cleanupApplied"] as const) {
    if (typeof value[key] !== "boolean") errors.push(`${path}.${key} must be a boolean`);
  }
  if (!validNonNegativeNumber(value.onsetMatchSec) || value.onsetMatchSec > 10) {
    errors.push(`${path}.onsetMatchSec must be a finite number between 0 and 10`);
  }
  if (value.onsetDetector !== undefined) {
    if (!isRecord(value.onsetDetector)) {
      errors.push(`${path}.onsetDetector must be an object`);
    } else {
      if (!validPositiveInteger(value.onsetDetector.sampleRate)) {
        errors.push(`${path}.onsetDetector.sampleRate must be a positive integer`);
      }
      if (!validPositiveInteger(value.onsetDetector.hopLength)) {
        errors.push(`${path}.onsetDetector.hopLength must be a positive integer`);
      }
      if (typeof value.onsetDetector.backtrack !== "boolean") {
        errors.push(`${path}.onsetDetector.backtrack must be a boolean`);
      }
      if (!validNonNegativeNumber(value.onsetDetector.delta)) {
        errors.push(`${path}.onsetDetector.delta must be a non-negative finite number`);
      }
    }
  }
  if (!Number.isInteger(value.minVelocity) || Number(value.minVelocity) < 0 || Number(value.minVelocity) > 127) {
    errors.push(`${path}.minVelocity must be an integer between 0 and 127`);
  }
  for (const key of ["minDurationBeats", "mergeWindowBeats", "maxDurationSec"] as const) {
    if (!validPositiveNumber(value[key])) errors.push(`${path}.${key} must be a positive finite number`);
  }
  for (const key of ["maxPolyphony", "maxSounding"] as const) {
    if (!validPositiveInteger(value[key])) errors.push(`${path}.${key} must be a positive integer`);
  }
  if (value.maxDurationBeats !== undefined && !validPositiveNumber(value.maxDurationBeats)) {
    errors.push(`${path}.maxDurationBeats must be a positive finite number when present`);
  }
  if (value.importedMaxDurationBeats !== undefined && value.importedMaxDurationBeats !== null && !validPositiveNumber(value.importedMaxDurationBeats)) {
    errors.push(`${path}.importedMaxDurationBeats must be null or a positive finite number when present`);
  }
  if (value.importedMaxSounding !== undefined && !validPositiveInteger(value.importedMaxSounding)) {
    errors.push(`${path}.importedMaxSounding must be a positive integer when present`);
  }
  return errors;
}

export function validateTranscriptionProvenance(value: unknown, path = "transcription"): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path} must be an object`];
  if (typeof value.basicPitchVersion !== "string" || value.basicPitchVersion.trim() === "") {
    errors.push(`${path}.basicPitchVersion must be a non-empty string`);
  }
  if (typeof value.modelSerialization !== "string" || value.modelSerialization.trim() === "") {
    errors.push(`${path}.modelSerialization must be a non-empty string`);
  }
  for (const key of ["onsetThreshold", "frameThreshold"] as const) {
    const threshold = value[key];
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      errors.push(`${path}.${key} must be a finite number between 0 and 1`);
    }
  }
  if (value.tempo !== undefined && !validBpm(value.tempo)) {
    errors.push(`${path}.tempo must be a finite BPM between 20 and 300 when present`);
  }
  if (typeof value.tempoSource !== "string" || !TEMPO_SOURCES.has(value.tempoSource as TempoSource)) {
    errors.push(`${path}.tempoSource is not a recognized tempo source`);
  }
  if (typeof value.audioSource !== "string" || value.audioSource.trim() === "") {
    errors.push(`${path}.audioSource must be a non-empty string`);
  }
  if (!isIsoTimestamp(value.transcribedAt)) errors.push(`${path}.transcribedAt must be an ISO timestamp`);
  if (value.pipeline !== undefined) errors.push(...validateTranscriptionPipeline(value.pipeline, `${path}.pipeline`));
  if (value.postProcessing !== undefined) {
    errors.push(...validateTranscriptionPostProcessing(value.postProcessing, `${path}.postProcessing`));
  }
  return errors;
}

export function parseTranscriptionProvenance(value: unknown): TranscriptionProvenance {
  const errors = validateTranscriptionProvenance(value);
  if (errors.length) throw new Error(`invalid transcription provenance: ${errors.join("; ")}`);
  return value as TranscriptionProvenance;
}

function validateResolvedTempo(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value.bpm !== "number" || !Number.isFinite(value.bpm) || value.bpm < 20 || value.bpm > 300) {
    errors.push(`${path}.bpm must be a finite number between 20 and 300`);
  }
  if (typeof value.source !== "string" || !TEMPO_SOURCES.has(value.source as TempoSource)) {
    errors.push(`${path}.source is not a recognized tempo source`);
  }
  if (!isIsoTimestamp(value.resolvedAt)) errors.push(`${path}.resolvedAt must be an ISO timestamp`);
  if (typeof value.role !== "string" || !TEMPO_ROLES.has(value.role as TempoRole)) {
    errors.push(`${path}.role must be source-calibration or playback`);
  }
}

function validateSourceProvenance(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of ["kind", "acquiredVia", "sourceRef", "sourceYoutubeUrl", "sourceArtifactRef"] as const) {
    const field = value[key];
    if (field !== undefined && field !== null && (typeof field !== "string" || field.trim() === "")) {
      errors.push(`${path}.${key} must be a non-empty string or null when present`);
    }
  }
  if (value.sourceRef === undefined && value.sourceYoutubeUrl === undefined) {
    errors.push(`${path} must contain sourceRef or sourceYoutubeUrl`);
  }
}

/** Validate the role-tagged tempo copy used by notes.json provenance. */
export function validateTempoProvenance(value: unknown, path = "tempo"): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return errors;
  }
  validateResolvedTempo(value.calibration, `${path}.calibration`, errors);
  validateResolvedTempo(value.playback, `${path}.playback`, errors);
  if (isRecord(value.calibration) && value.calibration.role !== "source-calibration") {
    errors.push(`${path}.calibration.role must be source-calibration`);
  }
  if (isRecord(value.playback) && value.playback.role !== "playback") {
    errors.push(`${path}.playback.role must be playback`);
  }
  return errors;
}

export function parseTempoProvenance(value: unknown, path = "tempo"): TempoProvenance {
  const errors = validateTempoProvenance(value, path);
  if (errors.length) throw new Error(`invalid tempo provenance: ${errors.join("; ")}`);
  return value as TempoProvenance;
}

export function validateArrangementManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["manifest must be an object"];
  if (value.schemaVersion !== ARRANGEMENT_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ARRANGEMENT_MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof value.baseId !== "string" || !BASE_ID_RE.test(value.baseId)) errors.push("baseId must be a valid catalog base id");
  if (typeof value.identityStatus !== "string" || !IDENTITY_STATUSES.has(value.identityStatus as IdentityStatus)) {
    errors.push("identityStatus must be legacy-bootstrap, current, or migrated");
  }
  const identityStatus = value.identityStatus as IdentityStatus;
  for (const [key, required] of [["sourceArtifactHash", identityStatus !== "legacy-bootstrap"], ["configFingerprint", identityStatus !== "legacy-bootstrap"]] as const) {
    const field = value[key];
    if (required && (typeof field !== "string" || field.trim() === "")) errors.push(`${key} is required for ${identityStatus} artifacts`);
    if (field !== undefined && (typeof field !== "string" || field.trim() === "")) errors.push(`${key} must be a non-empty string when present`);
  }
  if (value.arrangementProfile !== undefined && (typeof value.arrangementProfile !== "string" || value.arrangementProfile.trim() === "")) {
    errors.push("arrangementProfile must be a non-empty string when present");
  }
  if (value.source !== undefined) validateSourceProvenance(value.source, "source", errors);
  if (!isRecord(value.tempo)) {
    errors.push("tempo must be an object");
  } else {
    errors.push(...validateTempoProvenance(value.tempo));
  }
  if (value.transcription !== undefined) {
    errors.push(...validateTranscriptionProvenance(value.transcription));
  }
  if (!isIsoTimestamp(value.artifactWrittenAt)) errors.push("artifactWrittenAt must be an ISO timestamp");
  return errors;
}

export function parseArrangementManifest(value: unknown): ArrangementManifest {
  const errors = validateArrangementManifest(value);
  if (errors.length) throw new Error(`invalid arrangement manifest: ${errors.join("; ")}`);
  return value as ArrangementManifest;
}

/**
 * Resolve the playback tempo at the artifact read boundary.
 *
 * A manifest is the runtime authority when present. The notes and database
 * values are denormalized mirrors and must agree with it; they are never
 * candidates for resolving a conflicting value. With no manifest, only the
 * selected level's notes.json tempo may bootstrap a legacy read. The optional
 * database tempo is still checked when supplied because it is the same
 * selected variant's read-model mirror, not another level's fallback.
 */
export function resolveArtifactPlaybackTempo(
  manifest: ArrangementManifest | null,
  notesTempo: unknown,
  databaseTempo?: unknown,
): ArtifactTempoResolution {
  if (!validBpm(notesTempo)) {
    return {
      status: "invalid",
      bpm: null,
      errors: ["selected notes.json must contain tempoBpm between 20 and 300"],
    };
  }
  if (databaseTempo !== undefined && !validBpm(databaseTempo)) {
    return {
      status: "invalid",
      bpm: null,
      errors: ["database tempo must be between 20 and 300"],
    };
  }

  if (!manifest) {
    if (databaseTempo !== undefined && !temposAgree(databaseTempo, notesTempo)) {
      return {
        status: "invalid",
        bpm: null,
        errors: [`legacy tempo mismatch: notes.json=${notesTempo}, database=${databaseTempo}`],
      };
    }
    return { status: "legacy", bpm: notesTempo, errors: [] };
  }

  const playbackBpm = manifest.tempo.playback.bpm;
  const errors: string[] = [];
  if (!temposAgree(notesTempo, playbackBpm)) {
    errors.push(`tempo mismatch: manifest playback=${playbackBpm}, notes.json=${notesTempo}`);
  }
  if (databaseTempo !== undefined && !temposAgree(databaseTempo, playbackBpm)) {
    errors.push(`tempo mismatch: manifest playback=${playbackBpm}, database=${databaseTempo}`);
  }
  if (errors.length) return { status: "invalid", bpm: null, errors };
  return { status: "valid", bpm: playbackBpm, manifest, errors: [] };
}

export function createLegacyBootstrapManifest(baseId: string, bpm: number, now = new Date().toISOString()): ArrangementManifest {
  const manifest: ArrangementManifest = {
    schemaVersion: ARRANGEMENT_MANIFEST_SCHEMA_VERSION,
    baseId,
    identityStatus: "legacy-bootstrap",
    tempo: {
      calibration: { bpm, source: "legacy", resolvedAt: now, role: "source-calibration" },
      playback: { bpm, source: "legacy", resolvedAt: now, role: "playback" },
    },
    artifactWrittenAt: now,
  };
  return parseArrangementManifest(manifest);
}

export function arrangementManifestPath(baseId: string, root = dataDir()): string {
  return join(root, "artifacts", baseId, "manifest.json");
}

export async function readArrangementManifest(baseId: string, root = dataDir()): Promise<ArrangementManifestRead> {
  const path = arrangementManifestPath(baseId, root);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    try {
      return { status: "valid", path, manifest: parseArrangementManifest(raw) };
    } catch (error) {
      return { status: "invalid", path, errors: [(error as Error).message] };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", path };
    return { status: "invalid", path, errors: [`unable to read manifest: ${(error as Error).message}`] };
  }
}

export async function writeArrangementManifestFile(path: string, manifest: ArrangementManifest): Promise<void> {
  const normalized = parseArrangementManifest(manifest);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
