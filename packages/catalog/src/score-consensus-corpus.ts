/**
 * Local, evaluation-only orchestration for the score corpus.
 *
 * This module deliberately does not import catalog/DB code and never writes to
 * the repository.  It consumes an existing corpus (normally the private
 * Audiveris run), optionally rasterizes caller-supplied PDFs, and records an
 * optional HOMR/native lane without treating unavailable evidence as truth.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  createHomrBackend,
  DEFAULT_HOMR_EXECUTABLE,
  DEFAULT_HOMR_FORCE_CPU,
  DEFAULT_HOMR_PACKAGE_NAME,
  DEFAULT_HOMR_PREFER_UVX,
  DEFAULT_HOMR_UVX_EXECUTABLE,
  DEFAULT_HOMR_VERSION,
  type HomrBackendOptions,
  type OmrBackend,
  type OmrPageResult,
  type OmrResult,
  type PdfRasterResult,
} from "./omr-backends.js";
import { createPdfRasterizer } from "./omr-backends.js";
import {
  buildOmrConsensus,
  renderOmrReviewMarkdown,
  sanitizeOmrMetadata,
  selectOmrConsensusEvents,
  type OmrBackendRun,
  type OmrBackendPageMetadata,
  type OmrConsensusReport,
  type OmrNativeRun,
  type OmrRole,
  type OmrScoreInput,
} from "./omr-consensus.js";
import { parseOmrMusicXml, parseOmrMusicXmlBytes } from "./omr-musicxml.js";
import {
  discoverNativeScoreArtifacts,
  type NativeScoreArtifactInput,
  type NativeScoreDiscoveryReport,
} from "./native-score-discovery.js";

export const SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION = 1 as const;
export const HOMR_AUTO_MODE = "auto" as const;
export const HOMR_UVX_PACKAGE = `${DEFAULT_HOMR_PACKAGE_NAME}==${DEFAULT_HOMR_VERSION}`;
export const HOMR_UVX_VERSION = DEFAULT_HOMR_VERSION;

/** Convenience adapter used by the corpus runner and local tests. */
export function parseMusicXmlScore(xml: string): OmrScoreInput {
  return parseOmrMusicXml(xml).score;
}

export interface ScoreConsensusSourceMetadata {
  fileName?: string | null;
  sha256?: string | null;
  bytes?: number | null;
  pages?: number | null;
}

export interface ScoreConsensusScoreInput {
  id: string;
  artist: string;
  title: string;
  previousStatus?: string | null;
  source: ScoreConsensusSourceMetadata;
  audiveris: OmrBackendRun;
  homr?: OmrBackendRun;
  native?: OmrNativeRun;
  nativeDiscovery?: NativeScoreDiscoveryReport;
  raster?: PdfRasterResult | null;
  metadata?: unknown;
}

export interface ScoreConsensusBenchmarkRole {
  eligible: boolean;
  coverage: number | null;
  trustedMeasures: number;
  availableMeasures: number;
}

export interface ScoreConsensusReviewPageRef {
  measureId: string;
  number: string;
  page: number | null;
  system: number | null;
  /** Relative raster path only; absolute paths are never emitted. */
  rasterPage: string | null;
}

export interface ScoreConsensusReport {
  schemaVersion: typeof SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION;
  id: string;
  artist: string;
  title: string;
  previousStatus: string | null;
  source: ScoreConsensusSourceMetadata;
  consensus: OmrConsensusReport;
  benchmark: Record<OmrRole, ScoreConsensusBenchmarkRole>;
  raster: PdfRasterResult | null;
  nativeDiscovery?: NativeScoreDiscoveryReport;
  regions: Array<{
    measureId: string;
    number: string;
    page: number | null;
    system: number | null;
    startBeat: number;
    endBeat: number;
    state: string;
    confidence: number;
    review: boolean;
  }>;
  nonClaims: string[];
}

export interface ScoreConsensusCorpusSummary {
  schemaVersion: typeof SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION;
  before: { reviewRequired: number; failed: number };
  after: {
    trustedNative: number;
    trustedConsensus: number;
    trustedSingleEngine: number;
    partiallyTrusted: number;
    reviewRequired: number;
    failed: number;
  };
  totals: {
    scoreCount: number;
    totalMeasures: number;
    trustedMeasures: number;
    reviewRequiredMeasures: number;
    failedMeasures: number;
    reviewItems: number;
    benchmarkEligible: { melody: number; harmony: number; rhythm: number };
  };
  determinismSha256: string;
  nonClaims: string[];
}

export interface ScoreConsensusCorpusResult {
  schemaVersion: typeof SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION;
  output: string;
  scores: ScoreConsensusReport[];
  summary: ScoreConsensusCorpusSummary;
}

export interface ScoreConsensusCorpusOptions {
  corpusRoot: string;
  outputRoot: string;
  /** Optional PDF directory used only for native metadata/rasterization. */
  pdfDir?: string;
  homr?: string;
  rasterize?: boolean;
  dpi?: number;
  nativeManifest?: string;
  timeoutMs?: number;
}

export interface ParsedScoreConsensusArgs extends ScoreConsensusCorpusOptions {
  rasterize: boolean;
  dpi: number;
}

export interface HomrPageScoreInput {
  /** One-based PDF/raster page number. */
  page: number;
  /** Relative raster path retained for diagnostics only. */
  relativePath?: string | null;
  score: OmrScoreInput;
}

export interface HomrPageRunMetadata {
  page: number;
  rasterPage: string | null;
  status: OmrPageResult["status"];
  version: string;
  elapsedMs: number;
  exitCode: number | null;
  musicXmlGenerated: boolean;
  measureCount: number;
  noteCount: number;
  staffCount: number;
  artifactPaths: string[];
  warnings: string[];
  errors: string[];
}

export interface HomrRunMetadata {
  strategy: "one-page-per-invocation";
  /** Requested launcher mode (`auto` may resolve to uvx or the executable fallback). */
  mode: "auto" | "explicit";
  requestedMode?: "auto" | "explicit";
  /** Actual launcher selected by the backend after probing. */
  resolvedMode?: "uvx" | "executable";
  executable: string;
  package: string | null;
  model: string;
  health: "healthy" | "partial" | "unavailable" | "failed";
  /** Wrapper health is derived from the classified page runs. */
  backendHealth: NonNullable<OmrResult["health"]>;
  /** Raw backend health is retained for diagnostics only. */
  rawBackendHealth?: OmrResult["health"];
  requestedPages: number;
  availablePages: number;
  unavailablePages: number;
  failedPages: number;
  invocationCount: number;
  /** One grouped backend call fans out to one HOMR invocation per page. */
  backendCallCount: number;
  invocations: Array<{
    page: number;
    rasterPage: string | null;
    outputDirectory: string;
  }>;
  pages: HomrPageRunMetadata[];
  invocation?: OmrResult["invocation"];
  modelMetadata?: OmrResult["model"];
  resolutionError?: string;
}

export interface HomrPageRunnerOptions {
  scoreId: string;
  outputRoot: string;
  raster?: PdfRasterResult | null;
  homr: string;
  timeoutMs?: number;
  /** Test seam for exercising page aggregation without an external binary. */
  createBackend?: (options: HomrBackendOptions) => OmrBackend;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Stable JSON with no physical paths or runtime timestamps. */
export function canonicalScoreConsensusCorpusJson(value: unknown): string {
  return `${JSON.stringify(stableValue(sanitizeOmrMetadata(value)), null, 2)}\n`;
}

function positiveDuration(value: unknown, timeSignature: unknown, fallback: number): number {
  if (finite(value) && value > 0) return value;
  if (Array.isArray(timeSignature) && timeSignature.length === 2 && finite(timeSignature[0])
    && finite(timeSignature[1]) && timeSignature[0] > 0 && timeSignature[1] > 0) {
    return (timeSignature[0] * 4) / timeSignature[1];
  }
  return fallback;
}

function validHomrPageScore(value: unknown): value is HomrPageScoreInput {
  if (!value || typeof value !== "object") return false;
  const page = (value as Partial<HomrPageScoreInput>).page;
  const score = (value as Partial<HomrPageScoreInput>).score;
  return finite(page) && Number.isInteger(page) && page > 0
    && Boolean(score && typeof score === "object" && Array.isArray(score.parts)
      && score.parts.some((part) => part && typeof part === "object" && Array.isArray(part.measures) && part.measures.length));
}

function homrPageDuration(score: OmrScoreInput): number {
  let duration = 0;
  for (const part of Array.isArray(score.parts) ? score.parts : []) {
    if (!part || typeof part !== "object" || !Array.isArray(part.measures)) continue;
    let cursor = 0;
    for (const measure of part.measures) {
      if (!measure || typeof measure !== "object") continue;
      const start = finite(measure.startBeat) && measure.startBeat >= 0 ? measure.startBeat : cursor;
      const measureDuration = positiveDuration(measure.durationBeats, measure.timeSignature ?? score.timeSignature, 4);
      cursor = start + measureDuration;
      duration = Math.max(duration, cursor);
    }
  }
  return rounded(duration);
}

/**
 * Combine page-local HOMR MusicXML parses into one score input.
 *
 * HOMR emits independent, page-local scores.  Part IDs are prefixed with a
 * zero-padded page namespace (only when needed for lexical ordering), while
 * measure IDs remain local to their part so normalizeOmrScore produces the
 * same namespace exactly once.  Page order and beat offsets are independent
 * of the order in which recognition promises complete.
 */
export function combineHomrPageScores(inputs: readonly HomrPageScoreInput[]): OmrScoreInput | null {
  const pages = inputs
    .filter(validHomrPageScore)
    .map((entry, index) => ({ ...entry, index, relativePath: safeRelativeRasterPath(entry.relativePath) }))
    .sort((left, right) => left.page - right.page
      || compareText(left.relativePath ?? "", right.relativePath ?? "")
      || left.index - right.index);
  if (!pages.length) return null;

  const pageWidth = Math.max(1, String(pages.at(-1)!.page).length);
  const pageOccurrences = new Map<number, number>();
  const parts: OmrScoreInput["parts"] = [];
  let beatOffset = 0;
  for (const page of pages) {
    const occurrence = (pageOccurrences.get(page.page) ?? 0) + 1;
    pageOccurrences.set(page.page, occurrence);
    const pageNamespace = `page-${String(page.page).padStart(pageWidth, "0")}${occurrence > 1 ? `-${occurrence}` : ""}`;
    const sourceParts = Array.isArray(page.score.parts) ? page.score.parts : [];
    const partOccurrences = new Map<string, number>();
    for (const [partIndex, sourcePart] of sourceParts.entries()) {
      if (!sourcePart || typeof sourcePart !== "object" || !Array.isArray(sourcePart.measures)) continue;
      const sourcePartId = typeof sourcePart.id === "string" && sourcePart.id.trim()
        ? sourcePart.id.trim()
        : `part-${partIndex + 1}`;
      const partOccurrence = (partOccurrences.get(sourcePartId) ?? 0) + 1;
      partOccurrences.set(sourcePartId, partOccurrence);
      const partId = `${pageNamespace}:${sourcePartId}${partOccurrence > 1 ? `-${partOccurrence}` : ""}`;
      let cursor = 0;
      const measures = sourcePart.measures.flatMap((sourceMeasure, measureIndex) => {
        if (!sourceMeasure || typeof sourceMeasure !== "object") return [];
        const startBeat = finite(sourceMeasure.startBeat) && sourceMeasure.startBeat >= 0 ? sourceMeasure.startBeat : cursor;
        const durationBeats = positiveDuration(sourceMeasure.durationBeats, sourceMeasure.timeSignature ?? page.score.timeSignature, 4);
        cursor = startBeat + durationBeats;
        const rawMeasureId = typeof sourceMeasure.id === "string" && sourceMeasure.id.trim()
          ? sourceMeasure.id.trim()
          : String(sourceMeasure.number ?? measureIndex + 1);
        const sourceMeasurePrefix = `${sourcePartId}:`;
        const sourceMeasureId = rawMeasureId.startsWith(sourceMeasurePrefix)
          ? rawMeasureId.slice(sourceMeasurePrefix.length)
          : rawMeasureId;
        return [{
          ...sourceMeasure,
          id: sourceMeasureId,
          page: page.page,
          startBeat: rounded(beatOffset + startBeat),
          durationBeats: rounded(durationBeats),
          ...(Array.isArray(sourceMeasure.events) ? { events: sourceMeasure.events.map((event) => ({ ...event })) } : {}),
          ...(Array.isArray(sourceMeasure.rests) ? { rests: sourceMeasure.rests.map((rest) => ({ ...rest })) } : {}),
        }];
      });
      parts.push({ ...sourcePart, id: partId, measures });
    }
    beatOffset = rounded(beatOffset + homrPageDuration(page.score));
  }
  if (!parts.some((part) => part.measures.length)) return null;
  const first = pages[0]!.score;
  return {
    ...(typeof first.title === "string" ? { title: first.title } : {}),
    ...(finite(first.tempoBpm) ? { tempoBpm: first.tempoBpm } : {}),
    ...(first.timeSignature !== undefined ? { timeSignature: first.timeSignature } : {}),
    ...(first.keySignature !== undefined ? { keySignature: first.keySignature } : {}),
    parts,
    metadata: {
      adapter: "homr-page-combination-v1",
      pages: pages.map((page) => page.page),
      pageCount: pages.length,
    },
  };
}

function safePath(value: string, label: string): string {
  if (!value || !isAbsolute(value) || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`${label} must be an absolute single-line path`);
  }
  return resolve(value);
}

function inside(root: string, path: string): boolean {
  const normalizedRoot = resolve(root).replace(/[\\/]$/, "");
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function scoreIdSegment(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".."
    || value.includes("/") || value.includes("\\") || /[\0\r\n]/.test(value)) {
    throw new Error("score ids must be safe single path segments");
  }
  return value;
}

async function assertOutputRoot(outputRoot: string, corpusRoot: string): Promise<void> {
  const root = resolve(outputRoot);
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
  if (inside(repoRoot, root)) throw new Error("score consensus output must be outside the repository");
  if (inside(corpusRoot, root) || inside(root, corpusRoot)) {
    throw new Error("score consensus output must not overlap the input corpus");
  }
  try {
    const entries = await readdir(root);
    if (entries.length) throw new Error("score consensus output must be a fresh empty directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      await mkdir(root, { recursive: true });
      return;
    }
    if (error instanceof Error && /fresh empty directory/.test(error.message)) throw error;
    throw new Error("score consensus output must be a fresh empty directory");
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalScoreConsensusCorpusJson(value), { encoding: "utf8" });
}

function roleEligibility(report: OmrConsensusReport): Record<OmrRole, ScoreConsensusBenchmarkRole> {
  return {
    melody: { ...report.eligibility.melody },
    harmony: { ...report.eligibility.harmony },
    rhythm: { ...report.eligibility.rhythm },
  };
}

function safeRelativeRasterPath(value: unknown): string | null {
  if (typeof value !== "string" || !value || isAbsolute(value)) return null;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function sanitizeRasterResult(value: PdfRasterResult | null | undefined): PdfRasterResult | null {
  if (!value || typeof value !== "object" || !Array.isArray(value.pages)) return null;
  const renderer = value.renderer && typeof value.renderer === "object" ? value.renderer : null;
  const version = renderer && typeof renderer.version === "string" && renderer.version.trim()
    ? renderer.version.trim().slice(0, 120)
    : "unknown";
  const dpi = renderer && finite(renderer.dpi) && Number.isInteger(renderer.dpi) && renderer.dpi > 0 ? renderer.dpi : 300;
  const pages = value.pages
    .filter((page) => page && typeof page === "object" && finite(page.page) && Number.isInteger(page.page) && page.page > 0
      && safeRelativeRasterPath(page.relativePath) !== null)
    .map((page) => ({
      page: page.page,
      relativePath: safeRelativeRasterPath(page.relativePath)!,
      width: finite(page.width) ? page.width : 0,
      height: finite(page.height) ? page.height : 0,
      bytes: finite(page.bytes) ? page.bytes : 0,
      sha256: typeof page.sha256 === "string" ? page.sha256 : "",
    }));
  return {
    renderer: { id: "pdftoppm", version, dpi, format: "png", crop: "none", rotation: 0 },
    pages,
  };
}

function reviewPageRefs(report: OmrConsensusReport, raster: PdfRasterResult | null): ScoreConsensusReviewPageRef[] {
  const pages = new Map<number, string>();
  for (const page of raster?.pages ?? []) {
    if (!finite(page.page)) continue;
    const relativePath = safeRelativeRasterPath(page.relativePath);
    if (relativePath) pages.set(page.page, relativePath);
  }
  return report.reviewItems.map((item) => {
    const measure = report.measures.find((candidate) => candidate.id === item.measureId);
    const page = measure?.page ?? null;
    return {
      measureId: item.measureId,
      number: item.number,
      page,
      system: measure?.system ?? null,
      rasterPage: page === null ? null : pages.get(page) ?? null,
    };
  });
}

function renderScoreReviewMarkdown(report: OmrConsensusReport, pageRefs: readonly ScoreConsensusReviewPageRef[]): string {
  const base = renderOmrReviewMarkdown(report).trimEnd();
  if (!pageRefs.length) return `${base}\n`;
  const lines = [
    base,
    "",
    "## Page/system references",
    "",
    "| Measure | Page | System | Raster page |",
    "| --- | ---: | ---: | --- |",
    ...pageRefs.map((ref) => `| ${ref.number} | ${ref.page ?? "?"} | ${ref.system ?? "?"} | ${ref.rasterPage ?? "unavailable"} |`),
    "",
  ];
  return lines.join("\n");
}

function reportMetadata(input: ScoreConsensusScoreInput, safeMetadata: unknown): unknown {
  const backendRuns = [input.audiveris, ...(input.homr ? [input.homr] : [])]
    .filter((run) => run.metadata !== undefined)
    .map((run) => ({ id: run.id, metadata: sanitizeOmrMetadata(run.metadata) }));
  if (!backendRuns.length) return safeMetadata;
  if (safeMetadata && typeof safeMetadata === "object" && !Array.isArray(safeMetadata)) {
    return { ...(safeMetadata as Record<string, unknown>), backendRuns };
  }
  return { ...(safeMetadata === undefined ? {} : { source: safeMetadata }), backendRuns };
}

/** Build one additive report from already-adapted backend/native evidence. */
export function createScoreConsensusReport(input: ScoreConsensusScoreInput): ScoreConsensusReport {
  const engines = [input.audiveris, ...(input.homr ? [input.homr] : [])];
  const safeMetadata = input.metadata === undefined ? undefined : sanitizeOmrMetadata(input.metadata);
  const consensusMetadata = reportMetadata(input, safeMetadata);
  const safeRaster = sanitizeRasterResult(input.raster);
  const safeNativeDiscovery = input.nativeDiscovery === undefined
    ? undefined
    : sanitizeOmrMetadata(input.nativeDiscovery) as NativeScoreDiscoveryReport;
  const consensus = buildOmrConsensus({
    engines,
    ...(input.native ? { native: input.native } : {}),
    ...(consensusMetadata === undefined ? {} : { metadata: consensusMetadata }),
  });
  const regions = consensus.measures.map((measure) => ({
    measureId: measure.id,
    number: measure.number,
    page: measure.page,
    system: measure.system,
    startBeat: rounded(measure.startBeat),
    endBeat: rounded(measure.startBeat + measure.durationBeats),
    state: measure.state,
    confidence: rounded(measure.confidence),
    review: measure.state === "REVIEW_REQUIRED" || measure.state === "FAILED",
  }));
  return {
    schemaVersion: SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION,
    id: input.id,
    artist: input.artist,
    title: input.title,
    previousStatus: input.previousStatus ?? null,
    source: {
      fileName: typeof input.source.fileName === "string" ? basename(input.source.fileName) : null,
      sha256: typeof input.source.sha256 === "string" ? input.source.sha256 : null,
      bytes: finite(input.source.bytes) ? input.source.bytes : null,
      pages: finite(input.source.pages) ? input.source.pages : null,
    },
    consensus,
    benchmark: roleEligibility(consensus),
    raster: safeRaster,
    ...(safeNativeDiscovery ? { nativeDiscovery: safeNativeDiscovery } : {}),
    regions,
    nonClaims: [
      "OMR output is not ground truth; no notation was manually corrected by this evaluator.",
      "A single engine is reported as TRUSTED_SINGLE_ENGINE, not as independent consensus.",
      "Automated regional trust does not establish recognizability or piano playability.",
    ],
  };
}

/** Deterministic corpus-level before/after report. */
export function summarizeScoreConsensus(
  reports: readonly ScoreConsensusReport[],
  before: { previousReviewRequired?: number; previousFailed?: number } = {},
): ScoreConsensusCorpusSummary {
  const after = {
    trustedNative: reports.filter((report) => report.consensus.summary.state === "TRUSTED_NATIVE").length,
    trustedConsensus: reports.filter((report) => report.consensus.summary.state === "TRUSTED_CONSENSUS").length,
    trustedSingleEngine: reports.filter((report) => report.consensus.summary.state === "TRUSTED_SINGLE_ENGINE").length,
    partiallyTrusted: reports.filter((report) => report.consensus.summary.state === "PARTIALLY_TRUSTED").length,
    reviewRequired: reports.filter((report) => report.consensus.summary.state === "REVIEW_REQUIRED").length,
    failed: reports.filter((report) => report.consensus.summary.state === "FAILED").length,
  };
  const totals = {
    scoreCount: reports.length,
    totalMeasures: reports.reduce((sum, report) => sum + report.consensus.summary.totalMeasures, 0),
    trustedMeasures: reports.reduce((sum, report) => sum + report.consensus.summary.trustedMeasures, 0),
    reviewRequiredMeasures: reports.reduce((sum, report) => sum + report.consensus.summary.reviewRequiredMeasures, 0),
    failedMeasures: reports.reduce((sum, report) => sum + report.consensus.summary.failedMeasures, 0),
    reviewItems: reports.reduce((sum, report) => sum + report.consensus.reviewItems.length, 0),
    benchmarkEligible: {
      melody: reports.filter((report) => report.benchmark.melody.eligible).length,
      harmony: reports.filter((report) => report.benchmark.harmony.eligible).length,
      rhythm: reports.filter((report) => report.benchmark.rhythm.eligible).length,
    },
  };
  const withoutHash = {
    schemaVersion: SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION,
    before: { reviewRequired: before.previousReviewRequired ?? 0, failed: before.previousFailed ?? 0 },
    after,
    totals,
  };
  return {
    ...withoutHash,
    determinismSha256: hashText(canonicalScoreConsensusCorpusJson(withoutHash)),
    nonClaims: [
      "Before/after counts compare report states, not human musical correctness.",
      "Benchmark eligibility is role-specific and does not imply a full-score reference.",
      "Listening-pack inclusion is a spot-check convenience, separate from benchmark eligibility.",
    ],
  };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
  return parsed as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Keep diagnostic context while removing absolute paths from messages. */
function safeDiagnostic(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const redacted = value
    .replace(/(['"])(?:[A-Za-z]:[\\/]|\/)[^'"]*\1/g, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s'"`;,\)\]\r\n]*/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return redacted || null;
}

function scoreFromMetadata(id: string, metadata: Record<string, unknown>): { artist: string; title: string; previousStatus: string | null; source: ScoreConsensusSourceMetadata; omr: Record<string, unknown> } {
  const source = metadata.sourcePdf && typeof metadata.sourcePdf === "object" && !Array.isArray(metadata.sourcePdf)
    ? metadata.sourcePdf as Record<string, unknown>
    : {};
  const omr = metadata.omr && typeof metadata.omr === "object" && !Array.isArray(metadata.omr)
    ? metadata.omr as Record<string, unknown>
    : {};
  const validation = metadata.validation && typeof metadata.validation === "object" && !Array.isArray(metadata.validation)
    ? metadata.validation as Record<string, unknown>
    : {};
  const title = stringValue(metadata.title) ?? id;
  return {
    artist: stringValue(metadata.artist) ?? "Unknown",
    title,
    previousStatus: stringValue(validation.status),
    source: {
      fileName: stringValue(source.fileName),
      sha256: stringValue(source.sha256),
      bytes: finite(source.bytes) ? source.bytes : null,
      pages: finite(source.pages) ? source.pages : null,
    },
    omr,
  };
}

function metadataTitleFromSummary(id: string, summary: Record<string, unknown>): { artist: string; title: string; status: string | null } {
  const scores = Array.isArray(summary.scores) ? summary.scores : [];
  const row = scores.find((value) => value && typeof value === "object" && (value as Record<string, unknown>).id === id) as Record<string, unknown> | undefined;
  return { artist: stringValue(row?.artist) ?? "Unknown", title: stringValue(row?.title) ?? id, status: stringValue(row?.status) };
}

function artifactInputsForNativeManifest(value: unknown, id: string): NativeScoreArtifactInput[] {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const entry = source[id] ?? (source.scores && typeof source.scores === "object" ? (source.scores as Record<string, unknown>)[id] : undefined);
  const values: unknown[] = Array.isArray(entry) ? entry : entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).artifacts)
    ? (entry as Record<string, unknown>).artifacts as unknown[]
    : entry && typeof entry === "object" ? [entry] : [];
  return values.filter((item): item is NativeScoreArtifactInput => Boolean(item && typeof item === "object" && !Array.isArray(item))) as NativeScoreArtifactInput[];
}

async function readOptionalJson(path: string): Promise<Record<string, unknown> | null> {
  try { return parseJsonRecord(await readFile(path, "utf8")); } catch { return null; }
}

async function pathIfFile(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  try { return (await stat(path)).isFile() ? path : null; } catch { return null; }
}

async function findPdf(pdfDir: string | undefined, fileName: string | null): Promise<string | null> {
  if (!pdfDir || !fileName) return null;
  const direct = await pathIfFile(join(pdfDir, basename(fileName)));
  if (direct) return direct;
  try {
    const entries = await readdir(pdfDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === basename(fileName).toLowerCase());
    return match ? pathIfFile(join(pdfDir, match.name)) : null;
  } catch { return null; }
}

function homrUnavailable(): OmrBackendRun {
  return { id: "homr", version: "unavailable", status: "unavailable", error: "optional homr backend is not configured" };
}

function omrRunFromResult(result: OmrResult, score: OmrScoreInput | null): OmrBackendRun {
  return {
    id: result.backend,
    version: result.version,
    status: result.status === "pass" ? "available" : result.status,
    ...(result.health ? { health: result.health } : {}),
    ...(result.pages ? { pages: result.pages.map((page) => ({ ...page })) } : {}),
    ...(result.invocation
      ? { invocation: typeof result.invocation === "string" ? result.invocation : { ...result.invocation } }
      : {}),
    ...(result.model
      ? { model: typeof result.model === "string" ? result.model : { ...result.model } }
      : {}),
    ...(score ? { score } : {}),
    ...(result.errors.length ? { error: result.errors.join("; ") } : {}),
  };
}

function isHomrAuto(value: string): boolean {
  return value === HOMR_AUTO_MODE;
}

function homrModel(result: OmrResult): string {
  const model = (result as { model?: unknown }).model;
  if (typeof model === "string" && model.trim()) return model.trim().slice(0, 120);
  if (model && typeof model === "object") {
    const value = model as { id?: unknown; name?: unknown; version?: unknown };
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "homr";
    const version = typeof value.version === "string" && value.version.trim() ? `@${value.version.trim()}` : "";
    return `${id}${version}`.slice(0, 120);
  }
  return "homr";
}

function homrArtifactPaths(result: OmrResult): string[] {
  return (Array.isArray(result.artifacts) ? result.artifacts : [])
    .map((artifact) => safeRelativeRasterPath(artifact.relativePath))
    .filter((path): path is string => path !== null)
    .sort(compareText);
}

function invocationArtifactPaths(allPaths: readonly string[], index: number, width: number): string[] {
  const invocation = index + 1;
  const names = [...new Set([
    String(invocation),
    String(invocation).padStart(2, "0"),
    String(invocation).padStart(width, "0"),
  ])];
  const prefixes = names.map((name) => `page-${name}/`);
  return allPaths.filter((path) => prefixes.some((prefix) => path.startsWith(prefix))).sort(compareText);
}

function safeResultPages(
  pages: readonly OmrPageResult[],
  pageRuns: readonly HomrPageRunMetadata[],
): OmrBackendPageMetadata[] {
  return pages.map((page, index) => {
    const safe = sanitizeOmrMetadata(page);
    const source = safe && typeof safe === "object" && !Array.isArray(safe)
      ? { ...(safe as Record<string, unknown>) }
      : {};
    const run = pageRuns[index];
    const artifacts = (Array.isArray(page.artifacts) ? page.artifacts : [])
      .map((artifact) => {
        const relativePath = safeRelativeRasterPath(artifact.relativePath);
        return relativePath ? { ...artifact, relativePath } : null;
      })
      .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
      .sort((left, right) => compareText(left.relativePath, right.relativePath));
    return {
      ...source,
      page: page.page,
      ...(run ? {
        status: run.status,
        measureCount: run.measureCount,
        noteCount: run.noteCount,
        staffCount: run.staffCount,
        warnings: run.warnings,
        errors: run.errors,
      } : {}),
      artifacts,
    };
  }) as OmrBackendPageMetadata[];
}

function healthFromHomrPageRuns(pageRuns: readonly HomrPageRunMetadata[]): NonNullable<OmrResult["health"]> {
  const available = pageRuns.filter((page) => page.status === "available").length;
  if (available === pageRuns.length && pageRuns.length > 0) return "available";
  if (available > 0) return "partially-available";
  if (pageRuns.length > 0 && pageRuns.every((page) => page.status === "unavailable")) return "unavailable";
  return "broken-output";
}

function homrBackendForOption(options: HomrPageRunnerOptions): { backend: OmrBackend; mode: "auto" | "explicit"; executable: string; package: string | null } {
  const mode = isHomrAuto(options.homr) ? "auto" : "explicit";
  const backendOptions: HomrBackendOptions = mode === "auto"
    ? {
      packageName: DEFAULT_HOMR_PACKAGE_NAME,
      version: DEFAULT_HOMR_VERSION,
      uvxExecutable: DEFAULT_HOMR_UVX_EXECUTABLE,
      executable: DEFAULT_HOMR_EXECUTABLE,
      preferUvx: DEFAULT_HOMR_PREFER_UVX,
      forceCpu: DEFAULT_HOMR_FORCE_CPU,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }
    : {
      executable: options.homr,
      preferUvx: false,
      forceCpu: DEFAULT_HOMR_FORCE_CPU,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
  const backend = options.createBackend
    ? options.createBackend(backendOptions)
    : createHomrBackend(backendOptions);
  return {
    backend,
    mode,
    executable: mode === "auto" ? DEFAULT_HOMR_UVX_EXECUTABLE : options.homr,
    package: mode === "auto" ? HOMR_UVX_PACKAGE : null,
  };
}

function scoreMeasureCount(score: OmrScoreInput | null): number {
  return score?.parts.reduce((count, part) => Math.max(count, Array.isArray(part?.measures) ? part.measures.length : 0), 0) ?? 0;
}

function scoreNoteCount(score: OmrScoreInput | null): number {
  return score?.parts.reduce((count, part) => count + (Array.isArray(part?.measures)
    ? part.measures.reduce((partCount, measure) => partCount + (Array.isArray(measure?.events) ? measure.events.length : 0), 0)
    : 0), 0) ?? 0;
}

function scoreStaffCount(score: OmrScoreInput | null): number {
  const staves = new Set<string>();
  for (const part of score?.parts ?? []) {
    for (const measure of part?.measures ?? []) {
      for (const staff of measure?.staves ?? []) if (Number.isInteger(staff?.number) && staff.number > 0) staves.add(`${part.id}:${staff.number}`);
      for (const event of measure?.events ?? []) if (Number.isInteger(event?.staff) && event.staff! > 0) staves.add(`${part.id}:${event.staff}`);
    }
  }
  return staves.size;
}

/**
 * Run HOMR once for each raster page and retain every page that parses.
 *
 * A failed page is deliberately omitted from the combined score, but remains
 * visible in metadata and the run error.  This lets usable pages contribute
 * evidence without turning a missing page into an apparently empty measure.
 */
export async function runHomrPages(options: HomrPageRunnerOptions): Promise<OmrBackendRun> {
  const raster = sanitizeRasterResult(options.raster);
  const pages = [...(raster?.pages ?? [])].sort((left, right) => left.page - right.page || compareText(left.relativePath, right.relativePath));
  const mode = isHomrAuto(options.homr) ? "auto" : "explicit";
  const executable = mode === "auto" ? DEFAULT_HOMR_UVX_EXECUTABLE : basename(options.homr);
  const packageName = mode === "auto" ? HOMR_UVX_PACKAGE : null;
  if (!pages.length) {
    return {
      id: "homr",
      version: HOMR_UVX_VERSION,
      status: "unavailable",
      health: "unavailable",
      pages: [],
      error: "HOMR was requested but no raster pages were available",
      metadata: {
        strategy: "one-page-per-invocation",
        mode,
        executable,
        package: packageName,
        model: "homr",
        health: "unavailable",
        backendHealth: "unavailable",
        requestedPages: 0,
        availablePages: 0,
        unavailablePages: 0,
        failedPages: 0,
        invocationCount: 0,
        backendCallCount: 0,
        invocations: [],
        pages: [],
      } satisfies HomrRunMetadata,
    };
  }
  const config = homrBackendForOption(options);
  const pageWidth = Math.max(1, String(pages.at(-1)!.page).length);
  const pageRuns: HomrPageRunMetadata[] = [];
  const pageScores: HomrPageScoreInput[] = [];
  const errors: string[] = [];
  const homrRoot = join(options.outputRoot, "scores", options.scoreId, "backends", "homr");
  const imagePaths = pages.map((page) => join(options.outputRoot, "scores", options.scoreId, "raster", page.relativePath));
  const started = Date.now();
  let result: OmrResult | null = null;
  try {
    result = await config.backend.recognize({ imagePaths, outputDirectory: homrRoot });
  } catch (error) {
    const message = safeDiagnostic(error instanceof Error ? error.message : "HOMR recognition failed");
    if (message) errors.push(message);
  }
  const resultPages = result && Array.isArray(result.pages) ? result.pages : [];
  const allArtifactPaths = result ? homrArtifactPaths(result) : [];
  const model = result ? homrModel(result) : "homr";
  const rawInvocation = result?.invocation === undefined
    ? undefined
    : sanitizeOmrMetadata(result.invocation) as OmrResult["invocation"];
  const rawModel = result?.model === undefined ? undefined : sanitizeOmrMetadata(result.model) as OmrResult["model"];
  // The backend may have fallen back from the requested uvx launcher to an
  // external executable. Preserve only global diagnostics here; per-page
  // errors are reclassified below so they are not duplicated in `error`.
  const backendGlobalErrors = (result?.errors ?? [])
    .filter((error) => typeof error === "string" && !/^HOMR page \d+\b/.test(error))
    .map((error) => safeDiagnostic(error))
    .filter((error): error is string => typeof error === "string" && error.length > 0);
  errors.push(...backendGlobalErrors);
  const invocationRecord = rawInvocation && typeof rawInvocation === "object" && !Array.isArray(rawInvocation)
    ? rawInvocation as unknown as Record<string, unknown>
    : null;
  const resolvedMode: "uvx" | "executable" = invocationRecord?.mode === "uvx" || invocationRecord?.mode === "executable"
    ? invocationRecord.mode
    : mode === "auto" ? "uvx" : "executable";
  const resolvedExecutable = typeof invocationRecord?.executable === "string" && invocationRecord.executable.trim()
    ? invocationRecord.executable.trim().slice(0, 120)
    : resolvedMode === "uvx" ? DEFAULT_HOMR_UVX_EXECUTABLE : basename(options.homr);
  const resolvedPackage = resolvedMode === "uvx"
    ? typeof invocationRecord?.packageName === "string" && invocationRecord.packageName.trim()
      ? invocationRecord.packageName.trim().slice(0, 120)
      : packageName
    : null;
  const resolutionError = backendGlobalErrors.find((error) => /resolution failed|model acquisition/i.test(error));
  for (const [index, page] of pages.entries()) {
    const rasterPage = safeRelativeRasterPath(page.relativePath);
    // Backend pages are numbered by invocation (1..N), while raster page
    // numbers may be sparse (for example pages 2 and 10).  Positional lookup
    // is therefore the only stable association between the two arrays.
    const backendPage = resultPages[index];
    const directArtifacts = (Array.isArray(backendPage?.artifacts) ? backendPage.artifacts : [])
      .map((artifact) => safeRelativeRasterPath(artifact.relativePath))
      .filter((path): path is string => path !== null)
      .sort(compareText);
    const pageArtifacts = directArtifacts.length
      ? directArtifacts
      : invocationArtifactPaths(allArtifactPaths, index, pageWidth);
    const parseErrors: string[] = [];
    let score: OmrScoreInput | null = null;
    for (const artifactPath of pageArtifacts) {
      try {
        const parsed = parseOmrMusicXmlBytes(await readFile(join(homrRoot, artifactPath))).score;
        if (scoreMeasureCount(parsed) > 0 && scoreNoteCount(parsed) > 0) {
          score = parsed;
          break;
        }
        parseErrors.push(`${artifactPath}: parsed score has no pitched notes`);
      } catch (error) {
        const detail = safeDiagnostic(error instanceof Error ? error.message : "invalid MusicXML");
        parseErrors.push(`${artifactPath}: ${detail ?? "invalid MusicXML"}`);
      }
    }
    if (!score && !pageArtifacts.length && result) parseErrors.push("HOMR produced no MusicXML artifact");
    const rawStatus = backendPage?.status;
    const outputBroken = !score && (pageArtifacts.length > 0 || result?.status === "pass");
    const status: OmrPageResult["status"] = outputBroken
      ? "broken-output"
      : score && rawStatus !== "unavailable" && rawStatus !== "failed" && rawStatus !== "broken-output"
        ? "available"
        : rawStatus ?? (result?.status === "unavailable" ? "unavailable" : "failed");
    const pageErrors = [...(backendPage?.errors ?? []), ...parseErrors]
      .map((error) => safeDiagnostic(error))
      .filter((error): error is string => Boolean(error));
    const pageWarnings = [...(backendPage?.warnings ?? [])]
      .map((warning) => safeDiagnostic(warning))
      .filter((warning): warning is string => Boolean(warning));
    if (pageErrors.length) errors.push(`page ${page.page}: ${pageErrors.join("; ")}`);
    pageRuns.push({
      page: page.page,
      rasterPage,
      status,
      version: backendPage?.page ? result?.version ?? config.backend.version ?? "unknown" : result?.version ?? config.backend.version ?? "unknown",
      elapsedMs: finite(backendPage?.elapsedMs) ? backendPage!.elapsedMs : Math.max(0, Date.now() - started),
      exitCode: backendPage?.exitCode === null || finite(backendPage?.exitCode) ? backendPage.exitCode : result ? (status === "available" ? 0 : null) : null,
      musicXmlGenerated: pageArtifacts.length > 0,
      measureCount: score ? (finite(backendPage?.measureCount) ? backendPage!.measureCount : scoreMeasureCount(score)) : 0,
      noteCount: score ? (finite(backendPage?.noteCount) ? backendPage!.noteCount : scoreNoteCount(score)) : 0,
      staffCount: score ? (finite(backendPage?.staffCount) ? backendPage!.staffCount : scoreStaffCount(score)) : 0,
      artifactPaths: pageArtifacts,
      warnings: pageWarnings,
      errors: pageErrors,
    });
    if (score && status === "available") pageScores.push({ page: page.page, relativePath: rasterPage, score });
  }
  const availablePages = pageRuns.filter((page) => page.status === "available").length;
  const unavailablePages = pageRuns.filter((page) => page.status === "unavailable").length;
  const failedPages = pageRuns.filter((page) => page.status !== "available" && page.status !== "unavailable").length;
  const backendHealth = healthFromHomrPageRuns(pageRuns);
  const rawBackendHealth = result?.health;
  const health: HomrRunMetadata["health"] = backendHealth === "available"
    ? "healthy"
    : backendHealth === "partially-available"
      ? "partial"
      : backendHealth === "unavailable"
        ? "unavailable"
        : "failed";
  const score = combineHomrPageScores(pageScores);
  const metadata: HomrRunMetadata = {
    strategy: "one-page-per-invocation",
    mode: config.mode,
    requestedMode: config.mode,
    resolvedMode,
    executable: resolvedExecutable,
    package: resolvedPackage,
    model,
    health,
    backendHealth,
    requestedPages: pages.length,
    availablePages,
    unavailablePages,
    failedPages,
    invocationCount: pages.length,
    backendCallCount: result ? 1 : 0,
    invocations: pageRuns.map((page) => ({
      page: page.page,
      rasterPage: page.rasterPage,
      outputDirectory: "scores/" + options.scoreId + "/backends/homr",
    })),
    pages: pageRuns,
    ...(rawInvocation !== undefined ? { invocation: rawInvocation } : {}),
    ...(rawModel !== undefined ? { modelMetadata: rawModel } : {}),
    ...(rawBackendHealth !== undefined ? { rawBackendHealth } : {}),
    ...(resolutionError ? { resolutionError } : {}),
  };
  const safePages: OmrBackendPageMetadata[] = resultPages.length
    ? safeResultPages(resultPages, pageRuns)
    : pageRuns.map((page) => ({ ...page }));
  return {
    id: "homr",
    version: result?.version ?? config.backend.version ?? "unknown",
    status: score ? "available" : backendHealth === "unavailable" ? "unavailable" : "failed",
    health: backendHealth,
    pages: safePages,
    ...(rawInvocation !== undefined
      ? { invocation: rawInvocation as unknown as NonNullable<OmrBackendRun["invocation"]> }
      : {}),
    ...(rawModel !== undefined ? { model: rawModel } : {}),
    ...(score ? { score } : {}),
    ...(errors.length ? { error: errors.join("; ") } : {}),
    metadata,
  };
}

async function runOneScore(
  corpusRoot: string,
  outputRoot: string,
  scoreId: string,
  options: ParsedScoreConsensusArgs,
  nativeManifest: unknown,
): Promise<ScoreConsensusReport> {
  const scoreRoot = join(corpusRoot, "scores", scoreId);
  const metadata = await readOptionalJson(join(scoreRoot, "source-metadata.json")) ?? {};
  const summary = scoreFromMetadata(scoreId, metadata);
  const corpusSummary = await readOptionalJson(join(corpusRoot, "corpus-summary.json"));
  const summaryTitle = corpusSummary ? metadataTitleFromSummary(scoreId, corpusSummary) : { artist: "Unknown", title: scoreId, status: null };
  const artist = summary.artist === "Unknown" ? summaryTitle.artist : summary.artist;
  const title = summary.title === scoreId ? summaryTitle.title : summary.title;
  const xmlPath = await pathIfFile(join(scoreRoot, "normalized", "reference.musicxml"));
  let parsed: OmrScoreInput | null = null;
  if (xmlPath) {
    try { parsed = parseOmrMusicXml(await readFile(xmlPath, "utf8")).score; } catch { parsed = null; }
  }
  const audiverisStatus = stringValue(summary.omr.status)?.toLowerCase() === "pass" ? "available" : parsed ? "available" : "failed";
  const audiveris: OmrBackendRun = {
    id: "audiveris",
    version: stringValue(summary.omr.version) ?? "unknown",
    status: audiverisStatus,
    ...(parsed ? { score: parsed } : {}),
    ...(!parsed ? { error: "existing Audiveris normalized MusicXML is unavailable" } : {}),
  };
  let raster: PdfRasterResult | null = null;
  const pdfPath = await findPdf(options.pdfDir, summary.source.fileName ?? null);
  if (options.rasterize && pdfPath) {
    const rasterRoot = join(outputRoot, "scores", scoreId, "raster");
    try {
      raster = await createPdfRasterizer({ timeoutMs: options.timeoutMs }).rasterize({ pdfPath, outputDirectory: rasterRoot, dpi: options.dpi });
      await writeJson(join(rasterRoot, "manifest.json"), raster);
    } catch (error) {
      await writeJson(join(rasterRoot, "manifest.json"), { status: "unavailable", reason: error instanceof Error ? error.message : "rasterization unavailable" });
    }
  }
  const homr = options.homr
    ? await runHomrPages({ scoreId, outputRoot, raster, homr: options.homr, timeoutMs: options.timeoutMs })
    : homrUnavailable();
  const nativeArtifacts = artifactInputsForNativeManifest(nativeManifest, scoreId);
  let nativeDiscovery: NativeScoreDiscoveryReport | undefined;
  if (pdfPath || nativeArtifacts.length) {
    nativeDiscovery = await discoverNativeScoreArtifacts({
      ...(pdfPath ? { pdfPath } : {}),
      ...(nativeArtifacts.length ? { nativeArtifacts } : {}),
      omr: [{ id: "audiveris", backend: "Audiveris", version: audiveris.version, status: audiveris.status }],
    }, { ...(pdfPath ? { allowedRoots: [dirname(pdfPath)] } : {}) });
  }
  const report = createScoreConsensusReport({
    id: scoreId,
    artist,
    title,
    previousStatus: summary.previousStatus ?? summaryTitle.status,
    source: summary.source,
    audiveris,
    homr,
    raster,
    ...(nativeDiscovery ? { nativeDiscovery } : {}),
    metadata: { corpus: "existing-audiveris", pdfAvailable: Boolean(pdfPath), xmlAvailable: Boolean(xmlPath) },
  });
  const outScore = join(outputRoot, "scores", scoreId);
  const pageRefs = reviewPageRefs(report.consensus, report.raster);
  await writeJson(join(outScore, "consensus", "report.json"), report);
  await writeJson(join(outScore, "consensus", "regions.json"), { schemaVersion: 1, regions: report.regions });
  await writeJson(join(outScore, "consensus", "events.json"), {
    schemaVersion: 1,
    source: report.consensus.measures.length ? "trusted-regions" : "none",
    events: selectOmrConsensusEvents(report.consensus),
    nonClaims: ["Events are the selected trusted OMR evidence, not a manually corrected score or musical ground truth."],
  });
  await writeJson(join(outScore, "review", "items.json"), { schemaVersion: 1, items: report.consensus.reviewItems, pageRefs });
  await writeFile(join(outScore, "review", "REVIEW.md"), renderScoreReviewMarkdown(report.consensus, pageRefs), { encoding: "utf8" });
  if (nativeDiscovery) await writeJson(join(outScore, "native", "discovery.json"), nativeDiscovery);
  return report;
}

/** Read the existing corpus, run the optional consensus lanes, and write a fresh report root. */
export async function runScoreConsensusCorpus(options: ScoreConsensusCorpusOptions): Promise<ScoreConsensusCorpusResult> {
  const corpusRoot = safePath(options.corpusRoot, "corpus root");
  const outputRoot = safePath(options.outputRoot, "output root");
  await assertOutputRoot(outputRoot, corpusRoot);
  const pdfDir = options.pdfDir ? safePath(options.pdfDir, "PDF directory") : undefined;
  const nativeManifestPath = options.nativeManifest ? safePath(options.nativeManifest, "native manifest") : undefined;
  const parsedOptions: ParsedScoreConsensusArgs = {
    ...options,
    ...(pdfDir ? { pdfDir } : {}),
    ...(nativeManifestPath ? { nativeManifest: nativeManifestPath } : {}),
    rasterize: options.rasterize === true,
    dpi: finite(options.dpi) && options.dpi >= 150 && options.dpi <= 600 ? Math.round(options.dpi) : 300,
  };
  const prior = await readOptionalJson(join(corpusRoot, "corpus-summary.json"));
  const source = await readdir(join(corpusRoot, "scores"), { withFileTypes: true });
  const directoryIds = source.filter((entry) => entry.isDirectory()).map((entry) => scoreIdSegment(entry.name));
  const summaryIds = (Array.isArray(prior?.scores) ? prior.scores : [])
    .map((entry) => entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : null)
    .filter((id): id is string => typeof id === "string")
    .map(scoreIdSegment);
  const scoreIds = [...new Set([...directoryIds, ...summaryIds])].sort(compareText);
  let nativeManifest: unknown = null;
  if (nativeManifestPath) {
    try { nativeManifest = JSON.parse(await readFile(nativeManifestPath, "utf8")) as unknown; } catch { nativeManifest = null; }
  }
  const reports: ScoreConsensusReport[] = [];
  for (const scoreId of scoreIds) reports.push(await runOneScore(corpusRoot, outputRoot, scoreId, parsedOptions, nativeManifest));
  const priorScores = Array.isArray(prior?.scores) ? prior.scores : [];
  const before = {
    previousReviewRequired: priorScores.filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).status === "REVIEW_REQUIRED").length,
    previousFailed: priorScores.filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).status === "FAILED").length,
  };
  const summary = summarizeScoreConsensus(reports, before);
  const result: ScoreConsensusCorpusResult = { schemaVersion: SCORE_CONSENSUS_CORPUS_SCHEMA_VERSION, output: "[local-output]", scores: reports, summary };
  await writeJson(join(outputRoot, "consensus-summary.json"), { ...result, output: "[local-output]" });
  await writeFile(join(outputRoot, "consensus-summary.md"), renderCorpusSummaryMarkdown(reports, summary), { encoding: "utf8" });
  return result;
}

export function renderCorpusSummaryMarkdown(reports: readonly ScoreConsensusReport[], summary: ScoreConsensusCorpusSummary): string {
  const lines = [
    "# Score consensus corpus",
    "",
    "This is local evaluation evidence. OMR output is not ground truth and no score was manually corrected.",
    "",
    `Before: ${summary.before.reviewRequired} REVIEW_REQUIRED, ${summary.before.failed} FAILED`,
    `After: ${summary.after.trustedNative} TRUSTED_NATIVE, ${summary.after.trustedConsensus} TRUSTED_CONSENSUS, ${summary.after.trustedSingleEngine} TRUSTED_SINGLE_ENGINE, ${summary.after.partiallyTrusted} PARTIALLY_TRUSTED, ${summary.after.reviewRequired} REVIEW_REQUIRED, ${summary.after.failed} FAILED`,
    "",
    "| Score | State | Measures | Trusted | Review | Failed | Melody eligible | Raster | HOMR |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
  ];
  for (const report of reports) lines.push(`| ${report.artist} — ${report.title} | ${report.consensus.summary.state} | ${report.consensus.summary.totalMeasures} | ${report.consensus.summary.trustedMeasures} | ${report.consensus.summary.reviewRequiredMeasures} | ${report.consensus.summary.failedMeasures} | ${report.benchmark.melody.eligible ? "yes" : "no"} | ${report.raster ? `${report.raster.pages.length} pages` : "unavailable"} | ${report.consensus.backends.find((backend) => backend.id === "homr")?.status ?? "unavailable"} |`);
  lines.push("", `Targeted review items: ${summary.totals.reviewItems}`, "", "Non-claims: no human listening gate, no manual notation correction, no trusted native symbolic reference unless explicitly verified.", "");
  return lines.join("\n");
}

function requiredValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseScoreConsensusArgs(argv: readonly string[]): ParsedScoreConsensusArgs {
  const result: ParsedScoreConsensusArgs = { corpusRoot: "", outputRoot: "", rasterize: false, dpi: 300 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const flag = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = requiredValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--corpus": result.corpusRoot = value(); break;
      case "--out": result.outputRoot = value(); break;
      case "--pdf-dir": result.pdfDir = value(); break;
      case "--homr": {
        // `--homr` is an explicit opt-in to the pinned uvx runner.  A value
        // remains an executable path/name for offline/local installations.
        if (inline !== undefined) {
          if (!inline.trim()) throw new Error("--homr requires a non-empty value");
          result.homr = inline;
        } else {
          const next = argv[index + 1];
          if (!next || next.startsWith("--")) result.homr = HOMR_AUTO_MODE;
          else result.homr = value();
        }
        break;
      }
      case "--native-manifest": result.nativeManifest = value(); break;
      case "--timeout-ms": result.timeoutMs = positiveInt(value(), flag); break;
      case "--rasterize": result.rasterize = true; break;
      case "--no-raster": result.rasterize = false; break;
      case "--dpi": result.dpi = positiveInt(value(), flag); break;
      case "--help": case "-h": throw new Error(scoreConsensusUsage());
      default: throw new Error(`unknown option: ${arg}\n${scoreConsensusUsage()}`);
    }
  }
  if (!result.corpusRoot) throw new Error(`--corpus is required\n${scoreConsensusUsage()}`);
  if (!result.outputRoot) throw new Error(`--out is required\n${scoreConsensusUsage()}`);
  if (result.dpi < 150 || result.dpi > 600) throw new Error("--dpi must be between 150 and 600");
  return result;
}

export function scoreConsensusUsage(): string {
  return [
    "Usage: run-score-consensus.ts --corpus DIR --out DIR [options]",
    "  --corpus DIR          existing local score corpus root",
    "  --out DIR             fresh output root outside the repository",
    "  --pdf-dir DIR         optional local PDF directory for raster/native metadata",
    "  --rasterize           rasterize available PDFs to deterministic PNG pages",
    "  --dpi N               raster DPI, 150-600 (default 300)",
    "  --homr [FILE]         optional HOMR executable; bare flag uses pinned uvx",
    "  --native-manifest FILE  explicit local native artifact manifest (never fetched)",
    "  --timeout-ms N        optional external command timeout",
  ].join("\n");
}

export async function runScoreConsensusCli(argv: readonly string[]): Promise<number> {
  try {
    const options = parseScoreConsensusArgs(argv);
    const result = await runScoreConsensusCorpus(options);
    process.stdout.write(`${JSON.stringify({ output: result.output, summary: result.summary }, null, 2)}\n`);
    return result.summary.after.failed ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "score consensus failed"}\n`);
    return 1;
  }
}
