/**
 * Optional, evaluation-only OMR and page-rasterization adapters.
 *
 * The normal catalog/transcription runtime never constructs these adapters.
 * They are deliberately thin wrappers around command-line tools so CI can
 * exercise their contracts without installing Audiveris, homr, or Poppler.
 * Every command is invoked with execFile (shell disabled), and result paths
 * are represented relative to the caller-owned output directory.
 */
import { execFile as execFileCallback, type ExecFileException, type ExecFileOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { OmrScoreInput } from "./omr-consensus.js";
import { parseOmrMusicXmlBytes } from "./omr-musicxml.js";

const execFileDefault = promisify(execFileCallback) as unknown as OmrCommandRunner;
const DEFAULT_RASTER_DPI = 300;
const MIN_RASTER_DPI = 150;
const MAX_RASTER_DPI = 600;
const DEFAULT_FIRST_PAGE = 1;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const HOMR_DEFAULTS = Object.freeze({
  packageName: "homr",
  version: "0.7.0",
  uvxExecutable: "uvx",
  executable: "homr",
  preferUvx: true,
  forceCpu: true,
} as const);
export const DEFAULT_HOMR_PACKAGE_NAME = HOMR_DEFAULTS.packageName;
export const DEFAULT_HOMR_VERSION = HOMR_DEFAULTS.version;
export const DEFAULT_HOMR_UVX_EXECUTABLE = HOMR_DEFAULTS.uvxExecutable;
export const DEFAULT_HOMR_EXECUTABLE = HOMR_DEFAULTS.executable;
export const DEFAULT_HOMR_PREFER_UVX = HOMR_DEFAULTS.preferUvx;
export const DEFAULT_HOMR_FORCE_CPU = HOMR_DEFAULTS.forceCpu;
/** Compatibility aliases for callers that prefer a HOMR-prefixed constant. */
export const HOMR_DEFAULT_PACKAGE_NAME = HOMR_DEFAULTS.packageName;
export const HOMR_DEFAULT_VERSION = HOMR_DEFAULTS.version;
export const HOMR_DEFAULT_UVX_EXECUTABLE = HOMR_DEFAULTS.uvxExecutable;
export const HOMR_DEFAULT_EXECUTABLE = HOMR_DEFAULTS.executable;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type OmrCommandRunner = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type OmrResultStatus = "pass" | "unavailable" | "failed";
export type OmrArtifactFormat = "mxl" | "musicxml" | "xml" | "unknown";
export type OmrHealth = "available" | "partially-available" | "unavailable" | "broken-output";
export type OmrPageStatus = "available" | "unavailable" | "failed" | "broken-output";

export type HomrPreprocessingVariant =
  | "original"
  | "grayscale"
  | "grayscale-contrast"
  | "grayscale-binarize"
  | "grayscale-binarize-trim";

export type HomrFailureClass =
  | "unavailable"
  | "invalid-input"
  | "process-failed"
  | "timeout"
  | "signal"
  | "no-output"
  | "broken-output";

export const HOMR_PREPROCESSING_LADDER = Object.freeze([
  { variant: "original", recipe: "identity" },
  { variant: "grayscale", recipe: "grayscale(luma=0.299,0.587,0.114)" },
  { variant: "grayscale-contrast", recipe: "grayscale+contrast(min-max)" },
  { variant: "grayscale-binarize", recipe: "grayscale+threshold(128)" },
  { variant: "grayscale-binarize-trim", recipe: "grayscale+threshold(128)+whitespace-trim(conservative)" },
] as const);

export interface HomrPageAttempt {
  attempt: number;
  variant: HomrPreprocessingVariant;
  recipe: string;
  sourceSha256: string;
  inputSha256: string | null;
  relativeInput: string;
  status: OmrPageStatus;
  recovery?: "not-needed" | "retryable" | "recovered" | "exhausted";
  failureClass?: HomrFailureClass;
  rootCause?: string;
  trusted: boolean;
  elapsedMs: number;
  exitCode: number | null;
  signal?: string | null;
  artifacts: OmrArtifact[];
  measureCount: number;
  noteCount: number;
  staffCount: number;
  warnings: string[];
  errors: string[];
}

export interface HomrPageRecovery {
  attempted: boolean;
  recovered: boolean;
  selectedAttempt: number | null;
  attempts: number;
  maxAttempts: number;
  strategy: "deterministic-preprocessing-ladder";
}

export interface OmrRecognizeInput {
  /** Page images prepared by the deterministic PDF rasterizer. */
  imagePaths: readonly string[];
  /** A caller-owned directory for raw backend output. */
  outputDirectory: string;
}

export interface OmrArtifact {
  /** Always relative to OmrRecognizeInput.outputDirectory. */
  relativePath: string;
  format: OmrArtifactFormat;
  bytes: number;
  sha256: string;
}

export interface OmrPageResult {
  page: number;
  /** Always relative to OmrRecognizeInput.outputDirectory. */
  relativeInput: string;
  status: OmrPageStatus;
  elapsedMs: number;
  /** Zero for a successful process; null when no process was started. */
  exitCode: number | null;
  artifacts: OmrArtifact[];
  measureCount: number;
  noteCount: number;
  staffCount: number;
  warnings: string[];
  errors: string[];
  failureClass?: HomrFailureClass;
  rootCause?: string;
  attempts?: HomrPageAttempt[];
  recovery?: HomrPageRecovery;
}

export interface OmrInvocationMetadata {
  /** The logical launcher selected for this run, never an absolute path. */
  mode: "uvx" | "executable";
  executable: string;
  packageName: string;
  version: string;
  forceCpu: boolean;
  perPage: true;
  /** The shell-free argument template with a relative-input placeholder. */
  args: string[];
}

export interface OmrModelMetadata {
  id: "homr";
  packageName: string;
  version: string;
  runtime: "uvx" | "executable";
  forceCpu: boolean;
  /** How weights are acquired; paths are intentionally never emitted. */
  source: "uvx-managed-cache" | "external-executable" | "unknown";
  cache: "uv-cache" | "external" | "unknown";
  /** Optional weight records when a caller supplies/derives them safely. */
  files?: Array<{ name: string; bytes: number; sha256: string }>;
  [key: string]: unknown;
}

export interface OmrResult {
  backend: string;
  version: string;
  status: OmrResultStatus;
  artifacts: OmrArtifact[];
  warnings: string[];
  errors: string[];
  health?: OmrHealth;
  pages?: OmrPageResult[];
  invocation?: OmrInvocationMetadata;
  /** HOMR uses the structured metadata form; string remains accepted for older corpus callers. */
  model?: OmrModelMetadata | string;
}

/** Common adapter contract for an optional external OMR engine. */
export interface OmrBackend {
  readonly id: string;
  /** `unknown` until a lazy probe or recognition run discovers a version. */
  readonly version: string;
  recognize(input: OmrRecognizeInput): Promise<OmrResult>;
}

export interface OmrBackendOptions {
  executable?: string;
  /** Supplying a version skips the lazy external probe. */
  version?: string;
  timeoutMs?: number;
  execFile?: OmrCommandRunner;
}

export interface HomrBackendOptions extends OmrBackendOptions {
  /** Python distribution passed to uvx's `--from` option. */
  packageName?: string;
  /** Pinned Python distribution version used by uvx. */
  version?: string;
  /** uvx launcher to probe and invoke when preferred. */
  uvxExecutable?: string;
  /** Prefer uvx and fall back to executable when uvx is unavailable. */
  preferUvx?: boolean;
  /** Pass HOMR's explicit CPU switch (`--gpu no`). */
  forceCpu?: boolean;
}

export interface PdfRasterConfig {
  dpi: number;
  format: "png";
  crop: "none";
  rotation: 0;
  firstPage: number;
  lastPage: number | null;
}

export interface PdfRasterInput {
  pdfPath: string;
  outputDirectory: string;
  dpi?: number;
  firstPage?: number;
  lastPage?: number | null;
}

export interface PdfRasterCommandInput {
  pdfPath: string;
  outputPrefix: string;
  dpi?: number;
  firstPage?: number;
  lastPage?: number | null;
}

export interface RasterPageMetadata {
  page: number;
  /** Always relative to the rasterizer output directory. */
  relativePath: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface PdfRasterResult {
  renderer: {
    id: "pdftoppm";
    version: string;
    dpi: number;
    format: "png";
    crop: "none";
    rotation: 0;
  };
  pages: RasterPageMetadata[];
}

export interface PdfRasterizer {
  readonly id: "pdftoppm";
  rasterize(input: PdfRasterInput): Promise<PdfRasterResult>;
}

export interface PdfRasterizerOptions {
  executable?: string;
  version?: string;
  timeoutMs?: number;
  execFile?: OmrCommandRunner;
}

export class OmrBackendError extends Error {
  readonly code: "INVALID_INPUT" | "UNAVAILABLE" | "FAILED";
  readonly cause?: unknown;

  constructor(code: OmrBackendError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "OmrBackendError";
    this.code = code;
    this.cause = cause;
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathInput(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new OmrBackendError("INVALID_INPUT", `Invalid ${label}: path must be a non-empty single-line path`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!finite(value) || !Number.isInteger(value) || value <= 0) {
    throw new OmrBackendError("INVALID_INPUT", `Invalid ${label}: expected a positive integer`);
  }
  return value;
}

function timeoutValue(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  return finite(value) && Number.isInteger(value) && value > 0 && value <= 24 * 60 * 60 * 1000
    ? value
    : (() => { throw new OmrBackendError("INVALID_INPUT", "Invalid OMR command timeout"); })();
}

/** Resolve fixed, reproducible page-rendering settings without probing tools. */
export function resolvePdfRasterConfig(input: Partial<PdfRasterConfig> = {}): PdfRasterConfig {
  const dpi = input.dpi ?? DEFAULT_RASTER_DPI;
  if (!finite(dpi) || !Number.isInteger(dpi) || dpi < MIN_RASTER_DPI || dpi > MAX_RASTER_DPI) {
    throw new OmrBackendError("INVALID_INPUT", `Invalid raster DPI: expected an integer between ${MIN_RASTER_DPI} and ${MAX_RASTER_DPI}`);
  }
  const firstPage = input.firstPage ?? DEFAULT_FIRST_PAGE;
  positiveInteger(firstPage, "first page");
  const lastPage = input.lastPage === undefined || input.lastPage === null ? null : positiveInteger(input.lastPage, "last page");
  if (lastPage !== null && lastPage < firstPage) {
    throw new OmrBackendError("INVALID_INPUT", "Invalid raster page range: last page precedes first page");
  }
  if (input.format !== undefined && input.format !== "png") throw new OmrBackendError("INVALID_INPUT", "Only PNG rasterization is supported");
  if (input.crop !== undefined && input.crop !== "none") throw new OmrBackendError("INVALID_INPUT", "Raster crop must be none for deterministic output");
  if (input.rotation !== undefined && input.rotation !== 0) throw new OmrBackendError("INVALID_INPUT", "Raster rotation must be zero for deterministic output");
  return { dpi, format: "png", crop: "none", rotation: 0, firstPage, lastPage };
}

/** Build the shell-free Poppler command used by the rasterizer. */
export function buildPdfRasterArgs(input: PdfRasterCommandInput): string[] {
  const pdfPath = pathInput(input.pdfPath, "PDF");
  const outputPrefix = pathInput(input.outputPrefix, "raster output");
  const config = resolvePdfRasterConfig({ dpi: input.dpi, firstPage: input.firstPage, lastPage: input.lastPage });
  const args = ["-r", String(config.dpi), "-png", "-f", String(config.firstPage)];
  if (config.lastPage !== null) args.push("-l", String(config.lastPage));
  args.push(pdfPath, outputPrefix);
  return args;
}

function extractVersion(value: string): string {
  const match = value.match(/(?:^|\s|[=:])v?(\d+\.\d+(?:\.\d+){0,3}(?:[-+._][0-9A-Za-z.-]+)?)(?=\s|$|[^0-9A-Za-z])/m);
  return match?.[1] ?? "unknown";
}

function commandMessage(error: unknown, sensitivePaths: readonly string[] = []): string {
  if (!error || typeof error !== "object") return "external command failed";
  const value = error as { stderr?: unknown; message?: unknown };
  const detail = typeof value.stderr === "string" ? value.stderr.trim().split(/\r?\n/).at(-1) : undefined;
  const raw = detail || (typeof value.message === "string" ? value.message : "external command failed");
  // Never put a local path, command argv, or credentials into a report.
  return sensitivePaths.reduce((message, path) => message.split(path).join("[redacted-path]"), raw)
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s'"`;,)]*/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

function missingExecutable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as ExecFileException & { code?: string | number }).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === 127;
}

function numericExitCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

function signalValue(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const signal = (error as { signal?: unknown }).signal;
  return typeof signal === "string" && signal.trim() ? signal.trim().slice(0, 32) : null;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; killed?: unknown; message?: unknown };
  return value.code === "ETIMEDOUT" || (value.killed === true && /timed? ?out|timeout/i.test(typeof value.message === "string" ? value.message : ""));
}

/** Keep tool diagnostics useful without allowing local paths into reports. */
function sanitizedStderr(errorOrStderr: unknown, sensitivePaths: readonly string[] = []): string | null {
  const raw = typeof errorOrStderr === "string"
    ? errorOrStderr
    : errorOrStderr && typeof errorOrStderr === "object" && typeof (errorOrStderr as { stderr?: unknown }).stderr === "string"
      ? (errorOrStderr as { stderr: string }).stderr
      : errorOrStderr && typeof errorOrStderr === "object" && typeof (errorOrStderr as { message?: unknown }).message === "string"
        ? (errorOrStderr as { message: string }).message
      : "";
  if (!raw.trim()) return null;
  const redacted = sensitivePaths.reduce((message, path) => message.split(path).join("[redacted-path]"), raw)
    .replace(/(['"])(?:[A-Za-z]:[\\/]|\/)[^'"]*\1/g, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^'"`;,)\r\n]*/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return redacted || null;
}

function commandDiagnostic(error: unknown, sensitivePaths: readonly string[] = []): string {
  const detail = sanitizedStderr(error, sensitivePaths);
  if (detail) return detail;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" || typeof code === "string") return `external command exited with ${String(code).slice(0, 40)}`;
    const signal = (error as { signal?: unknown }).signal;
    if (typeof signal === "string" && signal.trim()) return `external command terminated by ${signal.slice(0, 40)}`;
  }
  return "external command failed";
}

function logicalExecutableName(executable: string): string {
  const normalized = executable.replaceAll("\\", "/");
  return basename(normalized) || "homr";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function optionToken(value: unknown, label: string, fallback: string): string {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "string" || !resolved.trim() || /[\0\r\n]/.test(resolved)) {
    throw new OmrBackendError("INVALID_INPUT", `Invalid ${label}`);
  }
  return resolved.trim();
}

function optionBoolean(value: unknown, label: string, fallback: boolean): boolean {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "boolean") throw new OmrBackendError("INVALID_INPUT", `Invalid ${label}`);
  return resolved;
}

/** Probe lazily; probing an unavailable optional tool is represented as unknown. */
export async function probeExecutableVersion(
  executable: string,
  execFile: OmrCommandRunner = execFileDefault,
  args: readonly string[] = ["--version"],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const file = pathInput(executable, "OMR executable");
  const timeout = timeoutValue(timeoutMs);
  try {
    const result = await execFile(file, args, { shell: false, timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return extractVersion(`${result.stdout}\n${result.stderr}`);
  } catch {
    return "unknown";
  }
}

function relativeOutputPath(root: string, file: string): string {
  const rootPath = resolve(root);
  const filePath = resolve(file);
  const result = relative(rootPath, filePath);
  if (!result || result === ".." || result.startsWith(`..${sep}`) || resolve(rootPath, result) !== filePath) {
    throw new OmrBackendError("FAILED", "OMR output escaped its output directory");
  }
  return result.split(sep).join("/");
}

async function regularFileBytes(path: string, label: string): Promise<{ bytes: Uint8Array; size: number }> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size <= 0) throw new Error(`${label} is not a non-empty regular file`);
    const bytes = new Uint8Array(await readFile(path));
    return { bytes, size: info.size };
  } catch (error) {
    if (error instanceof OmrBackendError) throw error;
    throw new OmrBackendError("FAILED", `${label} is unavailable`, error);
  }
}

async function walkRegularFiles(root: string, maxFiles = Number.POSITIVE_INFINITY): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) break;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
      // Symlinks are intentionally ignored so a backend cannot make a report
      // escape its caller-owned output directory.
    }
  }
  await visit(root);
  return files;
}

function artifactFormat(path: string): OmrArtifactFormat {
  const extension = extname(path).toLowerCase();
  if (extension === ".mxl") return "mxl";
  if (extension === ".musicxml") return "musicxml";
  if (extension === ".xml") return "xml";
  return "unknown";
}

async function collectOmrArtifacts(outputDirectory: string): Promise<OmrArtifact[]> {
  const files = (await walkRegularFiles(outputDirectory))
    .filter((file) => /\.(?:mxl|musicxml|xml)$/i.test(file))
    .sort((a, b) => relativeOutputPath(outputDirectory, a).localeCompare(relativeOutputPath(outputDirectory, b)));
  const artifacts: OmrArtifact[] = [];
  for (const file of files) {
    const data = await regularFileBytes(file, "OMR artifact");
    artifacts.push({ relativePath: relativeOutputPath(outputDirectory, file), format: artifactFormat(file), bytes: data.size, sha256: hashBytes(data.bytes) });
  }
  return artifacts;
}

const MAX_HOMR_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_HOMR_PARTS = 128;
const MAX_HOMR_MEASURES = 10_000;
const MAX_HOMR_NOTES = 100_000;
const MAX_HOMR_STAVES = 512;

interface OmrArtifactFile {
  artifact: OmrArtifact;
  bytes: Uint8Array;
}

/** Read only files immediately adjacent to a staged HOMR image. */
async function collectAdjacentOmrArtifacts(pageDirectory: string, outputDirectory: string): Promise<OmrArtifactFile[]> {
  const entries = await readdir(pageDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /\.(?:mxl|musicxml|xml)$/i.test(entry.name))
    .map((entry) => join(pageDirectory, entry.name))
    .sort((a, b) => relativeOutputPath(outputDirectory, a).localeCompare(relativeOutputPath(outputDirectory, b)));
  const files: OmrArtifactFile[] = [];
  for (const file of candidates) {
    const info = await lstat(file);
    if (info.size > MAX_HOMR_ARTIFACT_BYTES) {
      throw new OmrBackendError("FAILED", "HOMR MusicXML output exceeds the safety limit");
    }
    const data = await regularFileBytes(file, "HOMR MusicXML output");
    files.push({
      bytes: data.bytes,
      artifact: {
        relativePath: relativeOutputPath(outputDirectory, file),
        format: artifactFormat(file),
        bytes: data.size,
        sha256: hashBytes(data.bytes),
      },
    });
  }
  return files;
}

/** Remove only adjacent MusicXML from the current deterministic attempt path. */
async function clearAdjacentOmrArtifacts(pageDirectory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(pageDirectory, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => entry.isFile() && /\.(?:mxl|musicxml|xml)$/i.test(entry.name))
    .map((entry) => unlink(join(pageDirectory, entry.name))));
}

interface OmrScoreMetrics {
  measureCount: number;
  noteCount: number;
  staffCount: number;
}

function scoreMetrics(score: OmrScoreInput): OmrScoreMetrics {
  const parts = Array.isArray(score.parts) ? score.parts : [];
  const staves = new Set<string>();
  let measureCount = 0;
  let noteCount = 0;
  for (const part of parts) {
    const measures = Array.isArray(part.measures) ? part.measures : [];
    measureCount = Math.max(measureCount, measures.length);
    let partHasPitchedEvents = false;
    for (const measure of measures) {
      if (Array.isArray(measure.events)) noteCount += measure.events.length;
      if (Array.isArray(measure.events) && measure.events.length > 0) partHasPitchedEvents = true;
      if (Array.isArray(measure.staves)) {
        for (const staff of measure.staves) {
          if (staff && Number.isInteger(staff.number) && staff.number > 0) staves.add(`${part.id}:${staff.number}`);
        }
      }
      if (Array.isArray(measure.events)) {
        for (const event of measure.events) {
          if (event && event.staff !== undefined && Number.isInteger(event.staff) && event.staff > 0) staves.add(`${part.id}:${event.staff}`);
        }
      }
    }
    // MusicXML permits a single implicit staff when <staff> is omitted.
    if (partHasPitchedEvents && ![...staves].some((staff) => staff.slice(0, staff.lastIndexOf(":")) === part.id)) staves.add(`${part.id}:1`);
  }
  return { measureCount, noteCount, staffCount: staves.size };
}

function pathologicalMetrics(metrics: OmrScoreMetrics, score: OmrScoreInput): string | null {
  const partCount = Array.isArray(score.parts) ? score.parts.length : 0;
  if (!partCount || !metrics.measureCount || !metrics.noteCount || !metrics.staffCount) {
    return "HOMR MusicXML output is empty or contains no pitched notes";
  }
  if (partCount > MAX_HOMR_PARTS || metrics.measureCount > MAX_HOMR_MEASURES || metrics.noteCount > MAX_HOMR_NOTES || metrics.staffCount > MAX_HOMR_STAVES) {
    return "HOMR MusicXML output exceeds the safety limits";
  }
  return null;
}

function mergeScoreMetrics(target: OmrScoreMetrics, next: OmrScoreMetrics): void {
  target.measureCount = Math.max(target.measureCount, next.measureCount);
  target.noteCount += next.noteCount;
  target.staffCount += next.staffCount;
}

function validateRecognizeInput(input: OmrRecognizeInput): { images: string[]; outputDirectory: string } {
  if (!input || !Array.isArray(input.imagePaths) || input.imagePaths.length === 0) {
    throw new OmrBackendError("INVALID_INPUT", "OMR recognition requires at least one page image");
  }
  const images = input.imagePaths.map((image) => pathInput(image, "page image"));
  return { images, outputDirectory: pathInput(input.outputDirectory, "OMR output directory") };
}

function baseResult(backend: string, version: string, status: OmrResultStatus, artifacts: OmrArtifact[] = [], warnings: string[] = [], errors: string[] = []): OmrResult {
  return { backend, version, status, artifacts, warnings, errors, pages: [] };
}

async function runOmrBackend(
  id: string,
  executable: string,
  versionHint: string | undefined,
  execFile: OmrCommandRunner,
  timeoutMs: number,
  input: OmrRecognizeInput,
  args: readonly string[],
): Promise<OmrResult> {
  let validated: { images: string[]; outputDirectory: string };
  try {
    validated = validateRecognizeInput(input);
    await mkdir(validated.outputDirectory, { recursive: true });
  } catch (error) {
    if (error instanceof OmrBackendError) return baseResult(id, versionHint ?? "unknown", "failed", [], [], [error.message]);
    return baseResult(id, versionHint ?? "unknown", "failed", [], [], ["OMR output directory is unavailable"]);
  }
  try {
    const result = await execFile(executable, args, { shell: false, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const version = versionHint && versionHint !== "unknown" ? versionHint : extractVersion(`${result.stdout}\n${result.stderr}`);
    const artifacts = await collectOmrArtifacts(validated.outputDirectory);
    if (!artifacts.length) return baseResult(id, version, "failed", [], [], ["OMR completed without MusicXML or MXL output"]);
    return baseResult(id, version, "pass", artifacts);
  } catch (error) {
    if (missingExecutable(error)) return baseResult(id, versionHint ?? "unknown", "unavailable", [], ["optional OMR backend is unavailable"], [id === "homr" ? "homr unavailable" : "Audiveris unavailable"]);
    return baseResult(id, versionHint ?? "unknown", "failed", [], [], [`${id} recognition failed: ${commandMessage(error, [validated.outputDirectory, ...validated.images])}`]);
  }
}

/** Construct a lazy Audiveris adapter. No command is started here. */
export function createAudiverisBackend(options: OmrBackendOptions = {}): OmrBackend {
  const executable = pathInput(options.executable ?? "audiveris", "Audiveris executable");
  const timeoutMs = timeoutValue(options.timeoutMs);
  const execFile = options.execFile ?? execFileDefault;
  let discoveredVersion = options.version ?? "unknown";
  return {
    id: "audiveris",
    get version() { return discoveredVersion; },
    async recognize(input: OmrRecognizeInput): Promise<OmrResult> {
      if (discoveredVersion === "unknown" && options.version === undefined) discoveredVersion = await probeExecutableVersion(executable, execFile, ["--version"], timeoutMs);
      const validated = validateRecognizeInput(input);
      const args = ["-batch", "-export", "-output", validated.outputDirectory, ...validated.images];
      const result = await runOmrBackend("audiveris", executable, discoveredVersion, execFile, timeoutMs, input, args);
      discoveredVersion = result.version;
      return result;
    },
  };
}

export interface HomrCommandInput {
  imagePath: string;
  packageName?: string;
  version?: string;
  forceCpu?: boolean;
}

function normalizeHomrCommandInput(
  input: HomrCommandInput | string,
  overrides: Pick<HomrCommandInput, "packageName" | "version" | "forceCpu"> = {},
): Required<Pick<HomrCommandInput, "imagePath" | "packageName" | "version" | "forceCpu">> {
  const values = typeof input === "string" ? { imagePath: input, ...overrides } : { ...input, ...overrides };
  return {
    imagePath: pathInput(values.imagePath, "HOMR page image"),
    packageName: optionToken(values.packageName, "HOMR package name", HOMR_DEFAULTS.packageName),
    version: optionToken(values.version, "HOMR package version", HOMR_DEFAULTS.version),
    forceCpu: optionBoolean(values.forceCpu, "HOMR forceCpu", HOMR_DEFAULTS.forceCpu),
  };
}

/** Build HOMR's exact uvx command arguments for one staged image. */
export function buildHomrUvxArgs(input: HomrCommandInput): string[];
export function buildHomrUvxArgs(imagePath: string, options?: Pick<HomrCommandInput, "packageName" | "version" | "forceCpu">): string[];
export function buildHomrUvxArgs(
  input: HomrCommandInput | string,
  options: Pick<HomrCommandInput, "packageName" | "version" | "forceCpu"> = {},
): string[] {
  const normalized = normalizeHomrCommandInput(input, options);
  const args = ["--from", `${normalized.packageName}==${normalized.version}`, normalized.packageName];
  if (normalized.forceCpu) args.push("--gpu", "no");
  args.push(normalized.imagePath);
  return args;
}

/** Build direct HOMR executable arguments for one staged image. */
export function buildHomrExecutableArgs(input: HomrCommandInput): string[];
export function buildHomrExecutableArgs(imagePath: string, options?: Pick<HomrCommandInput, "forceCpu">): string[];
export function buildHomrExecutableArgs(
  input: HomrCommandInput | string,
  options: Pick<HomrCommandInput, "forceCpu"> = {},
): string[] {
  const normalized = normalizeHomrCommandInput(input, options);
  const args: string[] = [];
  if (normalized.forceCpu) args.push("--gpu", "no");
  args.push(normalized.imagePath);
  return args;
}

/**
 * Compatibility helper retained for callers of the first adapter revision.
 * HOMR 0.7.0 accepts exactly one image and has no output-directory option.
 */
export function buildHomrArgs(input: OmrRecognizeInput): string[] {
  const validated = validateRecognizeInput(input);
  if (validated.images.length !== 1) {
    throw new OmrBackendError("INVALID_INPUT", "HOMR accepts exactly one staged page image per invocation");
  }
  return buildHomrExecutableArgs(validated.images[0]!);
}

interface HomrLauncher {
  mode: "uvx" | "executable";
  executable: string;
  /** A failed uvx probe is retained as path-safe diagnostic provenance. */
  resolutionError?: string;
}

type HomrModelFile = { name: string; bytes: number; sha256: string };

interface HomrModelDiscovery {
  files?: HomrModelFile[];
  error?: string;
}

const MAX_HOMR_MODEL_DISCOVERY_ATTEMPTS = 2;

async function resolveHomrLauncher(
  options: {
    preferUvx: boolean;
    uvxExecutable: string;
    executable: string;
    packageName: string;
    version: string;
    execFile: OmrCommandRunner;
    timeoutMs: number;
  },
): Promise<HomrLauncher> {
  if (options.preferUvx) {
    try {
      // HOMR does not expose a --version flag.  Resolve the pinned package
      // and console script with --help instead; this catches both a missing
      // uvx executable and an unresolvable package before page processing.
      await options.execFile(options.uvxExecutable, [
        "--from",
        `${options.packageName}==${options.version}`,
        options.packageName,
        "--help",
      ], {
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      });
      return { mode: "uvx", executable: options.uvxExecutable };
    } catch (error) {
      // uvx is optional. The explicit executable is the deterministic fallback,
      // but retain why the fallback was selected for path-safe diagnostics.
      const detail = commandDiagnostic(error, [options.uvxExecutable, options.executable]);
      return {
        mode: "executable",
        executable: options.executable,
        resolutionError: `HOMR uvx resolution failed: ${detail}`,
      };
    }
  }
  return { mode: "executable", executable: options.executable };
}

function homrInvocationMetadata(launcher: HomrLauncher, packageName: string, version: string, forceCpu: boolean): OmrInvocationMetadata {
  const imagePlaceholder = "<relative-page-image>";
  const args = launcher.mode === "uvx"
    ? buildHomrUvxArgs({ imagePath: imagePlaceholder, packageName, version, forceCpu })
    : buildHomrExecutableArgs({ imagePath: imagePlaceholder, forceCpu });
  return {
    mode: launcher.mode,
    executable: logicalExecutableName(launcher.executable),
    packageName,
    version,
    forceCpu,
    perPage: true,
    args,
  };
}

function homrPageError(error: unknown, fallback: string, sensitivePaths: readonly string[] = []): string {
  const stderr = sanitizedStderr(error, sensitivePaths);
  return stderr ? `${fallback}: ${stderr}` : fallback;
}

/**
 * Best-effort discovery of HOMR's managed ONNX weights.  uvx keeps these in
 * its cache rather than exposing a model directory, so the report records
 * only cache-relative names and hashes.  Failure to inspect the cache never
 * changes recognition status.
 */
async function discoverHomrModelFiles(
  launcher: HomrLauncher,
  uvxExecutable: string,
  execFile: OmrCommandRunner,
  timeoutMs: number,
): Promise<HomrModelDiscovery> {
  if (launcher.mode !== "uvx") return {};
  try {
    const uvExecutable = uvxExecutable.includes("/")
      ? join(uvxExecutable.slice(0, uvxExecutable.lastIndexOf("/")), "uv")
      : "uv";
    const result = await execFile(uvExecutable, ["cache", "dir"], {
      shell: false,
      timeout: Math.min(timeoutMs, 30_000),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const cacheDirectory = result.stdout.trim().split(/\r?\n/).map((line) => line.trim()).find((line) => /^(?:[A-Za-z]:[\\/]|\/)/.test(line));
    if (!cacheDirectory) return { error: "HOMR model acquisition failed: uv cache directory was not reported" };
    const cacheRoot = resolve(cacheDirectory);
    const archiveRoot = join(cacheRoot, "archive-v0");
    const archiveEntries = await readdir(archiveRoot, { withFileTypes: true });
    const candidates: string[] = [];
    for (const entry of archiveEntries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => compareText(a.name, b.name))
      .slice(0, 64)) {
      const files = await walkRegularFiles(join(archiveRoot, entry.name), 4096);
      candidates.push(...files.filter((file) => /(?:segnet_[^/]+|(?:encoder|decoder)_pytorch_model_[^/]+)\.onnx$/i.test(file)));
    }
    const records: HomrModelFile[] = [];
    let totalBytes = 0;
    for (const file of candidates.sort(compareText).slice(0, 16)) {
      const name = relative(cacheRoot, resolve(file));
      if (!name || name === ".." || name.startsWith(`..${sep}`) || resolve(cacheRoot, name) !== resolve(file)) continue;
      const info = await lstat(file);
      if (!info.isFile() || info.size <= 0 || info.size > 128 * 1024 * 1024 || totalBytes + info.size > 512 * 1024 * 1024) continue;
      const bytes = new Uint8Array(await readFile(file));
      records.push({ name: name.split(sep).join("/"), bytes: info.size, sha256: hashBytes(bytes) });
      totalBytes += info.size;
    }
    return records.length
      ? { files: records }
      : { error: "HOMR model acquisition found no supported ONNX weight files in the uv cache" };
  } catch (error) {
    const detail = commandDiagnostic(error, [uvxExecutable]);
    return { error: `HOMR model acquisition failed: ${detail}` };
  }
}

function parseHomrPageOutput(
  files: readonly OmrArtifactFile[],
  page: number,
  warnings: string[],
  errors: string[],
): OmrScoreMetrics {
  const metrics: OmrScoreMetrics = { measureCount: 0, noteCount: 0, staffCount: 0 };
  let broken = false;
  for (const file of files) {
    try {
      const parsed = parseOmrMusicXmlBytes(file.bytes);
      const next = scoreMetrics(parsed.score);
      const pathological = pathologicalMetrics(next, parsed.score);
      if (pathological) {
        errors.push(`HOMR page ${page}: ${pathological}`);
        broken = true;
        continue;
      }
      warnings.push(...parsed.warnings.map((warning) => `HOMR page ${page}: ${sanitizedStderr(warning) ?? "parser warning"}`));
      mergeScoreMetrics(metrics, next);
    } catch (error) {
      errors.push(homrPageError(error, `HOMR page ${page} MusicXML output is malformed`, []));
      broken = true;
    }
  }
  if (broken) {
    // Do not expose counts from a partly parsed/broken page as trustworthy.
    return { measureCount: 0, noteCount: 0, staffCount: 0 };
  }
  return metrics;
}

interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Decode the small, ordinary PNGs emitted by pdftoppm.  Keeping this adapter
 * in-process avoids adding an unpinned image binary to the recovery lane and
 * makes the preprocessing hashes reproducible on every supported runtime.
 */
function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.byteLength < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new OmrBackendError("FAILED", "HOMR preprocessing requires a PNG image");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  const source = Buffer.from(bytes);
  while (offset + 12 <= source.byteLength) {
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > source.byteLength) throw new OmrBackendError("FAILED", "HOMR preprocessing received a truncated PNG");
    const data = source.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (length !== 13) throw new OmrBackendError("FAILED", "HOMR preprocessing received an invalid PNG header");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") idat.push(new Uint8Array(data));
    else if (type === "IEND") break;
    offset = end;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0 || !idat.length) {
    throw new OmrBackendError("FAILED", "HOMR preprocessing supports only non-interlaced 8-bit PNGs");
  }
  const rowBytes = width * channels;
  const filtered = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  if (filtered.byteLength !== height * (rowBytes + 1)) throw new OmrBackendError("FAILED", "HOMR preprocessing received invalid PNG pixel data");
  const rows = new Uint8Array(height * rowBytes);
  const previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowBytes + 1)]!;
    const input = filtered.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels]! : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      const value = input[x]!;
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 0xff;
      else if (filter === 2) row[x] = (value + up) & 0xff;
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
      } else throw new OmrBackendError("FAILED", "HOMR preprocessing received an unsupported PNG filter");
    }
    previous.set(row);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceIndex = y * rowBytes + x * channels;
    const targetIndex = (y * width + x) * 4;
    if (colorType === 0) rgba[targetIndex] = rgba[targetIndex + 1] = rgba[targetIndex + 2] = rows[sourceIndex]!;
    else if (colorType === 2) {
      rgba[targetIndex] = rows[sourceIndex]!;
      rgba[targetIndex + 1] = rows[sourceIndex + 1]!;
      rgba[targetIndex + 2] = rows[sourceIndex + 2]!;
    } else if (colorType === 4) rgba[targetIndex] = rgba[targetIndex + 1] = rgba[targetIndex + 2] = rows[sourceIndex]!;
    else {
      rgba[targetIndex] = rows[sourceIndex]!;
      rgba[targetIndex + 1] = rows[sourceIndex + 1]!;
      rgba[targetIndex + 2] = rows[sourceIndex + 2]!;
    }
    rgba[targetIndex + 3] = colorType === 4 ? rows[sourceIndex + 1]! : colorType === 6 ? rows[sourceIndex + 3]! : 255;
  }
  return { width, height, rgba };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.byteLength);
  result.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return result;
}

function encodeGrayPng(width: number, height: number, values: Uint8Array): Buffer {
  const scanlines = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (width + 1)] = 0;
    Buffer.from(values.subarray(y * width, (y + 1) * width)).copy(scanlines, y * (width + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([Buffer.from(PNG_SIGNATURE), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines, { level: 9, strategy: 3 })), pngChunk("IEND", new Uint8Array())]);
}

function preprocessHomrImage(source: Uint8Array, variant: HomrPreprocessingVariant): Uint8Array {
  if (variant === "original") return source;
  const decoded = decodePng(source);
  const gray = new Uint8Array(decoded.width * decoded.height);
  let min = 255;
  let max = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const pixel = index * 4;
    const alpha = decoded.rgba[pixel + 3]!;
    const value = Math.round((decoded.rgba[pixel]! * 299 + decoded.rgba[pixel + 1]! * 587 + decoded.rgba[pixel + 2]! * 114) / 1000);
    gray[index] = Math.round((value * alpha + 255 * (255 - alpha)) / 255);
    min = Math.min(min, gray[index]!);
    max = Math.max(max, gray[index]!);
  }
  if (variant === "grayscale-contrast" && max > min) {
    for (let index = 0; index < gray.length; index += 1) gray[index] = Math.round(((gray[index]! - min) * 255) / (max - min));
  }
  if (variant === "grayscale-binarize" || variant === "grayscale-binarize-trim") {
    for (let index = 0; index < gray.length; index += 1) gray[index] = gray[index]! >= 128 ? 255 : 0;
  }
  // The final ladder step intentionally keeps the original canvas dimensions:
  // trimming only suppresses already-white edge pixels, never crops page data.
  return new Uint8Array(encodeGrayPng(decoded.width, decoded.height, gray));
}

function homrHealth(pages: readonly OmrPageResult[]): OmrHealth {
  const available = pages.filter((page) => page.status === "available").length;
  if (available === pages.length && pages.length > 0) return "available";
  if (available > 0) return "partially-available";
  if (pages.length > 0 && pages.every((page) => page.status === "unavailable")) return "unavailable";
  return "broken-output";
}

function homrResultStatus(pages: readonly OmrPageResult[]): OmrResultStatus {
  if (pages.some((page) => page.status === "available")) return "pass";
  if (pages.length > 0 && pages.every((page) => page.status === "unavailable")) return "unavailable";
  return "failed";
}

async function recognizeHomrPages(
  input: OmrRecognizeInput,
  options: {
    packageName: string;
    version: string;
    uvxExecutable: string;
    executable: string;
    preferUvx: boolean;
    forceCpu: boolean;
    timeoutMs: number;
    execFile: OmrCommandRunner;
    launcher?: HomrLauncher;
    resolveLauncher: () => Promise<HomrLauncher>;
    resolveModelFiles?: (launcher: HomrLauncher) => Promise<HomrModelDiscovery>;
  },
): Promise<OmrResult> {
  let validated: { images: string[]; outputDirectory: string };
  try {
    validated = validateRecognizeInput(input);
    await mkdir(validated.outputDirectory, { recursive: true });
  } catch (error) {
    const message = error instanceof OmrBackendError ? error.message : "HOMR output directory is unavailable";
    return { ...baseResult("homr", options.version, "failed", [], [], [message]), health: "broken-output", pages: [] };
  }

  const launcher = options.launcher ?? await options.resolveLauncher();
  const pages: OmrPageResult[] = [];
  const allArtifacts: OmrArtifact[] = [];
  const allWarnings: string[] = [];
  const allErrors: string[] = launcher.resolutionError ? [launcher.resolutionError] : [];
  let modelFiles: HomrModelFile[] | undefined;
  let modelDiscoveryError: string | undefined;
  let modelDiscoveryAttempts = 0;

  const discoverModelFilesAfterPage = async (): Promise<void> => {
    if (launcher.mode !== "uvx" || modelFiles || modelDiscoveryAttempts >= MAX_HOMR_MODEL_DISCOVERY_ATTEMPTS || !options.resolveModelFiles) return;
    modelDiscoveryAttempts += 1;
    try {
      const discovery = await options.resolveModelFiles(launcher);
      if (discovery.files?.length) {
        modelFiles = discovery.files;
        modelDiscoveryError = undefined;
      } else if (discovery.error) {
        modelDiscoveryError = discovery.error;
      }
    } catch (error) {
      modelDiscoveryError = `HOMR model acquisition failed: ${commandDiagnostic(error)}`;
    }
  };

  for (const [index, source] of validated.images.entries()) {
    const page = index + 1;
    const started = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    const attempts: HomrPageAttempt[] = [];
    let sourceBytes: Uint8Array;
    let sourceSha256 = "";
    try {
      const sourceData = await regularFileBytes(pathInput(source, "HOMR page image"), "HOMR page image");
      sourceBytes = sourceData.bytes;
      sourceSha256 = hashBytes(sourceBytes);
    } catch (error) {
      const message = homrPageError(error, `HOMR page ${page} input staging failed`, [validated.outputDirectory, source]);
      const failedAttempt: HomrPageAttempt = {
        attempt: 1,
        variant: "original",
        recipe: "identity",
        sourceSha256: "",
        inputSha256: null,
        relativeInput: `page-${page}/attempt-1/original/input.png`,
        status: "failed",
        recovery: "exhausted",
        failureClass: "invalid-input",
        rootCause: message,
        trusted: false,
        elapsedMs: Math.max(0, Date.now() - started),
        exitCode: null,
        artifacts: [],
        measureCount: 0,
        noteCount: 0,
        staffCount: 0,
        warnings,
        errors: [message],
      };
      const pageResult: OmrPageResult = {
        page,
        relativeInput: `page-${page}/attempt-1/original/input.png`,
        status: "failed",
        elapsedMs: Math.max(0, Date.now() - started),
        exitCode: null,
        artifacts: [],
        measureCount: 0,
        noteCount: 0,
        staffCount: 0,
        warnings,
        errors: [message],
        failureClass: "invalid-input",
        rootCause: message,
        attempts: [failedAttempt],
        recovery: { attempted: false, recovered: false, selectedAttempt: null, attempts: 1, maxAttempts: HOMR_PREPROCESSING_LADDER.length, strategy: "deterministic-preprocessing-ladder" },
      };
      pages.push(pageResult);
      allWarnings.push(...warnings);
      allErrors.push(...pageResult.errors);
      continue;
    }

    let selected: HomrPageAttempt | undefined;
    for (const [variantIndex, descriptor] of HOMR_PREPROCESSING_LADDER.entries()) {
      const attemptNumber = variantIndex + 1;
      const variant = descriptor.variant;
      const attemptStarted = Date.now();
      const attemptWarnings: string[] = [];
      const attemptErrors: string[] = [];
      const attemptDirectory = join(resolve(validated.outputDirectory), `page-${page}`, `attempt-${attemptNumber}`, variant);
      const stagedPath = join(attemptDirectory, "input.png");
      let inputSha256: string | null = null;
      let attemptStatus: OmrPageStatus = "failed";
      let failureClass: HomrFailureClass | undefined;
      let exitCode: number | null = null;
      let signal: string | null | undefined;
      let artifacts: OmrArtifact[] = [];
      let metrics: OmrScoreMetrics = { measureCount: 0, noteCount: 0, staffCount: 0 };
      try {
        await mkdir(attemptDirectory, { recursive: true });
        await clearAdjacentOmrArtifacts(attemptDirectory);
        const variantBytes = preprocessHomrImage(sourceBytes, variant);
        inputSha256 = hashBytes(variantBytes);
        await writeFile(stagedPath, variantBytes);
        const args = launcher.mode === "uvx"
          ? buildHomrUvxArgs({ imagePath: stagedPath, packageName: options.packageName, version: options.version, forceCpu: options.forceCpu })
          : buildHomrExecutableArgs({ imagePath: stagedPath, forceCpu: options.forceCpu });
        let commandSucceeded = false;
        try {
          const commandResult = await options.execFile(launcher.executable, args, {
            shell: false,
            timeout: options.timeoutMs,
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
          });
          exitCode = 0;
          attemptStatus = "available";
          failureClass = undefined;
          commandSucceeded = true;
          const stderr = sanitizedStderr(commandResult.stderr, [validated.outputDirectory, stagedPath]);
          if (stderr) attemptWarnings.push(stderr);
        } catch (error) {
          exitCode = numericExitCode(error);
          signal = signalValue(error);
          if (missingExecutable(error)) {
            attemptStatus = "unavailable";
            failureClass = "unavailable";
            attemptErrors.push("homr unavailable");
          } else {
            attemptStatus = "failed";
            failureClass = isTimeoutError(error) ? "timeout" : signal ? "signal" : "process-failed";
            attemptErrors.push(homrPageError(error, `HOMR page ${page} recognition failed`, [validated.outputDirectory, stagedPath]));
          }
        }

        // HOMR downloads its managed weights on first execution. Discovering
        // before this point races that acquisition and produces false absence.
        if (commandSucceeded) await discoverModelFilesAfterPage();

        const files = await collectAdjacentOmrArtifacts(attemptDirectory, validated.outputDirectory);
        artifacts = files.map((file) => file.artifact);
        if (attemptStatus === "failed" || attemptStatus === "unavailable") {
          // A non-zero process result is never promoted to trustworthy output.
        } else if (!files.length) {
          attemptStatus = "broken-output";
          failureClass = "no-output";
          attemptErrors.push(`HOMR page ${page} produced no adjacent MusicXML output`);
        } else {
          const parseWarnings: string[] = [];
          const parseErrors: string[] = [];
          metrics = parseHomrPageOutput(files, page, parseWarnings, parseErrors);
          attemptWarnings.push(...parseWarnings);
          attemptErrors.push(...parseErrors);
          if (!metrics.measureCount || !metrics.noteCount || !metrics.staffCount || parseErrors.some((error) => /malformed|empty|safety limits|no pitched/i.test(error))) {
            attemptStatus = "broken-output";
            failureClass = "broken-output";
          } else {
            attemptStatus = "available";
            failureClass = undefined;
          }
        }
      } catch (error) {
        attemptStatus = "broken-output";
        failureClass = variant === "original" ? "invalid-input" : "broken-output";
        attemptErrors.push(homrPageError(error, `HOMR page ${page} preprocessing failed`, [validated.outputDirectory, stagedPath]));
      }
      const attempt: HomrPageAttempt = {
        attempt: attemptNumber,
        variant,
        recipe: descriptor.recipe,
        sourceSha256,
        inputSha256,
        relativeInput: relativeOutputPath(validated.outputDirectory, stagedPath),
        status: attemptStatus,
        recovery: attemptStatus === "available" ? (attemptNumber === 1 ? "not-needed" : "recovered") : "retryable",
        ...(failureClass ? { failureClass } : {}),
        ...(attemptErrors.length ? { rootCause: attemptErrors[0] } : {}),
        trusted: attemptStatus === "available" && exitCode === 0,
        elapsedMs: Math.max(0, Date.now() - attemptStarted),
        exitCode,
        ...(signal !== undefined ? { signal } : {}),
        artifacts,
        measureCount: metrics.measureCount,
        noteCount: metrics.noteCount,
        staffCount: metrics.staffCount,
        warnings: attemptWarnings,
        errors: attemptErrors,
      };
      attempts.push(attempt);
      warnings.push(...attemptWarnings);
      errors.push(...attemptErrors);
      if (attempt.trusted) {
        selected = attempt;
        break;
      }
      if (failureClass === "unavailable" || failureClass === "invalid-input") break;
    }
    if (!selected && attempts.length) attempts[attempts.length - 1]!.recovery = "exhausted";
    selected ??= attempts.find((attempt) => attempt.failureClass === "process-failed" || attempt.failureClass === "timeout" || attempt.failureClass === "signal") ?? attempts.at(-1);
    const pageResult: OmrPageResult = {
      page,
      relativeInput: selected?.relativeInput ?? `page-${page}/attempt-1/original/input.png`,
      status: selected?.status ?? "failed",
      elapsedMs: Math.max(0, Date.now() - started),
      exitCode: selected?.exitCode ?? null,
      artifacts: selected?.artifacts ?? [],
      measureCount: selected?.measureCount ?? 0,
      noteCount: selected?.noteCount ?? 0,
      staffCount: selected?.staffCount ?? 0,
      warnings,
      errors,
      ...(selected?.failureClass && selected.status !== "available" ? { failureClass: selected.failureClass } : {}),
      ...(selected?.rootCause && selected.status !== "available" ? { rootCause: selected.rootCause } : {}),
      attempts,
      recovery: {
        attempted: attempts.length > 1,
        recovered: selected?.status === "available" && attempts.length > 1,
        selectedAttempt: selected?.trusted ? selected.attempt : null,
        attempts: attempts.length,
        maxAttempts: HOMR_PREPROCESSING_LADDER.length,
        strategy: "deterministic-preprocessing-ladder",
      },
    };
    pages.push(pageResult);
    // Raw artifacts from every attempt remain available for forensic
    // provenance. Only the selected exit-0, parsed attempt contributes score
    // metrics and page evidence above.
    for (const attempt of attempts) allArtifacts.push(...attempt.artifacts);
    allWarnings.push(...warnings);
    allErrors.push(...errors);
  }

  if (modelDiscoveryError && !modelFiles) allErrors.push(modelDiscoveryError);
  const invocation = homrInvocationMetadata(launcher, options.packageName, options.version, options.forceCpu);
  const model: OmrModelMetadata = {
    id: "homr",
    packageName: options.packageName,
    version: options.version,
    runtime: launcher.mode,
    forceCpu: options.forceCpu,
    source: launcher.mode === "uvx" ? "uvx-managed-cache" : "external-executable",
    cache: launcher.mode === "uvx" ? "uv-cache" : "external",
    ...(modelFiles ? { files: modelFiles } : {}),
  };

  return {
    ...baseResult("homr", options.version, homrResultStatus(pages), allArtifacts, allWarnings, allErrors),
    health: homrHealth(pages),
    pages,
    invocation,
    model,
  };
}

/** Construct an optional HOMR adapter; uvx resolution and page execution are lazy. */
export function createHomrBackend(options: HomrBackendOptions = {}): OmrBackend {
  const packageName = optionToken(options.packageName, "HOMR package name", HOMR_DEFAULTS.packageName);
  const version = optionToken(options.version, "HOMR package version", HOMR_DEFAULTS.version);
  const uvxExecutable = pathInput(options.uvxExecutable ?? HOMR_DEFAULTS.uvxExecutable, "uvx executable");
  const executable = pathInput(options.executable ?? HOMR_DEFAULTS.executable, "homr executable");
  const preferUvx = optionBoolean(options.preferUvx, "HOMR preferUvx", HOMR_DEFAULTS.preferUvx);
  const forceCpu = optionBoolean(options.forceCpu, "HOMR forceCpu", HOMR_DEFAULTS.forceCpu);
  const timeoutMs = timeoutValue(options.timeoutMs);
  const execFile = options.execFile ?? execFileDefault;
  let discoveredVersion = version;
  let resolvedLauncher: HomrLauncher | undefined;
  let discoveredModelFiles: HomrModelFile[] | undefined;
  return {
    id: "homr",
    get version() { return discoveredVersion; },
    async recognize(input: OmrRecognizeInput): Promise<OmrResult> {
      const result = await recognizeHomrPages(input, {
        packageName,
        version,
        uvxExecutable,
        executable,
        preferUvx,
        forceCpu,
        timeoutMs,
        execFile,
        launcher: resolvedLauncher,
        resolveLauncher: async () => {
          resolvedLauncher = await resolveHomrLauncher({
            preferUvx,
            uvxExecutable,
            executable,
            packageName,
            version,
            execFile,
            timeoutMs,
          });
          return resolvedLauncher;
        },
        resolveModelFiles: async (launcher) => {
          if (discoveredModelFiles) return { files: discoveredModelFiles };
          const discovery = await discoverHomrModelFiles(launcher, uvxExecutable, execFile, timeoutMs);
          if (discovery.files) discoveredModelFiles = discovery.files;
          return discovery;
        },
      });
      discoveredVersion = result.version;
      return result;
    },
  };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value) || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
    throw new OmrBackendError("FAILED", "Raster output is not a valid PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height) throw new OmrBackendError("FAILED", "Raster output has invalid PNG dimensions");
  return { width, height };
}

function pageNumber(file: string, fallback: number): number {
  const name = basename(file);
  const match = name.match(/(?:^|-)(\d+)\.png$/i);
  return match ? Number(match[1]) : fallback;
}

/** Hash one generated PNG with a path-safe, relative metadata record. */
export async function hashImageFile(file: string, outputDirectory: string, page?: number): Promise<RasterPageMetadata> {
  const root = pathInput(outputDirectory, "raster output directory");
  const imagePath = pathInput(file, "raster image");
  const relativePath = relativeOutputPath(root, imagePath);
  const data = await regularFileBytes(imagePath, "Raster image");
  const dimensions = pngDimensions(data.bytes);
  return { page: page ?? pageNumber(imagePath, 1), relativePath, width: dimensions.width, height: dimensions.height, bytes: data.size, sha256: hashBytes(data.bytes) };
}

/** Construct a deterministic Poppler page rasterizer without starting a process. */
export function createPdfRasterizer(options: PdfRasterizerOptions = {}): PdfRasterizer {
  const executable = pathInput(options.executable ?? "pdftoppm", "PDF rasterizer executable");
  const timeoutMs = timeoutValue(options.timeoutMs);
  const execFile = options.execFile ?? execFileDefault;
  return {
    id: "pdftoppm",
    async rasterize(input: PdfRasterInput): Promise<PdfRasterResult> {
      const pdfPath = pathInput(input.pdfPath, "PDF");
      const outputDirectory = pathInput(input.outputDirectory, "raster output directory");
      const config = resolvePdfRasterConfig({ dpi: input.dpi, firstPage: input.firstPage, lastPage: input.lastPage });
      await mkdir(outputDirectory, { recursive: true });
      const outputPrefix = join(resolve(outputDirectory), "page");
      const args = buildPdfRasterArgs({ pdfPath, outputPrefix, dpi: config.dpi, firstPage: config.firstPage, lastPage: config.lastPage });
      try {
        const result = await execFile(executable, args, { shell: false, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
        const version = options.version ?? extractVersion(`${result.stdout}\n${result.stderr}`);
        const files = (await walkRegularFiles(outputDirectory)).filter((file) => /\.png$/i.test(file)).sort((a, b) => relativeOutputPath(outputDirectory, a).localeCompare(relativeOutputPath(outputDirectory, b)));
        const pages: RasterPageMetadata[] = [];
        for (const [index, file] of files.entries()) {
          const metadata = await hashImageFile(file, outputDirectory, pageNumber(file, index + config.firstPage));
          if (metadata.page < config.firstPage || (config.lastPage !== null && metadata.page > config.lastPage)) continue;
          pages.push(metadata);
        }
        if (!pages.length) throw new OmrBackendError("FAILED", "PDF rasterizer produced no PNG pages");
        pages.sort((a, b) => a.page - b.page || a.relativePath.localeCompare(b.relativePath));
        return { renderer: { id: "pdftoppm", version, dpi: config.dpi, format: "png", crop: "none", rotation: 0 }, pages };
      } catch (error) {
        if (error instanceof OmrBackendError) throw error;
        if (missingExecutable(error)) throw new OmrBackendError("UNAVAILABLE", "PDF rasterizer unavailable", error);
        throw new OmrBackendError("FAILED", `PDF rasterization failed: ${commandMessage(error, [outputDirectory, pdfPath])}`, error);
      }
    },
  };
}

/** Convenience one-shot API for callers that do not need a rasterizer object. */
export function rasterizePdfPages(input: PdfRasterInput, options: PdfRasterizerOptions = {}): Promise<PdfRasterResult> {
  return createPdfRasterizer(options).rasterize(input);
}
