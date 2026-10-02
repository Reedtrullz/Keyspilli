import { matchingSourcePitch } from "./source-pitch.js";
import { Note, Variant } from "./types.js";
import { PITCH_COLORS } from "./pitchColors.js";
import { keySignature } from "./analyze.js";

const DIV = 960;
const MEASURE_BOUNDARY_TOLERANCE = 1 / DIV + 1e-9;

interface XmlNoteSegment extends Note {
  tieStart?: boolean;
  tieStop?: boolean;
  /** MusicXML voice used to keep overlapping same-pitch tie chains distinct. */
  voice?: number;
}

function noteInfo(midi: number): { step: string; alter: number; octave: number } {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const map: [string, number][] = [
    ["C", 0],
    ["C", 1],
    ["D", 0],
    ["D", 1],
    ["E", 0],
    ["F", 0],
    ["F", 1],
    ["G", 0],
    ["G", 1],
    ["A", 0],
    ["A", 1],
    ["B", 0],
  ];
  const [step, alter] = map[pc]!;
  return { step, alter, octave };
}

function typeFromDur(beats: number): { type: string; dots: number } {
  const dotted: [number, string][] = [
    [1.5, "quarter"],
    [3, "half"],
    [6, "whole"],
    [0.75, "eighth"],
    [0.375, "16th"],
  ];
  for (const [b, t] of dotted) {
    if (Math.abs(beats - b) < 1e-6) return { type: t, dots: 1 };
  }
  const names = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];
  let b = beats;
  let i = 2; // 1 beat = quarter
  while (b < 1 && i < names.length - 1) {
    b *= 2;
    i++;
  }
  while (b > 1 && i > 0) {
    b /= 2;
    i--;
  }
  return { type: names[i]!, dots: 0 };
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Write score-partwise MusicXML (piano grand staff) with per-note colors.
 * Notes are in beats; lyrics attach to RH notes via note.lyrics.
 */
export function writeMusicXml(variant: Variant, title: string, artist: string, options: { chordWords?: boolean } = {}): string {
  const [num, den] = variant.timeSig;
  const timeSigEvents = (variant.timeSigEvents ?? [])
    .filter((event) => Number.isFinite(event.beat) && event.beat >= 0
      && Number.isInteger(event.timeSig[0]) && event.timeSig[0] > 0
      && Number.isInteger(event.timeSig[1]) && event.timeSig[1] > 0)
    .slice()
    .sort((a, b) => a.beat - b.beat || a.tick - b.tick);
  const timeSigAt = (beat: number): [number, number] => {
    let current: [number, number] = [num, den];
    for (const event of timeSigEvents) {
      if (event.beat > beat + 1e-9) break;
      current = [...event.timeSig] as [number, number];
    }
    return current;
  };
  const beatsPerMeasure = num * (4 / den);
  // Prefer the arrangement's explicit measure map, but synthesize any
  // missing tail measures so a malformed/incomplete source cannot silently
  // drop notes that extend past the last catalog row.
  const measures = [...variant.measures].sort((a, b) => a.startBeat - b.startBeat || a.index - b.index);
  const maxNoteEnd = variant.notes.reduce((max, n) => Math.max(max, n.start + n.dur), 0);
  if (!measures.length) {
    measures.push({ index: 0, startBeat: 0, endBeat: beatsPerMeasure });
  }
  let nextIndex = Math.max(...measures.map((m) => m.index), -1) + 1;
  let tailEnd = measures[measures.length - 1]!.endBeat;
  while (tailEnd < maxNoteEnd - 1e-9) {
    const startBeat = tailEnd;
    tailEnd += beatsPerMeasure;
    measures.push({ index: nextIndex++, startBeat, endBeat: tailEnd });
  }
  const { fifths, mode } = keySignature(variant.key);
  const bpm = variant.tempoBpm;

  // A voice is a sequential stream. Simultaneous distinct pitches share a
  // chord, but later overlapping attacks and duplicate unisons need separate
  // voices; otherwise independent consumers move their onsets or lose ties.
  const voiceByNote = new Map<Note, number>();
  for (const staff of [1, 2] as const) {
    const lanes: {start:number;end:number;midis:Set<number>}[]=[];
    const notes=variant.notes.filter(n=>staff===2?n.hand==="L":n.hand!=="L")
      .sort((a,b)=>a.start-b.start||b.dur-a.dur||a.midi-b.midi);
    for(const n of notes){
      let lane=lanes.findIndex(l=>l.end<=n.start+1e-9||Math.abs(l.start-n.start)<1e-9&&!l.midis.has(n.midi));
      if(lane<0){lane=lanes.length;lanes.push({start:n.start,end:n.start+n.dur,midis:new Set([n.midi])});}
      else{
        const l=lanes[lane]!;
        if(Math.abs(l.start-n.start)>=1e-9){l.start=n.start;l.end=n.start+n.dur;l.midis.clear();}
        else l.end=Math.max(l.end,n.start+n.dur);
        l.midis.add(n.midi);
      }
      voiceByNote.set(n,staff+lane*2);
    }
  }

  const notesByMeasure = new Map<number, XmlNoteSegment[]>();
  for (const n of variant.notes) {
    const end = n.start + n.dur;
    let cursor = n.start;
    // MusicXML measures cannot contain a note whose duration runs past the
    // barline. Split cross-bar sustains into tied segments so strict readers
    // see balanced measure cursors while the parser can reconstruct the
    // original note.
    while (cursor < end - 1e-9) {
      let mi = measures.findIndex((m) => cursor >= m.startBeat - 1e-9 && cursor < m.endBeat - 1e-9);
      if (mi < 0) {
        mi = cursor < measures[0]!.startBeat ? 0 : measures.length - 1;
      }
      const measure = measures[mi]!;
      // If the final supplied measure is shorter than the note tail, keep the
      // remainder in that measure rather than dropping it. Normal catalog
      // arrangements have contiguous measures, while this fallback keeps
      // hand-authored/test variants lossless.
      const boundary = measure.endBeat > cursor + 1e-9 ? measure.endBeat : end;
      if (boundary - cursor > 0 && boundary - cursor <= MEASURE_BOUNDARY_TOLERANCE) {
        cursor = boundary;
        continue;
      }
      const boundedEnd = Math.min(end, boundary);
      // Source timing normalization can leave a measure boundary a few
      // microbeats before a quantized note end. Treat that remainder as part
      // of the preceding segment instead of emitting a one-tick ghost note.
      const segmentEnd = end - boundedEnd <= MEASURE_BOUNDARY_TOLERANCE ? end : boundedEnd;
      const segmentDur = segmentEnd - cursor;
      if (segmentDur <= 1e-9) break;
      const segment: XmlNoteSegment = {
        ...n,
        start: cursor,
        dur: segmentDur,
        // A continuation only starts another tie when more material remains
        // after this segment. The previous implementation marked every
        // post-barline segment as tie-start, including the final segment;
        // that left parser chains open and let later same-pitch re-attacks
        // steal their durations.
        tieStart: segmentEnd < end - MEASURE_BOUNDARY_TOLERANCE,
        tieStop: cursor > n.start + 1e-9,
        voice: voiceByNote.get(n),
      };
      const arr = notesByMeasure.get(mi) ?? [];
      arr.push(segment);
      notesByMeasure.set(mi, arr);
      cursor = segmentEnd;
    }
  }

  /** Render one staff as a cursor-aware stream. MusicXML advances a part's
   * cursor sequentially, so interleaved RH/LH notes must be written as two
   * streams separated by <backup>; otherwise the second staff is shifted by
   * whatever duration happened to be emitted on the first staff. Every staff
   * is padded with a rest to the measure boundary: some importers ignore
   * trailing <forward> when calculating measure length, which makes
   * MusicXML importers advance the next measure at a different time and can
   * leave otherwise balanced cross-bar ties open. */
  const renderStaff = (notes: XmlNoteSegment[], staff: 1 | 2, measureStart: number, measureLength: number): { xml: string; cursor: number } => {
    const byVoice = new Map<number, XmlNoteSegment[]>();
    for (const n of notes) {
      const voice = n.voice ?? staff;
      const stream = byVoice.get(voice) ?? [];
      stream.push(n);
      byVoice.set(voice, stream);
    }
    if (!byVoice.size) byVoice.set(staff, []);
    const xml: string[] = [];
    let cursor = 0;
    for (const [voice, voiceNotes] of [...byVoice.entries()].sort((a, b) => a[0] - b[0])) {
      if (cursor > 0) xml.push(`<backup><duration>${Math.round(cursor * DIV)}</duration></backup>`);
      cursor = 0;
      const byStart = new Map<number, XmlNoteSegment[]>();
      for (const n of voiceNotes) {
        const start = Number(Math.max(0, n.start - measureStart).toFixed(6));
        const group = byStart.get(start) ?? [];
        group.push(n);
        byStart.set(start, group);
      }
      for (const [start, group] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
        if (start > cursor + 1e-6) {
          xml.push(`<forward><duration>${Math.round((start - cursor) * DIV)}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`);
          cursor = start;
        }
        const ordered = [...group].sort((a, b) => b.dur - a.dur || a.midi - b.midi);
        const cursorDur = Math.max(...ordered.map((n) => n.dur));
        for (let i = 0; i < ordered.length; i++) {
          const n = ordered[i]!;
          const isChord = i > 0;
          const { step, alter, octave } = matchingSourcePitch(n) ?? noteInfo(n.midi);
          // Preserve the source duration. Clamping short notes to a quarter of
          // a beat silently stretched 16th/32nd-note passages in every sheet.
          const durBeats = Math.max(1 / DIV, n.dur);
          const { type, dots } = typeFromDur(durBeats);
          const color = PITCH_COLORS[n.midi % 12]!;
          const lyric = n.lyrics
            ? "<lyric number=\"1\"><syllabic>single</syllabic><text>" + xmlEscape(n.lyrics) + "</text></lyric>"
            : "";
          const tieTypes = [
            n.tieStop ? "<tie type=\"stop\"/>" : "",
            n.tieStart ? "<tie type=\"start\"/>" : "",
          ].join("");
          const tiedNotations = [
            n.tieStop ? "<tied type=\"stop\"/>" : "",
            n.tieStart ? "<tied type=\"start\"/>" : "",
          ].join("");
          const notations = tiedNotations ? "<notations>" + tiedNotations + "</notations>" : "";
          xml.push(
            "<note" + (isChord ? "" : " default-x=\"" + Math.round(10 + start * 120) + "\"") + " color=\"" + color + "\">" +
              (isChord ? "<chord/>" : "") +
              "<pitch><step>" + step + "</step>" + (alter ? "<alter>" + alter + "</alter>" : "") + "<octave>" + octave + "</octave></pitch>" +
              "<duration>" + Math.round(durBeats * DIV) + "</duration>" +
              tieTypes +
              "<voice>" + voice + "</voice><type>" + type + "</type>" + (dots ? "<dot/>" : "") +
              "<staff>" + staff + "</staff>" + lyric + notations + "</note>",
          );
          cursor = start + cursorDur;
        }
      }
      if (cursor < measureLength - 1e-9) {
        const restDuration = measureLength - cursor;
        const { type, dots } = typeFromDur(restDuration);
        xml.push(`<note><rest/><duration>${Math.round(restDuration * DIV)}</duration><voice>${voice}</voice><type>${type}</type>${dots ? "<dot/>" : ""}<staff>${staff}</staff></note>`);
        cursor = measureLength;
      }
    }
    return { xml: xml.join(""), cursor };
  };

  const measureXml = measures
    .map((m, mi) => {
      const notes = notesByMeasure.get(mi) ?? [];
      const measureLength = Math.max(0, m.endBeat - m.startBeat);
      const rh = renderStaff(notes.filter((n) => n.hand !== "L"), 1, m.startBeat, measureLength);
      const lh = renderStaff(notes.filter((n) => n.hand === "L"), 2, m.startBeat, measureLength);
      const noteXmls =
        rh.xml +
        (rh.cursor > 0 ? "<backup><duration>" + Math.round(rh.cursor * DIV) + "</duration></backup>" : "") +
        lh.xml;
      const [measureNum, measureDen] = timeSigAt(m.startBeat);
      const previousTimeSig = mi > 0 ? timeSigAt(measures[mi - 1]!.startBeat) : null;
      const timeChanged = mi === 0 || previousTimeSig === null
        || previousTimeSig[0] !== measureNum || previousTimeSig[1] !== measureDen;
      const keyTime =
        mi === 0
          ? `<key><fifths>${fifths}</fifths><mode>${mode === 0 ? "major" : "minor"}</mode></key><time><beats>${measureNum}</beats><beat-type>${measureDen}</beat-type></time>`
          : timeChanged ? `<time><beats>${measureNum}</beats><beat-type>${measureDen}</beat-type></time>` : "";
      const tempoDir =
        mi === 0
          ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type></direction>`
          : "";
      return (
        `<measure number="${mi + 1}">` +
        `<attributes><divisions>${DIV}</divisions>${keyTime}<staves>2</staves>` +
        `<clef number="1"><sign>G</sign><line>2</line></clef>` +
        `<clef number="2"><sign>F</sign><line>4</line></clef>` +
        `<staff-details number="1"><staff-lines>5</staff-lines></staff-details>` +
        `<staff-details number="2"><staff-lines>5</staff-lines></staff-details>` +
        `</attributes>${tempoDir}${options.chordWords ? variant.chords.filter(c => c.beat >= m.startBeat && c.beat < m.endBeat).map(c => `<direction placement="above"><direction-type><words>${xmlEscape(c.name)}</words></direction-type><offset>${Math.round((c.beat-m.startBeat)*DIV)}</offset></direction>`).join("") : ""}${noteXmls}</measure>`
      );
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${xmlEscape(title)}</work-title></work>
  <identification><creator type="composer">${xmlEscape(artist)}</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measureXml}</part>
</score-partwise>`;
}
