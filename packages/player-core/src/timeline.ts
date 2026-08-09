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

export class Timeline {
  private _time = 0;
  private _speed = 1;
  loop: LoopRegion | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private durationSec: number,
    private onNoteDue: (n: TimedNote, atSec: number) => void,
    private onTick: (time: number) => void = () => {},
  ) {}

  get time(): number {
    return this._time;
  }

  get speed(): number {
    return this._speed;
  }

  setSpeed(s: number): void {
    this._speed = Math.max(0.25, Math.min(2, s));
    this.emit();
  }

  seek(t: number): void {
    this._time = Math.max(0, Math.min(this.durationSec, t));
    this.emit();
  }

  get duration(): number {
    return this.durationSec;
  }

  /** Advance by dt seconds (from requestAnimationFrame). Returns due notes. */
  advance(dt: number): TimedNote[] {
    const next = this._time + dt;
    if (this.loop && next > this.loop.endSec) {
      this._time = this.loop.startSec;
    } else {
      this._time = Math.min(next, this.durationSec);
    }
    this.emit();
    return [];
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
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
