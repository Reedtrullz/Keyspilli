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
  createPdfRasterizer,
  type OmrResult,
  type PdfRasterResult,
} from "./omr-backends.js";
import {
  buildOmrConsensus,
  renderOmrReviewMarkdown,
  sanitizeOmrMetadata,
  selectOmrConsensusEvents,
  type OmrBackendRun,
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

/** Build one additive report from already-adapted backend/native evidence. */
export function createScoreConsensusReport(input: ScoreConsensusScoreInput): ScoreConsensusReport {
  const engines = [input.audiveris, ...(input.homr ? [input.homr] : [])];
  const safeMetadata = input.metadata === undefined ? undefined : sanitizeOmrMetadata(input.metadata);
  const safeRaster = sanitizeRasterResult(input.raster);
  const safeNativeDiscovery = input.nativeDiscovery === undefined
    ? undefined
    : sanitizeOmrMetadata(input.nativeDiscovery) as NativeScoreDiscoveryReport;
  const consensus = buildOmrConsensus({
    engines,
    ...(input.native ? { native: input.native } : {}),
    ...(safeMetadata === undefined ? {} : { metadata: safeMetadata }),
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
    ...(score ? { score } : {}),
    ...(result.errors.length ? { error: result.errors.join("; ") } : {}),
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
  let homr = homrUnavailable();
  if (options.homr && raster?.pages.length) {
    const homrRoot = join(outputRoot, "scores", scoreId, "backends", "homr");
    try {
      const result = await createHomrBackend({ executable: options.homr, timeoutMs: options.timeoutMs }).recognize({ imagePaths: raster.pages.map((page) => join(outputRoot, "scores", scoreId, "raster", page.relativePath)), outputDirectory: homrRoot });
      let homrScore: OmrScoreInput | null = null;
      const firstArtifact = result.artifacts[0];
      if (firstArtifact) {
        try { homrScore = parseOmrMusicXmlBytes(await readFile(join(homrRoot, firstArtifact.relativePath))).score; } catch { homrScore = null; }
      }
      homr = omrRunFromResult(result, homrScore);
    } catch (error) {
      homr = { id: "homr", version: "unknown", status: "failed", error: error instanceof Error ? error.message : "homr recognition failed" };
    }
  }
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
      case "--homr": result.homr = value(); break;
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
    "  --homr FILE           optional HOMR executable; otherwise recorded unavailable",
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
