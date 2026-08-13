import { Note, ParsedMidi } from "./types.js";

const SHARP_KEYS = ["C", "G", "D", "A", "E", "B", "F#", "C#"];
const FLAT_KEYS = ["C", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const MINOR_SHARP = ["A", "E", "B", "F#", "C#", "G#", "D#", "A#"];
const MINOR_FLAT = ["A", "D", "G", "C", "F", "Bb", "Eb", "Ab"];

const MAJOR_FIFTHS_BY_NAME: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
const MINOR_FIFTHS_BY_NAME: Record<string, number> = {
  A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7,
};

/** Key signature (fifths + mode) for a key name like "G", "F#m", "A minor" or "Eb". */
export function keySignature(key: string): { fifths: number; mode: 0 | 1 } {
  const trimmed = key.trim();
  const minor = /m(?:inor)?$/i.test(trimmed);
  const root = trimmed.split(/\s+/)[0]!.replace(/m$/i, "");
  const table = minor ? MINOR_FIFTHS_BY_NAME : MAJOR_FIFTHS_BY_NAME;
  return { fifths: table[root] ?? 0, mode: minor ? 1 : 0 };
}

export function keyName(sharps: number, minor: boolean): string {
  const idx = Math.abs(sharps);
  if (idx > 7) return "C";
  if (sharps >= 0) return minor ? MINOR_SHARP[idx]! + "m" : SHARP_KEYS[idx]!;
  return minor ? MINOR_FLAT[idx]! + "m" : FLAT_KEYS[idx]!;
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Krumhansl-Schmuckler key detection on note durations. */
export function detectKey(notes: Note[]): { name: string; sharps: number; mode: 0 | 1 } {
  const weights = new Array(12).fill(0);
  for (const n of notes) weights[n.midi % 12]! += n.dur;
  let best = 0;
  let bestScore = -Infinity;
  let bestMode: 0 | 1 = 0;
  for (let root = 0; root < 12; root++) {
    for (const [profile, mode] of [
      [MAJOR_PROFILE, 0],
      [MINOR_PROFILE, 1],
    ] as const) {
      let score = 0;
      for (let i = 0; i < 12; i++) score += weights[(root + i) % 12]! * profile[i]!;
      if (score > bestScore) {
        bestScore = score;
        best = root;
        bestMode = mode;
      }
    }
  }
  // fifths by root pitch class for major keys (C=0, C#=+7, Eb=-3, ...)
  const MAJOR_FIFTHS = [0, 7, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
  const sharps = bestMode === 0 ? MAJOR_FIFTHS[best]! : MAJOR_FIFTHS[(best + 3) % 12]!;
  return { name: keyName(sharps, bestMode === 1), sharps, mode: bestMode };
}

/** Name a chord from its pitch classes (bass = lowest note). */
export function chordName(pcs: number[], bassPc?: number): string {
  if (pcs.length === 0) return "";
  const candidates = bassPc !== undefined ? [bassPc, ...pcs.filter((p) => p !== bassPc)] : pcs;

  let bestName = "";
  let maxScore = -1;

  for (const r of candidates) {
    const set = [...new Set(pcs.map((p) => (p - r + 12) % 12))].sort((a, b) => a - b);
    const has = (x: number) => set.includes(x);
    let quality: string | null = null;
    let seventh = "";
    let score = 0;
    const is7 = has(10);
    const isMaj7 = has(11);

    if (has(3) && has(6)) { quality = "dim"; score = 10; }
    else if (has(4) && has(8)) { quality = "aug"; score = 10; }
    else if (has(3)) { quality = "m"; score = has(7) ? 10 : 5; }
    else if (has(4)) { quality = ""; score = has(7) ? 10 : 5; }
    else if (has(2)) { quality = "sus2"; score = has(7) ? 8 : 4; }
    else if (has(5)) { quality = "sus4"; score = has(7) ? 8 : 4; }
    else if (has(7) && !is7 && !isMaj7) { quality = "5"; score = 6; }

    if (isMaj7 && !is7) { seventh = "maj7"; score += (has(7) || has(4) || has(3) ? 6 : 2); }
    else if (is7) { seventh = "7"; score += (has(7) || has(4) || has(3) ? 6 : 2); }

    if (quality === null && !seventh) continue;
    const noQuality = !quality && !seventh;
    if ((noQuality && (pcs.length === 2 || (!has(3) && !has(4)))) || (pcs.length === 2 && !has(3) && !has(4) && !has(7))) continue;

    if (bassPc !== undefined && r === bassPc) score += 3;

    if (score > maxScore) {
      maxScore = score;
      const rootName = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][r]!;
      bestName = rootName + (quality ?? "") + seventh;
    }
  }

  return bestName;
}

/**
 * Split notes into two hand groups by pitch: cut at the largest adjacent
 * pitch gap; if no gap >= 5 semitones (e.g. a scale), cut at the gap whose
 * midpoint is closest to middle C (60).
 */
export function splitHands(notes: Note[]): { rh: Note[]; lh: Note[] } {
  if (notes.length === 0) return { rh: [], lh: [] };
  const distinct = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
  if (distinct.length < 2) {
    return { rh: notes.map((n) => ({ ...n, hand: "R" as const })), lh: [] };
  }
  const gaps = distinct.slice(0, -1).map((p, i) => ({
    a: p,
    b: distinct[i + 1]!,
    gap: distinct[i + 1]! - p,
  }));
  const maxGap = Math.max(...gaps.map((g) => g.gap));
  let chosen =
    maxGap >= 5
      ? gaps.find((g) => g.gap === maxGap)!
      : gaps.reduce((best, g) =>
          Math.abs((g.a + g.b) / 2 - 60) < Math.abs((best.a + best.b) / 2 - 60) ? g : best,
        )!;
  // If the gap split leaves one hand nearly empty (e.g. continuous-range AI
  // transcriptions), fall back to a percentile boundary so both hands get a
  // usable part: ~25% of NOTES to the left hand (note-count percentile,
  // not distinct-pitch percentile — sparse sub-bass regions would otherwise
  // starve the left hand).
  const mid0 = (chosen.a + chosen.b) / 2;
  const lhCount = notes.filter((n) => n.midi <= mid0).length;
  if (lhCount < notes.length * 0.15 || lhCount > notes.length * 0.85) {
    const sortedNotes = [...notes].sort((a, b) => a.midi - b.midi);
    const target = Math.max(1, Math.min(sortedNotes.length - 1, Math.floor(sortedNotes.length * 0.25)));
    const lo = sortedNotes[target - 1]!.midi;
    const hi = sortedNotes[target]!.midi;
    chosen = { a: lo, b: hi, gap: hi - lo };
  }
  const mid = (chosen.a + chosen.b) / 2;
  return {
    lh: notes.filter((n) => n.midi <= mid).map((n) => ({ ...n, hand: "L" as const })),
    rh: notes.filter((n) => n.midi > mid).map((n) => ({ ...n, hand: "R" as const })),
  };
}

export function detectBassPattern(lh: Note[], grid = 0.25): string {
  if (lh.length < 4) return "block";
  const byStart = new Map<number, Note[]>();
  for (const n of lh) {
    const k = Math.round(n.start / grid) * grid;
    const arr = byStart.get(k) ?? [];
    arr.push(n);
    byStart.set(k, arr);
  }
  const events = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  const avgChordSize = events.reduce((s, [, ns]) => s + ns.length, 0) / events.length;
  if (avgChordSize >= 2.6) return "block";
  const octavePairs = events.filter(([, ns]) => ns.length === 2 && Math.abs(ns[0]!.midi - ns[1]!.midi) === 12).length;
  if (octavePairs / Math.max(1, events.length) > 0.35) return "octave";
  // oompah: alternating low/high bass notes on beats 1-3 vs 2-4
  let alt = 0;
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]![1][0]!.midi;
    const cur = events[i]![1][0]!.midi;
    if (Math.abs(cur - prev) > 7 && (i % 2 === 1)) alt++;
  }
  if (alt / Math.max(1, events.length - 1) > 0.4) return "oompah";
  const single = events.filter(([, ns]) => ns.length === 1);
  let stepwise = 0;
  for (let i = 1; i < single.length; i++) {
    if (Math.abs(single[i]![1][0]!.midi - single[i - 1]![1][0]!.midi) <= 2) stepwise++;
  }
  if (single.length > 4 && stepwise / single.length > 0.5) return "walking";
  const range = Math.max(...lh.map((n) => n.midi)) - Math.min(...lh.map((n) => n.midi));
  return range < 8 ? "pedal" : "arpeggio";
}

/** Extract top-voice melody from notes within a time slice. */
export function melodyFrom(notes: Note[], grid: number): Note[] {
  const out: Note[] = [];
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  for (let i = 0; i < slices.length; i++) {
    const k = slices[i]!;
    const group = bySlice.get(k)!;
    const top = group.reduce((a, b) => (b.midi > a.midi ? b : a));
    const next = slices[i + 1];
    const gap = next === undefined ? top.dur : (next - k) * grid;
    const dur = next === undefined ? Math.min(2.5, top.dur) : Math.min(2.5, Math.max(0.25, gap <= 1.5 ? gap : Math.min(top.dur, gap)));
    out.push({ ...top, dur, hand: "R" });
  }
  return out;
}
