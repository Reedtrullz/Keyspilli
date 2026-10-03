import {SOURCE_OCCURRENCES,readSourceOccurrences} from "./source-occurrences.js";
import {validSourcePedal} from "./source-pedal.js";
import { sectionsFromMarkers } from "./source-sections.js";
import { tutorialSourceLane } from "./source-hand-lanes.js";
import { Hand, MidiTempoEvent, MidiTimeSignatureEvent, Note, ParsedMidi } from "./types.js";

const MAX_TIME_SIGNATURE_EVENTS = 4096;

function inferTrackHand(names: string[]): Hand | undefined {
  const text = names.join(" ").toLowerCase();
  // Only use unambiguous staff/voice labels. Generic track names such as
  // "piano" or "melody" should still go through the pitch-based splitter.
  if (/\b(?:left\s*hand|lh|bass|lower)\b/.test(text)) return "L";
  if (/\b(?:right\s*hand|rh|treble|upper)\b/.test(text)) return "R";
  return undefined;
}

function inferTrackIdentitySource(names: string[]): Note["identitySource"] {
  const text = names.join(" ").toLowerCase();
  if (/\bvocals?\b/.test(text)) return "vocals";
  if (/\bguitars?\b/.test(text)) return "guitar";
  if (/\bother\b/.test(text)) return "other";
  return undefined;
}

function readVarint(data: Uint8Array, pos: { v: number }, end: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (pos.v >= end) throw new Error(`truncated MIDI varint at pos=${pos.v}`);
    const b = data[pos.v++]!;
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) return value;
  }
  throw new Error(`invalid MIDI varint at pos=${pos.v}`);
}

function readStr(data: Uint8Array, pos: { v: number }, len: number, end?: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    if (end !== undefined && pos.v >= end) throw new Error(`truncated MIDI string at pos=${pos.v}`);
    s += String.fromCharCode(data[pos.v++]!);
  }
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
  if (format !== 0 && format !== 1) throw new Error(`unsupported MIDI format ${format} (only format 0/1 supported)`);
  if (format === 0 && ntrks !== 1) throw new Error("MIDI format 0 must have one track");
  if (division & 0x8000) throw new Error("SMPTE timing not supported");
  if (division === 0) throw new Error("invalid MIDI division: must be positive");
  if (ntrks === 0 || ntrks > 512) throw new Error("invalid track count");
  let pos = 8 + headerLen;

  const trackNotes: Note[][] = [];
  const trackNames: string[] = [];
  const sourceParts: ParsedMidi["sourceParts"] = [];
  const unsupportedControls = new Set<string>();
  const tempos: MidiTempoEvent[] = [];
  const timeSigEvents: MidiTimeSignatureEvent[] = [];
  let timeSig: [number, number] = [4, 4];
  let keySig = 0;
  let keyMode: 0 | 1 = 0;
  let title: string | undefined;
  const pedalChanges: NonNullable<ParsedMidi["sourcePedal"]>["changes"] = [];
  let fileEndBeat=0;
  let occurrences:ParsedMidi["notationMeasures"];
  const sectionMarkers: Array<{beat:number;label:string}> = [];

  for (let t = 0; t < ntrks; t++) {
    if (pos + 8 > buf.length || readStr(buf, { v: pos }, 4, buf.length) !== "MTrk") throw new Error("bad track header");
    pos += 4;
    const len = (buf[pos]! << 24) | (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!;
    pos += 4;
    if (len < 0 || pos + len > buf.length) throw new Error("truncated track");
    const end = pos + len;
    let tick = 0;
    let running: number | null = null;
    const namesInTrack: string[] = [];
    let trackName = "";
    let percussion = false;
    let percussionNoteCount = 0;
    // MIDI does not carry a note identity on note-off events. Keep a FIFO
    // queue per (channel,pitch). The writer allocates separate channels for
    // overlapping same-pitch intervals, which makes even nested re-strikes
    // unambiguous instead of guessing which note an off event belongs to.
    const on: Map<string, { midi: number; start: number; vel: number }[]> = new Map();
    const notes: Note[] = [];

    while (pos < end) {
      const deltaPos = { v: pos };
      tick += readVarint(buf, deltaPos, end);
      pos = deltaPos.v;
      if (pos >= end) throw new Error(`truncated MIDI event at pos=${pos}`);
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
          if (pos >= end) throw new Error(`truncated MIDI meta at pos=${pos}`);
          const type = buf[pos++]!;
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos, end);
          pos = lenPos.v;
          if (pos + len2 > end) throw new Error(`truncated MIDI meta payload at pos=${pos} len=${len2} end=${end}`);
          if (type === 0x51 && len2 === 3) {
            const us = (buf[pos]! << 16) | (buf[pos + 1]! << 8) | buf[pos + 2]!;
            if (us > 0) tempos.push({ tick, beat: tick / division, microsecondsPerQuarter: us, bpm: 60_000_000 / us });
          } else if (type === 0x58 && len2 === 4) {
            const numerator = buf[pos]!;
            const denominatorExponent = buf[pos + 1]!;
            if (numerator <= 0 || denominatorExponent >= 31) throw new Error("invalid MIDI time signature");
            timeSig = [numerator, 1 << denominatorExponent];
            if (timeSigEvents.length >= MAX_TIME_SIGNATURE_EVENTS) throw new Error("too many MIDI time-signature events");
            timeSigEvents.push({ tick, beat: tick / division, timeSig: [...timeSig] });
          } else if (type === 0x59 && len2 === 2) {
            keySig = (buf[pos]! << 24) >> 24;
            keyMode = buf[pos + 1]! === 0 ? 0 : 1;
          } else if (type === 0x03) {
            const name = readStr(buf, { v: pos }, len2);
            if (name.trim()) {
              trackName ||= name.trim();
              namesInTrack.push(name);
              trackNames.push(name);
            }
          } else if (type === 0x7f) {
            const prefix=readStr(buf,{v:pos},Math.min(len2,SOURCE_OCCURRENCES.length+1));
            if (prefix===`${SOURCE_OCCURRENCES}:` && len2>262144)throw new Error("source occurrence map exceeds bounds");
            const payload=len2<=262144?readStr(buf,{v:pos},len2):"";
            if(payload.startsWith(`${SOURCE_OCCURRENCES}:`)){
              if(occurrences || tick!==0)throw new Error("ambiguous source occurrence map");
              occurrences=readSourceOccurrences(payload.slice(SOURCE_OCCURRENCES.length+1));
            }
          } else if ((type === 0x06 || type === 0x07) && len2 <= 160) {
            if(sectionMarkers.length<4097) sectionMarkers.push({beat:tick/division,label:new TextDecoder().decode(buf.subarray(pos,pos+len2))});
          } else if (type === 0x01 || type === 0x02) {
            const s = readStr(buf, { v: pos }, len2);
            if (!title && s.trim()) title = s.trim();
          }
          pos += len2;
        } else if (status === 0xf0 || status === 0xf7) {
          const lenPos = { v: pos };
          const len2 = readVarint(buf, lenPos, end);
          pos = lenPos.v;
          if (pos + len2 > end) throw new Error(`truncated MIDI sysex payload at pos=${pos} len=${len2} end=${end}`);
          pos += len2;
        } else if (status === 0xf1 || status === 0xf3) {
          if (pos + 1 > end) throw new Error(`truncated MIDI system-common message at pos=${pos}`);
          pos += 1;
        } else if (status === 0xf2) {
          if (pos + 2 > end) throw new Error(`truncated MIDI system-common message at pos=${pos}`);
          pos += 2;
        }
        continue;
      }
      const b = tick / division;
      if (pos + 2 > end && (kind === 0x80 || kind === 0x90 || kind === 0xa0 || kind === 0xb0 || kind === 0xe0)) {
        throw new Error(`truncated MIDI channel message at pos=${pos} kind=0x${kind.toString(16)}`);
      }
      if (kind === 0xc0 || kind === 0xd0) {
        if (pos + 1 > end) throw new Error(`truncated MIDI channel message at pos=${pos} kind=0x${kind.toString(16)}`);
      }
      if (kind === 0x80 || (kind === 0x90 && buf[pos + 1] === 0)) {
        const note = buf[pos]!;
        pos += 2;
        if (chan === 9) continue; // percussion: no piano notes
        const key = `${chan}:${note}`;
        const started = on.get(key);
        if (started?.length) {
          const active = started.shift()!;
          if (started.length === 0) on.delete(key);
          notes.push({ midi: note, start: active.start, dur: b - active.start, vel: active.vel, sourceMidiChannel:chan });
        }
      } else if (kind === 0x90) {
        const note = buf[pos]!;
        const vel = buf[pos + 1]!;
        pos += 2;
        if (chan === 9 && vel > 0) { percussion = true; percussionNoteCount++; }
        if (chan !== 9 && vel > 0) {
          const key = `${chan}:${note}`;
          const active = on.get(key) ?? [];
          active.push({ midi: note, start: b, vel });
          on.set(key, active);
        }
      } else if (kind === 0xb0 && buf[pos] === 64) {
        if(pedalChanges.length>=4096 || buf[pos+1]!>127)throw new Error("Invalid or excessive source CC64 events");
        pedalChanges.push({beat:b,channel:chan,value:buf[pos+1]!,source:`midi:${t}`});pos+=2;
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xe0) {
        unsupportedControls.add(kind === 0xa0 ? "polyphonic aftertouch" : kind === 0xb0 ? "control changes" : "pitch bend");
        pos += 2;
      } else if (kind === 0xc0 || kind === 0xd0) {
        unsupportedControls.add(kind === 0xc0 ? "program changes" : "channel aftertouch");
        pos += 1;
      }
    }
    // close hanging notes at track end
    fileEndBeat=Math.max(fileEndBeat,tick/division);
    for (const [key,active] of on) {
      for (const s of active) {
        notes.push({ midi: s.midi, start: s.start, dur: Math.max(0.01, tick / division - s.start), vel: s.vel, sourceMidiChannel:Number(key.split(":")[0]) });
      }
    }
    const hand = inferTrackHand(namesInTrack);
    const identitySource = inferTrackIdentitySource(namesInTrack);
    const sourceLane = namesInTrack.length === 1 ? tutorialSourceLane(namesInTrack[0]!) : undefined;
    const partId = `midi:${t}`;
    trackNotes.push(notes.map((n, index) => ({ ...n,
      sourceOrigins: [{ id: `${partId}:${index}`, part: partId, track: t }],
      ...(hand ? { hand } : {}), ...(identitySource ? { identitySource } : {}), ...(sourceLane ? { sourceLane } : {}),
    })));
    if (trackName || notes.length || percussion) {
      const pitches = notes.map((note) => note.midi);
      sourceParts!.push({
        id: partId,
        name: trackName || `Track ${t + 1}`,
        noteCount: notes.length + percussionNoteCount,
        lowMidi: pitches.length ? Math.min(...pitches) : null,
        highMidi: pitches.length ? Math.max(...pitches) : null,
        startBeat: notes.length ? Math.min(...notes.map((note) => note.start)) : null,
        endBeat: notes.length ? Math.max(...notes.map((note) => note.start + note.dur)) : null,
        ...(percussion ? { percussion: true } : {}),
      });
    }
  }

  const valid = trackNotes
    .flat()
    .filter((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && Number.isFinite(n.start) && Number.isFinite(n.dur));

  // Some exported arrangements duplicate a single staff name on every track
  // (for example, both tracks may be called "Pianl LH" even though one is the
  // upper staff).  Treat that as contradictory metadata only when every
  // non-empty track claims the same hand and their pitch centres are clearly
  // separated.  Genuine cross-handed imports keep their explicit labels.
  const nonEmptyTracks = trackNotes.filter((notes) => notes.length > 0);
  const explicitHands = new Set(nonEmptyTracks.flatMap((notes) => notes.map((n) => n.hand).filter((h): h is Hand => h !== undefined)));
  const allTracksExplicit = nonEmptyTracks.every((notes) => notes.every((n) => n.hand !== undefined));
  if (nonEmptyTracks.length >= 2 && allTracksExplicit && explicitHands.size === 1) {
    const medians = nonEmptyTracks.map((notes) => {
      const pitches = notes.map((n) => n.midi).sort((a, b) => a - b);
      return pitches[Math.floor(pitches.length / 2)]!;
    });
    const minMedian = Math.min(...medians);
    const maxMedian = Math.max(...medians);
    if (maxMedian - minMedian >= 12) {
      const splitAt = (minMedian + maxMedian) / 2;
      for (const notes of nonEmptyTracks) {
        const median = notes.map((n) => n.midi).sort((a, b) => a - b)[Math.floor(notes.length / 2)]!;
        const inferred: Hand = median <= splitAt ? "L" : "R";
        for (const note of notes) note.hand = inferred;
      }
    }
  }
  valid.sort((a, b) => a.start - b.start || a.midi - b.midi);
  if(!pedalChanges.length)for(const note of valid)delete note.sourceMidiChannel;
  const sourcePedal=pedalChanges.length ? {version:1 as const,endBeat:fileEndBeat,provenance:"midi-file" as const,changes:pedalChanges.sort((a,b)=>a.beat-b.beat)} : undefined;
  if(sourcePedal && !validSourcePedal(sourcePedal))throw new Error("Invalid or ambiguous source CC64 timeline");
  const tempoBpm = tempos.find((event) => event.tick === 0)?.bpm ?? 120;
  const durationBeats = valid.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const sections=sectionsFromMarkers(sectionMarkers,durationBeats);
  if(occurrences && durationBeats>occurrences.at(-1)!.endBeat+1/division+1e-9)throw new Error("source occurrence map differs from MIDI");
  return {
    format,
    ...(sections.length ? {sections} : {}),
    division,
    tempoBpm,
    tempoMetaPresent: tempos.length > 0,
    ...(tempos.length ? { tempoEvents: tempos.sort((a, b) => a.tick - b.tick || a.microsecondsPerQuarter - b.microsecondsPerQuarter) } : {}),
    ...(timeSigEvents.length ? { timeSigEvents: timeSigEvents.sort((a, b) => a.tick - b.tick || a.timeSig[0] - b.timeSig[0] || a.timeSig[1] - b.timeSig[1]) } : {}),
    keySig,
    keyMode,
    timeSig,
    notes: valid,
    trackNames: trackNames.filter((n) => n.trim()),
    sourceParts,
    ...(unsupportedControls.size ? { unsupportedControls: [...unsupportedControls].sort() } : {}),
    durationBeats:Math.max(durationBeats,occurrences?.at(-1)?.endBeat ?? 0,sourcePedal?.endBeat ?? 0),
    ...(sourcePedal?{sourcePedal}:{}),
    ...(occurrences?{notationMeasures:occurrences,repeatPlayback:"declared" as const}:{}),
    title,
  };
}

/** Convert a non-negative source MIDI tick to native elapsed seconds. */
export function midiTickToNativeSeconds(
  parsed: Pick<ParsedMidi, "division" | "tempoBpm" | "tempoEvents">,
  tick: number,
): number {
  if (!Number.isFinite(tick) || tick < 0 || !Number.isFinite(parsed.division) || parsed.division <= 0) return Number.NaN;
  const events = (parsed.tempoEvents ?? [])
    .filter((event) => Number.isFinite(event.tick) && event.tick >= 0 && Number.isFinite(event.microsecondsPerQuarter) && event.microsecondsPerQuarter > 0)
    .slice()
    .sort((left, right) => left.tick - right.tick || left.microsecondsPerQuarter - right.microsecondsPerQuarter);
  // MIDI's default tempo is 120 BPM until the first tempo event.  A source
  // may place its first Set Tempo event after beat zero, so do not use that
  // later tempo for the preceding interval.
  const firstAtZero = events.find((event) => event.tick === 0);
  let currentUs = firstAtZero
    ? firstAtZero.microsecondsPerQuarter
    : events.length
      ? 500_000
      : Number.isFinite(parsed.tempoBpm) && parsed.tempoBpm > 0 ? 60_000_000 / parsed.tempoBpm : 500_000;
  let previousTick = 0;
  let seconds = 0;
  for (const event of events) {
    if (event.tick > tick) break;
    seconds += ((event.tick - previousTick) / parsed.division) * currentUs / 1_000_000;
    previousTick = event.tick;
    currentUs = event.microsecondsPerQuarter;
  }
  return seconds + ((tick - previousTick) / parsed.division) * currentUs / 1_000_000;
}

/** Convert a symbolic quarter-note beat to native MIDI seconds. */
export function midiBeatToNativeSeconds(
  parsed: Pick<ParsedMidi, "division" | "tempoBpm" | "tempoEvents">,
  beat: number,
): number {
  return midiTickToNativeSeconds(parsed, beat * parsed.division);
}
