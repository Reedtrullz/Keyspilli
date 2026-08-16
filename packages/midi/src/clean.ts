import { Note } from "./types.js";
import { splitHands } from "./analyze.js";

/**
 * Defaults used by the Basic Pitch transcription cleanup pass.
 *
 * Keep these values in one exported object so the worker's provenance and the
 * actual cleanup implementation cannot quietly drift apart. These are
 * separate from the imported-MIDI safety defaults below: transcriptions may
 * discard quiet/short events, while human-authored MIDI should retain them.
 */
export const TRANSCRIPTION_CLEANUP_CONFIG = {
  minVelocity: 30,
  minDurationBeats: 0.14,
  mergeWindowBeats: 0.125,
  maxPolyphony: 6,
  maxSounding: 8,
  maxDurationSec: 2.5,
} as const;

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
  /** source tempo, for a SECONDS-based duration ceiling (a beat cap of 8 is
   * 6.4s at 75 BPM but only 2.7s at 180; slow songs need a shorter cap) */
  tempoBpm?: number;
  /** max sustain in seconds when tempoBpm is provided */
  maxDurSec?: number;
}

/** Default hard ceiling for human-authored imported sustains. */
export const DEFAULT_IMPORTED_MAX_DUR_SEC = 4;
/** A piano arrangement should never require more than this many held notes. */
export const DEFAULT_IMPORTED_MAX_SOUNDING = 12;

/**
 * Effective duration ceiling used by cleanTranscription when tempo is known.
 * Exporting the calculation lets provenance record the value that was
 * actually applied, rather than only the seconds-based input constant.
 */
export function transcriptionMaxDurationBeats(
  tempoBpm: number,
  maxDurSec: number = TRANSCRIPTION_CLEANUP_CONFIG.maxDurationSec,
): number {
  return Math.min(8, Math.max(2, Math.round((maxDurSec * tempoBpm) / 60)));
}

/**
 * Convert a real-time sustain ceiling into beats while keeping the result
 * bounded for malformed tempos. This is shared by import sanitization and
 * validation so a note cannot pass generation and then fail publication.
 */
export function maxDurationBeatsForTempo(
  tempoBpm: number | undefined,
  maxDurSec = DEFAULT_IMPORTED_MAX_DUR_SEC,
): number {
  const tempo = Number(tempoBpm);
  const seconds = Number(maxDurSec);
  if (!Number.isFinite(tempo) || tempo <= 0 || !Number.isFinite(seconds) || seconds <= 0) return 8;
  return Math.min(8, Math.max(2, Math.round((seconds * tempo) / 60)));
}

export interface ImportedSanitizeOptions {
  /** source tempo used to make the sustain ceiling tempo-aware */
  tempoBpm?: number;
  /**
   * Explicit sustain ceiling in beats. `null` disables duration capping for a
   * human-authored source; omitting it keeps the historical safety default for
   * direct callers that do not know the source provenance.
   */
  maxDurBeats?: number | null;
  /** sustain ceiling in seconds when maxDurBeats is omitted (not when null) */
  maxDurSec?: number;
  /** maximum number of notes allowed to overlap at any instant */
  maxSounding?: number;
}

/**
 * Conservative cleanup for every imported MIDI/MusicXML source.
 *
 * Unlike cleanTranscription(), this does not remove quiet notes, merge close
 * re-strikes, or otherwise reinterpret human dynamics. It only drops malformed
 * events, optionally caps drone-like sustains, and limits staggered sounding
 * walls that cannot be played by two hands. Existing hand labels are
 * preserved; labels inferred solely for the overlap pass are removed before
 * returning.
 */
export function sanitizeImportedNotes(notes: Note[], opts: ImportedSanitizeOptions = {}): Note[] {
  const maxDurBeats = opts.maxDurBeats === null
    ? undefined
    : opts.maxDurBeats ?? maxDurationBeatsForTempo(opts.tempoBpm);
  const maxSounding = Math.max(1, Math.floor(opts.maxSounding ?? DEFAULT_IMPORTED_MAX_SOUNDING));
  const hadHandLabels = notes.some((n) => n.hand !== undefined);
  const valid = notes.filter((n) =>
    Number.isFinite(n.midi) &&
    Number.isFinite(n.start) && n.start >= 0 &&
    Number.isFinite(n.dur) && n.dur > 0 &&
    Number.isFinite(n.vel),
  );
  // Keep the shortest grid supported by the importer. Human-authored
  // MusicXML/MIDI commonly contains 16th notes; the AI cleanup path below
  // intentionally keeps its historical 0.25-beat floor.
  // A null ceiling is the explicit human-authored path. Legitimate MIDI and
  // MusicXML arrangements can hold a pedal/bass note for many measures, so a
  // generic seconds-based cap must not silently rewrite those sources.
  let out = maxDurBeats === undefined ? valid : capHandOverlaps(valid, maxDurBeats, 0.125);
  out = capSoundingPolyphony(out, maxSounding);
  if (!hadHandLabels) {
    out = out.map(({ hand: _hand, ...n }) => n);
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
}

/**
 * Post-process AI-transcribed note lists (Basic Pitch output). Removes the
 * typical false positives: very short/quiet ghost notes, same-pitch notes
 * re-triggered by the model (attack transients), and excessive simultaneous
 * voicing from pedal resonance. Human-made MIDI files should NOT go through
 * this (it would eat real grace notes and quiet dynamics).
 */
export function cleanTranscription(notes: Note[], opts: CleanOptions = {}): Note[] {
  const minVel = opts.minVel ?? TRANSCRIPTION_CLEANUP_CONFIG.minVelocity;
  const minDurBeats = opts.minDurBeats ?? TRANSCRIPTION_CLEANUP_CONFIG.minDurationBeats;
  const mergeWindow = opts.mergeWindow ?? TRANSCRIPTION_CLEANUP_CONFIG.mergeWindowBeats;
  const maxPolyphony = opts.maxPolyphony ?? TRANSCRIPTION_CLEANUP_CONFIG.maxPolyphony;
  const maxSounding = opts.maxSounding ?? TRANSCRIPTION_CLEANUP_CONFIG.maxSounding;
  // Duration ceiling: seconds-based when the tempo is known (a beat cap of 8
  // is 6.4s at 75 BPM but only 2.7s at 180), otherwise scaled to the input's
  // typical note length. Never drifts past 8 beats.
  let maxDurBeats = opts.maxDurBeats;
  if (maxDurBeats === undefined && opts.tempoBpm) {
    maxDurBeats = transcriptionMaxDurationBeats(
      opts.tempoBpm,
      opts.maxDurSec ?? TRANSCRIPTION_CLEANUP_CONFIG.maxDurationSec,
    );
  }
  if (maxDurBeats === undefined) {
    const durs = notes.map((n) => n.dur).sort((a, b) => a - b);
    const mid = Math.floor(durs.length / 2);
    const medianDur = durs.length === 0 ? 0.5 : durs.length % 2 === 1 ? durs[mid]! : (durs[mid - 1]! + durs[mid]!) / 2;
    maxDurBeats = Math.min(8, Math.max(2, 4 * medianDur));
  }

  // Keep true durations here; capHandOverlaps enforces the ceiling per hand
  // so it can tell drones (past the ceiling) apart from legato overlaps.
  let out = notes.filter((n) => n.vel >= minVel && n.dur >= minDurBeats);
  out = mergeNearDuplicates(out, mergeWindow);
  out = capPolyphony(out, maxPolyphony);
  out = capSoundingPolyphony(out, maxSounding);
  out = capHandOverlaps(out, maxDurBeats);
  return out;
}

/** Cap drones per hand: notes past the ceiling end at the next attack (floor 0.25); legato overlaps under the ceiling are kept. */
export function capHandOverlaps(notes: Note[], maxDurBeats = 2.0, minDurBeats = 0.25): Note[] {
  // Preserve explicit staff/hand assignments from MusicXML and curated MIDI.
  // Only infer a pitch split for unlabeled imports; otherwise a low note
  // intentionally written on the RH staff (or a cross-handed LH note) would
  // silently move to the opposite hand during sanitization.
  const hasHandLabels = notes.some((n) => n.hand !== undefined);
  const { rh, lh } = hasHandLabels
    ? {
        rh: notes.filter((n) => n.hand !== "L"),
        lh: notes.filter((n) => n.hand === "L"),
      }
    : splitHands(notes);
  return [...truncateHand(rh, maxDurBeats, minDurBeats), ...truncateHand(lh, maxDurBeats, minDurBeats)].sort(
    (a, b) => a.start - b.start || a.midi - b.midi,
  );
}

/** Shorten a hand's notes only when they are drones: duration past the ceiling AND overlapping the next same-hand attack. */
function truncateHand(notes: Note[], maxDurBeats: number, minDurBeats: number): Note[] {
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
      if (next && dur > maxDurBeats && dur > timeToNext) {
        // Keep the importer's minimum grid (typically a 16th note) rather
        // than stretching every short re-attack to the AI cleaner's historical
        // quarter-beat floor.
        dur = Math.min(dur, Math.max(timeToNext, minDurBeats));
      }
      dur = Math.min(dur, maxDurBeats);
      out.push({ ...n, dur: Math.max(minDurBeats, dur) });
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
