import { Note, ParsedMidi } from "./types.js";

interface ParsedXmlNote extends Note {
  tieStart?: boolean;
  tieStop?: boolean;
  /** Raw MusicXML voice identity used to disambiguate overlapping ties. */
  voiceId?: string;
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Decode the standard XML entities that appear in MusicXML lyrics. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function firstMatch(s: string, re: RegExp): string {
  return s.match(re)?.[1] ?? "";
}

/** Merge tied MusicXML segments back into one playable note. Multiple
 * same-pitch ties can overlap, so keep a FIFO-style queue and match the
 * continuation whose previous segment ends exactly at the current onset. */
function mergeTiedNotes(notes: ParsedXmlNote[], tolerance: number): Note[] {
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
      const index = queue.findIndex((previous) => Math.abs(previous.start + previous.dur - note.start) <= tolerance);
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
 * Minimal MusicXML to notes parser (score-partwise). Handles output from our
 * own writer and common MuseScore/Sibelius exports: measures, divisions,
 * chords, staffs, tempo/key/time attributes.
 */
export function parseMusicXmlNotes(xml: string): ParsedMidi {
  let divisions = 1;
  let minDivisions = Infinity;
  const tempoValues = [
    ...Array.from(xml.matchAll(/<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/gi), match => Number(match[1])),
    ...Array.from(xml.matchAll(/<sound\b[^>]*\btempo\s*=\s*["']([0-9]+(?:\.[0-9]+)?)["']/gi), match => Number(match[1])),
  ];
  const tempo = tempoValues[0] ?? 120;
  const tempoMetaPresent = tempoValues.length > 0;
  if (tempo <= 0 || tempoValues.some(value => Math.abs(value - tempo) > 1e-6)) throw new Error("Unsupported: changing tempo");
  for (const metronome of xml.matchAll(/<metronome\b[^>]*>[\s\S]*?<\/metronome>/g)) {
    if (/<beat-unit-dot\b/.test(metronome[0]) || (/<beat-unit>/.test(metronome[0]) && !/<beat-unit>\s*quarter\s*<\/beat-unit>/.test(metronome[0]))) {
      throw new Error("Unsupported: non-quarter metronome tempo");
    }
  }
  const firstTempo = xml.search(/<per-minute>|<sound\b[^>]*\btempo\s*=/);
  const firstNote = xml.search(/<note\b/);
  if (firstNote >= 0 && firstTempo > firstNote && tempo !== 120) throw new Error("Unsupported: tempo begins after the first note");
  let beats = 4;
  let beatType = 4;
  const fifths = parseInt(firstMatch(xml, /<fifths>(-?\d+)<\/fifths>/), 10) || 0;
  const mode = firstMatch(xml, /<mode>(major|minor)<\/mode>/);
  const notes: ParsedXmlNote[] = [];
  // Reject multiple parts; only single-part piano scores are supported.
  const partMatches = xml.match(/<part(?![-\w])[^>]*>/g) ?? [];
  if (partMatches.length > 1) {
    throw new Error("Unsupported: multiple parts (expected single-part MusicXML)");
  }
  const partBody = xml.match(/<part(?![-\w])[^>]*>([\s\S]*?)<\/part>/)?.[1] ?? xml;
  const measures = partBody.match(/<measure(?=[\s>])[^>]*>[\s\S]*?<\/measure>/g) ?? [];
  let measureStart = 0;
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi]!;
    let cursor = 0;
    let measureEnd = 0;
    let lastStart = 0;
    const els = m.match(/<(note|backup|forward|attributes)\b[^>]*>[\s\S]*?<\/(?:note|backup|forward|attributes)>/g) ?? [];
    for (const el of els) {
      if (el.startsWith("<attributes")) {
        const division = firstMatch(el, /<divisions>\s*([0-9.]+)\s*<\/divisions>/);
        if (division) {
          divisions = Number(division);
          if (!Number.isFinite(divisions) || divisions <= 0) throw new Error("invalid MusicXML divisions");
          minDivisions = Math.min(minDivisions, divisions);
        }
        const time = firstMatch(el, /<time\b[^>]*>([\s\S]*?)<\/time>/);
        if (time) {
          const nextBeats = Number(firstMatch(time, /<beats>\s*(\d+)\s*<\/beats>/));
          const nextType = Number(firstMatch(time, /<beat-type>\s*(\d+)\s*<\/beat-type>/));
          if (!nextBeats || !nextType) throw new Error("Unsupported: compound time signature");
          if ((measureStart > 0 || cursor > 0) && (nextBeats !== beats || nextType !== beatType)) throw new Error("Unsupported: changing time signature");
          beats = nextBeats;
          beatType = nextType;
        }
        continue;
      }
      if (el.startsWith("<backup") || el.startsWith("<forward")) {
        const d = Number(firstMatch(el, /<duration>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/duration>/)) || 0;
        cursor = el.startsWith("<backup")
          ? Math.max(0, cursor - d / divisions)
          : cursor + d / divisions;
        measureEnd = Math.max(measureEnd, cursor);
        continue;
      }
      // Advance cursor for rests without emitting a note.
      if (/<(rest)\b/.test(el)) {
        const dur = Number(firstMatch(el, /<duration>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/duration>/)) || 0;
        const durBeats = dur / divisions;
        if (durBeats > 0) cursor += durBeats;
        measureEnd = Math.max(measureEnd, cursor);
        continue;
      }
      const chord = /<chord\s*\/>/.test(el);
      const step = firstMatch(el, /<step>([A-G])<\/step>/);
      if (!step) continue;
      const alter = parseInt(firstMatch(el, /<alter>(-?\d+)<\/alter>/), 10) || 0;
      const octave = parseInt(firstMatch(el, /<octave>(\d+)<\/octave>/), 10);
      const dur = Number(firstMatch(el, /<duration>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/duration>/)) || 0;
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
        lyrics: lyric ? decodeXmlEntities(lyric) : undefined,
        tieStart,
        tieStop,
        voiceId: voiceRaw || staffRaw || undefined,
      });
      measureEnd = Math.max(measureEnd, cursor, start + durBeats);
    }
    const implicit = /^<measure\b[^>]*(?:implicit\s*=\s*["']yes["']|number\s*=\s*["']0["'])/.test(m);
    const meter = beats * 4 / beatType;
    // Independent onset/duration rounding can overshoot a bar by one division.
    measureStart += implicit ? measureEnd : measureEnd > meter + 1 / divisions + 1e-9 ? measureEnd : meter;
  }
  // A writer may round the onset and duration independently, so a tied
  // segment can end one division tick past its continuation onset.
  const mergedNotes = mergeTiedNotes(notes, 1 / (Number.isFinite(minDivisions) ? minDivisions : divisions) + 1e-9)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  const durationBeats = mergedNotes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    format: 0,
    division: divisions,
    tempoBpm: tempo,
    tempoMetaPresent,
    keySig: fifths,
    keyMode: mode === "minor" ? 1 : 0,
    timeSig: [beats, beatType],
    notes: mergedNotes,
    trackNames: ["MusicXML"],
    durationBeats,
    title: firstMatch(xml, /<work-title>([\s\S]*?)<\/work-title>/),
  };
}
