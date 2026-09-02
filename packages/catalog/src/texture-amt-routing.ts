import { createHash } from "node:crypto";
import {
  evaluateColdMetalTransfer,
  type ColdMetalTransferInput,
  type ColdTransferMetric,
  type ColdTransferNote,
  type ColdTransferNoteInput,
  type ColdTransferRoute,
} from "./cold-metal-transfer.js";

export const TEXTURE_AMT_ROUTING_SCHEMA_VERSION = 1 as const;
export const DEFAULT_TEXTURE_ROUTING_WINDOW = 4;
export const DEFAULT_TEXTURE_ROUTING_ONSET_TOLERANCE = 0.08;
export const DEFAULT_TEXTURE_ROUTING_MATERIAL_GAIN = 0.03;

export type TextureBackend = "basic" | "gaps";
export type TextureMetric = "onset" | "exact" | "pitchClass";
export type TextureClass = "FAST_LEAD" | "SPARSE_LEAD" | "POWER_CHORD" | "RHYTHM_CHUG" | "DENSE_HARMONY" | "MIXED" | "UNKNOWN";

export interface TextureWindow {
  id: string;
  start: number;
  end: number;
}

export interface TextureFeatures {
  noteCount: number;
  onsetCount: number;
  noteDensity: number;
  onsetDensity: number;
  medianInterOnset: number | null;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  medianPitch: number | null;
  medianDuration: number | null;
  shortRate: number;
  meanStackSize: number | null;
  maxStackSize: number;
  polyphonicOnsetRate: number | null;
  repeatedPitchRate: number | null;
  octaveStackRate: number | null;
  fifthStackRate: number | null;
  rhythmicRegularity: number | null;
}

export interface BackendAgreementClasses {
  matched: number;
  bothExact: number;
  bothPitchClassOnly: number;
  bothTimingOnly: number;
  basicOnly: number;
  gapsOnly: number;
}

export interface TextureRoutingSongInput {
  id: string;
  /** A source/candidate duration. It must not be inferred from reference notes. */
  duration: number;
  basic: ColdTransferRoute;
  gaps: ColdTransferRoute;
}

export interface TextureRoutingPlanInput {
  timebase: "beats" | "seconds";
  onsetTolerance?: number;
  windowSize?: number;
  windows?: readonly TextureWindow[];
  songs: readonly TextureRoutingSongInput[];
}

interface TextureCandidateSet {
  status: "available" | "unavailable" | "malformed";
  notes: ColdTransferNote[];
}

export interface TextureRoutingWindowPlan {
  window: TextureWindow;
  generation: {
    basic: TextureFeatures;
    gaps: TextureFeatures;
    agreement: BackendAgreementClasses;
    textureClass: TextureClass;
  };
}

export interface TextureRoutingSongPlan {
  id: string;
  duration: number;
  candidates: Record<TextureBackend, TextureCandidateSet>;
  windows: TextureRoutingWindowPlan[];
}

export interface TextureRoutingPlan {
  schemaVersion: typeof TEXTURE_AMT_ROUTING_SCHEMA_VERSION;
  kind: "cold-metal-texture-routing-plan";
  config: {
    timebase: "beats" | "seconds";
    onsetTolerance: number;
    windowSize: number | null;
    windowDefinition: "fixed-half-open-source-duration" | "explicit-half-open";
  };
  songs: TextureRoutingSongPlan[];
  routing: {
    status: "not-defined";
    fallback: TextureBackend;
    referenceLabelsInFeatures: false;
    rawNoteUnion: false;
  };
}

export interface TextureWindowEvaluation {
  window: TextureWindow;
  truthNoteCount: number;
  basic: Record<TextureMetric, ColdTransferMetric>;
  gaps: Record<TextureMetric, ColdTransferMetric>;
  winners: Record<TextureMetric, TextureBackend | "none">;
  ties: Record<TextureMetric, boolean>;
}

export interface TextureOracleResult {
  metrics: Record<TextureMetric, ColdTransferMetric>;
  gainOverBestSingle: Record<TextureMetric, number | null>;
  winnerCounts: Record<TextureMetric, Record<TextureBackend, number>>;
  tieCounts: Record<TextureMetric, number>;
}

export interface TextureAgreementClassSummary {
  candidateCount: number;
  onset: ColdTransferMetric;
  exact: ColdTransferMetric;
  pitchClass: ColdTransferMetric;
}

export interface TextureAgreementReport {
  exact: {
    shared: TextureAgreementClassSummary;
    basicOnly: TextureAgreementClassSummary;
    gapsOnly: TextureAgreementClassSummary;
    timingConflicts: TextureAgreementClassSummary;
  };
  pitchClass: {
    shared: TextureAgreementClassSummary;
    basicOnly: TextureAgreementClassSummary;
    gapsOnly: TextureAgreementClassSummary;
    timingConflicts: TextureAgreementClassSummary;
  };
  octaveDisagreement: {
    pairs: number;
    basicExactMatches: number;
    gapsExactMatches: number;
    basicPitchClassMatches: number;
    gapsPitchClassMatches: number;
  };
}

export interface TextureFeatureSummary {
  windowCount: number;
  basicCandidateDensity: number | null;
  gapsCandidateDensity: number | null;
  basicOnsetDensity: number | null;
  gapsOnsetDensity: number | null;
  exactAgreementRatio: number | null;
  pitchClassAgreementRatio: number | null;
  oracleWinners: Record<TextureMetric, Record<TextureBackend | "tie" | "none", number>>;
}

export interface TextureRoutingSongEvaluation {
  id: string;
  duration: number;
  bestSingle: Record<TextureBackend, Record<TextureMetric, ColdTransferMetric>>;
  windows: TextureWindowEvaluation[];
  backendSelectionOracle: TextureOracleResult;
  noteUnionOracle: Record<TextureMetric, ColdTransferMetric>;
  agreement: TextureAgreementReport;
  featureSummary: Record<TextureClass, TextureFeatureSummary>;
  referenceSupport: {
    basicOnly: Record<TextureMetric, number>;
    gapsOnly: Record<TextureMetric, number>;
    both: Record<TextureMetric, number>;
    neither: Record<TextureMetric, number>;
  };
}

export interface TextureRoutingEvaluationInput {
  plan: TextureRoutingPlan;
  truth: readonly { id: string; notes: readonly ColdTransferNoteInput[] }[];
  materialGain?: number;
}

export interface TextureRoutingEvaluationReport {
  schemaVersion: typeof TEXTURE_AMT_ROUTING_SCHEMA_VERSION;
  kind: "cold-metal-texture-routing-evaluation";
  config: TextureRoutingPlan["config"] & {
    materialGain: number;
    highCeilingCriterion: string;
  };
  songs: TextureRoutingSongEvaluation[];
  decision: {
    routingCeiling: "ROUTING_CEILING_HIGH" | "ROUTING_CEILING_LOW";
    router: "not-built";
    architecture: "NO_AMT_ARCHITECTURE_CHANGE";
  };
}

type PairKind = "exact" | "pitchClass" | "onset";
type Pair = { left: number; right: number; kind: PairKind; distance: number };
const EPS = 1e-9;
const METRICS: readonly TextureMetric[] = ["onset", "exact", "pitchClass"];
const TEXTURE_CLASSES: readonly TextureClass[] = ["FAST_LEAD", "SPARSE_LEAD", "POWER_CHORD", "RHYTHM_CHUG", "DENSE_HARMONY", "MIXED", "UNKNOWN"];

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function round(value: number): number { const n = Math.round(value * 1e6) / 1e6; return Object.is(n, -0) ? 0 : n; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower));
}
function read(raw: ColdTransferNoteInput, names: readonly (keyof ColdTransferNoteInput)[]): unknown {
  for (const name of names) if (raw[name] !== undefined) return raw[name];
  return undefined;
}
function noteOrder(a: ColdTransferNote, b: ColdTransferNote): number {
  return a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.sourceIndex - b.sourceIndex;
}
function normalizeNotes(value: unknown): TextureCandidateSet {
  if (!Array.isArray(value)) return { status: "malformed", notes: [] };
  const notes: (Omit<ColdTransferNote, "sourceIndex"> & { sourceIndex?: number })[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as ColdTransferNoteInput;
    const midi = read(item, ["midi", "pitch"]);
    const start = read(item, ["start", "onset"]);
    const dur = read(item, ["dur", "duration"]);
    if (!finite(midi) || !Number.isInteger(midi) || midi < 0 || midi > 127 || !finite(start) || start < 0 || !finite(dur) || dur <= 0) continue;
    notes.push({ midi, start, dur, sourceIndex: finite(item.sourceIndex) && Number.isInteger(item.sourceIndex) && item.sourceIndex >= 0 ? item.sourceIndex : undefined });
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || (a.sourceIndex ?? Number.POSITIVE_INFINITY) - (b.sourceIndex ?? Number.POSITIVE_INFINITY));
  return { status: "available", notes: notes.map((note, index) => ({ ...note, sourceIndex: note.sourceIndex ?? index })) };
}
function routeCandidates(route: ColdTransferRoute): TextureCandidateSet {
  if (Array.isArray(route)) return normalizeNotes(route);
  if (!route || typeof route !== "object" || Array.isArray(route)) return { status: "malformed", notes: [] };
  const input = route as Exclude<ColdTransferRoute, readonly ColdTransferNoteInput[]>;
  if (input.status === "unavailable" || input.status === "malformed") return { status: input.status, notes: [] };
  if (input.status !== undefined && input.status !== "available") return { status: "malformed", notes: [] };
  return normalizeNotes(input.notes ?? []);
}
function sourceWindows(duration: number, windowSize: number): TextureWindow[] {
  if (!finite(duration) || duration <= 0 || !finite(windowSize) || windowSize <= 0) return [];
  const result: TextureWindow[] = [];
  for (let start = 0, index = 0; start < duration; start += windowSize, index += 1) {
    const end = Math.min(duration, start + windowSize);
    if (end - start > EPS) result.push({ id: `w${String(index).padStart(4, "0")}`, start: round(start), end: round(end) });
  }
  return result;
}
function validateWindows(windows: readonly TextureWindow[]): TextureWindow[] {
  const ids = new Set<string>();
  const result = windows.map((window, index) => {
    if (!window || typeof window.id !== "string" || !window.id.trim() || ids.has(window.id)) throw new Error(`texture window IDs must be unique at ${index}`);
    if (!finite(window.start) || !finite(window.end) || window.start < 0 || window.end <= window.start) throw new Error(`invalid texture window ${window.id}`);
    const start = round(window.start);
    const end = round(window.end);
    if (end <= start) throw new Error(`invalid texture window ${window.id}`);
    ids.add(window.id);
    return { id: window.id, start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let index = 1; index < result.length; index += 1) if (result[index]!.start < result[index - 1]!.end - EPS) throw new Error(`overlapping texture windows: ${result[index - 1]!.id} and ${result[index]!.id}`);
  return result;
}
function inWindow(note: ColdTransferNote, window: TextureWindow): boolean { return note.start >= window.start && note.start < window.end; }
function slice(notes: readonly ColdTransferNote[], window: TextureWindow): ColdTransferNote[] { return notes.filter((note) => inWindow(note, window)); }
function onsetGroups(notes: readonly ColdTransferNote[], tolerance: number): ColdTransferNote[][] {
  const groups: ColdTransferNote[][] = [];
  for (const note of [...notes].sort(noteOrder)) {
    const current = groups.at(-1);
    if (current && note.start - current[0]!.start <= tolerance + EPS) current.push(note);
    else groups.push([note]);
  }
  return groups;
}
function pairs(left: readonly ColdTransferNote[], right: readonly ColdTransferNote[], tolerance: number): Pair[] {
  const edges: Pair[] = [];
  for (let li = 0; li < left.length; li += 1) for (let ri = 0; ri < right.length; ri += 1) {
    const distance = Math.abs(left[li]!.start - right[ri]!.start);
    if (distance > tolerance + EPS) continue;
    const kind: PairKind = left[li]!.midi === right[ri]!.midi ? "exact" : left[li]!.midi % 12 === right[ri]!.midi % 12 ? "pitchClass" : "onset";
    edges.push({ left: li, right: ri, kind, distance });
  }
  const priority: Record<PairKind, number> = { exact: 0, pitchClass: 1, onset: 2 };
  edges.sort((a, b) => priority[a.kind] - priority[b.kind] || a.distance - b.distance || a.left - b.left || a.right - b.right);
  const edgeByPair = new Map(edges.map((edge) => [`${edge.kind}:${edge.left}:${edge.right}`, edge] as const));
  const edgesByKindAndLeft = new Map<PairKind, Map<number, Pair[]>>();
  for (const edge of edges) {
    const byLeft = edgesByKindAndLeft.get(edge.kind) ?? new Map<number, Pair[]>();
    const candidates = byLeft.get(edge.left) ?? [];
    candidates.push(edge);
    byLeft.set(edge.left, candidates);
    edgesByKindAndLeft.set(edge.kind, byLeft);
  }
  const result: Pair[] = [];
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  for (const kind of ["exact", "pitchClass", "onset"] as const) {
    const owner = new Map<number, number>();
    const assigned = new Map<number, number>();
    const visit = (leftIndex: number, seen: Set<number>): boolean => {
      for (const edge of edgesByKindAndLeft.get(kind)?.get(leftIndex) ?? []) {
        if (usedRight.has(edge.right) || seen.has(edge.right)) continue;
        seen.add(edge.right);
        const previous = owner.get(edge.right);
        if (previous === undefined || visit(previous, seen)) {
          owner.set(edge.right, leftIndex);
          assigned.set(leftIndex, edge.right);
          return true;
        }
      }
      return false;
    };
    for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
      if (usedLeft.has(leftIndex)) continue;
      visit(leftIndex, new Set());
    }
    for (const [leftIndex, rightIndex] of assigned) {
      usedLeft.add(leftIndex);
      usedRight.add(rightIndex);
      const edge = edgeByPair.get(`${kind}:${leftIndex}:${rightIndex}`)!;
      result.push(edge);
    }
  }
  return result.sort((a, b) => a.left - b.left || a.right - b.right);
}
function featureStats(notes: readonly ColdTransferNote[], start: number, end: number, tolerance: number): TextureFeatures {
  const ordered = [...notes].sort(noteOrder);
  const groups = onsetGroups(ordered, tolerance);
  const starts = groups.map((group) => group[0]!.start);
  const interOnsets = starts.slice(1).map((value, index) => value - starts[index]!);
  const durations = ordered.map((note) => note.dur);
  const pitches = ordered.map((note) => note.midi);
  const stacks = groups.map((group) => group.length);
  const pairRate = (interval: number): number | null => groups.length ? round(groups.filter((group) => group.some((left, i) => group.slice(i + 1).some((right) => Math.abs(left.midi - right.midi) === interval))).length / groups.length) : null;
  const repeatedPitchRate = ordered.length > 1 ? round(ordered.slice(1).filter((note, index) => note.midi === ordered[index]!.midi).length / (ordered.length - 1)) : null;
  const meanGap = interOnsets.length ? interOnsets.reduce((sum, gap) => sum + gap, 0) / interOnsets.length : null;
  const stdGap = meanGap && interOnsets.length ? Math.sqrt(interOnsets.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / interOnsets.length) : null;
  const durationSpan = Math.max(0, end - start);
  return {
    noteCount: ordered.length,
    onsetCount: groups.length,
    noteDensity: durationSpan > EPS ? round(ordered.length / durationSpan) : 0,
    onsetDensity: durationSpan > EPS ? round(groups.length / durationSpan) : 0,
    medianInterOnset: quantile(interOnsets, 0.5),
    pitchMin: pitches.length ? Math.min(...pitches) : null,
    pitchMax: pitches.length ? Math.max(...pitches) : null,
    pitchSpan: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : null,
    medianPitch: quantile(pitches, 0.5),
    medianDuration: quantile(durations, 0.5),
    shortRate: ordered.length ? round(ordered.filter((note) => note.dur < 0.25).length / ordered.length) : 0,
    meanStackSize: stacks.length ? round(stacks.reduce((sum, value) => sum + value, 0) / stacks.length) : null,
    maxStackSize: stacks.length ? Math.max(...stacks) : 0,
    polyphonicOnsetRate: groups.length ? round(groups.filter((group) => group.length > 1).length / groups.length) : null,
    repeatedPitchRate,
    octaveStackRate: pairRate(12),
    fifthStackRate: pairRate(7),
    rhythmicRegularity: stdGap !== null && meanGap && meanGap > EPS ? round(clamp(1 - stdGap / meanGap, 0, 1)) : interOnsets.length ? 1 : null,
  };
}
function classifyTexture(basic: TextureFeatures, gaps: TextureFeatures): TextureClass {
  const density = Math.max(basic.onsetDensity, gaps.onsetDensity);
  const stack = Math.max(basic.meanStackSize ?? 0, gaps.meanStackSize ?? 0);
  const regularity = Math.max(basic.rhythmicRegularity ?? 0, gaps.rhythmicRegularity ?? 0);
  const notes = basic.noteCount + gaps.noteCount;
  if (!notes) return "UNKNOWN";
  if (density >= 8 && stack >= 2) return "DENSE_HARMONY";
  if (density >= 4 && regularity >= 0.65 && stack <= 2) return "RHYTHM_CHUG";
  if (density <= 2.5 && stack <= 1.5 && regularity >= 0.45) return "SPARSE_LEAD";
  if (density >= 2.5 && stack <= 1.5) return "FAST_LEAD";
  if (stack >= 1.5) return "POWER_CHORD";
  return "MIXED";
}
function generationForWindow(basic: readonly ColdTransferNote[], gaps: readonly ColdTransferNote[], window: TextureWindow, tolerance: number): TextureRoutingWindowPlan["generation"] {
  const basicFeatures = featureStats(basic, window.start, window.end, tolerance);
  const gapsFeatures = featureStats(gaps, window.start, window.end, tolerance);
  const agreementPairs = pairs(basic, gaps, tolerance);
  const agreement: BackendAgreementClasses = {
    matched: agreementPairs.length,
    bothExact: agreementPairs.filter((pair) => pair.kind === "exact").length,
    bothPitchClassOnly: agreementPairs.filter((pair) => pair.kind === "pitchClass").length,
    bothTimingOnly: agreementPairs.filter((pair) => pair.kind === "onset").length,
    basicOnly: basic.length - agreementPairs.length,
    gapsOnly: gaps.length - agreementPairs.length,
  };
  return { basic: basicFeatures, gaps: gapsFeatures, agreement, textureClass: classifyTexture(basicFeatures, gapsFeatures) };
}

export function buildTextureRoutingPlan(input: TextureRoutingPlanInput): TextureRoutingPlan {
  if (!input || !Array.isArray(input.songs) || !input.songs.length) throw new Error("texture routing songs must be non-empty");
  const onsetTolerance = input.onsetTolerance ?? DEFAULT_TEXTURE_ROUTING_ONSET_TOLERANCE;
  const windowSize = input.windowSize ?? DEFAULT_TEXTURE_ROUTING_WINDOW;
  if (input.timebase !== "beats" && input.timebase !== "seconds") throw new Error("texture routing timebase is invalid");
  if (!finite(onsetTolerance) || onsetTolerance < 0 || !finite(windowSize) || windowSize <= 0) throw new Error("texture routing thresholds are invalid");
  const ids = new Set<string>();
  const songs = [...input.songs].sort((a, b) => {
    const left = a && typeof a === "object" && typeof a.id === "string" ? a.id : "";
    const right = b && typeof b === "object" && typeof b.id === "string" ? b.id : "";
    return left < right ? -1 : left > right ? 1 : 0;
  }).map((song) => {
    if (!song || typeof song.id !== "string" || !song.id.trim() || ids.has(song.id)) throw new Error("texture routing song IDs must be unique non-empty strings");
    if (!finite(song.duration) || song.duration <= 0) throw new Error(`texture routing duration is invalid for ${song.id}`);
    ids.add(song.id);
    const candidates = { basic: routeCandidates(song.basic), gaps: routeCandidates(song.gaps) } satisfies Record<TextureBackend, TextureCandidateSet>;
    const windows = validateWindows(input.windows?.length ? input.windows : sourceWindows(song.duration, windowSize)).map((window) => ({
      window,
      generation: generationForWindow(slice(candidates.basic.notes, window), slice(candidates.gaps.notes, window), window, onsetTolerance),
    }));
    return { id: song.id, duration: round(song.duration), candidates, windows };
  });
  return {
    schemaVersion: TEXTURE_AMT_ROUTING_SCHEMA_VERSION,
    kind: "cold-metal-texture-routing-plan",
    config: { timebase: input.timebase, onsetTolerance: round(onsetTolerance), windowSize: input.windows?.length ? null : round(windowSize), windowDefinition: input.windows?.length ? "explicit-half-open" : "fixed-half-open-source-duration" },
    songs,
    routing: { status: "not-defined", fallback: "basic", referenceLabelsInFeatures: false, rawNoteUnion: false },
  };
}

function metricParts(metrics: readonly ColdTransferMetric[]): ColdTransferMetric {
  const matches = metrics.reduce((sum, value) => sum + value.matches, 0);
  const predictedCount = metrics.reduce((sum, value) => sum + value.predictedCount, 0);
  const truthCount = metrics.reduce((sum, value) => sum + value.truthCount, 0);
  const precision = predictedCount ? matches / predictedCount : null;
  const recall = truthCount ? matches / truthCount : null;
  const f1 = precision === null && recall === null ? null : precision === null || recall === null ? 0 : precision + recall > EPS ? 2 * precision * recall / (precision + recall) : 0;
  return { matches, predictedCount, truthCount, precision: precision === null ? null : round(precision), recall: recall === null ? null : round(recall), f1: f1 === null ? null : round(f1) };
}
function winner(basic: ColdTransferMetric, gaps: ColdTransferMetric): { selected: TextureBackend | "none"; tie: boolean } {
  const b = basic.f1 ?? -Infinity;
  const g = gaps.f1 ?? -Infinity;
  if (b === -Infinity && g === -Infinity) return { selected: "none", tie: false };
  if (Math.abs(b - g) <= EPS) return { selected: "basic", tie: true };
  return b > g ? { selected: "basic", tie: false } : { selected: "gaps", tie: false };
}
function metricRecord(song: ReturnType<typeof evaluateColdMetalTransfer>["songs"][number], backend: TextureBackend): Record<TextureMetric, ColdTransferMetric> {
  const route = song[backend];
  return { onset: route.onset, exact: route.exact, pitchClass: route.pitchClass };
}
function scoreSubset(truth: readonly ColdTransferNoteInput[], notes: readonly ColdTransferNote[], timebase: "beats" | "seconds", tolerance: number): Record<TextureMetric, ColdTransferMetric> {
  const report = evaluateColdMetalTransfer({ timebase, onsetTolerance: tolerance, songs: [{ id: "subset", truth, basic: notes, gaps: { status: "unavailable" } }] });
  return metricRecord(report.songs[0]!, "basic");
}
function classSummary(truth: readonly ColdTransferNoteInput[], notes: readonly ColdTransferNote[], timebase: "beats" | "seconds", tolerance: number): TextureAgreementClassSummary {
  const metrics = scoreSubset(truth, notes, timebase, tolerance);
  return { candidateCount: notes.length, ...metrics };
}
function agreementReport(truth: readonly ColdTransferNoteInput[], basic: readonly ColdTransferNote[], gaps: readonly ColdTransferNote[], timebase: "beats" | "seconds", tolerance: number): TextureAgreementReport {
  const assigned = pairs(basic, gaps, tolerance);
  const sharedBasic = new Set(assigned.map((pair) => pair.left));
  const sharedGaps = new Set(assigned.map((pair) => pair.right));
  const exactShared = assigned.filter((pair) => pair.kind === "exact");
  const pcShared = assigned.filter((pair) => pair.kind === "exact" || pair.kind === "pitchClass");
  const timingConflicts = assigned.filter((pair) => pair.kind === "onset");
  const summary = (indices: number[], notes: readonly ColdTransferNote[]) => classSummary(truth, indices.map((index) => notes[index]!), timebase, tolerance);
  const build = (shared: Pair[]) => {
    const sharedLeft = new Set(shared.map((pair) => pair.left));
    const sharedRight = new Set(shared.map((pair) => pair.right));
    return {
      shared: summary(shared.map((pair) => pair.left), basic),
      basicOnly: summary(basic.map((_, index) => index).filter((index) => !sharedLeft.has(index)), basic),
      gapsOnly: summary(gaps.map((_, index) => index).filter((index) => !sharedRight.has(index)), gaps),
      timingConflicts: summary(timingConflicts.map((pair) => pair.left), basic),
    };
  };
  const octave = assigned.filter((pair) => pair.kind === "pitchClass");
  const basicOctave = octave.map((pair) => basic[pair.left]!);
  const gapsOctave = octave.map((pair) => gaps[pair.right]!);
  const basicPc = scoreSubset(truth, basicOctave, timebase, tolerance);
  const gapsPc = scoreSubset(truth, gapsOctave, timebase, tolerance);
  return {
    exact: build(exactShared),
    pitchClass: build(pcShared),
    octaveDisagreement: { pairs: octave.length, basicExactMatches: basicPc.exact.matches, gapsExactMatches: gapsPc.exact.matches, basicPitchClassMatches: basicPc.pitchClass.matches, gapsPitchClassMatches: gapsPc.pitchClass.matches },
  };
}
function emptySupport(): TextureRoutingSongEvaluation["referenceSupport"] { return { basicOnly: { onset: 0, exact: 0, pitchClass: 0 }, gapsOnly: { onset: 0, exact: 0, pitchClass: 0 }, both: { onset: 0, exact: 0, pitchClass: 0 }, neither: { onset: 0, exact: 0, pitchClass: 0 } }; }
function featureSummary(windows: readonly TextureRoutingWindowPlan[], evaluated: readonly TextureWindowEvaluation[]): Record<TextureClass, TextureFeatureSummary> {
  const result = {} as Record<TextureClass, TextureFeatureSummary>;
  for (const texture of TEXTURE_CLASSES) {
    const selected = windows.filter((window) => window.generation.textureClass === texture);
    const indexes = new Map(windows.map((window, index) => [window.window.id, index]));
    const evals = selected.map((window) => evaluated[indexes.get(window.window.id)!]).filter((value): value is TextureWindowEvaluation => Boolean(value));
    const mean = (values: readonly (number | null)[]): number | null => {
      const finiteValues = values.filter((value): value is number => finite(value));
      return finiteValues.length ? round(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length) : null;
    };
    const winners = Object.fromEntries(METRICS.map((metric) => [metric, { basic: evals.filter((value) => value.winners[metric] === "basic").length, gaps: evals.filter((value) => value.winners[metric] === "gaps").length, tie: evals.filter((value) => value.ties[metric]).length, none: evals.filter((value) => value.winners[metric] === "none").length }])) as TextureFeatureSummary["oracleWinners"];
    result[texture] = {
      windowCount: selected.length,
      basicCandidateDensity: mean(selected.map((window) => window.generation.basic.noteDensity)),
      gapsCandidateDensity: mean(selected.map((window) => window.generation.gaps.noteDensity)),
      basicOnsetDensity: mean(selected.map((window) => window.generation.basic.onsetDensity)),
      gapsOnsetDensity: mean(selected.map((window) => window.generation.gaps.onsetDensity)),
      exactAgreementRatio: mean(selected.map((window) => {
        const denominator = Math.max(window.generation.basic.noteCount, window.generation.gaps.noteCount);
        return denominator ? window.generation.agreement.bothExact / denominator : null;
      })),
      pitchClassAgreementRatio: mean(selected.map((window) => {
        const denominator = Math.max(window.generation.basic.noteCount, window.generation.gaps.noteCount);
        return denominator ? (window.generation.agreement.bothExact + window.generation.agreement.bothPitchClassOnly) / denominator : null;
      })),
      oracleWinners: winners,
    };
  }
  return result;
}

export function evaluateTextureRouting(input: TextureRoutingEvaluationInput): TextureRoutingEvaluationReport {
  if (!input || !input.plan || !Array.isArray(input.truth)) throw new Error("texture routing evaluation requires a plan and truth");
  const materialGain = input.materialGain ?? DEFAULT_TEXTURE_ROUTING_MATERIAL_GAIN;
  if (!finite(materialGain) || materialGain < 0) throw new Error("texture routing material gain is invalid");
  const truthById = new Map<string, readonly ColdTransferNoteInput[]>();
  for (const item of input.truth) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() || !Array.isArray(item.notes) || truthById.has(item.id)) throw new Error("texture routing truth IDs must match plan songs");
    truthById.set(item.id, item.notes);
  }
  if (truthById.size !== input.plan.songs.length || !input.plan.songs.every((song) => truthById.has(song.id))) throw new Error("texture routing truth IDs must match plan songs");
  const songs = input.plan.songs.map((songPlan): TextureRoutingSongEvaluation => {
    const truth = truthById.get(songPlan.id)!;
    const coveredTruth = truth.filter((raw: ColdTransferNoteInput) => {
      const start = read(raw, ["start", "onset"]);
      return finite(start) && start < songPlan.duration;
    });
    const fullInput: ColdMetalTransferInput = { timebase: input.plan.config.timebase, onsetTolerance: input.plan.config.onsetTolerance, songs: [{ id: songPlan.id, duration: songPlan.duration, truth: coveredTruth, basic: songPlan.candidates.basic.status === "available" ? songPlan.candidates.basic.notes : { status: songPlan.candidates.basic.status }, gaps: songPlan.candidates.gaps.status === "available" ? songPlan.candidates.gaps.notes : { status: songPlan.candidates.gaps.status } }] };
    const full = evaluateColdMetalTransfer(fullInput).songs[0]!;
    const windows: TextureWindowEvaluation[] = songPlan.windows.map((windowPlan) => {
      const window = windowPlan.window;
      const windowTruth = coveredTruth.filter((raw: ColdTransferNoteInput) => { const start = read(raw, ["start", "onset"]); return finite(start) && start >= window.start && start < window.end; });
      const basicNotes = slice(songPlan.candidates.basic.notes, window);
      const gapsNotes = slice(songPlan.candidates.gaps.notes, window);
      const report = evaluateColdMetalTransfer({ timebase: input.plan.config.timebase, onsetTolerance: input.plan.config.onsetTolerance, songs: [{ id: `${songPlan.id}:${window.id}`, truth: windowTruth, basic: songPlan.candidates.basic.status === "available" ? basicNotes : { status: songPlan.candidates.basic.status }, gaps: songPlan.candidates.gaps.status === "available" ? gapsNotes : { status: songPlan.candidates.gaps.status } }] }).songs[0]!;
      const basicMetrics = metricRecord(report, "basic");
      const gapsMetrics = metricRecord(report, "gaps");
      const winners = {} as Record<TextureMetric, TextureBackend | "none">;
      const ties = {} as Record<TextureMetric, boolean>;
      for (const metric of METRICS) { const choice = winner(basicMetrics[metric], gapsMetrics[metric]); winners[metric] = choice.selected; ties[metric] = choice.tie; }
      return { window, truthNoteCount: windowTruth.length, basic: basicMetrics, gaps: gapsMetrics, winners, ties };
    });
    const oracleMetrics = {} as Record<TextureMetric, ColdTransferMetric>;
    const gains = {} as Record<TextureMetric, number | null>;
    const winnerCounts = {} as TextureOracleResult["winnerCounts"];
    const tieCounts = {} as TextureOracleResult["tieCounts"];
    for (const metric of METRICS) {
      const parts = windows.filter((window) => window.truthNoteCount > 0).map((window) => {
        const choice = window.winners[metric];
        return choice === "gaps" ? window.gaps[metric] : choice === "basic" ? window.basic[metric] : { matches: 0, predictedCount: 0, truthCount: 0, precision: null, recall: null, f1: null };
      });
      oracleMetrics[metric] = metricParts(parts);
      const best = Math.max(full.basic[metric].f1 ?? -Infinity, full.gaps[metric].f1 ?? -Infinity);
      gains[metric] = best === -Infinity || oracleMetrics[metric].f1 === null ? null : round(oracleMetrics[metric].f1 - best);
      winnerCounts[metric] = { basic: windows.filter((window) => window.truthNoteCount > 0 && window.winners[metric] === "basic").length, gaps: windows.filter((window) => window.truthNoteCount > 0 && window.winners[metric] === "gaps").length };
      tieCounts[metric] = windows.filter((window) => window.truthNoteCount > 0 && window.ties[metric]).length;
    }
    const support = emptySupport();
    for (const metric of METRICS) {
      const values = full.complementarity[metric];
      support.basicOnly[metric] = values.basicOnly; support.gapsOnly[metric] = values.gapsOnly; support.both[metric] = values.both; support.neither[metric] = values.neither;
    }
    const feature = featureSummary(songPlan.windows, windows);
    const bestSingle = { basic: metricRecord(full, "basic"), gaps: metricRecord(full, "gaps") };
    return {
      id: songPlan.id,
      duration: songPlan.duration,
      bestSingle,
      windows,
      backendSelectionOracle: { metrics: oracleMetrics, gainOverBestSingle: gains, winnerCounts, tieCounts },
      noteUnionOracle: { onset: full.union.onset, exact: full.union.exact, pitchClass: full.union.pitchClass },
      agreement: agreementReport(coveredTruth, songPlan.candidates.basic.notes, songPlan.candidates.gaps.notes, input.plan.config.timebase, input.plan.config.onsetTolerance),
      featureSummary: feature,
      referenceSupport: support,
    };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const highSongs = songs.filter((song) => (song.backendSelectionOracle.gainOverBestSingle.exact ?? -Infinity) >= materialGain || (song.backendSelectionOracle.gainOverBestSingle.pitchClass ?? -Infinity) >= materialGain).length;
  return {
    schemaVersion: TEXTURE_AMT_ROUTING_SCHEMA_VERSION,
    kind: "cold-metal-texture-routing-evaluation",
    config: { ...input.plan.config, materialGain, highCeilingCriterion: `at least two songs gain >= ${round(materialGain)} exact or pitchClass F1 over their better fixed backend` },
    songs,
    decision: { routingCeiling: highSongs >= 2 ? "ROUTING_CEILING_HIGH" : "ROUTING_CEILING_LOW", router: "not-built", architecture: "NO_AMT_ARCHITECTURE_CHANGE" },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function canonicalTextureRouting(value: TextureRoutingPlan | TextureRoutingEvaluationReport): string { return `${canonical(value)}\n`; }
export function hashCanonicalTextureRouting(value: TextureRoutingPlan | TextureRoutingEvaluationReport): string {
  return createHash("sha256").update(canonicalTextureRouting(value), "utf8").digest("hex");
}
