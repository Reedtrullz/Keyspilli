#!/usr/bin/env node
/**
 * Build the local C/D section-aware piano listening bundle.
 *
 * This is deliberately an evaluation-only command.  It accepts explicit
 * local MIDI paths, calls the section builder once, writes a new set of MIDI
 * previews, and (when a SoundFont is configured) renders those previews to
 * WAV.  It never opens the catalog, publishes an artifact, uploads a source,
 * or reads the supplied reference MIDI.
 *
 * The builder is loaded dynamically so this script remains a small adapter at
 * the local-tool boundary while the pure builder can evolve independently.
 * The accepted input shape is documented in `sectionBuilderInput`; aliases
 * are included for the two natural spellings used by local callers.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  parseMidi,
  writeMidi,
  type Note,
  type ParsedMidi,
} from "@keyspilli/midi";
import {
  createFluidSynthRenderer,
  type MidiRenderResult,
} from "../src/midi-renderer.js";

const ONSET_TOLERANCE = 0.08;
const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_GAIN = 1;
const DEFAULT_TARGET_PEAK = 10 ** (-1 / 20);
const EPSILON = 1e-9;

export interface PianoSectionWindow {
  id: string;
  startBeat: number;
  endBeat: number;
  label?: string;
}

export interface PianoSectionAlignment {
  /** Candidate time is `(d.start - offsetBeats) / scale`. */
  offsetBeats: number;
  scale: number;
  transposeSemitones: number;
}

export interface PianoSectionListeningOptions {
  out: string;
  cMidi: string;
  dMidi: string;
  cOriginalEasy?: string;
  windows: PianoSectionWindow[];
  dAlignment: PianoSectionAlignment;
  soundfont?: string;
  executable?: string;
  sampleRate: number;
  gain: number;
  targetPeak: number;
  noRender: boolean;
}

export interface PianoSectionBuilderAdapter {
  buildSectionAwarePianoCandidate(input: unknown): unknown | Promise<unknown>;
}

interface InputMidi {
  id: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  parsed: ParsedMidi;
}

interface LocalOutput {
  id: string;
  label: string;
  midiPath: string;
  midiRef: string;
  midiBytes: Uint8Array;
  parsed: ParsedMidi;
  wavPath?: string;
  wavRef?: string;
  render?: MidiRenderResult;
}

interface BundleSoundfontMetadata {
  status: "used" | "configured" | "unavailable" | "not-configured";
  /** Basename-only identifier; the local path is intentionally never emitted. */
  identifier: string | null;
  bytes: number | null;
  sha256: string | null;
}

interface BundleRendererMetadata {
  id: string;
  version: string;
  backend: "fluidsynth";
  /** Deliberately no executable/path field: the manifest is portable and path-safe. */
  sampleRate: number;
  channels: 1 | 2;
  gain: number;
  targetPeak: number;
  renderStatus: "rendered" | "not-rendered";
  soundfont: BundleSoundfontMetadata;
}

interface BundleNormalizationMetadata {
  method: "peak";
  targetPeak: number;
  targetPeakDb: number;
  format: "pcm16";
  sampleRate: number;
  channels: 1 | 2;
}

interface BundleExcerptMetadata {
  ref: string;
  bytes: number;
  sha256: string;
}

type BundleExcerptMap = Record<string, Record<string, BundleExcerptMetadata>>;

interface SectionBuilderOutputMap {
  [key: string]: unknown;
}

const OUTPUTS = [
  { id: "C-original-easy", label: "C original Easy" },
  { id: "C-melody-only", label: "C protected melody only" },
  { id: "C-revoiced-easy", label: "C semantic accompaniment — Easy" },
  { id: "C-revoiced-medium", label: "C semantic accompaniment — Medium" },
  { id: "CD-selected-melody-only", label: "C/D selected melody only" },
  { id: "CD-fused-easy", label: "C/D fused — Easy" },
  { id: "CD-fused-medium", label: "C/D fused — Medium" },
] as const;

const PRIOR_HUMAN_OBSERVATIONS = {
  source: "previous local blind listening pass",
  status: "context-only",
  observations: {
    directMetalEasy: "poor / failed recognizability in the prior pass",
    gabi: "weak and rejected in the prior pass",
    pianoPaul05: "recognizable main melody; lower/darker accompaniment was muddy and dense",
    posle: "recognizable, with the strongest solo/lead region in the prior pass",
  },
  note: "These observations are preserved as context. New scores remain blank until a fresh blind listening pass.",
} as const;

function usage(): string {
  return [
    "Usage: build-piano-section-listening.ts --out DIR --c-midi FILE --d-midi FILE --windows JSON|FILE [options]",
    "",
    "Required:",
    "  --out DIR              New local output directory",
    "  --c-midi FILE          Canonical C MIDI (PianoPaul05-aligned/local input)",
    "  --d-midi FILE          Explicit D MIDI (Pøsle-aligned/local input)",
    "  --windows JSON|FILE    Explicit C-domain section windows",
    "",
    "Optional:",
    "  --c-original-easy FILE Use an existing C Easy MIDI for the untouched baseline",
    "  --d-offset N           D alignment offset in beats (default 0)",
    "  --d-scale N            D-to-C beat scale (default 1)",
    "  --d-transpose N        D semitone shift (default 0)",
    "  --soundfont FILE       SoundFont (or KEYSPILLI_SOUNDFONT)",
    "  --executable FILE      FluidSynth executable (or KEYSPILLI_FLUIDSYNTH)",
    "  --sample-rate N        WAV sample rate (default 44100)",
    "  --gain N               FluidSynth gain (default 1)",
    "  --target-peak N        PCM peak target 0..1 (default -1 dBFS)",
    "  --no-render            Write MIDI/diagnostics but skip FluidSynth WAVs",
  ].join("\n");
}

function finiteNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${option} must be finite: ${value}`);
  return parsed;
}

function nextValue(argv: readonly string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function parseArgs(argv: readonly string[]): PianoSectionListeningOptions {
  let out: string | undefined;
  let cMidi: string | undefined;
  let dMidi: string | undefined;
  let cOriginalEasy: string | undefined;
  let windowsValue: string | undefined;
  let offsetBeats = 0;
  let scale = 1;
  let transposeSemitones = 0;
  let soundfont: string | undefined;
  let executable: string | undefined;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let gain = DEFAULT_GAIN;
  let targetPeak = DEFAULT_TARGET_PEAK;
  let noRender = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const option = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = nextValue(argv, index, option);
      index = next[1];
      return next[0];
    };
    switch (option) {
      case "--out": out = value(); break;
      case "--c-midi": case "--primary": cMidi = value(); break;
      case "--d-midi": case "--alternate": dMidi = value(); break;
      case "--c-original-easy": cOriginalEasy = value(); break;
      case "--windows": windowsValue = value(); break;
      case "--d-offset": offsetBeats = finiteNumber(value(), option); break;
      case "--d-scale": scale = finiteNumber(value(), option); break;
      case "--d-transpose": transposeSemitones = finiteNumber(value(), option); break;
      case "--soundfont": soundfont = value(); break;
      case "--executable": executable = value(); break;
      case "--sample-rate": sampleRate = finiteNumber(value(), option); break;
      case "--gain": gain = finiteNumber(value(), option); break;
      case "--target-peak": targetPeak = finiteNumber(value(), option); break;
      case "--no-render": noRender = true; break;
      case "--help": case "-h": throw new Error(usage());
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!out || !cMidi || !dMidi || !windowsValue) throw new Error(`${usage()}\n\n--out, --c-midi, --d-midi, and --windows are required`);
  if (!(scale > 0)) throw new Error("--d-scale must be greater than zero");
  if (!(sampleRate > 0 && Number.isInteger(sampleRate))) throw new Error("--sample-rate must be a positive integer");
  if (!(gain > 0)) throw new Error("--gain must be greater than zero");
  if (!(targetPeak > 0 && targetPeak <= 1)) throw new Error("--target-peak must be in (0, 1]");
  return {
    out: resolve(out),
    cMidi: resolve(cMidi),
    dMidi: resolve(dMidi),
    ...(cOriginalEasy ? { cOriginalEasy: resolve(cOriginalEasy) } : {}),
    windows: parseWindowsValue(windowsValue),
    dAlignment: { offsetBeats, scale, transposeSemitones },
    ...(soundfont ? { soundfont: resolve(soundfont) } : {}),
    ...(executable ? { executable } : {}),
    sampleRate,
    gain,
    targetPeak,
    noRender,
  };
}

async function readTextOrFile(value: string): Promise<string> {
  if (value.trim().startsWith("[") || value.trim().startsWith("{")) return value;
  try {
    const info = await stat(value);
    if (!info.isFile()) throw new Error("not a regular file");
    return await readFile(value, "utf8");
  } catch (error) {
    throw new Error(`windows JSON unavailable: ${value}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseWindowsJson(raw: unknown): PianoSectionWindow[] {
  const source = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? (raw as { windows?: unknown }).windows : undefined);
  if (!Array.isArray(source) || source.length === 0) throw new Error("windows must be a non-empty array");
  const seen = new Set<string>();
  const windows = source.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`windows[${index}] must be an object`);
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : `window-${index + 1}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id === "." || id === "..") {
      throw new Error(`window ${id} must use a path-safe id (letters, numbers, dot, underscore, and hyphen only)`);
    }
    const startBeat = Number(value.startBeat);
    const endBeat = Number(value.endBeat);
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat + EPSILON || startBeat < 0) {
      throw new Error(`window ${id} must have finite non-negative startBeat and endBeat > startBeat`);
    }
    if (seen.has(id)) throw new Error(`duplicate window id: ${id}`);
    seen.add(id);
    return {
      id,
      startBeat,
      endBeat,
      ...(typeof value.label === "string" && value.label.trim() ? { label: value.label.trim() } : {}),
    };
  });
  return windows.sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat || a.id.localeCompare(b.id));
}

function parseWindowsValue(value: string): PianoSectionWindow[] {
  // Parsing is completed asynchronously in build() if this is a file.  A
  // synchronous JSON value is useful for programmatic callers and CLI tests.
  if (value.trim().startsWith("[") || value.trim().startsWith("{")) {
    try { return parseWindowsJson(JSON.parse(value)); } catch (error) {
      throw new Error(`invalid --windows JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return [{ id: "__file__", startBeat: -1, endBeat: -1, label: value }];
}

async function resolveWindows(options: PianoSectionListeningOptions, originalArgv?: string): Promise<PianoSectionWindow[]> {
  // The sentinel is intentionally private to parseArgs; it avoids changing the
  // public options type just to support a file-valued CLI argument.
  if (options.windows.length === 1 && options.windows[0]!.id === "__file__") {
    const path = options.windows[0]!.label!;
    const text = await readTextOrFile(path);
    try { return parseWindowsJson(JSON.parse(text)); } catch (error) {
      throw new Error(`invalid --windows file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  void originalArgv;
  return parseWindowsJson(options.windows);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function roundNumber(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function soundfontIdentifier(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "soundfont";
}

/**
 * Resolve SoundFont provenance without ever putting its local path into the
 * bundle. Rendering already validates/reads the SoundFont, so use that
 * result when available. In no-render mode a configured file is hashed as a
 * convenience, while a missing file remains a diagnostic rather than making
 * the MIDI-only path fail.
 */
async function bundleSoundfontMetadata(path: string | undefined, rendered?: MidiRenderResult): Promise<BundleSoundfontMetadata> {
  if (rendered) {
    return {
      status: "used",
      identifier: soundfontIdentifier(rendered.soundfont.path),
      bytes: rendered.soundfont.bytes,
      sha256: rendered.soundfont.sha256,
    };
  }
  if (!path) return { status: "not-configured", identifier: null, bytes: null, sha256: null };
  const identifier = soundfontIdentifier(path);
  try {
    const info = await stat(path);
    if (!info.isFile()) return { status: "unavailable", identifier, bytes: null, sha256: null };
    const bytes = new Uint8Array(await readFile(path));
    return { status: "configured", identifier, bytes: bytes.byteLength, sha256: hashBytes(bytes) };
  } catch {
    return { status: "unavailable", identifier, bytes: null, sha256: null };
  }
}

function bundleNormalizationMetadata(sampleRate: number, channels: 1 | 2, targetPeak: number): BundleNormalizationMetadata {
  return {
    method: "peak",
    targetPeak,
    targetPeakDb: roundNumber(20 * Math.log10(targetPeak)),
    format: "pcm16",
    sampleRate,
    channels,
  };
}

async function readInputMidi(id: string, path: string): Promise<InputMidi> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${id} MIDI is not a readable regular file: ${path}`);
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.byteLength === 0) throw new Error(`${id} MIDI is empty: ${path}`);
  let parsed: ParsedMidi;
  try { parsed = parseMidi(bytes); } catch (error) {
    throw new Error(`${id} MIDI is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { id, path, bytes, sha256: hashBytes(bytes), parsed };
}

function transformDNotes(parsed: ParsedMidi, alignment: PianoSectionAlignment): Note[] {
  return parsed.notes.map((note) => ({
    ...note,
    start: (note.start - alignment.offsetBeats) / alignment.scale,
    midi: note.midi + alignment.transposeSemitones,
  })).filter((note) => Number.isFinite(note.start) && note.start + note.dur > 0);
}

function sectionBuilderInput(c: InputMidi, d: InputMidi, windows: readonly PianoSectionWindow[], alignment: PianoSectionAlignment): Record<string, unknown> {
  const transformedDNotes = transformDNotes(d.parsed, alignment);
  const primary = { id: "C", label: "C — PianoPaul05", parsed: c.parsed, notes: c.parsed.notes, bytes: c.bytes };
  const builderAlignment = {
    offsetBeats: alignment.offsetBeats,
    beatScale: alignment.scale,
    transposeSemitones: alignment.transposeSemitones,
    // `scale` is retained as an adapter alias for prototype callers; the
    // shipped pure builder reads `beatScale`.
    scale: alignment.scale,
  };
  const alternate = {
    id: "D",
    label: "D — Pøsle",
    parsed: d.parsed,
    notes: d.parsed.notes,
    bytes: d.bytes,
    alignedNotes: transformedDNotes,
    alignment: builderAlignment,
  };
  const candidateC = { id: "C", label: primary.label, parsed: c.parsed, notes: c.parsed.notes, melodyNotes: c.parsed.notes };
  const candidateD = { id: "D", label: alternate.label, parsed: d.parsed, notes: transformedDNotes, melodyNotes: transformedDNotes, alignment: builderAlignment };
  // Keep both the explicit semantic shape and terse aliases.  A pure builder
  // can destructure the shape it owns, while this adapter stays compatible
  // with local prototype revisions without importing private types.
  return {
    primary,
    alternate,
    alternates: [alternate],
    canonical: primary,
    c: primary,
    d: alternate,
    candidates: [candidateC, candidateD],
    primaryCandidateId: "C",
    alternateCandidateId: "D",
    windows: windows.map((window) => ({ ...window })),
    regionWindows: windows.map((window) => ({ ...window })),
    dAlignment: { ...builderAlignment },
    alignment: { candidateId: "D", ...builderAlignment },
    cMidi: c.parsed,
    dMidi: d.parsed,
    transformedDNotes,
  };
}

async function loadBuilder(): Promise<PianoSectionBuilderAdapter> {
  const moduleUrl = new URL("../src/piano-section-builder.js", import.meta.url).href;
  let moduleValue: unknown;
  try { moduleValue = await import(moduleUrl); } catch (error) {
    throw new Error(`piano-section-builder is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!moduleValue || typeof moduleValue !== "object" || typeof (moduleValue as { buildSectionAwarePianoCandidate?: unknown }).buildSectionAwarePianoCandidate !== "function") {
    throw new Error("piano-section-builder must export buildSectionAwarePianoCandidate(input)");
  }
  return moduleValue as PianoSectionBuilderAdapter;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function findOutputValue(result: unknown, id: string): unknown {
  const root = asRecord(result);
  if (!root) return undefined;
  const containers: Record<string, unknown>[] = [root];
  for (const key of ["outputs", "artifacts", "previews", "midi", "result"]) {
    const value = asRecord(root[key]);
    if (value) containers.push(value);
  }
  const aliases: Record<string, string[]> = {
    "C-melody-only": ["cMelodyOnly", "melodyOnly", "cMelody"],
    "C-revoiced-easy": ["cRevoicedEasy", "revoicedEasy", "cEasyRevoiced"],
    "C-revoiced-medium": ["cRevoicedMedium", "revoicedMedium", "cMediumRevoiced"],
    "CD-selected-melody-only": ["cdSelectedMelodyOnly", "selectedMelodyOnly", "selectedMelody"],
    "CD-fused-easy": ["cdFusedEasy", "fusedEasy", "cdEasy"],
    "CD-fused-medium": ["cdFusedMedium", "fusedMedium", "cdMedium"],
  };
  const camel = id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const keys = [id, camel, ...(aliases[id] ?? [])];
  for (const container of containers) {
    for (const key of keys) if (container[key] !== undefined) return container[key];
  }
  // Accept a grouped `{ cRevoiced: { easy, medium }, cdFused: ... }` result.
  const grouped: Array<[string, string]> = [
    ["C-revoiced-easy", "cRevoiced.easy"],
    ["C-revoiced-medium", "cRevoiced.medium"],
    ["CD-fused-easy", "cdFused.easy"],
    ["CD-fused-medium", "cdFused.medium"],
  ];
  const path = grouped.find(([outputId]) => outputId === id)?.[1];
  if (path) {
    const [parent, child] = path.split(".");
    for (const container of containers) {
      const groupedValue = asRecord(container[parent!]);
      if (groupedValue?.[child!] !== undefined) return groupedValue[child!];
    }
  }
  return undefined;
}

function bytesFromUnknown(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) return new Uint8Array(value);
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["bytes", "midiBytes", "data"]) {
    const bytes = bytesFromUnknown(record[key]);
    if (bytes) return bytes;
  }
  for (const key of ["midi", "parsed", "value"]) {
    const bytes = bytesFromUnknown(record[key]);
    if (bytes) return bytes;
  }
  return undefined;
}

function notesFromUnknown(value: unknown): Note[] | undefined {
  if (Array.isArray(value) && value.every((item) => item && typeof item === "object" && "midi" in item && "start" in item)) {
    return value.map((note) => ({ ...(note as Note) }));
  }
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["notes", "melodyNotes", "selectedNotes", "midi", "parsed", "value"]) {
    const notes = notesFromUnknown(record[key]);
    if (notes) return notes;
  }
  return undefined;
}

function midiBytesFor(value: unknown, base: ParsedMidi, title: string): Uint8Array {
  const bytes = bytesFromUnknown(value);
  if (bytes) {
    try { parseMidi(bytes); return bytes; } catch { /* fall through to note extraction */ }
  }
  const notes = notesFromUnknown(value);
  if (!notes) throw new Error(`builder output ${title} has neither MIDI bytes nor Note[]`);
  const right = notes.filter((note) => note.hand !== "L");
  const left = notes.filter((note) => note.hand === "L");
  return writeMidi(notes, {
    tempoBpm: base.tempoBpm,
    timeSig: base.timeSig,
    keySig: base.keySig,
    keyMode: base.keyMode,
    title,
    tracks: [
      { name: "Right Hand", notes: right },
      { name: "Left Hand", notes: left },
    ],
  });
}

function midiMetrics(parsed: ParsedMidi): Record<string, unknown> {
  const notes = parsed.notes.filter((note) => Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0);
  const starts = [...new Set(notes.map((note) => Math.round(note.start / ONSET_TOLERANCE) * ONSET_TOLERANCE))].sort((a, b) => a - b);
  const hand = {
    right: notes.filter((note) => note.hand !== "L").length,
    left: notes.filter((note) => note.hand === "L").length,
  };
  const simultaneous = notes.reduce((max, note, index) => {
    const count = notes.filter((other, otherIndex) => otherIndex !== index
      && other.start < note.start + note.dur - EPSILON
      && other.start + other.dur > note.start + EPSILON).length + 1;
    return Math.max(max, count);
  }, 0);
  const pitches = notes.map((note) => note.midi);
  const durationBeats = notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  return {
    noteCount: notes.length,
    onsetCount: starts.length,
    durationBeats,
    durationSeconds: parsed.tempoBpm > 0 ? durationBeats * 60 / parsed.tempoBpm : null,
    tempoBpm: parsed.tempoBpm,
    pitchMin: pitches.length ? Math.min(...pitches) : null,
    pitchMax: pitches.length ? Math.max(...pitches) : null,
    lowRegisterNotes: notes.filter((note) => note.midi <= 60).length,
    rightHandNotes: hand.right,
    leftHandNotes: hand.left,
    maxSimultaneity: simultaneous,
    onsetToleranceBeats: ONSET_TOLERANCE,
  };
}

function pathSafe(value: unknown, key?: string): unknown {
  if (key && /(?:^|_)(?:path|file|directory|dir)$/i.test(key)) return "[redacted-path]";
  if (typeof value === "string") {
    if (/^(?:\/|[A-Za-z]:[\\/]|file:\/\/)/.test(value)) return "[redacted-path]";
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => pathSafe(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((childKey) => [childKey, pathSafe((value as Record<string, unknown>)[childKey], childKey)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(pathSafe(value), null, 2)}\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(value), "utf8");
}

function blindMap(outputs: readonly LocalOutput[]): Record<string, { candidateId: string; label: string; wavRef?: string }> {
  const ids = ["C-original-easy", "C-revoiced-easy", "CD-fused-easy", "CD-fused-medium"];
  const aliases = ["A", "B", "C", "D"];
  return Object.fromEntries(aliases.map((alias, index) => {
    const output = outputs.find((item) => item.id === ids[index]);
    return [alias, { candidateId: ids[index]!, label: output?.label ?? ids[index]!, ...(output?.wavRef ? { wavRef: output.wavRef } : {}) }];
  }));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function findWavChunk(view: DataView, wanted: string): { offset: number; length: number } {
  if (view.byteLength < 12 || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== "RIFF"
    || String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const length = view.getUint32(offset + 4, true);
    if (offset + 8 + length > view.byteLength) throw new Error(`truncated WAV ${id} chunk`);
    if (id === wanted) return { offset: offset + 8, length };
    offset += 8 + length + (length & 1);
  }
  throw new Error(`WAV is missing ${wanted} chunk`);
}

async function sliceWav(inputPath: string, outputPath: string, startSeconds: number, endSeconds: number): Promise<void> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = findWavChunk(view, "fmt ");
  const data = findWavChunk(view, "data");
  const format = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  if (format !== 1 || bits !== 16 || (channels !== 1 && channels !== 2)) throw new Error("listening excerpts require PCM16 WAV");
  const bytesPerFrame = channels * 2;
  const frames = Math.floor(data.length / bytesPerFrame);
  const start = Math.max(0, Math.min(frames, Math.floor(startSeconds * sampleRate)));
  const end = Math.max(start, Math.min(frames, Math.ceil(endSeconds * sampleRate)));
  const payload = bytes.slice(data.offset + start * bytesPerFrame, data.offset + end * bytesPerFrame);
  const header = new ArrayBuffer(44);
  const headerView = new DataView(header);
  writeAscii(headerView, 0, "RIFF");
  headerView.setUint32(4, 36 + payload.length, true);
  writeAscii(headerView, 8, "WAVE");
  writeAscii(headerView, 12, "fmt ");
  headerView.setUint32(16, 16, true);
  headerView.setUint16(20, 1, true);
  headerView.setUint16(22, channels, true);
  headerView.setUint32(24, sampleRate, true);
  headerView.setUint32(28, sampleRate * bytesPerFrame, true);
  headerView.setUint16(32, bytesPerFrame, true);
  headerView.setUint16(34, 16, true);
  writeAscii(headerView, 36, "data");
  headerView.setUint32(40, payload.length, true);
  await mkdir(dirname(outputPath), { recursive: true });
  const output = new Uint8Array(44 + payload.length);
  output.set(new Uint8Array(header), 0);
  output.set(payload, 44);
  await writeFile(outputPath, output);
}

async function renderExcerpts(outputs: readonly LocalOutput[], windows: readonly PianoSectionWindow[], tempoBpm: number, out: string): Promise<BundleExcerptMap> {
  const excerpts: BundleExcerptMap = {};
  for (const window of windows) {
    excerpts[window.id] = {};
    const startSeconds = window.startBeat * 60 / tempoBpm;
    const endSeconds = window.endBeat * 60 / tempoBpm;
    for (const output of outputs) {
      if (!output.wavPath) continue;
      const ref = `excerpts/${window.id}/${output.id}.wav`;
      const path = join(out, ref);
      await sliceWav(output.wavPath, path, startSeconds, endSeconds);
      const bytes = new Uint8Array(await readFile(path));
      excerpts[window.id]![output.id] = { ref, bytes: bytes.byteLength, sha256: hashBytes(bytes) };
    }
  }
  return excerpts;
}

function listeningMarkdown(
  outputs: readonly LocalOutput[],
  windows: readonly PianoSectionWindow[],
  blind: Record<string, { candidateId: string; label: string; wavRef?: string }>,
  excerpts: BundleExcerptMap,
  diagnosticsPath: string,
  renderer: BundleRendererMetadata,
  normalization: BundleNormalizationMetadata,
): string {
  const soundfont = renderer.soundfont.sha256
    ? `${renderer.soundfont.identifier ?? "soundfont"} (sha256 ${renderer.soundfont.sha256})`
    : renderer.soundfont.identifier ?? "not configured";
  return [
    "# Section-aware piano listening bundle",
    "",
    "Local-only C/D comparison. The section builder is experimental and does not change Keyspilli production imports.",
    "",
    "Human listening acceptance: pending.",
    "New scores are intentionally blank. The prior listening observations are preserved as context in `manifest.json`.",
    `Renderer: ${renderer.backend} ${renderer.id} ${renderer.version}, ${normalization.sampleRate} Hz, ${normalization.format}, fixed peak target ${normalization.targetPeak.toFixed(6)} (${normalization.targetPeakDb.toFixed(3)} dBFS).`,
    `SoundFont: ${soundfont}.`,
    `Render status: ${renderer.renderStatus}.`,
    "",
    "## Descriptive candidates",
    ...outputs.map((output) => `- ${output.label}: [MIDI](${output.midiRef})${output.wavRef ? ` · [WAV](${output.wavRef})` : ""}`),
    "",
    "## Blind pass",
    ...Object.keys(blind).sort().map((alias) => `- ${alias}: [WAV](blind/${alias}.wav)`),
    "",
    "## Explicit aligned windows",
    ...windows.map((window) => {
      const links = Object.values(excerpts[window.id] ?? {}).map((excerpt) => `[excerpt WAV](${excerpt.ref})`);
      return `- ${window.id}: beats ${window.startBeat}–${window.endBeat}${window.label ? ` — ${window.label}` : ""}${links.length ? ` · ${links.join(" · ")}` : ""}`;
    }),
    "",
    "## Diagnostics",
    `- [manifest.json](manifest.json)`,
    `- [metrics.json](${diagnosticsPath})`,
    "- [selected-region-map.json](selected-region-map.json)",
    "- [blind-map.json](blind-map.json)",
    "",
    "Automated metrics are diagnostic evidence only; they do not establish recognizability or playability.",
    "",
  ].join("\n");
}

/**
 * Build the local bundle.  Supplying `adapter` is useful for unit tests and
 * keeps the renderer/builder boundary independently testable.
 */
export async function buildPianoSectionListeningBundle(
  options: PianoSectionListeningOptions,
  adapter?: PianoSectionBuilderAdapter,
): Promise<Record<string, unknown>> {
  const windows = await resolveWindows(options);
  const c = await readInputMidi("C", options.cMidi);
  const d = await readInputMidi("D", options.dMidi);
  const cOriginal = await readInputMidi("C-original-easy", options.cOriginalEasy ?? options.cMidi);
  const builder = adapter ?? await loadBuilder();
  const builderResult = await builder.buildSectionAwarePianoCandidate(sectionBuilderInput(c, d, windows, options.dAlignment));
  const outputRoot = resolve(options.out);
  await mkdir(outputRoot, { recursive: true });

  const localOutputs: LocalOutput[] = [];
  for (const outputSpec of OUTPUTS) {
    const raw = outputSpec.id === "C-original-easy" ? cOriginal.bytes : findOutputValue(builderResult, outputSpec.id);
    if (raw === undefined) throw new Error(`builder did not return required output ${outputSpec.id}`);
    const bytes = midiBytesFor(raw, c.parsed, outputSpec.label);
    const parsed = parseMidi(bytes);
    const midiRef = `midi/${outputSpec.id}.mid`;
    const midiPath = join(outputRoot, midiRef);
    await mkdir(dirname(midiPath), { recursive: true });
    await writeFile(midiPath, bytes);
    localOutputs.push({ ...outputSpec, midiPath, midiRef, midiBytes: bytes, parsed });
  }

  const configuredSoundfontPath = options.soundfont ?? process.env.KEYSPILLI_SOUNDFONT;
  if (!options.noRender) {
    const soundfontPath = configuredSoundfontPath;
    if (!soundfontPath) throw new Error("SoundFont unavailable. Set KEYSPILLI_SOUNDFONT, pass --soundfont, or use --no-render.");
    const renderer = createFluidSynthRenderer({
      soundfontPath,
      executable: options.executable ?? process.env.KEYSPILLI_FLUIDSYNTH,
      sampleRate: options.sampleRate,
      gain: options.gain,
      targetPeak: options.targetPeak,
    });
    for (const output of localOutputs) {
      const wavRef = `audio/${output.id}.wav`;
      const wavPath = join(outputRoot, wavRef);
      await mkdir(dirname(wavPath), { recursive: true });
      const render = await renderer.render({ midiPath: output.midiPath, outputPath: wavPath });
      output.wavRef = wavRef;
      output.wavPath = wavPath;
      output.render = render;
    }
    // Excerpt metadata is collected below after all slices have been written.
    // One flat blind directory is intentionally made from the four selected
    // comparison candidates; per-window copies remain under excerpts/.
    const blindIds = ["C-original-easy", "C-revoiced-easy", "CD-fused-easy", "CD-fused-medium"];
    for (const [index, id] of blindIds.entries()) {
      const output = localOutputs.find((item) => item.id === id);
      if (!output?.wavPath) continue;
      await sliceWav(output.wavPath, join(outputRoot, "blind", `${String.fromCharCode(65 + index)}.wav`), 0, Number.POSITIVE_INFINITY);
    }
  }

  const excerptMetrics: BundleExcerptMap = options.noRender
    ? {}
    : await renderExcerpts(localOutputs, windows, c.parsed.tempoBpm, outputRoot);

  const blind = blindMap(localOutputs);
  const representativeRender = localOutputs.find((output) => output.render)?.render;
  const renderChannels: 1 | 2 = representativeRender?.wav.channels === 1 ? 1 : 2;
  const rendererSoundfont = await bundleSoundfontMetadata(configuredSoundfontPath, representativeRender);
  const rendererMetadata: BundleRendererMetadata = {
    id: representativeRender?.renderer.id ?? "fluidsynth",
    version: representativeRender?.renderer.version ?? "pcm16-v1",
    backend: "fluidsynth",
    sampleRate: representativeRender?.renderer.sampleRate ?? options.sampleRate,
    channels: renderChannels,
    gain: representativeRender?.renderer.gain ?? options.gain,
    targetPeak: representativeRender?.renderer.targetPeak ?? options.targetPeak,
    renderStatus: options.noRender ? "not-rendered" : "rendered",
    soundfont: rendererSoundfont,
  };
  const normalizationMetadata = bundleNormalizationMetadata(
    rendererMetadata.sampleRate,
    rendererMetadata.channels,
    rendererMetadata.targetPeak,
  );
  const outputMetrics = Object.fromEntries(localOutputs.map((output) => [output.id, {
    label: output.label,
    midi: { ref: output.midiRef, bytes: output.midiBytes.byteLength, sha256: hashBytes(output.midiBytes) },
    ...(output.wavRef && output.render ? {
      wav: {
        ref: output.wavRef,
        bytes: output.render.wav.bytes,
        sha256: output.render.wav.sha256,
        durationSeconds: output.render.wav.durationSeconds,
        peak: output.render.wav.peak,
        rms: output.render.wav.rms,
      },
    } : {}),
    metrics: midiMetrics(output.parsed),
  }]));
  const diagnostics = asRecord(builderResult)?.diagnostics ?? asRecord(builderResult)?.regionDiagnostics ?? null;
  const selection = asRecord(builderResult)?.selection ?? asRecord(builderResult)?.regionSelection ?? null;
  const manifest = {
    schemaVersion: 1,
    kind: "local-piano-section-listening-bundle",
    generatedFrom: "explicit local C/D MIDI inputs",
    thresholds: { onsetToleranceBeats: ONSET_TOLERANCE },
    renderer: rendererMetadata,
    normalization: normalizationMetadata,
    inputs: {
      C: { id: "C", bytes: c.bytes.byteLength, sha256: c.sha256, parser: { format: c.parsed.format, division: c.parsed.division, tempoBpm: c.parsed.tempoBpm, durationBeats: c.parsed.durationBeats, noteCount: c.parsed.notes.length } },
      D: { id: "D", bytes: d.bytes.byteLength, sha256: d.sha256, parser: { format: d.parsed.format, division: d.parsed.division, tempoBpm: d.parsed.tempoBpm, durationBeats: d.parsed.durationBeats, noteCount: d.parsed.notes.length } },
    },
    alignment: { candidateId: "D", ...options.dAlignment, domain: "C beats" },
    windows,
    excerpts: excerptMetrics,
    outputs: outputMetrics,
    selection: pathSafe(selection),
    builderDiagnostics: pathSafe(diagnostics),
    humanEvaluation: { status: "pending", ratings: null, priorObservations: PRIOR_HUMAN_OBSERVATIONS },
  };
  const canonical = canonicalJson(manifest);
  const canonicalSha256 = hashBytes(new TextEncoder().encode(canonical));
  await writeFile(join(outputRoot, "manifest.canonical.json"), canonical, "utf8");
  await writeJson(join(outputRoot, "manifest.json"), { ...manifest, canonicalSha256 });
  await writeJson(join(outputRoot, "metrics.json"), { schemaVersion: 1, thresholds: manifest.thresholds, renderer: rendererMetadata, normalization: normalizationMetadata, windows, excerpts: excerptMetrics, outputs: outputMetrics, builderDiagnostics: pathSafe(diagnostics) });
  await writeJson(join(outputRoot, "selected-region-map.json"), { windows, selection: pathSafe(selection) });
  await writeJson(join(outputRoot, "blind-map.json"), blind);
  await writeJson(join(outputRoot, "evidence-manifest.json"), { schemaVersion: 1, kind: manifest.kind, manifest: "manifest.json", canonicalManifest: "manifest.canonical.json", metrics: "metrics.json", selectedRegionMap: "selected-region-map.json", blindMap: "blind-map.json", excerpts: excerptMetrics, renderer: rendererMetadata, normalization: normalizationMetadata, humanEvaluation: manifest.humanEvaluation });
  await writeFile(join(outputRoot, "LISTENING.md"), listeningMarkdown(localOutputs, windows, blind, excerptMetrics, "metrics.json", rendererMetadata, normalizationMetadata), "utf8");

  const result = { out: outputRoot, outputs: localOutputs.map((output) => output.id), windows: windows.map((window) => window.id), rendered: !options.noRender, canonicalSha256 };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/* istanbul ignore next -- command entry point */
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
  } else {
    try {
      await buildPianoSectionListeningBundle(parseArgs(process.argv.slice(2)));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
