import type { Note, ParsedMidi } from "@keyspilli/midi";
import {
  normalizeSymbolicScore,
  type SymbolicScoreInput,
} from "./symbolic-alignment.js";

/** Input accepted by the local, I/O-free piano alignment helper. */
export type PianoScoreInput = SymbolicScoreInput | ParsedMidi;

export interface PianoAlignmentRegionInput {
  id: string;
  /** Reference and candidate bounds are in their own beat domains. */
  reference: [number, number];
  candidate: [number, number];
}

export interface PianoAlignmentOptions {
  onsetToleranceBeats?: number;
  /** Candidate beat = reference beat * tempoScale + offsetBeats. */
  tempoScales?: number[];
  /** Alias for tempoScales, useful to callers sharing symbolic options. */
  beatScales?: number[];
  globalTempoScales?: number[];
  /** Signed candidate-to-reference MIDI shift hypotheses. */
  transpositionSemitones?: number[];
  transpositions?: number[];
  /** Explicit offsets are useful when an intro is longer than the bounded search. */
  offsetBeats?: number[];
  introOffsetsBeats?: number[];
  maxIntroOffsetBeats?: number;
  maxOffsetBeats?: number;
  /** Maximum slope of a local piecewise mapping (the reciprocal is also bounded). */
  maxLocalTempoScale?: number;
  maxWarpSlope?: number;
  /** Maximum allowed residual from the fitted global relationship. */
  maxWarpBeats?: number;
  maxSegments?: number;
  minMatchedOnsets?: number;
  regions?: PianoAlignmentRegionInput[];
  /** Alias for regions. */
  windows?: PianoAlignmentRegionInput[];
}

export interface PianoAlignmentMappingPoint {
  referenceBeat: number;
  candidateBeat: number;
}

export interface PianoAlignmentMatch {
  referenceIndex: number;
  candidateIndex: number;
  referenceBeat: number;
  candidateBeat: number;
  onsetErrorBeats: number;
  pitchOverlap: number;
  exactPitch: boolean;
  transposedCandidateMidis: number[];
}

export interface PianoAlignmentSegment {
  reference: [number, number];
  candidate: [number, number];
  offsetBeats: number;
  tempoScale: number;
  matchedOnsets: number;
  confidence: number;
}

export interface PianoAlignmentRegionResult {
  id: string;
  reference: [number, number];
  candidate: [number, number];
  matchedOnsets: number;
  referenceOnsets: number;
  candidateOnsets: number;
  coverage: { referenceRatio: number; candidateRatio: number };
  confidence: number;
  onsetErrorBeats: { median: number | null; p90: number | null };
}

export interface PianoAlignmentResult {
  status: "aligned" | "partial" | "mismatch" | "insufficient-evidence" | "rejected";
  offsetBeats: number;
  tempoScale: number;
  /** Alias retained for consumers that use symbolic-alignment terminology. */
  beatScale: number;
  transpositionSemitones: number;
  mapping: PianoAlignmentMappingPoint[];
  segments: PianoAlignmentSegment[];
  regions: PianoAlignmentRegionResult[];
  matches: PianoAlignmentMatch[];
  coverage: {
    referenceRatio: number;
    candidateRatio: number;
    referenceOnsets: number;
    candidateOnsets: number;
  };
  confidence: number;
  diagnostics: string[];
}

interface OnsetGroup {
  start: number;
  notes: Note[];
  noteIndices: number[];
}

interface PathPair {
  reference: OnsetGroup;
  candidate: OnsetGroup;
  overlap: number;
  exact: boolean;
  timingError: number;
}

interface PathResult {
  pairs: PathPair[];
  score: number;
}

interface Hypothesis {
  scale: number;
  offset: number;
  transpose: number;
  path: PathResult;
  fittedScale: number;
  fittedOffset: number;
  residuals: number[];
  quality: number;
}

const EPS = 1e-9;
const DEFAULT_TOLERANCE = 0.08;
const DEFAULT_MAX_WARP = 1.5;
const DEFAULT_MAX_LOCAL_SCALE = 2;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function noteOrder(a: Note, b: Note): number {
  return a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || (a.hand ?? "").localeCompare(b.hand ?? "")
    || (a.identitySource ?? "").localeCompare(b.identitySource ?? "")
    || (a.lyrics ?? "").localeCompare(b.lyrics ?? "");
}

function onsetGroups(notes: readonly Note[], tolerance: number): OnsetGroup[] {
  const groups: OnsetGroup[] = [];
  notes.map((note, index) => ({ note, index })).sort((a, b) => noteOrder(a.note, b.note) || a.index - b.index)
    .forEach(({ note, index }) => {
      const previous = groups.at(-1);
      if (previous && note.start - previous.start <= tolerance + EPS) {
        previous.notes.push(note);
        previous.noteIndices.push(index);
      } else {
        groups.push({ start: note.start, notes: [note], noteIndices: [index] });
      }
    });
  return groups;
}

function uniqueSorted(values: readonly number[], fallback: number[], low = -Infinity, high = Infinity): number[] {
  const valuesInRange = values.filter((value) => finite(value) && value >= low - EPS && value <= high + EPS)
    .map((value) => round(value, 6));
  const result = [...new Set(valuesInRange)].sort((a, b) => a - b);
  return result.length ? result : fallback;
}

function pitchOverlap(reference: OnsetGroup, candidate: OnsetGroup, transpose: number): { overlap: number; exact: boolean } {
  const remaining = candidate.notes.map((note) => note.midi + transpose);
  let matched = 0;
  for (const referenceNote of reference.notes) {
    const index = remaining.indexOf(referenceNote.midi);
    if (index < 0) continue;
    matched += 1;
    remaining.splice(index, 1);
  }
  const denominator = Math.max(reference.notes.length, candidate.notes.length, 1);
  return { overlap: matched / denominator, exact: matched === reference.notes.length && matched === candidate.notes.length };
}

function candidateScales(options: PianoAlignmentOptions): number[] {
  const requested = options.tempoScales ?? options.beatScales ?? options.globalTempoScales;
  return uniqueSorted(requested ?? [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25], [1], 0.25, 4)
    .filter((scale) => scale > 0);
}

function candidateTranspositions(options: PianoAlignmentOptions): number[] {
  return uniqueSorted(options.transpositionSemitones ?? options.transpositions ?? Array.from({ length: 25 }, (_, index) => index - 12), [0], -24, 24)
    .filter((transpose) => Number.isInteger(transpose));
}

function validRegion(region: PianoAlignmentRegionInput | undefined): region is PianoAlignmentRegionInput {
  return Boolean(region && typeof region.id === "string" && region.id.length > 0
    && Array.isArray(region.reference) && region.reference.length === 2
    && Array.isArray(region.candidate) && region.candidate.length === 2
    && region.reference.every(finite) && region.candidate.every(finite)
    && region.reference[0]! >= 0 && region.candidate[0]! >= 0
    && region.reference[1]! > region.reference[0]! && region.candidate[1]! > region.candidate[0]!);
}

function normalizedRegions(options: PianoAlignmentOptions, referenceDuration: number, candidateDuration: number): { regions: PianoAlignmentRegionInput[]; invalid: number } {
  const requested = options.regions ?? options.windows;
  if (!requested?.length) {
    return {
      regions: [{ id: "whole", reference: [0, referenceDuration], candidate: [0, candidateDuration] }],
      invalid: 0,
    };
  }
  const regions = requested.filter(validRegion).map((region) => ({
    id: region.id,
    reference: [region.reference[0]!, region.reference[1]!] as [number, number],
    candidate: [region.candidate[0]!, region.candidate[1]!] as [number, number],
  })).sort((a, b) => a.id.localeCompare(b.id)
    || a.reference[0]! - b.reference[0]!
    || a.candidate[0]! - b.candidate[0]!);
  return { regions, invalid: requested.length - regions.length };
}

function inRange(value: number, range: [number, number]): boolean {
  return value >= range[0]! - EPS && value < range[1]! - EPS;
}

function affineFit(pairs: readonly PathPair[]): { scale: number; offset: number; residuals: number[] } {
  if (!pairs.length) return { scale: 1, offset: 0, residuals: [] };
  if (pairs.length === 1) {
    const pair = pairs[0]!;
    return { scale: 1, offset: pair.candidate.start - pair.reference.start, residuals: [0] };
  }
  const meanReference = pairs.reduce((sum, pair) => sum + pair.reference.start, 0) / pairs.length;
  const meanCandidate = pairs.reduce((sum, pair) => sum + pair.candidate.start, 0) / pairs.length;
  const denominator = pairs.reduce((sum, pair) => sum + (pair.reference.start - meanReference) ** 2, 0);
  const scale = denominator > EPS
    ? pairs.reduce((sum, pair) => sum + (pair.reference.start - meanReference) * (pair.candidate.start - meanCandidate), 0) / denominator
    : 1;
  const offset = meanCandidate - scale * meanReference;
  return { scale, offset, residuals: pairs.map((pair) => Math.abs(pair.candidate.start - (pair.reference.start * scale + offset))) };
}

function pathForHypothesis(
  references: readonly OnsetGroup[],
  candidates: readonly OnsetGroup[],
  scale: number,
  offset: number,
  transpose: number,
  maxWarp: number,
): PathResult {
  const rows = references.length + 1;
  const cols = candidates.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(Number.NEGATIVE_INFINITY));
  const actions = Array.from({ length: rows }, () => Array<"match" | "skip-reference" | "skip-candidate" | undefined>(cols));
  const gap = -0.85;
  dp[0]![0] = 0;
  for (let i = 1; i < rows; i += 1) {
    dp[i]![0] = dp[i - 1]![0]! + gap;
    actions[i]![0] = "skip-reference";
  }
  for (let j = 1; j < cols; j += 1) {
    dp[0]![j] = dp[0]![j - 1]! + gap;
    actions[0]![j] = "skip-candidate";
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const reference = references[i - 1]!;
      const candidate = candidates[j - 1]!;
      const pitch = pitchOverlap(reference, candidate, transpose);
      const residual = Math.abs(candidate.start - (reference.start * scale + offset));
      const timingPenalty = Math.min(2, residual / Math.max(maxWarp, 0.05)) * 0.22;
      const matchScore = pitch.overlap > 0 ? pitch.overlap * 2 - timingPenalty : Number.NEGATIVE_INFINITY;
      const matchValue = dp[i - 1]![j - 1]! + matchScore;
      const skipReference = dp[i - 1]![j]! + gap;
      const skipCandidate = dp[i]![j - 1]! + gap;
      // Deterministic tie order prefers a match, then consuming reference time,
      // then consuming candidate time.
      let value = matchValue;
      let action: "match" | "skip-reference" | "skip-candidate" = "match";
      if (skipReference > value + EPS) { value = skipReference; action = "skip-reference"; }
      if (skipCandidate > value + EPS) { value = skipCandidate; action = "skip-candidate"; }
      dp[i]![j] = value;
      actions[i]![j] = action;
    }
  }
  const pairs: PathPair[] = [];
  let i = references.length;
  let j = candidates.length;
  while (i > 0 || j > 0) {
    const action = actions[i]![j];
    if (action === "match" && i > 0 && j > 0) {
      const reference = references[i - 1]!;
      const candidate = candidates[j - 1]!;
      const pitch = pitchOverlap(reference, candidate, transpose);
      pairs.push({ reference, candidate, overlap: pitch.overlap, exact: pitch.exact, timingError: Math.abs(candidate.start - (reference.start * scale + offset)) });
      i -= 1;
      j -= 1;
    } else if (action === "skip-reference" && i > 0) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }
  pairs.reverse();
  return { pairs, score: dp[references.length]![candidates.length]! };
}

function makeOffsets(
  references: readonly OnsetGroup[],
  candidates: readonly OnsetGroup[],
  scales: readonly number[],
  transpositions: readonly number[],
  options: PianoAlignmentOptions,
): number[] {
  const explicit = options.offsetBeats ?? options.introOffsetsBeats;
  if (explicit?.length) return uniqueSorted(explicit, [0]);
  const maxOffset = clamp(finite(options.maxIntroOffsetBeats)
    ? options.maxIntroOffsetBeats!
    : finite(options.maxOffsetBeats) ? options.maxOffsetBeats! : 16, 0, 128);
  const offsets = new Set<number>([0]);
  for (const scale of scales) {
    for (const transpose of transpositions) {
      for (const reference of references.slice(0, 12)) {
        for (const candidate of candidates.slice(0, 32)) {
          if (pitchOverlap(reference, candidate, transpose).overlap <= 0) continue;
          const offset = candidate.start - reference.start * scale;
          if (Math.abs(offset) <= maxOffset + EPS) offsets.add(round(offset, 3));
        }
      }
    }
  }
  return [...offsets].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).slice(0, 64).sort((a, b) => a - b);
}

function buildMatches(pairs: readonly PathPair[], transpose: number): PianoAlignmentMatch[] {
  return pairs.flatMap((pair) => {
    const referenceIndex = pair.reference.noteIndices[0];
    const candidateIndex = pair.candidate.noteIndices[0];
    if (referenceIndex === undefined || candidateIndex === undefined) return [];
    return [{
      referenceIndex,
      candidateIndex,
      referenceBeat: round(pair.reference.start),
      candidateBeat: round(pair.candidate.start),
      onsetErrorBeats: round(pair.timingError),
      pitchOverlap: round(pair.overlap),
      exactPitch: pair.exact,
      transposedCandidateMidis: pair.candidate.notes.map((note) => note.midi + transpose).sort((a, b) => a - b),
    }];
  });
}

function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(low === high ? sorted[low]! : sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function buildSegments(pairs: readonly PathPair[], maxSegments: number, maxLocalScale: number): PianoAlignmentSegment[] {
  if (pairs.length < 2) return pairs.length ? [{
    reference: [round(pairs[0]!.reference.start), round(pairs[0]!.reference.start)] as [number, number],
    candidate: [round(pairs[0]!.candidate.start), round(pairs[0]!.candidate.start)] as [number, number],
    offsetBeats: round(pairs[0]!.candidate.start - pairs[0]!.reference.start),
    tempoScale: 1,
    matchedOnsets: 1,
    confidence: round(pairs[0]!.overlap),
  }] : [];
  const slopes = pairs.slice(1).map((pair, index) => {
    const previous = pairs[index]!;
    return (pair.candidate.start - previous.candidate.start) / (pair.reference.start - previous.reference.start);
  });
  const boundaries: number[] = [0];
  for (let index = 1; index < slopes.length && boundaries.length < Math.max(1, maxSegments); index += 1) {
    if (Math.abs(slopes[index]! - slopes[index - 1]!) > 0.06) boundaries.push(index);
  }
  boundaries.push(pairs.length - 1);
  const deduped = [...new Set(boundaries)].sort((a, b) => a - b);
  const segments: PianoAlignmentSegment[] = [];
  for (let boundary = 0; boundary < deduped.length - 1; boundary += 1) {
    const start = deduped[boundary]!;
    const end = deduped[boundary + 1]!;
    const slice = pairs.slice(start, end + 1);
    const fit = affineFit(slice);
    segments.push({
      reference: [round(slice[0]!.reference.start), round(slice.at(-1)!.reference.start)] as [number, number],
      candidate: [round(slice[0]!.candidate.start), round(slice.at(-1)!.candidate.start)] as [number, number],
      offsetBeats: round(fit.offset),
      tempoScale: round(clamp(fit.scale, 1 / maxLocalScale, maxLocalScale)),
      matchedOnsets: slice.length,
      confidence: round(slice.reduce((sum, pair) => sum + pair.overlap, 0) / slice.length),
    });
  }
  // If the drift has many tiny changes, retain a bounded number of segments by
  // merging adjacent segments with the least difference in local slope.
  while (segments.length > Math.max(1, maxSegments)) {
    let mergeAt = 0;
    let bestDifference = Infinity;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const difference = Math.abs(segments[index]!.tempoScale - segments[index + 1]!.tempoScale);
      if (difference < bestDifference - EPS) { bestDifference = difference; mergeAt = index; }
    }
    const left = segments[mergeAt]!;
    const right = segments[mergeAt + 1]!;
    const mergedPairs = pairs.filter((pair) => pair.reference.start >= left.reference[0]! - EPS && pair.reference.start <= right.reference[1]! + EPS);
    const fit = affineFit(mergedPairs);
    segments.splice(mergeAt, 2, {
      reference: [left.reference[0]!, right.reference[1]!] as [number, number],
      candidate: [left.candidate[0]!, right.candidate[1]!] as [number, number],
      offsetBeats: round(fit.offset),
      tempoScale: round(clamp(fit.scale, 1 / maxLocalScale, maxLocalScale)),
      matchedOnsets: mergedPairs.length,
      confidence: round(mergedPairs.reduce((sum, pair) => sum + pair.overlap, 0) / Math.max(1, mergedPairs.length)),
    });
  }
  return segments;
}

function regionResults(
  regions: readonly PianoAlignmentRegionInput[],
  references: readonly OnsetGroup[],
  candidates: readonly OnsetGroup[],
  pairs: readonly PathPair[],
): PianoAlignmentRegionResult[] {
  return regions.map((region) => {
    const ref = references.filter((group) => inRange(group.start, region.reference));
    const cand = candidates.filter((group) => inRange(group.start, region.candidate));
    const matched = pairs.filter((pair) => inRange(pair.reference.start, region.reference) && inRange(pair.candidate.start, region.candidate));
    const errors = matched.map((pair) => pair.timingError);
    const referenceRatio = ref.length ? matched.length / ref.length : 0;
    const candidateRatio = cand.length ? matched.length / cand.length : 0;
    const pitch = matched.length ? matched.reduce((sum, pair) => sum + pair.overlap, 0) / matched.length : 0;
    const confidence = clamp(referenceRatio * 0.4 + candidateRatio * 0.2 + pitch * 0.3 + (errors.length ? Math.max(0, 1 - (quantile(errors, 0.5)! / 1.5)) * 0.1 : 0), 0, 1);
    return {
      id: region.id,
      reference: region.reference,
      candidate: region.candidate,
      matchedOnsets: matched.length,
      referenceOnsets: ref.length,
      candidateOnsets: cand.length,
      coverage: { referenceRatio: round(referenceRatio), candidateRatio: round(candidateRatio) },
      confidence: round(confidence),
      onsetErrorBeats: { median: quantile(errors, 0.5), p90: quantile(errors, 0.9) },
    };
  });
}

function emptyResult(referenceCount: number, candidateCount: number, diagnostics: string[], status: PianoAlignmentResult["status"]): PianoAlignmentResult {
  return {
    status,
    offsetBeats: 0,
    tempoScale: 1,
    beatScale: 1,
    transpositionSemitones: 0,
    mapping: [],
    segments: [],
    regions: [],
    matches: [],
    coverage: { referenceRatio: 0, candidateRatio: 0, referenceOnsets: referenceCount, candidateOnsets: candidateCount },
    confidence: 0,
    diagnostics,
  };
}

/**
 * Align two piano scores using a bounded affine hypothesis search followed by
 * monotonic onset DP. It never performs I/O and rejects implausible local
 * timing slopes rather than returning a high-scoring pathological warp.
 */
export function alignPianoCandidates(
  referenceInput: PianoScoreInput,
  candidateInput: PianoScoreInput,
  options: PianoAlignmentOptions = {},
): PianoAlignmentResult {
  const reference = normalizeSymbolicScore(referenceInput);
  const candidate = normalizeSymbolicScore(candidateInput);
  const tolerance = clamp(finite(options.onsetToleranceBeats) ? options.onsetToleranceBeats! : DEFAULT_TOLERANCE, 0.001, 1);
  const maxWarp = clamp(finite(options.maxWarpBeats) ? options.maxWarpBeats! : DEFAULT_MAX_WARP, 0.05, 16);
  const maxLocalScale = clamp(finite(options.maxLocalTempoScale)
    ? options.maxLocalTempoScale!
    : finite(options.maxWarpSlope) ? options.maxWarpSlope! : DEFAULT_MAX_LOCAL_SCALE, 1.01, 8);
  const references = onsetGroups(reference.notes, tolerance);
  const candidates = onsetGroups(candidate.notes, tolerance);
  if (!references.length || !candidates.length) return emptyResult(references.length, candidates.length, ["reference and candidate require at least one onset"], "insufficient-evidence");
  const normalizedRegionsResult = normalizedRegions(options, reference.durationBeats, candidate.durationBeats);
  if (!normalizedRegionsResult.regions.length) return emptyResult(references.length, candidates.length, ["all supplied piano alignment regions are invalid"], "insufficient-evidence");
  const scales = candidateScales(options);
  const transpositions = candidateTranspositions(options);
  const offsets = makeOffsets(references, candidates, scales, transpositions, options);
  const hypotheses: Hypothesis[] = [];
  for (const scale of scales) for (const offset of offsets) for (const transpose of transpositions) {
    const path = pathForHypothesis(references, candidates, scale, offset, transpose, maxWarp);
    if (!path.pairs.length) continue;
    const fit = affineFit(path.pairs);
    const quality = path.pairs.reduce((sum, pair) => sum + pair.overlap, 0) / path.pairs.length;
    hypotheses.push({ scale, offset, transpose, path, fittedScale: fit.scale, fittedOffset: fit.offset, residuals: fit.residuals, quality });
  }
  hypotheses.sort((a, b) => b.path.pairs.length - a.path.pairs.length
    || b.quality - a.quality
    || (a.residuals.reduce((sum, value) => sum + value, 0) - b.residuals.reduce((sum, value) => sum + value, 0))
    || Math.abs(a.transpose) - Math.abs(b.transpose)
    || Math.abs(a.fittedOffset) - Math.abs(b.fittedOffset)
    || a.fittedScale - b.fittedScale
    || a.transpose - b.transpose);
  const best = hypotheses[0];
  if (!best) return emptyResult(references.length, candidates.length, ["insufficient onset and pitch evidence for alignment"], "insufficient-evidence");
  const localSlopes = best.path.pairs.slice(1).map((pair, index) => {
    const previous = best.path.pairs[index]!;
    return (pair.candidate.start - previous.candidate.start) / (pair.reference.start - previous.reference.start);
  });
  const pathologicalSlope = localSlopes.some((slope) => !finite(slope) || slope <= 0 || slope < 1 / maxLocalScale - EPS || slope > maxLocalScale + EPS);
  const pathologicalResidual = best.residuals.some((residual) => residual > maxWarp + EPS);
  if (pathologicalSlope || pathologicalResidual) {
    return emptyResult(references.length, candidates.length, ["pathological timing warp rejected"] , "rejected");
  }
  const pairs = best.path.pairs;
  const matches = buildMatches(pairs, best.transpose);
  const mapping = pairs.map((pair) => ({ referenceBeat: round(pair.reference.start), candidateBeat: round(pair.candidate.start) }));
  const referenceRatio = pairs.length / references.length;
  const candidateRatio = pairs.length / candidates.length;
  const regions = regionResults(normalizedRegionsResult.regions, references, candidates, pairs);
  const segments = buildSegments(pairs, Math.max(1, Math.floor(options.maxSegments ?? 8)), maxLocalScale);
  const medianResidual = quantile(best.residuals, 0.5) ?? maxWarp;
  const confidence = round(clamp(referenceRatio * 0.32 + candidateRatio * 0.18 + best.quality * 0.35 + Math.max(0, 1 - medianResidual / maxWarp) * 0.15, 0, 1));
  const minMatched = Math.max(1, Math.floor(options.minMatchedOnsets ?? 2));
  const diagnostics: string[] = [];
  if (normalizedRegionsResult.invalid) diagnostics.push(`ignored ${normalizedRegionsResult.invalid} invalid piano alignment region${normalizedRegionsResult.invalid === 1 ? "" : "s"}`);
  if (Math.abs(best.fittedScale - 1) > 0.02) diagnostics.push(`global tempo relationship selected (${round(best.fittedScale)})`);
  if (Math.abs(best.fittedOffset) > tolerance) diagnostics.push(`intro offset selected (${round(best.fittedOffset)})`);
  if (segments.length > 1) diagnostics.push(`bounded piecewise timing drift represented by ${segments.length} segments`);
  let status: PianoAlignmentResult["status"];
  if (pairs.length < minMatched || confidence < 0.2) status = "insufficient-evidence";
  else if (best.quality < 0.55) status = "mismatch";
  else if (referenceRatio < 0.98 || candidateRatio < 0.98 || regions.some((region) => region.coverage.referenceRatio < 0.98)) status = "partial";
  else status = "aligned";
  return {
    status,
    offsetBeats: round(best.fittedOffset),
    tempoScale: round(best.fittedScale),
    beatScale: round(best.fittedScale),
    transpositionSemitones: best.transpose,
    mapping,
    segments,
    regions,
    matches,
    coverage: { referenceRatio: round(referenceRatio), candidateRatio: round(candidateRatio), referenceOnsets: references.length, candidateOnsets: candidates.length },
    confidence,
    diagnostics,
  };
}

/** Descriptive aliases for callers that use score terminology. */
export const alignPianoScores = alignPianoCandidates;
export const alignPianoSymbolic = alignPianoCandidates;
export const alignPianoSymbolicScores = alignPianoCandidates;
export const alignSymbolicPianoCandidates = alignPianoCandidates;
