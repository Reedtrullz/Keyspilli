import { splitHands, detectBassPattern, detectKey, chordName } from "./analyze.js";
import { Note, ParsedMidi, SongMeta, Variant, DifficultyLevel, LEVEL_ORDER, ChordLabel } from "./types.js";
import { quantize } from "./quantize.js";
import { BEGINNER_OFFGRID_CANDIDATE, LADDER_TOL, PLAYABILITY_LIMITS } from "./validate.js";
import { sanitizeImportedNotes } from "./clean.js";
import { validateChordLabels } from "./chords.js";
import {
  selectGuitarLeadPath,
  type MetalArrangementTraceEvent,
  type MetalArrangementTraceOperation,
  type MetalArrangementTraceSink,
} from "./metal-arrange.js";
import {
  assessBeginnerOffGridCandidate,
  selectBeginnerOffGridRhCandidates,
  type BeginnerOffGridRejectedCandidate,
} from "./beginner-offgrid.js";
import { selectProtectedSemanticLocalThinning } from "./density-normalization-audit.js";

export interface VariantOptions {
  /** 16th-note grid (beats) used for note slicing */
  grid?: number;
  /** octave-shift notes outside the piano range (21-108) into it */
  normalizeRange?: boolean;
  /**
   * Optional hard ceiling for imported note sustains, in beats.  Audio
   * transcriptions often inherit a detector's tail (or a pedal resonance)
   * instead of a real note-off; callers that have a transcription source can
   * use this to keep those tails from masking the next melodic attack. Pass
   * `null` for a human-authored source whose long sustains are intentional.
   */
  maxDurBeats?: number | null;
  /**
   * Arrangement intent. `source` keeps the imported staff assignment as
   * faithfully as possible (the historical direct-call behaviour). `learner`
   * applies conservative two-hand, melody-over-chords shaping. `metal` uses
   * the same learner safety gates but treats the supplied RH/LH roles as a
   * semantic piano cover, retaining sparse harmonic anchors at every level.
   */
  arrangementProfile?: "source" | "learner" | "metal";
  /**
   * The source is an audio transcription whose one-staff pitch stream may
   * need inferred inner-voice placement. Keep this opt-in so curated MIDI
   * and MusicXML arrangements are never octave-revoiced by a shape-only
   * heuristic.
   */
  audioDerived?: boolean;
  /** Authoritative harmony from a role-aware arranger. Avoid per-level re-inference. */
  chords?: ChordLabel[];
  /** Optional development-only lineage sidecar; never changes variant bytes. */
  trace?: MetalArrangementTraceSink;
}

type LearnerInternalNote = Note & {
  learnerTraceRefs?: readonly string[];
  rawMidi?: number;
};

function learnerTraceRefs(note: Note): readonly string[] {
  const refs = (note as LearnerInternalNote).learnerTraceRefs;
  return refs ? [...refs].sort() : [];
}

function learnerTuple(note: Note): string {
  return `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.hand ?? "?"}:${note.identitySource ?? "unknown"}:${note.lyrics ?? ""}`;
}

function compareLearnerNotes(a: Note, b: Note): number {
  const text = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  return a.start - b.start
    || a.midi - b.midi
    || a.dur - b.dur
    || a.vel - b.vel
    || text(a.hand ?? "", b.hand ?? "")
    || text(a.identitySource ?? "", b.identitySource ?? "")
    || text(a.lyrics ?? "", b.lyrics ?? "");
}

/** Seed deterministic source IDs without using caller/input array order. */
function seedLearnerTrace(notes: Note[]): LearnerInternalNote[] {
  const counts = new Map<string, number>();
  const ids = new Map<string, string[]>();
  for (const note of [...notes].sort(compareLearnerNotes)) {
    const tuple = learnerTuple(note);
    const occurrence = counts.get(tuple) ?? 0;
    counts.set(tuple, occurrence + 1);
    const values = ids.get(tuple) ?? [];
    values.push(`learner:source:${tuple}:${occurrence}`);
    ids.set(tuple, values);
  }
  const consumed = new Map<string, number>();
  return notes.map((note) => {
    const tuple = learnerTuple(note);
    const index = consumed.get(tuple) ?? 0;
    consumed.set(tuple, index + 1);
    return { ...note, learnerTraceRefs: [ids.get(tuple)?.[index] ?? `learner:source:${tuple}:${index}`] };
  });
}

function stripLearnerTrace(note: Note): Note {
  const { learnerTraceRefs: _learnerTraceRefs, rawMidi: _rawMidi, ...publicNote } = note as LearnerInternalNote;
  return publicNote;
}

function traceRoots(
  event: MetalArrangementTraceEvent,
  byKey: Map<string, MetalArrangementTraceEvent>,
  memo: Map<string, Set<string>>,
  visiting = new Set<string>(),
): Set<string> {
  const cached = memo.get(event.key);
  if (cached) return cached;
  if (visiting.has(event.key)) return new Set();
  visiting.add(event.key);
  const roots = new Set<string>();
  if (event.parentKeys.length) {
    for (const parentKey of event.parentKeys) {
      const parent = byKey.get(parentKey);
      if (parent) for (const root of traceRoots(parent, byKey, memo, visiting)) roots.add(root);
      else roots.add(parentKey);
    }
  } else roots.add(event.key);
  visiting.delete(event.key);
  memo.set(event.key, roots);
  return roots;
}

function learnerSourceKey(note: Note): string {
  return `${note.hand ?? "R"}:${note.start.toFixed(9)}:${note.midi}:${note.dur.toFixed(9)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

function resolveBeginnerOffGridRejections(
  events: MetalArrangementTraceEvent[],
  sourceNotes: Note[],
): BeginnerOffGridRejectedCandidate[] {
  const byKey = new Map(events.map((event) => [event.key, event]));
  const memo = new Map<string, Set<string>>();
  const result: BeginnerOffGridRejectedCandidate[] = [];
  for (const event of events) {
    if (event.stage !== "beginner-ladder" || event.selected !== false || !event.note || !event.parentKeys.length) continue;
    const roots = [...traceRoots(event, byKey, memo)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    if (roots.length !== 1) continue;
    const raw = byKey.get(roots[0]!);
    if (!raw?.note) continue;
    const source = sourceNotes
      .filter((note) => note.midi === raw.note!.midi && Math.abs(note.start - raw.note!.start) <= 1e-6)
      .sort((left, right) => Math.abs(left.dur - raw.note!.dur) - Math.abs(right.dur - raw.note!.dur)
        || Math.abs(left.vel - raw.note!.vel) - Math.abs(right.vel - raw.note!.vel)
        || (() => {
          const leftKey = learnerSourceKey(left);
          const rightKey = learnerSourceKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })())[0];
    if (source) result.push({ note: { ...source }, sourceKey: roots[0]! });
  }
  return [...new Map(result.map((candidate) => [candidate.sourceKey, candidate])).values()];
}

/**
 * Recover the same rejected source events without materializing the complete
 * learner-stage trace. The full graph is reserved for explicit trace sinks;
 * Candidate A only needs the single-ref parents that did not survive the
 * Beginner ladder.
 */
function resolveBeginnerOffGridRejectionsFromLineage(
  beforeLadder: Note[],
  afterLadder: Note[],
  sourceNotes: Note[],
): BeginnerOffGridRejectedCandidate[] {
  const selectedRefs = new Set(afterLadder.flatMap(learnerTraceRefs));
  const sourceByRef = new Map<string, Note>();
  for (const source of sourceNotes) {
    for (const ref of learnerTraceRefs(source)) sourceByRef.set(ref, source);
  }
  const rejected = new Map<string, BeginnerOffGridRejectedCandidate>();
  for (const note of beforeLadder) {
    const refs = learnerTraceRefs(note);
    // A merged parent is either retained as a whole or rejected as a whole in
    // emitLearnerStageTrace; do not split its source IDs here.
    if (refs.length !== 1 || refs.some((ref) => selectedRefs.has(ref))) continue;
    const source = sourceByRef.get(refs[0]!);
    if (source) rejected.set(refs[0]!, { note: { ...source }, sourceKey: refs[0]! });
  }
  return [...rejected.values()];
}

function difficultyTraceKey(level: DifficultyLevel, note: Note, index: number): string {
  return `difficulty:${level}:${index}:${note.hand ?? "?"}:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

/** Stable fallback key for metal arrangements whose parsed MIDI has no refs. */
function canonicalTraceKey(note: Note): string {
  return `final:${note.hand ?? "?"}:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

interface DifficultyParentResult {
  parents: Note[];
  operation: MetalArrangementTraceOperation;
  parentKeys?: string[];
}

function difficultyParent(note: Note, canonical: Note[], startTolerance: number): DifficultyParentResult {
  const refs = learnerTraceRefs(note);
  if (refs.length) {
    const sources = canonical
      .filter((candidate) => learnerTraceRefs(candidate).some((ref) => refs.includes(ref)))
      .sort(compareLearnerNotes);
    return sources.length
      ? {
        parents: sources,
        operation: learnerOperation(note, sources) ?? "RETAINED",
        parentKeys: sources.map((source) => learnerTraceKey("raw", source, 0, "selected")),
      }
      : { parents: [], operation: "GENERATED" };
  }
  const candidates = canonical
    .map((source) => ({ source, start: Math.abs(source.start - note.start), pitch: Math.abs(source.midi - note.midi), dur: Math.abs(source.dur - note.dur) }))
    .filter(({ source }) => source.hand === note.hand && source.identitySource === note.identitySource)
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.dur - b.dur || a.source.midi - b.source.midi);
  const exact = candidates.find(({ start, pitch }) => start <= startTolerance && pitch === 0);
  if (exact) return {
    parents: [exact.source],
    operation: learnerOperation(note, [exact.source]) ?? "RETAINED",
    parentKeys: [canonicalTraceKey(exact.source)],
  };
  const nearby = candidates.find(({ start }) => start <= startTolerance);
  if (nearby) return {
    parents: [nearby.source],
    operation: learnerOperation(note, [nearby.source]) ?? "REPLACED",
    parentKeys: [canonicalTraceKey(nearby.source)],
  };
  return { parents: [], operation: "GENERATED" };
}

function emitDifficultyTrace(
  sink: MetalArrangementTraceSink | undefined,
  level: DifficultyLevel,
  notes: Note[],
  canonical: Note[],
): void {
  if (!sink) return;
  // The learner ladder intentionally quantizes the very-easy/beginner floors
  // more coarsely than the canonical stream. Keep that deterministic timing
  // transform traceable without treating a rounded attack as newly invented.
  const startTolerance = level === "very-beginner" ? 0.5 : level === "beginner" || level === "very-easy" ? 0.25 : 0.125;
  for (const [index, note] of notes.entries()) {
    const parent = difficultyParent(note, canonical, startTolerance + 1e-9);
    const parentKeys = parent.parentKeys ?? parent.parents.map((source) => learnerTraceKey("raw", source, 0, "selected"));
    const event: MetalArrangementTraceEvent = {
      key: difficultyTraceKey(level, note, index),
      stage: "difficulty",
      parentKeys,
      source: note.identitySource ?? null,
      sourceStem: note.identitySource ?? null,
      note: {
        ...learnerTraceNote(note),
      },
      selected: true,
      selectionReason: `difficulty-${level}-${parent.operation.toLowerCase()}`,
      operation: parent.operation,
    };
    sink.record(event);
  }
}

type LearnerTraceParent = { stage: MetalArrangementTraceEvent["stage"], notes: Note[] };

function learnerTraceKey(
  stage: MetalArrangementTraceEvent["stage"],
  note: Note,
  index: number,
  state: "selected" | "rejected",
): string {
  const refs = learnerTraceRefs(note);
  // Source IDs plus the transformed note tuple are stable even when a stage
  // passes a hand-filtered parent pool (so a later stage can still resolve the
  // exact parent key without depending on that pool's local array index).
  if (refs.length) {
    return `learner:${stage}:${state}:${refs.join("|")}:${learnerTuple(note)}`;
  }
  const identity = refs.length ? refs.join("|") : learnerTuple(note);
  return `learner:${stage}:${state}:${index}:${identity}`;
}

function learnerTraceNote(note: Note): NonNullable<MetalArrangementTraceEvent["note"]> {
  const internal = note as LearnerInternalNote;
  return {
    midi: note.midi,
    ...(internal.rawMidi === undefined ? {} : { rawMidi: internal.rawMidi }),
    start: note.start,
    dur: note.dur,
    vel: note.vel,
    ...(note.hand ? { hand: note.hand } : {}),
  };
}

function learnerTraceDistance(a: Note, b: Note): number {
  if (a.hand !== b.hand || a.identitySource !== b.identitySource) return Number.POSITIVE_INFINITY;
  return Math.abs(a.start - b.start) * 100
    + Math.abs(a.midi - b.midi) * 10
    + Math.abs(a.dur - b.dur)
    + Math.abs(a.vel - b.vel) / 127;
}

function learnerOperation(note: Note, parents: Note[]): MetalArrangementTraceEvent["operation"] {
  if (!parents.length) return "GENERATED";
  if (parents.length > 1) return "MERGED";
  const parent = parents[0]!;
  const changes: MetalArrangementTraceOperation[] = [
    note.midi !== parent.midi ? (Math.abs(note.midi - parent.midi) % 12 === 0 ? "OCTAVE_SHIFTED" : "PITCH_CHANGED") : undefined,
    Math.abs(note.start - parent.start) > 1e-9 ? "TIMING_CHANGED" : undefined,
    Math.abs(note.dur - parent.dur) > 1e-9 ? "DURATION_CHANGED" : undefined,
    note.hand !== parent.hand ? "HAND_CHANGED" : undefined,
    note.identitySource !== parent.identitySource ? "ROLE_CHANGED" : undefined,
  ].filter((value): value is MetalArrangementTraceOperation => value !== undefined);
  return changes.length === 0 ? "RETAINED" : changes.length === 1 ? changes[0] : "REPLACED";
}

/** Emit deterministic source-to-Easy lineage only for an explicit trace sink. */
function emitLearnerStageTrace(
  sink: MetalArrangementTraceSink | undefined,
  stage: MetalArrangementTraceEvent["stage"],
  notes: Note[],
  parents: LearnerTraceParent[],
  selectionReason: string,
): void {
  if (!sink) return;
  const ordered = [...notes].sort(
    compareLearnerNotes,
  );
  const parentPool = parents.flatMap(({ stage: parentStage, notes: parentNotes }) => {
    const parentOrdered = [...parentNotes].sort(compareLearnerNotes);
    return parentOrdered.map((note, index) => ({
      stage: parentStage,
      note,
      index,
      key: learnerTraceKey(parentStage, note, index, "selected"),
      refs: learnerTraceRefs(note),
    }));
  });
  const used = new Set<number>();
  const matched = new Set<number>();
  const usedRefs = new Set<string>();
  for (const [index, note] of ordered.entries()) {
    const refs = learnerTraceRefs(note);
    const direct = parentPool.filter((entry) => refs.some((ref) => entry.refs.includes(ref)));
    let matches = direct;
    if (!matches.length) {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let parentIndex = 0; parentIndex < parentPool.length; parentIndex++) {
        if (used.has(parentIndex)) continue;
        const distance = learnerTraceDistance(note, parentPool[parentIndex]!.note);
        if (distance < bestDistance - 1e-9) {
          bestIndex = parentIndex;
          bestDistance = distance;
        }
      }
      if (bestIndex >= 0) {
        matches = [parentPool[bestIndex]!];
        used.add(bestIndex);
      }
    }
    for (const match of matches) {
      const parentIndex = parentPool.indexOf(match);
      if (parentIndex >= 0) matched.add(parentIndex);
      for (const ref of match.refs) usedRefs.add(ref);
    }
    const parentNotes = matches.map((match) => match.note);
    const operation = learnerOperation(note, parentNotes);
    sink.record({
      key: learnerTraceKey(stage, note, index, "selected"),
      stage,
      parentKeys: matches.map((match) => match.key),
      source: note.identitySource ?? null,
      sourceStem: note.identitySource ?? null,
      note: learnerTraceNote(note),
      selected: true,
      operation,
      selectionReason: `${selectionReason}-${operation?.toLowerCase() ?? "generated"}`,
    });
  }
  for (let index = 0; index < parentPool.length; index++) {
    if (matched.has(index)) continue;
    const parent = parentPool[index]!;
    sink.record({
      key: learnerTraceKey(stage, parent.note, index, "rejected"),
      stage,
      parentKeys: [parent.key],
      source: parent.note.identitySource ?? null,
      sourceStem: parent.note.identitySource ?? null,
      note: learnerTraceNote(parent.note),
      selected: false,
      operation: parent.refs.some((ref) => usedRefs.has(ref)) ? "COLLAPSED" : "REJECTED",
      selectionReason: `${selectionReason}-${parent.refs.some((ref) => usedRefs.has(ref)) ? "collapsed" : "rejected"}`,
    });
  }
}

export const SAFE_TEMPO_BPM = 120;

/**
 * Array-safe numeric extrema for imported material.  Audio transcriptions can
 * contain hundreds of thousands of sequential attacks; spreading those
 * arrays into Math.min/Math.max exceeds V8's argument-list limit.
 */
function maxNumber(values: Iterable<number>, fallback = Number.NEGATIVE_INFINITY): number {
  let result = fallback;
  for (const value of values) {
    if (Number.isFinite(value) && value > result) result = value;
  }
  return result;
}

function minNumber(values: Iterable<number>, fallback = Number.POSITIVE_INFINITY): number {
  let result = fallback;
  for (const value of values) {
    if (Number.isFinite(value) && value < result) result = value;
  }
  return result;
}

function maxNoteEnd(notes: Iterable<Note>, fallback = 0): number {
  let result = fallback;
  for (const note of notes) {
    const end = note.start + note.dur;
    if (Number.isFinite(end) && end > result) result = end;
  }
  return result;
}

/** Return a publishable integer tempo, falling back for malformed MIDI meta. */
export function normalizeTempoBpm(value: number | undefined, fallback = SAFE_TEMPO_BPM): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20 || n > 300) return fallback;
  return Math.round(n);
}

/** Shift out-of-piano-range notes by octaves so everything is playable. */
export function normalizePianoRange(notes: Note[]): Note[] {
  return notes.map((n) => {
    let midi = n.midi;
    while (midi < 21) midi += 12;
    while (midi > 108) midi -= 12;
    return midi === n.midi ? n : { ...n, midi };
  });
}

/**
 * Pitches that sound for >= 30% of the song's total duration. Basic Pitch
 * tracks sustained background layers (pads/shimmer) that re-trigger on every
 * attack; choosing them as "the melody" produces a constant-note line. Voice
 * selection prefers non-pad pitches, falling back to a pad when nothing else
 * sounds in a slice.
 */
export function padPitches(notes: Note[]): Set<number> {
  const pads = new Set<number>();
  if (!notes.length) return pads;
  const total = maxNoteEnd(notes);
  const sounding = new Map<number, number>();
  for (const n of notes) sounding.set(n.midi, (sounding.get(n.midi) ?? 0) + n.dur);
  for (const [midi, dur] of sounding) {
    if (dur / total >= 0.3) pads.add(midi);
  }
  return pads;
}

function chordsAt(
  notes: Note[],
  grid: number,
  arrangementEnd?: number,
  preserveShortLhStacks = false,
): ChordLabel[] {
  const bySlice = new Map<number, { all: Note[]; lh: Note[]; rh: Note[] }>();
  for (const note of notes) {
    const beat = Math.round(note.start / grid) * grid;
    const slice = bySlice.get(beat) ?? { all: [], lh: [], rh: [] };
    slice.all.push(note);
    if (note.hand === "L") slice.lh.push(note);
    else if (note.hand === "R") slice.rh.push(note);
    bySlice.set(beat, slice);
  }
  const out: ChordLabel[] = [];
  for (const [beat, slice] of [...bySlice.entries()].sort((a, b) => a[0] - b[0])) {
    const longNotes = slice.all.filter((note) => note.dur >= 0.25);
    const shortStackPitchClasses = new Set(slice.lh.map((note) => note.midi % 12));
    const eligibleShortLh = preserveShortLhStacks && shortStackPitchClasses.size >= 2
      ? slice.lh.filter((note) => note.dur < 0.25)
      : [];
    const eligible = [...longNotes, ...eligibleShortLh];
    // The left hand is the most reliable harmonic evidence in a piano
    // arrangement. If it has at least two distinct pitch classes, keep that
    // voicing and avoid allowing the highest melody note to rename the chord.
    // For melody-only/legacy material, use the full cluster minus its top
    // voice where possible, then fall back to the complete cluster.
    const lh = [...new Set(eligible.filter((note) => note.hand === "L").map((note) => note.midi))]
      .sort((a, b) => a - b);
    const all = [...new Set(eligible.map((note) => note.midi))].sort((a, b) => a - b);
    const lhPitchClasses = new Set(lh.map((midi) => midi % 12));
    const harmonic = lhPitchClasses.size >= 2
      ? lh
      : all.length > 2
        ? all.slice(0, -1)
        : all;
    // Generated chord playback is a learner accompaniment, not a verbatim
    // dump of every sounding pitch. Preserve the absolute bass and upper
    // shell while keeping the voicing compact and playable.
    const canonicalNotes = [...new Set(harmonic)].sort((a, b) => a - b);
    const compactNotes = canonicalNotes.length > 4
      ? [canonicalNotes[0]!, ...canonicalNotes.slice(-3)]
      : canonicalNotes;
    const pcs = [...new Set(compactNotes.map((m) => m % 12))].sort((a, b) => a - b);
    if (pcs.length < 2) continue;
    const bassPc = compactNotes[0]! % 12;
    const name = chordName(pcs, bassPc);
    if (!name) continue; // unlabelable dyad (root+3rd, chromatic clash, ...)
    out.push({
      beat,
      name,
      notes: compactNotes,
      sourceKind: "generated",
      inferred: true,
      inferenceType: "voicing",
    });
  }
  // Per-grid-slice analysis produces the same chord every 0.25 beats; collapse
  // consecutive same-name runs and keep only runs that hold >= 1 beat, so the
  // progression shows real changes instead of harmonic flashes.
  const kept: ChordLabel[] = [];
  if (out.length) {
    let runStart = out[0]!;
    for (let i = 1; i <= out.length; i++) {
      const current = out[i];
      if (current && current.name === runStart.name) continue;
      const runEndBeat = current?.beat ?? Math.max(
        arrangementEnd ?? 0,
        maxNoteEnd(notes),
        runStart.beat + 1,
      );
      if (runEndBeat - runStart.beat >= 1) {
        kept.push({
          ...runStart,
          durationBeats: runEndBeat - runStart.beat,
        });
      }
      if (current) runStart = current;
    }
  }
  return kept;
}

/**
 * Medium-level rhythmic reduction: drop short off-eighth passing tones that
 * are not an outer voice of their hand's slice. A note is a passing tone when
 * the next same-hand onset lands < 0.25 beats after it. Slice top (melody)
 * and bottom (bass) survive; single-note slices have no outer voice, so
 * scalar 16th-note runs collapse to eighths on the grid. Selection-only (no
 * start shifts), so the ladder stays a true subset of advanced.
 */
export function reduceMediumRhythm(notes: Note[]): Note[] {
  const handOf = (n: Note) => (n.hand === "L" ? "L" : "R");
  const sliceKey = (n: Note) => `${handOf(n)}:${Math.round(n.start / 0.125)}`;
  const bySlice = new Map<string, Note[]>();
  const onsetsByHand = new Map<string, number[]>();
  for (const n of notes) {
    const key = sliceKey(n);
    const arr = bySlice.get(key) ?? [];
    arr.push(n);
    bySlice.set(key, arr);
    const hand = handOf(n);
    const onsets = onsetsByHand.get(hand) ?? [];
    onsets.push(n.start);
    onsetsByHand.set(hand, onsets);
  }
  const high = new Map<string, number>();
  const low = new Map<string, number>();
  for (const [key, ns] of bySlice) {
    high.set(key, maxNumber(ns.map((n) => n.midi)));
    low.set(key, minNumber(ns.map((n) => n.midi)));
  }
  const sortedOnsets = new Map<string, number[]>();
  for (const [hand, onsets] of onsetsByHand) {
    sortedOnsets.set(hand, [...new Set(onsets)].sort((a, b) => a - b));
  }
  return notes.filter((n) => {
    const hand = handOf(n);
    const key = sliceKey(n);
    const k = Math.round(n.start / 0.125);
    // Passing tones are defined by onset spacing: a sustained note attacked
    // 0.125 beats after an off-eighth start is still a passing tone.
    if (k % 2 !== 1) return true;
    const ns = bySlice.get(key)!;
    const isOuter = ns.length >= 2 && (n.midi === high.get(key) || n.midi === low.get(key));
    if (isOuter) return true;
    const next = sortedOnsets.get(hand)!.find((o) => o > n.start + 1e-9);
    return next === undefined || next - n.start >= 0.25;
  });
}

/**
 * Keep the upper guitar line separate from a simultaneous low rhythm wall in
 * learner metal variants. The arranger has already reduced each stem to one
 * event per onset, so a high, moving lead phrase is the useful identity while
 * low attacks in that same phrase are almost always accompaniment leakage.
 * This is deliberately gated to legato learner levels; Advanced retains the
 * source detail and the vocal lane is never filtered here.
 */
function suppressLowGuitarLeadFiller(notes: Note[], legato: boolean): Note[] {
  if (!legato || notes.length < 4) return notes;
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const guitar = sorted.filter((note) => note.identitySource === "guitar");
  if (guitar.length < 4) return notes;

  const leadPhraseNotes = new Set<Note>();
  for (const note of guitar) {
    if (note.midi > 62) continue;
    // Use a short sliding window instead of only consecutive events. A
    // separated stem can contain rests or vocal handoffs between the upper
    // lead and its low rhythm partials; those gaps must not hide the lead
    // evidence that tells us the low event belongs in the accompaniment.
    const high = guitar.filter((candidate) =>
      candidate.midi >= 68 && Math.abs(candidate.start - note.start) <= 4 + 1e-9,
    );
    const distinctHigh = new Set(high.map((note) => note.midi)).size;
    const highSpan = high.length
      ? Math.max(...high.map((note) => note.midi)) - Math.min(...high.map((note) => note.midi))
      : 0;
    // A few upper attacks with a moving contour are enough to distinguish a
    // lead/solo phrase from a low riff. Requiring both register and contour
    // keeps a single high chord partial from suppressing a genuine low lead.
    const leadLike = high.length >= 3
      && distinctHigh >= 3
      && (highSpan >= 5 || Math.max(...high.map((note) => note.midi)) >= 76);
    if (leadLike) leadPhraseNotes.add(note);
  }
  if (!leadPhraseNotes.size) return notes;
  return notes.filter((note) => !leadPhraseNotes.has(note));
}

/**
 * Remove a short guitar excursion when the source lane makes an obvious
 * return to the same pitch neighbourhood. The identity stream is often
 * interleaved with vocal anchors, so looking only at adjacent events misses
 * exactly these detector detours. This pass deliberately skips vocals while
 * finding guitar neighbours and is limited to legato learner levels; the
 * Advanced lane remains a faithful source-detail reference.
 */
function removeInterleavedGuitarDetours(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  let current = [...notes];
  // A second pass catches a pair of adjacent excursions without allowing a
  // long chain of removals to collapse an entire phrase into its endpoints.
  for (let pass = 0; pass < 2; pass++) {
    const sorted = current.sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
    const remove = new Set<Note>();
    for (const source of ["guitar", "other"] as const) {
      const sourceIndexes = sorted
        .map((note, index) => note.identitySource === source ? index : -1)
        .filter((index) => index >= 0);
      for (let position = 1; position < sourceIndexes.length - 1; position++) {
        const previous = sorted[sourceIndexes[position - 1]!]!;
        const note = sorted[sourceIndexes[position]!]!;
        const next = sorted[sourceIndexes[position + 1]!]!;
        const interveningVocal = sorted
          .slice(sourceIndexes[position]! + 1, sourceIndexes[position + 1]!)
          .find((candidate) => candidate.identitySource === "vocals");
        const phraseLanding = interveningVocal !== undefined
          && interveningVocal.start - note.start <= 1.5 + 1e-9
          && note.start - previous.start <= 1 + 1e-9
          && Math.abs(note.midi - previous.midi) <= 7;
        if (phraseLanding) continue;
        const intoBeats = note.start - previous.start;
        const outBeats = next.start - note.start;
        const durationSec = note.dur * secondsPerBeat;
        const downbeat = Math.abs(note.start - Math.round(note.start)) <= 1e-9;
        // A quiet, short detector spike on a barline is still removable. Real
        // downbeat landings are protected by their velocity/duration (and by
        // the high-landing guard below), rather than by timing alone.
        const downbeatAnchor = downbeat && (note.vel >= 90 || durationSec >= 0.35);
        const highLanding = note.midi >= 76
          && note.midi >= Math.max(previous.midi, next.midi)
          && (note.vel >= 90 || durationSec >= 0.35);
        const detour = intoBeats <= 1.5 + 1e-9
          && outBeats <= 1.5 + 1e-9
          && durationSec <= 0.35 + 1e-9
          && !downbeatAnchor
          && !highLanding
          && note.vel < 100
          && Math.abs(note.midi - previous.midi) >= 5
          && Math.abs(note.midi - next.midi) >= 5
          && Math.abs(previous.midi - next.midi) <= 5
          && Math.sign(note.midi - previous.midi) !== Math.sign(next.midi - note.midi);
        if (detour) remove.add(note);
      }
    }
    if (!remove.size) break;
    current = sorted.filter((note) => !remove.has(note));
  }
  return current;
}

/**
 * Remove an isolated guitar interjection immediately before a vocal anchor
 * when it would force a large, fast register handoff.  A vocal phrase is
 * identity-bearing, so it is never filtered; this gate only removes a weak
 * guitar singleton that has no nearby guitar support of its own.  Keeping
 * the gate source-aware is important: the reference arrangement has a dense
 * lower accompaniment, but its upper line does not alternate between distant
 * instrumental and vocal registers on every attack.
 */
function removeWeakGuitarVocalHandoffs(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const vocals = sorted.filter((note) => note.identitySource === "vocals");
  const instrumentals = sorted.filter((note) => isMetalInstrumentalSource(note.identitySource));
  if (vocals.length < 1 || instrumentals.length < 1) return notes;
  const maxVocalBracketBeats = 1.5;
  const maxHandoffBeats = 1;
  const maxSupportBeats = 0.75;
  return sorted.filter((note) => {
    if (!isMetalInstrumentalSource(note.identitySource)) return true;
    const source = note.identitySource;
    const nextVocal = vocals.find((vocal) => vocal.start >= note.start - 1e-9 && vocal.start - note.start <= maxVocalBracketBeats + 1e-9);
    // A guitar attack immediately before a vocal entrance is the risky case:
    // it can make the next singer note appear as a register jump. Restrict
    // this gate to that direction. Guitar attacks after a vocal are retained
    // so a phrase landing is not deleted merely because the next vocal is
    // farther away.
    if (!nextVocal) return true;

    const previousInstrumental = [...instrumentals]
      .reverse()
      .find((candidate) => candidate.identitySource === source && candidate.start < note.start - 1e-9);
    const nextInstrumental = instrumentals
      .find((candidate) => candidate.identitySource === source && candidate.start > note.start + 1e-9);
    const durationSec = note.dur * secondsPerBeat;
    const toVocal = nextVocal.start - note.start;
    const nextLeap = Math.abs(nextVocal.midi - note.midi);
    const terminalStepWorsensHandoff = previousInstrumental !== undefined
      && note.start - previousInstrumental.start <= maxSupportBeats + 1e-9
      && toVocal <= maxHandoffBeats + 1e-9
      // Legato scheduling may have already lengthened a selected detector
      // attack to the next vocal entrance. Permit that bounded extension
      // here, while still rejecting genuinely sustained (>~half-second)
      // bridge notes.
      && durationSec <= 0.55 + 1e-9
      && note.vel < 80
      && Math.abs(note.midi - previousInstrumental.midi) <= 5
      && nextLeap >= 12
      && nextLeap >= Math.abs(nextVocal.midi - previousInstrumental.midi) + 3;
    if (terminalStepWorsensHandoff) return false;
    const supportedByPrevious = previousInstrumental !== undefined
      && note.start - previousInstrumental.start <= maxSupportBeats + 1e-9;
    const supportedByNext = nextInstrumental !== undefined
      && nextInstrumental.start - note.start <= maxSupportBeats + 1e-9;
    if (supportedByPrevious || supportedByNext) return true;

    const abruptHandoff = toVocal <= maxHandoffBeats + 1e-9 && nextLeap >= 9;
    if (!abruptHandoff) return true;

    const protectedLanding = note.vel >= 90
      || durationSec >= 0.5
      || (note.midi >= 76 && (note.vel >= 80 || durationSec >= 0.35));
    if (protectedLanding) return true;
    return false;
  });
}

/**
 * A legato learner may tie detector re-attacks, but a repeated pitch inside a
 * changing guitar contour is still a real melodic event. Basic Pitch often
 * emits two or three same-pitch attacks immediately before a stepwise move;
 * collapsing those before contour selection is the main way a metal solo
 * becomes unnaturally sparse. Require a genuine local contour before
 * preserving the re-attack so a single-pitch rhythm wall keeps the existing
 * tie/thinning behaviour.
 */
function hasMovingGuitarContext(note: Note, source: Note[]): boolean {
  if (note.identitySource !== "guitar") return false;
  const context = source
    .filter((candidate) => candidate.identitySource === "guitar"
      && Math.abs(candidate.start - note.start) <= 2.5 + 1e-9)
    .sort((a, b) => a.start - b.start || b.vel - a.vel);
  if (new Set(context.map((candidate) => candidate.midi)).size < 3) return false;
  return context.some((candidate) => candidate.midi !== note.midi
    && Math.abs(candidate.start - note.start) <= 0.9 + 1e-9);
}

/**
 * Remove a very weak, short vocal fragment that immediately returns to the
 * same pitch. Basic Pitch can split one sung syllable into a tiny lower
 * contour flicker; making that flicker a learner attack is more distracting
 * than helpful. Keep this deliberately narrower than the guitar cleanup:
 * only repeated-pitch brackets are eligible, vocal notes remain untouched in
 * Advanced/source levels, and a sustained, loud, or otherwise substantial
 * centre note is always retained.
 */
function removeWeakVocalDetours(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const vocals = sorted.filter((note) => note.identitySource === "vocals");
  if (vocals.length < 3) return notes;

  const remove = new Set<Note>();
  const maxBracketBeats = 1;
  const maxCentreDurationSec = 0.35;
  const maxCentreVelocity = 70;
  const maxEndpointDistance = 2;
  const minExcursion = 3;

  for (let index = 1; index < vocals.length - 1; index++) {
    const previous = vocals[index - 1]!;
    const note = vocals[index]!;
    const next = vocals[index + 1]!;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    const durationSec = note.dur * secondsPerBeat;
    const centreIsWeak = note.vel <= maxCentreVelocity
      && note.vel <= Math.max(previous.vel, next.vel) * 0.8 + 1e-9;
    const repeatedBracket = previous.midi === next.midi;
    const isDetour = repeatedBracket
      && beforeBeats > 0
      && afterBeats > 0
      && beforeBeats <= maxBracketBeats + 1e-9
      && afterBeats <= maxBracketBeats + 1e-9
      && durationSec <= maxCentreDurationSec + 1e-9
      && note.vel < maxCentreVelocity
      && centreIsWeak
      && Math.abs(note.midi - previous.midi) >= minExcursion
      && Math.abs(note.midi - next.midi) >= minExcursion
      && Math.abs(previous.midi - next.midi) <= maxEndpointDistance;
    if (isDetour) remove.add(note);
  }

  return remove.size ? sorted.filter((note) => !remove.has(note)) : notes;
}

/**
 * Remove an unsupported residual-stem spike before learner merging can make
 * its neighbours look farther apart.  The `other` lane is often a full-mix
 * residue: a quiet, eighth-note detector hit can sit between two ordinary
 * upper attacks and sound like a random piano leap.  Keep this deliberately
 * residual-only and legato-only; vocals, dedicated guitar, and Advanced
 * source detail are not altered.
 */
function removeResidualUpperOutliers(notes: Note[], legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const residual = notes
    .filter((note) => note.identitySource === "other" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  if (residual.length < 3) return notes;

  const remove = new Set<Note>();
  for (let index = 1; index < residual.length - 1; index++) {
    const previous = residual[index - 1]!;
    const note = residual[index]!;
    const next = residual[index + 1]!;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    if (beforeBeats > 1.5 + 1e-9 || afterBeats > 1.5 + 1e-9) continue;
    if (note.vel > 48 || note.dur > 0.375 + 1e-9) continue;
    if (Math.abs(note.midi - previous.midi) < 7 || Math.abs(note.midi - next.midi) < 7) continue;
    if (Math.abs(previous.midi - next.midi) > 5) continue;
    const hasSamePitchSupport = residual.some((candidate) => candidate !== note
      && candidate.midi === note.midi
      && Math.abs(candidate.start - note.start) <= 2 + 1e-9);
    if (hasSamePitchSupport) continue;
    remove.add(note);
  }
  return remove.size ? notes.filter((note) => !remove.has(note)) : notes;
}

/**
 * Remove a single weak guitar attack that is literally bracketed by vocal
 * attacks in the selected learner melody.  The pre-selection handoff guard
 * above cannot see this shape reliably: richer candidates can support the
 * guitar note before scheduling and then be discarded by the spacing/voice
 * selector.  Run this bounded post-selection pass so the decision is based
 * on the notes that will actually be played.
 *
 * This is intentionally narrower than a general source smoother.  Vocals are
 * immutable; a guitar run with a nearby guitar neighbour is retained; and a
 * strong, sustained, or high landing is retained.  Only an exact-pitch
 * redundant singleton or one that creates a >=7-semitone vocal handoff inside
 * one beat is removed.  Advanced/source detail bypasses the pass via
 * `legato=false`.
 */
function removeIsolatedGuitarVocalSingletons(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const remove = new Set<Note>();
  const maxBracketBeats = 1;
  const maxConnectedGuitarGap = 0.75;

  for (let index = 1; index < sorted.length - 1; index++) {
    const note = sorted[index]!;
    const previous = sorted[index - 1]!;
    const next = sorted[index + 1]!;
    if (
      !isMetalInstrumentalSource(note.identitySource)
      || previous.identitySource !== "vocals"
      || next.identitySource !== "vocals"
    ) continue;
    const source = note.identitySource;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    if (beforeBeats > maxBracketBeats + 1e-9 || afterBeats > maxBracketBeats + 1e-9) continue;

    // Do not call a member of a connected guitar run a singleton merely
    // because a vocal note happens to sit on one side of it.  Search the
    // selected stream, not the richer pre-selection candidates.
    const previousInstrumental = [...sorted.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.identitySource === source);
    const nextInstrumental = sorted.slice(index + 1)
      .find((candidate) => candidate.identitySource === source);
    if (
      (previousInstrumental && note.start - previousInstrumental.start <= maxConnectedGuitarGap + 1e-9)
      || (nextInstrumental && nextInstrumental.start - note.start <= maxConnectedGuitarGap + 1e-9)
    ) continue;

    const durationSec = note.dur * secondsPerBeat;
    const protectedLanding = note.vel >= 90
      || durationSec >= 0.5
      || (note.midi >= 76 && (note.vel >= 80 || durationSec >= 0.35));
    if (protectedLanding) continue;

    const redundant = note.midi === previous.midi || note.midi === next.midi;
    const directVocalLeap = Math.abs(next.midi - previous.midi);
    const adjacentLeap = Math.max(
      Math.abs(note.midi - previous.midi),
      Math.abs(next.midi - note.midi),
    );
    const createsLargeHandoff = adjacentLeap >= 7
      // A quiet guitar bridge can make a large vocal leap playable (for
      // example 64 -> 72 -> 80). Do not delete it merely because each leg
      // is wide; the singleton is disposable only when it is no better than
      // the direct vocal handoff it would replace.
      && adjacentLeap >= directVocalLeap;
    if (redundant || createsLargeHandoff) remove.add(note);
  }
  return remove.size ? sorted.filter((note) => !remove.has(note)) : notes;
}

/**
 * Score the travel between two selected guitar attacks.  The ordinary
 * interval scheduler only knows whether two starts fit on the piano grid; it
 * can therefore choose a sparse sequence whose individual notes are salient
 * but whose hand has to jump between them.  Keep this penalty deliberately
 * modest and source-local: a real rest, a vocal handoff, or a non-guitar lane
 * must not inherit a guitar fingering constraint.
 */
function isMetalInstrumentalSource(source: Note["identitySource"]): boolean {
  return source === "guitar" || source === "other";
}

function metalInstrumentalTransitionPenalty(previous: Note, note: Note, gapBeats: number): number {
  if (!isMetalInstrumentalSource(previous.identitySource)
    || previous.identitySource !== note.identitySource) return 0;
  if (!Number.isFinite(gapBeats) || gapBeats <= 0 || gapBeats > 1.5 + 1e-9) return 0;
  const leap = Math.abs(note.midi - previous.midi);
  if (leap < 5) return 0;
  const comfortable = gapBeats <= 0.5 + 1e-9 ? 5 : gapBeats <= 1 + 1e-9 ? 7 : 12;
  const excess = Math.max(0, leap - comfortable);
  // A fixed surcharge for a fast >=7-semitone travel prevents a low-weight
  // detector spike from winning over a connected step, while the excess term
  // still lets a phrase resolve by a genuine octave when no nearby option
  // exists. Add a little extra pressure above an octave: that is the common
  // register-flicker shape in separated guitar stems, not a hard rejection.
  const quietSpike = note.vel < 60 && note.dur <= 0.2 + 1e-9 && leap >= 7;
  return excess * 0.25
    + (leap >= 7 && gapBeats <= 1 + 1e-9 ? 0.35 : 0)
    + (leap >= 10 && gapBeats <= 1.5 + 1e-9 ? 0.6 : 0)
    + (leap >= 10 && gapBeats <= 1 + 1e-9 ? 3.5 : 0)
    + (quietSpike ? 2.5 : 0);
}

/**
 * Prefer a connected stepwise bridge when the scheduler would otherwise
 * leave a long hole in a lead phrase. This is intentionally a soft, local
 * penalty: a real rest, a source handoff, or a gap with no usable bridge is
 * left alone, while a quiet candidate that can fill the hole earns a chance
 * to survive the learner spacing pass.
 */
function metalInstrumentalCoveragePenalty(
  phrase: Note[],
  candidates: { note: Note; phraseIndex: number }[],
  previousIndex: number,
  currentIndex: number,
  minimumSpacingBeats: number,
): number {
  const previous = candidates[previousIndex]?.note;
  const current = candidates[currentIndex]?.note;
  if (
    !previous
    || !current
    || !isMetalInstrumentalSource(previous.identitySource)
    || previous.identitySource !== current.identitySource
  ) return 0;
  const source = previous.identitySource;
  const gapBeats = current.start - previous.start;
  const targetGap = Math.max(1, minimumSpacingBeats * 2);
  if (gapBeats <= targetGap + 1e-9) {
    // In a connected guitar lead, a comfortable half-/whole-beat connector
    // is positive evidence rather than a cost. The ordinary salience DP can
    // otherwise choose two loud endpoints and leave an unplayable hole even
    // though a supported stepwise attack exists between them. Keep this
    // reward guitar-only so residual fallback lanes do not regain detector
    // chatter merely because they are dense.
    return source === "guitar" && gapBeats >= minimumSpacingBeats - 1e-9
      && Math.abs(current.midi - previous.midi) <= 5
      ? -0.8
      : 0;
  }
  // Keep the bridge lookup local. Besides avoiding an allocation for every
  // DP edge, this bounds the nested scan on dense detector output to a small
  // phrase neighbourhood rather than turning the O(n^2) contour DP into an
  // accidental O(n^3) pass on long uploads.
  if (gapBeats > targetGap + 3 + 1e-9) return 0;

  const previousPhraseIndex = candidates[previousIndex]!.phraseIndex;
  const currentPhraseIndex = candidates[currentIndex]!.phraseIndex;
  // Candidate filtering removes vocals, so a candidate-only scan could make
  // a guitar bridge jump across an intervening vocal or other source event.
  // The original phrase is authoritative for source barriers.
  for (let phraseIndex = previousPhraseIndex + 1; phraseIndex < currentPhraseIndex; phraseIndex++) {
    if (phrase[phraseIndex]!.identitySource !== source) return 0;
  }

  let hasStepwiseBridge = false;
  for (let middleIndex = previousIndex + 1; middleIndex < currentIndex; middleIndex++) {
    const note = candidates[middleIndex]!.note;
    const beforeGap = note.start - previous.start;
    const afterGap = current.start - note.start;
    const directionTurns = Math.sign(note.midi - previous.midi) !== Math.sign(current.midi - note.midi);
    const quietShortSpike = note.vel < 70 && note.dur <= 0.25 + 1e-9
      && directionTurns
      && Math.max(Math.abs(note.midi - previous.midi), Math.abs(current.midi - note.midi)) >= 7;
    if (
      note.identitySource === source
      && beforeGap >= minimumSpacingBeats - 1e-9
      && afterGap >= minimumSpacingBeats - 1e-9
      && !quietShortSpike
      // A half-beat learner step can still cover a minor sixth in the
      // opening descent of a lead phrase. Keep the bridge criterion looser
      // than the transition comfort threshold; the DP's travel penalty
      // remains responsible for rejecting genuinely wide zig-zags.
      && Math.abs(note.midi - previous.midi) <= 9
      && Math.abs(current.midi - note.midi) <= 9
    ) {
      hasStepwiseBridge = true;
      break;
    }
  }
  if (!hasStepwiseBridge) return 0;
  return Math.min(6, 5 + (gapBeats - targetGap) * 1.5);
}

/**
 * Select a source-aware guitar path from a richer phrase candidate set. This
 * is a first-order dynamic program: every candidate can start a path, and a
 * later candidate may follow whenever the learner spacing floor is met. The
 * path maximises note salience minus local guitar travel cost, so a quiet
 * large leap loses to a connected step even when both attacks are otherwise
 * equally plausible. Vocal anchors are excluded by the caller and remain
 * mandatory in the returned phrase.
 */
function selectMetalInstrumentalContour(
  phrase: Note[],
  candidates: { note: Note; phraseIndex: number }[],
  weights: number[],
  minimumSpacingBeats: number,
  mandatory: ReadonlySet<Note> = new Set(),
): Note[] {
  if (!candidates.length) return [];
  const best = new Array<number>(candidates.length).fill(Number.NEGATIVE_INFINITY);
  const parent = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index++) {
    const current = candidates[index]!.note;
    // A phrase landing or a strong/sustained high attack is identity-bearing
    // even when its travel to the previous note is wider than comfortable.
    // Give it a bounded reward rather than making it an unconditional hard
    // constraint; two mandatory attacks inside one spacing window can still
    // resolve to the more salient one.
    const mandatoryBonus = 24;
    best[index] = weights[index]! + (mandatory.has(current) ? mandatoryBonus : 0);
    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previous = candidates[previousIndex]!.note;
      const gap = current.start - previous.start;
      if (gap < minimumSpacingBeats - 1e-9) continue;
      const transition = metalInstrumentalTransitionPenalty(previous, current, gap)
        + metalInstrumentalCoveragePenalty(phrase, candidates, previousIndex, index, minimumSpacingBeats);
      const score = best[previousIndex]! + weights[index]!
        + (mandatory.has(current) ? mandatoryBonus : 0)
        - transition;
      if (score > best[index]! + 1e-9) {
        best[index] = score;
        parent[index] = previousIndex;
      }
    }
  }
  let state = best.reduce((winner, score, index) => score > best[winner]! + 1e-9 ? index : winner, 0);
  const selected: Note[] = [];
  while (state >= 0) {
    selected.push({ ...candidates[state]!.note });
    state = parent[state]!;
  }
  const result = selected.reverse();
  return result;
}

/**
 * Apply the source-locked guitar tracker only to phrases that contain enough
 * temporal spread to represent a lead contour.  Very dense detector runs are
 * intentionally left to the existing learner scheduler: they already have a
 * level-specific spacing policy and forcing the source tracker onto them can
 * make the easier ladder collapse to the same attack set.  The helper returns
 * only notes that were present in the input phrase; it never synthesizes a
 * replacement pitch or changes any note payload.
 */
function selectMetalLearnerGuitarPhrase(phrase: Note[], minimumSpacingBeats: number): Note[] | undefined {
  if (phrase.length < 6) return undefined;
  const span = phrase.at(-1)!.start - phrase[0]!.start;
  if (!Number.isFinite(span) || span < 2) return undefined;
  const gaps = phrase.slice(1).map((note, index) => note.start - phrase[index]!.start);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const middle = sortedGaps.length ? (sortedGaps.length - 1) * 0.5 : 0;
  const medianGap = sortedGaps.length
    ? sortedGaps[Math.floor(middle)]!
      + (sortedGaps[Math.ceil(middle)]! - sortedGaps[Math.floor(middle)]!) * (middle - Math.floor(middle))
    : 0;
  if (medianGap < 0.25 - 1e-9) return undefined;
  if (new Set(phrase.map((note) => note.midi)).size < 3) return undefined;
  const intervals = gaps.map((_, index) => Math.abs(phrase[index + 1]!.midi - phrase[index]!.midi));
  const largeLeapRatio = intervals.length
    ? intervals.filter((interval) => interval >= 7).length / intervals.length
    : 0;
  const repeatedRatio = intervals.length
    ? intervals.filter((interval) => interval === 0).length / intervals.length
    : 0;
  if (largeLeapRatio > 0.55 + 1e-9 || repeatedRatio > 0.75 + 1e-9) return undefined;

  return selectGuitarLeadPath(phrase, {
    minimumSpacingBeats: Math.max(0.5, minimumSpacingBeats),
    groupToleranceBeats: 0.08,
    phraseBreakBeats: 1.5,
    maxCandidatesPerGroup: 4,
    beamWidth: 24,
    allowGapRecovery: true,
    skipPenalty: 1.5,
    minimumPhraseGroups: 4,
  }).notes;
}

/**
 * Restore supported residual attacks that a learner interval pass skipped
 * from an otherwise sparse, beat-level phrase. Residual detector paths can
 * arrive at the learner reducer with a coherent one-beat contour but still
 * lose every other attack to salience ties. In that narrow case, adding back
 * existing source-tagged events keeps the melody recognizable without
 * synthesizing notes or relaxing the piano spacing floor. Dedicated guitar,
 * vocal phrases, dense textures, and Advanced (non-legato) remain unchanged.
 */
function restoreSparseResidualCoverage(
  cleaned: Note[],
  selected: Note[],
  minimumSpacingBeats: number,
  maxAttacksPerSecond: number,
): Note[] {
  if (maxAttacksPerSecond < 3.5 - 1e-9) return selected;
  const residual = cleaned
    .filter((note) => note.identitySource === "other" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  if (residual.length < 4) return selected;

  const phrases: Note[][] = [];
  for (const note of residual) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - previous.start > 3 + 1e-9
      || note.start - phrase[0]!.start > 32 + 1e-9) phrases.push([note]);
    else phrase.push(note);
  }
  if (!phrases.length) return selected;

  const result = [...selected];
  const targetSpacing = Math.max(minimumSpacingBeats, 0.75);
  for (const phrase of phrases) {
    if (phrase.length < 4) continue;
    const phraseStart = phrase[0]!.start;
    const phraseEnd = phrase.at(-1)!.start;
    const span = phraseEnd - phraseStart;
    if (!Number.isFinite(span) || span < 4) continue;
    const availableDensity = phrase.length / Math.max(1, span);
    if (availableDensity < 0.75 - 1e-9 || availableDensity > 2.5 + 1e-9) continue;

    // Do not reintroduce an alternate instrumental lane next to a dedicated
    // guitar phrase. The source-lane selector owns that decision; this helper
    // is only for residual-only windows where no guitar evidence is nearby.
    const nearbyGuitar = cleaned.some((note) => note.identitySource === "guitar"
      && note.start >= phraseStart - 1.5 - 1e-9
      && note.start <= phraseEnd + 1.5 + 1e-9);
    if (nearbyGuitar) continue;

    const inPhrase = (note: Note): boolean => note.identitySource === "other"
      && note.start >= phraseStart - 1e-9
      && note.start <= phraseEnd + 1e-9;
    const kept = result.filter(inPhrase).sort((a, b) => a.start - b.start);
    // Source-aware fusion may intentionally select no residual material for
    // this phrase. Do not resurrect that lane merely because raw candidates
    // remain in `cleaned`; coverage recovery is only a denser selection of an
    // already selected residual phrase.
    if (!kept.length) continue;
    const selectedDensity = kept.length / Math.max(1, span);
    if (selectedDensity >= 0.95 - 1e-9) continue;
    if (kept.length >= phrase.length) continue;

    const vocalIntervals = result
      .filter((note) => note.identitySource === "vocals")
      .map((note) => ({ start: note.start, end: note.start + note.dur }));
    const tooCloseToPlayedAttack = (note: Note): boolean => result.some((played) =>
      played.hand !== "L"
      && Math.abs(played.start - note.start) < minimumSpacingBeats - 1e-9,
    );
    let candidates = phrase.filter((note) => {
      if (kept.some((other) => Math.abs(other.start - note.start) <= 1e-9)) return false;
      if (note.vel < 56 && note.dur < 0.3) return false;
      if (tooCloseToPlayedAttack(note)) return false;
      return !vocalIntervals.some((interval) => interval.start <= note.start + 1e-9
        && interval.end > note.start + 1e-9);
    });
    if (!candidates.length) continue;

    const targetCount = Math.min(
      phrase.length,
      Math.max(kept.length, Math.floor(span / targetSpacing + 1 + 1e-9)),
    );
    while (kept.length < targetCount) {
      let winner: Note | undefined;
      let winnerScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        if (kept.some((note) => Math.abs(note.start - candidate.start) < targetSpacing - 1e-9)) continue;
        if (tooCloseToPlayedAttack(candidate)) continue;
        const nearestGrid = Math.round((candidate.start - phraseStart) / targetSpacing) * targetSpacing + phraseStart;
        const gridFit = Math.max(0, 1 - Math.min(1, Math.abs(candidate.start - nearestGrid) / (targetSpacing * 0.6)));
        const previous = kept.filter((note) => note.start < candidate.start).at(-1);
        const next = kept.find((note) => note.start > candidate.start);
        const continuity = (previous && next)
          ? Math.max(0, 1 - (Math.abs(candidate.midi - previous.midi) + Math.abs(next.midi - candidate.midi)) / 24)
          : 0.5;
        const score = gridFit * 2 + continuity
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127);
        if (score > winnerScore + 1e-9) {
          winner = candidate;
          winnerScore = score;
        }
      }
      if (!winner) break;
      kept.push({ ...winner });
      kept.sort((a, b) => a.start - b.start);
      const candidateIndex = candidates.indexOf(winner);
      if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
    }

    // Replace the phrase atomically.  `kept` is derived from `result`, so
    // leaving retained entries in place and then appending `kept` would
    // duplicate every note that survived coverage recovery.  Remove all
    // residual entries in this span first, then append exactly the selected
    // copies; vocal and dedicated-guitar notes are outside `inPhrase` and are
    // untouched.
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (inPhrase(result[index]!)) result.splice(index, 1);
    }
    result.push(...kept.map((note) => ({ ...note })));
  }
  return result.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Restore supported guitar lead attacks that the contour scheduler skipped
 * inside a connected phrase.  Metal learner levels are intentionally selected
 * from a richer source stream than Advanced, but a weighted interval pass can
 * still choose only endpoints around vocal anchors and leave the solo
 * unrecognisably sparse.  This pass is selection-only: it copies existing
 * source-tagged guitar notes, never changes their pitch or onset, keeps vocals
 * immutable, and respects the learner spacing floor.
 *
 * The gate is deliberately conservative.  A phrase must already have a
 * selected guitar attack, several distinct upper pitches, useful candidate
 * density, and a mostly connected contour.  Stable repeated walls and noisy
 * residual lanes therefore remain with their existing rhythm/source policy.
 */
function restoreSparseGuitarCoverage(
  sourceCandidates: Note[],
  selected: Note[],
  minimumSpacingBeats: number,
): Note[] {
  const guitarCandidates = sourceCandidates
    .filter((note) => note.identitySource === "guitar" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  if (guitarCandidates.length < 6) return selected;

  const phrases: Note[][] = [];
  for (const note of guitarCandidates) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - previous.start > 1.5 + 1e-9
      || note.start - phrase[0]!.start > 32 + 1e-9) {
      phrases.push([note]);
    } else {
      phrase.push(note);
    }
  }

  const result = [...selected];
  const vocalNotes = result.filter((note) => note.identitySource === "vocals");
  // Keep a useful coverage target separate from the physical learner floor:
  // a valid phrase may add at half-beat spacing, while the target remains
  // conservative enough not to restore every detector attack.
  const targetSpacing = Math.max(minimumSpacingBeats, 0.75);
  const coverageFloor = Math.max(minimumSpacingBeats, 0.5);
  const keyFor = (note: Note): string => `${note.identitySource ?? ""}:${note.start.toFixed(6)}:${note.midi}`;
  const selectedKeys = new Set(result.map(keyFor));
  const tooCloseToPlayedAttack = (note: Note): boolean => result.some((played) =>
    played.hand !== "L"
    && Math.abs(played.start - note.start) < minimumSpacingBeats - 1e-9,
  );

  for (const phrase of phrases) {
    if (phrase.length < 6) continue;
    const phraseStart = phrase[0]!.start;
    const phraseEnd = phrase.at(-1)!.start;
    const span = phraseEnd - phraseStart;
    if (!Number.isFinite(span) || span < 2) continue;

    const distinctPitches = new Set(phrase.map((note) => note.midi));
    if (distinctPitches.size < 3) continue;
    const intervals = phrase.slice(1).map((note, index) => Math.abs(note.midi - phrase[index]!.midi));
    const largeLeapRatio = intervals.length
      ? intervals.filter((interval) => interval >= 7).length / intervals.length
      : 0;
    const repeatedRatio = intervals.length
      ? intervals.filter((interval) => interval === 0).length / intervals.length
      : 0;
    if (largeLeapRatio > 0.45 + 1e-9 || repeatedRatio > 0.75 + 1e-9) continue;
    if (phrase.length / Math.max(1, span) < 1.25 - 1e-9) continue;

    const inPhrase = (note: Note): boolean => note.identitySource === "guitar"
      && note.start >= phraseStart - 1e-9
      && note.start <= phraseEnd + 1e-9;
    const kept = result.filter(inPhrase).sort((a, b) => a.start - b.start);
    // Recovery must refine an already selected guitar phrase, never create a
    // new instrumental source in a section that the lane selector rejected.
    if (!kept.length) continue;

    const targetCount = Math.min(
      phrase.length,
      Math.max(kept.length, Math.floor(span / targetSpacing + 1 + 1e-9)),
    );
    if (targetCount <= kept.length) continue;

    const available = phrase.filter((note) => !selectedKeys.has(keyFor(note)));
    while (kept.length < targetCount) {
      let winner: Note | undefined;
      let winnerScore = Number.NEGATIVE_INFINITY;
      for (const candidate of available) {
        if (selectedKeys.has(keyFor(candidate)) || tooCloseToPlayedAttack(candidate)) continue;
        if (vocalNotes.some((vocal) => Math.abs(vocal.start - candidate.start) < minimumSpacingBeats - 1e-9)) continue;

        const previous = kept.filter((note) => note.start < candidate.start).at(-1);
        const next = kept.find((note) => note.start > candidate.start);
        const beforeGap = previous ? candidate.start - previous.start : Number.POSITIVE_INFINITY;
        const afterGap = next ? next.start - candidate.start : Number.POSITIVE_INFINITY;
        const stepToPrevious = previous ? Math.abs(candidate.midi - previous.midi) : 0;
        const stepToNext = next ? Math.abs(next.midi - candidate.midi) : 0;
        const bridgesGap = previous !== undefined && next !== undefined
          && beforeGap >= targetSpacing - 1e-9
          && afterGap >= targetSpacing - 1e-9;
        const stepwise = (previous !== undefined && stepToPrevious <= 5)
          || (next !== undefined && stepToNext <= 5);
        const quietLargeLeap = candidate.vel < 70 && candidate.dur <= 0.25 + 1e-9
          && ((previous !== undefined && stepToPrevious >= 7) || (next !== undefined && stepToNext >= 7));
        const gridDistance = Math.abs((candidate.start - phraseStart) / targetSpacing
          - Math.round((candidate.start - phraseStart) / targetSpacing));
        const gridFit = Math.max(0, 1 - Math.min(1, gridDistance));
        const endpoint = previous === undefined || next === undefined;
        const score = (bridgesGap ? 4 : 0)
          + (stepwise ? 2.5 : 0)
          + gridFit
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127)
          + (endpoint ? 1.5 : 0)
          - (quietLargeLeap ? 3 : 0)
          - Math.max(0, Math.max(stepToPrevious, stepToNext) - 7) * 0.2;
        if (score > winnerScore + 1e-9) {
          winner = candidate;
          winnerScore = score;
        }
      }
      if (!winner) break;
      const copy = { ...winner };
      kept.push(copy);
      kept.sort((a, b) => a.start - b.start);
      result.push(copy);
      selectedKeys.add(keyFor(copy));
    }

    // The greedy add-only pass can be trapped when every omitted candidate is
    // just inside the floor of an existing attack. In that case, choose a
    // larger source-locked subset from the cleaned phrase, allowing a bounded
    // replacement of a weak attack rather than resurrecting pre-cleanup data.
    if (kept.length < targetCount) {
      const fixed = result.filter((note) => !inPhrase(note) && note.hand !== "L");
      const candidates = phrase.filter((note) => note.hand !== "L"
        && !fixed.some((played) => Math.abs(played.start - note.start) < coverageFloor - 1e-9));
      const previousCompatible = candidates.map((note, index) => {
        let low = 0;
        let high = index - 1;
        let compatible = -1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (note.start - candidates[middle]!.start >= coverageFloor - 1e-9) {
            compatible = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        return compatible;
      });
      const weights = candidates.map((candidate, index) => {
        const previous = candidates[index - 1];
        const next = candidates[index + 1];
        const selectedBonus = selectedKeys.has(keyFor(candidate)) ? 6 : 0;
        const endpoint = index === 0 || index === candidates.length - 1;
        const stepwise = (previous !== undefined && Math.abs(candidate.midi - previous.midi) <= 5)
          || (next !== undefined && Math.abs(next.midi - candidate.midi) <= 5);
        const quietLargeLeap = candidate.vel < 70 && candidate.dur <= 0.25 + 1e-9
          && ((previous !== undefined && Math.abs(candidate.midi - previous.midi) >= 7)
            || (next !== undefined && Math.abs(next.midi - candidate.midi) >= 7));
        const gridDistance = Math.abs((candidate.start - phraseStart) / targetSpacing
          - Math.round((candidate.start - phraseStart) / targetSpacing));
        return selectedBonus
          + (endpoint ? 2 : 0)
          + (stepwise ? 2 : 0)
          + Math.max(0, 1 - Math.min(1, gridDistance))
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127)
          - (quietLargeLeap ? 3 : 0);
      });
      const dp = Array.from({ length: candidates.length + 1 }, () =>
        new Array<number>(targetCount + 1).fill(Number.NEGATIVE_INFINITY));
      const take = Array.from({ length: candidates.length + 1 }, () =>
        new Array<boolean>(targetCount + 1).fill(false));
      dp[0]![0] = 0;
      for (let candidateIndex = 1; candidateIndex <= candidates.length; candidateIndex += 1) {
        dp[candidateIndex]![0] = 0;
        for (let count = 1; count <= targetCount; count += 1) {
          const skipped = dp[candidateIndex - 1]![count]!;
          const parent = previousCompatible[candidateIndex - 1]! + 1;
          const parentScore = dp[parent]![count - 1]!;
          const included = parentScore > Number.NEGATIVE_INFINITY / 2
            ? parentScore + weights[candidateIndex - 1]!
            : Number.NEGATIVE_INFINITY;
          if (included > skipped + 1e-9) {
            dp[candidateIndex]![count] = included;
            take[candidateIndex]![count] = true;
          } else {
            dp[candidateIndex]![count] = skipped;
          }
        }
      }
      let count = targetCount;
      while (count > kept.length && dp[candidates.length]![count]! <= Number.NEGATIVE_INFINITY / 2) count -= 1;
      if (count > kept.length) {
        const chosen: Note[] = [];
        let candidateIndex = candidates.length;
        while (candidateIndex > 0 && count > 0) {
          if (take[candidateIndex]![count]) {
            chosen.push({ ...candidates[candidateIndex - 1]! });
            candidateIndex = previousCompatible[candidateIndex - 1]! + 1;
            count -= 1;
          } else {
            candidateIndex -= 1;
          }
        }
        chosen.reverse();
        if (chosen.length > kept.length) {
          for (let resultIndex = result.length - 1; resultIndex >= 0; resultIndex -= 1) {
            if (inPhrase(result[resultIndex]!)) {
              selectedKeys.delete(keyFor(result[resultIndex]!));
              result.splice(resultIndex, 1);
            }
          }
          result.push(...chosen);
          for (const note of chosen) selectedKeys.add(keyFor(note));
        }
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Select a physically phrased metal RH path inside each real phrase. This is
 * tempo-aware and local, because a whole-song density average cannot see a
 * half-second detector burst. Pitch and attack choices are selection-only so
 * every easier level remains traceable to its harder neighbor.
 */
function reduceMetalRhRealism(
  notes: Note[],
  tempoBpm: number,
  maxAttacksPerSecond: number,
  legato = false,
  preserveGuitarCoverage = false,
): Note[] {
  if (!notes.length) return [];
  const safeTempo = normalizeTempoBpm(tempoBpm);
  const secondsPerBeat = 60 / safeTempo;
  const safeRate = Number.isFinite(maxAttacksPerSecond) && maxAttacksPerSecond > 0 ? maxAttacksPerSecond : 4;
  const minimumSpacingBeats = (safeTempo / 60) / safeRate;
  // Quantization can leave a one-grid sliver between two fragments that were
  // contiguous in the source stem. Allow only a short, tempo-aware silence
  // here: a larger gap is a real vocal re-attack and must remain playable.
  const maxVocalFragmentGapBeats = Math.min(0.125, 0.08 / secondsPerBeat);
  const dedupedSource = suppressLowGuitarLeadFiller(notes, legato)
    .sort((a, b) => a.start - b.start
      || Number(b.identitySource === "vocals") - Number(a.identitySource === "vocals")
      || b.vel - a.vel || b.dur - a.dur || b.midi - a.midi)
    .filter((note, index, all) => index === 0 || Math.abs(note.start - all[index - 1]!.start) > 1e-9);
  const source = removeResidualUpperOutliers(dedupedSource, legato);

  const merged: Note[] = [];
  let lastMergedAttackStart: number | undefined;
  let lastMergedVocal: Note | undefined;
  let lastMergedVocalAttackStart: number | undefined;
  for (const original of source) {
    const note = { ...original };
    const previous = merged.at(-1);
    const elapsedSec = previous && lastMergedAttackStart !== undefined
      ? (note.start - lastMergedAttackStart) * secondsPerBeat
      : Number.POSITIVE_INFINITY;
    const gapSec = previous
      ? Math.max(0, note.start - (previous.start + previous.dur)) * secondsPerBeat
      : Number.POSITIVE_INFINITY;
    const vocalGapBeats = lastMergedVocal
      ? Math.max(0, note.start - (lastMergedVocal.start + lastMergedVocal.dur))
      : Number.POSITIVE_INFINITY;
    const vocalAttackGapBeats = lastMergedVocalAttackStart === undefined
      ? Number.POSITIVE_INFINITY
      : note.start - lastMergedVocalAttackStart;
    // Basic Pitch commonly splits one sung syllable into adjacent fragments
    // at nearly the same pitch. Treat those as one sustained piano note; a
    // real gap or a pitch change still creates a fresh attack. This is limited
    // to the vocal lane so repeated guitar articulations remain available in
    // the harder metal levels.
    if (
      lastMergedVocal
      && note.identitySource === "vocals"
      && lastMergedVocal.midi === note.midi
      // A later learner level may have extended the previous note to fill a
      // playable gap. Keep the attack-to-attack bound as well as the silence
      // bound so that extension cannot turn a genuine re-attack into a
      // detector fragment.
      && vocalAttackGapBeats <= 0.5 + 1e-9
      && vocalGapBeats <= maxVocalFragmentGapBeats + 1e-9
    ) {
      lastMergedVocal.dur = Math.max(lastMergedVocal.dur, note.start + note.dur - lastMergedVocal.start);
      lastMergedVocal.vel = Math.max(lastMergedVocal.vel, note.vel);
      lastMergedAttackStart = note.start;
      lastMergedVocalAttackStart = note.start;
      continue;
    }
    if (note.identitySource === "vocals") {
      lastMergedVocal = note;
      lastMergedVocalAttackStart = note.start;
    }
    const preserveMelodicReattack = Boolean(
      previous
      && previous.midi === note.midi
      && (hasMovingGuitarContext(previous, source) || hasMovingGuitarContext(note, source)),
    );
    const shortFragmentMerge = legato
      && elapsedSec <= 0.4 + 1e-9
      && gapSec <= 0.2 + 1e-9
      && previous?.dur !== undefined
      && previous.dur <= 0.25 + 1e-9
      && note.dur <= 0.25 + 1e-9;
    if (
      previous
      && previous.identitySource !== "vocals"
      && note.identitySource !== "vocals"
      && previous.midi === note.midi
      && !preserveMelodicReattack
      // In a legato learner level, overlapping same-pitch guitar attacks are
      // one held piano tone rather than separate picked strikes. Keep the
      // advanced/source texture tighter so deliberate re-attacks remain
      // available there, while allowing a quarter-second fragment boundary
      // to collapse in the playable levels.
      && (elapsedSec <= (legato ? 0.25 : 0.09) + 1e-9 || shortFragmentMerge)
      && (gapSec <= (legato ? 0.125 : 0) + 1e-9 || shortFragmentMerge)
      && note.start <= previous.start + previous.dur + (legato
        ? shortFragmentMerge ? 0.5 : 0.25
        : 0.125) + 1e-9
    ) {
      previous.dur = Math.max(previous.dur, note.start + note.dur - previous.start);
      previous.vel = Math.max(previous.vel, note.vel);
      lastMergedAttackStart = note.start;
      continue;
    }
    merged.push(note);
    lastMergedAttackStart = note.start;
  }

  const vocalCleaned = removeWeakVocalDetours(merged, safeTempo, legato);
  const handoffCleaned = removeWeakGuitarVocalHandoffs(vocalCleaned, safeTempo, legato);
  const cleaned = removeInterleavedGuitarDetours(handoffCleaned.filter((note, index, all) => {
    if (note.identitySource === "vocals") return true;
    const previous = all[index - 1];
    const next = all[index + 1];
    if (!previous || !next) return true;
    // Keep the historical cleanup for a completely unlabeled triple while
    // preventing a guitar rule from treating vocal neighbours as guitar
    // evidence. Explicit source labels must match on all three notes.
    const sameSourceNeighbours = previous.identitySource === note.identitySource
      && next.identitySource === note.identitySource;
    const intoSec = (note.start - previous.start) * secondsPerBeat;
    const outSec = (next.start - note.start) * secondsPerBeat;
    const durationSec = note.dur * secondsPerBeat;
    const isHalfBeatAnchor = Math.abs(note.start * 2 - Math.round(note.start * 2)) <= 1e-9;
    const broadLegatoGuitarDetour = legato
      && note.identitySource === "guitar"
      && previous.identitySource === "guitar"
      && next.identitySource === "guitar"
      && intoSec <= 1.5 * secondsPerBeat + 1e-9
      && outSec <= 1.5 * secondsPerBeat + 1e-9
      && durationSec <= 0.35 + 1e-9
      && !isHalfBeatAnchor
      && note.vel < 100
      && Math.abs(note.midi - previous.midi) >= 5
      && Math.abs(note.midi - next.midi) >= 5
      && Math.abs(previous.midi - next.midi) <= 5;
    return !(
      (
        // A detector's short chord-tone detour often lasts a full eighth note
        // by the time Basic Pitch has merged overlapping partials. Treat that
        // as an ornamental hit when it sits between two nearby lead pitches;
        // otherwise the piano lane faithfully reproduces a guitar pick/noise
        // event as an awkward leap. Keep this local and source-aware below so
        // vocal anchors and deliberate wide figures are untouched.
        intoSec <= 0.4 + 1e-9
        && outSec <= 0.4 + 1e-9
        && durationSec <= 0.35 + 1e-9
        && Math.abs(note.midi - previous.midi) >= 5
        && Math.abs(note.midi - next.midi) >= 5
        && Math.abs(previous.midi - next.midi) <= 5
        // Keep a clearly intentional lead accent even when it reverses; the
        // quietness guard targets low-energy separated partials instead.
        && note.vel <= Math.max(previous.vel, next.vel) * 0.9 + 1e-9
        && sameSourceNeighbours
      )
      || broadLegatoGuitarDetour
    );
  }), safeTempo, legato);

  const phrases: Note[][] = [];
  for (const note of cleaned) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    const restBeats = previous ? note.start - (previous.start + previous.dur) : Number.POSITIVE_INFINITY;
    if (!phrase || !previous || (restBeats >= 0.5 && restBeats * secondsPerBeat >= 0.35)) phrases.push([note]);
    else phrase.push(note);
  }

  const selected: Note[] = [];
  for (const phrase of phrases) {
    if (phrase.length <= 1) {
      selected.push(...phrase.map((note) => ({ ...note })));
      continue;
    }
    const protectedAnchors = phrase.filter((note) => note.identitySource === "vocals");
    const candidates = phrase.flatMap((note, phraseIndex) => note.identitySource !== "vocals"
      && protectedAnchors.every((anchor) => Math.abs(note.start - anchor.start) >= minimumSpacingBeats - 1e-9)
      ? [{ note, phraseIndex }]
      : []);
    const useContourDp = legato && candidates.some(({ note }) => isMetalInstrumentalSource(note.identitySource));
    const learnerGuitarPath = preserveGuitarCoverage && legato
      ? selectMetalLearnerGuitarPhrase(
        phrase.filter((note) => note.identitySource === "guitar" && note.hand !== "L" && note.midi >= 61),
        minimumSpacingBeats,
      ) ?? []
      : [];
    const guitarCoverageKeys = new Set(
      learnerGuitarPath.map((note) => `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`),
    );
    const noteKey = (note: Note): string => `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`;
    const mandatoryContourNotes = new Set(
      candidates
        .filter(({ note, phraseIndex }) => {
          const durationSec = note.dur * secondsPerBeat;
          const previousInstrumental = isMetalInstrumentalSource(note.identitySource)
            ? phrase.slice(0, phraseIndex).reverse().find((candidate) => candidate.identitySource === note.identitySource)
            : undefined;
          const nextPhraseNote = phrase[phraseIndex + 1];
          const instrumentalPhraseLanding = isMetalInstrumentalSource(note.identitySource)
            && nextPhraseNote?.identitySource === "vocals"
            && previousInstrumental !== undefined
            && note.start - previousInstrumental.start <= 1 + 1e-9
            && Math.abs(note.midi - previousInstrumental.midi) <= 7;
          return phraseIndex === 0
            || phraseIndex === phrase.length - 1
            || note.vel >= 100
            || (note.midi >= 76 && (note.vel >= 90 || durationSec >= 0.5))
            || instrumentalPhraseLanding
            || guitarCoverageKeys.has(noteKey(note));
        })
        .map(({ note }) => note),
    );
    const weights = candidates.map(({ note, phraseIndex: index }) => {
      const previous = phrase[index - 1];
      const next = phrase[index + 1];
      const endpoint = index === 0 || index === phrase.length - 1;
      const localExtremum = previous && next
        && ((note.midi > previous.midi && note.midi > next.midi) || (note.midi < previous.midi && note.midi < next.midi));
      const prominence = previous && next
        ? Math.min(Math.abs(note.midi - previous.midi), Math.abs(note.midi - next.midi))
        : 0;
      const stepConnector = previous && next
        && previous.identitySource === note.identitySource
        && next.identitySource === note.identitySource
        && Math.abs(note.midi - previous.midi) <= 4
        && Math.abs(next.midi - note.midi) <= 4;
      // A dense, stepwise guitar phrase contains useful connector attacks
      // even when each individual note is quieter than a detector spike. The
      // contour DP should prefer those connectors over leaving a one-beat
      // hole, but only when both local intervals are already comfortable.
      // This bonus is source/legato scoped; vocals and residual fallback keep
      // their existing salience policy.
      const coverageBonus = useContourDp
        && note.identitySource === "guitar"
        && stepConnector
        ? 3
        : 0;
      // A local salience score alone can prefer a quiet chord partial that
      // creates a large guitar jump. Look through vocal events for the nearest
      // guitar neighbours and lower that candidate's weight when the travel
      // is both fast and weak. This is intentionally a selection penalty (no
      // pitch replacement): phrase endpoints, dynamic/sustained landings, and
      // all vocal notes remain protected.
      let instrumentalTransitionPenalty = 0;
      const previousInstrumental = isMetalInstrumentalSource(note.identitySource)
        ? [...phrase.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.identitySource === note.identitySource)
        : undefined;
      const nextInstrumental = isMetalInstrumentalSource(note.identitySource)
        ? phrase.slice(index + 1)
          .find((candidate) => candidate.identitySource === note.identitySource)
        : undefined;
      const instrumentalLocalExtremum = previousInstrumental && nextInstrumental
        && ((note.midi > previousInstrumental.midi && note.midi > nextInstrumental.midi)
          || (note.midi < previousInstrumental.midi && note.midi < nextInstrumental.midi));
      if (legato && isMetalInstrumentalSource(note.identitySource) && instrumentalLocalExtremum) {
        const durationSec = note.dur * secondsPerBeat;
        const protectedLead = endpoint
          || note.vel >= 100
          || durationSec >= 0.35
          || (note.midi >= 76 && note.vel >= 90);
        if (!protectedLead && note.vel < 100 && durationSec <= 0.35 + 1e-9) {
          for (const neighbour of [previousInstrumental, nextInstrumental]) {
            if (!neighbour) continue;
            const gapBeats = Math.abs(note.start - neighbour.start);
            const leap = Math.abs(note.midi - neighbour.midi);
            if (gapBeats <= 1.5 + 1e-9 && leap >= 7) instrumentalTransitionPenalty += 2.25;
            else if (gapBeats <= 1 + 1e-9 && leap >= 5) instrumentalTransitionPenalty += 0.45;
          }
        }
      }
      const beatPosition = Math.abs(note.start - Math.round(note.start));
      const halfBeatPosition = Math.abs(note.start * 2 - Math.round(note.start * 2));
      const localExtremumBonus = instrumentalTransitionPenalty > 0
        ? 0
        : localExtremum && prominence >= 3
          ? useContourDp ? 0.5 : 2 + Math.min(2, prominence / 6)
          : 0;
      return 1
        + Math.min(note.dur * secondsPerBeat, 0.75) * 1.5
        + Math.max(0, Math.min(1, note.vel / 127)) * 0.5
        + (endpoint ? 5 : 0)
        + localExtremumBonus
        + (stepConnector ? 0.75 : 0)
        + coverageBonus
        + (beatPosition <= 1e-6 ? 0.75 : halfBeatPosition <= 1e-6 ? 0.35 : 0)
        - (useContourDp ? 0 : instrumentalTransitionPenalty);
    });
    const phraseSelection: Note[] = [];
    if (useContourDp) {
      phraseSelection.push(...selectMetalInstrumentalContour(phrase, candidates, weights, minimumSpacingBeats, mandatoryContourNotes));
    } else {
      const previousCompatible = candidates.map(({ note }, index) => {
        let low = 0;
        let high = index - 1;
        let compatible = -1;
        while (low <= high) {
          const candidate = Math.floor((low + high) / 2);
          if (note.start - candidates[candidate]!.note.start >= minimumSpacingBeats - 1e-9) {
            compatible = candidate;
            low = candidate + 1;
          } else {
            high = candidate - 1;
          }
        }
        return compatible;
      });
      const best = new Array<number>(candidates.length + 1).fill(0);
      const take = new Array<boolean>(candidates.length).fill(false);
      for (let index = 0; index < candidates.length; index++) {
        const include = weights[index]! + best[previousCompatible[index]! + 1]!;
        const exclude = best[index]!;
        if (include > exclude + 1e-9) {
          best[index + 1] = include;
          take[index] = true;
        } else {
          best[index + 1] = exclude;
        }
      }
      for (let index = candidates.length - 1; index >= 0;) {
        const include = weights[index]! + best[previousCompatible[index]! + 1]!;
        if (take[index] && Math.abs(best[index + 1]! - include) <= 1e-9) {
          phraseSelection.push({ ...candidates[index]!.note });
          index = previousCompatible[index]!;
        } else {
          index -= 1;
        }
      }
      phraseSelection.reverse();
    }
    selected.push(...protectedAnchors.map((note) => ({ ...note })), ...phraseSelection);
  }

  const residualCovered = legato
    ? restoreSparseResidualCoverage(cleaned, selected, minimumSpacingBeats, safeRate)
    : selected;
  const handoffSelected = removeIsolatedGuitarVocalSingletons(residualCovered, safeTempo, legato);
  const sorted = removeInterleavedGuitarDetours(
    handoffSelected.sort((a, b) => a.start - b.start || a.midi - b.midi),
    safeTempo,
    legato,
  );
  if (!legato) return sorted;
  const coverageSelected = preserveGuitarCoverage
    ? restoreSparseGuitarCoverage(cleaned, sorted, minimumSpacingBeats)
    : sorted;
  return coverageSelected.sort((a, b) => a.start - b.start || a.midi - b.midi).map((note, index, all) => {
    const next = all[index + 1];
    if (!next) return { ...note };
    const gap = next.start - note.start;
    if (gap <= 0 || gap * secondsPerBeat > 0.5) return { ...note };
    return { ...note, dur: Math.min(gap, Math.max(note.dur, gap * 0.9)) };
  });
}

export function melodyOnly(notes: Note[], grid: number, minDur: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  for (let i = 0; i < slices.length; i++) {
    const k = slices[i]!;
    const group = bySlice.get(k)!;
    // Prefer the highest non-pad voice; a sustained background pad is not the
    // melody. Fall back to the pad when it is the only note sounding.
    const nonPad = pads ? group.filter((n) => !pads.has(n.midi)) : group;
    const top = (nonPad.length ? nonPad : group).reduce((a, b) => (b.midi > a.midi ? b : a));
    const next = slices[i + 1];
    // Cap the legato fill: stretching across rests makes sparse sections ring
    // for 10+ seconds. Notes keep their attack, rests stay rests.
    const gap = next === undefined ? top.dur : (next - k) * grid;
    const dur = next === undefined ? Math.max(minDur, Math.min(2.5, top.dur)) : Math.min(2.5, Math.max(minDur, gap <= 1.5 ? gap : Math.min(top.dur, gap)));
    out.push({ ...top, dur });
  }
  return out;
}

/**
 * Choose the Easy RH voice without treating pitch alone as melody evidence.
 * A short, quiet co-onset decoration is not allowed to displace a longer or
 * louder principal event; otherwise `melodyOnly` can turn a two-voice score
 * into the wrong (usually upper) line.  The fallback remains pitch-biased for
 * ambiguous groups, and a small continuity bonus keeps the selected line
 * stable across adjacent attacks without flattening real leaps.
 * ponytail: this stays a greedy per-onset pass; use phrase DP only if a
 * measured Easy contour regression survives this bounded selector.
 */
function selectEasyMelody(notes: Note[], grid: number, minDur: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const note of notes) {
    const key = Math.round(note.start / grid);
    const group = bySlice.get(key) ?? [];
    group.push(note);
    bySlice.set(key, group);
  }
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  const candidates = slices.map((slice) => {
    const group = bySlice.get(slice)!;
    // A pad is a fallback voice, not a competing melody. Exclude it only when
    // the slice also has credible non-pad evidence; a quiet short detector
    // fragment should not displace a sustained pad that is the sole real voice.
    const nonPad = pads ? group.filter((note) => !pads.has(note.midi)) : group;
    const maxGroupVelocity = Math.max(...group.map((note) => note.vel), 1);
    const credibleNonPad = nonPad.filter((note) => note.dur > 0.25 + 1e-9
      || note.vel >= maxGroupVelocity * 0.7
      || note.identitySource === "vocals");
    const considered = credibleNonPad.length ? nonPad : group;
    const credible = considered.filter((note) => !pads?.has(note.midi)
      || note.vel >= maxGroupVelocity * 0.7
      || note.dur >= 0.5
      || note.identitySource === "vocals");
    const pool = credible.length ? credible : considered;
    const maxVelocity = Math.max(...pool.map((note) => note.vel), 1);
    const meaningful = pool.filter((note) => {
      // A short/quiet upper event is usually a decorative chord partial. Keep
      // it when it is the only evidence, but let a credible co-onset voice win.
      const decorative = note.dur <= 0.25 + 1e-9 && note.vel < maxVelocity * 0.75;
      return !decorative || pool.every((other) => other === note || (
        other.dur <= note.dur + 1e-9 && other.vel < note.vel
      ));
    });
    return (meaningful.length ? meaningful : pool).sort(
      (a, b) => a.midi - b.midi || b.vel - a.vel || b.dur - a.dur,
    );
  });
  const chosen: Note[] = [];
  let previous: Note | undefined;
  for (const group of candidates) {
    let best = group[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const note of group) {
      const dynamic = Math.max(0, Math.min(1, note.vel / 127));
      const duration = Math.max(0, Math.min(1, note.dur / 0.5));
      const continuity = previous
        ? (() => {
          const gap = note.start - previous.start;
          if (gap > 1.5 + 1e-9) return 0;
          const leap = Math.abs(note.midi - previous.midi);
          return (leap <= 5 ? 0.35 : leap <= 9 ? 0.1 : -0.2) + (leap === 0 ? 0.1 : 0);
        })()
        : 0;
      const sourceBonus = note.identitySource === "vocals" ? 0.35 : 0;
      const score = dynamic * 1.5 + duration * 0.9 + sourceBonus + note.midi * 0.002 + continuity;
      if (score > bestScore + 1e-9) {
        best = note;
        bestScore = score;
      }
    }
    chosen.push({ ...best });
    previous = best;
  }
  return melodyOnly(chosen, grid, minDur);
}

/** Keep the highest `keep` voices per slice; pad pitches rank below real voices. */
function topVoices(notes: Note[], grid: number, keep: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const ns of bySlice.values()) {
    const sorted = [...ns].sort((a, b) => {
      const pa = pads?.has(a.midi) ? 1 : 0;
      const pb = pads?.has(b.midi) ? 1 : 0;
      return pa - pb || b.midi - a.midi;
    });
    for (const n of sorted.slice(0, keep)) out.push(n);
  }
  return out;
}

/**
 * Drop notes that would make one hand's SOUNDING pitch span exceed `maxSpan`
 * (notes overlap across slices even when their starts are different). The
 * hand's melodic extreme (highest for RH, lowest for LH) is kept and only
 * unreachable inner/outer voices are removed, so the line survives.
 */
function capSoundingSpan(notes: Note[], maxSpan: number, anchor: "high" | "low"): Note[] {
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || (anchor === "high" ? b.midi - a.midi : a.midi - b.midi),
  );
  const out: Note[] = [];
  const active: { end: number; midi: number; note: Note }[] = [];
  for (const n of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= n.start) active.splice(i, 1);
    }
    const mids = active.map((a) => a.midi);
    if (mids.length === 0) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
      continue;
    }
    const activeHigh = maxNumber(mids, n.midi);
    const activeLow = minNumber(mids, n.midi);
    const span = activeHigh - activeLow;
    const extendsAnchor = anchor === "high" ? n.midi > activeHigh : n.midi < activeLow;
    if (span <= maxSpan) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    } else if (extendsAnchor) {
      const kept = active.filter((a) => Math.abs(a.midi - n.midi) <= maxSpan);
      const removed = new Set(active.filter((a) => !kept.includes(a)).map((a) => a.note));
      for (let i = out.length - 1; i >= 0; i--) {
        const note = out[i];
        if (note !== undefined && removed.has(note)) out.splice(i, 1);
      }
      active.length = 0;
      active.push(...kept, { end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    }
  }
  return out;
}

function thinChord(notes: Note[], keep: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / 0.25) * 0.25;
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const [k, ns] of bySlice) {
    const sorted = [...ns].sort((a, b) => a.midi - b.midi);
    const kept = sorted.slice(0, Math.min(keep, sorted.length));
    // The quarter-note bin is only a selection window. Keep each attack at
    // its imported (eighth-note) onset: snapping here can move two sequential
    // same-pitch re-attacks onto one another and create an overlap that did
    // not exist in the source arrangement.
    for (const n of kept) out.push({ ...n });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Reduce an explicit metal rhythm lane without touching the harmonic shell.
 * Separated guitar stems can contain a quarter-note wall even after the RH
 * lead has been selected; copying every attack into the LH makes a learner
 * play a drum-machine pattern underneath long root/fifth blocks. Keep one
 * source attack per spacing window, preserving the original onset/pitch so
 * the difficulty ladder can still match it to the next harder level.
 */
function thinMetalRhythm(notes: Note[], minimumSpacingBeats: number): Note[] {
  const sorted = notes
    .filter((note) => note.identitySource === "guitar" || note.identitySource === "other")
    .sort((a, b) => a.start - b.start || b.vel - a.vel || a.midi - b.midi);
  if (!sorted.length || !Number.isFinite(minimumSpacingBeats) || minimumSpacingBeats <= 0) return sorted;
  const selected: Note[] = [];
  for (const note of sorted) {
    const previous = selected.at(-1);
    if (!previous || note.start - previous.start >= minimumSpacingBeats - 1e-9) {
      selected.push({ ...note });
      continue;
    }
    // Co-onset detector duplicates are one physical strike. If the later
    // duplicate is stronger, let it represent the window; otherwise keep the
    // first attack so phrase starts and downbeats are stable.
    if (Math.abs(note.start - previous.start) <= 1e-9
      && (note.vel > previous.vel || (note.vel === previous.vel && note.midi < previous.midi))) {
      selected[selected.length - 1] = { ...note };
    }
  }
  return selected;
}

/** Build the metal LH texture: sparse harmonic shell plus a source-aware
 * rhythm lane. `rhythmGap` is a beat floor that increases for easier levels. */
function metalLeftHandTexture(notes: Note[], rhythmGap: number, harmonicVoices: number): Note[] {
  const harmonic = thinChord(
    notes.filter((note) => note.identitySource !== "guitar" && note.identitySource !== "other"),
    harmonicVoices,
  );
  const rhythm = thinMetalRhythm(notes, rhythmGap);
  return [...harmonic, ...rhythm].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/** Remove unisons that overlap only because a simpler level re-voiced them. */
function trimSamePitchOverlaps(notes: Note[], minDur = 0.125): Note[] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const key = `${n.hand === "L" ? "L" : "R"}:${n.midi}`;
    const group = groups.get(key) ?? [];
    group.push({ ...n });
    groups.set(key, group);
  }
  const out: Note[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
    const kept: Note[] = [];
    for (const n of group) {
      const prev = kept[kept.length - 1];
      if (!prev) {
        kept.push(n);
        continue;
      }
      if (Math.abs(prev.start - n.start) <= 1e-9) {
        // Re-voicing can collapse two source pitches onto the same attack;
        // retain one physical strike with the stronger dynamics and longest
        // written duration.
        prev.dur = Math.max(prev.dur, n.dur);
        prev.vel = Math.max(prev.vel, n.vel);
        const prevRefs = learnerTraceRefs(prev);
        const nextRefs = learnerTraceRefs(n);
        const mergedRefs = [...new Set([...prevRefs, ...nextRefs])].sort();
        if (mergedRefs.length) (prev as LearnerInternalNote).learnerTraceRefs = mergedRefs;
        continue;
      }
      if (prev.start + prev.dur > n.start + 1e-9) {
        prev.dur = n.start - prev.start;
        if (prev.dur < minDur - 1e-9) kept.pop();
      }
      kept.push(n);
    }
    out.push(...kept);
  }
  return out.sort(
    (a, b) =>
      a.start - b.start ||
      a.midi - b.midi ||
      (a.hand ?? "").localeCompare(b.hand ?? ""),
  );
}

/**
 * Select a uniform subset of attack groups when a generated level is faster
 * than its playability budget. Selection-only (no start shifting) keeps the
 * source pitches intact and makes the result eligible for the RH ladder.
 */
function capAttackDensity(notes: Note[], tempoBpm: number, maxDensity: number, minMedianIoi: number): Note[] {
  if (!notes.length || !Number.isFinite(tempoBpm) || tempoBpm <= 0) return notes;
  const span = maxNoteEnd(notes);
  const spanSec = span * 60 / tempoBpm;
  // maxDensity and minMedianIoi are both expressed in seconds. The IOI floor
  // therefore contributes an attack-rate ceiling of 1 / seconds, while the
  // source tempo is used only when converting the beat span to seconds.
  const targetDensity = Math.min(maxDensity, 1 / minMedianIoi);
  const maxAttacks = Math.max(1, Math.floor(targetDensity * spanSec));
  const byStart = new Map<number, Note[]>();
  for (const n of notes) {
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (groups.length <= maxAttacks) return notes;
  const keep = new Set<number>();
  if (maxAttacks === 1) keep.add(0);
  else {
    for (let i = 0; i < maxAttacks; i++) {
      keep.add(Math.round((i * (groups.length - 1)) / (maxAttacks - 1)));
    }
  }
  return groups.filter((_, i) => keep.has(i)).flatMap(([, ns]) => ns);
}

/**
 * Respect explicit staff/track labels while still giving unlabeled material
 * a deterministic pitch-based split. MIDI imports can contain one named LH
 * track plus auxiliary unlabeled tracks, so an all-or-nothing branch would
 * either discard the label or force every auxiliary note onto the RH staff.
 */
function splitPreservingHands(notes: Note[], forceUnlabeledToRh = false): { rh: Note[]; lh: Note[] } {
  const labeledRh = notes.filter((n) => n.hand === "R");
  const labeledLh = notes.filter((n) => n.hand === "L");
  const unlabeled = notes.filter((n) => n.hand === undefined);
  if (!unlabeled.length) return { rh: labeledRh, lh: labeledLh };
  if (forceUnlabeledToRh) {
    return {
      rh: [...labeledRh, ...unlabeled.map((n) => ({ ...n, hand: "R" as const }))],
      lh: labeledLh,
    };
  }
  const inferred = splitHands(unlabeled);
  return { rh: [...labeledRh, ...inferred.rh], lh: [...labeledLh, ...inferred.lh] };
}

function handStats(notes: Note[]): { left: Note[]; right: Note[]; pitchSpan: number; chordSlices: number } {
  const left = notes.filter((n) => n.hand === "L");
  const right = notes.filter((n) => n.hand !== "L");
  const pitches = notes.map((n) => n.midi);
  const bySlice = new Map<number, Set<number>>();
  for (const n of notes) {
    const key = Math.round(n.start / 0.125);
    const slice = bySlice.get(key) ?? new Set<number>();
    slice.add(n.midi);
    bySlice.set(key, slice);
  }
  const chordSlices = [...bySlice.values()].filter((slice) => {
    if (slice.size < 2) return false;
    const sorted = [...slice].sort((a, b) => a - b);
    return sorted[sorted.length - 1]! - sorted[0]! >= 3;
  }).length;
  return {
    left,
    right,
    pitchSpan: pitches.length ? maxNumber(pitches) - minNumber(pitches) : 0,
    chordSlices,
  };
}

/**
 * Imported MIDI labels are frequently copied from a single source staff (all
 * notes say RH, or the bass staff contains almost everything). That is legal
 * MIDI but a poor teaching arrangement: the learner sees no useful left-hand
 * part. Re-split only when the shape provides evidence for a two-hand texture
 * (a meaningful pitch span and repeated chord/voice slices), leaving genuinely
 * monophonic pieces and balanced/cross-handed arrangements untouched.
 */
function shouldRebalanceForLearner(notes: Note[]): boolean {
  if (notes.length < 16) return false;
  const { left, right, pitchSpan, chordSlices } = handStats(notes);
  const smaller = Math.min(left.length, right.length);
  const larger = Math.max(left.length, right.length);
  const oneSided = smaller === 0;
  const severelyImbalanced = larger > 0 && smaller / larger < 0.15;
  if (!oneSided && !severelyImbalanced) return false;
  if (pitchSpan < 24) return false;
  // At least a few independent attacks must support a harmony/bass reading;
  // a single high-register melody should not acquire invented left-hand notes.
  return chordSlices >= Math.max(3, Math.floor(notes.length / 80)) || minNumber(notes.map((n) => n.midi)) <= 48;
}

function onsetGroups(notes: Note[]): Note[][] {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = note.start.toFixed(3);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a[0]!.start - b[0]!.start);
}

/**
 * Detect the common audio-transcription shape where the pitch split is
 * numerically balanced but musically useless: a high melody sits above
 * recurring bass-plus-inner-voice attacks, while the preliminary LH contains
 * almost no multi-note onsets. Keep this gate narrow so melody-only songs and
 * already-labelled piano arrangements are not rewritten.
 */
function shouldRedistributeInnerVoices(notes: Note[]): boolean {
  if (notes.length < 24 || notes.some((note) => note.hand !== undefined)) return false;
  const preliminary = splitHands(notes);
  const lhGroups = onsetGroups(preliminary.lh);
  if (lhGroups.length < 8) return false;
  const lhMultiRatio = lhGroups.filter((group) => group.length > 1).length / lhGroups.length;
  if (lhMultiRatio >= 0.15) return false;
  const candidateGroups = onsetGroups(notes).filter((group) => {
    if (group.length < 2) return false;
    const sorted = [...group].sort((a, b) => a.midi - b.midi);
    return sorted[0]!.midi <= 50 && sorted[sorted.length - 1]!.midi - sorted[0]!.midi >= 7;
  });
  return candidateGroups.length >= Math.max(8, Math.floor(onsetGroups(notes).length * 0.08));
}

/**
 * Move inner voices from a one-staff transcription into a compact LH shell.
 * The highest co-onset remains the melody; lower co-onsets are octave-revoiced
 * into a playable bass/register. This is deliberately an inferred learner
 * arrangement, not a claim that Basic Pitch supplied staff assignments.
 */
function redistributeInnerVoices(notes: Note[]): Note[] {
  return onsetGroups(notes).flatMap((group) => {
    if (group.length === 1) {
      const note = group[0]!;
      return [{ ...note, hand: note.midi <= 50 ? "L" as const : "R" as const }];
    }
    const sorted = [...group].sort((a, b) => a.midi - b.midi || b.vel - a.vel);
    const melody = sorted[sorted.length - 1]!;
    const moveToLeft = sorted.length >= 2 && (sorted[0]!.midi <= 50 || sorted.length >= 3)
      ? new Set(sorted.slice(0, -1))
      : new Set<Note>();
    return group.map((note) => {
      if (note === melody) return { ...note, hand: "R" as const };
      if (!moveToLeft.has(note)) return { ...note, hand: "R" as const };
      let midi = note.midi;
      while (midi > 55) midi -= 12;
      while (midi < 36) midi += 12;
      return { ...note, midi, hand: "L" as const };
    });
  });
}

/** Detect the continuous-pitch, high-overlap walls that need a percentile
 * hand split. A large pitch gap is a real bass/treble boundary and should
 * continue to win; only dense material with no such boundary is rebalanced.
 * Curated piano arrangements and sources with explicit hand labels are
 * already meaningful two-hand material, so their metadata must override this
 * transcription-wall safeguard. */
function isDenseContinuousWall(notes: Note[], trackNames: string[] = []): boolean {
  if (notes.some((n) => n.hand !== undefined)) return false;
  const namedPiano = trackNames.some((name) => /\b(?:piano|keyboard|keys?)\b/i.test(name));
  // A named Piano track is normally a curated arrangement, but a staggered
  // wall of very long notes can still carry that generic writer-generated
  // name. Keep the wall safeguard for that malformed shape; real curated
  // material has a varied duration distribution (as in Dear God).
  const longSustainRatio = notes.filter((n) => n.dur >= 4).length / Math.max(1, notes.length);
  if (namedPiano && longSustainRatio < 0.5) return false;
  if (notes.length < 12) return false;
  const distinct = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
  if (distinct.length < 2) return false;
  const maxGap = maxNumber(distinct.slice(1).map((m, i) => m - distinct[i]!));
  if (maxGap >= 5) return false;
  const events = notes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let maxSounding = 0;
  for (const [, delta] of events) { active += delta; maxSounding = Math.max(maxSounding, active); }
  return maxSounding >= 8;
}

function fallbackRhSubset(harder: Note[], maxSim: number, minNotes: number): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of harder) {
    if (n.hand === "L") continue;
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (!groups.length) return [];
  // Use one attack group per requested note at minimum; most scalar lines
  // have one note per group, while chords may contribute up to maxSim notes.
  const neededGroups = Math.min(groups.length, Math.max(1, minNotes));
  const out: Note[] = [];
  for (let i = 0; i < neededGroups; i++) {
    const index = neededGroups === 1 ? 0 : Math.round((i * (groups.length - 1)) / (neededGroups - 1));
    const notes = groups[index]![1]!
      .slice()
      .sort((a, b) => b.midi - a.midi)
      .slice(0, Math.max(1, maxSim));
    out.push(...notes);
  }
  return out;
}

/**
 * Shorten overlapping attacks instead of throwing them away when a simplified
 * level inherits a dense source wall. This keeps the melody/ladder pitches
 * while ensuring the easier level never asks for more than `maxSim` held
 * fingers at once.
 */
function capPlayableSounding(notes: Note[], maxSim: number, minDur = 0.125): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: Note[] = [];
  const active: { end: number; note: Note; outIndex: number }[] = [];
  for (const original of sorted) {
    const n = { ...original };
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= n.start + 1e-9) active.splice(i, 1);
    }
    if (active.length >= maxSim) {
      // Prefer ending the longest-held/oldest note at this new attack. The
      // attack itself is retained whenever a positive grid-sized duration is
      // available; only same-time chords beyond the budget are dropped.
      const candidates = active
        .filter((entry) => n.start - entry.note.start >= minDur - 1e-9)
        .sort((a, b) => b.note.start - a.note.start || b.note.dur - a.note.dur);
      const target = candidates[0];
      if (!target) continue;
      const shortened = n.start - target.note.start;
      target.note.dur = Math.max(minDur, shortened);
      target.end = target.note.start + target.note.dur;
      out[target.outIndex] = { ...target.note };
      active.splice(active.indexOf(target), 1);
    }
    const outIndex = out.push(n) - 1;
    active.push({ end: n.start + n.dur, note: n, outIndex });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * A semantic beginner reduction has one job per hand: the RH carries the
 * identity line and the LH supplies a sparse harmonic anchor.  Applying the
 * ordinary global two-finger cap to that texture is subtly unsafe because it
 * sorts low pitches first; a sustained LH note can therefore consume the
 * budget and make a simultaneous RH melody attack disappear.  Cap each hand
 * to one sounding note instead, which both preserves melody priority and
 * keeps the combined sounding budget at two.
 */
function capSemanticBeginnerHands(notes: Note[]): Note[] {
  return [
    ...capPlayableSounding(notes.filter((note) => note.hand === "L"), 1),
    ...capPlayableSounding(notes.filter((note) => note.hand !== "L"), 1),
  ].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Keep one deterministic LH harmonic anchor in each rhythmic window.  The
 * lowest note at the first LH attack wins, so a role-aware arranger's bass or
 * chord root survives while repeated metal/guitar pulses do not overwhelm a
 * beginning pianist.  This is selection-only: pitches and attacks remain
 * traceable to the next harder level.
 */
function sparseLeftHandAnchors(notes: Note[], windowBeats: number): Note[] {
  const lhGroups = onsetGroups(notes.filter((note) => note.hand === "L"));
  if (!lhGroups.length) return [];
  const groupsByWindow = new Map<number, Note[][]>();
  for (const group of lhGroups) {
    const window = Math.floor((group[0]!.start + 1e-9) / windowBeats);
    const groups = groupsByWindow.get(window) ?? [];
    groups.push(group);
    groupsByWindow.set(window, groups);
  }
  return [...groupsByWindow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, groups]) => {
      const first = groups[0]!;
      return [...first].sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0]!;
    });
}

/**
 * Apply the frozen generic-learner Beginner sparse-LH policy.  This remains
 * separate from the metal anchor path so metal output is unchanged: use
 * existing Very Easy LH evidence, choose at most one lowest attack per
 * source-meter window, and skip an attack when its full sounding overlap
 * would exceed the two-hand budget. Every emitted note is an existing event;
 * no retiming or RH mutation is performed.
 */
function collisionAwareSparseLeftHandAnchors(
  beginnerRh: Note[],
  veryEasy: Note[],
  windowBeats: number,
  tempoBpm: number,
  maxDensity: number,
): Note[] {
  const width = Number.isFinite(windowBeats) && windowBeats > 0 ? windowBeats : 4;
  const rejectedRoles = new Set([
    "unknown",
    "unsafe",
    "decorative",
    "arpeggio",
    "arpeggio-filler",
    "filler",
    "repeated-filler",
    "repeated_same_harmony_filler",
    "drum",
    "drums",
  ]);
  const eligible = veryEasy
    .filter((note) => (
      note.hand === "L"
      && (note.identitySource === undefined || note.identitySource === "guitar")
      && !rejectedRoles.has(String((note as Note & { role?: unknown }).role ?? "").toLowerCase())
    ))
    .sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  if (!eligible.length) return [];

  const byWindow = new Map<number, Map<string, Note[]>>();
  for (const note of eligible) {
    const index = Math.floor((note.start + 1e-9) / width);
    const groups = byWindow.get(index) ?? new Map<string, Note[]>();
    const key = note.start.toFixed(6);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
    byWindow.set(index, groups);
  }

  const maxSounding = (notes: Note[]): number => {
    const events = notes
      .flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0;
    let max = 0;
    for (const [, delta] of events) {
      active += delta;
      max = Math.max(max, active);
    }
    return max;
  };

  const emitted: Note[] = [];
  for (const [, groups] of [...byWindow.entries()].sort(([a], [b]) => a - b)) {
    const ordered = [...groups.values()]
      .map((group) => group[0]!)
      .sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
    for (const candidate of ordered) {
      const combined = [...beginnerRh, ...emitted, candidate];
      const spanSeconds = maxNoteEnd(combined) * 60 / tempoBpm;
      const attackDensity = new Set(combined.map((note) => note.start.toFixed(3))).size / spanSeconds;
      if (maxSounding(combined) <= 2 && attackDensity <= maxDensity + 1e-9) {
        emitted.push({ ...candidate });
        break;
      }
    }
  }
  return emitted;
}

/** Select a deterministic mixed-hand subset from a harder level. */
function fallbackPlayableSubset(harder: Note[], maxSim: number, minNotes: number, existing: Note[]): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of harder) {
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (!groups.length) return existing;
  const seen = new Set(existing.map((n) => `${n.midi}@${n.start.toFixed(6)}`));
  const out = [...existing];
  const addFromGroup = (group: Note[]) => {
    const candidates = [...group].sort((a, b) => {
      const hand = (a.hand === "L" ? 0 : 1) - (b.hand === "L" ? 0 : 1);
      return hand || b.vel - a.vel || b.midi - a.midi;
    });
    let added = 0;
    for (const n of candidates) {
      if (added >= maxSim) break;
      const key = `${n.midi}@${n.start.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...n });
      added++;
    }
  };
  // First pass samples across the whole song so a collapsed quantization
  // grid still yields a recognizable beginning, middle, and ending.
  const firstPass = Math.min(groups.length, Math.max(1, minNotes));
  for (let i = 0; i < firstPass && out.length < minNotes; i++) {
    const index = firstPass === 1 ? 0 : Math.round((i * (groups.length - 1)) / (firstPass - 1));
    addFromGroup(groups[index]![1]!);
  }
  // If those groups did not contain enough voices, fill deterministically
  // from the remaining attacks without exceeding the per-attack chord budget.
  for (const [, group] of groups) {
    if (out.length >= minNotes) break;
    addFromGroup(group);
  }
  return out;
}

function preserveRhLadder(
  easier: Note[],
  harder: Note[],
  tolerance: number,
  maxSim: number,
  allowFallback = false,
  semanticTwoHand = false,
): Note[] {
  const capSounding = (notes: Note[]) => semanticTwoHand
    ? capSemanticBeginnerHands(notes)
    : capPlayableSounding(notes, maxSim);
  const starts = new Map<number, number[]>();
  for (const n of harder) {
    if (n.hand === "L") continue;
    const arr = starts.get(n.midi) ?? [];
    arr.push(n.start);
    starts.set(n.midi, arr);
  }
  const collect = (matchTolerance: number, preserveStarts: boolean): Note[] => easier.flatMap((n) => {
    if (n.hand === "L") return [n];
    const candidates = starts.get(n.midi) ?? [];
    if (!candidates.length) return [];
    let match = candidates[0]!;
    let distance = Math.abs(match - n.start);
    for (const s of candidates.slice(1)) {
      const d = Math.abs(s - n.start);
      if (d < distance) {
        match = s;
        distance = d;
      }
    }
    if (distance > matchTolerance) return [];
    return [preserveStarts ? { ...n } : { ...n, start: match }];
  });
  let kept = collect(tolerance, allowFallback);
  // Quantizing a melody to a coarser grid can change which pitch wins a slice,
  // leaving an otherwise healthy level with only a handful of RH notes that
  // match the harder level exactly.  In that case, choose a sparse subset of
  // the already validated harder RH material instead of publishing an invalid
  // (<8-note) level or inventing new pitches.  The fallback is capped per
  // attack so it remains within the easier level's chord-size budget.
  let result = capSounding(kept);
  // Quarter-grid reductions can legitimately move an onset by half of the
  // eighth-note grid used by the harder level. If the strict ladder match
  // would leave an otherwise substantial level with fewer than eight RH
  // notes, retry with that quantization tolerance and snap the recovered
  // notes onto the harder level's actual onsets. This is still a true subset
  // of harder-level pitches/attacks; it only repairs the grid mismatch.
  if (!allowFallback && result.filter((n) => n.hand !== "L").length < 8) {
    const recovered = capSounding(collect(Math.max(tolerance, 0.13), false));
    if (recovered.filter((n) => n.hand !== "L").length > result.filter((n) => n.hand !== "L").length) {
      kept = recovered;
      result = recovered;
    }
  }
  const resultRhCount = result.filter((n) => n.hand !== "L").length;
  const harderRhCount = harder.filter((n) => n.hand !== "L").length;
  // A semantic beginner level needs an identity task as well as its sparse
  // LH anchor.  Counting only the combined note total lets eight LH notes
  // satisfy the fallback even when the harder tier still has RH material;
  // that publishes an unplayable one-handed level.  If the harder tier has no
  // RH material there is nothing traceable to recover, so retain the source's
  // genuinely LH-only texture rather than inventing a hand assignment.
  const fallbackTargetReached = semanticTwoHand
    ? result.length >= 8 && (resultRhCount > 0 || harderRhCount === 0)
    : resultRhCount >= 8;
  if (allowFallback && !fallbackTargetReached) {
    const lh = result.filter((n) => n.hand === "L");
    const needed = semanticTwoHand
      ? Math.max(8 - result.length, resultRhCount > 0 || harderRhCount === 0 ? 0 : 1)
      : Math.max(0, 8 - resultRhCount);
    const fallback = fallbackRhSubset(harder, maxSim, Math.max(needed, 8));
    if (fallback.length >= needed) {
      const seen = new Set(result.filter((n) => n.hand !== "L").map((n) => `${n.midi}@${n.start.toFixed(6)}`));
      const rh = result.filter((n) => n.hand !== "L");
      for (const n of fallback) {
        const key = `${n.midi}@${n.start.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rh.push(n);
        if (semanticTwoHand
          ? lh.length + rh.length >= 8 && (rh.length > 0 || harderRhCount === 0)
          : rh.length >= 8) break;
      }
      if (semanticTwoHand
        ? lh.length + rh.length >= 8 && (rh.length > 0 || harderRhCount === 0)
        : rh.length >= 8) {
        result = [...lh, ...rh].sort((a, b) => a.start - b.start || a.midi - b.midi);
      }
    }
  }
  if (allowFallback && result.length < 8) result = fallbackPlayableSubset(harder, maxSim, 8, result);
  return capSounding(result);
}

/**
 * Keep metal accompaniment attacks traceable through the difficulty ladder.
 * RH already has a dedicated matcher above; LH anchors need the same
 * treatment because quarter-/half-bar quantization can otherwise invent a
 * new bass onset that never existed in the next harder tier. Matching uses
 * the level's normal tolerance and snaps to the harder level's exact attack,
 * so the resulting note is a true semantic subset rather than a re-timed
 * accompaniment event.
 */
function preserveMetalLhLadder(easier: Note[], harder: Note[], tolerance: number): Note[] {
  const starts = new Map<number, number[]>();
  for (const note of harder) {
    if (note.hand !== "L") continue;
    const values = starts.get(note.midi) ?? [];
    values.push(note.start);
    starts.set(note.midi, values);
  }
  return easier.flatMap((note) => {
    if (note.hand !== "L") return [note];
    const candidates = starts.get(note.midi) ?? [];
    let match: number | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const nextDistance = Math.abs(candidate - note.start);
      if (nextDistance < distance) {
        match = candidate;
        distance = nextDistance;
      }
    }
    if (match === undefined || distance > tolerance) return [];
    return [{ ...note, start: match }];
  });
}

const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
  // Enharmonic spellings can be emitted by key detection (for example Cb
  // for seven flats). Keep easy-level bass revoicing on the actual tonic
  // instead of silently falling back to C.
  Cb: 11, "B#": 0, "E#": 5, Fb: 4,
};

function rootOf(midi: number, key: string): number {
  // Metadata may use the same long-form names accepted by keySignature(),
  // such as “F# minor” and “F# major”. Only the tonic token affects the
  // octave revoice; mode is irrelevant here.
  const rawTonic = key.trim().split(/\s+/)[0]?.replace(/m(?:inor)?$/i, "") ?? "C";
  const tonic = rawTonic.charAt(0).toUpperCase() + rawTonic.slice(1);
  const pc = KEY_PC[tonic] ?? 0;
  const offset = ((midi - pc) % 12 + 12) % 12;
  let root = midi - offset;
  while (root < 21) root += 12; // keep the rooted bass on the piano
  return root;
}

/**
 * Generate 6 difficulty variants from a source arrangement.
 * Guarantee: each easier level is a strict simplification (subset or
 * equal notes) of the level above it.
 */
export function buildVariants(src: ParsedMidi, meta: SongMeta, opts: VariantOptions = {}): Variant[] {
  if (opts.chords) {
    const chordErrors = validateChordLabels(opts.chords);
    if (chordErrors.length) throw new Error(`invalid supplied chords: ${chordErrors.join("; ")}`);
  }
  const grid = opts.grid ?? 0.25;
  const metalProfile = opts.arrangementProfile === "metal";
  const learnerProfile = opts.arrangementProfile === "learner";
  const learnerSafetyProfile = learnerProfile || metalProfile;
  const tempo = normalizeTempoBpm(meta.tempo ?? src.tempoBpm);
  // Every source type passes through the same conservative structural cleanup.
  // YouTube ingestion may additionally run cleanTranscription() beforehand;
  // this second pass is intentionally idempotent and protects direct callers.
  const sanitizeOptions: Parameters<typeof sanitizeImportedNotes>[1] = { tempoBpm: tempo };
  // Preserve the distinction between an omitted option (legacy direct-call
  // safety default) and an explicit null (human-authored source, no blanket
  // duration cap). Catalog ingestion always supplies one of these policies.
  if (opts.maxDurBeats !== undefined) sanitizeOptions.maxDurBeats = opts.maxDurBeats;
  const learnerTraceEvents: MetalArrangementTraceEvent[] = [];
  const learnerLineageEnabled = learnerProfile;
  const learnerTraceEnabled = learnerLineageEnabled && opts.trace !== undefined;
  const learnerTraceSink: MetalArrangementTraceSink | undefined = learnerTraceEnabled
    ? { record: (event) => { learnerTraceEvents.push(event); opts.trace?.record(event); } }
    : opts.trace;
  const learnerTraceSource = learnerLineageEnabled ? seedLearnerTrace(src.notes) : src.notes;
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "raw", learnerTraceSource, [], "learner-source");
  }
  const imported = sanitizeImportedNotes(learnerTraceSource, sanitizeOptions);
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "cleaned", imported, [{ stage: "raw", notes: learnerTraceSource }], "sanitize-import");
  }
  // Run the gated learner voice pass before quantization so co-onset evidence
  // from the transcription is not erased by the later grid merge.
  // Metal input is already role-aware and explicitly hand-labelled. Running
  // the generic one-staff rebalance would undo that semantic separation.
  const innerVoiceArrangement = learnerProfile && opts.audioDerived === true && shouldRedistributeInnerVoices(imported);
  const arrangedImported = innerVoiceArrangement ? redistributeInnerVoices(imported) : imported;
  const base = quantize(arrangedImported, { grid: 0.125, minDur: 0.125 });
  const normalized = opts.normalizeRange === false ? base : normalizePianoRange(base);
  const shifted = base.filter((n, i) => normalized[i]!.midi !== n.midi);
  const sourceWarnings = shifted.length
    ? [`${shifted.length} source notes were octave-normalized into the piano range 21-108`]
    : [];
  const arrangementWarnings = innerVoiceArrangement
    ? ["learner inner-voice redistribution applied (inferred staff assignment)"]
    : [];
  const warnings = [...sourceWarnings, ...arrangementWarnings];
  const splitSource = normalized;
  const hasExplicitHands = splitSource.some((n) => n.hand !== undefined);
  const unlabeledSource = splitSource.filter((n) => n.hand === undefined);
  const pathologicalWall = isDenseContinuousWall(
    unlabeledSource.length ? unlabeledSource : splitSource,
    src.trackNames,
  );
  // Learner arrangements may correct a source that labels every staff note as
  // one hand. This is deliberately gated by `shouldRebalanceForLearner`; a
  // real cross-handed score and a genuinely monophonic melody keep the source
  // labels. Dense unlabeled transcription walls retain their existing safety
  // fallback below.
  const learnerRebalance = learnerProfile && shouldRebalanceForLearner(splitSource);
  const split = learnerRebalance
    ? splitHands(splitSource)
    : hasExplicitHands
      ? splitPreservingHands(splitSource, pathologicalWall && unlabeledSource.length > 0)
      : pathologicalWall
        ? { rh: splitSource.map((n) => ({ ...n, hand: "R" as const })), lh: [] as Note[] }
        : splitHands(splitSource);
  const { rh, lh } = split;
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "learner-arranged", [...rh, ...lh], [{ stage: "cleaned", notes: imported }], "range-and-hand-arrangement");
  }
  const key = meta.key ?? detectKey(imported).name;
  // Detect background pads before sustain capping; otherwise a long drone
  // shortened by the import sanitizer can stop looking like a pad and displace
  // the actual melody in the RH voice selector.
  const pads = padPitches(src.notes);
  const capLevel = (level: DifficultyLevel, notes: Note[]) => {
    const lim = PLAYABILITY_LIMITS[level]!;
    return capAttackDensity(notes, tempo, lim.maxDensity, lim.minMedianIoi);
  };

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering. Cap voices per
  // slice AND sounding span so full-band multitrack MIDIs stay a playable
  // piano texture; each easier level is then a reduction of the level above
  // so the ladder stays a true subset.
  const advancedRhSource = metalProfile ? reduceMetalRhRealism(rh, tempo, 8) : rh;
  const advancedSource = quantize(
    [
      ...capSoundingSpan(topVoices(advancedRhSource, 0.125, 4, pads), 12, "high"),
      // Advanced keeps the imported LH attacks intact. Chord thinning is a
      // simplification operation; applying it here changed eighth-note bass
      // timing and introduced same-pitch overlaps in curated arrangements.
      // Learner rebalancing may intentionally keep a low bass plus a
      // mid-register shell (roughly a tenth); the historical 12-semitone
      // ceiling would discard the shell and recreate bass-only LH output.
      ...capSoundingSpan(lh, innerVoiceArrangement ? 19 : 12, "low"),
    ],
    { grid: 0.125 },
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "advanced-candidates", advancedSource, [{ stage: "learner-arranged", notes: [...rh, ...lh] }], "advanced-candidate-construction");
  }
  // The source-level validator allows up to 13 simultaneous notes for
  // advanced material because some faithful arrangements use large chords.
  // A learner still has two hands: cap the advanced texture at four held
  // notes per hand (eight total), shortening old sustains before dropping new
  // attacks. This specifically prevents the “sounds right but no human could
  // play it” failure mode while preserving the melody and chord attacks.
  const advanced = capLevel(
    "advanced",
    learnerSafetyProfile
      ? trimSamePitchOverlaps(capPlayableSounding(advancedSource, 8))
      : advancedSource,
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "advanced-playable", advanced, [{ stage: "advanced-candidates", notes: advancedSource }], "advanced-playability");
  }
  const advancedRh = advanced.filter((n) => n.hand !== "L");
  const advancedLh = advanced.filter((n) => n.hand === "L");
  // Build learner lead candidates from the richer pre-cap stream. The
  // advanced playable cap is intentionally conservative for simultaneous
  // voices, but using that already-pruned result here can erase the connected
  // guitar landings that a medium/easy contour selector needs to choose from.
  // The final ladder intersection still guarantees every published learner
  // note exists in Advanced.
  const mediumRhCandidates = metalProfile ? advancedRhSource : advancedRh;
  const mediumLhTexture = metalProfile
    ? metalLeftHandTexture(advancedLh, 0.5, 3)
    : thinChord(advancedLh, 3);
  const mediumRhTexture = metalProfile
    ? [
      // Residual upper paths have already been reduced to a coherent source
      // lane by the metal arranger. Keep those sparse, evidence-backed
      // attacks available to the learner scheduler; applying topVoices here
      // again can discard every other beat before the source-aware contour
      // pass gets a chance to restore it. Guitar and other non-residual lanes
      // retain the existing voice cap to avoid widening dense textures.
      ...mediumRhCandidates.filter((note) => note.identitySource === "other" && note.midi >= 61),
      ...topVoices(
        mediumRhCandidates.filter((note) => note.identitySource !== "other"),
        0.125,
        3,
        pads,
      ),
    ]
    : topVoices(mediumRhCandidates, 0.125, 3, pads);
  const mediumTexture = [
    ...capSoundingSpan(mediumRhTexture, 12, "high"),
    ...capSoundingSpan(mediumLhTexture, innerVoiceArrangement ? 19 : 12, "low"),
  ];
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "medium-candidates", mediumTexture, [{ stage: "learner-arranged", notes: [...rh, ...lh] }], "medium-candidate-construction");
  }
  // A role-aware RH carries the song identity, but detector articulation is
  // not piano fingering. Progressively reduce its local phrase rate while the
  // LH keeps the existing accompaniment reduction.
  const mediumReduced = metalProfile
    ? [
      // Medium should still expose more lead detail than Easy, but a sixth-
      // note pulse at common metal tempos is a poor single-hand piano target.
      // Four attacks/sec gives a half-beat floor at 120 BPM while removing
      // detector chatter from the playable middle level.
      ...reduceMetalRhRealism(mediumTexture.filter((note) => note.hand !== "L"), tempo, 4, true, true),
      ...reduceMediumRhythm(mediumTexture.filter((note) => note.hand === "L")),
    ]
    : reduceMediumRhythm(mediumTexture);
  const medium = capLevel("medium", trimSamePitchOverlaps(quantize(
    mediumReduced,
    { grid: 0.125 },
  )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "medium-playable", medium, [{ stage: "medium-candidates", notes: mediumTexture }], "medium-playability");
  }
  const mediumRh = medium.filter((n) => n.hand !== "L");
  const mediumLh = medium.filter((n) => n.hand === "L");
  const easyRhSource = metalProfile ? reduceMetalRhRealism(mediumRh, tempo, 4, true, true) : mediumRh;
  const easyLhTexture = metalProfile
    ? metalLeftHandTexture(mediumLh, 0.75, 2)
    : trimSamePitchOverlaps(thinChord(mediumLh, 2).map((n) => (
      // Learner imports already carry the source voicing. Re-rooting every
      // attack to the global key erases real harmonic changes; keep the
      // historical tonic revoice for the default/source profile only.
      learnerProfile ? { ...n } : { ...n, midi: rootOf(n.midi, key) }
    )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "easy-rh-input", easyRhSource, [{
      stage: "medium-playable",
      notes: medium.filter((note) => note.hand !== "L"),
    }], "easy-rh-input");
    emitLearnerStageTrace(learnerTraceSink, "easy-lh-input", easyLhTexture, [{
      stage: "medium-playable",
      notes: medium.filter((note) => note.hand === "L"),
    }], "easy-lh-input");
  }
  const easyMelody = !metalProfile && learnerProfile
    ? selectEasyMelody(easyRhSource, 0.125, 0.5, pads)
    : melodyOnly(easyRhSource, 0.125, 0.5, pads);
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "onset-group", easyRhSource, [{ stage: "easy-rh-input", notes: easyRhSource }], "easy-onset-grouping");
    emitLearnerStageTrace(learnerTraceSink, "selector-input", [...easyRhSource, ...easyLhTexture], [
      { stage: "easy-rh-input", notes: easyRhSource },
      { stage: "easy-lh-input", notes: easyLhTexture },
    ], "easy-selector-input");
    emitLearnerStageTrace(learnerTraceSink, "easy-voice-selection", easyMelody, [{ stage: "onset-group", notes: easyRhSource }], "easy-voice-selection");
  }
  const easyAssembledSource = [
    ...capSoundingSpan(easyMelody, 12, "high"),
    ...capSoundingSpan(
      easyLhTexture,
      innerVoiceArrangement ? 19 : 12,
      "low",
    ),
  ];
  const easyUncapped = trimSamePitchOverlaps(quantize(
    easyAssembledSource,
    { grid: 0.125 },
  ));
  const easy = capLevel("easy", easyUncapped);
  if (learnerTraceEnabled) {
    const easyDecision = [...easyMelody, ...easyLhTexture];
    emitLearnerStageTrace(learnerTraceSink, "decision", easyDecision, [
      { stage: "easy-voice-selection", notes: easyMelody },
      { stage: "easy-lh-input", notes: easyLhTexture },
    ], "easy-selection");
    emitLearnerStageTrace(learnerTraceSink, "easy-assembled", easyUncapped, [{ stage: "decision", notes: easyDecision }], "easy-assembly");
    emitLearnerStageTrace(learnerTraceSink, "easy-playable", easy, [{ stage: "easy-assembled", notes: easyUncapped }], "easy-playability");
  }
  // Each easier level is a reduction of the level above it, so the ladder
  // is a true subset (same melody, same moments) instead of a re-selection
  // that drifts apart in fast passages.
  const easyRh = easy.filter((n) => n.hand !== "L");
  const easyLh = easy.filter((n) => n.hand === "L");
  const veryEasyRhSource = metalProfile ? reduceMetalRhRealism(easyRh, tempo, 3, true) : easyRh;
  const veryEasyLhTexture = metalProfile ? metalLeftHandTexture(easyLh, 1, 2) : easyLh;
  const veryEasy = capLevel("very-easy", trimSamePitchOverlaps(quantize(
    [...capSoundingSpan(melodyOnly(veryEasyRhSource, 0.25, 0.5, pads), 12, "high"), ...veryEasyLhTexture],
    { grid: 0.25 },
  )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "very-easy-rh-input", veryEasyRhSource, [{
      stage: "easy-playable",
      notes: easy.filter((note) => note.hand !== "L"),
    }], "very-easy-rh-input");
    emitLearnerStageTrace(learnerTraceSink, "very-easy-playable", veryEasy, [{
      stage: "easy-playable",
      notes: easy,
    }], "very-easy-playability");
  }
  const meterBeats = src.timeSig[0] * (4 / src.timeSig[1]);
  const beatsPerMeasure = Number.isFinite(meterBeats) && meterBeats > 0 ? meterBeats : 4;
  const beginnerRhSource = metalProfile
    ? reduceMetalRhRealism(veryEasy.filter((n) => n.hand !== "L"), tempo, 2.5, true)
    : veryEasy.filter((n) => n.hand !== "L");
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-rh-input", beginnerRhSource, [{
      stage: "very-easy-playable",
      notes: veryEasy.filter((note) => note.hand !== "L"),
    }], "beginner-rh-input");
  }
  const beginnerRh = capSoundingSpan(melodyOnly(beginnerRhSource, 0.25, 0.5, pads), 12, "high");
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-rh-selected", beginnerRh, [{
      stage: "beginner-rh-input",
      notes: beginnerRhSource,
    }], "beginner-principal-selection");
  }
  const beginnerSource = quantize(
    [
      ...beginnerRh,
      ...(metalProfile ? sparseLeftHandAnchors(veryEasy, Math.max(1, beatsPerMeasure / 2)) : []),
    ],
    { grid: 0.25 },
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-assembled", beginnerSource, [
      { stage: "beginner-rh-selected", notes: beginnerRh },
      { stage: "very-easy-playable", notes: veryEasy.filter((note) => note.hand === "L") },
    ], "beginner-assembly");
  }
  const beginner = capLevel(
    "beginner",
    trimSamePitchOverlaps(metalProfile ? capSemanticBeginnerHands(beginnerSource) : beginnerSource),
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-playable", beginner, [{
      stage: "beginner-assembled",
      notes: beginnerSource,
    }], "beginner-playability");
  }
  const veryBeginnerRhSource = metalProfile
    ? reduceMetalRhRealism(beginner.filter((n) => n.hand !== "L"), tempo, 2, true)
    : beginner.filter((n) => n.hand !== "L");
  const veryBeginnerRh = capSoundingSpan(
    melodyOnly(veryBeginnerRhSource, 0.5, 1, pads),
    12,
    "high",
  );
  const veryBeginnerSource = quantize(
    [
      ...veryBeginnerRh,
      ...(metalProfile ? sparseLeftHandAnchors(beginner, Math.max(1, beatsPerMeasure)) : []),
    ],
    { grid: 0.5 },
  );
  const veryBeginner = capLevel(
    "very-beginner",
    trimSamePitchOverlaps(metalProfile ? capSemanticBeginnerHands(veryBeginnerSource) : veryBeginnerSource),
  );

  const rawSets: Record<DifficultyLevel, Note[]> = {
    "very-beginner": veryBeginner,
    beginner,
    "very-easy": veryEasy,
    easy,
    medium,
    advanced,
  };
  // Thin harder learner levels before canonicalizing the public ladder. A
  // post-ladder deletion can leave an easier note with no surviving parent.
  if (learnerProfile && !metalProfile) {
    for (const level of ["easy", "medium", "advanced"] as const) {
      rawSets[level] = selectProtectedSemanticLocalThinning(rawSets[level]!, tempo, level).notes;
    }
  }
  // The levels were density-capped top-down so every reduction sees the same
  // playable attack stream as its next harder neighbor. Intersect easier RH
  // material with that neighbor once more to canonicalize quantized starts.
  const sets: Record<DifficultyLevel, Note[]> = { ...rawSets };
  for (let i = LEVEL_ORDER.length - 2; i >= 0; i--) {
    const easier = LEVEL_ORDER[i]!;
    const harder = LEVEL_ORDER[i + 1]!;
    const metalBeginnerFallback = metalProfile
      && (easier === "very-beginner" || easier === "beginner");
    const ladderReduced = preserveRhLadder(
      sets[easier]!,
      sets[harder]!,
      LADDER_TOL[easier] ?? 0.02,
      PLAYABILITY_LIMITS[easier]!.maxSim,
      pathologicalWall || metalBeginnerFallback,
      metalBeginnerFallback,
    );
    sets[easier] = trimSamePitchOverlaps(
      metalProfile
        ? preserveMetalLhLadder(ladderReduced, sets[harder]!, LADDER_TOL[easier] ?? 0.02)
        : ladderReduced,
    );
  }
  if (learnerProfile && !metalProfile) {
    sets.beginner = trimSamePitchOverlaps(preserveRhLadder(
      sets.beginner!,
      sets.easy!,
      LADDER_TOL.beginner ?? 0.02,
      PLAYABILITY_LIMITS.beginner!.maxSim,
    ));
    sets["very-beginner"] = trimSamePitchOverlaps(preserveRhLadder(
      sets["very-beginner"]!,
      sets.beginner!,
      LADDER_TOL["very-beginner"] ?? 0.26,
      PLAYABILITY_LIMITS["very-beginner"]!.maxSim,
    ));
  }
  const beginnerAfterLadder = sets.beginner!;
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-ladder", beginnerAfterLadder, [{
      stage: "beginner-playable",
      notes: beginner,
    }], "beginner-ladder-preservation");
  }
  // Promote the frozen collision-aware sparse-LH policy for the generic
  // learner Beginner only. Applying it after the ladder is finalized makes
  // the source of truth explicit: existing Beginner RH and finalized Very
  // Easy LH are the inputs, while every other level (including metal) stays
  // unchanged.
  if (learnerProfile && !metalProfile) {
    const beginner = sets.beginner!;
    const beginnerRh = beginner.filter((note) => note.hand !== "L");
    const sparseLh = collisionAwareSparseLeftHandAnchors(
      beginnerRh,
      sets["very-easy"]!,
      Math.max(1, beatsPerMeasure),
      tempo,
      PLAYABILITY_LIMITS.beginner!.maxDensity,
    );
    const existingKeys = new Set(beginner.map((note) => `${note.hand ?? "R"}:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`));
    sets.beginner = [...beginner, ...sparseLh.filter((note) => {
      const key = `L:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`;
      return !existingKeys.has(key);
    })].sort((a, b) => a.start - b.start || (a.hand === "L" ? 1 : -1) || a.midi - b.midi);
  }
  // Frozen Candidate A: after the existing ladder and sparse-LH stages, admit
  // at most one structurally supported source attack per meter window. The
  // shared selector owns eligibility/order; this callback owns the current
  // Beginner mechanical envelope. Candidate B is never callable here.
  if (learnerProfile && !metalProfile) {
    const beginnerBaseline = sets.beginner!;
    const rejected = learnerTraceEnabled
      ? resolveBeginnerOffGridRejections(learnerTraceEvents, imported)
      : resolveBeginnerOffGridRejectionsFromLineage(beginner, beginnerAfterLadder, imported);
    const durationBeats = Math.max(0, ...imported.map((note) => note.start + note.dur).filter(Number.isFinite));
    const selection = selectBeginnerOffGridRhCandidates({
      sourceNotes: imported,
      baselineNotes: beginnerBaseline,
      rejected,
      timeSig: src.timeSig,
      durationBeats,
      budget: 1,
      isLegal: (candidate, selected, baseline) => assessBeginnerOffGridCandidate(
        candidate,
        selected,
        baseline,
        {
          tempoBpm: tempo,
          durationBeats,
          maxSimultaneity: PLAYABILITY_LIMITS.beginner!.maxSim,
          maxDensity: PLAYABILITY_LIMITS.beginner!.maxDensity,
          minMedianIoiSeconds: PLAYABILITY_LIMITS.beginner!.minMedianIoi,
        },
      ).legal,
    });
    const additions = new Map(selection.emitted.map((candidate) => [learnerSourceKey(candidate.note), candidate.sourceKey]));
    sets.beginner = selection.selected.map((note) => {
      const sourceKey = additions.get(learnerSourceKey(note));
      if (!sourceKey) return note;
      const marked = { ...note, learnerTraceRefs: [sourceKey] } as LearnerInternalNote;
      Object.defineProperty(marked, BEGINNER_OFFGRID_CANDIDATE, { value: true, enumerable: true });
      return marked;
    });
  }
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-final", sets.beginner!, [{
      stage: "beginner-ladder",
      notes: beginnerAfterLadder,
    }, {
      stage: "raw",
      notes: learnerTraceSource,
    }], "beginner-finalization");
  }
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "easy-ladder", sets.easy!, [{ stage: "easy-playable", notes: easy }], "easy-ladder-preservation");
    emitLearnerStageTrace(learnerTraceSink, "final", sets.easy!, [{ stage: "easy-ladder", notes: sets.easy! }], "easy-public-final");
  }
  const scores: Record<DifficultyLevel, number> = {
    "very-beginner": 1,
    beginner: 1.4,
    "very-easy": 2,
    easy: 2.6,
    medium: 3.4,
    advanced: 4.6,
  };
  const lhPattern = detectBassPattern(lh);
  return LEVEL_ORDER.map((level) => {
    const internalNotes = sets[level]!.map((n) => ({ ...n }));
    emitDifficultyTrace(opts.trace, level, internalNotes, learnerTraceSource);
    const notes = learnerLineageEnabled ? internalNotes.map(stripLearnerTrace) : internalNotes;
    return {
      level,
      difficultyScore: scores[level]!,
      notes,
      ...(warnings.length ? { warnings } : {}),
      chords: opts.chords
        ? opts.chords.map((chord) => ({ ...chord, notes: [...chord.notes] }))
        : chordsAt(notes, grid, src.durationBeats, opts.audioDerived !== true),
      bassPattern: level === "advanced" || level === "medium"
        ? lhPattern
        : level === "very-easy" || level === "easy" || (metalProfile && notes.some((note) => note.hand === "L"))
          ? "block"
          : "none",
      key,
      tempoBpm: tempo,
      timeSig: src.timeSig,
      measures: buildMeasures(notes, src.timeSig, src.durationBeats),
    };
  });
}

function buildMeasures(notes: Note[], timeSig: [number, number], arrangementEnd = 0): Variant["measures"] {
  const [num, den] = timeSig;
  const rawBeatsPerMeasure = num * (4 / den);
  const beatsPerMeasure = Number.isFinite(rawBeatsPerMeasure) && rawBeatsPerMeasure > 0 ? rawBeatsPerMeasure : 4;
  const dur = Math.max(arrangementEnd, maxNoteEnd(notes), 1);
  const count = Math.max(1, Math.ceil(dur / beatsPerMeasure));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerMeasure,
    endBeat: (i + 1) * beatsPerMeasure,
  }));
}
