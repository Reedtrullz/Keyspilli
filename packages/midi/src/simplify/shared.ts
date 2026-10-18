import { Note } from "../types.js";

export const SAFE_TEMPO_BPM = 120;

/**
 * Array-safe numeric extrema for imported material.  Audio transcriptions can
 * contain hundreds of thousands of sequential attacks; spreading those
 * arrays into Math.min/Math.max exceeds V8's argument-list limit.
 */
export function maxNumber(values: Iterable<number>, fallback = Number.NEGATIVE_INFINITY): number {
  let result = fallback;
  for (const value of values) {
    if (Number.isFinite(value) && value > result) result = value;
  }
  return result;
}

export function minNumber(values: Iterable<number>, fallback = Number.POSITIVE_INFINITY): number {
  let result = fallback;
  for (const value of values) {
    if (Number.isFinite(value) && value < result) result = value;
  }
  return result;
}

export function maxNoteEnd(notes: Iterable<Note>, fallback = 0): number {
  let result = fallback;
  for (const note of notes) {
    const end = note.start + note.dur;
    if (Number.isFinite(end) && end > result) result = end;
  }
  return result;
}

/** Return a publishable integer tempo, falling back for malformed MIDI meta. */
export function normalizeTempoBpm(value: number | undefined, fallback = SAFE_TEMPO_BPM): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20 || n > 300) return fallback;
  return Math.round(n);
}

/** Shift out-of-piano-range notes by octaves so everything is playable. */
export function normalizePianoRange(notes: Note[]): Note[] {
  return notes.map((n) => {
    let midi = n.midi;
    while (midi < 21) midi += 12;
    while (midi > 108) midi -= 12;
    return midi === n.midi ? n : { ...n, midi };
  });
}

/**
 * Score the travel between two selected guitar attacks.  The ordinary
 * interval scheduler only knows whether two starts fit on the piano grid; it
 * can therefore choose a sparse sequence whose individual notes are salient
 * but whose hand has to jump between them.  Keep this penalty deliberately
 * modest and source-local: a real rest, a vocal handoff, or a non-guitar lane
 * must not inherit a guitar fingering constraint.
 */
export function isMetalInstrumentalSource(source: Note["identitySource"]): boolean {
  return source === "guitar" || source === "other";
}

export function onsetGroups(notes: Note[]): Note[][] {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = note.start.toFixed(3);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a[0]!.start - b[0]!.start);
}

const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
  // Enharmonic spellings can be emitted by key detection (for example Cb
  // for seven flats). Keep easy-level bass revoicing on the actual tonic
  // instead of silently falling back to C.
  Cb: 11, "B#": 0, "E#": 5, Fb: 4,
};

export function rootOf(midi: number, key: string): number {
  // Metadata may use the same long-form names accepted by keySignature(),
  // such as “F# minor” and “F# major”. Only the tonic token affects the
  // octave revoice; mode is irrelevant here.
  const rawTonic = key.trim().split(/\s+/)[0]?.replace(/m(?:inor)?$/i, "") ?? "C";
  const tonic = rawTonic.charAt(0).toUpperCase() + rawTonic.slice(1);
  const pc = KEY_PC[tonic] ?? 0;
  const offset = ((midi - pc) % 12 + 12) % 12;
  let root = midi - offset;
  while (root < 21) root += 12; // keep the rooted bass on the piano
  return root;
}
