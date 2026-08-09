import { splitHands, detectBassPattern, detectKey, chordName } from "./analyze.js";
import { Note, ParsedMidi, SongMeta, Variant, DifficultyLevel, LEVEL_ORDER, ChordLabel } from "./types.js";
import { quantize } from "./quantize.js";

export interface VariantOptions {
  /** 16th-note grid (beats) used for note slicing */
  grid?: number;
}

function chordsAt(notes: Note[], grid: number): ChordLabel[] {
  const bySlice = new Map<number, number[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid) * grid;
    const arr = bySlice.get(k) ?? [];
    arr.push(n.midi);
    bySlice.set(k, arr);
  }
  const out: ChordLabel[] = [];
  for (const [beat, mids] of [...bySlice.entries()].sort((a, b) => a[0] - b[0])) {
    const pcs = [...new Set(mids.map((m) => m % 12))].sort((a, b) => a - b);
    if (pcs.length < 2) continue;
    out.push({ beat, name: chordName(pcs), notes: mids });
  }
  return out;
}

function simplifyRhythm(notes: Note[], grid: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  for (let i = 0; i < slices.length; i++) {
    const k = slices[i]!;
    const next = slices[i + 1];
    const dur = next === undefined ? 1 : Math.max(grid, (next - k) * grid);
    for (const n of bySlice.get(k)!) out.push({ ...n, dur });
  }
  return out;
}

function melodyOnly(notes: Note[], grid: number, minDur: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  for (let i = 0; i < slices.length; i++) {
    const k = slices[i]!;
    const group = bySlice.get(k)!;
    const top = group.reduce((a, b) => (b.midi > a.midi ? b : a));
    const next = slices[i + 1];
    const dur = next === undefined ? Math.max(minDur, top.dur) : Math.max(minDur, (next - k) * grid);
    out.push({ ...top, dur });
  }
  return out;
}

function thinChord(notes: Note[], keep: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / 0.25) * 0.25;
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const [k, ns] of bySlice) {
    const sorted = [...ns].sort((a, b) => a.midi - b.midi);
    const kept = sorted.slice(0, Math.min(keep, sorted.length));
    for (const n of kept) out.push({ ...n, start: k });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

function rootOf(midi: number): number {
  return midi - ((midi - 24) % 12);
}

/**
 * Generate 6 difficulty variants from a source arrangement.
 * Guarantee: each easier level is a strict simplification (subset or
 * equal notes) of the level above it.
 */
export function buildVariants(src: ParsedMidi, meta: SongMeta, opts: VariantOptions = {}): Variant[] {
  const grid = opts.grid ?? 0.25;
  const base = quantize(src.notes, { grid: 0.125, minDur: 0.05 });
  const { rh, lh } = splitHands(base);
  const key = meta.key ?? detectKey(src.notes).name;
  const tempo = meta.tempo ?? Math.round(src.tempoBpm);

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering.
  const advanced = quantize([...rh, ...lh], { grid: 0.125 });
  const medium = quantize([...simplifyRhythm(rh, 0.125), ...thinChord(lh, 3)], { grid: 0.125 });
  const easy = quantize(
    [...melodyOnly(rh, 0.125, 0.5), ...thinChord(lh, 2).map((n) => ({ ...n, midi: rootOf(n.midi) }))],
    { grid: 0.25 },
  );
  const lhRoots = lh
    .map((n) => ({ ...n, midi: rootOf(n.midi) }))
    .filter((n, i, a) => a.findIndex((x) => Math.abs(x.start - n.start) < 1e-6) === i);
  const veryEasy = quantize([...melodyOnly(rh, 0.25, 0.5), ...lhRoots], { grid: 0.25 });
  const beginner = quantize(melodyOnly(rh, 0.25, 0.5), { grid: 0.25 });
  const veryBeginner = quantize(melodyOnly(rh, 0.5, 1), { grid: 0.5 });

  const sets: Record<DifficultyLevel, Note[]> = {
    "very-beginner": veryBeginner,
    beginner,
    "very-easy": veryEasy,
    easy,
    medium,
    advanced,
  };
  const scores: Record<DifficultyLevel, number> = {
    "very-beginner": 1,
    beginner: 1.4,
    "very-easy": 2,
    easy: 2.6,
    medium: 3.4,
    advanced: 4.6,
  };
  const lhPattern = detectBassPattern(lh);
  return LEVEL_ORDER.map((level) => {
    const notes = sets[level]!.map((n) => ({ ...n }));
    return {
      level,
      difficultyScore: scores[level]!,
      notes,
      chords: chordsAt(notes, grid),
      bassPattern: level === "advanced" || level === "medium" ? lhPattern : level === "very-easy" || level === "easy" ? "block" : "none",
      key,
      tempoBpm: tempo,
      timeSig: src.timeSig,
      measures: buildMeasures(notes, src.timeSig),
    };
  });
}

function buildMeasures(notes: Note[], timeSig: [number, number]): Variant["measures"] {
  const [num, den] = timeSig;
  const beatsPerMeasure = num * (4 / den);
  const dur = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 1);
  const count = Math.max(1, Math.ceil(dur / beatsPerMeasure));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerMeasure,
    endBeat: (i + 1) * beatsPerMeasure,
  }));
}
