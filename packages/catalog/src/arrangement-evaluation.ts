import { basename } from "node:path";
import { validateVariants, verifyMonotonicity, type GuitarHarmonyDiagnostics, type Note, type ParsedMidi, type Variant } from "@keyspilli/midi";
import { sha256Hex } from "./fixture-evidence.js";

/** The thresholds are part of the report contract so a report can be reproduced. */
export const ARRANGEMENT_EVALUATION_CONFIG = {
  schemaVersion: 1,
  onsetToleranceBeats: 0.08,
  veryShortBeats: 0.125,
  isolatedGapBeats: 1.5,
  isolatedDurationBeats: 0.25,
  repeatedGapBeats: 0.5,
  spanViolationSemitones: 12,
  referenceOnsetToleranceBeats: 0.125,
  minimumReferenceWindows: 3,
  minimumReferenceBars: 32,
} as const;

export interface EvaluationWindow {
  id: string;
  label?: string;
  candidate: [number, number];
  reference?: [number, number];
  anchorId?: string;
}

export interface ArrangementEvaluationCandidate {
  selector: string;
  revision?: string;
  bytes?: Uint8Array;
  parsed?: ParsedMidi;
  notes?: Note[];
  tempoBpm?: number;
  durationBeats?: number;
  timeSig?: [number, number];
  guitarDiagnostics?: GuitarDiagnosticsInput;
  /** Alias accepted by callers that pass MetalArrangementResult.stats directly. */
  guitarHarmony?: GuitarDiagnosticsInput;
}

export type GuitarDiagnosticsInput = Partial<Omit<GuitarHarmonyDiagnostics, "qualityCounts">> & {
  qualityCounts?: Record<string, number>;
} & Record<string, unknown>;

export interface ArrangementEvaluationReference {
  selector?: string;
  bytes?: Uint8Array;
  parsed?: ParsedMidi;
  notes?: Note[];
  tempoBpm?: number;
  durationBeats?: number;
  windows?: EvaluationWindow[];
  /** Optional known relationship between byte-different but event-identical references. */
  aliasOf?: string;
}

export interface ProvenanceTraceEvent {
  key: string;
  windowId?: string;
  stage?: "raw" | "lead" | "residual" | "cluster" | "semantic" | "chord" | "left-hand" | "final";
  source?: string | null;
  selectionReason?: string;
  rawCandidateCount?: number;
  selected?: boolean;
}

export interface ProvenanceTraceInput {
  status?: "available" | "unavailable";
  events?: ProvenanceTraceEvent[];
  windows?: Record<string, ProvenanceTraceEvent[]>;
}

export interface ArrangementEvaluationInput {
  fixture: { id: string; label?: string };
  candidate: ArrangementEvaluationCandidate;
  reference?: ArrangementEvaluationReference;
  windows?: EvaluationWindow[];
  guitarDiagnostics?: GuitarDiagnosticsInput;
  trace?: ProvenanceTraceInput;
  variants?: Variant[];
  mode?: "structural" | "reference" | "human";
  /** Optional duration expectation; this never becomes a hard gate when omitted. */
  expectedDurationBeats?: number;
}

export interface NumericRange {
  min: number | null;
  max: number | null;
  span: number | null;
}

export interface IntervalMetrics {
  mean: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface LargeLeapMetrics {
  count: number;
  rate: number;
  thresholdSemitones: number;
  unexplainedCount: number | null;
}

export interface HandMetrics {
  noteCount: number;
  onsetCount: number;
  attacksPerSecond: number;
  range: NumericRange;
  interval: IntervalMetrics;
  largeLeap: LargeLeapMetrics;
  octaveBounceCount: number;
  melodicGap: { p50: number | null; p90: number | null; p99: number | null; max: number | null };
  monoOnsetRatio: number;
  polyOnsetRatio: number;
  shortRate: number;
  repeatedRate: number;
}

export interface LeftHandMetrics extends HandMetrics {
  averageNotesPerAttack: number;
  pitchClassSetRepeatRate: number | null;
  excessiveChordDensityRate: number;
  rootFifthOctaveRepresentation: { value: number | null; basis: "provenance" | "unavailable" };
}

export interface GlobalMetrics {
  noteCount: number;
  onsetCount: number;
  notesPerSecond: number;
  onsetsPerSecond: number;
  durationBeats: number;
  durationSeconds: number;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  simultaneity: { max: number; p50: number; p90: number; p99: number; basis: "sounding-sweep" };
  chromaticOutlier: { value: number | null; basis: "explicit-key" | "reference" | "unavailable"; count: number | null; total: number | null };
  isolatedShortCount: number;
  veryShortCount: number;
  repeatedAttackRate: number;
  rhLhCollisionCount: number;
  rhLhCollisionRate: number;
  handSpanViolations: number;
  coverage: { firstBeat: number | null; lastBeat: number | null; activeBeats: number; ratio: number };
  durationMismatch: { value: number | null; basis: "expected" | "reference" | "unavailable" };
}

export interface GuitarEvaluationMetrics {
  rawCandidateCount: number | null;
  harmonicGroupCount: number | null;
  selectedLeadCount: number | null;
  recoveredCount: number | null;
  rejectedCount: number | null;
  /** Short aliases matching the arranger's diagnostic vocabulary. */
  recovered: number | null;
  rejected: number | null;
  rawSourceNotes: number | null;
  /** Compatibility alias for the metal arranger diagnostic field. */
  rawGuitarNotes: number | null;
  leadNotes: number | null;
  residualNotes: number | null;
  onsetClusterCount: number | null;
  semanticAttackCount: number | null;
  collapsedUnisonOctaveFifth: number | null;
  rejectedWeakThirds: number | null;
  bassSupportedRoots: number | null;
  stabilizedTransitions: number | null;
  emittedLeftHandEvents: number | null;
  fallbackWindows: number | null;
  qualityCounts: Record<string, number>;
  finalRightHandCount: number;
  finalLeftHandCount: number;
}

/**
 * Metrics for one learner variant.  Variant notes are evaluated separately
 * from the canonical arrangement so a ladder can be inspected without
 * conflating its density or source transitions with the source arrangement.
 * Semantic guitar diagnostics are intentionally unavailable here: those
 * diagnostics describe the canonical arranger pass, not a post-selection
 * learner variant.
 */
export interface VariantEvaluationMetrics {
  level: Variant["level"];
  difficultyScore: number;
  tempoBpm: number;
  timeSig: [number, number];
  global: GlobalMetrics;
  rightHand: HandMetrics;
  leftHand: LeftHandMetrics;
  guitar: GuitarEvaluationMetrics;
  source: SourceIntegrityMetrics;
}

export interface SourceCounts {
  vocals: number;
  guitar: number;
  bass: number;
  other: number;
  generated: number | null;
  inferred: number | null;
  unknown: number;
}

export interface SourceIntegrityMetrics {
  /** Counts reflect labels actually carried by Note; unavailable roles stay null below. */
  final: { all: SourceCounts; right: SourceCounts; left: SourceCounts };
  transitions: number;
  rapidTransitions: number;
  vocalFinalCount: number;
  /** Note.identitySource has no bass role; null means attribution was not carried. */
  bassFinalCount: number | null;
  drumDerivedPitchCount: number;
  unknownProvenanceCount: number;
  sectionSourceCounts: Record<string, SourceCounts>;
}

export interface ReferenceWindowMetrics {
  candidateBounds: [number, number];
  referenceBounds: [number, number];
  candidateOnsetCount: number;
  referenceOnsetCount: number;
  candidateNoteCount: number;
  referenceNoteCount: number;
  matchedOnsets: number;
  exactPitchMatches: number;
  pitchClassMatches: number;
  onsetErrorBeats: { median: number | null; p90: number | null };
  exactPitch: { precision: number | null; recall: number | null; f1: number | null };
  pitchClass: { precision: number | null; recall: number | null; f1: number | null };
  contour: { p95Leap: number | null; directionAgreement: number | null };
  ioi: { candidateMedian: number | null; referenceMedian: number | null };
  density: { candidate: number; reference: number };
}

export interface ReferenceEvaluation {
  status: "not-requested" | "alignment-required" | "aligned" | "insufficient-coverage";
  referenceHash: string | null;
  referenceSelector: string | null;
  /** Logical alias relation, when a byte-different reference is known equivalent. */
  aliasOf: string | null;
  windows: Array<ReferenceWindowMetrics & { id: string; anchorId?: string }>;
  matchedOnsets: number;
  exactPitch: { precision: number | null; recall: number | null; f1: number | null };
  pitchClass: { precision: number | null; recall: number | null; f1: number | null };
  alignmentCoverageBars: number;
  diagnostics: string[];
}

export interface ArrangementEvaluationReport {
  schemaVersion: 1;
  config: typeof ARRANGEMENT_EVALUATION_CONFIG;
  fixture: { id: string; label?: string };
  candidate: {
    selector: string;
    revision?: string;
    bytes: number | null;
    sha256: string | null;
    parser: { format: number; division: number; tempoBpm: number; durationBeats: number; timeSig: [number, number]; noteCount: number };
  };
  metrics: {
    global: GlobalMetrics;
    rightHand: HandMetrics;
    leftHand: LeftHandMetrics;
    guitar: GuitarEvaluationMetrics;
    source: SourceIntegrityMetrics;
    sections: Record<string, SectionEvaluationMetrics>;
    variants: Record<string, VariantEvaluationMetrics>;
  };
  reference?: ReferenceEvaluation;
  trace: { status: "available" | "unavailable"; events?: ProvenanceTraceEvent[]; windows?: Record<string, ProvenanceTraceEvent[]> };
  gate: GateResult;
  determinism: { canonicalSha256: string };
}

export interface SectionEvaluationMetrics {
  startBeat: number;
  endBeat: number;
  coverage: GlobalMetrics["coverage"];
  global: GlobalMetrics;
  rightHand: HandMetrics;
  leftHand: LeftHandMetrics;
  source: SourceCounts;
  guitar: Pick<GuitarEvaluationMetrics, "finalRightHandCount" | "finalLeftHandCount">;
  reference?: ReferenceWindowMetrics;
}

export interface GateResult {
  mode: "structural" | "reference" | "human";
  status: "pass" | "fail" | "null";
  failures: string[];
  evaluated: string[];
  thresholds: Record<string, number>;
  /** Makes intentionally unavailable checks explicit in candidate-only reports. */
  availability: { variants: "evaluated" | "unavailable" };
}

type AnyNote = Note & { isDrum?: boolean; drum?: boolean };

interface MetricBundle {
  global: GlobalMetrics;
  rightHand: HandMetrics;
  leftHand: LeftHandMetrics;
  guitar: GuitarEvaluationMetrics;
  source: SourceIntegrityMetrics;
}

function finiteNote(note: Note): boolean {
  if (!note || typeof note !== "object") return false;
  const value = note as unknown as {
    midi?: unknown;
    start?: unknown;
    dur?: unknown;
    vel?: unknown;
    hand?: unknown;
    identitySource?: unknown;
  };
  const validHand = value.hand === undefined || value.hand === "L" || value.hand === "R";
  const validSource = value.identitySource === undefined
    || value.identitySource === "vocals"
    || value.identitySource === "guitar"
    || value.identitySource === "other";
  const midi = value.midi;
  const start = value.start;
  const dur = value.dur;
  const vel = value.vel;
  return typeof midi === "number" && typeof start === "number" && typeof dur === "number" && typeof vel === "number"
    && Number.isInteger(midi) && Number.isFinite(start) && Number.isFinite(dur)
    && Number.isFinite(vel) && vel >= 0 && vel <= 127
    && start >= 0 && dur > 0 && midi >= 0 && midi <= 127
    && validHand && validSource;
}

function cleanNotes(notes: Note[]): AnyNote[] {
  return notes.filter(finiteNote).map((note) => ({ ...note }));
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * scale) / scale : 0;
}

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function mean(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function starts(notes: Note[], tolerance = ARRANGEMENT_EVALUATION_CONFIG.onsetToleranceBeats): number[] {
  const sorted = [...notes].filter(finiteNote).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: number[] = [];
  for (const note of sorted) {
    if (!out.length || note.start - out[out.length - 1]! > tolerance + 1e-9) out.push(note.start);
  }
  return out;
}

function sourceRank(source: string | null | undefined): number {
  if (source === "vocals") return 0;
  if (source === "guitar") return 1;
  if (source === "other") return 2;
  if (source === "bass") return 3;
  return 4;
}

function onsetGroups(notes: Note[], hand?: "L" | "R"): Array<{ start: number; notes: AnyNote[] }> {
  const sorted = cleanNotes(notes)
    .filter((note) => hand === undefined || (hand === "L" ? note.hand === "L" : note.hand !== "L"))
    .sort((a, b) => a.start - b.start || a.midi - b.midi || sourceRank(a.identitySource) - sourceRank(b.identitySource) || a.vel - b.vel);
  const groups: Array<{ start: number; notes: AnyNote[] }> = [];
  for (const note of sorted) {
    const group = groups[groups.length - 1];
    if (!group || note.start - group.start > ARRANGEMENT_EVALUATION_CONFIG.onsetToleranceBeats + 1e-9) {
      groups.push({ start: note.start, notes: [note] });
    } else group.notes.push(note);
  }
  return groups;
}

function handOf(note: Note): "L" | "R" {
  return note.hand === "L" ? "L" : "R";
}

function rangeOf(notes: Note[]): NumericRange {
  if (!notes.length) return { min: null, max: null, span: null };
  let min = Infinity;
  let max = -Infinity;
  for (const note of notes) {
    min = Math.min(min, note.midi);
    max = Math.max(max, note.midi);
  }
  return { min, max, span: max - min };
}

function intervalsForHand(notes: Note[]): { pitches: number[]; gaps: number[] } {
  const groups = onsetGroups(notes);
  const pitches = groups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
  const gaps = groups.slice(1).map((group, index) => group.start - groups[index]!.start);
  return { pitches, gaps };
}

function intervalMetrics(pitches: number[]): IntervalMetrics {
  const values = pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!));
  return { mean: mean(values), median: quantile(values, 0.5), p95: quantile(values, 0.95), max: values.length ? Math.max(...values) : null };
}

function handMetrics(notes: Note[], durationSeconds: number): HandMetrics {
  const groups = onsetGroups(notes);
  const { pitches, gaps } = intervalsForHand(notes);
  const intervals = pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!));
  const large = intervals.filter((value) => value >= 7).length;
  const repeated = pitches.slice(1).filter((pitch, index) => pitch === pitches[index]).length;
  const mono = groups.filter((group) => group.notes.length === 1).length;
  const short = notes.filter((note) => note.dur <= ARRANGEMENT_EVALUATION_CONFIG.veryShortBeats).length;
  let octaveBounceCount = 0;
  for (let index = 2; index < pitches.length; index++) {
    const incoming = pitches[index - 1]! - pitches[index - 2]!;
    const outgoing = pitches[index]! - pitches[index - 1]!;
    if (Math.abs(incoming) >= 11 && Math.abs(outgoing) >= 11 && Math.sign(incoming) !== Math.sign(outgoing)) octaveBounceCount++;
  }
  return {
    noteCount: notes.length,
    onsetCount: groups.length,
    attacksPerSecond: durationSeconds > 0 ? round(groups.length / durationSeconds) : 0,
    range: rangeOf(notes),
    interval: intervalMetrics(pitches),
    largeLeap: { count: large, rate: intervals.length ? round(large / intervals.length) : 0, thresholdSemitones: 7, unexplainedCount: null },
    octaveBounceCount,
    melodicGap: { p50: quantile(gaps, 0.5), p90: quantile(gaps, 0.9), p99: quantile(gaps, 0.99), max: gaps.length ? Math.max(...gaps) : null },
    monoOnsetRatio: groups.length ? round(mono / groups.length) : 0,
    polyOnsetRatio: groups.length ? round((groups.length - mono) / groups.length) : 0,
    shortRate: notes.length ? round(short / notes.length) : 0,
    repeatedRate: intervals.length ? round(repeated / intervals.length) : 0,
  };
}

function leftHandMetrics(notes: Note[], durationSeconds: number): LeftHandMetrics {
  const base = handMetrics(notes, durationSeconds);
  const groups = onsetGroups(notes, "L");
  const sets = groups.map((group) => [...new Set(group.notes.map((note) => ((note.midi % 12) + 12) % 12))].sort((a, b) => a - b).join(","));
  const repeatedSets = sets.slice(1).filter((set, index) => set === sets[index]).length;
  const chordDense = groups.filter((group) => group.notes.length > 3).length;
  return {
    ...base,
    averageNotesPerAttack: groups.length ? round(notes.length / groups.length) : 0,
    pitchClassSetRepeatRate: sets.length > 1 ? round(repeatedSets / (sets.length - 1)) : null,
    excessiveChordDensityRate: groups.length ? round(chordDense / groups.length) : 0,
    rootFifthOctaveRepresentation: { value: null, basis: "unavailable" },
  };
}

function sweepSimultaneity(notes: Note[]): { max: number; quantiles: number[] } {
  const events: Array<{ time: number; delta: number }> = [];
  for (const note of notes) events.push({ time: note.start, delta: 1 }, { time: note.start + note.dur, delta: -1 });
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let level = 0;
  let max = 0;
  const levels: number[] = [];
  for (const event of events) {
    level += event.delta;
    max = Math.max(max, level);
    levels.push(level);
  }
  return { max, quantiles: [quantile(levels, 0.5) ?? 0, quantile(levels, 0.9) ?? 0, quantile(levels, 0.99) ?? 0] };
}

function activeCoverage(notes: Note[], durationBeats: number): GlobalMetrics["coverage"] {
  if (!notes.length || durationBeats <= 0) return { firstBeat: null, lastBeat: null, activeBeats: 0, ratio: 0 };
  const events = notes.flatMap((note) => [[note.start, 1], [Math.min(durationBeats, note.start + note.dur), -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let previous = events[0]![0];
  let activeBeats = 0;
  for (const [time, delta] of events) {
    if (active > 0) activeBeats += Math.max(0, time - previous);
    active += delta;
    previous = time;
  }
  return { firstBeat: Math.min(...notes.map((note) => note.start)), lastBeat: Math.max(...notes.map((note) => note.start + note.dur)), activeBeats: round(activeBeats), ratio: round(activeBeats / durationBeats) };
}

function sourceCounts(notes: Note[]): SourceCounts {
  const counts: SourceCounts = { vocals: 0, guitar: 0, bass: 0, other: 0, generated: null, inferred: null, unknown: 0 };
  for (const note of notes) {
    if (note.identitySource === "vocals") counts.vocals++;
    else if (note.identitySource === "guitar") counts.guitar++;
    else if (note.identitySource === "other") counts.other++;
    else counts.unknown++;
  }
  return counts;
}

function sourceTransitions(notes: Note[]): { transitions: number; rapid: number } {
  // Source transitions are a right-hand melody diagnostic.  LH chord/root
  // material should not make a vocal-to-guitar handoff look worse, and the
  // source tiebreak keeps same-onset results stable under input reordering.
  const ordered = onsetGroups(notes.filter((note) => handOf(note) === "R"))
    .map((group) => ({ start: group.start, source: [...group.notes].sort((a, b) => sourceRank(a.identitySource) - sourceRank(b.identitySource) || a.midi - b.midi)[0]?.identitySource ?? null }));
  let transitions = 0;
  let rapid = 0;
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.source !== ordered[index - 1]!.source) {
      transitions++;
      if (ordered[index]!.start - ordered[index - 1]!.start <= ARRANGEMENT_EVALUATION_CONFIG.repeatedGapBeats + 1e-9) rapid++;
    }
  }
  return { transitions, rapid };
}

function collisionCount(notes: Note[]): number {
  const rh = onsetGroups(notes, "R");
  const lh = onsetGroups(notes, "L");
  let count = 0;
  for (const right of rh) for (const left of lh) {
    if (right.start < left.start + Math.max(...left.notes.map((note) => note.dur))
      && left.start < right.start + Math.max(...right.notes.map((note) => note.dur))) count++;
  }
  return count;
}

function globalMetrics(notes: Note[], tempoBpm: number, durationBeats: number, expectedDurationBeats?: number): GlobalMetrics {
  const valid = cleanNotes(notes);
  const durationSeconds = tempoBpm > 0 ? durationBeats * 60 / tempoBpm : 0;
  const groups = starts(valid);
  const sweep = sweepSimultaneity(valid);
  const rh = valid.filter((note) => handOf(note) === "R");
  const lh = valid.filter((note) => handOf(note) === "L");
  const collision = collisionCount(valid);
  const isolated = valid.filter((note) => note.dur <= ARRANGEMENT_EVALUATION_CONFIG.isolatedDurationBeats
    && (note.start === 0 || !valid.some((other) => other !== note && Math.abs(other.start - note.start) <= ARRANGEMENT_EVALUATION_CONFIG.isolatedGapBeats))).length;
  const repeated = groups.slice(1).filter((start, index) => start - groups[index]! <= ARRANGEMENT_EVALUATION_CONFIG.repeatedGapBeats).length;
  const range = rangeOf(valid);
  const low = valid.length ? Math.min(...valid.map((note) => note.midi)) : null;
  const high = valid.length ? Math.max(...valid.map((note) => note.midi)) : null;
  const handSpanViolations = [rh, lh].reduce((count, handNotes) => {
    const pitches = intervalsForHand(handNotes).pitches;
    return count + pitches.slice(1).filter((pitch, index) => Math.abs(pitch - pitches[index]!) > ARRANGEMENT_EVALUATION_CONFIG.spanViolationSemitones).length;
  }, 0);
  return {
    noteCount: valid.length,
    onsetCount: groups.length,
    notesPerSecond: durationSeconds > 0 ? round(valid.length / durationSeconds) : 0,
    onsetsPerSecond: durationSeconds > 0 ? round(groups.length / durationSeconds) : 0,
    durationBeats: round(durationBeats),
    durationSeconds: round(durationSeconds),
    pitchMin: low,
    pitchMax: high,
    pitchSpan: range.span,
    simultaneity: { max: sweep.max, p50: sweep.quantiles[0]!, p90: sweep.quantiles[1]!, p99: sweep.quantiles[2]!, basis: "sounding-sweep" },
    chromaticOutlier: { value: null, basis: "unavailable", count: null, total: null },
    isolatedShortCount: isolated,
    veryShortCount: valid.filter((note) => note.dur <= ARRANGEMENT_EVALUATION_CONFIG.veryShortBeats).length,
    repeatedAttackRate: groups.length > 1 ? round(repeated / (groups.length - 1)) : 0,
    rhLhCollisionCount: collision,
    rhLhCollisionRate: valid.length ? round(collision / valid.length) : 0,
    handSpanViolations,
    coverage: activeCoverage(valid, durationBeats),
    durationMismatch: expectedDurationBeats === undefined
      ? { value: null, basis: "unavailable" }
      : { value: round(durationBeats - expectedDurationBeats), basis: "expected" },
  };
}

function parserFor(candidate: ArrangementEvaluationCandidate, notes: Note[]): ArrangementEvaluationReport["candidate"]["parser"] {
  const parsed = candidate.parsed;
  const candidateTempo = candidate.tempoBpm ?? parsed?.tempoBpm;
  const candidateDuration = candidate.durationBeats ?? parsed?.durationBeats;
  const candidateDivision = parsed?.division;
  const candidateFormat = parsed?.format;
  const candidateTimeSig = parsed?.timeSig ?? candidate.timeSig;
  const tempoBpm = Number.isFinite(candidateTempo) && candidateTempo! > 0 ? candidateTempo! : 120;
  const durationFallback = Math.max(0, ...notes.filter(finiteNote).map((note) => note.start + note.dur));
  const durationBeats = Number.isFinite(candidateDuration) && candidateDuration! >= 0 ? candidateDuration! : durationFallback;
  const format = Number.isInteger(candidateFormat) && candidateFormat! >= 0 ? candidateFormat! : 1;
  const division = Number.isInteger(candidateDivision) && candidateDivision! > 0 ? candidateDivision! : 480;
  const timeSig: [number, number] = candidateTimeSig && Number.isInteger(candidateTimeSig[0]) && candidateTimeSig[0] > 0
    && Number.isInteger(candidateTimeSig[1]) && candidateTimeSig[1] > 0
    ? [candidateTimeSig[0], candidateTimeSig[1]] : [4, 4];
  return {
    format,
    division,
    tempoBpm,
    durationBeats,
    timeSig,
    noteCount: notes.length,
  };
}

function parserMetadataValid(candidate: ArrangementEvaluationCandidate): boolean {
  const parsed = candidate.parsed;
  const tempo = candidate.tempoBpm ?? parsed?.tempoBpm;
  const duration = candidate.durationBeats ?? parsed?.durationBeats;
  const division = parsed?.division;
  const format = parsed?.format;
  const timeSig = parsed?.timeSig ?? candidate.timeSig;
  return (tempo === undefined || (Number.isFinite(tempo) && tempo > 0))
    && (duration === undefined || (Number.isFinite(duration) && duration >= 0))
    && (division === undefined || (Number.isInteger(division) && division > 0))
    && (format === undefined || (Number.isInteger(format) && format >= 0))
    && (timeSig === undefined || (Array.isArray(timeSig) && timeSig.length === 2
      && Number.isInteger(timeSig[0]) && timeSig[0] > 0 && Number.isInteger(timeSig[1]) && timeSig[1] > 0));
}

function notesFor(source: { parsed?: ParsedMidi; notes?: Note[] }): Note[] {
  return source.notes ?? source.parsed?.notes ?? [];
}

function orderedWindows(windows: EvaluationWindow[]): EvaluationWindow[] {
  return [...windows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    || a.candidate[0] - b.candidate[0] || a.candidate[1] - b.candidate[1]
    || (a.reference?.[0] ?? -1) - (b.reference?.[0] ?? -1));
}

function orderedTrace(trace: ProvenanceTraceInput | undefined): ArrangementEvaluationReport["trace"] {
  if (trace?.status !== "available") return { status: "unavailable" };
  const sortText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  const sortEvents = (events: ProvenanceTraceEvent[] | undefined): ProvenanceTraceEvent[] | undefined => events
    ? [...events].sort((a, b) => sortText(a.key, b.key) || sortText(a.stage ?? "", b.stage ?? "") || sortText(a.source ?? "", b.source ?? ""))
    : undefined;
  const windows = trace.windows
    ? Object.fromEntries(Object.entries(trace.windows).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, events]) => [id, sortEvents(events)!]))
    : undefined;
  return { status: "available", events: sortEvents(trace.events), windows };
}

function guitarMetrics(notes: Note[], candidate: ArrangementEvaluationCandidate, input: ArrangementEvaluationInput): GuitarEvaluationMetrics {
  const d = input.guitarDiagnostics ?? candidate.guitarDiagnostics ?? candidate.guitarHarmony;
  const value = (key: string): number | null => {
    const raw = d?.[key as keyof GuitarHarmonyDiagnostics];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  };
  const quality = d?.qualityCounts && typeof d.qualityCounts === "object"
    ? Object.fromEntries(Object.entries(d.qualityCounts).filter(([, count]) => typeof count === "number" && Number.isFinite(count)))
    : {};
  return {
    rawCandidateCount: value("rawCandidateCount"), harmonicGroupCount: value("harmonicGroupCount"), selectedLeadCount: value("selectedLeadCount"),
    recoveredCount: value("recoveredCount") ?? value("recovered"), rejectedCount: value("rejectedCount") ?? value("rejected"),
    recovered: value("recoveredCount") ?? value("recovered"), rejected: value("rejectedCount") ?? value("rejected"),
    rawSourceNotes: value("rawSourceNotes"), leadNotes: value("leadNotes"),
    residualNotes: value("residualNotes"), onsetClusterCount: value("onsetClusterCount"), semanticAttackCount: value("semanticAttackCount"),
    collapsedUnisonOctaveFifth: value("collapsedUnisonOctaveFifth"), rejectedWeakThirds: value("rejectedWeakThirds"), bassSupportedRoots: value("bassSupportedRoots"),
    stabilizedTransitions: value("stabilizedTransitions"), emittedLeftHandEvents: value("emittedLeftHandEvents"), fallbackWindows: value("fallbackWindows"),
    rawGuitarNotes: value("rawGuitarNotes"),
    qualityCounts: quality as Record<string, number>,
    finalRightHandCount: notes.filter((note) => handOf(note) === "R" && note.identitySource === "guitar").length,
    finalLeftHandCount: notes.filter((note) => handOf(note) === "L" && note.identitySource === "guitar").length,
  };
}

function metricBundle(
  notes: Note[],
  tempoBpm: number,
  durationBeats: number,
  candidate: ArrangementEvaluationCandidate,
  input: ArrangementEvaluationInput,
  expectedDurationBeats?: number,
): MetricBundle {
  const durationSeconds = tempoBpm > 0 ? durationBeats * 60 / tempoBpm : 0;
  const right = notes.filter((note) => handOf(note) === "R");
  const left = notes.filter((note) => handOf(note) === "L");
  const transition = sourceTransitions(notes);
  const sectionSource: Record<string, SourceCounts> = { full: sourceCounts(notes) };
  return {
    global: globalMetrics(notes, tempoBpm, durationBeats, expectedDurationBeats),
    rightHand: handMetrics(right, durationSeconds),
    leftHand: leftHandMetrics(left, durationSeconds),
    guitar: guitarMetrics(notes, candidate, input),
    source: {
      final: { all: sourceCounts(notes), right: sourceCounts(right), left: sourceCounts(left) },
      transitions: transition.transitions,
      rapidTransitions: transition.rapid,
      vocalFinalCount: notes.filter((note) => note.identitySource === "vocals").length,
      bassFinalCount: null,
      drumDerivedPitchCount: notes.filter((note) => Boolean((note as AnyNote).isDrum || (note as AnyNote).drum)).length,
      unknownProvenanceCount: notes.filter((note) => !note.identitySource).length,
      sectionSourceCounts: sectionSource,
    },
  };
}

function variantDurationBeats(variant: Variant): number {
  const measureEnd = variant.measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0);
  if (Number.isFinite(measureEnd) && measureEnd > 0) return measureEnd;
  return Math.max(0, ...variant.notes.filter(finiteNote).map((note) => note.start + note.dur));
}

function variantMetrics(variant: Variant, input: ArrangementEvaluationInput): VariantEvaluationMetrics {
  const durationBeats = variantDurationBeats(variant);
  // A semantic guitar pass is performed before variant construction.  Do not
  // repeat its canonical diagnostics for every learner level; the per-level
  // guitar bundle below reports final tagged RH/LH counts and nulls the
  // unavailable upstream fields.
  const candidate: ArrangementEvaluationCandidate = {
    selector: `variant:${variant.level}`,
    notes: variant.notes,
    tempoBpm: variant.tempoBpm,
    durationBeats,
    timeSig: variant.timeSig,
  };
  const variantInput: ArrangementEvaluationInput = { ...input, candidate, guitarDiagnostics: undefined };
  const bundle = metricBundle(variant.notes, variant.tempoBpm, durationBeats, candidate, variantInput);
  return {
    level: variant.level,
    difficultyScore: variant.difficultyScore,
    tempoBpm: variant.tempoBpm,
    timeSig: [...variant.timeSig] as [number, number],
    ...bundle,
  };
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return precision === 0 && recall === 0 ? 0 : null;
  return round(2 * precision * recall / (precision + recall));
}

function compareReferenceWindow(candidate: Note[], reference: Note[], window: EvaluationWindow): ReferenceWindowMetrics {
  const [cStart, cEnd] = window.candidate;
  // A reference comparison is never allowed to infer an offset or silently
  // compare the candidate window to itself.  Callers must provide both sides.
  if (!window.reference) throw new Error(`reference bounds missing for window ${window.id}`);
  const [rStart, rEnd] = window.reference;
  const c = cleanNotes(candidate).filter((note) => note.start >= cStart && note.start < cEnd);
  const r = cleanNotes(reference).filter((note) => note.start >= rStart && note.start < rEnd);
  const cGroups = onsetGroups(c);
  const rGroups = onsetGroups(r);
  const usedGroups = new Set<number>();
  const matchedGroups: Array<{ candidate: AnyNote[]; reference: AnyNote[]; error: number }> = [];
  const errors: number[] = [];
  let matchedOnsets = 0;
  for (const group of cGroups) {
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < rGroups.length; index++) {
      if (usedGroups.has(index)) continue;
      // Windows may intentionally carry a known bar/phrase offset (for
      // example a generated intro beginning four beats later).  Compare
      // positions relative to each explicit window, never absolute song
      // coordinates, while still refusing any unannotated scaling/offset.
      const distance = Math.abs((group.start - cStart) - (rGroups[index]!.start - rStart));
      if (distance <= ARRANGEMENT_EVALUATION_CONFIG.referenceOnsetToleranceBeats + 1e-9 && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best >= 0) {
      usedGroups.add(best);
      matchedOnsets++;
      errors.push(bestDistance);
      matchedGroups.push({ candidate: group.notes, reference: rGroups[best]!.notes, error: bestDistance });
    }
  }
  const pairMatches = (pitchClass: boolean): number => {
    let count = 0;
    for (const pair of matchedGroups) {
      const consumed = new Set<number>();
      const candidateNotes = [...pair.candidate].sort((a, b) => a.midi - b.midi || a.start - b.start || a.dur - b.dur);
      const referenceNotes = [...pair.reference].sort((a, b) => a.midi - b.midi || a.start - b.start || a.dur - b.dur);
      for (const note of candidateNotes) {
        const index = referenceNotes.findIndex((other, refIndex) => !consumed.has(refIndex)
          && (pitchClass ? ((note.midi - other.midi) % 12 + 12) % 12 === 0 : note.midi === other.midi));
        if (index >= 0) {
          consumed.add(index);
          count++;
        }
      }
    }
    return count;
  };
  const exactMatches = pairMatches(false);
  const classMatches = pairMatches(true);
  const exactPrecision = c.length ? round(exactMatches / c.length) : null;
  const exactRecall = r.length ? round(exactMatches / r.length) : null;
  const classPrecision = c.length ? round(classMatches / c.length) : null;
  const classRecall = r.length ? round(classMatches / r.length) : null;
  const cPitches = cGroups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
  const rPitches = rGroups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
  const cIntervals = cPitches.slice(1).map((pitch, index) => Math.abs(pitch - cPitches[index]!));
  const rIntervals = rPitches.slice(1).map((pitch, index) => Math.abs(pitch - rPitches[index]!));
  const directionLength = Math.min(cPitches.length, rPitches.length) - 1;
  let directionMatches = 0;
  for (let index = 1; index <= directionLength; index++) {
    if (Math.sign(cPitches[index]! - cPitches[index - 1]!) === Math.sign(rPitches[index]! - rPitches[index - 1]!)) directionMatches++;
  }
  const cStarts = cGroups.map((group) => group.start);
  const rStarts = rGroups.map((group) => group.start);
  const cIoi = cStarts.slice(1).map((start, index) => start - cStarts[index]!);
  const rIoi = rStarts.slice(1).map((start, index) => start - rStarts[index]!);
  return {
    candidateBounds: window.candidate,
    referenceBounds: [rStart, rEnd],
    candidateOnsetCount: cGroups.length,
    referenceOnsetCount: rGroups.length,
    candidateNoteCount: c.length,
    referenceNoteCount: r.length,
    matchedOnsets,
    exactPitchMatches: exactMatches,
    pitchClassMatches: classMatches,
    onsetErrorBeats: { median: quantile(errors, 0.5), p90: quantile(errors, 0.9) },
    exactPitch: { precision: exactPrecision, recall: exactRecall, f1: f1(exactPrecision, exactRecall) },
    pitchClass: { precision: classPrecision, recall: classRecall, f1: f1(classPrecision, classRecall) },
    contour: { p95Leap: quantile(cIntervals, 0.95), directionAgreement: directionLength > 0 ? round(directionMatches / directionLength) : null },
    ioi: { candidateMedian: quantile(cIoi, 0.5), referenceMedian: quantile(rIoi, 0.5) },
    density: { candidate: round(cGroups.length / Math.max(1e-9, cEnd - cStart)), reference: round(rGroups.length / Math.max(1e-9, rEnd - rStart)) },
  };
}

function referenceEvaluation(candidate: Note[], reference: ArrangementEvaluationReference | undefined, candidateParser: ArrangementEvaluationReport["candidate"]["parser"], windows: EvaluationWindow[]): ReferenceEvaluation | undefined {
  if (!reference) return undefined;
  const refNotes = notesFor(reference);
  const referenceWindows = orderedWindows(reference.windows ?? windows);
  if (!referenceWindows.length || referenceWindows.some((window) => !window.reference)) return {
    status: "alignment-required", referenceHash: reference.bytes ? sha256Hex(reference.bytes) : null, referenceSelector: reference.selector ? basename(reference.selector) : null,
    aliasOf: reference.aliasOf ?? null,
    windows: [], matchedOnsets: 0, exactPitch: { precision: null, recall: null, f1: null }, pitchClass: { precision: null, recall: null, f1: null }, alignmentCoverageBars: 0,
    diagnostics: ["explicit candidate/reference windows are required; no automatic offset or time scaling was applied"],
  };
  const resultWindows = referenceWindows.map((window) => ({ id: window.id, ...(window.anchorId ? { anchorId: window.anchorId } : {}), ...compareReferenceWindow(candidate, refNotes, window) }));
  // Coverage is the comparable span, not the whole candidate span.  A long
  // candidate window paired with a short reference window must not inflate the
  // "bars covered" claim used by the strict reference gate.
  const alignedBeats = resultWindows.reduce((sum, window) => {
    const candidateBeats = Math.max(0, window.candidateBounds[1] - window.candidateBounds[0]);
    const referenceBeats = Math.max(0, window.referenceBounds[1] - window.referenceBounds[0]);
    return sum + Math.min(candidateBeats, referenceBeats);
  }, 0);
  const matched = resultWindows.reduce((sum, window) => sum + window.matchedOnsets, 0);
  const candidateExactMatches = resultWindows.reduce((sum, window) => sum + window.exactPitchMatches, 0);
  const referenceExactMatches = candidateExactMatches;
  const candidateClassMatches = resultWindows.reduce((sum, window) => sum + window.pitchClassMatches, 0);
  const referenceClassMatches = candidateClassMatches;
  const candidateNoteCount = resultWindows.reduce((sum, window) => sum + window.candidateNoteCount, 0);
  const referenceNoteCount = resultWindows.reduce((sum, window) => sum + window.referenceNoteCount, 0);
  const exactPrecision = candidateNoteCount ? round(candidateExactMatches / candidateNoteCount) : null;
  const exactRecall = referenceNoteCount ? round(referenceExactMatches / referenceNoteCount) : null;
  const classPrecision = candidateNoteCount ? round(candidateClassMatches / candidateNoteCount) : null;
  const classRecall = referenceNoteCount ? round(referenceClassMatches / referenceNoteCount) : null;
  const bars = alignedBeats / 4;
  const enough = resultWindows.length >= ARRANGEMENT_EVALUATION_CONFIG.minimumReferenceWindows && bars >= ARRANGEMENT_EVALUATION_CONFIG.minimumReferenceBars;
  return {
    status: enough ? "aligned" : "insufficient-coverage",
    referenceHash: reference.bytes ? sha256Hex(reference.bytes) : null,
    referenceSelector: reference.selector ? basename(reference.selector) : null,
    aliasOf: reference.aliasOf ?? null,
    windows: resultWindows,
    matchedOnsets: matched,
    exactPitch: { precision: exactPrecision, recall: exactRecall, f1: f1(exactPrecision, exactRecall) },
    pitchClass: { precision: classPrecision, recall: classRecall, f1: f1(classPrecision, classRecall) },
    alignmentCoverageBars: round(bars),
    diagnostics: enough ? [] : [`reference coverage is ${resultWindows.length} windows / ${round(bars)} bars; strict comparison requires at least 3 windows and 32 bars`],
  };
}

function qualityGate(
  notes: Note[],
  parser: ArrangementEvaluationReport["candidate"]["parser"],
  variants: Variant[] | undefined,
  mode: ArrangementEvaluationInput["mode"],
  parserValid = true,
  referenceStatus?: ReferenceEvaluation["status"],
): GateResult {
  const failures: string[] = [];
  const evaluated = ["finite MIDI notes", "finite parser metadata", "sounding simultaneity", "piano range", "drum-derived pitch count"];
  const invalid = notes.filter((note) => !finiteNote(note)).length;
  if (invalid) failures.push(`${invalid} non-finite or invalid MIDI notes`);
  if (!parserValid) failures.push("parser metadata contains non-finite or invalid values");
  const valid = cleanNotes(notes);
  const sim = sweepSimultaneity(valid).max;
  if (sim > 8) failures.push(`max sounding simultaneity ${sim} exceeds 8`);
  const outsidePiano = valid.filter((note) => note.midi < 21 || note.midi > 108).length;
  if (outsidePiano) failures.push(`${outsidePiano} notes outside piano range 21-108`);
  const drums = valid.filter((note) => Boolean((note as AnyNote).isDrum || (note as AnyNote).drum)).length;
  if (drums) failures.push(`${drums} drum-derived pitches present`);
  if (variants) {
    evaluated.push("variant validation", "variant monotonicity");
    if (!variants.length) failures.push("variant list is empty");
    for (const variant of variants) if (!variant.notes.length) failures.push(`${variant.level} variant has no notes`);
    failures.push(...validateVariants(variants), ...verifyMonotonicity(variants));
  } else evaluated.push("variant validation unavailable (candidate-only)", "variant monotonicity unavailable (candidate-only)");
  const selectedMode = mode ?? "structural";
  let status: GateResult["status"] = failures.length ? "fail" : "pass";
  if (selectedMode === "human") status = "null";
  else if (selectedMode === "reference" && referenceStatus !== "aligned") {
    evaluated.push(`reference alignment unavailable (${referenceStatus ?? "not supplied"})`);
    // A reference report without enough explicit, aligned coverage is a
    // diagnostic, not a passing reference gate. Preserve structural failures
    // as hard failures when they exist.
    if (status === "pass") status = "null";
  } else if (selectedMode === "reference") evaluated.push("reference alignment");
  return {
    mode: selectedMode,
    status,
    failures,
    evaluated,
    thresholds: { maxSimultaneity: 8, pianoMin: 21, pianoMax: 108, onsetToleranceBeats: ARRANGEMENT_EVALUATION_CONFIG.onsetToleranceBeats },
    availability: { variants: variants ? "evaluated" : "unavailable" },
  };
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key === "generatedAt" || key === "path" || key === "absolutePath") return undefined;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[objectKey], objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }
  return value;
}

/** Stable JSON used for determinism checks; timestamps and absolute paths are never emitted. */
export function canonicalEvaluationJson(report: ArrangementEvaluationReport): string {
  return JSON.stringify(canonicalize(report));
}

export function evaluateArrangement(input: ArrangementEvaluationInput): ArrangementEvaluationReport {
  const candidateNotes = notesFor(input.candidate);
  const parser = parserFor(input.candidate, candidateNotes);
  const windows = orderedWindows(input.windows ?? input.reference?.windows ?? []);
  const bundle = metricBundle(candidateNotes, parser.tempoBpm, parser.durationBeats, input.candidate, input, input.expectedDurationBeats);
  const variants: Record<string, VariantEvaluationMetrics> = {};
  for (const variant of input.variants ?? []) variants[variant.level] = variantMetrics(variant, input);
  const sections: Record<string, SectionEvaluationMetrics> = {};
  for (const window of windows) {
    const sectionNotes = cleanNotes(candidateNotes).filter((note) => note.start >= window.candidate[0] && note.start < window.candidate[1]);
    const sectionBundle = metricBundle(sectionNotes, parser.tempoBpm, window.candidate[1] - window.candidate[0], input.candidate, input);
    sections[window.id] = {
      startBeat: window.candidate[0], endBeat: window.candidate[1], coverage: sectionBundle.global.coverage, global: sectionBundle.global, rightHand: sectionBundle.rightHand, leftHand: sectionBundle.leftHand,
      source: sectionBundle.source.final.all, guitar: { finalRightHandCount: sectionBundle.guitar.finalRightHandCount, finalLeftHandCount: sectionBundle.guitar.finalLeftHandCount },
      ...(input.reference && window.reference ? { reference: compareReferenceWindow(candidateNotes, notesFor(input.reference), window) } : {}),
    };
  }
  for (const [id, section] of Object.entries(sections)) bundle.source.sectionSourceCounts[id] = section.source;
  const referenceReport = input.reference ? referenceEvaluation(candidateNotes, input.reference, parser, windows) : undefined;
  const reportWithoutDeterminism: Omit<ArrangementEvaluationReport, "determinism"> = {
    schemaVersion: 1,
    config: ARRANGEMENT_EVALUATION_CONFIG,
    fixture: input.fixture,
    candidate: { selector: basename(input.candidate.selector), ...(input.candidate.revision ? { revision: input.candidate.revision } : {}), bytes: input.candidate.bytes?.byteLength ?? null, sha256: input.candidate.bytes ? sha256Hex(input.candidate.bytes) : null, parser },
    metrics: { ...bundle, sections, variants },
    ...(referenceReport ? { reference: referenceReport } : {}),
    trace: orderedTrace(input.trace),
    gate: qualityGate(candidateNotes, parser, input.variants, input.mode, parserMetadataValid(input.candidate), referenceReport?.status),
  };
  const canonical = canonicalEvaluationJson(reportWithoutDeterminism as ArrangementEvaluationReport);
  return { ...reportWithoutDeterminism, determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(canonical)) } };
}

/** Convenience form for callers that already have notes and parser metadata. */
export function evaluateArrangementNotes(
  notes: Note[],
  metadata: Omit<ArrangementEvaluationInput, "candidate"> & { candidate?: Partial<ArrangementEvaluationCandidate> },
): ArrangementEvaluationReport {
  return evaluateArrangement({ ...metadata, candidate: { selector: metadata.candidate?.selector ?? "in-memory", ...metadata.candidate, notes } });
}

export function compareArrangementReference(candidate: Note[], reference: Note[], window: EvaluationWindow): ReferenceWindowMetrics {
  return compareReferenceWindow(candidate, reference, window);
}
