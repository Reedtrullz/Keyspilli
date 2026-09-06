import type { EvidenceClass, EvidenceRole } from "./external-evidence.js";
import type {
  GenerationCandidateClass,
  GenerationCandidateProvenanceClass,
} from "./generation-candidate-intake.js";

/** Versioned, beat/second-domain contract for region-scoped symbolic evidence. */
export const REGION_OWNERSHIP_SCHEMA_VERSION = 1 as const;

export type RegionCoordinateDomain = "SOURCE_REGION" | "TARGET_REGION";

export const REGION_TIMING_AUTHORITIES = [
  "NATIVE_AUTHORITATIVE",
  "ALIGNED_HIGH_CONFIDENCE",
  "ALIGNED_PARTIAL",
  "ALIGNMENT_REJECTED",
  "UNALIGNED",
] as const;
export type RegionTimingAuthority = (typeof REGION_TIMING_AUTHORITIES)[number]
  | "NATIVE"
  | "aligned"
  | "partial"
  | "rejected"
  | "unaligned";

export const REGION_ALIGNMENT_STATES = [
  "NATIVE",
  "NATIVE_AUTHORITATIVE",
  "ALIGNED_HIGH_CONFIDENCE",
  "ALIGNED_PARTIAL",
  "ALIGNMENT_REJECTED",
  "UNALIGNED",
] as const;
export type RegionAlignmentState = (typeof REGION_ALIGNMENT_STATES)[number]
  | "aligned"
  | "partial"
  | "rejected"
  | "unaligned";

export const REGION_OWNERSHIP_STATES = ["OWNED", "FALLBACK_OWNED", "PARTIAL_SUPPORT", "WITHHELD"] as const;
export type RegionOwnershipState = (typeof REGION_OWNERSHIP_STATES)[number];

export type RegionEvidenceRole = EvidenceRole;
export type RegionEvidenceSourceClass = GenerationCandidateClass;
export const REGION_EVIDENCE_SOURCE_CLASSES = [
  "GENERATION_CANDIDATE",
  "FALLBACK_AMT",
  "BENCHMARK_REFERENCE",
  "DIAGNOSTIC_ONLY",
] as const satisfies readonly RegionEvidenceSourceClass[];

export interface BeatRegion {
  startBeat: number;
  endBeat: number;
}

export interface AudioRegion {
  startSecond: number;
  endSecond: number;
}

export type RegionSpan = BeatRegion | readonly [number, number];

export interface RegionEvidenceClaim {
  /** Stable event/claim identifier, not a physical path. */
  id: string;
  /** Candidate/record identifier used by the frozen generation set. */
  candidateId: string;
  /** Canonical generation firewall class. */
  sourceClass: RegionEvidenceSourceClass;
  /** Compatibility alias accepted at runtime for callers using candidateClass. */
  candidateClass?: RegionEvidenceSourceClass;
  evidenceClass?: EvidenceClass;
  provenanceClass?: GenerationCandidateProvenanceClass;
  role: RegionEvidenceRole;
  timingAuthority: RegionTimingAuthority;
  alignmentState: RegionAlignmentState;
  confidence?: number;
  sourceRegion?: RegionSpan;
  targetRegion?: AudioRegion | readonly [number, number];
  /** Tuple aliases are useful at ingestion boundaries and normalize to regions. */
  sourceBounds?: readonly [number, number];
  targetBounds?: readonly [number, number];
  /** Generic source-domain aliases for adapters that do not name the domain. */
  regionStart?: number;
  regionEnd?: number;
  coordinateDomain?: RegionCoordinateDomain;
  roleEligible?: boolean;
  fallbackEligible?: boolean;
  /** Allows semantic (non-timed) harmony/bass support under partial alignment. */
  semanticOnly?: boolean;
  allowSemanticSupport?: boolean;
  /** Drum evidence may own timing-only regions, never pitched roles. */
  isDrum?: boolean;
  sourceEventIds?: readonly string[];
}

export interface RegionEvidenceDecision extends Omit<RegionEvidenceClaim, "sourceRegion" | "targetRegion"> {
  sourceRegion?: BeatRegion;
  targetRegion?: AudioRegion;
  ownershipState: RegionOwnershipState;
  reasonCodes: readonly string[];
}

export type RegionReadiness = "GENERATION_READY" | "GENERATION_PARTIAL" | "GENERATION_BLOCKED";

export interface RegionOwnershipDiagnostics {
  claimCount: number;
  validClaimCount: number;
  ownedClaimCount: number;
  fallbackOwnedClaimCount: number;
  partialClaimCount: number;
  withheldClaimCount: number;
  overlapWithheldCount: number;
  roles: Record<RegionEvidenceRole, { owned: number; fallbackOwned: number; partial: number; withheld: number }>;
}

export interface RegionOwnershipResolution {
  schemaVersion: typeof REGION_OWNERSHIP_SCHEMA_VERSION;
  decisions: readonly RegionEvidenceDecision[];
  /** Accepted semantic regions after deterministic adjacent-region merging. */
  merged: readonly RegionEvidenceDecision[];
  readiness: RegionReadiness;
  diagnostics: RegionOwnershipDiagnostics;
}

export interface RegionOwnershipResolutionOptions {
  /** Optional tolerance for adjacent source/target regions; defaults to 1e-9. */
  adjacencyTolerance?: number;
}

const ROLES: readonly RegionEvidenceRole[] = ["melody", "harmony", "bass-root", "rhythm", "timing-only"];
const ROLE_SET = new Set<string>(ROLES);
const SOURCE_CLASS_SET = new Set<string>([
  "GENERATION_CANDIDATE",
  "BENCHMARK_REFERENCE",
  "DIAGNOSTIC_ONLY",
  "FALLBACK_AMT",
]);
const PROVENANCE_SET = new Set<string>([
  "PROJECT_OWNED",
  "OPEN_LICENSE",
  "USER_SUPPLIED_PRIVATE",
  "REMOTE_APPROVED",
  "UNKNOWN",
]);
const TIMING_SET = new Set<string>(REGION_TIMING_AUTHORITIES);
const ALIGNMENT_SET = new Set<string>(REGION_ALIGNMENT_STATES);
const EPSILON = 1e-9;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function lexical(a: unknown, b: unknown): number {
  const left = typeof a === "string" ? a : "";
  const right = typeof b === "string" ? b : "";
  return left < right ? -1 : left > right ? 1 : 0;
}

function numberOrInfinity(value: unknown): number {
  return finite(value) ? value : Number.POSITIVE_INFINITY;
}

function normalizedTiming(value: unknown): RegionTimingAuthority | null {
  if (value === "NATIVE") return "NATIVE_AUTHORITATIVE";
  if (value === "native") return "NATIVE_AUTHORITATIVE";
  if (value === "aligned") return "ALIGNED_HIGH_CONFIDENCE";
  if (value === "partial") return "ALIGNED_PARTIAL";
  if (value === "rejected") return "ALIGNMENT_REJECTED";
  if (value === "unaligned" || value === "not-attempted" || value === "unavailable") return "UNALIGNED";
  return TIMING_SET.has(String(value)) ? value as RegionTimingAuthority : null;
}

function normalizedAlignment(value: unknown, timing: RegionTimingAuthority | null): RegionAlignmentState | null {
  if (value === "NATIVE_AUTHORITATIVE") return "NATIVE_AUTHORITATIVE";
  if (ALIGNMENT_SET.has(String(value))) return value as RegionAlignmentState;
  if (value === "aligned") return timing === "ALIGNED_PARTIAL" ? "ALIGNED_PARTIAL" : "ALIGNED_HIGH_CONFIDENCE";
  if (value === "partial") return "ALIGNED_PARTIAL";
  if (value === "rejected") return "ALIGNMENT_REJECTED";
  if (value === "unaligned" || value === "not-attempted" || value === "unavailable") return "UNALIGNED";
  return null;
}

function regionValid(value: unknown, startKey: "startBeat" | "startSecond", endKey: "endBeat" | "endSecond"): boolean {
  if (!record(value) || !finite(value[startKey]) || !finite(value[endKey])) return false;
  return value[startKey] >= 0 && value[endKey] > value[startKey];
}

function normalizeSpan(value: unknown, startKey: "startBeat" | "startSecond", endKey: "endBeat" | "endSecond"): { start: number; end: number } | undefined {
  if (Array.isArray(value) && value.length === 2) {
    return { start: Number(value[0]), end: Number(value[1]) };
  }
  if (record(value)) return { start: Number(value[startKey]), end: Number(value[endKey]) };
  return undefined;
}

function normalizeSourceClass(value: unknown, alias: unknown): RegionEvidenceSourceClass | null {
  const selected = typeof value === "string" ? value : alias;
  return typeof selected === "string" && SOURCE_CLASS_SET.has(selected) ? selected as RegionEvidenceSourceClass : null;
}

function normalizeClaim(value: unknown, index: number): { claim: RegionEvidenceClaim; invalid: boolean } {
  const raw = record(value) ? value : {};
  const sourceClass = normalizeSourceClass(raw.sourceClass, raw.candidateClass);
  const provenance = raw.provenanceClass === undefined
    ? "UNKNOWN"
    : PROVENANCE_SET.has(String(raw.provenanceClass)) ? raw.provenanceClass as GenerationCandidateProvenanceClass : "UNKNOWN";
  const timing = normalizedTiming(raw.timingAuthority);
  const alignment = normalizedAlignment(raw.alignmentState, timing);
  const role = ROLE_SET.has(String(raw.role)) ? raw.role as RegionEvidenceRole : "melody";
  const sourceSpan = normalizeSpan(raw.sourceRegion ?? raw.sourceBounds ?? (raw.coordinateDomain === "SOURCE_REGION" && raw.regionStart !== undefined ? [raw.regionStart, raw.regionEnd] : undefined), "startBeat", "endBeat");
  const targetSpan = normalizeSpan(raw.targetRegion ?? raw.targetBounds ?? (raw.coordinateDomain === "TARGET_REGION" && raw.regionStart !== undefined ? [raw.regionStart, raw.regionEnd] : undefined), "startSecond", "endSecond");
  const claim: RegionEvidenceClaim = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `[claim-${index + 1}]`,
    candidateId: typeof raw.candidateId === "string" ? raw.candidateId.trim() : "",
    sourceClass: sourceClass ?? "DIAGNOSTIC_ONLY",
    ...(sourceClass ? {} : { candidateClass: "DIAGNOSTIC_ONLY" }),
    ...(typeof raw.evidenceClass === "string" ? { evidenceClass: raw.evidenceClass as EvidenceClass } : {}),
    provenanceClass: provenance,
    role,
    timingAuthority: timing ?? "UNALIGNED",
    alignmentState: alignment ?? "UNALIGNED",
    ...(finite(raw.confidence) ? { confidence: raw.confidence } : {}),
    ...(sourceSpan ? { sourceRegion: { startBeat: sourceSpan.start, endBeat: sourceSpan.end } } : {}),
    ...(targetSpan ? { targetRegion: { startSecond: targetSpan.start, endSecond: targetSpan.end } } : {}),
    ...(typeof raw.roleEligible === "boolean" ? { roleEligible: raw.roleEligible } : {}),
    ...(typeof raw.fallbackEligible === "boolean" ? { fallbackEligible: raw.fallbackEligible } : {}),
    ...(typeof raw.semanticOnly === "boolean" ? { semanticOnly: raw.semanticOnly } : {}),
    ...(typeof raw.allowSemanticSupport === "boolean" ? { allowSemanticSupport: raw.allowSemanticSupport } : {}),
    ...(typeof raw.isDrum === "boolean" ? { isDrum: raw.isDrum } : {}),
    ...(Array.isArray(raw.sourceEventIds) ? { sourceEventIds: raw.sourceEventIds.filter((id): id is string => typeof id === "string").sort(lexical) } : {}),
  };
  const invalid = !record(value)
    || !sourceClass
    || !timing
    || !alignment
    || !claim.candidateId
    || !regionValid(claim.sourceRegion, "startBeat", "endBeat") && !regionValid(claim.targetRegion, "startSecond", "endSecond")
    || (claim.sourceRegion !== undefined && !regionValid(claim.sourceRegion, "startBeat", "endBeat"))
    || (claim.targetRegion !== undefined && !regionValid(claim.targetRegion, "startSecond", "endSecond"))
    || (raw.confidence !== undefined && !finite(raw.confidence));
  return { claim, invalid };
}

function baseDecision(claim: RegionEvidenceClaim, invalid: boolean): RegionEvidenceDecision {
  const reasons: string[] = [];
  let ownershipState: RegionOwnershipState = "WITHHELD";
  if (invalid) reasons.push("INVALID_REGION");
  if (claim.sourceClass === "BENCHMARK_REFERENCE") reasons.push("BENCHMARK_FIREWALL");
  if (claim.sourceClass === "DIAGNOSTIC_ONLY") reasons.push("DIAGNOSTIC_FIREWALL");
  if (claim.roleEligible === false) reasons.push("ROLE_NOT_ELIGIBLE");
  if (claim.provenanceClass === "UNKNOWN") reasons.push("PROVENANCE_BLOCKED");
  if (claim.isDrum && claim.role !== "timing-only") reasons.push("DRUM_TIMING_ONLY");
  if (claim.fallbackEligible === false && claim.sourceClass === "FALLBACK_AMT") reasons.push("FALLBACK_DISABLED");
  const timing = normalizedTiming(claim.timingAuthority);
  const alignment = normalizedAlignment(claim.alignmentState, timing);
  const blocked = reasons.length > 0;
  if (!blocked && timing && alignment) {
    const alignmentRejected = alignment === "ALIGNMENT_REJECTED" || alignment === "UNALIGNED";
    const alignmentPartial = alignment === "ALIGNED_PARTIAL";
    if (!alignmentRejected && !alignmentPartial && (timing === "NATIVE_AUTHORITATIVE" || timing === "ALIGNED_HIGH_CONFIDENCE")) {
      ownershipState = claim.sourceClass === "FALLBACK_AMT" ? "FALLBACK_OWNED" : "OWNED";
      reasons.push(claim.sourceClass === "FALLBACK_AMT" ? "FALLBACK_TIMING_AUTHORITY" : timing === "NATIVE_AUTHORITATIVE" ? "NATIVE_TIMING_AUTHORITY" : "HIGH_CONFIDENCE_ALIGNMENT");
    } else if (alignmentPartial || timing === "ALIGNED_PARTIAL") {
      if (claim.role !== "melody" && claim.role !== "timing-only" && (claim.semanticOnly === true || claim.allowSemanticSupport === true)) {
        ownershipState = "PARTIAL_SUPPORT";
        reasons.push("PARTIAL_ALIGNMENT_SEMANTIC_SUPPORT");
      } else reasons.push("PARTIAL_ALIGNMENT");
    } else if (alignmentRejected || timing === "ALIGNMENT_REJECTED") {
      if (claim.role !== "melody" && claim.role !== "timing-only" && (claim.semanticOnly === true || claim.allowSemanticSupport === true)) {
        ownershipState = "PARTIAL_SUPPORT";
        reasons.push("REJECTED_ALIGNMENT_SEMANTIC_SUPPORT");
      } else reasons.push("ALIGNMENT_REJECTED");
    } else {
      if (claim.role !== "melody" && claim.role !== "timing-only" && (claim.semanticOnly === true || claim.allowSemanticSupport === true)) {
        ownershipState = "PARTIAL_SUPPORT";
        reasons.push("NO_TARGET_TIMING_SEMANTIC_SUPPORT");
      } else reasons.push("NO_TARGET_TIMING");
    }
  }
  if (ownershipState === "WITHHELD" && !reasons.length) reasons.push("REGION_WITHHELD");
  const { sourceRegion, targetRegion, ...rest } = claim;
  return {
    ...rest,
    ...(sourceRegion && !Array.isArray(sourceRegion) ? { sourceRegion } : {}),
    ...(targetRegion && !Array.isArray(targetRegion) ? { targetRegion } : {}),
    ownershipState,
    reasonCodes: [...new Set(reasons)].sort(lexical),
  } as RegionEvidenceDecision;
}

function sourceOverlap(a: RegionEvidenceDecision, b: RegionEvidenceDecision): boolean {
  if (!a.sourceRegion || !b.sourceRegion) return false;
  return a.sourceRegion.startBeat < b.sourceRegion.endBeat - EPSILON && b.sourceRegion.startBeat < a.sourceRegion.endBeat - EPSILON;
}

function targetOverlap(a: RegionEvidenceDecision, b: RegionEvidenceDecision): boolean {
  if (!a.targetRegion || !b.targetRegion) return false;
  return a.targetRegion.startSecond < b.targetRegion.endSecond - EPSILON && b.targetRegion.startSecond < a.targetRegion.endSecond - EPSILON;
}

function overlaps(a: RegionEvidenceDecision, b: RegionEvidenceDecision): boolean {
  if (a.role !== b.role) return false;
  return sourceOverlap(a, b) || targetOverlap(a, b);
}

function decisionPriority(decision: RegionEvidenceDecision): readonly unknown[] {
  const sourcePriority = decision.sourceClass === "GENERATION_CANDIDATE" ? 3 : decision.sourceClass === "FALLBACK_AMT" ? 2 : 0;
  const timing = normalizedTiming(decision.timingAuthority);
  const timingPriority = timing === "NATIVE_AUTHORITATIVE" ? 5 : timing === "ALIGNED_HIGH_CONFIDENCE" ? 4 : timing === "ALIGNED_PARTIAL" ? 3 : timing === "ALIGNMENT_REJECTED" ? 1 : 0;
  return [sourcePriority, timingPriority, finite(decision.confidence) ? decision.confidence : -1, decision.provenanceClass === "PROJECT_OWNED" ? 2 : decision.provenanceClass ? 1 : 0, decision.candidateId, decision.id];
}

function comparePriority(a: RegionEvidenceDecision, b: RegionEvidenceDecision): number {
  const left = decisionPriority(a);
  const right = decisionPriority(b);
  for (let i = 0; i < left.length; i += 1) {
    const av = left[i];
    const bv = right[i];
    if (typeof av === "number" && typeof bv === "number" && av !== bv) return bv - av;
    if (typeof av === "string" && typeof bv === "string" && av !== bv) return lexical(av, bv);
  }
  return 0;
}

function decisionSort(a: RegionEvidenceDecision, b: RegionEvidenceDecision): number {
  const role = lexical(a.role, b.role);
  if (role) return role;
  const source = numberOrInfinity(a.sourceRegion?.startBeat) - numberOrInfinity(b.sourceRegion?.startBeat);
  if (source) return source;
  const target = numberOrInfinity(a.targetRegion?.startSecond) - numberOrInfinity(b.targetRegion?.startSecond);
  if (target) return target;
  return lexical(a.candidateId, b.candidateId) || lexical(a.id, b.id);
}

function mergeDecision(left: RegionEvidenceDecision, right: RegionEvidenceDecision): RegionEvidenceDecision | null {
  if (left.ownershipState !== right.ownershipState
    || left.role !== right.role
    || left.candidateId !== right.candidateId
    || left.sourceClass !== right.sourceClass
    || left.provenanceClass !== right.provenanceClass
    || left.timingAuthority !== right.timingAuthority
    || left.alignmentState !== right.alignmentState
    || left.isDrum !== right.isDrum
    || left.semanticOnly !== right.semanticOnly
    || left.allowSemanticSupport !== right.allowSemanticSupport
    || (left.confidence === undefined) !== (right.confidence === undefined)
    || (left.confidence !== undefined && right.confidence !== undefined && left.confidence !== right.confidence)) return null;
  if (left.sourceRegion && right.sourceRegion && Math.abs(left.sourceRegion.endBeat - right.sourceRegion.startBeat) > EPSILON) return null;
  if (left.targetRegion && right.targetRegion && Math.abs(left.targetRegion.endSecond - right.targetRegion.startSecond) > EPSILON) return null;
  const sourceEventIds = [...new Set([...(left.sourceEventIds ?? []), ...(right.sourceEventIds ?? [])])].sort(lexical);
  return {
    ...left,
    id: lexical(left.id, right.id) <= 0 ? left.id : right.id,
    sourceRegion: left.sourceRegion && right.sourceRegion ? { startBeat: Math.min(left.sourceRegion.startBeat, right.sourceRegion.startBeat), endBeat: Math.max(left.sourceRegion.endBeat, right.sourceRegion.endBeat) } : left.sourceRegion ?? right.sourceRegion,
    targetRegion: left.targetRegion && right.targetRegion ? { startSecond: Math.min(left.targetRegion.startSecond, right.targetRegion.startSecond), endSecond: Math.max(left.targetRegion.endSecond, right.targetRegion.endSecond) } : left.targetRegion ?? right.targetRegion,
    sourceEventIds,
    reasonCodes: [...new Set([...left.reasonCodes, ...right.reasonCodes])].sort(lexical),
  };
}

/** Merge only adjacent decisions from the same owner/source/role. */
export function mergeRegionEvidenceDecisions(
  decisions: readonly RegionEvidenceDecision[],
  options: RegionOwnershipResolutionOptions = {},
): RegionEvidenceDecision[] {
  const tolerance = finite(options.adjacencyTolerance) && options.adjacencyTolerance! >= 0 ? options.adjacencyTolerance! : EPSILON;
  const accepted = decisions.filter((decision) => decision.ownershipState !== "WITHHELD").map((decision) => ({ ...decision }));
  accepted.sort(decisionSort);
  const merged: RegionEvidenceDecision[] = [];
  for (const decision of accepted) {
    const prior = merged.at(-1);
    if (prior) {
      const sourceAdjacent = prior.sourceRegion && decision.sourceRegion
        ? Math.abs(decision.sourceRegion.startBeat - prior.sourceRegion.endBeat) <= tolerance
        : false;
      const targetAdjacent = prior.targetRegion && decision.targetRegion
        ? Math.abs(decision.targetRegion.startSecond - prior.targetRegion.endSecond) <= tolerance
        : false;
      if (sourceAdjacent || targetAdjacent) {
        const combined = mergeDecision(prior, decision);
        if (combined) {
          merged[merged.length - 1] = combined;
          continue;
        }
      }
    }
    merged.push(decision);
  }
  return merged;
}

function emptyRoleDiagnostics(): RegionOwnershipDiagnostics["roles"] {
  return Object.fromEntries(ROLES.map((role) => [role, { owned: 0, fallbackOwned: 0, partial: 0, withheld: 0 }])) as RegionOwnershipDiagnostics["roles"];
}

/** Resolve ownership before symbolic evidence reaches arrangement. */
export function resolveRegionEvidence(
  claims: readonly RegionEvidenceClaim[] | unknown,
  options: RegionOwnershipResolutionOptions = {},
): RegionOwnershipResolution {
  const rows = Array.isArray(claims) ? claims : [];
  const decisions: RegionEvidenceDecision[] = rows.map((value, index) => {
    const normalized = normalizeClaim(value, index);
    return baseDecision(normalized.claim, normalized.invalid);
  });
  decisions.sort(decisionSort);
  const direct = decisions.filter((decision) => decision.ownershipState === "OWNED" || decision.ownershipState === "FALLBACK_OWNED");
  for (const decision of direct) {
    const competitors = direct.filter((other) => other !== decision && overlaps(decision, other));
    const winner = competitors.reduce<RegionEvidenceDecision>((best, other) => comparePriority(other, best) < 0 ? other : best, decision);
    if (winner !== decision) {
      decision.ownershipState = "WITHHELD";
      decision.reasonCodes = [...new Set([...decision.reasonCodes, winner.sourceClass === "GENERATION_CANDIDATE" && decision.sourceClass === "FALLBACK_AMT" ? "FALLBACK_LOWER_PRIORITY" : "OVERLAPPING_CLAIM_LOST"])].sort(lexical);
    }
  }
  const merged = mergeRegionEvidenceDecisions(decisions, options);
  const roles = emptyRoleDiagnostics();
  for (const decision of decisions) {
    const row = roles[decision.role];
    if (decision.ownershipState === "OWNED") row.owned += 1;
    else if (decision.ownershipState === "FALLBACK_OWNED") row.fallbackOwned += 1;
    else if (decision.ownershipState === "PARTIAL_SUPPORT") row.partial += 1;
    else row.withheld += 1;
  }
  const acceptedMelody = decisions.some((decision) => decision.role === "melody" && (decision.ownershipState === "OWNED" || decision.ownershipState === "FALLBACK_OWNED"));
  const anyPartial = decisions.some((decision) => decision.ownershipState === "PARTIAL_SUPPORT");
  const anyWithheld = decisions.some((decision) => decision.ownershipState === "WITHHELD");
  const readiness: RegionReadiness = !acceptedMelody ? "GENERATION_BLOCKED" : anyPartial || anyWithheld ? "GENERATION_PARTIAL" : "GENERATION_READY";
  return {
    schemaVersion: REGION_OWNERSHIP_SCHEMA_VERSION,
    decisions,
    merged,
    readiness,
    diagnostics: {
      claimCount: rows.length,
      validClaimCount: decisions.filter((decision) => !decision.reasonCodes.includes("INVALID_REGION")).length,
      ownedClaimCount: decisions.filter((decision) => decision.ownershipState === "OWNED").length,
      fallbackOwnedClaimCount: decisions.filter((decision) => decision.ownershipState === "FALLBACK_OWNED").length,
      partialClaimCount: decisions.filter((decision) => decision.ownershipState === "PARTIAL_SUPPORT").length,
      withheldClaimCount: decisions.filter((decision) => decision.ownershipState === "WITHHELD").length,
      overlapWithheldCount: decisions.filter((decision) => decision.reasonCodes.includes("OVERLAPPING_CLAIM_LOST") || decision.reasonCodes.includes("FALLBACK_LOWER_PRIORITY")).length,
      roles,
    },
  };
}

export const resolveRegionOwnership = resolveRegionEvidence;
export const mergeRegionEvidence = mergeRegionEvidenceDecisions;

/**
 * Return whether a beat-domain source event is owned by an accepted region.
 * Claims without a source region cannot authorize timed source events.
 */
export function regionAllowsSourceEvent(
  decisions: readonly RegionEvidenceDecision[] | RegionOwnershipResolution,
  candidateId: string | readonly string[],
  role: RegionEvidenceRole,
  startBeat: number,
): boolean {
  const rows: readonly RegionEvidenceDecision[] = Array.isArray(decisions)
    ? decisions as readonly RegionEvidenceDecision[]
    : (decisions as RegionOwnershipResolution).decisions;
  const candidateIds = new Set(Array.isArray(candidateId) ? candidateId : [candidateId]);
  const roleClaims = rows.filter((decision) => decision.role === role);
  const scoped = roleClaims.filter((decision) => candidateIds.has(decision.candidateId));
  if (!roleClaims.length) return true;
  if (!scoped.length) return false;
  if (!finite(startBeat)) return false;
  return scoped.some((decision) => (decision.ownershipState === "OWNED" || decision.ownershipState === "FALLBACK_OWNED")
    && decision.sourceRegion !== undefined
    && startBeat >= decision.sourceRegion.startBeat - EPSILON
    && startBeat < decision.sourceRegion.endBeat - EPSILON);
}

export function regionDecisionForSourceEvent(
  decisions: readonly RegionEvidenceDecision[] | RegionOwnershipResolution,
  candidateId: string | readonly string[],
  role: RegionEvidenceRole,
  startBeat: number,
): RegionEvidenceDecision | undefined {
  const rows: readonly RegionEvidenceDecision[] = Array.isArray(decisions)
    ? decisions as readonly RegionEvidenceDecision[]
    : (decisions as RegionOwnershipResolution).decisions;
  const candidateIds = new Set(Array.isArray(candidateId) ? candidateId : [candidateId]);
  return rows.find((decision) => candidateIds.has(decision.candidateId) && decision.role === role && decision.sourceRegion
    && (decision.ownershipState === "OWNED" || decision.ownershipState === "FALLBACK_OWNED")
    && startBeat >= decision.sourceRegion.startBeat - EPSILON && startBeat < decision.sourceRegion.endBeat - EPSILON);
}

/** Whether an accepted claim covers any part of a source beat region. */
export function regionOwnsSourceRegion(
  decisions: readonly RegionEvidenceDecision[] | RegionOwnershipResolution,
  candidateId: string | readonly string[],
  role: RegionEvidenceRole,
  startBeat: number,
  endBeat: number,
): boolean {
  const rows: readonly RegionEvidenceDecision[] = Array.isArray(decisions)
    ? decisions as readonly RegionEvidenceDecision[]
    : (decisions as RegionOwnershipResolution).decisions;
  if (!finite(startBeat) || !finite(endBeat) || endBeat <= startBeat) return false;
  const candidateIds = new Set(Array.isArray(candidateId) ? candidateId : [candidateId]);
  const roleClaims = rows.filter((decision) => decision.role === role);
  if (!roleClaims.length) return true;
  return roleClaims.some((decision) => candidateIds.has(decision.candidateId)
    && (decision.ownershipState === "OWNED" || decision.ownershipState === "FALLBACK_OWNED")
    && decision.sourceRegion !== undefined
    && decision.sourceRegion.startBeat < endBeat - EPSILON
    && startBeat < decision.sourceRegion.endBeat - EPSILON);
}
