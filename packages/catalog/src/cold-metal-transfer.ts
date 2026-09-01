import { createHash } from "node:crypto";
import { normalizeUpstreamTruth } from "./upstream-attribution.js";

/** Evaluation-only comparison of two raw guitar AMT routes. It is deliberately
 * independent of the arranger: notes are compared in the caller's beat (or
 * second) domain with one fixed tolerance and deterministic one-to-one pairs. */
export const COLD_METAL_TRANSFER_SCHEMA_VERSION = 1 as const;

export type ColdTransferRouteStatus = "available" | "unavailable" | "malformed";
export type ColdTransferClassification = "gaps-wins" | "precision-only" | "mixed" | "no-transfer" | "unavailable";
export type ColdTransferCase =
  | "GAPS_COLD_TRANSFER_VALIDATED"
  | "GAPS_COLD_TRANSFER_MIXED"
  | "GAPS_CONTROLLED_ONLY"
  | "GAPS_COLD_TRANSFER_UNAVAILABLE";
export type ColdTransferArchitecture =
  | "REPLACE_BASIC_PITCH"
  | "COMPLEMENT_BASIC_PITCH"
  | "TEXTURE_DEPENDENT"
  | "NO_PROMOTION";

export interface ColdTransferNote {
  midi: number;
  start: number;
  dur: number;
  sourceIndex: number;
}

export interface ColdTransferNoteInput {
  midi?: unknown;
  pitch?: unknown;
  start?: unknown;
  onset?: unknown;
  dur?: unknown;
  duration?: unknown;
  sourceIndex?: unknown;
}

export interface ColdTransferRouteInput {
  status?: ColdTransferRouteStatus;
  notes?: readonly ColdTransferNoteInput[];
  duration?: number;
}

export type ColdTransferRoute = readonly ColdTransferNoteInput[] | ColdTransferRouteInput;

export interface ColdTransferSongInput {
  id: string;
  truth: readonly ColdTransferNoteInput[];
  basic: ColdTransferRoute;
  gaps: ColdTransferRoute;
  duration?: number;
}

export interface ColdMetalTransferInput {
  songs: readonly ColdTransferSongInput[];
  /** The caller may use beats or seconds; no implicit tempo/alignment is applied. */
  timebase?: "beats" | "seconds";
  onsetTolerance?: number;
  /** Backwards-compatible spelling used by the first synthetic fixtures. */
  onsetToleranceBeats?: number;
  materialGain?: number;
  catastrophicLoss?: number;
  meaningfulPrecisionGain?: number;
}

export interface ColdTransferMetric {
  matches: number;
  predictedCount: number;
  truthCount: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ColdTransferOctaveMetric extends ColdTransferMetric {
  errorRate: number | null;
}

export interface ColdTransferRouteMetrics {
  status: ColdTransferRouteStatus;
  candidateCount: number | null;
  invalidCount: number | null;
  duration: number | null;
  densityPerUnit: number | null;
  unsupportedPerUnit: number | null;
  onset: ColdTransferMetric;
  exact: ColdTransferMetric;
  pitchClass: ColdTransferMetric;
  octave: ColdTransferOctaveMetric;
}

export interface ColdTransferComplementarity {
  both: number;
  basicOnly: number;
  gapsOnly: number;
  neither: number;
}

export interface ColdTransferPredictionOverlap {
  matches: number;
  basicCount: number;
  gapsCount: number;
  basicOnly: number;
  gapsOnly: number;
  supportedBasicOnly: number;
  unsupportedBasicOnly: number;
  supportedGapsOnly: number;
  unsupportedGapsOnly: number;
}

export interface ColdTransferSongResult {
  id: string;
  status: "available" | "unavailable";
  basic: ColdTransferRouteMetrics;
  gaps: ColdTransferRouteMetrics;
  deltas: {
    onset: number | null;
    exact: number | null;
    pitchClass: number | null;
    precision: number | null;
    recall: number | null;
    octaveError: number | null;
    candidateCountRatio: number | null;
  };
  complementarity: Record<"onset" | "exact" | "pitchClass", ColdTransferComplementarity>;
  predictionOverlap: Record<"onset" | "exact" | "pitchClass", ColdTransferPredictionOverlap>;
  union: Record<"onset" | "exact" | "pitchClass", ColdTransferMetric>;
  /** Alias retained for callers that call the agreement set "intersection". */
  intersection: Record<"onset" | "exact" | "pitchClass", ColdTransferMetric>;
  intersectionAgreement: Record<"onset" | "exact" | "pitchClass", ColdTransferMetric>;
  classification: ColdTransferClassification;
}

export interface ColdMetalTransferReport {
  schemaVersion: typeof COLD_METAL_TRANSFER_SCHEMA_VERSION;
  kind: "metal-guitar-amt-transfer";
  evaluation: {
    timebase: "beats" | "seconds";
    onsetTolerance: number;
    matching: "deterministic-maximum-cardinality-one-to-one";
    materialGain: number;
    catastrophicLoss: number;
    meaningfulPrecisionGain: number;
  };
  songs: ColdTransferSongResult[];
  global: {
    caseClassification: ColdTransferCase | "gaps-wins" | "gaps-mixed" | "controlled-only" | "insufficient-evidence";
    architectureClassification: ColdTransferArchitecture | "gaps-transfer" | "insufficient-evidence";
    availableSongs: number;
    unavailableSongs: number;
  };
}

interface NormalizedRoute {
  status: ColdTransferRouteStatus;
  notes: ColdTransferNote[];
  invalidCount: number;
  duration: number | null;
}

type Kind = "onset" | "exact" | "pitchClass";
type Pair = { left: number; right: number };
const EPS = 1e-9;

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function round(value: number): number { const n = Math.round(value * 1e9) / 1e9; return Object.is(n, -0) ? 0 : n; }
function compareNumber(a: number, b: number): number { return a - b; }
function read(value: ColdTransferNoteInput, names: readonly (keyof ColdTransferNoteInput)[]): unknown {
  for (const name of names) if (value[name] !== undefined) return value[name];
  return undefined;
}
function noteOrder(a: ColdTransferNote, b: ColdTransferNote): number {
  return compareNumber(a.start, b.start) || compareNumber(a.midi, b.midi) || compareNumber(a.dur, b.dur) || compareNumber(a.sourceIndex, b.sourceIndex);
}
function normalizeNotes(value: unknown, label: string, strict: boolean): { notes: ColdTransferNote[]; invalidCount: number } {
  if (!Array.isArray(value)) {
    if (strict) throw new Error(`${label} must be an array`);
    return { notes: [], invalidCount: 0 };
  }
  const notes: ColdTransferNote[] = [];
  let invalidCount = 0;
  value.forEach((raw, sourceIndex) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { if (strict) throw new Error(`invalid ${label} note ${sourceIndex}`); invalidCount += 1; return; }
    const input = raw as ColdTransferNoteInput;
    const midi = read(input, ["midi", "pitch"]);
    const start = read(input, ["start", "onset"]);
    const dur = read(input, ["dur", "duration"]);
    if (!finite(midi) || !Number.isInteger(midi) || midi < 0 || midi > 127 || !finite(start) || start < 0 || !finite(dur) || dur <= 0) {
      if (strict) throw new Error(`invalid ${label} note ${sourceIndex}`);
      invalidCount += 1;
      return;
    }
    const supplied = input.sourceIndex;
    if (supplied !== undefined && (!finite(supplied) || !Number.isInteger(supplied) || supplied < 0)) {
      if (strict) throw new Error(`invalid ${label} sourceIndex ${sourceIndex}`);
      invalidCount += 1;
      return;
    }
    notes.push({ midi, start, dur, sourceIndex: supplied ?? sourceIndex });
  });
  notes.sort(noteOrder);
  return { notes, invalidCount };
}

function normalizeRoute(value: ColdTransferRoute, label: string): NormalizedRoute {
  const input = (Array.isArray(value) ? { notes: value } : value) as ColdTransferRouteInput;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "malformed", notes: [], invalidCount: 0, duration: null };
  const status: ColdTransferRouteStatus = input.status ?? "available";
  if (status !== "available" && status !== "unavailable" && status !== "malformed") return { status: "malformed", notes: [], invalidCount: 0, duration: null };
  if (status !== "available") return { status, notes: [], invalidCount: 0, duration: null };
  if (input.notes !== undefined && !Array.isArray(input.notes)) return { status: "malformed", notes: [], invalidCount: 0, duration: null };
  const parsed = normalizeNotes(input.notes ?? [], label, false);
  const inferred = parsed.notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  const duration = input.duration === undefined ? inferred : finite(input.duration) && input.duration > 0 ? input.duration : null;
  if (duration === null) return { status: "malformed", notes: [], invalidCount: parsed.invalidCount, duration: null };
  return { status: "available", notes: parsed.notes, invalidCount: parsed.invalidCount, duration };
}

function metric(predictedCount: number, truthCount: number, matches: number): ColdTransferMetric {
  const precision = predictedCount ? matches / predictedCount : null;
  const recall = truthCount ? matches / truthCount : null;
  const f1 = precision === null && recall === null ? null : precision === null || recall === null ? 0 : precision + recall > EPS ? 2 * precision * recall / (precision + recall) : 0;
  return { matches, predictedCount, truthCount, precision: precision === null ? null : round(precision), recall: recall === null ? null : round(recall), f1: f1 === null ? null : round(f1) };
}

function pairs(left: readonly ColdTransferNote[], right: readonly ColdTransferNote[], tolerance: number, kind: Kind): Pair[] {
  const edges = left.map((expected) => right.map((candidate, index) => ({ index, distance: Math.abs(expected.start - candidate.start) }))
    .filter(({ index, distance }) => distance <= tolerance + EPS && (kind === "onset" || (kind === "exact" ? expectedMidi(expected) === expectedMidi(right[index]!) : expectedMidi(expected) % 12 === expectedMidi(right[index]!) % 12)))
    .sort((a, b) => a.distance - b.distance || a.index - b.index));
  const owner = new Array<number>(right.length).fill(-1);
  const assigned = new Array<number>(left.length).fill(-1);
  const visit = (li: number, seen: Set<number>): boolean => {
    for (const edge of edges[li] ?? []) {
      if (seen.has(edge.index)) continue;
      seen.add(edge.index);
      if (owner[edge.index] === -1 || visit(owner[edge.index]!, seen)) { owner[edge.index] = li; assigned[li] = edge.index; return true; }
    }
    return false;
  };
  for (let i = 0; i < left.length; i += 1) visit(i, new Set());
  return assigned.map((rightIndex, leftIndex) => rightIndex < 0 ? null : ({ left: leftIndex, right: rightIndex })).filter((pair): pair is Pair => pair !== null);
}

function expectedMidi(note: ColdTransferNote): number { return note.midi; }
function emptyComplementarity(): ColdTransferComplementarity { return { both: 0, basicOnly: 0, gapsOnly: 0, neither: 0 }; }
function emptyOverlap(): ColdTransferPredictionOverlap { return { matches: 0, basicCount: 0, gapsCount: 0, basicOnly: 0, gapsOnly: 0, supportedBasicOnly: 0, unsupportedBasicOnly: 0, supportedGapsOnly: 0, unsupportedGapsOnly: 0 }; }
function unavailableMetric(): ColdTransferMetric { return metric(0, 0, 0); }
function unavailableRoute(status: ColdTransferRouteStatus): ColdTransferRouteMetrics {
  const empty = unavailableMetric();
  return { status, candidateCount: null, invalidCount: null, duration: null, densityPerUnit: null, unsupportedPerUnit: null, onset: empty, exact: empty, pitchClass: empty, octave: { ...empty, errorRate: null } };
}

function routeMetrics(truth: readonly ColdTransferNote[], route: NormalizedRoute, tolerance: number, songDuration?: number): ColdTransferRouteMetrics {
  if (route.status !== "available") return unavailableRoute(route.status);
  const onset = pairs(truth, route.notes, tolerance, "onset");
  const exact = pairs(truth, route.notes, tolerance, "exact");
  const pitchClass = pairs(truth, route.notes, tolerance, "pitchClass");
  const octave = pairs(truth, route.notes.filter((note) => note.midi >= 0), tolerance, "pitchClass")
    .filter(({ left, right }) => truth[left]!.midi !== route.notes[right]!.midi && Math.abs(truth[left]!.midi - route.notes[right]!.midi) % 12 === 0);
  const octaveMetric = { ...metric(route.notes.length, truth.length, octave.length), errorRate: pitchClass.length ? round(octave.length / pitchClass.length) : null };
  const duration = songDuration ?? route.duration;
  return {
    status: "available", candidateCount: route.notes.length + route.invalidCount, invalidCount: route.invalidCount, duration,
    densityPerUnit: duration ? round((route.notes.length + route.invalidCount) / duration) : null,
    unsupportedPerUnit: duration ? round(route.invalidCount / duration) : null,
    onset: metric(route.notes.length + route.invalidCount, truth.length, onset.length),
    exact: metric(route.notes.length + route.invalidCount, truth.length, exact.length),
    pitchClass: metric(route.notes.length + route.invalidCount, truth.length, pitchClass.length),
    octave: octaveMetric,
  };
}

function complementarity(truthCount: number, basicPairs: readonly Pair[], gapsPairs: readonly Pair[]): ColdTransferComplementarity {
  const basic = new Set(basicPairs.map((pair) => pair.left));
  const gaps = new Set(gapsPairs.map((pair) => pair.left));
  const result = emptyComplementarity();
  for (let i = 0; i < truthCount; i += 1) {
    if (basic.has(i) && gaps.has(i)) result.both += 1;
    else if (basic.has(i)) result.basicOnly += 1;
    else if (gaps.has(i)) result.gapsOnly += 1;
    else result.neither += 1;
  }
  return result;
}

function overlap(basic: readonly ColdTransferNote[], gaps: readonly ColdTransferNote[], truth: readonly ColdTransferNote[], tolerance: number, kind: Kind, basicPairs: readonly Pair[], gapsPairs: readonly Pair[]): { overlap: ColdTransferPredictionOverlap; agreement: ColdTransferMetric } {
  const result = emptyOverlap();
  result.basicCount = basic.length; result.gapsCount = gaps.length;
  const shared = pairs(basic, gaps, tolerance, kind);
  result.matches = shared.length;
  const sharedBasic = new Set(shared.map((pair) => pair.left));
  const sharedGaps = new Set(shared.map((pair) => pair.right));
  const agreementCandidates = shared.map((pair) => basic[pair.left]!);
  const supportedBasicOnly = basicPairs.filter((pair) => !sharedBasic.has(pair.right)).length;
  const supportedGapsOnly = gapsPairs.filter((pair) => !sharedGaps.has(pair.right)).length;
  result.basicOnly = basic.length - result.matches;
  result.gapsOnly = gaps.length - result.matches;
  result.supportedBasicOnly = supportedBasicOnly;
  result.unsupportedBasicOnly = Math.max(0, result.basicOnly - supportedBasicOnly);
  result.supportedGapsOnly = supportedGapsOnly;
  result.unsupportedGapsOnly = Math.max(0, result.gapsOnly - supportedGapsOnly);
  // The agreement set uses Basic's representative and the same matcher.
  return { overlap: result, agreement: metric(agreementCandidates.length, truth.length, pairs(truth, agreementCandidates, tolerance, kind).length) };
}

function unionNotes(basic: readonly ColdTransferNote[], gaps: readonly ColdTransferNote[], tolerance: number, kind: Kind): ColdTransferNote[] {
  const result: ColdTransferNote[] = [];
  for (const candidate of [...basic, ...gaps].sort(noteOrder)) {
    const duplicate = result.some((prior) => Math.abs(prior.start - candidate.start) <= tolerance + EPS
      && Math.abs(prior.dur - candidate.dur) <= EPS
      && (kind === "onset" || kind === "exact" ? prior.midi === candidate.midi : prior.midi % 12 === candidate.midi % 12));
    if (!duplicate) result.push(candidate);
  }
  return result;
}

function delta(a: number | null, b: number | null): number | null { return a === null || b === null ? null : round(a - b); }

function classify(basic: ColdTransferRouteMetrics, gaps: ColdTransferRouteMetrics, thresholds: Required<Pick<ColdMetalTransferInput, "materialGain" | "catastrophicLoss" | "meaningfulPrecisionGain">>): ColdTransferClassification {
  if (basic.status !== "available" || gaps.status !== "available") return "unavailable";
  const exactGain = delta(gaps.exact.f1, basic.exact.f1) ?? -Infinity;
  const pcGain = delta(gaps.pitchClass.f1, basic.pitchClass.f1) ?? -Infinity;
  const precisionGain = delta(gaps.exact.precision, basic.exact.precision) ?? 0;
  const catastrophic = exactGain < -thresholds.catastrophicLoss || pcGain < -thresholds.catastrophicLoss;
  if (!catastrophic && exactGain >= thresholds.materialGain && pcGain >= thresholds.materialGain) return "gaps-wins";
  if (!catastrophic && precisionGain >= thresholds.meaningfulPrecisionGain && exactGain < thresholds.materialGain) return "precision-only";
  if (catastrophic || (exactGain >= thresholds.materialGain) !== (pcGain >= thresholds.materialGain)) return "mixed";
  return "no-transfer";
}

function strictCase(classifications: readonly ColdTransferClassification[]): ColdTransferCase {
  if (classifications.some((value) => value === "unavailable")) return "GAPS_COLD_TRANSFER_UNAVAILABLE";
  const wins = classifications.filter((value) => value === "gaps-wins").length;
  if (wins >= 2) return "GAPS_COLD_TRANSFER_VALIDATED";
  if (wins > 0 || classifications.some((value) => value === "precision-only" || value === "mixed")) return "GAPS_COLD_TRANSFER_MIXED";
  return "GAPS_CONTROLLED_ONLY";
}

function architecture(songs: readonly ColdTransferSongResult[], globalCase: ColdTransferCase): ColdTransferArchitecture {
  if (globalCase === "GAPS_COLD_TRANSFER_UNAVAILABLE") return "NO_PROMOTION";
  let basicOnly = 0, gapsOnly = 0;
  for (const song of songs) { basicOnly += song.complementarity.exact.basicOnly; gapsOnly += song.complementarity.exact.gapsOnly; }
  if (globalCase === "GAPS_COLD_TRANSFER_VALIDATED" && basicOnly <= gapsOnly) return "REPLACE_BASIC_PITCH";
  if (basicOnly > 0 && gapsOnly > 0) return globalCase === "GAPS_COLD_TRANSFER_MIXED" ? "TEXTURE_DEPENDENT" : "COMPLEMENT_BASIC_PITCH";
  return "NO_PROMOTION";
}

/** Evaluate all supplied songs. This function never reads files or invokes a model. */
export function evaluateColdMetalTransfer(input: ColdMetalTransferInput): ColdMetalTransferReport {
  if (!input || !Array.isArray(input.songs) || input.songs.length === 0) throw new Error("cold transfer songs must be non-empty");
  const tolerance = input.onsetTolerance ?? input.onsetToleranceBeats ?? 0.08;
  const thresholds = {
    materialGain: input.materialGain ?? 0.03,
    catastrophicLoss: input.catastrophicLoss ?? 0.1,
    meaningfulPrecisionGain: input.meaningfulPrecisionGain ?? 0.1,
  };
  if (![tolerance, thresholds.materialGain, thresholds.catastrophicLoss, thresholds.meaningfulPrecisionGain].every((value) => finite(value) && value >= 0)) throw new Error("cold transfer thresholds must be finite and non-negative");
  const ids = new Set<string>();
  const songs: ColdTransferSongResult[] = [...input.songs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((song): ColdTransferSongResult => {
    if (!song || typeof song.id !== "string" || !song.id.trim() || ids.has(song.id)) throw new Error("song IDs must be unique non-empty strings");
    ids.add(song.id);
    if (song.duration !== undefined && (!finite(song.duration) || song.duration <= 0)) throw new Error("song duration must be finite and positive");
    const truth = normalizeUpstreamTruth(song.truth).notes.map(({ midi, start, dur, sourceIndex }) => ({ midi, start, dur, sourceIndex }));
    const basicRoute = normalizeRoute(song.basic, `${song.id} basic`);
    const gapsRoute = normalizeRoute(song.gaps, `${song.id} gaps`);
    const basic = routeMetrics(truth, basicRoute, tolerance, song.duration);
    const gaps = routeMetrics(truth, gapsRoute, tolerance, song.duration);
    const kinds: Kind[] = ["onset", "exact", "pitchClass"];
    const complementarityResult = {} as Record<Kind, ColdTransferComplementarity>;
    const predictionOverlap = {} as Record<Kind, ColdTransferPredictionOverlap>;
    const union = {} as Record<Kind, ColdTransferMetric>;
    const intersectionAgreement = {} as Record<Kind, ColdTransferMetric>;
    for (const kind of kinds) {
      const bp = basicRoute.status === "available" ? pairs(truth, basicRoute.notes, tolerance, kind) : [];
      const gp = gapsRoute.status === "available" ? pairs(truth, gapsRoute.notes, tolerance, kind) : [];
      complementarityResult[kind] = complementarity(truth.length, bp, gp);
      const overlapResult = overlap(basicRoute.notes, gapsRoute.notes, truth, tolerance, kind, bp, gp);
      predictionOverlap[kind] = overlapResult.overlap;
      intersectionAgreement[kind] = overlapResult.agreement;
      const unionRoute = unionNotes(basicRoute.notes, gapsRoute.notes, tolerance, kind);
      union[kind] = metric(unionRoute.length, truth.length, pairs(truth, unionRoute, tolerance, kind).length);
    }
    const status: "available" | "unavailable" = basic.status === "available" && gaps.status === "available" ? "available" : "unavailable";
    const classification = classify(basic, gaps, thresholds);
    return {
      id: song.id, status, basic, gaps,
      deltas: {
        onset: delta(gaps.onset.f1, basic.onset.f1), exact: delta(gaps.exact.f1, basic.exact.f1), pitchClass: delta(gaps.pitchClass.f1, basic.pitchClass.f1),
        precision: delta(gaps.exact.precision, basic.exact.precision), recall: delta(gaps.exact.recall, basic.exact.recall), octaveError: delta(gaps.octave.errorRate, basic.octave.errorRate),
        candidateCountRatio: basic.candidateCount && gaps.candidateCount !== null ? round(gaps.candidateCount / basic.candidateCount) : null,
      },
      complementarity: { onset: complementarityResult.onset, exact: complementarityResult.exact, pitchClass: complementarityResult.pitchClass },
      predictionOverlap: { onset: predictionOverlap.onset, exact: predictionOverlap.exact, pitchClass: predictionOverlap.pitchClass },
      union: { onset: union.onset, exact: union.exact, pitchClass: union.pitchClass },
      intersection: { onset: intersectionAgreement.onset, exact: intersectionAgreement.exact, pitchClass: intersectionAgreement.pitchClass },
      intersectionAgreement: { onset: intersectionAgreement.onset, exact: intersectionAgreement.exact, pitchClass: intersectionAgreement.pitchClass },
      classification,
    };
  });
  const classifications = songs.map((song) => song.classification);
  const strict = strictCase(classifications);
  const availableSongs = songs.filter((song) => song.status === "available").length;
  const unavailableSongs = songs.length - availableSongs;
  return {
    schemaVersion: COLD_METAL_TRANSFER_SCHEMA_VERSION, kind: "metal-guitar-amt-transfer",
    evaluation: { timebase: input.timebase ?? "beats", onsetTolerance: tolerance, matching: "deterministic-maximum-cardinality-one-to-one", ...thresholds },
    songs,
    global: {
      caseClassification: classifications.length === 2 && classifications.some((value) => value === "gaps-wins") ? "gaps-wins" : strict,
      architectureClassification: classifications.some((value) => value === "unavailable")
        ? "insufficient-evidence"
        : classifications.length === 2 && classifications.some((value) => value === "gaps-wins") ? "gaps-transfer" : architecture(songs, strict),
      availableSongs, unavailableSongs,
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function canonicalColdMetalTransfer(report: ColdMetalTransferReport): string { return `${canonical(report)}\n`; }
export function hashCanonicalColdMetalTransfer(report: ColdMetalTransferReport): string { return createHash("sha256").update(canonicalColdMetalTransfer(report)).digest("hex"); }
