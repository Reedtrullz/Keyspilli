/**
 * Page-first, bounded OMR alignment.
 *
 * This is deliberately an additive diagnostic surface. It does not alter the
 * flat consensus aligner or select a consensus event payload. All returned
 * measure/event ids point back to the canonical score supplied by the caller.
 */
import {
  normalizeCanonicalScore,
  rationalBeatToNumber,
  type CanonicalMeasure,
  type CanonicalPerformedToken,
  type CanonicalScore,
} from "./omr-canonical.js";
import type { NormalizedOmrScore, OmrMeasureInput, OmrRole, OmrScoreInput } from "./omr-consensus.js";

export type OmrAlignmentRelation =
  | "one-to-one"
  | "reference-split"
  | "candidate-merge"
  | "candidate-missing"
  | "reference-missing";

export interface OmrPageKey {
  page: number | null;
  ordinal: number;
}

export interface OmrPageAlignment {
  reference: OmrPageKey | null;
  candidate: OmrPageKey | null;
  confidence: number;
  status: "aligned" | "unmatched" | "ambiguous";
  referenceMeasureIndices: number[];
  candidateMeasureIndices: number[];
  diagnostics: string[];
}

export interface OmrStaffLaneKey {
  partIndex: number;
  partId: string;
  staff: number | null;
  role: OmrRole | null;
}

export interface OmrStaffLaneMapping {
  reference: OmrStaffLaneKey;
  candidate: OmrStaffLaneKey;
  confidence: number;
  status: "mapped" | "ambiguous" | "unmapped";
  evidence: { role: number; rhythm: number; pitch: number; range: number; topology: number };
}

export interface OmrRegionEventAlignment {
  matched: Array<{ referenceEventId: string; candidateEventId: string; onsetError: number; pitchEqual: boolean }>;
  unmatchedReferenceEventIds: string[];
  unmatchedCandidateEventIds: string[];
}

export interface OmrMeasureRegionAlignment {
  relation: OmrAlignmentRelation;
  referenceMeasureIndices: number[];
  candidateMeasureIndices: number[];
  referenceMeasureIds: string[];
  candidateMeasureIds: string[];
  confidence: number;
  eventAlignment?: OmrRegionEventAlignment;
  diagnostics: string[];
}

export interface OmrHierarchicalAlignment {
  status: "aligned" | "partial" | "ambiguous" | "unavailable";
  pages: OmrPageAlignment[];
  staffMappings: OmrStaffLaneMapping[];
  measures: OmrMeasureRegionAlignment[];
  unmatchedReferenceMeasures: number[];
  unmatchedCandidateMeasures: number[];
  score: number;
  diagnostics: string[];
}

export interface OmrHierarchicalAlignmentOptions {
  onsetToleranceBeats?: number;
  phraseBreakBeats?: number;
  maxSplitWidth?: 1 | 2;
  ambiguityMargin?: number;
  maxPageCells?: number;
  maxEventTokens?: number;
  allowPageOrdinalFallback?: boolean;
}

const DEFAULTS = {
  onsetToleranceBeats: 0.08,
  phraseBreakBeats: 1.5,
  maxSplitWidth: 2 as const,
  ambiguityMargin: 0.08,
  maxPageCells: 4096,
  maxEventTokens: 8192,
};
const EPS = 1e-9;

type ScoreLike = CanonicalScore | NormalizedOmrScore | OmrScoreInput;

interface PageGroup {
  key: OmrPageKey;
  measures: CanonicalMeasure[];
  invalid: boolean;
  diagnostics: string[];
}

interface Lane {
  key: OmrStaffLaneKey;
  events: Array<{ onset: number; duration: number; pitch: number }>;
  measureCount: number;
  measureIds: Set<string>;
}

interface MeasureChoice {
  type: "one" | "split" | "merge" | "candidate-missing" | "reference-missing";
  score: number;
  i: number;
  j: number;
  diagnostics: string[];
}

interface PageAlignmentResult {
  regions: OmrMeasureRegionAlignment[];
  unmatchedReference: number[];
  unmatchedCandidate: number[];
  score: number;
  status: "aligned" | "ambiguous";
  diagnostics: string[];
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ratio(left: number, right: number): number {
  if (left === 0 && right === 0) return 1;
  if (left === 0 || right === 0) return 0;
  return Math.min(left, right) / Math.max(left, right);
}

function scoreOf(input: ScoreLike): CanonicalScore {
  const value = input as Partial<CanonicalScore>;
  if (value.schemaVersion === "omr-canonical-v1" && Array.isArray(value.measures)) return input as CanonicalScore;
  const normalized = input as Partial<NormalizedOmrScore>;
  if (Array.isArray(normalized.measures) && Array.isArray(normalized.parts)
    && normalized.measures.every((measure) => typeof measure === "object" && measure !== null && "partId" in measure)) {
    const byId = new Map(normalized.measures.map((measure) => [measure.id, measure]));
    const parts: OmrScoreInput["parts"] = normalized.parts.map((part) => ({
      id: part.id,
      name: part.name,
      role: part.role ?? undefined,
      measures: part.measureIds.map((id) => {
        const measure = byId.get(id)!;
        const value: OmrMeasureInput = {
          id: measure.id,
          number: measure.number,
          page: measure.page ?? undefined,
          system: measure.system ?? undefined,
          startBeat: measure.startBeat,
          durationBeats: measure.durationBeats,
          timeSignature: measure.timeSignature,
          keySignature: measure.keySignature,
          implicit: measure.implicit,
          events: measure.events.map((event) => ({ onset: event.onset, duration: event.duration, pitch: event.pitch, accidental: event.accidental, tie: event.tie, staff: event.staff ?? undefined, voice: event.voice ?? undefined, role: event.role ?? undefined, tuplet: event.tuplet })),
          rests: measure.rests,
          tieIn: measure.tieIn,
          tieOut: measure.tieOut,
          tupletCount: measure.tupletCount,
        };
        return value;
      }),
    }));
    return normalizeCanonicalScore({ title: normalized.title ?? undefined, tempoBpm: normalized.tempoBpm ?? undefined, timeSignature: normalized.timeSignature, keySignature: normalized.keySignature, parts });
  }
  return normalizeCanonicalScore(input as OmrScoreInput);
}

function rawPageDiagnostics(input: ScoreLike, label: string): string[] {
  const value = input as Partial<OmrScoreInput>;
  if (!Array.isArray(value.parts)) return [];
  const diagnostics: string[] = [];
  for (const part of value.parts) {
    if (!part || !Array.isArray(part.measures)) continue;
    for (const measure of part.measures) {
      const page = (measure as OmrMeasureInput).page;
      if (page !== undefined && pageNumber(page) === null) diagnostics.push(`${label}: invalid page metadata on ${String((measure as OmrMeasureInput).id ?? (measure as OmrMeasureInput).number ?? "measure")}`);
    }
  }
  return diagnostics;
}

function timingDiagnostics(input: ScoreLike, label: string): string[] {
  const value = input as Partial<OmrScoreInput>;
  const diagnostics: string[] = [];
  const checkMeasure = (measure: { id?: unknown; number?: unknown; startBeat?: unknown; durationBeats?: unknown; events?: Array<{ onset?: unknown; duration?: unknown }> }, fallback: string): void => {
    const id = String(measure.id ?? measure.number ?? fallback);
    if (measure.startBeat !== undefined && (!finite(measure.startBeat) || measure.startBeat < 0)) diagnostics.push(`${label}: invalid nonnegative startBeat on ${id}`);
    if (measure.durationBeats !== undefined && (!finite(measure.durationBeats) || measure.durationBeats <= 0)) diagnostics.push(`${label}: invalid positive durationBeats on ${id}`);
    for (const [index, event] of (measure.events ?? []).entries()) {
      if (event.onset !== undefined && (!finite(event.onset) || event.onset < 0)) diagnostics.push(`${label}: invalid nonnegative event onset on ${id}:e${index}`);
      if (event.duration !== undefined && (!finite(event.duration) || event.duration <= 0)) diagnostics.push(`${label}: invalid positive event duration on ${id}:e${index}`);
    }
  };
  if (Array.isArray(value.parts)) {
    for (const part of value.parts) for (const [index, measure] of (part?.measures ?? []).entries()) checkMeasure(measure, `measure-${index}`);
    return diagnostics;
  }
  const normalized = input as Partial<NormalizedOmrScore>;
  if (Array.isArray(normalized.measures)) {
    for (const measure of normalized.measures) checkMeasure(measure, measure.id);
  }
  return diagnostics;
}

function canonicalTimingDiagnostics(score: CanonicalScore, label: string): string[] {
  const diagnostics: string[] = [];
  for (const measure of score.measures) {
    if (!finite(rationalBeatToNumber(measure.startBeat)) || rationalBeatToNumber(measure.startBeat) < 0) diagnostics.push(`${label}: invalid nonnegative startBeat on ${measure.id}`);
    if (!finite(rationalBeatToNumber(measure.durationBeats)) || rationalBeatToNumber(measure.durationBeats) <= 0) diagnostics.push(`${label}: invalid positive durationBeats on ${measure.id}`);
    for (const [index, event] of measure.notationEvents.entries()) {
      if (!finite(rationalBeatToNumber(event.measureOnset)) || rationalBeatToNumber(event.measureOnset) < 0) diagnostics.push(`${label}: invalid nonnegative event onset on ${measure.id}:e${index}`);
      if (!finite(rationalBeatToNumber(event.duration)) || rationalBeatToNumber(event.duration) <= 0) diagnostics.push(`${label}: invalid positive event duration on ${measure.id}:e${index}`);
    }
    if (measure.page !== null && pageNumber(measure.page) === null) diagnostics.push(`${label}: invalid page metadata on ${measure.id}`);
  }
  return diagnostics;
}

function measureOrder(left: CanonicalMeasure, right: CanonicalMeasure): number {
  return rationalBeatToNumber(left.startBeat) - rationalBeatToNumber(right.startBeat)
    || stableCompare(left.number, right.number)
    || stableCompare(left.fingerprint, right.fingerprint)
    || stableCompare(left.partId, right.partId)
    || left.partIndex - right.partIndex
    || stableCompare(left.id, right.id)
    || left.index - right.index;
}

function pageNumber(value: unknown): number | null {
  return finite(value) && Number.isInteger(value) && value >= 1 ? value : null;
}

function pageGroups(score: CanonicalScore): { groups: PageGroup[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const grouped = new Map<string, PageGroup>();
  const duplicatePages = new Set<number>();
  const measuresByPart = new Map<string, CanonicalMeasure[]>();
  for (const measure of score.measures) (measuresByPart.get(measure.partId) ?? (measuresByPart.set(measure.partId, []), measuresByPart.get(measure.partId)!)).push(measure);
  for (const measures of measuresByPart.values()) {
    let previous: number | null = null;
    const seen = new Set<number>();
    for (const measure of [...measures].sort(measureOrder)) {
      const page = pageNumber(measure.page);
      if (page === null) continue;
      if (previous !== null && page !== previous && seen.has(page)) duplicatePages.add(page);
      seen.add(page);
      previous = page;
    }
  }
  let invalidOrdinal = 0;
  for (const measure of score.measures) {
    const rawPage = measure.page;
    const valid = rawPage === null || pageNumber(rawPage) !== null;
    if (!valid) {
      diagnostics.push(`invalid page metadata on ${measure.id}`);
      const key = `invalid-${invalidOrdinal++}`;
      grouped.set(key, { key: { page: null, ordinal: -invalidOrdinal }, measures: [measure], invalid: true, diagnostics: ["invalid page metadata"] });
      continue;
    }
    const page = pageNumber(rawPage);
    const key = page === null ? "null" : `page:${page}`;
    const existing = grouped.get(key);
    if (existing) existing.measures.push(measure);
    else grouped.set(key, { key: { page, ordinal: 0 }, measures: [measure], invalid: false, diagnostics: [] });
  }
  for (const page of duplicatePages) {
    const group = grouped.get(`page:${page}`);
    if (group) {
      group.invalid = true;
      group.diagnostics.push(`duplicate explicit page identity ${page}`);
      diagnostics.push(`duplicate explicit page identity ${page}`);
    }
  }
  const explicit = [...grouped.values()].filter((group) => group.key.page !== null).sort((a, b) => a.key.page! - b.key.page!);
  const missing = grouped.get("null");
  const groups = [...explicit, ...(missing ? [missing] : []), ...[...grouped.values()].filter((group) => group.invalid)];
  groups.forEach((group, index) => {
    group.key = { page: group.key.page, ordinal: index };
    group.measures.sort(measureOrder);
  });
  return { groups, diagnostics };
}

function pageFingerprint(group: PageGroup): { duration: number; attacks: number; fingerprints: string[] } {
  return {
    duration: group.measures.reduce((sum, measure) => sum + rationalBeatToNumber(measure.durationBeats), 0),
    attacks: group.measures.reduce((sum, measure) => sum + measure.performedTokens.length, 0),
    fingerprints: group.measures.map((measure) => measure.fingerprint).sort(stableCompare),
  };
}

function pageSimilarity(reference: PageGroup, candidate: PageGroup): number {
  const left = pageFingerprint(reference);
  const right = pageFingerprint(candidate);
  const fingerprintIntersection = left.fingerprints.filter((value) => {
    const index = right.fingerprints.indexOf(value);
    if (index < 0) return false;
    right.fingerprints.splice(index, 1);
    return true;
  }).length;
  return round(ratio(reference.measures.length, candidate.measures.length) * 0.35
    + ratio(left.duration, right.duration) * 0.25
    + ratio(left.attacks, right.attacks) * 0.15
    + ratio(fingerprintIntersection, Math.max(left.fingerprints.length, right.fingerprints.length, 1)) * 0.25);
}

function pairPages(reference: CanonicalScore, candidate: CanonicalScore, options: Required<Pick<OmrHierarchicalAlignmentOptions, "allowPageOrdinalFallback" | "ambiguityMargin">>): { pages: OmrPageAlignment[]; diagnostics: string[] } {
  const ref = pageGroups(reference);
  const cand = pageGroups(candidate);
  const diagnostics = [...ref.diagnostics.map((value) => `reference: ${value}`), ...cand.diagnostics.map((value) => `candidate: ${value}`)];
  const pages: OmrPageAlignment[] = [];
  const candidateByPage = new Map<number, PageGroup>();
  for (const group of cand.groups) if (group.key.page !== null && !group.invalid) candidateByPage.set(group.key.page, group);
  const usedCandidates = new Set<PageGroup>();
  for (const group of ref.groups) {
    if (group.invalid) {
      pages.push({ reference: group.key, candidate: null, confidence: 0, status: "unmatched", referenceMeasureIndices: group.measures.map((measure) => measure.index), candidateMeasureIndices: [], diagnostics: [...group.diagnostics, "invalid page metadata"] });
      continue;
    }
    const match = group.key.page === null ? undefined : candidateByPage.get(group.key.page);
    if (match) {
      usedCandidates.add(match);
      pages.push({
        reference: group.key,
        candidate: match.key,
        confidence: pageSimilarity(group, match),
        status: "aligned",
        referenceMeasureIndices: group.measures.map((measure) => measure.index),
        candidateMeasureIndices: match.measures.map((measure) => measure.index),
        diagnostics: [],
      });
      continue;
    }
    pages.push({
      reference: group.key,
      candidate: null,
      confidence: 0,
      status: "unmatched",
      referenceMeasureIndices: group.measures.map((measure) => measure.index),
      candidateMeasureIndices: [],
      diagnostics: [group.key.page === null ? "page metadata unavailable; no correspondence invented" : `candidate page ${group.key.page} is missing`],
    });
  }
  for (const group of cand.groups) {
    if (usedCandidates.has(group) || (!group.invalid && group.key.page !== null && ref.groups.some((item) => item.key.page === group.key.page && !item.invalid))
      || (options.allowPageOrdinalFallback && group.key.page === null && ref.groups.some((item) => item.key.page === null && !item.invalid))) continue;
    pages.push({ reference: null, candidate: group.key, confidence: 0, status: "unmatched", referenceMeasureIndices: [], candidateMeasureIndices: group.measures.map((measure) => measure.index), diagnostics: [group.key.page === null ? "page metadata unavailable; no correspondence invented" : `reference page ${group.key.page} is missing`] });
  }

  const refMissing = ref.groups.filter((group) => group.key.page === null && !group.invalid);
  const candMissing = cand.groups.filter((group) => group.key.page === null && !group.invalid);
  if (options.allowPageOrdinalFallback && refMissing.length && candMissing.length) {
    const count = Math.min(refMissing.length, candMissing.length);
    for (let index = 0; index < count; index += 1) {
      const left = refMissing[index]!;
      const right = candMissing[index]!;
      const confidence = pageSimilarity(left, right);
      const next = candMissing[index + 1];
      const alternate = next ? pageSimilarity(left, next) : -1;
      const ambiguous = alternate >= confidence - options.ambiguityMargin;
      const existing = pages.find((page) => page.reference?.ordinal === left.key.ordinal);
      if (existing) {
        usedCandidates.add(right);
        existing.candidate = right.key;
        existing.confidence = confidence;
        existing.status = ambiguous ? "ambiguous" : "aligned";
        existing.candidateMeasureIndices = right.measures.map((measure) => measure.index);
        existing.diagnostics = ["ordinal-fallback", ...(ambiguous ? ["ambiguous ordinal page match"] : [])];
      }
      if (ambiguous) diagnostics.push(`ambiguous ordinal page match at ${left.key.ordinal}`);
    }
    if (refMissing.length !== candMissing.length) diagnostics.push("ordinal fallback left unmatched page metadata groups");
  }
  if (refMissing.length || candMissing.length) diagnostics.push("page metadata unavailable for one or more groups");
  pages.sort((left, right) => (left.reference?.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.reference?.ordinal ?? Number.MAX_SAFE_INTEGER)
    || (left.candidate?.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.candidate?.ordinal ?? Number.MAX_SAFE_INTEGER));
  return { pages, diagnostics };
}

function laneKey(key: OmrStaffLaneKey): string {
  return `${key.partId}|${key.staff ?? ""}|${key.role ?? ""}`;
}

function laneGroups(score: CanonicalScore, page: OmrPageAlignment): Lane[] {
  const measures = new Set(page.referenceMeasureIndices);
  const grouped = new Map<string, Lane>();
  for (const measure of score.measures) {
    if (!measures.has(measure.index)) continue;
    const part = score.parts.find((item) => item.id === measure.partId);
    const add = (staff: number | null, role: OmrRole | null, event?: { onset: number; duration: number; midi: number | null }): void => {
      if (event && event.midi === null) return;
      const key: OmrStaffLaneKey = { partIndex: measure.partIndex, partId: measure.partId, staff, role };
      const id = laneKey(key);
      const lane = grouped.get(id) ?? { key, events: [], measureCount: 0, measureIds: new Set<string>() };
      if (!lane.measureIds.has(measure.id)) {
        lane.measureIds.add(measure.id);
        lane.measureCount += 1;
      }
      if (event && event.midi !== null) lane.events.push({ onset: event.onset, duration: event.duration, pitch: event.midi });
      grouped.set(id, lane);
    };
    let hadNote = false;
    for (const event of measure.notationEvents) {
      if (event.type !== "note" || event.midi === null) continue;
      hadNote = true;
      add(event.source.staff, event.source.role ?? part?.role ?? null, { onset: rationalBeatToNumber(event.measureOnset), duration: rationalBeatToNumber(event.duration), midi: event.midi });
    }
    if (!hadNote) add(null, part?.role ?? null);
  }
  return [...grouped.values()].sort((left, right) => stableCompare(laneKey(left.key), laneKey(right.key)));
}

function histogram(events: Lane["events"]): number[] {
  const result = Array.from({ length: 12 }, () => 0);
  for (const event of events) {
    const index = ((event.pitch % 12) + 12) % 12;
    result[index] = result[index]! + 1;
  }
  return result;
}

function histogramSimilarity(left: number[], right: number[]): number {
  const total = Math.max(1, left.reduce((sum, value) => sum + value, 0) + right.reduce((sum, value) => sum + value, 0));
  return clamp(1 - left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / total);
}

function laneEvidence(reference: Lane, candidate: Lane, tolerance: number): OmrStaffLaneMapping["evidence"] {
  const role = reference.key.role === null || candidate.key.role === null ? 0.5 : reference.key.role === candidate.key.role ? 1 : 0;
  const refOnsets = reference.events.map((event) => event.onset).sort(compareNumbers);
  const candOnsets = candidate.events.map((event) => event.onset).sort(compareNumbers);
  let onsetMatches = 0;
  const used = new Set<number>();
  for (const onset of refOnsets) {
    const index = candOnsets.findIndex((value, candidateIndex) => !used.has(candidateIndex) && Math.abs(value - onset) <= tolerance + EPS);
    if (index >= 0) { used.add(index); onsetMatches += 1; }
  }
  const rhythm = refOnsets.length === 0 && candOnsets.length === 0 ? 1 : onsetMatches / Math.max(refOnsets.length, candOnsets.length, 1);
  const pitch = histogramSimilarity(histogram(reference.events), histogram(candidate.events));
  const refRange = reference.events.length ? [Math.min(...reference.events.map((event) => event.pitch)), Math.max(...reference.events.map((event) => event.pitch))] : null;
  const candRange = candidate.events.length ? [Math.min(...candidate.events.map((event) => event.pitch)), Math.max(...candidate.events.map((event) => event.pitch))] : null;
  const range = refRange && candRange ? clamp(1 - (Math.abs(refRange[0]! - candRange[0]!) + Math.abs(refRange[1]! - candRange[1]!)) / 48) : refRange === candRange ? 1 : 0;
  const topology = ratio(reference.measureCount, candidate.measureCount) * 0.5 + ratio(reference.events.length, candidate.events.length) * 0.5;
  return { role: round(role), rhythm: round(rhythm), pitch: round(pitch), range: round(range), topology: round(topology) };
}

function mappingConfidence(evidence: OmrStaffLaneMapping["evidence"]): number {
  return round(evidence.role * 0.2 + evidence.rhythm * 0.25 + evidence.pitch * 0.25 + evidence.range * 0.15 + evidence.topology * 0.15);
}

function assignmentOrder(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? -1;
    const b = right[index] ?? -1;
    if (a !== b) return a - b;
  }
  return 0;
}

function globalLaneAssignment(scores: number[][]): number[] {
  const candidateCount = scores[0]?.length ?? 0;
  if (!scores.length || !candidateCount) return scores.map(() => -1);
  if (candidateCount > 12) {
    const pairs: Array<{ ref: number; candidate: number; score: number }> = [];
    for (let ref = 0; ref < scores.length; ref += 1) for (let candidate = 0; candidate < candidateCount; candidate += 1) pairs.push({ ref, candidate, score: scores[ref]![candidate]! });
    pairs.sort((left, right) => right.score - left.score || left.ref - right.ref || left.candidate - right.candidate);
    const result = scores.map(() => -1);
    const used = new Set<number>();
    for (const pair of pairs) if (result[pair.ref] === -1 && !used.has(pair.candidate)) { result[pair.ref] = pair.candidate; used.add(pair.candidate); }
    return result;
  }
  interface Answer { score: number; assignment: number[] }
  const memo = new Map<string, Answer>();
  const solve = (ref: number, used: number): Answer => {
    if (ref >= scores.length) return { score: 0, assignment: [] };
    const key = `${ref}:${used}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const options: Answer[] = [{ score: -0.2, assignment: [-1, ...solve(ref + 1, used).assignment] }];
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      if (used & (1 << candidate)) continue;
      const next = solve(ref + 1, used | (1 << candidate));
      options.push({ score: scores[ref]![candidate]! + next.score, assignment: [candidate, ...next.assignment] });
    }
    options.sort((left, right) => right.score - left.score || assignmentOrder(left.assignment, right.assignment));
    const best = options[0]!;
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).assignment;
}

function mapLanes(reference: CanonicalScore, candidate: CanonicalScore, page: OmrPageAlignment, options: Required<Pick<OmrHierarchicalAlignmentOptions, "ambiguityMargin" | "onsetToleranceBeats">>): OmrStaffLaneMapping[] {
  if (!page.reference || !page.candidate) return [];
  const refs = laneGroups(reference, page);
  const cands = laneGroups(candidate, { ...page, referenceMeasureIndices: page.candidateMeasureIndices });
  const choices = refs.map((ref) => cands.map((cand) => {
    const evidence = laneEvidence(ref, cand, options.onsetToleranceBeats);
    return { cand, evidence, confidence: mappingConfidence(evidence) };
  }));
  const assignment = globalLaneAssignment(choices.map((row) => row.map((choice) => choice.confidence)));
  const mappings: OmrStaffLaneMapping[] = [];
  for (const [refIndex, ref] of refs.entries()) {
    const row = choices[refIndex]!;
    const ranked = [...row].sort((left, right) => right.confidence - left.confidence || stableCompare(laneKey(left.cand.key), laneKey(right.cand.key)));
    const best = ranked[0];
    if (!best) continue;
    const assignedIndex = assignment[refIndex] ?? -1;
    const assigned = assignedIndex >= 0 ? row[assignedIndex] : undefined;
    const second = ranked.find((choice) => choice.cand !== best.cand);
    const ambiguous = Boolean(second && best.confidence - second.confidence <= options.ambiguityMargin);
    if (ambiguous) {
      mappings.push({ reference: ref.key, candidate: best.cand.key, confidence: best.confidence, status: "ambiguous", evidence: best.evidence });
      continue;
    }
    if (!assigned) {
      mappings.push({ reference: ref.key, candidate: best.cand.key, confidence: best.confidence, status: "unmapped", evidence: best.evidence });
      continue;
    }
    mappings.push({ reference: ref.key, candidate: assigned.cand.key, confidence: assigned.confidence, status: "mapped", evidence: assigned.evidence });
  }
  return mappings.sort((left, right) => stableCompare(laneKey(left.reference), laneKey(right.reference)));
}

function tokenEvents(measures: CanonicalMeasure[], base: number): Array<{ token: CanonicalPerformedToken; onset: number }> {
  return measures.flatMap((measure) => measure.performedTokens.map((token) => ({ token, onset: rationalBeatToNumber(token.onset) - base })))
    .sort((left, right) => left.onset - right.onset || (left.token.midi ?? Number.MAX_SAFE_INTEGER) - (right.token.midi ?? Number.MAX_SAFE_INTEGER) || stableCompare(left.token.id, right.token.id));
}

function eventAlignment(reference: CanonicalMeasure[], candidate: CanonicalMeasure[], tolerance: number, maxEventTokens: number): OmrRegionEventAlignment {
  const base = Math.min(...reference.map((measure) => rationalBeatToNumber(measure.startBeat)), ...candidate.map((measure) => rationalBeatToNumber(measure.startBeat)));
  const refs = tokenEvents(reference, base);
  const cands = tokenEvents(candidate, base);
  if (refs.length > maxEventTokens || cands.length > maxEventTokens) return { matched: [], unmatchedReferenceEventIds: refs.map((item) => item.token.id), unmatchedCandidateEventIds: cands.map((item) => item.token.id) };
  const usedCands = new Set<number>();
  const matched: OmrRegionEventAlignment["matched"] = [];
  let cursor = 0;
  for (const left of refs) {
    while (cursor < cands.length && cands[cursor]!.onset < left.onset - tolerance - EPS) cursor += 1;
    let bestIndex = -1;
    let best: [number, number, number, string] | null = null;
    for (let index = cursor; index < cands.length && cands[index]!.onset <= left.onset + tolerance + EPS; index += 1) {
      if (usedCands.has(index)) continue;
      const right = cands[index]!;
      const key: [number, number, number, string] = [left.token.midi === right.token.midi ? 0 : 1, Math.abs(left.onset - right.onset), Math.abs(rationalBeatToNumber(left.token.duration) - rationalBeatToNumber(right.token.duration)), right.token.id];
      if (!best || key[0] < best[0] || (key[0] === best[0] && (key[1] < best[1] || (key[1] === best[1] && (key[2] < best[2] || (key[2] === best[2] && stableCompare(key[3], best[3]) < 0)))))) { best = key; bestIndex = index; }
    }
    if (bestIndex >= 0) {
      const right = cands[bestIndex]!;
      usedCands.add(bestIndex);
      matched.push({ referenceEventId: left.token.id, candidateEventId: right.token.id, onsetError: round(Math.abs(left.onset - right.onset)), pitchEqual: left.token.midi === right.token.midi });
      cursor = bestIndex + 1;
    }
  }
  matched.sort((left, right) => stableCompare(left.referenceEventId, right.referenceEventId));
  const matchedRefs = new Set(matched.map((item) => item.referenceEventId));
  const matchedCands = new Set(matched.map((item) => item.candidateEventId));
  return { matched, unmatchedReferenceEventIds: refs.filter((item) => !matchedRefs.has(item.token.id)).map((item) => item.token.id), unmatchedCandidateEventIds: cands.filter((item) => !matchedCands.has(item.token.id)).map((item) => item.token.id) };
}

function regionMetrics(reference: CanonicalMeasure[], candidate: CanonicalMeasure[], tolerance: number, maxEventTokens: number): { confidence: number; events: OmrRegionEventAlignment; diagnostics: string[] } {
  const events = eventAlignment(reference, candidate, tolerance, maxEventTokens);
  const refCount = reference.reduce((sum, measure) => sum + measure.performedTokens.length, 0);
  const candCount = candidate.reduce((sum, measure) => sum + measure.performedTokens.length, 0);
  const eventScore = events.matched.length / Math.max(refCount, candCount, 1);
  const refDuration = reference.reduce((sum, measure) => sum + rationalBeatToNumber(measure.durationBeats), 0);
  const candDuration = candidate.reduce((sum, measure) => sum + rationalBeatToNumber(measure.durationBeats), 0);
  const durationScore = ratio(refDuration, candDuration);
  const signatures = reference.every((measure) => candidate.some((other) => JSON.stringify(measure.timeSignature) === JSON.stringify(other.timeSignature))) ? 1 : 0;
  const diagnostics: string[] = [];
  const notationTieMismatch = reference.reduce((sum, measure) => sum + measure.performedTokens.filter((token) => token.notationSegments.length > 1).length, 0)
    !== candidate.reduce((sum, measure) => sum + measure.performedTokens.filter((token) => token.notationSegments.length > 1).length, 0);
  if (notationTieMismatch) diagnostics.push("notation tie segmentation differs; performed duration was compared");
  if (refCount > maxEventTokens || candCount > maxEventTokens) diagnostics.push(`event token limit exceeded (${Math.max(refCount, candCount)} > ${maxEventTokens})`);
  return { confidence: round(clamp(eventScore * 0.55 + durationScore * 0.25 + signatures * 0.2)), events, diagnostics };
}

function boundaryCompatible(reference: CanonicalMeasure[], candidate: CanonicalMeasure[], tolerance: number): boolean {
  if (reference.length < 2 && candidate.length < 2) return true;
  const left = reference.length > 1 ? reference : candidate;
  const boundary = rationalBeatToNumber(left[0]!.durationBeats);
  const refBase = rationalBeatToNumber(reference[0]!.startBeat);
  const candBase = rationalBeatToNumber(candidate[0]!.startBeat);
  const refAtBoundary = reference.flatMap((measure) => measure.performedTokens).some((token) => Math.abs(rationalBeatToNumber(token.onset) - refBase - boundary) <= tolerance + EPS);
  const candAtBoundary = candidate.flatMap((measure) => measure.performedTokens).some((token) => Math.abs(rationalBeatToNumber(token.onset) - candBase - boundary) <= tolerance + EPS);
  return refAtBoundary === candAtBoundary;
}

function phraseGap(measures: CanonicalMeasure[], phraseBreakBeats: number): boolean {
  const ordered = [...measures].sort(measureOrder);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const previousEnd = rationalBeatToNumber(previous.startBeat) + rationalBeatToNumber(previous.durationBeats);
    if (rationalBeatToNumber(current.startBeat) - previousEnd > phraseBreakBeats + EPS) return true;
  }
  return false;
}

function relationCandidate(reference: CanonicalMeasure[], candidate: CanonicalMeasure[], tolerance: number, phraseBreakBeats: number, type: MeasureChoice["type"], maxEventTokens: number): MeasureChoice | null {
  const refDuration = reference.reduce((sum, measure) => sum + rationalBeatToNumber(measure.durationBeats), 0);
  const candDuration = candidate.reduce((sum, measure) => sum + rationalBeatToNumber(measure.durationBeats), 0);
  if (Math.abs(refDuration - candDuration) > tolerance) return null;
  if (phraseGap(reference, phraseBreakBeats) || phraseGap(candidate, phraseBreakBeats)) return null;
  if (!boundaryCompatible(reference, candidate, tolerance)) return null;
  const metrics = regionMetrics(reference, candidate, tolerance, maxEventTokens);
  if (metrics.confidence < 0.45) return null;
  return { type, score: metrics.confidence * 2 - 0.2, i: reference.length, j: candidate.length, diagnostics: metrics.diagnostics };
}

function measureChoice(reference: CanonicalMeasure, candidate: CanonicalMeasure, tolerance: number, maxEventTokens: number): MeasureChoice {
  const metrics = regionMetrics([reference], [candidate], tolerance, maxEventTokens);
  const startDistance = Math.abs(rationalBeatToNumber(reference.startBeat) - rationalBeatToNumber(candidate.startBeat));
  const position = clamp(1 - startDistance / Math.max(rationalBeatToNumber(reference.durationBeats), rationalBeatToNumber(candidate.durationBeats), 4));
  const number = reference.number === candidate.number ? 1 : 0;
  const confidence = round(clamp(metrics.confidence * 0.7 + position * 0.2 + number * 0.1));
  return { type: "one", score: confidence * 2 - 0.15, i: 1, j: 1, diagnostics: metrics.diagnostics };
}

function region(reference: CanonicalMeasure[], candidate: CanonicalMeasure[], relation: OmrAlignmentRelation, confidence: number, diagnostics: string[], tolerance: number, maxEventTokens: number): OmrMeasureRegionAlignment {
  const metrics = reference.length && candidate.length ? regionMetrics(reference, candidate, tolerance, maxEventTokens) : null;
  return {
    relation,
    referenceMeasureIndices: reference.map((measure) => measure.index),
    candidateMeasureIndices: candidate.map((measure) => measure.index),
    referenceMeasureIds: reference.map((measure) => measure.id),
    candidateMeasureIds: candidate.map((measure) => measure.id),
    confidence: round(confidence),
    ...(metrics ? { eventAlignment: metrics.events } : {}),
    diagnostics: [...diagnostics, ...(metrics?.diagnostics ?? [])],
  };
}

function alignPage(reference: PageGroup, candidate: PageGroup, options: Required<Pick<OmrHierarchicalAlignmentOptions, "onsetToleranceBeats" | "ambiguityMargin" | "maxPageCells" | "maxSplitWidth" | "phraseBreakBeats" | "maxEventTokens">>): PageAlignmentResult {
  const refs = reference.measures;
  const cands = candidate.measures;
  const cells = (refs.length + 1) * (cands.length + 1);
  if (cells > options.maxPageCells) return { regions: [], unmatchedReference: refs.map((measure) => measure.index), unmatchedCandidate: cands.map((measure) => measure.index), score: 0, status: "ambiguous", diagnostics: [`page cell limit exceeded (${cells} > ${options.maxPageCells})`] };
  const dp = Array.from({ length: refs.length + 1 }, () => Array.from({ length: cands.length + 1 }, () => Number.NEGATIVE_INFINITY));
  const choices: Array<Array<MeasureChoice | null>> = Array.from({ length: refs.length + 1 }, () => Array.from({ length: cands.length + 1 }, () => null));
  const diagnostics: string[] = [];
  dp[0]![0] = 0;
  for (let i = 1; i <= refs.length; i += 1) { dp[i]![0] = dp[i - 1]![0]! - 0.62; choices[i]![0] = { type: "candidate-missing", score: -0.62, i: 1, j: 0, diagnostics: ["candidate measure missing (reference-only measure)"] }; }
  for (let j = 1; j <= cands.length; j += 1) { dp[0]![j] = dp[0]![j - 1]! - 0.62; choices[0]![j] = { type: "reference-missing", score: -0.62, i: 0, j: 1, diagnostics: ["reference measure missing (candidate-only measure)"] }; }
  for (let i = 1; i <= refs.length; i += 1) for (let j = 1; j <= cands.length; j += 1) {
    const candidates: Array<{ choice: MeasureChoice; total: number; priority: number }> = [];
    const one = measureChoice(refs[i - 1]!, cands[j - 1]!, options.onsetToleranceBeats, options.maxEventTokens);
    candidates.push({ choice: one, total: dp[i - 1]![j - 1]! + one.score, priority: 0 });
    if (options.maxSplitWidth === 2 && j >= 2) {
      const split = relationCandidate([refs[i - 1]!], [cands[j - 2]!, cands[j - 1]!], options.onsetToleranceBeats, options.phraseBreakBeats, "split", options.maxEventTokens);
      if (split) candidates.push({ choice: split, total: dp[i - 1]![j - 2]! + split.score, priority: 1 });
    }
    if (options.maxSplitWidth === 2 && i >= 2) {
      const merge = relationCandidate([refs[i - 2]!, refs[i - 1]!], [cands[j - 1]!], options.onsetToleranceBeats, options.phraseBreakBeats, "merge", options.maxEventTokens);
      if (merge) candidates.push({ choice: merge, total: dp[i - 2]![j - 1]! + merge.score, priority: 2 });
    }
    candidates.push({ choice: { type: "candidate-missing", score: -0.62, i: 1, j: 0, diagnostics: ["candidate measure missing (reference-only measure)"] }, total: dp[i - 1]![j]! - 0.62, priority: 3 });
    candidates.push({ choice: { type: "reference-missing", score: -0.62, i: 0, j: 1, diagnostics: ["reference measure missing (candidate-only measure)"] }, total: dp[i]![j - 1]! - 0.62, priority: 4 });
    candidates.sort((left, right) => right.total - left.total || left.priority - right.priority);
    const bestTotal = candidates[0]!.total;
    const secondTotal = candidates[1]?.total ?? Number.NEGATIVE_INFINITY;
    if (secondTotal > Number.NEGATIVE_INFINITY && bestTotal - secondTotal <= options.ambiguityMargin) diagnostics.push(`near-tied page transition at ${i},${j}`);
    dp[i]![j] = candidates[0]!.total;
    choices[i]![j] = candidates[0]!.choice;
  }
  const regions: OmrMeasureRegionAlignment[] = [];
  const unmatchedReference: number[] = [];
  const unmatchedCandidate: number[] = [];
  let i = refs.length;
  let j = cands.length;
  while (i > 0 || j > 0) {
    const choice = choices[i]![j]!;
    if (choice.type === "one") {
      const metrics = regionMetrics([refs[i - 1]!], [cands[j - 1]!], options.onsetToleranceBeats, options.maxEventTokens);
      regions.push(region([refs[i - 1]!], [cands[j - 1]!], "one-to-one", metrics.confidence, choice.diagnostics, options.onsetToleranceBeats, options.maxEventTokens));
      i -= 1; j -= 1;
    } else if (choice.type === "split") {
      const children = [cands[j - 2]!, cands[j - 1]!];
      const metrics = regionMetrics([refs[i - 1]!], children, options.onsetToleranceBeats, options.maxEventTokens);
      regions.push(region([refs[i - 1]!], children, "reference-split", metrics.confidence, choice.diagnostics, options.onsetToleranceBeats, options.maxEventTokens));
      i -= 1; j -= 2;
    } else if (choice.type === "merge") {
      const parents = [refs[i - 2]!, refs[i - 1]!];
      const metrics = regionMetrics(parents, [cands[j - 1]!], options.onsetToleranceBeats, options.maxEventTokens);
      regions.push(region(parents, [cands[j - 1]!], "candidate-merge", metrics.confidence, choice.diagnostics, options.onsetToleranceBeats, options.maxEventTokens));
      i -= 2; j -= 1;
    } else if (choice.type === "candidate-missing") {
      unmatchedReference.push(refs[i - 1]!.index);
      regions.push(region([refs[i - 1]!], [], "candidate-missing", 0, choice.diagnostics, options.onsetToleranceBeats, options.maxEventTokens));
      i -= 1;
    } else {
      unmatchedCandidate.push(cands[j - 1]!.index);
      regions.push(region([], [cands[j - 1]!], "reference-missing", 0, choice.diagnostics, options.onsetToleranceBeats, options.maxEventTokens));
      j -= 1;
    }
  }
  regions.reverse();
  unmatchedReference.sort(compareNumbers);
  unmatchedCandidate.sort(compareNumbers);
  const repeated = refs.some((measure, index) => refs.slice(index + 1).some((other) => measure.fingerprint === other.fingerprint && measure.number === other.number))
    || cands.some((measure, index) => cands.slice(index + 1).some((other) => measure.fingerprint === other.fingerprint && measure.number === other.number));
  if (repeated) diagnostics.push("ambiguous repeated measure fingerprints with identical numbers");
  const nearTie = diagnostics.some((diagnostic) => diagnostic.startsWith("near-tied page transition"));
  return { regions, unmatchedReference, unmatchedCandidate, score: round(dp[refs.length]![cands.length]!), status: repeated || nearTie ? "ambiguous" : "aligned", diagnostics };
}

function pageGroupFor(score: CanonicalScore, page: OmrPageKey): PageGroup | undefined {
  return pageGroups(score).groups.find((group) => group.key.ordinal === page.ordinal);
}

/** Align two scores by explicit page, lane evidence, and page-local measures. */
export function alignHierarchicalOmrScores(referenceInput: ScoreLike, candidateInput: ScoreLike, options: OmrHierarchicalAlignmentOptions = {}): OmrHierarchicalAlignment {
  const reference = scoreOf(referenceInput);
  const candidate = scoreOf(candidateInput);
  const onsetToleranceBeats = Math.max(0.001, Math.min(1, options.onsetToleranceBeats ?? DEFAULTS.onsetToleranceBeats));
  const phraseBreakBeats = Math.max(0, options.phraseBreakBeats ?? DEFAULTS.phraseBreakBeats);
  const ambiguityMargin = Math.max(0, options.ambiguityMargin ?? DEFAULTS.ambiguityMargin);
  const maxPageCells = Math.max(1, Math.floor(options.maxPageCells ?? DEFAULTS.maxPageCells));
  const maxEventTokens = Math.max(1, Math.floor(options.maxEventTokens ?? DEFAULTS.maxEventTokens));
  const maxSplitWidth = options.maxSplitWidth === 1 ? 1 : DEFAULTS.maxSplitWidth;
  const paired = pairPages(reference, candidate, { allowPageOrdinalFallback: Boolean(options.allowPageOrdinalFallback), ambiguityMargin });
  const pages = paired.pages.map((page) => ({ ...page }));
  const diagnostics = [...rawPageDiagnostics(referenceInput, "reference"), ...timingDiagnostics(referenceInput, "reference"), ...canonicalTimingDiagnostics(reference, "reference"), ...rawPageDiagnostics(candidateInput, "candidate"), ...timingDiagnostics(candidateInput, "candidate"), ...canonicalTimingDiagnostics(candidate, "candidate"), ...paired.diagnostics];
  const invalidInput = diagnostics.some((diagnostic) => diagnostic.includes("invalid "));
  if (invalidInput) {
    const invalidPages = pages.map((page) => ({ ...page, status: "ambiguous" as const, diagnostics: [...page.diagnostics, "invalid score metadata; alignment unavailable"] }));
    return { status: "unavailable", pages: invalidPages, staffMappings: [], measures: [], unmatchedReferenceMeasures: reference.measures.map((measure) => measure.index).sort(compareNumbers), unmatchedCandidateMeasures: candidate.measures.map((measure) => measure.index).sort(compareNumbers), score: 0, diagnostics: [...diagnostics, "invalid score metadata; hierarchical alignment unavailable"] };
  }
  const allRegions: OmrMeasureRegionAlignment[] = [];
  const unmatchedReference: number[] = [];
  const unmatchedCandidate: number[] = [];
  const staffMappings: OmrStaffLaneMapping[] = [];
  let alignedPageCount = 0;
  let ambiguous = pages.some((page) => page.status === "ambiguous");
  for (const page of pages) {
    if (!page.reference || !page.candidate || page.status !== "aligned") {
      unmatchedReference.push(...page.referenceMeasureIndices);
      unmatchedCandidate.push(...page.candidateMeasureIndices);
      continue;
    }
    const referenceGroup = pageGroupFor(reference, page.reference);
    const candidateGroup = pageGroupFor(candidate, page.candidate);
    if (!referenceGroup || !candidateGroup) continue;
    const local = alignPage(referenceGroup, candidateGroup, { onsetToleranceBeats, ambiguityMargin, maxPageCells, maxSplitWidth, phraseBreakBeats, maxEventTokens });
    page.status = local.status;
    page.confidence = round(local.regions.length ? local.regions.reduce((sum, regionValue) => sum + regionValue.confidence, 0) / local.regions.length : 0);
    page.diagnostics.push(...local.diagnostics);
    allRegions.push(...local.regions);
    unmatchedReference.push(...local.unmatchedReference);
    unmatchedCandidate.push(...local.unmatchedCandidate);
    const mappings = mapLanes(reference, candidate, page, { ambiguityMargin, onsetToleranceBeats });
    staffMappings.push(...mappings);
    for (const mapping of mappings) if (mapping.status === "ambiguous") diagnostics.push(`ambiguous staff lane mapping for ${mapping.reference.partId}:${mapping.reference.staff ?? "none"}`);
    for (const mapping of mappings) if (mapping.status === "mapped" && (mapping.reference.role === null || mapping.candidate.role === null)) diagnostics.push(`inferred role-null staff lane mapping for ${mapping.reference.partId}`);
    if (local.status === "ambiguous") ambiguous = true;
    alignedPageCount += 1;
  }
  unmatchedReference.sort(compareNumbers);
  unmatchedCandidate.sort(compareNumbers);
  const unique = <T>(items: T[]): T[] => [...new Set(items)];
  const alignedRegions = allRegions.filter((regionValue) => regionValue.relation === "one-to-one" || regionValue.relation === "reference-split" || regionValue.relation === "candidate-merge");
  if (staffMappings.some((mapping) => mapping.status === "ambiguous")) ambiguous = true;
  const status: OmrHierarchicalAlignment["status"] = alignedPageCount === 0
    ? (ambiguous ? "ambiguous" : "unavailable")
    : ambiguous ? "ambiguous" : (unique(unmatchedReference).length || unique(unmatchedCandidate).length || pages.some((page) => page.status === "unmatched") ? "partial" : "aligned");
  const score = round(alignedRegions.length ? alignedRegions.reduce((sum, regionValue) => sum + regionValue.confidence, 0) / alignedRegions.length : 0);
  return {
    status,
    pages,
    staffMappings,
    measures: allRegions,
    unmatchedReferenceMeasures: unique(unmatchedReference).sort(compareNumbers),
    unmatchedCandidateMeasures: unique(unmatchedCandidate).sort(compareNumbers),
    score,
    diagnostics: [...diagnostics, ...(ambiguous ? ["hierarchical alignment contains ambiguous evidence"] : [])],
  };
}

/** Name kept as a discoverable counterpart to alignOmrScores(). */
export const alignOmrScoresHierarchical = alignHierarchicalOmrScores;
export const alignOmrScoresHierarchically = alignHierarchicalOmrScores;
