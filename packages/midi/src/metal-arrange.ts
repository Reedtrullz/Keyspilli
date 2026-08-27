import type { ChordLabel, Note, ParsedMidi } from "./types.js";

export type MetalStemRole = "vocals" | "bass" | "guitar" | "other" | "drums";

export interface MetalStem {
  role: MetalStemRole;
  midi: ParsedMidi;
  /** Optional separator/transcriber confidence in [0, 1]. */
  confidence?: number;
}

export interface MetalArrangementInput {
  stems: MetalStem[];
  sectionBeats?: number;
  harmonyBeats?: number;
  title?: string;
}

export interface MetalIdentitySection {
  startBeat: number;
  endBeat: number;
  source: "vocals" | "guitar" | "other" | "rest";
  confidence: number;
}

export interface MetalArrangementIR {
  version: 1;
  tempoBpm: number;
  timeSig: [number, number];
  durationBeats: number;
  sections: MetalIdentitySection[];
  identity: Note[];
  harmony: ChordLabel[];
  rhythmicAccents: number[];
}

export interface MetalArrangementResult {
  parsed: ParsedMidi;
  chords: ChordLabel[];
  ir: MetalArrangementIR;
  stats: {
    identityNotes: number;
    leftHandNotes: number;
    chordEvents: number;
    sourceSections: Record<string, number>;
  };
  warnings: string[];
}

const EPS = 1e-6;
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function beatsPerMeasure(timeSig: [number, number]): number {
  const [numerator, denominator] = timeSig;
  const value = numerator * (4 / denominator);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function toRegister(midi: number, low: number, high: number): number {
  let pitch = Math.round(midi);
  while (pitch < low) pitch += 12;
  while (pitch > high) pitch -= 12;
  return clamp(pitch, low, high);
}

function validNotes(stem: MetalStem | undefined): Note[] {
  if (!stem) return [];
  return stem.midi.notes
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0 && note.midi >= 0 && note.midi <= 127)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
}

/**
 * Reduce polyphonic pitch evidence to one identity voice. The small dynamic
 * program strongly prefers confident/long attacks but penalizes implausible
 * instantaneous leaps, which removes most guitar-chord and bleed duplicates.
 */
function monophonicPath(notes: Note[], low: number, high: number): Note[] {
  const groups: Note[][] = [];
  for (const note of notes) {
    const normalized = { ...note, midi: toRegister(note.midi, low, high) };
    const last = groups.at(-1);
    if (last && Math.abs(last[0]!.start - normalized.start) <= 0.08) last.push(normalized);
    else groups.push([normalized]);
  }

  let previous: Note | undefined;
  const selected: Note[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const candidates = group
      .filter((note) => !previous || note.start >= previous.start + Math.min(previous.dur, 0.08) - EPS)
      .map((note) => {
        if (!previous) return note;
        const elapsed = Math.max(0, note.start - previous.start);
        let pitch = note.midi;
        // A detector octave-flips guitar/vocal partials surprisingly often.
        // Within a short travel window, fold by octaves toward the previous
        // pitch; never ask the player to jump more than an octave in <=1.5
        // beats merely because the raw stem contained a distant partial.
        if (elapsed <= 1.5) {
          while (Math.abs(pitch - previous.midi) > 12 && pitch - previous.midi > 0 && pitch - 12 >= low) pitch -= 12;
          while (Math.abs(pitch - previous.midi) > 12 && pitch - previous.midi < 0 && pitch + 12 <= high) pitch += 12;
        }
        return pitch === note.midi ? note : { ...note, midi: pitch };
      });
    if (!candidates.length) continue;
    const best = candidates.reduce((winner, note) => {
      const score = note.vel / 16 + Math.min(note.dur, 2) - (previous ? Math.abs(note.midi - previous.midi) / 7 : 0);
      const winnerScore = winner.vel / 16 + Math.min(winner.dur, 2) - (previous ? Math.abs(winner.midi - previous.midi) / 7 : 0);
      return score > winnerScore ? note : winner;
    });
    const nextStart = groups[groupIndex + 1]?.[0]?.start;
    const dur = Math.max(0.125, Math.min(best.dur, nextStart === undefined ? best.dur : nextStart - best.start));
    previous = { ...best, dur, hand: "R" };
    selected.push(previous);
  }
  return selected;
}

function notesIn(notes: Note[], start: number, end: number): Note[] {
  return notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
}

function sourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const attacks = notesIn(notes, start, end).length;
  const expected = Math.max(1, (end - start) / 2);
  return clamp((attacks / expected) * stemConfidence, 0, 1);
}

/**
 * A transcription can produce a dense, single-pitch vocal drone from bleed
 * or reverb. It should not displace a moving riff that carries the song's
 * identity. Penalize only the degenerate vocal case; chants and deliberately
 * narrow melodies with at least two pitches retain their normal priority.
 */
function vocalSourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const confidence = sourceConfidence(notes, start, end, stemConfidence);
  const evidence = notesIn(notes, start, end);
  if (evidence.length < 4) return confidence;
  const distinct = new Set(evidence.map((note) => note.midi));
  if (distinct.size > 1) return confidence;
  return confidence * 0.5;
}

function bassAt(notes: Note[], start: number, end: number): Note | undefined {
  // A fresh bass attack is stronger harmonic evidence than an older low
  // sustain. Otherwise a held C2 can mask a D2 chord change two beats later.
  const attacked = notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
  if (attacked.length) {
    return attacked.sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start) || a.midi - b.midi || b.vel - a.vel)[0];
  }
  const candidates = notes.filter((note) => note.start < end && note.start + note.dur > start);
  return candidates.sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0];
}

function pitchClassesAt(notes: Note[], start: number, end: number): Set<number> {
  return new Set(notes.filter((note) => note.start < end && note.start + note.dur > start).map((note) => ((note.midi % 12) + 12) % 12));
}

function identityForWindow(primary: Note[], alternates: Note[][], start: number, end: number): Note[] {
  const selected = notesIn(primary, start, end).map((note) => ({ ...note }));
  // Preserve a guitar/other motif during vocal rests instead of throwing the
  // whole instrumental lane away just because the section has a vocal lead.
  for (const lane of alternates) {
    for (const note of notesIn(lane, start, end)) {
      const occupied = selected.some((existing) =>
        Math.abs(existing.start - note.start) <= 0.08
        || (existing.start <= note.start && existing.start + existing.dur > note.start),
      );
      if (!occupied) selected.push({ ...note });
    }
  }
  return selected
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi)
    .map((note, index, all) => ({
      ...note,
      dur: Math.max(0.125, Math.min(note.dur, end - note.start, all[index + 1] ? all[index + 1]!.start - note.start : note.dur)),
    }));
}

function chordFor(rootPc: number, pcs: Set<number>): { name: string; notes: number[] } {
  const hasMinor = pcs.has((rootPc + 3) % 12);
  const hasMajor = pcs.has((rootPc + 4) % 12);
  const quality = hasMinor === hasMajor ? "5" : hasMinor ? "m" : "";
  const root = 36 + rootPc;
  const bassRoot = root > 47 ? root - 12 : root;
  const intervals = quality === "m" ? [0, 3, 7] : quality === "" ? [0, 4, 7] : [0, 7];
  return {
    name: `${SHARP_NAMES[rootPc]}${quality}`,
    notes: intervals.map((interval) => bassRoot + interval),
  };
}

function uniqueSorted(notes: Note[]): Note[] {
  const seen = new Set<string>();
  return notes
    .sort((a, b) => a.start - b.start || a.midi - b.midi || b.dur - a.dur)
    .filter((note) => {
      const key = `${note.hand}:${note.midi}:${note.start.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Turn separated band evidence into a deliberately piano-shaped canonical
 * arrangement. Drums contribute timing accents only; they are never emitted
 * as pitched notes.
 */
export function buildMetalArrangement(input: MetalArrangementInput): MetalArrangementResult {
  if (!input.stems.length) throw new Error("Metal arrangement requires at least one stem");
  const reference = input.stems.find((stem) => stem.role !== "drums")?.midi ?? input.stems[0]!.midi;
  const tempoBpm = reference.tempoBpm;
  const timeSig = reference.timeSig;
  const durationBeats = input.stems.reduce((duration, stem) => {
    let result = Number.isFinite(stem.midi.durationBeats) ? Math.max(duration, stem.midi.durationBeats) : duration;
    for (const note of validNotes(stem)) {
      const end = note.start + note.dur;
      if (Number.isFinite(end) && end > result) result = end;
    }
    return result;
  }, 1);
  const meterBeats = beatsPerMeasure(timeSig);
  const sectionBeats = Math.max(2, input.sectionBeats ?? meterBeats * 2);
  const harmonyBeats = Math.max(1, input.harmonyBeats ?? meterBeats / 2);
  const roles: MetalStemRole[] = ["vocals", "bass", "guitar", "other", "drums"];
  for (const role of roles) {
    if (input.stems.filter((stem) => stem.role === role).length > 1) {
      throw new Error(`metal arrangement received duplicate ${role} stems`);
    }
  }
  const vocalsStem = input.stems.find((stem) => stem.role === "vocals");
  const guitarStem = input.stems.find((stem) => stem.role === "guitar") ?? input.stems.find((stem) => stem.role === "other");
  const otherStem = input.stems.find((stem) => stem.role === "other" && stem !== guitarStem);
  const bassStem = input.stems.find((stem) => stem.role === "bass");
  const drumsStem = input.stems.find((stem) => stem.role === "drums");
  const vocals = monophonicPath(validNotes(vocalsStem), 60, 84);
  const guitar = monophonicPath(validNotes(guitarStem), 55, 84);
  const other = monophonicPath(validNotes(otherStem), 55, 84);
  const bass = validNotes(bassStem);
  const harmonicEvidence = [...validNotes(guitarStem), ...validNotes(otherStem)];
  const sections: MetalIdentitySection[] = [];
  const identity: Note[] = [];

  for (let start = 0; start < durationBeats - EPS; start += sectionBeats) {
    const end = Math.min(durationBeats, start + sectionBeats);
    const choices = [
      { source: "vocals" as const, notes: vocals, confidence: vocalSourceConfidence(vocals, start, end, vocalsStem?.confidence) },
      { source: "guitar" as const, notes: guitar, confidence: sourceConfidence(guitar, start, end, guitarStem?.confidence) * 0.92 },
      { source: "other" as const, notes: other, confidence: sourceConfidence(other, start, end, otherStem?.confidence) * 0.85 },
    ].sort((a, b) => b.confidence - a.confidence);
    const winner = choices[0]!;
    const source = winner.confidence >= 0.15 ? winner.source : "rest";
    sections.push({ startBeat: start, endBeat: end, source, confidence: winner.confidence });
    if (source !== "rest") {
      for (const note of identityForWindow(winner.notes, choices.slice(1).map((choice) => choice.notes), start, end)) {
        identity.push(note);
      }
    }
  }

  const chords: ChordLabel[] = [];
  const leftHand: Note[] = [];
  let previousRoot: number | undefined;
  for (let beat = 0; beat < durationBeats - EPS; beat += harmonyBeats) {
    const end = Math.min(durationBeats, beat + harmonyBeats);
    const bassNote = bassAt(bass, beat, end);
    const evidence = pitchClassesAt(harmonicEvidence, beat, end);
    let rootPc = bassNote ? ((bassNote.midi % 12) + 12) % 12 : previousRoot;
    if (rootPc === undefined && evidence.size) rootPc = [...evidence][0];
    if (rootPc === undefined) continue;
    previousRoot = rootPc;
    const chord = chordFor(rootPc, evidence);
    const duration = Math.max(0.25, end - beat);
    chords.push({
      beat,
      name: chord.name,
      notes: chord.notes,
      sourceKind: "inferred",
      inferred: true,
      inferenceType: "voicing",
      durationBeats: duration,
    });
    const root = chord.notes[0]!;
    leftHand.push({ midi: root, start: beat, dur: Math.min(duration, 1.5), vel: 68, hand: "L" });
    if (chord.notes.length > 1) {
      const fifth = chord.notes.find((note) => note % 12 === (rootPc! + 7) % 12);
      if (fifth !== undefined) leftHand.push({ midi: fifth, start: beat, dur: Math.min(duration, 1.5), vel: 62, hand: "L" });
    }
  }

  const rhythmicAccents = validNotes(drumsStem).map((note) => note.start).filter((beat, index, all) => index === 0 || beat - all[index - 1]! >= 0.125);
  const notes = uniqueSorted([...identity.map((note) => ({ ...note, hand: "R" as const })), ...leftHand]);
  const warnings: string[] = [];
  const mismatchedTempo = input.stems.filter((stem) => Math.abs(stem.midi.tempoBpm - tempoBpm) > 0.5);
  if (mismatchedTempo.length) warnings.push(`${mismatchedTempo.length} stems had mismatched tempo metadata; beat positions were used unchanged`);
  if (!identity.length) warnings.push("no reliable vocal, guitar, or other identity line was found");
  if (!bass.length) warnings.push("no bass stem was available; harmony roots may be less reliable");
  const sourceSections: Record<string, number> = {};
  for (const section of sections) {
    sourceSections[section.source] = (sourceSections[section.source] ?? 0) + 1;
  }
  const parsed: ParsedMidi = {
    format: 1,
    division: reference.division || 480,
    tempoBpm,
    tempoMetaPresent: true,
    keySig: reference.keySig,
    keyMode: reference.keyMode,
    timeSig,
    notes,
    trackNames: ["Metal Piano RH", "Metal Piano LH"],
    durationBeats,
    ...(input.title ? { title: input.title } : {}),
  };
  const ir: MetalArrangementIR = { version: 1, tempoBpm, timeSig, durationBeats, sections, identity: identity.map((note) => ({ ...note })), harmony: chords, rhythmicAccents };
  return {
    parsed,
    chords,
    ir,
    stats: { identityNotes: identity.length, leftHandNotes: leftHand.length, chordEvents: chords.length, sourceSections },
    warnings,
  };
}
