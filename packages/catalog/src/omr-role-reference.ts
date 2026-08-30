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
  return [...report.backends]
    .filter((backend) => backend.status === "available" && backend.measureCount > 0)
    .sort((left, right) => compareStrings(left.id, right.id) || compareStrings(left.version, right.version));
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
    const backends = availableBackends(report);
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
    const selected = backends.length ? backends : availableBackends(report);
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
  return options.alignedRegions ?? options.alignmentRegions ?? [];
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
  const measures = [...report.measures].sort((left, right) => left.index - right.index || compareStrings(left.id, right.id));
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
    const roleEvents = measure.events.filter((event) => event.role === role).map((event) => projectEvent(measure, event, role));
    const state = measure.roles[role].state;
    const isTrusted = trustedState(state) && roleEvents.length > 0 && context.alignmentStatus !== "ambiguous" && context.alignmentStatus !== "unmatched";
    const reason = unknownReason(measure, role, roleUnassigned, context.alignmentStatus);
    const provenance = isTrusted ? roleProvenance(report, measure, role) : { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null } satisfies RoleProvenance;
    const laneEvents = isTrusted ? roleEvents : [];
    events[role] = laneEvents;
    maskReasons[role] = isTrusted && reason === "role-unassigned" ? reason : isTrusted ? null : reasonForMask(measure, role, roleUnassigned, context.alignmentStatus);
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
  }
  for (const mask of masks.filter((value) => value.role === role)) {
    unknownBeatSpan += Math.max(0, mask.endBeat - mask.startBeat);
    unknownEventCount += mask.measureIds.length;
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
  const { contexts, hierarchical } = contextsFor(report, options);
  const perMeasure = contexts.map((context) => buildMeasureRegion(report, context));
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
  const source = sourceMetadata(report, options);
  const score = reportScore(report, options);
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
  const suppliedRegions = [...alignmentRegions(options)]
    .filter((region) => region && typeof region.id === "string")
    .sort((left, right) => left.startBeat - right.startBeat || compareStrings(left.id, right.id));
  const minConfidence = finite(options.minAlignmentConfidence) ? Math.max(0, Math.min(1, options.minAlignmentConfidence!)) : 0.8;
  const alignmentByMeasure = new Map<string, string>();
  for (const region of suppliedRegions) {
    const accepted = region.confidence >= minConfidence && (region.status === "aligned" || region.status === "split" || region.status === "merged");
    if (!accepted) continue;
    for (const id of region.canonicalMeasureIds) alignmentByMeasure.set(id, region.id);
  }
  const members = [...report.reviewItems]
    .sort((left, right) => left.measureIndex - right.measureIndex || compareStrings(left.measureId, right.measureId))
    .map((item) => reviewMember(report, item, alignmentByMeasure.get(item.measureId) ?? null));
  const groups: ReviewMember[][] = [];
  for (const member of members) {
    const previous = groups.at(-1);
    if (!previous || !membersCanJoin(previous.at(-1)!, member)) groups.push([member]);
    else previous.push(member);
  }
  return groups.map(reviewGroup).sort((left, right) => left.firstMeasureIndex - right.firstMeasureIndex || compareStrings(left.id, right.id));
}

export function summarizeOmrReviewGroups(report: OmrConsensusReport, groups = groupOmrReviewRegions(report)): OmrReviewGroupSummary {
  return {
    rawItemCount: report.reviewItems.length,
    groupedRegionCount: groups.length,
    criticalGroupCount: groups.filter((group) => group.priorityClass === "high").length,
  };
}
