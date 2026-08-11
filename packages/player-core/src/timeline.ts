import type { SongData } from "./types.js";

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
  return song.notes.map((n) => ({
    midi: n.midi + transpose,
    startSec: beatToSec(n.start, song.tempoBpm, speed),
    durSec: beatToSec(n.dur, song.tempoBpm, speed),
    vel: n.vel,
    hand: n.hand,
    lyrics: n.lyrics,
  }));
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
