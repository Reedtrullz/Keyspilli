import { Note } from "./types.js";

function varint(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

interface TrackEvent {
  tick: number;
  bytes: number[];
  /** Optional same-tick ordering override (lower runs first). */
  order?: number;
}

function buildTrack(events: TrackEvent[]): Uint8Array {
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.order !== undefined || b.order !== undefined) return (a.order ?? 2) - (b.order ?? 2);
    // At the same tick, note-offs must precede note-ons so a channel can be
    // reused without creating a zero-length ambiguity.
    const statusOrder = (status: number) => {
      const kind = status & 0xf0;
      if (status === 0xff) return 0;
      if (kind === 0x80) return 1;
      if (kind === 0xc0 || kind === 0xd0) return 2;
      if (kind === 0x90) return 3;
      return 2;
    };
    return statusOrder(a.bytes[0]!) - statusOrder(b.bytes[0]!);
  });
  const body: number[] = [];
  let last = 0;
  for (const ev of events) {
    body.push(...varint(ev.tick - last));
    body.push(...ev.bytes);
    last = ev.tick;
  }
  body.push(...varint(0), 0xff, 0x2f, 0x00);
  const len = body.length;
  return new Uint8Array([...strBytes("MTrk"), (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...body]);
}

function strBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const MELODY_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/**
 * Allocate MIDI channels per pitch so overlapping intervals never share a
 * channel. MIDI note-off events carry only pitch+channel, so this is required
 * to preserve nested same-pitch re-strikes during parse/write roundtrips.
 */
function allocateChannels(notes: Note[]): Map<Note, number> {
  const byPitch = new Map<number, { note: Note; end: number; channel: number }[]>();
  const out = new Map<Note, number>();
  const ordered = notes
    .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.dur) && n.dur > 0 && Number.isFinite(n.vel) && n.vel > 0)
    .slice()
    .sort((a, b) => a.start - b.start || (a.start + a.dur) - (b.start + b.dur) || a.midi - b.midi);

  for (const note of ordered) {
    const lanes = byPitch.get(note.midi) ?? [];
    if (!byPitch.has(note.midi)) byPitch.set(note.midi, lanes);
    const start = note.start;
    const lane = lanes.find((x) => x.end <= start + 1e-9);
    const used = new Set(lanes.map((x) => x.channel));
    const channel = lane?.channel ?? MELODY_CHANNELS.find((ch) => !used.has(ch));
    if (channel === undefined) {
      throw new Error(`too many overlapping MIDI notes for pitch ${note.midi} (maximum ${MELODY_CHANNELS.length})`);
    }
    if (lane) lane.end = note.start + note.dur;
    else lanes.push({ note, end: note.start + note.dur, channel });
    out.set(note, channel);
  }
  return out;
}

export interface WriteMidiOptions {
  tempoBpm: number;
  timeSig?: [number, number];
  keySig?: number;
  keyMode?: 0 | 1;
  title?: string;
  /** notes grouped by hand; if empty, all notes go to one track */
  tracks?: { name: string; notes: Note[]; channel?: number; program?: number; percussion?: boolean }[];
  division?: number;
}

/** Write a type-1 SMF (one track per hand) from notes in beats. */
export function writeMidi(notes: Note[], opts: WriteMidiOptions): Uint8Array {
  const division = opts.division ?? 480;
  const [num, den] = opts.timeSig ?? [4, 4];
  const tempoUs = Math.round(60_000_000 / opts.tempoBpm);
  const tracks = opts.tracks && opts.tracks.length > 0
    ? opts.tracks
    : [{ name: "Piano", notes }];
  const trackBytes: Uint8Array[] = [];
  for (const track of tracks) {
    const events: TrackEvent[] = [];
    if (track.name) {
      const name = strBytes(track.name);
      events.push({ tick: 0, bytes: [0xff, 0x03, name.length, ...name] });
    }
    if (track === tracks[0]) {
      events.push(
        { tick: 0, bytes: [0xff, 0x51, 0x03, (tempoUs >>> 16) & 0xff, (tempoUs >>> 8) & 0xff, tempoUs & 0xff] },
        { tick: 0, bytes: [0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8] },
        { tick: 0, bytes: [0xff, 0x59, 0x02, opts.keySig ?? 0, opts.keyMode ?? 0] },
      );
    }
    const explicitChannel = track.percussion ? 9 : track.channel;
    if (explicitChannel !== undefined && (!Number.isInteger(explicitChannel) || explicitChannel < 0 || explicitChannel > 15)) {
      throw new Error(`invalid MIDI channel ${String(explicitChannel)}`);
    }
    if (track.program !== undefined && (!Number.isInteger(track.program) || track.program < 0 || track.program > 127)) {
      throw new Error(`invalid MIDI program ${String(track.program)}`);
    }
    const channels = explicitChannel === undefined
      ? allocateChannels(track.notes)
      : new Map(track.notes.map((note) => [note, explicitChannel]));
    const usedChannels = [...new Set(channels.values())].sort((a, b) => a - b);
    for (const channel of usedChannels) {
      if (channel !== 9) events.push({ tick: 0, order: 1, bytes: [0xc0 | channel, track.program ?? 0] });
    }
    for (const n of [...track.notes].sort((a, b) => a.start - b.start || a.midi - b.midi)) {
      const t = Math.round(n.start * division);
      const vel = Math.round(n.vel || 0);
      if (vel < 1 || !Number.isFinite(n.start) || !Number.isFinite(n.dur) || n.dur <= 0) continue;
      const off = Math.round((n.start + n.dur) * division);
      const channel = channels.get(n);
      if (channel === undefined) continue;
      events.push({ tick: t, order: 3, bytes: [0x90 | channel, n.midi, Math.max(1, Math.min(127, vel))] });
      events.push({ tick: off, order: 0, bytes: [0x80 | channel, n.midi, 0] });
    }
    trackBytes.push(buildTrack(events));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (trackBytes.length >> 8) & 0xff, trackBytes.length & 0xff, (division >> 8) & 0xff, division & 0xff];
  return new Uint8Array([...header, ...trackBytes.flatMap((t) => [...t])]);
}
