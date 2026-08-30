/**
 * Conservative, engine-local quality diagnostics for normalized OMR scores.
 *
 * This module intentionally does not compare engines. A region can be selected
 * from one engine even when another engine failed or disagreed elsewhere.
 */
import {
  normalizeOmrScore,
  type OmrBackendHealth,
  type OmrBackendRun,
  type OmrBackendStatus,
  type OmrNativeRun,
  type OmrNormalizedEvent,
  type OmrNormalizedMeasure,
  type OmrScoreInput,
  type NormalizedOmrScore,
} from "./omr-consensus.js";

export const OMR_QUALITY_SCHEMA_VERSION = 1 as const;

/** Conservative defaults. Increasing acceptance must be an explicit caller choice. */
export const DEFAULT_OMR_QUALITY_THRESHOLDS = Object.freeze({
  measureDurationToleranceBeats: 0.08,
  maxLeapSemitones: 24,
  densityAnomalyRatio: 3,
  continuityToleranceBeats: 0.08,
  tieContinuityToleranceBeats: 0.08,
  autoAcceptScore: 0.92,
  likelyOkScore: 0.78,
  reviewScore: 0.45,
} as const);

export type OmrQualityState = "AUTO_ACCEPT" | "LIKELY_OK" | "REVIEW" | "BROKEN";

export interface OmrQualityThresholds {
  measureDurationToleranceBeats: number;
  maxLeapSemitones: number;
  densityAnomalyRatio: number;
  continuityToleranceBeats: number;
  tieContinuityToleranceBeats: number;
  autoAcceptScore: number;
  likelyOkScore: number;
  reviewScore: number;
}

export interface OmrQualityCategory {
  score: number | null;
  available: boolean;
  basis: string | null;
  flags: string[];
}

export interface OmrQualityCategories {
  rhythmicValidity: OmrQualityCategory;
  pitchPlausibility: OmrQualityCategory;
  continuity: OmrQualityCategory;
  structuralValidity: OmrQualityCategory;
  densityAnomaly: OmrQualityCategory;
  notationCompleteness: OmrQualityCategory;
}

export interface OmrQualityMeasure {
  backendId: string;
  backendVersion: string;
  backendStatus: OmrBackendStatus;
  sourceLabel: string;
  priority: "native" | "omr";
  available: boolean;
  page: number | null;
  system: number | null;
  measureId: string | null;
  measureNumber: string | null;
  measureIndex: number | null;
  startBeat: number | null;
  durationBeats: number | null;
  staffNumbers: number[];
  voices: string[];
  events: OmrNormalizedEvent[];
  categories: OmrQualityCategories;
  score: number | null;
  state: OmrQualityState;
  diagnostics: string[];
}

export interface OmrQualityBackend {
  id: string;
  version: string;
  status: OmrBackendStatus;
  sourceLabel: string;
  priority: "native" | "omr";
  measureCount: number;
  availableMeasures: number;
  pages: number[];
  error: string | null;
}

export interface OmrQualityBackendSummary extends OmrQualityBackend {
  autoAcceptMeasures: number;
  likelyOkMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
}

export interface OmrQualityPageSummary {
  page: number | null;
  measureCount: number;
  availableMeasures: number;
  autoAcceptMeasures: number;
  likelyOkMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  backends: string[];
}

export interface OmrQualityRegionSummary {
  regionKey: string;
  page: number | null;
  measureId: string | null;
  measureNumber: string | null;
  candidates: number;
  selectedBackendId: string | null;
  selectedBackendVersion: string | null;
  selectedState: OmrQualityState | null;
  selectedScore: number | null;
}

export interface OmrQualityReport {
  schemaVersion: typeof OMR_QUALITY_SCHEMA_VERSION;
  consensusClaim: false;
  nativePriority: boolean;
  thresholds: OmrQualityThresholds;
  backends: OmrQualityBackend[];
  measures: OmrQualityMeasure[];
  backendSummaries: OmrQualityBackendSummary[];
  pageSummaries: OmrQualityPageSummary[];
  regionSummaries: OmrQualityRegionSummary[];
}

export interface OmrQualityInput {
  engines?: OmrBackendRun[];
  backends?: OmrBackendRun[];
  native?: OmrNativeRun;
  thresholds?: Partial<OmrQualityThresholds>;
}

export interface OmrQualitySelection {
  schemaVersion: typeof OMR_QUALITY_SCHEMA_VERSION;
  consensusClaim: false;
  regions: OmrQualityMeasure[];
}

interface Candidate {
  backend: OmrQualityBackend;
  normalized: NormalizedOmrScore | null;
  warnings: string[];
  error: string | null;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeStatus(value: unknown): OmrBackendStatus | null {
  return value === "available" || value === "unavailable" || value === "failed" ? value : null;
}

function safeHealth(value: unknown): OmrBackendHealth | null {
  return value === "available" || value === "partially-available" || value === "unavailable" || value === "broken-output" ? value : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(stableCompare).map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
}

function category(score: number | null, basis: string | null, flags: string[] = []): OmrQualityCategory {
  return {
    score: score === null ? null : rounded(clamp(score)),
    available: score !== null,
    basis,
    flags: [...new Set(flags)].sort(stableCompare),
  };
}

function emptyCategories(): OmrQualityCategories {
  return {
    rhythmicValidity: category(null, null),
    pitchPlausibility: category(null, null),
    continuity: category(null, null),
    structuralValidity: category(null, null),
    densityAnomaly: category(null, null),
    notationCompleteness: category(null, null),
  };
}

function normalizedRun(value: unknown, index: number): { run: OmrBackendRun; score: OmrScoreInput | null; status: OmrBackendStatus; error: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { run: { id: `backend-${index}`, version: "unknown", status: "failed", error: "malformed backend row" }, score: null, status: "failed", error: "malformed backend row" };
  }
  const source = value as Record<string, unknown>;
  const id = safeText(source.id, `backend-${index}`);
  const version = safeText(source.version, "unknown");
  const explicitStatus = safeStatus(source.status);
  const health = safeHealth(source.health);
  const scoreValue = source.score;
  const score = scoreValue && typeof scoreValue === "object" && !Array.isArray(scoreValue) ? scoreValue as OmrScoreInput : null;
  const status: OmrBackendStatus = explicitStatus
    ?? (health === "unavailable" ? "unavailable" : health === "broken-output" ? "failed" : score ? "available" : "failed");
  const error = typeof source.error === "string" && source.error.trim() ? source.error.replace(/\s+/g, " ").trim().slice(0, 500) : score ? null : "backend did not provide a score";
  const run: OmrBackendRun = {
    id,
    version,
    status,
    ...(score ? { score } : {}),
    ...(error ? { error } : {}),
    ...(typeof source.health === "string" ? { health: source.health as OmrBackendHealth } : {}),
    ...(source.pages !== undefined ? { pages: source.pages as OmrBackendRun["pages"] } : {}),
  };
  return { run, score, status, error };
}

function options(input: Partial<OmrQualityThresholds> | undefined): OmrQualityThresholds {
  const result: OmrQualityThresholds = { ...DEFAULT_OMR_QUALITY_THRESHOLDS };
  if (!input || typeof input !== "object") return result;
  for (const key of Object.keys(result) as Array<keyof OmrQualityThresholds>) {
    const value = input[key];
    if (!finite(value)) continue;
    if (key === "measureDurationToleranceBeats" || key === "continuityToleranceBeats" || key === "tieContinuityToleranceBeats") result[key] = Math.max(0, value);
    else if (key === "maxLeapSemitones" || key === "densityAnomalyRatio") result[key] = Math.max(1, value);
    else result[key] = clamp(value);
  }
  if (result.likelyOkScore > result.autoAcceptScore) result.likelyOkScore = result.autoAcceptScore;
  if (result.reviewScore > result.likelyOkScore) result.reviewScore = result.likelyOkScore;
  return result;
}

function eventKey(event: OmrNormalizedEvent): string {
  return [event.onset, event.duration, event.pitch, event.staff ?? "", event.voice ?? "", event.role ?? ""].join("|");
}

function laneKey(event: OmrNormalizedEvent): string {
  return [event.role ?? "", event.staff ?? "", event.voice ?? ""].join("|");
}

function orderedEvents(measure: OmrNormalizedMeasure): OmrNormalizedEvent[] {
  return [...measure.events].sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.duration - right.duration || stableCompare(left.id, right.id));
}

function rhythmic(measure: OmrNormalizedMeasure, thresholds: OmrQualityThresholds): OmrQualityCategory {
  if (!measure.events.length && !measure.rests.length) return category(null, "no note or rest timing evidence");
  const expected = measure.durationBeats;
  if (!finite(expected) || expected <= 0) return category(0, "measure duration is not positive", ["invalid-measure-duration"]);
  const ends = [...measure.events.map((event) => event.onset + event.duration), ...measure.rests.map((rest) => rest.onset + rest.duration)];
  const actual = Math.max(...ends, 0);
  const difference = actual - expected;
  const error = Math.abs(difference);
  const flags = error <= thresholds.measureDurationToleranceBeats ? [] : [difference < 0 ? "underfull-measure" : "overfull-measure"];
  return category(clamp(1 - error / Math.max(expected, 1)), `timeline end ${rounded(actual)} vs expected ${rounded(expected)}`, flags);
}

function pitch(measure: OmrNormalizedMeasure, thresholds: OmrQualityThresholds): OmrQualityCategory {
  if (!measure.events.length) return category(null, "no pitched-event evidence");
  const flags: string[] = [];
  const lanes = new Map<string, OmrNormalizedEvent[]>();
  for (const event of measure.events) lanes.set(laneKey(event), [...(lanes.get(laneKey(event)) ?? []), event]);
  for (const events of lanes.values()) {
    const sorted = orderedEvents({ ...measure, events });
    for (let index = 1; index < sorted.length; index += 1) {
      if (Math.abs(sorted[index]!.pitch - sorted[index - 1]!.pitch) > thresholds.maxLeapSemitones) flags.push("impossible-leap");
    }
  }
  return category(flags.length ? 0 : 1, "adjacent same-lane pitch interval", flags);
}

function continuity(measure: OmrNormalizedMeasure, thresholds: OmrQualityThresholds): OmrQualityCategory {
  if (!measure.events.length) return category(null, "no event continuity evidence");
  const flags: string[] = [];
  const seen = new Set<string>();
  const lanes = new Map<string, OmrNormalizedEvent[]>();
  for (const event of orderedEvents(measure)) {
    const key = eventKey(event);
    if (seen.has(key)) flags.push("duplicate-event");
    seen.add(key);
    lanes.set(laneKey(event), [...(lanes.get(laneKey(event)) ?? []), event]);
    if (event.tie.stop || event.tie.continue) {
      const prior = [...(lanes.get(laneKey(event)) ?? [])].slice(0, -1).some((candidate) => candidate.pitch === event.pitch && candidate.tie.start);
      if (!prior) flags.push(event.tie.stop ? "orphan-tie-stop" : "orphan-tie-continue");
    }
    if (event.tie.start && event.tie.stop) flags.push("invalid-tie");
  }
  for (const events of lanes.values()) {
    const sorted = orderedEvents({ ...measure, events });
    for (let index = 1; index < sorted.length; index += 1) {
      const prior = sorted[index - 1]!;
      const current = sorted[index]!;
      const gap = current.onset - (prior.onset + prior.duration);
      if (gap > thresholds.continuityToleranceBeats && !prior.tie.start) flags.push("continuity-gap");
      if (gap < -thresholds.continuityToleranceBeats) flags.push("continuity-overlap");
    }
  }
  const score = flags.some((flag) => flag.includes("duplicate") || flag.includes("orphan") || flag === "invalid-tie") ? 0 : flags.includes("continuity-overlap") ? 0.45 : flags.includes("continuity-gap") ? 0.7 : 1;
  return category(score, "same-lane ordering, gaps, overlaps, and tie boundaries", flags);
}

function structural(measure: OmrNormalizedMeasure, warnings: string[]): OmrQualityCategory {
  const flags: string[] = [];
  if (!measure.id || !measure.partId || !measure.number) flags.push("missing-measure-identity");
  if (!finite(measure.durationBeats) || measure.durationBeats <= 0) flags.push("invalid-measure-duration");
  if (warnings.length) flags.push("normalization-warning");
  for (const event of measure.events) {
    if (!finite(event.onset) || event.onset < 0 || !finite(event.duration) || event.duration <= 0 || !Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127) flags.push("invalid-event");
  }
  return category(flags.length ? 0 : 1, "normalized measure and event invariants", flags);
}

function notation(measure: OmrNormalizedMeasure): OmrQualityCategory {
  if (!measure.events.length) return category(null, "no notation event metadata");
  let available = 0;
  let total = 0;
  const flags: string[] = [];
  for (const event of measure.events) {
    const fields: Array<[unknown, string]> = [[event.staff, "missing-staff"], [event.voice, "missing-voice"], [event.accidental, "missing-accidental"]];
    for (const [value, flag] of fields) {
      total += 1;
      if (value !== null && value !== undefined) available += 1;
      else flags.push(flag);
    }
  }
  return category(total ? available / total : null, "staff, voice, and accidental metadata presence", flags);
}

function density(measure: OmrNormalizedMeasure, allMeasures: OmrNormalizedMeasure[], thresholds: OmrQualityThresholds): OmrQualityCategory {
  if (!measure.events.length || !finite(measure.durationBeats) || measure.durationBeats <= 0) return category(null, "no density evidence");
  const others = allMeasures.filter((candidate) => candidate.id !== measure.id && candidate.events.length && candidate.durationBeats > 0).map((candidate) => candidate.events.length / candidate.durationBeats).sort((left, right) => left - right);
  if (!others.length) return category(null, "no independent density baseline");
  const midpoint = Math.floor(others.length / 2);
  const baseline = others.length % 2 ? others[midpoint]! : (others[midpoint - 1]! + others[midpoint]!) / 2;
  const ratio = (measure.events.length / measure.durationBeats) / Math.max(baseline, Number.EPSILON);
  const flags = ratio > thresholds.densityAnomalyRatio ? ["density-spike"] : [];
  return category(flags.length ? clamp(1 - (ratio - thresholds.densityAnomalyRatio) / thresholds.densityAnomalyRatio) : 1, `density ratio ${rounded(ratio)} against leave-one-out median`, flags);
}

function classify(categories: OmrQualityCategories, thresholds: OmrQualityThresholds): { score: number | null; state: OmrQualityState } {
  const values = Object.values(categories).map((entry) => entry.score).filter((value): value is number => value !== null);
  if (!values.length) return { score: null, state: "BROKEN" };
  const score = rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
  const flags = Object.values(categories).flatMap((entry) => entry.flags);
  if (values.some((value) => value === 0) || flags.some((flag) => ["invalid-event", "invalid-measure-duration", "impossible-leap", "duplicate-event", "orphan-tie-stop", "orphan-tie-continue", "invalid-tie"].includes(flag))) return { score, state: "BROKEN" };
  if (score >= thresholds.autoAcceptScore && values.length === 6 && !flags.length) return { score, state: "AUTO_ACCEPT" };
  if (score >= thresholds.likelyOkScore && !flags.some((flag) => flag === "overfull-measure" || flag === "underfull-measure" || flag === "density-spike")) return { score, state: "LIKELY_OK" };
  if (score >= thresholds.reviewScore) return { score, state: "REVIEW" };
  return { score, state: "BROKEN" };
}

function unavailableMeasure(backend: OmrQualityBackend, error: string | null): OmrQualityMeasure {
  const diagnostics = [backend.status === "unavailable" ? "backend-unavailable" : backend.status === "failed" ? "backend-failed" : "backend-empty-score", ...(error ? [error] : [])].sort(stableCompare);
  return {
    backendId: backend.id, backendVersion: backend.version, backendStatus: backend.status, sourceLabel: backend.sourceLabel, priority: backend.priority,
    available: false, page: null, system: null, measureId: null, measureNumber: null, measureIndex: null, startBeat: null, durationBeats: null,
    staffNumbers: [], voices: [], events: [], categories: emptyCategories(), score: null, state: "BROKEN", diagnostics,
  };
}

function regionKey(row: Pick<OmrQualityMeasure, "page" | "measureId" | "measureNumber">): string {
  return `${row.page === null ? "unknown-page" : row.page}:${row.measureId ?? row.measureNumber ?? "unknown-measure"}`;
}

const STATE_RANK: Record<OmrQualityState, number> = { AUTO_ACCEPT: 4, LIKELY_OK: 3, REVIEW: 2, BROKEN: 1 };

function compareRows(left: OmrQualityMeasure, right: OmrQualityMeasure): number {
  return (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER)
    || (left.measureIndex ?? Number.MAX_SAFE_INTEGER) - (right.measureIndex ?? Number.MAX_SAFE_INTEGER)
    || stableCompare(left.measureId ?? "", right.measureId ?? "")
    || stableCompare(left.backendId, right.backendId)
    || stableCompare(left.backendVersion, right.backendVersion);
}

/** Evaluate every available backend and every normalized measure independently. */
export function evaluateOmrQuality(input: OmrQualityInput | OmrBackendRun[] = {}): OmrQualityReport {
  const source = Array.isArray(input) ? { engines: input } : input && typeof input === "object" ? input : {};
  const thresholds = options(source.thresholds);
  const rawRuns = [...(source.engines ?? source.backends ?? [])];
  const candidates: Candidate[] = [];
  for (let index = 0; index < rawRuns.length; index += 1) {
    const safe = normalizedRun(rawRuns[index], index);
    const backend: OmrQualityBackend = { id: safe.run.id, version: safe.run.version, status: safe.status, sourceLabel: safe.run.id, priority: "omr", measureCount: 0, availableMeasures: 0, pages: [], error: safe.error };
    let normalized: NormalizedOmrScore | null = null;
    let warnings: string[] = [];
    if (safe.score && safe.status === "available") {
      try {
        normalized = normalizeOmrScore(safe.score);
        warnings = normalized.warnings;
      } catch (error) {
        backend.status = "failed";
        backend.error = error instanceof Error ? error.message : "malformed backend score";
      }
    }
    backend.measureCount = normalized?.measures.length ?? 0;
    backend.availableMeasures = normalized?.measures.length ?? 0;
    backend.pages = [...new Set((normalized?.measures ?? []).map((measure) => measure.page).filter((page): page is number => page !== null))].sort((a, b) => a - b);
    candidates.push({ backend, normalized, warnings, error: backend.error });
  }
  if (source.native && source.native.score) {
    const backend: OmrQualityBackend = { id: safeText(source.native.id, "native"), version: safeText(source.native.version, "unknown"), status: "available", sourceLabel: "native", priority: "native", measureCount: 0, availableMeasures: 0, pages: [], error: null };
    let normalized: NormalizedOmrScore | null = null;
    let warnings: string[] = [];
    try { normalized = normalizeOmrScore(source.native.score); warnings = normalized.warnings; } catch (error) { backend.status = "failed"; backend.error = error instanceof Error ? error.message : "malformed native score"; }
    backend.measureCount = normalized?.measures.length ?? 0;
    backend.availableMeasures = normalized?.measures.length ?? 0;
    backend.pages = [...new Set((normalized?.measures ?? []).map((measure) => measure.page).filter((page): page is number => page !== null))].sort((a, b) => a - b);
    candidates.push({ backend, normalized, warnings, error: backend.error });
  }
  candidates.sort((left, right) => stableCompare(left.backend.id, right.backend.id) || stableCompare(left.backend.version, right.backend.version) || (left.backend.priority === right.backend.priority ? 0 : left.backend.priority === "native" ? -1 : 1));
  const rows: OmrQualityMeasure[] = [];
  for (const candidate of candidates) {
    if (!candidate.normalized || candidate.backend.status !== "available" || !candidate.normalized.measures.length) {
      rows.push(unavailableMeasure(candidate.backend, candidate.error));
      continue;
    }
    for (const measureValue of candidate.normalized.measures) {
      const categories: OmrQualityCategories = {
        rhythmicValidity: rhythmic(measureValue, thresholds),
        pitchPlausibility: pitch(measureValue, thresholds),
        continuity: continuity(measureValue, thresholds),
        structuralValidity: structural(measureValue, candidate.warnings.filter((warning) => warning.includes(measureValue.id))),
        densityAnomaly: density(measureValue, candidate.normalized.measures, thresholds),
        notationCompleteness: notation(measureValue),
      };
      const classified = classify(categories, thresholds);
      const diagnostics = [...new Set(Object.values(categories).flatMap((entry) => entry.flags))].sort(stableCompare);
      rows.push({
        backendId: candidate.backend.id, backendVersion: candidate.backend.version, backendStatus: candidate.backend.status, sourceLabel: candidate.backend.sourceLabel, priority: candidate.backend.priority,
        available: true, page: measureValue.page, system: measureValue.system, measureId: measureValue.id, measureNumber: measureValue.number, measureIndex: measureValue.index,
        startBeat: measureValue.startBeat, durationBeats: measureValue.durationBeats, staffNumbers: [...measureValue.staves], voices: [...measureValue.voices], events: orderedEvents(measureValue),
        categories, score: classified.score, state: classified.state, diagnostics,
      });
    }
  }
  rows.sort(compareRows);
  const summaries = candidates.map((candidate): OmrQualityBackendSummary => {
    const candidateRows = rows.filter((row) => row.backendId === candidate.backend.id && row.backendVersion === candidate.backend.version);
    return { ...candidate.backend, autoAcceptMeasures: candidateRows.filter((row) => row.state === "AUTO_ACCEPT").length, likelyOkMeasures: candidateRows.filter((row) => row.state === "LIKELY_OK").length, reviewMeasures: candidateRows.filter((row) => row.state === "REVIEW").length, brokenMeasures: candidateRows.filter((row) => row.state === "BROKEN").length };
  }).sort((left, right) => stableCompare(left.id, right.id) || stableCompare(left.version, right.version));
  const pages = [...new Set(rows.filter((row) => row.available).map((row) => row.page === null ? "unknown" : String(row.page)))].sort(stableCompare);
  const pageSummaries = pages.map((key): OmrQualityPageSummary => {
    const page = key === "unknown" ? null : Number(key);
    const pageRows = rows.filter((row) => row.available && row.page === page);
    return { page, measureCount: pageRows.length, availableMeasures: pageRows.filter((row) => row.available).length, autoAcceptMeasures: pageRows.filter((row) => row.state === "AUTO_ACCEPT").length, likelyOkMeasures: pageRows.filter((row) => row.state === "LIKELY_OK").length, reviewMeasures: pageRows.filter((row) => row.state === "REVIEW").length, brokenMeasures: pageRows.filter((row) => row.state === "BROKEN").length, backends: [...new Set(pageRows.map((row) => row.backendId))].sort(stableCompare) };
  });
  const regionKeys = [...new Set(rows.filter((row) => row.available).map(regionKey))].sort(stableCompare);
  const regionSummaries = regionKeys.map((key): OmrQualityRegionSummary => {
    const regionRows = rows.filter((row) => row.available && regionKey(row) === key);
    const selected = choose(regionRows);
    return { regionKey: key, page: selected?.page ?? null, measureId: selected?.measureId ?? null, measureNumber: selected?.measureNumber ?? null, candidates: regionRows.length, selectedBackendId: selected?.backendId ?? null, selectedBackendVersion: selected?.backendVersion ?? null, selectedState: selected?.state ?? null, selectedScore: selected?.score ?? null };
  });
  return { schemaVersion: OMR_QUALITY_SCHEMA_VERSION, consensusClaim: false, nativePriority: candidates.some((candidate) => candidate.backend.priority === "native"), thresholds, backends: candidates.map((candidate) => candidate.backend).sort((left, right) => stableCompare(left.id, right.id) || stableCompare(left.version, right.version)), measures: rows, backendSummaries: summaries, pageSummaries, regionSummaries };
}

function choose(rows: OmrQualityMeasure[]): OmrQualityMeasure | null {
  return [...rows].sort((left, right) => STATE_RANK[right.state] - STATE_RANK[left.state] || (right.score ?? -1) - (left.score ?? -1) || (left.priority === right.priority ? 0 : left.priority === "native" ? -1 : 1) || stableCompare(left.backendId, right.backendId) || stableCompare(left.backendVersion, right.backendVersion))[0] ?? null;
}

/** Select a backend independently for each page/measure region. */
export function selectBestOmrQuality(report: OmrQualityReport): OmrQualitySelection {
  const keys = [...new Set(report.measures.filter((row) => row.available).map(regionKey))].sort(stableCompare);
  return { schemaVersion: OMR_QUALITY_SCHEMA_VERSION, consensusClaim: false, regions: keys.map((key) => choose(report.measures.filter((row) => row.available && regionKey(row) === key))).filter((row): row is OmrQualityMeasure => row !== null) };
}

/** Alias for callers that describe independent selection as region selection. */
export const selectOmrQuality = selectBestOmrQuality;
export const selectBestOmrQualityRegions = selectBestOmrQuality;
export const selectOmrQualityRegions = selectBestOmrQuality;
export const buildOmrQualityReport = evaluateOmrQuality;
export const evaluateOmrScoreQuality = evaluateOmrQuality;

/** Stable JSON; no timestamps, paths, network access, or input-order dependence. */
export function canonicalOmrQualityJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export const canonicalOmrQualityReportJson = canonicalOmrQualityJson;
