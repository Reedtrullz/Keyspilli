import {SOURCE_PEDAL,readSourcePedal} from "./source-pedal.js";
import {SOURCE_OCCURRENCES,readSourceOccurrences} from "./source-occurrences.js";
import { sectionsFromMarkers } from "./source-sections.js";
import { MidiTimeSignatureEvent, Note, ParsedMidi } from "./types.js";
import { mergedNoteLineage } from "./quantize.js";

interface ParsedXmlNote extends Note {
  tieStart?: boolean;
  tieStop?: boolean;
  /** Raw MusicXML voice identity used to disambiguate overlapping ties. */
  voiceId?: string;
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function xmlAttribute(attributes: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`))?.[2] ?? "";
}

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

/** Validate the MusicXML subset before regex extraction can mistake comments for music. */
function cleanMusicXml(xml: string): string {
  const stack: string[] = [];
  let roots = 0;
  let clean = "";
  for (let pos = 0; pos < xml.length;) {
    const open = xml.indexOf("<", pos);
    const text = xml.slice(pos, open < 0 ? xml.length : open);
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) throw new Error("invalid MusicXML entity");
    if (!stack.length && text.trim()) throw new Error("invalid MusicXML text outside document");
    clean += text;
    if (open < 0) break;
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0 || xml.slice(open + 4, end).includes("--")) throw new Error("invalid MusicXML comment");
      clean += " ";
      pos = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open + 2);
      if (end < 0) throw new Error("invalid MusicXML processing instruction");
      pos = end + 2;
      continue;
    }
    if (xml.startsWith("<!", open)) throw new Error("unsupported MusicXML declaration");
    let end = open + 1;
    let quote = "";
    for (; end < xml.length; end++) {
      const char = xml[end]!;
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end >= xml.length) throw new Error("invalid MusicXML tag");
    const tag = xml.slice(open, end + 1);
    const match = tag.match(/^<(\/?)([A-Za-z_][\w:.-]*)\b/);
    if (!match) throw new Error("invalid MusicXML tag");
    const name = match[2]!;
    if (match[1]) {
      if (!/^<\/[A-Za-z_][\w:.-]*\s*>$/.test(tag) || stack.pop() !== name) throw new Error("invalid MusicXML closing tag");
    } else {
      if (!stack.length) {
        if (name !== "score-partwise" || ++roots !== 1) throw new Error("invalid MusicXML document root");
      }
      const suffix = tag.match(/\/\s*>$/)?.[0] ?? ">";
      let attributes = tag.slice(match[0].length, tag.length - suffix.length);
      while (attributes.trim()) {
        const attr = attributes.match(/^\s+([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([^<]*?)\2/);
        if (!attr || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(attr[3]!)) throw new Error("invalid MusicXML attribute");
        attributes = attributes.slice(attr[0].length);
      }
      if (!/\/\s*>$/.test(tag)) stack.push(name);
    }
    clean += tag;
    pos = end + 1;
  }
  if (stack.length || roots !== 1 || !/^\s*<score-partwise\b/.test(clean) || !/<\/score-partwise>\s*$/.test(clean)) {
    throw new Error("invalid MusicXML document");
  }
  return clean;
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
        Object.assign(previous, mergedNoteLineage(previous, note));
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

/** ponytail: only a full-bar, constant-state, explicit two-pass repeat at the
 * beginning of one part. Keep every other form rejected until independently checked. */
function repeatOrder(xml: string, measures: string[]): { index: number; occurrence: 1 | 2 }[] | null {
  if (!/<(?:repeat|ending)\b/i.test(xml)) return null;
  const fail = () => { throw new Error("Unsupported MusicXML repeat or ending playback order"); };
  if (/<(?:ending|tie|tied|grace|transpose)\b/i.test(xml) || measures.some(m=>/^<measure\b[^>]*(?:implicit\s*=\s*["']yes["']|number\s*=\s*["']0["'])/.test(m))) fail();
  const repeats=[...xml.matchAll(/<repeat\b([^>]*?)\/\s*>/g)];
  if (repeats.length!==2 || [...xml.matchAll(/<repeat\b/g)].length!==2 || measures.length>2048) fail();
  if (!measures.length) fail();
  const forward=repeats[0]!, backward=repeats[1]!;
  for (const repeat of repeats) if (repeat[1]!.replace(/\b(?:direction|times)\s*=\s*(["']).*?\1/g, "").trim()) fail();
  if (xmlAttribute(forward[1]!,"direction")!=="forward" || xmlAttribute(forward[1]!,"times") || xmlAttribute(backward[1]!,"direction")!=="backward" || !["","2"].includes(xmlAttribute(backward[1]!,"times"))) fail();
  const last=measures.findIndex(m=>m.includes(backward[0]));
  if (!measures[0]?.includes(forward[0]) || last<0 || !/<barline\b[^>]*location\s*=\s*["']left["'][^>]*>\s*<repeat\b/.test(measures[0]) || !/<barline\b[^>]*location\s*=\s*["']right["'][^>]*>\s*<repeat\b/.test(measures[last]!)) fail();
  if (measures[0]!.indexOf(forward[0]) > measures[0]!.indexOf("<note") || measures[last]!.lastIndexOf("</note>") > measures[last]!.indexOf(backward[0])) fail();
  const attributes=[...measures[0]!.matchAll(/<attributes\b[^>]*>([\s\S]*?)<\/attributes>/g)];
  if (measures[0]!.indexOf("<attributes") > measures[0]!.indexOf("<note")) fail();
  if (attributes.length!==1 || !/<divisions>/.test(attributes[0]![1]!) || !/<time\b/.test(attributes[0]![1]!) || measures.slice(1).some(m=>/<attributes\b/.test(m))) fail();
  const order: {index:number;occurrence:1|2}[]=[];
  for (const occurrence of [1,2] as const) for(let index=0;index<=last;index++) order.push({index,occurrence});
  for(let index=last+1;index<measures.length;index++) order.push({index,occurrence:1});
  if(order.length>2048) throw new Error("repeat source workload exceeds supported limits");
  return order;
}

/**
 * Minimal MusicXML to notes parser (score-partwise). Handles output from our
 * own writer and common MuseScore/Sibelius exports: measures, divisions,
 * chords, staffs, tempo/key/time attributes.
 */
export function parseMusicXmlNotes(xml: string): ParsedMidi {
  if (xml.length > 8 * 1024 * 1024) throw new Error("MusicXML source workload exceeds supported limits");
  const clean = cleanMusicXml(xml);
  const partNodes = [...clean.matchAll(/<part(?![-\w])([^>]*)>[\s\S]*?<\/part>/g)];
  const partNames = new Map<string, string>();
  for (const match of clean.matchAll(/<score-part\b([^>]*)>([\s\S]*?)<\/score-part>/g)) {
    const id = xmlAttribute(match[1]!, "id");
    const name = firstMatch(match[2]!, /<part-name>([\s\S]*?)<\/part-name>/);
    if (id) partNames.set(id, name ? decodeXmlEntities(name) : id);
  }
  if (partNodes.length > 1) {
    if (/<(?:repeat|ending)\b/i.test(clean)) throw new Error("Unsupported MusicXML multipart repeat playback order");
    const sourceMarkers:Array<{beat:number;label:string}>=[];
    const parsedParts = partNodes.map((partMatch, index) => {
      const id = xmlAttribute(partMatch[1]!, "id") || `part-${index + 1}`;
      const name = partNames.get(id) ?? id;
      const singlePart = clean.replace(/<part(?![-\w])[^>]*>[\s\S]*?<\/part>/g, (candidate) => candidate === partMatch[0] ? candidate : "");
      return { parsed: parseSingleMusicXmlNotes(singlePart, { id: `musicxml:${id}`, name }, sourceMarkers), id, name };
    });
    const signatureByBeat = new Map<number, [number, number]>();
    for (const { parsed } of parsedParts) {
      for (const event of parsed.timeSigEvents ?? []) {
        const previous = signatureByBeat.get(event.beat);
        if (previous && (previous[0] !== event.timeSig[0] || previous[1] !== event.timeSig[1])) {
          throw new Error("Unsupported: conflicting MusicXML part time signatures");
        }
        signatureByBeat.set(event.beat, [...event.timeSig]);
      }
    }
    const first = parsedParts[0]!.parsed;
    const timeSigEvents = [...signatureByBeat]
      .sort(([left], [right]) => left - right)
      .map(([beat, timeSig]) => ({ beat, timeSig, tick: Math.round(beat * first.division) }));
    const notes = parsedParts.flatMap(({ parsed }) => parsed.notes).sort((a, b) => a.start - b.start || a.midi - b.midi);
    const sections=sectionsFromMarkers(sourceMarkers,notes.reduce((end,n)=>Math.max(end,n.start+n.dur),0));
    return {
      ...first,
      sections,
      notes,
      trackNames: parsedParts.map(({ name }) => name),
      sourceParts: parsedParts.map(({ parsed, id, name }) => ({
        id: `musicxml:${id}`,
        name,
        noteCount: parsed.notes.length,
        lowMidi: parsed.notes.length ? Math.min(...parsed.notes.map((note) => note.midi)) : null,
        highMidi: parsed.notes.length ? Math.max(...parsed.notes.map((note) => note.midi)) : null,
        startBeat: parsed.notes.length ? Math.min(...parsed.notes.map((note) => note.start)) : null,
        endBeat: parsed.notes.length ? Math.max(...parsed.notes.map((note) => note.start + note.dur)) : null,
      })),
      durationBeats: notes.reduce((end, note) => Math.max(end, note.start + note.dur), 0),
      ...(timeSigEvents.length ? { timeSigEvents } : {}),
    };
  }
  const node = partNodes[0];
  const id = node ? xmlAttribute(node[1]!, "id") || "part-1" : "part-1";
  return parseSingleMusicXmlNotes(clean, { id: `musicxml:${id}`, name: partNames.get(id) ?? "MusicXML" });
}

function parseSingleMusicXmlNotes(xml: string, sourcePart: { id: string; name: string }, markerCollector?:Array<{beat:number;label:string}>): ParsedMidi {
  xml = cleanMusicXml(xml);
  if (/<(?:segno|coda|dalsegno|dacapo|tocoda|fine)\b|\b(?:dalsegno|dacapo|tocoda|fine)\s*=/i.test(xml)) {
    throw new Error("Unsupported MusicXML navigation playback order");
  }
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
  const timeSigEvents: MidiTimeSignatureEvent[] = [];
  const notationMeasures: NonNullable<ParsedMidi["notationMeasures"]> = [];
  const fifths = parseInt(firstMatch(xml, /<fifths>(-?\d+)<\/fifths>/), 10) || 0;
  const mode = firstMatch(xml, /<mode>(major|minor)<\/mode>/);
  const notes: ParsedXmlNote[] = [];
  const sectionMarkers:Array<{beat:number;label:string}>=[];
  // This helper receives one isolated source part; the public parser handles
  // named multi-part MusicXML above before selecting this part's body.
  const partMatches = xml.match(/<part(?![-\w])[^>]*>/g) ?? [];
  if (partMatches.length > 1) {
    throw new Error("Unsupported: multiple parts (expected single-part MusicXML)");
  }
  const partBody = xml.match(/<part(?![-\w])[^>]*>([\s\S]*?)<\/part>/)?.[1] ?? xml;
  const measures = partBody.match(/<measure(?=[\s>])[^>]*>[\s\S]*?<\/measure>/g) ?? [];
  const order = repeatOrder(xml, measures);
  const playback = order ?? measures.map((_,index)=>({index,occurrence:1 as const}));
  let measureStart = 0;
  for (let mi = 0; mi < playback.length; mi++) {
    const occurrence = playback[mi]!;
    const m = measures[occurrence.index]!;
    let sourceNoteIndex = 0;
    let cursor = 0;
    let measureEnd = 0;
    let lastStart = 0;
    const els = m.match(/<(note|backup|forward|attributes|direction)\b[^>]*>[\s\S]*?<\/(?:note|backup|forward|attributes|direction)>/g) ?? [];
    for (const el of els) {
      if(el.startsWith("<direction")) {
        const offset=Number(firstMatch(el,/<offset\b[^>]*>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*<\/offset>/))||0;
        for(const match of el.matchAll(/<(?:rehearsal|words)\b[^>]*>([^<]*)<\/(?:rehearsal|words)>/g)) {
          if(sectionMarkers.length<4097) sectionMarkers.push({beat:measureStart+cursor+offset/divisions,label:decodeXmlEntities(match[1]!)});
        }
        continue;
      }
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
          if (cursor > 0 && (nextBeats !== beats || nextType !== beatType)) throw new Error("Unsupported: changing time signature mid-measure");
          if (!timeSigEvents.length || timeSigEvents[timeSigEvents.length - 1]!.beat !== measureStart
            || timeSigEvents[timeSigEvents.length - 1]!.timeSig[0] !== nextBeats
            || timeSigEvents[timeSigEvents.length - 1]!.timeSig[1] !== nextType) {
            timeSigEvents.push({
              tick: Math.round(measureStart * divisions),
              beat: measureStart,
              timeSig: [nextBeats, nextType],
            });
          }
          beats = nextBeats;
          beatType = nextType;
        }
        continue;
      }
      if (el.startsWith("<backup") || el.startsWith("<forward")) {
        const d = Number(firstMatch(el, /<duration>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/duration>/)) || 0;
        if (order && el.startsWith("<backup") && cursor < d / divisions - 1e-9) throw new Error("Unsupported MusicXML repeat negative cursor");
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
      const octave = parseInt(firstMatch(el, /<octave>(-?\d+)<\/octave>/), 10);
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
      const noteIndex = notes.length;
      const originalId = `${sourcePart.id}:measure:${occurrence.index}:note:${sourceNoteIndex++}`;
      if (order && notes.length >= 20_000) throw new Error("repeat source workload exceeds supported limits");
      notes.push({
        midi,
        ...(Number.isInteger(alter) && alter >= -2 && alter <= 2 && Number.isInteger(octave) && octave >= -1 && octave <= 9
          ? { sourcePitch: { step: step as "A" | "B" | "C" | "D" | "E" | "F" | "G", alter: alter as -2 | -1 | 0 | 1 | 2, octave: octave as -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } }
          : {}),
        start: measureStart + start,
        dur: durBeats,
        vel: 80,
        hand: staffRaw === "2" ? "L" : staffRaw === "1" ? "R" : voiceRaw === "2" ? "L" : "R",
        lyrics: lyric ? decodeXmlEntities(lyric) : undefined,
        tieStart,
        tieStop,
        voiceId: voiceRaw || staffRaw || undefined,
        sourceOrigins: [{ id: order ? `${originalId}:occurrence:${occurrence.occurrence}` : `${sourcePart.id}:${staffRaw || "?"}:${voiceRaw || "?"}:${noteIndex}`, part: sourcePart.id,
          ...(order ? {originalId,measureIndex:occurrence.index,occurrence:occurrence.occurrence} : {}),
          ...(staffRaw ? { staff: staffRaw } : {}), ...(voiceRaw ? { voice: voiceRaw } : {}) }],
      });
      measureEnd = Math.max(measureEnd, cursor, start + durBeats);
    }
    const implicit = /^<measure\b[^>]*(?:implicit\s*=\s*["']yes["']|number\s*=\s*["']0["'])/.test(m);
    const meter = beats * 4 / beatType;
    // Independent onset/duration rounding can overshoot a bar by one division.
    // Clamp that format quantization back to the declared meter, while still
    // honoring an explicitly padded short measure before a meter change.
    const roundingTolerance = 2 / divisions + 1e-9;
    const nextTime = firstMatch(measures[playback[mi + 1]?.index ?? -1] ?? "", /<time\b[^>]*>([\s\S]*?)<\/time>/);
    const nextBeats = nextTime ? Number(firstMatch(nextTime, /<beats>\s*(\d+)\s*<\/beats>/)) : beats;
    const nextType = nextTime ? Number(firstMatch(nextTime, /<beat-type>\s*(\d+)\s*<\/beat-type>/)) : beatType;
    const meterChangesNext = Boolean(nextTime) && (nextBeats !== beats || nextType !== beatType);
    const explicitShortMeasure = measureEnd < meter - roundingTolerance && meterChangesNext;
    const length = implicit || explicitShortMeasure || measureEnd > meter + roundingTolerance ? measureEnd : meter;
    if (order && Math.abs(measureEnd - meter) > 1e-9) throw new Error("Unsupported MusicXML repeat: full bars required");
    if (order && (measureStart + length > 4096 || Math.ceil((measureStart + length)/.25)*notes.length > 200_000_000)) throw new Error("repeat source workload exceeds supported limits");
    notationMeasures.push({ index: mi, startBeat: measureStart, endBeat: measureStart + length, ...(order ? {sourceMeasureIndex:occurrence.index,sourceOccurrence:occurrence.occurrence} : {}) });
    measureStart += length;
  }
  // A writer may round the onset and duration independently, so a tied
  // segment can end one division tick past its continuation onset.
  const mergedNotes = mergeTiedNotes(notes, 2 / (Number.isFinite(minDivisions) ? minDivisions : divisions) + 1e-9)
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  const metadata=[...xml.matchAll(/<miscellaneous-field\b([^>]*)>([\s\S]*?)<\/miscellaneous-field>/g)].filter(m=>xmlAttribute(m[1]!,"name")===SOURCE_OCCURRENCES);
  if(metadata.length>1 || order && metadata.length) throw new Error("ambiguous source occurrence map");
  const exportedOccurrences=metadata[0]?readSourceOccurrences(decodeXmlEntities(metadata[0][2]!)):null;
  if(exportedOccurrences && (exportedOccurrences.length!==notationMeasures.length || exportedOccurrences.some((m,i)=>Math.abs(m.startBeat-notationMeasures[i]!.startBeat)>1e-9 || Math.abs(m.endBeat-notationMeasures[i]!.endBeat)>1e-9)))throw new Error("source occurrence map differs from notation");
  const pedals=[...xml.matchAll(/<miscellaneous-field\b([^>]*)>([\s\S]*?)<\/miscellaneous-field>/g)].filter(m=>xmlAttribute(m[1]!,"name")===SOURCE_PEDAL);
  if(pedals.length>1 || order && pedals.length)throw new Error("ambiguous source pedal metadata");
  const sourcePedal=pedals[0]?readSourcePedal(decodeXmlEntities(pedals[0][2]!),mergedNotes):undefined;
  const durationBeats = mergedNotes.reduce((m, n) => Math.max(m, n.start + n.dur), order ? measureStart : 0);
  const sections=sectionsFromMarkers(sectionMarkers,durationBeats);
  markerCollector?.push(...sectionMarkers);
  if (order && Math.ceil(durationBeats/.25)*mergedNotes.length > 200_000_000) throw new Error("repeat source workload exceeds supported limits");
  return {
    format: 0,
    ...(sections.length ? {sections} : {}),
    division: divisions,
    tempoBpm: tempo,
    tempoMetaPresent,
    keySig: fifths,
    keyMode: mode === "minor" ? 1 : 0,
    timeSig: [beats, beatType],
    notes: mergedNotes,
    notationMeasures:exportedOccurrences ?? notationMeasures,
    ...(order ? {repeatPlayback:"unfolded" as const} : exportedOccurrences ? {repeatPlayback:"declared" as const} : {}),
    trackNames: [sourcePart.name],
    sourceParts: [{
      id: sourcePart.id,
      name: sourcePart.name,
      noteCount: mergedNotes.length,
      lowMidi: mergedNotes.length ? Math.min(...mergedNotes.map((note) => note.midi)) : null,
      highMidi: mergedNotes.length ? Math.max(...mergedNotes.map((note) => note.midi)) : null,
      startBeat: mergedNotes.length ? Math.min(...mergedNotes.map((note) => note.start)) : null,
      endBeat: mergedNotes.length ? Math.max(...mergedNotes.map((note) => note.start + note.dur)) : null,
    }],
    durationBeats:Math.max(durationBeats,sourcePedal?.endBeat ?? 0),
    ...(sourcePedal?{sourcePedal}:{}),
    ...(!sourcePedal && /<pedal\b/.test(xml)?{unsupportedControls:["MusicXML pedal directions without a channel-bound controller timeline"]}:{}),
    ...(timeSigEvents.length ? { timeSigEvents } : {}),
    title: firstMatch(xml, /<work-title>([\s\S]*?)<\/work-title>/),
  };
}
