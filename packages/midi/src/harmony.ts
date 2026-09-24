import { chordToNotes } from "./chords.js";
import type { ChordLabel, Note } from "./types.js";

/**
 * Whole-arrangement harmony labels for the Chords backing.
 *
 * The earlier generator named each onset from the notes struck there, which
 * holds stale labels through arpeggios and single-note bass lines and reads
 * left-hand fifths as power chords. This labeler scores every candidate chord
 * against all notes sounding in each half bar (whole bar for odd meters),
 * weighted by duration plus the lowest sounding note, then picks the
 * best-scoring path with a penalty per change. Every note is evidence,
 * including the sung line, because a backing that fights the melody is
 * wrong. Only chord names leave this function, so no source note is copied
 * into the backing. Segments with nothing sounding, and a short pickup bar,
 * become N.C.
 */

interface Template { name: string; root: number; pcs: ReadonlySet<number>; size: number; cost: number }

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MIXED = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);
const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Plain triads are the default; a colour or suspended chord must earn its
// extra tone because a wrong seventh clashes more than an omitted one.
const QUALITIES: ReadonlyArray<readonly [string, readonly number[], number]> = [
  ["", [0, 4, 7], 0],
  ["m", [0, 3, 7], 0],
  ["7", [0, 4, 7, 10], 0.08],
  ["m7", [0, 3, 7, 10], 0.1],
  ["maj7", [0, 4, 7, 11], 0.14],
  ["sus4", [0, 5, 7], 0.15],
  ["dim", [0, 3, 6], 0.18],
];

const CHANGE_PENALTY = 0.35;
const OUTSIDE_WEIGHT = 0.6;
const BASS_WEIGHT = 0.3;
const PRESENCE_WEIGHT = 0.15;
const NON_DIATONIC_COST = 0.06;

export interface HarmonySegment { startBeat: number; endBeat: number }

function parseKey(key: string | undefined): { tonic: number; minor: boolean } | null {
  const match = /^([A-G])([#b]?)(m?)$/.exec(key?.trim() ?? "");
  if (!match) return null;
  return { tonic: (PITCH[match[1]!]! + (match[2] === "#" ? 1 : match[2] === "b" ? 11 : 0)) % 12, minor: match[3] === "m" };
}

function scale(key: { tonic: number; minor: boolean } | null): ReadonlySet<number> | null {
  if (!key) return null;
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]; // minor keeps its leading tone
  return new Set(steps.map((step) => (key.tonic + step) % 12));
}

function templates(key: string | undefined): Template[] {
  const names = key === undefined || parseKey(key) === null ? MIXED : FLAT_KEYS.has(key) ? FLAT : SHARP;
  const diatonic = scale(parseKey(key));
  return QUALITIES.flatMap(([quality, intervals, cost]) => names.map((root, rootPc) => {
    const pcs = new Set(intervals.map((interval) => (interval + rootPc) % 12));
    const outside = diatonic !== null && [...pcs].some((pc) => !diatonic.has(pc));
    return { name: root + quality, root: rootPc, pcs, size: intervals.length, cost: cost + (outside ? NON_DIATONIC_COST : 0) };
  }));
}

/** Half bars in even meters of four or more beats; whole bars otherwise. */
export function harmonySegments(measures: readonly HarmonySegment[]): HarmonySegment[] {
  return measures.flatMap(({ startBeat, endBeat }) => {
    const length = endBeat - startBeat;
    if (!(length > 0)) return [];
    if (length >= 4 && length % 2 === 0) {
      const half = startBeat + length / 2;
      return [{ startBeat, endBeat: half }, { startBeat: half, endBeat }];
    }
    return [{ startBeat, endBeat }];
  });
}

function evidence(notes: readonly Note[], startBeat: number, endBeat: number) {
  const weights = new Array<number>(12).fill(0);
  const bass = new Array<number>(12).fill(0);
  let total = 0;
  const onsets = new Set<number>();
  for (const note of notes) {
    const overlap = Math.min(endBeat, note.start + note.dur) - Math.max(startBeat, note.start);
    if (overlap <= 0) continue;
    weights[note.midi % 12]! += overlap;
    total += overlap;
    if (note.start >= startBeat) onsets.add(note.start);
  }
  for (const onset of onsets) {
    let lowest = Infinity;
    for (const note of notes) if (note.start <= onset && onset < note.start + note.dur) lowest = Math.min(lowest, note.midi);
    bass[lowest % 12]! += 1 / onsets.size;
  }
  return { weights, bass, total };
}

function score(template: Template, observed: ReturnType<typeof evidence>): number {
  let inside = 0, present = 0;
  for (const pc of template.pcs) {
    inside += observed.weights[pc]!;
    if (observed.weights[pc]! > 0.05 * observed.total) present++;
  }
  const outside = observed.total - inside;
  return (inside - OUTSIDE_WEIGHT * outside) / observed.total
    + BASS_WEIGHT * observed.bass[template.root]!
    + PRESENCE_WEIGHT * (present / template.size)
    - template.cost;
}

/**
 * Label `measures` of `notes` with one chord (or N.C.) per segment path.
 * Measures should be the arrangement's own bars so meter changes and pickups
 * keep their phase; pass an empty list only for measure-less legacy data.
 */
export function inferHarmonyTimeline(
  notes: readonly Note[],
  measures: readonly HarmonySegment[],
  options: { key?: string } = {},
): ChordLabel[] {
  const segments = harmonySegments(measures);
  if (!segments.length) return [];
  // A pickup bar shorter than the bar after it is melody alone.
  const [first, second] = measures;
  const pickupEnd = first && second && first.endBeat - first.startBeat < second.endBeat - second.startBeat ? first.endBeat : -Infinity;
  const sorted = [...notes].filter((note) => note.dur > 0).sort((a, b) => a.start - b.start);
  const candidates = templates(options.key);
  const rest = candidates.length;
  let previous = new Array<number>(rest + 1).fill(0);
  const back: number[][] = [];
  for (const segment of segments) {
    // Notes that could overlap this segment; `sorted` is by start.
    const local = sorted.filter((note) => note.start < segment.endBeat && note.start + note.dur > segment.startBeat);
    const observed = evidence(local, segment.startBeat, segment.endBeat);
    let best = 0;
    for (let k = 1; k <= rest; k++) if (previous[k]! > previous[best]!) best = k;
    const current = new Array<number>(rest + 1);
    const from = new Array<number>(rest + 1);
    for (let k = 0; k <= rest; k++) {
      const silent = observed.total === 0 || segment.endBeat <= pickupEnd;
      const gain = silent ? (k === rest ? 0.5 : -1) : k === rest ? -1 : score(candidates[k]!, observed);
      const stay = previous[k]!;
      const change = previous[best]! - CHANGE_PENALTY;
      current[k] = Math.max(stay, change) + gain;
      from[k] = stay >= change ? k : best;
    }
    back.push(from);
    previous = current;
  }
  let state = 0;
  for (let k = 1; k <= rest; k++) if (previous[k]! > previous[state]!) state = k;
  const path = new Array<number>(segments.length);
  for (let i = segments.length - 1; i >= 0; i--) {
    path[i] = state;
    state = back[i]![state]!;
  }
  const out: ChordLabel[] = [];
  path.forEach((k, i) => {
    const segment = segments[i]!;
    const name = k === rest ? "N.C." : candidates[k]!.name;
    const last = out[out.length - 1];
    if (last && last.name === name && last.beat + last.durationBeats! === segment.startBeat) {
      last.durationBeats! += segment.endBeat - segment.startBeat;
      return;
    }
    out.push({
      beat: segment.startBeat,
      durationBeats: segment.endBeat - segment.startBeat,
      name,
      notes: k === rest ? [] : chordToNotes(name, { octave: 4, bassOctave: 3, includeBass: true, maxNotes: 4 }),
      sourceKind: "generated",
      inferred: true,
      inferenceType: "harmony-window",
    });
  });
  return out;
}
