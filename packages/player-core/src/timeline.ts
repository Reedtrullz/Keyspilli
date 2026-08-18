import type { SongData } from "./types.js";
import { chordName, tryParseChordSymbol, type ChordLabel, type ChordSourceKind } from "@keyspilli/midi";

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

/** Source context used when a caller can classify legacy events. */
export interface ChordDedupeOptions {
  /**
   * Classify events whose sourceKind is absent/unknown. Unknown is otherwise
   * deliberately not an authority rank and is never silently promoted.
   */
  unknownSourceKind?: Exclude<ChordSourceKind, "unknown">;
  /** Arrangement end used to close a final generated run. */
  durationBeats?: number;
}

type ChordEvent = ChordLabel & { sourceKind?: ChordSourceKind };

interface NormalizedChordEvent {
  event: ChordEvent;
  sourceKind: ChordSourceKind;
  start: number;
  explicitDuration?: number;
  end: number;
  runKey: string;
  fingerprint: string;
}

const SOURCE_RANK: Record<Exclude<ChordSourceKind, "unknown">, number> = {
  generated: 1,
  inferred: 2,
  authored: 3,
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function canonicalNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "null";
  // Number#toString canonicalizes 1, 1.0, and -0 consistently for our beat
  // and MIDI values while retaining enough precision for non-grid callers.
  return Object.is(value, -0) ? "0" : value.toString();
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function asEvent(value: ChordLabel): ChordEvent {
  return value as ChordEvent;
}

function eventNotes(event: ChordEvent): number[] {
  return Array.isArray(event.notes)
    ? event.notes.filter((note): note is number => typeof note === "number" && Number.isFinite(note))
    : [];
}

function sourceKindFor(event: ChordEvent, options: ChordDedupeOptions): ChordSourceKind {
  const sourceKind = event.sourceKind;
  if (sourceKind === "authored" || sourceKind === "inferred" || sourceKind === "generated") return sourceKind;
  if (sourceKind === "unknown" && options.unknownSourceKind) return options.unknownSourceKind;
  // Inference metadata is an explicit event-level source signal even when a
  // legacy producer omitted sourceKind.
  if (event.inferred === true || event.inferenceType !== undefined) return "inferred";
  return "unknown";
}

function pitchClassFromName(name: string): number | undefined {
  const match = /^\s*([A-Ga-g])([#b♯♭]?)/.exec(name);
  if (!match) return undefined;
  const letter = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]!.toUpperCase()];
  if (letter === undefined) return undefined;
  const accidental = match[2] ?? "";
  return mod12(letter + (accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0));
}

function chordDescriptor(name: string, notes: number[]): { root?: number; quality?: string; inversion?: string } {
  const parsed = tryParseChordSymbol(name);
  const root = parsed?.rootPc ?? pitchClassFromName(name);
  const quality = parsed?.quality ?? (() => {
    const match = /^\s*[A-Ga-g](?:[#b♯♭]?)(.*?)(?:\/.*)?\s*$/.exec(name);
    return match?.[1]?.replace(/\s+/g, "").toLowerCase() || undefined;
  })();
  const bass = parsed?.bassPc ?? (notes.length ? mod12(Math.min(...notes)) : undefined);
  return {
    root,
    quality,
    // The absolute octave is intentionally omitted: inversion is a material
    // harmonic difference, while octave doublings are not.
    inversion: bass === undefined ? undefined : `bass:${bass}`,
  };
}

function materialRunKey(sourceKind: ChordSourceKind, name: string, notes: number[]): string {
  const descriptor = chordDescriptor(name, notes);
  return [
    sourceKind,
    descriptor.root === undefined ? "?" : String(descriptor.root),
    descriptor.quality ?? "?",
    descriptor.inversion ?? "?",
  ].join("|");
}

function eventFingerprint(event: ChordEvent, sourceKind: ChordSourceKind, name: string, explicitDuration?: number): string {
  const notes = eventNotes(event).slice().sort((a, b) => a - b);
  // Include all serializable event metadata after the required fields. This
  // makes conflicting inference metadata deterministic too, without allowing
  // object key order or note-array order to affect the result.
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(event).sort()) {
    if (key === "beat" || key === "name" || key === "notes" || key === "sourceKind" || key === "durationBeats") continue;
    extras[key] = event[key as keyof ChordEvent];
  }
  return stableSerialize({
    beat: event.beat,
    durationBeats: explicitDuration,
    sourceKind,
    name,
    notes,
    extras,
  });
}

function authorityRank(sourceKind: ChordSourceKind): number | undefined {
  return sourceKind === "unknown" ? undefined : SOURCE_RANK[sourceKind];
}

function playableCount(event: ChordEvent): number {
  return [...new Set(eventNotes(event))].length;
}

/** Return positive when `a` should win the conflict. */
function compareChordEvents(a: NormalizedChordEvent, b: NormalizedChordEvent): number {
  const aRank = authorityRank(a.sourceKind);
  const bRank = authorityRank(b.sourceKind);
  // Unknown is not a rank. When known provenance is available, prefer it over
  // an ambiguous event rather than silently treating ambiguity as authority.
  if (aRank !== undefined && bRank === undefined) return 1;
  if (aRank === undefined && bRank !== undefined) return -1;
  if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;

  const aPlayable = playableCount(a.event) > 0;
  const bPlayable = playableCount(b.event) > 0;
  if (aPlayable !== bPlayable) return aPlayable ? 1 : -1;

  if (aPlayable && bPlayable && a.sourceKind !== "unknown" && a.sourceKind === b.sourceKind) {
    const aCount = playableCount(a.event);
    const bCount = playableCount(b.event);
    if (aCount !== bCount) {
      // Generated voicings are learner fallbacks; authored and inferred
      // voicings retain the fuller source shape.
      return a.sourceKind === "generated" ? bCount - aCount : aCount - bCount;
    }
  }

  const aDuration = a.explicitDuration ?? 0;
  const bDuration = b.explicitDuration ?? 0;
  if (aDuration !== bDuration) return aDuration - bDuration;
  if (a.fingerprint === b.fingerprint) return 0;
  return a.fingerprint < b.fingerprint ? 1 : -1;
}

function normalizeChordEvent(event: ChordEvent, options: ChordDedupeOptions): NormalizedChordEvent | null {
  const notes = eventNotes(event);
  const sourceKind = sourceKindFor(event, options);
  const computedName = notes.length
    ? chordName([...new Set(notes.map((note) => mod12(note)))].sort((a, b) => a - b), mod12(Math.min(...notes)))
    : "";
  // Keep authored/inferred display-only symbols with no playable voicing, but
  // retain the historical rule that an unlabeled generated/legacy cluster is
  // dropped even if its input row carried a stale display name.
  if (notes.length > 0 && !computedName && sourceKind !== "authored" && sourceKind !== "inferred") return null;
  // Legacy/generated clusters retain the old bass-aware relabeling. Authored
  // and inferred symbols retain their supplied label, including unvoiced ones.
  const suppliedSymbol = tryParseChordSymbol(event.name);
  const name = sourceKind === "authored" || sourceKind === "inferred"
    ? (event.name || computedName)
    // chordName() normalizes pitch classes without spelling inversions. Keep
    // an explicit slash-bass symbol because inversion is material for display
    // and for the compaction run key.
    : (suppliedSymbol?.bassPc !== undefined ? event.name : (computedName || event.name));
  if (!name) return null;

  const start = Number.isFinite(event.beat) ? event.beat : 0;
  const explicitDuration = typeof event.durationBeats === "number" && Number.isFinite(event.durationBeats) && event.durationBeats > 0
    ? event.durationBeats
    : undefined;
  const normalizedEvent = event.name === name ? event : { ...event, name };
  const fingerprint = eventFingerprint(normalizedEvent, sourceKind, name, explicitDuration);
  return {
    event: normalizedEvent,
    sourceKind,
    start,
    explicitDuration,
    // Filled from the next onset once the input is sorted.
    end: explicitDuration === undefined ? start + 1 : start + explicitDuration,
    runKey: materialRunKey(sourceKind, name, notes),
    fingerprint,
  };
}

function classifyOverlap(events: NormalizedChordEvent[]): NormalizedChordEvent[] {
  const ordered = [...events].sort((a, b) => a.start - b.start || (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i]!;
    if (current.explicitDuration !== undefined) continue;
    const next = ordered[i + 1];
    if (next && next.start > current.start) current.end = next.start;
  }

  const accepted: NormalizedChordEvent[] = [];
  for (const current of ordered) {
    const overlapping = accepted.filter((previous) => previous.start < current.start && previous.end > current.start);
    for (const previous of overlapping) {
      const comparison = compareChordEvents(current, previous);
      if (comparison < 0) continue;
      const index = accepted.indexOf(previous);
      if (index < 0) continue;
      // Preserve a leading lower-authority segment when the winning event
      // begins later. Explicit durations can be clipped without changing the
      // winning event's absolute notes or metadata.
      if (previous.start < current.start && previous.explicitDuration !== undefined) {
        const clippedDuration = current.start - previous.start;
        accepted[index] = clippedDuration > 0
          ? { ...previous, event: { ...previous.event, durationBeats: clippedDuration }, explicitDuration: clippedDuration, end: current.start }
          : current;
      } else {
        accepted.splice(index, 1);
      }
    }
    const sameBeat = [
      ...accepted.filter((previous) => Math.abs(previous.start - current.start) <= 1e-9),
      current,
    ];
    if (sameBeat.length > 1) {
      const winner = sameBeat.reduce((best, candidate) => compareChordEvents(candidate, best) > 0 ? candidate : best);
      for (const candidate of sameBeat) {
        if (candidate === current) continue;
        const index = accepted.indexOf(candidate);
        if (index >= 0) accepted.splice(index, 1);
      }
      accepted.push(winner);
    } else if (!overlapping.some((previous) => compareChordEvents(current, previous) < 0)) {
      accepted.push(current);
    }
  }
  return accepted.sort((a, b) => a.start - b.start || (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
}

/**
 * Display-time chord cleanup with source-aware deterministic precedence.
 *
 * Legacy events keep their bass-aware relabeling and same-name compaction.
 * Events carrying provenance resolve conflicts as authored > inferred >
 * generated, then by playable voicing, source-aware note richness, duration,
 * and a canonical permutation-stable fingerprint. The selected event object
 * is otherwise preserved, including absolute notes and optional metadata.
 */
function dedupeChordsOnce(
  chords: ChordLabel[],
  minRunBeatsOrOptions: number | ChordDedupeOptions = 1,
  maybeOptions: ChordDedupeOptions = {},
): ChordLabel[] {
  const minRunBeats = typeof minRunBeatsOrOptions === "number" ? minRunBeatsOrOptions : 1;
  const options = typeof minRunBeatsOrOptions === "number" ? maybeOptions : minRunBeatsOrOptions;
  const normalized = chords
    .map((chord) => normalizeChordEvent(asEvent(chord), options))
    .filter((event): event is NormalizedChordEvent => event !== null);
  if (!normalized.length) return [];

  const resolved = classifyOverlap(normalized);
  const out: ChordLabel[] = [];
  let run: NormalizedChordEvent[] = [];
  const flush = (nextStart?: number) => {
    if (!run.length) return;
    const first = run[0]!;
    // `classifyOverlap` derives an implicit event end from the next onset.
    // Use those ends here instead of the old one-beat sentinel so a compacted
    // run carries its real beat span into the player. Explicit durations stay
    // authoritative on the winning event below.
    const runEnd = Math.max(
      ...run.map((event) => event.end),
      nextStart ?? options.durationBeats ?? first.start + 1,
    );
    if (runEnd - first.start >= minRunBeats) {
      const winner = run.reduce((best, candidate) => compareChordEvents(candidate, best) > 0 ? candidate : best);
      // Keep the historical run start while retaining the winning event's
      // notes, label, duration, and provenance metadata.
      const eventAtStart = winner.start === first.start ? winner.event : { ...winner.event, beat: first.start };
      // Legacy/generated events do not carry an explicit span. Persist the
      // next-onset/run span so PlaybackEngine can schedule them in beats at
      // the active tempo instead of falling back to a fixed wall-clock value.
      // Never replace an authored/inferred (or otherwise explicit) duration.
      out.push((winner.explicitDuration === undefined
        ? { ...eventAtStart, durationBeats: runEnd - first.start }
        : eventAtStart) as ChordLabel);
    }
    run = [];
  };

  for (const event of resolved) {
    if (!run.length) {
      run = [event];
      continue;
    }
    if (event.runKey === run[0]!.runKey) {
      run.push(event);
      continue;
    }
    flush(event.start);
    run = [event];
  }
  flush();
  return out;
}

/**
 * Apply cleanup to a fixed point. A short run can be removed between two
 * otherwise equivalent runs; collapsing that newly adjacent pair on the next
 * pass makes the public operation idempotent without encoding a hidden
 * "dropped-run" marker in the chord event shape.
 */
export function dedupeChords(
  chords: ChordLabel[],
  minRunBeatsOrOptions: number | ChordDedupeOptions = 1,
  maybeOptions: ChordDedupeOptions = {},
): ChordLabel[] {
  const minRunBeats = typeof minRunBeatsOrOptions === "number" ? minRunBeatsOrOptions : 1;
  const options = typeof minRunBeatsOrOptions === "number" ? maybeOptions : minRunBeatsOrOptions;
  let current = dedupeChordsOnce(chords, minRunBeats, options);
  // Each pass can only remove/merge events; the extra bound protects callers
  // from malformed numeric input while allowing one pass per disappearing
  // event for pathological timelines.
  const maxPasses = Math.max(2, chords.length + 1);
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = dedupeChordsOnce(current, minRunBeats, options);
    if (stableSerialize(next) === stableSerialize(current)) return current;
    current = next;
  }
  return current;
}

/**
 * Complete beat spans at the player boundary.
 *
 * New generated and hybrid timelines are required to carry an explicit span
 * so the audio engine can schedule them at the active tempo. Legacy events
 * without provenance remain untouched by callers that need the historical
 * wall-clock fallback. Explicit spans are clipped to the next onset and the
 * supplied arrangement end, which prevents overlaps after a source merge.
 */
export function completeChordDurations<T extends ChordLabel>(
  chords: readonly T[],
  durationBeats?: number,
): T[] {
  const ordered = chords
    .filter((chord) => Number.isFinite(chord.beat) && chord.beat >= 0)
    .map((chord, index) => ({ chord, index }))
    .sort((a, b) => a.chord.beat - b.chord.beat || a.index - b.index);
  if (!ordered.length) return [];

  const finiteDuration = typeof durationBeats === "number" && Number.isFinite(durationBeats) && durationBeats > 0
    ? durationBeats
    : undefined;
  const out: T[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const chord = ordered[i]!.chord;
    const nextBeat = ordered[i + 1]?.chord.beat;
    const explicit = typeof chord.durationBeats === "number" && Number.isFinite(chord.durationBeats) && chord.durationBeats > 0
      ? chord.durationBeats
      : undefined;
    const naturalEnd = nextBeat !== undefined
      ? nextBeat
      : finiteDuration !== undefined
        ? finiteDuration
        : explicit !== undefined
          ? chord.beat + explicit
          : undefined;
    if (naturalEnd === undefined) {
      out.push(chord);
      continue;
    }
    const requestedEnd = explicit === undefined ? naturalEnd : chord.beat + explicit;
    const end = Math.min(requestedEnd, naturalEnd, finiteDuration ?? Number.POSITIVE_INFINITY);
    if (!(end > chord.beat + 1e-7)) continue;
    out.push({ ...chord, durationBeats: end - chord.beat });
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
