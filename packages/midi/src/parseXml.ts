import { Note, ParsedMidi } from "./types.js";

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function firstMatch(s: string, re: RegExp): string {
  return s.match(re)?.[1] ?? "";
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
  const notes: Note[] = [];
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
      notes.push({
        midi,
        start: measureStart + start,
        dur: durBeats,
        vel: 80,
        hand: staffRaw === "2" ? "L" : staffRaw === "1" ? "R" : voiceRaw === "2" ? "L" : "R",
        lyrics: lyric ? lyric.replace(/&amp;/g, "&").replace(/&lt;/g, "<") : undefined,
      });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const durationBeats = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    format: 0,
    division: divisions,
    tempoBpm: tempo,
    keySig: fifths,
    keyMode: mode === "minor" ? 1 : 0,
    timeSig: [beats, beatType],
    notes,
    trackNames: ["MusicXML"],
    durationBeats,
    title: firstMatch(xml, /<work-title>([\s\S]*?)<\/work-title>/),
  };
}
