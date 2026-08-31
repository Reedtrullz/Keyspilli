/**
 * Local-only rotating blind-listening materializer.
 *
 * The selector is deliberately delegated to score-listening-pack.ts. This
 * adapter only reads explicitly supplied local MIDI paths through an injected
 * renderer, writes derived WAV excerpts outside the repository, and emits a
 * path-free public manifest. It does not upload, publish, or touch catalog
 * state. Melody is intentionally not a worksheet dimension in this frozen
 * review slice.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { MidiAudioRenderer, MidiRenderResult } from "./midi-renderer.js";
import {
  pathSafeScoreReference,
  selectRotatingScoreListeningPack,
  type ScoreCorpusSong,
  type ScoreListeningPack,
  type ScoreListeningPackExcerpt,
} from "./score-listening-pack.js";

export const ROTATING_LISTENING_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface RotatingListeningSectionDescriptor {
  id: string;
  startSeconds: number;
  endSeconds: number;
  label?: string;
  role?: string;
  preference?: string;
}

export interface RotatingListeningCandidateDescriptor {
  midiPath?: string;
  path?: string;
  label?: string;
}

export interface RotatingListeningSongDescriptor {
  id: string;
  artist?: string;
  title?: string;
  /** Explicit local candidate paths. Baseline is A and current is B. */
  baselineMidiPath?: string;
  currentMidiPath?: string;
  /** Aliases accepted for callers that use candidate objects. */
  baseline?: string | RotatingListeningCandidateDescriptor;
  current?: string | RotatingListeningCandidateDescriptor;
  candidates?: {
    baseline?: string | RotatingListeningCandidateDescriptor;
    current?: string | RotatingListeningCandidateDescriptor;
  };
  sections?: readonly RotatingListeningSectionDescriptor[];
  durationSeconds?: number;
}

export interface RotatingListeningBundleOptions {
  songs: readonly RotatingListeningSongDescriptor[];
  outputRoot: string;
  repositoryRoot?: string;
  seed?: string | number;
  targetSeconds?: number;
  minSeconds?: number;
  maxSeconds?: number;
  minSongs?: number;
  minSectionSeconds?: number;
  maxSectionSeconds?: number;
  normalization?: Partial<RotatingListeningNormalization>;
}

export interface RotatingListeningBundleDependencies {
  renderer?: MidiAudioRenderer;
}

export interface RotatingListeningNormalization {
  method: "peak" | "none";
  targetPeakDb: number;
  maxGainDb: number;
  sampleRate: number;
  channels: 1 | 2;
}

export type RotatingListeningArtifactStatus = "rendered" | "unavailable" | "failed";

export interface RotatingListeningAudioRecord {
  ref: string;
  bytes: number;
  sha256: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  peak: number;
  rms: number;
  silenceRatio: number;
  clippingCount: number;
}

export interface RotatingListeningCandidateRecord {
  status: RotatingListeningArtifactStatus;
  audio: RotatingListeningAudioRecord | null;
  reason?: string;
}

export interface RotatingListeningManifestExcerpt {
  id: string;
  songId: string;
  sectionId: string;
  label: string | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  candidates: { A: RotatingListeningCandidateRecord; B: RotatingListeningCandidateRecord };
}

export interface RotatingListeningManifest {
  schemaVersion: typeof ROTATING_LISTENING_BUNDLE_SCHEMA_VERSION;
  kind: "rotating-multi-song-blind-listening-bundle";
  pathSafe: true;
  packId: string;
  seed: string;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  totalSeconds: number;
  status: "ready" | "insufficient" | "unavailable";
  songs: Array<{ id: string; artist: string | null; title: string | null }>;
  excerpts: RotatingListeningManifestExcerpt[];
  renderer: RotatingListeningRendererMetadata;
  normalization: RotatingListeningNormalization;
  warnings: string[];
  errors: Array<{ code: string; message: string; songId?: string; candidate?: "A" | "B" }>;
  blindMap: "blind-map.json";
  worksheet: "LISTENING.md";
}

export interface RotatingListeningRendererMetadata {
  status: "rendered" | "unavailable";
  id: string | null;
  version: string | null;
  sampleRate: number | null;
  channels: number | null;
  gain: number | null;
  targetPeak: number | null;
  soundfont: {
    identifier: string | null;
    bytes: number | null;
    sha256: string | null;
  } | null;
}

export interface RotatingListeningBlindMapEntry {
  songId: string;
  sectionId: string;
  excerptId: string;
  aliases: {
    A: { candidateId: "baseline"; midiRef: string | null };
    B: { candidateId: "current"; midiRef: string | null };
  };
}

export interface RotatingListeningBlindMap {
  schemaVersion: 1;
  kind: "rotating-multi-song-blind-listening-answer-key";
  packId: string;
  entries: Record<string, RotatingListeningBlindMapEntry>;
}

export interface RotatingListeningBundleResult {
  manifest: RotatingListeningManifest;
  manifestPath: string;
  blindMap: RotatingListeningBlindMap;
  blindMapPath: string;
  worksheet: string;
  worksheetPath: string;
  pack: ScoreListeningPack;
}

interface CandidatePaths {
  baseline?: string;
  current?: string;
}

interface WavInfo {
  bytes: Uint8Array;
  sampleRate: number;
  channels: number;
  dataOffset: number;
  dataLength: number;
}

const EPSILON = 1e-9;
const DEFAULT_NORMALIZATION: RotatingListeningNormalization = {
  method: "peak",
  targetPeakDb: -1,
  maxGainDb: 12,
  sampleRate: 44_100,
  channels: 2,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeId(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a non-empty path-safe id`);
  const result = value.trim();
  if (!result || result === "." || result === ".." || result.includes("/") || result.includes("\\") || /[\0\r\n]/.test(result)) {
    throw new Error(`${field} must be a non-empty path-safe id`);
  }
  return result;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return redact(text).slice(0, 240);
}

function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/(?:file:\/\/)?\/[^\s"'<>;,)]*/g, "[redacted-path]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>;,)]*/g, "[redacted-path]")
    .replace(/(^|[\s("'=,;:\[\]])(?:\.\.?\/|[^\s/]+\/)[^\s"']+\.(?:mid|midi|wav|mp3|sf2)(?=$|[\s"'])/gi, "$1[redacted-path]")
    .replace(/[\0\r\n]+/g, " ")
    .slice(0, 500);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => [key, stable(item)]));
}

function json(value: unknown): string {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function candidatePath(value: string | RotatingListeningCandidateDescriptor | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object") return (value.midiPath ?? value.path)?.trim() || undefined;
  return undefined;
}

function pathsFor(song: RotatingListeningSongDescriptor): CandidatePaths {
  const baseline = song.baselineMidiPath ?? candidatePath(song.baseline) ?? candidatePath(song.candidates?.baseline);
  const current = song.currentMidiPath ?? candidatePath(song.current) ?? candidatePath(song.candidates?.current);
  return { ...(baseline ? { baseline } : {}), ...(current ? { current } : {}) };
}

function sectionsFor(song: RotatingListeningSongDescriptor): RotatingListeningSectionDescriptor[] {
  if (song.sections?.length) return song.sections.map((section) => ({ ...section }));
  if (finite(song.durationSeconds) && song.durationSeconds > 0) {
    return [{ id: "opening", label: "Opening", startSeconds: 0, endSeconds: Math.min(song.durationSeconds, 30) }];
  }
  return [];
}

function toCorpusSong(song: RotatingListeningSongDescriptor): ScoreCorpusSong {
  const paths = pathsFor(song);
  const sections = sectionsFor(song).map((section) => ({
    ...section,
    references: {
      ...(paths.baseline ? { baseline: pathSafeScoreReference(paths.baseline) ?? "external/artifact" } : {}),
      ...(paths.current ? { current: pathSafeScoreReference(paths.current) ?? "external/artifact" } : {}),
    },
  }));
  return {
    id: safeId(song.id, "song.id"),
    artist: safeText(song.artist) ?? undefined,
    title: safeText(song.title) ?? undefined,
    validation: { status: "PASS" },
    sections,
  };
}

interface NormalizedOptions {
  seed: string;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  minSongs: number;
  minSectionSeconds: number;
  maxSectionSeconds: number;
}

function normalizeOptions(options: RotatingListeningBundleOptions): NormalizedOptions {
  const seed = String(options.seed ?? "default").trim();
  const targetSeconds = options.targetSeconds ?? 120;
  const minSeconds = options.minSeconds ?? 90;
  const maxSeconds = options.maxSeconds ?? 150;
  const minSongs = options.minSongs ?? 2;
  const minSectionSeconds = options.minSectionSeconds ?? 8;
  const maxSectionSeconds = options.maxSectionSeconds ?? 30;
  if (!seed) throw new Error("seed must be non-empty");
  if (![targetSeconds, minSeconds, maxSeconds, minSectionSeconds, maxSectionSeconds].every((value) => finite(value) && value > 0)) {
    throw new Error("duration options must be positive and finite");
  }
  if (minSeconds < 90 - EPSILON || maxSeconds > 150 + EPSILON || minSeconds > targetSeconds + EPSILON || targetSeconds > maxSeconds + EPSILON) {
    throw new Error("rotating bundle requires 90 <= minSeconds <= targetSeconds <= maxSeconds <= 150");
  }
  if (!Number.isInteger(minSongs) || minSongs < 2) throw new Error("minSongs must be an integer >= 2");
  if (minSectionSeconds > maxSectionSeconds) throw new Error("minSectionSeconds must not exceed maxSectionSeconds");
  return { seed, targetSeconds, minSeconds, maxSeconds, minSongs, minSectionSeconds, maxSectionSeconds };
}

function normalizeNormalization(options: Partial<RotatingListeningNormalization> | undefined): RotatingListeningNormalization {
  const value = { ...DEFAULT_NORMALIZATION, ...(options ?? {}) };
  if (value.method !== "peak" && value.method !== "none") throw new Error("normalization.method must be peak or none");
  if (!finite(value.targetPeakDb) || value.targetPeakDb > 0 || !finite(value.maxGainDb) || value.maxGainDb < 0 || !finite(value.sampleRate) || value.sampleRate <= 0 || !Number.isInteger(value.sampleRate)) {
    throw new Error("normalization metadata is invalid");
  }
  if (value.channels !== 1 && value.channels !== 2) throw new Error("normalization.channels must be 1 or 2");
  return { method: value.method, targetPeakDb: round(value.targetPeakDb), maxGainDb: round(value.maxGainDb), sampleRate: value.sampleRate, channels: value.channels };
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

async function validateExternalPath(value: string, label: string, repositoryRoot: string): Promise<string> {
  if (!isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`${label} must be an absolute local path without NUL/newline characters`);
  const repository = await existingRealpath(resolve(repositoryRoot));
  const canonical = await existingRealpath(resolve(value));
  if (pathInside(canonical, repository)) throw new Error(`${label} must be outside the repository`);
  return canonical;
}

async function validateOutputRoot(outputRoot: string, repositoryRoot: string): Promise<string> {
  const root = await validateExternalPath(outputRoot, "outputRoot", repositoryRoot);
  try {
    const info = await lstat(resolve(outputRoot));
    if (info.isSymbolicLink()) throw new Error("outputRoot must not be a symbolic link");
    if (!info.isDirectory()) throw new Error("outputRoot must be a directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "ENOENT") throw error;
  }
  return root;
}

async function regularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function rendererMetadata(renderer: MidiAudioRenderer | undefined, result: MidiRenderResult | undefined, normalization: RotatingListeningNormalization): RotatingListeningRendererMetadata {
  const source = result?.renderer;
  const soundfont = result?.soundfont;
  return {
    status: result ? "rendered" : "unavailable",
    id: safeText(source?.id ?? renderer?.id),
    version: safeText(source?.version ?? renderer?.version),
    sampleRate: finite(source?.sampleRate) ? source.sampleRate : result?.wav.sampleRate ?? null,
    channels: finite(result?.wav.channels) ? result!.wav.channels : normalization.channels,
    gain: finite(source?.gain) ? source.gain : null,
    targetPeak: finite(source?.targetPeak) ? source.targetPeak : null,
    soundfont: soundfont ? { identifier: safeText(basename(soundfont.path)) ?? "soundfont", bytes: soundfont.bytes, sha256: safeText(soundfont.sha256) } : null,
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index += 1) result += String.fromCharCode(view.getUint8(offset + index));
  return result;
}

function wavChunk(view: DataView, wanted: string): { offset: number; length: number } {
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") throw new Error("renderer did not produce a RIFF/WAVE file");
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > view.byteLength) throw new Error(`truncated WAV ${id} chunk`);
    if (id === wanted) return { offset: dataOffset, length };
    offset = dataOffset + length + (length & 1);
  }
  throw new Error(`WAV is missing ${wanted} chunk`);
}

function parseWav(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = wavChunk(view, "fmt ");
  if (fmt.length < 16 || view.getUint16(fmt.offset, true) !== 1 || view.getUint16(fmt.offset + 14, true) !== 16) throw new Error("listening excerpts require canonical PCM16 WAV");
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  if (![1, 2].includes(channels) || !sampleRate) throw new Error("WAV has invalid channel or sample-rate metadata");
  const data = wavChunk(view, "data");
  return { bytes, sampleRate, channels, dataOffset: data.offset, dataLength: data.length };
}

function writeWavSlice(source: WavInfo, outputPath: string, startSeconds: number, endSeconds: number): Promise<void> {
  const bytesPerFrame = source.channels * 2;
  const totalFrames = Math.floor(source.dataLength / bytesPerFrame);
  const startFrame = Math.max(0, Math.min(totalFrames, Math.floor(startSeconds * source.sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(totalFrames, Math.ceil(endSeconds * source.sampleRate)));
  const payload = source.bytes.slice(source.dataOffset + startFrame * bytesPerFrame, source.dataOffset + endFrame * bytesPerFrame);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + payload.length, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, source.channels, true); view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * bytesPerFrame, true); view.setUint16(32, bytesPerFrame, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, payload.length, true);
  const output = new Uint8Array(44 + payload.length);
  output.set(new Uint8Array(header)); output.set(payload, 44);
  return mkdir(dirname(outputPath), { recursive: true }).then(() => writeFile(outputPath, output));
}

function audioRecord(ref: string, bytes: Uint8Array): RotatingListeningAudioRecord {
  const wav = parseWav(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleCount = wav.dataLength / 2;
  let peak = 0;
  let sumSquares = 0;
  let silence = 0;
  let clipping = 0;
  for (let offset = wav.dataOffset; offset < wav.dataOffset + wav.dataLength; offset += 2) {
    const sample = view.getInt16(offset, true);
    const normalized = Math.abs(sample) / 32768;
    peak = Math.max(peak, normalized);
    sumSquares += normalized * normalized;
    if (Math.abs(sample) <= 32) silence += 1;
    if (Math.abs(sample) >= 32767) clipping += 1;
  }
  const frameCount = wav.channels ? sampleCount / wav.channels : 0;
  const durationSeconds = wav.sampleRate > 0 ? frameCount / wav.sampleRate : 0;
  return {
    ref, bytes: bytes.byteLength, sha256: hashBytes(bytes), durationSeconds: round(durationSeconds), sampleRate: wav.sampleRate,
    channels: wav.channels, peak: round(peak), rms: round(sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0),
    silenceRatio: round(sampleCount ? silence / sampleCount : 0), clippingCount: clipping,
  };
}

function reason(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${hash(path).slice(0, 12)}`;
  await writeFile(temporary, content, { encoding: "utf8" });
  await rename(temporary, path);
}

function worksheet(manifest: RotatingListeningManifest): string {
  const lines = [
    "# Rotating multi-song blind listening",
    "",
    `Pack: ${manifest.packId}`,
    `Total listening time: ${manifest.totalSeconds}s (target ${manifest.targetSeconds}s)`,
    "",
    "Listen without opening the answer key. For each excerpt, answer only the frozen review questions below.",
    "",
  ];
  for (const excerpt of manifest.excerpts) {
    lines.push(`## ${excerpt.id}`, `- Duration: ${excerpt.durationSeconds}s`);
    for (const alias of ["A", "B"] as const) {
      const audio = excerpt.candidates[alias].audio;
      lines.push(`- ${alias}: ${audio ? `[audio](${audio.ref})` : "unavailable"}`);
    }
    lines.push(
      "",
      "Accompaniment correctness (1–5): A ____  B ____",
      "Recognizable? A / B / BOTH / NEITHER",
      "Anything obviously wrong? A / B / BOTH / NEITHER",
      "Which version is better? A / B / SAME",
      "Notes:",
      "",
    );
  }
  if (!manifest.excerpts.length) lines.push("No usable excerpts were selected.", "");
  lines.push("Human listening status: pending.", "");
  return lines.join("\n");
}

/** Build a deterministic local bundle around explicit song descriptors. */
export async function buildRotatingListeningBundle(
  options: RotatingListeningBundleOptions,
  dependencies: RotatingListeningBundleDependencies = {},
): Promise<RotatingListeningBundleResult> {
  const normalized = normalizeOptions(options);
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const outputRoot = await validateOutputRoot(options.outputRoot, repositoryRoot);
  const descriptors = options.songs.map((song) => ({ ...song, id: safeId(song.id, "song.id") }));
  if (new Set(descriptors.map((song) => song.id)).size !== descriptors.length) throw new Error("song ids must be unique");
  const pathMap = new Map<string, CandidatePaths>();
  for (const song of descriptors) {
    const paths = pathsFor(song);
    const validated: CandidatePaths = {};
    if (paths.baseline) validated.baseline = await validateExternalPath(paths.baseline, `${song.id} baseline MIDI`, repositoryRoot);
    if (paths.current) validated.current = await validateExternalPath(paths.current, `${song.id} current MIDI`, repositoryRoot);
    pathMap.set(song.id, validated);
  }

  let normalization = normalizeNormalization(options.normalization);
  await mkdir(outputRoot, { recursive: true });
  const stagingRoot = join(outputRoot, `.staging-${randomUUID()}`);
  await mkdir(stagingRoot, { recursive: true });
  const errors: RotatingListeningManifest["errors"] = [];
  let pack: ScoreListeningPack;
  try {
    try {
      pack = selectRotatingScoreListeningPack(descriptors.map(toCorpusSong), {
        seed: normalized.seed,
        targetSeconds: normalized.targetSeconds,
        minSeconds: normalized.minSeconds,
        maxSeconds: normalized.maxSeconds,
        minSongs: normalized.minSongs,
        minSectionSeconds: normalized.minSectionSeconds,
        maxSectionSeconds: normalized.maxSectionSeconds,
      });
    } catch (error) {
      errors.push({ code: "PACK_SELECTION_FAILED", message: reason(error) });
      pack = {
        schemaVersion: 1,
        kind: "score-rotating-listening-pack",
        packId: `rotating-${hash(`${normalized.seed}\u0000selector-failed`).slice(0, 16)}`,
        seed: normalized.seed,
        targetSeconds: normalized.targetSeconds,
        minSeconds: normalized.minSeconds,
        maxSeconds: normalized.maxSeconds,
        totalSeconds: 0,
        status: "insufficient",
        songs: [],
        excerpts: [],
        warnings: ["score listening selector failed; no excerpts were selected"],
      };
    }
  const warnings = [...pack.warnings];
  const firstResultByCandidate = new Map<"A" | "B", MidiRenderResult>();
  const wavByCandidate = new Map<string, { result: MidiRenderResult; wav: WavInfo }>();

  const renderCandidate = async (songId: string, candidate: "A" | "B", midiPath: string): Promise<MidiRenderResult | null> => {
    if (!dependencies.renderer) {
      errors.push({ code: "RENDERER_UNAVAILABLE", message: "local renderer was not supplied", songId, candidate });
      return null;
    }
    if (!await regularFile(midiPath)) {
      errors.push({ code: "MIDI_UNAVAILABLE", message: "explicit MIDI artifact is unavailable", songId, candidate });
      return null;
    }
    const renderKey = `${songId}\u0000${candidate}`;
    const outputPath = join(stagingRoot, ".renders", hash(renderKey).slice(0, 20), `${candidate}.full.wav`);
    await mkdir(dirname(outputPath), { recursive: true });
    await unlink(outputPath).catch(() => undefined);
    try {
      const result = await dependencies.renderer.render({ midiPath, outputPath });
      const renderedBytes = new Uint8Array(await readFile(outputPath));
      const wav = parseWav(renderedBytes);
      wavByCandidate.set(renderKey, { result, wav });
      firstResultByCandidate.set(candidate, result);
      return result;
    } catch (error) {
      errors.push({ code: "RENDER_FAILED", message: reason(error), songId, candidate });
      return null;
    }
  };

  const renderBySong = new Map<string, { A: MidiRenderResult | null; B: MidiRenderResult | null }>();
  for (const song of pack.songs) {
    const paths = pathMap.get(song.id) ?? {};
    if (!paths.baseline || !paths.current) {
      const message = "both baseline and current local MIDI artifacts are required for an A/B excerpt";
      for (const candidate of ["A", "B"] as const) errors.push({ code: "AB_ARTIFACT_UNAVAILABLE", message, songId: song.id, candidate });
      renderBySong.set(song.id, { A: null, B: null });
      continue;
    }
    const [A, B] = await Promise.all([renderCandidate(song.id, "A", paths.baseline), renderCandidate(song.id, "B", paths.current)]);
    renderBySong.set(song.id, { A, B });
  }

  const excerpts: RotatingListeningManifestExcerpt[] = [];
  const blindEntries: Record<string, RotatingListeningBlindMapEntry> = {};
  for (const excerpt of pack.excerpts) {
    const paths = pathMap.get(excerpt.songId) ?? {};
    const renders = renderBySong.get(excerpt.songId) ?? { A: null, B: null };
    const candidates = {} as RotatingListeningManifestExcerpt["candidates"];
    for (const candidate of ["A", "B"] as const) {
      const result = renders[candidate];
      const key = `${excerpt.songId}\u0000${candidate}`;
      const rendered = result ? wavByCandidate.get(key) : undefined;
      const ref = `audio/${hash(excerpt.id).slice(0, 16)}-${candidate}.wav`;
      await unlink(join(stagingRoot, ref)).catch(() => undefined);
      if (result && rendered) {
        const path = join(stagingRoot, ref);
        const renderedDuration = rendered.wav.dataLength / (rendered.wav.channels * 2) / rendered.wav.sampleRate;
        if (excerpt.endSeconds > renderedDuration + EPSILON) {
          const message = `requested excerpt ends at ${round(excerpt.endSeconds)}s but rendered audio is only ${round(renderedDuration)}s`;
          errors.push({ code: "EXCERPT_DURATION_MISMATCH", message, songId: excerpt.songId, candidate });
          candidates[candidate] = { status: "failed", audio: null, reason: message };
          continue;
        }
        try {
          await writeWavSlice(rendered.wav, path, excerpt.startSeconds, excerpt.endSeconds);
          const bytes = new Uint8Array(await readFile(path));
          candidates[candidate] = { status: "rendered", audio: audioRecord(ref, bytes) };
        } catch (error) {
          errors.push({ code: "EXCERPT_FAILED", message: reason(error), songId: excerpt.songId, candidate });
          candidates[candidate] = { status: "failed", audio: null, reason: reason(error) };
        }
      } else {
        candidates[candidate] = { status: "unavailable", audio: null, reason: "audio artifact unavailable" };
      }
    }
    excerpts.push({
      id: excerpt.id,
      songId: excerpt.songId,
      sectionId: excerpt.sectionId,
      label: safeText(excerpt.label),
      startSeconds: round(excerpt.startSeconds),
      endSeconds: round(excerpt.endSeconds),
      durationSeconds: round(excerpt.durationSeconds),
      candidates,
    });
    blindEntries[excerpt.id] = {
      songId: excerpt.songId,
      sectionId: excerpt.sectionId,
      excerptId: excerpt.id,
      aliases: {
        A: { candidateId: "baseline", midiRef: paths.baseline ? pathSafeScoreReference(paths.baseline) : null },
        B: { candidateId: "current", midiRef: paths.current ? pathSafeScoreReference(paths.current) : null },
      },
    };
  }

  const firstResult = firstResultByCandidate.get("A") ?? firstResultByCandidate.get("B");
  if (firstResult) {
    normalization = normalizeNormalization({
      ...options.normalization,
      sampleRate: options.normalization?.sampleRate ?? firstResult.wav.sampleRate,
      channels: options.normalization?.channels ?? (firstResult.wav.channels === 1 ? 1 : 2),
    });
  }
  const renderer = rendererMetadata(dependencies.renderer, firstResult, normalization);
  const manifest: RotatingListeningManifest = {
    schemaVersion: ROTATING_LISTENING_BUNDLE_SCHEMA_VERSION,
    kind: "rotating-multi-song-blind-listening-bundle",
    pathSafe: true,
    packId: `rotating-${hash(`${normalized.seed}\u0000${pack.excerpts.map((excerpt) => excerpt.id).join("\u0000")}`).slice(0, 16)}`,
    seed: normalized.seed,
    targetSeconds: round(normalized.targetSeconds),
    minSeconds: round(normalized.minSeconds),
    maxSeconds: round(normalized.maxSeconds),
    totalSeconds: round(pack.totalSeconds),
    status: !dependencies.renderer ? "unavailable" : pack.status === "ready" && excerpts.length > 0 && excerpts.every((excerpt) => excerpt.candidates.A.status === "rendered" && excerpt.candidates.B.status === "rendered") ? "ready" : pack.status === "ready" ? "unavailable" : "insufficient",
    songs: pack.songs.map((song) => ({ id: song.id, artist: safeText(song.artist), title: safeText(song.title) })).sort((left, right) => compareText(left.id, right.id)),
    excerpts,
    renderer,
    normalization,
    warnings: [...new Set(warnings.map(redact).filter(Boolean))].sort(compareText),
    errors: errors.sort((left, right) => compareText(`${left.code}\u0000${left.songId ?? ""}\u0000${left.candidate ?? ""}`, `${right.code}\u0000${right.songId ?? ""}\u0000${right.candidate ?? ""}`)),
    blindMap: "blind-map.json",
    worksheet: "LISTENING.md",
  };
  const blindMap: RotatingListeningBlindMap = { schemaVersion: 1, kind: "rotating-multi-song-blind-listening-answer-key", packId: manifest.packId, entries: blindEntries };
  const markdown = worksheet(manifest);
  const manifestPath = join(outputRoot, "manifest.json");
  const blindMapPath = join(outputRoot, "blind-map.json");
  const worksheetPath = join(outputRoot, "LISTENING.md");
  await atomicWrite(join(stagingRoot, "manifest.json"), json(manifest));
  await atomicWrite(join(stagingRoot, "blind-map.json"), json(blindMap));
  await atomicWrite(join(stagingRoot, "LISTENING.md"), markdown);
  const publishedAudio = new Set(excerpts.flatMap((excerpt) => (["A", "B"] as const)
    .map((candidate) => excerpt.candidates[candidate].audio?.ref)
    .filter((ref): ref is string => Boolean(ref))));
  for (const ref of [...publishedAudio].sort(compareText)) {
    const destination = join(outputRoot, ref);
    await mkdir(dirname(destination), { recursive: true });
    await rename(join(stagingRoot, ref), destination);
  }
  for (const [name, destination] of [["manifest.json", manifestPath], ["blind-map.json", blindMapPath], ["LISTENING.md", worksheetPath]] as const) {
    await rename(join(stagingRoot, name), destination);
  }
  return { manifest, manifestPath, blindMap, blindMapPath, worksheet: markdown, worksheetPath, pack };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Canonical stable JSON for callers that do not need filesystem writes. */
export function rotatingListeningBundleManifestJson(manifest: RotatingListeningManifest): string {
  return json(manifest);
}
