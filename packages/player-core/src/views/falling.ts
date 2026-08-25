import type { TimedNote } from "../timeline.js";
import { pitchColor, type MeasureInfo } from "@keyspilli/midi";

export interface KeyboardGeometry {
  whiteKeys: number[]; // midi of white keys
  blackKeys: number[]; // midi of black keys
  whiteWidth: number;
  blackWidth: number;
  whiteHeight: number;
  blackHeight: number;
}

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Short pitch label: letter for keys, octave appended on C (C4, C#4...). */
export function noteLabel(midi: number): string {
  const pc = NAMES[midi % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return pc === "C" ? `${pc}${octave}` : pc;
}

export function keyboardGeometry(lowMidi: number, highMidi: number, width: number, whiteHeight = 160): KeyboardGeometry {
  const whites: number[] = [];
  const blacks: number[] = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    if (WHITE.includes(m % 12)) whites.push(m);
    else blacks.push(m);
  }
  const whiteWidth = width / whites.length;
  return {
    whiteKeys: whites,
    blackKeys: blacks,
    whiteWidth,
    blackWidth: whiteWidth * 0.62,
    whiteHeight,
    blackHeight: whiteHeight * 0.62,
  };
}

/**
 * Geometry shared by the falling-note and keyboard renderers.
 *
 * FallingCanvas calls both helpers once per animation frame. Rebuilding the
 * white/black key arrays and searching them with `indexOf` for every visible
 * note made that hot path scale with (notes x keyboard width). Keep a small,
 * bounded cache keyed by the immutable layout inputs and precompute each
 * MIDI-to-x lookup once. The returned data is treated as read-only by the
 * renderers; callers of the public helpers still receive fresh result objects
 * where they did before.
 */
interface CachedKeyboardLayout {
  geometry: KeyboardGeometry;
  xByMidi: Map<number, number>;
}

const KEYBOARD_LAYOUT_CACHE_LIMIT = 32;
const keyboardLayoutCache = new Map<string, CachedKeyboardLayout>();

function keyboardLayout(lowMidi: number, highMidi: number, width: number, whiteHeight = 160): CachedKeyboardLayout {
  const key = `${lowMidi}:${highMidi}:${width}:${whiteHeight}`;
  const cached = keyboardLayoutCache.get(key);
  if (cached) {
    // Keep frequently used ranges near the end of the bounded LRU.
    keyboardLayoutCache.delete(key);
    keyboardLayoutCache.set(key, cached);
    return cached;
  }

  const geometry = keyboardGeometry(lowMidi, highMidi, width, whiteHeight);
  const whiteIndex = new Map(geometry.whiteKeys.map((midi, index) => [midi, index]));
  const xByMidi = new Map<number, number>();
  for (const midi of geometry.whiteKeys) {
    xByMidi.set(midi, (whiteIndex.get(midi) ?? 0) * geometry.whiteWidth);
  }
  for (const midi of geometry.blackKeys) {
    const previous = whiteIndex.get(midi - 1);
    // Preserve the legacy negative x for a black key whose preceding white
    // key falls just outside the requested range. Falling bars skip it while
    // keyboardRects lets the browser clip it at the edge as before.
    xByMidi.set(midi, (previous ?? -1) * geometry.whiteWidth + geometry.whiteWidth - geometry.blackWidth / 2);
  }

  const layout = { geometry, xByMidi };
  keyboardLayoutCache.set(key, layout);
  while (keyboardLayoutCache.size > KEYBOARD_LAYOUT_CACHE_LIMIT) {
    const oldest = keyboardLayoutCache.keys().next().value;
    if (oldest === undefined) break;
    keyboardLayoutCache.delete(oldest);
  }
  return layout;
}

export interface FallingBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  midi: number;
  label: string;
  hand?: "R" | "L";
}

export interface FallingLayoutOptions {
  width: number;
  height: number;
  nowSec: number;
  speed: number;
  lookaheadSec: number;
  lowMidi: number;
  highMidi: number;
}

/**
 * A small interval index for the falling-note viewport.
 *
 * Timelines produced by the catalog are sorted by start time. Keeping the
 * prefix maximum end time lets the renderer skip notes that have already
 * finished while still including a long note that started before the
 * viewport. Hand-authored/test timelines are allowed to be unsorted; those
 * keep the old linear path so render order and edge semantics remain exact.
 */
export interface FallingNoteIndex {
  readonly notes: TimedNote[];
  readonly sorted: boolean;
  /** Start times, present for sorted timelines. */
  readonly starts: readonly number[];
  /** Prefix maximum of startSec + durSec, present for sorted timelines. */
  readonly prefixMaxEnd: readonly number[];
}

export function createFallingNoteIndex(notes: TimedNote[]): FallingNoteIndex {
  let sorted = true;
  const starts = new Array<number>(notes.length);
  const prefixMaxEnd = new Array<number>(notes.length);
  let maxEnd = Number.NEGATIVE_INFINITY;
  let previousStart = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    const start = note.startSec;
    starts[i] = start;
    if (!Number.isFinite(start) || start < previousStart) sorted = false;
    previousStart = start;
    const end = start + note.durSec;
    if (end > maxEnd) maxEnd = end;
    prefixMaxEnd[i] = maxEnd;
  }
  return { notes, sorted, starts, prefixMaxEnd };
}

function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Return the sorted-note bounds that can overlap a falling viewport. */
export function fallingNoteRange(
  index: FallingNoteIndex,
  nowSec: number,
  lookaheadSec: number,
  endGraceSec = 0.05,
  out: { start: number; end: number } = { start: 0, end: 0 },
): { start: number; end: number } {
  if (!index.sorted) {
    out.start = 0;
    out.end = index.notes.length;
    return out;
  }
  out.start = lowerBound(index.prefixMaxEnd, nowSec - endGraceSec);
  out.end = upperBound(index.starts, nowSec + lookaheadSec);
  return out;
}

/**
 * Draw bars using a prebuilt note index. The optional output array is cleared
 * and reused by the caller to avoid one hot-loop array allocation per frame.
 */
export function fallingBarsIndexed(
  index: FallingNoteIndex,
  o: FallingLayoutOptions,
  out: FallingBar[] = [],
): FallingBar[] {
  if (!index.sorted) return fallingBars(index.notes, o, out);
  const layout = keyboardLayout(o.lowMidi, o.highMidi, o.width);
  const { geometry: geo, xByMidi } = layout;
  const pxPerSec = o.height / o.lookaheadSec;
  const rangeStart = lowerBound(index.prefixMaxEnd, o.nowSec - 0.05);
  const rangeEnd = upperBound(index.starts, o.nowSec + o.lookaheadSec);
  out.length = 0;
  for (let i = rangeStart; i < rangeEnd; i++) {
    const n = index.notes[i]!;
    if (n.startSec + n.durSec < o.nowSec - 0.05) continue;
    // Preserve the legacy edge behavior for a black note immediately above
    // the requested range: its preceding white key may still be visible.
    let x = xByMidi.get(n.midi);
    if (x === undefined) {
      const previous = !WHITE.includes(n.midi % 12) ? xByMidi.get(n.midi - 1) : undefined;
      x = previous === undefined ? -100 : previous + geo.whiteWidth - geo.blackWidth / 2;
    }
    if (x < 0) continue;
    const isBlack = !WHITE.includes(n.midi % 12);
    const bottom = o.height - (n.startSec - o.nowSec) * pxPerSec;
    const height = Math.max(6, n.durSec * pxPerSec - 2);
    const y = bottom - height;
    out.push({
      x,
      y,
      width: isBlack ? geo.blackWidth : geo.whiteWidth * 0.92,
      height,
      color: pitchColor(n.midi),
      midi: n.midi,
      label: noteLabel(n.midi),
      hand: n.hand,
    });
  }
  return out;
}

/** Map notes to falling bars for the given viewport + time window. */
export function fallingBars(notes: TimedNote[], o: FallingLayoutOptions, out: FallingBar[] = []): FallingBar[] {
  const layout = keyboardLayout(o.lowMidi, o.highMidi, o.width);
  const { geometry: geo, xByMidi } = layout;
  const pxPerSec = o.height / o.lookaheadSec;
  out.length = 0;
  for (const n of notes) {
    if (n.startSec > o.nowSec + o.lookaheadSec || n.startSec + n.durSec < o.nowSec - 0.05) continue;
    // Preserve the legacy edge behavior for a black note immediately above
    // the requested range: its preceding white key may still be visible.
    // Normal in-range notes take the precomputed map without any search.
    let x = xByMidi.get(n.midi);
    if (x === undefined) {
      const previous = !WHITE.includes(n.midi % 12) ? xByMidi.get(n.midi - 1) : undefined;
      x = previous === undefined ? -100 : previous + geo.whiteWidth - geo.blackWidth / 2;
    }
    if (x < 0) continue;
    const isBlack = !WHITE.includes(n.midi % 12);
    // Notes fall DOWN toward the keyboard. The note's leading edge is its
    // BOTTOM: it lands exactly on the playhead (y == o.height) at the note's
    // start time, and the bar extends UPWARD for the note's duration.
    const bottom = o.height - (n.startSec - o.nowSec) * pxPerSec;
    const height = Math.max(6, n.durSec * pxPerSec - 2);
    const y = bottom - height;
    out.push({
      x,
      y,
      width: isBlack ? geo.blackWidth : geo.whiteWidth * 0.92,
      height,
      color: pitchColor(n.midi),
      midi: n.midi,
      label: noteLabel(n.midi),
      hand: n.hand,
    });
  }
  return out;
}

/**
 * Keyboard range for one measure (plus a beat of overlap), so the piano stays
 * put while playing through the measure instead of re-centering every frame.
 * Wide measures expand to the complete piano range used by the measure (up
 * to the 88-key MIDI bounds) instead of silently dropping notes outside a
 * median-centered window; empty measures return the previous range.
 */
export function measureMidiRange(
  notes: TimedNote[],
  measures: MeasureInfo[],
  tempoBpm: number,
  speed: number,
  measureIdx: number,
  fallback: { lowMidi: number; highMidi: number },
  _maxSpan = 54,
): { lowMidi: number; highMidi: number } {
  const m = measures[measureIdx];
  if (!m) return fallback;
  const next = measures[measureIdx + 1];
  const secPerBeat = 60 / (tempoBpm * speed);
  const startSec = m.startBeat * secPerBeat;
  const endSec = (next?.endBeat ?? m.endBeat) * secPerBeat;
  const mids: number[] = [];
  for (const n of notes) {
    if (n.startSec < endSec && n.startSec + n.durSec >= startSec) mids.push(n.midi);
  }
  if (mids.length === 0) return fallback;
  mids.sort((a, b) => a - b);
  let lowMidi = mids[0]! - 3;
  let highMidi = mids[mids.length - 1]! + 3;
  // Older versions centered a 54-semitone window on the median here. That
  // made xOf() return -100 for legitimate notes at either edge of a wide
  // measure, so the falling view silently omitted attacks. Keep the argument
  // for API compatibility, but prefer a complete range (capped only by the
  // real 88-key piano limits) so every note remains renderable.
  void _maxSpan;
  return {
    lowMidi: Math.max(21, lowMidi),
    highMidi: Math.min(108, highMidi),
  };
}

/** Timeline index for chord labels drawn alongside the falling notes. */
export interface FallingChordIndex<T extends { beat: number }> {
  readonly events: T[];
  readonly sorted: boolean;
  readonly beats: readonly number[];
}

export function createFallingChordIndex<T extends { beat: number }>(events: T[]): FallingChordIndex<T> {
  let sorted = true;
  const beats = new Array<number>(events.length);
  let previous = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < events.length; i++) {
    const beat = events[i]!.beat;
    beats[i] = beat;
    if (!Number.isFinite(beat) || beat < previous) sorted = false;
    previous = beat;
  }
  return { events, sorted, beats };
}

/** Last chord event at or before a beat, preserving duplicate-beat order. */
export function lastFallingChordIndex<T extends { beat: number }>(index: FallingChordIndex<T>, beat: number): number {
  if (!index.sorted) {
    for (let i = index.events.length - 1; i >= 0; i--) {
      if (beat >= index.events[i]!.beat) return i;
    }
    return -1;
  }
  return upperBound(index.beats, beat) - 1;
}

/** Sorted chord bounds for a visible beat interval. */
export function fallingChordRange<T extends { beat: number }>(
  index: FallingChordIndex<T>,
  startBeat: number,
  endBeat: number,
  out: { start: number; end: number } = { start: 0, end: 0 },
): { start: number; end: number } {
  if (!index.sorted) {
    out.start = 0;
    out.end = index.events.length;
    return out;
  }
  out.start = lowerBound(index.beats, startBeat);
  out.end = upperBound(index.beats, endBeat);
  return out;
}

/** MIDI notes whose bars will cross the playhead within `windowSec`. */
export function upcomingMidi(
  bars: FallingBar[],
  areaHeight: number,
  lookaheadSec: number,
  windowSec = 1,
  out: Set<number> = new Set(),
): Set<number> {
  const pxPerSec = areaHeight / lookaheadSec;
  out.clear();
  for (const b of bars) {
    const distToPlayhead = areaHeight - (b.y + b.height);
    if (distToPlayhead > 0 && distToPlayhead < pxPerSec * windowSec) out.add(b.midi);
  }
  return out;
}

/** Keyboard row geometry for drawing the on-screen keyboard. */
export function keyboardRects(o: { width: number; lowMidi: number; highMidi: number; whiteHeight: number }): {
  whites: { midi: number; x: number; w: number }[];
  blacks: { midi: number; x: number; w: number }[];
  whiteWidth: number;
} {
  const { geometry: geo, xByMidi } = keyboardLayout(o.lowMidi, o.highMidi, o.width, o.whiteHeight);
  return {
    whites: geo.whiteKeys.map((midi, i) => ({ midi, x: i * geo.whiteWidth, w: geo.whiteWidth })),
    blacks: geo.blackKeys.map((midi) => {
      return { midi, x: xByMidi.get(midi) ?? -100, w: geo.blackWidth };
    }),
    whiteWidth: geo.whiteWidth,
  };
}

export { pitchColor };
