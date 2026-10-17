import { Note, DifficultyLevel } from "../types.js";
import { type MetalArrangementTraceEvent, type MetalArrangementTraceOperation, type MetalArrangementTraceSink } from "../metal-arrange.js";
import { type BeginnerOffGridRejectedCandidate } from "../beginner-offgrid.js";

export type LearnerInternalNote = Note & {
  learnerTraceRefs?: readonly string[];
  rawMidi?: number;
};

export function learnerTraceRefs(note: Note): readonly string[] {
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
export function seedLearnerTrace(notes: Note[]): LearnerInternalNote[] {
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

export function stripLearnerTrace(note: Note): Note {
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

export function learnerSourceKey(note: Note): string {
  return `${note.hand ?? "R"}:${note.start.toFixed(9)}:${note.midi}:${note.dur.toFixed(9)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

export function resolveBeginnerOffGridRejections(
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
export function resolveBeginnerOffGridRejectionsFromLineage(
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

export function emitDifficultyTrace(
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
export function emitLearnerStageTrace(
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
