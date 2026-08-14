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
}

function buildTrack(events: TrackEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || (a.bytes[0]! & 0xf0) - (b.bytes[0]! & 0xf0));
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

export interface WriteMidiOptions {
  tempoBpm: number;
  timeSig?: [number, number];
  keySig?: number;
  keyMode?: 0 | 1;
  title?: string;
  /** notes grouped by hand; if empty, all notes go to one track */
  tracks?: { name: string; notes: Note[] }[];
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
    events.push({ tick: 0, bytes: [0xc0, 0] }); // program: acoustic grand
    const on: Map<number, { midi: number; vel: number }> = new Map();
    const soundingEnd = new Map<number, number>();
    const offEvents = new Map<number, TrackEvent>();
    for (const n of [...track.notes].sort((a, b) => a.start - b.start || a.midi - b.midi)) {
      const t = Math.round(n.start * division);
      const vel = Math.round(n.vel || 0);
      if (vel < 1) continue; // note-on velocity 0 is a note-off in MIDI
      const off = Math.round((n.start + n.dur) * division);
      // Only cut a previous same-pitch note when it is still sounding at the
      // new attack. Cancelling the scheduled note-off of an already-ended
      // note would stretch it to the next attack.
      const prevEnd = soundingEnd.get(n.midi);
      if (on.has(n.midi) && prevEnd !== undefined && t < prevEnd) {
        // re-strike: cancel the previous instance's scheduled note-off so the
        // new note is not cut short; the off at the attack tick sorts before
        // the new note-on (0x80 < 0x90), so the pairing stays correct.
        const stale = offEvents.get(n.midi);
        if (stale) {
          const i = events.indexOf(stale);
          if (i >= 0) events.splice(i, 1);
        }
        events.push({ tick: t, bytes: [0x80, n.midi, 0] });
        on.delete(n.midi);
      }
      on.set(n.midi, { midi: n.midi, vel });
      soundingEnd.set(n.midi, off);
      events.push({ tick: t, bytes: [0x90, n.midi, Math.max(1, Math.min(127, vel))] });
      const offEv = { tick: off, bytes: [0x80, n.midi, 0] as number[] };
      offEvents.set(n.midi, offEv);
      events.push(offEv);
    }
    trackBytes.push(buildTrack(events));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (trackBytes.length >> 8) & 0xff, trackBytes.length & 0xff, (division >> 8) & 0xff, division & 0xff];
  return new Uint8Array([...header, ...trackBytes.flatMap((t) => [...t])]);
}
