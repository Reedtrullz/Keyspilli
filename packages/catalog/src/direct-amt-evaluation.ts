import { createHash } from "node:crypto";

/**
 * Generic, local-only evidence primitives for a windowed automatic music
 * transcription (AMT) experiment.
 *
 * This module has no model, filesystem, network, audio-decoding, or catalog
 * dependencies.  A caller injects PCM bytes, window references, and the route
 * runner.  The runner is deliberately treated as an untrusted boundary: its
 * output is normalized, its device attempts are recorded, and malformed or
 * unavailable evidence never becomes a successful transcription claim.
 */

export const DIRECT_AMT_EVALUATION_SCHEMA_VERSION = 1 as const;

export type DirectAmtDevice = "mps" | "cpu";
export type DirectAmtTimeBase = "window" | "song";
export type DirectAmtTimeBaseInput = DirectAmtTimeBase | "relative" | "absolute";
export type DirectAmtRouteStatus = "available" | "unavailable" | "malformed" | "timeout" | "failed";

export interface DirectAmtPcmSource {
  /** Interleaved raw PCM bytes. The caller chooses the PCM encoding. */
  bytes: Uint8Array | ArrayBuffer;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
}

/** Accepted aliases make the injected boundary convenient without changing the canonical contract. */
export interface DirectAmtPcmSourceInput extends Partial<DirectAmtPcmSource> {
  sampleRateHz?: number;
  channelCount?: number;
  bytesPerFrame?: number;
  bitDepth?: number;
}

export interface DirectAmtWindowSpec {
  id?: string;
  label?: string;
  startSample?: number;
  endSample?: number;
  startFrame?: number;
  endFrame?: number;
  sampleStart?: number;
  sampleEnd?: number;
  startSeconds?: number;
  endSeconds?: number;
  startSec?: number;
  endSec?: number;
}

/** A validated half-open frame range with a copied PCM excerpt. */
export interface DirectAmtWindowMetadata {
  id: string;
  label?: string;
  startSample: number;
  endSample: number;
  sampleCount: number;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  byteOffset: number;
  byteLength: number;
  sourceSha256: string;
  windowSha256: string;
  /** Copied bytes, so an injected mutable source cannot change the evidence. */
  bytes: Uint8Array;
}

/** Serializable window provenance; deliberately excludes copied PCM bytes. */
export type DirectAmtWindowProvenance = Omit<DirectAmtWindowMetadata, "bytes">;

type ByteInput = Uint8Array | ArrayBuffer;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value >= 0;
}

function asBytes(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error(`${label} must be Uint8Array or ArrayBuffer`);
}

function sourceValues(source: DirectAmtPcmSourceInput): {
  bytes: Uint8Array;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
} {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("direct AMT PCM source must be an object");
  }
  const bytes = asBytes(source.bytes, "direct AMT PCM source bytes");
  const sampleRate = source.sampleRate ?? source.sampleRateHz;
  const channels = source.channels ?? source.channelCount;
  const bytesPerSample = source.bytesPerSample
    ?? (finite(source.bytesPerFrame) && positiveInteger(channels) && source.bytesPerFrame % channels === 0 ? source.bytesPerFrame / channels : undefined)
    ?? (finite(source.bitDepth) && source.bitDepth > 0 && source.bitDepth % 8 === 0 ? source.bitDepth / 8 : undefined);
  if (!finite(sampleRate) || sampleRate <= 0) throw new Error("direct AMT PCM source sample rate must be positive");
  if (!positiveInteger(channels)) throw new Error("direct AMT PCM source channels must be a positive integer");
  if (!positiveInteger(bytesPerSample)) throw new Error("direct AMT PCM source bytesPerSample must be a positive integer");
  const frameBytes = channels * bytesPerSample;
  if (!Number.isSafeInteger(frameBytes) || frameBytes <= 0 || bytes.length % frameBytes !== 0) {
    throw new Error("direct AMT PCM bytes must be frame-aligned");
  }
  return { bytes, sampleRate, channels, bytesPerSample };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Hash the raw source bytes only; metadata and input object identity do not affect the result. */
export function hashDirectAmtSource(value: ByteInput | DirectAmtPcmSourceInput): string {
  const bytes = value && typeof value === "object" && "bytes" in value
    ? asBytes((value as DirectAmtPcmSourceInput).bytes, "direct AMT PCM source bytes")
    : asBytes(value, "direct AMT source bytes");
  return sha256(bytes);
}

/** Hash the copied bytes of one window. */
export function hashDirectAmtWindow(value: ByteInput | Pick<DirectAmtWindowMetadata, "bytes">): string {
  const bytes = value && typeof value === "object" && "bytes" in value
    ? asBytes(value.bytes, "direct AMT window bytes")
    : asBytes(value, "direct AMT window bytes");
  return sha256(bytes);
}

function numberAlias(value: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

function sampleFromSeconds(value: unknown, sampleRate: number, name: string): number {
  if (!finite(value) || value < 0) throw new Error(`${name} must be a finite non-negative time`);
  const sample = (value as number) * sampleRate;
  const rounded = Math.round(sample);
  if (!Number.isSafeInteger(rounded) || Math.abs(sample - rounded) > 1e-8) {
    throw new Error(`${name} must be sample-aligned`);
  }
  return rounded;
}

function normalizedBounds(raw: unknown, sampleRate: number, index: number): { id?: string; label?: string; startSample: number; endSample: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`invalid direct AMT window at index ${index}`);
  }
  const value = raw as Record<string, unknown>;
  const startSampleValue = numberAlias(value, ["startSample", "sampleStart", "startFrame"]);
  const endSampleValue = numberAlias(value, ["endSample", "sampleEnd", "endFrame"]);
  const startTimeValue = numberAlias(value, ["startSeconds", "startSec"]);
  const endTimeValue = numberAlias(value, ["endSeconds", "endSec"]);
  let startSample: number;
  let endSample: number;
  if (startSampleValue !== undefined || endSampleValue !== undefined) {
    if (!nonNegativeInteger(startSampleValue) || !nonNegativeInteger(endSampleValue)) {
      throw new Error(`direct AMT window ${index} bounds must be non-negative integer samples`);
    }
    startSample = startSampleValue;
    endSample = endSampleValue;
  } else {
    if (startTimeValue === undefined || endTimeValue === undefined) {
      throw new Error(`direct AMT window ${index} requires sample or second bounds`);
    }
    startSample = sampleFromSeconds(startTimeValue, sampleRate, `direct AMT window ${index} start`);
    endSample = sampleFromSeconds(endTimeValue, sampleRate, `direct AMT window ${index} end`);
  }
  const idValue = value.id;
  const labelValue = value.label;
  const id = typeof idValue === "string" && idValue.trim() ? idValue.trim() : undefined;
  const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : undefined;
  return { ...(id ? { id } : {}), ...(label ? { label } : {}), startSample, endSample };
}

function compareWindowBounds(left: { id?: string; startSample: number; endSample: number }, right: { id?: string; startSample: number; endSample: number }): number {
  return left.startSample - right.startSample
    || left.endSample - right.endSample
    || stableCompare(left.id ?? "", right.id ?? "");
}

/**
 * Validate, sort, and extract half-open windows.  Windows may overlap (which
 * is useful for context-window experiments), but every boundary must be an
 * integer frame inside the injected source and IDs must be unique.
 */
export function extractDirectAmtWindows(
  sourceInput: DirectAmtPcmSourceInput,
  windows: readonly DirectAmtWindowSpec[],
): DirectAmtWindowMetadata[] {
  const source = sourceValues(sourceInput);
  if (!Array.isArray(windows)) throw new Error("direct AMT windows must be an array");
  const frameBytes = source.channels * source.bytesPerSample;
  const frameCount = source.bytes.length / frameBytes;
  const sourceSha256 = sha256(source.bytes);
  const ids = new Set<string>();
  const bounds = windows.map((raw, index) => normalizedBounds(raw, source.sampleRate, index)).map((item, index) => {
    const id = item.id ?? `window-${item.startSample}-${item.endSample}`;
    if (ids.has(id)) throw new Error(`duplicate direct AMT window id: ${id}`);
    ids.add(id);
    if (item.endSample <= item.startSample || item.startSample < 0 || item.endSample > frameCount) {
      throw new Error(`invalid direct AMT window bounds at index ${index}`);
    }
    return { ...item, id };
  });
  bounds.sort(compareWindowBounds);
  return bounds.map((item) => {
    const byteOffset = item.startSample * frameBytes;
    const byteLength = (item.endSample - item.startSample) * frameBytes;
    const bytes = new Uint8Array(source.bytes.slice(byteOffset, byteOffset + byteLength));
    return {
      id: item.id,
      ...(item.label ? { label: item.label } : {}),
      startSample: item.startSample,
      endSample: item.endSample,
      sampleCount: item.endSample - item.startSample,
      sampleRate: source.sampleRate,
      channels: source.channels,
      bytesPerSample: source.bytesPerSample,
      startSeconds: item.startSample / source.sampleRate,
      endSeconds: item.endSample / source.sampleRate,
      durationSeconds: (item.endSample - item.startSample) / source.sampleRate,
      byteOffset,
      byteLength,
      sourceSha256,
      windowSha256: sha256(bytes),
      bytes,
    };
  });
}

/** Validation-only alias retained as a convenient contract boundary. */
export const validateDirectAmtWindows = extractDirectAmtWindows;

export interface DirectAmtNote {
  pitch: number;
  /** Seconds, relative to the window unless the enclosing track says `song`. */
  onset: number;
  offset?: number;
  confidence?: number;
  unsupported?: boolean;
}

export interface DirectAmtNoteInput {
  pitch?: number;
  midi?: number;
  onset?: number;
  onsetSeconds?: number;
  start?: number;
  offset?: number;
  offsetSeconds?: number;
  end?: number;
  duration?: number;
  dur?: number;
  confidence?: number;
  unsupported?: boolean;
  supported?: boolean;
}

export interface DirectAmtTrackOutput {
  id: string;
  role: string;
  notes: readonly DirectAmtNote[];
  timeBase: DirectAmtTimeBase;
}

export interface DirectAmtTrackOutputInput {
  id?: string;
  trackId?: string;
  name?: string;
  role: string;
  notes: readonly DirectAmtNoteInput[];
  timeBase?: DirectAmtTimeBaseInput;
}

function compareNotes(left: DirectAmtNote, right: DirectAmtNote): number {
  return left.onset - right.onset
    || left.pitch - right.pitch
    || (left.offset ?? Number.POSITIVE_INFINITY) - (right.offset ?? Number.POSITIVE_INFINITY)
    || (left.confidence ?? Number.POSITIVE_INFINITY) - (right.confidence ?? Number.POSITIVE_INFINITY)
    || Number(left.unsupported ?? false) - Number(right.unsupported ?? false);
}

function trackFingerprint(role: string, timeBase: DirectAmtTimeBase, notes: readonly DirectAmtNote[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ role, timeBase, notes }))
    .digest("hex");
}

function normalizeNote(raw: unknown, trackId: string, index: number): DirectAmtNote {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`malformed direct AMT note in track ${trackId} at index ${index}`);
  }
  const value = raw as Record<string, unknown>;
  const pitchValue = numberAlias(value, ["pitch", "midi"]);
  const onsetValue = numberAlias(value, ["onset", "onsetSeconds", "start"]);
  const offsetValue = numberAlias(value, ["offset", "offsetSeconds", "end"]);
  const durationValue = numberAlias(value, ["duration", "dur"]);
  if (!finite(pitchValue)) throw new Error(`malformed direct AMT pitch in track ${trackId} at index ${index}`);
  if (!finite(onsetValue)) throw new Error(`malformed direct AMT onset in track ${trackId} at index ${index}`);
  let offset: number | undefined;
  if (offsetValue !== undefined) {
    if (!finite(offsetValue)) throw new Error(`malformed direct AMT offset in track ${trackId} at index ${index}`);
    offset = offsetValue;
  } else if (durationValue !== undefined) {
    if (!finite(durationValue) || durationValue < 0) throw new Error(`malformed direct AMT duration in track ${trackId} at index ${index}`);
    offset = (onsetValue as number) + durationValue;
  }
  if (offset !== undefined && offset < onsetValue) {
    throw new Error(`direct AMT note offset precedes onset in track ${trackId} at index ${index}`);
  }
  const confidenceValue = value.confidence;
  if (confidenceValue !== undefined && (!finite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)) {
    throw new Error(`malformed direct AMT confidence in track ${trackId} at index ${index}`);
  }
  const unsupported = value.unsupported === true || value.supported === false;
  return {
    pitch: pitchValue,
    onset: onsetValue,
    ...(offset === undefined ? {} : { offset }),
    ...(confidenceValue === undefined ? {} : { confidence: confidenceValue as number }),
    ...(unsupported ? { unsupported: true } : {}),
  };
}

/** Normalize injected tracks without dropping role labels or flattening lanes. */
export function normalizeDirectAmtTrackOutputs(value: unknown): DirectAmtTrackOutput[] {
  const rawTracks = value && typeof value === "object" && !Array.isArray(value) && "tracks" in value
    ? (value as { tracks?: unknown }).tracks
    : value;
  if (!Array.isArray(rawTracks)) throw new Error("direct AMT tracks must be an array");
  const noteArray = rawTracks.length > 0 && rawTracks.every((raw) => raw && typeof raw === "object" && !Array.isArray(raw)
    && !("notes" in (raw as object))
    && (["pitch", "midi", "onset", "onsetSeconds", "start"] as const).some((key) => key in (raw as object)));
  const trackRows: unknown[] = noteArray
    ? [{ id: "track-0", role: "other", notes: rawTracks, timeBase: "window" }]
    : rawTracks;
  const pending = trackRows.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`malformed direct AMT track at index ${index}`);
    const source = raw as Record<string, unknown>;
    const idValue = source.id ?? source.trackId ?? source.name;
    const roleValue = source.role;
    const explicitId = typeof idValue === "string" && idValue.trim() ? idValue.trim() : null;
    const role = typeof roleValue === "string" ? roleValue.trim() : "";
    if (!role) throw new Error(`malformed direct AMT track role at index ${index}`);
    const errorTrackId = explicitId ?? `track-${index}`;
    if (!Array.isArray(source.notes)) throw new Error(`malformed direct AMT notes in track ${errorTrackId}`);
    const timeBaseInput = source.timeBase === "relative" ? "window" : source.timeBase === "absolute" ? "song" : source.timeBase;
    const timeBaseValue = timeBaseInput === undefined ? "window" : timeBaseInput;
    if (timeBaseValue !== "window" && timeBaseValue !== "song") throw new Error(`malformed direct AMT time base in track ${errorTrackId}`);
    const timeBase = timeBaseValue as DirectAmtTimeBase;
    const notes = source.notes.map((note, noteIndex) => normalizeNote(note, errorTrackId, noteIndex)).sort(compareNotes);
    return {
      explicitId,
      role,
      notes,
      timeBase,
      fingerprint: trackFingerprint(role, timeBase, notes),
    };
  });
  const explicitIds = new Set<string>();
  for (const row of pending) {
    if (row.explicitId === null) continue;
    if (explicitIds.has(row.explicitId)) throw new Error(`duplicate direct AMT track: ${row.explicitId}`);
    explicitIds.add(row.explicitId);
  }
  pending.sort((left, right) => stableCompare(left.role, right.role)
    || stableCompare(left.explicitId ?? "", right.explicitId ?? "")
    || stableCompare(left.fingerprint, right.fingerprint)
    || stableCompare(left.timeBase, right.timeBase));
  // Reserve explicit IDs before assigning generated IDs so a generated
  // fingerprint can never depend on whether an explicit track happened to
  // appear before or after it in the input array.
  const usedGeneratedIds = new Set(explicitIds);
  const tracks = pending.map((row): DirectAmtTrackOutput => {
    if (row.explicitId !== null) return { id: row.explicitId, role: row.role, notes: row.notes, timeBase: row.timeBase };
    const baseId = `track-${row.role}-${row.fingerprint.slice(0, 16)}`;
    let id = baseId;
    let suffix = 2;
    while (usedGeneratedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedGeneratedIds.add(id);
    return { id, role: row.role, notes: row.notes, timeBase: row.timeBase };
  });
  tracks.sort((left, right) => stableCompare(left.role, right.role) || stableCompare(left.id, right.id));
  return tracks;
}

export const validateDirectAmtTrackOutputs = normalizeDirectAmtTrackOutputs;

export interface DirectAmtRouteRequest {
  songId: string;
  window: DirectAmtWindowMetadata;
  device: DirectAmtDevice;
}

export interface DirectAmtRouteRunnerResult {
  status?: unknown;
  tracks?: unknown;
  durationMs?: unknown;
  error?: unknown;
}

export type DirectAmtRouteRunner = (
  request: DirectAmtRouteRequest,
) => DirectAmtRouteRunnerResult | readonly DirectAmtTrackOutputInput[] | Promise<DirectAmtRouteRunnerResult | readonly DirectAmtTrackOutputInput[]>;

export interface DirectAmtRouteAttempt {
  device: DirectAmtDevice;
  status: DirectAmtRouteStatus;
  durationMs: number | null;
  trackCount: number | null;
  error: string | null;
}

export interface DirectAmtFallbackProvenance {
  kind: "mps-to-cpu";
  from: "mps";
  to: "cpu";
  reason: string;
}

export interface DirectAmtRouteEvidence {
  schemaVersion: typeof DIRECT_AMT_EVALUATION_SCHEMA_VERSION;
  songId: string;
  windowId: string;
  status: DirectAmtRouteStatus;
  requestedDevice: DirectAmtDevice;
  selectedDevice: DirectAmtDevice | null;
  tracks: DirectAmtTrackOutput[];
  attempts: DirectAmtRouteAttempt[];
  fallback: DirectAmtFallbackProvenance | null;
  durationMs: number | null;
  error: string | null;
}

function cleanError(value: unknown, fallback: string): string {
  const text = value instanceof Error && value.message.trim()
    ? value.message
    : typeof value === "string" && value.trim()
      ? value
      : fallback;
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function thrownStatus(error: unknown): DirectAmtRouteStatus {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|etimedout|abort/i.test(message)) return "timeout";
  if (/unavailable|not supported|no device|mps.*(missing|unsupported)/i.test(message)) return "unavailable";
  return "failed";
}

function isDevice(value: unknown): value is DirectAmtDevice {
  return value === "mps" || value === "cpu";
}

function cloneWindowMetadata(window: DirectAmtWindowMetadata): DirectAmtWindowMetadata {
  return { ...window, bytes: new Uint8Array(window.bytes) };
}

function statusValue(value: unknown, error: unknown): DirectAmtRouteStatus | "unknown" {
  if (value === undefined) return error === undefined ? "unknown" : thrownStatus(error);
  if (value === "available" || value === "ok" || value === "success") return "available";
  if (value === "unavailable") return "unavailable";
  if (value === "malformed") return "malformed";
  if (value === "timeout" || value === "timed-out") return "timeout";
  if (value === "failed" || value === "error") {
    const inferred = thrownStatus(error);
    return value === "error" || inferred === "unavailable" ? inferred : "failed";
  }
  return "unknown";
}

interface NormalizedAttempt {
  status: DirectAmtRouteStatus;
  tracks: DirectAmtTrackOutput[];
  durationMs: number | null;
  error: string | null;
}

function normalizeAttempt(value: unknown, device: DirectAmtDevice): NormalizedAttempt {
  if (Array.isArray(value)) {
    try {
      const tracks = normalizeDirectAmtTrackOutputs(value);
      return { status: "available", tracks, durationMs: null, error: null };
    } catch (error) {
      return { status: "malformed", tracks: [], durationMs: null, error: cleanError(error, `malformed ${device} route output`) };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "malformed", tracks: [], durationMs: null, error: `malformed ${device} route result` };
  }
  const source = value as Record<string, unknown>;
  const durationValue = source.durationMs;
  if (durationValue !== undefined && (!finite(durationValue) || durationValue < 0)) {
    return { status: "malformed", tracks: [], durationMs: null, error: `malformed ${device} route duration` };
  }
  const explicitStatus = statusValue(source.status, source.error);
  const tracksValue = source.tracks;
  let status: DirectAmtRouteStatus;
  if (explicitStatus === "unknown") {
    status = source.status === undefined && tracksValue !== undefined ? "available" : "malformed";
  } else {
    status = explicitStatus;
  }
  if (status === "available") {
    if (tracksValue === undefined) {
      return { status: "malformed", tracks: [], durationMs: durationValue === undefined ? null : durationValue as number, error: `available ${device} route omitted tracks` };
    }
    try {
      const tracks = normalizeDirectAmtTrackOutputs(tracksValue);
      return { status, tracks, durationMs: durationValue === undefined ? null : durationValue as number, error: null };
    } catch (error) {
      return { status: "malformed", tracks: [], durationMs: durationValue === undefined ? null : durationValue as number, error: cleanError(error, `malformed ${device} route tracks`) };
    }
  }
  return {
    status,
    tracks: [],
    durationMs: durationValue === undefined ? null : durationValue as number,
    error: cleanError(source.error, `${device} route ${status}`),
  };
}

async function invokeRoute(runner: DirectAmtRouteRunner, request: DirectAmtRouteRequest, timeoutMs: number | undefined): Promise<NormalizedAttempt> {
  if (timeoutMs !== undefined && (!finite(timeoutMs) || timeoutMs < 0)) throw new Error("direct AMT timeoutMs must be non-negative");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const execution = Promise.resolve().then(() => runner(request));
    const result = timeoutMs === undefined
      ? await execution
      : await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("direct AMT route timed out")), timeoutMs);
        }),
      ]);
    return normalizeAttempt(result, request.device);
  } catch (error) {
    const status = thrownStatus(error);
    return { status, tracks: [], durationMs: null, error: cleanError(error, `${request.device} route ${status}`) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Run one injected route, falling back from unavailable MPS to CPU only. */
export async function runDirectAmtWindow(input: {
  songId: string;
  window: DirectAmtWindowMetadata;
  runner: DirectAmtRouteRunner;
  preferredDevice?: DirectAmtDevice;
  timeoutMs?: number;
}): Promise<DirectAmtRouteEvidence> {
  if (!input || typeof input.songId !== "string" || !input.songId.trim()) throw new Error("direct AMT songId is required");
  if (typeof input.runner !== "function") throw new Error("direct AMT route runner is required");
  if (!input.window || typeof input.window !== "object" || !(input.window.bytes instanceof Uint8Array)) {
    throw new Error("direct AMT route window is required");
  }
  const requestedDevice = input.preferredDevice ?? "mps";
  if (!isDevice(requestedDevice)) throw new Error("direct AMT device must be mps or cpu");
  const attempts: DirectAmtRouteAttempt[] = [];
  const firstRequest: DirectAmtRouteRequest = { songId: input.songId, window: cloneWindowMetadata(input.window), device: requestedDevice };
  const first = await invokeRoute(input.runner, firstRequest, input.timeoutMs);
  attempts.push({ device: requestedDevice, status: first.status, durationMs: first.durationMs, trackCount: first.status === "available" ? first.tracks.length : null, error: first.error });
  let selected = first;
  let selectedDevice: DirectAmtDevice | null = first.status === "available" ? requestedDevice : null;
  let fallback: DirectAmtFallbackProvenance | null = null;
  if (requestedDevice === "mps" && first.status === "unavailable") {
    fallback = { kind: "mps-to-cpu", from: "mps", to: "cpu", reason: first.error ?? "MPS route unavailable" };
    const cpu = await invokeRoute(input.runner, { ...firstRequest, window: cloneWindowMetadata(input.window), device: "cpu" }, input.timeoutMs);
    attempts.push({ device: "cpu", status: cpu.status, durationMs: cpu.durationMs, trackCount: cpu.status === "available" ? cpu.tracks.length : null, error: cpu.error });
    selected = cpu;
    selectedDevice = cpu.status === "available" ? "cpu" : null;
  }
  const knownDurations = attempts.map((attempt) => attempt.durationMs).filter((duration): duration is number => duration !== null);
  return {
    schemaVersion: DIRECT_AMT_EVALUATION_SCHEMA_VERSION,
    songId: input.songId.trim(),
    windowId: input.window.id,
    status: selected.status,
    requestedDevice,
    selectedDevice,
    tracks: selected.status === "available" ? selected.tracks : [],
    attempts,
    fallback,
    durationMs: knownDurations.length ? knownDurations.reduce((sum, duration) => sum + duration, 0) : null,
    error: selected.status === "available" ? null : selected.error,
  };
}

export const runDirectAmtRoute = runDirectAmtWindow;

export interface DirectAmtMatchMetrics {
  predictedCount: number;
  referenceCount: number;
  matches: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface DirectAmtContourMetrics {
  directionAgreement: number | null;
  matchedTransitions: number;
  referenceTransitions: number;
  predictedTransitions: number;
  comparableTransitions: number;
}

export interface DirectAmtUnsupportedDensity {
  count: number;
  total: number;
  rate: number;
}

export interface DirectAmtRoleOracleMetrics {
  exact: DirectAmtMatchMetrics;
  exactPitch: DirectAmtMatchMetrics;
  pitchClass: DirectAmtMatchMetrics;
  onset: DirectAmtMatchMetrics;
  contour: DirectAmtContourMetrics;
  unsupportedDensity: DirectAmtUnsupportedDensity;
}

/** Per-physical-track metrics retained alongside the role aggregate. */
export interface DirectAmtTrackOracleMetrics {
  role: string;
  referenceTrackId: string | null;
  predictionTrackId: string | null;
  metrics: DirectAmtRoleOracleMetrics;
}

export interface DirectAmtWindowOracleMetrics extends DirectAmtRoleOracleMetrics {
  schemaVersion: typeof DIRECT_AMT_EVALUATION_SCHEMA_VERSION;
  windowId: string;
  predictedNoteCount: number;
  referenceNoteCount: number;
  predictedTrackCount: number;
  referenceTrackCount: number;
  roles: string[];
  byRole: Record<string, DirectAmtRoleOracleMetrics>;
  /** Track-local pairings; role aggregates never mix notes across tracks. */
  byTrack: DirectAmtTrackOracleMetrics[];
}

function ratioMetrics(predictedCount: number, referenceCount: number, matches: number): DirectAmtMatchMetrics {
  const precision = predictedCount > 0 ? matches / predictedCount : null;
  const recall = referenceCount > 0 ? matches / referenceCount : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return { predictedCount, referenceCount, matches, precision, recall, f1 };
}

function pitchClass(pitch: number): number {
  const integer = Math.round(pitch);
  return ((integer % 12) + 12) % 12;
}

interface NotePair {
  reference: DirectAmtNote;
  prediction: DirectAmtNote;
}

function oneToOneMatches(
  reference: readonly DirectAmtNote[],
  prediction: readonly DirectAmtNote[],
  predicate: (reference: DirectAmtNote, prediction: DirectAmtNote) => boolean,
): NotePair[] {
  // Build a deterministic bipartite graph and use augmenting paths rather
  // than greedily consuming the nearest prediction.  A greedy pass can
  // strand a later reference note even though a maximum-cardinality
  // one-to-one assignment exists (for example refs .10/.15 and predictions
  // .04/.14 with a .06 tolerance).  Edges are visited by distance and then
  // input order, so equal-score assignments remain reproducible.
  const edges = reference.map((expected) => prediction
    .map((candidate, index) => ({ index, distance: Math.abs(expected.onset - candidate.onset) }))
    .filter(({ index }) => predicate(expected, prediction[index]!))
    .sort((left, right) => left.distance - right.distance || left.index - right.index));
  const predictionOwner = new Array<number>(prediction.length).fill(-1);
  const referencePrediction = new Array<number>(reference.length).fill(-1);

  const visit = (referenceIndex: number, seen: Set<number>): boolean => {
    for (const edge of edges[referenceIndex]!) {
      if (seen.has(edge.index)) continue;
      seen.add(edge.index);
      const owner = predictionOwner[edge.index]!;
      if (owner < 0 || visit(owner, seen)) {
        predictionOwner[edge.index] = referenceIndex;
        referencePrediction[referenceIndex] = edge.index;
        return true;
      }
    }
    return false;
  };

  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex += 1) {
    visit(referenceIndex, new Set<number>());
  }
  return referencePrediction
    .map((predictionIndex, referenceIndex) => predictionIndex < 0 ? null : {
      reference: reference[referenceIndex]!,
      prediction: prediction[predictionIndex]!,
    })
    .filter((pair): pair is NotePair => pair !== null);
}

function contourMetrics(pairs: readonly NotePair[]): DirectAmtContourMetrics {
  const ordered = [...pairs].sort((left, right) => left.reference.onset - right.reference.onset || left.reference.pitch - right.reference.pitch);
  let referenceTransitions = 0;
  let predictedTransitions = 0;
  let matchedTransitions = 0;
  let comparableTransitions = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const referenceDirection = Math.sign(current.reference.pitch - previous.reference.pitch);
    const predictedDirection = Math.sign(current.prediction.pitch - previous.prediction.pitch);
    referenceTransitions += Number(referenceDirection !== 0);
    predictedTransitions += Number(predictedDirection !== 0);
    if (referenceDirection === 0 && predictedDirection === 0) continue;
    comparableTransitions += 1;
    if (referenceDirection !== 0 && predictedDirection !== 0 && referenceDirection === predictedDirection) {
      matchedTransitions += 1;
    }
  }
  return {
    directionAgreement: comparableTransitions > 0 ? matchedTransitions / comparableTransitions : null,
    matchedTransitions,
    referenceTransitions,
    predictedTransitions,
    comparableTransitions,
  };
}

function durationForWindow(window: Pick<DirectAmtWindowMetadata, "startSeconds" | "endSeconds" | "durationSeconds">): number {
  if (finite(window.durationSeconds) && window.durationSeconds > 0) return window.durationSeconds;
  return Math.max(0, window.endSeconds - window.startSeconds);
}

interface LocalTrackNotes {
  id: string;
  role: string;
  notes: DirectAmtNote[];
}

function localTracks(
  tracks: readonly DirectAmtTrackOutput[],
  window: Pick<DirectAmtWindowMetadata, "startSeconds" | "endSeconds" | "durationSeconds">,
): LocalTrackNotes[] {
  const duration = durationForWindow(window);
  return tracks.map((track): LocalTrackNotes => {
    const lower = track.timeBase === "song" ? window.startSeconds : 0;
    const upper = track.timeBase === "song" ? window.endSeconds : duration;
    const notes: DirectAmtNote[] = [];
    for (const note of track.notes) {
      if (note.onset < lower || note.onset >= upper) continue;
      notes.push(track.timeBase === "song"
        ? { ...note, onset: note.onset - window.startSeconds, ...(note.offset === undefined ? {} : { offset: note.offset - window.startSeconds }) }
        : note);
    }
    notes.sort(compareNotes);
    return { id: track.id, role: track.role, notes };
  }).sort((left, right) => stableCompare(left.role, right.role) || stableCompare(left.id, right.id));
}

function tracksByRole(tracks: readonly LocalTrackNotes[]): Map<string, LocalTrackNotes[]> {
  const result = new Map<string, LocalTrackNotes[]>();
  for (const track of tracks) result.set(track.role, [...(result.get(track.role) ?? []), track]);
  return result;
}

function roleMetrics(reference: readonly DirectAmtNote[], prediction: readonly DirectAmtNote[], onsetToleranceSeconds: number): DirectAmtRoleOracleMetrics {
  const tolerance = onsetToleranceSeconds + 1e-9;
  const exactPairs = oneToOneMatches(reference, prediction, (expected, candidate) => expected.pitch === candidate.pitch && Math.abs(expected.onset - candidate.onset) <= tolerance);
  const pitchClassPairs = oneToOneMatches(reference, prediction, (expected, candidate) => pitchClass(expected.pitch) === pitchClass(candidate.pitch) && Math.abs(expected.onset - candidate.onset) <= tolerance);
  const onsetPairs = oneToOneMatches(reference, prediction, (expected, candidate) => Math.abs(expected.onset - candidate.onset) <= tolerance);
  const unsupportedCount = prediction.filter((note) => note.unsupported === true || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127).length;
  const unsupportedDensity = {
    count: unsupportedCount,
    total: prediction.length,
    rate: prediction.length > 0 ? unsupportedCount / prediction.length : 0,
  };
  return {
    exact: ratioMetrics(prediction.length, reference.length, exactPairs.length),
    exactPitch: ratioMetrics(prediction.length, reference.length, exactPairs.length),
    pitchClass: ratioMetrics(prediction.length, reference.length, pitchClassPairs.length),
    onset: ratioMetrics(prediction.length, reference.length, onsetPairs.length),
    contour: contourMetrics(onsetPairs),
    unsupportedDensity,
  };
}

/** Aggregate role lanes without allowing a melody prediction to match a bass reference. */
function aggregateRoleMetrics(metrics: readonly DirectAmtRoleOracleMetrics[]): DirectAmtRoleOracleMetrics {
  const sumMetric = (key: "exact" | "pitchClass" | "onset"): DirectAmtMatchMetrics => {
    const predictedCount = metrics.reduce((sum, value) => sum + value[key].predictedCount, 0);
    const referenceCount = metrics.reduce((sum, value) => sum + value[key].referenceCount, 0);
    const matches = metrics.reduce((sum, value) => sum + value[key].matches, 0);
    return ratioMetrics(predictedCount, referenceCount, matches);
  };
  const exact = sumMetric("exact");
  const pitchClassValue = sumMetric("pitchClass");
  const onset = sumMetric("onset");
  const unsupportedCount = metrics.reduce((sum, value) => sum + value.unsupportedDensity.count, 0);
  const unsupportedTotal = metrics.reduce((sum, value) => sum + value.unsupportedDensity.total, 0);
  const matchedTransitions = metrics.reduce((sum, value) => sum + value.contour.matchedTransitions, 0);
  const referenceTransitions = metrics.reduce((sum, value) => sum + value.contour.referenceTransitions, 0);
  const predictedTransitions = metrics.reduce((sum, value) => sum + value.contour.predictedTransitions, 0);
  const comparableTransitions = metrics.reduce((sum, value) => sum + value.contour.comparableTransitions, 0);
  return {
    exact,
    exactPitch: { ...exact },
    pitchClass: pitchClassValue,
    onset,
    contour: {
      directionAgreement: comparableTransitions > 0 ? matchedTransitions / comparableTransitions : null,
      matchedTransitions,
      referenceTransitions,
      predictedTransitions,
      comparableTransitions,
    },
    unsupportedDensity: {
      count: unsupportedCount,
      total: unsupportedTotal,
      rate: unsupportedTotal > 0 ? unsupportedCount / unsupportedTotal : 0,
    },
  };
}

/**
 * Score one window.  Notes are clipped by onset to this window and are then
 * matched only within the same semantic role; no neighboring-window context
 * can satisfy an oracle match.
 */
export function scoreDirectAmtWindow(input: {
  window: Pick<DirectAmtWindowMetadata, "id" | "startSeconds" | "endSeconds" | "durationSeconds">;
  reference: unknown;
  prediction: unknown;
  onsetToleranceSeconds?: number;
}): DirectAmtWindowOracleMetrics {
  if (!input || !input.window || typeof input.window !== "object") {
    throw new Error("direct AMT score window is required");
  }
  const scoreWindow = input.window;
  if (!finite(scoreWindow.startSeconds) || !finite(scoreWindow.endSeconds) || !finite(scoreWindow.durationSeconds)
    || scoreWindow.startSeconds < 0
    || scoreWindow.endSeconds <= scoreWindow.startSeconds
    || scoreWindow.durationSeconds <= 0) {
    throw new Error("direct AMT score window bounds must be finite and non-negative");
  }
  const tolerance = input.onsetToleranceSeconds ?? 0.05;
  if (!finite(tolerance) || tolerance < 0) throw new Error("direct AMT onset tolerance must be non-negative");
  const referenceTracks = normalizeDirectAmtTrackOutputs(input.reference);
  const predictionTracks = normalizeDirectAmtTrackOutputs(input.prediction);
  const referenceLocalTracks = localTracks(referenceTracks, input.window);
  const predictionLocalTracks = localTracks(predictionTracks, input.window);
  const referenceByRole = tracksByRole(referenceLocalTracks);
  const predictionByRole = tracksByRole(predictionLocalTracks);
  const roles = [...new Set([...referenceByRole.keys(), ...predictionByRole.keys()])].sort(stableCompare);
  const byRole: Record<string, DirectAmtRoleOracleMetrics> = {};
  const byTrack: DirectAmtTrackOracleMetrics[] = [];
  for (const role of roles) {
    const referenceRoleTracks = referenceByRole.get(role) ?? [];
    const predictionRoleTracks = predictionByRole.get(role) ?? [];
    const pairCount = Math.max(referenceRoleTracks.length, predictionRoleTracks.length);
    const pairMetrics: DirectAmtRoleOracleMetrics[] = [];
    for (let index = 0; index < pairCount; index += 1) {
      const referenceTrack = referenceRoleTracks[index];
      const predictionTrack = predictionRoleTracks[index];
      const metrics = roleMetrics(referenceTrack?.notes ?? [], predictionTrack?.notes ?? [], tolerance);
      pairMetrics.push(metrics);
      byTrack.push({
        role,
        referenceTrackId: referenceTrack?.id ?? null,
        predictionTrackId: predictionTrack?.id ?? null,
        metrics,
      });
    }
    byRole[role] = aggregateRoleMetrics(pairMetrics);
  }
  const allReference = referenceLocalTracks.flatMap((track) => track.notes);
  const allPrediction = predictionLocalTracks.flatMap((track) => track.notes);
  // Aggregate only after role-local scoring.  The aggregate view is a
  // diagnostic convenience; per-role results remain the authoritative
  // comparison and are never mixed to manufacture a role score.
  const aggregate = aggregateRoleMetrics(Object.values(byRole));
  return {
    schemaVersion: DIRECT_AMT_EVALUATION_SCHEMA_VERSION,
    windowId: input.window.id,
    predictedNoteCount: allPrediction.length,
    referenceNoteCount: allReference.length,
    predictedTrackCount: predictionTracks.length,
    referenceTrackCount: referenceTracks.length,
    roles,
    byRole,
    byTrack,
    ...aggregate,
  };
}

export const computeDirectAmtOracleMetrics = scoreDirectAmtWindow;
export const evaluateDirectAmtWindow = scoreDirectAmtWindow;
export const computeDirectAmtWindowMetrics = scoreDirectAmtWindow;

export interface DirectAmtWindowTimingMetrics {
  windowId: string;
  status: DirectAmtRouteStatus;
  requestedDevice: DirectAmtDevice;
  selectedDevice: DirectAmtDevice | null;
  extractionMs: number | null;
  inferenceMs: number | null;
  totalMs: number | null;
  fallback: boolean;
}

export function timingForDirectAmtWindow(
  route: Pick<DirectAmtRouteEvidence, "windowId" | "status" | "requestedDevice" | "selectedDevice" | "durationMs" | "fallback">,
  extractionMs?: number,
): DirectAmtWindowTimingMetrics {
  const validExtraction = extractionMs !== undefined && finite(extractionMs) && extractionMs >= 0 ? extractionMs : null;
  return {
    windowId: route.windowId,
    status: route.status,
    requestedDevice: route.requestedDevice,
    selectedDevice: route.selectedDevice,
    extractionMs: validExtraction,
    inferenceMs: route.durationMs,
    totalMs: route.durationMs === null ? validExtraction : (validExtraction ?? 0) + route.durationMs,
    fallback: route.fallback !== null,
  };
}

export const buildDirectAmtWindowTiming = timingForDirectAmtWindow;

export interface DirectAmtSongTimingMetrics {
  windowCount: number;
  availableWindowCount: number;
  unavailableWindowCount: number;
  malformedWindowCount: number;
  timeoutWindowCount: number;
  failedWindowCount: number;
  fallbackWindowCount: number;
  totalMs: number | null;
  meanMs: number | null;
  p95Ms: number | null;
}

export interface DirectAmtSongWindowEvidence {
  windowId: string;
  /** Sample/time/hash identity for the exact window sent to the route. */
  window?: DirectAmtWindowProvenance;
  route: Pick<DirectAmtRouteEvidence, "status" | "selectedDevice" | "requestedDevice" | "fallback" | "durationMs"> | { status: DirectAmtRouteStatus };
  metrics: DirectAmtWindowOracleMetrics | null;
  referenceError?: string;
  timing: DirectAmtWindowTimingMetrics | { totalMs: number | null };
}

function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function summarizeDirectAmtSongTiming(windows: readonly DirectAmtSongWindowEvidence[]): DirectAmtSongTimingMetrics {
  const durations = windows.map((item) => item.timing && finite(item.timing.totalMs) && item.timing.totalMs >= 0 ? item.timing.totalMs : null).filter((value): value is number => value !== null);
  const count = (status: DirectAmtRouteStatus): number => windows.filter((item) => item.route.status === status).length;
  const fallbackCount = windows.filter((item) => "fallback" in item.route && item.route.fallback !== null).length;
  return {
    windowCount: windows.length,
    availableWindowCount: count("available"),
    unavailableWindowCount: count("unavailable"),
    malformedWindowCount: count("malformed"),
    timeoutWindowCount: count("timeout"),
    failedWindowCount: count("failed"),
    fallbackWindowCount: fallbackCount,
    totalMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null,
    meanMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    p95Ms: quantile(durations, 0.95),
  };
}

export const summarizeDirectAmtTiming = summarizeDirectAmtSongTiming;

export interface DirectAmtSongBottleneckClassification {
  primary: DirectAmtBottleneck;
  kind: DirectAmtBottleneck;
  categories: DirectAmtBottleneck[];
  reasons: string[];
}

export type DirectAmtBottleneck =
  | "none"
  | "availability"
  | "timeout"
  | "malformed-output"
  | "malformed-reference"
  | "failed-route"
  | "unsupported-density"
  | "accuracy"
  | "timing"
  | "insufficient-coverage"
  | "mixed";

export const DIRECT_AMT_BOTTLENECK_THRESHOLDS = Object.freeze({
  unsupportedDensity: 0.25,
  minimumExactF1: 0.5,
  maximumWindowMs: 30_000,
} as const);

function metricRate(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const value = (metrics as Record<string, unknown>)[key];
  if (!value || typeof value !== "object") return null;
  const rate = (value as Record<string, unknown>).rate;
  return finite(rate) ? rate : null;
}

function metricF1(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const source = metrics as Record<string, unknown>;
  for (const key of ["exact", "exactPitch", "pitchClass", "onset"]) {
    const value = source[key];
    if (value && typeof value === "object" && finite((value as Record<string, unknown>).f1)) return (value as Record<string, unknown>).f1 as number;
  }
  return null;
}

/** Classify the dominant per-song issue from already-materialized window evidence. */
export function classifyDirectAmtSongBottleneck(input: {
  windows: readonly DirectAmtSongWindowEvidence[] | readonly Record<string, unknown>[];
  thresholds?: Partial<typeof DIRECT_AMT_BOTTLENECK_THRESHOLDS>;
}): DirectAmtSongBottleneckClassification {
  const thresholds = { ...DIRECT_AMT_BOTTLENECK_THRESHOLDS, ...(input.thresholds ?? {}) };
  const categories = new Set<DirectAmtBottleneck>();
  const reasons: string[] = [];
  for (const raw of input.windows) {
    const item = raw as Record<string, unknown>;
    const windowId = typeof item.windowId === "string" ? item.windowId : "window";
    const routeValue = item.route;
    const routeStatus = routeValue && typeof routeValue === "object" ? (routeValue as Record<string, unknown>).status : routeValue;
    if (routeStatus === "unavailable") {
      categories.add("availability");
      reasons.push(`${windowId} route unavailable`);
    } else if (routeStatus === "timeout") {
      categories.add("timeout");
      reasons.push(`${windowId} route timed out`);
    } else if (routeStatus === "malformed") {
      categories.add("malformed-output");
      reasons.push(`${windowId} route output malformed`);
    } else if (routeStatus === "failed") {
      categories.add("failed-route");
      reasons.push(`${windowId} route failed`);
    }
    const metrics = item.metrics;
    if (typeof item.referenceError === "string" && item.referenceError.length > 0) {
      categories.add("malformed-reference");
      reasons.push(`${windowId} reference input malformed: ${item.referenceError}`);
    }
    const unsupported = metricRate(metrics, "unsupportedDensity");
    if (unsupported !== null && unsupported > thresholds.unsupportedDensity) {
      categories.add("unsupported-density");
      reasons.push(`${windowId} unsupported density ${unsupported}`);
    }
    const f1 = metricF1(metrics);
    if (f1 !== null && f1 < thresholds.minimumExactF1) {
      categories.add("accuracy");
      reasons.push(`${windowId} exact oracle F1 ${f1}`);
    }
    const timing = item.timing;
    const totalMs = timing && typeof timing === "object" ? (timing as Record<string, unknown>).totalMs : null;
    if (finite(totalMs) && totalMs > thresholds.maximumWindowMs) {
      categories.add("timing");
      reasons.push(`${windowId} timing ${totalMs}ms exceeds threshold`);
    }
  }
  if (!categories.size) {
    const hasMetrics = input.windows.some((item) => Boolean((item as Record<string, unknown>).metrics));
    categories.add(hasMetrics ? "none" : "insufficient-coverage");
    if (!hasMetrics) reasons.push("no window has scoreable oracle evidence");
  }
  const ordered = [...categories].sort(stableCompare);
  const primary: DirectAmtBottleneck = ordered.length > 1 ? "mixed" : ordered[0]!;
  return {
    primary,
    kind: primary,
    categories: ordered,
    reasons,
  };
}

export interface DirectAmtSongEvaluationInput {
  songId: string;
  source: DirectAmtPcmSourceInput;
  windows: readonly DirectAmtWindowSpec[];
  runner: DirectAmtRouteRunner;
  referenceByWindow?: Readonly<Record<string, unknown>>;
  preferredDevice?: DirectAmtDevice;
  timeoutMs?: number;
  onsetToleranceSeconds?: number;
  extractionMsByWindow?: Readonly<Record<string, number>>;
}

export interface DirectAmtSongEvaluation {
  schemaVersion: typeof DIRECT_AMT_EVALUATION_SCHEMA_VERSION;
  songId: string;
  sourceSha256: string;
  sourceMetadata: {
    byteLength: number;
    frameCount: number;
    sampleRate: number;
    channels: number;
    bytesPerSample: number;
    sha256: string;
  };
  windows: DirectAmtSongWindowEvidence[];
  timing: DirectAmtSongTimingMetrics;
  bottleneck: DirectAmtSongBottleneckClassification;
}

/** Materialize a complete synthetic/injected song evaluation without model or media side effects. */
export async function evaluateDirectAmtSong(input: DirectAmtSongEvaluationInput): Promise<DirectAmtSongEvaluation> {
  if (!input || typeof input !== "object") throw new Error("direct AMT song evaluation input is required");
  if (typeof input.songId !== "string" || !input.songId.trim()) throw new Error("direct AMT songId is required");
  if (typeof input.runner !== "function") throw new Error("direct AMT route runner is required");
  if (input.preferredDevice !== undefined && !isDevice(input.preferredDevice)) {
    throw new Error("direct AMT device must be mps or cpu");
  }
  const source = sourceValues(input.source);
  const extracted = extractDirectAmtWindows(input.source, input.windows);
  const routes = await Promise.all(extracted.map((item) => runDirectAmtWindow({
    songId: input.songId,
    window: item,
    runner: input.runner,
    preferredDevice: input.preferredDevice,
    timeoutMs: input.timeoutMs,
  })));
  const windows = extracted.map((item, index) => {
    const route = routes[index]!;
    const reference = input.referenceByWindow?.[item.id];
    const windowProvenance: DirectAmtWindowProvenance = {
      id: item.id,
      ...(item.label ? { label: item.label } : {}),
      startSample: item.startSample,
      endSample: item.endSample,
      sampleCount: item.sampleCount,
      sampleRate: item.sampleRate,
      channels: item.channels,
      bytesPerSample: item.bytesPerSample,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      durationSeconds: item.durationSeconds,
      byteOffset: item.byteOffset,
      byteLength: item.byteLength,
      sourceSha256: item.sourceSha256,
      windowSha256: item.windowSha256,
    };
    let metrics: DirectAmtWindowOracleMetrics | null = null;
    let referenceError: string | undefined;
    if (route.status === "available" && reference !== undefined) {
      try {
        metrics = scoreDirectAmtWindow({
          window: item,
          reference,
          prediction: route.tracks,
          onsetToleranceSeconds: input.onsetToleranceSeconds,
        });
      } catch (error) {
        referenceError = cleanError(error, "malformed direct AMT reference input");
      }
    }
    return {
      windowId: item.id,
      window: windowProvenance,
      route,
      metrics,
      ...(referenceError ? { referenceError } : {}),
      timing: timingForDirectAmtWindow(route, input.extractionMsByWindow?.[item.id]),
    } satisfies DirectAmtSongWindowEvidence;
  });
  const timing = summarizeDirectAmtSongTiming(windows);
  return {
    schemaVersion: DIRECT_AMT_EVALUATION_SCHEMA_VERSION,
    songId: input.songId.trim(),
    sourceSha256: hashDirectAmtSource(input.source),
    sourceMetadata: {
      byteLength: source.bytes.length,
      frameCount: source.bytes.length / (source.channels * source.bytesPerSample),
      sampleRate: source.sampleRate,
      channels: source.channels,
      bytesPerSample: source.bytesPerSample,
      sha256: hashDirectAmtSource(source.bytes),
    },
    windows,
    timing,
    bottleneck: classifyDirectAmtSongBottleneck({ windows }),
  };
}

export const classifyDirectAmtBottleneck = classifyDirectAmtSongBottleneck;

function canonicalPathSafeString(value: string): string {
  return value
    .replace(/(?:file:\/\/)?\/(?:Users|private|tmp|var|Volumes|home|root|opt|mnt|workspace|etc|srv|data|Applications|Library|System)(?:\/[^\s"'<>;,)]*)*/gi, "[redacted-path]")
    .replace(/(^|[\s("'=,;\[])([A-Za-z]:[\\/][^\s"'<>;,)]*)/g, "$1[redacted-path]")
    .replace(/(^|[\s("'=,;\[])(\\\\[^\s"'<>;,)]*)/g, "$1[redacted-path]");
}

function canonicalPathSafeStringExtended(value: string): string {
  return value
    .replace(/(^|[\s"'=(:,;\[])(?:\.\.?(?:\/|\\))+(?:[^\s"'<>;,)]*)/g, "$1[redacted-path]")
    .replace(/(^|[\s"'=(:,;\[])(?:[A-Za-z0-9._-]+(?:\/|\\))+[A-Za-z0-9._-]+\.(?:wav|wave|mid|midi|mp3|flac|json|ckpt|onnx|pt|pth)(?=$|\s|[.,;)}\]])/gi, "$1[redacted-path]");
}

const OMIT_CANONICAL_KEY = /(?:path|filename|file|directory|workdir|cwd)$/i;
const OMIT_CANONICAL_TIME_KEY = /(?:At|Timestamp)$/i;

function canonicalize(value: unknown, key?: string): unknown {
  if (key && (OMIT_CANONICAL_KEY.test(key) || OMIT_CANONICAL_TIME_KEY.test(key))) return undefined;
  if (value instanceof Uint8Array) return { byteLength: value.byteLength, sha256: sha256(value) };
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return { byteLength: bytes.byteLength, sha256: sha256(bytes) };
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string") return canonicalPathSafeStringExtended(canonicalPathSafeString(value));
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[objectKey], objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }
  return value;
}

/** Stable JSON for evidence comparison; it contains hashes, never absolute paths or run timestamps. */
export function canonicalDirectAmtJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export const canonicalDirectAmtEvaluationJson = canonicalDirectAmtJson;

export function hashCanonicalDirectAmt(value: unknown): string {
  return createHash("sha256").update(canonicalDirectAmtJson(value), "utf8").digest("hex");
}
