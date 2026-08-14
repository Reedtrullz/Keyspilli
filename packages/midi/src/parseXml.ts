import { Note, ParsedMidi } from "./types.js";

interface ParsedXmlNote extends Note {
  tieStart?: boolean;
  tieStop?: boolean;
  /** Raw MusicXML voice identity used to disambiguate overlapping ties. */
  voiceId?: string;
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function firstMatch(s: string, re: RegExp): string {
  return s.match(re)?.[1] ?? "";
}

/** Merge tied MusicXML segments back into one playable note. Multiple
 * same-pitch ties can overlap, so keep a FIFO-style queue and match the
 * continuation whose previous segment ends exactly at the current onset. */
function mergeTiedNotes(notes: ParsedXmlNote[]): Note[] {
  // When multiple tied segments share an onset (common for overlapping
  // same-pitch notes rendered as a chord), process the longest segment first.
  // The writer emits continuation segments in descending duration order, so
  // this keeps the queue's exact-end matching aligned with the originating
  // chains instead of letting a short re-attack steal the long sustain.
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi || b.dur - a.dur);
  const chains = new Map<string, ParsedXmlNote[]>();
  const out: ParsedXmlNote[] = [];
  const keyOf = (n: ParsedXmlNote) => n.midi + ":" + (n.hand ?? "R") + ":" + (n.voiceId ?? "");
  for (const note of sorted) {
    const key = keyOf(note);
    const queue = chains.get(key) ?? [];
    let merged = false;
    if (note.tieStop) {
      const index = queue.findIndex((previous) => Math.abs(previous.start + previous.dur - note.start) <= 0.001);
      if (index >= 0) {
        const previous = queue[index]!;
        previous.dur = note.start + note.dur - previous.start;
        if (note.tieStart) queue[index] = previous;
        else queue.splice(index, 1);
        merged = true;
      }
    }
    if (!merged) {
      out.push(note);
      if (note.tieStart) queue.push(note);
    }
    if (queue.length) chains.set(key, queue);
    else chains.delete(key);
  }
  return out.map(({ tieStart: _tieStart, tieStop: _tieStop, voiceId: _voiceId, ...note }) => note);
}

/**
 * Minimal MusicXML → notes parser (score-partwise). Handles output from our
 * own writer and common MuseScore/Sibelius exports: measures, divisions,
 * chords, staffs, tempo/key/time attributes.
 */
export function parseMusicXmlNotes(xml: string): ParsedMidi {
  const divisions = Math.max(1, parseInt(firstMatch(xml, /<divisions>(\d+)<\/divisions>/), 10) || 1);
  const tempo = parseInt(firstMatch(xml, /<per-minute>(\d+)<\/per-minute>/), 10) || 120;
  const beats = parseInt(firstMatch(xml, /<time><beats>(\d+)<\/beats><beat-type>(\d+)<\/beat-type><\/time>/) || firstMatch(xml, /<beats>(\d+)<\/beats>/), 10) || 4;
  const beatType = parseInt(firstMatch(xml, /<beat-type>(\d+)<\/beat-type>/), 10) || 4;
  const fifths = parseInt(firstMatch(xml, /<fifths>(-?\d+)<\/fifths>/), 10) || 0;
  const mode = firstMatch(xml, /<mode>(major|minor)<\/mode>/);
  const notes: ParsedXmlNote[] = [];
  // Parse only the first part; multi-instrument exports are out of scope.
  // ponytail: per-part divisions/attributes unsupported; add when uploads need it.
  const partBody = xml.match(/<part(?![-\w])[^>]*>([\s\S]*?)<\/part>/)?.[1] ?? xml;
  const measures = partBody.match(/<measure(?:[ >])[^>]*>[\s\S]*?<\/measure>/g) ?? [];
  const beatsPerMeasure = beats * (4 / beatType);
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi]!;
    const measureStart = mi * beatsPerMeasure;
    let cursor = 0;
    let lastStart = 0;
    const els = m.match(/<(note|backup|forward)\b[^>]*>[\s\S]*?<\/(?:note|backup|forward)>/g) ?? [];
    for (const el of els) {
      if (el.startsWith("<backup") || el.startsWith("<forward")) {
        const d = parseInt(firstMatch(el, /<duration>(\d+)<\/duration>/), 10) || 0;
        cursor = el.startsWith("<backup")
          ? Math.max(0, cursor - d / divisions)
          : cursor + d / divisions;
        continue;
      }
      const chord = /<chord\s*\/>/.test(el);
      const step = firstMatch(el, /<step>([A-G])<\/step>/);
      if (!step) continue;
      const alter = parseInt(firstMatch(el, /<alter>(-?\d+)<\/alter>/), 10) || 0;
      const octave = parseInt(firstMatch(el, /<octave>(\d+)<\/octave>/), 10);
      const dur = parseInt(firstMatch(el, /<duration>(\d+)<\/duration>/), 10) || 0;
      const staffRaw = firstMatch(el, /<staff>(\d+)<\/staff>/);
      const voiceRaw = firstMatch(el, /<voice>(\d+)<\/voice>/);
      const pc = STEP_PC[step]! + alter;
      const midi = 12 * (octave + 1) + pc;
      const durBeats = dur / divisions;
      if (!Number.isFinite(midi) || midi < 0 || midi > 127 || !Number.isFinite(durBeats) || durBeats <= 0) continue;
      const start = chord ? lastStart : (lastStart = cursor);
      if (!chord) cursor += durBeats;
      const lyric = firstMatch(el, /<lyric\b[^>]*>[\s\S]*?<text>([\s\S]*?)<\/text>/);
      // MusicXML may encode ties both as <tie> and as notation-level
      // <tied>; some exporters use type="continue" for a middle segment.
      // Treat continue as both stop and start so arbitrarily long chains
      // reconstruct to one playable note.
      const tieStart = /<(?:tie|tied)\b[^>]*type\s*=\s*["'](?:start|continue)["']/i.test(el);
      const tieStop = /<(?:tie|tied)\b[^>]*type\s*=\s*["'](?:stop|continue)["']/i.test(el);
      notes.push({
        midi,
        start: measureStart + start,
        dur: durBeats,
        vel: 80,
        hand: staffRaw === "2" ? "L" : staffRaw === "1" ? "R" : voiceRaw === "2" ? "L" : "R",
        lyrics: lyric ? lyric.replace(/&amp;/g, "&").replace(/&lt;/g, "<") : undefined,
        tieStart,
        tieStop,
        voiceId: voiceRaw || staffRaw || undefined,
      });
    }
  }
  const mergedNotes = mergeTiedNotes(notes).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const durationBeats = mergedNotes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    format: 0,
    division: divisions,
    tempoBpm: tempo,
    keySig: fifths,
    keyMode: mode === "minor" ? 1 : 0,
    timeSig: [beats, beatType],
    notes: mergedNotes,
    trackNames: ["MusicXML"],
    durationBeats,
    title: firstMatch(xml, /<work-title>([\s\S]*?)<\/work-title>/),
  };
}
