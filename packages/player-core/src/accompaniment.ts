import {
  chordIntervals,
  chordToNotes,
  splitPianoRoles,
  tryParseChordSymbol,
  type ChordLabel,
  type Note,
  type ProtectedMelodyNote,
} from "@keyspilli/midi";

export type AccompanimentStyle = "melody-accompaniment" | "bass-chords";
export type AccompanimentHand = "L" | "R";

export type AccompanimentFallbackReason =
  | "no source notes"
  | "unsupported chord"
  | "explicit no-chord"
  | "no chord coverage"
  | "accompaniment ownership unavailable"
  | "no owned source notes to replace"
  | "no source notes to replace"
  | "sustained source note crosses accompaniment boundary"
  | "ambiguous melody"
  | "invalid phrase override"
  | "right-hand part unavailable"
  | "no playable support voicing"
  | "sounding limit exceeded";

export interface AccompanimentFallbackSpan {
  startBeat: number;
  endBeat: number;
  reason: AccompanimentFallbackReason;
}

export interface AccompanimentResolution {
  style: AccompanimentStyle;
  notes: Note[];
  chords: AccompanimentChord[];
  /** Chord labels for the UI, with generated voicings only where resolution succeeded. */
  displayChords: ChordLabel[];
  /** Note events for visual guidance; audio uses source notes plus chords. */
  guidanceNotes: Note[];
  fallbackSpans: AccompanimentFallbackSpan[];
}

export interface AccompanimentChord extends ChordLabel {
  /** One suggested hand per sounding chord tone, in `notes` order. */
  suggestedHands: AccompanimentHand[];
  /** Pitch classes intentionally omitted from an incomplete but defining shell. */
  omittedPitchClasses?: number[];
}

export interface AccompanimentOptions {
  durationBeats?: number;
  /** Stable IDs for source notes that are explicitly replaceable. */
  replaceableSourceIds?: ReadonlySet<string>;
}

export type MelodySelection = "automatic" | "right-hand";
export type MelodySelectionProvenance = "inferred" | "user-confirmed";
export type MelodyUnresolvedReason = "ambiguous melody" | "invalid phrase override" | "right-hand part unavailable";
export type MelodyAccompanimentSupportMode = "source-rhythm" | "sparse-harmonic" | "fallback";

export interface MelodyUnresolvedSpan {
  startBeat: number;
  endBeat: number;
  reason: MelodyUnresolvedReason;
}

export interface MelodyAccompanimentProvenance {
  schemaVersion: 1;
  generatorVersion: "melody-accompaniment.v2";
  sourceFingerprint: string | null;
  selection: MelodySelection;
  selectionProvenance: MelodySelectionProvenance;
  sourceNoteCount: number;
  melodyNoteIds: string[];
  unresolvedSpans: MelodyUnresolvedSpan[];
  /** Number of source accompaniment notes retained after onset reduction. */
  sourceSupportNoteCount: number;
  /** Number of note events from sparse harmonic backing. */
  generatedNoteCount: number;
  /** Beats covered by sparse harmonic backing; source-rhythm beats are not counted here. */
  generatedBeats: number;
  /** New source-linked attacks created when sounding-limit trims split a held support. */
  soundingReattackCount: number;
  fallbackBeats: number;
  supportModes: MelodyAccompanimentSupportMode[];
}

export type SparseBackingTimingProvenance = "source-measure-boundary" | "unknown";

/**
 * Meter phase is opt-in: a tuple alone does not establish a downbeat or rule
 * out a pickup. Callers may use this only when the source measure boundary is
 * independently validated; unknown provenance deliberately stays sparse at
 * chord/source boundaries.
 */
export interface SparseBackingTiming {
  timeSig: readonly [number, number];
  measureStartBeat: number;
  provenance: SparseBackingTimingProvenance;
}

export interface MelodyAccompanimentOptions {
  durationBeats?: number;
  /** Validated source phase for meter-aware sparse backing. */
  sparseBackingTiming?: SparseBackingTiming;
  sourceFingerprint?: string | null;
  selection?: MelodySelection;
  allowRests?: boolean;
  phraseOverrides?: readonly MelodyPhraseOverride[];
}

export interface MelodyPhraseOverride {
  startBeat: number;
  endBeat: number;
  sourceNoteIds: readonly string[];
  /** Overrides are valid only when their captured source identity matches. */
  sourceFingerprint?: string | null;
}

export type ArrangementEventRole = "melody" | "accompaniment" | "retained-unclassified";

export interface ArrangementEvent {
  id: string;
  note: Note;
  role: ArrangementEventRole;
  sourceNoteIds: readonly string[];
}

export interface ArrangementPhrase {
  startBeat: number;
  endBeat: number;
  melodySourceIds: readonly string[];
  strategy: "source-reduction" | "harmonic-backing" | "original" | "silence";
  change: "changed" | "unchanged";
  review: "automatic" | "user-selected" | "needs-review";
  reasons: readonly string[];
}

export interface ArrangementChangeSummary {
  durationBeats: number;
  changedBeats: number;
  unchangedBeats: number;
  silentBeats: number;
  reviewBeats: number;
  addedNotes: number;
  removedNotes: number;
  alteredNotes: number;
}

export interface MelodyAccompanimentResolution extends AccompanimentResolution {
  melody: Note[];
  protectedMelody: readonly ProtectedMelodyNote[];
  events: readonly ArrangementEvent[];
  phrases: readonly ArrangementPhrase[];
  changeSummary: ArrangementChangeSummary;
  provenance: MelodyAccompanimentProvenance;
}

export function filterAccompanimentChords(
  chords: readonly AccompanimentChord[],
  hand: AccompanimentHand | "both",
): AccompanimentChord[] {
  if (hand === "both") return [...chords];
  return chords.flatMap((chord) => {
    const notes = chord.notes.filter((_, index) => chord.suggestedHands[index] === hand);
    return notes.length ? [{ ...chord, notes, suggestedHands: notes.map(() => hand) }] : [];
  });
}

const EPSILON = 1e-7;
const NO_CHORD = /^(?:-|N\.?C\.?|no[ -]?chord)$/i;

interface ChordEvent {
  chord: ChordLabel;
  startBeat: number;
  endBeat: number;
  notes: number[] | null;
}

function noteKey(note: Note): string {
  return JSON.stringify([
    note.midi,
    note.start,
    note.dur,
    note.vel,
    note.hand ?? null,
    note.sourceLane ?? null,
    note.identitySource ?? null,
    note.lyrics ?? null,
  ]);
}

/**
 * Build deterministic source-note IDs without treating hand as ownership.
 * Exact duplicate events use an occurrence suffix; notes at different beats
 * remain distinct even when they share a pitch.
 */
export function sourceNoteIds(notes: readonly Note[]): string[] {
  const occurrences = new Map<string, number>();
  return notes.map((note) => {
    const key = noteKey(note);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return `${key}#${occurrence}`;
  });
}

function audibleNoteKey(note: Note): string {
  return JSON.stringify([note.midi, note.start, note.dur, note.vel]);
}

function sameAudibleNotes(left: readonly Note[], right: readonly Note[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const note of left) {
    const key = audibleNoteKey(note);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const note of right) {
    const key = audibleNoteKey(note);
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
  }
  return counts.size === 0;
}

function activeNotes(notes: readonly Note[], beat: number): Note[] {
  return notes.filter((note) => note.start <= beat + EPSILON && noteEnd(note) > beat + EPSILON);
}

function clippedBoundaries(notes: readonly Note[], durationBeats: number): number[] {
  const boundaries = new Set<number>([0, durationBeats]);
  for (const note of notes) {
    const start = Math.max(0, Math.min(durationBeats, note.start));
    const end = Math.max(0, Math.min(durationBeats, noteEnd(note)));
    if (end > start + EPSILON) {
      boundaries.add(start);
      boundaries.add(end);
    }
  }
  return [...boundaries].sort((a, b) => a - b);
}

function unionDuration(
  spans: readonly { startBeat: number; endBeat: number }[],
  durationBeats: number,
): number {
  if (durationBeats <= EPSILON) return 0;
  const clipped = spans
    .map((span) => ({
      startBeat: Math.max(0, Math.min(durationBeats, span.startBeat)),
      endBeat: Math.max(0, Math.min(durationBeats, span.endBeat)),
    }))
    .filter((span) => span.endBeat > span.startBeat + EPSILON)
    .sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  let total = 0;
  let current: { startBeat: number; endBeat: number } | null = null;
  for (const span of clipped) {
    if (!current || span.startBeat > current.endBeat + EPSILON) {
      if (current) total += current.endBeat - current.startBeat;
      current = { ...span };
    } else {
      current.endBeat = Math.max(current.endBeat, span.endBeat);
    }
  }
  if (current) total += current.endBeat - current.startBeat;
  return total;
}

/** Compare source audio with the actually rendered note events. */
export function measureArrangementChanges(
  sourceNotes: readonly Note[],
  events: readonly ArrangementEvent[],
  durationBeats: number,
  reviewSpans: readonly { startBeat: number; endBeat: number }[] = [],
): ArrangementChangeSummary {
  const duration = Math.max(0, Number.isFinite(durationBeats) ? durationBeats : 0);
  const outputNotes = events.map((event) => event.note);
  const boundaries = clippedBoundaries([...sourceNotes, ...outputNotes], duration);
  let changedBeats = 0;
  let unchangedBeats = 0;
  let silentBeats = 0;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const startBeat = boundaries[index]!;
    const endBeat = boundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) continue;
    const sourceActive = activeNotes(sourceNotes, (startBeat + endBeat) / 2);
    const outputActive = activeNotes(outputNotes, (startBeat + endBeat) / 2);
    if (sourceActive.length === 0 && outputActive.length === 0) silentBeats += endBeat - startBeat;
    else if (sameAudibleNotes(sourceActive, outputActive)) unchangedBeats += endBeat - startBeat;
    else changedBeats += endBeat - startBeat;
  }

  const sourceIds = sourceNoteIds(sourceNotes);
  const sourceById = new Map(sourceIds.map((id, index) => [id, sourceNotes[index]!]));
  const linkedEvents = new Map<string, ArrangementEvent[]>();
  let addedNotes = 0;
  for (const event of events) {
    const knownIds = event.sourceNoteIds.filter((id) => sourceById.has(id));
    if (knownIds.length === 0) {
      addedNotes++;
      continue;
    }
    for (const id of knownIds) {
      const linked = linkedEvents.get(id) ?? [];
      linked.push(event);
      linkedEvents.set(id, linked);
    }
  }
  let removedNotes = 0;
  let alteredNotes = 0;
  for (const [id, source] of sourceById) {
    const linked = linkedEvents.get(id) ?? [];
    if (linked.length === 0) removedNotes++;
    else if (linked.length !== 1 || !sameAudibleNotes([source], [linked[0]!.note])) alteredNotes++;
  }

  return {
    durationBeats: duration,
    changedBeats,
    unchangedBeats,
    silentBeats,
    reviewBeats: unionDuration(reviewSpans, duration),
    addedNotes,
    removedNotes,
    alteredNotes,
  };
}

function validDuration(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function noteEnd(note: Note): number {
  return note.start + Math.max(0, note.dur);
}

function isNoChord(name: string): boolean {
  return NO_CHORD.test(name.trim());
}

function compactUpperShape(chord: ChordLabel, intervals?: readonly number[]): number[] | null {
  const parsed = tryParseChordSymbol(chord.name);
  if (!parsed) return null;
  try {
    // Build the upper shape from the quality itself. `chordToNotes` includes
    // a slash bass, so using its maxNotes cap here could drop a seventh or
    // altered tone before the RH shape is even voiced.
    const rootMidi = 60 + parsed.rootPc;
    const shape = [...new Set((intervals ?? chordIntervals(parsed.quality)).map((interval) => rootMidi + (interval % 12)))]
      .sort((a, b) => a - b);
    return shape.length > 0 && Math.max(...shape) - Math.min(...shape) <= 12 ? shape : null;
  } catch {
    return null;
  }
}

function candidateUpperVoicings(shape: readonly number[]): number[][] {
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < shape.length; inversion++) {
    const rotated = [
      ...shape.slice(inversion),
      ...shape.slice(0, inversion).map((midi) => midi + 12),
    ];
    for (let shift = -24; shift <= 24; shift += 12) {
      const candidate = rotated.map((midi) => midi + shift);
      if (candidate.every((midi) => midi >= 60 && midi <= 96)
        && candidate[candidate.length - 1]! - candidate[0]! <= 12) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function voicingScore(candidate: readonly number[], previous: readonly number[] | null): number {
  const centreDistance = Math.abs((candidate[0]! + candidate[candidate.length - 1]!) / 2 - 72);
  if (!previous) return centreDistance;
  const movement = candidate.reduce((sum, midi, index) => sum + Math.abs(midi - (previous[index] ?? midi)), 0)
    + Math.abs(candidate.length - previous.length) * 12;
  return movement * 100 + centreDistance;
}

function chooseUpperVoicing(shape: readonly number[], previous: readonly number[] | null): number[] | null {
  return candidateUpperVoicings(shape)
    .sort((a, b) => voicingScore(a, previous) - voicingScore(b, previous))[0] ?? null;
}

function generatedChordNotes(
  chord: ChordLabel,
  style: AccompanimentStyle,
  previousUpper: readonly number[] | null,
): number[] | null {
  if (isNoChord(chord.name) || !tryParseChordSymbol(chord.name)) return null;
  const upper = chooseUpperVoicing(compactUpperShape(chord) ?? [], previousUpper);
  if (!upper) return null;
  if (style !== "bass-chords") return upper;
  try {
    const full = chordToNotes(chord.name, {
      octave: 4,
      bassOctave: 2,
      includeBass: style === "bass-chords",
      maxNotes: 4,
    });
    const bass = full.find((midi) => midi < 60);
    return bass === undefined ? null : [bass, ...upper];
  } catch {
    return null;
  }
}

function timelineDuration(
  notes: readonly Note[],
  chords: readonly ChordLabel[],
  durationBeats: number | undefined,
): number {
  if (validDuration(durationBeats)) return durationBeats;
  return Math.max(
    0,
    ...notes.map(noteEnd),
    ...chords.map((chord) => chord.beat + (validDuration(chord.durationBeats) ? chord.durationBeats : 1)),
  );
}

function eventEnd(
  chord: ChordLabel,
  next: ChordLabel | undefined,
  durationBeats: number,
  sourceEnd: number,
): number {
  const nextBeat = next && next.beat > chord.beat + EPSILON ? next.beat : undefined;
  const explicitEnd = validDuration(chord.durationBeats) ? chord.beat + chord.durationBeats : undefined;
  const boundary = [explicitEnd, nextBeat].filter((value): value is number => value !== undefined).sort((a, b) => a - b)[0];
  if (boundary !== undefined) return Math.min(durationBeats, boundary);
  if (durationBeats > chord.beat + EPSILON) return durationBeats;
  return Math.max(chord.beat + 1, sourceEnd);
}

function buildEvents(
  notes: readonly Note[],
  chords: readonly ChordLabel[],
  style: AccompanimentStyle,
  durationBeats: number,
): ChordEvent[] {
  const byBeat = new Map<number, ChordLabel>();
  for (const chord of [...chords].sort((a, b) => a.beat - b.beat)) byBeat.set(chord.beat, chord);
  const ordered = [...byBeat.values()].sort((a, b) => a.beat - b.beat);
  const sourceEnd = Math.max(0, ...notes.map(noteEnd));
  let previousUpper: number[] | null = null;
  return ordered.flatMap((chord, index) => {
    const startBeat = Math.max(0, chord.beat);
    const rawEnd = eventEnd(chord, ordered[index + 1], durationBeats, sourceEnd);
    const endBeat = Math.min(durationBeats, rawEnd);
    if (endBeat <= startBeat + EPSILON) return [];
    const generated = isNoChord(chord.name) ? null : generatedChordNotes(chord, style, previousUpper);
    if (generated) previousUpper = style === "bass-chords" ? generated.slice(1) : generated;
    return [{
      chord,
      startBeat,
      endBeat,
      notes: generated,
    }];
  });
}

function splitEventAtReviewSpans(
  event: ChordEvent,
  reviewSpans: readonly { startBeat: number; endBeat: number }[],
): ChordEvent[] {
  const boundaries = new Set<number>([event.startBeat, event.endBeat]);
  for (const span of reviewSpans) {
    if (span.endBeat <= event.startBeat + EPSILON || span.startBeat >= event.endBeat - EPSILON) continue;
    boundaries.add(Math.max(event.startBeat, span.startBeat));
    boundaries.add(Math.min(event.endBeat, span.endBeat));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  return sorted.slice(0, -1).flatMap((startBeat, index) => {
    const endBeat = sorted[index + 1]!;
    return endBeat > startBeat + EPSILON ? [{ ...event, startBeat, endBeat }] : [];
  });
}

function contains(interval: { startBeat: number; endBeat: number }, beat: number): boolean {
  return interval.startBeat <= beat + EPSILON && beat < interval.endBeat - EPSILON;
}

function overlaps(note: Note, startBeat: number, endBeat: number): boolean {
  return note.start < endBeat - EPSILON && noteEnd(note) > startBeat + EPSILON;
}

function whollyInside(note: Note, startBeat: number, endBeat: number): boolean {
  return note.start >= startBeat - EPSILON && noteEnd(note) <= endBeat + EPSILON;
}

function subtractCoveredIntervals(
  note: Note,
  covered: readonly { startBeat: number; endBeat: number }[],
): Note[] {
  if (note.dur <= 0 || covered.length === 0) return [note];
  const originalEnd = noteEnd(note);
  let pieces = [{ startBeat: note.start, endBeat: originalEnd }];
  // ponytail: linear interval subtraction is sufficient for one player's song;
  // use an interval index only if generated timelines become much denser.
  for (const interval of covered) {
    pieces = pieces.flatMap((piece) => {
      if (interval.endBeat <= piece.startBeat + EPSILON || interval.startBeat >= piece.endBeat - EPSILON) {
        return [piece];
      }
      const next: Array<{ startBeat: number; endBeat: number }> = [];
      if (interval.startBeat > piece.startBeat + EPSILON) {
        next.push({ startBeat: piece.startBeat, endBeat: Math.min(piece.endBeat, interval.startBeat) });
      }
      if (interval.endBeat < piece.endBeat - EPSILON) {
        next.push({ startBeat: Math.max(piece.startBeat, interval.endBeat), endBeat: piece.endBeat });
      }
      return next;
    });
  }
  return pieces
    .filter((piece) => piece.endBeat > piece.startBeat + EPSILON)
    .map((piece) => piece.startBeat === note.start && piece.endBeat === originalEnd
      ? note
      : { ...note, start: piece.startBeat, dur: piece.endBeat - piece.startBeat });
}

function fallbackReason(event: ChordEvent): AccompanimentFallbackReason {
  if (isNoChord(event.chord.name)) return "explicit no-chord";
  return "unsupported chord";
}

function buildDisplayTimeline(events: readonly ChordEvent[], realized: readonly AccompanimentChord[]): ChordLabel[] {
  const byBeat = new Map(realized.map((chord) => [chord.beat, chord]));
  return events.map((event) => byBeat.get(event.startBeat) ?? {
    ...event.chord,
    beat: event.startBeat,
    durationBeats: event.endBeat - event.startBeat,
  });
}

function buildFallbackSpans(
  events: readonly ChordEvent[],
  covered: readonly { startBeat: number; endBeat: number }[],
  fallbackEvents: readonly { startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }[],
  durationBeats: number,
): AccompanimentFallbackSpan[] {
  const boundaries = new Set<number>([0, durationBeats]);
  for (const event of events) {
    boundaries.add(event.startBeat);
    boundaries.add(event.endBeat);
  }
  for (const event of fallbackEvents) {
    boundaries.add(Math.max(0, Math.min(durationBeats, event.startBeat)));
    boundaries.add(Math.max(0, Math.min(durationBeats, event.endBeat)));
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const fallbackSpans: AccompanimentFallbackSpan[] = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index++) {
    const startBeat = sortedBoundaries[index]!;
    const endBeat = sortedBoundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) continue;
    const midpoint = (startBeat + endBeat) / 2;
    const explicit = fallbackEvents.find((interval) => contains(interval, midpoint));
    if (!explicit && covered.some((interval) => contains(interval, midpoint))) continue;
    fallbackSpans.push({
      startBeat,
      endBeat,
      reason: explicit?.reason ?? "no chord coverage",
    });
  }
  return fallbackSpans;
}

function mergeFallbackEvents(
  events: readonly { startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }[],
): Array<{ startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }> {
  const merged: Array<{ startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }> = [];
  for (const event of [...events].sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat)) {
    const previous = merged[merged.length - 1];
    if (previous && previous.reason === event.reason && event.startBeat <= previous.endBeat + EPSILON) {
      previous.endBeat = Math.max(previous.endBeat, event.endBeat);
    } else {
      merged.push({ ...event });
    }
  }
  return merged;
}

interface SoundingLimitResult {
  events: ArrangementEvent[];
  fallbackSpans: Array<{ startBeat: number; endBeat: number; reason: "sounding limit exceeded" }>;
  reattackCount: number;
}

const MAX_SOUNDING_NOTES_PER_HAND = 3;

function withinSoundingLimit(events: readonly ArrangementEvent[]): boolean {
  if (events.length > MAX_SOUNDING_NOTES_PER_HAND) return false;
  if (events.length < 2) return true;
  return Math.max(...events.map((event) => event.note.midi)) - Math.min(...events.map((event) => event.note.midi)) <= 12 + EPSILON;
}

/**
 * Enforce the physical-hand budget on the projected stream.
 *
 * Melody and retained-unclassified events are mandatory. Accompaniment is
 * trimmed only over intervals where it loses the budget, preserving the
 * sourceNoteIds on each surviving piece. A later collision therefore cannot
 * erase an earlier held attack without a corresponding changed interval.
 */
export function enforceAccompanimentSoundingLimits(events: readonly ArrangementEvent[]): SoundingLimitResult {
  const physical = events.filter((event) => event.note.hand === "L" || event.note.hand === "R");
  const support = physical.filter((event) => event.role === "accompaniment");
  const mandatory = physical.filter((event) => event.role === "melody" || event.role === "retained-unclassified");
  const boundaries = new Set<number>();
  for (const event of physical) {
    boundaries.add(event.note.start);
    boundaries.add(noteEnd(event.note));
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const rejectedById = new Map<string, Array<{ startBeat: number; endBeat: number }>>();
  const fallbackSpans: SoundingLimitResult["fallbackSpans"] = [];
  let reattackCount = 0;
  const reject = (event: ArrangementEvent, startBeat: number, endBeat: number) => {
    const intervals = rejectedById.get(event.id) ?? [];
    intervals.push({ startBeat, endBeat });
    rejectedById.set(event.id, intervals);
  };
  for (let index = 0; index < sortedBoundaries.length - 1; index++) {
    const startBeat = sortedBoundaries[index]!;
    const endBeat = sortedBoundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) continue;
    const activeMandatory = mandatory.filter((event) => overlaps(event.note, startBeat, endBeat));
    for (const hand of ["L", "R"] as const) {
      const handMandatory = activeMandatory.filter((event) => event.note.hand === hand);
      const activeSupport = support.filter((event) => event.note.hand === hand && overlaps(event.note, startBeat, endBeat));
      if (handMandatory.length === 0 && activeSupport.length === 0) continue;
      const rejected = new Set<ArrangementEvent>();
      const mandatoryFits = withinSoundingLimit(handMandatory);
      if (!mandatoryFits) {
        for (const event of activeSupport) {
          rejected.add(event);
          reject(event, startBeat, endBeat);
        }
      } else {
        const ordered = [...activeSupport].sort((a, b) => a.note.midi - b.note.midi
          || (a.sourceNoteIds.length > 0 ? -1 : 1) - (b.sourceNoteIds.length > 0 ? -1 : 1)
          || b.note.dur - a.note.dur
          || a.id.localeCompare(b.id));
        const kept = [...handMandatory];
        for (const event of ordered) {
          if (activeMandatory.some((mandatoryEvent) => mandatoryEvent.note.midi === event.note.midi)
            || !withinSoundingLimit([...kept, event])) {
            rejected.add(event);
            reject(event, startBeat, endBeat);
          } else {
            kept.push(event);
          }
        }
      }
      if (!mandatoryFits || rejected.size > 0) {
        fallbackSpans.push({ startBeat, endBeat, reason: "sounding limit exceeded" });
      }
    }
  }
  return {
    events: events.flatMap((event) => {
      const rejected = rejectedById.get(event.id);
      if (event.role !== "accompaniment" || !rejected?.length) return [event];
      const pieces = subtractCoveredIntervals(event.note, rejected);
      reattackCount += pieces.filter((piece) => piece.start > event.note.start + EPSILON).length;
      return pieces.map((note, index) => ({
        ...event,
        id: `${event.id}:piece:${index}`,
        note,
      }));
    }),
    fallbackSpans,
    reattackCount,
  };
}

/**
 * Resolve one source arrangement into one non-overlapping playback plan.
 * Unknown source ownership is a deliberate safe fallback: source notes stay
 * intact and no generated chord overlay is emitted.
 */
export function resolveAccompaniment(
  sourceNotes: readonly Note[],
  chordTimeline: readonly ChordLabel[],
  style: AccompanimentStyle,
  options: AccompanimentOptions = {},
): AccompanimentResolution {
  const durationBeats = timelineDuration(sourceNotes, chordTimeline, options.durationBeats);
  const events = buildEvents(sourceNotes, chordTimeline, style, durationBeats);
  if (sourceNotes.length === 0) {
    return {
      style,
      notes: [],
      chords: [],
      displayChords: buildDisplayTimeline(events, []),
      guidanceNotes: [],
      fallbackSpans: durationBeats > EPSILON
        ? [{ startBeat: 0, endBeat: durationBeats, reason: "no source notes" }]
        : [],
    };
  }

  const ids = sourceNoteIds(sourceNotes);
  const replaceable = options.replaceableSourceIds;
  const keep = sourceNotes.map(() => true);
  const fallbackEvents: Array<{ startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }> = [];
  const effectiveChords: AccompanimentChord[] = [];
  const covered: Array<{ startBeat: number; endBeat: number }> = [];

  for (const event of events) {
    if (!event.notes?.length) {
      fallbackEvents.push({ startBeat: event.startBeat, endBeat: event.endBeat, reason: fallbackReason(event) });
      continue;
    }

    if (style === "melody-accompaniment" && !replaceable) {
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: "accompaniment ownership unavailable",
      });
      continue;
    }

    const overlapping = sourceNotes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => overlaps(note, event.startBeat, event.endBeat));
    const crossingBoundary = overlapping.some(({ note }) => !whollyInside(note, event.startBeat, event.endBeat));
    if (crossingBoundary) {
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: "sustained source note crosses accompaniment boundary",
      });
      continue;
    }

    const replaceableNotes = overlapping.filter(({ index }) =>
      style === "bass-chords" || replaceable?.has(ids[index] ?? ""),
    );
    if (style === "melody-accompaniment" && replaceableNotes.length === 0) {
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: "no owned source notes to replace",
      });
      continue;
    }
    if (style === "bass-chords" && overlapping.length === 0) {
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: "no source notes to replace",
      });
      continue;
    }

    for (const { index } of replaceableNotes) keep[index] = false;
    effectiveChords.push({
      ...event.chord,
      beat: event.startBeat,
      notes: event.notes,
      durationBeats: event.endBeat - event.startBeat,
      suggestedHands: event.notes.map((_, index) => style === "bass-chords" && index === 0 ? "L" : "R"),
      inferred: true,
      inferenceType: "voicing",
    });
    covered.push({ startBeat: event.startBeat, endBeat: event.endBeat });
  }

  const fallbackSpans = buildFallbackSpans(events, covered, fallbackEvents, durationBeats);

  return {
    style,
    notes: sourceNotes.filter((_, index) => keep[index]),
    chords: effectiveChords,
    displayChords: buildDisplayTimeline(events, effectiveChords),
    guidanceNotes: [
      ...sourceNotes.filter((_, index) => keep[index]),
      ...effectiveChords.flatMap((chord) => chord.notes.map((midi, index) => ({
        midi,
        start: chord.beat,
        dur: chord.durationBeats ?? 1,
        vel: 70,
        hand: style === "bass-chords" && index === 0 ? "L" as const : "R" as const,
      }))),
    ].sort((a, b) => a.start - b.start || a.midi - b.midi),
    fallbackSpans,
  };
}

interface SelectedMelody {
  melody: Note[];
  protectedMelody: ProtectedMelodyNote[];
  selectedIndices: Set<number>;
  sourceIds: string[];
  sourceNotes: readonly Note[];
  confirmedRanges: readonly { startBeat: number; endBeat: number }[];
  selection: MelodySelection;
  selectionProvenance: MelodySelectionProvenance;
  unresolvedSpans: MelodyUnresolvedSpan[];
}

function playableSourceNote(note: Note): boolean {
  return Number.isFinite(note.midi)
    && Number.isFinite(note.start)
    && Number.isFinite(note.dur)
    && note.dur > 0
    && Number.isFinite(note.vel);
}

function protectedSourceNote(note: Note, sourceIndex: number, identity: string): ProtectedMelodyNote {
  return Object.freeze({ ...note, sourceIndex, identity, role: "melody" });
}

function sourceAttackGroups(
  items: readonly { note: Note; sourceIndex: number }[],
): Array<Array<{ note: Note; sourceIndex: number }>> {
  const ordered = items
    .filter(({ note }) => playableSourceNote(note))
    .sort((a, b) => a.note.start - b.note.start || a.note.midi - b.note.midi || a.sourceIndex - b.sourceIndex);
  const groups: Array<Array<{ note: Note; sourceIndex: number }>> = [];
  for (const item of ordered) {
    const previous = groups[groups.length - 1];
    const latestStart = previous?.[previous.length - 1]?.note.start;
    if (previous && latestStart !== undefined && item.note.start - latestStart <= 0.08 + EPSILON) previous.push(item);
    else groups.push([item]);
  }
  return groups;
}

interface ReducedSourceSupport {
  sourceIndex: number;
  note: Note;
}

/** Keep the source attack grid while capping each accompaniment onset at three tones. */
function reduceSourceSupport(
  sourceNotes: readonly Note[],
  selectedIndices: ReadonlySet<number>,
  startBeat: number,
  endBeat: number,
): ReducedSourceSupport[] {
  const candidates = sourceNotes
    .map((note, sourceIndex) => ({ note, sourceIndex }))
    .filter(({ note, sourceIndex }) => !selectedIndices.has(sourceIndex)
      && playableSourceNote(note)
      && note.start >= startBeat - EPSILON
      && note.start < endBeat - EPSILON);
  const groups = sourceAttackGroups(candidates);
  const reduced: ReducedSourceSupport[] = [];
  let previousStackKey: string | null = null;
  // ponytail: cap at three source tones per onset; collapse only exact repeated
  // chordal stacks after the first attack. Protected hook notes stay selected
  // through phrase overrides; add broader motif analysis only with reviewed data.
  for (const group of groups) {
    const onset = [...group]
      .sort((a, b) => a.note.midi - b.note.midi || b.note.dur - a.note.dur || b.note.vel - a.note.vel);
    const bass = onset[0];
    if (!bass) continue;
    const withinOctave = onset.filter(({ note }) => note.midi - bass.note.midi <= MAX_LEFT_HAND_SPAN + EPSILON);
    const chosen = [
      bass,
      ...withinOctave.filter(({ note }) => note.midi !== bass.note.midi).slice(-2),
    ];
    const stackKey = chosen.map(({ note }) => note.midi).join(",");
    const repeatedChordStack = chosen.length >= 3 && stackKey === previousStackKey;
    const seenPitches = new Set<number>();
    for (const item of (repeatedChordStack ? chosen.slice(0, 1) : chosen).sort((a, b) => a.note.midi - b.note.midi)) {
      if (seenPitches.has(item.note.midi)) continue;
      seenPitches.add(item.note.midi);
      reduced.push({
        sourceIndex: item.sourceIndex,
        note: { ...item.note, hand: "L" },
      });
    }
    previousStackKey = stackKey;
  }
  return reduced;
}

interface SparseMeterPattern {
  measureBeats: number;
  offsets: readonly number[];
  measureStartBeat: number;
}

function sparseMeterPattern(timing?: SparseBackingTiming): SparseMeterPattern | null {
  if (!timing || timing.provenance !== "source-measure-boundary") return null;
  const [numerator, denominator] = timing.timeSig;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)
    || numerator <= 0 || denominator <= 0 || !Number.isFinite(timing.measureStartBeat)) return null;
  const measureBeats = numerator * (4 / denominator);
  if (!Number.isFinite(measureBeats) || measureBeats <= EPSILON) return null;
  const offsets = numerator === 2 && denominator === 4
    ? [0, 1]
    : numerator === 3 && denominator === 4
      ? [0, 2]
      : numerator === 4 && denominator === 4
        ? [0, 2]
        : numerator === 6 && denominator === 8
          ? [0, 1.5]
          : null;
  return offsets ? { measureBeats, offsets, measureStartBeat: timing.measureStartBeat } : null;
}

function sparseHarmonicStarts(startBeat: number, endBeat: number, timing?: SparseBackingTiming): number[] {
  const starts = [startBeat];
  const pattern = sparseMeterPattern(timing);
  if (!pattern) return starts;
  const firstMeasure = Math.floor((startBeat - pattern.measureStartBeat) / pattern.measureBeats) - 1;
  const lastMeasure = Math.ceil((endBeat - pattern.measureStartBeat) / pattern.measureBeats) + 1;
  for (let measure = firstMeasure; measure <= lastMeasure; measure++) {
    const measureStart = pattern.measureStartBeat + measure * pattern.measureBeats;
    for (const offset of pattern.offsets) {
      const beat = measureStart + offset;
      if (beat > startBeat + EPSILON && beat < endBeat - EPSILON) starts.push(beat);
    }
  }
  return [...new Set(starts)].sort((a, b) => a - b);
}

function sparseHarmonicSupportNotes(
  voicing: readonly number[],
  startBeat: number,
  endBeat: number,
  timing?: SparseBackingTiming,
): Note[] {
  const starts = sparseHarmonicStarts(startBeat, endBeat, timing);
  return starts.flatMap((beat, index) => {
    const nextBeat = starts[index + 1] ?? endBeat;
    const dur = Math.min(0.75, endBeat - beat, nextBeat - beat);
    if (dur <= EPSILON) return [];
    return voicing.map((midi) => ({
      midi,
      start: beat,
      dur,
      vel: 54,
      hand: "L" as const,
    }));
  });
}

function mergeUnresolvedSpans(spans: MelodyUnresolvedSpan[]): MelodyUnresolvedSpan[] {
  const ordered = [...spans].sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  const merged: MelodyUnresolvedSpan[] = [];
  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && span.startBeat <= previous.endBeat + 0.08 && span.reason === previous.reason) {
      previous.endBeat = Math.max(previous.endBeat, span.endBeat);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

interface ValidatedPhraseOverrides {
  valid: MelodyPhraseOverride[];
  invalidSpans: MelodyUnresolvedSpan[];
}

function validatePhraseOverrides(
  overrides: readonly MelodyPhraseOverride[] | undefined,
  sourceNotes: readonly Note[],
  sourceIds: readonly string[],
  durationBeats: number,
  sourceFingerprint: string | null,
): ValidatedPhraseOverrides {
  if (!overrides?.length) return { valid: [], invalidSpans: [] };
  const sourceIndexById = new Map(sourceIds.map((id, index) => [id, index]));
  const valid: MelodyPhraseOverride[] = [];
  const invalidSpans: MelodyUnresolvedSpan[] = [];
  let previousEnd = -Infinity;
  for (const override of overrides) {
    const finiteBounds = Number.isFinite(override.startBeat) && Number.isFinite(override.endBeat);
    const startBeat = finiteBounds ? Math.max(0, override.startBeat) : 0;
    const endBeat = finiteBounds ? Math.min(durationBeats, override.endBeat) : 0;
    const ordered = startBeat >= previousEnd - EPSILON;
    const boundsValid = finiteBounds
      && override.startBeat >= -EPSILON
      && override.endBeat > override.startBeat + EPSILON
      && override.endBeat <= durationBeats + EPSILON
      && endBeat > startBeat + EPSILON;
    const uniqueIds = new Set(override.sourceNoteIds);
    const idsValid = uniqueIds.size === override.sourceNoteIds.length
      && override.sourceNoteIds.every((id) => sourceIndexById.has(id))
      && override.sourceNoteIds.every((id) => {
        const source = sourceNotes[sourceIndexById.get(id)!]!;
        return source.start >= startBeat - EPSILON && source.start < endBeat - EPSILON;
      });
    const fingerprintValid = typeof sourceFingerprint === "string"
      && override.sourceFingerprint === sourceFingerprint;
    if (!boundsValid || !ordered || !idsValid || !fingerprintValid) {
      if (finiteBounds && endBeat > startBeat + EPSILON) {
        invalidSpans.push({ startBeat, endBeat, reason: "invalid phrase override" });
      }
      continue;
    }
    valid.push({ ...override, startBeat, endBeat, sourceNoteIds: [...override.sourceNoteIds] });
    previousEnd = endBeat;
  }
  return { valid, invalidSpans };
}

function applyPhraseOverrides(
  sourceNotes: readonly Note[],
  sourceIds: readonly string[],
  selectedIndices: Set<number>,
  overrides: readonly MelodyPhraseOverride[],
): void {
  for (const override of overrides) {
    for (const [index, note] of sourceNotes.entries()) {
      if (note.start >= override.startBeat - EPSILON && note.start < override.endBeat - EPSILON) selectedIndices.delete(index);
    }
    for (const id of override.sourceNoteIds) selectedIndices.add(sourceIds.indexOf(id));
  }
}

function subtractOverrideRanges(
  span: MelodyUnresolvedSpan,
  ranges: readonly { startBeat: number; endBeat: number }[],
): MelodyUnresolvedSpan[] {
  let remaining: MelodyUnresolvedSpan[] = [{ ...span }];
  for (const range of ranges) {
    remaining = remaining.flatMap((candidate) => {
      if (range.endBeat <= candidate.startBeat + EPSILON || range.startBeat >= candidate.endBeat - EPSILON) return [candidate];
      const pieces: MelodyUnresolvedSpan[] = [];
      if (candidate.startBeat < range.startBeat - EPSILON) {
        pieces.push({ ...candidate, endBeat: range.startBeat });
      }
      if (candidate.endBeat > range.endBeat + EPSILON) {
        pieces.push({ ...candidate, startBeat: range.endBeat });
      }
      return pieces;
    });
  }
  return remaining.filter((candidate) => candidate.endBeat > candidate.startBeat + EPSILON);
}

function selectMelodySource(
  sourceNotes: readonly Note[],
  durationBeats: number,
  requestedSelection: MelodySelection,
  allowRests = false,
  sourceFingerprint: string | null = null,
  phraseOverrides?: readonly MelodyPhraseOverride[],
): SelectedMelody {
  const ids = sourceNoteIds(sourceNotes);
  const rightHandIndices = sourceNotes
    .map((note, index) => playableSourceNote(note) && note.hand === "R" ? index : -1)
    .filter((index): index is number => index >= 0);
  const validatedOverrides = validatePhraseOverrides(
    phraseOverrides,
    sourceNotes,
    ids,
    durationBeats,
    sourceFingerprint,
  );
  const hasRightHandSelection = requestedSelection === "right-hand" && rightHandIndices.length > 0;
  if (hasRightHandSelection) {
    const selectedIndices = new Set(rightHandIndices);
    applyPhraseOverrides(sourceNotes, ids, selectedIndices, validatedOverrides.valid);
    const protectedMelody = [...selectedIndices]
      .sort((a, b) => sourceNotes[a]!.start - sourceNotes[b]!.start || sourceNotes[a]!.midi - sourceNotes[b]!.midi || a - b)
      .map((index) => protectedSourceNote(sourceNotes[index]!, index, ids[index]!));
    return {
      melody: protectedMelody.map((note) => ({ ...note })),
      protectedMelody,
      selectedIndices,
      sourceIds: ids,
      sourceNotes,
      confirmedRanges: rightHandIndices.length > 0
        ? [{ startBeat: 0, endBeat: durationBeats }]
        : validatedOverrides.valid.map(({ startBeat, endBeat }) => ({ startBeat, endBeat })),
      selection: "right-hand",
      selectionProvenance: "user-confirmed",
      unresolvedSpans: mergeUnresolvedSpans(validatedOverrides.invalidSpans),
    };
  }

  const split = splitPianoRoles(sourceNotes, { preferSustainedLine: true, allowRests });
  const selectedIndices = new Set(split.protectedMelody.map((note) => note.sourceIndex));
  applyPhraseOverrides(sourceNotes, ids, selectedIndices, validatedOverrides.valid);
  const protectedMelody = [...split.protectedMelody]
    .filter((note) => selectedIndices.has(note.sourceIndex))
    .map((note) => protectedSourceNote(sourceNotes[note.sourceIndex]!, note.sourceIndex, ids[note.sourceIndex]!));
  for (const index of [...selectedIndices].filter((index) => !protectedMelody.some((note) => note.sourceIndex === index))) {
    protectedMelody.push(protectedSourceNote(sourceNotes[index]!, index, ids[index]!));
  }
  protectedMelody.sort((a, b) => a.start - b.start || a.midi - b.midi || a.sourceIndex - b.sourceIndex);
  const overrideRanges = validatedOverrides.valid.map(({ startBeat, endBeat }) => ({ startBeat, endBeat }));
  const unresolvedSpans = mergeUnresolvedSpans([
    ...split.pathEvidence.flatMap((span) => {
      const startBeat = Math.max(0, span.startBeat);
      const endBeat = Math.min(durationBeats, span.endBeat);
      if (endBeat <= startBeat + EPSILON) return [];
      return subtractOverrideRanges({ startBeat, endBeat, reason: "ambiguous melody" }, overrideRanges);
    }),
    ...validatedOverrides.invalidSpans,
  ]);
  if (requestedSelection === "right-hand" && rightHandIndices.length === 0 && durationBeats > EPSILON) {
    unresolvedSpans.push(...subtractOverrideRanges(
      { startBeat: 0, endBeat: durationBeats, reason: "right-hand part unavailable" },
      overrideRanges,
    ));
  }
  return {
    melody: protectedMelody.map((note) => ({ ...sourceNotes[note.sourceIndex]! })),
    protectedMelody,
    selectedIndices,
    sourceIds: ids,
    sourceNotes,
    confirmedRanges: overrideRanges,
    selection: "automatic",
    selectionProvenance: validatedOverrides.valid.length > 0 ? "user-confirmed" : "inferred",
    unresolvedSpans: mergeUnresolvedSpans(unresolvedSpans),
  };
}

function intervalChanged(
  sourceNotes: readonly Note[],
  outputEvents: readonly ArrangementEvent[],
  startBeat: number,
  endBeat: number,
): boolean {
  const outputNotes = outputEvents.map((event) => event.note);
  const boundaries = new Set<number>([startBeat, endBeat]);
  for (const note of [...sourceNotes, ...outputNotes]) {
    if (!overlaps(note, startBeat, endBeat)) continue;
    boundaries.add(Math.max(startBeat, Math.min(endBeat, note.start)));
    boundaries.add(Math.max(startBeat, Math.min(endBeat, noteEnd(note))));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index]!;
    const end = sorted[index + 1]!;
    if (end <= start + EPSILON) continue;
    const midpoint = (start + end) / 2;
    if (!sameAudibleNotes(activeNotes(sourceNotes, midpoint), activeNotes(outputNotes, midpoint))) return true;
  }
  return false;
}

function localArrangementStrategy(
  sourceNotes: readonly Note[],
  outputEvents: readonly ArrangementEvent[],
  startBeat: number,
  endBeat: number,
): ArrangementPhrase["strategy"] {
  const localEvents = outputEvents.filter((event) => overlaps(event.note, startBeat, endBeat));
  if (localEvents.some((event) => event.role === "accompaniment" && event.sourceNoteIds.length > 0)) return "source-reduction";
  if (localEvents.some((event) => event.role === "accompaniment" && event.sourceNoteIds.length === 0)) return "harmonic-backing";
  const hasSource = sourceNotes.some((note) => overlaps(note, startBeat, endBeat));
  const hasOutput = outputEvents.some((event) => overlaps(event.note, startBeat, endBeat));
  if (!hasSource && !hasOutput) return "silence";
  return "original";
}

function buildArrangementPhrases(
  durationBeats: number,
  selected: SelectedMelody,
  fallbackSpans: readonly AccompanimentFallbackSpan[],
  sourceNotes: readonly Note[],
  outputEvents: readonly ArrangementEvent[],
  planningSpans: readonly { startBeat: number; endBeat: number }[] = [],
): ArrangementPhrase[] {
  if (durationBeats <= EPSILON) return [];
  const boundaries = new Set<number>([0, durationBeats]);
  for (const range of [...selected.confirmedRanges, ...selected.unresolvedSpans, ...fallbackSpans, ...planningSpans]) {
    boundaries.add(Math.max(0, Math.min(durationBeats, range.startBeat)));
    boundaries.add(Math.max(0, Math.min(durationBeats, range.endBeat)));
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const overlapsRange = (startBeat: number, endBeat: number, range: { startBeat: number; endBeat: number }) =>
    range.startBeat < endBeat - EPSILON && range.endBeat > startBeat + EPSILON;

  return sortedBoundaries.slice(0, -1).flatMap((startBeat, index) => {
    const endBeat = sortedBoundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) return [];
    const reasons = [...new Set([
      ...selected.unresolvedSpans
        .filter((span) => overlapsRange(startBeat, endBeat, span))
        .map((span) => span.reason),
      ...fallbackSpans
        .filter((span) => overlapsRange(startBeat, endBeat, span))
        .map((span) => span.reason),
    ])];
    const userSelected = selected.confirmedRanges.some((range) => overlapsRange(startBeat, endBeat, range));
    const strategy = localArrangementStrategy(sourceNotes, outputEvents, startBeat, endBeat);
    const change = intervalChanged(sourceNotes, outputEvents, startBeat, endBeat) ? "changed" : "unchanged";
    return [{
      startBeat,
      endBeat,
      melodySourceIds: selected.sourceIds.filter((_, sourceIndex) => {
        const note = selected.sourceNotes[sourceIndex];
        return selected.selectedIndices.has(sourceIndex)
          && note !== undefined
          && note.start >= startBeat - EPSILON
          && note.start < endBeat - EPSILON;
      }),
      strategy,
      change,
      review: reasons.length > 0 ? "needs-review" : userSelected ? "user-selected" : "automatic",
      reasons,
    }];
  });
}

const MAX_LEFT_HAND_SPAN = 12;
const MIN_MELODY_CLEARANCE = 2;
const LOWEST_SUPPORT_MIDI = 36;

function supportUpperShape(
  chord: ChordLabel,
  upper: readonly number[],
  bass: number,
  melody: readonly Note[],
  startBeat: number,
  endBeat: number,
  previous: readonly number[] | null,
  shapeOverride?: readonly number[],
): number[] | null {
  const shape = shapeOverride ? [...shapeOverride] : compactUpperShape(chord) ?? [...upper];
  if (!shape.length) return null;
  const activeMelody = melody.filter((note) => overlaps(note, startBeat, endBeat));
  const lowestMelody = activeMelody.length ? Math.min(...activeMelody.map((note) => note.midi)) : null;
  const targetTop = lowestMelody === null ? 55 : Math.min(55, lowestMelody - MIN_MELODY_CLEARANCE);
  const candidates: Array<{ bass: number; upper: number[]; notes: number[] }> = [];
  for (const base of candidateUpperVoicings(shape)) {
    for (let shift = -36; shift <= 0; shift += 12) {
      const shifted = base.map((midi) => midi + shift);
      // Raising the bass by an octave is the smallest change that turns the
      // source-style bass-plus-upper shape into one learner-sized LH span.
      for (const bassShift of [0, 12, -12, 24, -24, 36, -36]) {
        const revoicedBass = bass + bassShift;
        const notes = [...new Set([revoicedBass, ...shifted])];
        const uniquePitchClasses = new Set(notes.map((midi) => midi % 12));
        const span = Math.max(...notes) - Math.min(...notes);
        const collidesWithMelody = lowestMelody !== null
          && notes.some((midi) => midi >= lowestMelody - MIN_MELODY_CLEARANCE);
        if (notes.every((midi) => Number.isInteger(midi) && midi >= LOWEST_SUPPORT_MIDI && midi <= 96)
          && revoicedBass <= Math.min(...shifted)
          && span <= MAX_LEFT_HAND_SPAN
          && uniquePitchClasses.size === notes.length
          && !collidesWithMelody) {
          candidates.push({ bass: revoicedBass, upper: shifted, notes });
        }
      }
    }
  }
  return candidates.sort((a, b) => {
    const aMotion = previous ? voicingScore(a.notes, previous) : 0;
    const bMotion = previous ? voicingScore(b.notes, previous) : 0;
    const aTopDistance = Math.abs(Math.max(...a.notes) - targetTop);
    const bTopDistance = Math.abs(Math.max(...b.notes) - targetTop);
    return Math.abs(a.bass - bass) - Math.abs(b.bass - bass)
      || aMotion - bMotion
      || aTopDistance - bTopDistance
      || (Math.max(...a.notes) - Math.min(...a.notes)) - (Math.max(...b.notes) - Math.min(...b.notes));
  })[0]?.notes ?? null;
}

interface LearningChordNotes {
  notes: number[];
  omittedPitchClasses: number[];
}

function shellIntervals(intervals: readonly number[]): number[] | null {
  if (intervals.length <= 2 || !intervals.some((interval) => interval % 12 === 7)) return null;
  const shell = intervals.filter((interval) => interval % 12 !== 7);
  return shell.length >= 2 ? shell : null;
}

function learningChordNotes(
  chord: ChordLabel,
  upper: readonly number[],
  melody: readonly Note[],
  startBeat: number,
  endBeat: number,
  previous: readonly number[] | null,
): LearningChordNotes | null {
  if (isNoChord(chord.name) || !tryParseChordSymbol(chord.name)) return null;
  try {
    const parsed = tryParseChordSymbol(chord.name);
    if (!parsed) return null;
    const full = chordToNotes(chord.name, { octave: 4, bassOctave: 2, includeBass: true });
    const bass = full.find((midi) => midi < 60);
    if (bass === undefined) return null;
    const intervals = chordIntervals(parsed.quality);
    const fullShape = compactUpperShape(chord) ?? [...upper];
    const shell = shellIntervals(intervals);
    const candidates = [
      { shape: fullShape, intervals, omittedPitchClasses: [] },
      ...(shell ? [{
        shape: compactUpperShape(chord, shell) ?? [],
        intervals: shell,
        omittedPitchClasses: intervals
          .filter((interval) => !shell.includes(interval))
          .map((interval) => (parsed.rootPc + interval) % 12),
      }] : []),
    ].filter((candidate) => candidate.shape.length > 0);
    for (const candidate of candidates) {
      const support = supportUpperShape(chord, candidate.shape, bass, melody, startBeat, endBeat, previous, candidate.shape);
      if (!support) continue;
      const notes = [...new Set(support)];
      const expectedPitchClasses = new Set([
        ...candidate.intervals.map((interval) => (parsed.rootPc + interval) % 12),
        bass % 12,
      ]);
      const actualPitchClasses = new Set(notes.map((midi) => midi % 12));
      if ([...expectedPitchClasses].some((pitchClass) => !actualPitchClasses.has(pitchClass))) continue;
      if (Math.min(...notes) % 12 !== bass % 12) continue;
      if (!notes.every((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127)) continue;
      return { notes, omittedPitchClasses: candidate.omittedPitchClasses };
    }
    return null;
  } catch {
    return null;
  }
}

/** Build the separate learner arrangement that owns its melody/support split. */
export function buildMelodyAccompaniment(
  sourceNotes: readonly Note[],
  chordTimeline: readonly ChordLabel[],
  options: MelodyAccompanimentOptions = {},
): MelodyAccompanimentResolution {
  const durationBeats = timelineDuration(sourceNotes, chordTimeline, options.durationBeats);
  const requestedSelection = options.selection ?? "automatic";
  const selected = selectMelodySource(
    sourceNotes,
    durationBeats,
    requestedSelection,
    options.allowRests === true,
    options.sourceFingerprint ?? null,
    options.phraseOverrides,
  );
  const events = buildEvents(sourceNotes, chordTimeline, "melody-accompaniment", durationBeats);
  const fallbackEvents: Array<{ startBeat: number; endBeat: number; reason: AccompanimentFallbackReason }> = [];
  const effectiveChords: AccompanimentChord[] = [];
  const chordCovered: Array<{ startBeat: number; endBeat: number }> = [];
  const replacementCovered: Array<{ startBeat: number; endBeat: number }> = [];
  const sourceIndicesToReplace = new Set<number>();
  const sourceSupportByIndex = new Map<number, Note>();
  const generatedSupportNotes: Note[] = [];
  const supportModes = new Set<MelodyAccompanimentSupportMode>();

  if (sourceNotes.length === 0) {
    const fallbackSpans = durationBeats > EPSILON
      ? [{ startBeat: 0, endBeat: durationBeats, reason: "no source notes" as const }]
      : [];
    const arrangementEvents: ArrangementEvent[] = [];
    const changeSummary = measureArrangementChanges(sourceNotes, arrangementEvents, durationBeats, selected.unresolvedSpans);
    return {
      style: "melody-accompaniment",
      notes: [],
      chords: [],
      displayChords: buildDisplayTimeline(events, []),
      guidanceNotes: [],
      fallbackSpans,
      melody: [],
      protectedMelody: [],
      events: arrangementEvents,
      phrases: buildArrangementPhrases(durationBeats, selected, fallbackSpans, sourceNotes, arrangementEvents, events),
      changeSummary,
      provenance: {
        schemaVersion: 1,
        generatorVersion: "melody-accompaniment.v2",
        sourceFingerprint: options.sourceFingerprint ?? null,
        selection: selected.selection,
        selectionProvenance: selected.selectionProvenance,
        sourceNoteCount: 0,
        melodyNoteIds: [],
        unresolvedSpans: selected.unresolvedSpans,
        sourceSupportNoteCount: 0,
        generatedNoteCount: 0,
        generatedBeats: 0,
        soundingReattackCount: 0,
        fallbackBeats: durationBeats,
        supportModes: ["fallback"],
      },
    };
  }

  let previousSparseKey: string | null = null;
  let previousSparseStart = -Infinity;
  let previousSparseEnd = -Infinity;
  let previousSparseGeneratedIndex = -1;
  let previousLearningVoicing: number[] | null = null;
  for (const event of events.flatMap((item) => splitEventAtReviewSpans(item, selected.unresolvedSpans))) {
    const unresolved = selected.unresolvedSpans.find((span) =>
      span.startBeat < event.endBeat - EPSILON && span.endBeat > event.startBeat + EPSILON,
    );
    if (unresolved) {
      previousSparseKey = null;
      previousSparseStart = -Infinity;
      previousLearningVoicing = null;
      supportModes.add("fallback");
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: unresolved.reason,
      });
      continue;
    }
    const sourceSupport = sourceNotes
      .map((note, sourceIndex) => ({ note, sourceIndex }))
      .filter(({ note, sourceIndex }) => !selected.selectedIndices.has(sourceIndex) && overlaps(note, event.startBeat, event.endBeat));
    const reducedSupport = reduceSourceSupport(sourceNotes, selected.selectedIndices, event.startBeat, event.endBeat);
    const learning = learningChordNotes(
      event.chord,
      event.notes ?? [],
      selected.melody,
      event.startBeat,
      event.endBeat,
      previousLearningVoicing,
    );
    const notes = learning?.notes ?? null;
    if (!notes && sourceSupport.length === 0) {
      previousSparseKey = null;
      previousSparseStart = -Infinity;
      previousLearningVoicing = null;
      supportModes.add("fallback");
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: event.notes?.length ? "no playable support voicing" : fallbackReason(event),
      });
      continue;
    }
    const replacementInterval = { startBeat: event.startBeat, endBeat: event.endBeat };
    replacementCovered.push(replacementInterval);
    if (sourceSupport.length > 0) {
      previousSparseKey = null;
      previousSparseStart = -Infinity;
      supportModes.add("source-rhythm");
      for (const { note, sourceIndex } of sourceSupport) {
        if (note.start >= event.startBeat - EPSILON && note.start < event.endBeat - EPSILON) {
          sourceIndicesToReplace.add(sourceIndex);
        } else if (note.start < event.startBeat - EPSILON) {
          sourceSupportByIndex.set(sourceIndex, { ...note, hand: "L" });
        }
      }
      for (const item of reducedSupport) {
        sourceSupportByIndex.set(item.sourceIndex, item.note);
      }
    }
    if (!notes) {
      previousSparseKey = null;
      previousSparseStart = -Infinity;
      previousLearningVoicing = null;
      supportModes.add("fallback");
      fallbackEvents.push({
        startBeat: event.startBeat,
        endBeat: event.endBeat,
        reason: event.notes?.length ? "no playable support voicing" : fallbackReason(event),
      });
      continue;
    }
    effectiveChords.push({
      ...event.chord,
      beat: event.startBeat,
      notes,
      durationBeats: event.endBeat - event.startBeat,
      suggestedHands: notes.map(() => "L"),
      sourceKind: "generated",
      inferred: true,
      inferenceType: "voicing",
      ...(learning?.omittedPitchClasses.length ? { omittedPitchClasses: learning.omittedPitchClasses } : {}),
    });
    previousLearningVoicing = notes;
    chordCovered.push(replacementInterval);
    if (reducedSupport.length === 0 && sourceSupport.length === 0) {
      const sparseKey = notes.join(",");
      const repeated = sparseKey === previousSparseKey && event.startBeat <= previousSparseEnd + EPSILON;
      if (!repeated) {
        supportModes.add("sparse-harmonic");
        previousSparseStart = event.startBeat;
        previousSparseGeneratedIndex = generatedSupportNotes.length;
        const sparseNotes = sparseHarmonicSupportNotes(notes, event.startBeat, event.endBeat, options.sparseBackingTiming);
        generatedSupportNotes.push(...sparseNotes);
      } else {
        generatedSupportNotes.splice(previousSparseGeneratedIndex);
        generatedSupportNotes.push(...sparseHarmonicSupportNotes(
          notes,
          previousSparseStart,
          event.endBeat,
          options.sparseBackingTiming,
        ));
      }
      previousSparseKey = sparseKey;
      previousSparseEnd = event.endBeat;
    }
  }

  const planningBoundaries = new Set<number>([0, durationBeats]);
  for (const event of events) {
    planningBoundaries.add(event.startBeat);
    planningBoundaries.add(event.endBeat);
  }
  for (const span of selected.unresolvedSpans) {
    planningBoundaries.add(Math.max(0, Math.min(durationBeats, span.startBeat)));
    planningBoundaries.add(Math.max(0, Math.min(durationBeats, span.endBeat)));
  }
  const sortedPlanningBoundaries = [...planningBoundaries].sort((a, b) => a - b);
  for (let index = 0; index < sortedPlanningBoundaries.length - 1; index++) {
    const startBeat = sortedPlanningBoundaries[index]!;
    const endBeat = sortedPlanningBoundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) continue;
    const midpoint = (startBeat + endBeat) / 2;
    if (events.some((event) => contains(event, midpoint))
      || selected.unresolvedSpans.some((span) => contains(span, midpoint))) continue;
    const sourceSupport = sourceNotes
      .map((note, sourceIndex) => ({ note, sourceIndex }))
      .filter(({ note, sourceIndex }) => !selected.selectedIndices.has(sourceIndex)
        && playableSourceNote(note)
        && note.start >= startBeat - EPSILON
        && note.start < endBeat - EPSILON);
    const reducedSupport = reduceSourceSupport(sourceNotes, selected.selectedIndices, startBeat, endBeat);
    if (reducedSupport.length === 0 || reducedSupport.length >= sourceSupport.length) continue;
    supportModes.add("source-rhythm");
    replacementCovered.push({ startBeat, endBeat });
    for (const { sourceIndex } of sourceSupport) sourceIndicesToReplace.add(sourceIndex);
    for (const item of reducedSupport) {
      sourceSupportByIndex.set(item.sourceIndex, item.note);
    }
  }

  const sourceEvents = sourceNotes.flatMap((note, index): ArrangementEvent[] => {
    const sourceId = selected.sourceIds[index]!;
    if (selected.selectedIndices.has(index)) {
      return [{ id: `source:${sourceId}`, note, role: "melody", sourceNoteIds: [sourceId] }];
    }
    const reduced = sourceSupportByIndex.get(index);
    if (reduced) {
      return [{ id: `source:${sourceId}`, note: reduced, role: "accompaniment", sourceNoteIds: [sourceId] }];
    }
    if (!sourceIndicesToReplace.has(index)) {
      return [{ id: `source:${sourceId}`, note, role: "retained-unclassified", sourceNoteIds: [sourceId] }];
    }
    return subtractCoveredIntervals(note, replacementCovered).map((piece, pieceIndex) => ({
      id: `source:${sourceId}:piece:${pieceIndex}`,
      note: piece,
      role: "accompaniment",
      sourceNoteIds: [sourceId],
    }));
  });
  const generatedSupportEvents: ArrangementEvent[] = generatedSupportNotes.map((note, index) => ({
    id: `generated:sparse:${index}`,
    note,
    role: "accompaniment",
    sourceNoteIds: [],
  }));
  const rawArrangementEvents = [...sourceEvents, ...generatedSupportEvents]
    .sort((a, b) => a.note.start - b.note.start || a.note.midi - b.note.midi || a.id.localeCompare(b.id));
  const soundingLimits = enforceAccompanimentSoundingLimits(rawArrangementEvents);
  fallbackEvents.push(...soundingLimits.fallbackSpans);
  const arrangementEvents = soundingLimits.events;
  const fallbackSpans = buildFallbackSpans(events, chordCovered, mergeFallbackEvents(fallbackEvents), durationBeats);
  const renderedGeneratedSupport = arrangementEvents
    .filter((event) => event.role === "accompaniment" && event.sourceNoteIds.length === 0)
    .map((event) => event.note);
  const renderedSourceSupportIds = new Set(arrangementEvents
    .filter((event) => event.role === "accompaniment" && event.sourceNoteIds.length > 0)
    .flatMap((event) => event.sourceNoteIds));
  const generatedBeats = unionDuration(
    renderedGeneratedSupport.map((note) => ({ startBeat: note.start, endBeat: noteEnd(note) })),
    durationBeats,
  );
  const fallbackBeats = fallbackSpans.reduce((sum, span) => sum + Math.max(0, span.endBeat - span.startBeat), 0);
  if (supportModes.size === 0) supportModes.add("fallback");
  const melodyNoteIds = [...selected.selectedIndices].sort((a, b) => a - b).map((index) => selected.sourceIds[index]!);
  const changeSummary = measureArrangementChanges(sourceNotes, arrangementEvents, durationBeats, selected.unresolvedSpans);
  const phrases = buildArrangementPhrases(durationBeats, selected, fallbackSpans, sourceNotes, arrangementEvents, events);
  const provenance: MelodyAccompanimentProvenance = {
    schemaVersion: 1,
    generatorVersion: "melody-accompaniment.v2",
    sourceFingerprint: options.sourceFingerprint ?? null,
    selection: selected.selection,
    selectionProvenance: selected.selectionProvenance,
    sourceNoteCount: sourceNotes.length,
    melodyNoteIds,
    unresolvedSpans: selected.unresolvedSpans,
    sourceSupportNoteCount: renderedSourceSupportIds.size,
    generatedNoteCount: renderedGeneratedSupport.length,
    generatedBeats,
    soundingReattackCount: soundingLimits.reattackCount,
    fallbackBeats,
    supportModes: [...supportModes],
  };

  return {
    style: "melody-accompaniment",
    notes: arrangementEvents.map(({ note }) => note),
    chords: effectiveChords,
    displayChords: buildDisplayTimeline(events, effectiveChords),
    guidanceNotes: arrangementEvents.map(({ note }) => note),
    fallbackSpans,
    melody: selected.melody,
    protectedMelody: selected.protectedMelody,
    events: arrangementEvents,
    phrases,
    changeSummary,
    provenance,
  };
}
