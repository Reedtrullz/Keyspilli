import { Note } from "./types.js";

export interface CleanOptions {
  /** drop notes quieter than this velocity (0-127) */
  minVel?: number;
  /** drop notes shorter than this (beats) */
  minDurBeats?: number;
  /** merge same-pitch notes whose starts are within this window (beats) */
  mergeWindow?: number;
  /** drop quietest notes when more than this many sound at once */
  maxPolyphony?: number;
}

/**
 * Post-process AI-transcribed note lists (Basic Pitch output). Removes the
 * typical false positives: very short/quiet ghost notes, same-pitch notes
 * re-triggered by the model (attack transients), and excessive simultaneous
 * voicing from pedal resonance. Human-made MIDI files should NOT go through
 * this (it would eat real grace notes and quiet dynamics).
 */
export function cleanTranscription(notes: Note[], opts: CleanOptions = {}): Note[] {
  const minVel = opts.minVel ?? 30;
  const minDurBeats = opts.minDurBeats ?? 0.14;
  const mergeWindow = opts.mergeWindow ?? 0.125;
  const maxPolyphony = opts.maxPolyphony ?? 6;

  let out = notes.filter((n) => n.vel >= minVel && n.dur >= minDurBeats);
  out = mergeNearDuplicates(out, mergeWindow);
  out = capPolyphony(out, maxPolyphony);
  return out;
}

/** Merge same-pitch notes with starts within `window` beats (keep longest). */
export function mergeNearDuplicates(notes: Note[], window: number): Note[] {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi || a.start - b.start);
  const out: Note[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.midi === n.midi && n.start - prev.start < window) {
      // keep the longest note, extending to cover both
      const end = Math.max(prev.start + prev.dur, n.start + n.dur);
      out[out.length - 1] = {
        ...prev,
        dur: Math.max(prev.dur, end - prev.start),
        vel: Math.max(prev.vel, n.vel),
      };
    } else {
      out.push(n);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** At any instant, drop the quietest notes beyond maxPolyphony. */
export function capPolyphony(notes: Note[], maxPolyphony: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / 0.125) * 0.125;
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const [k, ns] of bySlice) {
    if (ns.length <= maxPolyphony) {
      out.push(...ns);
      continue;
    }
    const sorted = [...ns].sort((a, b) => b.vel - a.vel);
    out.push(...sorted.slice(0, maxPolyphony));
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
