import type { SongData } from "./types.js";
import { chordName, type ChordLabel } from "@keyspilli/midi";

/** Converts beat-based song data into seconds given a speed multiplier. */
export function beatToSec(beat: number, bpm: number, speed: number): number {
  return (beat * 60) / (bpm * speed);
}

export interface TimedNote {
  midi: number;
  startSec: number;
  durSec: number;
  vel: number;
  hand?: "R" | "L";
  lyrics?: string;
}

/** Resolve song data to absolute-second notes with transpose applied. */
export function resolveTimedNotes(song: SongData, speed: number, transpose: number): TimedNote[] {
  return song.notes.map((n) => {
    // ponytail: crude downbeat accent (beat-grid heuristic), not a
    // reconstruction of source dynamics; replace when sources carry velocities.
    const vel = Math.round(Math.min(127, Math.max(1, n.vel * (n.start % 1 === 0 ? 1.1 : 0.85))));
    return {
      midi: n.midi + transpose,
      startSec: beatToSec(n.start, song.tempoBpm, speed),
      durSec: beatToSec(n.dur, song.tempoBpm, speed),
      vel,
      hand: n.hand,
      lyrics: n.lyrics,
    };
  });
}

/**
 * Display-time chord cleanup for existing artifacts: collapse consecutive
 * same-name runs, drop sets with no real chord name (unlabelable dyads and
 * chromatic clusters), re-label 2-note power chords with current naming
 * ("C#" -> "C#5"), then drop runs that hold for less than `minRunBeats`
 * (per-slice harmonic flashes).
 */
export function dedupeChords(chords: ChordLabel[], minRunBeats = 1): ChordLabel[] {
  const out: ChordLabel[] = [];
  const filtered: ChordLabel[] = [];
  for (const c of chords) {
    const pcs = [...new Set(c.notes.map((m) => m % 12))].sort((a, b) => a - b);
    const name = chordName(pcs);
    if (!name) continue; // unlabelable cluster (chromatic flash), any size
    filtered.push(pcs.length === 2 ? { ...c, name } : c);
  }
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i]!;
    const next = filtered[i + 1];
    if (next && next.name === c.name) continue; // collapse same-name runs
    const runBeats = (next?.beat ?? c.beat + 1) - c.beat;
    if (runBeats < minRunBeats) continue; // transient flash: not the progression
    out.push(c);
  }
  return out;
}

export interface LoopRegion {
  startSec: number;
  endSec: number;
}

/** Seconds per beat at a given BPM and speed multiplier. */
export function secPerBeat(bpm: number, speed: number): number {
  return 60 / (bpm * speed);
}

/** Beats in one measure for a time signature (3/4 -> 3, 6/8 -> 3). */
export function beatsPerMeasure(timeSig: [number, number]): number {
  return timeSig[0] * (4 / timeSig[1]);
}

/** Index of the measure containing timeSec, clamped to the song's range. */
export function measureIndex(
  timeSec: number,
  bpm: number,
  speed: number,
  timeSig: [number, number],
  measureCount: number,
): number {
  return Math.min(
    measureCount - 1,
    Math.floor(timeSec / secPerBeat(bpm, speed) / beatsPerMeasure(timeSig)),
  );
}

/** Binary-search index of first note starting at or after t. */
export function firstNoteAtOrAfter(notes: TimedNote[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.startSec < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
