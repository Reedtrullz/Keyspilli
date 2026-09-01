import { createHash } from "node:crypto";

/** Pure metrics for comparing raw audio-to-MIDI routes against external truth. */
export const UPSTREAM_ATTRIBUTION_SCHEMA_VERSION = 1 as const;

export type UpstreamRouteStatus = "available" | "unavailable" | "malformed" | "failed" | "timeout";
export type UpstreamDecision =
  | "TRANSCRIPTION_LIMITED"
  | "TIMBRE_LIMITED"
  | "MIXTURE_INTERFERENCE_LIMITED"
  | "SEPARATION_LIMITED"
  | "MULTIPLE";

export interface UpstreamNote {
  midi: number;
  start: number;
  dur: number;
  string?: number;
  fret?: number;
  technique?: string;
  sourceIndex: number;
}

export interface UpstreamNoteInput {
  midi?: unknown;
  pitch?: unknown;
  start?: unknown;
  onset?: unknown;
  dur?: unknown;
  duration?: unknown;
  string?: unknown;
  fret?: unknown;
  technique?: unknown;
  sourceIndex?: unknown;
}

export interface UpstreamTruthMetadata {
  performanceId?: string;
  technique?: string;
  durationBeats?: number;
  tempoBpm?: number;
  sourceHash?: string;
}

export interface UpstreamTruth {
  schemaVersion: typeof UPSTREAM_ATTRIBUTION_SCHEMA_VERSION;
  notes: UpstreamNote[];
  performanceId: string | null;
  technique: string | null;
  durationBeats: number;
  tempoBpm: number | null;
  sourceHash: string | null;
}

export interface UpstreamCandidateNoteInput extends UpstreamNoteInput {
  unsupported?: unknown;
}

export interface UpstreamRouteCandidate {
  id?: string;
  route?: string;
  status?: UpstreamRouteStatus | null;
  notes?: readonly UpstreamCandidateNoteInput[];
  durationBeats?: number;
  durationSeconds?: number;
  tempoBpm?: number;
  sourceHash?: string;
  configHash?: string;
  [key: string]: unknown;
}

export interface UpstreamEvaluationOptions {
  onsetToleranceBeats?: number;
  durationToleranceBeats?: number;
}

export interface UpstreamMetric {
  matches: number;
  predictedCount: number;
  truthCount: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface UpstreamDurationMetrics {
  matched: number;
  withinTolerance: number;
  meanAbsoluteErrorBeats: number | null;
  medianAbsoluteErrorBeats: number | null;
  maxAbsoluteErrorBeats: number | null;
}

export interface UpstreamOnsetResidualMetrics {
  matched: number;
  meanAbsoluteBeats: number | null;
  medianAbsoluteBeats: number | null;
  maxAbsoluteBeats: number | null;
}

export interface UpstreamUnsupportedMetrics {
  count: number;
  rate: number | null;
  perSecond: number | null;
}

export interface UpstreamTechniqueMetrics {
  truthCount: number;
  onset: UpstreamMetric;
  exactPitch: UpstreamMetric;
  pitchClass: UpstreamMetric;
  octaveDisplaced: UpstreamMetric;
  duration: UpstreamDurationMetrics;
}

export interface UpstreamRouteMetrics {
  schemaVersion: typeof UPSTREAM_ATTRIBUTION_SCHEMA_VERSION;
  route: string;
  status: UpstreamRouteStatus | null;
  sourceHash: string | null;
  configHash: string | null;
  truthNoteCount: number | null;
  candidateNoteCount: number | null;
  durationBeats: number | null;
  durationSeconds: number | null;
  onset: UpstreamMetric;
  exactPitch: UpstreamMetric;
  /** Short aliases are retained for report consumers using the metric names from the experiment plan. */
  exact: UpstreamMetric;
  pitchClass: UpstreamMetric;
  pc: UpstreamMetric;
  octave: UpstreamMetric;
  octaveDisplaced: UpstreamMetric;
  onsetResidual: UpstreamOnsetResidualMetrics;
  duration: UpstreamDurationMetrics;
  unsupported: UpstreamUnsupportedMetrics;
  unsupportedPerSecond: number | null;
  candidateDensity: { perBeat: number | null; perSecond: number | null };
  candidateDensityPerSecond: number | null;
  octaveFlips: { count: number | null; rate: number | null };
  techniques: Record<string, UpstreamTechniqueMetrics>;
}

export interface UpstreamLossDecomposition {
  transcriptionFloor: number | null;
  timbreLoss: number | null;
  mixtureLoss: number | null;
  separatorRecovery: number | null;
  separatorLoss: number | null;
  residualGap: number | null;
}

export interface UpstreamAttributionReport {
  schemaVersion: typeof UPSTREAM_ATTRIBUTION_SCHEMA_VERSION;
  truth: UpstreamTruth;
  routes: UpstreamRouteMetrics[];
  loss: UpstreamLossDecomposition;
  /** Alias for callers that name this section explicitly. */
  lossDecomposition: UpstreamLossDecomposition;
  decisions: UpstreamDecision[];
  decision: UpstreamDecision | null;
}

interface CandidateNote extends UpstreamNote {
  unsupported: boolean;
}

interface NotePair {
  truth: UpstreamNote;
  candidate: CandidateNote;
}

const EPS = 1e-9;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function noteOrder(left: UpstreamNote, right: UpstreamNote): number {
  return left.start - right.start || left.midi - right.midi || left.dur - right.dur
    || compareText(left.technique ?? "", right.technique ?? "") || left.sourceIndex - right.sourceIndex;
}

function round(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function metric(predictedCount: number, truthCount: number, matches: number): UpstreamMetric {
  const precision = predictedCount ? matches / predictedCount : null;
  const recall = truthCount ? matches / truthCount : null;
  const f1 = precision === null && recall === null ? null : precision === null || recall === null ? 0 : precision + recall > EPS
    ? (2 * precision * recall) / (precision + recall)
    : 0;
  return {
    matches,
    predictedCount,
    truthCount,
    precision,
    recall,
    f1,
  };
}

function emptyMetric(): UpstreamMetric {
  return metric(0, 0, 0);
}

function emptyDuration(): UpstreamDurationMetrics {
  return { matched: 0, withinTolerance: 0, meanAbsoluteErrorBeats: null, medianAbsoluteErrorBeats: null, maxAbsoluteErrorBeats: null };
}

function emptyResidual(): UpstreamOnsetResidualMetrics {
  return { matched: 0, meanAbsoluteBeats: null, medianAbsoluteBeats: null, maxAbsoluteBeats: null };
}

function invalidTruthNote(value: unknown, index: number, reason = "fields"): never {
  throw new Error(`invalid upstream truth note ${reason} at index ${index}`);
}

function noteValue(value: UpstreamNoteInput, keys: readonly string[]): unknown {
  for (const key of keys) if (value[key as keyof UpstreamNoteInput] !== undefined) return value[key as keyof UpstreamNoteInput];
  return undefined;
}

function readStrictTruthNote(value: unknown, sourceIndex: number): UpstreamNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidTruthNote(value, sourceIndex);
  const input = value as UpstreamNoteInput;
  const midi = noteValue(input, ["midi", "pitch"]);
  const start = noteValue(input, ["start", "onset"]);
  const dur = noteValue(input, ["dur", "duration"]);
  if (!finite(midi) || !Number.isInteger(midi) || midi < 0 || midi > 127) return invalidTruthNote(value, sourceIndex, "midi");
  if (!finite(start) || start < 0) return invalidTruthNote(value, sourceIndex, "start");
  if (!finite(dur) || dur <= 0) return invalidTruthNote(value, sourceIndex, "duration");
  const suppliedIndex = input.sourceIndex;
  if (suppliedIndex !== undefined && (!finite(suppliedIndex) || !Number.isInteger(suppliedIndex) || suppliedIndex < 0)) return invalidTruthNote(value, sourceIndex, "sourceIndex");
  const result: UpstreamNote = { midi, start, dur, sourceIndex: suppliedIndex ?? sourceIndex };
  for (const key of ["string", "fret"] as const) {
    const item = input[key];
    if (item !== undefined && (!finite(item) || !Number.isInteger(item) || item < 0)) return invalidTruthNote(value, sourceIndex, key);
    if (item !== undefined) result[key] = item;
  }
  if (input.technique !== undefined && (typeof input.technique !== "string" || !input.technique.trim())) return invalidTruthNote(value, sourceIndex, "technique");
  if (typeof input.technique === "string") result.technique = input.technique.trim();
  return result;
}

/** Normalize external MIDI labels. Invalid truth is an error; it is never silently repaired. */
export function normalizeUpstreamTruth(notes: readonly UpstreamNoteInput[], metadata: UpstreamTruthMetadata = {}): UpstreamTruth {
  if (!Array.isArray(notes)) throw new Error("upstream truth notes must be an array");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("upstream truth metadata must be an object");
  const normalizedInput = notes.map((note, index) => readStrictTruthNote(note, index));
  // A performance-level technique label is the only annotation available for
  // many Guitar-TECHS MIDI files. Apply it to otherwise-unlabelled notes so
  // per-technique metrics remain meaningful while preserving explicit labels.
  const performanceTechnique = typeof metadata.technique === "string" && metadata.technique.trim()
    ? metadata.technique.trim()
    : undefined;
  if (performanceTechnique) {
    for (const note of normalizedInput) if (!note.technique) note.technique = performanceTechnique;
  }
  const hasSuppliedSourceIndex = notes.some((note) => note && typeof note === "object" && !Array.isArray(note) && (note as UpstreamNoteInput).sourceIndex !== undefined);
  const normalized = normalizedInput.sort(noteOrder).map((note, index) => hasSuppliedSourceIndex ? note : { ...note, sourceIndex: index });
  const lastEnd = normalized.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  if (metadata.durationBeats !== undefined && (!finite(metadata.durationBeats) || metadata.durationBeats < lastEnd)) throw new Error("upstream truth durationBeats must cover all notes");
  if (metadata.tempoBpm !== undefined && (!finite(metadata.tempoBpm) || metadata.tempoBpm <= 0)) throw new Error("upstream truth tempoBpm must be positive");
  if (metadata.performanceId !== undefined && (typeof metadata.performanceId !== "string" || !metadata.performanceId.trim())) throw new Error("upstream truth performanceId must be a non-empty string");
  if (metadata.technique !== undefined && (typeof metadata.technique !== "string" || !metadata.technique.trim())) throw new Error("upstream truth technique must be a non-empty string");
  if (metadata.sourceHash !== undefined && (typeof metadata.sourceHash !== "string" || !metadata.sourceHash.trim())) throw new Error("upstream truth sourceHash must be a non-empty string");
  return {
    schemaVersion: UPSTREAM_ATTRIBUTION_SCHEMA_VERSION,
    notes: normalized,
    performanceId: metadata.performanceId?.trim() ?? null,
    technique: metadata.technique?.trim() ?? null,
    durationBeats: metadata.durationBeats ?? lastEnd,
    tempoBpm: metadata.tempoBpm ?? null,
    sourceHash: metadata.sourceHash?.trim() ?? null,
  };
}

function readCandidateNotes(value: readonly UpstreamCandidateNoteInput[]): { notes: CandidateNote[]; malformed: boolean } {
  if (!Array.isArray(value)) return { notes: [], malformed: true };
  const notes: CandidateNote[] = [];
  for (let sourceIndex = 0; sourceIndex < value.length; sourceIndex += 1) {
    const raw = value[sourceIndex];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { notes: [], malformed: true };
    const input = raw as UpstreamCandidateNoteInput;
    const midi = noteValue(input, ["midi", "pitch"]);
    const start = noteValue(input, ["start", "onset"]);
    const dur = noteValue(input, ["dur", "duration"]);
    if (!finite(start) || start < 0 || !finite(dur) || dur <= 0) return { notes: [], malformed: true };
    const unsupported = input.unsupported === true || !finite(midi) || !Number.isInteger(midi) || midi < 0 || midi > 127;
    const result: CandidateNote = { midi: finite(midi) ? midi : -1, start, dur, sourceIndex, unsupported };
    if (typeof input.technique === "string" && input.technique.trim()) result.technique = input.technique.trim();
    notes.push(result);
  }
  return { notes, malformed: false };
}

function pairNotes(
  truth: readonly UpstreamNote[],
  candidates: readonly CandidateNote[],
  predicate: (truth: UpstreamNote, candidate: CandidateNote) => boolean,
): NotePair[] {
  const edges = truth.map((expected) => candidates
    .map((candidate, index) => ({ index, distance: Math.abs(expected.start - candidate.start) }))
    .filter(({ index }) => predicate(expected, candidates[index]!))
    .sort((left, right) => left.distance - right.distance || left.index - right.index));
  const owners = new Array<number>(candidates.length).fill(-1);
  const assigned = new Array<number>(truth.length).fill(-1);
  const visit = (truthIndex: number, seen: Set<number>): boolean => {
    for (const edge of edges[truthIndex] ?? []) {
      if (seen.has(edge.index)) continue;
      seen.add(edge.index);
      if (owners[edge.index] === -1 || visit(owners[edge.index]!, seen)) {
        owners[edge.index] = truthIndex;
        assigned[truthIndex] = edge.index;
        return true;
      }
    }
    return false;
  };
  for (let index = 0; index < truth.length; index += 1) visit(index, new Set());
  return assigned.map((candidateIndex, truthIndex) => candidateIndex < 0 ? null : {
    truth: truth[truthIndex]!, candidate: candidates[candidateIndex]!,
  }).filter((pair): pair is NotePair => pair !== null);
}

function residual(values: readonly number[]): UpstreamOnsetResidualMetrics {
  if (!values.length) return emptyResidual();
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted[(sorted.length - 1) / 2] ?? 0);
  const median = Number.isInteger((sorted.length - 1) / 2)
    ? middle
    : ((sorted[Math.floor(sorted.length / 2) - 1] ?? 0) + (sorted[Math.ceil(sorted.length / 2) - 1] ?? 0)) / 2;
  return {
    matched: values.length,
    meanAbsoluteBeats: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    medianAbsoluteBeats: round(median),
    maxAbsoluteBeats: round(sorted.at(-1) ?? 0),
  };
}

function durationMetrics(pairs: readonly NotePair[], tolerance: number): UpstreamDurationMetrics {
  if (!pairs.length) return emptyDuration();
  const errors = pairs.map((pair) => Math.abs(pair.truth.dur - pair.candidate.dur));
  const sorted = [...errors].sort((a, b) => a - b);
  const middle = (sorted[(sorted.length - 1) / 2] ?? 0);
  const median = Number.isInteger((sorted.length - 1) / 2)
    ? middle
    : ((sorted[Math.floor(sorted.length / 2) - 1] ?? 0) + (sorted[Math.ceil(sorted.length / 2) - 1] ?? 0)) / 2;
  return {
    matched: pairs.length,
    withinTolerance: errors.filter((error) => error <= tolerance + EPS).length,
    meanAbsoluteErrorBeats: round(errors.reduce((sum, value) => sum + value, 0) / errors.length),
    medianAbsoluteErrorBeats: round(median),
    maxAbsoluteErrorBeats: round(sorted.at(-1) ?? 0),
  };
}

function techniqueMetrics(
  truth: readonly UpstreamNote[],
  candidates: readonly CandidateNote[],
  onsetTolerance: number,
  durationTolerance: number,
): Record<string, UpstreamTechniqueMetrics> {
  const names = [...new Set(truth.map((note) => note.technique ?? "unknown"))].sort(compareText);
  const result: Record<string, UpstreamTechniqueMetrics> = {};
  for (const name of names) {
    const expected = truth.filter((note) => (note.technique ?? "unknown") === name);
    const expectedCandidates = candidates.filter((candidate) => !candidate.technique || candidate.technique === name);
    const onsetPairs = pairNotes(expected, expectedCandidates, (left, right) => Math.abs(left.start - right.start) <= onsetTolerance + EPS);
    const exactPairs = pairNotes(expected, expectedCandidates, (left, right) => left.midi === right.midi && Math.abs(left.start - right.start) <= onsetTolerance + EPS);
    const pcPairs = pairNotes(expected, expectedCandidates, (left, right) => left.midi % 12 === right.midi % 12 && Math.abs(left.start - right.start) <= onsetTolerance + EPS);
    const displacedPairs = pairNotes(expected, expectedCandidates, (left, right) => left.midi !== right.midi && Math.abs(left.midi - right.midi) % 12 === 0 && Math.abs(left.start - right.start) <= onsetTolerance + EPS);
    result[name] = {
      truthCount: expected.length,
      onset: metric(expectedCandidates.length, expected.length, onsetPairs.length),
      exactPitch: metric(expectedCandidates.length, expected.length, exactPairs.length),
      pitchClass: metric(expectedCandidates.length, expected.length, pcPairs.length),
      octaveDisplaced: metric(expectedCandidates.length, expected.length, displacedPairs.length),
      duration: durationMetrics(onsetPairs, durationTolerance),
    };
  }
  return result;
}

function unavailableMetrics(route: string, status: UpstreamRouteStatus | null, sourceHash: string | null, configHash: string | null): UpstreamRouteMetrics {
  const metricValue = emptyMetric();
  const duration = emptyDuration();
  return {
    schemaVersion: UPSTREAM_ATTRIBUTION_SCHEMA_VERSION, route, status, sourceHash, configHash,
    truthNoteCount: null, candidateNoteCount: null, durationBeats: null, durationSeconds: null,
    onset: metricValue, exactPitch: metricValue, exact: metricValue, pitchClass: metricValue, pc: metricValue,
    octave: metricValue, octaveDisplaced: metricValue, onsetResidual: emptyResidual(), duration,
    unsupported: { count: 0, rate: null, perSecond: null }, unsupportedPerSecond: null,
    candidateDensity: { perBeat: null, perSecond: null }, candidateDensityPerSecond: null,
    octaveFlips: { count: null, rate: null }, techniques: {},
  };
}

/** Score raw route notes. Unsupported pitches are counted but never matched. */
export function evaluateUpstreamRoute(
  truth: UpstreamTruth,
  candidate: UpstreamRouteCandidate | readonly UpstreamCandidateNoteInput[] | null | undefined,
  options: UpstreamEvaluationOptions = {},
): UpstreamRouteMetrics {
  if (!truth || !Array.isArray(truth.notes)) throw new Error("upstream truth is required");
  let input: UpstreamRouteCandidate | undefined;
  if (Array.isArray(candidate)) input = { notes: candidate as readonly UpstreamCandidateNoteInput[] };
  else input = candidate as UpstreamRouteCandidate | null | undefined ?? undefined;
  const route = typeof input?.route === "string" && input.route.trim() ? input.route.trim() : "unknown";
  const status = input?.status === undefined ? "available" : input.status;
  const sourceHash = typeof input?.sourceHash === "string" ? input.sourceHash : null;
  const configHash = typeof input?.configHash === "string" ? input.configHash : null;
  if (status !== null && !["available", "unavailable", "malformed", "failed", "timeout"].includes(status)) return unavailableMetrics(route, "malformed", sourceHash, configHash);
  if (status !== "available") return unavailableMetrics(route, status ?? null, sourceHash, configHash);
  const rawNotes = input?.notes ?? [];
  const parsed = readCandidateNotes(rawNotes);
  if (parsed.malformed) return unavailableMetrics(route, "malformed", sourceHash, configHash);
  const candidates = parsed.notes.filter((note) => !note.unsupported).sort(noteOrder);
  const onsetTolerance = options.onsetToleranceBeats ?? 0.05;
  const durationTolerance = options.durationToleranceBeats ?? 0.25;
  if (!finite(onsetTolerance) || onsetTolerance < 0 || !finite(durationTolerance) || durationTolerance < 0) throw new Error("upstream evaluation tolerances must be non-negative");
  const onsetPairs = pairNotes(truth.notes, candidates, (expected, actual) => Math.abs(expected.start - actual.start) <= onsetTolerance + EPS);
  const exactPairs = pairNotes(truth.notes, candidates, (expected, actual) => expected.midi === actual.midi && Math.abs(expected.start - actual.start) <= onsetTolerance + EPS);
  const pcPairs = pairNotes(truth.notes, candidates, (expected, actual) => expected.midi % 12 === actual.midi % 12 && Math.abs(expected.start - actual.start) <= onsetTolerance + EPS);
  const displacedPairs = pairNotes(truth.notes, candidates, (expected, actual) => expected.midi !== actual.midi && Math.abs(expected.midi - actual.midi) % 12 === 0 && Math.abs(expected.start - actual.start) <= onsetTolerance + EPS);
  const durationBeats = input?.durationBeats ?? truth.durationBeats;
  if (!finite(durationBeats) || durationBeats <= 0) return unavailableMetrics(route, "malformed", sourceHash, configHash);
  const tempoBpm = input?.tempoBpm ?? truth.tempoBpm;
  const durationSeconds = input?.durationSeconds ?? (tempoBpm ? durationBeats * 60 / tempoBpm : null);
  if (durationSeconds !== null && (!finite(durationSeconds) || durationSeconds <= 0)) return unavailableMetrics(route, "malformed", sourceHash, configHash);
  const predictedCount = parsed.notes.length;
  const onset = metric(predictedCount, truth.notes.length, onsetPairs.length);
  const exact = metric(predictedCount, truth.notes.length, exactPairs.length);
  const pc = metric(predictedCount, truth.notes.length, pcPairs.length);
  const displaced = metric(predictedCount, truth.notes.length, displacedPairs.length);
  const onsetResidual = residual(onsetPairs.map((pair) => Math.abs(pair.truth.start - pair.candidate.start)));
  const duration = durationMetrics(onsetPairs, durationTolerance);
  const unsupportedCount = parsed.notes.filter((note) => note.unsupported).length;
  const unsupported: UpstreamUnsupportedMetrics = {
    count: unsupportedCount,
    rate: parsed.notes.length ? unsupportedCount / parsed.notes.length : 0,
    perSecond: durationSeconds ? unsupportedCount / durationSeconds : null,
  };
  const candidateDensity = {
    perBeat: durationBeats ? parsed.notes.length / durationBeats : null,
    perSecond: durationSeconds ? parsed.notes.length / durationSeconds : null,
  };
  const techniques = techniqueMetrics(truth.notes, candidates, onsetTolerance, durationTolerance);
  return {
    schemaVersion: UPSTREAM_ATTRIBUTION_SCHEMA_VERSION, route, status: "available", sourceHash, configHash,
    truthNoteCount: truth.notes.length, candidateNoteCount: parsed.notes.length, durationBeats, durationSeconds,
    onset, exactPitch: exact, exact, pitchClass: pc, pc, octave: displaced, octaveDisplaced: displaced,
    onsetResidual, duration, unsupported, candidateDensity,
    unsupportedPerSecond: unsupported.perSecond,
    candidateDensityPerSecond: candidateDensity.perSecond,
    octaveFlips: { count: displacedPairs.length, rate: pcPairs.length ? displacedPairs.length / pcPairs.length : 0 }, techniques,
  };
}

function routeEntries(routes: readonly UpstreamRouteCandidate[] | Record<string, UpstreamRouteCandidate | null | undefined>): Array<{ name: string; candidate: UpstreamRouteCandidate | null }> {
  if (Array.isArray(routes)) {
    const list = routes as readonly UpstreamRouteCandidate[];
    return list.map((candidate, index) => ({ name: candidate.route ?? candidate.id ?? `route-${index}`, candidate }));
  }
  const record = routes as Record<string, UpstreamRouteCandidate | null | undefined>;
  return Object.keys(record).sort(compareText).map((name) => ({ name, candidate: record[name] ?? null }));
}

function routeByNames(routes: readonly UpstreamRouteMetrics[], names: readonly string[]): UpstreamRouteMetrics | undefined {
  return routes.find((route) => {
    const normalized = route.route.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return names.some((name) => {
      const wanted = name.replace(/[^a-z0-9]+/g, "");
      return normalized === wanted || (wanted.length >= 4 && normalized.startsWith(wanted));
    });
  });
}

function subtract(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : round(left - right);
}

/** Compare paired route scores and classify the largest controlled loss signatures. */
export function compareUpstreamRoutes(
  truth: UpstreamTruth,
  routes: readonly UpstreamRouteCandidate[] | Record<string, UpstreamRouteCandidate | null | undefined>,
  options: UpstreamEvaluationOptions = {},
): UpstreamAttributionReport {
  const evaluated = routeEntries(routes).map(({ name, candidate }) => {
    if (candidate === null) return unavailableMetrics(name, null, null, null);
    const result = evaluateUpstreamRoute(truth, { ...candidate, route: candidate.route ?? name }, options);
    return result.route === "unknown" ? { ...result, route: name } : result;
  }).sort((left, right) => compareText(left.route, right.route));
  // Accept the stable descriptive route IDs emitted by the local runner as
  // well as the shorter aliases used by pure callers.
  const di = routeByNames(evaluated, ["di", "di→bp", "di->bp", "dibp", "di-basic-pitch", "direct"]);
  const amp = routeByNames(evaluated, ["amp", "amp/mic", "amp-mic", "amp→bp", "amp->bp", "amp-mic-basic-pitch"]);
  const mixture = routeByNames(evaluated, ["mixture", "direct-mixture", "mixture-basic-pitch", "mix"]);
  const separators = evaluated.filter((route) => {
    const normalized = route.route.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (normalized.includes("demucs") || normalized.includes("bsroformer")) && route.status === "available";
  });
  const separatorScores = separators.map((route) => route.exactPitch.f1).filter((score): score is number => score !== null);
  const bestSeparator = separatorScores.length ? Math.max(...separatorScores) : null;
  const loss: UpstreamLossDecomposition = {
    transcriptionFloor: di?.exactPitch.f1 ?? null,
    timbreLoss: subtract(di?.exactPitch.f1 ?? null, amp?.exactPitch.f1 ?? null),
    mixtureLoss: subtract(amp?.exactPitch.f1 ?? null, mixture?.exactPitch.f1 ?? null),
    separatorRecovery: subtract(bestSeparator, mixture?.exactPitch.f1 ?? null),
    separatorLoss: subtract(mixture?.exactPitch.f1 ?? null, bestSeparator),
    residualGap: subtract(amp?.exactPitch.f1 ?? null, bestSeparator),
  };
  const decisions: UpstreamDecision[] = [];
  if (di?.exactPitch.f1 !== null && di !== undefined && di.exactPitch.f1 < 0.5) decisions.push("TRANSCRIPTION_LIMITED");
  if (loss.timbreLoss !== null && loss.timbreLoss >= 0.2) decisions.push("TIMBRE_LIMITED");
  if (loss.mixtureLoss !== null && loss.mixtureLoss >= 0.2) decisions.push("MIXTURE_INTERFERENCE_LIMITED");
  if (loss.residualGap !== null && loss.residualGap >= 0.2) decisions.push("SEPARATION_LIMITED");
  if (decisions.length > 1) decisions.push("MULTIPLE");
  return {
    schemaVersion: UPSTREAM_ATTRIBUTION_SCHEMA_VERSION,
    truth,
    routes: evaluated,
    loss,
    lossDecomposition: loss,
    decisions,
    decision: decisions.length > 1 ? "MULTIPLE" : decisions[0] ?? null,
  };
}

const PATH_KEY = /path|file|filename|directory|dir|root|cwd|timestamp|generatedat|runtime|command|executable/i;

function redactString(value: string): string {
  if (/^(?:file:\/\/)?\//i.test(value)) return "[redacted-path]";
  return value.replace(/(^|[\s("'=,;\[])(?:file:\/\/)?\/(?!\/)[^\s"'<>;,)]*/gi, (_match, prefix: string) => `${prefix}[redacted-path]`);
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key && PATH_KEY.test(key)) return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item)).filter((item) => item !== undefined);
    if (key === "routes") items.sort((left, right) => compareText(String((left as Record<string, unknown>).route ?? ""), String((right as Record<string, unknown>).route ?? "")));
    return items;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const name of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const item = canonicalize((value as Record<string, unknown>)[name], name);
      if (item !== undefined) output[name] = item;
    }
    return output;
  }
  return value;
}

/** Stable JSON; runtime timestamps and local paths never affect report identity. */
export function canonicalUpstreamReport(report: UpstreamAttributionReport | object): string {
  return JSON.stringify(canonicalize(report));
}

export function hashCanonicalUpstreamReport(report: UpstreamAttributionReport | object): string {
  return createHash("sha256").update(canonicalUpstreamReport(report), "utf8").digest("hex");
}
