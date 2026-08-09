import { Note } from "./types.js";

export interface QuantizeOptions {
  /** grid in beats, e.g. 0.25 = 16th notes */
  grid?: number;
  /** minimum note duration in beats to keep */
  minDur?: number;
  /** drop notes quieter than this */
  minVel?: number;
}

function roundTo(x: number, g: number): number {
  return Math.round(x / g) * g;
}

/** Snap note times to a rhythmic grid, merge unisons, drop tiny/quiet notes. */
export function quantize(notes: Note[], opts: QuantizeOptions = {}): Note[] {
  const grid = opts.grid ?? 0.25;
  const minDur = opts.minDur ?? 0.05;
  const minVel = opts.minVel ?? 8;
  const out = new Map<string, Note>();
  for (const n of notes) {
    if (n.vel < minVel) continue;
    const start = roundTo(n.start, grid);
    let dur = roundTo(n.start + n.dur, grid) - start;
    if (dur < minDur) dur = minDur;
    const key = `${n.midi}:${start.toFixed(3)}`;
    const prev = out.get(key);
    if (prev) {
      if (dur > prev.dur) out.set(key, { ...prev, dur, vel: Math.max(prev.vel, n.vel) });
    } else {
      out.set(key, { ...n, start, dur });
    }
  }
  return [...out.values()].sort((a, b) => a.start - b.start || a.midi - b.midi);
}
