import { Note, ParsedMidi } from "./types.js";

function readVarint(data: Uint8Array, pos: { v: number }): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const b = data[pos.v++]!;
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return value;
}

function readStr(data: Uint8Array, pos: { v: number }, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(data[pos.v++]!);
  return s;
}

/** Parse a Standard MIDI File into absolute-beat note events. */
export function parseMidi(buf: Uint8Array): ParsedMidi {
  if (buf.length < 14 || readStr(buf, { v: 0 }, 4) !== "MThd") throw new Error("not a MIDI file (missing MThd)");
  const headerLen = (buf[4]! << 24) | (buf[5]! << 16) | (buf[6]! << 8) | buf[7]!;
  if (headerLen !== 6) throw new Error("unsupported MIDI header length");
  const format = (buf[8]! << 8) | buf[9]!;
  const ntrks = (buf[10]! << 8) | buf[11]!;
  const division = (buf[12]! << 8) | buf[13]!;
  if (division & 0x8000) throw new Error("SMPTE timing not supported");
  if (ntrks === 0 || ntrks > 512) throw new Error("invalid track count");
  let pos = 8 + headerLen;

  const trackNotes: Note[][] = [];
  const trackNames: string[] = [];
  const tempos: { beat: number; bpm: number }[] = [];
  let timeSig: [number, number] = [4, 4];
  let keySig = 0;
  let keyMode: 0 | 1 = 0;
  let title: string | undefined;

  for (let t = 0; t < ntrks; t++) {
    if (pos + 8 > buf.length || readStr(buf, { v: pos }, 4) !== "MTrk") throw new Error("bad track header");
    pos += 4;
    const len = (buf[pos]! << 24) | (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!;
    pos += 4;
    if (len < 0 || pos + len > buf.length) throw new Error("truncated track");
    const end = pos + len;
    let tick = 0;
    let running: number | null = null;
    const on: Map<number, { start: number; vel: number }> = new Map();
    const notes: Note[] = [];

    while (pos < end) {
      const deltaPos = { v: pos };
      tick += readVarint(buf, deltaPos);
      pos = deltaPos.v;
      let status = buf[pos++]!;
      if (status < 0x80) {
        if (running === null) throw new Error(`running status without previous status at pos=${pos} byte=${buf[pos]?.toString(16)}`);
        status = running;
        pos--;
      } else if (status < 0xf0) {
        // only channel messages update running status; meta/sysex must not
        running = status;
      }
      const kind = status & 0xf0;
      const chan = status & 0x0f;
      if (kind === 0xf0) {
        if (status === 0xff) {
          const type = buf[pos++]!;
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos);
          pos = lenPos.v;
          if (type === 0x51 && len2 === 3) {
            const us = (buf[pos]! << 16) | (buf[pos + 1]! << 8) | buf[pos + 2]!;
            if (us > 0) tempos.push({ beat: tick / division, bpm: 60_000_000 / us });
          } else if (type === 0x58 && len2 === 4) {
            timeSig = [buf[pos]!, 1 << buf[pos + 1]!];
          } else if (type === 0x59 && len2 === 2) {
            keySig = (buf[pos]! << 24) >> 24;
            keyMode = buf[pos + 1]! === 0 ? 0 : 1;
          } else if (type === 0x03) {
            trackNames.push(readStr(buf, { v: pos }, len2));
          } else if (type === 0x01 || type === 0x02) {
            const s = readStr(buf, { v: pos }, len2);
            if (!title && s.trim()) title = s.trim();
          }
          pos += len2;
        } else if (status === 0xf0 || status === 0xf7) {
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos);
          pos = lenPos.v;
          pos += len2;
        }
        continue;
      }
      const b = tick / division;
      if (kind === 0x80 || (kind === 0x90 && buf[pos + 1] === 0)) {
        const note = buf[pos]!;
        pos += 2;
        if (chan === 9) continue; // percussion: no piano notes
        const started = on.get(note);
        if (started) {
          on.delete(note);
          notes.push({ midi: note, start: started.start, dur: b - started.start, vel: started.vel });
        }
      } else if (kind === 0x90) {
        const note = buf[pos]!;
        const vel = buf[pos + 1]!;
        pos += 2;
        if (chan !== 9 && vel > 0) on.set(note, { start: b, vel });
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
        pos += 2;
      } else if (kind === 0xc0 || kind === 0xd0) {
        pos += 1;
      }
    }
    // close hanging notes at track end
    for (const [note, s] of on) {
      notes.push({ midi: note, start: s.start, dur: Math.max(0.01, tick / division - s.start), vel: s.vel });
    }
    trackNotes.push(notes);
    if (t === 0) {
      const n = trackNames[trackNames.length - 1];
      if (n && /piano/i.test(n)) trackNames.splice(trackNames.length - 1, 1, n);
    }
  }

  const valid = trackNotes
    .flat()
    .filter((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && Number.isFinite(n.start) && Number.isFinite(n.dur));
  valid.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const tempoBpm = tempos[0]?.bpm ?? 120;
  const durationBeats = valid.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    format,
    division,
    tempoBpm,
    keySig,
    keyMode,
    timeSig,
    notes: valid,
    trackNames: trackNames.filter((n) => n.trim()),
    durationBeats,
    title,
  };
}
