/**
 * Additive, pure role-aware projections of an OMR consensus report.
 *
 * The consensus builder remains the source of trust decisions and its raw
 * review items are deliberately not changed here. This module only gives
 * benchmark and human-review consumers explicit role lanes and masks.
 */
import {
  sanitizeOmrMetadata,
  type OmrConsensusMeasure,
  type OmrConsensusReport,
  type OmrDisagreementKind,
  type OmrNormalizedEvent,
  type OmrRole,
  type OmrTrustState,
} from "./omr-consensus.js";

export const OMR_PARTIAL_REFERENCE_SCHEMA_VERSION = 1 as const;

export type TrustedRole = OmrRole;
export type PartialRoleState = "TRUSTED_NATIVE" | "TRUSTED_CONSENSUS" | "TRUSTED_SINGLE_ENGINE" | "UNKNOWN";

export interface RoleProvenance {
  kind: "native" | "dual-omr-consensus" | "single-engine" | "unknown";
  engineIds: string[];
  versions: string[];
  independenceGroups: string[];
  sourceSha256: string | null;
}

export interface TrustedRoleEvent {
  id: string;
  role: TrustedRole;
  measureId: string;
  onset: number;
  duration: number;
  midi: number;
  pitchClass: number;
  sourceEventId: string;
  /** Source notation segments when a tie is collapsed into one attack. */
  sourceSegmentIds?: string[];
}

export interface PartialRoleCell {
  state: PartialRoleState;
  confidence: number | null;
  eventIds: string[];
  eventCount: number;
  provenance: RoleProvenance;
}

export interface TrustedRoleRegion {
  id: string;
  measureIds: string[];
  startBeat: number;
  endBeat: number;
  roles: Record<TrustedRole, PartialRoleCell>;
  unknownRoles: TrustedRole[];
  pageSystems: Array<{ page: number | null; system: number | null }>;
  /** Set when a Task 3 region was supplied; absent for a flat region. */
  alignmentRegionId?: string;
}

export interface RoleCoverage {
  trustedBeatSpan: number;
  eligibleBeatSpan: number;
  unknownBeatSpan: number;
  trustedEventCount: number;
  unknownEventCount: number;
  coverage: number | null;
}

export interface PartialScoreReference {
  schemaVersion: typeof OMR_PARTIAL_REFERENCE_SCHEMA_VERSION;
  score: { id: string; artist?: string; title?: string };
  source: { sha256: string | null; artifactType: string; accessMethod: string | null };
  /** Explicitly identifies whether a hierarchical adapter supplied regions. */
  alignment: "hierarchical" | "flat-fallback";
  measureOrder: string[];
  regions: TrustedRoleRegion[];
  lanes: Record<TrustedRole, TrustedRoleEvent[]>;
  unknownMasks: Array<{
    role: TrustedRole;
    startBeat: number;
    endBeat: number;
    measureIds: string[];
    reason: "review-required" | "failed" | "role-unassigned" | "no-evidence";
  }>;
  coverage: Record<TrustedRole, RoleCoverage>;
  nonClaims: string[];
}

/** The v1 seam for Task 3 without importing its implementation. */
export interface RoleAlignmentRegion {
  id: string;
  canonicalMeasureIds: string[];
  sourceMeasureIds: Record<string, string[]>;
  startBeat: number;
  endBeat: number;
  confidence: number;
  status: "aligned" | "split" | "merged" | "ambiguous" | "unmatched";
}

/** Alias for callers that use the OMR-prefixed naming convention. */
export type OmrRoleAlignmentRegion = RoleAlignmentRegion;

export interface RoleReferenceOptions {
  score?: { id?: string; artist?: string; title?: string };
  source?: { sha256?: string | null; artifactType?: string; accessMethod?: string | null };
  alignedRegions?: readonly RoleAlignmentRegion[];
  /** Alias accepted for adapters that call these alignment regions. */
  alignmentRegions?: readonly RoleAlignmentRegion[];
  minAlignmentConfidence?: number;
}

export interface OmrReviewGroup {
  id: string;
  measureIds: string[];
  firstMeasureIndex: number;
  lastMeasureIndex: number;
  startBeat: number | null;
  endBeat: number | null;
  pageSystems: Array<{ page: number | null; system: number | null }>;
  rootCauses: OmrDisagreementKind[];
  roles: TrustedRole[];
  priority: number;
  priorityClass: "high" | "medium" | "low";
  memberCount: number;
  estimatedEventCount: number;
  confidence: { min: number; median: number; max: number };
  memberItems: string[];
}

export interface OmrReviewGroupSummary {
  rawItemCount: number;
  groupedRegionCount: number;
  criticalGroupCount: number;
}

const ROLES: readonly TrustedRole[] = ["melody", "harmony", "rhythm"];
const TRUSTED_STATES = new Set<OmrTrustState>(["TRUSTED_NATIVE", "TRUSTED_CONSENSUS", "TRUSTED_SINGLE_ENGINE"]);
const DISAGREEMENT_ORDER: readonly OmrDisagreementKind[] = [
  "structure",
  "unmatched-measure",
  "melody-pitch",
  "rhythm",
  "rhythm-pitch",
  "harmony-pitch",
  "continuity",
];
const EPS = 2e-6;
const DISAGREEMENT_KINDS = new Set<OmrDisagreementKind>(DISAGREEMENT_ORDER);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function roleCompare(left: TrustedRole, right: TrustedRole): number {
  return ROLES.indexOf(left) - ROLES.indexOf(right);
}

function stableUnique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function trustedState(state: OmrTrustState | null): state is "TRUSTED_NATIVE" | "TRUSTED_CONSENSUS" | "TRUSTED_SINGLE_ENGINE" {
  return state !== null && TRUSTED_STATES.has(state);
}

function validRole(value: unknown): value is TrustedRole {
  return value === "melody" || value === "harmony" || value === "rhythm";
}

function safeRoleState(value: unknown): { state: OmrTrustState | null; confidence: number | null } {
  if (!value || typeof value !== "object") return { state: null, confidence: null };
  const candidate = value as { state?: unknown; confidence?: unknown };
  const states: readonly (OmrTrustState | null)[] = ["TRUSTED_NATIVE", "TRUSTED_CONSENSUS", "TRUSTED_SINGLE_ENGINE", "REVIEW_REQUIRED", "FAILED", null];
  const state = states.includes(candidate.state as OmrTrustState | null) ? candidate.state as OmrTrustState | null : null;
  return { state, confidence: finite(candidate.confidence) ? rounded(candidate.confidence) : null };
}

function safeEvent(value: unknown, fallbackMeasureId: string, fallbackMeasureIndex: number, index: number): OmrNormalizedEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<OmrNormalizedEvent>;
  if (typeof candidate.id !== "string" || !candidate.id || !finite(candidate.onset) || candidate.onset < 0 || !finite(candidate.duration) || candidate.duration <= 0 || !finite(candidate.pitch) || !Number.isInteger(candidate.pitch) || candidate.pitch < 0 || candidate.pitch > 127) return null;
  const tie = candidate.tie && typeof candidate.tie === "object" ? candidate.tie : {};
  return {
    id: candidate.id,
    partId: typeof candidate.partId === "string" ? candidate.partId : "unknown",
    measureId: typeof candidate.measureId === "string" ? candidate.measureId : fallbackMeasureId,
    measureIndex: finite(candidate.measureIndex) ? candidate.measureIndex : fallbackMeasureIndex,
    onset: rounded(candidate.onset),
    duration: rounded(candidate.duration),
    pitch: candidate.pitch,
    accidental: typeof candidate.accidental === "string" ? candidate.accidental : null,
    tie: { start: Boolean((tie as { start?: unknown }).start), stop: Boolean((tie as { stop?: unknown }).stop), continue: Boolean((tie as { continue?: unknown }).continue) },
    staff: finite(candidate.staff) ? candidate.staff : null,
    voice: typeof candidate.voice === "string" ? candidate.voice : null,
    role: validRole(candidate.role) ? candidate.role : null,
    tuplet: Boolean(candidate.tuplet),
  };
}

function safeMeasure(value: unknown, fallbackIndex: number): OmrConsensusMeasure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<OmrConsensusMeasure>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  const events = Array.isArray(candidate.events)
    ? candidate.events.map((event, index) => safeEvent(event, candidate.id!, finite(candidate.index) ? candidate.index : fallbackIndex, index)).filter((event): event is OmrNormalizedEvent => event !== null)
    : [];
  const roleSource = candidate.roles && typeof candidate.roles === "object" ? candidate.roles as Record<string, unknown> : {};
  const roles = {
    melody: safeRoleState(roleSource.melody),
    harmony: safeRoleState(roleSource.harmony),
    rhythm: safeRoleState(roleSource.rhythm),
  };
  const agreementValue = candidate.agreement && typeof candidate.agreement === "object" ? candidate.agreement as unknown as Record<string, unknown> : null;
  const disagreements = agreementValue && Array.isArray(agreementValue.disagreements)
    ? agreementValue.disagreements.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && DISAGREEMENT_KINDS.has((entry as { kind?: unknown }).kind as OmrDisagreementKind))).map((entry) => ({
      kind: entry.kind as OmrDisagreementKind,
      role: validRole(entry.role) ? entry.role : null,
      severity: finite(entry.severity) ? rounded(entry.severity) : 0,
      detail: typeof entry.detail === "string" ? entry.detail : "structured disagreement",
    }))
    : [];
  const agreement = agreementValue && Array.isArray(agreementValue.disagreements) ? { ...candidate.agreement, disagreements } as NonNullable<OmrConsensusMeasure["agreement"]> : null;
  return {
    ...candidate,
    id: candidate.id,
    index: finite(candidate.index) ? candidate.index : fallbackIndex,
    number: typeof candidate.number === "string" ? candidate.number : String(candidate.number ?? fallbackIndex + 1),
    source: typeof candidate.source === "string" ? candidate.source : "unknown",
    page: finite(candidate.page) ? candidate.page : null,
    system: finite(candidate.system) ? candidate.system : null,
    startBeat: finite(candidate.startBeat) ? Math.max(0, rounded(candidate.startBeat)) : 0,
    durationBeats: finite(candidate.durationBeats) ? Math.max(0, rounded(candidate.durationBeats)) : 0,
    state: candidate.state === "TRUSTED_NATIVE" || candidate.state === "TRUSTED_CONSENSUS" || candidate.state === "TRUSTED_SINGLE_ENGINE" || candidate.state === "REVIEW_REQUIRED" || candidate.state === "FAILED" ? candidate.state : "FAILED",
    confidence: finite(candidate.confidence) ? rounded(candidate.confidence) : 0,
    agreement,
    roles,
    events,
    reviewReasons: Array.isArray(candidate.reviewReasons) ? candidate.reviewReasons.filter((reason): reason is string => typeof reason === "string") : [],
  };
}

function safeReviewItem(value: unknown, fallbackIndex: number): OmrConsensusReport["reviewItems"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<OmrConsensusReport["reviewItems"][number]>;
  if (typeof candidate.measureId !== "string" || !candidate.measureId) return null;
  return {
    measureId: candidate.measureId,
    measureIndex: finite(candidate.measureIndex) ? candidate.measureIndex : fallbackIndex,
    number: typeof candidate.number === "string" ? candidate.number : String(fallbackIndex + 1),
    priority: finite(candidate.priority) ? candidate.priority : 0,
    priorityClass: candidate.priorityClass === "high" || candidate.priorityClass === "medium" || candidate.priorityClass === "low" ? candidate.priorityClass : "low",
    reasons: Array.isArray(candidate.reasons) ? candidate.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    roles: Array.isArray(candidate.roles) ? candidate.roles.filter(validRole) : [],
  };
}

/** Strip malformed nested report rows before projecting; invalid rows fail closed. */
function safeReport(value: unknown): OmrConsensusReport {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<OmrConsensusReport> : {};
  const measures = Array.isArray(source.measures) ? source.measures.map((measure, index) => safeMeasure(measure, index)).filter((measure): measure is OmrConsensusMeasure => measure !== null) : [];
  const reviewItems = Array.isArray(source.reviewItems) ? source.reviewItems.map((item, index) => safeReviewItem(item, index)).filter((item): item is OmrConsensusReport["reviewItems"][number] => item !== null) : [];
  const backends = Array.isArray(source.backends)
    ? source.backends
      .filter((backend): backend is OmrConsensusReport["backends"][number] => Boolean(backend && typeof backend === "object" && typeof (backend as { id?: unknown }).id === "string" && typeof (backend as { version?: unknown }).version === "string"))
      .map((backend) => ({
        ...backend,
        independenceGroup: typeof backend.independenceGroup === "string" ? backend.independenceGroup : backend.id,
        status: backend.status === "available" || backend.status === "unavailable" || backend.status === "failed" ? backend.status : "failed",
        measureCount: finite(backend.measureCount) ? backend.measureCount : 0,
      }))
    : [];
  const alignments = Array.isArray(source.alignments)
    ? source.alignments
      .filter((entry): entry is OmrConsensusReport["alignments"][number] => Boolean(entry && typeof entry === "object" && typeof (entry as { left?: unknown }).left === "string" && typeof (entry as { right?: unknown }).right === "string" && (entry as { alignment?: unknown }).alignment && typeof (entry as { alignment?: unknown }).alignment === "object" && Array.isArray(((entry as { alignment: { matches?: unknown } }).alignment).matches)))
    : [];
  const native = source.native && typeof source.native === "object" && source.native.provenance && typeof source.native.provenance === "object"
    ? source.native
    : undefined;
  return { ...source, measures, reviewItems, backends, alignments, ...(native ? { native } : { native: undefined }) } as OmrConsensusReport;
}

function pageSystemCompare(left: { page: number | null; system: number | null }, right: { page: number | null; system: number | null }): number {
  return (left.page ?? -1) - (right.page ?? -1) || (left.system ?? -1) - (right.system ?? -1);
}

function stablePageSystems(measures: readonly OmrConsensusMeasure[]): Array<{ page: number | null; system: number | null }> {
  const seen = new Set<string>();
  const values = measures
    .map((measure) => ({ page: measure.page, system: measure.system }))
    .filter((value) => {
      const key = `${value.page ?? "null"}:${value.system ?? "null"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.sort(pageSystemCompare);
}

function measureEnd(measure: OmrConsensusMeasure): number {
  return rounded(measure.startBeat + Math.max(0, measure.durationBeats));
}

function sourceMetadata(report: OmrConsensusReport, options: RoleReferenceOptions): PartialScoreReference["source"] {
  const native = report.native?.provenance;
  const reportMetadata = report.metadata && typeof report.metadata === "object" && !Array.isArray(report.metadata)
    ? report.metadata as Record<string, unknown>
    : {};
  const source = options.source ?? {};
  const sha256 = typeof source.sha256 === "string"
    ? source.sha256
    : typeof native?.sha256 === "string"
      ? native.sha256
      : typeof reportMetadata.sha256 === "string" ? reportMetadata.sha256 : null;
  const artifactType = typeof source.artifactType === "string" && source.artifactType.trim()
    ? source.artifactType.trim()
    : typeof native?.artifactType === "string" ? native.artifactType : "omr-consensus";
  const accessMethod = typeof source.accessMethod === "string"
    ? source.accessMethod
    : typeof native?.accessMethod === "string" ? native.accessMethod : null;
  const sanitized = sanitizeOmrMetadata({ sha256, artifactType, accessMethod }) as Record<string, unknown>;
  return {
    sha256: typeof sanitized.sha256 === "string" && sanitized.sha256 !== "[redacted-path]" ? sanitized.sha256 : null,
    artifactType: typeof sanitized.artifactType === "string" ? sanitized.artifactType : "omr-consensus",
    accessMethod: typeof sanitized.accessMethod === "string" ? sanitized.accessMethod : null,
  };
}

function reportScore(report: OmrConsensusReport, options: RoleReferenceOptions): PartialScoreReference["score"] {
  const score = options.score ?? {};
  const metadata = report.metadata && typeof report.metadata === "object" && !Array.isArray(report.metadata)
    ? report.metadata as Record<string, unknown>
    : {};
  const rawId = typeof score.id === "string" && score.id.trim()
    ? score.id.trim()
    : typeof metadata.scoreId === "string" && metadata.scoreId.trim() ? metadata.scoreId.trim() : "omr-score";
  const rawTitle = typeof score.title === "string" ? score.title : typeof metadata.title === "string" ? metadata.title : undefined;
  const rawArtist = typeof score.artist === "string" ? score.artist : typeof metadata.artist === "string" ? metadata.artist : undefined;
  const sanitized = sanitizeOmrMetadata({ id: rawId, title: rawTitle, artist: rawArtist }) as Record<string, unknown>;
  const id = typeof sanitized.id === "string" && sanitized.id !== "[redacted-path]" ? sanitized.id : "omr-score";
  const title = typeof sanitized.title === "string" && sanitized.title !== "[redacted-path]" ? sanitized.title : undefined;
  const artist = typeof sanitized.artist === "string" && sanitized.artist !== "[redacted-path]" ? sanitized.artist : undefined;
  return { id, ...(artist ? { artist } : {}), ...(title ? { title } : {}) };
}

function availableBackends(report: OmrConsensusReport): OmrConsensusReport["backends"] {
  return [...(Array.isArray(report.backends) ? report.backends : [])]
    .filter((backend) => backend.status === "available" && backend.measureCount > 0)
    .sort((left, right) => compareStrings(left.id, right.id) || compareStrings(left.version, right.version));
}

function consensusParticipants(report: OmrConsensusReport, measure: OmrConsensusMeasure): OmrConsensusReport["backends"] {
  const alignments = Array.isArray(report.alignments) ? report.alignments : [];
  const alignment = alignments.find((entry) => entry.left === measure.source
    && Array.isArray(entry.alignment?.matches)
    && entry.alignment.matches.some((match) => Boolean(match && typeof match === "object" && (match.referenceMeasureId === measure.id || match.referenceIndex === measure.index))));
  const ids = alignment ? stableUnique([alignment.left, alignment.right]) : [measure.source];
  return availableBackends(report).filter((backend) => ids.includes(backend.id));
}

function roleProvenance(report: OmrConsensusReport, measure: OmrConsensusMeasure, role: TrustedRole): RoleProvenance {
  const state = measure.roles[role].state;
  const native = report.native;
  if (state === "TRUSTED_NATIVE" && native) {
    return {
      kind: "native",
      engineIds: [native.id],
      versions: [native.version],
      independenceGroups: ["native"],
      sourceSha256: typeof native.provenance.sha256 === "string" ? native.provenance.sha256 : null,
    };
  }
  if (state === "TRUSTED_CONSENSUS") {
    const backends = consensusParticipants(report, measure);
    if (backends.length < 2) return { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null };
    return {
      kind: "dual-omr-consensus",
      engineIds: stableUnique(backends.map((backend) => backend.id)).sort(compareStrings),
      versions: stableUnique(backends.map((backend) => backend.version)).sort(compareStrings),
      independenceGroups: stableUnique(backends.map((backend) => backend.independenceGroup)).sort(compareStrings),
      sourceSha256: null,
    };
  }
  if (state === "TRUSTED_SINGLE_ENGINE") {
    const backends = availableBackends(report).filter((backend) => backend.id === measure.source);
    const selected = backends;
    if (!selected.length) return { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null };
    return {
      kind: "single-engine",
      engineIds: stableUnique(selected.map((backend) => backend.id)).sort(compareStrings),
      versions: stableUnique(selected.map((backend) => backend.version)).sort(compareStrings),
      independenceGroups: stableUnique(selected.map((backend) => backend.independenceGroup)).sort(compareStrings),
      sourceSha256: null,
    };
  }
  return { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null };
}

function roleEventId(measure: OmrConsensusMeasure, event: OmrNormalizedEvent): string {
  return `role:${measure.id}:${event.id}`;
}

interface InternalRoleEvent extends TrustedRoleEvent {
  tieIn: boolean;
  tieOut: boolean;
}

function projectEvent(measure: OmrConsensusMeasure, event: OmrNormalizedEvent, role: TrustedRole): InternalRoleEvent {
  return {
    id: roleEventId(measure, event),
    role,
    measureId: measure.id,
    onset: rounded(measure.startBeat + event.onset),
    duration: rounded(event.duration),
    midi: event.pitch,
    pitchClass: ((event.pitch % 12) + 12) % 12,
    sourceEventId: event.id,
    sourceSegmentIds: [event.id],
    tieIn: event.tie.stop || event.tie.continue,
    tieOut: event.tie.start || event.tie.continue,
  };
}

/** Collapse a tie-split role lane into performed attacks without losing source ids. */
function collapseTiedEvents(events: readonly InternalRoleEvent[]): InternalRoleEvent[] {
  const result: InternalRoleEvent[] = [];
  for (const event of events) {
    const previous = result.at(-1);
    if (previous
      && previous.role === event.role
      && previous.midi === event.midi
      && Math.abs(previous.onset + previous.duration - event.onset) <= EPS
      && (previous.tieOut || event.tieIn)) {
      previous.duration = rounded(previous.duration + event.duration);
      previous.tieOut = event.tieOut;
      previous.sourceSegmentIds = [...(previous.sourceSegmentIds ?? []), ...(event.sourceSegmentIds ?? [])];
      continue;
    }
    result.push({ ...event, sourceSegmentIds: [...(event.sourceSegmentIds ?? [])] });
  }
  return result;
}

function alignmentRegions(options: RoleReferenceOptions): readonly RoleAlignmentRegion[] {
  const value = options.alignedRegions ?? options.alignmentRegions;
  return Array.isArray(value) ? value.filter((region): region is RoleAlignmentRegion => Boolean(region && typeof region === "object" && typeof region.id === "string" && Array.isArray(region.canonicalMeasureIds) && finite(region.startBeat) && finite(region.endBeat) && finite(region.confidence))) : [];
}

function numericIndex(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

interface MeasureContext {
  measure: OmrConsensusMeasure;
  alignmentId: string | null;
  alignmentStatus: RoleAlignmentRegion["status"] | null;
}

function contextsFor(report: OmrConsensusReport, options: RoleReferenceOptions): { contexts: MeasureContext[]; hierarchical: boolean } {
  const measures = [...(Array.isArray(report.measures) ? report.measures : [])].sort((left, right) => left.index - right.index || compareStrings(left.id, right.id));
  const regions = [...alignmentRegions(options)]
    .filter((region) => region && typeof region.id === "string")
    .sort((left, right) => left.startBeat - right.startBeat || compareStrings(left.id, right.id));
  if (!regions.length) return { contexts: measures.map((measure) => ({ measure, alignmentId: null, alignmentStatus: null })), hierarchical: false };
  const byId = new Map(measures.map((measure) => [measure.id, measure]));
  const used = new Set<string>();
  const result: MeasureContext[] = [];
  const minConfidence = finite(options.minAlignmentConfidence) ? Math.max(0, Math.min(1, options.minAlignmentConfidence!)) : 0.8;
  for (const region of regions) {
    const accepted = region.confidence >= minConfidence && (region.status === "aligned" || region.status === "split" || region.status === "merged");
    for (const canonicalId of region.canonicalMeasureIds) {
      const direct = byId.get(canonicalId);
      const fallback = direct ?? (() => {
        const index = numericIndex(canonicalId);
        return index === null ? undefined : measures[index];
      })();
      if (!fallback || used.has(fallback.id)) continue;
      used.add(fallback.id);
      result.push({ measure: fallback, alignmentId: region.id, alignmentStatus: accepted ? region.status : "ambiguous" });
    }
  }
  // An adapter may intentionally omit an alignment region. Keep those measures
  // visible as explicit no-evidence masks instead of dropping them silently.
  for (const measure of measures) if (!used.has(measure.id)) result.push({ measure, alignmentId: null, alignmentStatus: "unmatched" });
  result.sort((left, right) => left.measure.index - right.measure.index || compareStrings(left.measure.id, right.measure.id));
  return { contexts: result, hierarchical: true };
}

type UnknownReason = PartialScoreReference["unknownMasks"][number]["reason"];

function unknownReason(measure: OmrConsensusMeasure, role: TrustedRole, roleUnassigned: boolean, alignmentStatus: MeasureContext["alignmentStatus"]): UnknownReason | null {
  if (alignmentStatus === "ambiguous" || alignmentStatus === "unmatched") return "no-evidence";
  const state = measure.roles[role].state;
  if (state === "REVIEW_REQUIRED") return "review-required";
  if (state === "FAILED") return "failed";
  if (roleUnassigned) return "role-unassigned";
  if (!trustedState(state)) return "no-evidence";
  return null;
}

function reasonForMask(measure: OmrConsensusMeasure, role: TrustedRole, roleUnassigned: boolean, alignmentStatus: MeasureContext["alignmentStatus"]): UnknownReason {
  return unknownReason(measure, role, roleUnassigned, alignmentStatus) ?? "no-evidence";
}

function sameProvenance(left: RoleProvenance, right: RoleProvenance): boolean {
  return left.kind === right.kind
    && left.sourceSha256 === right.sourceSha256
    && left.engineIds.join("\u0000") === right.engineIds.join("\u0000")
    && left.versions.join("\u0000") === right.versions.join("\u0000")
    && left.independenceGroups.join("\u0000") === right.independenceGroups.join("\u0000");
}

function regionCanJoin(left: InternalRegion, right: InternalRegion): boolean {
  if (left.context.measure.index + 1 !== right.context.measure.index) return false;
  if (left.context.alignmentId !== right.context.alignmentId) return false;
  if (left.context.alignmentId === null && (left.context.measure.page !== right.context.measure.page || left.context.measure.system !== right.context.measure.system)) return false;
  for (const role of ROLES) {
    const leftCell = left.cells[role];
    const rightCell = right.cells[role];
    if (leftCell.state !== rightCell.state || !sameProvenance(leftCell.provenance, rightCell.provenance)) return false;
    if (left.maskReasons[role] !== right.maskReasons[role]) return false;
  }
  return true;
}

interface InternalRegion {
  context: MeasureContext;
  contexts: MeasureContext[];
  cells: Record<TrustedRole, PartialRoleCell>;
  events: Record<TrustedRole, InternalRoleEvent[]>;
  maskReasons: Record<TrustedRole, UnknownReason | null>;
}

function buildMeasureRegion(report: OmrConsensusReport, context: MeasureContext): InternalRegion {
  const measure = context.measure;
  const roleUnassigned = measure.events.some((event) => event.role === null);
  const events = {} as Record<TrustedRole, InternalRoleEvent[]>;
  const cells = {} as Record<TrustedRole, PartialRoleCell>;
  const maskReasons = {} as Record<TrustedRole, UnknownReason | null>;
  for (const role of ROLES) {
    const roleEvents = measure.events
      .filter((event) => event.role === role)
      .sort((left, right) => left.onset - right.onset || left.duration - right.duration || left.pitch - right.pitch || compareStrings(left.id, right.id))
      .map((event) => projectEvent(measure, event, role));
    const state = measure.roles[role].state;
    const isTrusted = trustedState(state) && roleEvents.length > 0 && context.alignmentStatus !== "ambiguous" && context.alignmentStatus !== "unmatched";
    const reason = unknownReason(measure, role, roleUnassigned, context.alignmentStatus);
    const provenance = isTrusted ? roleProvenance(report, measure, role) : { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null } satisfies RoleProvenance;
    const laneEvents = isTrusted ? roleEvents : [];
    events[role] = laneEvents;
    // A null-role event is not evidence for a trusted role. It must not turn a
    // complete trusted lane into a full-measure unknown interval; only an
    // otherwise untrusted cell receives the role-unassigned mask.
    maskReasons[role] = isTrusted ? null : reasonForMask(measure, role, roleUnassigned, context.alignmentStatus);
    cells[role] = {
      state: isTrusted ? state as PartialRoleState : "UNKNOWN",
      confidence: isTrusted ? measure.roles[role].confidence : null,
      eventIds: laneEvents.map((event) => event.id),
      eventCount: laneEvents.length,
      provenance,
    };
  }
  return { context, contexts: [context], cells, events, maskReasons };
}

function publicEvent(event: InternalRoleEvent): TrustedRoleEvent {
  const { tieIn: _tieIn, tieOut: _tieOut, ...value } = event;
  return value;
}

function mergeRegions(regions: InternalRegion[]): InternalRegion[] {
  const merged: InternalRegion[] = [];
  for (const region of regions) {
    const previous = merged.at(-1);
    if (!previous || !regionCanJoin(previous, region)) {
      merged.push(region);
      continue;
    }
    previous.contexts.push(...region.contexts);
    for (const role of ROLES) {
      previous.events[role].push(...region.events[role]);
      previous.cells[role].eventIds.push(...region.cells[role].eventIds);
      previous.cells[role].eventCount += region.cells[role].eventCount;
      if (previous.cells[role].confidence !== null && region.cells[role].confidence !== null) previous.cells[role].confidence = rounded((previous.cells[role].confidence + region.cells[role].confidence) / 2);
    }
  }
  return merged;
}

function regionId(region: InternalRegion): string {
  if (region.context.alignmentId) return region.context.alignmentId;
  const first = region.contexts[0]!.measure.index;
  const last = region.contexts.at(-1)!.measure.index;
  return `m${first}-${last}`;
}

function maskReasonForContext(region: InternalRegion, role: TrustedRole): UnknownReason | null {
  const reasons = region.contexts.map((context) => {
    const measure = context.measure;
    if (region.cells[role].state !== "UNKNOWN" && context.alignmentStatus !== "ambiguous" && context.alignmentStatus !== "unmatched") return null;
    const roleUnassigned = measure.events.some((event) => event.role === null);
    return unknownReason(measure, role, roleUnassigned, context.alignmentStatus);
  }).filter((reason): reason is UnknownReason => reason !== null);
  return reasons[0] ?? null;
}

function makeUnknownMasks(regions: readonly InternalRegion[]): PartialScoreReference["unknownMasks"] {
  const masks: PartialScoreReference["unknownMasks"] = [];
  for (const region of regions) {
    for (const role of ROLES) {
      const reason = maskReasonForContext(region, role);
      if (!reason) continue;
      const measures = region.contexts.map((context) => context.measure);
      masks.push({
        role,
        startBeat: rounded(Math.min(...measures.map((measure) => measure.startBeat))),
        endBeat: rounded(Math.max(...measures.map(measureEnd))),
        measureIds: measures.map((measure) => measure.id),
        reason,
      });
    }
  }
  return masks.sort((left, right) => left.startBeat - right.startBeat || roleCompare(left.role, right.role) || left.endBeat - right.endBeat || compareStrings(left.reason, right.reason));
}

function roleCoverage(regions: readonly InternalRegion[], masks: PartialScoreReference["unknownMasks"], role: TrustedRole): RoleCoverage {
  let trustedBeatSpan = 0;
  let eligibleBeatSpan = 0;
  let unknownBeatSpan = 0;
  let trustedEventCount = 0;
  let unknownEventCount = 0;
  for (const region of regions) {
    const duration = region.contexts.reduce((sum, context) => sum + Math.max(0, context.measure.durationBeats), 0);
    const cell = region.cells[role];
    const hasEvidence = region.contexts.some((context) => context.measure.events.some((event) => event.role === role) || context.measure.roles[role].state !== null);
    if (hasEvidence) eligibleBeatSpan += duration;
    if (cell.state !== "UNKNOWN") {
      trustedBeatSpan += duration;
      trustedEventCount += collapseTiedEvents(region.events[role]).length;
    }
    for (const context of region.contexts) {
      const roleEventCount = context.measure.events.filter((event) => event.role === role).length;
      const state = context.measure.roles[role].state;
      const alignmentRejected = context.alignmentStatus === "ambiguous" || context.alignmentStatus === "unmatched";
      if (roleEventCount && (!trustedState(state) || alignmentRejected)) unknownEventCount += roleEventCount;
    }
  }
  for (const mask of masks.filter((value) => value.role === role)) {
    unknownBeatSpan += Math.max(0, mask.endBeat - mask.startBeat);
  }
  return {
    trustedBeatSpan: rounded(trustedBeatSpan),
    eligibleBeatSpan: rounded(eligibleBeatSpan),
    unknownBeatSpan: rounded(unknownBeatSpan),
    trustedEventCount,
    unknownEventCount,
    coverage: eligibleBeatSpan > 0 ? rounded(trustedBeatSpan / eligibleBeatSpan) : null,
  };
}

/** Build deterministic role lanes and explicit unknown masks from existing trust decisions. */
export function buildTrustedPartialReference(report: OmrConsensusReport, options: RoleReferenceOptions = {}): PartialScoreReference {
  const safe = safeReport(report);
  const { contexts, hierarchical } = contextsFor(safe, options);
  const perMeasure = contexts.map((context) => buildMeasureRegion(safe, context));
  const regions = mergeRegions(perMeasure);
  const unknownMasks = makeUnknownMasks(regions);
  const lanes = {} as Record<TrustedRole, TrustedRoleEvent[]>;
  for (const role of ROLES) {
    const rawEvents = regions.flatMap((region) => region.events[role]).sort((left, right) => left.onset - right.onset || left.midi - right.midi || compareStrings(left.sourceEventId, right.sourceEventId));
    lanes[role] = collapseTiedEvents(rawEvents).map(publicEvent);
  }
  const publicRegions: TrustedRoleRegion[] = regions.map((region) => {
    const measures = region.contexts.map((context) => context.measure);
    const regionRoles = {} as Record<TrustedRole, PartialRoleCell>;
    for (const role of ROLES) {
      const cell = region.cells[role];
      const semanticEvents = collapseTiedEvents(region.events[role]);
      regionRoles[role] = {
        ...cell,
        eventIds: semanticEvents.map((event) => event.id),
        eventCount: semanticEvents.length,
        confidence: measures.every((measure) => measure.roles[role].confidence !== null)
          ? rounded(measures.reduce((sum, measure) => sum + (measure.roles[role].confidence ?? 0), 0) / measures.length)
          : null,
      };
    }
    const unknownRoles = ROLES.filter((role) => maskReasonForContext(region, role) !== null);
    return {
      id: regionId(region),
      measureIds: measures.map((measure) => measure.id),
      startBeat: rounded(Math.min(...measures.map((measure) => measure.startBeat))),
      endBeat: rounded(Math.max(...measures.map(measureEnd))),
      roles: regionRoles,
      unknownRoles,
      pageSystems: stablePageSystems(measures),
      ...(region.context.alignmentId ? { alignmentRegionId: region.context.alignmentId } : {}),
    };
  });
  const source = sourceMetadata(safe, options);
  const score = reportScore(safe, options);
  return {
    schemaVersion: OMR_PARTIAL_REFERENCE_SCHEMA_VERSION,
    score,
    source,
    alignment: hierarchical ? "hierarchical" : "flat-fallback",
    measureOrder: contexts.map((context) => context.measure.id),
    regions: publicRegions,
    lanes,
    unknownMasks,
    coverage: {
      melody: roleCoverage(regions, unknownMasks, "melody"),
      harmony: roleCoverage(regions, unknownMasks, "harmony"),
      rhythm: roleCoverage(regions, unknownMasks, "rhythm"),
    },
    nonClaims: [
      "Trusted lanes are evidence projections, not proof of notation correctness or piano playability.",
      "Unknown masks are unavailable evidence and must not be interpreted as rests.",
      ...(hierarchical ? [] : ["Measure regions use a flat-fallback alignment because no hierarchical adapter was supplied."]),
      "Trusted single-engine evidence is not independent consensus.",
    ],
  };
}

function disagreementRoles(kind: OmrDisagreementKind): TrustedRole[] {
  if (kind === "melody-pitch") return ["melody"];
  if (kind === "harmony-pitch") return ["harmony"];
  if (kind === "rhythm-pitch") return ["rhythm"];
  return [];
}

function reviewRootCauses(report: OmrConsensusReport, item: OmrConsensusReport["reviewItems"][number]): OmrDisagreementKind[] {
  const measure = report.measures.find((candidate) => candidate.id === item.measureId);
  const causes = measure?.agreement?.disagreements.map((disagreement) => disagreement.kind) ?? [];
  if (!causes.length) return ["unmatched-measure"];
  return stableUnique(causes).sort((left, right) => DISAGREEMENT_ORDER.indexOf(left) - DISAGREEMENT_ORDER.indexOf(right));
}

function reviewRoles(report: OmrConsensusReport, item: OmrConsensusReport["reviewItems"][number], causes: readonly OmrDisagreementKind[]): TrustedRole[] {
  const measure = report.measures.find((candidate) => candidate.id === item.measureId);
  const fromState = measure ? ROLES.filter((role) => measure.roles[role].state === "REVIEW_REQUIRED" || measure.roles[role].state === "FAILED") : [];
  const fromCause = causes.flatMap(disagreementRoles);
  return stableUnique([...fromState, ...fromCause, ...item.roles]).sort(roleCompare);
}

interface ReviewMember {
  item: OmrConsensusReport["reviewItems"][number];
  measure: OmrConsensusMeasure | undefined;
  causes: OmrDisagreementKind[];
  roles: TrustedRole[];
  alignmentId: string | null;
}

function reviewMember(report: OmrConsensusReport, item: OmrConsensusReport["reviewItems"][number], alignmentId: string | null = null): ReviewMember {
  const causes = reviewRootCauses(report, item);
  return { item, measure: report.measures.find((candidate) => candidate.id === item.measureId), causes, roles: reviewRoles(report, item, causes), alignmentId };
}

function membersCanJoin(left: ReviewMember, right: ReviewMember): boolean {
  if (left.item.measureIndex + 1 !== right.item.measureIndex) return false;
  if (left.causes.join("\u0000") !== right.causes.join("\u0000")) return false;
  if (!left.roles.some((role) => right.roles.includes(role))) return false;
  const leftMeasure = left.measure;
  const rightMeasure = right.measure;
  if (!leftMeasure || !rightMeasure) return false;
  if (left.alignmentId !== right.alignmentId) return false;
  if (left.alignmentId?.startsWith("rejected:") || right.alignmentId?.startsWith("rejected:")) return false;
  if (left.alignmentId === null && (leftMeasure.page !== rightMeasure.page || leftMeasure.system !== rightMeasure.system)) return false;
  return true;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort(compareNumbers);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : rounded((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function reviewGroup(members: readonly ReviewMember[]): OmrReviewGroup {
  const first = members[0]!;
  const last = members.at(-1)!;
  const measures = members.map((member) => member.measure).filter((measure): measure is OmrConsensusMeasure => measure !== undefined);
  const confidences = measures.map((measure) => finite(measure.confidence) ? measure.confidence : 0);
  const priority = Math.max(...members.map((member) => member.item.priority), 0) + Math.min(2, Math.floor(Math.max(0, members.length - 1) / 2));
  const causes = first.causes;
  const roles = stableUnique(members.flatMap((member) => member.roles)).sort(roleCompare);
  const pageSystems = stablePageSystems(measures);
  return {
    id: `review:${first.item.measureIndex}-${last.item.measureIndex}`,
    measureIds: members.map((member) => member.item.measureId),
    firstMeasureIndex: first.item.measureIndex,
    lastMeasureIndex: last.item.measureIndex,
    startBeat: measures.length ? rounded(Math.min(...measures.map((measure) => measure.startBeat))) : null,
    endBeat: measures.length ? rounded(Math.max(...measures.map(measureEnd))) : null,
    pageSystems,
    rootCauses: [...causes],
    roles,
    priority,
    priorityClass: priority >= 6 ? "high" : priority >= 3 ? "medium" : "low",
    memberCount: members.length,
    estimatedEventCount: measures.reduce((sum, measure) => sum + measure.events.length, 0),
    confidence: { min: rounded(Math.min(...confidences, 0)), median: median(confidences), max: rounded(Math.max(...confidences, 0)) },
    memberItems: members.map((member) => member.item.measureId),
  };
}

/** Group raw review items by structured root cause while retaining every raw item unchanged. */
export function groupOmrReviewRegions(report: OmrConsensusReport, options: Pick<RoleReferenceOptions, "alignedRegions" | "alignmentRegions" | "minAlignmentConfidence"> = {}): OmrReviewGroup[] {
  const safe = safeReport(report);
  const suppliedRegions = [...alignmentRegions(options)]
    .filter((region) => region && typeof region.id === "string")
    .sort((left, right) => left.startBeat - right.startBeat || compareStrings(left.id, right.id));
  const minConfidence = finite(options.minAlignmentConfidence) ? Math.max(0, Math.min(1, options.minAlignmentConfidence!)) : 0.8;
  const alignmentByMeasure = new Map<string, string>();
  for (const region of suppliedRegions) {
    const accepted = region.confidence >= minConfidence && (region.status === "aligned" || region.status === "split" || region.status === "merged");
    // Keep rejected regions as distinct hard boundaries. Otherwise two
    // rejected adjacent items on the same page/system could be grouped as if
    // the adapter had proven continuity.
    for (const id of region.canonicalMeasureIds) alignmentByMeasure.set(id, accepted ? region.id : `rejected:${region.id}`);
  }
  const members = [...safe.reviewItems]
    .sort((left, right) => left.measureIndex - right.measureIndex || compareStrings(left.measureId, right.measureId))
    .map((item) => reviewMember(safe, item, alignmentByMeasure.get(item.measureId) ?? null));
  const groups: ReviewMember[][] = [];
  for (const member of members) {
    const previous = groups.at(-1);
    if (!previous || !membersCanJoin(previous.at(-1)!, member)) groups.push([member]);
    else previous.push(member);
  }
  return groups.map(reviewGroup).sort((left, right) => left.firstMeasureIndex - right.firstMeasureIndex || compareStrings(left.id, right.id));
}

export function summarizeOmrReviewGroups(report: OmrConsensusReport, groups = groupOmrReviewRegions(report)): OmrReviewGroupSummary {
  const safe = safeReport(report);
  return {
    rawItemCount: safe.reviewItems.length,
    groupedRegionCount: groups.length,
    criticalGroupCount: groups.filter((group) => group.priorityClass === "high").length,
  };
}
