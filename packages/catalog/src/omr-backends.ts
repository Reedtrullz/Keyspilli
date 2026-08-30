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
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileDefault = promisify(execFileCallback) as unknown as OmrCommandRunner;
const DEFAULT_RASTER_DPI = 300;
const MIN_RASTER_DPI = 150;
const MAX_RASTER_DPI = 600;
const DEFAULT_FIRST_PAGE = 1;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type OmrCommandRunner = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type OmrResultStatus = "pass" | "unavailable" | "failed";
export type OmrArtifactFormat = "mxl" | "musicxml" | "xml" | "unknown";

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

export interface OmrResult {
  backend: string;
  version: string;
  status: OmrResultStatus;
  artifacts: OmrArtifact[];
  warnings: string[];
  errors: string[];
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

async function walkRegularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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

function validateRecognizeInput(input: OmrRecognizeInput): { images: string[]; outputDirectory: string } {
  if (!input || !Array.isArray(input.imagePaths) || input.imagePaths.length === 0) {
    throw new OmrBackendError("INVALID_INPUT", "OMR recognition requires at least one page image");
  }
  const images = input.imagePaths.map((image) => pathInput(image, "page image"));
  return { images, outputDirectory: pathInput(input.outputDirectory, "OMR output directory") };
}

function baseResult(backend: string, version: string, status: OmrResultStatus, artifacts: OmrArtifact[] = [], warnings: string[] = [], errors: string[] = []): OmrResult {
  return { backend, version, status, artifacts, warnings, errors };
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

/** Build the intentionally simple, shell-free homr command. */
export function buildHomrArgs(input: OmrRecognizeInput): string[] {
  const validated = validateRecognizeInput(input);
  return ["--output-dir", validated.outputDirectory, ...validated.images];
}

/** Construct an optional homr adapter; homr is never imported or probed at startup. */
export function createHomrBackend(options: OmrBackendOptions = {}): OmrBackend {
  const executable = pathInput(options.executable ?? "homr", "homr executable");
  const timeoutMs = timeoutValue(options.timeoutMs);
  const execFile = options.execFile ?? execFileDefault;
  let discoveredVersion = options.version ?? "unknown";
  return {
    id: "homr",
    get version() { return discoveredVersion; },
    async recognize(input: OmrRecognizeInput): Promise<OmrResult> {
      if (discoveredVersion === "unknown" && options.version === undefined) discoveredVersion = await probeExecutableVersion(executable, execFile, ["--version"], timeoutMs);
      const args = buildHomrArgs(input);
      const result = await runOmrBackend("homr", executable, discoveredVersion, execFile, timeoutMs, input, args);
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
