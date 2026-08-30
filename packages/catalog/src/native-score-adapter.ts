/**
 * Local-only adapter for native symbolic scores.
 *
 * This is deliberately a direct-import surface for local research and
 * evaluation. It reads an explicitly supplied file or byte buffer, never
 * downloads a source, invokes a converter, or writes a copy of the source.
 * MusicXML/MXL is delegated to the notation-aware OMR adapter; MIDI is parsed
 * here so track, channel/voice, measure, and role evidence is not discarded
 * before it reaches the common OMR representation. MSCZ is reported as
 * unavailable because this package does not bundle a MuseScore container
 * parser; callers should export MusicXML/MXL or MIDI locally instead.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { sha256Hex } from "./fixture-evidence.js";
import { normalizeCanonicalScore, type CanonicalScore } from "./omr-canonical.js";
import {
  parseOmrMusicXmlBytes,
  type OmrMusicXmlParseOptions,
} from "./omr-musicxml.js";
import type {
  OmrEventInput,
  OmrPartInput,
  OmrRole,
  OmrScoreInput,
} from "./omr-consensus.js";
import type { NativeScoreArtifactType } from "./native-score-discovery.js";

export const NATIVE_SCORE_ADAPTER_VERSION = "native-score-adapter-v1" as const;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const EPS = 1e-9;

export class NativeScoreAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeScoreAdapterError";
  }
}

/** A tiny test/integration seam for constructing MIDI track bytes. */
export interface NativeMidiTrackSpec {
  name?: string | null;
  events: readonly number[];
}

export interface NativeSymbolicAdapterOptions extends OmrMusicXmlParseOptions {
  /** Logical source identity; physical paths are never included in results. */
  sourceRef?: string | null;
  /** Optional public provenance page, stripped if it contains credentials. */
  sourcePage?: string | null;
  /** Explicit artifact version supplied by the caller. */
  version?: string | null;
  /** Defaults to `local-bytes` for the byte API and `local-file` for files. */
  accessMethod?: "local-file" | "local-bytes";
  /** Optional track-index or track-name role overrides for MIDI. */
  trackRoles?: Readonly<Record<string, OmrRole | null | undefined>>;
  /** Optional track-index or track-name staff overrides for MIDI. */
  trackStaffs?: Readonly<Record<string, number | null | undefined>>;
  /** Maximum bytes accepted by the file API. */
  maxBytes?: number;
  /** Additional allowed roots for local files. Paths remain absent from output. */
  allowedRoots?: readonly string[];
  /** Explicit escape hatch for a caller that intentionally reads a repository fixture. */
  allowRepositoryPath?: boolean;
  /** Repository boundary used by the default local-file safety check. */
  repositoryRoot?: string;
}

export interface NativeSymbolicProvenance {
  artifactType: NativeScoreArtifactType;
  sourceRef: string | null;
  sourcePage: string | null;
  version: string | null;
  accessMethod: "local-file" | "local-bytes";
  sha256: string;
  bytes: number;
  parser: { id: string; version: typeof NATIVE_SCORE_ADAPTER_VERSION };
  rootFile: string | null;
}

export interface NativeSymbolicAdapterSuccess {
  status: "parsed";
  format: "midi" | "musicxml" | "mxl";
  score: OmrScoreInput;
  canonical: CanonicalScore;
  provenance: NativeSymbolicProvenance;
  warnings: string[];
}

export interface NativeSymbolicAdapterUnavailable {
  status: "unsupported";
  format: NativeScoreArtifactType;
  score: null;
  canonical: null;
  provenance: NativeSymbolicProvenance;
  warnings: string[];
  reason: string;
}

export interface NativeSymbolicAdapterInvalid {
  status: "invalid";
  format: NativeScoreArtifactType;
  score: null;
  canonical: null;
  provenance: NativeSymbolicProvenance;
  warnings: string[];
  error: string;
}

export type NativeSymbolicAdapterResult = NativeSymbolicAdapterSuccess | NativeSymbolicAdapterUnavailable | NativeSymbolicAdapterInvalid;

interface MidiRawNote {
  startTick: number;
  endTick: number;
  midi: number;
  vel: number;
  channel: number;
}

interface MidiTrackData {
  index: number;
  name: string | null;
  notes: MidiRawNote[];
  endTick: number;
}

interface MidiTimeChange {
  tick: number;
  signature: [number, number];
}

interface MidiKeyChange {
  tick: number;
  fifths: number;
  mode: 0 | 1;
}

interface ParsedNativeMidi {
  score: OmrScoreInput;
  warnings: string[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveFinite(value: unknown): value is number {
  return finite(value) && value > 0;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeLogicalText(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  if (!text || text.includes("/") || text.includes("\\") || /^file:/i.test(text)) return null;
  return text;
}

function safeSourcePage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeVersion(value: unknown): string | null {
  return safeLogicalText(value, 120);
}

function safeRootFile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text || text.startsWith("/") || text.includes("\\")) return null;
  const segments = text.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/").slice(0, 240);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "native symbolic parse failed";
  const sanitized = message
    .replace(/file:\/\/[^\s]+/gi, "[redacted-path]")
    .replace(/(?:^|[\s(=:])\/(?:[^\s/]+\/)*(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/[^\s)]*/gi, "$1[redacted-path]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.slice(0, 240) || "native symbolic parse failed";
}

function varint(data: Uint8Array, position: { value: number }, end: number): number {
  let result = 0;
  for (let count = 0; count < 4; count += 1) {
    if (position.value >= end) throw new NativeScoreAdapterError("truncated MIDI variable-length value");
    const byte = data[position.value++]!;
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return result;
  }
  throw new NativeScoreAdapterError("invalid MIDI variable-length value");
}

function ascii(data: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...data.slice(start, start + length));
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset]! << 24) >>> 0) + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!;
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function roleFromTrackName(value: string | null): OmrRole | null {
  if (!value) return null;
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(?:lead|melody|vocal|voice|solo|soprano|alto|tenor)\b/.test(text)) return "melody";
  if (/\b(?:rhythm|drum|percussion|beat|groove)\b/.test(text)) return "rhythm";
  if (/\b(?:harmony|harmonic|chord|accompaniment|piano|guitar|bass|strings|left hand|right hand|lower|upper)\b/.test(text)) return "harmony";
  return null;
}

function staffFromTrackName(value: string | null): number | null {
  if (!value) return null;
  return /\b(?:left\s*hand|lower|bass)\b/i.test(value) ? 2
    : /\b(?:right\s*hand|upper|treble)\b/i.test(value) ? 1
      : null;
}

function normalizeRole(value: unknown): OmrRole | null {
  return value === "melody" || value === "harmony" || value === "rhythm" ? value : null;
}

function trackOverride<T>(overrides: Readonly<Record<string, T | null | undefined>> | undefined, index: number, name: string | null): T | null | undefined {
  if (!overrides) return undefined;
  const byIndex = overrides[String(index)];
  if (byIndex !== undefined) return byIndex;
  if (name && Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
  return undefined;
}

function parseNativeMidi(data: Uint8Array, options: NativeSymbolicAdapterOptions): ParsedNativeMidi {
  if (data.byteLength < 14 || ascii(data, 0, 4) !== "MThd") throw new NativeScoreAdapterError("not a MIDI file (missing MThd)");
  const headerLength = readUint32(data, 4);
  if (headerLength !== 6 || data.byteLength < 8 + headerLength) throw new NativeScoreAdapterError("unsupported MIDI header length");
  const format = readUint16(data, 8);
  const trackCount = readUint16(data, 10);
  const division = readUint16(data, 12);
  if (format > 2 || trackCount < 1 || trackCount > 512) throw new NativeScoreAdapterError("invalid MIDI format or track count");
  if (division === 0 || (division & 0x8000) !== 0) throw new NativeScoreAdapterError("SMPTE MIDI timing is unsupported");

  const warnings: string[] = [];
  const tracks: MidiTrackData[] = [];
  const tempos: Array<{ tick: number; bpm: number }> = [];
  const timeChanges: MidiTimeChange[] = [{ tick: 0, signature: [4, 4] }];
  const keyChanges: MidiKeyChange[] = [{ tick: 0, fifths: 0, mode: 0 }];
  const trackNames: string[] = [];
  let title: string | undefined;
  let position = 8 + headerLength;
  let percussionDropped = 0;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (position + 8 > data.byteLength || ascii(data, position, 4) !== "MTrk") throw new NativeScoreAdapterError("bad MIDI track header");
    const length = readUint32(data, position + 4);
    position += 8;
    if (position + length > data.byteLength) throw new NativeScoreAdapterError("truncated MIDI track");
    const end = position + length;
    let tick = 0;
    let running: number | null = null;
    let trackName: string | null = null;
    const notes: MidiRawNote[] = [];
    const active = new Map<string, Array<{ midi: number; startTick: number; vel: number; channel: number }>>();

    while (position < end) {
      const deltaState = { value: position };
      tick += varint(data, deltaState, end);
      position = deltaState.value;
      if (position >= end) throw new NativeScoreAdapterError("truncated MIDI event");
      let status = data[position++]!;
      if (status < 0x80) {
        if (running === null) throw new NativeScoreAdapterError("MIDI running status without a prior channel event");
        position -= 1;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      } else {
        running = null;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (status === 0xff) {
        if (position >= end) throw new NativeScoreAdapterError("truncated MIDI meta event");
        const type = data[position++]!;
        const payloadState = { value: position };
        const payloadLength = varint(data, payloadState, end);
        position = payloadState.value;
        if (position + payloadLength > end) throw new NativeScoreAdapterError("truncated MIDI meta payload");
        const payload = data.slice(position, position + payloadLength);
        if (type === 0x03) {
          const name = String.fromCharCode(...payload).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
          if (name) {
            trackName = name.slice(0, 240);
            trackNames.push(trackName);
          }
        } else if ((type === 0x01 || type === 0x02) && !title) {
          const text = String.fromCharCode(...payload).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
          if (text) title = text.slice(0, 240);
        } else if (type === 0x51 && payloadLength === 3) {
          const micros = (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!;
          if (micros > 0) tempos.push({ tick, bpm: 60_000_000 / micros });
        } else if (type === 0x58 && payloadLength >= 2) {
          const numerator = payload[0]!;
          const denominator = 2 ** payload[1]!;
          if (numerator > 0 && positiveFinite(denominator)) timeChanges.push({ tick, signature: [numerator, denominator] });
        } else if (type === 0x59 && payloadLength >= 2) {
          const signedFifths = (payload[0]! << 24) >> 24;
          keyChanges.push({ tick, fifths: signedFifths, mode: payload[1] === 1 ? 1 : 0 });
        }
        position += payloadLength;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const payloadState = { value: position };
        const payloadLength = varint(data, payloadState, end);
        position = payloadState.value + payloadLength;
        if (position > end) throw new NativeScoreAdapterError("truncated MIDI sysex payload");
        continue;
      }
      // System-common and real-time messages are not musical note events but
      // are legal in native MIDI exports. Consume their fixed payloads so a
      // harmless MTC/song-select message cannot make an otherwise valid score
      // unavailable.
      if (status === 0xf1 || status === 0xf3) {
        if (position >= end) throw new NativeScoreAdapterError("truncated MIDI system-common event");
        position += 1;
        continue;
      }
      if (status === 0xf2) {
        if (position + 2 > end) throw new NativeScoreAdapterError("truncated MIDI song-position event");
        position += 2;
        continue;
      }
      if (status === 0xf6 || (status >= 0xf8 && status <= 0xfe)) continue;
      if (kind === 0xc0 || kind === 0xd0) {
        if (position >= end) throw new NativeScoreAdapterError("truncated MIDI channel event");
        position += 1;
        continue;
      }
      if (kind !== 0x80 && kind !== 0x90 && kind !== 0xa0 && kind !== 0xb0 && kind !== 0xe0) {
        throw new NativeScoreAdapterError("unsupported MIDI channel event");
      }
      if (position + 2 > end) throw new NativeScoreAdapterError("truncated MIDI channel event");
      const pitch = data[position++]!;
      const velocity = data[position++]!;
      if (kind === 0x90 && velocity > 0) {
        if (channel === 9) {
          percussionDropped += 1;
        } else {
          const key = `${channel}:${pitch}`;
          const queue = active.get(key) ?? [];
          queue.push({ midi: pitch, startTick: tick, vel: velocity, channel });
          active.set(key, queue);
        }
      } else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) {
        if (channel !== 9) {
          const key = `${channel}:${pitch}`;
          const queue = active.get(key);
          const started = queue?.shift();
          if (started) {
            if (tick > started.startTick) notes.push({ startTick: started.startTick, endTick: tick, midi: started.midi, vel: started.vel, channel: started.channel });
            else warnings.push(`dropped zero-duration MIDI note on track ${trackIndex + 1}`);
          }
          if (queue && queue.length === 0) active.delete(key);
        }
      }
    }
    const endTick = tick;
    for (const queue of active.values()) {
      for (const started of queue) {
        if (endTick > started.startTick) notes.push({ startTick: started.startTick, endTick, midi: started.midi, vel: started.vel, channel: started.channel });
        else warnings.push(`dropped hanging zero-duration MIDI note on track ${trackIndex + 1}`);
      }
    }
    notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi || left.endTick - right.endTick || left.channel - right.channel);
    tracks.push({ index: trackIndex, name: trackName, notes, endTick });
    position = end;
  }

  if (percussionDropped > 0) warnings.push(`dropped ${percussionDropped} percussion MIDI note-on event${percussionDropped === 1 ? "" : "s"}`);
  const maxTick = Math.max(1, ...tracks.map((track) => track.endTick), ...tracks.flatMap((track) => track.notes.map((note) => note.endTick)));
  const sortedTimeChanges = [...timeChanges].sort((left, right) => left.tick - right.tick);
  const sortedKeyChanges = [...keyChanges].sort((left, right) => left.tick - right.tick);
  const timeAt = (tickValue: number): [number, number] => {
    let current = sortedTimeChanges[0]!.signature;
    for (const change of sortedTimeChanges) {
      if (change.tick > tickValue) break;
      current = change.signature;
    }
    return [...current] as [number, number];
  };
  const keyAt = (tickValue: number): MidiKeyChange => {
    let current = sortedKeyChanges[0]!;
    for (const change of sortedKeyChanges) {
      if (change.tick > tickValue) break;
      current = change;
    }
    return current;
  };
  const measureRanges: Array<{ startTick: number; endTick: number; signature: [number, number]; key: MidiKeyChange }> = [];
  let measureStart = 0;
  while (measureStart < maxTick || measureRanges.length === 0) {
    const signature = timeAt(measureStart);
    const nominal = division * signature[0] * 4 / signature[1];
    if (!positiveFinite(nominal)) throw new NativeScoreAdapterError("MIDI time signature has invalid measure duration");
    const nextChange = sortedTimeChanges.find((change) => change.tick > measureStart + EPS && change.tick < measureStart + nominal - EPS);
    const measureEnd = nextChange?.tick ?? measureStart + nominal;
    if (!(measureEnd > measureStart)) throw new NativeScoreAdapterError("MIDI measure grid did not advance");
    measureRanges.push({ startTick: measureStart, endTick: measureEnd, signature, key: keyAt(measureStart) });
    measureStart = measureEnd;
    if (measureRanges.length > 1_000_000) throw new NativeScoreAdapterError("MIDI contains too many derived measures");
  }

  const parts: OmrPartInput[] = tracks.map((track) => {
    const explicitName = track.name;
    const name = explicitName ?? `Track ${track.index + 1}`;
    const role = normalizeRole(trackOverride(options.trackRoles, track.index, explicitName)) ?? roleFromTrackName(explicitName);
    const explicitStaff = trackOverride(options.trackStaffs, track.index, explicitName);
    const staff = explicitStaff === null ? null : (finite(explicitStaff) && Number.isInteger(explicitStaff) && explicitStaff > 0
      ? explicitStaff
      : staffFromTrackName(explicitName) ?? (role === "melody" ? 1 : null));
    const measures = measureRanges.map((range, measureIndex) => {
      const events: OmrEventInput[] = [];
      const voices = new Set<string>();
      for (const note of track.notes) {
        if (note.startTick < range.startTick - EPS || note.startTick >= range.endTick - EPS) continue;
        const voice = String(note.channel + 1);
        voices.add(voice);
        events.push({
          onset: rounded((note.startTick - range.startTick) / division),
          duration: rounded((note.endTick - note.startTick) / division),
          pitch: note.midi,
          staff: staff ?? undefined,
          voice,
          role: role ?? undefined,
          tuplet: false,
        });
      }
      // Keep the final tie-breaker locale-independent.  Native score reports
      // are intended to be byte-stable across machines with different locale
      // settings, so do not use localeCompare for MIDI voice ids.
      events.sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.duration - right.duration || compareText(String(left.voice ?? ""), String(right.voice ?? "")));
      return {
        id: `track-${track.index + 1}:m${measureIndex + 1}`,
        number: String(measureIndex + 1),
        startBeat: rounded(range.startTick / division),
        durationBeats: rounded((range.endTick - range.startTick) / division),
        timeSignature: range.signature,
        keySignature: range.key.fifths,
        implicit: false,
        ...(staff === null ? {} : { staves: [{ number: staff, role: role ?? undefined, voices: [], events: [] }] }),
        voices: [...voices].sort(compareText).map((id) => ({ id, role: role ?? undefined })),
        events,
      };
    });
    return { id: `track-${track.index + 1}`, name, ...(role ? { role } : {}), measures };
  });
  const initialTime = timeAt(0);
  const initialKey = keyAt(0);
  const firstTempo = [...tempos].sort((left, right) => left.tick - right.tick)[0]?.bpm;
  const score: OmrScoreInput = {
    ...(title ? { title } : {}),
    tempoBpm: positiveFinite(firstTempo) ? rounded(firstTempo) : undefined,
    timeSignature: initialTime,
    keySignature: initialKey.fifths,
    parts,
    metadata: {
      adapter: NATIVE_SCORE_ADAPTER_VERSION,
      format: "midi",
      midiFormat: format,
      division,
      keyMode: initialKey.mode,
      trackNames: [...trackNames].sort(compareText),
      measureCount: measureRanges.length,
      unavailableMetadata: ["page", "accidental", "tie"],
      ...(firstTempo === undefined ? { warnings: ["MIDI has no tempo meta; tempo remains unavailable"] } : {}),
    },
  };
  if (!positiveFinite(firstTempo)) warnings.push("MIDI has no tempo meta; tempo remains unavailable");
  return { score, warnings: [...new Set(warnings)].sort(compareText) };
}

function artifactFormat(value: NativeScoreArtifactType | string): NativeScoreArtifactType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "mid" || normalized === "midi") return "midi";
  if (normalized === "xml" || normalized === "musicxml") return "musicxml";
  if (normalized === "mxl") return "mxl";
  if (normalized === "mscz") return "mscz";
  throw new NativeScoreAdapterError(`unsupported native symbolic format: ${value}`);
}

function zipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function withProvenance(score: OmrScoreInput, provenance: NativeSymbolicProvenance): OmrScoreInput {
  const metadata = score.metadata && typeof score.metadata === "object" && !Array.isArray(score.metadata) ? score.metadata as Record<string, unknown> : {};
  return {
    ...score,
    metadata: {
      ...metadata,
      native: {
        artifactType: provenance.artifactType,
        sourceRef: provenance.sourceRef,
        sourcePage: provenance.sourcePage,
        version: provenance.version,
        accessMethod: provenance.accessMethod,
        sha256: provenance.sha256,
        bytes: provenance.bytes,
        parser: provenance.parser,
        rootFile: provenance.rootFile,
      },
    },
  };
}

function baseProvenance(format: NativeScoreArtifactType, bytes: Uint8Array, options: NativeSymbolicAdapterOptions, rootFile: string | null): NativeSymbolicProvenance {
  return {
    artifactType: format,
    sourceRef: safeLogicalText(options.sourceRef),
    sourcePage: safeSourcePage(options.sourcePage),
    version: safeVersion(options.version),
    accessMethod: options.accessMethod ?? "local-bytes",
    sha256: sha256Hex(bytes),
    bytes: bytes.byteLength,
    parser: { id: "keyspilli-native-symbolic", version: NATIVE_SCORE_ADAPTER_VERSION },
    rootFile: safeRootFile(rootFile),
  };
}

/** Adapt an explicitly typed local byte buffer into the common normalized score. */
export function adaptNativeSymbolicBytes(
  input: Uint8Array | ArrayBuffer,
  formatInput: NativeScoreArtifactType | string,
  options: NativeSymbolicAdapterOptions = {},
): NativeSymbolicAdapterResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = artifactFormat(formatInput);
  const provenance = baseProvenance(format, bytes, options, null);
  if (format === "mscz") {
    return {
      status: "unsupported",
      format,
      score: null,
      canonical: null,
      provenance,
      warnings: [],
      reason: "MSCZ is recognized but unavailable in the local adapter; export MusicXML, MXL, or MIDI locally",
    };
  }
  try {
    let score: OmrScoreInput;
    let warnings: string[];
    let rootFile: string | null = null;
    if (format === "midi") {
      const parsed = parseNativeMidi(bytes, options);
      score = parsed.score;
      warnings = parsed.warnings;
    } else {
      if (format === "mxl" && !zipContainer(bytes)) throw new NativeScoreAdapterError("MXL input is not a ZIP container");
      if (format === "musicxml" && zipContainer(bytes)) throw new NativeScoreAdapterError("MusicXML input is a ZIP container; use MXL format");
      const parsed = parseOmrMusicXmlBytes(bytes, options);
      rootFile = parsed.rootFile;
      score = parsed.score;
      warnings = [...parsed.warnings];
      if (format === "mxl" && parsed.format !== "mxl") warnings.push("MXL input did not contain a ZIP MusicXML container");
    }
    const finalProvenance = baseProvenance(format, bytes, options, rootFile);
    const enriched = withProvenance(score, finalProvenance);
    return {
      status: "parsed",
      format,
      score: enriched,
      canonical: normalizeCanonicalScore(enriched),
      provenance: finalProvenance,
      warnings: [...new Set(warnings)].sort(compareText),
    };
  } catch (error) {
    return {
      status: "invalid",
      format,
      score: null,
      canonical: null,
      provenance,
      warnings: [],
      error: safeError(error),
    };
  }
}

function pathInside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function protectedPath(value: string): boolean {
  const segments = resolve(value).split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => /^(?:\.ssh|\.gnupg|\.aws|\.config|wallets?|secrets?|credentials?|tokens?|passwords?|id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys)$/i.test(segment));
}

function formatFromPath(path: string): NativeScoreArtifactType {
  const extension = extname(path).toLowerCase();
  if (extension === ".mid" || extension === ".midi") return "midi";
  if (extension === ".musicxml" || extension === ".xml") return "musicxml";
  if (extension === ".mxl") return "mxl";
  if (extension === ".mscz") return "mscz";
  throw new NativeScoreAdapterError(`unsupported native symbolic extension: ${extension || "(none)"}`);
}

async function validateLocalFile(path: string, options: NativeSymbolicAdapterOptions): Promise<string> {
  if (!isAbsolute(path)) throw new NativeScoreAdapterError("native symbolic path must be absolute");
  if (path.includes("\u0000") || /[\r\n]/.test(path)) throw new NativeScoreAdapterError("native symbolic path contains unsafe characters");
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path);
  } catch {
    throw new NativeScoreAdapterError("native symbolic path does not exist or could not be resolved");
  }
  const info = await stat(resolvedPath);
  if (!info.isFile()) throw new NativeScoreAdapterError("native symbolic path is not a regular file");
  const maxBytes = positiveFinite(options.maxBytes) ? options.maxBytes! : DEFAULT_MAX_BYTES;
  if (info.size > maxBytes) throw new NativeScoreAdapterError("native symbolic file exceeds local size limit");
  if (protectedPath(resolvedPath)) throw new NativeScoreAdapterError("protected native symbolic path");
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  if (!options.allowRepositoryPath && pathInside(repositoryRoot, resolvedPath)) throw new NativeScoreAdapterError("native symbolic input must be outside the repository");
  if (options.allowedRoots?.length && !options.allowedRoots.some((root) => pathInside(root, resolvedPath))) throw new NativeScoreAdapterError("native symbolic input is outside allowed local roots");
  return resolvedPath;
}

/** Read one explicitly permitted local native file without exposing its path or copying it. */
export async function adaptNativeSymbolicFile(path: string, options: NativeSymbolicAdapterOptions = {}): Promise<NativeSymbolicAdapterResult> {
  const resolvedPath = await validateLocalFile(path, options);
  const bytes = new Uint8Array(await readFile(resolvedPath));
  const format = formatFromPath(resolvedPath);
  return adaptNativeSymbolicBytes(bytes, format, {
    ...options,
    accessMethod: "local-file",
    sourceRef: options.sourceRef ?? basename(resolvedPath),
  });
}

/** Stable JSON for local reports; physical source paths are intentionally absent from the result. */
export function nativeSymbolicAdapterJson(result: NativeSymbolicAdapterResult): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stable(item)]));
  };
  return `${JSON.stringify(stable(result), null, 2)}\n`;
}
