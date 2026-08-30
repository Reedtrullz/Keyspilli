/**
 * Local-only listening materialization for a frozen symbolic reference.
 *
 * The symbolic reference builder deliberately has no renderer dependency. This
 * module is the optional Phase 9/10 boundary: it reads an already-frozen MIDI,
 * derives role-isolated MIDI views, asks the injected local renderer for WAVs,
 * and writes a path-free manifest plus Markdown/HTML review index. It never
 * touches the catalog, production runtime, network, or source-score files.
 */

import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseMidi, writeMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import type { MidiAudioRenderer, MidiRenderResult } from "./midi-renderer.js";
import type { OmrReviewQueue, OmrReviewQueueItem } from "./omr-review-queue.js";

export const LOCAL_REFERENCE_LISTENING_SCHEMA_VERSION = 1 as const;
export const LOCAL_REFERENCE_LISTENING_NON_CLAIM =
  "Rendered audio supports local human review; it is not evidence of copyright permission, musical correctness, or recognizability.";

export type LocalReferenceListeningStatus = "RENDERED" | "PARTIAL" | "UNAVAILABLE";

export interface LocalReferenceListeningInput {
  scoreId: string;
  title?: string;
  /** Explicit local MIDI source. It is read, never copied or modified. */
  referenceMidiPath: string;
  reviewQueue?: Pick<OmrReviewQueue, "items" | "unresolvedRegions"> | null;
}

export interface LocalReferenceListeningOptions {
  /** Local output root containing the frozen reference. Must be outside repo. */
  outputRoot: string;
  repositoryRoot?: string;
  /** Injected in tests; production CLI supplies createFluidSynthRenderer(). */
  renderer: MidiAudioRenderer;
  /** Opening excerpt length in seconds. Defaults to 30. */
  excerptSeconds?: number;
}

export interface LocalReferenceListeningOutputs {
  /** A derived copy used by the renderer; the caller's source is never modified. */
  referenceMidi: string;
  fullWav: string | null;
  openingExcerptWav: string | null;
  melodyMidi: string | null;
  melodyWav: string | null;
  accompanimentMidi: string | null;
  accompanimentWav: string | null;
  reviewQueue: string;
  manifest: string;
  markdown: string;
  html: string;
}

export interface LocalReferenceListeningRenderer {
  id: string;
  version: string;
  sampleRate: number;
  channels: number;
  gain: number;
  targetPeak: number;
  soundfont: { identifier: string; bytes: number; sha256: string } | null;
}

export interface LocalReferenceListeningRender {
  role: "full" | "melody" | "accompaniment";
  midi: { ref: string; bytes: number; sha256: string };
  wav: {
    ref: string;
    bytes: number;
    sha256: string;
    sampleRate: number;
    channels: number;
    durationSeconds: number;
    peak: number;
    rms: number;
    silenceRatio: number;
    clippingCount: number;
  };
  duration: MidiRenderResult["duration"];
}

export interface LocalReferenceListeningReviewItem {
  id: string;
  page: number | null;
  system: number | null;
  measureId: string;
  measureNumber: string;
  role: string;
  reason: string;
  /** Bounded, path-redacted interpretations from the available engines. */
  backendValues: Record<string, string[]>;
  backendInterpretations: Record<string, string[]>;
  context: {
    keySignature: number | null;
    timeSignature: [number, number] | null;
    startBeat: number;
    durationBeats: number;
    structural: { agreement: number | null; evidence: string[] };
  };
  importance: "melody" | "harmony" | "rhythm" | "unknown";
  recommendedAction: string;
}

export interface LocalReferenceListeningDeterminism {
  /** SHA-256 of the path-free report payload, excluding this field. */
  canonicalSha256: string;
  basis: "path-free-report-without-determinism";
}

export interface LocalReferenceListeningReport {
  schemaVersion: typeof LOCAL_REFERENCE_LISTENING_SCHEMA_VERSION;
  kind: "local-score-reference-listening";
  scoreId: string;
  title: string;
  status: LocalReferenceListeningStatus;
  source: {
    midi: { ref: string; bytes: number; sha256: string };
    parser: {
      format: number;
      division: number;
      tempoBpm: number;
      timeSig: [number, number];
      durationBeats: number;
      noteCount: number;
    };
    roleBasis: "midi-hand" | "pitch-threshold-60" | "all-notes-melody";
    melodyNoteCount: number;
    accompanimentNoteCount: number;
  };
  renderer: LocalReferenceListeningRenderer | null;
  renders: LocalReferenceListeningRender[];
  review: {
    itemCount: number;
    unresolvedRegions: string[];
    items: LocalReferenceListeningReviewItem[];
  };
  determinism: LocalReferenceListeningDeterminism;
  outputs: LocalReferenceListeningOutputs;
  errors: Array<{ role: "full" | "melody" | "accompaniment" | "excerpt"; message: string }>;
  nonClaims: string[];
}

interface FileBytes {
  bytes: Uint8Array;
  size: number;
  sha256: string;
}

interface RoleMidi {
  notes: Note[];
  roleBasis: LocalReferenceListeningReport["source"]["roleBasis"];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stable(item)]),
  );
}

function safeId(value: unknown): string {
  if (typeof value !== "string") throw new Error("scoreId must be a non-empty path-safe logical id");
  const id = value.trim();
  if (!id || id === "." || id === ".." || id.includes("/") || id.includes("\\") || /[\0\r\n]/.test(id)) {
    throw new Error("scoreId must be a non-empty path-safe logical id");
  }
  return id;
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
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const parent = dirname(value);
    if (parent === value) return resolve(value);
    return join(await existingRealpath(parent), basename(value));
  }
}

async function safeOutputRoot(outputRoot: string, repositoryRoot: string): Promise<string> {
  if (!isAbsolute(outputRoot) || /[\0\r\n]/.test(outputRoot)) {
    throw new Error("listening outputRoot must be an absolute path without NUL/newline characters");
  }
  const root = resolve(outputRoot);
  const repository = await existingRealpath(resolve(repositoryRoot));
  const canonical = await existingRealpath(root);
  if (pathInside(canonical, repository)) throw new Error("listening outputRoot must be outside the repository");
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink()) throw new Error("listening outputRoot must not be a symbolic link");
    if (!info.isDirectory()) throw new Error("listening outputRoot must be a directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code !== "ENOENT") throw error;
  }
  return canonical;
}

async function readRegularFile(path: string, label: string, repositoryRoot: string): Promise<FileBytes> {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error(`${label} must be an absolute local path without NUL/newline characters`);
  const canonical = await existingRealpath(resolve(path));
  if (pathInside(canonical, await existingRealpath(resolve(repositoryRoot)))) {
    throw new Error(`${label} must be outside the repository`);
  }
  const info = await stat(canonical).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${label} is unavailable`);
  const bytes = new Uint8Array(await readFile(canonical));
  return { bytes, size: bytes.byteLength, sha256: hashBytes(bytes) };
}

async function atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function parseRoleNotes(parsed: ParsedMidi): RoleMidi {
  const notes = parsed.notes.slice().sort((left, right) => left.start - right.start || left.midi - right.midi || left.dur - right.dur);
  const hasExplicitHand = notes.some((note) => note.hand !== undefined);
  if (hasExplicitHand) {
    return {
      notes: notes.filter((note) => note.hand !== "L"),
      roleBasis: "midi-hand",
    };
  }
  const upper = notes.filter((note) => note.midi >= 61);
  const lower = notes.filter((note) => note.midi <= 60);
  if (upper.length && lower.length) return { notes: upper, roleBasis: "pitch-threshold-60" };
  return { notes, roleBasis: "all-notes-melody" };
}

function accompanimentNotes(parsed: ParsedMidi, roleBasis: RoleMidi["roleBasis"]): Note[] {
  const notes = parsed.notes.slice().sort((left, right) => left.start - right.start || left.midi - right.midi || left.dur - right.dur);
  if (roleBasis === "midi-hand") return notes.filter((note) => note.hand === "L");
  if (roleBasis === "pitch-threshold-60") return notes.filter((note) => note.midi <= 60);
  return [];
}

function writeRoleMidi(notes: Note[], parsed: ParsedMidi, name: string): Uint8Array {
  return writeMidi(notes, {
    tempoBpm: parsed.tempoBpm,
    timeSig: parsed.timeSig,
    keySig: parsed.keySig,
    keyMode: parsed.keyMode,
    title: parsed.title ?? name,
    tracks: [{ name, notes }],
  });
}

function sanitizeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/(?:file:\/\/)?(?:\/[^\s"'<>]+|[A-Za-z]:[\\/][^\s"'<>]+|\\\\[^\s"'<>]+)/g, "[redacted-path]")
    .replace(/[\0\r\n]+/g, " ")
    .slice(0, 500);
}

/** Keep caller-supplied review text useful without allowing local paths into reports. */
function safeReportText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(?:file:\/\/)?(?:\/[^\s"'<>]+|[A-Za-z]:[\\/][^\s"'<>]+|\\\\[^\s"'<>]+)/g, "[redacted-path]")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, 500) || fallback;
}

function safeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeReportText(item)).filter(Boolean))].sort(compareText);
}

function safeTextRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right))) {
    const values = safeTextList(items);
    if (values.length) output[safeReportText(key, "unknown")] = values;
  }
  return output;
}

function nullableFinite(value: unknown): number | null {
  return finite(value) ? value : null;
}

function safeReviewContext(value: unknown): LocalReferenceListeningReviewItem["context"] {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const structural = context.structural && typeof context.structural === "object" && !Array.isArray(context.structural)
    ? context.structural as Record<string, unknown>
    : {};
  const rawTimeSig = context.timeSignature;
  const timeSignature: [number, number] | null = Array.isArray(rawTimeSig) && rawTimeSig.length === 2
    && finite(rawTimeSig[0]) && finite(rawTimeSig[1])
    ? [rawTimeSig[0]!, rawTimeSig[1]!]
    : null;
  return {
    keySignature: nullableFinite(context.keySignature),
    timeSignature,
    startBeat: finite(context.startBeat) ? context.startBeat : 0,
    durationBeats: finite(context.durationBeats) && context.durationBeats >= 0 ? context.durationBeats : 0,
    structural: {
      agreement: nullableFinite(structural.agreement),
      evidence: safeTextList(structural.evidence),
    },
  };
}

function safeBasename(value: string): string {
  return basename(value.replaceAll("\\", "/")) || "soundfont";
}

function safeRendererLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  // Renderer identity/version are logical labels.  A renderer may expose its
  // executable path (or a relative path) as metadata; keep that out of the
  // report instead of partially redacting it into a misleading label.
  if (!raw || raw.includes("/") || raw.includes("\\") || /^(?:file:|https?:|~[\\/]|[A-Za-z]:[\\/])/i.test(raw)) return fallback;
  const text = safeReportText(raw, fallback);
  // Renderer identity is a logical label, not a path or URL.  Keep the
  // report path-free even when an injected/local renderer returns arbitrary
  // metadata (the production renderer uses fixed labels).
  if (!text || text.includes("/") || text.includes("\\") || /^file:/i.test(text) || /^https?:/i.test(text)) return fallback;
  return text;
}

function rendererFromResult(result: MidiRenderResult): LocalReferenceListeningRenderer {
  return {
    id: safeRendererLabel(result.renderer.id, "renderer"),
    version: safeRendererLabel(result.renderer.version, "unknown"),
    sampleRate: result.renderer.sampleRate,
    channels: result.wav.channels,
    gain: result.renderer.gain,
    targetPeak: result.renderer.targetPeak,
    soundfont: {
      identifier: safeBasename(result.soundfont.path),
      bytes: result.soundfont.bytes,
      sha256: result.soundfont.sha256,
    },
  };
}

function renderRecord(role: LocalReferenceListeningRender["role"], result: MidiRenderResult, midiRef: string, wavRef: string, midiBytes: FileBytes): LocalReferenceListeningRender {
  return {
    role,
    midi: { ref: midiRef, bytes: midiBytes.size, sha256: midiBytes.sha256 },
    wav: {
      ref: wavRef,
      bytes: result.wav.bytes,
      sha256: result.wav.sha256,
      sampleRate: result.wav.sampleRate,
      channels: result.wav.channels,
      durationSeconds: result.wav.durationSeconds,
      peak: result.wav.peak,
      rms: result.wav.rms,
      silenceRatio: result.wav.silenceRatio,
      clippingCount: result.wav.clippingCount,
    },
    duration: result.duration,
  };
}

function reviewImportance(role: string): LocalReferenceListeningReviewItem["importance"] {
  return role === "melody" || role === "harmony" || role === "rhythm" ? role : "unknown";
}

function reviewItems(queue: LocalReferenceListeningInput["reviewQueue"]): LocalReferenceListeningReviewItem[] {
  return (queue?.items ?? []).map((item: OmrReviewQueueItem, index) => {
    const role = safeReportText(item.role, "unknown");
    const reason = safeReportText(Array.isArray(item.evidence) ? item.evidence[0] : undefined, safeReportText(item.reasonCategory, "unknown"));
    return {
      id: safeReportText(item.id, `review-${index + 1}`),
      page: finite(item.page) ? item.page : null,
      system: finite(item.system) ? item.system : null,
      measureId: safeReportText(item.measureId, safeReportText(item.id, `measure-${index + 1}`)),
      measureNumber: safeReportText(item.measureNumber, "unknown"),
      role,
      reason,
      backendValues: safeTextRecord(item.backendValues),
      backendInterpretations: safeTextRecord(item.backendInterpretations),
      context: safeReviewContext(item.context),
      importance: reviewImportance(role),
      recommendedAction: safeReportText(item.recommendedAction, "Human-review this unresolved region."),
    };
  }).sort((left, right) => {
    const leftKey = JSON.stringify(stable(left));
    const rightKey = JSON.stringify(stable(right));
    return compareText(leftKey, rightKey);
  });
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

function wavChunk(view: DataView, wanted: string): { offset: number; length: number } {
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") throw new Error("rendered WAV is not RIFF/WAVE");
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

async function sliceOpeningWav(inputPath: string, outputPath: string, seconds: number): Promise<void> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = wavChunk(view, "fmt ");
  const data = wavChunk(view, "data");
  const format = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  if (format !== 1 || (channels !== 1 && channels !== 2) || bits !== 16 || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("opening excerpt requires canonical PCM16 WAV");
  }
  const frameBytes = channels * 2;
  const totalFrames = Math.floor(data.length / frameBytes);
  const endFrame = Math.min(totalFrames, Math.max(1, Math.ceil(seconds * sampleRate)));
  const payload = bytes.slice(data.offset, data.offset + endFrame * frameBytes);
  const header = new ArrayBuffer(44);
  const outputView = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => outputView.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); outputView.setUint32(4, 36 + payload.length, true); text(8, "WAVE");
  text(12, "fmt "); outputView.setUint32(16, 16, true); outputView.setUint16(20, 1, true);
  outputView.setUint16(22, channels, true); outputView.setUint32(24, sampleRate, true);
  outputView.setUint32(28, sampleRate * frameBytes, true); outputView.setUint16(32, frameBytes, true); outputView.setUint16(34, 16, true);
  text(36, "data"); outputView.setUint32(40, payload.length, true);
  const output = new Uint8Array(44 + payload.length); output.set(new Uint8Array(header)); output.set(payload, 44);
  await mkdir(dirname(outputPath), { recursive: true });
  await atomicWrite(outputPath, output);
}

function markdown(report: LocalReferenceListeningReport): string {
  const lines = [
    `# ${report.title} — local reference listening`,
    "",
    `Status: **${report.status}**. This bundle is local-only and does not establish musical correctness or recognizability.`,
    "",
    `Source: ${report.source.midi.ref} (${report.source.parser.noteCount} notes, ${report.source.parser.tempoBpm.toFixed(2)} BPM, ${report.source.parser.durationBeats.toFixed(2)} beats).`,
    `Role split: ${report.source.roleBasis}; melody ${report.source.melodyNoteCount}, accompaniment ${report.source.accompanimentNoteCount}.`,
    "",
    "## Audio",
  ];
  const link = (label: string, ref: string | null) => ref ? `- ${label}: [WAV](./${basename(ref)})` : `- ${label}: unavailable`;
  lines.push(link("Full reference", report.outputs.fullWav));
  lines.push(link("Melody only", report.outputs.melodyWav));
  lines.push(link("Accompaniment only", report.outputs.accompanimentWav));
  lines.push(link("Opening excerpt", report.outputs.openingExcerptWav));
  if (report.renderer) lines.push("", `Renderer: ${report.renderer.id} ${report.renderer.version}, ${report.renderer.sampleRate} Hz, ${report.renderer.channels} channels, gain ${report.renderer.gain}.`, `SoundFont: ${report.renderer.soundfont?.identifier ?? "unavailable"} (${report.renderer.soundfont?.sha256 ?? "unavailable"}).`);
  lines.push("", "## Review queue");
  lines.push(`Review queue: [JSON](./${basename(report.outputs.reviewQueue)}).`);
  if (!report.review.items.length) lines.push("No unresolved review items were supplied.");
  for (const item of report.review.items) {
    const location = [item.page === null ? null : `page ${item.page}`, item.system === null ? null : `system ${item.system}`, `measure ${item.measureNumber}`].filter(Boolean).join(", ");
    const interpretations = Object.entries(item.backendValues).sort(([left], [right]) => compareText(left, right)).map(([backend, values]) => `${backend}: ${values.join(", ")}`).join("; ");
    const alternateReadings = Object.entries(item.backendInterpretations).sort(([left], [right]) => compareText(left, right)).map(([backend, values]) => `${backend}: ${values.join(", ")}`).join("; ");
    lines.push(`- **${location}** — ${item.importance}; ${item.reason}. ${item.recommendedAction}`);
    if (interpretations) lines.push(`  - Symbolic readings: ${interpretations}`);
    if (alternateReadings) lines.push(`  - Interpretations: ${alternateReadings}`);
  }
  lines.push("", "## Automated status", `- Rendered roles: ${report.renders.map((render) => render.role).join(", ") || "none"}`, `- Review items: ${report.review.itemCount}`, `- Manifest: [JSON](./${basename(report.outputs.manifest)})`, "", ...report.errors.map((error) => `- ${error.role}: ${error.message}`), "", report.nonClaims[0]!);
  return `${lines.join("\n")}\n`;
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function html(report: LocalReferenceListeningReport): string {
  const audio = (label: string, ref: string | null) => ref
    ? `<li>${htmlEscape(label)}: <audio controls preload="none" src="./${htmlEscape(basename(ref))}"></audio> <a href="./${htmlEscape(basename(ref))}">WAV</a></li>`
    : `<li>${htmlEscape(label)}: unavailable</li>`;
  const items = report.review.items.map((item) => {
    const location = [item.page === null ? null : `page ${item.page}`, item.system === null ? null : `system ${item.system}`, `measure ${item.measureNumber}`].filter(Boolean).join(", ");
    const readings = Object.entries(item.backendValues).sort(([left], [right]) => compareText(left, right)).map(([backend, values]) => `${backend}: ${values.join(", ")}`).join("; ");
    const interpretations = Object.entries(item.backendInterpretations).sort(([left], [right]) => compareText(left, right)).map(([backend, values]) => `${backend}: ${values.join(", ")}`).join("; ");
    return `<li><strong>${htmlEscape(location)}</strong> — ${htmlEscape(item.importance)}; ${htmlEscape(item.reason)}. ${htmlEscape(item.recommendedAction)}${readings ? `<br>Symbolic readings: ${htmlEscape(readings)}` : ""}${interpretations ? `<br>Interpretations: ${htmlEscape(interpretations)}` : ""}</li>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${htmlEscape(report.title)} — local reference listening</title></head><body><h1>${htmlEscape(report.title)} — local reference listening</h1><p>Status: <strong>${htmlEscape(report.status)}</strong>. Local-only evidence; human review remains required.</p><h2>Audio</h2><ul>${audio("Full reference", report.outputs.fullWav)}${audio("Melody only", report.outputs.melodyWav)}${audio("Accompaniment only", report.outputs.accompanimentWav)}${audio("Opening excerpt", report.outputs.openingExcerptWav)}</ul><h2>Review queue</h2><p><a href="./${htmlEscape(basename(report.outputs.reviewQueue))}">Review queue JSON</a></p><ul>${items || "<li>No unresolved review items were supplied.</li>"}</ul><p>Renderer: ${htmlEscape(report.renderer ? `${report.renderer.id} ${report.renderer.version}` : "unavailable")}</p></body></html>\n`;
}

/** Build full/role-isolated WAVs and a local human-review index. */
export async function buildLocalReferenceListening(
  input: LocalReferenceListeningInput,
  options: LocalReferenceListeningOptions,
): Promise<LocalReferenceListeningReport> {
  const scoreId = safeId(input.scoreId);
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const outputRoot = await safeOutputRoot(options.outputRoot, repositoryRoot);
  const excerptSeconds = options.excerptSeconds ?? 30;
  if (!finite(excerptSeconds) || excerptSeconds <= 0) throw new Error("excerptSeconds must be a finite positive number");
  const source = await readRegularFile(input.referenceMidiPath, "reference MIDI", repositoryRoot);
  const sourceCanonical = await existingRealpath(resolve(input.referenceMidiPath));
  if (pathInside(sourceCanonical, outputRoot)) {
    throw new Error("listening outputRoot must not contain the reference MIDI source");
  }
  let parsed: ParsedMidi;
  try {
    parsed = parseMidi(source.bytes);
  } catch (error) {
    throw new Error(`reference MIDI could not be parsed: ${sanitizeError(error)}`);
  }
  if (!finite(parsed.tempoBpm) || parsed.tempoBpm <= 0 || !finite(parsed.durationBeats) || parsed.durationBeats < 0) {
    throw new Error("reference MIDI has invalid tempo or duration metadata");
  }
  const role = parseRoleNotes(parsed);
  const accompaniment = accompanimentNotes(parsed, role.roleBasis);
  const scoreRoot = join(outputRoot, "scores", scoreId, "listening");
  await mkdir(scoreRoot, { recursive: true });
  const refs = {
    referenceMidi: `scores/${scoreId}/listening/reference.mid`,
    fullWav: `scores/${scoreId}/listening/reference-full.wav`,
    openingExcerptWav: `scores/${scoreId}/listening/reference-opening.wav`,
    melodyMidi: role.notes.length ? `scores/${scoreId}/listening/reference-melody.mid` : null,
    melodyWav: role.notes.length ? `scores/${scoreId}/listening/reference-melody.wav` : null,
    accompanimentMidi: accompaniment.length ? `scores/${scoreId}/listening/reference-accompaniment.mid` : null,
    accompanimentWav: accompaniment.length ? `scores/${scoreId}/listening/reference-accompaniment.wav` : null,
    reviewQueue: `scores/${scoreId}/listening/review-queue.json`,
    manifest: `scores/${scoreId}/listening/manifest.json`,
    markdown: `scores/${scoreId}/listening/LISTENING.md`,
    html: `scores/${scoreId}/listening/LISTENING.html`,
  } satisfies LocalReferenceListeningOutputs;
  // A rerun must not leave a previously rendered role/excerpt looking valid
  // after the current renderer fails. These are all derived paths under the
  // already validated score root, never caller-owned source paths.
  await Promise.all([
    refs.referenceMidi,
    refs.fullWav,
    refs.openingExcerptWav,
    `scores/${scoreId}/listening/reference-melody.mid`,
    `scores/${scoreId}/listening/reference-melody.wav`,
    `scores/${scoreId}/listening/reference-accompaniment.mid`,
    `scores/${scoreId}/listening/reference-accompaniment.wav`,
  ].filter((ref): ref is string => typeof ref === "string").map((ref) => rm(resolve(outputRoot, ref), { force: true })));
  const errors: LocalReferenceListeningReport["errors"] = [];
  const renders: LocalReferenceListeningRender[] = [];
  let rendererMetadata: LocalReferenceListeningRenderer | null = null;
  const renderTarget = async (target: LocalReferenceListeningRender["role"], midiBytes: FileBytes, renderMidiPath: string, wavPath: string, midiRef: string, wavRef: string, derivedMidiPath?: string): Promise<void> => {
    await rm(wavPath, { force: true });
    try {
      if (derivedMidiPath) await atomicWrite(derivedMidiPath, midiBytes.bytes);
      const result = await options.renderer.render({ midiPath: renderMidiPath, outputPath: wavPath });
      rendererMetadata ??= rendererFromResult(result);
      renders.push(renderRecord(target, result, midiRef, wavRef, midiBytes));
    } catch (error) {
      await rm(wavPath, { force: true });
      errors.push({ role: target, message: sanitizeError(error) });
    }
  };
  const fullMidi: FileBytes = source;
  await renderTarget("full", fullMidi, resolve(outputRoot, refs.referenceMidi), resolve(outputRoot, refs.fullWav), refs.referenceMidi, refs.fullWav, resolve(outputRoot, refs.referenceMidi));
  if (role.notes.length && refs.melodyMidi && refs.melodyWav) {
    const bytes = writeRoleMidi(role.notes, parsed, "Reference melody");
    await renderTarget("melody", { bytes, size: bytes.byteLength, sha256: hashBytes(bytes) }, resolve(outputRoot, refs.melodyMidi), resolve(outputRoot, refs.melodyWav), refs.melodyMidi, refs.melodyWav, resolve(outputRoot, refs.melodyMidi));
  }
  if (accompaniment.length && refs.accompanimentMidi && refs.accompanimentWav) {
    const bytes = writeRoleMidi(accompaniment, parsed, "Reference accompaniment");
    await renderTarget("accompaniment", { bytes, size: bytes.byteLength, sha256: hashBytes(bytes) }, resolve(outputRoot, refs.accompanimentMidi), resolve(outputRoot, refs.accompanimentWav), refs.accompanimentMidi, refs.accompanimentWav, resolve(outputRoot, refs.accompanimentMidi));
  }
  let openingExcerptWav: string | null = null;
  await rm(resolve(outputRoot, refs.openingExcerptWav), { force: true });
  if (renders.some((render) => render.role === "full")) {
    try {
      await sliceOpeningWav(resolve(outputRoot, refs.fullWav), resolve(outputRoot, refs.openingExcerptWav), Math.max(0.1, excerptSeconds));
      openingExcerptWav = refs.openingExcerptWav;
    } catch (error) {
      errors.push({ role: "excerpt", message: sanitizeError(error) });
    }
  }
  const review = reviewItems(input.reviewQueue);
  const unresolvedRegions = [...(input.reviewQueue?.unresolvedRegions ?? [])]
    .map((region) => safeReportText(region))
    .filter(Boolean)
    .sort(compareText);
  const outputs: LocalReferenceListeningOutputs = {
    referenceMidi: refs.referenceMidi,
    fullWav: renders.some((render) => render.role === "full") ? refs.fullWav : null,
    openingExcerptWav,
    melodyMidi: refs.melodyMidi,
    melodyWav: renders.some((render) => render.role === "melody") ? refs.melodyWav : null,
    accompanimentMidi: refs.accompanimentMidi,
    accompanimentWav: renders.some((render) => render.role === "accompaniment") ? refs.accompanimentWav : null,
    reviewQueue: refs.reviewQueue,
    manifest: refs.manifest,
    markdown: refs.markdown,
    html: refs.html,
  };
  await atomicWrite(resolve(outputRoot, refs.reviewQueue), `${JSON.stringify(stable({
    schemaVersion: 1,
    kind: "local-score-reference-review-queue",
    scoreId,
    unresolvedRegions,
    items: review,
  }), null, 2)}\n`);
  const expectedTargets = 1 + Number(role.notes.length > 0) + Number(accompaniment.length > 0);
  const status: LocalReferenceListeningStatus = renders.length === 0
    ? "UNAVAILABLE"
    : renders.length >= expectedTargets && !errors.some((error) => error.role !== "excerpt")
      ? "RENDERED"
      : "PARTIAL";
  const reportWithoutDeterminism: Omit<LocalReferenceListeningReport, "determinism"> = {
    schemaVersion: LOCAL_REFERENCE_LISTENING_SCHEMA_VERSION,
    kind: "local-score-reference-listening",
    scoreId,
    title: safeReportText(input.title, scoreId),
    status,
    source: {
      midi: { ref: "reference.mid", bytes: source.size, sha256: source.sha256 },
      parser: { format: parsed.format, division: parsed.division, tempoBpm: round(parsed.tempoBpm), timeSig: parsed.timeSig, durationBeats: round(parsed.durationBeats), noteCount: parsed.notes.length },
      roleBasis: role.roleBasis,
      melodyNoteCount: role.notes.length,
      accompanimentNoteCount: accompaniment.length,
    },
    renderer: rendererMetadata,
    renders: renders.sort((left, right) => compareText(left.role, right.role)),
    review: {
      itemCount: review.length,
      unresolvedRegions,
      items: review,
    },
    outputs,
    errors: errors.sort((left, right) => compareText(left.role, right.role) || compareText(left.message, right.message)),
    nonClaims: [LOCAL_REFERENCE_LISTENING_NON_CLAIM, "Absolute source, executable, and SoundFont paths are intentionally omitted from the report."],
  };
  const canonicalReport = JSON.stringify(stable(reportWithoutDeterminism));
  const report: LocalReferenceListeningReport = {
    ...reportWithoutDeterminism,
    determinism: {
      basis: "path-free-report-without-determinism",
      canonicalSha256: hashBytes(new TextEncoder().encode(canonicalReport)),
    },
  };
  await atomicWrite(resolve(outputRoot, refs.manifest), `${JSON.stringify(stable(report), null, 2)}\n`);
  await atomicWrite(resolve(outputRoot, refs.markdown), markdown(report));
  await atomicWrite(resolve(outputRoot, refs.html), html(report));
  return report;
}

export function localReferenceListeningJson(report: LocalReferenceListeningReport): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

export const buildLocalReferenceListeningBundle = buildLocalReferenceListening;
