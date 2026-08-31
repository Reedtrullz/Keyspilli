/**
 * Deterministic, local-only readiness aggregation for score references.
 *
 * The existing forensics, native-verification, OMR-quality, review-queue, and
 * listening modules intentionally report one concern at a time. This adapter
 * makes the practical hand-off visible per score without making those modules
 * depend on one another or changing the production catalog barrel. It accepts
 * their JSON-shaped reports as data, never reads a PDF/MIDI, and never treats
 * an OMR parse or a rendered WAV as human musical approval.
 */

export const LOCAL_REFERENCE_READINESS_SCHEMA_VERSION = 1 as const;

export type LocalReferenceMaturityState =
  | "RAW_OMR"
  | "VALIDATED_DRAFT"
  | "MELODY_READY"
  | "HARMONY_READY"
  | "FULL_REFERENCE_READY"
  | "MANUAL_REVIEW_REQUIRED"
  | "FAILED";

export type LocalReferenceNativeMatchStatus =
  | "verified-match"
  | "candidate-found"
  | "unverified"
  | "not-found";

export type LocalReferenceReadinessGateStatus =
  | "MULTI_SONG_READY"
  | "PROVISIONAL"
  | "NOT_READY"
  | "FAILED";

export interface LocalReferenceReadinessSourcePdf {
  status: "ok" | "available" | "missing" | "error" | "unknown";
  bytes: number | null;
  pages: number | null;
  sha256: string | null;
  label: string | null;
}

export interface LocalReferenceReadinessSource {
  pdf: LocalReferenceReadinessSourcePdf | null;
  provenanceStatus: "verified" | "available" | "missing" | "unknown";
}

export interface LocalReferenceReadinessNativeMatch {
  status: LocalReferenceNativeMatchStatus;
  classification:
    | "EXACT_OR_HIGH_CONFIDENCE_MATCH"
    | "LIKELY_MATCH"
    | "WRONG_ARRANGEMENT"
    | "UNKNOWN"
    | "NONE";
  eligible: boolean;
  artifact: {
    id: string;
    artifactType: string | null;
    version: string | null;
    provenance: string | null;
    bytes: number | null;
    sha256: string | null;
  } | null;
  reasons: string[];
}

export interface LocalReferenceReadinessBackendCoverage {
  id: string;
  version: string;
  status: string;
  priority: "native" | "omr" | "unknown";
  measureCount: number;
  availableMeasures: number;
  acceptedMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  availableCoverage: number | null;
  acceptedCoverage: number | null;
}

export interface LocalReferenceReadinessOmr {
  available: boolean;
  source: "quality" | "consensus" | "none";
  preferredBackend: {
    kind: "omr" | "consensus" | "none";
    id: string;
    version: string;
    status: string;
  } | null;
  preferredBackendByRole: Record<"melody" | "harmony" | "rhythm", { id: string; version: string } | null>;
  preferredCoverage: {
    totalMeasures: number;
    availableMeasures: number;
    acceptedMeasures: number;
    reviewMeasures: number;
    brokenMeasures: number;
    availableCoverage: number | null;
    acceptedCoverage: number | null;
  };
  backends: LocalReferenceReadinessBackendCoverage[];
  fallbackWindows: number | null;
}

export interface LocalReferenceReadinessRole {
  state: LocalReferenceMaturityState;
  eligible: boolean;
  trustedPercent: number | null;
  trustedMeasures: number;
  availableMeasures: number;
  reviewRegions: number;
  basis: string;
  /** Role-local OMR quality evidence, when supplied by a corpus report. */
  readiness?: "READY" | "REVIEW_REQUIRED" | "UNAVAILABLE";
  coverage?: number | null;
  eligibleMeasures?: number;
  reviewMeasures?: number;
  brokenMeasures?: number;
  preferredBackend?: { id: string; version: string } | null;
}

export interface LocalReferenceReadinessReviewRegion {
  id: string;
  measureId: string;
  /** All measures covered by an independent role-review group, when supplied. */
  measureIds?: string[];
  measureNumber: string;
  page: number | null;
  system: number | null;
  pageSystems?: Array<{ page: number | null; system: number | null }>;
  role: "melody" | "harmony" | "rhythm" | "unknown";
  reasonCategory: string;
  state: "AUTO_ACCEPT" | "LIKELY_OK" | "REVIEW" | "BROKEN";
  priority: "high" | "medium" | "low";
  evidence: string[];
  recommendedAction: string;
  decision: "pending" | "accepted" | "rejected" | "corrected" | "skipped";
  /** Independent role-review provenance, when this region came from a corpus group. */
  backendId?: string;
  backendVersion?: string;
  firstMeasureIndex?: number | null;
  lastMeasureIndex?: number | null;
  startBeat?: number | null;
  endBeat?: number | null;
  memberCount?: number | null;
  estimatedEventCount?: number | null;
  confidence?: { min: number; median: number; max: number } | null;
}

export interface LocalReferenceReadinessHumanDecision {
  id: string;
  scoreId: string;
  itemId: string;
  outcome: "accepted" | "rejected" | "corrected" | "skipped";
  note: string | null;
}

export interface LocalReferenceReadinessReview {
  regions: LocalReferenceReadinessReviewRegion[];
  totalRegions: number;
  melodyCriticalRegions: number;
  harmonyCriticalRegions: number;
  rhythmCriticalRegions: number;
  /** Counts reported by a corpus summary when localized queue items are absent. */
  reportedOnly: boolean;
  actualHumanDecisions: number;
  pendingRegions: number;
  decisions: LocalReferenceReadinessHumanDecision[];
}

export interface LocalReferenceReadinessListening {
  status: "RENDERED" | "PARTIAL" | "UNAVAILABLE" | "NOT_REQUESTED";
  available: boolean;
  artifacts: {
    referenceMidi: string | null;
    referenceMusicXml: string | null;
    melodyMidi: string | null;
    accompanimentMidi: string | null;
    fullWav: string | null;
    melodyWav: string | null;
    accompanimentWav: string | null;
    openingExcerptWav: string | null;
    manifest: string | null;
    reviewQueue: string | null;
    markdown: string | null;
    html: string | null;
    coverageMask: string | null;
  };
  renderer: {
    id: string;
    version: string;
    sampleRate: number | null;
    channels: number | null;
    gain: number | null;
    targetPeak: number | null;
    soundfont: { identifier: string; sha256: string | null; bytes: number | null } | null;
  } | null;
}

export interface LocalReferenceReadinessBenchmark {
  melodyEligible: boolean;
  harmonyEligible: boolean;
  melodyState: LocalReferenceMaturityState;
  harmonyState: LocalReferenceMaturityState;
  gate: "eligible" | "provisional" | "not-eligible" | "unknown";
  failures: string[];
}

export interface LocalReferenceReadinessScore {
  id: string;
  artist: string;
  title: string;
  source: LocalReferenceReadinessSource;
  nativeMatch: LocalReferenceReadinessNativeMatch;
  omr: LocalReferenceReadinessOmr;
  readiness: {
    state: LocalReferenceMaturityState;
    melody: LocalReferenceReadinessRole;
    harmony: LocalReferenceReadinessRole;
    rhythm: LocalReferenceReadinessRole;
  };
  review: LocalReferenceReadinessReview;
  benchmark: LocalReferenceReadinessBenchmark;
  listening: LocalReferenceReadinessListening;
  outputs: {
    referenceMidi: string | null;
    referenceMusicXml: string | null;
    coverageMask: string | null;
    manifest: string | null;
    reviewQueue: string | null;
  };
  nonClaims: string[];
}

export interface LocalReferenceReadinessInput {
  /** Local builder, corpus, or equivalent JSON-shaped score reports. */
  scores?: readonly unknown[];
  /** A single report is accepted as a convenience for CLI adapters. */
  score?: unknown;
  /** Listening reports keyed by score id or as an array of reports. */
  listening?: readonly unknown[] | Record<string, unknown>;
  listeningBundles?: readonly unknown[] | Record<string, unknown>;
  /** Optional explicit human decisions. Omitted means zero decisions. */
  humanDecisions?: readonly unknown[];
}

export interface LocalReferenceReadinessReport {
  schemaVersion: typeof LOCAL_REFERENCE_READINESS_SCHEMA_VERSION;
  kind: "local-reference-readiness";
  scores: LocalReferenceReadinessScore[];
  summary: {
    totalScores: number;
    sourcePdfAvailable: number;
    nativeCandidates: number;
    nativeSymbolicMatches: number;
    preferredBackendCounts: Record<string, number>;
    melodyReadyAutomatically: number;
    harmonyReadyAutomatically: number;
    fullReferenceReady: number;
    manualReviewScores: number;
    failedScores: number;
    reviewRegions: number;
  };
  humanWorkload: {
    melodyCriticalReviewRegions: number;
    harmonyCriticalReviewRegions: number;
    rhythmCriticalReviewRegions: number;
    totalReviewRegions: number;
    actualHumanDecisions: number;
    pendingRegions: number;
  };
  benchmarkGate: {
    status: LocalReferenceReadinessGateStatus;
    decision: "build-multi-song-benchmark" | "build-provisional-benchmark" | "finish-human-review-queue" | "no-usable-references";
    melodyReadyScores: number;
    harmonyReadyScores: number;
    thresholds: { multiSongMelodyReady: 4; provisionalMelodyReady: 2 };
    failures: string[];
  };
  nonClaims: string[];
}

type UnknownRecord = Record<string, unknown>;
type ReadinessRoleName = "melody" | "harmony" | "rhythm";

const ROLES: readonly ReadinessRoleName[] = ["melody", "harmony", "rhythm"];
const MATURITY_STATES = new Set<LocalReferenceMaturityState>([
  "RAW_OMR",
  "VALIDATED_DRAFT",
  "MELODY_READY",
  "HARMONY_READY",
  "FULL_REFERENCE_READY",
  "MANUAL_REVIEW_REQUIRED",
  "FAILED",
]);
const NATIVE_CLASSIFICATIONS = new Set<LocalReferenceReadinessNativeMatch["classification"]>([
  "EXACT_OR_HIGH_CONFIDENCE_MATCH",
  "LIKELY_MATCH",
  "WRONG_ARRANGEMENT",
  "UNKNOWN",
  "NONE",
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): number | null {
  return finite(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

function number(value: unknown): number | null {
  return finite(value) ? value : null;
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  return cleaned || fallback;
}

function safeId(value: unknown, fallback: string): string {
  const cleaned = text(value, fallback).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
}

function safeHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f\d]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function safeLabel(value: unknown, fallback = "unknown"): string {
  const cleaned = text(value, fallback);
  if (/(?:^|[\s"'(=:])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/]|\/|\\)/i.test(cleaned)) return fallback;
  if (/https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(cleaned)) return fallback;
  return cleaned;
}

function safeRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\\/g, "/").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned.startsWith("/") || /^[A-Za-z]:\//.test(cleaned) || cleaned.startsWith("~")) return null;
  if (cleaned.split("/").some((part) => part === ".." || part === "")) return null;
  if (/^(?:https?|file):/i.test(cleaned)) return null;
  return cleaned.slice(0, 300);
}

function safeReason(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(?:file:\/\/)?(?:\/(?:Users|private|tmp|var|home|Volumes)\/[^\s"']+|[A-Za-z]:[\\/][^\s"']+)/g, "[redacted-path]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, item]) => [key, stable(item)]),
  );
}

function state(value: unknown, fallback: LocalReferenceMaturityState = "RAW_OMR"): LocalReferenceMaturityState {
  return typeof value === "string" && MATURITY_STATES.has(value as LocalReferenceMaturityState)
    ? value as LocalReferenceMaturityState
    : fallback;
}

function queueState(value: unknown): LocalReferenceReadinessReviewRegion["state"] {
  if (value === "AUTO_ACCEPT" || value === "LIKELY_OK" || value === "REVIEW" || value === "BROKEN") return value;
  if (value === "FAILED" || value === "REVIEW_REQUIRED") return value === "FAILED" ? "BROKEN" : "REVIEW";
  if (value === "TRUSTED_NATIVE" || value === "TRUSTED_CONSENSUS" || value === "TRUSTED_SINGLE_ENGINE") return "AUTO_ACCEPT";
  return "BROKEN";
}

function role(value: unknown): ReadinessRoleName | "unknown" {
  return value === "melody" || value === "harmony" || value === "rhythm" ? value : "unknown";
}

function priority(value: unknown, roleName: ReadinessRoleName | "unknown", reason: string): LocalReferenceReadinessReviewRegion["priority"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (roleName === "melody" && ["pitch", "timing", "clef", "chord-root"].includes(reason)) return "high";
  if (roleName === "harmony") return "medium";
  if (roleName === "rhythm") return "low";
  return reason === "structure" ? "high" : "medium";
}

function reasonCategory(value: unknown): string {
  const raw = typeof value === "string" ? value : "unknown";
  const lowered = raw.toLowerCase();
  if (lowered.includes("structure") || lowered.includes("measure") || lowered.includes("tie") || lowered.includes("unmatched")) return "structure";
  if (lowered.includes("clef")) return "clef";
  if (lowered.includes("chord") || lowered.includes("root")) return "chord-root";
  if (lowered.includes("pitch") || lowered.includes("melody") || lowered.includes("leap")) return "pitch";
  if (lowered.includes("timing") || lowered.includes("onset") || lowered.includes("duration") || lowered.includes("rhythm") || lowered.includes("density")) return "timing";
  if (lowered.includes("articulation") || lowered.includes("continuity")) return "articulation";
  return "unknown";
}

function compareMeasureIds(left: string, right: string): number {
  const leftMatch = /(\d+)(?:\D*)$/.exec(left);
  const rightMatch = /(\d+)(?:\D*)$/.exec(right);
  if (leftMatch && rightMatch) {
    const numeric = Number(leftMatch[1]) - Number(rightMatch[1]);
    if (numeric !== 0) return numeric;
  }
  return compare(left, right);
}

function decisionOutcome(value: unknown): LocalReferenceReadinessHumanDecision["outcome"] | null {
  if (value === "accept" || value === "accepted" || value === "approve" || value === "approved") return "accepted";
  if (value === "reject" || value === "rejected") return "rejected";
  if (value === "correct" || value === "corrected" || value === "edit" || value === "edited") return "corrected";
  if (value === "skip" || value === "skipped") return "skipped";
  return null;
}

function sourcePdf(raw: UnknownRecord): LocalReferenceReadinessSource {
  const source = record(raw.source);
  const pdf = record(source.pdf);
  const identity = record(pdf.identity);
  // The builder uses source.pdf, while corpus reports commonly flatten the
  // PDF identity onto source (fileName/bytes/pages/sha256). Accept both
  // shapes, but never carry a physical path into the readiness report.
  const direct = Object.keys(pdf).length
    ? pdf
    : Object.keys(source).some((key) => ["status", "fileName", "logicalBasename", "label", "bytes", "pages", "sha256"].includes(key))
      ? source
      : record(raw.sourcePdf);
  const bytes = integer(direct.bytes ?? identity.bytes);
  const pages = integer(direct.pages ?? identity.pages);
  const sha256 = safeHash(direct.sha256 ?? identity.sha256);
  const statusValue = text(direct.status ?? source.status, "unknown").toLowerCase();
  const status: LocalReferenceReadinessSourcePdf["status"] = statusValue === "ok" || statusValue === "available"
    ? statusValue
    : statusValue === "missing" || statusValue === "error" ? statusValue : "unknown";
  const label = safeLabel(direct.logicalBasename ?? direct.fileName ?? direct.label, "");
  const pdfValue = Object.keys(direct).length || bytes !== null || pages !== null || sha256 !== null
    ? { status, bytes, pages, sha256, label: label || null }
    : null;
  return {
    pdf: pdfValue,
    provenanceStatus: pdfValue?.sha256 ? "verified" : pdfValue ? "available" : "missing",
  };
}

function verifiedNativeCandidate(candidate: UnknownRecord): boolean {
  const hashStatus = text(candidate.hashStatus).toLowerCase();
  const bytes = integer(candidate.bytes);
  return hashStatus === "verified"
    && safeHash(candidate.sha256) !== null
    && bytes !== null
    && bytes > 0
    && Boolean(safeLabel(candidate.provenance, ""));
}

function nativeMatch(raw: UnknownRecord): LocalReferenceReadinessNativeMatch {
  const verification = record(raw.nativeVerification);
  const discovery = record(raw.nativeDiscovery);
  const selected = record(raw.selected);
  const nativeSummary = record(raw.native);
  const candidate = record(verification.candidate).id
    ? record(verification.candidate)
    : Object.keys(record(discovery.selected)).length
      ? record(discovery.selected)
      : selected.kind === "native" ? selected : {};
  const hasCandidate = Object.keys(candidate).length > 0 && Boolean(text(candidate.id));
  const rawClassification = verification.classification ?? raw.nativeClassification ?? selected.classification ?? (hasCandidate ? "UNKNOWN" : "NONE");
  const classification = NATIVE_CLASSIFICATIONS.has(rawClassification as LocalReferenceReadinessNativeMatch["classification"])
    ? rawClassification as LocalReferenceReadinessNativeMatch["classification"]
    : "UNKNOWN";
  const verifiedCandidate = verifiedNativeCandidate(candidate);
  const eligible = Boolean(verifiedCandidate
    && classification === "EXACT_OR_HIGH_CONFIDENCE_MATCH"
    && (verification.eligibleAsReference === true
      || candidate.trusted === true
      || (selected.kind === "native" && nativeSummary.selected === true)));
  const status: LocalReferenceNativeMatchStatus = eligible
    ? "verified-match"
    : hasCandidate
      ? classification === "UNKNOWN" ? "unverified" : "candidate-found"
      : "not-found";
  const reasons = [
    ...array(verification.reasons).map((value) => safeReason(value)),
    ...array(nativeSummary.errors).map((value) => safeReason(value)),
  ].filter(Boolean).sort(compare);
  return {
    status,
    classification,
    eligible,
    artifact: hasCandidate ? {
      id: safeId(candidate.id, "native"),
      artifactType: safeLabel(candidate.artifactType ?? candidate.type, "") || null,
      version: safeLabel(candidate.version ?? candidate.versionIdentity, "") || null,
      provenance: safeLabel(candidate.provenance, "") || null,
      bytes: integer(candidate.bytes),
      sha256: safeHash(candidate.sha256),
    } : null,
    reasons,
  };
}

interface RawQualityData {
  rows: UnknownRecord[];
  selectedRows: UnknownRecord[];
  backends: UnknownRecord[];
  summaries: UnknownRecord[];
  totalMeasures: number;
  fallbackWindows: number | null;
}

interface ReportedReviewCounts {
  total: number;
  melody: number;
  harmony: number;
  rhythm: number;
}

function reportedReviewCounts(raw: UnknownRecord): ReportedReviewCounts {
  const summary = record(raw.review);
  const roleGroups = array(summary.roleGroups).map(record);
  const roleGroupCounts = {
    melody: roleGroups.filter((group) => role(group.role) === "melody").length,
    harmony: roleGroups.filter((group) => role(group.role) === "harmony").length,
    rhythm: roleGroups.filter((group) => role(group.role) === "rhythm").length,
  };
  return {
    total: integer(summary.actionableItems ?? summary.totalItems ?? summary.totalRegions) ?? roleGroups.length,
    melody: integer(summary.melodyCritical ?? summary.melodyCriticalRegions) ?? roleGroupCounts.melody,
    harmony: integer(summary.harmonyCritical ?? summary.harmonyCriticalRegions) ?? roleGroupCounts.harmony,
    rhythm: integer(summary.rhythmCritical ?? summary.rhythmCriticalRegions) ?? roleGroupCounts.rhythm,
  };
}

function qualityData(raw: UnknownRecord): RawQualityData {
  const quality = record(raw.quality);
  const rows = array(quality.measures).map(record).filter((item) => Object.keys(item).length > 0);
  const selected = record(raw.qualitySelection);
  const selectedRows = array(selected.regions).map(record).filter((item) => Object.keys(item).length > 0);
  const summaries = array(quality.backendSummaries).map(record).filter((item) => Object.keys(item).length > 0);
  const backends = array(quality.backends).map(record).filter((item) => Object.keys(item).length > 0);
  const corpusOmr = record(raw.omr);
  const uniqueIds = new Set(rows.map((row) => text(row.measureId ?? row.id)).filter(Boolean));
  return {
    rows,
    selectedRows: selectedRows.length ? selectedRows : bestRows(rows),
    backends,
    summaries,
    totalMeasures: uniqueIds.size
      || integer(corpusOmr.qualityMeasures)
      || Math.max(...summaries.map((row) => integer(row.measureCount) ?? 0), 0),
    fallbackWindows: number(record(raw.consensus).summary && record(record(raw.consensus).summary).fallbackWindows)
      ?? number(record(raw.consensus).fallbackWindows),
  };
}

function rowKey(row: UnknownRecord): string {
  return `${text(row.page, "?")}\u0000${text(row.measureId ?? row.id, "?")}\u0000${text(row.measureNumber ?? row.number, "?")}`;
}

function bestRows(rows: UnknownRecord[]): UnknownRecord[] {
  const rank: Record<string, number> = { AUTO_ACCEPT: 4, LIKELY_OK: 3, REVIEW: 2, BROKEN: 1 };
  const byKey = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const key = rowKey(row);
    const prior = byKey.get(key);
    if (!prior || (rank[text(row.state)] ?? 0) > (rank[text(prior.state)] ?? 0)
      || ((rank[text(row.state)] ?? 0) === (rank[text(prior.state)] ?? 0) && (number(row.score) ?? -1) > (number(prior.score) ?? -1))) byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => compare(rowKey(left), rowKey(right)));
}

function backendCoverage(data: RawQualityData, raw: UnknownRecord): LocalReferenceReadinessBackendCoverage[] {
  const summaryByKey = new Map<string, UnknownRecord>();
  for (const summary of data.summaries) summaryByKey.set(`${text(summary.id)}\u0000${text(summary.version, "unknown")}`, summary);
  const backendRows = data.backends.length ? data.backends : data.summaries;
  const corpusOmr = record(raw.omr);
  const corpusBackends = array(corpusOmr.backends).map(record).filter((row) => Object.keys(row).length > 0);
  const sourceBackends = backendRows.length ? backendRows : corpusBackends;
  const result: LocalReferenceReadinessBackendCoverage[] = [];
  for (const backend of sourceBackends) {
    const id = safeId(backend.id ?? backend.backendId, "backend");
    const version = safeLabel(backend.version ?? backend.backendVersion, "unknown");
    const summary = summaryByKey.get(`${text(backend.id ?? backend.backendId)}\u0000${text(backend.version ?? backend.backendVersion, "unknown")}`) ?? backend;
    const measureCount = integer(summary.measureCount) ?? integer(backend.measureCount) ?? 0;
    const availableMeasures = integer(summary.availableMeasures) ?? integer(backend.availableMeasures) ?? measureCount;
    const acceptedMeasures = (integer(summary.autoAcceptMeasures) ?? integer(summary.acceptedMeasures) ?? 0)
      + (integer(summary.likelyOkMeasures) ?? 0);
    const reviewMeasures = integer(summary.reviewMeasures) ?? integer(summary.reviewRequiredMeasures) ?? 0;
    const brokenMeasures = integer(summary.brokenMeasures) ?? integer(summary.failedMeasures)
      ?? Math.max(0, measureCount - acceptedMeasures - reviewMeasures);
    result.push({
      id,
      version,
      status: safeLabel(summary.status ?? backend.status, "unknown"),
      priority: summary.priority === "native" || backend.priority === "native" ? "native" : summary.priority === "omr" || backend.priority === "omr" ? "omr" : "unknown",
      measureCount,
      availableMeasures,
      acceptedMeasures,
      reviewMeasures,
      brokenMeasures,
      availableCoverage: measureCount > 0 ? rounded(availableMeasures / measureCount) : null,
      acceptedCoverage: measureCount > 0 ? rounded(acceptedMeasures / measureCount) : null,
    });
  }
  if (!result.length) {
    const consensus = record(raw.consensus);
    for (const backend of array(consensus.backends).map(record)) {
      if (!Object.keys(backend).length) continue;
      const measureCount = integer(backend.measureCount) ?? 0;
      const availableMeasures = measureCount;
      result.push({
        id: safeId(backend.id, "backend"), version: safeLabel(backend.version, "unknown"), status: safeLabel(backend.status, "unknown"), priority: "omr",
        measureCount, availableMeasures, acceptedMeasures: 0, reviewMeasures: 0, brokenMeasures: 0,
        availableCoverage: measureCount > 0 ? 1 : null, acceptedCoverage: null,
      });
    }
  }
  return result.sort((left, right) => compare(`${left.id}\u0000${left.version}`, `${right.id}\u0000${right.version}`));
}

function preferredBackend(raw: UnknownRecord, data: RawQualityData, backends: LocalReferenceReadinessBackendCoverage[]): LocalReferenceReadinessOmr["preferredBackend"] {
  const selected = record(raw.selected);
  const omr = record(raw.omr);
  const selectedBackend = text(selected.backend ?? omr.preferredBackend);
  if (selectedBackend) {
    const row = backends.find((candidate) => candidate.id === safeId(selectedBackend, selectedBackend));
    return { kind: "omr", id: row?.id ?? safeId(selectedBackend, selectedBackend), version: row?.version ?? safeLabel(selected.version ?? omr.preferredBackendVersion, "unknown"), status: row?.status ?? safeLabel(omr.status, "available") };
  }
  const quality = record(raw.quality);
  const selection = record(raw.qualitySelection);
  const selectedRegions = array(selection.regions).map(record).filter((row) => Object.keys(row).length > 0);
  const selectedIds = new Map<string, number>();
  for (const row of selectedRegions) selectedIds.set(`${text(row.backendId)}\u0000${text(row.backendVersion)}`, (selectedIds.get(`${text(row.backendId)}\u0000${text(row.backendVersion)}`) ?? 0) + 1);
  const candidate = [...backends].sort((left, right) => {
    const leftSelected = selectedIds.get(`${left.id}\u0000${left.version}`) ?? 0;
    const rightSelected = selectedIds.get(`${right.id}\u0000${right.version}`) ?? 0;
    return rightSelected - leftSelected || (right.acceptedCoverage ?? -1) - (left.acceptedCoverage ?? -1) || right.availableMeasures - left.availableMeasures || compare(left.id, right.id) || compare(left.version, right.version);
  })[0];
  if (candidate) return { kind: "omr", id: candidate.id, version: candidate.version, status: candidate.status };
  const consensus = record(raw.consensus);
  const summary = record(consensus.summary);
  const consensusBackends = array(consensus.backends).map(record).filter((row) => Object.keys(row).length > 0);
  const available = consensusBackends.filter((row) => text(row.status) === "available").sort((left, right) => compare(text(left.id), text(right.id)))[0];
  if (available) return { kind: "consensus", id: safeId(available.id, "omr"), version: safeLabel(available.version, "unknown"), status: safeLabel(available.status, "available") };
  if (text(summary.state)) return { kind: "consensus", id: "omr-consensus", version: "1", status: text(summary.state, "unknown") };
  void data;
  void quality;
  return null;
}

function omrSummary(raw: UnknownRecord): LocalReferenceReadinessOmr {
  const data = qualityData(raw);
  const backends = backendCoverage(data, raw);
  const consensus = record(raw.consensus);
  const consensusSummary = record(consensus.summary);
  const corpusOmr = record(raw.omr);
  const corpusHasOmr = Object.keys(corpusOmr).length > 0;
  const quality = record(raw.quality);
  const useQuality = Object.keys(quality).length > 0 && (data.rows.length > 0 || backends.length > 0);
  const totalMeasures = useQuality
    ? data.totalMeasures
    : integer(consensusSummary.totalMeasures)
      ?? integer(corpusOmr.qualityMeasures)
      ?? 0;
  const acceptedMeasures = useQuality
    ? data.selectedRows.filter((row) => queueState(row.state) === "AUTO_ACCEPT" || queueState(row.state) === "LIKELY_OK").length
    : integer(consensusSummary.trustedMeasures)
      ?? backends.reduce((sum, row) => sum + row.acceptedMeasures, 0)
      ?? 0;
  const reviewMeasures = useQuality
    ? data.selectedRows.filter((row) => queueState(row.state) === "REVIEW").length
    : integer(consensusSummary.reviewRequiredMeasures)
      ?? integer(corpusOmr.reviewMeasures)
      ?? backends.reduce((sum, row) => sum + row.reviewMeasures, 0);
  const brokenMeasures = useQuality
    ? data.selectedRows.filter((row) => queueState(row.state) === "BROKEN").length
    : integer(consensusSummary.failedMeasures)
      ?? integer(corpusOmr.brokenMeasures)
      ?? backends.reduce((sum, row) => sum + row.brokenMeasures, 0);
  const availableMeasures = useQuality ? data.selectedRows.length : acceptedMeasures + reviewMeasures + brokenMeasures;
  const preferred = preferredBackend(raw, data, backends);
  const preferredRow = preferred ? backends.find((row) => row.id === preferred.id && row.version === preferred.version) : null;
  const consensusCoverage = totalMeasures > 0 ? {
    totalMeasures,
    availableMeasures,
    acceptedMeasures,
    reviewMeasures,
    brokenMeasures,
    availableCoverage: rounded(availableMeasures / totalMeasures),
    acceptedCoverage: rounded(acceptedMeasures / totalMeasures),
  } : {
    totalMeasures: 0, availableMeasures: 0, acceptedMeasures: 0, reviewMeasures: 0, brokenMeasures: 0, availableCoverage: null, acceptedCoverage: null,
  };
  return {
    available: useQuality || Object.keys(consensus).length > 0 || corpusHasOmr,
    source: useQuality ? "quality" : Object.keys(consensus).length > 0 ? "consensus" : corpusHasOmr ? "quality" : "none",
    preferredBackend: preferred,
    preferredBackendByRole: preferredBackendByRole(raw),
    preferredCoverage: preferredRow ? {
      totalMeasures: preferredRow.measureCount,
      availableMeasures: preferredRow.availableMeasures,
      acceptedMeasures: preferredRow.acceptedMeasures,
      reviewMeasures: preferredRow.reviewMeasures,
      brokenMeasures: preferredRow.brokenMeasures,
      availableCoverage: preferredRow.availableCoverage,
      acceptedCoverage: preferredRow.acceptedCoverage,
    } : consensusCoverage,
    backends,
    fallbackWindows: integer(consensusSummary.fallbackWindows) ?? integer(corpusOmr.fallbackWindows) ?? data.fallbackWindows,
  };
}

function eventRoles(row: UnknownRecord): Set<ReadinessRoleName> {
  const roles = new Set<ReadinessRoleName>();
  for (const event of array(row.events).map(record)) {
    const eventRole = role(event.role);
    if (eventRole !== "unknown") roles.add(eventRole);
  }
  return roles;
}

type OmrRoleReadinessStatus = "READY" | "REVIEW_REQUIRED" | "UNAVAILABLE";

interface ParsedOmrRoleQualityReadiness {
  present: boolean;
  value: UnknownRecord;
  readiness: OmrRoleReadinessStatus | null;
  coverage: number | null;
  eligibleMeasures: number;
  availableMeasures: number;
  trustedMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  preferredBackend: { id: string; version: string } | null;
}

function omrRoleReadiness(value: unknown): OmrRoleReadinessStatus | null {
  const normalized = text(value).toUpperCase();
  if (normalized === "READY" || normalized === "REVIEW_REQUIRED" || normalized === "UNAVAILABLE") return normalized;
  const referenceState = normalized;
  if (referenceState.endsWith("_REFERENCE_READY")) return "READY";
  if (referenceState.endsWith("_REFERENCE_NOT_READY")) return "REVIEW_REQUIRED";
  return referenceState === "UNAVAILABLE" ? "UNAVAILABLE" : null;
}

function preferredBackendRef(value: unknown): { id: string; version: string } | null {
  const candidate = record(value);
  const id = safeId(candidate.id, "");
  if (!id) return null;
  return { id, version: safeLabel(candidate.version, "unknown") };
}

function parsedOmrRoleQualityReadiness(raw: UnknownRecord, roleName: ReadinessRoleName): ParsedOmrRoleQualityReadiness {
  const omr = record(raw.omr);
  const roleQuality = record(omr.roleQuality);
  const roleReadiness = record(roleQuality.roleReadiness);
  const value = record(roleReadiness[roleName]);
  const preferredBackend = value.preferredBackendId
    ? preferredBackendRef({ id: value.preferredBackendId, version: value.preferredBackendVersion })
    : preferredBackendRef(record(omr.preferredBackendByRole)[roleName]);
  return {
    present: Object.keys(value).length > 0,
    value,
    readiness: omrRoleReadiness(value.readiness ?? value.referenceState),
    coverage: number(value.coverage),
    eligibleMeasures: integer(value.eligibleMeasures) ?? 0,
    availableMeasures: integer(value.availableMeasures) ?? 0,
    trustedMeasures: integer(value.trustedMeasures) ?? 0,
    reviewMeasures: integer(value.reviewMeasures) ?? 0,
    brokenMeasures: integer(value.brokenMeasures) ?? 0,
    preferredBackend,
  };
}

function preferredBackendByRole(raw: UnknownRecord): Record<ReadinessRoleName, { id: string; version: string } | null> {
  return Object.fromEntries(ROLES.map((roleName) => [roleName, parsedOmrRoleQualityReadiness(raw, roleName).preferredBackend])) as Record<ReadinessRoleName, { id: string; version: string } | null>;
}

function benchmarkRole(raw: UnknownRecord, roleName: ReadinessRoleName): {
  eligible: boolean | null;
  readiness: OmrRoleReadinessStatus | null;
  roleQualityPresent: boolean;
  coverage: number | null;
  eligibleMeasures: number;
  trustedMeasures: number;
  availableMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  preferredBackend: { id: string; version: string } | null;
  basis: string;
} {
  const roleQuality = parsedOmrRoleQualityReadiness(raw, roleName);
  const benchmark = record(raw.benchmark);
  const consensus = record(raw.consensus);
  const eligibility = record(record(consensus.eligibility)[roleName]);
  const benchmarkRoleValue = record(benchmark[roleName]);
  const corpusRole = record(record(raw.roles)[roleName]);
  const selected = roleQuality.present
    ? roleQuality.value
    : benchmarkRoleValue.eligible !== undefined
      ? benchmarkRoleValue
      : eligibility.eligible !== undefined ? eligibility : corpusRole;
  const eligible = roleQuality.present
    ? roleQuality.readiness === "READY"
      ? true
      : roleQuality.readiness === "REVIEW_REQUIRED" || roleQuality.readiness === "UNAVAILABLE"
        ? false
        : typeof selected.eligible === "boolean" ? selected.eligible : null
    : typeof selected.eligible === "boolean"
      ? selected.eligible
      : selected.state === "READY" ? true
        : selected.state === "REVIEW_REQUIRED" || selected.state === "UNAVAILABLE" ? false : null;
  return {
    eligible,
    readiness: roleQuality.present ? roleQuality.readiness : null,
    roleQualityPresent: roleQuality.present,
    coverage: roleQuality.present ? roleQuality.coverage : number(selected.coverage),
    eligibleMeasures: roleQuality.present ? roleQuality.eligibleMeasures : integer(selected.eligibleMeasures) ?? 0,
    trustedMeasures: roleQuality.present ? roleQuality.trustedMeasures : integer(selected.trustedMeasures ?? selected.eligibleMeasures) ?? 0,
    availableMeasures: roleQuality.present ? roleQuality.availableMeasures : integer(selected.availableMeasures ?? selected.eligibleMeasures) ?? 0,
    reviewMeasures: roleQuality.present ? roleQuality.reviewMeasures : integer(selected.reviewMeasures) ?? 0,
    brokenMeasures: roleQuality.present ? roleQuality.brokenMeasures : integer(selected.brokenMeasures) ?? 0,
    preferredBackend: roleQuality.preferredBackend,
    basis: roleQuality.present ? "OMR role-quality readiness" : Object.keys(benchmarkRoleValue).length ? "corpus benchmark eligibility" : Object.keys(eligibility).length ? "OMR role eligibility" : Object.keys(corpusRole).length ? "corpus role readiness" : "role-tagged quality rows",
  };
}

function roleReadiness(raw: UnknownRecord, roleName: ReadinessRoleName, reviewRegions: LocalReferenceReadinessReviewRegion[], data: RawQualityData, native: LocalReferenceReadinessNativeMatch): LocalReferenceReadinessRole {
  const explicit = benchmarkRole(raw, roleName);
  const rows = data.selectedRows.length ? data.selectedRows : data.rows;
  const roleRows = rows.filter((row) => eventRoles(row).has(roleName));
  const acceptedRoleRows = roleRows.filter((row) => queueState(row.state) === "AUTO_ACCEPT" || queueState(row.state) === "LIKELY_OK");
  const reviewCount = reviewRegions.filter((item) => item.role === roleName && item.decision === "pending").length;
  const roleCoverage = explicit.roleQualityPresent
    ? explicit.coverage
    : explicit.coverage ?? (roleRows.length > 0 ? acceptedRoleRows.length / roleRows.length : null);
  const availableMeasures = explicit.roleQualityPresent ? explicit.availableMeasures : explicit.availableMeasures || roleRows.length;
  const trustedMeasures = explicit.roleQualityPresent ? explicit.trustedMeasures : explicit.trustedMeasures || acceptedRoleRows.length;
  const isEligible = explicit.eligible === true || (roleCoverage !== null && roleCoverage >= 0.8 && (explicit.roleQualityPresent ? explicit.eligibleMeasures > 0 : roleRows.length > 0));
  const rawState = state(record(record(raw.readiness)[roleName]).state, "RAW_OMR");
  const scoreState = state(raw.maturity ?? raw.state, "RAW_OMR");
  const corpusRoleState = text(record(record(raw.roles)[roleName]).state);
  const allAvailableRowsBroken = rows.length > 0 && rows.every((row) => queueState(row.state) === "BROKEN");
  let resultState: LocalReferenceMaturityState;
  let basis = explicit.basis;
  if (explicit.roleQualityPresent && explicit.readiness === "READY") {
    resultState = roleName === "melody" ? "MELODY_READY" : roleName === "harmony" ? "HARMONY_READY" : "VALIDATED_DRAFT";
    basis = explicit.basis;
  } else if (explicit.roleQualityPresent && explicit.readiness === "REVIEW_REQUIRED") {
    resultState = "MANUAL_REVIEW_REQUIRED";
    basis = "OMR role-quality readiness requires review";
  } else if (explicit.roleQualityPresent && explicit.readiness === "UNAVAILABLE") {
    resultState = "RAW_OMR";
    basis = "role evidence unavailable from OMR role-quality report";
  } else if (reviewCount > 0) {
    resultState = "MANUAL_REVIEW_REQUIRED";
    basis = "role has unresolved localized review regions";
  } else if (corpusRoleState === "REVIEW_REQUIRED") {
    resultState = "MANUAL_REVIEW_REQUIRED";
    basis = "corpus role readiness requires review";
  } else if (corpusRoleState === "UNAVAILABLE") {
    resultState = "RAW_OMR";
    basis = "role evidence unavailable";
  } else if (roleName === "melody" && (isEligible || native.eligible || rawState === "MELODY_READY" || scoreState === "MELODY_READY" || scoreState === "HARMONY_READY" || scoreState === "FULL_REFERENCE_READY")) {
    resultState = "MELODY_READY";
    basis = native.eligible ? "verified native symbolic match" : explicit.eligible === true ? explicit.basis : "validated melody evidence";
  } else if (roleName === "harmony" && (isEligible || rawState === "HARMONY_READY" || scoreState === "HARMONY_READY" || scoreState === "FULL_REFERENCE_READY")) {
    resultState = "HARMONY_READY";
    basis = explicit.eligible === true ? explicit.basis : "validated harmony evidence";
  } else if (roleName === "rhythm" && (isEligible || scoreState === "FULL_REFERENCE_READY")) {
    resultState = "VALIDATED_DRAFT";
    basis = "validated rhythm evidence";
  } else if ((scoreState === "FAILED" || allAvailableRowsBroken) && !roleRows.length && !native.eligible) {
    resultState = "FAILED";
    basis = "no usable symbolic evidence";
  } else if (roleRows.length || data.rows.length || Object.keys(record(raw.quality)).length || Object.keys(record(raw.consensus)).length) {
    resultState = reviewCount > 0 ? "MANUAL_REVIEW_REQUIRED" : "VALIDATED_DRAFT";
    basis = roleRows.length ? "role-tagged OMR rows" : "symbolic backend available without explicit role tags";
  } else {
    resultState = "RAW_OMR";
    basis = "no role-specific symbolic evidence";
  }
  return {
    state: resultState,
    eligible: resultState === "MELODY_READY" || resultState === "HARMONY_READY",
    trustedPercent: roleCoverage === null ? null : rounded(Math.max(0, Math.min(1, roleCoverage)) * 100, 3),
    trustedMeasures,
    availableMeasures,
    reviewRegions: reviewCount,
    basis,
    ...(explicit.roleQualityPresent ? {
      readiness: explicit.readiness ?? "UNAVAILABLE",
      coverage: explicit.coverage,
      eligibleMeasures: explicit.eligibleMeasures,
      reviewMeasures: explicit.reviewMeasures,
      brokenMeasures: explicit.brokenMeasures,
      preferredBackend: explicit.preferredBackend,
    } : {}),
  };
}

function roleGroupCandidate(group: UnknownRecord, index: number): UnknownRecord | null {
  const roleName = role(group.role);
  if (roleName === "unknown") return null;
  const measureIds = [...new Set(array(group.measureIds)
    .map((value) => safeId(value, ""))
    .filter(Boolean))].sort(compareMeasureIds);
  const firstMeasureIndex = integer(group.firstMeasureIndex);
  const lastMeasureIndex = integer(group.lastMeasureIndex);
  const measureId = measureIds[0] ?? `measure-${firstMeasureIndex ?? index + 1}`;
  const backendId = safeId(group.backendId, "backend");
  const backendVersion = safeLabel(group.backendVersion, "unknown");
  const fallbackId = `${backendId}:${backendVersion}:${roleName}:${measureIds.join("+") || measureId}`;
  const id = safeId(group.id, fallbackId);
  const pageSystems = array(group.pageSystems).map((value) => {
    const item = record(value);
    return { page: integer(item.page), system: integer(item.system) };
  });
  const firstPageSystem = pageSystems[0] ?? { page: null, system: null };
  const rootCauses = [...new Set(array(group.rootCauses).map((value) => safeReason(value)).filter(Boolean))].sort(compare);
  const reason = reasonCategory(rootCauses[0] ?? "structure");
  const memberCount = integer(group.memberCount);
  const estimatedEventCount = integer(group.estimatedEventCount);
  const confidence = record(group.confidence);
  const confidenceValue = finite(confidence.min) && finite(confidence.median) && finite(confidence.max)
    ? { min: confidence.min, median: confidence.median, max: confidence.max }
    : null;
  const evidence = [
    ...rootCauses,
    memberCount === null ? "independent role-review group" : `grouped ${memberCount} measure${memberCount === 1 ? "" : "s"}`,
    estimatedEventCount === null ? "" : `estimated ${estimatedEventCount} event${estimatedEventCount === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return {
    __roleGroup: true,
    __roleGroupMeasures: measureIds,
    id,
    measureId,
    measureIds,
    measureNumber: safeLabel(group.measureNumber, firstMeasureIndex === null ? measureId : String(firstMeasureIndex + 1)),
    page: firstPageSystem.page,
    system: firstPageSystem.system,
    pageSystems,
    role: roleName,
    reasonCategory: reason,
    state: "REVIEW",
    priorityClass: group.priorityClass,
    evidence,
    recommendedAction: `Review ${roleName} measures ${measureIds.join(", ") || measureId}${rootCauses.length ? ` for ${rootCauses.join(", ")}` : " for role quality issues"}.`,
    backendId,
    backendVersion,
    firstMeasureIndex,
    lastMeasureIndex,
    startBeat: number(group.startBeat),
    endBeat: number(group.endBeat),
    memberCount,
    estimatedEventCount,
    confidence: confidenceValue,
  };
}

function reviewRegions(raw: UnknownRecord): LocalReferenceReadinessReviewRegion[] {
  const queue = record(raw.reviewQueue);
  const candidates: UnknownRecord[] = array(queue.items).map(record).filter((item) => Object.keys(item).length > 0);
  const queuedMeasures = new Set(candidates.map((item) => safeId(item.measureId ?? item.id, "unknown-measure")));
  const consensus = record(raw.consensus);
  for (const item of array(consensus.reviewItems).map(record)) {
    if (Object.keys(item).length) candidates.push({
      ...item,
      measureId: item.measureId,
      measureNumber: item.number,
      reasonCategory: array(item.reasons)[0] ?? "unknown",
      evidence: item.reasons,
      state: "REVIEW",
    });
  }
  const quality = record(raw.quality);
  const qualityRows = array(quality.measures).map(record).filter((item) => queueState(item.state) === "REVIEW" || queueState(item.state) === "BROKEN");
  for (const row of qualityRows) {
    if (queuedMeasures.has(safeId(row.measureId ?? row.id, "unknown-measure"))) continue;
    const diagnostics = array(row.diagnostics).length ? array(row.diagnostics) : ["quality-state-review"];
    for (const diagnostic of diagnostics) candidates.push({
      ...row,
      id: `${text(row.measureId ?? row.id, "measure")}:${reasonCategory(diagnostic)}`,
      reasonCategory: diagnostic,
      evidence: [diagnostic],
      role: role(array(row.events).map(record).find((event) => role(event.role) !== "unknown")?.role),
    });
  }
  for (const region of array(raw.regions).map(record)) {
    if (region.review === true || text(region.state).toUpperCase() === "REVIEW_REQUIRED" || text(region.state).toUpperCase() === "FAILED") candidates.push({ ...region, reasonCategory: region.reason ?? "structure", evidence: region.evidence ?? region.diagnostics ?? [] });
  }
  const roleGroupCandidates = array(record(raw.review).roleGroups)
    .map(record)
    .map((group, index) => roleGroupCandidate(group, index))
    .filter((item): item is UnknownRecord => item !== null);
  candidates.push(...roleGroupCandidates);
  const coveredRoleMeasures = new Map<ReadinessRoleName, Set<string>>();
  for (const group of roleGroupCandidates) {
    const groupRole = role(group.role);
    if (groupRole === "unknown") continue;
    const measures = coveredRoleMeasures.get(groupRole) ?? new Set<string>();
    for (const measureId of array(group.__roleGroupMeasures)) {
      const normalized = safeId(measureId, "");
      if (normalized) measures.add(normalized);
    }
    coveredRoleMeasures.set(groupRole, measures);
  }
  const actionableCandidates = candidates.filter((candidate) => {
    if (candidate.__roleGroup === true) return true;
    const candidateRole = role(candidate.role);
    if (candidateRole === "unknown") return true;
    const measureId = safeId(candidate.measureId ?? candidate.id, "");
    return !(measureId && coveredRoleMeasures.get(candidateRole)?.has(measureId));
  });
  const grouped = new Map<string, LocalReferenceReadinessReviewRegion>();
  for (const candidate of actionableCandidates) {
    const measureId = safeId(candidate.measureId ?? candidate.id, "unknown-measure");
    const measureNumber = safeLabel(candidate.measureNumber ?? candidate.number, "unknown");
    const roleName = role(candidate.role);
    const reason = reasonCategory(candidate.reasonCategory ?? candidate.reason ?? array(candidate.evidence)[0]);
    const key = candidate.__roleGroup === true
      ? `group\u0000${safeId(candidate.id, `${measureId}:${roleName}:${reason}`)}`
      : `${measureId}\u0000${roleName}\u0000${reason}`;
    const evidence = [...new Set([
      ...array(candidate.evidence).map((value) => safeReason(value)),
      ...array(candidate.diagnostics).map((value) => safeReason(value)),
      ...array(candidate.reasons).map((value) => safeReason(value)),
    ].filter(Boolean))].sort(compare);
    const item: LocalReferenceReadinessReviewRegion = {
      id: safeId(candidate.id, `${measureId}:${roleName}:${reason}`),
      measureId,
      measureNumber,
      page: integer(candidate.page),
      system: integer(candidate.system),
      role: roleName,
      reasonCategory: reason,
      state: queueState(candidate.state),
      priority: priority(candidate.priorityClass ?? candidate.priority, roleName, reason),
      evidence,
      recommendedAction: safeReason(candidate.recommendedAction, "Human-review this unresolved region."),
      decision: "pending",
      ...(candidate.__roleGroup === true ? {
        measureIds: array(candidate.measureIds).map((value) => safeId(value, "")).filter(Boolean),
        pageSystems: array(candidate.pageSystems).map((value) => {
          const item = record(value);
          return { page: integer(item.page), system: integer(item.system) };
        }),
        backendId: safeId(candidate.backendId, "backend"),
        backendVersion: safeLabel(candidate.backendVersion, "unknown"),
        firstMeasureIndex: integer(candidate.firstMeasureIndex),
        lastMeasureIndex: integer(candidate.lastMeasureIndex),
        startBeat: number(candidate.startBeat),
        endBeat: number(candidate.endBeat),
        memberCount: integer(candidate.memberCount),
        estimatedEventCount: integer(candidate.estimatedEventCount),
        confidence: record(candidate.confidence).min !== undefined && finite(record(candidate.confidence).min) && finite(record(candidate.confidence).median) && finite(record(candidate.confidence).max)
          ? { min: record(candidate.confidence).min as number, median: record(candidate.confidence).median as number, max: record(candidate.confidence).max as number }
          : null,
      } : {}),
    };
    const prior = grouped.get(key);
    if (!prior) grouped.set(key, item);
    else {
      prior.evidence = [...new Set([...prior.evidence, ...item.evidence])].sort(compare);
      if (prior.state !== "BROKEN" && item.state === "BROKEN") prior.state = "BROKEN";
      if (prior.page === null) prior.page = item.page;
      if (prior.system === null) prior.system = item.system;
    }
  }
  const priorityRank: Record<LocalReferenceReadinessReviewRegion["priority"], number> = { high: 0, medium: 1, low: 2 };
  return [...grouped.values()].sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER) || compare(`${left.measureId}\u0000${left.role}\u0000${left.reasonCategory}`, `${right.measureId}\u0000${right.role}\u0000${right.reasonCategory}`));
}

function normalizeDecisions(scoreId: string, raw: UnknownRecord, supplied: readonly unknown[]): LocalReferenceReadinessHumanDecision[] {
  const values = [
    ...supplied,
    ...array(raw.humanDecisions),
    ...array(record(raw.review).decisions),
  ];
  const result: LocalReferenceReadinessHumanDecision[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = record(value);
    const outcome = decisionOutcome(item.outcome ?? item.decision ?? item.verdict ?? item.action);
    const itemId = safeId(item.itemId ?? item.reviewId ?? item.id, "unknown-item");
    if (!outcome || itemId === "unknown-item") continue;
    const targetScore = safeId(item.scoreId ?? scoreId, scoreId);
    if (targetScore !== scoreId) continue;
    const key = `${targetScore}\u0000${itemId}\u0000${outcome}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: safeId(item.id, `${scoreId}:${itemId}:${outcome}`), scoreId, itemId, outcome, note: safeReason(item.note ?? item.notes) || null });
  }
  return result.sort((left, right) => compare(`${left.itemId}\u0000${left.outcome}`, `${right.itemId}\u0000${right.outcome}`));
}

function listeningFor(scoreId: string, raw: UnknownRecord, input: LocalReferenceReadinessInput): LocalReferenceReadinessListening {
  const direct = record(raw.listeningReport).status ? record(raw.listeningReport) : record(raw.listening);
  const supplied = listeningEntry(scoreId, input.listening) ?? listeningEntry(scoreId, input.listeningBundles);
  const value = Object.keys(direct).length ? direct : supplied;
  const outputs = record(value.outputs);
  const scoreOutputs = record(raw.outputs);
  const artifact = (key: string, aliases: readonly string[] = []): string | null => {
    for (const candidate of [key, ...aliases]) {
      const result = safeRef(outputs[candidate] ?? value[candidate] ?? scoreOutputs[candidate]);
      if (result) return result;
    }
    return null;
  };
  const artifacts = {
    referenceMidi: artifact("referenceMidi"), referenceMusicXml: artifact("referenceMusicXml"), melodyMidi: artifact("melodyMidi"), accompanimentMidi: artifact("accompanimentMidi"),
    fullWav: artifact("fullWav"), melodyWav: artifact("melodyWav"), accompanimentWav: artifact("accompanimentWav"), openingExcerptWav: artifact("openingExcerptWav"),
    manifest: artifact("manifest"), reviewQueue: artifact("reviewQueue"), markdown: artifact("markdown"), html: artifact("html"), coverageMask: artifact("coverageMask"),
  };
  const renderers = record(value.renderer);
  const soundfont = record(renderers.soundfont);
  const hasAudio = Boolean(artifacts.fullWav || artifacts.melodyWav || artifacts.accompanimentWav || artifacts.openingExcerptWav);
  const statusValue = text(value.status).toUpperCase();
  const status: LocalReferenceReadinessListening["status"] = statusValue === "RENDERED" || statusValue === "PARTIAL" || statusValue === "UNAVAILABLE"
    ? statusValue
    : Object.keys(value).length ? hasAudio ? "RENDERED" : "UNAVAILABLE" : "NOT_REQUESTED";
  const renderer = Object.keys(renderers).length ? {
    id: safeLabel(renderers.id, "unknown"), version: safeLabel(renderers.version, "unknown"), sampleRate: number(renderers.sampleRate), channels: integer(renderers.channels), gain: number(renderers.gain), targetPeak: number(renderers.targetPeak),
    soundfont: Object.keys(soundfont).length ? { identifier: safeLabel(soundfont.identifier, "unknown"), sha256: safeHash(soundfont.sha256), bytes: integer(soundfont.bytes) } : null,
  } : null;
  void scoreId;
  return { status, available: hasAudio, artifacts, renderer };
}

function listeningEntry(scoreId: string, input: readonly unknown[] | Record<string, unknown> | undefined): UnknownRecord {
  if (Array.isArray(input)) return input.map(record).find((row) => safeId(row.scoreId ?? row.id, "") === scoreId) ?? {};
  const row = input ? record((input as Record<string, unknown>)[scoreId]) : {};
  return Object.keys(row).length ? row : {};
}

function outputRefs(raw: UnknownRecord): LocalReferenceReadinessScore["outputs"] {
  const outputs = record(raw.outputs);
  return {
    referenceMidi: safeRef(outputs.referenceMidi), referenceMusicXml: safeRef(outputs.referenceMusicXml), coverageMask: safeRef(outputs.coverageMask), manifest: safeRef(outputs.manifest), reviewQueue: safeRef(outputs.reviewQueue),
  };
}

function scoreRows(input: LocalReferenceReadinessInput | unknown): UnknownRecord[] {
  const source = record(input);
  const scores = array(source.scores).map(record).filter((row) => Object.keys(row).length > 0);
  if (scores.length) return scores;
  const single = record(source.score);
  if (Object.keys(single).length) return [single];
  if (text(source.kind) === "local-score-reference" && array(source.scores).length) return scores;
  return [];
}

function scoreReadiness(raw: UnknownRecord, input: LocalReferenceReadinessInput, suppliedDecisions: readonly unknown[]): LocalReferenceReadinessScore {
  const id = safeId(raw.id ?? raw.scoreId, "score");
  const title = safeLabel(raw.title, id);
  const artist = safeLabel(raw.artist, "Unknown artist");
  const source = sourcePdf(raw);
  const native = nativeMatch(raw);
  const data = qualityData(raw);
  const review = reviewRegions(raw);
  const reported = reportedReviewCounts(raw);
  const decisions = normalizeDecisions(id, raw, suppliedDecisions);
  const decisionByItem = new Map(decisions.map((decision) => [decision.itemId, decision]));
  for (const region of review) {
    const decision = decisionByItem.get(region.id) ?? decisionByItem.get(`${id}:${region.measureId}:${region.role}:${region.reasonCategory}`);
    if (decision) region.decision = decision.outcome;
  }
  const reviewSummary: LocalReferenceReadinessReview = {
    regions: review,
    totalRegions: Math.max(review.length, reported.total),
    melodyCriticalRegions: Math.max(review.filter((item) => item.role === "melody").length, reported.melody),
    harmonyCriticalRegions: Math.max(review.filter((item) => item.role === "harmony").length, reported.harmony),
    rhythmCriticalRegions: Math.max(review.filter((item) => item.role === "rhythm").length, reported.rhythm),
    reportedOnly: reported.total > review.length,
    actualHumanDecisions: decisions.length,
    pendingRegions: review.filter((item) => item.decision === "pending").length + Math.max(0, reported.total - review.length),
    decisions,
  };
  const readiness = {
    melody: roleReadiness(raw, "melody", review, data, native),
    harmony: roleReadiness(raw, "harmony", review, data, native),
    rhythm: roleReadiness(raw, "rhythm", review, data, native),
  };
  const reportedState = state(raw.maturity ?? raw.state, "RAW_OMR");
  const failed = reportedState === "FAILED" || (!native.eligible && !data.rows.length && !Object.keys(record(raw.consensus)).length && !Object.keys(record(raw.quality)).length && !Object.keys(record(raw.omr)).length);
  const overallState: LocalReferenceMaturityState = failed
    ? "FAILED"
    : reportedState === "FULL_REFERENCE_READY" || reportedState === "HARMONY_READY"
      ? reportedState
      : reportedState === "MELODY_READY" && readiness.melody.state === "MELODY_READY"
        ? "MELODY_READY"
    : readiness.melody.state === "MELODY_READY" && readiness.harmony.state === "HARMONY_READY" && reviewSummary.pendingRegions === 0 ? "FULL_REFERENCE_READY"
      : readiness.melody.state === "MELODY_READY" ? "MELODY_READY"
        : reviewSummary.totalRegions ? "MANUAL_REVIEW_REQUIRED"
          : data.rows.length || Object.keys(record(raw.consensus)).length || Object.keys(record(raw.omr)).length ? "VALIDATED_DRAFT" : "RAW_OMR";
  const benchmark: LocalReferenceReadinessBenchmark = {
    melodyEligible: readiness.melody.state === "MELODY_READY",
    harmonyEligible: readiness.harmony.state === "HARMONY_READY",
    melodyState: readiness.melody.state,
    harmonyState: readiness.harmony.state,
    gate: readiness.melody.state === "MELODY_READY" ? reviewSummary.melodyCriticalRegions ? "provisional" : "eligible" : "not-eligible",
    failures: [
      ...(readiness.melody.state !== "MELODY_READY" ? ["melody is not ready"] : []),
      ...(readiness.harmony.state !== "HARMONY_READY" ? ["harmony is not ready"] : []),
      ...(reviewSummary.pendingRegions ? [`${reviewSummary.pendingRegions} review regions remain pending`] : []),
    ].sort(compare),
  };
  const explicitNonClaims = array(raw.nonClaims).map((value) => safeReason(value)).filter(Boolean);
  return {
    id, artist, title, source, nativeMatch: native, omr: omrSummary(raw),
    readiness: { state: overallState, ...readiness },
    review: reviewSummary,
    benchmark,
    listening: listeningFor(id, raw, input),
    outputs: outputRefs(raw),
    nonClaims: [...new Set([...explicitNonClaims, "This deterministic report does not establish copyright permission, musical correctness, recognizability, or playability."])].sort(compare),
  };
}

function benchmarkGate(scores: readonly LocalReferenceReadinessScore[]): LocalReferenceReadinessReport["benchmarkGate"] {
  const melodyReadyScores = scores.filter((score) => score.benchmark.melodyEligible).length;
  const harmonyReadyScores = scores.filter((score) => score.benchmark.harmonyEligible).length;
  const failures = scores.flatMap((score) => score.benchmark.failures.map((failure) => `${score.id}: ${failure}`)).sort(compare);
  if (melodyReadyScores >= 4) return { status: "MULTI_SONG_READY", decision: "build-multi-song-benchmark", melodyReadyScores, harmonyReadyScores, thresholds: { multiSongMelodyReady: 4, provisionalMelodyReady: 2 }, failures };
  if (melodyReadyScores >= 2) return { status: "PROVISIONAL", decision: "build-provisional-benchmark", melodyReadyScores, harmonyReadyScores, thresholds: { multiSongMelodyReady: 4, provisionalMelodyReady: 2 }, failures };
  return { status: scores.length ? "NOT_READY" : "FAILED", decision: scores.length ? "finish-human-review-queue" : "no-usable-references", melodyReadyScores, harmonyReadyScores, thresholds: { multiSongMelodyReady: 4, provisionalMelodyReady: 2 }, failures };
}

/** Build a deterministic per-score readiness report from existing local reports. */
export function buildLocalReferenceReadiness(input: LocalReferenceReadinessInput | unknown = {}): LocalReferenceReadinessReport {
  const normalized = record(input) as LocalReferenceReadinessInput;
  const suppliedDecisions = array(normalized.humanDecisions);
  const scores = scoreRows(input).map((raw) => scoreReadiness(raw, normalized, suppliedDecisions)).sort((left, right) => compare(left.id, right.id));
  const preferredBackendCounts: Record<string, number> = {};
  for (const score of scores) {
    const preferred = score.omr.preferredBackend;
    if (preferred) preferredBackendCounts[preferred.id] = (preferredBackendCounts[preferred.id] ?? 0) + 1;
  }
  for (const key of Object.keys(preferredBackendCounts).sort(compare)) void preferredBackendCounts[key];
  const report: LocalReferenceReadinessReport = {
    schemaVersion: LOCAL_REFERENCE_READINESS_SCHEMA_VERSION,
    kind: "local-reference-readiness",
    scores,
    summary: {
      totalScores: scores.length,
      sourcePdfAvailable: scores.filter((score) => score.source.pdf !== null).length,
      nativeCandidates: scores.filter((score) => score.nativeMatch.status !== "not-found").length,
      nativeSymbolicMatches: scores.filter((score) => score.nativeMatch.eligible).length,
      preferredBackendCounts: Object.fromEntries(Object.entries(preferredBackendCounts).sort(([left], [right]) => compare(left, right))),
      melodyReadyAutomatically: scores.filter((score) => score.benchmark.melodyEligible).length,
      harmonyReadyAutomatically: scores.filter((score) => score.benchmark.harmonyEligible).length,
      fullReferenceReady: scores.filter((score) => score.readiness.state === "FULL_REFERENCE_READY").length,
      manualReviewScores: scores.filter((score) => score.readiness.state === "MANUAL_REVIEW_REQUIRED").length,
      failedScores: scores.filter((score) => score.readiness.state === "FAILED").length,
      reviewRegions: scores.reduce((sum, score) => sum + score.review.totalRegions, 0),
    },
    humanWorkload: {
      melodyCriticalReviewRegions: scores.reduce((sum, score) => sum + score.review.melodyCriticalRegions, 0),
      harmonyCriticalReviewRegions: scores.reduce((sum, score) => sum + score.review.harmonyCriticalRegions, 0),
      rhythmCriticalReviewRegions: scores.reduce((sum, score) => sum + score.review.rhythmCriticalRegions, 0),
      totalReviewRegions: scores.reduce((sum, score) => sum + score.review.totalRegions, 0),
      actualHumanDecisions: scores.reduce((sum, score) => sum + score.review.actualHumanDecisions, 0),
      pendingRegions: scores.reduce((sum, score) => sum + score.review.pendingRegions, 0),
    },
    benchmarkGate: benchmarkGate(scores),
    nonClaims: [
      "This report is local-only and does not modify the catalog or production runtime.",
      "OMR validity, native identity, rendered audio, and human musical acceptance are separate evidence gates.",
      "Actual human decisions are zero unless explicit decisions are supplied.",
    ],
  };
  return JSON.parse(JSON.stringify(stable(report))) as LocalReferenceReadinessReport;
}

/** Stable, path-safe JSON representation; runtime timestamps are never added. */
export function localReferenceReadinessJson(report: LocalReferenceReadinessReport): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

/** Compact final-report view intended for a local Markdown hand-off. */
export function localReferenceReadinessMarkdown(report: LocalReferenceReadinessReport): string {
  const lines = [
    "# Local reference readiness",
    "",
    "Local-only evidence aggregation. Native identity, OMR validity, listening artifacts, and human musical acceptance remain separate gates.",
    "",
    "## Per-score readiness",
    "",
    "| Score | Native match | Preferred backend | Melody | Harmony | Review regions | Human decisions | Listening | Role backends |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
  ];
  for (const score of report.scores) {
    const preferred = score.omr.preferredBackend ? `${score.omr.preferredBackend.id} ${score.omr.preferredBackend.version}` : "none";
    const roleBackends = ROLES.map((roleName) => {
      const backend = score.readiness[roleName].preferredBackend;
      return `${roleName}: ${backend ? `${backend.id} ${backend.version}` : "none"}`;
    }).join("; ");
    lines.push(`| ${score.artist} — ${score.title} | ${score.nativeMatch.status} | ${preferred} | ${score.readiness.melody.state} | ${score.readiness.harmony.state} | ${score.review.totalRegions} | ${score.review.actualHumanDecisions} | ${score.listening.status} | ${roleBackends} |`);
  }
  lines.push(
    "",
    "## Human workload",
    "",
    `- Melody-critical review regions: ${report.humanWorkload.melodyCriticalReviewRegions}`,
    `- Harmony-critical review regions: ${report.humanWorkload.harmonyCriticalReviewRegions}`,
    `- Rhythm-critical review regions: ${report.humanWorkload.rhythmCriticalReviewRegions}`,
    `- Total localized review regions: ${report.humanWorkload.totalReviewRegions}`,
    `- Actual human decisions: ${report.humanWorkload.actualHumanDecisions}`,
    `- Pending regions: ${report.humanWorkload.pendingRegions}`,
    report.humanWorkload.actualHumanDecisions === 0 ? "No actual human decisions supplied." : "",
    "",
    "## Benchmark gate",
    "",
    `- Status: **${report.benchmarkGate.status}**`,
    `- Melody-ready scores: ${report.benchmarkGate.melodyReadyScores}`,
    `- Harmony-ready scores: ${report.benchmarkGate.harmonyReadyScores}`,
    `- Decision: ${report.benchmarkGate.decision}`,
    "",
    ...report.nonClaims.map((claim) => `- ${claim}`),
    "",
  );
  return lines.join("\n");
}

export const canonicalLocalReferenceReadinessJson = localReferenceReadinessJson;
