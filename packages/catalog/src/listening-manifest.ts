/**
 * Pure contracts for local MIDI listening comparisons.
 *
 * This module deliberately knows nothing about MIDI rendering.  It turns
 * renderer outputs into a small, deterministic manifest and a blank human
 * scoring worksheet.  Local filesystem paths are retained only on the
 * convenience object returned by createListeningManifest; canonical output
 * contains logical artifact ids instead.
 */

export const LISTENING_MANIFEST_SCHEMA_VERSION = 1 as const;

export const LISTENING_WORKSHEET_DIMENSIONS = [
  "recognizability",
  "melodyCorrectness",
  "harmonyCorrectness",
  "rhythmTiming",
  "cleanliness",
  "pianisticQuality",
  "playability",
] as const;

export type ListeningWorksheetDimension = typeof LISTENING_WORKSHEET_DIMENSIONS[number];
export type ListeningNormalizationMethod = "none" | "peak";
export type ListeningDurationStatus = "ok" | "warning" | "unavailable" | "invalid";

export interface ListeningSoundfontInput {
  identifier?: string;
  sha256?: string | null;
  path?: string;
}

export interface ListeningRendererInput {
  backend: string;
  version: string;
  sampleRate: number;
  channels?: 1 | 2;
  soundfont?: ListeningSoundfontInput;
}

export interface ListeningRendererRecord {
  backend: string;
  version: string;
  sampleRate: number;
  channels: 1 | 2;
  soundfont?: {
    identifier: string;
    sha256: string | null;
    /** Local-only convenience field; omitted by canonical output. */
    path?: string;
  };
}

export interface ListeningNormalizationConfig {
  /** Fixed normalization method. The renderer must not normalize per candidate. */
  method: ListeningNormalizationMethod;
  /** Target peak in dBFS for peak normalization. */
  targetPeakDb: number;
  /** Safety ceiling for a global gain transform. */
  maxGainDb: number;
  sampleRate: number;
  channels: 1 | 2;
}

export const DEFAULT_LISTENING_NORMALIZATION: ListeningNormalizationConfig = Object.freeze({
  method: "peak",
  targetPeakDb: -1,
  maxGainDb: 12,
  sampleRate: 44_100,
  channels: 2,
});

export interface ListeningDurationDiagnostics {
  expectedSeconds: number | null;
  actualSeconds: number | null;
  deltaSeconds: number | null;
  toleranceSeconds: number;
  status: ListeningDurationStatus;
}

export interface ListeningCandidateInput {
  id: string;
  label?: string;
  sourceType?: string;
  /** A logical artifact id may be supplied when the local path is private. */
  midiRef?: string;
  wavRef?: string;
  /** Local-only paths used by the convenience listening manifest. */
  midiPath?: string;
  wavPath?: string;
  /** `midi`/`durationSeconds` are accepted as aliases for integration callers. */
  midi?: string;
  wav?: string;
  durationSeconds?: number;
  midiDurationSeconds?: number;
  expectedDurationSeconds?: number;
  renderedDurationSeconds?: number;
  renderedSampleCount?: number;
}

export interface ListeningArtifactRecord {
  id: string | null;
  /** Local-only convenience path. Omitted by canonical output. */
  path?: string;
}

export interface ListeningCandidateRecord {
  id: string;
  label?: string;
  sourceType: string;
  midi: ListeningArtifactRecord;
  wav: ListeningArtifactRecord;
  duration: ListeningDurationDiagnostics;
  renderedSampleCount: number | null;
}

export interface ListeningExcerptInput {
  id: string;
  label?: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ListeningExcerptRecord {
  id: string;
  label?: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ListeningBlindAlias {
  alias: string;
  candidateId: string;
}

export interface ListeningManifestInput {
  renderer: ListeningRendererInput;
  candidates: readonly ListeningCandidateInput[];
  excerpts?: readonly ListeningExcerptInput[];
  /** Enables deterministic A/B aliases in the convenience manifest. */
  blind?: boolean;
  normalization?: Partial<ListeningNormalizationConfig>;
  /** Optional upper bound used to validate excerpt end times. */
  durationSeconds?: number;
}

export interface ListeningManifest {
  schemaVersion: typeof LISTENING_MANIFEST_SCHEMA_VERSION;
  renderer: ListeningRendererRecord;
  normalization: ListeningNormalizationConfig;
  candidates: ListeningCandidateRecord[];
  excerpts: ListeningExcerptRecord[];
  blind: { aliases: ListeningBlindAlias[] };
}

export interface ListeningWorksheetCandidate {
  /** Display id, normally a blind alias such as A or B. */
  id: string;
  /** Original id is useful to a local worksheet generator but is not shown in Markdown. */
  candidateId: string;
  artifactRef: string | null;
  scores: Record<ListeningWorksheetDimension, number | null>;
  wouldRecognize: boolean | null;
  largestAudibleDefect: string;
  notes: string;
}

export interface ListeningWorksheet {
  schemaVersion: 1;
  title: string;
  scoreScale: Record<1 | 2 | 3 | 4 | 5, string>;
  dimensions: readonly ListeningWorksheetDimension[];
  candidates: ListeningWorksheetCandidate[];
}

export interface ExcerptValidationOptions {
  durationSeconds?: number;
  /** Overlap is valid by default; set this when excerpts must be disjoint. */
  rejectOverlap?: boolean;
}

export interface BlankWorksheetOptions {
  title?: string;
  blind?: boolean;
  aliases?: readonly ListeningBlindAlias[];
}

const EPS = 1e-9;
const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.1;
const PATH_KEY = /(?:^|_)(?:absolute)?path$/i;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeFinite(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function normalizeSampleRate(value: unknown, fallback: number): number {
  const sampleRate = value === undefined ? fallback : value;
  if (!finite(sampleRate) || sampleRate <= 0 || !Number.isInteger(sampleRate)) {
    throw new Error("sampleRate must be a positive integer");
  }
  return sampleRate;
}

function normalizeChannels(value: unknown, fallback: 1 | 2): 1 | 2 {
  const channels = value === undefined ? fallback : value;
  if (channels !== 1 && channels !== 2) throw new Error("channels must be 1 or 2");
  return channels;
}

function basenameLike(value: string): string {
  const slash = value.replaceAll("\\", "/");
  const last = slash.slice(slash.lastIndexOf("/") + 1);
  return last || "artifact";
}

/** Convert an optional local path/ref into a stable logical artifact id. */
export function logicalListeningArtifactId(value: string | undefined, fallback: string): string | null {
  if (value === undefined || !value.trim()) return null;
  const trimmed = value.trim();
  // Preserve web/object URLs as logical source references. Local file URLs and
  // absolute/relative paths are represented by their basename only.
  if (/^(?:https?|s3):\/\//i.test(trimmed)) return trimmed;
  if (/^file:\/\//i.test(trimmed)) return basenameLike(trimmed.replace(/^file:\/\//i, ""));
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    return basenameLike(trimmed);
  }
  return trimmed || fallback;
}

function artifactRecord(ref: string | undefined, path: string | undefined, fallback: string): ListeningArtifactRecord {
  return {
    id: logicalListeningArtifactId(ref ?? path, fallback),
    ...(path ? { path } : {}),
  };
}

function normalizeRenderer(input: ListeningRendererInput): ListeningRendererRecord {
  const backend = requireText(input.backend, "renderer.backend");
  const version = requireText(input.version, "renderer.version");
  const sampleRate = normalizeSampleRate(input.sampleRate, DEFAULT_LISTENING_NORMALIZATION.sampleRate);
  const channels = normalizeChannels(input.channels, DEFAULT_LISTENING_NORMALIZATION.channels);
  const soundfont = input.soundfont
    ? {
      identifier: requireText(input.soundfont.identifier ?? "soundfont", "renderer.soundfont.identifier"),
      sha256: input.soundfont.sha256 === undefined || input.soundfont.sha256 === null ? null : requireText(input.soundfont.sha256, "renderer.soundfont.sha256"),
      ...(input.soundfont.path ? { path: input.soundfont.path } : {}),
    }
    : undefined;
  return { backend, version, sampleRate, channels, ...(soundfont ? { soundfont } : {}) };
}

export function normalizeListeningNormalization(
  input: Partial<ListeningNormalizationConfig> | undefined,
  renderer?: Pick<ListeningRendererRecord, "sampleRate" | "channels">,
): ListeningNormalizationConfig {
  const source = input ?? {};
  const method = source.method ?? DEFAULT_LISTENING_NORMALIZATION.method;
  if (method !== "none" && method !== "peak") throw new Error("normalization.method must be 'none' or 'peak'");
  const targetPeakDb = source.targetPeakDb ?? DEFAULT_LISTENING_NORMALIZATION.targetPeakDb;
  const maxGainDb = source.maxGainDb ?? DEFAULT_LISTENING_NORMALIZATION.maxGainDb;
  if (!finite(targetPeakDb) || targetPeakDb > 0) throw new Error("normalization.targetPeakDb must be finite and at or below 0 dBFS");
  if (!finite(maxGainDb) || maxGainDb < 0) throw new Error("normalization.maxGainDb must be finite and non-negative");
  const sampleRate = normalizeSampleRate(source.sampleRate, renderer?.sampleRate ?? DEFAULT_LISTENING_NORMALIZATION.sampleRate);
  const channels = normalizeChannels(source.channels, renderer?.channels ?? DEFAULT_LISTENING_NORMALIZATION.channels);
  return { method, targetPeakDb, maxGainDb, sampleRate, channels };
}

export function durationDiagnostics(
  expectedSeconds: number | undefined,
  actualSeconds: number | undefined,
  toleranceSeconds = DEFAULT_DURATION_TOLERANCE_SECONDS,
): ListeningDurationDiagnostics {
  const expected = expectedSeconds === undefined ? null : expectedSeconds;
  const actual = actualSeconds === undefined ? null : actualSeconds;
  if ((expected !== null && !nonNegativeFinite(expected)) || (actual !== null && !nonNegativeFinite(actual))) {
    return {
      expectedSeconds: nonNegativeFinite(expected) ? round(expected) : null,
      actualSeconds: nonNegativeFinite(actual) ? round(actual) : null,
      deltaSeconds: null,
      toleranceSeconds: round(Math.max(0, toleranceSeconds)),
      status: "invalid",
    };
  }
  const tolerance = finite(toleranceSeconds) && toleranceSeconds >= 0 ? round(toleranceSeconds) : DEFAULT_DURATION_TOLERANCE_SECONDS;
  if (expected === null || actual === null) return { expectedSeconds: expected, actualSeconds: actual, deltaSeconds: null, toleranceSeconds: tolerance, status: "unavailable" };
  const delta = round(actual - expected);
  return {
    expectedSeconds: round(expected),
    actualSeconds: round(actual),
    deltaSeconds: delta,
    toleranceSeconds: tolerance,
    status: Math.abs(delta) <= tolerance + EPS ? "ok" : "warning",
  };
}

export function validateExcerptRanges(
  excerpts: readonly ListeningExcerptInput[],
  options: ExcerptValidationOptions = {},
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const normalized: ListeningExcerptRecord[] = [];
  if (options.durationSeconds !== undefined && !nonNegativeFinite(options.durationSeconds)) errors.push("durationSeconds must be finite and non-negative");
  for (const excerpt of excerpts) {
    const id = typeof excerpt?.id === "string" ? excerpt.id.trim() : "";
    if (!id) {
      errors.push("excerpt id must be a non-empty string");
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate excerpt id: ${id}`);
    seen.add(id);
    const start = excerpt.startSeconds;
    const end = excerpt.endSeconds;
    if (!finite(start)) errors.push(`excerpt ${id} startSeconds must be finite`);
    else if (start < 0) errors.push(`excerpt ${id} startSeconds must be non-negative`);
    if (!finite(end)) errors.push(`excerpt ${id} endSeconds must be finite`);
    else if (end <= (finite(start) ? start : 0) + EPS) errors.push(`excerpt ${id} must end after it starts`);
    if (options.durationSeconds !== undefined && finite(end) && end > options.durationSeconds + EPS) errors.push(`excerpt ${id} ends after the available duration`);
    if (finite(start) && start >= 0 && finite(end) && end > start + EPS) normalized.push({
      id,
      ...(typeof excerpt.label === "string" && excerpt.label.trim() ? { label: excerpt.label.trim() } : {}),
      startSeconds: round(start),
      endSeconds: round(end),
    });
  }
  if (options.rejectOverlap) {
    normalized.sort((a, b) => a.startSeconds - b.startSeconds || compareText(a.id, b.id));
    for (let index = 1; index < normalized.length; index += 1) {
      const previous = normalized[index - 1]!;
      const current = normalized[index]!;
      if (current.startSeconds < previous.endSeconds - EPS) errors.push(`excerpts ${previous.id} and ${current.id} overlap`);
    }
  }
  return errors;
}

export function normalizeExcerptRanges(
  excerpts: readonly ListeningExcerptInput[],
  options: ExcerptValidationOptions = {},
): ListeningExcerptRecord[] {
  const errors = validateExcerptRanges(excerpts, options);
  if (errors.length) throw new Error(`Invalid listening excerpts: ${errors.join("; ")}`);
  return excerpts.map((excerpt) => ({
    id: excerpt.id.trim(),
    ...(typeof excerpt.label === "string" && excerpt.label.trim() ? { label: excerpt.label.trim() } : {}),
    startSeconds: round(excerpt.startSeconds),
    endSeconds: round(excerpt.endSeconds),
  })).sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || compareText(a.id, b.id));
}

function aliasFor(index: number): string {
  let value = index + 1;
  let alias = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    alias = String.fromCharCode(65 + remainder) + alias;
    value = Math.floor((value - 1) / 26);
  }
  return alias;
}

/** Stable A, B, ... aliases based on logical candidate ids, not input order. */
export function createBlindAliases(candidateIds: readonly string[]): ListeningBlindAlias[] {
  const ids = candidateIds.map((id) => requireText(id, "candidate id"));
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error("candidate ids must be unique for blind aliases");
  return [...ids].sort(compareText).map((candidateId, index) => ({ alias: aliasFor(index), candidateId }));
}

function normalizeCandidate(input: ListeningCandidateInput): ListeningCandidateRecord {
  const id = requireText(input.id, "candidate.id");
  const midiPath = typeof input.midiPath === "string" && input.midiPath.trim() ? input.midiPath.trim() : undefined;
  const wavPath = typeof input.wavPath === "string" && input.wavPath.trim() ? input.wavPath.trim() : undefined;
  const midiRef = input.midiRef ?? input.midi;
  const wavRef = input.wavRef ?? input.wav;
  const expected = input.expectedDurationSeconds ?? input.midiDurationSeconds ?? input.durationSeconds;
  const duration = durationDiagnostics(expected, input.renderedDurationSeconds);
  return {
    id,
    ...(typeof input.label === "string" && input.label.trim() ? { label: input.label.trim() } : {}),
    sourceType: typeof input.sourceType === "string" && input.sourceType.trim() ? input.sourceType.trim() : "unknown",
    midi: artifactRecord(midiRef, midiPath, `${id}.mid`),
    wav: artifactRecord(wavRef, wavPath, `${id}.wav`),
    duration,
    renderedSampleCount: nonNegativeFinite(input.renderedSampleCount) ? Math.trunc(input.renderedSampleCount) : null,
  };
}

export function createListeningManifest(input: ListeningManifestInput): ListeningManifest {
  const renderer = normalizeRenderer(input.renderer);
  const candidates = input.candidates.map(normalizeCandidate).sort((a, b) => compareText(a.id, b.id));
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new Error("candidate ids must be unique");
  const excerpts = normalizeExcerptRanges(input.excerpts ?? [], { durationSeconds: input.durationSeconds });
  const aliases = input.blind ? createBlindAliases(candidates.map((candidate) => candidate.id)) : [];
  return {
    schemaVersion: LISTENING_MANIFEST_SCHEMA_VERSION,
    renderer,
    normalization: normalizeListeningNormalization(input.normalization, renderer),
    candidates,
    excerpts,
    blind: { aliases },
  };
}

function redactPathLikeString(value: string): string {
  return value
    .replace(/(^|[\s("'=,;\[\]])\/(?:[^\s"'<>;,)]*\/)+[^\s"'<>;,)]*/g, "$1[redacted-path]")
    .replace(/(^|[\s("'=,;\[\]])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, "$1[redacted-path]")
    .replace(/(^|\s)(\.\.?\/|[^\s/]+\/)[^\s"']+\.(?:mid|midi|wav|mp3|sf2)(?=$|[\s"'])/gi, "$1[redacted-path]");
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key && PATH_KEY.test(key)) return undefined;
  if (typeof value === "string") return redactPathLikeString(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(object).sort(compareText)) {
      const item = canonicalize(object[objectKey], objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }
  return value;
}

/** Path-safe canonical representation; local convenience paths are omitted. */
export function canonicalListeningManifest(manifest: ListeningManifest): object {
  const candidates = [...manifest.candidates].sort((a, b) => compareText(a.id, b.id)).map((candidate) => ({
    id: candidate.id,
    ...(candidate.label ? { label: candidate.label } : {}),
    sourceType: candidate.sourceType,
    midi: { id: candidate.midi.id },
    wav: { id: candidate.wav.id },
    duration: candidate.duration,
    renderedSampleCount: candidate.renderedSampleCount,
  }));
  return canonicalize({
    schemaVersion: manifest.schemaVersion,
    renderer: manifest.renderer,
    normalization: manifest.normalization,
    candidates,
    excerpts: [...manifest.excerpts].sort((a, b) => a.startSeconds - b.startSeconds || compareText(a.id, b.id)),
    blind: { aliases: [...manifest.blind.aliases].sort((a, b) => compareText(a.alias, b.alias)) },
  }) as object;
}

export function canonicalListeningManifestJson(manifest: ListeningManifest): string {
  return JSON.stringify(canonicalListeningManifest(manifest));
}

function candidateInputForWorksheet(candidate: ListeningCandidateInput | ListeningCandidateRecord): { id: string; artifactRef: string | null } {
  const record = candidate as ListeningCandidateRecord;
  if (record.midi && typeof record.midi === "object") return { id: record.id, artifactRef: record.wav.id };
  const input = candidate as ListeningCandidateInput;
  return {
    id: input.id,
    artifactRef: logicalListeningArtifactId(input.wavRef ?? input.wav ?? input.wavPath, `${input.id}.wav`),
  };
}

export function createBlankListeningWorksheet(
  candidates: readonly (ListeningCandidateInput | ListeningCandidateRecord)[],
  options: BlankWorksheetOptions = {},
): ListeningWorksheet {
  const normalized = candidates.map(candidateInputForWorksheet).sort((a, b) => compareText(a.id, b.id));
  const ids = normalized.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) throw new Error("candidate ids must be unique for a worksheet");
  const aliases = options.aliases ? [...options.aliases] : options.blind ? createBlindAliases(ids) : ids.map((candidateId, index) => ({ alias: candidateId, candidateId }));
  const aliasByCandidate = new Map(aliases.map((alias) => [alias.candidateId, alias.alias]));
  const scores = (): Record<ListeningWorksheetDimension, number | null> => Object.fromEntries(
    LISTENING_WORKSHEET_DIMENSIONS.map((dimension) => [dimension, null]),
  ) as Record<ListeningWorksheetDimension, number | null>;
  return {
    schemaVersion: 1,
    title: options.title?.trim() || "MIDI listening comparison",
    scoreScale: { 1: "terrible", 2: "poor", 3: "mixed", 4: "good", 5: "excellent" },
    dimensions: LISTENING_WORKSHEET_DIMENSIONS,
    candidates: normalized.map((candidate) => ({
      id: aliasByCandidate.get(candidate.id) ?? candidate.id,
      candidateId: candidate.id,
      artifactRef: candidate.artifactRef,
      scores: scores(),
      wouldRecognize: null,
      largestAudibleDefect: "",
      notes: "",
    })),
  };
}

const WORKSHEET_LABELS: Record<ListeningWorksheetDimension, string> = {
  recognizability: "Recognizability",
  melodyCorrectness: "Melody correctness",
  harmonyCorrectness: "Harmony correctness",
  rhythmTiming: "Rhythm/timing",
  cleanliness: "Cleanliness",
  pianisticQuality: "Pianistic quality",
  playability: "Playability",
};

/** Render a blank worksheet without pre-populating subjective scores. */
export function renderListeningWorksheetMarkdown(worksheet: ListeningWorksheet): string {
  const lines = [
    `# ${worksheet.title}`,
    "",
    "Score each dimension from 1 (terrible) to 5 (excellent). Leave a score blank until you listen.",
    "The key question is whether you recognize the song without seeing its title.",
    "",
  ];
  for (const candidate of worksheet.candidates) {
    lines.push(`## Candidate ${candidate.id}`);
    if (candidate.artifactRef) lines.push(`Audio: ${candidate.artifactRef}`);
    lines.push("", "| Dimension | Score (1–5) | Notes |", "| --- | --- | --- |");
    for (const dimension of worksheet.dimensions) lines.push(`| ${WORKSHEET_LABELS[dimension]} |  |  |`);
    lines.push("", "Would I recognize the song without seeing its title? YES / NO: ", "", "Largest audible defect: ", "", "Notes: ", "");
  }
  return `${lines.join("\n")}\n`;
}
