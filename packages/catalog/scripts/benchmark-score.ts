#!/usr/bin/env node
/**
 * Local-only PDF score benchmark.
 *
 * This is deliberately an optional development tool.  It keeps a PDF outside
 * the repository, asks Audiveris to produce MusicXML/MXL, validates the
 * notation without silently repairing musical content, and then uses the
 * existing MusicXML/MIDI parser and FluidSynth renderer.  It has no catalog,
 * network, upload, or production side effects.
 *
 * Usage:
 *   pnpm exec tsx packages/catalog/scripts/benchmark-score.ts \
 *     --pdf /private/path/score.pdf --out /private/tmp/corpus/score
 *
 * Audiveris is optional at runtime, but the command fails closed (and emits a
 * FAILED report) when it is not installed/configured.  MuseScore and
 * FluidSynth are best-effort optional renderers.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync, zipSync } from "fflate";
import { parseMidi, parseMusicXmlNotes, writeMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import { renderMidiToWav } from "../src/midi-renderer.js";
import {
  canonicalBenchmarkCorpusJson,
  createBenchmarkCorpusManifest,
  createScoreProvenance,
  validateBenchmarkCorpusManifest,
  type BenchmarkCorpusSong,
} from "../src/score-benchmark.js";

const execFile = promisify(execFileCallback);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NORMALIZATION_VERSION = "score-benchmark-normalizer-v1";
const REPORT_SCHEMA_VERSION = 1;
const MAX_MXL_ENTRIES = 200;
const MAX_MXL_UNCOMPRESSED = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const EPSILON = 1e-6;

export type ScoreValidationStatus = "PASS" | "PASS_WITH_WARNINGS" | "REVIEW_REQUIRED" | "FAILED";
export type ValidationSeverity = "warning" | "review";

export interface ScoreWarning {
  code: string;
  severity: ValidationSeverity;
  message: string;
  measure?: number;
  part?: string;
  staff?: number;
  voice?: string;
}

export interface ScorePartSummary {
  id: string;
  name: string;
  role: "melody" | "accompaniment" | "keyboard" | "unknown";
  roleConfidence: "high" | "medium" | "low";
  staffCount: number;
  staves: number[];
  clefs: string[];
  voiceCount: number;
  measureCount: number;
}

export interface ScoreStructureSummary {
  parts: ScorePartSummary[];
  partCount: number;
  staffCount: number;
  instrumentNames: string[];
  clefs: string[];
  voiceCount: number;
  tempoBpm: number | null;
  timeSignatures: Array<[number, number]>;
  keySignatures: Array<{ fifths: number; mode: string }>;
  measureCount: number;
}

export interface ScoreMeasureMetric {
  measure: number;
  notes: number;
  attacks: number;
  notesPerBeat: number;
  maxPolyphony: number;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchClasses: number;
}

export interface ScoreValidationMetrics {
  parsedNotes: number;
  parsedDurationBeats: number;
  pitchMin: number | null;
  pitchMax: number | null;
  duplicateEvents: number;
  multiOctaveJumps: number;
  malformedNoteElements: number;
  tuplets: number;
  ties: { starts: number; stops: number; orphanStarts: number; orphanStops: number };
  measures: ScoreMeasureMetric[];
  densityAnomalies: number;
}

export interface ScoreRenderArtifact {
  status: "PASS" | "UNAVAILABLE" | "FAILED" | "SKIPPED";
  path?: string;
  bytes?: number;
  sha256?: string;
  /** Path-free renderer provenance; local executable/SoundFont paths are never emitted. */
  renderer?: {
    backend: string;
    version: string;
    sampleRate?: number;
    gain?: number;
    targetPeak?: number;
    soundfont?: { identifier: string; sha256: string };
  };
  reason?: string;
}

export interface ScoreValidationReport {
  schemaVersion: number;
  status: ScoreValidationStatus;
  source: { fileName: string; sha256: string | null; pages: number | null };
  omr: { backend: string; version: string | null; status: "PASS" | "FAILED"; rawFormat?: "mxl" | "musicxml-wrapped"; reason?: string };
  normalization: { version: string; policy: string; repairs: string[] };
  structure: ScoreStructureSummary | null;
  metrics: ScoreValidationMetrics | null;
  errors: string[];
  warnings: ScoreWarning[];
  manualReview: "not-reviewed" | "approved" | "rejected";
  artifacts: {
    musicxml: string | null;
    midi: string | null;
    notes: string | null;
    audio: ScoreRenderArtifact;
    notation: ScoreRenderArtifact;
  };
}

export interface ScoreBenchmarkOptions {
  pdf: string;
  out: string;
  id?: string;
  title?: string;
  artist?: string;
  audiveris?: string;
  musescore?: string;
  fluidsynth?: string;
  soundfont?: string;
  corpusManifest?: string;
  timeoutMs?: number;
  noAudio?: boolean;
  noNotation?: boolean;
  noCorpus?: boolean;
}

export interface ScoreBenchmarkResult {
  status: ScoreValidationStatus;
  out: string;
  report: ScoreValidationReport;
  corpusManifest: string | null;
}

interface PdfInput {
  path: string;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  pages: number | null;
}

interface XmlSource {
  xml: string;
  rawMxl: Uint8Array;
  rawFormat: "mxl" | "musicxml-wrapped";
}

interface MeasureScan {
  number: number;
  index: number;
  body: string;
  partId: string;
  startBeat: number;
  endBeat: number;
  divisions: number;
  timeSig: [number, number];
}

interface PartScan {
  id: string;
  name: string;
  role: ScorePartSummary["role"];
  roleConfidence: ScorePartSummary["roleConfidence"];
  body: string;
  measures: MeasureScan[];
}

interface PreparedArtifacts {
  xml: string;
  rawMxl: Uint8Array;
  rawFormat: XmlSource["rawFormat"];
  parsed: ParsedMidi;
  partNotes: Array<{
    id: string;
    name: string;
    role: ScorePartSummary["role"];
    roleConfidence: ScorePartSummary["roleConfidence"];
    notes: Note[];
    metadata: Array<{
      staff?: number;
      voice?: string;
      measure?: number;
      beat?: number;
      source?: string;
    }>;
  }>;
  midi: Uint8Array;
  structure: ScoreStructureSummary;
  metrics: ScoreValidationMetrics;
  warnings: ScoreWarning[];
  errors: string[];
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sanitizeText(value: unknown, fallback = "unknown error"): string {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (!text) return fallback;
  const safeUrls: string[] = [];
  // Keep the path matcher deliberately conservative about slash-shaped
  // labels (for example `/api/v1/scores`) while covering executable paths
  // and other absolute paths that do not have a media-file extension.  The
  // filesystem-root allowlist covers the normal POSIX roots; the longer
  // fallback requires several path components so a logical two-segment label
  // is left useful in diagnostics.
  const pathBoundary = `(^|[\\s(\"'=,;:\\[\\]])`;
  const pathComponent = `[A-Za-z0-9._~+@%!-]+`;
  const filesystemRoots = `(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app|Applications|System|Volumes|Library|usr|bin|sbin|dev)`;
  return text
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        safeUrls.push(url.toString());
        return "SAFE_URL_" + (safeUrls.length - 1);
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\/)[^"'\r\n]*\1/g, "[redacted-path]")
    .replace(/(?<![/:])(?![A-Za-z]:\/\/)(?:[A-Za-z]:[\\/]|\/)(?:[^\r\n"'\x60,;)]|\s(?!at\b|while\b|from\b|during\b))+\.(?:pdf|mid|midi|wav|mxl|xml|json|mp3)\b/gi, "[redacted-path]")
    // Unquoted executable/tool paths often have no extension (for example
    // `spawn /Users/reidar/bin/audiveris ENOENT`).  Match only at a textual
    // boundary so URL/route paths remain intact, and retain the leading
    // boundary in the replacement.
    .replace(new RegExp(`${pathBoundary}/${filesystemRoots}(?:/${pathComponent})+`, "gi"), "$1[redacted-path]")
    .replace(new RegExp(`${pathBoundary}/(?:${pathComponent}/){3,}${pathComponent}`, "g"), "$1[redacted-path]")
    .replace(new RegExp(`${pathBoundary}[A-Za-z]:[\\\\](?:${pathComponent}[\\\\])+${pathComponent}`, "g"), "$1[redacted-path]")
    .replace(/[\r\n]+/g, " ")
    .replace(/SAFE_URL_(\d+)/g, (_, index: string) => safeUrls[Number(index)] ?? "[redacted-url]")
    .slice(0, 500) || fallback;
}

export function safeError(error: unknown, fallback = "score benchmark failed"): string {
  return sanitizeText(error, fallback);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "score";
}

function posixRelative(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  return value || basename(path);
}

function isInside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function resolveThroughExistingAncestors(path: string): Promise<string> {
  const absolute = resolve(path);
  const suffix: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const resolved = await realpath(current);
      return suffix.length ? join(resolved, ...suffix) : resolved;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) return absolute;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

export async function assertOutsideRepository(path: string, label: string): Promise<void> {
  const [repository, candidate] = await Promise.all([
    realpath(REPO_ROOT),
    resolveThroughExistingAncestors(path),
  ]);
  if (isInside(repository, candidate)) {
    throw new Error(`${label} must be outside the repository; keep score artifacts local-only`);
  }
}

/**
 * Reject symlinked output components below a caller-owned output root.
 *
 * `assertOutsideRepository` resolves the path that exists at validation time,
 * which is enough to reject an output root pointing into this repository but
 * not enough to protect a later `out/normalized/...` write when
 * `out/normalized` is a symlink to some other directory.  Keep the lexical
 * output root as the trust boundary and inspect every existing component from
 * that boundary to the requested path.  Missing components are safe to
 * create; the post-mkdir check in `ensureOutputDirectory` closes the common
 * pre-existing-directory case without following any nested link.
 */
async function assertNoSymlinkComponents(root: string, path: string, label: string): Promise<void> {
  const outputRoot = resolve(root);
  const candidate = resolve(path);
  if (!isInside(outputRoot, candidate)) {
    throw new Error(`${label} must remain under the output directory`);
  }
  const suffix = relative(outputRoot, candidate);
  const components = suffix ? suffix.split(sep) : [];
  let current = outputRoot;
  for (const component of [".", ...components]) {
    current = component === "." ? current : join(current, component);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(`${label} contains a symlinked output component`);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT" || code === "ENOTDIR") break;
      throw error;
    }
  }
}

export async function assertSafeOutputPath(path: string, root: string, label: string): Promise<void> {
  await assertOutsideRepository(path, label);
  await assertNoSymlinkComponents(root, path, label);
}

async function ensureOutputDirectory(path: string, root: string, label: string): Promise<void> {
  await assertSafeOutputPath(path, root, label);
  await mkdir(path, { recursive: true });
  await assertSafeOutputPath(path, root, label);
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = integer(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function parsePdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ? matches.length : null;
}

async function validatePdf(path: string): Promise<PdfInput> {
  const resolved = await realpath(resolve(path));
  await assertOutsideRepository(resolved, "PDF");
  if (extname(resolved).toLowerCase() !== ".pdf") throw new Error("--pdf must point to a .pdf file");
  const info = await stat(resolved);
  if (!info.isFile() || info.size <= 0) throw new Error("--pdf must be a non-empty regular file");
  const bytes = new Uint8Array(await readFile(resolved));
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 8));
  if (!header.startsWith("%PDF-")) throw new Error("--pdf does not have a PDF header");
  return {
    path: resolved,
    fileName: basename(resolved),
    bytes,
    sha256: hashBytes(bytes),
    pages: parsePdfPages(bytes),
  };
}

function assertSafeMxl(bytes: Uint8Array): void {
  if (bytes.length < 22) throw new Error("invalid MXL container (truncated)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const begin = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= begin; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("invalid MXL container (missing directory)");
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("MXL zip64 containers are unsupported");
  }
  if (entries > MAX_MXL_ENTRIES || directoryOffset + directorySize > bytes.length) {
    throw new Error("MXL container exceeds safety limits");
  }
  let cursor = directoryOffset;
  let uncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > directoryOffset + directorySize || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("invalid MXL central directory");
    }
    uncompressed += view.getUint32(cursor + 24, true);
    if (uncompressed > MAX_MXL_UNCOMPRESSED) throw new Error("MXL container exceeds 64MB uncompressed limit");
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
}

function xmlFromMxl(bytes: Uint8Array): string {
  assertSafeMxl(bytes);
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  let scoreName: string | undefined;
  const container = files["META-INF/container.xml"];
  if (container) {
    const root = new TextDecoder().decode(container).match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
    if (root && files[root]) scoreName = root;
  }
  scoreName ??= names.find((name) => /\.(?:musicxml|xml)$/i.test(name) && !name.startsWith("META-INF/"));
  if (!scoreName) throw new Error("MXL container has no MusicXML score");
  return new TextDecoder().decode(files[scoreName]!);
}

function wrapMusicXml(xml: string): Uint8Array {
  const container = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  return zipSync({
    "META-INF/container.xml": new TextEncoder().encode(container),
    "score.musicxml": new TextEncoder().encode(xml),
  });
}

function normalizeMusicXml(xml: string): string {
  // This is intentionally not a musical repair.  Only transport-level noise
  // is normalized, while the source XML remains available in raw.mxl.
  return xml.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimEnd() + "\n";
}

function classifyRole(name: string): { role: ScorePartSummary["role"]; confidence: ScorePartSummary["roleConfidence"] } {
  const lower = name.toLowerCase();
  if (/\b(?:voice|vocal|singer|melody|lead)\b/.test(lower)) return { role: "melody", confidence: "high" };
  if (/\b(?:piano|keyboard|accompaniment|accomp|guitar|bass)\b/.test(lower)) {
    return { role: /\b(?:piano|keyboard)\b/.test(lower) ? "keyboard" : "accompaniment", confidence: "high" };
  }
  return { role: "unknown", confidence: "low" };
}

function scorePartName(xml: string, id: string): string {
  const part = xml.match(new RegExp(`<score-part\\b[^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"][^>]*>([\\s\\S]*?)</score-part>`, "i"))?.[1] ?? "";
  return firstMatch(part, /<part-name\b[^>]*>([\s\S]*?)<\/part-name>/i)?.replace(/<[^>]+>/g, "").trim() || id;
}

function scanParts(xml: string): PartScan[] {
  const scans: PartScan[] = [];
  for (const match of xml.matchAll(/<part(?=\s|>)([^>]*)>([\s\S]*?)<\/part>/gi)) {
    const opening = match[1] ?? "";
    const id = attr(opening, "id") ?? `P${scans.length + 1}`;
    const body = match[2] ?? "";
    const name = scorePartName(xml, id);
    const role = classifyRole(name);
    let divisions = 1;
    let timeSig: [number, number] = [4, 4];
    let cursor = 0;
    const measures: MeasureScan[] = [];
    for (const [index, measureMatch] of [...body.matchAll(/<measure\b([^>]*)>([\s\S]*?)<\/measure>/gi)].entries()) {
      const measureOpening = measureMatch[1] ?? "";
      const measureBody = measureMatch[2] ?? "";
      const attrs = measureBody.match(/<attributes\b[\s\S]*?<\/attributes>/i)?.[0] ?? "";
      divisions = positiveInteger(firstMatch(attrs, /<divisions>\s*(\d+)\s*<\/divisions>/i), divisions);
      const beatsRaw = firstMatch(attrs, /<time\b[\s\S]*?<beats>\s*(\d+)\s*<\/beats>/i);
      const beatTypeRaw = firstMatch(attrs, /<time\b[\s\S]*?<beat-type>\s*(\d+)\s*<\/beat-type>/i);
      if (beatsRaw && beatTypeRaw) {
        const beats = positiveInteger(beatsRaw, timeSig[0]);
        const beatType = positiveInteger(beatTypeRaw, timeSig[1]);
        timeSig = [beats, beatType];
      }
      const length = timeSig[0] * (4 / timeSig[1]);
      const number = integer(attr(measureOpening, "number"), index + 1);
      measures.push({ number, index, body: measureBody, partId: id, startBeat: cursor, endBeat: cursor + length, divisions, timeSig });
      cursor += length;
    }
    scans.push({ id, name, role: role.role, roleConfidence: role.confidence, body, measures });
  }
  return scans;
}

interface PartNoteMetadata {
  staff?: number;
  voice?: string;
  measure?: number;
  beat?: number;
  source?: string;
}

interface ParsedPart {
  id: string;
  name: string;
  role: ScorePartSummary["role"];
  roleConfidence: ScorePartSummary["roleConfidence"];
  notes: Note[];
  metadata: PartNoteMetadata[];
  parsed: ParsedMidi;
}

function metadataForPart(partXml: string, notes: readonly Note[], part: PartScan | undefined): PartNoteMetadata[] {
  const body = partXml.match(/<part(?=\s|>)[^>]*>([\s\S]*?)<\/part>/i)?.[1] ?? partXml;
  const timeAttributes = body.match(/<attributes\b[\s\S]*?<\/attributes>/i)?.[0] ?? "";
  const beats = positiveInteger(firstMatch(timeAttributes, /<beats>\s*(\d+)\s*<\/beats>/i), 4);
  const beatType = positiveInteger(firstMatch(timeAttributes, /<beat-type>\s*(\d+)\s*<\/beat-type>/i), 4);
  const defaultMeasureBeats = beats * (4 / beatType);
  const raw: Array<{ midi: number; start: number; dur: number; staff: number; voice: string; measure: number; beat: number }> = [];
  for (const [index, measureMatch] of [...body.matchAll(/<measure\b([^>]*)>([\s\S]*?)<\/measure>/gi)].entries()) {
    const measureOpening = measureMatch[1] ?? "";
    const measureBody = measureMatch[2] ?? "";
    const scanned = part?.measures[index];
    const measureStart = scanned?.startBeat ?? index * defaultMeasureBeats;
    let divisions = scanned?.divisions ?? positiveInteger(firstMatch(measureBody, /<divisions>\s*(\d+)\s*<\/divisions>/i), 1);
    divisions = Math.max(1, divisions);
    let cursor = 0;
    let lastStart = 0;
    const measureNumber = integer(attr(measureOpening, "number"), scanned?.number ?? index + 1);
    for (const element of measureBody.match(/<(?:note|backup|forward)\b[^>]*>[\s\S]*?<\/(?:note|backup|forward)>/gi) ?? []) {
      if (element.startsWith("<backup") || element.startsWith("<forward")) {
        const duration = positiveInteger(firstMatch(element, /<duration>\s*(\d+)\s*<\/duration>/i), 0) / divisions;
        cursor = element.startsWith("<backup") ? Math.max(0, cursor - duration) : cursor + duration;
        continue;
      }
      const midi = parsePitch(element);
      const durationRaw = firstMatch(element, /<duration>\s*(-?\d+)\s*<\/duration>/i);
      const durationDivisions = Number(durationRaw);
      const duration = durationDivisions / divisions;
      if (midi === null || !finite(duration) || duration <= 0) continue;
      const chord = /<chord\s*\/>/i.test(element);
      const startWithinMeasure = chord ? lastStart : (lastStart = cursor);
      if (!chord) cursor += duration;
      const staff = positiveInteger(firstMatch(element, /<staff>\s*(\d+)\s*<\/staff>/i), 1);
      const voice = firstMatch(element, /<voice>\s*([^<]+?)\s*<\/voice>/i) || "1";
      raw.push({
        midi,
        start: round(measureStart + startWithinMeasure, 6),
        dur: duration,
        staff,
        voice,
        measure: measureNumber,
        beat: round(startWithinMeasure + 1, 6),
      });
    }
  }
  const byKey = new Map<string, PartNoteMetadata[]>();
  for (const event of raw) {
    const key = `${event.start.toFixed(6)}:${event.midi}`;
    const values = byKey.get(key) ?? [];
    values.push({ staff: event.staff, voice: event.voice, measure: event.measure, beat: event.beat });
    byKey.set(key, values);
  }
  for (const values of byKey.values()) values.sort((left, right) => (left.staff ?? 0) - (right.staff ?? 0) || (left.voice ?? "").localeCompare(right.voice ?? ""));
  return notes.map((note) => {
    const key = `${round(note.start, 6).toFixed(6)}:${note.midi}`;
    const metadata = byKey.get(key)?.shift() ?? {};
    return metadata;
  });
}

function parsedParts(xml: string, scans: PartScan[]): ParsedPart[] {
  const partFor = (id: string, fallbackIndex: number): PartScan | undefined => scans.find((scan) => scan.id === id) ?? scans[fallbackIndex];
  const withMetadata = (id: string, name: string, parsed: ParsedMidi, partXml: string, fallbackIndex: number): ParsedPart => {
    const scan = partFor(id, fallbackIndex);
    const role = scan ? { role: scan.role, roleConfidence: scan.roleConfidence } : { role: "unknown" as const, roleConfidence: "low" as const };
    return { id, name, ...role, notes: parsed.notes, metadata: metadataForPart(partXml, parsed.notes, scan), parsed };
  };
  if (scans.length <= 1) {
    const parsed = parseMusicXmlNotes(xml);
    const scan = scans[0];
    return [withMetadata(scan?.id ?? "P1", scan?.name ?? "Reference", parsed, xml, 0)];
  }
  const root = xml.match(/<score-partwise\b[^>]*>/i)?.[0] ?? "<score-partwise version=\"4.0\">";
  const partList = xml.match(/<part-list\b[\s\S]*?<\/part-list>/i)?.[0] ?? "";
  const parts: ParsedPart[] = [];
  for (const match of xml.matchAll(/<part(?=\s|>)[^>]*>[\s\S]*?<\/part>/gi)) {
    const body = `${root}${partList}${match[0]}</score-partwise>`;
    const parsed = parseMusicXmlNotes(body);
    const id = attr(match[0].match(/<part\b([^>]*)>/i)?.[1] ?? "", "id") ?? "";
    parts.push(withMetadata(id || `P${parts.length + 1}`, id ? scorePartName(xml, id) : `Part ${parts.length + 1}`, parsed, match[0], parts.length));
  }
  return parts;
}

function parsePitch(noteXml: string): number | null {
  const step = firstMatch(noteXml, /<step>\s*([A-G])\s*<\/step>/i)?.toUpperCase();
  const octave = integer(firstMatch(noteXml, /<octave>\s*(\d+)\s*<\/octave>/i), -100);
  if (!step || octave < 0) return null;
  const alter = integer(firstMatch(noteXml, /<alter>\s*(-?\d+)\s*<\/alter>/i), 0);
  const pc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = 12 * (octave + 1) + (pc[step] ?? 0) + alter;
  return midi >= 0 && midi <= 127 ? midi : null;
}

function addWarning(warnings: ScoreWarning[], warning: ScoreWarning): void {
  warnings.push({ ...warning, message: sanitizeText(warning.message, warning.code) });
}

function parseTempo(xml: string): number | null {
  const value = Number(firstMatch(xml, /<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/i));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseStructure(xml: string, parsed: ParsedMidi, scans: PartScan[], warnings: ScoreWarning[]): ScoreStructureSummary {
  const allClefs: string[] = [];
  const allInstruments: string[] = [];
  const allKeys: Array<{ fifths: number; mode: string }> = [];
  const allTimes: Array<[number, number]> = [];
  const allStaffIdentities = new Set<string>();
  let maxVoices = 0;
  for (const part of scans) {
    const staves = new Set<number>();
    const clefs = new Set<string>();
    const voices = new Set<string>();
    for (const measure of part.measures) {
      const attrs = measure.body.match(/<attributes\b[\s\S]*?<\/attributes>/i)?.[0] ?? "";
      for (const match of attrs.matchAll(/<clef\b([^>]*)>([\s\S]*?)<\/clef>/gi)) {
        const number = attr(match[1] ?? "", "number") ?? "1";
        const sign = firstMatch(match[2] ?? "", /<sign>\s*([^<]+)\s*<\/sign>/i) ?? "?";
        const line = firstMatch(match[2] ?? "", /<line>\s*([^<]+)\s*<\/line>/i) ?? "?";
        const clef = `${number}:${sign}${line}`;
        clefs.add(clef);
        allClefs.push(clef);
        const staff = integer(number, 1);
        staves.add(staff);
        allStaffIdentities.add(`${part.id}:${staff}`);
      }
      const declaredStaves = integer(firstMatch(attrs, /<staves>\s*(\d+)\s*<\/staves>/i), 0);
      for (let staff = 1; staff <= declaredStaves; staff += 1) {
        staves.add(staff);
        allStaffIdentities.add(`${part.id}:${staff}`);
      }
      for (const noteXml of measure.body.match(/<note\b[\s\S]*?<\/note>/gi) ?? []) {
        const staff = integer(firstMatch(noteXml, /<staff>\s*(\d+)\s*<\/staff>/i), 1);
        staves.add(staff);
        allStaffIdentities.add(`${part.id}:${staff}`);
        const voice = firstMatch(noteXml, /<voice>\s*([^<]+)\s*<\/voice>/i);
        if (voice) voices.add(voice.trim());
      }
      maxVoices = Math.max(maxVoices, voices.size);
      const fifths = firstMatch(attrs, /<fifths>\s*(-?\d+)\s*<\/fifths>/i);
      if (fifths !== undefined) {
        const value = integer(fifths, 0);
        const mode = firstMatch(attrs, /<mode>\s*([^<]+)\s*<\/mode>/i)?.trim() ?? "major";
        allKeys.push({ fifths: value, mode });
      }
      const beats = firstMatch(attrs, /<time\b[\s\S]*?<beats>\s*(\d+)\s*<\/beats>/i);
      const beatType = firstMatch(attrs, /<time\b[\s\S]*?<beat-type>\s*(\d+)\s*<\/beat-type>/i);
      if (beats && beatType) allTimes.push([positiveInteger(beats, 4), positiveInteger(beatType, 4)]);
    }
    if (!staves.size) allStaffIdentities.add(`${part.id}:1`);
    if (!clefs.size) addWarning(warnings, { code: "missing-clef", severity: "review", message: `part ${part.id} has no clef declaration`, part: part.id });
    allInstruments.push(part.name);
  }
  if (!scans.length) addWarning(warnings, { code: "missing-parts", severity: "review", message: "MusicXML contains no score parts" });
  const parts: ScorePartSummary[] = scans.map((part) => {
    const staves = new Set<number>();
    const clefs = new Set<string>();
    const voices = new Set<string>();
    for (const measure of part.measures) {
      const attrs = measure.body.match(/<attributes\b[\s\S]*?<\/attributes>/i)?.[0] ?? "";
      for (const match of attrs.matchAll(/<clef\b([^>]*)>([\s\S]*?)<\/clef>/gi)) {
        const number = attr(match[1] ?? "", "number") ?? "1";
        staves.add(integer(number, 1));
        const sign = firstMatch(match[2] ?? "", /<sign>\s*([^<]+)\s*<\/sign>/i) ?? "?";
        const line = firstMatch(match[2] ?? "", /<line>\s*([^<]+)\s*<\/line>/i) ?? "?";
        clefs.add(`${number}:${sign}${line}`);
      }
      for (const noteXml of measure.body.match(/<note\b[\s\S]*?<\/note>/gi) ?? []) {
        staves.add(integer(firstMatch(noteXml, /<staff>\s*(\d+)\s*<\/staff>/i), 1));
        const voice = firstMatch(noteXml, /<voice>\s*([^<]+)\s*<\/voice>/i);
        if (voice) voices.add(voice.trim());
      }
    }
    return {
      id: part.id,
      name: part.name,
      role: part.role,
      roleConfidence: part.roleConfidence,
      staffCount: Math.max(1, staves.size),
      staves: [...staves].sort((a, b) => a - b),
      clefs: [...clefs].sort(),
      voiceCount: Math.max(1, voices.size),
      measureCount: part.measures.length,
    };
  });
  const unique = <T>(values: T[], key: (value: T) => string): T[] => [...new Map(values.map((value) => [key(value), value])).values()];
  return {
    parts,
    partCount: scans.length,
    staffCount: allStaffIdentities.size,
    instrumentNames: unique(allInstruments, (value) => value),
    clefs: unique(allClefs, (value) => value),
    voiceCount: maxVoices,
    tempoBpm: parseTempo(xml) ?? (finite(parsed.tempoBpm) && parsed.tempoBpm > 0 ? parsed.tempoBpm : null),
    timeSignatures: unique(allTimes, (value) => value.join("/")),
    keySignatures: unique(allKeys, (value) => `${value.fifths}:${value.mode}`),
    measureCount: Math.max(0, ...scans.map((part) => part.measures.length)),
  };
}

function validateNotation(xml: string, parsed: ParsedMidi, scans: PartScan[]): { metrics: ScoreValidationMetrics; warnings: ScoreWarning[]; errors: string[] } {
  const warnings: ScoreWarning[] = [];
  const errors: string[] = [];
  const noteElements = xml.match(/<note\b[\s\S]*?<\/note>/gi) ?? [];
  let malformedNoteElements = 0;
  let tuplets = 0;
  let tieStarts = 0;
  let tieStops = 0;
  let orphanTieStarts = 0;
  let orphanTieStops = 0;
  const activeTies = new Set<string>();
  const duplicates = new Map<string, number>();
  for (const noteXml of noteElements) {
    const midi = parsePitch(noteXml);
    const rawDuration = firstMatch(noteXml, /<duration>\s*(-?\d+)\s*<\/duration>/i);
    const duration = Number(rawDuration);
    if (midi === null || !Number.isFinite(duration) || duration <= 0) {
      malformedNoteElements += 1;
      continue;
    }
    const voice = firstMatch(noteXml, /<voice>\s*([^<]+)\s*<\/voice>/i) ?? "1";
    const staff = firstMatch(noteXml, /<staff>\s*(\d+)\s*<\/staff>/i) ?? "1";
    const key = `${staff}:${voice}:${midi}`;
    const tieTypes = [...noteXml.matchAll(/<(?:tie|tied)\b[^>]*\btype\s*=\s*["'](start|stop|continue)["']/gi)].map((match) => match[1]!.toLowerCase());
    for (const type of tieTypes) {
      if (type === "start" || type === "continue") {
        tieStarts += 1;
        if (activeTies.has(key)) addWarning(warnings, { code: "duplicate-tie-start", severity: "review", message: `tie start overlaps an active tie for MIDI ${midi}`, voice, staff: integer(staff, 1) });
        activeTies.add(key);
      }
      if (type === "stop" || type === "continue") {
        tieStops += 1;
        if (!activeTies.delete(key)) {
          orphanTieStops += 1;
          addWarning(warnings, { code: "orphan-tie-stop", severity: "review", message: `tie stop has no matching start for MIDI ${midi}`, voice, staff: integer(staff, 1) });
        }
      }
    }
    const start = firstMatch(noteXml, /default-x\s*=\s*["']([^"']+)["']/i) ?? "unknown";
    const duplicateKey = `${start}:${midi}:${staff}:${voice}`;
    duplicates.set(duplicateKey, (duplicates.get(duplicateKey) ?? 0) + 1);
    if (noteXml.includes("<time-modification")) {
      tuplets += 1;
      const actual = integer(firstMatch(noteXml, /<actual-notes>\s*(\d+)\s*<\/actual-notes>/i), 0);
      const normal = integer(firstMatch(noteXml, /<normal-notes>\s*(\d+)\s*<\/normal-notes>/i), 0);
      if (actual <= 0 || normal <= 0) addWarning(warnings, { code: "malformed-tuplet", severity: "review", message: "tuplet has missing or non-positive actual/normal note counts" });
    }
  }
  for (const [key, count] of duplicates) {
    if (count > 1) {
      addWarning(warnings, { code: "duplicate-notehead", severity: "review", message: `duplicate note event detected (${count} at ${key})` });
    }
  }
  for (const key of activeTies) {
    orphanTieStarts += 1;
    addWarning(warnings, { code: "orphan-tie-start", severity: "review", message: `tie start is not closed (${key})` });
  }
  for (const part of scans) {
    const seenNumbers = new Set<number>();
    let previous = 0;
    for (const [index, measure] of part.measures.entries()) {
      if (seenNumbers.has(measure.number)) addWarning(warnings, { code: "duplicate-measure-number", severity: "review", message: `duplicate measure number ${measure.number}`, part: part.id, measure: measure.number });
      seenNumbers.add(measure.number);
      if (index > 0 && measure.number > previous + 1) addWarning(warnings, { code: "measure-number-gap", severity: "review", message: `measure numbering jumps from ${previous} to ${measure.number}`, part: part.id, measure: measure.number });
      previous = measure.number;
      const expected = measure.timeSig[0] * (4 / measure.timeSig[1]);
      const streams = new Map<string, number>();
      let hasChord = false;
      for (const noteXml of measure.body.match(/<note\b[\s\S]*?<\/note>/gi) ?? []) {
        const duration = Number(firstMatch(noteXml, /<duration>\s*(-?\d+)\s*<\/duration>/i));
        if (!Number.isFinite(duration) || duration <= 0) continue;
        if (/<chord\s*\/>/i.test(noteXml)) {
          hasChord = true;
          continue;
        }
        const voice = firstMatch(noteXml, /<voice>\s*([^<]+)\s*<\/voice>/i) ?? "1";
        const staff = firstMatch(noteXml, /<staff>\s*(\d+)\s*<\/staff>/i) ?? "1";
        const key = `${staff}:${voice}`;
        streams.set(key, (streams.get(key) ?? 0) + duration / measure.divisions);
      }
      const consumed = streams.size ? Math.max(...streams.values()) : 0;
      if (consumed > expected + 0.01) {
        addWarning(warnings, { code: "measure-overfull", severity: "review", message: `measure consumes ${round(consumed)} beats but expects ${round(expected)}`, part: part.id, measure: measure.number });
      } else if (consumed < expected - 0.01 && index !== 0) {
        addWarning(warnings, { code: "measure-underfull", severity: "warning", message: `measure consumes ${round(consumed)} beats but expects ${round(expected)}`, part: part.id, measure: measure.number });
      } else if (consumed < expected - 0.01 && index === 0) {
        addWarning(warnings, { code: "pickup-measure", severity: "warning", message: `opening measure is underfull (${round(consumed)}/${round(expected)} beats); treated as possible pickup`, part: part.id, measure: measure.number });
      }
      if (!hasChord && streams.size === 0) addWarning(warnings, { code: "empty-measure", severity: "review", message: "measure contains no timed note or rest events", part: part.id, measure: measure.number });
      const attrs = measure.body.match(/<attributes\b[\s\S]*?<\/attributes>/i)?.[0] ?? "";
      const fifthsRaw = firstMatch(attrs, /<fifths>\s*(-?\d+)\s*<\/fifths>/i);
      if (fifthsRaw !== undefined && Math.abs(integer(fifthsRaw, 0)) > 7) addWarning(warnings, { code: "invalid-key-signature", severity: "review", message: `key signature fifths=${fifthsRaw} is outside -7..7`, part: part.id, measure: measure.number });
      const beatsRaw = firstMatch(attrs, /<time\b[\s\S]*?<beats>\s*([^<]+)\s*<\/beats>/i);
      const beatTypeRaw = firstMatch(attrs, /<time\b[\s\S]*?<beat-type>\s*([^<]+)\s*<\/beat-type>/i);
      if (beatsRaw && (!/^\d+$/.test(beatsRaw) || Number(beatsRaw) <= 0)) addWarning(warnings, { code: "invalid-time-signature", severity: "review", message: `invalid time numerator ${beatsRaw}`, part: part.id, measure: measure.number });
      if (beatTypeRaw && (!/^\d+$/.test(beatTypeRaw) || Number(beatTypeRaw) <= 0)) addWarning(warnings, { code: "invalid-time-signature", severity: "review", message: `invalid time denominator ${beatTypeRaw}`, part: part.id, measure: measure.number });
    }
  }
  if (parseTempo(xml) === null) addWarning(warnings, { code: "missing-tempo", severity: "warning", message: "no explicit MusicXML tempo marking; parser fallback is 120 BPM" });
  if (!scans.some((part) => part.measures.some((measure) => /<clef\b/i.test(measure.body)))) addWarning(warnings, { code: "missing-clef", severity: "review", message: "no clef declarations were found" });
  if (!parsed.notes.length) errors.push("MusicXML produced no playable notes");
  if (malformedNoteElements) addWarning(warnings, { code: "malformed-note-elements", severity: "review", message: `${malformedNoteElements} note elements had invalid pitch or duration` });
  const sorted = [...parsed.notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let jumps = 0;
  let last: Note | undefined;
  for (const note of sorted) {
    if (last && note.start - last.start > 0.01 && Math.abs(note.midi - last.midi) >= 24) {
      jumps += 1;
      addWarning(warnings, { code: "multi-octave-jump", severity: "review", message: `isolated pitch jump ${Math.abs(note.midi - last.midi)} semitones near beat ${round(note.start)}` });
    }
    if (!last || note.start - last.start > 0.01) last = note;
  }
  const duplicateCount = [...duplicates.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
  const measureMetrics = measureMetricsFor(parsed, scans);
  const densityAnomalies = flagDensityAnomalies(measureMetrics, warnings);
  return {
    metrics: {
      parsedNotes: parsed.notes.length,
      parsedDurationBeats: round(parsed.durationBeats),
      pitchMin: parsed.notes.length ? Math.min(...parsed.notes.map((note) => note.midi)) : null,
      pitchMax: parsed.notes.length ? Math.max(...parsed.notes.map((note) => note.midi)) : null,
      duplicateEvents: duplicateCount,
      multiOctaveJumps: jumps,
      malformedNoteElements,
      tuplets,
      ties: { starts: tieStarts, stops: tieStops, orphanStarts: orphanTieStarts, orphanStops: orphanTieStops },
      measures: measureMetrics,
      densityAnomalies,
    },
    warnings,
    errors,
  };
}

function maxPolyphony(notes: Note[]): number {
  const events: Array<[number, number]> = [];
  for (const note of notes) events.push([note.start, 1], [note.start + note.dur, -1]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    current += delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function measureMetricsFor(parsed: ParsedMidi, scans: PartScan[]): ScoreMeasureMetric[] {
  const firstPart = scans[0];
  if (!firstPart) return [];
  return firstPart.measures.map((measure) => {
    const notes = parsed.notes.filter((note) => note.start >= measure.startBeat - EPSILON && note.start < measure.endBeat - EPSILON);
    const starts = new Set(notes.map((note) => note.start.toFixed(6)));
    return {
      measure: measure.number,
      notes: notes.length,
      attacks: starts.size,
      notesPerBeat: round(notes.length / Math.max(measure.endBeat - measure.startBeat, EPSILON)),
      maxPolyphony: maxPolyphony(notes),
      pitchMin: notes.length ? Math.min(...notes.map((note) => note.midi)) : null,
      pitchMax: notes.length ? Math.max(...notes.map((note) => note.midi)) : null,
      pitchClasses: new Set(notes.map((note) => note.midi % 12)).size,
    };
  });
}

function flagDensityAnomalies(metrics: ScoreMeasureMetric[], warnings: ScoreWarning[]): number {
  let anomalies = 0;
  for (let index = 0; index < metrics.length; index += 1) {
    const current = metrics[index]!;
    const neighbors = metrics.filter((_, candidate) => candidate !== index && Math.abs(candidate - index) <= 2).map((item) => item.notesPerBeat).filter((value) => value > 0);
    if (!neighbors.length) continue;
    const sorted = [...neighbors].sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)]!;
    if (current.notes > 32 && current.notesPerBeat > Math.max(8, baseline * 4)) {
      anomalies += 1;
      addWarning(warnings, { code: "density-explosion", severity: "review", message: `measure has ${current.notes} notes (${round(current.notesPerBeat)}/beat) versus local baseline ${round(baseline)}/beat`, measure: current.measure });
    }
  }
  return anomalies;
}

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  // Filesystem directory order is not a stable contract.  Audiveris normally
  // emits one export, but a project can contain more than one MXL/XML file;
  // sort the complete recursive result so the precedence below is reproducible
  // across filesystems and runs.
  return output.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function executableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
  return code === "ENOENT" || code === "ENOTDIR" || String(code) === "127";
}

const MACOS_AUDIVERIS_EXECUTABLE = "/Applications/Audiveris.app/Contents/MacOS/Audiveris";

async function regularFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Resolve the optional local Audiveris installation without changing CI dependencies. */
export async function resolveAudiverisExecutable(
  configured?: string,
  platform: NodeJS.Platform = process.platform,
  executableExists: (path: string) => Promise<boolean> = regularFileExists,
): Promise<string> {
  const explicit = configured?.trim();
  if (explicit) return explicit;
  if (platform === "darwin" && await executableExists(MACOS_AUDIVERIS_EXECUTABLE)) {
    return MACOS_AUDIVERIS_EXECUTABLE;
  }
  return "audiveris";
}

async function probeExecutable(executable: string, label: string, timeoutMs: number): Promise<string> {
  let lastError: unknown;
  for (const args of [["-version"], ["--version"], ["-help"]]) {
    try {
      const result = await execFile(executable, args, { shell: false, timeout: Math.min(timeoutMs, 30_000), maxBuffer: 2 * 1024 * 1024 });
      const output = `${result.stdout}\n${result.stderr}`;
      const version = output.match(/\b(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)\b/)?.[1];
      return version ?? "unknown";
    } catch (error) {
      lastError = error;
      if (executableMissing(error)) throw new Error(`${label} backend unavailable: ${executable}`);
    }
  }
  // Some Audiveris builds exit non-zero for an informational flag but still
  // work for -batch -export.  The executable was found, so retain unknown
  // version and let the real conversion be authoritative.
  if (lastError && executableMissing(lastError)) throw new Error(`${label} backend unavailable: ${executable}`);
  return "unknown";
}

async function invokeAudiveris(executable: string, pdf: PdfInput, outputDir: string, timeoutMs: number): Promise<{ version: string; file: string; bytes: Uint8Array; format: XmlSource["rawFormat"] }> {
  const version = await probeExecutable(executable, "Audiveris", timeoutMs);
  await execFile(executable, ["-batch", "-export", "-output", outputDir, pdf.path], {
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const files = await walkFiles(outputDir);
  const candidate = files.find((file) => /\.mxl$/i.test(file)) ?? files.find((file) => /\.(?:musicxml|xml)$/i.test(file));
  if (!candidate) throw new Error("Audiveris completed without an MXL or MusicXML export");
  const bytes = new Uint8Array(await readFile(candidate));
  if (/\.mxl$/i.test(candidate)) return { version, file: candidate, bytes, format: "mxl" };
  const xml = normalizeMusicXml(new TextDecoder().decode(bytes));
  return { version, file: candidate, bytes: wrapMusicXml(xml), format: "musicxml-wrapped" };
}

function statusFor(errors: string[], warnings: ScoreWarning[]): ScoreValidationStatus {
  if (errors.length) return "FAILED";
  if (warnings.some((warning) => warning.severity === "review")) return "REVIEW_REQUIRED";
  if (warnings.length) return "PASS_WITH_WARNINGS";
  return "PASS";
}

function emptyMetrics(): ScoreValidationMetrics {
  return {
    parsedNotes: 0,
    parsedDurationBeats: 0,
    pitchMin: null,
    pitchMax: null,
    duplicateEvents: 0,
    multiOctaveJumps: 0,
    malformedNoteElements: 0,
    tuplets: 0,
    ties: { starts: 0, stops: 0, orphanStarts: 0, orphanStops: 0 },
    measures: [],
    densityAnomalies: 0,
  };
}

function baseReport(pdf: { fileName: string; sha256: string | null; pages: number | null }, options: ScoreBenchmarkOptions): ScoreValidationReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    status: "FAILED",
    source: pdf,
    omr: { backend: "Audiveris", version: null, status: "FAILED" },
    normalization: { version: NORMALIZATION_VERSION, policy: "line-ending/BOM normalization only; no musical repair", repairs: [] },
    structure: null,
    metrics: null,
    errors: [],
    warnings: [],
    manualReview: "not-reviewed",
    artifacts: {
      musicxml: null,
      midi: null,
      notes: null,
      audio: options.noAudio ? { status: "SKIPPED", reason: "audio rendering disabled" } : { status: "UNAVAILABLE", reason: "not attempted" },
      notation: options.noNotation ? { status: "SKIPPED", reason: "notation rendering disabled" } : { status: "UNAVAILABLE", reason: "not attempted" },
    },
  };
}

function markdownReport(report: ScoreValidationReport): string {
  const lines = [
    `# Score benchmark report`,
    ``,
    `- Status: **${report.status}**`,
    `- Source: \`${report.source.fileName}\``,
    `- Source SHA-256: \`${report.source.sha256 ?? "unavailable"}\``,
    `- OMR: ${report.omr.backend} ${report.omr.version ?? "unknown"} (${report.omr.status})`,
    `- Normalization: ${report.normalization.version}`,
    `- Manual review: ${report.manualReview}`,
    ``,
  ];
  if (report.errors.length) lines.push("## Errors", "", ...report.errors.map((error) => `- ${error}`), "");
  if (report.warnings.length) lines.push("## Warnings", "", ...report.warnings.map((warning) => `- [${warning.severity}] ${warning.code}: ${warning.message}`), "");
  if (report.structure) {
    lines.push("## Structure", "", `- Parts: ${report.structure.partCount}`, `- Staves: ${report.structure.staffCount}`, `- Measures: ${report.structure.measureCount}`, `- Voices: ${report.structure.voiceCount}`, `- Tempo: ${report.structure.tempoBpm ?? "unknown"} BPM`, `- Clefs: ${report.structure.clefs.join(", ") || "none"}`, "");
    lines.push("| Part | Role | Staves | Voices | Measures |", "| --- | --- | ---: | ---: | ---: |", ...report.structure.parts.map((part) => `| ${part.name} | ${part.role} (${part.roleConfidence}) | ${part.staffCount} | ${part.voiceCount} | ${part.measureCount} |`), "");
  }
  if (report.metrics) {
    lines.push("## Metrics", "", `- Parsed notes: ${report.metrics.parsedNotes}`, `- Duration: ${report.metrics.parsedDurationBeats} beats`, `- Pitch range: ${report.metrics.pitchMin ?? "-"}–${report.metrics.pitchMax ?? "-"}`, `- Duplicate events: ${report.metrics.duplicateEvents}`, `- Multi-octave jumps: ${report.metrics.multiOctaveJumps}`, `- Density anomalies: ${report.metrics.densityAnomalies}`, `- Tuplets: ${report.metrics.tuplets}`, `- Ties: ${report.metrics.ties.starts} starts / ${report.metrics.ties.stops} stops`, "");
  }
  lines.push("## Artifacts", "", `- MusicXML: ${report.artifacts.musicxml ?? "unavailable"}`, `- MIDI: ${report.artifacts.midi ?? "unavailable"}`, `- Normalized notes: ${report.artifacts.notes ?? "unavailable"}`, `- Audio: ${report.artifacts.audio.status}${report.artifacts.audio.reason ? ` (${report.artifacts.audio.reason})` : ""}`, `- Notation preview: ${report.artifacts.notation.status}${report.artifacts.notation.reason ? ` (${report.artifacts.notation.reason})` : ""}`, "", "Raw OMR and all derived files are local benchmark evidence, not ground truth. Musical corrections require manual notation review.", "");
  return lines.join("\n");
}

async function writeJsonAtomic(path: string, value: unknown, root?: string): Promise<void> {
  if (root) {
    await ensureOutputDirectory(dirname(path), root, "output directory");
    await assertSafeOutputPath(path, root, "output artifact");
  } else {
    await mkdir(dirname(path), { recursive: true });
  }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeText(path: string, contents: string, root: string): Promise<void> {
  await ensureOutputDirectory(dirname(path), root, "output directory");
  await assertSafeOutputPath(path, root, "output artifact");
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeBytes(path: string, bytes: Uint8Array, root?: string): Promise<void> {
  if (root) {
    await ensureOutputDirectory(dirname(path), root, "output directory");
    await assertSafeOutputPath(path, root, "output artifact");
  } else {
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFile(path, bytes, { flag: "wx" });
}

async function artifactMeta(path: string, root: string): Promise<{ path: string; bytes: number; sha256: string }> {
  const bytes = new Uint8Array(await readFile(path));
  return { path: posixRelative(root, path), bytes: bytes.byteLength, sha256: hashBytes(bytes) };
}

async function renderAudio(midiPath: string, wavPath: string, options: ScoreBenchmarkOptions, root: string): Promise<ScoreRenderArtifact> {
  if (options.noAudio) return { status: "SKIPPED", reason: "audio rendering disabled" };
  try {
    await assertSafeOutputPath(wavPath, root, "audio output");
    const result = await renderMidiToWav({ midiPath, outputPath: wavPath }, {
      ...(options.fluidsynth ? { executable: options.fluidsynth } : {}),
      ...(options.soundfont ? { soundfontPath: options.soundfont } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const meta = await artifactMeta(wavPath, root);
    return {
      status: "PASS",
      ...meta,
      renderer: {
        backend: result.renderer.id,
        version: result.renderer.version,
        sampleRate: result.renderer.sampleRate,
        gain: result.renderer.gain,
        targetPeak: result.renderer.targetPeak,
        soundfont: { identifier: basename(result.soundfont.path), sha256: result.soundfont.sha256 },
      },
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    return { status: code === "BACKEND_UNAVAILABLE" || code === "SOUNDFONT_UNAVAILABLE" ? "UNAVAILABLE" : "FAILED", reason: sanitizeText(error, "FluidSynth render unavailable") };
  }
}

async function renderNotation(xmlPath: string, outputPath: string, options: ScoreBenchmarkOptions, root: string): Promise<ScoreRenderArtifact> {
  if (options.noNotation) return { status: "SKIPPED", reason: "notation rendering disabled" };
  const executable = options.musescore ?? process.env.KEYSPILLI_MUSESCORE ?? "musescore";
  try {
    await assertSafeOutputPath(outputPath, root, "notation output");
    await probeExecutable(executable, "MuseScore", options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    await execFile(executable, ["-o", outputPath, xmlPath], { shell: false, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const meta = await artifactMeta(outputPath, root);
    return { status: "PASS", ...meta, renderer: { backend: "musescore", version: "unknown" } };
  } catch (error) {
    return { status: executableMissing(error) ? "UNAVAILABLE" : "FAILED", reason: sanitizeText(error, "MuseScore unavailable") };
  }
}

async function artifactMetaAt(root: string, value: string | null | undefined): Promise<{ path: string; bytes: number; sha256: string } | null> {
  if (!value || isAbsolute(value)) return null;
  const path = resolve(root, value);
  if (!isInside(root, path)) return null;
  await assertSafeOutputPath(path, root, "artifact path");
  try {
    return await artifactMeta(path, root);
  } catch {
    return null;
  }
}

async function updateCorpus(
  path: string,
  root: string,
  artifactRoot: string,
  pdf: { fileName: string; sha256: string | null; pages: number | null; bytes?: number },
  report: ScoreValidationReport,
  id: string,
  title: string,
  artist: string,
  conversionTimestamp: string,
): Promise<void> {
  let existing: { schemaVersion?: number; songs?: Array<Record<string, unknown>> } = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    const validation = validateBenchmarkCorpusManifest(parsed);
    if (!validation.valid) {
      throw new Error(`existing corpus manifest is malformed; refusing overwrite: ${validation.errors.join("; ")}`);
    }
    existing = parsed as typeof existing;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("existing corpus manifest is malformed")) throw error;
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
      // A new corpus manifest is expected on the first score.
    } else if (error instanceof SyntaxError) {
      throw new Error("existing corpus manifest is malformed JSON; refusing overwrite");
    } else {
      throw error;
    }
  }
  const [musicXml, midi, notes] = await Promise.all([
    artifactMetaAt(artifactRoot, report.artifacts.musicxml),
    artifactMetaAt(artifactRoot, report.artifacts.midi),
    artifactMetaAt(artifactRoot, report.artifacts.notes),
  ]);
  const references: Record<string, string> = {};
  if (musicXml) references.fullScore = posixRelative(root, join(artifactRoot, musicXml.path));
  if (midi) references.piano = posixRelative(root, join(artifactRoot, midi.path));
  if (notes) references.harmony = posixRelative(root, join(artifactRoot, notes.path));
  if (!pdf.sha256 || Object.keys(references).length === 0) return;
  const entry: Record<string, unknown> = {
    id,
    artist,
    title,
    score: { sha256: pdf.sha256, bytes: pdf.bytes, pages: pdf.pages ?? undefined, omrStatus: report.omr.status },
    references,
    validation: { status: report.status, warnings: report.warnings.map((warning) => `${warning.code}: ${warning.message}`) },
  };
  if (musicXml && midi && report.omr.version) {
    entry.provenance = createScoreProvenance({
      sourcePdfSha256: pdf.sha256,
      sourcePdfBytes: pdf.bytes,
      sourcePdfPages: pdf.pages ?? undefined,
      sourcePdfName: pdf.fileName,
      omrBackend: report.omr.backend,
      omrVersion: report.omr.version,
      conversionTimestamp,
      normalizationVersion: report.normalization.version,
      musicXmlSha256: musicXml.sha256,
      musicXmlBytes: musicXml.bytes,
      midiSha256: midi.sha256,
      midiBytes: midi.bytes,
      validationStatus: report.status,
      manualReviewStatus: report.manualReview,
    });
  }
  const songs = (existing.songs ?? []).filter((song) => song.id !== id);
  songs.push(entry);
  songs.sort((left, right) => {
    const a = String(left.id);
    const b = String(right.id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const manifest = createBenchmarkCorpusManifest({ songs: songs as unknown as BenchmarkCorpusSong[] });
  await writeJsonAtomic(path, JSON.parse(`${canonicalBenchmarkCorpusJson(manifest)}\n`), root);
}

function defaultId(pdfFileName: string): string {
  return slugify(pdfFileName.replace(/\.pdf$/i, ""));
}

function optionValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function numberOption(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive finite number`);
  return parsed;
}

export function usage(): string {
  return [
    "Usage: benchmark-score.ts --pdf FILE --out DIR [options]",
    "  --pdf FILE             local PDF outside the repository",
    "  --out DIR              local output directory outside the repository",
    "  --id ID                logical corpus id (defaults to PDF basename)",
    "  --title TEXT           logical title (defaults to PDF basename)",
    "  --artist TEXT          logical artist (defaults to Unknown)",
    "  --audiveris FILE       Audiveris executable (or KEYSPILLI_AUDIVERIS)",
    "  --musescore FILE       optional MuseScore executable",
    "  --fluidsynth FILE      optional FluidSynth executable",
    "  --soundfont FILE       optional SoundFont (or KEYSPILLI_SOUNDFONT)",
    "  --corpus-manifest FILE benchmark-corpus.json path",
    "  --timeout-ms N         external backend timeout (default 600000)",
    "  --no-audio             skip local FluidSynth render",
    "  --no-notation          skip local MuseScore render",
    "  --no-corpus             do not update benchmark-corpus.json",
  ].join("\n");
}

export function parseArgs(argv: readonly string[]): ScoreBenchmarkOptions {
  let pdf: string | undefined;
  let out: string | undefined;
  const result: Omit<ScoreBenchmarkOptions, "pdf" | "out"> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const flag = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = optionValue(argv, index, flag);
      index = next[1];
      return next[0];
    };
    switch (flag) {
      case "--pdf": pdf = value(); break;
      case "--out": out = value(); break;
      case "--id": result.id = value(); break;
      case "--title": result.title = value(); break;
      case "--artist": result.artist = value(); break;
      case "--audiveris": result.audiveris = value(); break;
      case "--musescore": result.musescore = value(); break;
      case "--fluidsynth": result.fluidsynth = value(); break;
      case "--soundfont": result.soundfont = value(); break;
      case "--corpus-manifest": result.corpusManifest = value(); break;
      case "--timeout-ms": result.timeoutMs = numberOption(value(), flag); break;
      case "--no-audio": result.noAudio = true; break;
      case "--no-notation": result.noNotation = true; break;
      case "--no-corpus": result.noCorpus = true; break;
      case "--help": case "-h": throw new Error(usage());
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!pdf || !out) throw new Error(`--pdf and --out are required\n${usage()}`);
  if (result.id && !/^[a-z0-9][a-z0-9-]{0,119}$/i.test(result.id)) throw new Error("--id must be a simple logical identifier");
  return { pdf, out, ...result };
}

async function prepareArtifacts(xmlSource: XmlSource): Promise<PreparedArtifacts> {
  const xml = normalizeMusicXml(xmlSource.xml);
  const scans = scanParts(xml);
  const parsedPartList = parsedParts(xml, scans);
  const first = parsedPartList[0]?.parsed ?? parseMusicXmlNotes(xml);
  const parsed: ParsedMidi = {
    ...first,
    notes: parsedPartList.flatMap((part) => part.notes),
    durationBeats: parsedPartList.reduce((max, part) => Math.max(max, part.parsed.durationBeats), 0),
    trackNames: parsedPartList.map((part) => part.name),
  };
  const warnings: ScoreWarning[] = [];
  const structure = parseStructure(xml, parsed, scans, warnings);
  const notation = validateNotation(xml, parsed, scans);
  warnings.push(...notation.warnings);
  const errors = [...notation.errors];
  if (!/<score-partwise\b/i.test(xml)) errors.push("OMR output is not a score-partwise MusicXML document");
  if (!scans.length) errors.push("MusicXML contains no parts");
  const notes = parsed.notes;
  const tracks = parsedPartList.flatMap((part) => [
    { name: `${part.name} RH`, notes: part.notes.filter((note) => note.hand !== "L") },
    { name: `${part.name} LH`, notes: part.notes.filter((note) => note.hand === "L") },
  ]).filter((track) => track.notes.length > 0);
  const midi = writeMidi([], {
    tempoBpm: finite(parsed.tempoBpm) && parsed.tempoBpm > 0 ? parsed.tempoBpm : 120,
    timeSig: parsed.timeSig,
    keySig: parsed.keySig,
    keyMode: parsed.keyMode,
    title: parsed.title,
    tracks: tracks.length ? tracks : [{ name: "Reference", notes: [] }],
  });
  // Parsing our own output catches a broken conversion before it becomes a
  // benchmark reference.  This does not assert musical correctness.
  try {
    const reparsed = parseMidi(midi);
    if (reparsed.notes.length !== parsed.notes.length) errors.push(`MIDI roundtrip changed note count (${parsed.notes.length} -> ${reparsed.notes.length})`);
  } catch (error) {
    errors.push(`generated MIDI failed structural parse: ${safeError(error)}`);
  }
  return { ...xmlSource, xml, parsed, partNotes: parsedPartList, midi, structure, metrics: notation.metrics, warnings, errors };
}

async function sourceMetadata(
  pdf: { fileName: string; sha256: string | null; pages: number | null; bytes?: number },
  report: ScoreValidationReport,
  timestamp: string,
  artifactRoot: string,
): Promise<Record<string, unknown>> {
  const [musicXml, midi, notes] = await Promise.all([
    artifactMetaAt(artifactRoot, report.artifacts.musicxml),
    artifactMetaAt(artifactRoot, report.artifacts.midi),
    artifactMetaAt(artifactRoot, report.artifacts.notes),
  ]);
  const metadata: Record<string, unknown> = {
    schemaVersion: 1,
    sourcePdf: { fileName: pdf.fileName, bytes: pdf.bytes ?? null, sha256: pdf.sha256, pages: pdf.pages },
    omr: { backend: report.omr.backend, version: report.omr.version, status: report.omr.status, rawFormat: report.omr.rawFormat ?? null },
    conversion: { convertedAt: timestamp, normalizationVersion: report.normalization.version, manualReviewStatus: report.manualReview },
    outputs: {
      musicxml: report.artifacts.musicxml,
      midi: report.artifacts.midi,
      notes: report.artifacts.notes,
      audio: report.artifacts.audio.status === "PASS" ? {
        path: report.artifacts.audio.path,
        bytes: report.artifacts.audio.bytes,
        sha256: report.artifacts.audio.sha256,
        renderer: report.artifacts.audio.renderer ?? null,
      } : null,
      notation: report.artifacts.notation.status === "PASS" ? { path: report.artifacts.notation.path, sha256: report.artifacts.notation.sha256 } : null,
    },
    derivedArtifacts: {
      musicxml: musicXml,
      midi,
      notes,
    },
    validation: { status: report.status, warningCount: report.warnings.length, errorCount: report.errors.length },
  };
  if (pdf.sha256 && musicXml && midi && report.omr.version) {
    metadata.provenance = createScoreProvenance({
      sourcePdfSha256: pdf.sha256,
      sourcePdfBytes: pdf.bytes,
      sourcePdfPages: pdf.pages ?? undefined,
      sourcePdfName: pdf.fileName,
      omrBackend: report.omr.backend,
      omrVersion: report.omr.version,
      conversionTimestamp: timestamp,
      normalizationVersion: report.normalization.version,
      musicXmlSha256: musicXml.sha256,
      musicXmlBytes: musicXml.bytes,
      midiSha256: midi.sha256,
      midiBytes: midi.bytes,
      validationStatus: report.status,
      manualReviewStatus: report.manualReview,
    });
  }
  return metadata;
}

export async function runBenchmarkScore(options: ScoreBenchmarkOptions): Promise<ScoreBenchmarkResult> {
  const out = resolve(options.out);
  await ensureOutputDirectory(out, out, "output directory");
  const requestedName = basename(options.pdf);
  const logicalId = options.id ?? defaultId(requestedName);
  const title = options.title?.trim() || requestedName.replace(/\.pdf$/i, "");
  const artist = options.artist?.trim() || "Unknown";
  let pdf: PdfInput | undefined;
  try {
    pdf = await validatePdf(options.pdf);
  } catch (error) {
    const report = baseReport({ fileName: requestedName, sha256: null, pages: null }, options);
    report.errors.push(safeError(error, "invalid PDF input"));
    const timestamp = new Date().toISOString();
    await writeJsonAtomic(join(out, "validation", "report.json"), report, out);
    await writeText(join(out, "validation", "report.md"), markdownReport(report), out);
    await writeJsonAtomic(join(out, "source-metadata.json"), await sourceMetadata(report.source, report, timestamp, out), out);
    const manifest = options.noCorpus ? null : resolve(options.corpusManifest ?? join(dirname(out), "benchmark-corpus.json"));
    if (manifest) {
      await assertOutsideRepository(manifest, "corpus manifest");
    }
    // Invalid source files are not corpus records: without a source hash there
    // is no safe identity to publish, and a FAILED entry would violate the
    // corpus manifest contract. Leave an existing manifest untouched.
    return { status: report.status, out, report, corpusManifest: manifest };
  }

  const report = baseReport(pdf, options);
  report.source = { fileName: pdf.fileName, sha256: pdf.sha256, pages: pdf.pages };
  const omrExecutable = await resolveAudiverisExecutable(options.audiveris ?? process.env.KEYSPILLI_AUDIVERIS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const omrDir = join(out, "omr");
  const normalizedDir = join(out, "normalized");
  const validationDir = join(out, "validation");
  await ensureOutputDirectory(omrDir, out, "OMR output directory");
  await ensureOutputDirectory(normalizedDir, out, "normalized output directory");
  await ensureOutputDirectory(validationDir, out, "validation output directory");
  const timestamp = new Date().toISOString();
  let manifest: string | null = options.noCorpus ? null : resolve(options.corpusManifest ?? join(dirname(out), "benchmark-corpus.json"));
  try {
    if (manifest) await assertOutsideRepository(manifest, "corpus manifest");
    const scratch = await mkdtemp(join(omrDir, ".audiveris-"));
    try {
      const omr = await invokeAudiveris(omrExecutable, pdf, scratch, timeoutMs);
      report.omr = { backend: "Audiveris", version: omr.version, status: "PASS", rawFormat: omr.format };
      const rawMxlPath = join(omrDir, "raw.mxl");
      await writeBytes(rawMxlPath, omr.bytes, out);
      const xml = omr.format === "mxl" ? xmlFromMxl(omr.bytes) : new TextDecoder().decode(omr.bytes);
      const prepared = await prepareArtifacts({ xml, rawMxl: omr.bytes, rawFormat: omr.format });
      const xmlPath = join(normalizedDir, "reference.musicxml");
      const midiPath = join(normalizedDir, "reference.mid");
      const notesPath = join(normalizedDir, "notes.json");
      await writeText(xmlPath, prepared.xml, out);
      await writeBytes(midiPath, prepared.midi, out);
      const normalizedNotes = {
        schemaVersion: 1,
        tempoBpm: finite(prepared.parsed.tempoBpm) ? round(prepared.parsed.tempoBpm, 6) : null,
        timeSig: prepared.parsed.timeSig,
        notes: prepared.partNotes.flatMap((part, partIndex) => part.notes.map((note, noteIndex) => {
          const metadata = part.metadata[noteIndex] ?? {};
          return ({
            part: part.name,
            partId: part.id,
            partIndex,
            noteIndex,
            role: part.role,
            roleConfidence: part.roleConfidence,
            midi: note.midi,
            start: round(note.start, 6),
            dur: round(note.dur, 6),
            vel: round(note.vel, 3),
            hand: note.hand ?? "R",
            ...(metadata.staff === undefined ? {} : { staff: metadata.staff }),
            ...(metadata.voice === undefined ? {} : { voice: metadata.voice }),
            ...(metadata.measure === undefined ? {} : { measure: metadata.measure }),
            ...(metadata.beat === undefined ? {} : { beat: metadata.beat }),
            source: metadata.source ?? `score-part:${part.id}`,
            ...(note.lyrics ? { lyrics: note.lyrics } : {}),
          });
        })).sort((a, b) => a.start - b.start || a.midi - b.midi || a.partIndex - b.partIndex || a.noteIndex - b.noteIndex),
      };
      await writeJsonAtomic(notesPath, normalizedNotes, out);
      report.normalization.repairs = [];
      report.structure = prepared.structure;
      report.metrics = prepared.metrics;
      report.warnings.push(...prepared.warnings);
      report.errors.push(...prepared.errors);
      report.artifacts.musicxml = posixRelative(out, xmlPath);
      report.artifacts.midi = posixRelative(out, midiPath);
      report.artifacts.notes = posixRelative(out, notesPath);
      report.status = statusFor(report.errors, report.warnings);
      report.artifacts.audio = await renderAudio(midiPath, join(normalizedDir, "reference.wav"), options, out);
      report.artifacts.notation = await renderNotation(xmlPath, join(validationDir, "normalized-score.pdf"), options, out);
      if (report.artifacts.audio.status === "FAILED") addWarning(report.warnings, { code: "audio-render-failed", severity: "warning", message: report.artifacts.audio.reason ?? "audio render failed" });
      if (report.artifacts.notation.status === "FAILED") addWarning(report.warnings, { code: "notation-render-failed", severity: "warning", message: report.artifacts.notation.reason ?? "notation render failed" });
      report.status = statusFor(report.errors, report.warnings);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } catch (error) {
    report.omr = { backend: "Audiveris", version: null, status: "FAILED", reason: safeError(error, "Audiveris conversion failed") };
    report.errors.push(report.omr.reason!);
    report.status = "FAILED";
  }
  await writeJsonAtomic(join(validationDir, "report.json"), report, out);
  await writeText(join(validationDir, "report.md"), markdownReport(report), out);
  const pdfInfo = await stat(pdf.path);
  const metadata = await sourceMetadata({ fileName: pdf.fileName, sha256: pdf.sha256, pages: pdf.pages, bytes: pdfInfo.size }, report, timestamp, out);
  await writeJsonAtomic(join(out, "source-metadata.json"), metadata, out);
  if (manifest) await updateCorpus(manifest, dirname(manifest), out, { fileName: pdf.fileName, sha256: pdf.sha256, pages: pdf.pages, bytes: pdf.bytes.byteLength }, report, logicalId, title, artist, timestamp);
  return { status: report.status, out, report, corpusManifest: manifest };
}

async function main(): Promise<void> {
  let options: ScoreBenchmarkOptions;
  if (process.argv.slice(2).includes("--help") || process.argv.slice(2).includes("-h")) {
    console.log(usage());
    return;
  }
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(safeError(error, usage()));
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runBenchmarkScore(options);
    process.stdout.write(JSON.stringify({ status: result.status, out: result.out, corpusManifest: result.corpusManifest, report: posixRelative(result.out, join(result.out, "validation", "report.json")) }, null, 2) + "\n");
    if (result.status === "FAILED") process.exitCode = 1;
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && (process.argv[1].endsWith("benchmark-score.ts") || process.argv[1].endsWith("benchmark-score.js"))) {
  void main();
}
