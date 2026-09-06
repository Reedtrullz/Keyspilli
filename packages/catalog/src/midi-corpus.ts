import { createHash } from "node:crypto";

/** A bounded, path-free representation of one SMF for local corpus work. */
export const MIDI_CORPUS_SCHEMA_VERSION = 1 as const;
export const MIDI_CORPUS_NORMALIZER_VERSION = "midi-corpus-normalizer-v1" as const;

export type MidiCorpusIssueSeverity = "error" | "warning";

export interface MidiCorpusIssue {
  severity: MidiCorpusIssueSeverity;
  code: string;
  message: string;
  trackIndex?: number;
  byteOffset?: number;
  /** Absolute tick at which the malformed event was encountered, when known. */
  tick?: number;
}

export interface CanonicalMidiProgramChange {
  tick: number;
  channel: number;
  program: number;
}

export interface CanonicalMidiNote {
  trackIndex: number;
  channel: number;
  midi: number;
  velocity: number;
  startTick: number;
  endTick: number;
  startBeats: number;
  durationBeats: number;
  program: number;
  percussion: boolean;
}

export interface CanonicalMidiTrack {
  index: number;
  name: string | null;
  channels: number[];
  programs: CanonicalMidiProgramChange[];
  percussion: boolean;
  endTick: number;
  notes: CanonicalMidiNote[];
}

export interface CanonicalMidiTempo {
  tick: number;
  bpm: number;
}

export interface CanonicalMidiTimeSignature {
  tick: number;
  signature: [number, number];
}

export interface CanonicalMidiKeySignature {
  tick: number;
  fifths: number;
  mode: 0 | 1;
}

export interface CanonicalMidi {
  schemaVersion: typeof MIDI_CORPUS_SCHEMA_VERSION;
  format: number;
  division: number;
  title: string | null;
  tempos: CanonicalMidiTempo[];
  timeSignatures: CanonicalMidiTimeSignature[];
  keySignatures: CanonicalMidiKeySignature[];
  tracks: CanonicalMidiTrack[];
  notes: CanonicalMidiNote[];
}

export type MidiCorpusNormalizationStatus = "not-attempted" | "not-needed" | "normalized" | "blocked";

/** Path-free before/after accounting for every audit or normalization call. */
export interface MidiCorpusNormalizationAudit {
  status: MidiCorpusNormalizationStatus;
  beforeSha256: string;
  beforeBytes: number;
  afterSha256: string | null;
  afterBytes: number | null;
  droppedEvents: number;
  droppedIssueCodes: string[];
  /** Bounded forensic counters; null means the input was not structurally parseable. */
  outOfRangeValues: number;
  valuesChanged: number;
  affectedMessages: number;
  affectedTracks: number[];
  affectedTicks: number[];
  notesBefore: number | null;
  notesAfter: number | null;
  durationBeatsBefore: number | null;
  durationBeatsAfter: number | null;
  tempoBefore: number | null;
  tempoAfter: number | null;
  trackCountBefore: number | null;
  trackCountAfter: number | null;
}

export interface MidiCorpusOptions {
  /** Maximum input size accepted by the pure byte API. */
  maxBytes?: number;
  /** Maximum events per track, including non-note events. */
  maxEventsPerTrack?: number;
  /** Maximum absolute tick accepted in a track. */
  maxTicks?: number;
}

interface ParsedCorpus {
  canonical: CanonicalMidi;
  issues: MidiCorpusIssue[];
}

export interface MidiCorpusValidResult {
  schemaVersion: typeof MIDI_CORPUS_SCHEMA_VERSION;
  normalizerVersion: typeof MIDI_CORPUS_NORMALIZER_VERSION;
  status: "valid";
  inputSha256: string;
  inputBytes: number;
  normalizedSha256?: undefined;
  normalizedBytes?: undefined;
  normalization: MidiCorpusNormalizationAudit;
  canonical: CanonicalMidi;
  issues: MidiCorpusIssue[];
}

export interface MidiCorpusNormalizedResult {
  schemaVersion: typeof MIDI_CORPUS_SCHEMA_VERSION;
  normalizerVersion: typeof MIDI_CORPUS_NORMALIZER_VERSION;
  status: "normalized";
  inputSha256: string;
  inputBytes: number;
  normalizedSha256: string;
  normalization: MidiCorpusNormalizationAudit;
  canonical: CanonicalMidi;
  normalizedBytes: Uint8Array;
  issues: MidiCorpusIssue[];
}

export interface MidiCorpusInvalidResult {
  schemaVersion: typeof MIDI_CORPUS_SCHEMA_VERSION;
  normalizerVersion: typeof MIDI_CORPUS_NORMALIZER_VERSION;
  status: "invalid";
  inputSha256: string;
  inputBytes: number;
  normalizedSha256?: undefined;
  normalizedBytes?: undefined;
  normalization: MidiCorpusNormalizationAudit;
  canonical: null;
  issues: MidiCorpusIssue[];
}

export type MidiCorpusResult = MidiCorpusValidResult | MidiCorpusNormalizedResult | MidiCorpusInvalidResult;

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 1_000_000;
// A single SMF delta-time is a four-byte VLQ, so this bound also keeps the
// deterministic writer from having to invent timing filler events.
const MAX_VLQ_VALUE = 0x0fffffff;
const DEFAULT_MAX_TICKS = MAX_VLQ_VALUE;
const RECOVERABLE_EVENT_CODES = new Set([
  "data-byte-out-of-range",
  "running-status-without-status",
  "unsupported-channel-event",
  "unsupported-system-event",
]);

class MidiCorpusFatal extends Error {
  constructor(public readonly issue: MidiCorpusIssue) {
    super(issue.message);
    this.name = "MidiCorpusFatal";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function issue(
  severity: MidiCorpusIssueSeverity,
  code: string,
  message: string,
  trackIndex?: number,
  byteOffset?: number,
  tick?: number,
): MidiCorpusIssue {
  return {
    severity,
    code,
    message,
    ...(trackIndex === undefined ? {} : { trackIndex }),
    ...(byteOffset === undefined ? {} : { byteOffset }),
    ...(tick === undefined ? {} : { tick }),
  };
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function text(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function u16(data: Uint8Array, offset: number): number {
  return (data[offset]! << 8) | data[offset + 1]!;
}

function u32(data: Uint8Array, offset: number): number {
  return (((data[offset]! << 24) >>> 0) + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!);
}

function fatal(code: string, message: string, trackIndex?: number, byteOffset?: number): never {
  throw new MidiCorpusFatal(issue("error", code, message, trackIndex, byteOffset));
}

function readVlq(data: Uint8Array, position: { value: number }, end: number, trackIndex: number): number {
  let value = 0;
  for (let count = 0; count < 4; count += 1) {
    if (position.value >= end) fatal("truncated-varint", "truncated MIDI variable-length value", trackIndex, position.value);
    const byte = data[position.value++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  fatal("invalid-varint", "invalid MIDI variable-length value", trackIndex, position.value);
}

function pushIssue(
  issues: MidiCorpusIssue[],
  recover: boolean,
  value: MidiCorpusIssue,
): void {
  if (!recover) throw new MidiCorpusFatal(value);
  issues.push(value);
}

function parseCorpus(data: Uint8Array, options: Required<MidiCorpusOptions>, recover: boolean): ParsedCorpus {
  if (data.byteLength < 14 || ascii(data.slice(0, 4)) !== "MThd") fatal("missing-header", "not a MIDI file (missing MThd)");
  const headerLength = u32(data, 4);
  if (headerLength !== 6 || data.byteLength < 8 + headerLength) fatal("unsupported-header", "unsupported MIDI header length");
  const format = u16(data, 8);
  const trackCount = u16(data, 10);
  const division = u16(data, 12);
  if (format > 2 || trackCount < 1 || trackCount > 512) fatal("invalid-header", "invalid MIDI format or track count");
  if (format === 0 && trackCount !== 1) fatal("invalid-format-track-count", "MIDI format 0 must contain exactly one track");
  if (division === 0 || (division & 0x8000) !== 0) fatal("unsupported-timing", "SMPTE or zero MIDI timing is unsupported");

  const issues: MidiCorpusIssue[] = [];
  const tracks: CanonicalMidiTrack[] = [];
  const tempos: CanonicalMidiTempo[] = [];
  const timeSignatures: CanonicalMidiTimeSignature[] = [];
  const keySignatures: CanonicalMidiKeySignature[] = [];
  let title: string | null = null;
  let position = 8 + headerLength;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (position + 8 > data.length || ascii(data.slice(position, position + 4)) !== "MTrk") fatal("bad-track-header", "bad MIDI track header", trackIndex, position);
    const trackLength = u32(data, position + 4);
    position += 8;
    if (position + trackLength > data.length) fatal("truncated-track", "truncated MIDI track", trackIndex, position);
    const end = position + trackLength;
    let tick = 0;
    let running: number | null = null;
    let eventCount = 0;
    let trackName: string | null = null;
    let sawEnd = false;
    const channels = new Set<number>();
    const programs = new Map<number, number>();
    const programChanges: CanonicalMidiProgramChange[] = [];
    const notes: CanonicalMidiNote[] = [];
    const active = new Map<string, Array<{ channel: number; midi: number; startTick: number; velocity: number; program: number }>>();

    const recoverable = (code: string, message: string, offset: number): void => {
      pushIssue(issues, recover, issue("error", code, message, trackIndex, offset, tick));
    };
    const malformedMetadata = (code: string, message: string, offset: number): void => {
      // Metadata determines the timing/key interpretation of the corpus. It
      // is therefore structural input, not event-level noise that the
      // bounded normalizer may silently discard. In recovery mode we still
      // record the issue so callers receive a useful diagnostic before the
      // normalizer fails closed.
      pushIssue(issues, recover, issue("error", code, message, trackIndex, offset, tick));
    };
    const readChannelData = (count: number, eventOffset: number): number[] | null => {
      const values: number[] = [];
      let ok = true;
      for (let index = 0; index < count; index += 1) {
        if (position >= end) fatal("truncated-channel-event", "truncated MIDI channel event", trackIndex, eventOffset);
        const value = data[position++]!;
        if (value > 127) {
          recoverable("data-byte-out-of-range", `MIDI data byte ${value} is outside 0..127`, eventOffset);
          ok = false;
        }
        values.push(value);
      }
      return ok ? values : null;
    };

    while (position < end) {
      if (sawEnd) fatal("events-after-end-of-track", "MIDI track contains events after end-of-track", trackIndex, position);
      eventCount += 1;
      if (eventCount > options.maxEventsPerTrack) fatal("event-limit", `MIDI track exceeds ${options.maxEventsPerTrack} events`, trackIndex, position);
      const deltaOffset = position;
      const deltaState = { value: position };
      const actualDelta = readVlq(data, deltaState, end, trackIndex);
      position = deltaState.value;
      if (actualDelta > options.maxTicks - tick) fatal("tick-limit", "MIDI absolute tick exceeds configured bound", trackIndex, deltaOffset);
      tick += actualDelta;
      if (position >= end) fatal("truncated-event", "truncated MIDI event", trackIndex, position);
      const eventOffset = position;
      let status = data[position++]!;
      if (status < 0x80) {
        if (running === null) {
          recoverable("running-status-without-status", "MIDI running status without a prior channel event", eventOffset);
          continue;
        }
        position -= 1;
        status = running;
      } else if (status >= 0x80 && status < 0xf0) {
        running = status;
      } else if (status < 0xf8) {
        running = null;
      }

      if (status === 0xff) {
        if (position >= end) fatal("truncated-meta", "truncated MIDI meta event", trackIndex, position);
        const type = data[position++]!;
        const lengthState = { value: position };
        const payloadLength = readVlq(data, lengthState, end, trackIndex);
        position = lengthState.value;
        if (position + payloadLength > end) fatal("truncated-meta-payload", "truncated MIDI meta payload", trackIndex, position);
        const payload = data.slice(position, position + payloadLength);
        if (type === 0x03) {
          const value = text(payload);
          if (value) trackName = value;
        } else if ((type === 0x01 || type === 0x02) && title === null) {
          const value = text(payload);
          if (value) title = value;
        } else if (type === 0x51) {
          if (payloadLength !== 3) {
            malformedMetadata("invalid-tempo-payload", "MIDI tempo meta event must contain exactly 3 payload bytes", eventOffset);
          } else {
            const micros = (payload[0]! << 16) | (payload[1]! << 8) | payload[2]!;
            if (micros === 0) malformedMetadata("invalid-tempo-payload", "MIDI tempo meta event must contain a positive microseconds-per-quarter value", eventOffset);
            else tempos.push({ tick, bpm: 60_000_000 / micros });
          }
        } else if (type === 0x58) {
          if (payloadLength !== 4) {
            malformedMetadata("invalid-time-signature-payload", "MIDI time-signature meta event must contain exactly 4 payload bytes", eventOffset);
          } else {
            const numerator = payload[0]!;
            const denominator = 2 ** payload[1]!;
            if (numerator === 0 || !Number.isFinite(denominator)) malformedMetadata("invalid-time-signature-payload", "MIDI time-signature meta event has an invalid numerator or denominator", eventOffset);
            else timeSignatures.push({ tick, signature: [numerator, denominator] });
          }
        } else if (type === 0x59) {
          if (payloadLength !== 2) {
            malformedMetadata("invalid-key-signature-payload", "MIDI key-signature meta event must contain exactly 2 payload bytes", eventOffset);
          } else {
            const fifths = (payload[0]! << 24) >> 24;
            const mode = payload[1]!;
            if (fifths < -7 || fifths > 7 || (mode !== 0 && mode !== 1)) malformedMetadata("invalid-key-signature-payload", "MIDI key-signature meta event has an invalid key or mode", eventOffset);
            else keySignatures.push({ tick, fifths, mode });
          }
        }
        if (type === 0x2f) {
          if (payloadLength !== 0) fatal("invalid-end-of-track", "MIDI end-of-track meta event must have an empty payload", trackIndex, eventOffset);
          sawEnd = true;
        }
        position += payloadLength;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const lengthState = { value: position };
        const payloadLength = readVlq(data, lengthState, end, trackIndex);
        position = lengthState.value + payloadLength;
        if (position > end) fatal("truncated-sysex", "truncated MIDI sysex payload", trackIndex, lengthState.value);
        continue;
      }
      if (status === 0xf1 || status === 0xf3) {
        if (readChannelData(1, eventOffset) === null) continue;
        continue;
      }
      if (status === 0xf2) {
        if (readChannelData(2, eventOffset) === null) continue;
        continue;
      }
      if (status === 0xf6 || (status >= 0xf8 && status <= 0xfe)) continue;
      if (status >= 0xf0) {
        recoverable("unsupported-system-event", `unsupported MIDI system event 0x${status.toString(16)}`, eventOffset);
        continue;
      }

      const channel = status & 0x0f;
      const kind = status & 0xf0;
      channels.add(channel);
      if (kind === 0xc0) {
        const values = readChannelData(1, eventOffset);
        if (values) {
          programs.set(channel, values[0]!);
          programChanges.push({ tick, channel, program: values[0]! });
        }
        continue;
      }
      if (kind === 0xd0) {
        readChannelData(1, eventOffset);
        continue;
      }
      if (![0x80, 0x90, 0xa0, 0xb0, 0xe0].includes(kind)) {
        recoverable("unsupported-channel-event", `unsupported MIDI channel event 0x${kind.toString(16)}`, eventOffset);
        continue;
      }
      const values = readChannelData(2, eventOffset);
      if (!values) continue;
      const midi = values[0]!;
      const velocity = values[1]!;
      if (kind === 0x90 && velocity > 0) {
        const key = `${channel}:${midi}`;
        const queue = active.get(key) ?? [];
        queue.push({ channel, midi, startTick: tick, velocity, program: programs.get(channel) ?? 0 });
        active.set(key, queue);
      } else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) {
        const key = `${channel}:${midi}`;
        const queue = active.get(key);
        const started = queue?.shift();
        if (!started) {
          issues.push(issue("warning", "unmatched-note-off", `MIDI note-off has no matching note-on for ${midi}`, trackIndex, eventOffset));
        } else if (tick <= started.startTick) {
          issues.push(issue("warning", "zero-duration-note", `MIDI note ${midi} has zero duration`, trackIndex, eventOffset));
        } else {
          const percussion = channel === 9;
          notes.push({ trackIndex, channel, midi: started.midi, velocity: started.velocity, startTick: started.startTick, endTick: tick, startBeats: started.startTick / division, durationBeats: (tick - started.startTick) / division, program: started.program, percussion });
        }
        if (queue && queue.length === 0) active.delete(key);
      }
    }

    for (const queue of active.values()) {
      for (const started of queue) {
        if (tick > started.startTick) {
          const percussion = started.channel === 9;
          notes.push({ trackIndex, channel: started.channel, midi: started.midi, velocity: started.velocity, startTick: started.startTick, endTick: tick, startBeats: started.startTick / division, durationBeats: (tick - started.startTick) / division, program: started.program, percussion });
        }
      }
    }
    if (!sawEnd) issues.push(issue("error", "missing-end-of-track", "MIDI track has no end-of-track meta event", trackIndex, end));
    const normalizedNotes = notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi || left.endTick - right.endTick || left.channel - right.channel);
    tracks.push({ index: trackIndex, name: trackName, channels: [...channels].sort((a, b) => a - b), programs: programChanges.sort((a, b) => a.tick - b.tick || a.channel - b.channel || a.program - b.program), percussion: channels.has(9), endTick: tick, notes: normalizedNotes });
    position = end;
  }

  if (position !== data.length) fatal("trailing-data", "MIDI file contains bytes after the declared track chunks", undefined, position);

  const notes = tracks.flatMap((track) => track.notes).sort((left, right) => left.startTick - right.startTick || left.midi - right.midi || left.trackIndex - right.trackIndex || left.channel - right.channel);
  tempos.sort((a, b) => a.tick - b.tick || a.bpm - b.bpm);
  timeSignatures.sort((a, b) => a.tick - b.tick || a.signature[0] - b.signature[0] || a.signature[1] - b.signature[1]);
  keySignatures.sort((a, b) => a.tick - b.tick || a.fifths - b.fifths || a.mode - b.mode);
  return { canonical: { schemaVersion: MIDI_CORPUS_SCHEMA_VERSION, format, division, title, tempos, timeSignatures, keySignatures, tracks, notes }, issues };
}

interface WriteEvent { tick: number; bytes: number[]; order: number; }

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    out.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return out;
}

function metaEvent(type: number, payload: number[]): number[] {
  return [0xff, type, ...vlq(payload.length), ...payload];
}

function writeTrack(events: WriteEvent[]): Uint8Array {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order || a.bytes[0]! - b.bytes[0]!);
  const body: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    body.push(...vlq(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  return Uint8Array.from([0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body]);
}

function utf8(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

function writeCanonical(canonical: CanonicalMidi): Uint8Array {
  const trackBytes: Uint8Array[] = [];
  for (const track of canonical.tracks) {
    const events: WriteEvent[] = [];
    if (track.name) events.push({ tick: 0, order: 0, bytes: metaEvent(0x03, utf8(track.name)) });
    if (track.index === 0) {
      if (canonical.title) events.push({ tick: 0, order: 0, bytes: metaEvent(0x01, utf8(canonical.title)) });
      for (const tempo of canonical.tempos) {
        const micros = Math.max(1, Math.min(0xffffff, Math.round(60_000_000 / tempo.bpm)));
        events.push({ tick: Math.round(tempo.tick), order: 0, bytes: metaEvent(0x51, [(micros >>> 16) & 0xff, (micros >>> 8) & 0xff, micros & 0xff]) });
      }
      for (const change of canonical.timeSignatures) {
        events.push({ tick: Math.round(change.tick), order: 0, bytes: metaEvent(0x58, [change.signature[0], Math.round(Math.log2(change.signature[1])), 24, 8]) });
      }
      for (const change of canonical.keySignatures) events.push({ tick: Math.round(change.tick), order: 0, bytes: metaEvent(0x59, [change.fifths & 0xff, change.mode]) });
    }
    for (const program of track.programs) events.push({ tick: Math.round(program.tick), order: 1, bytes: [0xc0 | program.channel, program.program] });
    for (const note of track.notes) {
      events.push({ tick: Math.round(note.startTick), order: 3, bytes: [0x90 | note.channel, note.midi, note.velocity] });
      events.push({ tick: Math.round(note.endTick), order: 2, bytes: [0x80 | note.channel, note.midi, 0] });
    }
    trackBytes.push(writeTrack(events));
  }
  // A source format-0 file can be malformed enough to advertise multiple
  // tracks. The canonical rewrite has one independent chunk per track, so
  // use the valid multi-track format-1 header in that case.
  const outputFormat = canonical.format === 0 && trackBytes.length > 1 ? 1 : canonical.format;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, (outputFormat >>> 8) & 0xff, outputFormat & 0xff, (trackBytes.length >>> 8) & 0xff, trackBytes.length & 0xff, (canonical.division >>> 8) & 0xff, canonical.division & 0xff];
  return Uint8Array.from([...header, ...trackBytes.flatMap((track) => [...track])]);
}

function bounds(options: MidiCorpusOptions): Required<MidiCorpusOptions> {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes! > 0 ? options.maxBytes! : DEFAULT_MAX_BYTES;
  const maxEventsPerTrack = Number.isInteger(options.maxEventsPerTrack) && options.maxEventsPerTrack! > 0 ? options.maxEventsPerTrack! : DEFAULT_MAX_EVENTS;
  const maxTicks = Number.isSafeInteger(options.maxTicks) && options.maxTicks! > 0 ? Math.min(options.maxTicks!, MAX_VLQ_VALUE) : DEFAULT_MAX_TICKS;
  return { maxBytes, maxEventsPerTrack, maxTicks };
}

function normalizationAudit(
  bytes: Uint8Array,
  status: MidiCorpusNormalizationStatus,
  after: Uint8Array | null = null,
  dropped: readonly MidiCorpusIssue[] = [],
  beforeCanonical: CanonicalMidi | null = null,
  afterCanonical: CanonicalMidi | null = beforeCanonical,
): MidiCorpusNormalizationAudit {
  const droppedIssueCodes = [...new Set(dropped.map((entry) => entry.code))].sort();
  const droppedEventKeys = new Set(dropped.map((entry) => `${entry.trackIndex ?? "?"}:${entry.byteOffset ?? "?"}`));
  const affectedTracks = [...new Set(dropped.map((entry) => entry.trackIndex).filter((value): value is number => Number.isInteger(value)))].sort((a, b) => a - b);
  const affectedTicks = [...new Set(dropped.map((entry) => entry.tick).filter((value): value is number => Number.isInteger(value)))].sort((a, b) => a - b);
  const summary = (canonical: CanonicalMidi | null): { notes: number; durationBeats: number; tempo: number | null; tracks: number } | null => {
    if (!canonical) return null;
    const division = Number.isFinite(canonical.division) && canonical.division > 0 ? canonical.division : 1;
    const trackEnds = canonical.tracks.map((track) => track.endTick).filter((value) => Number.isFinite(value));
    const noteEnds = canonical.notes.map((note) => note.endTick).filter((value) => Number.isFinite(value));
    const durationTicks = Math.max(0, ...trackEnds, ...noteEnds);
    const tempo = canonical.tempos.find((value) => value.tick === 0)?.bpm ?? canonical.tempos[0]?.bpm ?? null;
    return { notes: canonical.notes.length, durationBeats: durationTicks / division, tempo: Number.isFinite(tempo) && tempo! > 0 ? tempo! : null, tracks: canonical.tracks.length };
  };
  const before = summary(beforeCanonical);
  const afterSummary = summary(afterCanonical);
  return {
    status,
    beforeSha256: sha256(bytes),
    beforeBytes: bytes.byteLength,
    afterSha256: after ? sha256(after) : null,
    afterBytes: after ? after.byteLength : null,
    droppedEvents: droppedEventKeys.size,
    droppedIssueCodes,
    outOfRangeValues: dropped.filter((entry) => entry.code === "data-byte-out-of-range").length,
    valuesChanged: 0,
    affectedMessages: droppedEventKeys.size,
    affectedTracks,
    affectedTicks,
    notesBefore: before?.notes ?? null,
    notesAfter: afterSummary?.notes ?? null,
    durationBeatsBefore: before?.durationBeats ?? null,
    durationBeatsAfter: afterSummary?.durationBeats ?? null,
    tempoBefore: before?.tempo ?? null,
    tempoAfter: afterSummary?.tempo ?? null,
    trackCountBefore: before?.tracks ?? null,
    trackCountAfter: afterSummary?.tracks ?? null,
  };
}

function invalid(
  bytes: Uint8Array,
  value: MidiCorpusIssue | MidiCorpusIssue[],
  status: MidiCorpusNormalizationStatus = "not-attempted",
): MidiCorpusInvalidResult {
  const issues = Array.isArray(value) ? value : [value];
  return { schemaVersion: MIDI_CORPUS_SCHEMA_VERSION, normalizerVersion: MIDI_CORPUS_NORMALIZER_VERSION, status: "invalid", inputSha256: sha256(bytes), inputBytes: bytes.byteLength, normalization: normalizationAudit(bytes, status), canonical: null, issues };
}

/** Strict, read-only audit. It never rewrites or returns a path. */
export function auditMidiBytes(input: Uint8Array | ArrayBuffer, options: MidiCorpusOptions = {}): MidiCorpusResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const limits = bounds(options);
  if (bytes.byteLength > limits.maxBytes) return invalid(bytes, issue("error", "input-too-large", `MIDI input exceeds ${limits.maxBytes} bytes`));
  try {
    const parsed = parseCorpus(bytes, limits, false);
    return { schemaVersion: MIDI_CORPUS_SCHEMA_VERSION, normalizerVersion: MIDI_CORPUS_NORMALIZER_VERSION, status: "valid", inputSha256: sha256(bytes), inputBytes: bytes.byteLength, normalization: normalizationAudit(bytes, "not-needed", bytes, [], parsed.canonical), canonical: parsed.canonical, issues: parsed.issues };
  } catch (error) {
    const parsed = error instanceof MidiCorpusFatal ? error.issue : issue("error", "parse-failed", "MIDI parse failed");
    return invalid(bytes, parsed);
  }
}

/**
 * Bounded event-level salvage. Structural failures remain invalid; recoverable
 * event corruption is dropped, recorded, and rewritten as a strict SMF.
 */
export function normalizeMidiBytes(input: Uint8Array | ArrayBuffer, options: MidiCorpusOptions = {}): MidiCorpusResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const limits = bounds(options);
  if (bytes.byteLength > limits.maxBytes) return invalid(bytes, issue("error", "input-too-large", `MIDI input exceeds ${limits.maxBytes} bytes`));
  try {
    const parsed = parseCorpus(bytes, limits, true);
    const errors = parsed.issues.filter((entry) => entry.severity === "error");
    const structural = errors.filter((entry) => !RECOVERABLE_EVENT_CODES.has(entry.code));
    if (structural.length) return invalid(bytes, parsed.issues, "blocked");
    const dropped = errors.filter((entry) => RECOVERABLE_EVENT_CODES.has(entry.code));
    if (dropped.length) parsed.issues.push(...dropped.map((entry) => issue("warning", "dropped-malformed-event", `dropped malformed MIDI event (${entry.code})`, entry.trackIndex, entry.byteOffset, entry.tick)));
    const normalizedBytes = writeCanonical(parsed.canonical);
    const wasNormalized = dropped.length > 0;
    return wasNormalized
      ? { schemaVersion: MIDI_CORPUS_SCHEMA_VERSION, normalizerVersion: MIDI_CORPUS_NORMALIZER_VERSION, status: "normalized", inputSha256: sha256(bytes), inputBytes: bytes.byteLength, normalizedSha256: sha256(normalizedBytes), normalization: normalizationAudit(bytes, "normalized", normalizedBytes, dropped, parsed.canonical, parsed.canonical), normalizedBytes, canonical: parsed.canonical, issues: parsed.issues }
      : { schemaVersion: MIDI_CORPUS_SCHEMA_VERSION, normalizerVersion: MIDI_CORPUS_NORMALIZER_VERSION, status: "valid", inputSha256: sha256(bytes), inputBytes: bytes.byteLength, normalization: normalizationAudit(bytes, "not-needed", bytes, [], parsed.canonical), canonical: parsed.canonical, issues: parsed.issues };
  } catch (error) {
    const parsed = error instanceof MidiCorpusFatal ? error.issue : issue("error", "parse-failed", "MIDI parse failed");
    return invalid(bytes, parsed, "blocked");
  }
}
