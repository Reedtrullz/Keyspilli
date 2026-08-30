/**
 * Engine-neutral symbolic score primitives for OMR evaluation.
 *
 * This module deliberately depends only on the existing OMR input types. It
 * has no parser, database, filesystem, or runtime-engine dependency. The
 * notation events retain source topology and tie spelling for diagnostics;
 * performed tokens are the content-only representation used for comparison.
 */

import { normalizeOmrScore, type OmrRole, type OmrScoreInput } from "./omr-consensus.js";
import type { OmrNormalizedEvent, OmrNormalizedMeasure } from "./omr-consensus.js";

export const OMR_CANONICAL_SCHEMA_VERSION = "omr-canonical-v1" as const;
const MAX_RATIONAL_DENOMINATOR = 1_000_000;
const RATIONAL_EPSILON = 1e-10;

export interface RationalBeat {
  numerator: number;
  denominator: number;
}

export interface CanonicalTie {
  start: boolean;
  stop: boolean;
  continue: boolean;
}

export interface CanonicalEventSource {
  partId: string;
  measureId: string;
  measureNumber: string;
  partIndex: number;
  measureIndex: number;
  page: number | null;
  system: number | null;
  staff: number | null;
  voice: string | null;
  role: OmrRole | null;
}

export interface CanonicalNotationSegment {
  eventId: string;
  measureId: string;
  onset: RationalBeat;
  duration: RationalBeat;
  tie: CanonicalTie;
}

export interface CanonicalNotationEvent {
  id: string;
  type: "note" | "rest";
  /** Absolute score beat. */
  onset: RationalBeat;
  /** Beat offset relative to the containing measure. */
  measureOnset: RationalBeat;
  duration: RationalBeat;
  midi: number | null;
  pitchClass: number | null;
  /** MusicXML accidental spelling, kept independent from sounding pitch. */
  accidental: string | null;
  spelling: string | null;
  tie: CanonicalTie;
  tuplet: boolean;
  source: CanonicalEventSource;
}

export interface CanonicalPerformedToken {
  id: string;
  type: "note" | "rest";
  onset: RationalBeat;
  duration: RationalBeat;
  midi: number | null;
  pitchClass: number | null;
  /** The first segment's spelling; all segment spellings remain in diagnostics. */
  accidental: string | null;
  spelling: string | null;
  measureId: string;
  partId: string;
  notationSegments: CanonicalNotationSegment[];
  notationSpellings: Array<string | null>;
  tie: CanonicalTie;
}

export interface CanonicalMeasure {
  id: string;
  partId: string;
  partIndex: number;
  index: number;
  number: string;
  page: number | null;
  system: number | null;
  startBeat: RationalBeat;
  durationBeats: RationalBeat;
  timeSignature: [number, number] | null;
  keySignature: number | null;
  implicit: boolean;
  notationEvents: CanonicalNotationEvent[];
  performedTokens: CanonicalPerformedToken[];
  /** A content-only signature; source ids, roles, staves, and voices are omitted. */
  fingerprint: string;
}

export interface CanonicalScore {
  schemaVersion: typeof OMR_CANONICAL_SCHEMA_VERSION;
  title: string | null;
  tempoBpm: number | null;
  timeSignature: [number, number] | null;
  keySignature: number | null;
  parts: Array<{ id: string; name: string | null; role: OmrRole | null; measureIds: string[] }>;
  measures: CanonicalMeasure[];
  notationEvents: CanonicalNotationEvent[];
  performedTokens: CanonicalPerformedToken[];
  warnings: string[];
}

export interface CanonicalTokenComparison {
  equal: boolean;
  /** Semantic distance: pitch and performed rhythm only. */
  distance: number;
  agreement: number;
  pitchDistance: number;
  rhythmDistance: number;
  spellingDistance: number;
  /** Performed tokens have no tie boundary penalty; notation diagnostics are separate. */
  continuityDistance: number;
  notationTieDistance: number;
  matched: number;
  unmatchedReference: number;
  unmatchedCandidate: number;
  disagreements: Array<"pitch" | "rhythm" | "spelling" | "tie-notation" | "insert" | "delete">;
}

function integer(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("rational beat exceeds safe integer range");
  return value;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

/** Construct a reduced, positive-denominator beat fraction. */
export function rationalBeat(numerator: number, denominator = 1): RationalBeat {
  integer(numerator);
  integer(denominator);
  if (denominator === 0) throw new Error("rational beat denominator must be non-zero");
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: Math.abs(denominator) / divisor };
}

function continuedFraction(value: number): RationalBeat {
  const sign = value < 0 ? -1 : 1;
  let remainder = Math.abs(value);
  let previousNumerator = 0;
  let numerator = 1;
  let previousDenominator = 1;
  let denominator = 0;
  let best = rationalBeat(Math.round(value), 1);
  for (let index = 0; index < 32 && Number.isFinite(remainder); index += 1) {
    const coefficient = Math.floor(remainder);
    const nextNumerator = coefficient * numerator + previousNumerator;
    const nextDenominator = coefficient * denominator + previousDenominator;
    if (nextDenominator > MAX_RATIONAL_DENOMINATOR || !Number.isSafeInteger(nextNumerator)) break;
    const candidate = rationalBeat(sign * nextNumerator, nextDenominator);
    best = candidate;
    if (Math.abs(value - candidate.numerator / candidate.denominator) <= RATIONAL_EPSILON) return candidate;
    const fraction = remainder - coefficient;
    if (fraction <= Number.EPSILON) break;
    previousNumerator = numerator;
    numerator = nextNumerator;
    previousDenominator = denominator;
    denominator = nextDenominator;
    remainder = 1 / fraction;
  }
  return best;
}

/** Convert a finite source beat to a stable reduced fraction. */
export function rationalBeatFrom(value: number | RationalBeat): RationalBeat {
  if (typeof value !== "number") return rationalBeat(value.numerator, value.denominator);
  if (!Number.isFinite(value)) throw new Error("beat must be finite");
  if (Number.isInteger(value)) return rationalBeat(value, 1);
  const decimal = value.toString();
  const decimalMatch = decimal.match(/^(-?)(\d+)\.(\d{1,6})$/);
  if (decimalMatch) {
    const sign = decimalMatch[1] === "-" ? -1 : 1;
    const fractionDigits = decimalMatch[3]!;
    const denominator = 10 ** fractionDigits.length;
    return rationalBeat(sign * (Number(decimalMatch[2]!) * denominator + Number(fractionDigits)), denominator);
  }
  return continuedFraction(value);
}

export function rationalBeatKey(value: RationalBeat): string {
  return `${value.numerator}/${value.denominator}`;
}

export function rationalBeatToNumber(value: RationalBeat): number {
  return value.numerator / value.denominator;
}

function compareRational(left: RationalBeat, right: RationalBeat): number {
  const difference = BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function equalRational(left: RationalBeat, right: RationalBeat): boolean {
  return compareRational(left, right) === 0;
}

function addRational(left: RationalBeat, right: RationalBeat): RationalBeat {
  const divisor = gcd(left.denominator, right.denominator);
  const numerator = left.numerator * (right.denominator / divisor) + right.numerator * (left.denominator / divisor);
  const denominator = (left.denominator / divisor) * right.denominator;
  return rationalBeat(numerator, denominator);
}

function subtractRational(left: RationalBeat, right: RationalBeat): RationalBeat {
  return addRational(left, rationalBeat(-right.numerator, right.denominator));
}

function tieFromEvent(event: OmrNormalizedEvent): CanonicalTie {
  return { start: event.tie.start, stop: event.tie.stop, continue: event.tie.continue };
}

function tieKey(tie: CanonicalTie): string {
  return `${tie.start ? "s" : ""}${tie.stop ? "e" : ""}${tie.continue ? "c" : ""}`;
}

function sourceEventCompare(left: CanonicalNotationEvent, right: CanonicalNotationEvent): number {
  return compareRational(left.onset, right.onset)
    || (left.type === right.type ? 0 : left.type === "rest" ? -1 : 1)
    || (left.midi ?? Number.MAX_SAFE_INTEGER) - (right.midi ?? Number.MAX_SAFE_INTEGER)
    || compareRational(left.duration, right.duration)
    || ((left.accidental ?? "") < (right.accidental ?? "") ? -1 : (left.accidental ?? "") > (right.accidental ?? "") ? 1 : 0)
    || (tieKey(left.tie) < tieKey(right.tie) ? -1 : tieKey(left.tie) > tieKey(right.tie) ? 1 : 0)
    || (left.source.staff ?? Number.MAX_SAFE_INTEGER) - (right.source.staff ?? Number.MAX_SAFE_INTEGER)
    || (((left.source.voice ?? "") < (right.source.voice ?? "")) ? -1 : ((left.source.voice ?? "") > (right.source.voice ?? "")) ? 1 : 0);
}

function tokenCompare(left: CanonicalPerformedToken, right: CanonicalPerformedToken): number {
  return compareRational(left.onset, right.onset)
    || (left.type === right.type ? 0 : left.type === "rest" ? -1 : 1)
    || (left.midi ?? Number.MAX_SAFE_INTEGER) - (right.midi ?? Number.MAX_SAFE_INTEGER)
    || compareRational(left.duration, right.duration)
    || ((left.accidental ?? "") < (right.accidental ?? "") ? -1 : (left.accidental ?? "") > (right.accidental ?? "") ? 1 : 0);
}

function eventFromNormalized(event: OmrNormalizedEvent, measure: OmrNormalizedMeasure): CanonicalNotationEvent {
  const measureStart = rationalBeatFrom(measure.startBeat);
  const localOnset = rationalBeatFrom(event.onset);
  const midi = event.pitch;
  return {
    id: "",
    type: "note",
    onset: addRational(measureStart, localOnset),
    measureOnset: localOnset,
    duration: rationalBeatFrom(event.duration),
    midi,
    pitchClass: ((midi % 12) + 12) % 12,
    accidental: event.accidental,
    spelling: event.accidental,
    tie: tieFromEvent(event),
    tuplet: event.tuplet,
    source: {
      partId: event.partId,
      measureId: event.measureId,
      measureNumber: measure.number,
      partIndex: measure.partIndex,
      measureIndex: measure.index,
      page: measure.page,
      system: measure.system,
      staff: event.staff,
      voice: event.voice,
      role: event.role,
    },
  };
}

function restEvent(onset: number, duration: number, measure: OmrNormalizedMeasure, index: number): CanonicalNotationEvent {
  const measureOnset = rationalBeatFrom(onset);
  return {
    id: `rest-${index}`,
    type: "rest",
    onset: addRational(rationalBeatFrom(measure.startBeat), measureOnset),
    measureOnset,
    duration: rationalBeatFrom(duration),
    midi: null,
    pitchClass: null,
    accidental: null,
    spelling: null,
    tie: { start: false, stop: false, continue: false },
    tuplet: false,
    source: {
      partId: measure.partId,
      measureId: measure.id,
      measureNumber: measure.number,
      partIndex: measure.partIndex,
      measureIndex: measure.index,
      page: measure.page,
      system: measure.system,
      staff: null,
      voice: null,
      role: null,
    },
  };
}

function tokenFromEvent(event: CanonicalNotationEvent): CanonicalPerformedToken {
  return {
    id: "",
    type: event.type,
    onset: event.onset,
    duration: event.duration,
    midi: event.midi,
    pitchClass: event.pitchClass,
    accidental: event.accidental,
    spelling: event.spelling,
    measureId: event.source.measureId,
    partId: event.source.partId,
    notationSegments: [{ eventId: event.id, measureId: event.source.measureId, onset: event.onset, duration: event.duration, tie: event.tie }],
    notationSpellings: [event.spelling],
    tie: { ...event.tie },
  };
}

function tokenKey(event: CanonicalNotationEvent): string {
  return `${event.source.partId}|${event.midi ?? "rest"}|${event.source.staff ?? ""}|${event.source.voice ?? ""}`;
}

function tokenEnd(token: CanonicalPerformedToken): RationalBeat {
  return addRational(token.onset, token.duration);
}

function collapsePerformedTokens(events: readonly CanonicalNotationEvent[], warnings: string[]): CanonicalPerformedToken[] {
  const tokens: CanonicalPerformedToken[] = [];
  const active = new Map<string, CanonicalPerformedToken[]>();
  for (const event of events) {
    if (event.type === "rest") {
      tokens.push(tokenFromEvent(event));
      continue;
    }
    const key = tokenKey(event);
    const candidates = active.get(key) ?? [];
    let token: CanonicalPerformedToken | undefined;
    if (event.tie.stop || event.tie.continue) {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index]!;
        if (equalRational(tokenEnd(candidate), event.onset)) {
          token = candidate;
          candidates.splice(index, 1);
          break;
        }
      }
      if (!token && event.tie.stop) warnings.push(`unmatched tie stop at ${event.source.measureId}:${rationalBeatKey(event.measureOnset)}`);
    }
    if (!token) {
      token = tokenFromEvent(event);
      tokens.push(token);
    } else {
      token.duration = subtractRational(addRational(event.onset, event.duration), token.onset);
      token.notationSegments.push({ eventId: event.id, measureId: event.source.measureId, onset: event.onset, duration: event.duration, tie: event.tie });
      token.notationSpellings.push(event.spelling);
      token.tie = {
        start: token.tie.start || event.tie.start,
        stop: token.tie.stop || event.tie.stop,
        continue: token.tie.continue || event.tie.continue,
      };
    }
    if (event.tie.start || event.tie.continue) candidates.push(token);
    if (candidates.length) active.set(key, candidates);
    else active.delete(key);
  }
  return tokens.sort(tokenCompare);
}

function hashFingerprint(material: string): string {
  // FNV-1a is small, deterministic, and available in every JS runtime; this
  // avoids making the pure representation depend on Node's crypto module.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= BigInt(material.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function measureFingerprint(measure: CanonicalMeasure): string {
  const start = measure.startBeat;
  const tokens = measure.performedTokens
    .map((token) => {
      const localOnset = subtractRational(token.onset, start);
      return [
        token.type,
        rationalBeatKey(localOnset),
        rationalBeatKey(token.duration),
        token.pitchClass === null ? "" : String(token.pitchClass),
      ].join(":");
    })
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const material = [
    OMR_CANONICAL_SCHEMA_VERSION,
    rationalBeatKey(measure.durationBeats),
    measure.timeSignature ? `${measure.timeSignature[0]}/${measure.timeSignature[1]}` : "",
    String(measure.keySignature ?? ""),
    tokens.join(","),
  ].join("|");
  return hashFingerprint(material);
}

/** Normalize an OMR score into notation events and performed-duration tokens. */
export function normalizeCanonicalScore(input: OmrScoreInput): CanonicalScore {
  const normalized = normalizeOmrScore(input);
  const measures: CanonicalMeasure[] = [];
  const notationEvents: CanonicalNotationEvent[] = [];
  for (const measure of normalized.measures) {
    const events = measure.events.map((event) => eventFromNormalized(event, measure));
    const rests = measure.rests.map((rest, index) => restEvent(rest.onset, rest.duration, measure, index));
    const allEvents = [...events, ...rests].sort(sourceEventCompare);
    allEvents.forEach((event, index) => { event.id = `${measure.id}:e${index}`; });
    const canonicalMeasure: CanonicalMeasure = {
      id: measure.id,
      partId: measure.partId,
      partIndex: measure.partIndex,
      index: measure.index,
      number: measure.number,
      page: measure.page,
      system: measure.system,
      startBeat: rationalBeatFrom(measure.startBeat),
      durationBeats: rationalBeatFrom(measure.durationBeats),
      timeSignature: measure.timeSignature,
      keySignature: measure.keySignature,
      implicit: measure.implicit,
      notationEvents: allEvents,
      performedTokens: [],
      fingerprint: "",
    };
    measures.push(canonicalMeasure);
    notationEvents.push(...allEvents);
  }
  const warnings = [...normalized.warnings];
  const performedTokens = collapsePerformedTokens([...notationEvents].sort(sourceEventCompare), warnings);
  performedTokens.forEach((token, index) => { token.id = `t${index}`; });
  const measureById = new Map(measures.map((measure) => [measure.id, measure]));
  for (const token of performedTokens) measureById.get(token.measureId)?.performedTokens.push(token);
  for (const measure of measures) measure.fingerprint = measureFingerprint(measure);
  return {
    schemaVersion: OMR_CANONICAL_SCHEMA_VERSION,
    title: normalized.title,
    tempoBpm: normalized.tempoBpm,
    timeSignature: normalized.timeSignature,
    keySignature: normalized.keySignature,
    parts: normalized.parts,
    measures,
    notationEvents,
    performedTokens,
    warnings,
  };
}

/** Compute a deterministic content fingerprint for a canonical measure. */
export function canonicalMeasureFingerprint(measure: CanonicalMeasure): string {
  return measureFingerprint(measure);
}

function tokenSpellingEqual(left: CanonicalPerformedToken, right: CanonicalPerformedToken): boolean {
  return left.type === "rest" && right.type === "rest"
    ? true
    : left.spelling === right.spelling;
}

function tokenRhythmEqual(left: CanonicalPerformedToken, right: CanonicalPerformedToken): boolean {
  return equalRational(left.onset, right.onset) && equalRational(left.duration, right.duration);
}

function tokenPitchEqual(left: CanonicalPerformedToken, right: CanonicalPerformedToken): boolean {
  return left.type === right.type && left.midi === right.midi;
}

function tokenTieEqual(left: CanonicalPerformedToken, right: CanonicalPerformedToken): boolean {
  return left.notationSegments.length === right.notationSegments.length
    && left.notationSegments.every((segment, index) => tieKey(segment.tie) === tieKey(right.notationSegments[index]!.tie));
}

/**
 * Compare performed tokens without requiring part/staff/voice/role identity.
 * Ties are compared semantically after collapse; notation tie segmentation is
 * retained as a separately reported diagnostic.
 */
export function compareCanonicalTokens(
  reference: readonly CanonicalPerformedToken[],
  candidate: readonly CanonicalPerformedToken[],
): CanonicalTokenComparison {
  const left = [...reference].sort(tokenCompare);
  const right = [...candidate].sort(tokenCompare);
  const used = new Set<number>();
  const pairs: Array<[CanonicalPerformedToken, CanonicalPerformedToken]> = [];
  const unmatchedReference: CanonicalPerformedToken[] = [];
  for (const token of left) {
    let bestIndex = -1;
    let bestScore: [number, number, number, number] | null = null;
    for (let index = 0; index < right.length; index += 1) {
      if (used.has(index)) continue;
      const candidateToken = right[index]!;
      const score: [number, number, number, number] = [
        token.type === candidateToken.type ? 0 : 1,
        Math.abs(rationalBeatToNumber(token.onset) - rationalBeatToNumber(candidateToken.onset)),
        token.midi === candidateToken.midi ? 0 : 1,
        Math.abs(rationalBeatToNumber(token.duration) - rationalBeatToNumber(candidateToken.duration)),
      ];
      const isBetter = bestScore === null || score.some((value, position) => {
        const previous = bestScore![position]!;
        return value < previous && score.slice(0, position).every((prefix, i) => prefix === bestScore![i]!);
      });
      if (isBetter) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) unmatchedReference.push(token);
    else {
      used.add(bestIndex);
      pairs.push([token, right[bestIndex]!]);
    }
  }
  const unmatchedCandidate = right.filter((_, index) => !used.has(index));
  const denominator = Math.max(1, Math.max(left.length, right.length));
  let pitchMismatches = unmatchedReference.length + unmatchedCandidate.length;
  let rhythmMismatches = unmatchedReference.length + unmatchedCandidate.length;
  let spellingMismatches = unmatchedReference.length + unmatchedCandidate.length;
  let tieMismatches = 0;
  for (const [ref, cand] of pairs) {
    if (!tokenPitchEqual(ref, cand)) pitchMismatches += 1;
    if (!tokenRhythmEqual(ref, cand)) rhythmMismatches += 1;
    if (!tokenSpellingEqual(ref, cand)) spellingMismatches += 1;
    if (!tokenTieEqual(ref, cand)) tieMismatches += 1;
  }
  const pitchDistance = pitchMismatches / denominator;
  const rhythmDistance = rhythmMismatches / denominator;
  const spellingDistance = spellingMismatches / denominator;
  const notationTieDistance = tieMismatches / denominator;
  const distance = (pitchDistance + rhythmDistance) / 2;
  const disagreements: CanonicalTokenComparison["disagreements"] = [];
  if (pitchDistance > 0) disagreements.push("pitch");
  if (rhythmDistance > 0) disagreements.push("rhythm");
  if (spellingDistance > 0 && pitchDistance === 0) disagreements.push("spelling");
  if (notationTieDistance > 0) disagreements.push("tie-notation");
  if (unmatchedReference.length) disagreements.push("delete");
  if (unmatchedCandidate.length) disagreements.push("insert");
  return {
    equal: pitchDistance === 0 && rhythmDistance === 0,
    distance,
    agreement: 1 - distance,
    pitchDistance,
    rhythmDistance,
    spellingDistance,
    continuityDistance: 0,
    notationTieDistance,
    matched: pairs.length,
    unmatchedReference: unmatchedReference.length,
    unmatchedCandidate: unmatchedCandidate.length,
    disagreements,
  };
}

/** Alias for callers that prefer an explicit event/token comparison name. */
export const compareCanonicalEvents = compareCanonicalTokens;
