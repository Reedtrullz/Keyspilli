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

/**
 * Pitches that sound for >= 30% of the song's total duration. Basic Pitch
 * tracks sustained background layers (pads/shimmer) that re-trigger on every
 * attack; choosing them as "the melody" produces a constant-note line. Voice
 * selection prefers non-pad pitches, falling back to a pad when nothing else
 * sounds in a slice.
 */
export function padPitches(notes: Note[]): Set<number> {
  const pads = new Set<number>();
  if (!notes.length) return pads;
  const total = Math.max(...notes.map((n) => n.start + n.dur));
  const sounding = new Map<number, number>();
  for (const n of notes) sounding.set(n.midi, (sounding.get(n.midi) ?? 0) + n.dur);
  for (const [midi, dur] of sounding) {
    if (dur / total >= 0.3) pads.add(midi);
  }
  return pads;
}

function chordsAt(notes: Note[], grid: number): ChordLabel[] {
  const bySlice = new Map<number, number[]>();
  for (const n of notes) {
    if (n.dur < 0.25) continue; // passing tones are not harmony
    const k = Math.round(n.start / grid) * grid;
    const arr = bySlice.get(k) ?? [];
    arr.push(n.midi);
    bySlice.set(k, arr);
  }
  const out: ChordLabel[] = [];
  for (const [beat, mids] of [...bySlice.entries()].sort((a, b) => a[0] - b[0])) {
    const pcs = [...new Set(mids.map((m) => m % 12))].sort((a, b) => a - b);
    if (pcs.length < 2) continue;
    const bassPc = Math.min(...mids) % 12;
    const name = chordName(pcs, bassPc);
    if (!name) continue; // unlabelable dyad (root+3rd, chromatic clash, ...)
    out.push({ beat, name, notes: mids });
  }
  // Per-grid-slice analysis produces the same chord every 0.25 beats; collapse
  // consecutive same-name runs and keep only runs that hold >= 1 beat, so the
  // progression shows real changes instead of harmonic flashes.
  const kept: ChordLabel[] = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    const next = out[i + 1];
    if (next && next.name === c.name) continue;
    const runBeats = (next?.beat ?? c.beat + 1) - c.beat;
    if (runBeats < 1) continue;
    kept.push(c);
  }
  return kept;
}

/**
 * Medium-level rhythmic reduction: drop short off-eighth passing tones that
 * are not an outer voice of their hand's slice. A note is a passing tone when
 * the next same-hand onset lands < 0.25 beats after it. Slice top (melody)
 * and bottom (bass) survive; single-note slices have no outer voice, so
 * scalar 16th-note runs collapse to eighths on the grid. Selection-only (no
 * start shifts), so the ladder stays a true subset of advanced.
 */
export function reduceMediumRhythm(notes: Note[]): Note[] {
  const handOf = (n: Note) => (n.hand === "L" ? "L" : "R");
  const sliceKey = (n: Note) => `${handOf(n)}:${Math.round(n.start / 0.125)}`;
  const bySlice = new Map<string, Note[]>();
  const onsetsByHand = new Map<string, number[]>();
  for (const n of notes) {
    const key = sliceKey(n);
    const arr = bySlice.get(key) ?? [];
    arr.push(n);
    bySlice.set(key, arr);
    const hand = handOf(n);
    const onsets = onsetsByHand.get(hand) ?? [];
    onsets.push(n.start);
    onsetsByHand.set(hand, onsets);
  }
  const high = new Map<string, number>();
  const low = new Map<string, number>();
  for (const [key, ns] of bySlice) {
    high.set(key, Math.max(...ns.map((n) => n.midi)));
    low.set(key, Math.min(...ns.map((n) => n.midi)));
  }
  const sortedOnsets = new Map<string, number[]>();
  for (const [hand, onsets] of onsetsByHand) {
    sortedOnsets.set(hand, [...new Set(onsets)].sort((a, b) => a - b));
  }
  return notes.filter((n) => {
    const hand = handOf(n);
    const key = sliceKey(n);
    const k = Math.round(n.start / 0.125);
    // Passing tones are defined by onset spacing: a sustained note attacked
    // 0.125 beats after an off-eighth start is still a passing tone.
    if (k % 2 !== 1) return true;
    const ns = bySlice.get(key)!;
    const isOuter = ns.length >= 2 && (n.midi === high.get(key) || n.midi === low.get(key));
    if (isOuter) return true;
    const next = sortedOnsets.get(hand)!.find((o) => o > n.start + 1e-9);
    return next === undefined || next - n.start >= 0.25;
  });
}

export function melodyOnly(notes: Note[], grid: number, minDur: number, pads?: Set<number>): Note[] {
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
    // Prefer the highest non-pad voice; a sustained background pad is not the
    // melody. Fall back to the pad when it is the only note sounding.
    const nonPad = pads ? group.filter((n) => !pads.has(n.midi)) : group;
    const top = (nonPad.length ? nonPad : group).reduce((a, b) => (b.midi > a.midi ? b : a));
    const next = slices[i + 1];
    // Cap the legato fill: stretching across rests makes sparse sections ring
    // for 10+ seconds. Notes keep their attack, rests stay rests.
    const gap = next === undefined ? top.dur : (next - k) * grid;
    const dur = next === undefined ? Math.max(minDur, Math.min(2.5, top.dur)) : Math.min(2.5, Math.max(minDur, gap <= 1.5 ? gap : Math.min(top.dur, gap)));
    out.push({ ...top, dur });
  }
  return out;
}

/** Keep the highest `keep` voices per slice; pad pitches rank below real voices. */
function topVoices(notes: Note[], grid: number, keep: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const ns of bySlice.values()) {
    const sorted = [...ns].sort((a, b) => {
      const pa = pads?.has(a.midi) ? 1 : 0;
      const pb = pads?.has(b.midi) ? 1 : 0;
      return pa - pb || b.midi - a.midi;
    });
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
  const base = quantize(src.notes, { grid: 0.125, minDur: 0.125 });
  const splitSource = opts.normalizeRange === false ? base : normalizePianoRange(base);
  const { rh, lh } = splitHands(splitSource);
  const key = meta.key ?? detectKey(src.notes).name;
  const tempo = meta.tempo ?? Math.round(src.tempoBpm);
  const pads = padPitches(splitSource);

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering. Cap voices per
  // slice AND sounding span so full-band multitrack MIDIs stay a playable
  // piano texture; each easier level is then a reduction of the level above
  // so the ladder stays a true subset.
  const advanced = quantize(
    [
      ...capSoundingSpan(topVoices(rh, 0.125, 4, pads), 12, "high"),
      ...capSoundingSpan(thinChord(lh, 4), 12, "low"),
    ],
    { grid: 0.125 },
  );
  const advancedRh = advanced.filter((n) => n.hand !== "L");
  const advancedLh = advanced.filter((n) => n.hand === "L");
  const medium = quantize(
    reduceMediumRhythm([
      ...capSoundingSpan(topVoices(advancedRh, 0.125, 3, pads), 12, "high"),
      ...capSoundingSpan(thinChord(advancedLh, 3), 12, "low"),
    ]),
    { grid: 0.125 },
  );
  const mediumRh = medium.filter((n) => n.hand !== "L");
  const mediumLh = medium.filter((n) => n.hand === "L");
  const easy = quantize(
    [
      ...capSoundingSpan(melodyOnly(mediumRh, 0.125, 0.5, pads), 12, "high"),
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
    [...capSoundingSpan(melodyOnly(easyRh, 0.25, 0.5, pads), 12, "high"), ...easyLh],
    { grid: 0.25 },
  );
  const beginner = quantize(
    capSoundingSpan(melodyOnly(veryEasy.filter((n) => n.hand !== "L"), 0.25, 0.5, pads), 12, "high"),
    { grid: 0.25 },
  );
  const veryBeginner = quantize(capSoundingSpan(melodyOnly(beginner, 0.5, 1, pads), 12, "high"), { grid: 0.5 });

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
