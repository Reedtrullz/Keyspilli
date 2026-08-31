/**
 * Local-only orchestration for the small score-reference corpus.
 *
 * This module is deliberately not exported from the catalog barrel.  It is a
 * research/evaluation boundary: callers provide an explicit manifest and
 * local paths, while the normal catalog/runtime remains unaware of PDFs,
 * OMR backends, or reference files.  Missing optional inputs become report
 * states instead of causing a corpus run to abort.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import {
  buildLocalReference,
  type LocalReferenceBuildReport,
  type LocalReferenceOmrBackendInput,
  type LocalReferenceScoreReport,
} from "./local-reference-builder.js";
import { keyName, writeMidi, writeMusicXml, type Note, type Variant } from "@keyspilli/midi";
import {
  discoverNativeScoreArtifacts,
  type NativeScoreArtifactInput,
  type NativeScoreDiscoveryReport,
  type NativeScoreOmrInput,
} from "./native-score-discovery.js";
import { inspectScoreSourceForensics, type ScoreSourceForensicsReport } from "./score-source-forensics.js";
import { parseOmrMusicXmlBytes } from "./omr-musicxml.js";
import { normalizeOmrScore, type OmrScoreInput } from "./omr-consensus.js";
import {
  evaluateOmrRoleQuality,
  type OmrRoleQualityBackendSummary,
  type OmrRoleQualityReviewGroup,
  type OmrRoleReadinessSummary,
  type OmrRoleQualityReport,
} from "./omr-role-quality.js";
import type { OmrQualityReport } from "./omr-quality.js";
import { sha256Hex } from "./fixture-evidence.js";

export const LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION = 1 as const;

export const LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS = Object.freeze([
  "This local corpus does not establish copyright permission or redistribute source scores.",
  "A parseable native or OMR score is not, by itself, a claim of musical correctness.",
  "Human review and listening remain separate acceptance gates.",
  "No corpus input is imported into the Keyspilli catalog or production runtime.",
] as const);

export type LocalScoreReferenceMaturity =
  | "RAW_OMR"
  | "VALIDATED_DRAFT"
  | "MELODY_READY"
  | "HARMONY_READY"
  | "FULL_REFERENCE_READY"
  | "MANUAL_REVIEW_REQUIRED"
  | "FAILED";

export type LocalScoreReferenceCorpusStatus = "READY" | "PARTIAL" | "REVIEW_REQUIRED" | "FAILED";
export type LocalScoreReferenceAvailability = "available" | "missing" | "unavailable" | "invalid" | "not-provided";
export type LocalScoreReferenceRole = "melody" | "harmony" | "rhythm";
export type LocalScoreReferenceRoleState = "READY" | "REVIEW_REQUIRED" | "UNAVAILABLE";

/** A backend row may be inline for tests or point at an explicitly local file. */
export interface ScoreReferenceCorpusOmrInput {
  id: string;
  version?: string | null;
  path?: string | null;
  status?: "available" | "unavailable" | "failed" | string;
  score?: OmrScoreInput | null;
  error?: string | null;
  sourceLabel?: string | null;
}

export interface ScoreReferenceCorpusScoreInput {
  id: string;
  artist: string;
  title: string;
  /** Aliases make external manifest conversion explicit without changing the legacy builder. */
  pdfPath?: string | null;
  pdf?: string | null;
  sourcePdf?: string | null;
  nativeArtifacts?: readonly NativeScoreArtifactInput[];
  native?: readonly NativeScoreArtifactInput[];
  omr?: readonly ScoreReferenceCorpusOmrInput[];
}

export interface ScoreReferenceCorpusInput {
  schemaVersion?: number;
  scores: readonly ScoreReferenceCorpusScoreInput[];
}

export interface ScoreReferenceCorpusOptions {
  /** Absolute output directory. It must be outside the repository. */
  outputRoot: string;
  /** Repository boundary used to reject source/output paths. Defaults to cwd. */
  repositoryRoot?: string;
}

export interface ScoreReferencePdfReport {
  status: LocalScoreReferenceAvailability;
  bytes: number | null;
  pages: number | null;
  sha256: string | null;
  errors: string[];
}

export interface ScoreReferenceRoleReadiness {
  state: LocalScoreReferenceRoleState;
  source: "omr" | "native" | "none";
  coverage: number | null;
  eligibleMeasures: number;
  trustedMeasures: number;
  eligibleEvents: number;
  trustedEvents: number;
  reviewMeasures: number;
  reason: string | null;
}

export interface ScoreReferenceNativeSummary {
  status: NativeScoreDiscoveryReport["status"] | "not-requested";
  selected: boolean;
  candidateCount: number;
  rejectedCount: number;
  errors: string[];
  selectionReason: string | null;
}

export interface ScoreReferenceOmrBackendSummary {
  id: string;
  version: string;
  status: "available" | "unavailable" | "failed";
  source: "inline" | "local-file" | "missing" | "invalid";
  hasScore: boolean;
  error: string | null;
}

export interface ScoreReferenceOmrSummary {
  status: "available" | "partial" | "unavailable" | "failed" | "not-requested";
  preferredBackend: string | null;
  /** Independent role-local choices; this is intentionally not one global winner. */
  preferredBackendByRole: Record<LocalScoreReferenceRole, { id: string; version: string } | null>;
  /** Additive role-local diagnostics over every supplied OMR backend. */
  roleQuality: ScoreReferenceOmrRoleQuality | null;
  backends: ScoreReferenceOmrBackendSummary[];
  qualityMeasures: number;
  reviewMeasures: number;
  brokenMeasures: number;
  fallbackUsed: boolean;
}

export interface ScoreReferenceOmrRoleQuality {
  schemaVersion: OmrRoleQualityReport["schemaVersion"];
  consensusClaim: false;
  selectionPolicy: OmrRoleQualityReport["selectionPolicy"];
  thresholds: OmrRoleQualityReport["thresholds"];
  backendSummaries: OmrRoleQualityBackendSummary[];
  /**
   * Compact per-backend/per-role category diagnostics.  This intentionally
   * projects event-free measure rows rather than copying the normalized event
   * payload, so corpus reports remain useful for auditing without becoming a
   * second symbolic artifact.
   */
  backendDiagnostics: ScoreReferenceOmrBackendDiagnostic[];
  roleReadiness: Record<LocalScoreReferenceRole, OmrRoleReadinessSummary>;
  reviewGroups: OmrRoleQualityReviewGroup[];
}

export interface ScoreReferenceOmrCategoryDiagnostic {
  score: number | null;
  available: boolean;
  basis: string | null;
  flags: string[];
  measureCount: number;
  availableMeasures: number;
}

export interface ScoreReferenceOmrBackendDiagnostic {
  backendId: string;
  backendVersion: string;
  role: "melody" | "harmony" | "rhythm";
  measureCount: number;
  availableMeasures: number;
  coverage: number | null;
  categories: {
    /** Measure arithmetic and event-bound checks. */
    rhythmicValidity: ScoreReferenceOmrCategoryDiagnostic;
    /** Same-role pitch interval plausibility. */
    pitchPlausibility: ScoreReferenceOmrCategoryDiagnostic;
    /** Overlap, duplicate, and tie continuity checks. */
    continuity: ScoreReferenceOmrCategoryDiagnostic;
    /** Normalized measure invariants. */
    structuralValidity: ScoreReferenceOmrCategoryDiagnostic;
    /** Density anomaly versus the role baseline. */
    densityAnomaly: ScoreReferenceOmrCategoryDiagnostic;
    /** Staff/voice/accidental presence used as notation consistency evidence. */
    notationCompleteness: ScoreReferenceOmrCategoryDiagnostic;
    /** Key metadata is not carried by the role-quality row projection. */
    keyConsistency: ScoreReferenceOmrCategoryDiagnostic;
    /** Time-signature metadata is not carried by the role-quality row projection. */
    timeConsistency: ScoreReferenceOmrCategoryDiagnostic;
  };
}

export interface ScoreReferenceCorpusOutputs {
  manifest: string | null;
  reviewQueue: string | null;
  referenceMusicXml: string | null;
  referenceMidi: string | null;
  coverageMask: string | null;
  /** Role-isolated artifacts are emitted only for independently READY OMR roles. */
  roleReferences: Record<LocalScoreReferenceRole, ScoreReferenceRoleOutputs | null>;
}

export interface ScoreReferenceRoleOutputs {
  referenceMusicXml: string;
  referenceMidi: string;
  coverageMask: string;
  manifest: string;
}

export interface ScoreReferenceCorpusScoreReport {
  id: string;
  artist: string;
  title: string;
  maturity: LocalScoreReferenceMaturity;
  source: {
    pdf: ScoreReferencePdfReport;
    /** Path-free metadata/evidence from the PDF forensics pass. */
    forensics: Pick<ScoreSourceForensicsReport, "metadata" | "xmp" | "links" | "evidence"> | null;
  };
  native: ScoreReferenceNativeSummary;
  omr: ScoreReferenceOmrSummary;
  roles: Record<LocalScoreReferenceRole, ScoreReferenceRoleReadiness>;
  /** Legacy selected-global role rows retained for compatibility/debugging. */
  selectedRoles?: Record<LocalScoreReferenceRole, ScoreReferenceRoleReadiness>;
  selected: LocalReferenceScoreReport["selected"];
  quality: {
    measures: number;
    reviewMeasures: number;
    brokenMeasures: number;
    selectedBackend: string | null;
  };
  outputs: ScoreReferenceCorpusOutputs;
  review: {
    /** Existing per-measure queue item count before independent role grouping. */
    baseItems: number;
    /** Preferred-backend role groups that replace covered base items. */
    roleGroupItems: number;
    /** Deduplicated actionable review-unit count. */
    actionableItems: number;
    totalItems: number;
    melodyCritical: number;
    harmonyCritical: number;
    rhythmCritical: number;
    unknown: number;
    roleGroups: OmrRoleQualityReviewGroup[];
  };
  errors: string[];
  nonClaims: string[];
}

export interface ScoreReferenceCorpusSummary {
  scoreCount: number;
  sourcePdfAvailable: number;
  sourcePdfMissing: number;
  nativeMatches: number;
  melodyReady: number;
  harmonyReady: number;
  fullReferenceReady: number;
  reviewRequired: number;
  failed: number;
  unresolvedReviewItems: number;
  melodyCriticalReviewItems: number;
  harmonyCriticalReviewItems: number;
  rhythmCriticalReviewItems: number;
}

export interface ScoreReferenceHumanWorkload {
  totalDecisions: number;
  scoresRequiringReview: number;
  melodyCritical: number;
  harmonyCritical: number;
  rhythmCritical: number;
  unknown: number;
  byScore: Array<{
    id: string;
    totalDecisions: number;
    melodyCritical: number;
    harmonyCritical: number;
    rhythmCritical: number;
    unknown: number;
  }>;
}

export interface ScoreReferenceCorpusReport {
  schemaVersion: typeof LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION;
  kind: "local-score-reference-corpus";
  status: LocalScoreReferenceCorpusStatus;
  scores: ScoreReferenceCorpusScoreReport[];
  summary: ScoreReferenceCorpusSummary;
  humanWorkload: ScoreReferenceHumanWorkload;
  artifacts: {
    report: string;
    workload: string;
    manifest: string;
  };
  nonClaims: string[];
}

interface PreparedOmr {
  input: ScoreReferenceCorpusOmrInput;
  backend: LocalReferenceOmrBackendInput;
  summary: ScoreReferenceOmrBackendSummary;
  sourcePath: string | null;
}

interface PreparedScore {
  input: ScoreReferenceCorpusScoreInput;
  pdfPath: string | null;
  nativeArtifacts: NativeScoreArtifactInput[];
  omr: PreparedOmr[];
  forensics: ScoreSourceForensicsReport | null;
  discovery: NativeScoreDiscoveryReport | null;
}

const OPTIONAL_NOTATION_DIAGNOSTICS = new Set(["missing-staff", "missing-voice", "missing-accidental"]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => [key, stable(item)]));
}

function safeText(value: unknown, fallback = "unknown", max = 240): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text || fallback;
}

function safeId(value: unknown, fallback: string): string {
  const text = safeText(value, fallback).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return /[A-Za-z0-9]/.test(text) ? text : fallback;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pathInside(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent).replace(/[\\/]$/, "");
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${sep}`);
}

async function existingRealpath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const parent = dirname(value);
    if (parent === value) return resolve(value);
    return join(await existingRealpath(parent), basename(value));
  }
}

function assertSafePath(value: string, label: string): void {
  if (!isAbsolute(value) || /[\u0000\r\n]/.test(value)) throw new Error(`${label} must be an absolute path without NUL/newline characters`);
}

async function assertSourcePath(value: string, label: string, repositoryRoot: string, outputRoot: string): Promise<string> {
  assertSafePath(value, label);
  const repository = await existingRealpath(resolve(repositoryRoot));
  const canonical = await existingRealpath(resolve(value));
  if (pathInside(canonical, repository)) throw new Error(`${label} must be outside the repository`);
  if (pathInside(canonical, outputRoot) || pathInside(resolve(value), outputRoot)) throw new Error(`${label} must not be inside the output root`);
  return resolve(value);
}

async function assertOutputRoot(value: string, repositoryRoot: string): Promise<string> {
  assertSafePath(value, "outputRoot");
  const outputRoot = resolve(value);
  const repository = await existingRealpath(resolve(repositoryRoot));
  const existing = await existingRealpath(outputRoot);
  if (pathInside(existing, repository)) throw new Error("outputRoot must be outside the repository");
  try {
    const info = await lstat(outputRoot);
    if (info.isSymbolicLink()) throw new Error("outputRoot must not be a symbolic link");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "ENOENT") throw error;
  }
  await mkdir(outputRoot, { recursive: true });
  const info = await stat(outputRoot);
  if (!info.isDirectory()) throw new Error("outputRoot must be a directory");
  return await realpath(outputRoot);
}

function publicError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return safeText(message.replace(/(?:file:\/\/|[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/)[^\s'"`)]*/gi, "[redacted-path]"), fallback, 500);
}

function publicValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/(?:^|[\s=(])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/]|\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/)/i.test(value)) return "[redacted-path]";
    return value;
  }
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(?:pdfPath|sourcePath|localPath|absolutePath|filePath|path)$/i.test(key))
      .map(([key, item]) => [key, publicValue(item)]));
  }
  return value;
}

function selectedPdfPath(input: ScoreReferenceCorpusScoreInput): string | null {
  for (const candidate of [input.pdfPath, input.pdf, input.sourcePdf]) if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return null;
}

function mapBackendStatus(value: unknown, hasScore: boolean): "available" | "unavailable" | "failed" {
  if (value === "available" || value === "unavailable" || value === "failed") return value;
  return hasScore ? "available" : "unavailable";
}

async function loadOmrScore(path: string): Promise<OmrScoreInput> {
  const bytes = new Uint8Array(await readFile(path));
  const extension = extname(path).toLowerCase();
  if ([".json", ".omr", ".score"].includes(extension)) {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OMR JSON score is malformed");
    const wrapped = (parsed as Record<string, unknown>).score;
    return (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : parsed) as OmrScoreInput;
  }
  const parsed = parseOmrMusicXmlBytes(bytes);
  return parsed.score;
}

async function prepareOmr(input: ScoreReferenceCorpusOmrInput, index: number, repositoryRoot: string, outputRoot: string): Promise<PreparedOmr> {
  const id = safeId(input.id, `omr-${index + 1}`);
  const version = safeText(input.version, "unknown", 120);
  const physical = typeof input.path === "string" && input.path.trim()
    ? await assertSourcePath(input.path.trim(), `OMR backend ${id} path`, repositoryRoot, outputRoot)
    : null;
  let score = input.score ?? null;
  let source: ScoreReferenceOmrBackendSummary["source"] = score ? "inline" : physical ? "local-file" : "missing";
  let status = mapBackendStatus(input.status, Boolean(score));
  let error: string | null = typeof input.error === "string" ? publicError(input.error, "OMR backend error") : null;
  if (!score && physical) {
    try {
      score = await loadOmrScore(physical);
      status = mapBackendStatus(input.status, true);
    } catch (caught) {
      status = "failed";
      source = "invalid";
      error = publicError(caught, "OMR score could not be parsed");
    }
  }
  if (!score && !error) error = status === "unavailable" ? "OMR backend unavailable" : "OMR backend did not provide a score";
  const backend: LocalReferenceOmrBackendInput = {
    id,
    version,
    status,
    score,
    ...(error ? { error } : {}),
    ...(input.sourceLabel ? { sourceLabel: safeText(input.sourceLabel, id) } : {}),
  };
  return {
    input: { ...input, id, version, status, score, ...(error ? { error } : {}) },
    backend,
    sourcePath: physical,
    summary: { id, version, status, source, hasScore: Boolean(score), error },
  };
}

function nativeInputs(input: ScoreReferenceCorpusScoreInput): NativeScoreArtifactInput[] {
  const values = Array.isArray(input.nativeArtifacts) ? input.nativeArtifacts : Array.isArray(input.native) ? input.native : [];
  return [...values]
    .filter((item): item is NativeScoreArtifactInput => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({ ...item }));
}

async function prepareScore(input: ScoreReferenceCorpusScoreInput, repositoryRoot: string, outputRoot: string): Promise<PreparedScore> {
  const id = safeId(input.id, "score-1");
  const normalized: ScoreReferenceCorpusScoreInput = {
    ...input,
    id,
    artist: safeText(input.artist, "Unknown artist"),
    title: safeText(input.title, id),
  };
  const rawPdf = selectedPdfPath(normalized);
  const pdfPath = rawPdf ? await assertSourcePath(rawPdf, `PDF for ${id}`, repositoryRoot, outputRoot) : null;
  const artifacts = nativeInputs(normalized);
  for (const [index, artifact] of artifacts.entries()) {
    if (typeof artifact.path === "string" && artifact.path.trim()) {
      artifacts[index] = { ...artifact, path: await assertSourcePath(artifact.path.trim(), `native artifact ${safeId(artifact.id, `native-${index + 1}`)} path`, repositoryRoot, outputRoot) };
    }
  }
  const omr: PreparedOmr[] = [];
  const backends = Array.isArray(normalized.omr) ? normalized.omr : [];
  for (const [index, backend] of backends.entries()) {
    if (!backend || typeof backend !== "object" || Array.isArray(backend)) continue;
    omr.push(await prepareOmr(backend, index, repositoryRoot, outputRoot));
  }
  const forensics = pdfPath ? await inspectScoreSourceForensics(pdfPath, { repositoryRoot }) : null;
  const discovery = artifacts.length || omr.length || pdfPath
    ? await discoverNativeScoreArtifacts({
      pdfPath,
      nativeArtifacts: artifacts,
      omr: omr.map((entry): NativeScoreOmrInput => ({ id: entry.backend.id, backend: entry.backend.id, version: entry.backend.version, status: entry.backend.status })),
    }, { allowNetwork: false })
    : null;
  return { input: normalized, pdfPath, nativeArtifacts: artifacts, omr, forensics, discovery };
}

function pdfReport(forensics: ScoreSourceForensicsReport | null, requested: boolean): ScoreReferencePdfReport {
  if (!requested) return { status: "not-provided", bytes: null, pages: null, sha256: null, errors: [] };
  if (!forensics) return { status: "unavailable", bytes: null, pages: null, sha256: null, errors: ["PDF forensics unavailable"] };
  const firstError = forensics.errors[0]?.code;
  const status: LocalScoreReferenceAvailability = forensics.status === "ok" ? "available"
    : firstError === "missing-file" ? "missing"
      : firstError === "repository-path" || firstError === "unsafe-path" ? "invalid" : "unavailable";
  return {
    status,
    bytes: forensics.identity?.bytes ?? null,
    pages: forensics.identity?.pages ?? null,
    sha256: forensics.identity?.sha256 ?? null,
    errors: forensics.errors.map((item) => safeText(item.code === "missing-file" ? "PDF file is missing" : item.message, "PDF forensics error", 500)),
  };
}

function roleReadiness(score: LocalReferenceScoreReport, role: LocalScoreReferenceRole, source: "omr" | "native" | "none"): ScoreReferenceRoleReadiness {
  if (source !== "omr" || !score.qualitySelection) {
    return { state: "UNAVAILABLE", source, coverage: null, eligibleMeasures: 0, trustedMeasures: 0, eligibleEvents: 0, trustedEvents: 0, reviewMeasures: 0, reason: source === "native" ? "native role mapping is not available in the local builder" : "no selected OMR role evidence" };
  }
  const rows = score.qualitySelection.regions.filter((row) => row.events.some((event) => event.role === role));
  if (!rows.length) return { state: "UNAVAILABLE", source, coverage: null, eligibleMeasures: 0, trustedMeasures: 0, eligibleEvents: 0, trustedEvents: 0, reviewMeasures: 0, reason: "no events for this role" };
  // The existing OMR quality scorer intentionally treats absent optional
  // staff/voice/accidental metadata conservatively and may label an otherwise
  // structurally valid row BROKEN.  Keep those rows role-ready when the only
  // diagnostics are the optional metadata flags; structural/pitch/timing
  // failures remain review-required.
  const trusted = rows.filter((row) => row.state === "AUTO_ACCEPT" || row.state === "LIKELY_OK"
    || (row.state === "BROKEN" && row.score !== null && row.score >= 0.78 && row.diagnostics.length > 0 && row.diagnostics.every((flag) => OPTIONAL_NOTATION_DIAGNOSTICS.has(flag))));
  const eligibleEvents = rows.reduce((sum, row) => sum + row.events.filter((event) => event.role === role).length, 0);
  const trustedEvents = trusted.reduce((sum, row) => sum + row.events.filter((event) => event.role === role).length, 0);
  const reviewMeasures = rows.length - trusted.length;
  const coverage = rows.length ? trusted.length / rows.length : null;
  return {
    state: trusted.length === rows.length ? "READY" : "REVIEW_REQUIRED",
    source,
    coverage,
    eligibleMeasures: rows.length,
    trustedMeasures: trusted.length,
    eligibleEvents,
    trustedEvents,
    reviewMeasures,
    reason: trusted.length === rows.length ? null : "one or more selected measures require review",
  };
}

function roleQualitySummary(quality: OmrQualityReport | null): ScoreReferenceOmrRoleQuality | null {
  if (!quality) return null;
  const report = evaluateOmrRoleQuality(quality);
  const roleReadiness = {
    melody: report.roleReadiness.melody,
    harmony: report.roleReadiness.harmony,
    rhythm: report.roleReadiness.rhythm,
  } satisfies Record<LocalScoreReferenceRole, OmrRoleReadinessSummary>;
  return {
    schemaVersion: report.schemaVersion,
    consensusClaim: false,
    selectionPolicy: report.selectionPolicy,
    thresholds: report.thresholds,
    backendSummaries: report.backendSummaries,
    backendDiagnostics: backendRoleDiagnostics(report),
    roleReadiness,
    reviewGroups: report.reviewGroups,
  };
}

const ROLE_QUALITY_CATEGORY_KEYS = [
  "rhythmicValidity",
  "pitchPlausibility",
  "continuity",
  "structuralValidity",
  "densityAnomaly",
  "notationCompleteness",
] as const;

type RoleQualityCategoryKey = (typeof ROLE_QUALITY_CATEGORY_KEYS)[number];

function diagnosticCategory(
  rows: readonly OmrRoleQualityReport["measures"][number][],
  key: RoleQualityCategoryKey,
): ScoreReferenceOmrCategoryDiagnostic {
  const categories = rows.map((row) => row.categories?.[key]).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const available = categories.filter((value) => value.available && finite(value.score));
  const scores = available.map((value) => value.score!).filter(finite);
  const flags = [...new Set(categories.flatMap((value) => Array.isArray(value.flags) ? value.flags : []))].sort(compareText);
  const bases = [...new Set(categories.map((value) => value.basis).filter((value): value is string => typeof value === "string" && value.length > 0))].sort(compareText);
  return {
    score: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 1e6) / 1e6 : null,
    available: scores.length > 0,
    basis: bases.length ? bases.join("; ") : `no ${key} evidence`,
    flags,
    measureCount: rows.length,
    availableMeasures: available.length,
  };
}

function unavailableConsistencyCategory(kind: "key" | "time", measureCount: number): ScoreReferenceOmrCategoryDiagnostic {
  return {
    score: null,
    available: false,
    basis: `${kind} metadata is not represented in role-quality rows`,
    flags: [],
    measureCount,
    availableMeasures: 0,
  };
}

function backendRoleDiagnostics(report: OmrRoleQualityReport): ScoreReferenceOmrBackendDiagnostic[] {
  const rows = Array.isArray(report.measures) ? report.measures : [];
  return report.backendSummaries.map((summary) => {
    const backendRows = rows.filter((row) => row.backendId === summary.backendId
      && row.backendVersion === summary.backendVersion
      && row.role === summary.role);
    const categories = Object.fromEntries(ROLE_QUALITY_CATEGORY_KEYS.map((key) => [key, diagnosticCategory(backendRows, key)])) as Pick<ScoreReferenceOmrBackendDiagnostic["categories"], RoleQualityCategoryKey>;
    return {
      backendId: summary.backendId,
      backendVersion: summary.backendVersion,
      role: summary.role,
      measureCount: summary.measureCount,
      availableMeasures: summary.availableMeasures,
      coverage: summary.coverage,
      categories: {
        ...categories,
        keyConsistency: unavailableConsistencyCategory("key", backendRows.length),
        timeConsistency: unavailableConsistencyCategory("time", backendRows.length),
      },
    };
  });
}

function independentRoleReadiness(
  roleQuality: ScoreReferenceOmrRoleQuality,
  detailedQuality: OmrRoleQualityReport | null,
  role: LocalScoreReferenceRole,
  fallbackSource: "omr" | "native" | "none",
): ScoreReferenceRoleReadiness {
  const summary = roleQuality.roleReadiness[role];
  const backendRows = summary.preferredBackendId && summary.preferredBackendVersion && detailedQuality
    ? detailedQuality.measures.filter((row) => row.role === role
      && row.backendId === summary.preferredBackendId
      && row.backendVersion === summary.preferredBackendVersion)
    : [];
  const eligibleEvents = backendRows.reduce((sum, row) => sum + row.eventCount, 0);
  const trustedEvents = backendRows
    .filter((row) => row.state === "AUTO_ACCEPT" || row.state === "LIKELY_OK")
    .reduce((sum, row) => sum + row.eventCount, 0);
  const source: "omr" | "native" | "none" = summary.preferredBackendId ? "omr"
    : fallbackSource === "omr" ? "omr" : "none";
  return {
    state: summary.readiness === "READY" ? "READY" : summary.readiness === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "UNAVAILABLE",
    source,
    coverage: summary.coverage,
    eligibleMeasures: summary.eligibleMeasures,
    trustedMeasures: summary.trustedMeasures,
    eligibleEvents,
    trustedEvents,
    reviewMeasures: summary.reviewMeasures,
    reason: summary.readiness === "READY" ? null
      : summary.readiness === "UNAVAILABLE" ? "no independent OMR role evidence"
        : "one or more independent role measures require review",
  };
}

function preferredRoleReviewGroups(
  roleQuality: ScoreReferenceOmrRoleQuality | null,
  roles: Record<LocalScoreReferenceRole, ScoreReferenceRoleReadiness>,
): OmrRoleQualityReviewGroup[] {
  if (!roleQuality) return [];
  const groups: OmrRoleQualityReviewGroup[] = [];
  const seen = new Set<string>();
  for (const group of roleQuality.reviewGroups) {
    const role = group.role as LocalScoreReferenceRole;
    if (roles[role]?.state !== "REVIEW_REQUIRED") continue;
    const preferred = roleQuality.roleReadiness[role];
    if (!preferred || preferred.preferredBackendId !== group.backendId || preferred.preferredBackendVersion !== group.backendVersion) continue;
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    groups.push(group);
  }
  return groups.sort((left, right) => left.firstMeasureIndex - right.firstMeasureIndex
    || left.lastMeasureIndex - right.lastMeasureIndex
    || compareText(left.role, right.role)
    || compareText(left.id, right.id));
}

type ScoreReferenceReviewItem = LocalReferenceScoreReport["reviewQueue"]["items"][number];

interface ActionableReviewProjection {
  baseItems: number;
  roleGroupItems: number;
  actionableItems: number;
  remainingBaseItems: ScoreReferenceReviewItem[];
}

function actionableReviewProjection(
  reviewItems: readonly ScoreReferenceReviewItem[],
  roleGroups: readonly OmrRoleQualityReviewGroup[],
): ActionableReviewProjection {
  const coveredBaseIndexes = new Set<number>();
  for (const group of roleGroups) {
    const measureIds = new Set(group.measureIds);
    if (!measureIds.size) continue;
    reviewItems.forEach((item, index) => {
      if (item.role === group.role && measureIds.has(item.measureId)) coveredBaseIndexes.add(index);
    });
  }
  const remainingBaseItems = reviewItems.filter((_, index) => !coveredBaseIndexes.has(index));
  return {
    baseItems: reviewItems.length,
    roleGroupItems: roleGroups.length,
    actionableItems: remainingBaseItems.length + roleGroups.length,
    remainingBaseItems,
  };
}

function preferredBackendByRole(roleQuality: ScoreReferenceOmrRoleQuality | null): Record<LocalScoreReferenceRole, { id: string; version: string } | null> {
  return {
    melody: roleQuality?.roleReadiness.melody.preferredBackendId
      ? { id: roleQuality.roleReadiness.melody.preferredBackendId, version: roleQuality.roleReadiness.melody.preferredBackendVersion ?? "unknown" }
      : null,
    harmony: roleQuality?.roleReadiness.harmony.preferredBackendId
      ? { id: roleQuality.roleReadiness.harmony.preferredBackendId, version: roleQuality.roleReadiness.harmony.preferredBackendVersion ?? "unknown" }
      : null,
    rhythm: roleQuality?.roleReadiness.rhythm.preferredBackendId
      ? { id: roleQuality.roleReadiness.rhythm.preferredBackendId, version: roleQuality.roleReadiness.rhythm.preferredBackendVersion ?? "unknown" }
      : null,
  };
}

function maturityFor(score: LocalReferenceScoreReport, roles: Record<LocalScoreReferenceRole, ScoreReferenceRoleReadiness>): LocalScoreReferenceMaturity {
  if (score.state === "FAILED") return "FAILED";
  if (score.selected.kind === "native") {
    // The single-score builder can verify a native artifact's identity without
    // having role-labelled measure evidence. Keep an exact native result as a
    // validated draft until role coverage is available; an identity mismatch
    // must remain explicitly reviewable.
    return score.state === "REVIEW_REQUIRED" || score.selected.classification !== "EXACT_OR_HIGH_CONFIDENCE_MATCH"
      ? "MANUAL_REVIEW_REQUIRED"
      : "VALIDATED_DRAFT";
  }
  if (Object.values(roles).some((role) => role.state === "REVIEW_REQUIRED")) return "MANUAL_REVIEW_REQUIRED";
  const melody = roles.melody.state === "READY";
  const harmony = roles.harmony.state === "READY";
  const rhythm = roles.rhythm.state === "READY";
  if (melody && harmony && rhythm) return "FULL_REFERENCE_READY";
  if (melody && harmony) return "HARMONY_READY";
  if (melody) return "MELODY_READY";
  return score.selected.kind === "omr" ? "VALIDATED_DRAFT" : "RAW_OMR";
}

const ROLE_ORDER: readonly LocalScoreReferenceRole[] = ["melody", "harmony", "rhythm"];

function emptyRoleReferences(): Record<LocalScoreReferenceRole, ScoreReferenceRoleOutputs | null> {
  return { melody: null, harmony: null, rhythm: null };
}

function roleReferencePaths(scoreId: string, role: LocalScoreReferenceRole): ScoreReferenceRoleOutputs {
  const roleRoot = `scores/${scoreId}/roles/${role}`;
  return {
    referenceMusicXml: `${roleRoot}/reference.musicxml`,
    referenceMidi: `${roleRoot}/reference.mid`,
    coverageMask: `${roleRoot}/coverage-mask.json`,
    manifest: `${roleRoot}/reference-manifest.json`,
  };
}

/** Remove only files this runner owns, so a rerun cannot leave stale role evidence. */
async function removeRoleReferenceFiles(outputRoot: string, scoreId: string, role: LocalScoreReferenceRole): Promise<void> {
  const paths = roleReferencePaths(scoreId, role);
  const roleDirectory = resolve(outputRoot, `scores/${scoreId}/roles/${role}`);
  try {
    const info = await lstat(roleDirectory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("role artifact directory is not a regular directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return;
    throw error;
  }
  await Promise.all(Object.values(paths).map((path) => rm(resolve(outputRoot, path), { force: true })));
}

function roleNotes(
  normalized: ReturnType<typeof normalizeOmrScore>,
  role: LocalScoreReferenceRole,
  trustedMeasureIds: ReadonlySet<string>,
): Note[] {
  const hand = role === "melody" ? "R" : "L";
  const velocity = role === "melody" ? 100 : 74;
  const notes: Note[] = [];
  for (const measure of normalized.measures) {
    if (!trustedMeasureIds.has(measure.id)) continue;
    for (const event of measure.events) {
      if (event.role !== role) continue;
      notes.push({
        midi: event.pitch,
        start: measure.startBeat + event.onset,
        dur: event.duration,
        vel: velocity,
        hand,
      });
    }
  }
  return notes.sort((left, right) => left.start - right.start || left.midi - right.midi || left.dur - right.dur);
}

function roleVariant(
  normalized: ReturnType<typeof normalizeOmrScore>,
  role: LocalScoreReferenceRole,
  notes: readonly Note[],
): Variant {
  const timeSig = normalized.timeSignature ?? [4, 4];
  const endBeat = Math.max(
    normalized.measures.reduce((max, measure) => Math.max(max, measure.startBeat + measure.durationBeats), 0),
    notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
  );
  const measures = normalized.measures
    .map((measure, index) => ({ index, startBeat: measure.startBeat, endBeat: measure.startBeat + measure.durationBeats }))
    .filter((measure) => measure.startBeat < endBeat + 1e-9)
    .sort((left, right) => left.startBeat - right.startBeat || left.index - right.index);
  if (!measures.length && endBeat > 0) measures.push({ index: 0, startBeat: 0, endBeat });
  return {
    level: "advanced",
    difficultyScore: 0,
    notes: [...notes],
    chords: [],
    bassPattern: "",
    key: keyName(normalized.keySignature ?? 0, false),
    tempoBpm: normalized.tempoBpm ?? 120,
    timeSig,
    measures,
  };
}

function roleQualityMeasures(
  roleQuality: OmrRoleQualityReport,
  backendId: string,
  backendVersion: string,
  role: LocalScoreReferenceRole,
): Array<OmrRoleQualityReport["measures"][number]> {
  return roleQuality.measures?.filter((row) => row.backendId === backendId && row.backendVersion === backendVersion && row.role === role) ?? [];
}

function trustedRoleMeasureIds(rows: readonly OmrRoleQualityReport["measures"][number][]): Set<string> {
  return new Set(rows
    .filter((row) => row.available && (row.state === "AUTO_ACCEPT" || row.state === "LIKELY_OK") && typeof row.measureId === "string")
    .map((row) => row.measureId!));
}

function roleCoveragePayload(
  scoreId: string,
  role: LocalScoreReferenceRole,
  backendId: string,
  backendVersion: string,
  rows: readonly OmrRoleQualityReport["measures"][number][],
  normalized: ReturnType<typeof normalizeOmrScore>,
  trustedIds: ReadonlySet<string>,
  coverage: number | null,
): string {
  const byId = new Map(rows.filter((row) => typeof row.measureId === "string").map((row) => [row.measureId!, row]));
  return `${JSON.stringify(stable({
    schemaVersion: LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION,
    scoreId,
    role,
    backend: { id: backendId, version: backendVersion },
    trustedCoverage: coverage,
    measures: normalized.measures.map((measure) => {
      const row = byId.get(measure.id);
      return {
        id: measure.id,
        number: measure.number,
        page: measure.page,
        startBeat: measure.startBeat,
        endBeat: measure.startBeat + measure.durationBeats,
        state: row?.state ?? "UNAVAILABLE",
        score: row?.score ?? null,
        diagnostics: row?.diagnostics ?? [],
        eventCount: row?.eventCount ?? 0,
        trusted: trustedIds.has(measure.id),
      };
    }),
    excludedRegions: rows.filter((row) => !trustedIds.has(row.measureId ?? "")).map((row) => ({
      measureId: row.measureId,
      measureIndex: row.measureIndex,
      diagnostics: row.diagnostics,
    })),
    nonClaims: ["Coverage marks automatic symbolic evidence; it does not establish musical correctness or human approval."],
  }), null, 2)}\n`;
}

async function atomicCorpusWrite(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function materializeRoleReferences(
  prepared: PreparedScore,
  built: LocalReferenceBuildReport,
  outputRoot: string,
): Promise<{ references: Record<LocalScoreReferenceRole, ScoreReferenceRoleOutputs | null>; errors: string[] }> {
  const result = emptyRoleReferences();
  const errors: string[] = [];
  const cleanupFailed = new Set<LocalScoreReferenceRole>();
  for (const role of ROLE_ORDER) {
    try {
      await removeRoleReferenceFiles(outputRoot, prepared.input.id, role);
    } catch {
      // A malformed role directory (for example a symlink or non-directory)
      // must not prevent other independent roles from being materialized.
      cleanupFailed.add(role);
      errors.push(`${role} role artifact materialization failed`);
    }
  }
  const builtScore = built.scores[0];
  const roleQuality = roleQualitySummary(builtScore?.quality ?? null);
  const detailedQuality = builtScore?.quality ? evaluateOmrRoleQuality(builtScore.quality) : null;
  if (!roleQuality || !detailedQuality) return { references: result, errors };
  for (const role of ROLE_ORDER) {
    if (cleanupFailed.has(role)) continue;
    try {
      const readiness = roleQuality.roleReadiness[role];
      if (readiness.readiness !== "READY" || !readiness.preferredBackendId || !readiness.preferredBackendVersion) continue;
      const backendId = readiness.preferredBackendId;
      const backendVersion = readiness.preferredBackendVersion;
      const backend = prepared.omr.find((entry) => entry.backend.id === backendId
        && entry.backend.version === backendVersion
        && entry.backend.score);
      if (!backend?.backend.score) continue;
      const actualBackendVersion = typeof backend.backend.version === "string" ? backend.backend.version : backendVersion;
      const rows = roleQualityMeasures(detailedQuality, backend.backend.id, actualBackendVersion, role);
      const trustedIds = trustedRoleMeasureIds(rows);
      if (!trustedIds.size) continue;
      const normalized = normalizeOmrScore(backend.backend.score);
      const notes = roleNotes(normalized, role, trustedIds);
      if (!notes.length) continue;
      const variant = roleVariant(normalized, role, notes);
      const midi = writeMidi(notes, {
        tempoBpm: variant.tempoBpm,
        timeSig: variant.timeSig,
        keySig: normalized.keySignature ?? 0,
        title: prepared.input.title,
        tracks: [{ name: `Reference ${role}`, notes }],
      });
      const musicXml = writeMusicXml(variant, prepared.input.title, prepared.input.artist);
      const coverage = roleCoveragePayload(prepared.input.id, role, backend.backend.id, actualBackendVersion, rows, normalized, trustedIds, readiness.coverage);
      const paths = roleReferencePaths(prepared.input.id, role);
      const roleRoot = `scores/${prepared.input.id}/roles/${role}`;
      await mkdir(resolve(outputRoot, roleRoot), { recursive: true });
      const manifest = `${JSON.stringify(stable({
        schemaVersion: LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION,
        kind: "local-score-reference-role",
        scoreId: prepared.input.id,
        role,
        sourcePdfSha256: prepared.forensics?.identity?.sha256 ?? null,
        selectedBackend: { id: backend.backend.id, version: backend.backend.version },
        trustedCoverage: readiness.coverage,
        trustedMeasures: readiness.trustedMeasures,
        eligibleMeasures: readiness.eligibleMeasures,
        excludedRegions: rows.filter((row) => !trustedIds.has(row.measureId ?? "")).map((row) => ({ measureId: row.measureId, diagnostics: row.diagnostics })),
        automaticRepairs: [],
        unresolvedIssues: roleQuality.reviewGroups.filter((group) => group.backendId === backend.backend.id && group.backendVersion === backend.backend.version && group.role === role).map((group) => ({ id: group.id, causes: group.rootCauses })),
        artifacts: {
          referenceMusicXml: { path: paths.referenceMusicXml, bytes: new TextEncoder().encode(musicXml).byteLength, sha256: sha256Hex(new TextEncoder().encode(musicXml)) },
          referenceMidi: { path: paths.referenceMidi, bytes: midi.byteLength, sha256: sha256Hex(midi) },
          coverageMask: { path: paths.coverageMask, bytes: new TextEncoder().encode(coverage).byteLength, sha256: sha256Hex(new TextEncoder().encode(coverage)) },
        },
        nonClaims: ["This role reference is local OMR evidence, not a claim of musical correctness or human approval."],
      }), null, 2)}\n`;
      await atomicCorpusWrite(resolve(outputRoot, paths.referenceMidi), midi);
      await atomicCorpusWrite(resolve(outputRoot, paths.referenceMusicXml), musicXml);
      await atomicCorpusWrite(resolve(outputRoot, paths.coverageMask), coverage);
      await atomicCorpusWrite(resolve(outputRoot, paths.manifest), manifest);
      result[role] = paths;
    } catch {
      // A broken role must not invalidate artifacts produced for other roles.
      // Remove only this runner's four files so a failed rerun cannot leave a
      // stale role reference that the report does not advertise.
      await removeRoleReferenceFiles(outputRoot, prepared.input.id, role).catch(() => undefined);
      errors.push(`${role} role artifact materialization failed`);
    }
  }
  return { references: result, errors };
}

function scoreReport(
  prepared: PreparedScore,
  builder: LocalReferenceBuildReport,
  roleReferences: Record<LocalScoreReferenceRole, ScoreReferenceRoleOutputs | null> = emptyRoleReferences(),
  roleReferenceErrors: readonly string[] = [],
): ScoreReferenceCorpusScoreReport {
  const built = builder.scores[0]!;
  const source: "omr" | "native" | "none" = built.selected.kind === "native" ? "native" : built.qualitySelection ? "omr" : "none";
  const selectedRoles = {
    melody: roleReadiness(built, "melody", source),
    harmony: roleReadiness(built, "harmony", source),
    rhythm: roleReadiness(built, "rhythm", source),
  } satisfies Record<LocalScoreReferenceRole, ScoreReferenceRoleReadiness>;
  const qualityMeasures = built.quality?.measures.length ?? 0;
  const reviewMeasures = built.quality?.measures.filter((row) => row.state === "REVIEW").length ?? 0;
  const brokenMeasures = built.quality?.measures.filter((row) => row.state === "BROKEN").length ?? 0;
  const selectedBackend = built.selected.backend;
  const reviewItems = built.reviewQueue.items;
  const roleQuality = roleQualitySummary(built.quality);
  const detailedQuality = built.quality ? evaluateOmrRoleQuality(built.quality) : null;
  const roles = roleQuality
    ? {
      melody: independentRoleReadiness(roleQuality, detailedQuality, "melody", source),
      harmony: independentRoleReadiness(roleQuality, detailedQuality, "harmony", source),
      rhythm: independentRoleReadiness(roleQuality, detailedQuality, "rhythm", source),
    }
    : selectedRoles;
  const roleGroups = preferredRoleReviewGroups(roleQuality, roles);
  const reviewProjection = actionableReviewProjection(reviewItems, roleGroups);
  const remainingBaseItems = reviewProjection.remainingBaseItems;
  const maturity = maturityFor(built, roles);
  const pdf = pdfReport(prepared.forensics, Boolean(prepared.pdfPath));
  const discovery = prepared.discovery ?? built.nativeDiscovery;
  const backends = prepared.omr.map((entry) => entry.summary);
  const preferredBackend = built.selected.kind === "omr" ? built.selected.backend : null;
  const omrStatus: ScoreReferenceOmrSummary["status"] = !backends.length ? "not-requested"
    : backends.some((entry) => entry.status === "available" && entry.hasScore) && backends.some((entry) => entry.status !== "available") ? "partial"
      : backends.some((entry) => entry.status === "available" && entry.hasScore) ? "available"
        : backends.some((entry) => entry.status === "failed") ? "failed" : "unavailable";
  const native: ScoreReferenceNativeSummary = discovery ? {
    status: discovery.status,
    selected: Boolean(built.nativeDiscovery?.selected || built.selected.kind === "native"),
    candidateCount: discovery.candidates.length,
    rejectedCount: discovery.rejected.length,
    errors: discovery.errors.map((error) => safeText(error, "native discovery error", 500)),
    selectionReason: discovery.selectionReason,
  } : { status: "not-requested", selected: false, candidateCount: 0, rejectedCount: 0, errors: [], selectionReason: null };
  const errors = [
    ...pdf.errors,
    ...prepared.omr.filter((entry) => entry.summary.error).map((entry) => `${entry.summary.id}: ${entry.summary.error}`),
    ...roleReferenceErrors,
    ...(built.state === "FAILED" && !built.reviewQueue.totalItems ? ["no usable symbolic reference was produced"] : []),
  ].sort(compareText);
  return {
    id: built.id,
    artist: built.artist,
    title: built.title,
    maturity,
    source: {
      pdf,
      forensics: prepared.forensics ? {
        metadata: prepared.forensics.metadata,
        xmp: prepared.forensics.xmp,
        links: prepared.forensics.links,
        evidence: prepared.forensics.evidence,
      } : null,
    },
    native,
    omr: {
      status: omrStatus,
      preferredBackend,
      preferredBackendByRole: preferredBackendByRole(roleQuality),
      roleQuality,
      backends: backends.sort((left, right) => compareText(left.id, right.id)),
      qualityMeasures,
      reviewMeasures,
      brokenMeasures,
      fallbackUsed: built.selected.kind !== "omr" && backends.length > 0,
    },
    roles,
    ...(roleQuality ? { selectedRoles } : {}),
    selected: built.selected,
    quality: { measures: qualityMeasures, reviewMeasures, brokenMeasures, selectedBackend },
    outputs: {
      manifest: built.outputs.manifest,
      reviewQueue: built.outputs.reviewQueue,
      referenceMusicXml: built.outputs.referenceMusicXml,
      referenceMidi: built.outputs.referenceMidi,
      coverageMask: built.outputs.coverageMask,
      roleReferences,
    },
    review: {
      baseItems: reviewProjection.baseItems,
      roleGroupItems: reviewProjection.roleGroupItems,
      actionableItems: reviewProjection.actionableItems,
      totalItems: reviewProjection.actionableItems,
      melodyCritical: remainingBaseItems.filter((item) => item.role === "melody").length + roleGroups.filter((group) => group.role === "melody").length,
      harmonyCritical: remainingBaseItems.filter((item) => item.role === "harmony").length + roleGroups.filter((group) => group.role === "harmony").length,
      rhythmCritical: remainingBaseItems.filter((item) => item.role === "rhythm").length + roleGroups.filter((group) => group.role === "rhythm").length,
      unknown: remainingBaseItems.filter((item) => item.role === "unknown").length,
      roleGroups,
    },
    errors,
    nonClaims: [...LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS, ...built.nonClaims],
  };
}

function workload(scores: readonly ScoreReferenceCorpusScoreReport[]): ScoreReferenceHumanWorkload {
  const byScore = scores.map((score) => ({
    id: score.id,
    totalDecisions: score.review.totalItems || (score.maturity === "FAILED" ? 1 : 0),
    melodyCritical: score.review.melodyCritical,
    harmonyCritical: score.review.harmonyCritical,
    rhythmCritical: score.review.rhythmCritical,
    unknown: score.review.unknown + (score.maturity === "FAILED" && score.review.totalItems === 0 ? 1 : 0),
  })).sort((left, right) => compareText(left.id, right.id));
  return {
    totalDecisions: byScore.reduce((sum, item) => sum + item.totalDecisions, 0),
    scoresRequiringReview: scores.filter((score) => score.maturity === "MANUAL_REVIEW_REQUIRED" || score.maturity === "FAILED").length,
    melodyCritical: byScore.reduce((sum, item) => sum + item.melodyCritical, 0),
    harmonyCritical: byScore.reduce((sum, item) => sum + item.harmonyCritical, 0),
    rhythmCritical: byScore.reduce((sum, item) => sum + item.rhythmCritical, 0),
    unknown: byScore.reduce((sum, item) => sum + item.unknown, 0),
    byScore,
  };
}

function summary(scores: readonly ScoreReferenceCorpusScoreReport[]): ScoreReferenceCorpusSummary {
  return {
    scoreCount: scores.length,
    sourcePdfAvailable: scores.filter((score) => score.source.pdf.status === "available").length,
    sourcePdfMissing: scores.filter((score) => score.source.pdf.status === "missing").length,
    nativeMatches: scores.filter((score) => score.native.selected).length,
    // Role counts are intentionally independent of whole-score maturity. A
    // score may have a trusted melody while its harmony still requires review.
    melodyReady: scores.filter((score) => score.roles.melody.state === "READY").length,
    harmonyReady: scores.filter((score) => score.roles.harmony.state === "READY").length,
    fullReferenceReady: scores.filter((score) => Object.values(score.roles).every((role) => role.state === "READY")).length,
    reviewRequired: scores.filter((score) => score.maturity === "MANUAL_REVIEW_REQUIRED").length,
    failed: scores.filter((score) => score.maturity === "FAILED").length,
    unresolvedReviewItems: scores.reduce((sum, score) => sum + score.review.totalItems, 0),
    melodyCriticalReviewItems: scores.reduce((sum, score) => sum + score.review.melodyCritical, 0),
    harmonyCriticalReviewItems: scores.reduce((sum, score) => sum + score.review.harmonyCritical, 0),
    rhythmCriticalReviewItems: scores.reduce((sum, score) => sum + score.review.rhythmCritical, 0),
  };
}

function corpusStatus(scores: readonly ScoreReferenceCorpusScoreReport[]): LocalScoreReferenceCorpusStatus {
  if (!scores.length || scores.every((score) => score.maturity === "FAILED")) return "FAILED";
  if (scores.some((score) => score.maturity === "MANUAL_REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (scores.some((score) => score.maturity === "FAILED" || score.maturity === "VALIDATED_DRAFT" || score.maturity === "RAW_OMR")) return "PARTIAL";
  return "READY";
}

function corpusManifest(scores: readonly PreparedScore[]): unknown {
  return {
    schemaVersion: LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION,
    kind: "local-score-reference-corpus-manifest",
    scores: scores.map((score) => ({
      id: score.input.id,
      artist: score.input.artist,
      title: score.input.title,
      inputs: {
        pdf: Boolean(score.pdfPath),
        nativeArtifacts: score.nativeArtifacts.length,
        omrBackends: score.omr.map((entry) => entry.backend.id).sort(compareText),
      },
    })).sort((left, right) => compareText(left.id, right.id)),
    nonClaims: [...LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS],
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(stable(publicValue(value)), null, 2)}\n`, "utf8");
}

function normalizeInput(input: ScoreReferenceCorpusInput): ScoreReferenceCorpusScoreInput[] {
  if (!input || typeof input !== "object" || !Array.isArray(input.scores)) throw new Error("score-reference corpus manifest must contain a scores array");
  const seen = new Set<string>();
  return input.scores.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`score manifest entry ${index + 1} is malformed`);
    const id = safeId(entry.id, `score-${index + 1}`);
    if (seen.has(id)) throw new Error(`duplicate score id: ${id}`);
    seen.add(id);
    return { ...entry, id, artist: safeText(entry.artist, "Unknown artist"), title: safeText(entry.title, id) };
  }).sort((left, right) => compareText(left.id, right.id));
}

/**
 * Run the explicit local corpus manifest. No source is fetched, copied into
 * the repository, or imported into the catalog; output files are confined to
 * the caller's external output root.
 */
export async function runLocalScoreReferenceCorpus(input: ScoreReferenceCorpusInput, options: ScoreReferenceCorpusOptions): Promise<ScoreReferenceCorpusReport> {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const normalized = normalizeInput(input);
  const outputRoot = await assertOutputRoot(options.outputRoot, repositoryRoot);
  const prepared: PreparedScore[] = [];
  for (const score of normalized) prepared.push(await prepareScore(score, repositoryRoot, outputRoot));

  const reports: ScoreReferenceCorpusScoreReport[] = [];
  for (const score of prepared) {
    const backends = score.omr.map((entry) => entry.backend);
    let built: LocalReferenceBuildReport;
    try {
      built = await buildLocalReference({
        id: score.input.id,
        artist: score.input.artist,
        title: score.input.title,
        pdfPath: score.pdfPath,
        nativeArtifacts: score.nativeArtifacts,
        backends,
      }, { outputRoot, repositoryRoot });
    } catch (error) {
      // Keep all manifest entries represented even if one optional adapter is
      // malformed. Build a minimal failed row without echoing physical paths.
      const failed: LocalReferenceScoreReport = {
        id: score.input.id,
        artist: score.input.artist,
        title: score.input.title,
        state: "FAILED",
        source: { pdf: null },
        nativeDiscovery: null,
        nativeVerification: null,
        quality: null,
        qualitySelection: null,
        selected: { kind: "omr", id: score.input.id, backend: null, version: null, artifactType: null, classification: null, sha256: null },
        outputs: { referenceMusicXml: null, referenceMidi: null, coverageMask: null, manifest: `scores/${score.input.id}/reference-manifest.json`, reviewQueue: `scores/${score.input.id}/review-queue.json` },
        reviewQueue: { schemaVersion: 1, scoreId: score.input.id, totalItems: 1, items: [], unresolvedRegions: [], nonClaims: ["The failed row requires human/source review."] },
        nonClaims: [...LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS],
      };
      // Do not let one thrown adapter prevent the remaining scores from being
      // emitted. The error itself is attached to the corpus row below.
      built = { schemaVersion: 1, kind: "local-score-reference", status: "FAILED", scores: [{ ...failed, nonClaims: [...failed.nonClaims, publicError(error, "reference build failed")] }], nonClaims: [...LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS] };
    }
    let roleReferences = emptyRoleReferences();
    let roleReferenceErrors: string[] = [];
    try {
      const materialized = await materializeRoleReferences(score, built, outputRoot);
      roleReferences = materialized.references;
      roleReferenceErrors = materialized.errors;
    } catch (error) {
      // Role artifacts are additive evidence. A malformed optional backend
      // must not erase the per-score report; the role output remains null and
      // the readiness gate stays fail-closed.
      roleReferences = emptyRoleReferences();
      roleReferenceErrors = [publicError(error, "role reference materialization failed")];
    }
    reports.push(scoreReport(score, built, roleReferences, roleReferenceErrors));
  }
  reports.sort((left, right) => compareText(left.id, right.id));
  const report: ScoreReferenceCorpusReport = {
    schemaVersion: LOCAL_SCORE_REFERENCE_CORPUS_SCHEMA_VERSION,
    kind: "local-score-reference-corpus",
    status: corpusStatus(reports),
    scores: reports,
    summary: summary(reports),
    humanWorkload: workload(reports),
    artifacts: { report: "corpus-report.json", workload: "human-workload.json", manifest: "corpus-manifest.json" },
    nonClaims: [...LOCAL_SCORE_REFERENCE_CORPUS_NON_CLAIMS],
  };
  await writeJson(join(outputRoot, "corpus-report.json"), report);
  await writeJson(join(outputRoot, "human-workload.json"), report.humanWorkload);
  await writeJson(join(outputRoot, "corpus-manifest.json"), corpusManifest(prepared));
  return publicValue(report) as ScoreReferenceCorpusReport;
}

/** Stable JSON used by tests and the local CLI; no timestamps or paths. */
export function localScoreReferenceCorpusJson(report: ScoreReferenceCorpusReport): string {
  return `${JSON.stringify(stable(publicValue(report)), null, 2)}\n`;
}
