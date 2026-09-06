import {
  BEGINNER_OFFGRID_RH_BUDGET_CONFIG,
  PLAYABILITY_LIMITS,
  assessBeginnerOffGridCandidate,
  type Note,
  type Variant,
  selectBeginnerOffGridRhCandidates,
  type BeginnerOffGridCandidate as ProductionBeginnerOffGridCandidate,
} from "@keyspilli/midi";
import { evaluateArrangement } from "./arrangement-evaluation.js";
import type { ProvenanceTraceEvent } from "./arrangement-evaluation.js";
import { COVER_RH_CLIFF_CONFIG } from "./cover-rh-cliff.js";

/** Frozen diagnostic contract. It is deliberately not consumed by generation. */
export const BEGINNER_OFFGRID_RH_FRONTIER_CONFIG = {
  schemaVersion: 1,
  mission: "BEGINNER_OFF_GRID_INTERIOR_RH_BUDGET_FRONTIER",
  quarterGridBeats: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.quarterGridBeats,
  gridToleranceBeats: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.gridToleranceBeats,
  onsetToleranceBeats: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.onsetToleranceBeats,
  phraseBreakBeats: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.phraseBreakBeats,
  repeatedGapBeats: COVER_RH_CLIFF_CONFIG.repeatedGapBeats,
  spanCapSemitones: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.spanCapSemitones,
  largeLeapSemitones: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.largeLeapSemitones,
  windowBudgets: { baseline: 0, "candidate-a": 1, "candidate-b": 2 },
  windowPolicy: "time-signature measure: 4 beats in 4/4; 4.5 beats in 9/8",
  structuralSignals: BEGINNER_OFFGRID_RH_BUDGET_CONFIG.structuralSignals,
} as const;

export type BeginnerOffGridCandidate = "baseline" | "candidate-a" | "candidate-b";
export type BeginnerOffGridDecision =
  | "BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED"
  | "BEGINNER_OFFGRID_RH_BUDGET_REQUIRES_LARGER_COMPLEXITY_STEP"
  | "BEGINNER_OFFGRID_RH_GAIN_TOO_SMALL"
  | "BEGINNER_OFFGRID_RH_BLOCKED_BY_OTHER_CONSTRAINTS"
  | "BEGINNER_OFFGRID_RH_COLLAPSES_PUBLIC_SEPARATION";
export type OffGridStructuralSignal = typeof BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.structuralSignals[number];
export type OffGridBlocker = "BLOCKED_BY_WINDOW_BUDGET" | "BLOCKED_BY_MAX_SIM" | "BLOCKED_BY_DENSITY" | "BLOCKED_BY_IOI" | "BLOCKED_BY_SPAN_JUMP" | "BLOCKED_BY_CURRENT_LH" | "BLOCKED_BY_OTHER_CONSTRAINT";

export interface BeginnerOffGridRhFrontierInput {
  fixture: { id: string; label?: string };
  /** Raw/Very Easy RH source used to characterize rejected attacks. */
  sourceNotes: Note[];
  variants: Variant[];
  /**
   * Optional pre-Candidate-A Beginner output. Production callers that pass a
   * post-promotion Beginner variant should provide this so the diagnostic
   * frontier does not apply Candidate A twice.
   */
  baselineNotes?: Note[];
  /** Optional first-loss trace. When present, only beginner-ladder rejections are eligible. */
  trace?: ProvenanceTraceEvent[];
  /** Synthetic/test escape hatch for an explicitly frozen rejection set. */
  rejectedRhNotes?: Note[];
  revision?: string;
}

export interface OffGridTimingMetrics {
  offGridAttacks: number;
  offGridFraction: number;
  offGridAttacksPerMinute: number;
  minimumSubdivisionBeats: number | null;
  subdivisionDistribution: Record<string, number>;
  nearestQuarterGridOffsets: number[];
  consecutiveOffGridRuns: number[];
}

export interface OffGridIdentityMetrics {
  sourceRhEvents: number;
  rhEventSurvival: number | null;
  sourceRhOnsets: number;
  rhOnsetSurvival: number | null;
  pitchClassSurvival: number | null;
  anchorSurvival: number | null;
  turnSurvival: number | null;
  localExtremaSurvival: number | null;
  repeatedAttackSurvival: number | null;
}

export interface FrontierCandidateReport {
  budget: number;
  tempoBpm: number;
  eligible: number;
  eligibleSourceKeys: string[];
  emitted: number;
  emittedStarts: number[];
  emittedSourceKeys: string[];
  discardedByWindowBudget: number;
  structurallySignificantRejected: number;
  recoveredStructural: number;
  blockers: Record<OffGridBlocker, number>;
  rhNotes: number;
  lhNotes: number;
  rhOnsets: number;
  metrics: {
    notes: number;
    onsets: number;
    rightHandNotes: number;
    rightHandOnsets: number;
    leftHandNotes: number;
    attacksPerSecond: number;
    medianIoiBeats: number | null;
    maxSimultaneity: number;
    medianSimultaneity: number;
    rightHandSpan: number | null;
    largeJumpRate: number;
    lhActiveOnsetPercent: number;
    bothHandsOnsetPercent: number;
  };
  identity: OffGridIdentityMetrics;
  timing: OffGridTimingMetrics;
  lhSignature: string;
}

export interface BeginnerOffGridRhFrontierReport {
  schemaVersion: 1;
  mission: "BEGINNER_OFF_GRID_INTERIOR_RH_BUDGET_FRONTIER";
  fixture: { id: string; label?: string };
  revision?: string;
  config: typeof BEGINNER_OFFGRID_RH_FRONTIER_CONFIG;
  sourceTiming: OffGridTimingMetrics & { structuralCategories: Record<OffGridStructuralSignal, number> };
  rejectedTiming: OffGridTimingMetrics;
  eligibleStructuralCategories: Record<OffGridStructuralSignal, number>;
  rejectedStructuralCategories: Record<OffGridStructuralSignal, number>;
  lineage: { traceAvailable: boolean; rejectedEvents: number; resolvedRejectedEvents: number; unresolvedRejectedEvents: number; explicitRejectionSet: boolean };
  candidates: Record<BeginnerOffGridCandidate, FrontierCandidateReport>;
  easy: FrontierCandidateReport | null;
  beginnerToEasy: { notesDelta: number; onsetsDelta: number; attacksPerSecondDelta: number; offGridAttacksPerMinuteDelta: number; maxSimultaneityDelta: number } | null;
  publicSeparation: { candidateAbelowEasy: boolean; candidateBbelowEasy: boolean; candidateAMetrics: Record<string, number | null>; candidateBMetrics: Record<string, number | null>; easyMetrics: Record<string, number | null> };
  controls: {
    lhUnchanged: boolean;
    noRetiming: boolean;
    maxSimLimit: boolean;
    densityLimit: boolean;
    ioiLimit: boolean;
    spanJumpLimit: boolean;
    nonBeginnerUnchanged: boolean;
    frozenPlayabilityConstraints: boolean;
  };
  decision: BeginnerOffGridDecision;
  behavior: "NO_MUSICAL_BEHAVIOR_CHANGE";
}

type Group = { start: number; notes: Note[] };
type TraceNote = NonNullable<ProvenanceTraceEvent["note"]>;
type EligibleCandidate = ProductionBeginnerOffGridCandidate;
const BLOCKERS: OffGridBlocker[] = ["BLOCKED_BY_WINDOW_BUDGET", "BLOCKED_BY_MAX_SIM", "BLOCKED_BY_DENSITY", "BLOCKED_BY_IOI", "BLOCKED_BY_SPAN_JUMP", "BLOCKED_BY_CURRENT_LH", "BLOCKED_BY_OTHER_CONSTRAINT"];
function redactPath(value: string): string {
  return value.replace(/(?:file:\/\/)?(?:\/Users\/|\/private\/tmp\/|[A-Za-z]:[\\/])[^\s"']+/g, "<redacted-path>");
}

function valid(note: Note): boolean {
  return Boolean(note && typeof note === "object")
    && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && Number.isFinite(note.start) && Number.isFinite(note.dur) && Number.isFinite(note.vel)
    && note.start >= 0 && note.dur > 0 && Number.isFinite(note.start + note.dur)
    && note.vel >= 0 && note.vel <= 127
    && (note.hand === undefined || note.hand === "L" || note.hand === "R");
}

function ordered(notes: Note[]): Note[] {
  return notes.filter(valid).map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || b.vel - a.vel);
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stableNoteKey(note: Note): string {
  return `${note.hand ?? "R"}:${note.start.toFixed(9)}:${note.midi}:${note.dur.toFixed(9)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

function noteSetSignature(notes: Note[]): string {
  return notes.map(stableNoteKey).sort(compareText).join("|");
}

function variantSignature(variant: Variant): string {
  return JSON.stringify({ ...variant, notes: ordered(variant.notes) });
}

function traceMidi(note: TraceNote): number { return note.rawMidi ?? note.midi; }

function traceRoots(
  event: ProvenanceTraceEvent,
  byKey: Map<string, ProvenanceTraceEvent>,
  memo: Map<string, Set<string>>,
  visiting = new Set<string>(),
): Set<string> {
  const cached = memo.get(event.key);
  if (cached) return cached;
  if (visiting.has(event.key)) return new Set();
  visiting.add(event.key);
  const result = new Set<string>();
  if (event.parentKeys?.length) {
    for (const parentKey of event.parentKeys) {
      const parent = byKey.get(parentKey);
      if (parent) for (const root of traceRoots(parent, byKey, memo, visiting)) result.add(root);
      else result.add(parentKey);
    }
  } else result.add(event.key);
  visiting.delete(event.key);
  memo.set(event.key, result);
  return result;
}

function resolveSourceNote(traceNote: TraceNote, sourceRh: Note[]): Note | null {
  return sourceRh
    .filter((note) => traceMidi(traceNote) === note.midi && Math.abs(traceNote.start - note.start) <= 1e-6)
    .sort((left, right) => Math.abs(left.dur - traceNote.dur) - Math.abs(right.dur - traceNote.dur) || Math.abs(left.vel - traceNote.vel) - Math.abs(right.vel - traceNote.vel) || compareText(stableNoteKey(left), stableNoteKey(right)))[0] ?? null;
}

function resolvedRejection(
  event: ProvenanceTraceEvent,
  sourceRh: Note[],
  byKey: Map<string, ProvenanceTraceEvent>,
  memo: Map<string, Set<string>>,
): { note: Note; sourceKey: string } | null {
  // Trace-backed candidates must prove a single source ancestry. Synthetic
  // callers can still use rejectedRhNotes as the explicit escape hatch.
  if (!event.parentKeys?.length) return null;
  if (!event.note || !valid({ ...event.note, hand: event.note.hand ?? "R" })) return null;
  const rootKeys = [...traceRoots(event, byKey, memo)].sort(compareText);
  if (rootKeys.length !== 1) return null;
  if (event.parentKeys?.length && (!rootKeys.length || rootKeys.some((key) => !byKey.has(key)))) return null;
  const roots = rootKeys.map((key) => byKey.get(key)?.note).filter((note): note is TraceNote => Boolean(note));
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const sourceNote = resolveSourceNote(root, sourceRh);
  return sourceNote ? { note: { ...sourceNote }, sourceKey: rootKeys[0] ?? event.key } : null;
}

function groups(notes: Note[]): Group[] {
  const out: Group[] = [];
  for (const note of ordered(notes)) {
    const group = out.at(-1);
    if (!group || note.start - group.start > BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.onsetToleranceBeats + 1e-9) out.push({ start: note.start, notes: [note] });
    else group.notes.push(note);
  }
  return out;
}

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function quarterOffset(start: number): number {
  const grid = BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.quarterGridBeats;
  return Math.abs(start - Math.round(start / grid) * grid);
}

function isOffGrid(start: number): boolean {
  return quarterOffset(start) > BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.gridToleranceBeats;
}

function subdivision(start: number): number | null {
  const denominators = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const denominator = denominators.find((value) => Math.abs(start * value - Math.round(start * value)) <= 1e-6);
  return denominator ? 1 / denominator : null;
}

function timing(notes: Note[], tempoBpm: number): OffGridTimingMetrics {
  const rh = ordered(notes.filter((note) => note.hand !== "L"));
  const onsetStarts = groups(rh).map((group) => group.start);
  const offGridStarts = onsetStarts.filter(isOffGrid);
  const runs: number[] = [];
  let run = 0;
  for (const start of onsetStarts) {
    if (isOffGrid(start)) run++;
    else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  const subdivisions = offGridStarts.map(subdivision).filter((value): value is number => value !== null);
  const subdivisionDistribution = Object.fromEntries([...new Set(subdivisions)].sort((a, b) => a - b).map((value) => [String(value), subdivisions.filter((item) => item === value).length]));
  const durationBeats = Math.max(0, ...rh.map((note) => note.start + note.dur));
  const durationMinutes = tempoBpm > 0 ? durationBeats * 60 / tempoBpm / 60 : 0;
  return {
    offGridAttacks: offGridStarts.length,
    offGridFraction: onsetStarts.length ? round(offGridStarts.length / onsetStarts.length) ?? 0 : 0,
    offGridAttacksPerMinute: durationMinutes > 0 ? round(offGridStarts.length / durationMinutes) ?? 0 : 0,
    minimumSubdivisionBeats: subdivisions.length ? Math.min(...subdivisions) : null,
    subdivisionDistribution,
    nearestQuarterGridOffsets: offGridStarts.map((start) => round(quarterOffset(start)) ?? 0).sort((a, b) => a - b),
    consecutiveOffGridRuns: runs,
  };
}

function structuralSignals(sourceGroups: Group[], index: number, velocityCut: number, durationCut: number): OffGridStructuralSignal[] {
  const group = sourceGroups[index]!;
  const pitch = Math.max(...group.notes.map((note) => note.midi));
  const previous = sourceGroups[index - 1];
  const next = sourceGroups[index + 1];
  const previousPitch = previous ? Math.max(...previous.notes.map((note) => note.midi)) : null;
  const nextPitch = next ? Math.max(...next.notes.map((note) => note.midi)) : null;
  const signals: OffGridStructuralSignal[] = [];
  if (previousPitch !== null && nextPitch !== null && ((pitch > previousPitch && pitch > nextPitch) || (pitch < previousPitch && pitch < nextPitch))) signals.push("contour-extremum");
  if (previousPitch === pitch || nextPitch === pitch) signals.push("repeated-articulation");
  if (group.notes.some((note) => note.vel >= velocityCut)) signals.push("high-velocity");
  if (group.notes.some((note) => note.dur >= durationCut)) signals.push("long-duration");
  if (index === 0 || index === sourceGroups.length - 1 || (previous && group.start - previous.start > BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.phraseBreakBeats) || (next && next.start - group.start > BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.phraseBreakBeats)) signals.push("phrase-anchor");
  if ((previousPitch !== null && Math.abs(pitch - previousPitch) >= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.largeLeapSemitones) || (nextPitch !== null && Math.abs(nextPitch - pitch) >= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.largeLeapSemitones)) signals.push("large-leap-endpoint");
  return signals;
}

function sameEvent(left: Note, right: Note): boolean {
  return left.midi === right.midi && Math.abs(left.start - right.start) <= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.onsetToleranceBeats + 1e-9;
}

function matchSource(source: Note[], candidate: Note[]): { source: Note; candidate: Note }[] {
  const used = new Set<number>();
  const result: { source: Note; candidate: Note }[] = [];
  const orderedCandidate = ordered(candidate);
  for (const sourceNote of ordered(source)) {
    const index = orderedCandidate.findIndex((note, candidateIndex) => !used.has(candidateIndex) && sameEvent(sourceNote, note));
    if (index >= 0) { used.add(index); result.push({ source: sourceNote, candidate: orderedCandidate[index]! }); }
  }
  return result;
}

function identity(source: Note[], candidate: Note[]): OffGridIdentityMetrics {
  const sourceRh = ordered(source.filter((note) => note.hand !== "L"));
  const candidateRh = ordered(candidate.filter((note) => note.hand !== "L"));
  const matches = matchSource(sourceRh, candidateRh);
  const sourceGroups = groups(sourceRh);
  const candidateGroups = groups(candidateRh);
  const matchedStarts = sourceGroups.filter((group) => candidateGroups.some((candidateGroup) => Math.abs(candidateGroup.start - group.start) <= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.onsetToleranceBeats + 1e-9));
  const pitchClasses = sourceGroups.filter((group) => {
    const target = candidateGroups.find((candidateGroup) => Math.abs(candidateGroup.start - group.start) <= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.onsetToleranceBeats + 1e-9);
    return target?.notes.some((note) => group.notes.some((sourceNote) => note.midi % 12 === sourceNote.midi % 12)) ?? false;
  });
  const reps = sourceGroups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
  const targetReps = sourceGroups.map((group) => {
    const target = candidateGroups.find((candidateGroup) => Math.abs(candidateGroup.start - group.start) <= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.onsetToleranceBeats + 1e-9);
    return target ? Math.max(...target.notes.map((note) => note.midi)) : null;
  });
  const turnAt = (index: number) => {
    const into = Math.sign(reps[index]! - reps[index - 1]!);
    const out = Math.sign(reps[index + 1]! - reps[index]!);
    return into !== 0 && out !== 0 && into !== out;
  };
  const extremaAt = (index: number) => (reps[index]! > reps[index - 1]! && reps[index]! > reps[index + 1]!) || (reps[index]! < reps[index - 1]! && reps[index]! < reps[index + 1]!);
  const sourceTurns = reps.length > 2 ? reps.slice(1, -1).map((_, index) => index + 1).filter(turnAt) : [];
  const sourceExtrema = reps.length > 2 ? reps.slice(1, -1).map((_, index) => index + 1).filter(extremaAt) : [];
  const survived = (indices: number[]) => indices.filter((index) => targetReps[index] !== null && targetReps[index - 1] !== null && targetReps[index + 1] !== null).length;
  const repeated = sourceGroups.slice(1).filter((group, index) => Math.max(...group.notes.map((note) => note.midi)) === Math.max(...sourceGroups[index]!.notes.map((note) => note.midi))).length;
  const repeatedSurvived = sourceGroups.slice(1).filter((group, index) => {
    if (Math.max(...group.notes.map((note) => note.midi)) !== Math.max(...sourceGroups[index]!.notes.map((note) => note.midi))) return false;
    return targetReps[index + 1] !== null && targetReps[index] !== null && targetReps[index + 1] === targetReps[index];
  }).length;
  return {
    sourceRhEvents: sourceRh.length,
    rhEventSurvival: sourceRh.length ? matches.length / sourceRh.length : null,
    sourceRhOnsets: sourceGroups.length,
    rhOnsetSurvival: sourceGroups.length ? matchedStarts.length / sourceGroups.length : null,
    pitchClassSurvival: sourceGroups.length ? pitchClasses.length / sourceGroups.length : null,
    anchorSurvival: sourceGroups.length ? (matchedStarts.length ? Math.min(2, matchedStarts.length) / Math.min(2, sourceGroups.length) : 0) : null,
    turnSurvival: sourceTurns.length ? survived(sourceTurns) / sourceTurns.length : null,
    localExtremaSurvival: sourceExtrema.length ? survived(sourceExtrema) / sourceExtrema.length : null,
    repeatedAttackSurvival: repeated ? repeatedSurvived / repeated : null,
  };
}

function emptyBlockers(): Record<OffGridBlocker, number> {
  return Object.fromEntries(BLOCKERS.map((key) => [key, 0])) as Record<OffGridBlocker, number>;
}

function candidateReport(sourceRh: Note[], baseline: Variant, notes: Note[], budget: number, eligible: EligibleCandidate[], emitted: EligibleCandidate[], discardedByWindowBudget: number, blockers: Record<OffGridBlocker, number>, source: Note[]): FrontierCandidateReport {
  const durationBeats = Math.max(0, ...notes.map((note) => note.start + note.dur), ...source.map((note) => note.start + note.dur));
  const evaluated = evaluateArrangement({ fixture: { id: "beginner-offgrid-rh-frontier" }, candidate: { selector: "diagnostic:beginner-offgrid", notes, tempoBpm: baseline.tempoBpm, durationBeats, timeSig: baseline.timeSig } });
  const metrics = evaluated.metrics;
  const onsetCount = metrics.global.onsetCount;
  const lhOnsets = metrics.leftHand.onsetCount;
  const bothHandOnsets = groups(notes).filter((group) => group.notes.some((note) => note.hand !== "L") && group.notes.some((note) => note.hand === "L")).length;
  return {
    budget,
    tempoBpm: baseline.tempoBpm,
    eligible: eligible.length,
    eligibleSourceKeys: eligible.map((candidate) => redactPath(candidate.sourceKey)).sort(compareText),
    emitted: emitted.length,
    emittedStarts: emitted.map((candidate) => candidate.note.start).sort((a, b) => a - b),
    emittedSourceKeys: emitted.map((candidate) => redactPath(candidate.sourceKey)).sort(compareText),
    discardedByWindowBudget,
    structurallySignificantRejected: eligible.length,
    recoveredStructural: emitted.length,
    blockers,
    rhNotes: metrics.rightHand.noteCount,
    lhNotes: metrics.leftHand.noteCount,
    rhOnsets: metrics.rightHand.onsetCount,
    metrics: {
      notes: metrics.global.noteCount,
      onsets: onsetCount,
      rightHandNotes: metrics.rightHand.noteCount,
      rightHandOnsets: metrics.rightHand.onsetCount,
      leftHandNotes: metrics.leftHand.noteCount,
      attacksPerSecond: metrics.global.onsetsPerSecond,
      medianIoiBeats: metrics.rightHand.melodicGap.p50,
      maxSimultaneity: metrics.global.simultaneity.max,
      medianSimultaneity: metrics.global.simultaneity.p50,
      rightHandSpan: metrics.rightHand.range.span,
      largeJumpRate: metrics.rightHand.largeLeap.rate,
      lhActiveOnsetPercent: onsetCount ? round(lhOnsets / onsetCount * 100) ?? 0 : 0,
      bothHandsOnsetPercent: onsetCount ? round(bothHandOnsets / onsetCount * 100) ?? 0 : 0,
    },
    identity: identity(source, notes),
    timing: timing(notes, baseline.tempoBpm),
    lhSignature: noteSetSignature(notes.filter((note) => note.hand === "L")),
  };
}

function belowEasy(candidate: FrontierCandidateReport, easy: FrontierCandidateReport): boolean {
  return candidate.metrics.notes < easy.metrics.notes && candidate.metrics.onsets < easy.metrics.onsets && candidate.metrics.attacksPerSecond < easy.metrics.attacksPerSecond && candidate.timing.offGridAttacksPerMinute < easy.timing.offGridAttacksPerMinute;
}

/** Pure, deterministic evaluator. It never calls generation or mutates variants. */
export function evaluateBeginnerOffGridRhFrontier(input: BeginnerOffGridRhFrontierInput): BeginnerOffGridRhFrontierReport {
  const beginner = input.variants.find((variant) => variant.level === "beginner");
  if (!beginner) throw new Error("beginner variant is required");
  const easyVariant = input.variants.find((variant) => variant.level === "easy");
  const source = ordered(input.sourceNotes);
  const sourceRh = source.filter((note) => note.hand !== "L");
  const baselineNotes = ordered(input.baselineNotes ?? beginner.notes);
  const sourceGroups = groups(sourceRh);
  const velocities = sourceRh.map((note) => note.vel);
  const durations = sourceRh.map((note) => note.dur);
  const velocityCut = quantile(velocities, 0.75) ?? 127;
  const durationCut = quantile(durations, 0.75) ?? 0;
  const traceEvents = input.trace ?? [];
  const traceProvided = input.trace !== undefined;
  const traceByKey = new Map(traceEvents.map((event) => [event.key, event]));
  const traceMemo = new Map<string, Set<string>>();
  const rejectedTraceEvents = traceEvents
    .filter((event) => event.stage === "beginner-ladder" && (event.selected === false || (event.operation === "REJECTED" && event.selected !== true)));
  const tracedRejected = rejectedTraceEvents
    .map((event) => resolvedRejection(event, sourceRh, traceByKey, traceMemo))
    .filter((candidate): candidate is { note: Note; sourceKey: string } => Boolean(candidate));
  const rejectionPool = [...new Map((traceProvided ? tracedRejected : (input.rejectedRhNotes ?? []).map((note) => ({ note: { ...note }, sourceKey: stableNoteKey(note) }))).map((candidate) => [candidate.sourceKey, candidate])).values()];
  const evaluationDurationBeats = Math.max(0, ...source.map((note) => note.start + note.dur));
  const legal = (candidate: Note, selected: Note[], baseline: Note[], budgetBlockers: Record<OffGridBlocker, number>): boolean => {
    const assessed = assessBeginnerOffGridCandidate(candidate, selected, baseline, {
      tempoBpm: beginner.tempoBpm,
      durationBeats: evaluationDurationBeats,
      maxSimultaneity: PLAYABILITY_LIMITS.beginner!.maxSim,
      maxDensity: PLAYABILITY_LIMITS.beginner!.maxDensity,
      minMedianIoiSeconds: PLAYABILITY_LIMITS.beginner!.minMedianIoi,
    });
    if (!assessed.legal) budgetBlockers[assessed.blocker ?? "BLOCKED_BY_OTHER_CONSTRAINT"]++;
    return assessed.legal;
  };
  const eligibility = selectBeginnerOffGridRhCandidates({
    sourceNotes: source,
    baselineNotes,
    rejected: rejectionPool,
    timeSig: beginner.timeSig,
    durationBeats: evaluationDurationBeats,
    budget: 0,
    isLegal: () => true,
  });
  const eligible = eligibility.eligible as EligibleCandidate[];
  const signalCounts = (notes: Note[]): Record<OffGridStructuralSignal, number> => {
    const counts = Object.fromEntries(BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.structuralSignals.map((signal) => [signal, 0])) as Record<OffGridStructuralSignal, number>;
    const noteGroups = groups(notes.filter((note) => note.hand !== "L"));
    for (let index = 0; index < noteGroups.length; index++) {
      for (const signal of structuralSignals(noteGroups, index, velocityCut, durationCut)) counts[signal]++;
    }
    return counts;
  };
  const eligibleCategoryCounts = Object.fromEntries(BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.structuralSignals.map((signal) => [signal, eligible.filter((candidate) => candidate.signals.includes(signal)).length])) as Record<OffGridStructuralSignal, number>;
  const rejectedCategoryCounts = Object.fromEntries(BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.structuralSignals.map((signal) => [signal, 0])) as Record<OffGridStructuralSignal, number>;
  for (const { note } of rejectionPool) {
    const groupIndex = sourceGroups.findIndex((group) => group.notes.some((member) => member.midi === note.midi && Math.abs(member.start - note.start) <= 1e-9));
    if (groupIndex < 0) continue;
    for (const signal of structuralSignals(sourceGroups, groupIndex, velocityCut, durationCut)) rejectedCategoryCounts[signal]++;
  }
  const sourceCategoryCounts = signalCounts(sourceRh);
  const rejectedTiming = timing(rejectionPool.map((candidate) => candidate.note), beginner.tempoBpm);
  const limits = PLAYABILITY_LIMITS.beginner!;
  const nonBeginnerBefore = input.variants.filter((variant) => variant.level !== "beginner").map(variantSignature);
  const run = (budget: number): { notes: Note[]; emitted: EligibleCandidate[]; discarded: number; blockers: Record<OffGridBlocker, number> } => {
    const blockers = emptyBlockers();
    const selection = selectBeginnerOffGridRhCandidates({
      sourceNotes: source,
      baselineNotes,
      rejected: rejectionPool,
      timeSig: beginner.timeSig,
      durationBeats: evaluationDurationBeats,
      budget,
      isLegal: (candidate, selected, baseline) => legal(candidate, selected, baseline, blockers),
    });
    blockers.BLOCKED_BY_WINDOW_BUDGET += selection.discardedByWindowBudget;
    return {
      notes: selection.selected,
      emitted: selection.emitted as EligibleCandidate[],
      discarded: selection.discardedByWindowBudget,
      blockers,
    };
  };
  const baseline = candidateReport(sourceRh, beginner, baselineNotes, 0, [], [], 0, emptyBlockers(), sourceRh);
  const a = run(1);
  const b = run(2);
  const candidateA = candidateReport(sourceRh, beginner, a.notes, 1, eligible, a.emitted, a.discarded, a.blockers, sourceRh);
  const candidateB = candidateReport(sourceRh, beginner, b.notes, 2, eligible, b.emitted, b.discarded, b.blockers, sourceRh);
  const easy = easyVariant ? candidateReport(sourceRh, beginner, ordered(easyVariant.notes), 0, [], [], 0, emptyBlockers(), sourceRh) : null;
  const allCandidates = [baseline, candidateA, candidateB];
  const densityLimit = allCandidates.every((candidate) => candidate.metrics.attacksPerSecond <= limits.maxDensity + 1e-9);
  const ioiLimit = allCandidates.every((candidate) => candidate.metrics.medianIoiBeats === null || candidate.metrics.medianIoiBeats * 60 / beginner.tempoBpm >= limits.minMedianIoi - 1e-9);
  const baselineSpan = baseline.metrics.rightHandSpan ?? 0;
  const spanJumpLimit = allCandidates.every((candidate) => !(baselineSpan <= BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.spanCapSemitones + 1e-9 && (candidate.metrics.rightHandSpan ?? 0) > BEGINNER_OFFGRID_RH_FRONTIER_CONFIG.spanCapSemitones + 1e-9));
  const controls = {
    lhUnchanged: [candidateA, candidateB].every((candidate) => candidate.lhSignature === baseline.lhSignature),
    noRetiming: [...a.emitted, ...b.emitted].every((candidate) => eligible.some((sourceCandidate) => sourceCandidate.sourceKey === candidate.sourceKey && stableNoteKey(sourceCandidate.note) === stableNoteKey(candidate.note))),
    maxSimLimit: allCandidates.every((candidate) => candidate.metrics.maxSimultaneity <= limits.maxSim),
    densityLimit,
    ioiLimit,
    spanJumpLimit,
    nonBeginnerUnchanged: JSON.stringify(nonBeginnerBefore) === JSON.stringify(input.variants.filter((variant) => variant.level !== "beginner").map(variantSignature)),
    frozenPlayabilityConstraints: false,
  };
  controls.frozenPlayabilityConstraints = controls.lhUnchanged && controls.noRetiming && controls.maxSimLimit && controls.densityLimit && controls.ioiLimit && controls.spanJumpLimit && controls.nonBeginnerUnchanged;
  const candidateAbelowEasy = Boolean(easy && belowEasy(candidateA, easy));
  const candidateBbelowEasy = Boolean(easy && belowEasy(candidateB, easy));
  const blockerCount = Object.entries(candidateA.blockers).filter(([key]) => key !== "BLOCKED_BY_WINDOW_BUDGET").reduce((sum, [, value]) => sum + value, 0);
  const decision: BeginnerOffGridDecision = !controls.maxSimLimit || blockerCount > candidateA.emitted + candidateB.emitted
    ? "BEGINNER_OFFGRID_RH_BLOCKED_BY_OTHER_CONSTRAINTS"
    : easy && !candidateAbelowEasy && candidateA.recoveredStructural > 0
      ? "BEGINNER_OFFGRID_RH_COLLAPSES_PUBLIC_SEPARATION"
    : candidateA.recoveredStructural > 0 && candidateAbelowEasy && candidateA.recoveredStructural >= candidateB.recoveredStructural / 2
        ? "BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED"
        : candidateB.recoveredStructural > candidateA.recoveredStructural
          ? "BEGINNER_OFFGRID_RH_BUDGET_REQUIRES_LARGER_COMPLEXITY_STEP"
          : "BEGINNER_OFFGRID_RH_GAIN_TOO_SMALL";
  return {
    schemaVersion: 1,
    mission: "BEGINNER_OFF_GRID_INTERIOR_RH_BUDGET_FRONTIER",
    fixture: { ...input.fixture, ...(input.fixture.label ? { label: redactPath(input.fixture.label) } : {}) },
    ...(input.revision ? { revision: redactPath(input.revision) } : {}),
    config: BEGINNER_OFFGRID_RH_FRONTIER_CONFIG,
    sourceTiming: { ...timing(sourceRh, beginner.tempoBpm), structuralCategories: sourceCategoryCounts },
    rejectedTiming,
    eligibleStructuralCategories: eligibleCategoryCounts,
    rejectedStructuralCategories: rejectedCategoryCounts,
    lineage: { traceAvailable: Boolean(input.trace?.length), rejectedEvents: traceProvided ? rejectedTraceEvents.length : rejectionPool.length, resolvedRejectedEvents: rejectionPool.length, unresolvedRejectedEvents: traceProvided ? Math.max(0, rejectedTraceEvents.length - tracedRejected.length) : 0, explicitRejectionSet: Boolean(input.rejectedRhNotes?.length) },
    candidates: { baseline, "candidate-a": candidateA, "candidate-b": candidateB },
    easy,
    beginnerToEasy: easy ? { notesDelta: easy.metrics.notes - baseline.metrics.notes, onsetsDelta: easy.metrics.onsets - baseline.metrics.onsets, attacksPerSecondDelta: round(easy.metrics.attacksPerSecond - baseline.metrics.attacksPerSecond) ?? 0, offGridAttacksPerMinuteDelta: round(easy.timing.offGridAttacksPerMinute - baseline.timing.offGridAttacksPerMinute) ?? 0, maxSimultaneityDelta: easy.metrics.maxSimultaneity - baseline.metrics.maxSimultaneity } : null,
    publicSeparation: { candidateAbelowEasy, candidateBbelowEasy, candidateAMetrics: { notes: candidateA.metrics.notes, onsets: candidateA.metrics.onsets, attacksPerSecond: candidateA.metrics.attacksPerSecond, offGridAttacksPerMinute: candidateA.timing.offGridAttacksPerMinute, maxSimultaneity: candidateA.metrics.maxSimultaneity }, candidateBMetrics: { notes: candidateB.metrics.notes, onsets: candidateB.metrics.onsets, attacksPerSecond: candidateB.metrics.attacksPerSecond, offGridAttacksPerMinute: candidateB.timing.offGridAttacksPerMinute, maxSimultaneity: candidateB.metrics.maxSimultaneity }, easyMetrics: easy ? { notes: easy.metrics.notes, onsets: easy.metrics.onsets, attacksPerSecond: easy.metrics.attacksPerSecond, offGridAttacksPerMinute: easy.timing.offGridAttacksPerMinute, maxSimultaneity: easy.metrics.maxSimultaneity } : {} },
    controls,
    decision,
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
  };
}

/** Stable path-free JSON for report reruns. */
export function canonicalBeginnerOffGridRhFrontierJson(report: BeginnerOffGridRhFrontierReport): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : typeof value === "string" ? redactPath(value) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(report));
}

export const evaluateOffGridRhBudgetFrontier = evaluateBeginnerOffGridRhFrontier;
