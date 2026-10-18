import type { Note } from "../types.js";
import type { IdentityNote, MetalStem } from "./types.js";

export const EPS = 1e-6;

export function stripInternalIdentity(note: IdentityNote): Note {
  const { rawMidi: _rawMidi, traceRefs: _traceRefs, traceSourceStem: _traceSourceStem, ...publicNote } = note;
  return publicNote;
}

export function isMetalInstrumentalSource(source: Note["identitySource"]): source is "guitar" | "other" {
  return source === "guitar" || source === "other";
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function beatsPerMeasure(timeSig: [number, number]): number {
  const [numerator, denominator] = timeSig;
  const value = numerator * (4 / denominator);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

export function toRegister(midi: number, low: number, high: number): number {
  let pitch = Math.round(midi);
  while (pitch < low) pitch += 12;
  while (pitch > high) pitch -= 12;
  return clamp(pitch, low, high);
}

export function validNotes(stem: MetalStem | undefined): Note[] {
  if (!stem) return [];
  return stem.midi.notes
    // Keep the trace and the serialized MIDI on the same valid event domain.
    // writeMidi cannot represent negative/non-integer/out-of-range pitches or
    // non-positive/non-finite velocities as source events.
    .filter((note) => Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
      && Number.isFinite(note.start) && note.start >= 0
      && Number.isFinite(note.dur) && note.dur > 0
      && Number.isFinite(note.vel) && note.vel >= 1 && note.vel <= 127)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
}

export function notesIn<T extends Note>(notes: T[], start: number, end: number): T[] {
  return notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
}

export function sourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const attacks = notesIn(notes, start, end).length;
  const expected = Math.max(1, (end - start) / 2);
  return clamp((attacks / expected) * stemConfidence, 0, 1);
}

export function isUpperGuitarRhythmWall(notes: Note[]): boolean {
  const evidence = notes.slice().sort((a, b) => a.start - b.start || b.vel - a.vel);
  if (evidence.length < 4 || evidence[0]?.identitySource !== "guitar") return false;
  const upperRatio = evidence.filter((note) => note.midi >= 64).length / evidence.length;
  const repeatedRatio = evidence.length > 1
    ? evidence.slice(1).filter((note, index) => note.midi === evidence[index]!.midi).length / (evidence.length - 1)
    : 1;
  const distinctPitches = new Set(evidence.map((note) => note.midi)).size;
  const gaps = evidence.slice(1)
    .map((note, index) => note.start - evidence[index]!.start)
    .filter((gap) => gap > EPS)
    .sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Number.POSITIVE_INFINITY;
  const attackDensity = evidence.length / Math.max(0.5, evidence.at(-1)!.start - evidence[0]!.start);
  return upperRatio >= 0.8
    && distinctPitches <= 2
    && repeatedRatio >= 0.75
    && medianGap <= 0.75 + EPS
    && attackDensity >= 1.5 - EPS;
}

export function bassAt(notes: Note[], start: number, end: number): Note | undefined {
  // A fresh bass attack is stronger harmonic evidence than an older low
  // sustain. Otherwise a held C2 can mask a D2 chord change two beats later.
  const attacked = notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
  if (attacked.length) {
    return attacked.sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start) || a.midi - b.midi || b.vel - a.vel)[0];
  }
  const candidates = notes.filter((note) => note.start < end && note.start + note.dur > start);
  return candidates.sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0];
}

export function pitchClassesAt(notes: Note[], start: number, end: number): Set<number> {
  return new Set(notes.filter((note) => note.start < end && note.start + note.dur > start).map((note) => ((note.midi % 12) + 12) % 12));
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function uniqueSorted(notes: Note[]): Note[] {
  const seen = new Set<string>();
  const result = notes
    .sort((a, b) => a.start - b.start
      || a.midi - b.midi
      // When a routed rhythm/root event lands on the same pitch as the
      // inferred chord shell, keep the source-tagged event. It represents
      // both the physical strike and its provenance; dropping it would make
      // the LH rhythm lane disappear at every chord boundary.
      || Number(Boolean(b.identitySource)) - Number(Boolean(a.identitySource))
      || b.dur - a.dur)
    .filter((note) => {
      const key = `${note.hand}:${note.midi}:${note.start.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // Different stems can retrigger one physical key. End its previous sustain
  // before splitting source tracks, so MIDI channels cannot multiply voices.
  const previous = new Map<string, Note>();
  for (const note of result) {
    const key = `${note.hand}:${note.midi}`;
    const prior = previous.get(key);
    if (prior) prior.dur = Math.min(prior.dur, note.start - prior.start);
    previous.set(key, note);
  }
  return result;
}
