/**
 * Role-local OMR quality and readiness diagnostics.
 *
 * This is deliberately separate from `omr-consensus.ts`: a score may have a
 * useful melody while its accompaniment is uncertain.  Every backend is
 * evaluated on its own evidence and the module never turns agreement (or the
 * absence of agreement) into a fabricated note.  The module is local tooling
 * and is intentionally not part of the catalog runtime barrel.
 */
import {
  evaluateOmrQuality,
  type OmrQualityCategory,
  type OmrQualityCategories,
  type OmrQualityInput,
  type OmrQualityMeasure,
  type OmrQualityReport,
  type OmrQualityThresholds,
} from "./omr-quality.js";
import type {
  OmrBackendRun,
  OmrNativeRun,
  OmrNormalizedEvent,
  OmrRole,
} from "./omr-consensus.js";

export const OMR_ROLE_QUALITY_SCHEMA_VERSION = 1 as const;

export type OmrRoleQualityState = "AUTO_ACCEPT" | "LIKELY_OK" | "REVIEW" | "BROKEN";
export type OmrRoleReadiness = "READY" | "REVIEW_REQUIRED" | "UNAVAILABLE";
export type OmrRoleReferenceState =
  | "MELODY_REFERENCE_READY"
  | "MELODY_REFERENCE_NOT_READY"
  | "HARMONY_REFERENCE_READY"
  | "HARMONY_REFERENCE_NOT_READY"
  | "RHYTHM_REFERENCE_READY"
  | "RHYTHM_REFERENCE_NOT_READY"
  | "UNAVAILABLE";

export interface OmrRoleQualityThresholds extends OmrQualityThresholds {
  /** Minimum role-bearing measure coverage before a role can be ready. */
  minReadyCoverage: number;
  /** Maximum fraction of eligible role measures that may require review. */
  maxReviewFraction: number;
  /** Broken role measures are never silently accepted by default. */
  maxBrokenFraction: number;
}

export const DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS: Readonly<OmrRoleQualityThresholds> = Object.freeze({
  measureDurationToleranceBeats: 0.08,
  maxLeapSemitones: 24,
  densityAnomalyRatio: 3,
  continuityToleranceBeats: 0.08,
  tieContinuityToleranceBeats: 0.08,
  autoAcceptScore: 0.92,
  likelyOkScore: 0.78,
  reviewScore: 0.45,
  minReadyCoverage: 0.8,
  maxReviewFraction: 0.2,
  maxBrokenFraction: 0,
});

export interface OmrRoleQualityCategories {
  rhythmicValidity: OmrQualityCategory;
  pitchPlausibility: OmrQualityCategory;
  continuity: OmrQualityCategory;
  structuralValidity: OmrQualityCategory;
  densityAnomaly: OmrQualityCategory;
  notationCompleteness: OmrQualityCategory;
}

export interface OmrRoleQualityMeasure {
  backendId: string;
  backendVersion: string;
  backendStatus: OmrQualityMeasure["backendStatus"];
  sourceLabel: string;
  priority: OmrQualityMeasure["priority"];
  role: OmrRole;
  available: boolean;
  page: number | null;
  system: number | null;
  measureId: string | null;
  measureNumber: string | null;
  measureIndex: number | null;
  startBeat: number | null;
  durationBeats: number | null;
  /** IDs are copied from normalized source events; no event is synthesized. */
  eventIds: string[];
  eventCount: number;
  categories: OmrRoleQualityCategories;
  score: number | null;
  state: OmrRoleQualityState;
  diagnostics: string[];
}

export interface OmrRoleQualityBackendSummary {
  backendId: string;
  backendVersion: string;
  priority: OmrQualityMeasure["priority"];
  role: OmrRole;
  measureCount: number;
  eligibleMeasures: number;
  availableMeasures: number;
  autoAcceptMeasures: number;
  likelyOkMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  coverage: number | null;
  score: number | null;
  readiness: OmrRoleReadiness;
  referenceState: OmrRoleReferenceState;
}

export interface OmrRoleReadinessSummary {
  role: OmrRole;
  readiness: OmrRoleReadiness;
  referenceState: OmrRoleReferenceState;
  preferredBackendId: string | null;
  preferredBackendVersion: string | null;
  coverage: number | null;
  eligibleMeasures: number;
  availableMeasures: number;
  trustedMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
}

export interface OmrRoleQualityReviewGroup {
  id: string;
  backendId: string;
  backendVersion: string;
  role: OmrRole;
  measureIds: string[];
  firstMeasureIndex: number;
  lastMeasureIndex: number;
  startBeat: number | null;
  endBeat: number | null;
  pageSystems: Array<{ page: number | null; system: number | null }>;
  rootCauses: string[];
  priorityClass: "high" | "medium" | "low";
  memberCount: number;
  estimatedEventCount: number;
  confidence: { min: number; median: number; max: number };
}

export interface OmrRoleQualityInput {
  engines?: OmrBackendRun[];
  backends?: OmrBackendRun[];
  native?: OmrNativeRun;
  /** Reuse a previously computed all-role report without recomputing it. */
  quality?: OmrQualityReport;
  thresholds?: Partial<OmrRoleQualityThresholds>;
}

export interface OmrRoleQualityReport {
  schemaVersion: typeof OMR_ROLE_QUALITY_SCHEMA_VERSION;
  /** Explicitly documents that no global Audiveris/HOMR agreement is required. */
  consensusClaim: false;
  selectionPolicy: "independent-backend-role-selection";
  thresholds: OmrRoleQualityThresholds;
  measures: OmrRoleQualityMeasure[];
  backendSummaries: OmrRoleQualityBackendSummary[];
  roleReadiness: Record<OmrRole, OmrRoleReadinessSummary>;
  reviewGroups: OmrRoleQualityReviewGroup[];
  nonClaims: string[];
}

const ROLES: readonly OmrRole[] = ["melody", "harmony", "rhythm"];
const HARD_FLAGS = new Set([
  "invalid-event",
  "invalid-measure-duration",
  "impossible-leap",
  "duplicate-event",
  "orphan-tie-stop",
  "orphan-tie-continue",
  "invalid-tie",
  "continuity-overlap",
  "event-outside-measure",
  "role-disappearance",
  "backend-failed",
]);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function roleReferenceState(role: OmrRole, readiness: OmrRoleReadiness): OmrRoleReferenceState {
  if (readiness === "UNAVAILABLE") return "UNAVAILABLE";
  const prefix = role === "melody" ? "MELODY" : role === "harmony" ? "HARMONY" : "RHYTHM";
  return `${prefix}_REFERENCE_${readiness === "READY" ? "READY" : "NOT_READY"}` as OmrRoleReferenceState;
}

function emptyCategory(basis: string): OmrQualityCategory {
  return { score: null, available: false, basis, flags: [] };
}

function category(score: number | null, basis: string, flags: readonly string[] = []): OmrQualityCategory {
  return {
    score: score === null ? null : rounded(clamp(score)),
    available: score !== null,
    basis,
    flags: [...new Set(flags)].sort(stableCompare),
  };
}

function emptyCategories(): OmrRoleQualityCategories {
  return {
    rhythmicValidity: emptyCategory("no role evidence"),
    pitchPlausibility: emptyCategory("no role evidence"),
    continuity: emptyCategory("no role evidence"),
    structuralValidity: emptyCategory("no role evidence"),
    densityAnomaly: emptyCategory("no role evidence"),
    notationCompleteness: emptyCategory("no role evidence"),
  };
}

function thresholdsFor(input: Partial<OmrRoleQualityThresholds> | undefined): OmrRoleQualityThresholds {
  const result = { ...DEFAULT_OMR_ROLE_QUALITY_THRESHOLDS };
  if (input && typeof input === "object") {
    for (const key of Object.keys(result) as Array<keyof OmrRoleQualityThresholds>) {
      const value = input[key];
      if (!finite(value)) continue;
      if (key === "measureDurationToleranceBeats" || key === "continuityToleranceBeats" || key === "tieContinuityToleranceBeats") result[key] = Math.max(0, value);
      else if (key === "maxLeapSemitones" || key === "densityAnomalyRatio") result[key] = Math.max(1, value);
      else result[key] = clamp(value);
    }
  }
  if (result.likelyOkScore > result.autoAcceptScore) result.likelyOkScore = result.autoAcceptScore;
  if (result.reviewScore > result.likelyOkScore) result.reviewScore = result.likelyOkScore;
  if (result.maxReviewFraction > 1) result.maxReviewFraction = 1;
  if (result.maxBrokenFraction > 1) result.maxBrokenFraction = 1;
  return result;
}

function safeQualityReport(input: OmrRoleQualityInput | OmrQualityReport | OmrBackendRun[] | unknown): OmrQualityReport {
  const candidate = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (candidate && candidate.schemaVersion === 1 && Array.isArray(candidate.measures) && Array.isArray(candidate.backends)) return input as OmrQualityReport;
  if (candidate?.quality && typeof candidate.quality === "object") {
    const quality = candidate.quality as Record<string, unknown>;
    if (quality.schemaVersion === 1 && Array.isArray(quality.measures) && Array.isArray(quality.backends)) return candidate.quality as OmrQualityReport;
  }
  if (Array.isArray(input)) return evaluateOmrQuality(input as OmrBackendRun[]);
  const value = candidate ?? {};
  const engines = Array.isArray(value.engines) ? value.engines as OmrBackendRun[] : Array.isArray(value.backends) ? value.backends as OmrBackendRun[] : [];
  const native = value.native && typeof value.native === "object" ? value.native as OmrNativeRun : undefined;
  const thresholds = value.thresholds && typeof value.thresholds === "object" ? value.thresholds as Partial<OmrQualityThresholds> : undefined;
  return evaluateOmrQuality({ engines, native, thresholds });
}

function roleEvents(row: OmrQualityMeasure, role: OmrRole): OmrNormalizedEvent[] {
  return (Array.isArray(row.events) ? row.events : [])
    .filter((event) => event && event.role === role)
    .sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.duration - right.duration || stableCompare(left.id, right.id));
}

function laneKey(event: OmrNormalizedEvent): string {
  return `${event.staff ?? "default"}|${event.voice ?? "default"}`;
}

interface OnsetGroup {
  start: number;
  events: OmrNormalizedEvent[];
}

function onsetGroups(events: readonly OmrNormalizedEvent[], tolerance: number): OnsetGroup[] {
  const groups: OnsetGroup[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (previous && event.onset - previous.start <= tolerance) previous.events.push(event);
    else groups.push({ start: event.onset, events: [event] });
  }
  return groups;
}

function representative(group: OnsetGroup, role: OmrRole): number {
  const pitches = group.events.map((event) => event.pitch).sort((left, right) => left - right);
  if (role === "melody") return pitches.at(-1)!;
  if (role === "rhythm") return pitches[0]!;
  return pitches[Math.floor(pitches.length / 2)]!;
}

function roleRhythm(events: readonly OmrNormalizedEvent[], measure: OmrQualityMeasure, thresholds: OmrRoleQualityThresholds): OmrQualityCategory {
  if (!events.length) return emptyCategory("no role timing evidence");
  const expected = measure.durationBeats;
  if (!finite(expected) || expected <= 0) return category(0, "role event bounds", ["invalid-measure-duration"]);
  const flags: string[] = [];
  for (const event of events) {
    if (!finite(event.onset) || event.onset < 0 || !finite(event.duration) || event.duration <= 0) flags.push("invalid-event");
    if (event.onset + event.duration > expected + thresholds.measureDurationToleranceBeats) flags.push("event-outside-measure");
  }
  return category(flags.length ? 0 : 1, "role event bounds; sparse role events do not imply missing rests", flags);
}

function rolePitch(events: readonly OmrNormalizedEvent[], role: OmrRole, thresholds: OmrRoleQualityThresholds): OmrQualityCategory {
  if (!events.length) return emptyCategory("no role pitch evidence");
  const byLane = new Map<string, OmrNormalizedEvent[]>();
  for (const event of events) byLane.set(laneKey(event), [...(byLane.get(laneKey(event)) ?? []), event]);
  const flags: string[] = [];
  for (const lane of byLane.values()) {
    const groups = onsetGroups(lane, thresholds.continuityToleranceBeats);
    for (let index = 1; index < groups.length; index += 1) {
      if (Math.abs(representative(groups[index]!, role) - representative(groups[index - 1]!, role)) > thresholds.maxLeapSemitones) flags.push("impossible-leap");
    }
  }
  return category(flags.length ? 0 : 1, "adjacent role onset-group pitch interval", flags);
}

function roleContinuity(events: readonly OmrNormalizedEvent[], thresholds: OmrRoleQualityThresholds): OmrQualityCategory {
  if (!events.length) return emptyCategory("no role continuity evidence");
  const flags: string[] = [];
  const seen = new Set<string>();
  const byLane = new Map<string, OmrNormalizedEvent[]>();
  for (const event of events) {
    const key = [event.onset, event.duration, event.pitch, event.staff ?? "", event.voice ?? ""].join("|");
    if (seen.has(key)) flags.push("duplicate-event");
    seen.add(key);
    byLane.set(laneKey(event), [...(byLane.get(laneKey(event)) ?? []), event]);
    if ((event.tie.stop || event.tie.continue) && !event.tie.start) {
      const prior = (byLane.get(laneKey(event)) ?? []).slice(0, -1).some((candidate) => candidate.pitch === event.pitch && candidate.tie.start);
      if (!prior) flags.push(event.tie.stop ? "orphan-tie-stop" : "orphan-tie-continue");
    }
    if (event.tie.start && event.tie.stop) flags.push("invalid-tie");
  }
  for (const lane of byLane.values()) {
    const sorted = [...lane].sort((left, right) => left.onset - right.onset || left.pitch - right.pitch || left.duration - right.duration || stableCompare(left.id, right.id));
    for (let index = 1; index < sorted.length; index += 1) {
      const prior = sorted[index - 1]!;
      const current = sorted[index]!;
      if (current.onset <= prior.onset + thresholds.continuityToleranceBeats) continue;
      if (current.onset < prior.onset + prior.duration - thresholds.continuityToleranceBeats) {
        const tied = current.pitch === prior.pitch && (prior.tie.start || current.tie.stop || current.tie.continue);
        if (!tied) flags.push("continuity-overlap");
      }
    }
  }
  const score = flags.some((flag) => flag === "duplicate-event" || flag.startsWith("orphan") || flag === "invalid-tie") ? 0 : flags.includes("continuity-overlap") ? 0.45 : 1;
  return category(score, "same-role lane ordering, overlap, duplicate, and tie boundaries", flags);
}

function roleNotation(events: readonly OmrNormalizedEvent[]): OmrQualityCategory {
  if (!events.length) return emptyCategory("no role notation evidence");
  let available = 0;
  let total = 0;
  const flags: string[] = [];
  for (const event of events) {
    for (const [value, flag] of [[event.staff, "missing-staff"], [event.voice, "missing-voice"], [event.accidental, "missing-accidental"]] as Array<[unknown, string]>) {
      total += 1;
      if (value !== null && value !== undefined) available += 1;
      else flags.push(flag);
    }
  }
  return category(total ? available / total : null, "role staff, voice, and accidental metadata presence", flags);
}

function roleDensity(
  events: readonly OmrNormalizedEvent[],
  measure: OmrQualityMeasure,
  baselines: readonly number[],
  thresholds: OmrRoleQualityThresholds,
): OmrQualityCategory {
  if (!events.length || !finite(measure.durationBeats) || measure.durationBeats <= 0) return emptyCategory("no role density evidence");
  if (!baselines.length) return emptyCategory("no independent role density baseline");
  const sorted = [...baselines].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const baseline = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const ratio = (events.length / measure.durationBeats) / Math.max(baseline, Number.EPSILON);
  const flags = ratio > thresholds.densityAnomalyRatio ? ["density-spike"] : [];
  return category(flags.length ? clamp(1 - (ratio - thresholds.densityAnomalyRatio) / thresholds.densityAnomalyRatio) : 1, `role density ratio ${rounded(ratio)} against leave-one-out median`, flags);
}

function structuralFrom(row: OmrQualityMeasure): OmrQualityCategory {
  const value = row.categories?.structuralValidity;
  if (!value || !finite(value.score)) return emptyCategory("no structural role evidence");
  return category(value.score, value.basis ?? "normalized measure invariants", value.flags ?? []);
}

function categoriesFor(events: readonly OmrNormalizedEvent[], row: OmrQualityMeasure, role: OmrRole, densityBaseline: readonly number[], thresholds: OmrRoleQualityThresholds): OmrRoleQualityCategories {
  return {
    rhythmicValidity: roleRhythm(events, row, thresholds),
    pitchPlausibility: rolePitch(events, role, thresholds),
    continuity: roleContinuity(events, thresholds),
    structuralValidity: structuralFrom(row),
    densityAnomaly: roleDensity(events, row, densityBaseline, thresholds),
    notationCompleteness: roleNotation(events),
  };
}

function classify(categories: OmrRoleQualityCategories, thresholds: OmrRoleQualityThresholds): { score: number | null; state: OmrRoleQualityState } {
  const values = Object.values(categories).map((value) => value.score).filter((value): value is number => finite(value));
  if (!values.length) return { score: null, state: "BROKEN" };
  const score = rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
  const flags = Object.values(categories).flatMap((value) => value.flags);
  if (values.some((value) => value === 0) || flags.some((flag) => HARD_FLAGS.has(flag))) return { score, state: "BROKEN" };
  if (score >= thresholds.autoAcceptScore && values.length >= 4 && !flags.length) return { score, state: "AUTO_ACCEPT" };
  if (score >= thresholds.likelyOkScore && !flags.some((flag) => ["overfull-measure", "underfull-measure", "density-spike"].includes(flag))) return { score, state: "LIKELY_OK" };
  if (score >= thresholds.reviewScore) return { score, state: "REVIEW" };
  return { score, state: "BROKEN" };
}

function rowFlags(categories: OmrRoleQualityCategories): string[] {
  return [...new Set(Object.values(categories).flatMap((value) => value.flags))].sort(stableCompare);
}

function confidence(row: OmrRoleQualityMeasure): number {
  return row.score ?? 0;
}

const STATE_RANK: Record<OmrRoleQualityState, number> = { AUTO_ACCEPT: 4, LIKELY_OK: 3, REVIEW: 2, BROKEN: 1 };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : rounded((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function rootCauses(row: OmrRoleQualityMeasure): string[] {
  const flags = row.diagnostics;
  const causes = new Set<string>();
  for (const flag of flags) {
    if (["invalid-measure-duration", "normalization-warning", "event-outside-measure", "role-disappearance", "invalid-event"].includes(flag)) causes.add("structure");
    else if (["impossible-leap", "isolated-pitch"].includes(flag)) causes.add("pitch");
    else if (["duplicate-event", "orphan-tie-stop", "orphan-tie-continue", "invalid-tie", "continuity-overlap"].includes(flag)) causes.add("continuity");
    else if (["density-spike"].includes(flag)) causes.add("density");
    else if (["missing-staff", "missing-voice", "missing-accidental"].includes(flag)) causes.add("notation");
    else if (flag === "no-role-evidence") causes.add("role-evidence");
  }
  if (!causes.size) causes.add(row.state === "BROKEN" ? "structure" : "review");
  return [...causes].sort(stableCompare);
}

function groupPriority(role: OmrRole, causes: readonly string[]): "high" | "medium" | "low" {
  if (role === "melody" && causes.some((cause) => ["pitch", "continuity", "structure", "density"].includes(cause))) return "high";
  if (role === "harmony") return "medium";
  return "low";
}

function sameGroup(left: OmrRoleQualityMeasure, right: OmrRoleQualityMeasure): boolean {
  if (left.backendId !== right.backendId || left.backendVersion !== right.backendVersion || left.role !== right.role) return false;
  if (left.measureIndex === null || right.measureIndex === null || right.measureIndex !== left.measureIndex + 1) return false;
  const rightCauses = new Set(rootCauses(right));
  if (!rootCauses(left).some((cause) => rightCauses.has(cause))) return false;
  return left.page === right.page && left.system === right.system;
}

function reviewGroup(rows: readonly OmrRoleQualityMeasure[]): OmrRoleQualityReviewGroup {
  const first = rows[0]!;
  const last = rows.at(-1)!;
  const confidences = rows.map(confidence);
  const causes = [...new Set(rows.flatMap(rootCauses))].sort(stableCompare);
  const systems = [...new Map(rows.map((row) => [`${row.page ?? "null"}:${row.system ?? "null"}`, { page: row.page, system: row.system }])).values()]
    .sort((left, right) => (left.page ?? -1) - (right.page ?? -1) || (left.system ?? -1) - (right.system ?? -1));
  const priorityClass = groupPriority(first.role, causes);
  return {
    id: `role-review:${first.backendId}:${first.role}:${first.measureIndex ?? 0}-${last.measureIndex ?? 0}:${causes.join(",")}`,
    backendId: first.backendId,
    backendVersion: first.backendVersion,
    role: first.role,
    measureIds: rows.map((row) => row.measureId).filter((value): value is string => value !== null),
    firstMeasureIndex: first.measureIndex ?? 0,
    lastMeasureIndex: last.measureIndex ?? 0,
    startBeat: finite(first.startBeat) ? rounded(first.startBeat) : null,
    endBeat: finite(last.startBeat) && finite(last.durationBeats) ? rounded(last.startBeat + last.durationBeats) : null,
    pageSystems: systems,
    rootCauses: causes,
    priorityClass,
    memberCount: rows.length,
    estimatedEventCount: rows.reduce((sum, row) => sum + row.eventCount, 0),
    confidence: { min: rounded(Math.min(...confidences, 0)), median: median(confidences), max: rounded(Math.max(...confidences, 0)) },
  };
}

/** Group only actual role issues; adjacent measures become one local task. */
export function groupOmrRoleQualityReviewRegions(report: OmrRoleQualityReport): OmrRoleQualityReviewGroup[] {
  const rows = (Array.isArray(report?.measures) ? report.measures : [])
    .filter((row) => row.state === "REVIEW" || row.state === "BROKEN")
    .filter((row) => Array.isArray(row.diagnostics) && row.diagnostics.length > 0 && !row.diagnostics.every((flag) => flag === "no-role-evidence"))
    .sort((left, right) => stableCompare(left.backendId, right.backendId) || stableCompare(left.backendVersion, right.backendVersion) || ROLES.indexOf(left.role) - ROLES.indexOf(right.role) || (left.measureIndex ?? Number.MAX_SAFE_INTEGER) - (right.measureIndex ?? Number.MAX_SAFE_INTEGER) || stableCompare(left.measureId ?? "", right.measureId ?? ""));
  const groups: OmrRoleQualityMeasure[][] = [];
  for (const row of rows) {
    const previous = groups.at(-1);
    if (!previous || !sameGroup(previous.at(-1)!, row)) groups.push([row]);
    else previous.push(row);
  }
  const priorityRank: Record<OmrRoleQualityReviewGroup["priorityClass"], number> = { high: 3, medium: 2, low: 1 };
  return groups.map(reviewGroup).sort((left, right) => priorityRank[right.priorityClass] - priorityRank[left.priorityClass] || left.firstMeasureIndex - right.firstMeasureIndex || stableCompare(left.id, right.id));
}

function backendKey(row: Pick<OmrQualityMeasure, "backendId" | "backendVersion">): string {
  return `${row.backendId}\u0000${row.backendVersion}`;
}

function summaryReadiness(eligible: number, auto: number, likely: number, review: number, broken: number, thresholds: OmrRoleQualityThresholds): OmrRoleReadiness {
  if (!eligible) return "UNAVAILABLE";
  const trusted = auto + likely;
  const coverage = trusted / eligible;
  return coverage >= thresholds.minReadyCoverage && review / eligible <= thresholds.maxReviewFraction && broken / eligible <= thresholds.maxBrokenFraction ? "READY" : "REVIEW_REQUIRED";
}

function summaryFor(rows: readonly OmrRoleQualityMeasure[], role: OmrRole, thresholds: OmrRoleQualityThresholds): OmrRoleQualityBackendSummary[] {
  const keys = [...new Set(rows.map(backendKey))].sort(stableCompare);
  return keys.flatMap((key) => {
    const candidates = rows.filter((row) => backendKey(row) === key && row.role === role);
    if (!candidates.length) return [];
    const first = candidates[0]!;
    // Once a role appears anywhere in a backend's score, an omitted role in a
    // present measure is a reviewable disappearance rather than silently
    // disappearing from the coverage denominator.  A role that never appears
    // remains unavailable and does not manufacture expected rests/events.
    const roleAppears = candidates.some((row) => row.eventCount > 0);
    const eligibleRows = roleAppears
      ? candidates.filter((row) => row.backendStatus === "available")
      : candidates.filter((row) => row.eventCount > 0);
    const eligible = eligibleRows.length;
    const auto = eligibleRows.filter((row) => row.state === "AUTO_ACCEPT").length;
    const likely = eligibleRows.filter((row) => row.state === "LIKELY_OK").length;
    const review = eligibleRows.filter((row) => row.state === "REVIEW").length;
    const broken = eligibleRows.filter((row) => row.state === "BROKEN").length;
    const readiness = summaryReadiness(eligible, auto, likely, review, broken, thresholds);
    const scored = eligibleRows.filter((row) => row.eventCount > 0 && row.score !== null).map((row) => row.score!);
    return [{
      backendId: first.backendId,
      backendVersion: first.backendVersion,
      priority: first.priority,
      role,
      measureCount: candidates.length,
      eligibleMeasures: eligible,
      availableMeasures: candidates.filter((row) => row.available).length,
      autoAcceptMeasures: auto,
      likelyOkMeasures: likely,
      reviewMeasures: review,
      brokenMeasures: broken,
      coverage: eligible ? rounded((auto + likely) / eligible) : null,
      score: scored.length ? rounded(scored.reduce((sum, value) => sum + value, 0) / scored.length) : null,
      readiness,
      referenceState: roleReferenceState(role, readiness),
    }];
  });
}

function readinessFor(role: OmrRole, summaries: readonly OmrRoleQualityBackendSummary[]): OmrRoleReadinessSummary {
  const candidates = summaries.filter((summary) => summary.role === role && summary.eligibleMeasures > 0);
  const rank: Record<OmrRoleReadiness, number> = { READY: 3, REVIEW_REQUIRED: 2, UNAVAILABLE: 1 };
  const preferred = [...candidates].sort((left, right) => rank[right.readiness] - rank[left.readiness]
    || (right.coverage ?? -1) - (left.coverage ?? -1)
    || (right.score ?? -1) - (left.score ?? -1)
    || (left.priority === right.priority ? 0 : left.priority === "native" ? -1 : 1)
    || stableCompare(left.backendId, right.backendId)
    || stableCompare(left.backendVersion, right.backendVersion))[0];
  const readiness = preferred?.readiness ?? "UNAVAILABLE";
  return {
    role,
    readiness,
    referenceState: roleReferenceState(role, readiness),
    preferredBackendId: preferred?.backendId ?? null,
    preferredBackendVersion: preferred?.backendVersion ?? null,
    coverage: preferred?.coverage ?? null,
    eligibleMeasures: preferred?.eligibleMeasures ?? 0,
    availableMeasures: preferred?.availableMeasures ?? 0,
    trustedMeasures: preferred ? preferred.autoAcceptMeasures + preferred.likelyOkMeasures : 0,
    reviewMeasures: preferred?.reviewMeasures ?? 0,
    brokenMeasures: preferred?.brokenMeasures ?? 0,
  };
}

/** Evaluate each backend and role independently; no global agreement is required. */
export function evaluateOmrRoleQuality(input: OmrRoleQualityInput | OmrQualityReport | OmrBackendRun[] = {}): OmrRoleQualityReport {
  const base = safeQualityReport(input);
  const inputRecord = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const sourceThresholds = inputRecord?.thresholds && typeof inputRecord.thresholds === "object"
    ? inputRecord.thresholds as Partial<OmrRoleQualityThresholds>
    : inputRecord?.quality && typeof inputRecord.quality === "object" && (inputRecord.quality as Record<string, unknown>).thresholds && typeof (inputRecord.quality as Record<string, unknown>).thresholds === "object"
      ? (inputRecord.quality as Record<string, unknown>).thresholds as Partial<OmrRoleQualityThresholds>
      : undefined;
  const thresholds = thresholdsFor(sourceThresholds);
  const baseRows = Array.isArray(base.measures) ? base.measures : [];
  const rolePresence = new Map<string, number>();
  for (const row of baseRows) {
    for (const role of ROLES) rolePresence.set(`${backendKey(row)}\u0000${role}`, (rolePresence.get(`${backendKey(row)}\u0000${role}`) ?? 0) + (roleEvents(row, role).length ? 1 : 0));
  }
  const densityBaselines = new Map<string, number[]>();
  for (const row of baseRows) {
    if (!row.available || !finite(row.durationBeats) || row.durationBeats <= 0) continue;
    for (const role of ROLES) {
      const events = roleEvents(row, role);
      if (events.length) {
        const key = `${backendKey(row)}\u0000${role}`;
        densityBaselines.set(key, [...(densityBaselines.get(key) ?? []), events.length / row.durationBeats]);
      }
    }
  }
  const roleRows: OmrRoleQualityMeasure[] = [];
  for (const baseRow of baseRows) {
    for (const role of ROLES) {
      const events = baseRow.available ? roleEvents(baseRow, role) : [];
      const roleKey = `${backendKey(baseRow)}\u0000${role}`;
      const globallyPresent = (rolePresence.get(roleKey) ?? 0) > 0;
      if (!baseRow.available) {
        const unavailableDiagnostic = baseRow.backendStatus === "failed" ? "backend-failed" : "backend-empty-score";
        roleRows.push({
          backendId: baseRow.backendId, backendVersion: baseRow.backendVersion, backendStatus: baseRow.backendStatus, sourceLabel: baseRow.sourceLabel, priority: baseRow.priority,
          role, available: false, page: baseRow.page, system: baseRow.system, measureId: baseRow.measureId, measureNumber: baseRow.measureNumber, measureIndex: baseRow.measureIndex,
          startBeat: baseRow.startBeat, durationBeats: baseRow.durationBeats, eventIds: [], eventCount: 0, categories: emptyCategories(), score: null, state: "BROKEN", diagnostics: [unavailableDiagnostic],
        });
        continue;
      }
      if (!events.length) {
        // A role absent from the complete score is unavailable, not a review
        // task. Once the role appears elsewhere, disappearance is reviewable.
        roleRows.push({
          backendId: baseRow.backendId, backendVersion: baseRow.backendVersion, backendStatus: baseRow.backendStatus, sourceLabel: baseRow.sourceLabel, priority: baseRow.priority,
          role, available: false, page: baseRow.page, system: baseRow.system, measureId: baseRow.measureId, measureNumber: baseRow.measureNumber, measureIndex: baseRow.measureIndex,
          startBeat: baseRow.startBeat, durationBeats: baseRow.durationBeats, eventIds: [], eventCount: 0, categories: emptyCategories(), score: null,
          state: globallyPresent ? "REVIEW" : "BROKEN", diagnostics: globallyPresent ? ["role-disappearance"] : ["no-role-evidence"],
        });
        continue;
      }
      const densityBaseline = [...(densityBaselines.get(roleKey) ?? [])];
      const currentDensity = finite(baseRow.durationBeats) && baseRow.durationBeats > 0 ? events.length / baseRow.durationBeats : null;
      if (currentDensity !== null) {
        const currentIndex = densityBaseline.findIndex((value) => Math.abs(value - currentDensity) <= Number.EPSILON * 16);
        if (currentIndex >= 0) densityBaseline.splice(currentIndex, 1);
      }
      const categories = categoriesFor(events, baseRow, role, densityBaseline, thresholds);
      const classified = classify(categories, thresholds);
      roleRows.push({
        backendId: baseRow.backendId, backendVersion: baseRow.backendVersion, backendStatus: baseRow.backendStatus, sourceLabel: baseRow.sourceLabel, priority: baseRow.priority,
        role, available: true, page: baseRow.page, system: baseRow.system, measureId: baseRow.measureId, measureNumber: baseRow.measureNumber, measureIndex: baseRow.measureIndex,
        startBeat: baseRow.startBeat, durationBeats: baseRow.durationBeats, eventIds: events.map((event) => event.id), eventCount: events.length, categories, score: classified.score, state: classified.state, diagnostics: rowFlags(categories),
      });
    }
  }
  roleRows.sort((left, right) => (left.measureIndex ?? Number.MAX_SAFE_INTEGER) - (right.measureIndex ?? Number.MAX_SAFE_INTEGER) || stableCompare(left.backendId, right.backendId) || stableCompare(left.backendVersion, right.backendVersion) || ROLES.indexOf(left.role) - ROLES.indexOf(right.role) || stableCompare(left.measureId ?? "", right.measureId ?? ""));
  const backendSummaries = ROLES.flatMap((role) => summaryFor(roleRows, role, thresholds)).sort((left, right) => stableCompare(left.backendId, right.backendId) || stableCompare(left.backendVersion, right.backendVersion) || ROLES.indexOf(left.role) - ROLES.indexOf(right.role));
  const roleReadiness = Object.fromEntries(ROLES.map((role) => [role, readinessFor(role, backendSummaries)])) as Record<OmrRole, OmrRoleReadinessSummary>;
  const report: OmrRoleQualityReport = {
    schemaVersion: OMR_ROLE_QUALITY_SCHEMA_VERSION,
    consensusClaim: false,
    selectionPolicy: "independent-backend-role-selection",
    thresholds,
    measures: roleRows,
    backendSummaries,
    roleReadiness,
    reviewGroups: [],
    nonClaims: [
      "Role readiness is an automatic structural/notation diagnostic, not proof of musical correctness.",
      "Melody readiness is independent from harmony and rhythm readiness.",
      "No note is synthesized; eventIds refer only to normalized source events.",
      "Human notation review and listening remain required before a reference is trusted.",
    ],
  };
  report.reviewGroups = groupOmrRoleQualityReviewRegions(report);
  return report;
}

export const buildOmrRoleQualityReport = evaluateOmrRoleQuality;
export const evaluateOmrRoleReadiness = evaluateOmrRoleQuality;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(stableCompare).map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
}

/** Stable JSON for local reports; excludes no evidence and has no timestamps. */
export function canonicalOmrRoleQualityJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export const canonicalOmrRoleQualityReportJson = canonicalOmrRoleQualityJson;
