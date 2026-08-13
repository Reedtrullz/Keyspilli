import { Note } from "./types.js";
import { splitHands } from "./analyze.js";

export interface CleanOptions {
  /** drop notes quieter than this velocity (0-127) */
  minVel?: number;
  /** drop notes shorter than this (beats) */
  minDurBeats?: number;
  /** merge same-pitch notes whose starts are within this window (beats) */
  mergeWindow?: number;
  /** drop quietest notes when more than this many sound at once */
  maxPolyphony?: number;
  /** hard bound on simultaneously sounding notes (kills transcription walls) */
  maxSounding?: number;
  /** cap notes held longer than this (beats); Basic Pitch tracks sustained
   * pads/background tones as minutes-long piano notes that drone */
  maxDurBeats?: number;
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
  const maxSounding = opts.maxSounding ?? 8;
  const maxDurBeats = opts.maxDurBeats ?? 2;

  let out = notes
    .filter((n) => n.vel >= minVel && n.dur >= minDurBeats)
    .map((n) => (n.dur > maxDurBeats ? { ...n, dur: maxDurBeats } : n));
  out = mergeNearDuplicates(out, mergeWindow);
  out = capPolyphony(out, maxPolyphony);
  out = capSoundingPolyphony(out, maxSounding);
  out = capHandOverlaps(out, maxDurBeats);
  return out;
}

/** Truncate note durations so sequential notes/chords in the same hand do not overlap past the next attack. */
export function capHandOverlaps(notes: Note[], maxDurBeats = 2.0): Note[] {
  const { rh, lh } = splitHands(notes);
  return [...truncateHand(rh, maxDurBeats), ...truncateHand(lh, maxDurBeats)].sort(
    (a, b) => a.start - b.start || a.midi - b.midi,
  );
}

function truncateHand(notes: Note[], maxDurBeats: number): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const slices: { start: number; notes: Note[] }[] = [];
  for (const n of sorted) {
    const last = slices[slices.length - 1];
    if (last && Math.abs(last.start - n.start) < 0.01) {
      last.notes.push(n);
    } else {
      slices.push({ start: n.start, notes: [n] });
    }
  }
  const out: Note[] = [];
  for (let i = 0; i < slices.length; i++) {
    const curr = slices[i]!;
    const next = slices[i + 1];
    const timeToNext = next ? next.start - curr.start : maxDurBeats;
    for (const n of curr.notes) {
      let dur = n.dur;
      if (next && dur > timeToNext) dur = Math.min(dur, Math.max(timeToNext, 0.25));
      dur = Math.min(dur, maxDurBeats);
      out.push({ ...n, dur: Math.max(0.125, dur) });
    }
  }
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

/**
 * Bound the number of notes SOUNDING at any instant. AI transcriptions of
 * dense productions can produce walls of 30+ simultaneous notes that no
 * pianist could play; this drops the quietest offenders so the result stays
 * within what two hands can actually do.
 */
export function capSoundingPolyphony(notes: Note[], maxSounding: number): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: Note[] = [];
  const active: Note[] = [];
  for (const n of sorted) {
    // drop expired notes
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.start + active[i]!.dur <= n.start) active.splice(i, 1);
    }
    if (active.length < maxSounding) {
      active.push(n);
      out.push(n);
      continue;
    }
    // at capacity: keep the louder of (quietest active, new note)
    const quietestIdx = active.reduce((bi, x, i) => (x.vel < active[bi]!.vel ? i : bi), 0);
    if (n.vel >= active[quietestIdx]!.vel) {
      out.splice(out.indexOf(active[quietestIdx]!), 1);
      active.splice(quietestIdx, 1);
      active.push(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
