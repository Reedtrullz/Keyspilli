import { Note, Variant } from "./types.js";
import { PITCH_COLORS } from "./pitchColors.js";

const DIV = 960;

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

function keySigFromName(key: string): { fifths: number; mode: number } {
  const major = ["C", "G", "D", "A", "E", "B", "F#", "C#"];
  const flat = ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
  const root = key.split(" ")[0]!;
  const mode = key.includes("m") ? 1 : 0;
  const mi = major.indexOf(root);
  if (mi >= 0) return { fifths: mi, mode };
  const fi = flat.indexOf(root);
  if (fi >= 0) return { fifths: -(fi + 1), mode };
  return { fifths: 0, mode };
}

/**
 * Write score-partwise MusicXML (piano grand staff) with per-note colors.
 * Notes are in beats; lyrics attach to RH notes via note.lyrics.
 */
export function writeMusicXml(variant: Variant, title: string, artist: string): string {
  const [num, den] = variant.timeSig;
  const beatsPerMeasure = num * (4 / den);
  const measures = variant.measures;
  const { fifths, mode } = keySigFromName(variant.key);
  const bpm = variant.tempoBpm;

  const notesByMeasure = new Map<number, Note[]>();
  for (const n of variant.notes) {
    const mi = Math.min(measures.length - 1, Math.max(0, Math.floor(n.start / beatsPerMeasure)));
    const arr = notesByMeasure.get(mi) ?? [];
    arr.push(n);
    notesByMeasure.set(mi, arr);
  }

  const measureXml = measures
    .map((m, mi) => {
      const notes = (notesByMeasure.get(mi) ?? []).sort((a, b) => a.start - b.start || a.midi - b.midi);
      const noteXmls: string[] = [];
      let prevStart = -1;
      for (const n of notes) {
        const isChord = Math.abs(n.start - prevStart) < 1e-6;
        prevStart = n.start;
        const st = n.hand === "L" ? 2 : 1;
        const { step, alter, octave } = noteInfo(n.midi);
        const { type, dots } = typeFromDur(Math.max(0.25, n.dur));
        const color = PITCH_COLORS[n.midi % 12]!;
        const lyric = n.lyrics
          ? `<lyric number="1"><syllabic>single</syllabic><text>${xmlEscape(n.lyrics)}</text></lyric>`
          : "";
        noteXmls.push(
          `<note${isChord ? "" : ` default-x="${Math.round(10 + (n.start - m.startBeat) * 120)}"`} color="${color}">` +
            (isChord ? "<chord/>" : "") +
            `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>` +
            `<duration>${Math.round(Math.max(0.25, n.dur) * DIV)}</duration>` +
            `<voice>${st}</voice><type>${type}</type>${dots ? "<dot/>" : ""}` +
            `<staff>${st}</staff>${lyric}</note>`,
        );
      }
      const keyTime =
        mi === 0
          ? `<key><fifths>${fifths}</fifths><mode>${mode === 0 ? "major" : "minor"}</mode></key><time><beats>${num}</beats><beat-type>${den}</beat-type></time>`
          : "";
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
        `</attributes>${tempoDir}${noteXmls.join("")}</measure>`
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
