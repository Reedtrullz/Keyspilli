/**
 * Local-only adapter for a bounded symbolic shadow corpus.
 *
 * This module intentionally has no downloader or network surface.  It reads
 * explicitly supplied local bytes/files, parses MIDI metadata and events, and
 * emits path-free records suitable for a development corpus report.  The
 * seven-song benchmark remains outside this adapter: a record is marked
 * `SHADOW_GENERATION_TRUTH` only when it has both symbolic and audio bytes,
 * plus explicit license and source-record provenance.
 *
 * The small interfaces below are structural on purpose.  `shadow-corpus.ts`
 * is owned by the manifest/firewall lane and can consume these records without
 * making the adapter depend on an in-flight manifest implementation.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { parseMidi, type ParsedMidi } from "@keyspilli/midi";
import type { ExternalRoleDiagnostic } from "./external-research.js";
import { sha256Hex } from "./fixture-evidence.js";

export const SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION = 1 as const;
export const SHADOW_CORPUS_ADAPTER_VERSION = "shadow-corpus-adapter-v1" as const;
export const SHADOW_GENERATION_TRUTH = "SHADOW_GENERATION_TRUTH" as const;
export const SHADOW_CORPUS_MAX_BYTES = 128 * 1024 * 1024;

export const SHADOW_INSTRUMENT_ROLES = ["drums", "bass", "guitar", "piano", "other"] as const;
export type ShadowInstrumentRole = (typeof SHADOW_INSTRUMENT_ROLES)[number];
export type ShadowGenerationEligibility = {
  eligible: boolean;
  purpose: typeof SHADOW_GENERATION_TRUTH | null;
  reasons?: string[];
};
export type ShadowEvaluationEligibility = {
  eligible: boolean;
  status: "SHADOW_GENERATION_TRUTH" | "METADATA_ONLY" | "INELIGIBLE";
  reasons?: string[];
};
/** Canonical status names match the provider-neutral manifest contract. */
export type ShadowMediaStatus = "available" | "missing" | "invalid" | "not-provided";

export interface ShadowCorpusSourceRecord {
  provider?: string | null;
  recordId?: string | null;
  dataset?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export interface ShadowCorpusMediaRecord {
  status: ShadowMediaStatus;
  sha256: string | null;
  byteLength: number | null;
  /** Stable logical identity; physical paths never appear in this record. */
  logicalRef: string | null;
}

export interface ShadowCorpusProgramChange {
  tick: number;
  channel: number;
  program: number;
}

export interface ShadowCorpusTrackSummary {
  id: string;
  index: number;
  name: string;
  channel: number | null;
  channels: number[];
  programs: number[];
  /** Convenience alias for consumers that only support one program. */
  program: number | null;
  programChanges: ShadowCorpusProgramChange[];
  noteCount: number;
  pitchedNoteCount: number;
  percussionNoteCount: number;
  percussion: boolean;
  role: ShadowInstrumentRole;
  /** Alias useful to manifest consumers that call this an instrument class. */
  instrumentClass: ShadowInstrumentRole;
  durationBeats: number;
  pitchRange: [number, number] | null;
  roleDiagnostic: ExternalRoleDiagnostic;
}

export interface ShadowCorpusNote {
  trackIndex: number;
  channel: number;
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
  startBeats: number;
  durationBeats: number;
  program: number;
  role: ShadowInstrumentRole;
  percussion: boolean;
}

/** Parsed one-file output. Notes are retained for the evaluator lane, while
 * the manifest/report lane can persist only the summaries on the item. */
export interface ShadowCorpusMidiAdapterResult {
  status: "parsed";
  format: "midi";
  sha256: string;
  byteLength: number;
  midiFormat: number;
  division: number;
  title: string | null;
  tempoBpm: number;
  keySignature: number;
  keyMode: 0 | 1;
  timeSignature: [number, number];
  durationBeats: number;
  parsed: ParsedMidi;
  notes: ShadowCorpusNote[];
  tracks: ShadowCorpusTrackSummary[];
  roleDiagnostics: ExternalRoleDiagnostic[];
}

export interface ShadowCorpusItemInput {
  /** Runtime callers may provide a version marker; unsupported versions fail closed. */
  schemaVersion?: typeof SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION;
  id: string;
  corpus?: string | null;
  datasetVersion?: string | null;
  license?: string | null;
  sourceRecord?: ShadowCorpusSourceRecord | string | null;
  sourceRef?: string | null;
  logicalRef?: string | null;
  symbolicPath?: string | null;
  symbolicBytes?: Uint8Array | ArrayBuffer;
  audioPath?: string | null;
  audioBytes?: Uint8Array | ArrayBuffer;
}

export interface ShadowCorpusAdapterPathOptions {
  /** Repository boundary used by the local-only file safety check. */
  repositoryRoot?: string;
  /** Test-only escape hatch for a deliberately checked-in fixture. */
  allowRepositoryPath?: boolean;
  /** If provided, every source file must resolve below this directory. */
  allowedRoot?: string;
  maxBytes?: number;
}

export interface ShadowCorpusItem {
  schemaVersion: typeof SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION;
  adapterVersion: typeof SHADOW_CORPUS_ADAPTER_VERSION;
  id: string;
  corpus: string;
  datasetVersion: string;
  license: string;
  sourceRecord: ShadowCorpusSourceRecord | null;
  audio: ShadowCorpusMediaRecord;
  symbolic: ShadowCorpusMediaRecord;
  tracks: ShadowCorpusTrackSummary[];
  durationBeats: number | null;
  tempoBpm: number | null;
  title: string | null;
  midiFormat: number | null;
  division: number | null;
  /** Count of parsed, non-percussion events by stable semantic family. */
  roleCounts: Record<ShadowInstrumentRole, number>;
  /** Stable tags present in this item, sorted by the role contract. */
  roleTags: ShadowInstrumentRole[];
  generationEligibility: ShadowGenerationEligibility;
  evaluationEligibility: ShadowEvaluationEligibility;
  eligibilityReasons: string[];
}

export interface ShadowCorpusAdapterReport {
  schemaVersion: typeof SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION;
  adapterVersion: typeof SHADOW_CORPUS_ADAPTER_VERSION;
  status: "ready" | "metadata-only" | "partial" | "failed";
  itemCount: number;
  parsedItemCount: number;
  failedItemCount: number;
  generationTruthCount: number;
  items: ShadowCorpusItem[];
  errors: ShadowCorpusAdapterErrorRecord[];
  /** Present only in the in-memory return object; serializer removes it. */
  outputPath: string;
}

export interface ShadowCorpusAdapterErrorRecord {
  id: string;
  code: "invalid-input" | "missing-symbolic" | "parse-failed" | "io-failed";
  message: string;
}

export class ShadowCorpusAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShadowCorpusAdapterError";
  }
}

interface InternalNote {
  channel: number;
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
  program: number;
  percussion: boolean;
}

interface InternalTrack {
  index: number;
  name: string | null;
  channels: Set<number>;
  programs: Set<number>;
  programChanges: ShadowCorpusProgramChange[];
  notes: InternalNote[];
  percussionNoteCount: number;
  endTick: number;
  percussion: boolean;
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const round = (value: number, digits = 6): number => {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};

function text(value: unknown, fallback: string | null = null, max = 240): string | null {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || fallback;
}

function safeId(value: unknown, fallback: string): string {
  const candidate = text(value, fallback, 120) ?? fallback;
  const normalized = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/")) return fallback;
  return normalized;
}

function logicalRef(value: unknown, fallback: string): string {
  const candidate = text(value, null, 240);
  if (!candidate || candidate.includes("/") || candidate.includes("\\") || /^[A-Za-z]:/.test(candidate) || candidate.startsWith("~")) return fallback;
  if (/^file:/i.test(candidate) || candidate.startsWith(".")) return fallback;
  return candidate;
}

function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function looksPhysicalPath(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return false;
  return /^file:\/\//i.test(value)
    || /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\\\\)/.test(value)
    || /(?:^|[\\/])[^\\/]+\.(?:mid|midi|wav|flac|mp3|json)$/i.test(value);
}

function sanitizeSourceValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const clean = text(value, "", 240) ?? "";
    if (/url|page|uri|sourceRef/i.test(key) || /^https?:\/\//i.test(clean)) {
      if (/^https?:\/\//i.test(clean)) return sanitizeUrl(clean) ?? "[redacted-source]";
    }
    if (/path|file|locator/i.test(key) || looksPhysicalPath(clean)) return "[redacted-path]";
    return clean;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeSourceValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([childKey, child]) => [childKey, sanitizeSourceValue(child, childKey)]));
  }
  return value ?? null;
}

function normalizeSourceRecord(value: ShadowCorpusItemInput["sourceRecord"]): ShadowCorpusSourceRecord | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const clean = text(value, null);
    if (!clean || looksPhysicalPath(clean)) return null;
    const logical = /^https?:\/\//i.test(clean) ? sanitizeUrl(clean) : clean;
    return logical ? { recordId: logical } : null;
  }
  const result = sanitizeSourceValue(value) as ShadowCorpusSourceRecord;
  const identityKeys = ["id", "recordId", "sourceRef", "uri", "url", "provider", "dataset", "name"];
  const hasLogicalIdentity = identityKeys.some((key) => {
    const candidate = result[key];
    if (typeof candidate !== "string" || !candidate.trim()) return false;
    const clean = candidate.trim();
    return clean !== "[redacted-path]" && clean !== "[redacted-source]"
      && !looksPhysicalPath(clean)
      && (!/^https?:\/\//i.test(clean) || sanitizeUrl(clean) !== null);
  });
  return hasLogicalIdentity ? result : null;
}

function roleFromName(name: string | null): ShadowInstrumentRole | null {
  const value = (name ?? "").toLowerCase();
  // "Rhythm Guitar" is a guitar role, not a drum role.  Do not interpret
  // the generic words "rhythm" or "beat" as percussion: those labels are
  // common on MIDI guitar/piano parts.  Channel 10 and actual drum/kit
  // labels are handled as percussion elsewhere.
  if (/\b(?:guitar|gtr)\b/.test(value)) return "guitar";
  if (/\b(?:drums?|percussion|drum\s*kit|drumset|kit)\b/.test(value)) return "drums";
  if (/\bbass\b|\blow(?:er)?\b/.test(value)) return "bass";
  if (/piano|keys?|keyboard|grand|electric piano/.test(value)) return "piano";
  return null;
}

function roleFromProgram(programs: readonly number[]): ShadowInstrumentRole | null {
  if (programs.some((program) => program >= 32 && program <= 39)) return "bass";
  if (programs.some((program) => program >= 24 && program <= 31)) return "guitar";
  if (programs.some((program) => program >= 0 && program <= 7)) return "piano";
  return null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function roleForTrack(track: InternalTrack, division: number): ShadowInstrumentRole {
  const nameRole = roleFromName(track.name);
  // A General MIDI program selects a pitched timbre, even for the
  // "percussive" GM family (113-120 / zero-based 112-119).  Drum semantics
  // come from channel 10 or an explicit drum/kit label, never the program
  // number alone.
  if (track.percussion || nameRole === "drums") return "drums";
  if (nameRole) return nameRole;
  const programRole = roleFromProgram([...track.programs]);
  if (programRole) return programRole;
  const pitches = track.notes.map((note) => note.midi);
  const average = median(pitches);
  const max = pitches.length ? Math.max(...pitches) : null;
  if (average !== null && average < 55 && max !== null && max < 67) return "bass";
  // Keep a non-empty anonymous lane explicit as `other`; role inference never
  // upgrades an unlabelled lane to a melody/guitar claim.
  void division;
  return "other";
}

function externalRole(role: ShadowInstrumentRole, track: InternalTrack, division: number): ExternalRoleDiagnostic {
  const pitched = track.notes.filter((note) => !note.percussion);
  const pitches = pitched.map((note) => note.midi).sort((left, right) => left - right);
  const minPitch = pitches[0] ?? null;
  const maxPitch = pitches.at(-1) ?? null;
  const starts = pitched.map((note) => note.startTick).sort((left, right) => left - right);
  const monophonic = pitched.length === 0 ? null : pitched.every((note, index) => {
    if (index === 0) return true;
    const previous = pitched.slice().sort((left, right) => left.startTick - right.startTick || left.midi - right.midi)[index - 1]!;
    return note.startTick >= previous.endTick;
  });
  const trackDuration = track.endTick / division;
  const evidenceRole: ExternalRoleDiagnostic["role"] = role === "drums"
    ? "timing-only"
    : role === "bass" ? "bass-root"
      : role === "other" && monophonic === true && (median(pitches) ?? 0) >= 60 ? "melody" : "harmony";
  const signals: string[] = [];
  if (track.name) signals.push("track name");
  if (track.programs.size) signals.push("program metadata");
  if (track.percussion) signals.push("percussion channel/program");
  if (monophonic === true) signals.push("monophonic evidence");
  if (minPitch !== null && maxPitch !== null) signals.push(`register:${minPitch}-${maxPitch}`);
  if (trackDuration > 0) signals.push(`density:${round(pitched.length / trackDuration, 3)}`);
  return {
    partId: `track-${track.index + 1}`,
    partName: track.name,
    role: evidenceRole,
    confidence: round(track.name || track.programs.size || track.percussion ? 0.82 : 0.55, 3),
    certainty: track.name || track.programs.size || track.percussion ? "uncertain" : "ambiguous",
    signals: [...new Set(signals)].sort(compareText),
    eventCount: track.notes.length + track.percussionNoteCount,
    pitchRange: minPitch === null || maxPitch === null ? null : [minPitch, maxPitch],
    monophonic,
    density: trackDuration > 0 ? round((track.notes.length + track.percussionNoteCount) / trackDuration, 3) : null,
    percussion: track.percussion,
    timingOnly: evidenceRole === "timing-only",
    alternatives: evidenceRole === "timing-only" ? ["rhythm"] : evidenceRole === "bass-root" ? ["harmony"] : ["melody", "bass-root"],
  };
}

function readVarint(data: Uint8Array, position: { value: number }, end: number): number {
  let result = 0;
  for (let count = 0; count < 4; count += 1) {
    if (position.value >= end) throw new ShadowCorpusAdapterError("truncated MIDI variable-length value");
    const byte = data[position.value++]!;
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return result;
  }
  throw new ShadowCorpusAdapterError("invalid MIDI variable-length value");
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.slice(offset, offset + length));
}

function uint16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function uint32(data: Uint8Array, offset: number): number {
  return (((data[offset]! << 24) >>> 0) + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!) >>> 0;
}

function parseTrackMetadata(data: Uint8Array, division: number, trackCount: number): InternalTrack[] {
  const tracks: InternalTrack[] = [];
  let position = 14;
  for (let index = 0; index < trackCount; index += 1) {
    if (position + 8 > data.length || ascii(data, position, 4) !== "MTrk") throw new ShadowCorpusAdapterError("bad MIDI track header");
    const length = uint32(data, position + 4);
    position += 8;
    if (position + length > data.length) throw new ShadowCorpusAdapterError("truncated MIDI track");
    const end = position + length;
    let tick = 0;
    let running: number | null = null;
    let name: string | null = null;
    const channels = new Set<number>();
    const programs = new Set<number>();
    const programChanges: ShadowCorpusProgramChange[] = [];
    const currentPrograms = new Map<number, number>();
    const active = new Map<string, InternalNote[]>();
    const notes: InternalNote[] = [];
    let percussionNoteCount = 0;
    let percussion = false;

    while (position < end) {
      const deltaPosition = { value: position };
      tick += readVarint(data, deltaPosition, end);
      position = deltaPosition.value;
      if (position >= end) throw new ShadowCorpusAdapterError("truncated MIDI event");
      let status = data[position++]!;
      if (status < 0x80) {
        if (running === null) throw new ShadowCorpusAdapterError("MIDI running status without a prior channel event");
        position -= 1;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      } else {
        running = null;
      }
      if (status === 0xff) {
        if (position >= end) throw new ShadowCorpusAdapterError("truncated MIDI meta event");
        const type = data[position++]!;
        const payloadPosition = { value: position };
        const payloadLength = readVarint(data, payloadPosition, end);
        position = payloadPosition.value;
        if (position + payloadLength > end) throw new ShadowCorpusAdapterError("truncated MIDI meta payload");
        if (type === 0x03) name = text(String.fromCharCode(...data.slice(position, position + payloadLength)), null);
        position += payloadLength;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const payloadPosition = { value: position };
        const payloadLength = readVarint(data, payloadPosition, end);
        position = payloadPosition.value + payloadLength;
        if (position > end) throw new ShadowCorpusAdapterError("truncated MIDI sysex payload");
        continue;
      }
      // System-common messages are legal in a local SMF; consume their fixed
      // payloads so metadata-only events do not corrupt subsequent tracks.
      if (status === 0xf1 || status === 0xf3) {
        if (position >= end) throw new ShadowCorpusAdapterError("truncated MIDI system-common event");
        position += 1;
        continue;
      }
      if (status === 0xf2) {
        if (position + 2 > end) throw new ShadowCorpusAdapterError("truncated MIDI song-position event");
        position += 2;
        continue;
      }
      if (status === 0xf6 || (status >= 0xf8 && status <= 0xfe)) continue;

      const kind = status & 0xf0;
      const channel = status & 0x0f;
      channels.add(channel);
      if (kind === 0xc0 || kind === 0xd0) {
        if (position >= end) throw new ShadowCorpusAdapterError("truncated MIDI channel event");
        const value = data[position++]!;
        if (kind === 0xc0) {
          currentPrograms.set(channel, value);
          programs.add(value);
          programChanges.push({ tick, channel, program: value });
        }
        continue;
      }
      if (kind !== 0x80 && kind !== 0x90 && kind !== 0xa0 && kind !== 0xb0 && kind !== 0xe0) {
        throw new ShadowCorpusAdapterError("unsupported MIDI channel event");
      }
      if (position + 2 > end) throw new ShadowCorpusAdapterError("truncated MIDI channel event");
      const midi = data[position++]!;
      const velocity = data[position++]!;
      const program = currentPrograms.get(channel) ?? 0;
      if (kind === 0x90 && velocity > 0) {
        const isPercussion = channel === 9;
        if (isPercussion) {
          percussion = true;
          percussionNoteCount += 1;
        } else {
          const key = `${channel}:${midi}`;
          const queue = active.get(key) ?? [];
          queue.push({ channel, midi, velocity, startTick: tick, endTick: tick, program, percussion: false });
          active.set(key, queue);
        }
      } else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) {
        if (channel === 9) continue;
        const key = `${channel}:${midi}`;
        const queue = active.get(key);
        const started = queue?.shift();
        if (started) {
          started.endTick = Math.max(started.startTick, tick);
          if (started.endTick > started.startTick) notes.push(started);
        }
        if (queue && queue.length === 0) active.delete(key);
      }
    }
    for (const queue of active.values()) {
      for (const started of queue) {
        started.endTick = Math.max(started.startTick, tick);
        if (started.endTick > started.startTick) notes.push(started);
      }
    }
    const nameRole = roleFromName(name);
    if (nameRole === "drums") percussion = true;
    tracks.push({
      index,
      name,
      channels,
      programs,
      programChanges: programChanges.sort((left, right) => left.tick - right.tick || left.channel - right.channel || left.program - right.program),
      notes: notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi || left.endTick - right.endTick),
      percussionNoteCount,
      endTick: tick,
      percussion,
    });
    position = end;
  }
  return tracks;
}

function analyzeTrack(track: InternalTrack, division: number): ShadowCorpusTrackSummary {
  const role = roleForTrack(track, division);
  const pitched = track.notes.filter((note) => !note.percussion);
  const pitches = pitched.map((note) => note.midi);
  const durationBeats = round(track.endTick / division);
  const channels = [...track.channels].sort((left, right) => left - right);
  const programs = [...track.programs].sort((left, right) => left - right);
  return {
    id: `track-${track.index + 1}`,
    index: track.index,
    // The manifest validator requires every track to have a visible label;
    // unnamed tempo/meta tracks receive a deterministic fallback.
    name: track.name ?? `Track ${track.index + 1}`,
    channel: channels.length === 1 ? channels[0]! : null,
    channels,
    programs,
    program: programs[0] ?? null,
    programChanges: track.programChanges.map((change) => ({ ...change })),
    noteCount: pitched.length + track.percussionNoteCount,
    pitchedNoteCount: pitched.length,
    percussionNoteCount: track.percussionNoteCount,
    percussion: track.percussion,
    role,
    instrumentClass: role,
    durationBeats,
    pitchRange: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : null,
    roleDiagnostic: externalRole(role, track, division),
  };
}

function roleCounts(tracks: readonly ShadowCorpusTrackSummary[]): Record<ShadowInstrumentRole, number> {
  const result: Record<ShadowInstrumentRole, number> = { drums: 0, bass: 0, guitar: 0, piano: 0, other: 0 };
  for (const track of tracks) result[track.role] += track.noteCount;
  return result;
}

function mediaRecord(status: ShadowMediaStatus, bytes: Uint8Array | null, logical: string | null): ShadowCorpusMediaRecord {
  return {
    status,
    sha256: bytes ? sha256Hex(bytes) : null,
    byteLength: bytes ? bytes.byteLength : null,
    logicalRef: logical,
  };
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function enforceByteLimit(bytes: Uint8Array, label: string, options: ShadowCorpusAdapterPathOptions): Uint8Array {
  const maxBytes = positiveInteger(options.maxBytes) ? options.maxBytes! : SHADOW_CORPUS_MAX_BYTES;
  if (bytes.byteLength > maxBytes) throw new ShadowCorpusAdapterError(`${label} exceeds the local byte limit`);
  return bytes;
}

function pathInside(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function protectedPath(value: string): boolean {
  return resolve(value).split(/[\\/]+/).filter(Boolean).some((segment) => /^(?:\.ssh|\.gnupg|\.aws|wallets?|secrets?|credentials?|tokens?|passwords?|id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys)$/i.test(segment));
}

async function readLocalBytes(path: string, label: string, options: ShadowCorpusAdapterPathOptions): Promise<Uint8Array> {
  if (!isAbsolute(path)) throw new ShadowCorpusAdapterError(`${label} must be an absolute local path`);
  if (path.includes("\u0000") || /[\r\n]/.test(path)) throw new ShadowCorpusAdapterError(`${label} contains unsafe characters`);
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path);
  } catch {
    throw new ShadowCorpusAdapterError(`${label} does not exist or could not be resolved`);
  }
  const info = await stat(resolvedPath);
  if (!info.isFile()) throw new ShadowCorpusAdapterError(`${label} is not a regular file`);
  const maxBytes = positiveInteger(options.maxBytes) ? options.maxBytes! : SHADOW_CORPUS_MAX_BYTES;
  if (info.size > maxBytes) throw new ShadowCorpusAdapterError(`${label} exceeds the local byte limit`);
  if (protectedPath(resolvedPath)) throw new ShadowCorpusAdapterError(`${label} is protected local state`);
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  if (!options.allowRepositoryPath && pathInside(repositoryRoot, resolvedPath)) throw new ShadowCorpusAdapterError(`${label} must be outside the repository`);
  if (options.allowedRoot && !pathInside(options.allowedRoot, resolvedPath)) throw new ShadowCorpusAdapterError(`${label} is outside the supplied corpus root`);
  return new Uint8Array(await readFile(resolvedPath));
}

/**
 * Parse one local MIDI buffer and retain the per-track metadata discarded by
 * the public `ParsedMidi` shape.  The public parser remains authoritative for
 * normalized title/tempo/duration and malformed-SMF rejection.
 */
export function adaptShadowCorpusMidiBytes(
  input: Uint8Array | ArrayBuffer,
  options: { logicalRef?: string | null } = {},
): ShadowCorpusMidiAdapterResult {
  const bytes = asBytes(input);
  let parsed: ParsedMidi;
  try {
    parsed = parseMidi(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MIDI parse failed";
    throw new ShadowCorpusAdapterError(message.replace(/[\r\n]/g, " ").slice(0, 240));
  }
  if (bytes.length < 14 || ascii(bytes, 0, 4) !== "MThd") throw new ShadowCorpusAdapterError("not a MIDI file (missing MThd)");
  const headerLength = uint32(bytes, 4);
  if (headerLength !== 6) throw new ShadowCorpusAdapterError("unsupported MIDI header length");
  const midiFormat = uint16(bytes, 8);
  const trackCount = uint16(bytes, 10);
  const division = uint16(bytes, 12);
  if (!positiveInteger(division) || division >= 0x8000) throw new ShadowCorpusAdapterError("unsupported MIDI timing division");
  const internalTracks = parseTrackMetadata(bytes, division, trackCount);
  const tracks = internalTracks.map((track) => analyzeTrack(track, division));
  const notes: ShadowCorpusNote[] = [];
  for (const [index, internal] of internalTracks.entries()) {
    const summary = tracks[index]!;
    for (const note of internal.notes) {
      notes.push({
        trackIndex: index,
        channel: note.channel,
        midi: note.midi,
        velocity: note.velocity,
        startTick: note.startTick,
        endTick: note.endTick,
        startBeats: round(note.startTick / division),
        durationBeats: round((note.endTick - note.startTick) / division),
        program: note.program,
        role: summary.role,
        percussion: false,
      });
    }
  }
  notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi || left.trackIndex - right.trackIndex || left.channel - right.channel);
  return {
    status: "parsed",
    format: "midi",
    sha256: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    midiFormat,
    division,
    title: parsed.title ?? null,
    tempoBpm: round(parsed.tempoBpm),
    keySignature: parsed.keySig,
    keyMode: parsed.keyMode,
    timeSignature: [...parsed.timeSig] as [number, number],
    durationBeats: round(parsed.durationBeats),
    parsed,
    notes,
    tracks,
    roleDiagnostics: tracks.map((track) => track.roleDiagnostic),
  };
}

/** Alias kept short for callers that already use an adapter naming convention. */
export const adaptShadowMidiBytes = adaptShadowCorpusMidiBytes;

export async function adaptShadowCorpusMidiFile(
  path: string,
  options: ShadowCorpusAdapterPathOptions & { logicalRef?: string | null } = {},
): Promise<ShadowCorpusMidiAdapterResult> {
  const bytes = await readLocalBytes(path, "symbolic MIDI input", options);
  return adaptShadowCorpusMidiBytes(bytes, { logicalRef: options.logicalRef ?? basename(path) });
}

/** Build one path-free item. A malformed symbolic file throws so batch callers
 * can record a fail-closed error instead of emitting generation truth. */
export async function buildShadowCorpusItem(
  input: ShadowCorpusItemInput,
  options: ShadowCorpusAdapterPathOptions = {},
): Promise<ShadowCorpusItem> {
  if (input && (input as unknown as Record<string, unknown>).schemaVersion !== undefined
    && (input as unknown as Record<string, unknown>).schemaVersion !== SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION) {
    throw new ShadowCorpusAdapterError(`item.schemaVersion is unsupported (expected ${SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION})`);
  }
  const id = safeId(input.id, "shadow-item");
  const corpus = text(input.corpus, "local-shadow", 120) ?? "local-shadow";
  const datasetVersion = text(input.datasetVersion, "unspecified", 120) ?? "unspecified";
  const license = text(input.license, "", 240) ?? "";
  const sourceRecord = normalizeSourceRecord(input.sourceRecord);
  const symbolicRef = logicalRef(input.logicalRef ?? input.sourceRef, `shadow:${safeId(corpus, "corpus")}:${id}:symbolic`);
  const audioRef = `${symbolicRef.replace(/:symbolic$/, "")}:audio`;

  if (input.symbolicBytes !== undefined && input.symbolicPath) throw new ShadowCorpusAdapterError("provide either symbolic bytes or symbolicPath, not both");
  if (input.audioBytes !== undefined && input.audioPath) throw new ShadowCorpusAdapterError("provide either audio bytes or audioPath, not both");
  if (input.symbolicBytes === undefined && !input.symbolicPath) throw new ShadowCorpusAdapterError("symbolic MIDI input is required");

  const symbolicBytes = input.symbolicBytes !== undefined
    ? enforceByteLimit(asBytes(input.symbolicBytes), "symbolic MIDI input", options)
    : await readLocalBytes(input.symbolicPath!, "symbolic MIDI input", options);
  const parsed = adaptShadowCorpusMidiBytes(symbolicBytes, { logicalRef: symbolicRef });

  let audioBytes: Uint8Array | null = null;
  let audioStatus: ShadowMediaStatus = "not-provided";
  if (input.audioBytes !== undefined) {
    audioBytes = enforceByteLimit(asBytes(input.audioBytes), "shadow audio input", options);
    audioStatus = audioBytes.byteLength > 0 ? "available" : "invalid";
  } else if (input.audioPath) {
    audioBytes = await readLocalBytes(input.audioPath, "shadow audio input", options);
    audioStatus = audioBytes.byteLength > 0 ? "available" : "invalid";
  }
  const symbolic = mediaRecord("available", symbolicBytes, symbolicRef);
  // Keep a logical identity even for missing media so a metadata-only item is
  // still serializable and cannot accidentally reveal where it was sought.
  const audio = mediaRecord(audioStatus, audioBytes, audioRef);
  const reasons: string[] = [];
  if (audio.status !== "available") reasons.push("audio bytes are required for shadow generation truth");
  if (!license) reasons.push("dataset license is required for shadow generation truth");
  if (!sourceRecord) reasons.push("dataset source record is required for shadow generation truth");
  const generationEligibility: ShadowGenerationEligibility = {
    eligible: reasons.length === 0,
    // The purpose describes the lane, while `eligible` is the fail-closed
    // gate. Keeping the purpose stable lets manifest validators explain why a
    // metadata-only item cannot be used without inventing another purpose.
    purpose: SHADOW_GENERATION_TRUTH,
    ...(reasons.length ? { reasons: [...reasons] } : {}),
  };
  const evaluationStatus: ShadowEvaluationEligibility["status"] = reasons.length === 0
    ? "SHADOW_GENERATION_TRUTH"
    : symbolic.status === "available" ? "METADATA_ONLY" : "INELIGIBLE";
  const evaluationEligibility: ShadowEvaluationEligibility = {
    eligible: evaluationStatus === "SHADOW_GENERATION_TRUTH",
    status: evaluationStatus,
    ...(reasons.length ? { reasons: [...reasons] } : {}),
  };
  const counts = roleCounts(parsed.tracks);
  return {
    schemaVersion: SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION,
    adapterVersion: SHADOW_CORPUS_ADAPTER_VERSION,
    id,
    corpus,
    datasetVersion,
    license,
    sourceRecord,
    audio,
    symbolic,
    tracks: parsed.tracks,
    durationBeats: finite(parsed.durationBeats) ? parsed.durationBeats : null,
    tempoBpm: finite(parsed.tempoBpm) ? parsed.tempoBpm : null,
    title: parsed.title,
    midiFormat: parsed.midiFormat,
    division: parsed.division,
    roleCounts: counts,
    roleTags: SHADOW_INSTRUMENT_ROLES.filter((role) => counts[role] > 0),
    generationEligibility,
    evaluationEligibility,
    eligibilityReasons: reasons,
  };
}

export const adaptShadowCorpusItem = buildShadowCorpusItem;

function redactText(value: string): string {
  return value
    .replace(/file:\/\/[^\s"']+/gi, "[redacted-path]")
    .replace(/(^|[\s(=,:])\/(?:[^\s"'<>;,)]*\/)?(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/[^\s"'<>;,)]*/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(^|[\s(=,:])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function stableValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item, key));
  if (!value || typeof value !== "object") return value;
  const excluded = /^(?:root|outputPath|path|file|filePath|symbolicPath|audioPath|sourcePath|physicalPath|absolutePath)$/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([childKey]) => !excluded.test(childKey))
    .sort(([left], [right]) => compareText(left, right))
    .map(([childKey, child]) => [childKey, stableValue(child, childKey)]));
}

/** Stable path-redacted JSON for reports and reproducibility checks. */
export function shadowCorpusAdapterJson(value: ShadowCorpusAdapterReport | ShadowCorpusItem | unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
