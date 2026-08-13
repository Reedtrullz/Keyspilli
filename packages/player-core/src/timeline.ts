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
  const vels = song.notes.map((n) => n.vel);
  const mean = vels.reduce((s, v) => s + v, 0) / Math.max(1, vels.length);
  const stddev = Math.sqrt(vels.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vels.length));
  // Real dynamics (stddev >= 8) pass through untouched; synthetic accent +
  // jitter is only for flat-velocity sources.
  const useRealDynamics = stddev >= 8;
  return song.notes.map((n, i) => {
    let vel = n.vel;
    if (!useRealDynamics) {
      // ponytail: metric accent + deterministic jitter for flat-velocity
      // sources; replace when sources carry real dynamics.
      const b = n.start;
      const beatAccent =
        b % 4 === 0 ? 1.15 :           // strong downbeat
        b % 4 === 2 ? 1.05 :           // secondary accent (beat 3)
        b % 1 === 0 ? 0.95 :           // weak beats (2, 4)
        0.80;                           // off-beat subdivisions
      // Deterministic jitter seeded by note index — keeps playback reproducible
      // but not robotically identical. ±5% range.
      const jitter = 1 + 0.05 * Math.sin(i * 7919);
      vel = Math.round(Math.min(127, Math.max(1, n.vel * beatAccent * jitter)));
    }
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
 * Display-time chord cleanup: re-label every chord using bass-aware naming,
 * collapse consecutive same-name runs (keeping the first), drop unlabelable
 * clusters, and drop runs shorter than `minRunBeats`.
 */
export function dedupeChords(chords: ChordLabel[], minRunBeats = 1): ChordLabel[] {
  const out: ChordLabel[] = [];
  const filtered: ChordLabel[] = [];
  for (const c of chords) {
    const pcs = [...new Set(c.notes.map((m) => m % 12))].sort((a, b) => a - b);
    const bassPc = c.notes.length > 0 ? Math.min(...c.notes) % 12 : undefined;
    const name = chordName(pcs, bassPc);
    if (!name) continue; // unlabelable cluster (chromatic flash), any size
    filtered.push({ ...c, name });
  }
  let runStart: ChordLabel | null = null;
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i]!;
    if (!runStart) runStart = c;
    const next = filtered[i + 1];
    if (next && next.name === c.name) continue; // still in the same run
    // End of run: runStart is the first chord, next is the first of a new run
    const runBeats = (next?.beat ?? runStart.beat + 1) - runStart.beat;
    if (runBeats >= minRunBeats) out.push(runStart);
    runStart = null;
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
