import { splitHands, detectBassPattern, detectKey, chordName } from "./analyze.js";
import { Note, ParsedMidi, SongMeta, Variant, DifficultyLevel, LEVEL_ORDER, ChordLabel } from "./types.js";
import { quantize } from "./quantize.js";

export interface VariantOptions {
  /** 16th-note grid (beats) used for note slicing */
  grid?: number;
  /** octave-shift notes outside the piano range (21-108) into it */
  normalizeRange?: boolean;
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

/** Keep the highest `keep` voices per slice (melody-first piano texture). */
function topVoices(notes: Note[], grid: number, keep: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const ns of bySlice.values()) {
    const sorted = [...ns].sort((a, b) => b.midi - a.midi);
    for (const n of sorted.slice(0, keep)) out.push(n);
  }
  return out;
}

/**
 * Drop notes that would make one hand's SOUNDING pitch span exceed `maxSpan`
 * (notes overlap across slices even when their starts are different). The
 * hand's melodic extreme (highest for RH, lowest for LH) is kept and only
 * unreachable inner/outer voices are removed, so the line survives.
 */
function capSoundingSpan(notes: Note[], maxSpan: number, anchor: "high" | "low"): Note[] {
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || (anchor === "high" ? b.midi - a.midi : a.midi - b.midi),
  );
  const out: Note[] = [];
  const active: { end: number; midi: number; note: Note }[] = [];
  for (const n of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= n.start) active.splice(i, 1);
    }
    const mids = active.map((a) => a.midi);
    if (mids.length === 0) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
      continue;
    }
    const span = Math.max(...mids, n.midi) - Math.min(...mids, n.midi);
    const extendsAnchor = anchor === "high" ? n.midi > Math.max(...mids) : n.midi < Math.min(...mids);
    if (span <= maxSpan) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    } else if (extendsAnchor) {
      const kept = active.filter((a) => Math.abs(a.midi - n.midi) <= maxSpan);
      const removed = new Set(active.filter((a) => !kept.includes(a)).map((a) => a.note));
      for (let i = out.length - 1; i >= 0; i--) {
        const note = out[i];
        if (note !== undefined && removed.has(note)) out.splice(i, 1);
      }
      active.length = 0;
      active.push(...kept, { end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    }
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

const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function rootOf(midi: number, key: string): number {
  const pc = KEY_PC[key.replace(/m$/, "")] ?? 0;
  const offset = ((midi - pc) % 12 + 12) % 12;
  let root = midi - offset;
  while (root < 21) root += 12; // keep the rooted bass on the piano
  return root;
}

/**
 * Generate 6 difficulty variants from a source arrangement.
 * Guarantee: each easier level is a strict simplification (subset or
 * equal notes) of the level above it.
 */
export function buildVariants(src: ParsedMidi, meta: SongMeta, opts: VariantOptions = {}): Variant[] {
  const grid = opts.grid ?? 0.25;
  const base = quantize(src.notes, { grid: 0.125, minDur: 0.05 });
  const splitSource = opts.normalizeRange === false ? base : normalizePianoRange(base);
  const { rh, lh } = splitHands(splitSource);
  const key = meta.key ?? detectKey(src.notes).name;
  const tempo = meta.tempo ?? Math.round(src.tempoBpm);

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering. Cap voices per
  // slice AND sounding span so full-band multitrack MIDIs stay a playable
  // piano texture; each easier level is then a reduction of the level above
  // so the ladder stays a true subset.
  const advanced = quantize(
    [
      ...capSoundingSpan(topVoices(rh, 0.125, 4), 12, "high"),
      ...capSoundingSpan(thinChord(lh, 4), 12, "low"),
    ],
    { grid: 0.125 },
  );
  const advancedRh = advanced.filter((n) => n.hand !== "L");
  const advancedLh = advanced.filter((n) => n.hand === "L");
  const medium = quantize(
    [
      ...capSoundingSpan(topVoices(advancedRh, 0.125, 3), 12, "high"),
      ...capSoundingSpan(thinChord(advancedLh, 3), 12, "low"),
    ],
    { grid: 0.125 },
  );
  const mediumRh = medium.filter((n) => n.hand !== "L");
  const mediumLh = medium.filter((n) => n.hand === "L");
  const easy = quantize(
    [
      ...capSoundingSpan(melodyOnly(mediumRh, 0.125, 0.5), 12, "high"),
      ...capSoundingSpan(thinChord(mediumLh, 2).map((n) => ({ ...n, midi: rootOf(n.midi, key) })), 12, "low"),
    ],
    { grid: 0.125 },
  );
  // Each easier level is a reduction of the level above it, so the ladder
  // is a true subset (same melody, same moments) instead of a re-selection
  // that drifts apart in fast passages.
  const easyRh = easy.filter((n) => n.hand !== "L");
  const easyLh = easy.filter((n) => n.hand === "L");
  const veryEasy = quantize(
    [...capSoundingSpan(melodyOnly(easyRh, 0.25, 0.5), 12, "high"), ...easyLh],
    { grid: 0.25 },
  );
  const beginner = quantize(
    capSoundingSpan(melodyOnly(veryEasy.filter((n) => n.hand !== "L"), 0.25, 0.5), 12, "high"),
    { grid: 0.25 },
  );
  const veryBeginner = quantize(capSoundingSpan(melodyOnly(beginner, 0.5, 1), 12, "high"), { grid: 0.5 });

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
