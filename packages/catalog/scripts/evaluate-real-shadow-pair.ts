#!/usr/bin/env node

/**
 * Evaluate one locally available, openly attributed audio/symbolic pair.
 *
 * This is deliberately a shadow-only command. It accepts explicit local
 * paths, hashes and parses them in memory, invokes the existing symbolic
 * intake and shadow evaluator, and writes only path-free metadata. It never
 * downloads, copies, publishes, or calls the production worker.
 *
 * The onset comparison is intentionally labelled a truth-timing probe: the
 * supplied MIDI is not an independently transcribed candidate. This keeps a
 * paired research corpus useful for alignment diagnostics without claiming
 * audio-to-MIDI quality that was not measured.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildMetalArrangement,
  buildVariants,
  parseMidi,
  parseMusicXmlNotes,
  validateArtifactFiles,
  validateVariants,
  writeVariantArtifacts,
  type DifficultyLevel,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import {
  AUDIO_ONSET_DETECTOR_CONFIG,
  ONSET_MATCH_SEC,
  TRANSCRIPTION_FILTER_VERSION,
} from "../src/transcribe.js";
import {
  ingestExternalSymbolicCandidate,
  type ExternalResearchParserStatus,
} from "../src/external-research.js";
import {
  adaptShadowCorpusMidiFile,
  buildShadowCorpusItem,
  SHADOW_CORPUS_MAX_BYTES,
  type ShadowCorpusAdapterPathOptions,
  type ShadowCorpusItem,
  type ShadowCorpusTrackSummary,
} from "../src/shadow-corpus-adapter.js";
import {
  evaluateShadowCorpus,
  shadowItemToMetalStems,
  type ShadowCorpusItemInput,
  type ShadowCorpusManifestInput,
  type ShadowTrackInput,
} from "../src/shadow-evaluation.js";
import { groupSongs } from "../src/group.js";
import { projectPublicGroupedSongs, projectPublicSongRows, type PublicDifficultyLevel } from "../src/public-difficulty.js";
import type { SongRow } from "../src/db-types.js";
import { sha256Hex } from "../src/fixture-evidence.js";
import {
  evaluateAudioSymbolicAlignment,
  type AudioBeatAnchor,
  type AudioSymbolicAlignmentInput,
  type AudioSymbolicAlignmentResult,
} from "../src/audio-symbolic-alignment.js";

export const REAL_SHADOW_PAIR_SCHEMA_VERSION = 1 as const;
export const REAL_SHADOW_PAIR_KIND = "guitar-techs-real-shadow-pair" as const;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PYTHON = process.env.KEYSPILLI_PYTHON
  ?? resolve(REPOSITORY_ROOT, "services/transcribe/.venv/bin/python");
const ONSET_SCRIPT = resolve(REPOSITORY_ROOT, "services/transcribe/src/audio_onsets.py");
const execFileP = promisify(execFile);

type ReportStatus = "complete" | "blocked";
type DetectorStatus = "parsed" | "unavailable";

const ABSOLUTE_PATH_TEXT = /(?:^|[\s("'=,:])(?:file:\/\/|\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)(?:[\\/]|$)|~[\\/]|[A-Za-z]:[\\/])[^\s"'<>;,)]*/i;
const RELATIVE_PATH_TEXT = /(?:^|[\s("'=,:])(?:\.\.?[\\/]|[^\\/\s]+[\\/])[^\s"'<>;,)]*/i;

interface ManifestDataset {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  record?: unknown;
  recordUrl?: unknown;
  sourceUrl?: unknown;
  paperUrl?: unknown;
}

interface ManifestItem {
  id?: unknown;
  performanceId?: unknown;
  stem?: unknown;
  reason?: unknown;
  techniques?: unknown;
  local?: unknown;
  truthMetadata?: unknown;
  audioMetadata?: unknown;
  alignment?: unknown;
}

interface RealShadowManifest {
  schemaVersion?: unknown;
  dataset?: unknown;
  items?: unknown;
}

interface LocalPaths {
  truth: string;
  audio: string;
}

export interface RealShadowPairCliOptions {
  manifest: string;
  itemId: string;
  truth?: string;
  audio?: string;
  out?: string;
  allowedRoot?: string;
  python?: string;
  help: boolean;
}

export interface RealShadowPairOptions {
  manifest: string;
  itemId: string;
  truth?: string;
  audio?: string;
  out?: string;
  allowedRoot?: string;
  python?: string;
  repositoryRoot?: string;
  /** Test/local seam; the default runs the production onset script. */
  onsetRunner?: (audioPath: string) => Promise<readonly number[]>;
  /** Independent timing evidence; candidate MIDI tempo remains the naive baseline. */
  alignment?: Pick<AudioSymbolicAlignmentInput, "anchors" | "secondsPerBeat" | "beatZeroAudioSeconds" | "onsetToleranceBeats" | "onsetDedupToleranceSeconds">;
}

export interface RealShadowMediaSummary {
  status: "available" | "unavailable";
  sha256: string | null;
  byteLength: number | null;
  logicalRef: string;
}

export interface RealShadowOnsetComparison {
  noteCount: number;
  audioOnsetCount: number;
  matchedNoteCount: number;
  unmatchedNoteCount: number;
  matchedAudioOnsetCount: number;
  naive: {
    tempoBpm: number;
    secondsPerBeat: number;
    durationBeats: number;
    durationSeconds: number;
    onsetCount: number;
    firstNoteSeconds: number | null;
    lastNoteSeconds: number | null;
  };
  production: {
    matchToleranceSeconds: number;
    matchedNoteRatio: number;
    matchedAudioOnsetRatio: number;
  };
}

export interface RealShadowPairReport {
  schemaVersion: typeof REAL_SHADOW_PAIR_SCHEMA_VERSION;
  kind: typeof REAL_SHADOW_PAIR_KIND;
  status: ReportStatus;
  dataset: {
    name: string;
    version: string;
    license: { label: string; spdx: string | null; url: string | null };
    recordId: string | null;
    recordUrl: string | null;
    sourceUrl: string | null;
    paperUrl: string | null;
  };
  item: {
    id: string;
    performanceId: string | null;
    stem: string | null;
    reason: string | null;
    techniques: string[];
    manifestTruth: {
      tempoBpm: number | null;
      durationBeats: number | null;
      noteCount: number | null;
    };
    parsedMidi: {
      tempoBpm: number;
      tempoSource: "midi-meta" | "parser-default";
      durationBeats: number;
      noteCount: number;
      title: string | null;
    };
  };
  source: {
    symbolic: RealShadowMediaSummary;
    audio: RealShadowMediaSummary & {
      wave: {
        status: "parsed" | "unsupported";
        sampleRate: number | null;
        channels: number | null;
        bitsPerSample: number | null;
        durationSeconds: number | null;
      };
    };
  };
  externalIntake: {
    status: ExternalResearchParserStatus;
    format: string | null;
    purpose: "SHADOW_GENERATION_TRUTH";
    candidateStatus: string | null;
    generationUsable: false;
    parser: string | null;
    alignment: { status: AudioSymbolicAlignmentResult["status"] | "not-attempted"; reason: string | null };
    rejectionReasons: string[];
    warnings: string[];
  };
  shadow: {
    adapter: {
      status: "ready";
      id: string;
      generationEligible: boolean;
      evaluationStatus: string;
      evaluationEligible: boolean;
      eligibilityReasons: string[];
      roleTags: string[];
      adapterRoleTags?: string[];
      roleOverride?: string;
      noteCount: number;
      durationBeats: number | null;
      tempoBpm: number | null;
    };
    pureEvaluation: {
      status: string;
      summary: {
        total: number;
        ready: number;
        notReady: number;
        blocked: number;
        drumPitchViolations: number;
      };
      failures: string[];
      item: {
        status: string | null;
        failures: string[];
        warnings: string[];
        determinism: string | null;
      };
      determinism: string;
    };
    downstream: DownstreamProductPathSummary;
  };
  timing: {
    alignment: AudioSymbolicAlignmentResult;
    detector: {
      status: DetectorStatus;
      script: "services/transcribe/src/audio_onsets.py";
      config: typeof AUDIO_ONSET_DETECTOR_CONFIG;
      onsetCount: number | null;
      firstOnsetSeconds: number | null;
      lastOnsetSeconds: number | null;
      error: string | null;
    };
    naiveTempoMapping: RealShadowOnsetComparison["naive"];
    productionOnsetFilter: RealShadowOnsetComparison["production"] & {
      status: DetectorStatus;
      filterVersion: typeof TRANSCRIPTION_FILTER_VERSION;
      inputKind: "truth-midi-timing-probe";
      matchedNoteCount: number | null;
      unmatchedNoteCount: number | null;
    };
    comparison: {
      noteCount: number;
      audioOnsetCount: number | null;
      matchedNoteCount: number | null;
      unmatchedNoteCount: number | null;
      matchedAudioOnsetCount: number | null;
    };
    audioSymbolicAlignment: {
      evidence: "explicit-independent-timing" | "manifest-independent-timing" | "duration-derived-audio-seconds-per-beat" | "none";
      status: string;
      confidence: number;
      naive: { method: string; confidence: number; metrics: Record<string, unknown> } | null;
      production: { method: string; confidence: number; metrics: Record<string, unknown> } | null;
      diagnostics: string[];
      config: Record<string, unknown>;
    };
  };
  blockers: string[];
  firstBlocker: string | null;
  safety: {
    sourceBytesCopied: false;
    networkUsed: false;
    productionInvoked: false;
    reportPathRedacted: true;
    benchmarkReferencesUsed: false;
  };
  determinism: { canonicalSha256: string };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function text(value: unknown, fallback: string | null = null, max = 240): string | null {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  if (!clean) return fallback;
  if (/^https?:\/\//i.test(clean)) return clean;
  return ABSOLUTE_PATH_TEXT.test(clean) || RELATIVE_PATH_TEXT.test(clean) ? "[redacted-path]" : clean;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry)).filter((entry): entry is string => Boolean(entry)))].sort();
}

function stableValue(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return typeof value === "string" ? text(value) : value ?? null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function redactText(value: unknown): string {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : String(value);
  return message
    .replace(/file:\/\/[^\s"']+/gi, "[redacted-path]")
    .replace(/(^|[\s(=,:])\/(?:[^\s"'<>;,)]*\/)?(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/(?:[^\s"'<>;,)]*)/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(^|[\s(=,:])[A-Za-z]:[\\\/][^\s"'<>;,)]*/g, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "operation failed";
}

function logicalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function logicalId(value: unknown, fallback: string): string {
  const candidate = text(value, fallback, 120) ?? fallback;
  const normalized = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized && !normalized.includes("/") && !normalized.includes("\\") ? normalized : fallback;
}

function pathInside(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function protectedPath(value: string): boolean {
  return resolve(value).split(/[\\/]+/).filter(Boolean).some((segment) => /^(?:\.ssh|\.gnupg|\.aws|wallets?|secrets?|credentials?|tokens?|passwords?|id_(?:rsa|dsa|ecdsa|ed25519)|authorized_keys)$/i.test(segment));
}

function localArgument(value: string, label: string): string {
  if (!value || !isAbsolute(value) || /^(?:https?|ftp):\/\//i.test(value) || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} must be an absolute local path`);
  }
  return resolve(value);
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

export function parseRealShadowPairArgs(argv: readonly string[]): RealShadowPairCliOptions {
  const result: RealShadowPairCliOptions = { manifest: "", itemId: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--manifest": result.manifest = localArgument(value(), "--manifest"); break;
      case "--item": result.itemId = logicalId(value(), ""); break;
      case "--truth": result.truth = localArgument(value(), "--truth"); break;
      case "--audio": result.audio = localArgument(value(), "--audio"); break;
      case "--out": result.out = localArgument(value(), "--out"); break;
      case "--allowed-root": result.allowedRoot = localArgument(value(), "--allowed-root"); break;
      case "--python": result.python = value(); break;
      case "--help":
      case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (result.help) return result;
  if (!result.manifest) throw new Error("--manifest is required");
  if (!result.itemId) throw new Error("--item is required");
  return result;
}

function usage(): string {
  return [
    "Usage: evaluate-real-shadow-pair.ts --manifest FILE --item ID [options]",
    "  --manifest FILE     local Guitar-TECHS metadata manifest (outside repo)",
    "  --item ID           item id, for example p3-music-08",
    "  --truth FILE        explicit local MIDI override (otherwise manifest local.truth)",
    "  --audio FILE        explicit local DI WAV override (otherwise manifest local.di)",
    "  --allowed-root DIR  optional local corpus root boundary",
    "  --python FILE       Python executable containing librosa",
    "  --out FILE          path-redacted report outside repo; default stdout",
    "",
    "The command is local-only. It runs the existing onset detector when",
    "available, but reports the result as a truth-MIDI timing probe rather",
    "than an independent audio-to-MIDI candidate evaluation.",
  ].join("\n");
}

async function regularFile(path: string, label: string, repositoryRoot: string, allowedRoot?: string): Promise<string> {
  if (!isAbsolute(path) || /[\u0000\r\n]/.test(path)) throw new Error(`${label} must be an absolute local path`);
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch {
    throw new Error(`${label} does not exist or could not be resolved`);
  }
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(`${label} could not be inspected`);
  }
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  if (pathInside(repositoryRoot, resolved)) throw new Error(`${label} must be outside the repository`);
  if (allowedRoot && !pathInside(allowedRoot, resolved)) throw new Error(`${label} is outside the supplied corpus root`);
  if (protectedPath(resolved)) throw new Error(`${label} is protected local state`);
  return resolved;
}

async function boundedRead(path: string, label: string, repositoryRoot: string, allowedRoot?: string): Promise<{ path: string; bytes: Uint8Array }> {
  const resolved = await regularFile(path, label, repositoryRoot, allowedRoot);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(`${label} could not be inspected`);
  }
  if (info.size > SHADOW_CORPUS_MAX_BYTES) throw new Error(`${label} exceeds the local byte limit`);
  return { path: resolved, bytes: new Uint8Array(await readFile(resolved)) };
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function manifestData(value: unknown): RealShadowManifest {
  const object = recordObject(value);
  if (object.schemaVersion !== 1 || !Array.isArray(object.items)) throw new Error("manifest schema/items are invalid");
  return object as RealShadowManifest;
}

function manifestItem(manifest: RealShadowManifest, id: string): ManifestItem {
  const rows = Array.isArray(manifest.items) ? manifest.items : [];
  const row = rows.find((item: unknown) => recordObject(item).id === id);
  if (!row) throw new Error(`manifest item is missing: ${id}`);
  return recordObject(row) as ManifestItem;
}

function manifestDataset(manifest: RealShadowManifest): ManifestDataset {
  return recordObject(manifest.dataset) as ManifestDataset;
}

function manifestLocalPath(value: unknown, base: string, label: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^(?:https?|ftp):\/\//i.test(value)) throw new Error(`${label} must be a local path`);
  return localArgument(isAbsolute(value) ? value : resolve(base, value), label);
}

function resolvePairPaths(options: RealShadowPairOptions, item: ManifestItem, manifestPath: string): LocalPaths {
  const local = recordObject(item.local);
  const truth = options.truth
    ?? manifestLocalPath(local.truth, dirname(manifestPath), "manifest truth")
    ?? undefined;
  const audio = options.audio
    ?? manifestLocalPath(local.di ?? local.directinput, dirname(manifestPath), "manifest DI audio")
    ?? undefined;
  if (!truth) throw new Error("truth MIDI path is required via --truth or manifest local.truth");
  if (!audio) throw new Error("DI audio path is required via --audio or manifest local.di");
  return { truth, audio };
}

function alignmentEvidence(
  item: ManifestItem,
  options: RealShadowPairOptions,
): Pick<AudioSymbolicAlignmentInput, "anchors" | "secondsPerBeat" | "beatZeroAudioSeconds" | "onsetToleranceBeats" | "onsetDedupToleranceSeconds"> {
  const itemEvidence = recordObject(item.alignment);
  const audioMetadata = recordObject(recordObject(item.audioMetadata).di);
  const anchors = options.alignment?.anchors
    ?? (Array.isArray(itemEvidence.anchors) ? itemEvidence.anchors as AudioBeatAnchor[] : undefined)
    ?? (Array.isArray(audioMetadata.anchors) ? audioMetadata.anchors as AudioBeatAnchor[] : undefined);
  const secondsPerBeat = options.alignment?.secondsPerBeat
    ?? (finite(itemEvidence.secondsPerBeat) ? itemEvidence.secondsPerBeat : undefined)
    ?? (finite(audioMetadata.secondsPerBeat) ? audioMetadata.secondsPerBeat : undefined);
  const beatZeroAudioSeconds = options.alignment?.beatZeroAudioSeconds
    ?? (finite(itemEvidence.beatZeroAudioSeconds) ? itemEvidence.beatZeroAudioSeconds : undefined)
    ?? (finite(audioMetadata.beatZeroAudioSeconds) ? audioMetadata.beatZeroAudioSeconds : undefined);
  return {
    ...(anchors ? { anchors } : {}),
    ...(secondsPerBeat !== undefined ? { secondsPerBeat } : {}),
    ...(beatZeroAudioSeconds !== undefined ? { beatZeroAudioSeconds } : {}),
    ...(options.alignment?.onsetToleranceBeats !== undefined ? { onsetToleranceBeats: options.alignment.onsetToleranceBeats } : {}),
    ...(options.alignment?.onsetDedupToleranceSeconds !== undefined ? { onsetDedupToleranceSeconds: options.alignment.onsetDedupToleranceSeconds } : {}),
  };
}

function datasetLicense(value: unknown): { label: string; spdx: string | null; url: string | null } {
  if (typeof value === "string") {
    const label = text(value, "unspecified") ?? "unspecified";
    const spdx = /cc\s*by\s*4/i.test(label) ? "CC-BY-4.0" : null;
    return { label, spdx, url: spdx ? "https://creativecommons.org/licenses/by/4.0/" : null };
  }
  const object = recordObject(value);
  const label = text(object.label ?? object.name ?? object.spdx, "unspecified") ?? "unspecified";
  const spdx = text(object.spdx, null);
  return { label, spdx: spdx || (/cc\s*by\s*4/i.test(label) ? "CC-BY-4.0" : null), url: logicalUrl(object.url) };
}

function numberOrNull(value: unknown): number | null {
  return finite(value) ? round(value) : null;
}

function mediaSummary(value: { status: string; sha256: string | null; byteLength: number | null; logicalRef: string | null }, fallback: string): RealShadowMediaSummary {
  return {
    status: value.status === "available" ? "available" : "unavailable",
    sha256: typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256) ? value.sha256.toLowerCase() : null,
    byteLength: finite(value.byteLength) ? value.byteLength : null,
    logicalRef: text(value.logicalRef, fallback) ?? fallback,
  };
}

interface WaveMetadata {
  status: "parsed" | "unsupported";
  sampleRate: number | null;
  channels: number | null;
  bitsPerSample: number | null;
  durationSeconds: number | null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function waveMetadata(bytes: Uint8Array): WaveMetadata {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    return { status: "unsupported", sampleRate: null, channels: null, bitsPerSample: null, durationSeconds: null };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let blockAlign: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > bytes.length) break;
    if (id === "fmt " && size >= 16) {
      channels = view.getUint16(payload + 2, true);
      sampleRate = view.getUint32(payload + 4, true);
      blockAlign = view.getUint16(payload + 12, true);
      bitsPerSample = view.getUint16(payload + 14, true);
    } else if (id === "data") {
      dataBytes = size;
    }
    offset = payload + size + (size % 2);
  }
  const valid = finite(sampleRate) && sampleRate > 0 && finite(blockAlign) && blockAlign > 0 && finite(dataBytes) && dataBytes >= 0;
  return {
    status: valid ? "parsed" : "unsupported",
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds: valid ? round(dataBytes! / blockAlign! / sampleRate!) : null,
  };
}

function noteOnsetCount(notes: readonly Note[]): number {
  return new Set(notes.filter((note) => finite(note.start)).map((note) => round(note.start))).size;
}

function noteSeconds(notes: readonly Note[], tempoBpm: number): number[] {
  const secPerBeat = 60 / tempoBpm;
  return notes.filter((note) => finite(note.start)).map((note) => note.start * secPerBeat);
}

/** Mirror the production `filterTranscription` onset predicate without writing MIDI. */
export function compareRealShadowOnsets(
  notes: readonly Note[],
  tempoBpm: number,
  audioOnsets: readonly number[],
  matchToleranceSeconds = ONSET_MATCH_SEC,
): RealShadowOnsetComparison {
  const safeTempo = finite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120;
  const safeTolerance = finite(matchToleranceSeconds) && matchToleranceSeconds >= 0 ? matchToleranceSeconds : ONSET_MATCH_SEC;
  const validNotes = notes.filter((note) => finite(note.start) && note.start >= 0);
  const validOnsets = audioOnsets.filter((onset) => finite(onset) && onset >= 0).map((onset) => round(onset)).sort((a, b) => a - b);
  const mapped = noteSeconds(validNotes, safeTempo);
  const usedAudio = new Set<number>();
  const matchedNoteIndexes: number[] = [];
  for (const [noteIndex, second] of mapped.entries()) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [audioIndex, onset] of validOnsets.entries()) {
      if (usedAudio.has(audioIndex)) continue;
      const distance = Math.abs(onset - second);
      if (distance <= safeTolerance && (distance < bestDistance || (distance === bestDistance && (bestIndex < 0 || audioIndex < bestIndex)))) {
        bestIndex = audioIndex;
        bestDistance = distance;
      }
    }
    if (bestIndex >= 0) {
      usedAudio.add(bestIndex);
      matchedNoteIndexes.push(noteIndex);
    }
  }
  const matchedNotes = matchedNoteIndexes.map((index) => mapped[index]!);
  const matchedAudio = [...usedAudio].sort((a, b) => a - b).map((index) => validOnsets[index]!);
  const secondsPerBeat = 60 / safeTempo;
  const first = mapped.length ? Math.min(...mapped) : null;
  const last = mapped.length ? Math.max(...mapped) : null;
  const durationBeats = validNotes.length ? Math.max(...validNotes.map((note) => note.start + Math.max(0, note.dur)), 0) : 0;
  return {
    noteCount: validNotes.length,
    audioOnsetCount: validOnsets.length,
    matchedNoteCount: matchedNotes.length,
    unmatchedNoteCount: validNotes.length - matchedNotes.length,
    matchedAudioOnsetCount: matchedAudio.length,
    naive: {
      tempoBpm: round(safeTempo),
      secondsPerBeat: round(secondsPerBeat),
      durationBeats: round(durationBeats),
      durationSeconds: round(durationBeats * secondsPerBeat),
      onsetCount: noteOnsetCount(validNotes),
      firstNoteSeconds: first === null ? null : round(first),
      lastNoteSeconds: last === null ? null : round(last),
    },
    production: {
      matchToleranceSeconds: round(safeTolerance),
      matchedNoteRatio: validNotes.length ? round(matchedNotes.length / validNotes.length) : 0,
      matchedAudioOnsetRatio: validOnsets.length ? round(matchedAudio.length / validOnsets.length) : 0,
    },
  };
}

async function runProductionOnsets(audioPath: string, python = DEFAULT_PYTHON): Promise<readonly number[]> {
  const result = await execFileP(python, [ONSET_SCRIPT, audioPath], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("audio onset detector returned invalid JSON");
  }
  if (!Array.isArray(parsed) || parsed.some((value) => !finite(value) || value < 0)) {
    throw new Error("audio onset detector returned invalid onset values");
  }
  return parsed as number[];
}

function trackNotes(adapter: Awaited<ReturnType<typeof adaptShadowCorpusMidiFile>>): ShadowTrackInput[] {
  const byTrack = new Map<number, Note[]>();
  for (const note of adapter.notes) {
    const notes = byTrack.get(note.trackIndex) ?? [];
    notes.push({ midi: note.midi, start: note.startBeats, dur: Math.max(0.01, note.durationBeats), vel: note.velocity });
    byTrack.set(note.trackIndex, notes);
  }
  return adapter.tracks.map((track: ShadowCorpusTrackSummary) => ({
    id: track.id,
    name: track.name,
    role: track.role,
    instrumentClass: track.instrumentClass,
    percussion: track.percussion,
    notes: byTrack.get(track.index) ?? [],
  }));
}

function evaluationMedia(value: ShadowCorpusItem["symbolic"]): NonNullable<ShadowCorpusItemInput["symbolic"]> {
  return {
    status: value.status,
    ...(value.sha256 ? { sha256: value.sha256 } : {}),
    ...(value.byteLength !== null ? { byteLength: value.byteLength } : {}),
    ...(value.logicalRef ? { logicalRef: value.logicalRef } : {}),
  };
}

function shadowItemInput(adapter: ShadowCorpusItem, parsed: Awaited<ReturnType<typeof adaptShadowCorpusMidiFile>>, sourceRef: string): ShadowCorpusItemInput {
  const guitarNotes = parsed.parsed.notes.map((note) => ({ ...note, identitySource: "guitar" as const }));
  const guitarParsed = { ...parsed.parsed, notes: guitarNotes };
  return {
    id: adapter.id,
    label: adapter.title ?? adapter.id,
    corpus: adapter.corpus,
    datasetVersion: adapter.datasetVersion,
    license: adapter.license,
    sourceRecord: adapter.sourceRecord ?? sourceRef,
    alignment: { status: "not-attempted", source: sourceRef },
    symbolic: { ...evaluationMedia(adapter.symbolic), parsed: guitarParsed, notes: guitarNotes },
    audio: evaluationMedia(adapter.audio),
    parsedMidi: guitarParsed,
    notes: guitarNotes,
  };
}

function shadowAlignmentStatus(alignment: AudioSymbolicAlignmentResult): string {
  return alignment.status;
}

function pureEvaluationSummary(value: ReturnType<typeof evaluateShadowCorpus>): RealShadowPairReport["shadow"]["pureEvaluation"] {
  const item = value.items[0];
  return {
    status: value.status,
    summary: value.summary,
    failures: [...value.failures].sort(),
    item: {
      status: item?.status ?? null,
      failures: item ? [...item.failures].sort() : [],
      warnings: item ? [...item.warnings].sort() : [],
      determinism: item?.determinism.canonicalSha256 ?? null,
    },
    determinism: value.determinism.canonicalSha256,
  };
}

function timingAlignmentSummary(
  value: ReturnType<typeof evaluateAudioSymbolicAlignment>,
  evidence: RealShadowPairReport["timing"]["audioSymbolicAlignment"]["evidence"],
): RealShadowPairReport["timing"]["audioSymbolicAlignment"] {
  const comparison = (entry: typeof value.production): { method: string; confidence: number; metrics: Record<string, unknown> } | null => {
    if (!entry) return null;
    return {
      method: entry.mapping.method,
      confidence: entry.confidence,
      metrics: {
        audioOnsetCount: entry.metrics.audioOnsetCount,
        symbolicOnsetCount: entry.metrics.symbolicOnsetCount,
        matchedOnsets: entry.metrics.matchedOnsets,
        precision: entry.metrics.precision,
        recall: entry.metrics.recall,
        f1: entry.metrics.f1,
        errorBeats: entry.metrics.errorBeats,
        errorSeconds: entry.metrics.errorSeconds,
        coverage: entry.metrics.coverage,
      },
    };
  };
  return {
    evidence,
    status: value.status,
    confidence: value.confidence,
    naive: comparison(value.naive),
    production: comparison(value.production),
    diagnostics: [...value.diagnostics].map(redactText).sort(),
    config: value.config,
  };
}

type DownstreamArtifactStatus = "validated" | "invalid";

interface DownstreamArtifactSummary {
  status: DownstreamArtifactStatus;
  byteLength: number | null;
  sha256: string | null;
  roundTripNoteCount: number | null;
  roundTripDurationBeats: number | null;
  issues: string[];
}

interface DownstreamPhysicalVariantSummary {
  level: DifficultyLevel;
  noteCount: number;
  difficultyScore: number;
  midi: DownstreamArtifactSummary;
  musicXml: DownstreamArtifactSummary;
}

interface DownstreamPublicLevelSummary {
  level: PublicDifficultyLevel;
  sourcePhysicalLevel: DifficultyLevel;
  noteCount: number;
  difficultyScore: number;
}

interface DownstreamProductPathSummary {
  status: "validated" | "blocked";
  arrangement: {
    status: "built" | "blocked";
    stemCount: number;
    noteCount: number;
    durationBeats: number | null;
    tempoBpm: number | null;
    warningCount: number;
    error: string | null;
  };
  physicalVariantCount: number;
  physicalVariants: DownstreamPhysicalVariantSummary[];
  variantValidationErrors: string[];
  publicProjection: {
    status: "complete" | "blocked";
    method: "projectPublicSongRows";
    expectedLevelCount: 5;
    levels: DownstreamPublicLevelSummary[];
    hiddenPhysicalLevels: DifficultyLevel[];
  };
  catalog: {
    status: "validated" | "blocked";
    groupedSongCount: number;
    publicGroupedSongCount: number;
    publicLevelCount: number;
    representativeLevel: PublicDifficultyLevel | null;
  };
  player: {
    status: "NOT_EXERCISED";
    reason: string;
  };
  blockers: string[];
}

function downstreamArtifact(
  variant: Variant,
  title: string,
  artist: string,
  kind: "midi" | "musicXml",
): DownstreamArtifactSummary {
  try {
    const artifacts = writeVariantArtifacts(variant, title, artist);
    const bytes = kind === "midi"
      ? artifacts.midi
      : new TextEncoder().encode(artifacts.xml);
    const issues = validateArtifactFiles(variant, artifacts).map(redactText);
    let roundTrip: ParsedMidi | null = null;
    try {
      roundTrip = kind === "midi"
        ? parseMidi(artifacts.midi)
        : parseMusicXmlNotes(artifacts.xml);
    } catch {
      // validateArtifactFiles carries the parser failure and remains the
      // single fail-closed validation result for the artifact pair.
    }
    return {
      status: issues.length ? "invalid" : "validated",
      byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes),
      roundTripNoteCount: roundTrip?.notes.length ?? null,
      roundTripDurationBeats: roundTrip ? round(roundTrip.durationBeats) : null,
      issues: [...new Set(issues)].sort(),
    };
  } catch (error) {
    return {
      status: "invalid",
      byteLength: null,
      sha256: null,
      roundTripNoteCount: null,
      roundTripDurationBeats: null,
      issues: [redactText(error)],
    };
  }
}

function downstreamSongRow(variant: Variant, title: string, artist: string): SongRow {
  const durationBeats = variant.notes.length
    ? Math.max(...variant.notes.map((note) => note.start + note.dur))
    : 0;
  return {
    id: `shadow-${variant.level}`,
    baseId: "shadow-real-pair",
    title,
    artist,
    category: "Shadow evaluation",
    difficulty: variant.level,
    difficultyScore: variant.difficultyScore,
    key: variant.key,
    tempo: variant.tempoBpm,
    style: "metal",
    mood: "diagnostic",
    bassPattern: variant.bassPattern,
    duration: Math.round((durationBeats * 60) / Math.max(variant.tempoBpm, 1)),
    contentType: "shadow",
    acquiredVia: "guitar-techs",
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays: 0,
    level: variant.level,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

/**
 * Run the product-facing pure path without touching catalog storage.  The
 * symbolic pair remains shadow truth: this deliberately reports generated
 * artifact readiness, not production publication eligibility.
 */
function downstreamProductPath(item: ShadowCorpusItemInput): DownstreamProductPathSummary {
  const title = text(item.label, item.id, 120) ?? item.id;
  const converted = shadowItemToMetalStems(item);
  if (!converted.stems.length) {
    const blockers = [...converted.failures, "no role-tagged symbolic stems are available"].map(redactText);
    return {
      status: "blocked",
      arrangement: {
        status: "blocked",
        stemCount: 0,
        noteCount: 0,
        durationBeats: null,
        tempoBpm: null,
        warningCount: 0,
        error: blockers[0] ?? "no role-tagged symbolic stems are available",
      },
      physicalVariantCount: 0,
      physicalVariants: [],
      variantValidationErrors: [],
      publicProjection: {
        status: "blocked",
        method: "projectPublicSongRows",
        expectedLevelCount: 5,
        levels: [],
        hiddenPhysicalLevels: [],
      },
      catalog: {
        status: "blocked",
        groupedSongCount: 0,
        publicGroupedSongCount: 0,
        publicLevelCount: 0,
        representativeLevel: null,
      },
      player: {
        status: "NOT_EXERCISED",
        reason: "no arrangement was available for a side-effect-free player-link exercise",
      },
      blockers: [...new Set(blockers)],
    };
  }

  let arrangement;
  let variants: Variant[] = [];
  let arrangementError: string | null = null;
  try {
    arrangement = buildMetalArrangement({ stems: converted.stems, title });
    variants = buildVariants(arrangement.parsed, {
      title,
      artist: "shadow-corpus",
      style: "metal",
      tempo: arrangement.parsed.tempoBpm,
    }, {
      arrangementProfile: "metal",
      audioDerived: false,
      maxDurBeats: null,
    });
  } catch (error) {
    arrangementError = redactText(error);
  }

  const arrangementSummary: DownstreamProductPathSummary["arrangement"] = arrangement
    ? {
      status: "built",
      stemCount: converted.stems.length,
      noteCount: arrangement.parsed.notes.length,
      durationBeats: round(arrangement.parsed.durationBeats),
      tempoBpm: round(arrangement.parsed.tempoBpm),
      warningCount: arrangement.warnings.length,
      error: null,
    }
    : {
      status: "blocked",
      stemCount: converted.stems.length,
      noteCount: 0,
      durationBeats: null,
      tempoBpm: null,
      warningCount: 0,
      error: arrangementError,
    };
  if (!arrangement) {
    return {
      status: "blocked",
      arrangement: arrangementSummary,
      physicalVariantCount: 0,
      physicalVariants: [],
      variantValidationErrors: [],
      publicProjection: {
        status: "blocked",
        method: "projectPublicSongRows",
        expectedLevelCount: 5,
        levels: [],
        hiddenPhysicalLevels: [],
      },
      catalog: {
        status: "blocked",
        groupedSongCount: 0,
        publicGroupedSongCount: 0,
        publicLevelCount: 0,
        representativeLevel: null,
      },
      player: {
        status: "NOT_EXERCISED",
        reason: "arrangement failure prevented a side-effect-free player-link exercise",
      },
      blockers: [arrangementError ?? "shadow arrangement failed"],
    };
  }

  const variantValidationErrors = [...new Set(validateVariants(variants, { maxDurBeats: null }).map(redactText))].sort();
  const physicalVariants = variants.map((variant): DownstreamPhysicalVariantSummary => ({
    level: variant.level,
    noteCount: variant.notes.length,
    difficultyScore: round(variant.difficultyScore),
    midi: downstreamArtifact(variant, title, "shadow-corpus", "midi"),
    musicXml: downstreamArtifact(variant, title, "shadow-corpus", "musicXml"),
  }));
  const physicalRows = variants.map((variant) => downstreamSongRow(variant, title, "shadow-corpus"));
  const projectedRows = projectPublicSongRows(physicalRows);
  const groupedSongs = groupSongs(physicalRows);
  const publicGroupedSongs = projectPublicGroupedSongs(groupedSongs);
  const byLevel = new Map(variants.map((variant) => [variant.level, variant]));
  const publicLevels = projectedRows.flatMap((row): DownstreamPublicLevelSummary[] => {
    const physicalLevel = row.difficulty as DifficultyLevel;
    const variant = byLevel.get(physicalLevel);
    if (!variant || !isDifficultyLevel(physicalLevel)) return [];
    return [{
      level: physicalLevel as PublicDifficultyLevel,
      sourcePhysicalLevel: physicalLevel,
      noteCount: variant.notes.length,
      difficultyScore: round(variant.difficultyScore),
    }];
  });
  const hiddenPhysicalLevels = variants
    .map((variant) => variant.level)
    .filter((level) => !projectedRows.some((row) => row.difficulty === level));
  const artifactIssues = physicalVariants.flatMap((variant) => [
    ...variant.midi.issues.map((issue) => `${variant.level} MIDI: ${issue}`),
    ...variant.musicXml.issues.map((issue) => `${variant.level} MusicXML: ${issue}`),
  ]);
  const publicProjectionStatus = publicLevels.length === 5 ? "complete" : "blocked";
  const catalogStatus = groupedSongs.length === 1
    && publicGroupedSongs.length === 1
    && publicGroupedSongs[0]?.levels.length === 5
    ? "validated"
    : "blocked";
  const blockers = [
    ...converted.failures,
    ...(variants.length !== 6 ? [`expected six physical variants, received ${variants.length}`] : []),
    ...variantValidationErrors.map((issue) => `variant validation: ${issue}`),
    ...artifactIssues,
    ...(publicProjectionStatus === "blocked" ? [`public projection returned ${publicLevels.length} of 5 levels`] : []),
    ...(catalogStatus === "blocked" ? ["catalog grouping/public grouped projection was incomplete"] : []),
  ].map(redactText);
  return {
    status: blockers.length ? "blocked" : "validated",
    arrangement: arrangementSummary,
    physicalVariantCount: variants.length,
    physicalVariants,
    variantValidationErrors,
    publicProjection: {
      status: publicProjectionStatus,
      method: "projectPublicSongRows",
      expectedLevelCount: 5,
      levels: publicLevels,
      hiddenPhysicalLevels: [...hiddenPhysicalLevels],
    },
    catalog: {
      status: catalogStatus,
      groupedSongCount: groupedSongs.length,
      publicGroupedSongCount: publicGroupedSongs.length,
      publicLevelCount: publicGroupedSongs[0]?.levels.length ?? 0,
      representativeLevel: (publicGroupedSongs[0]?.representative.level as PublicDifficultyLevel | undefined) ?? null,
    },
    player: {
      status: "NOT_EXERCISED",
      reason: "player entry-link resolution requires a persisted catalog item; this shadow path performs no catalog writes",
    },
    blockers: [...new Set(blockers)].sort(),
  };
}

function isDifficultyLevel(value: string): value is DifficultyLevel {
  return ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"].includes(value);
}

function manifestNumber(value: unknown, key: string): number | null {
  return numberOrNull(recordObject(value)[key]);
}

export async function evaluateRealShadowPair(options: RealShadowPairOptions): Promise<RealShadowPairReport> {
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const manifestPath = await regularFile(options.manifest, "manifest", repositoryRoot);
  const parsedManifest = manifestData(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  const item = manifestItem(parsedManifest, options.itemId);
  const paths = resolvePairPaths(options, item, manifestPath);
  const truthRead = await boundedRead(paths.truth, "truth MIDI", repositoryRoot, options.allowedRoot);
  const audioRead = await boundedRead(paths.audio, "DI audio", repositoryRoot, options.allowedRoot);
  const dataset = manifestDataset(parsedManifest);
  const datasetName = text(dataset.name, "Guitar-TECHS") ?? "Guitar-TECHS";
  const datasetVersion = text(dataset.version, "unknown") ?? "unknown";
  const recordId = text(dataset.record, null);
  const recordUrl = logicalUrl(dataset.recordUrl);
  const sourceUrl = logicalUrl(dataset.sourceUrl);
  const paperUrl = logicalUrl(dataset.paperUrl);
  const license = datasetLicense(dataset.license);
  const itemId = logicalId(item.id, options.itemId);
  const sourceRef = `guitar-techs:${itemId}`;
  const truthMetadata = recordObject(item.truthMetadata);
  const localAdapterOptions: ShadowCorpusAdapterPathOptions = {
    repositoryRoot,
    ...(options.allowedRoot ? { allowedRoot: options.allowedRoot } : {}),
  };
  const parsedMidi = await adaptShadowCorpusMidiFile(truthRead.path, { ...localAdapterOptions, logicalRef: `${sourceRef}:symbolic` });
  const adapter = await buildShadowCorpusItem({
    id: itemId,
    corpus: datasetName,
    datasetVersion,
    license: license.label,
    sourceRecord: { provider: datasetName, recordId, dataset: datasetName, url: recordUrl },
    logicalRef: `${sourceRef}:symbolic`,
    symbolicPath: truthRead.path,
    audioPath: audioRead.path,
  }, localAdapterOptions);
  const intake = await ingestExternalSymbolicCandidate({
    id: itemId,
    filePath: truthRead.path,
    format: "midi",
    title: itemId,
    provider: datasetName,
    version: datasetVersion,
    sourceRef,
    sourcePage: recordUrl,
    purpose: "SHADOW_GENERATION_TRUTH",
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
  });
  const wave = waveMetadata(audioRead.bytes);
  const onsetRunner = options.onsetRunner ?? ((path: string) => runProductionOnsets(path, options.python ?? DEFAULT_PYTHON));
  let onsetValues: readonly number[] | null = null;
  let onsetError: string | null = null;
  try {
    onsetValues = [...await onsetRunner(audioRead.path)]
      .filter((value) => finite(value) && value >= 0)
      .map((value) => round(value))
      .sort((a, b) => a - b);
  } catch (error) {
    onsetError = redactText(error);
  }
  const suppliedTimingEvidence = alignmentEvidence(item, options);
  const hasIndependentTimingEvidence = Boolean(
    (suppliedTimingEvidence.anchors?.length ?? 0) >= 2
      || (finite(suppliedTimingEvidence.secondsPerBeat) && suppliedTimingEvidence.secondsPerBeat > 0),
  );
  // Guitar-TECHS pairs ship a real DI recording and a truth MIDI but no
  // annotated beat anchors.  A duration-derived map is useful as a bounded
  // shadow timing probe; it is deliberately reported as such and cannot
  // upgrade the mission's real-alignment decision by itself.
  const durationDerivedSecondsPerBeat = !hasIndependentTimingEvidence
    && finite(wave.durationSeconds) && wave.durationSeconds > 0
    && parsedMidi.durationBeats > 0
    ? wave.durationSeconds / parsedMidi.durationBeats
    : null;
  const timingEvidence = hasIndependentTimingEvidence || durationDerivedSecondsPerBeat === null
    ? suppliedTimingEvidence
    : { ...suppliedTimingEvidence, secondsPerBeat: durationDerivedSecondsPerBeat, beatZeroAudioSeconds: 0 };
  const durationDerivedUntrusted = durationDerivedSecondsPerBeat !== null && !hasIndependentTimingEvidence;
  const alignment = evaluateAudioSymbolicAlignment({
    symbolicNotes: parsedMidi.parsed.notes,
    audioOnsetSeconds: onsetValues ?? [],
    tempoBpm: parsedMidi.parsed.tempoBpm,
    ...timingEvidence,
  });
  const shadowInput = shadowItemInput(adapter, parsedMidi, sourceRef);
  const shadowManifest: ShadowCorpusManifestInput = {
    schemaVersion: 1,
    corpus: datasetName,
    datasetVersion,
    license: license.label,
    sourceRecord: { provider: datasetName, recordId, dataset: datasetName, url: recordUrl },
    items: [{
      ...shadowInput,
      alignment: {
        status: durationDerivedUntrusted ? "insufficient-evidence" : shadowAlignmentStatus(alignment),
        source: sourceRef,
        reason: alignment.diagnostics.join("; ") || null,
      },
    }],
  };
  const pureEvaluation = evaluateShadowCorpus(shadowManifest);
  const downstream = downstreamProductPath(shadowInput);
  const comparison = compareRealShadowOnsets(parsedMidi.parsed.notes, parsedMidi.parsed.tempoBpm, onsetValues ?? []);
  const detectorStatus: DetectorStatus = onsetValues ? "parsed" : "unavailable";
  const itemManifestTruth = {
    tempoBpm: manifestNumber(item.truthMetadata, "tempoBpm"),
    durationBeats: manifestNumber(item.truthMetadata, "durationBeats"),
    noteCount: manifestNumber(item.truthMetadata, "noteCount"),
  };
  const blockers = [
    ...(durationDerivedUntrusted
      ? ["duration-derived audio seconds-per-beat is a diagnostic only; independent timing evidence is required"]
      : []),
    ...(alignment.status !== "aligned"
      ? [`independent audio-symbolic alignment ${alignment.status}: ${alignment.diagnostics.join("; ")}`]
      : []),
    ...(onsetError ? [`production onset detector unavailable: ${onsetError}`] : []),
    ...(pureEvaluation.items[0]?.failures.filter((failure) => !/alignment status is not-attempted/i.test(failure)) ?? []),
    ...downstream.blockers.map((blocker) => `downstream product path: ${blocker}`),
  ].map(redactText).filter((value, index, values) => values.indexOf(value) === index);
  const reportWithoutDeterminism: Omit<RealShadowPairReport, "determinism"> = {
    schemaVersion: REAL_SHADOW_PAIR_SCHEMA_VERSION,
    kind: REAL_SHADOW_PAIR_KIND,
    status: blockers.length ? "blocked" : "complete",
    dataset: {
      name: datasetName,
      version: datasetVersion,
      license,
      recordId,
      recordUrl,
      sourceUrl,
      paperUrl,
    },
    item: {
      id: itemId,
      performanceId: text(item.performanceId),
      stem: text(item.stem),
      reason: text(item.reason),
      techniques: stringArray(item.techniques),
      manifestTruth: itemManifestTruth,
      parsedMidi: {
        tempoBpm: round(parsedMidi.tempoBpm),
        tempoSource: parsedMidi.parsed.tempoMetaPresent ? "midi-meta" : "parser-default",
        durationBeats: round(parsedMidi.durationBeats),
        noteCount: parsedMidi.notes.length,
        title: parsedMidi.title,
      },
    },
    source: {
      symbolic: mediaSummary(adapter.symbolic, `${sourceRef}:symbolic`),
      audio: {
        ...mediaSummary(adapter.audio, `${sourceRef}:audio`),
        wave,
      },
    },
    externalIntake: {
      status: intake.status,
      format: intake.format,
      purpose: "SHADOW_GENERATION_TRUTH",
      candidateStatus: intake.candidate?.status ?? null,
      generationUsable: false,
      parser: intake.provenance?.parser.id ?? null,
      alignment: {
        status: durationDerivedUntrusted ? "insufficient-evidence" : alignment.status,
        reason: alignment.diagnostics.join("; ") || null,
      },
      rejectionReasons: [...intake.rejectionReasons].map(redactText).sort(),
      warnings: [...intake.warnings].map(redactText).sort(),
    },
    shadow: {
      adapter: {
        status: "ready",
        id: adapter.id,
        // The paired MIDI is truth/evaluation material, never a publishable
        // generation candidate.  The explicit role mapping below is only for
        // the shadow arrangement path.
        generationEligible: false,
        evaluationStatus: adapter.evaluationEligibility.status,
        evaluationEligible: adapter.evaluationEligibility.eligible,
        eligibilityReasons: [...adapter.eligibilityReasons].map(redactText).sort(),
        roleTags: ["guitar"],
        adapterRoleTags: [...adapter.roleTags].sort(),
        roleOverride: "single Guitar-TECHS DI MIDI mapped to guitar for shadow arrangement",
        noteCount: parsedMidi.notes.length,
        durationBeats: adapter.durationBeats,
        tempoBpm: adapter.tempoBpm,
      },
      pureEvaluation: pureEvaluationSummary(pureEvaluation),
      downstream,
    },
    timing: {
      alignment,
      detector: {
        status: detectorStatus,
        script: "services/transcribe/src/audio_onsets.py",
        config: AUDIO_ONSET_DETECTOR_CONFIG,
        onsetCount: onsetValues?.length ?? null,
        firstOnsetSeconds: onsetValues?.length ? onsetValues[0]! : null,
        lastOnsetSeconds: onsetValues?.length ? onsetValues.at(-1)! : null,
        error: onsetError,
      },
      naiveTempoMapping: comparison.naive,
      productionOnsetFilter: {
        ...comparison.production,
        status: detectorStatus,
        filterVersion: TRANSCRIPTION_FILTER_VERSION,
        inputKind: "truth-midi-timing-probe",
        matchedNoteCount: onsetValues ? comparison.matchedNoteCount : null,
        unmatchedNoteCount: onsetValues ? comparison.unmatchedNoteCount : null,
      },
      comparison: {
        noteCount: comparison.noteCount,
        audioOnsetCount: onsetValues ? comparison.audioOnsetCount : null,
        matchedNoteCount: onsetValues ? comparison.matchedNoteCount : null,
        unmatchedNoteCount: onsetValues ? comparison.unmatchedNoteCount : null,
        matchedAudioOnsetCount: onsetValues ? comparison.matchedAudioOnsetCount : null,
      },
      audioSymbolicAlignment: timingAlignmentSummary(
        alignment,
        options.alignment && (options.alignment.anchors?.length || options.alignment.secondsPerBeat !== undefined)
          ? "explicit-independent-timing"
          : timingEvidence.anchors?.length || timingEvidence.secondsPerBeat !== undefined
            ? durationDerivedSecondsPerBeat !== null && !hasIndependentTimingEvidence
              ? "duration-derived-audio-seconds-per-beat"
              : "manifest-independent-timing"
            : "none",
      ),
    },
    blockers,
    firstBlocker: blockers[0] ?? null,
    safety: {
      sourceBytesCopied: false,
      networkUsed: false,
      productionInvoked: false,
      reportPathRedacted: true,
      benchmarkReferencesUsed: false,
    },
  };
  const canonicalSha256 = sha256Hex(new TextEncoder().encode(stableJson(reportWithoutDeterminism)));
  return { ...reportWithoutDeterminism, determinism: { canonicalSha256 } };
}

export function canonicalRealShadowPairJson(value: RealShadowPairReport): string {
  return `${stableJson(value)}\n`;
}

async function outputPath(value: string, repositoryRoot: string): Promise<string> {
  const candidate = localArgument(value, "--out");
  if (pathInside(repositoryRoot, candidate)) throw new Error("--out must be outside the repository");
  try {
    const existing = await realpath(candidate);
    if (pathInside(repositoryRoot, existing)) throw new Error("--out must be outside the repository");
    if ((await stat(existing)).isDirectory()) throw new Error("--out must name a report file");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("--out")) throw error;
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw new Error("--out could not be inspected");
  }
  await mkdir(dirname(candidate), { recursive: true });
  const parent = await realpath(dirname(candidate));
  if (pathInside(repositoryRoot, parent)) throw new Error("--out must be outside the repository");
  return candidate;
}

export async function runRealShadowPairCli(argv: readonly string[]): Promise<number> {
  try {
    const options = parseRealShadowPairArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const report = await evaluateRealShadowPair(options);
    const output = canonicalRealShadowPairJson(report);
    if (options.out) await writeFile(await outputPath(options.out, REPOSITORY_ROOT), output, "utf8");
    process.stdout.write(output);
    return report.status === "complete" ? 0 : 1;
  } catch (error) {
    console.error(redactText(error));
    return 2;
  }
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  runRealShadowPairCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
