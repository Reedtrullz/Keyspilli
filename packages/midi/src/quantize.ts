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

type LearnerTaggedNote = Note & { learnerTraceRefs?: readonly string[] };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Choose a deterministic representative when several source notes land on
 * one quantized pitch/onset.  The old first-wins behavior made source/hand
 * metadata depend on caller array order; the longest/loudest event is the
 * least surprising representative, with lexical metadata tie-breakers.
 */
function compareCollisionRepresentative(a: Note, b: Note, aDur: number, bDur: number): number {
  return bDur - aDur
    || b.vel - a.vel
    || compareText(a.hand ?? "", b.hand ?? "")
    || compareText(a.identitySource ?? "", b.identitySource ?? "")
    || compareText(a.lyrics ?? "", b.lyrics ?? "")
    || a.start - b.start
    || a.midi - b.midi;
}

/** Snap note times to a rhythmic grid, merge unisons, drop tiny/quiet notes. */
export function quantize(notes: Note[], opts: QuantizeOptions = {}): Note[] {
  const grid = opts.grid ?? 0.25;
  const minDur = opts.minDur ?? 0.125;
  const minVel = opts.minVel ?? 8;
  const out = new Map<string, Note>();
  // Canonical processing order makes collision metadata stable under input
  // reordering while leaving single-note behavior unchanged.
  const ordered = [...notes].sort((a, b) => {
    const aStart = roundTo(a.start, grid);
    const bStart = roundTo(b.start, grid);
    const aDur = roundTo(a.start + a.dur, grid) - aStart;
    const bDur = roundTo(b.start + b.dur, grid) - bStart;
    return aStart - bStart
      || a.midi - b.midi
      || compareCollisionRepresentative(a, b, aDur, bDur);
  });
  for (const n of ordered) {
    if (n.vel < minVel) continue;
    const start = roundTo(n.start, grid);
    const dur = roundTo(n.start + n.dur, grid) - start;
    if (dur < minDur) continue; // drop sub-minDur ghosts instead of inflating them
    const key = `${n.midi}:${start.toFixed(3)}`;
    const prev = out.get(key);
    if (prev) {
      const prevRefs = (prev as LearnerTaggedNote).learnerTraceRefs ?? [];
      const nextRefs = (n as LearnerTaggedNote).learnerTraceRefs ?? [];
      const representative = compareCollisionRepresentative(prev, n, prev.dur, dur) <= 0 ? prev : n;
      if (!prevRefs.length && !nextRefs.length) {
        out.set(key, {
          ...representative,
          start,
          dur: Math.max(prev.dur, dur),
          vel: Math.max(prev.vel, n.vel),
        });
        continue;
      }
      const learnerTraceRefs = [...new Set([...prevRefs, ...nextRefs])].sort();
      const merged = {
        ...representative,
        start,
        dur: Math.max(prev.dur, dur),
        vel: Math.max(prev.vel, n.vel),
        ...(learnerTraceRefs.length ? { learnerTraceRefs } : {}),
      };
      out.set(key, merged);
    } else {
      out.set(key, { ...n, start, dur });
    }
  }
  return [...out.values()].sort((a, b) => a.start - b.start || a.midi - b.midi);
}
