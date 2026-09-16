import {
  chordIntervals,
  chordToNotes,
  tryParseChordSymbol,
  type ChordLabel,
  type Note,
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
  | "sustained source note crosses accompaniment boundary";

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
}

export interface AccompanimentOptions {
  durationBeats?: number;
  /** Stable IDs for source notes that are explicitly replaceable. */
  replaceableSourceIds?: ReadonlySet<string>;
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

function validDuration(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function noteEnd(note: Note): number {
  return note.start + Math.max(0, note.dur);
}

function isNoChord(name: string): boolean {
  return NO_CHORD.test(name.trim());
}

function compactUpperShape(chord: ChordLabel): number[] | null {
  const parsed = tryParseChordSymbol(chord.name);
  if (!parsed) return null;
  try {
    // Build the upper shape from the quality itself. `chordToNotes` includes
    // a slash bass, so using its maxNotes cap here could drop a seventh or
    // altered tone before the RH shape is even voiced.
    const rootMidi = 60 + parsed.rootPc;
    const shape = [...new Set(chordIntervals(parsed.quality).map((interval) => rootMidi + (interval % 12)))]
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
  const movement = candidate.reduce((sum, midi, index) => sum + Math.abs(midi - (previous[index] ?? midi)), 0);
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

function contains(interval: { startBeat: number; endBeat: number }, beat: number): boolean {
  return interval.startBeat <= beat + EPSILON && beat < interval.endBeat - EPSILON;
}

function overlaps(note: Note, startBeat: number, endBeat: number): boolean {
  return note.start < endBeat - EPSILON && noteEnd(note) > startBeat + EPSILON;
}

function whollyInside(note: Note, startBeat: number, endBeat: number): boolean {
  return note.start >= startBeat - EPSILON && noteEnd(note) <= endBeat + EPSILON;
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

  const boundaries = new Set<number>([0, durationBeats]);
  for (const event of events) {
    boundaries.add(event.startBeat);
    boundaries.add(event.endBeat);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const fallbackSpans: AccompanimentFallbackSpan[] = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index++) {
    const startBeat = sortedBoundaries[index]!;
    const endBeat = sortedBoundaries[index + 1]!;
    if (endBeat <= startBeat + EPSILON) continue;
    const midpoint = (startBeat + endBeat) / 2;
    if (covered.some((interval) => contains(interval, midpoint))) continue;
    const explicit = fallbackEvents.find((interval) => contains(interval, midpoint));
    fallbackSpans.push({
      startBeat,
      endBeat,
      reason: explicit?.reason ?? "no chord coverage",
    });
  }

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
