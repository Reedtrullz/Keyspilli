/**
 * Local-only reference builder for a single score.
 *
 * This is intentionally an orchestration boundary, rather than a catalog
 * ingestion path.  It reads caller-supplied PDF/native/OMR inputs, freezes a
 * small set of derived reference artifacts below an explicitly supplied
 * output directory, and returns reports containing logical relative paths
 * only.  No network, database, or Keyspilli arranger code is involved.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  keyName,
  writeMidi,
  writeMusicXml,
  type Note,
  type Variant,
} from "@keyspilli/midi";
import {
  inspectScoreSourceForensics,
  type ScoreSourceForensicsOptions,
  type ScoreSourceForensicsReport,
} from "./score-source-forensics.js";
import { type NativeScoreArtifactInput, type NativeScoreDiscoveryReport } from "./native-score-discovery.js";
import {
  verifyNativeScoreBytes,
  verifyNativeScoreIdentity,
  type PdfForensicsReportLike,
  type NativeScoreVerificationResult,
} from "./native-score-verification.js";
import {
  normalizeOmrScore,
  type OmrBackendRun,
  type OmrNormalizedMeasure,
  type OmrScoreInput,
} from "./omr-consensus.js";
import {
  evaluateOmrQuality,
  selectBestOmrQuality,
  type OmrQualityReport,
  type OmrQualitySelection,
} from "./omr-quality.js";
import { buildOmrReviewQueue, type OmrReviewQueue } from "./omr-review-queue.js";
import { sha256Hex } from "./fixture-evidence.js";

export const LOCAL_REFERENCE_BUILDER_SCHEMA_VERSION = 1 as const;
export const LOCAL_REFERENCE_BUILDER_NON_CLAIM =
  "This local reference is not a claim of copyright permission, musical correctness, or listening quality.";

export type LocalReferenceState =
  | "MELODY_READY"
  | "VALIDATED_DRAFT"
  | "REVIEW_REQUIRED"
  | "FAILED";

export interface LocalReferenceOmrBackendInput {
  id: string;
  version?: string;
  status?: "available" | "unavailable" | "failed";
  score?: OmrScoreInput | null;
  error?: string;
  sourceLabel?: string;
  priority?: "native" | "omr";
  /** Optional adapter diagnostics; retained only after path redaction. */
  [key: string]: unknown;
}

export interface LocalReferenceBuildInput {
  id: string;
  artist: string;
  title: string;
  /** The PDF is read for metadata/hash evidence only and is never copied. */
  pdfPath?: string | null;
  nativeArtifacts?: readonly NativeScoreArtifactInput[];
  backends?: readonly LocalReferenceOmrBackendInput[];
}

export interface LocalReferenceNativeOptions {
  /** Test seam for an already-authorized local artifact. Never serialized. */
  artifactBytes?: Uint8Array | ArrayBuffer;
  /** Optional per-candidate version of the same seam for multi-candidate runs. */
  artifactBytesById?: Readonly<Record<string, Uint8Array | ArrayBuffer>>;
}

export interface LocalReferenceBuildOptions {
  /** Absolute, local output root. It may be reused for deterministic reruns. */
  outputRoot: string;
  /** A repository root that the builder must never write below. */
  repositoryRoot?: string;
  forensics?: ScoreSourceForensicsOptions;
  native?: LocalReferenceNativeOptions;
  /** Adapter budget recorded by callers; this pure builder does not spawn one. */
  timeoutMs?: number;
}

export interface LocalReferenceSelected {
  kind: "native" | "omr";
  id: string;
  backend: string | null;
  version: string | null;
  artifactType: string | null;
  classification: string | null;
  sha256: string | null;
}

export interface LocalReferenceOutputs {
  referenceMusicXml: string | null;
  referenceMidi: string | null;
  referenceMxl?: string | null;
  coverageMask: string | null;
  manifest: string;
  reviewQueue: string;
}

export interface LocalReferenceReviewQueue extends OmrReviewQueue {
  totalItems: number;
}

export interface LocalReferenceScoreReport {
  id: string;
  artist: string;
  title: string;
  state: LocalReferenceState;
  source: {
    pdf: Pick<ScoreSourceForensicsReport, "status" | "identity" | "metadata" | "xmp" | "evidence" | "errors"> | null;
  };
  nativeDiscovery: Pick<NativeScoreDiscoveryReport, "schemaVersion" | "status" | "selectionReason" | "selected" | "candidates" | "rejected" | "omr" | "errors"> | null;
  nativeVerification: NativeScoreVerificationResult | null;
  quality: OmrQualityReport | null;
  qualitySelection: OmrQualitySelection | null;
  selected: LocalReferenceSelected;
  outputs: LocalReferenceOutputs;
  reviewQueue: LocalReferenceReviewQueue;
  /** The report deliberately omits physical source paths and raw note arrays. */
  nonClaims: string[];
}

export interface LocalReferenceBuildReport {
  schemaVersion: typeof LOCAL_REFERENCE_BUILDER_SCHEMA_VERSION;
  kind: "local-score-reference";
  status: LocalReferenceState;
  scores: LocalReferenceScoreReport[];
  nonClaims: string[];
}

interface NativeBytesCandidate {
  candidate: NativeScoreArtifactInput;
  bytes: Uint8Array;
  artifactType: "midi" | "musicxml" | "mxl" | "mscz";
}

const SAFE_HASH = /^[a-f0-9]{64}$/i;
// These expressions are intentionally non-global. The helpers below are
// called repeatedly while producing deterministic reports; a global RegExp's
// mutable lastIndex would otherwise make equivalent inputs depend on call
// order.
const PATHISH = /(?:^|[\s"'(=:])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/]|\/|\\)(?:[^\s"']*)/i;
const URL_CREDENTIALS = /https?:\/\/[^\s/@]+:[^\s/@]+@/i;
const QUALITY_REVIEW_FLAGS = new Set([
  "invalid-event",
  "invalid-measure-duration",
  "impossible-leap",
  "duplicate-event",
  "orphan-tie-stop",
  "orphan-tie-continue",
  "invalid-tie",
  "continuity-overlap",
  "continuity-gap",
  "overfull-measure",
  "underfull-measure",
  "density-spike",
  "normalization-warning",
]);
const OPTIONAL_NOTATION_FLAGS = new Set(["missing-staff", "missing-voice", "missing-accidental"]);
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanText(value: unknown, fallback = "unknown", limit = 240): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
  return cleaned || fallback;
}

function safeText(value: unknown, fallback = "unknown"): string {
  const cleaned = cleanText(value, fallback);
  if (PATHISH.test(cleaned) || URL_CREDENTIALS.test(cleaned)) return fallback;
  return cleaned;
}

function safeId(value: unknown, fallback: string): string {
  const text = safeText(value, fallback)
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return /[A-Za-z0-9]/.test(text) ? text : fallback;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

/** Redact path-like strings in adapter diagnostics before they enter a report. */
function redact(value: unknown): unknown {
  if (typeof value === "string") {
    const cleaned = value
      // Use fresh global expressions here so every occurrence is scrubbed
      // without sharing mutable RegExp state with the validation helpers.
      .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[redacted]@")
      .replace(/(?:^|[\s"'(=:])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/]|\/|\\)(?:[^\s"']*)/gi, "[redacted-path]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);
    // Adapter diagnostics can contain a relative source filename. Preserve
    // generated logical paths, but do not echo external score/audio files.
    if (/^(?!scores\/|reference\/)(?:[^\s/]+[\\/])+[^\s/]+\.(?:pdf|mid|midi|musicxml|xml|mxl|mscz|wav|mp3)(?:$|[?#])/i.test(cleaned)) return "[redacted-path]";
    return cleaned;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

function cloneReport<T>(value: T): T {
  return redact(value) as T;
}

function pathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent).replace(/[\\/]$/, "");
  return c === p || c.startsWith(`${p}${sep}`);
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

async function assertOutputRoot(outputRoot: string, repositoryRoot: string): Promise<string> {
  if (!isAbsolute(outputRoot) || /[\u0000\r\n]/.test(outputRoot)) {
    throw new Error("local reference outputRoot must be an absolute path without NUL/newline characters");
  }
  const root = resolve(outputRoot);
  const repository = await existingRealpath(resolve(repositoryRoot));
  const resolvedRoot = await existingRealpath(root);
  if (pathInside(resolvedRoot, repository)) {
    throw new Error("local reference outputRoot must be outside the repository");
  }
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) throw new Error("local reference outputRoot must not be a symbolic link");
    if (!info.isDirectory()) throw new Error("local reference outputRoot must be a directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "ENOENT") throw error;
  }
  // Use the canonicalized path for all subsequent writes. This avoids
  // traversing a symlinked parent even when the requested leaf did not yet
  // exist at validation time.
  return resolvedRoot;
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function bytesOf(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

function artifactType(value: NativeScoreArtifactInput): NativeBytesCandidate["artifactType"] | null {
  const raw = String(value.artifactType ?? value.type ?? "").toLowerCase();
  if (raw === "midi" || raw === "mid") return "midi";
  if (raw === "musicxml" || raw === "xml") return "musicxml";
  if (raw === "mxl") return "mxl";
  if (raw === "mscz") return "mscz";
  const path = typeof value.path === "string" ? value.path.toLowerCase() : "";
  if (path.endsWith(".mid") || path.endsWith(".midi")) return "midi";
  if (path.endsWith(".musicxml") || path.endsWith(".xml")) return "musicxml";
  if (path.endsWith(".mxl")) return "mxl";
  if (path.endsWith(".mscz")) return "mscz";
  return null;
}

function validNativeBytes(bytes: Uint8Array, type: NativeBytesCandidate["artifactType"]): boolean {
  if (type === "midi") return bytes.byteLength >= 14 && Buffer.from(bytes).subarray(0, 4).toString("ascii") === "MThd";
  if (type === "mxl" || type === "mscz") return bytes.byteLength >= 4 && Buffer.from(bytes).subarray(0, 2).toString("ascii") === "PK";
  return Buffer.from(bytes).toString("utf8").toLowerCase().includes("<score-partwise");
}

function candidateBytes(input: LocalReferenceBuildInput, options: LocalReferenceBuildOptions): NativeBytesCandidate | null {
  const candidates = [...(input.nativeArtifacts ?? [])]
    .filter((candidate): candidate is NativeScoreArtifactInput => Boolean(candidate && typeof candidate === "object"))
    .sort((left, right) => compareText(safeId(left.id, "native"), safeId(right.id, "native")));
  for (const candidate of candidates) {
    const type = artifactType(candidate);
    // MSCZ is discoverable metadata, but this builder has no safe parser or
    // writer for it. Keep it review-only instead of claiming a derived
    // reference exists when no output can be materialized.
    if (!type || type === "mscz") continue;
    const id = safeId(candidate.id, "native");
    const injected = options.native?.artifactBytesById?.[id] ?? (candidates.length === 1 ? options.native?.artifactBytes : undefined);
    if (injected === undefined) continue;
    const bytes = bytesOf(injected);
    if (candidate.permitted !== true) continue;
    if (!safeText(candidate.provenance, "") || !safeText(candidate.version ?? candidate.versionIdentity, "")) continue;
    if (!validNativeBytes(bytes, type)) continue;
    if (candidate.sha256 !== undefined && candidate.sha256 !== null) {
      if (typeof candidate.sha256 !== "string" || !SAFE_HASH.test(candidate.sha256)) continue;
      // Verify injected bytes exactly as path-backed candidates are verified.
      // The byte seam is useful for deterministic tests, but must not create a
      // second trust model where a supplied digest is silently ignored.
      if (sha256Hex(bytes) !== candidate.sha256.toLowerCase()) continue;
      if (candidate.bytes !== undefined && finite(candidate.bytes) && candidate.bytes !== bytes.byteLength) continue;
    }
    return { candidate, bytes, artifactType: type };
  }
  return null;
}

function pdfSource(report: ScoreSourceForensicsReport | null): LocalReferenceScoreReport["source"]["pdf"] {
  if (!report) return null;
  return {
    status: report.status,
    identity: report.identity,
    metadata: report.metadata,
    xmp: report.xmp,
    evidence: report.evidence,
    errors: report.errors,
  };
}

function emptyQueue(scoreId: string, reason?: string): LocalReferenceReviewQueue {
  const item = reason ? {
    id: `${scoreId}:symbolic-backend-unavailable`,
    scoreId,
    page: null,
    system: null,
    measureId: "symbolic-backend",
    measureNumber: "unknown",
    role: "unknown" as const,
    reasonCategory: "unknown",
    reason,
    state: "BROKEN" as const,
    priorityClass: "high" as const,
    backendValues: {},
    backendInterpretations: {},
    context: {
      keySignature: null,
      timeSignature: null,
      startBeat: 0,
      durationBeats: 0,
      structural: { agreement: null, evidence: [] },
    },
    evidence: [reason],
    recommendedAction: "Provide a permitted native symbolic score or an available OMR backend, then review the resulting notation.",
  } : null;
  return {
    schemaVersion: 1,
    scoreId,
    totalItems: item ? 1 : 0,
    items: item ? [item] : [],
    unresolvedRegions: item ? [item.measureId] : [],
    nonClaims: ["This queue is not automatic musical pitch correction.", "Unresolved regions are preserved for human review."],
  };
}

function scoreRowsForReview(quality: OmrQualityReport): Array<Record<string, unknown>> {
  return quality.measures
    .filter((row) => row.available && row.state !== "AUTO_ACCEPT" && row.state !== "LIKELY_OK")
    .flatMap((row): Array<Record<string, unknown>> => {
      const reasons = row.diagnostics.filter((flag) => !OPTIONAL_NOTATION_FLAGS.has(flag));
      if (!reasons.length && row.state === "REVIEW") reasons.push("quality-state-review");
      if (!reasons.length) return [];
      // Quality diagnostics are measure-scoped, but pitch/continuity issues
      // can still be attributed safely when every event in the measure has
      // the same explicit role. Preserve that attribution for the review
      // queue; structural issues remain deliberately role-neutral.
      const eventRoles = [...new Set(row.events.map((event) => event.role))];
      const explicitRole = eventRoles.length === 1 && eventRoles[0] !== null ? eventRoles[0] : null;
      const roleForReason = (reason: string): "melody" | "harmony" | "rhythm" | null => {
        if (!explicitRole) return null;
        return [
          "impossible-leap",
          "duplicate-event",
          "orphan-tie-stop",
          "orphan-tie-continue",
          "invalid-tie",
          "continuity-overlap",
          "continuity-gap",
          "density-spike",
        ].includes(reason) ? explicitRole : null;
      };
      return [{
        id: row.measureId ?? `${row.backendId}:${row.measureIndex ?? 0}`,
        number: row.measureNumber ?? "unknown",
        page: row.page,
        system: row.system,
        state: row.state,
        startBeat: row.startBeat ?? 0,
        durationBeats: row.durationBeats ?? 0,
        keySignature: null,
        timeSignature: null,
        reviewReasons: reasons,
        diagnostics: reasons,
        categories: row.categories,
        agreement: {
          structural: row.categories.structuralValidity.score,
          disagreements: reasons.map((detail) => ({ kind: detail, role: roleForReason(detail), detail })),
        },
      }];
    });
}

function queueFromQuality(scoreId: string, quality: OmrQualityReport): LocalReferenceReviewQueue {
  const queue = buildOmrReviewQueue({ metadata: { scoreId }, measures: scoreRowsForReview(quality) });
  return { ...queue, totalItems: queue.items.length };
}

function roleForEvent(event: { role: string | null }, measure: OmrNormalizedMeasure, score: OmrScoreInput): "melody" | "harmony" | "rhythm" | null {
  if (event.role === "melody" || event.role === "harmony" || event.role === "rhythm") return event.role;
  const part = (score.parts ?? []).find((candidate) => candidate && typeof candidate === "object" && String(candidate.id) === measure.partId);
  return part?.role ?? null;
}

function notesFromOmr(score: OmrScoreInput, normalized: ReturnType<typeof normalizeOmrScore>): Note[] {
  const notes: Note[] = [];
  for (const measure of normalized.measures) {
    for (const event of measure.events) {
      const role = roleForEvent(event, measure, score);
      notes.push({
        midi: event.pitch,
        start: measure.startBeat + event.onset,
        dur: event.duration,
        vel: role === "melody" || role === null ? 100 : 74,
        hand: role === "harmony" || role === "rhythm" ? "L" : "R",
      });
    }
  }
  return notes.sort((left, right) => left.start - right.start || (left.hand === right.hand ? 0 : left.hand === "L" ? 1 : -1) || left.midi - right.midi || left.dur - right.dur);
}

function variantFromOmr(score: OmrScoreInput, normalized: ReturnType<typeof normalizeOmrScore>, title: string, artist: string): { variant: Variant; notes: Note[] } {
  const notes = notesFromOmr(score, normalized);
  const timeSig = normalized.timeSignature ?? [4, 4];
  const durationBeats = Math.max(
    normalized.measures.reduce((max, measure) => Math.max(max, measure.startBeat + measure.durationBeats), 0),
    notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
  );
  const measures = normalized.measures
    .map((measure, index) => ({ index, startBeat: measure.startBeat, endBeat: measure.startBeat + measure.durationBeats }))
    .sort((left, right) => left.startBeat - right.startBeat || left.index - right.index);
  if (!measures.length && durationBeats > 0) measures.push({ index: 0, startBeat: 0, endBeat: durationBeats });
  const key = keyName(normalized.keySignature ?? 0, false);
  const variant: Variant = {
    level: "advanced",
    difficultyScore: 0,
    notes,
    chords: [],
    bassPattern: "",
    key,
    tempoBpm: normalized.tempoBpm ?? 120,
    timeSig,
    measures,
  };
  void title;
  void artist;
  return { variant, notes };
}

function qualityState(quality: OmrQualityReport, normalized: ReturnType<typeof normalizeOmrScore>): LocalReferenceState {
  if (!normalized.measures.length || !normalized.measures.some((measure) => measure.events.length)) return "FAILED";
  const available = quality.measures.filter((row) => row.available);
  if (!available.length) return "FAILED";
  // Missing optional notation metadata (staff/voice/accidental) may leave a
  // row LIKELY_OK. Explicit REVIEW/BROKEN rows, however, must stay reviewable
  // even when their notes are otherwise parseable.
  return available.some((row) => row.state === "REVIEW" || row.diagnostics.some((flag) => QUALITY_REVIEW_FLAGS.has(flag)))
    ? "REVIEW_REQUIRED"
    : "MELODY_READY";
}

function normalizedBackendRuns(backends: readonly LocalReferenceOmrBackendInput[]): OmrBackendRun[] {
  return backends.map((backend, index) => ({
    ...backend,
    id: safeId(backend.id, `backend-${index + 1}`),
    version: safeText(backend.version, "unknown"),
    status: backend.status ?? (backend.score ? "available" : "unavailable"),
    error: typeof backend.error === "string" ? safeText(backend.error, "backend error") : undefined,
  }));
}

function selectedOmrBackend(backends: readonly LocalReferenceOmrBackendInput[], quality: OmrQualityReport): LocalReferenceOmrBackendInput | null {
  const candidates = backends.filter((backend) => backend.score && (backend.status ?? "available") === "available");
  if (!candidates.length) return null;
  const usableRows = new Map<string, number>();
  for (const row of quality.measures) if (row.available) usableRows.set(row.backendId, (usableRows.get(row.backendId) ?? 0) + (row.state === "BROKEN" ? 0 : 1));
  return [...candidates].sort((left, right) => (usableRows.get(safeId(right.id, "")) ?? 0) - (usableRows.get(safeId(left.id, "")) ?? 0) || compareText(safeId(left.id, ""), safeId(right.id, "")))[0] ?? null;
}

function manifestForScore(score: LocalReferenceScoreReport, normalized?: ReturnType<typeof normalizeOmrScore>): string {
  const payload = {
    schemaVersion: LOCAL_REFERENCE_BUILDER_SCHEMA_VERSION,
    id: score.id,
    artist: score.artist,
    title: score.title,
    state: score.state,
    selected: score.selected,
    source: score.source,
    outputs: score.outputs,
    coverage: normalized ? normalized.measures.map((measure) => ({
      id: measure.id,
      number: measure.number,
      page: measure.page,
      startBeat: measure.startBeat,
      endBeat: measure.startBeat + measure.durationBeats,
      events: measure.events.length,
    })) : [],
    nonClaims: score.nonClaims,
  };
  return `${JSON.stringify(stable(redact(payload)), null, 2)}\n`;
}

function coverageForScore(scoreId: string, normalized: ReturnType<typeof normalizeOmrScore>, quality: OmrQualityReport): string {
  const qualityByMeasure = new Map(quality.measures.filter((row) => row.available).map((row) => [row.measureId, row]));
  return `${JSON.stringify(stable({
    schemaVersion: LOCAL_REFERENCE_BUILDER_SCHEMA_VERSION,
    scoreId,
    measures: normalized.measures.map((measure) => {
      const row = qualityByMeasure.get(measure.id);
      return {
        id: measure.id,
        number: measure.number,
        page: measure.page,
        startBeat: measure.startBeat,
        endBeat: measure.startBeat + measure.durationBeats,
        state: row?.state ?? "UNKNOWN",
        melodyEvents: measure.events.filter((event) => event.role === "melody").length,
        eventCount: measure.events.length,
      };
    }),
    nonClaims: ["Coverage masks identify symbolic evidence; they do not prove note correctness."],
  }), null, 2)}\n`;
}

function nativeSelection(verification: NativeScoreVerificationResult): LocalReferenceSelected | null {
  if (!verification.candidate) return null;
  return {
    kind: "native",
    id: verification.candidate.id,
    backend: null,
    version: verification.candidate.version,
    artifactType: verification.candidate.artifactType,
    classification: verification.classification,
    sha256: verification.candidate.sha256,
  };
}

/**
 * Build one local symbolic reference.  The output root is reusable: known
 * generated files are atomically replaced, while unrelated files are never
 * enumerated, removed, or overwritten.
 */
export async function buildLocalReference(input: LocalReferenceBuildInput, options: LocalReferenceBuildOptions): Promise<LocalReferenceBuildReport> {
  const source = input && typeof input === "object" ? input : ({} as LocalReferenceBuildInput);
  const repositoryRoot = options.repositoryRoot ?? options.forensics?.repositoryRoot ?? process.cwd();
  const outputRoot = await assertOutputRoot(options.outputRoot, repositoryRoot);
  await mkdir(outputRoot, { recursive: true });

  const id = safeId(source.id, "score-1");
  const artist = safeText(source.artist, "Unknown artist");
  const title = safeText(source.title, id);
  const scoreRoot = resolve(outputRoot, "scores", id);
  if (!pathInside(scoreRoot, outputRoot)) throw new Error("invalid local reference score id");
  await mkdir(scoreRoot, { recursive: true });

  let forensics: ScoreSourceForensicsReport | null = null;
  if (source.pdfPath) {
    forensics = await inspectScoreSourceForensics(source.pdfPath, {
      ...(options.forensics ?? {}),
      repositoryRoot,
    });
  }

  const nonClaims = [
    LOCAL_REFERENCE_BUILDER_NON_CLAIM,
    "Human review remains required for uncertain notation regions; no human musical correction was performed.",
  ];
  const nativeInjected = candidateBytes(source, options);
  let selected: LocalReferenceSelected | null = null;
  let nativeDiscovery: Pick<NativeScoreDiscoveryReport, "schemaVersion" | "status" | "selectionReason" | "selected" | "candidates" | "rejected" | "omr" | "errors"> | null = null;
  let nativeVerification: NativeScoreVerificationResult | null = null;
  let quality: OmrQualityReport | null = null;
  let qualitySelection: OmrQualitySelection | null = null;
  let normalized: ReturnType<typeof normalizeOmrScore> | undefined;
  let outputMusicXml: string | null = null;
  let outputMidi: string | null = null;
  let outputMxl: string | null = null;
  let coverageMask: string | null = null;

  const materializeNative = async (value: NativeBytesCandidate, verification: NativeScoreVerificationResult): Promise<boolean> => {
    const next = nativeSelection(verification);
    if (!next || !verification.symbolic) return false;
    selected = next;
    nativeVerification = cloneReport(verification);
    nativeDiscovery = cloneReport({
      schemaVersion: 1,
      candidates: [],
      omr: [],
      ...verification.discovery,
    });
    if (value.artifactType === "midi") {
      outputMidi = `scores/${id}/reference.mid`;
      await atomicWrite(resolve(outputRoot, outputMidi), value.bytes);
    } else if (value.artifactType === "musicxml") {
      outputMusicXml = `scores/${id}/reference.musicxml`;
      await atomicWrite(resolve(outputRoot, outputMusicXml), value.bytes);
    } else if (value.artifactType === "mxl") {
      outputMxl = `scores/${id}/reference.mxl`;
      await atomicWrite(resolve(outputRoot, outputMxl), value.bytes);
    } else {
      return false;
    }
    return true;
  };

  if (nativeInjected) {
    const verification = verifyNativeScoreBytes(
      (forensics ?? { metadata: {}, xmp: {} }) as PdfForensicsReportLike,
      nativeInjected.candidate,
      nativeInjected.bytes,
      { artifactType: nativeInjected.artifactType },
    );
    nativeVerification = cloneReport(verification);
    nativeDiscovery = cloneReport({
      schemaVersion: 1,
      candidates: [],
      omr: [],
      ...verification.discovery,
    });
    await materializeNative(nativeInjected, verification);
  } else {
    const nativeCandidates = [...(source.nativeArtifacts ?? [])]
      .filter((candidate): candidate is NativeScoreArtifactInput => Boolean(candidate && typeof candidate === "object"))
      .sort((left, right) => compareText(safeId(left.id, "native"), safeId(right.id, "native")));
    let reviewNative: { value: NativeBytesCandidate; verification: NativeScoreVerificationResult } | null = null;
    for (const candidate of nativeCandidates) {
      try {
        const verification = await verifyNativeScoreIdentity(
          (forensics ?? { metadata: {}, xmp: {} }) as PdfForensicsReportLike,
          candidate,
        );
        if (verification.candidate && verification.symbolic && typeof candidate.path === "string") {
          const bytes = new Uint8Array(await readFile(candidate.path));
          const type = artifactType(candidate);
          if (!type) continue;
          const value: NativeBytesCandidate = { candidate, bytes, artifactType: type };
          if (verification.eligibleAsReference) {
            await materializeNative(value, verification);
            break;
          }
          if (!reviewNative) reviewNative = { value, verification };
        }
      } catch {
        // A malformed native candidate is diagnostic evidence, not a reason
        // to abort an independent OMR lane.
      }
    }
    if (!selected && reviewNative) await materializeNative(reviewNative.value, reviewNative.verification);
  }

  const backends = normalizedBackendRuns(source.backends ?? []);
  if (backends.length) {
    quality = cloneReport(evaluateOmrQuality({ engines: backends }));
    qualitySelection = cloneReport(selectBestOmrQuality(quality));
  }

  if (!selected && backends.length && quality) {
    const backend = selectedOmrBackend(source.backends ?? [], quality);
    if (backend?.score) {
      try {
        normalized = normalizeOmrScore(backend.score);
        if (normalized.measures.some((measure) => measure.events.length)) {
          selected = {
            kind: "omr",
            id: id,
            backend: safeId(backend.id, "omr"),
            version: safeText(backend.version, "unknown"),
            artifactType: "musicxml",
            classification: "SINGLE_ENGINE_LOCAL_REFERENCE",
            sha256: null,
          };
          const rendered = variantFromOmr(backend.score, normalized, title, artist);
          outputMidi = `scores/${id}/reference.mid`;
          outputMusicXml = `scores/${id}/reference.musicxml`;
          await atomicWrite(resolve(outputRoot, outputMidi), writeMidi(rendered.notes, {
            tempoBpm: rendered.variant.tempoBpm,
            timeSig: rendered.variant.timeSig,
            keySig: normalized.keySignature ?? 0,
            title,
            tracks: [
              { name: "Reference melody", notes: rendered.notes.filter((note) => note.hand !== "L") },
              { name: "Reference accompaniment", notes: rendered.notes.filter((note) => note.hand === "L") },
            ],
          }));
          await atomicWrite(resolve(outputRoot, outputMusicXml), writeMusicXml(rendered.variant, title, artist));
          coverageMask = `scores/${id}/coverage-mask.json`;
          await atomicWrite(resolve(outputRoot, coverageMask), coverageForScore(id, normalized, quality));
        }
      } catch {
        normalized = undefined;
        selected = null;
      }
    }
  }

  const state: LocalReferenceState = selected?.kind === "native"
    ? selected.classification === "EXACT_OR_HIGH_CONFIDENCE_MATCH" ? "MELODY_READY" : "REVIEW_REQUIRED"
    : normalized && quality ? qualityState(quality, normalized) : "FAILED";
  const selectedForReport: LocalReferenceSelected = selected ?? {
    kind: "omr",
    id,
    backend: null,
    version: null,
    artifactType: null,
    classification: null,
    sha256: null,
  };
  const scoreReportBase: Omit<LocalReferenceScoreReport, "outputs" | "reviewQueue"> = {
    id,
    artist,
    title,
    state,
    source: { pdf: pdfSource(forensics) },
    nativeDiscovery,
    nativeVerification,
    quality,
    qualitySelection,
    selected: selectedForReport,
    nonClaims,
  };
  const reviewQueue = selected?.kind === "native"
    ? emptyQueue(id)
    : quality && normalized
      ? queueFromQuality(id, quality)
      : emptyQueue(id, "symbolic backend unavailable");
  const outputs: LocalReferenceOutputs = {
    referenceMusicXml: outputMusicXml,
    referenceMidi: outputMidi,
    ...(outputMxl ? { referenceMxl: outputMxl } : {}),
    coverageMask,
    manifest: `scores/${id}/reference-manifest.json`,
    reviewQueue: `scores/${id}/review-queue.json`,
  };
  const scoreReport: LocalReferenceScoreReport = { ...scoreReportBase, outputs, reviewQueue };
  await atomicWrite(resolve(outputRoot, outputs.reviewQueue), `${JSON.stringify(stable(redact(reviewQueue)), null, 2)}\n`);
  await atomicWrite(resolve(outputRoot, outputs.manifest), manifestForScore(scoreReport, normalized));

  return {
    schemaVersion: LOCAL_REFERENCE_BUILDER_SCHEMA_VERSION,
    kind: "local-score-reference",
    status: state,
    scores: [cloneReport(scoreReport)],
    nonClaims: [...nonClaims, "The reference builder is local-only and does not alter Keyspilli catalog/runtime state."],
  };
}

/** Stable, path-free JSON representation for repeatable local reports. */
export function localReferenceBuilderJson(report: LocalReferenceBuildReport): string {
  return `${JSON.stringify(stable(redact(report)), null, 2)}\n`;
}

export const buildLocalSymbolicReference = buildLocalReference;
