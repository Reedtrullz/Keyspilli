import { chordPitchClasses, tryParseChordSymbol } from "./chords.js";
import type { ChordLabel, Note } from "./types.js";

/**
 * Score a chord timeline against reference chords, the way chord-recognition
 * research does (MIREX): the share of time with the right root, the right
 * major/minor triad and the right seventh chord, plus how well the chord
 * change boundaries match. A reference chord outside a vocabulary (sus, dim,
 * aug for major/minor) is left out of that measure; an estimate outside it
 * simply counts as wrong. Gaps are "no chord".
 */
export interface TimedChord {
  startBeat: number;
  endBeat: number;
  /** Root pitch class, or null for no chord. */
  root: number | null;
  pcs: readonly number[];
}

export interface ChordScore {
  beats: number;
  root: number;
  majMin: number | null;
  sevenths: number | null;
  segmentation: number;
}

const TEMPLATES: ReadonlyArray<readonly number[]> = [
  [0, 4, 7, 10], [0, 4, 7, 11], [0, 3, 7, 10], [0, 3, 6, 10], [0, 3, 6, 9], [0, 3, 7, 11], [0, 4, 8, 10],
  [0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8], [0, 2, 7], [0, 5, 7],
];

function sameSet(a: ReadonlySet<number>, b: readonly number[]): boolean {
  return a.size === b.length && b.every((value) => a.has(value));
}

/** Name the root of a pitch-class set as a stacked template, or null. */
export function rootOfPitchClasses(pcs: Iterable<number>): number | null {
  const set = [...new Set([...pcs].map((pc) => ((pc % 12) + 12) % 12))].sort((a, b) => a - b);
  for (const template of TEMPLATES) {
    for (const root of set) {
      if (sameSet(new Set(set.map((pc) => (pc - root + 12) % 12)), template)) return root;
    }
  }
  return null;
}

/** Reference chords from a block-chord track: one chord per shared onset. */
export function chordsFromBlocks(notes: readonly Note[]): TimedChord[] {
  const blocks = new Map<number, Note[]>();
  for (const note of notes) blocks.set(note.start, [...(blocks.get(note.start) ?? []), note]);
  return [...blocks].sort(([a], [b]) => a - b).flatMap(([startBeat, block]) => {
    const pcs = [...new Set(block.map((note) => note.midi % 12))];
    const root = rootOfPitchClasses(pcs);
    return root === null ? [] : [{ startBeat, endBeat: Math.max(...block.map((note) => note.start + note.dur)), root, pcs }];
  });
}

/** Timeline from chord labels; a label without a duration lasts until the next. */
export function chordsFromLabels(labels: readonly ChordLabel[], endBeat: number): TimedChord[] {
  const ordered = [...labels].sort((a, b) => a.beat - b.beat);
  return ordered.map((label, index) => {
    const next = ordered[index + 1]?.beat ?? endBeat;
    const end = label.durationBeats !== undefined ? Math.min(next, label.beat + label.durationBeats) : next;
    const parsed = tryParseChordSymbol(label.name);
    if (!parsed) return { startBeat: label.beat, endBeat: end, root: null, pcs: [] };
    return { startBeat: label.beat, endBeat: end, root: parsed.rootPc, pcs: chordPitchClasses(parsed) };
  });
}

function at(timeline: readonly TimedChord[], beat: number): TimedChord | null {
  let low = 0, high = timeline.length - 1, found: TimedChord | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timeline[mid]!.startBeat <= beat) { found = timeline[mid]!; low = mid + 1; } else high = mid - 1;
  }
  return found && beat < found.endBeat ? found : null;
}

function intervals(chord: TimedChord): Set<number> {
  return new Set(chord.pcs.map((pc) => (pc - chord.root! + 12) % 12));
}

/** maj / min triad class (sevenths reduce to their triad); undefined outside the vocabulary. */
function majMinClass(chord: TimedChord | null): string | undefined {
  if (!chord || chord.root === null) return "N";
  const iv = intervals(chord);
  if (!iv.has(7)) return undefined;
  if (iv.has(4) && !iv.has(3)) return `${chord.root}:maj`;
  if (iv.has(3) && !iv.has(4)) return `${chord.root}:min`;
  return undefined;
}

function seventhClass(chord: TimedChord | null): string | undefined {
  const triad = majMinClass(chord);
  if (!chord || chord.root === null || triad === undefined) return triad;
  const iv = intervals(chord);
  if (iv.size === 3) return triad;
  if (iv.size !== 4) return undefined;
  if (iv.has(10)) return `${triad}7`;
  if (iv.has(11) && triad.endsWith("maj")) return `${triad}maj7`;
  return undefined;
}

function segments(timeline: readonly TimedChord[], endBeat: number): Array<[number, number]> {
  const edges = new Set<number>([0, endBeat]);
  for (const chord of timeline) {
    if (chord.startBeat > 0 && chord.startBeat < endBeat) edges.add(chord.startBeat);
    if (chord.endBeat > 0 && chord.endBeat < endBeat) edges.add(chord.endBeat);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  return sorted.slice(1).map((end, index) => [sorted[index]!, end]);
}

/** 1 minus the share of `a`'s segments not covered by the best-matching `b` segment. */
function directionalHamming(a: Array<[number, number]>, b: Array<[number, number]>, total: number): number {
  let missed = 0;
  for (const [start, end] of a) {
    let best = 0;
    for (const [s, e] of b) {
      if (e <= start) continue;
      if (s >= end) break;
      best = Math.max(best, Math.min(end, e) - Math.max(start, s));
    }
    missed += end - start - best;
  }
  return total ? missed / total : 0;
}

export function scoreChords(
  reference: readonly TimedChord[],
  estimate: readonly TimedChord[],
  endBeat: number,
  step = 0.125,
): ChordScore {
  const ref = [...reference].sort((a, b) => a.startBeat - b.startBeat);
  const est = [...estimate].sort((a, b) => a.startBeat - b.startBeat);
  let samples = 0, root = 0, majMinN = 0, majMin = 0, seventhN = 0, sevenths = 0;
  for (let beat = step / 2; beat < endBeat; beat += step) {
    const r = at(ref, beat), e = at(est, beat);
    samples++;
    if ((r?.root ?? null) === (e?.root ?? null)) root++;
    const rm = majMinClass(r);
    if (rm !== undefined) { majMinN++; if (rm === majMinClass(e)) majMin++; }
    const rs = seventhClass(r);
    if (rs !== undefined) { seventhN++; if (rs === seventhClass(e)) sevenths++; }
  }
  const refSegments = segments(ref, endBeat), estSegments = segments(est, endBeat);
  const over = directionalHamming(estSegments, refSegments, endBeat);
  const under = directionalHamming(refSegments, estSegments, endBeat);
  return {
    beats: samples * step,
    root: samples ? root / samples : 0,
    majMin: majMinN ? majMin / majMinN : null,
    sevenths: seventhN ? sevenths / seventhN : null,
    segmentation: 1 - Math.max(over, under),
  };
}
