import {
  buildMetalArrangement,
  buildVariants,
  type MetalArrangementResult,
  type MetalStem,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import { sha256Hex } from "./fixture-evidence.js";

/**
 * The shadow evaluator deliberately uses a small, provider-neutral input
 * shape.  Task 2/3 may add a richer `ShadowCorpusItem`/adapter later; those
 * objects are structurally compatible as long as they expose `tracks` or a
 * parsed symbolic score.  No note arrays are emitted in the resulting report.
 */
export type ShadowTrackRole = "vocals" | "bass" | "guitar" | "piano" | "other" | "drums";

export interface ShadowTrackInput {
  id?: string;
  /** Optional because metadata-only corpus manifests may defer role mapping to an adapter. */
  role?: ShadowTrackRole;
  name?: string;
  instrumentClass?: string;
  class?: string;
  percussion?: boolean;
  notes?: readonly Note[];
  parsed?: ParsedMidi;
  /** Local-only adapter hint. Never appears in a report. */
  path?: string;
  confidence?: number;
}

export interface ShadowMediaInput {
  status?: string;
  sha256?: string | null;
  byteLength?: number;
  logicalRef?: string;
  /** Local-only, never serialized by this module. */
  path?: string;
  parsed?: ParsedMidi;
  notes?: readonly Note[];
}

export interface ShadowCorpusItemInput {
  id: string;
  label?: string;
  targetSongId?: string;
  alignment?: { status?: string; source?: string; reason?: string | null };
  symbolic?: ShadowMediaInput;
  audio?: ShadowMediaInput;
  tracks?: readonly ShadowTrackInput[];
  /** Convenience forms for synthetic tests and local adapters. */
  parsed?: ParsedMidi;
  parsedMidi?: ParsedMidi;
  midiMetadata?: ParsedMidi;
  notes?: readonly Note[];
  tempoBpm?: number;
  timeSig?: [number, number];
  keySig?: number;
  keyMode?: 0 | 1;
  durationBeats?: number;
  /** Adapter-specific local locator; accepted but never reported. */
  symbolicPath?: string;
  [key: string]: unknown;
}

export interface ShadowCorpusManifestInput {
  schemaVersion: number;
  /** Optional manifest defaults; item-level metadata is also accepted. */
  corpus?: string;
  datasetVersion?: string;
  license?: string | Record<string, unknown>;
  sourceRecord?: string | Record<string, unknown>;
  items: readonly ShadowCorpusItemInput[];
  [key: string]: unknown;
}

export interface ShadowRoleMetrics {
  noteCount: number;
  onsetCount: number;
  pitchMin: number | null;
  pitchMax: number | null;
}

export interface ShadowInputMetrics {
  durationBeats: number;
  roles: Record<ShadowTrackRole, ShadowRoleMetrics>;
  peakPitchedOnsetSize: number;
  drumTimingEventCount: number;
}

export interface ShadowMelodyMetrics {
  inputNoteCount: number;
  inputOnsetCount: number;
  vocalNoteCount: number;
  leadNoteCount: number;
  vocalOnsetCount: number;
  leadOnsetCount: number;
  pitchClassRecall: number | null;
  contourP95Leap: number | null;
}

export interface ShadowHarmonyMetrics {
  inputGuitarNoteCount: number;
  inputBassNoteCount: number;
  semanticRootCount: number;
  leftHandRootCount: number;
  chordEventCount: number;
  collapsedStackCount: number;
  repeatedRestrikeReduction: number;
}

export interface ShadowDrumMetrics {
  inputTimingEventCount: number;
  pitchedNoteCount: number;
  outputTimingOnly: boolean;
}

export interface ShadowTextureMetrics {
  canonicalNoteCount: number;
  canonicalOnsetCount: number;
  canonicalPeakOnsetSize: number;
  canonicalPeakSimultaneity: number;
  veryShortRate: number;
  maxRightHandLeap: number | null;
  maxLeftHandLeap: number | null;
}

export interface ShadowVariantMetrics {
  noteCount: number;
  rightHandNoteCount: number;
  leftHandNoteCount: number;
  onsetCount: number;
  difficultyScore: number;
  valid: boolean;
  failures: string[];
}

export type ShadowReadiness =
  | "SHADOW_ENGINEERING_READY"
  | "SHADOW_ENGINEERING_NOT_READY"
  | "SHADOW_ENGINEERING_BLOCKED";

export interface ShadowItemEvaluationReport {
  schemaVersion: 1;
  status: ShadowReadiness;
  fixture: { id: string; label?: string };
  provenance: {
    corpus: string;
    datasetVersion: string;
    license: string | Record<string, unknown>;
    sourceRecord: string | Record<string, unknown>;
    alignment: { status: string; source: string | null };
    symbolicStatus: string;
    audioStatus: string;
  };
  input: ShadowInputMetrics;
  output: {
    melody: ShadowMelodyMetrics;
    harmony: ShadowHarmonyMetrics;
    drums: ShadowDrumMetrics;
    texture: ShadowTextureMetrics;
  };
  variants: {
    advanced: ShadowVariantMetrics;
    medium: ShadowVariantMetrics;
    easy: ShadowVariantMetrics;
  };
  failures: string[];
  warnings: string[];
  diagnostics: {
    arrangementWarnings: string[];
    guitarHarmony: {
      rawSourceNotes: number | null;
      leadNotes: number | null;
      residualNotes: number | null;
      onsetClusterCount: number | null;
      semanticAttackCount: number | null;
      collapsedUnisonOctaveFifth: number | null;
      rejectedWeakThirds: number | null;
      bassSupportedRoots: number | null;
      stabilizedTransitions: number | null;
      emittedLeftHandEvents: number | null;
      fallbackWindows: number | null;
      qualityCounts: Record<string, number>;
    };
  };
  determinism: { canonicalSha256: string };
}

export interface ShadowCorpusEvaluationReport {
  schemaVersion: 1;
  status: ShadowReadiness;
  corpus: { id: string; datasetVersion: string; license: string | Record<string, unknown>; sourceRecord: string | Record<string, unknown> };
  selectedItemIds: string[];
  items: ShadowItemEvaluationReport[];
  summary: {
    total: number;
    ready: number;
    notReady: number;
    blocked: number;
    drumPitchViolations: number;
  };
  failures: string[];
  determinism: { canonicalSha256: string };
}

export interface ShadowEvaluationOptions {
  itemIds?: readonly string[];
  sectionBeats?: number;
  harmonyBeats?: number;
}

export interface ShadowRoleNotes {
  vocals: Note[];
  bass: Note[];
  guitar: Note[];
  piano: Note[];
  other: Note[];
  drums: Note[];
}

type RoleNotes = ShadowRoleNotes;

const ROLES: readonly ShadowTrackRole[] = ["vocals", "bass", "guitar", "piano", "other", "drums"];
const METAL_ROLES: readonly MetalStem["role"][] = ["vocals", "bass", "guitar", "other", "drums"];
const EPS = 1e-9;

function emptyRoleNotes(): RoleNotes {
  return { vocals: [], bass: [], guitar: [], piano: [], other: [], drums: [] };
}

function finiteNote(note: unknown): note is Note {
  if (!note || typeof note !== "object") return false;
  const value = note as Record<string, unknown>;
  return typeof value.midi === "number" && Number.isInteger(value.midi) && value.midi >= 0 && value.midi <= 127
    && typeof value.start === "number" && Number.isFinite(value.start) && value.start >= 0
    && typeof value.dur === "number" && Number.isFinite(value.dur) && value.dur > 0
    && typeof value.vel === "number" && Number.isFinite(value.vel) && value.vel >= 0 && value.vel <= 127;
}

function safeNotes(notes: unknown): Note[] {
  if (!Array.isArray(notes)) return [];
  return notes.filter(finiteNote).map((note) => ({ ...note }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeItem(value: unknown, fallbackId: string): ShadowCorpusItemInput {
  if (!isRecord(value)) return { id: fallbackId };
  const id = typeof value.id === "string" && value.id.trim() ? value.id : fallbackId;
  const copy = { ...value, id } as Record<string, unknown>;
  if (copy.label !== undefined && typeof copy.label !== "string") delete copy.label;
  return copy as ShadowCorpusItemInput;
}

/**
 * Validate the runtime shape before role extraction.  The public API is
 * typed, but manifest/CLI callers commonly pass JSON and can therefore hand
 * us nulls, objects where arrays are expected, or malformed track entries.
 * Such input must become a blocked report rather than an evaluator throw.
 */
function shadowItemShapeFailures(value: unknown): string[] {
  if (!isRecord(value)) return ["shadow item must be an object"];
  const failures: string[] = [];
  if (typeof value.id !== "string" || !value.id.trim()) failures.push("shadow item id must be a non-empty string");
  if (value.label !== undefined && value.label !== null && typeof value.label !== "string") {
    failures.push("shadow item label must be a string");
  }
  if (value.notes !== undefined && !Array.isArray(value.notes)) {
    failures.push("shadow item notes must be an array");
  }
  if (value.tracks !== undefined && !Array.isArray(value.tracks)) {
    failures.push("shadow item tracks must be an array");
  }
  if (Array.isArray(value.tracks)) {
    for (const [index, track] of value.tracks.entries()) {
      if (!isRecord(track)) {
        failures.push(`shadow track ${index} must be an object`);
        continue;
      }
      for (const field of ["notes", "parsed"] as const) {
        if (track[field] !== undefined
          && field === "notes" && !Array.isArray(track[field])) {
          failures.push(`shadow track ${index} notes must be an array`);
        }
        if (track[field] !== undefined
          && field === "parsed" && !isRecord(track[field])) {
          failures.push(`shadow track ${index} parsed metadata must be an object`);
        }
      }
    }
  }
  for (const field of ["parsed", "parsedMidi", "midiMetadata"] as const) {
    if (value[field] !== undefined && !isRecord(value[field])) {
      failures.push(`shadow item ${field} metadata must be an object`);
    }
  }
  if (value.symbolic !== undefined && !isRecord(value.symbolic)) {
    failures.push("shadow symbolic metadata must be an object");
  }
  if (value.audio !== undefined && !isRecord(value.audio)) {
    failures.push("shadow audio metadata must be an object");
  }
  if (value.alignment !== undefined && !isRecord(value.alignment)) {
    failures.push("shadow alignment metadata must be an object");
  }
  return failures;
}

function noteSort(a: Note, b: Note): number {
  return a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || compareText(a.identitySource ?? "", b.identitySource ?? "");
}

function parsedFromNotes(notes: readonly Note[], reference?: ParsedMidi, title?: string): ParsedMidi {
  const valid = safeNotes(notes).sort(noteSort);
  const duration = Math.max(
    reference && Number.isFinite(reference.durationBeats) ? reference.durationBeats : 0,
    ...valid.map((note) => note.start + note.dur),
    1,
  );
  return {
    format: reference?.format ?? 1,
    division: reference?.division ?? 480,
    tempoBpm: reference?.tempoBpm && Number.isFinite(reference.tempoBpm) ? reference.tempoBpm : 120,
    tempoMetaPresent: reference?.tempoMetaPresent ?? true,
    keySig: reference?.keySig ?? 0,
    keyMode: reference?.keyMode ?? 0,
    timeSig: reference?.timeSig ?? [4, 4],
    notes: valid,
    trackNames: reference?.trackNames ?? [],
    durationBeats: duration,
    ...(title ? { title } : reference?.title ? { title: reference.title } : {}),
  };
}

function notesFromTrack(track: ShadowTrackInput): Note[] {
  if (!track || typeof track !== "object" || Array.isArray(track)) return [];
  if (Array.isArray(track.notes)) return safeNotes(track.notes);
  return safeNotes(track.parsed?.notes);
}

function normalizedTrackRole(track: ShadowTrackInput): keyof RoleNotes | undefined {
  if (!track || typeof track !== "object" || Array.isArray(track)) return undefined;
  const candidate = typeof track.role === "string" && track.role.trim()
    ? track.role.trim().toLowerCase()
    : typeof track.instrumentClass === "string" && track.instrumentClass.trim()
      ? track.instrumentClass.trim().toLowerCase()
      : typeof track.class === "string" && track.class.trim()
        ? track.class.trim().toLowerCase()
        : track.percussion ? "drums" : undefined;
  if (!candidate) return undefined;
  if (candidate === "vocal" || candidate === "voice" || candidate === "melody") return "vocals";
  if (candidate === "bass-root" || candidate === "bassroot") return "bass";
  if (candidate === "lead" || candidate === "riff") return "guitar";
  if (candidate === "harmony") return "other";
  if (ROLES.includes(candidate as ShadowTrackRole)) return candidate as keyof RoleNotes;
  return undefined;
}

function roleNotesForItem(item: ShadowCorpusItemInput): { roles: RoleNotes; reference: ParsedMidi | undefined; failures: string[] } {
  const roles = emptyRoleNotes();
  const failures: string[] = [];
  const tracks = Array.isArray(item.tracks) ? item.tracks : [];
  let reference = item.parsed ?? item.parsedMidi ?? item.midiMetadata ?? item.symbolic?.parsed;
  for (const track of tracks) {
    if (!track || typeof track !== "object" || Array.isArray(track)) {
      failures.push("invalid shadow track role");
      continue;
    }
    const role = normalizedTrackRole(track);
    if (!role) {
      failures.push("invalid shadow track role");
      continue;
    }
    const notes = notesFromTrack(track);
    if (track.parsed && !reference) reference = track.parsed;
    roles[role].push(...notes);
  }
  if (!tracks.length) {
    const flat = Array.isArray(item.notes) ? safeNotes(item.notes) : safeNotes(reference?.notes ?? item.symbolic?.notes);
    // A flat score is an explicit fallback, not a reason to guess that every
    // note is guitar. Use carried source labels when available and keep
    // unlabelled notes as piano/other evidence.
    for (const note of flat) {
      if (note.identitySource === "vocals") roles.vocals.push(note);
      else if (note.identitySource === "guitar") roles.guitar.push(note);
      else if (note.identitySource === "other") roles.other.push(note);
      else roles.piano.push(note);
    }
  }
  return { roles, reference, failures };
}

function mergedRoleParsed(role: ShadowTrackRole, notes: readonly Note[], reference?: ParsedMidi, title?: string): ParsedMidi {
  const identitySource: Note["identitySource"] = role === "vocals"
    ? "vocals"
    : role === "guitar"
      ? "guitar"
      : role === "other" || role === "piano"
        ? "other"
        : undefined;
  return parsedFromNotes(notes.map((note) => ({ ...note, ...(identitySource ? { identitySource } : {}) })), reference, title);
}

/**
 * Convert role-tagged shadow tracks to the five semantic stem lanes accepted
 * by the metal arranger. Piano and unclassified pitched tracks are retained
 * as residual `other`; drum notes remain present only in the timing lane and
 * the arranger will never emit them as piano pitches.
 */
export function shadowItemToMetalStems(item: ShadowCorpusItemInput): { stems: MetalStem[]; input: ShadowRoleNotes; reference?: ParsedMidi; failures: string[] } {
  const extracted = roleNotesForItem(item);
  const stems: MetalStem[] = [];
  for (const role of METAL_ROLES) {
    const sourceNotes = role === "other"
      ? [...extracted.roles.other, ...extracted.roles.piano]
      : extracted.roles[role];
    if (!sourceNotes.length) continue;
    const parsed = mergedRoleParsed(role, sourceNotes, extracted.reference, item.label ?? item.id);
    stems.push({ role, midi: parsed, confidence: role === "drums" ? 1 : 0.9 });
  }
  return { stems, input: extracted.roles, reference: extracted.reference, failures: extracted.failures };
}

function onsetStarts(notes: readonly Note[], tolerance = 0.08): number[] {
  const starts: number[] = [];
  for (const note of [...notes].filter(finiteNote).sort(noteSort)) {
    if (!starts.length || note.start - starts[starts.length - 1]! > tolerance + EPS) starts.push(note.start);
  }
  return starts;
}

function onsetGroups(notes: readonly Note[], tolerance = 0.08): Note[][] {
  const groups: Note[][] = [];
  for (const note of [...notes].filter(finiteNote).sort(noteSort)) {
    const current = groups.at(-1);
    const latest = current?.at(-1);
    if (!current || !latest || note.start - latest.start > tolerance + EPS) groups.push([note]);
    else current.push(note);
  }
  return groups;
}

function roleMetrics(notes: readonly Note[]): ShadowRoleMetrics {
  const valid = notes.filter(finiteNote);
  return {
    noteCount: valid.length,
    onsetCount: onsetGroups(valid).length,
    pitchMin: valid.length ? Math.min(...valid.map((note) => note.midi)) : null,
    pitchMax: valid.length ? Math.max(...valid.map((note) => note.midi)) : null,
  };
}

function peakOnsetSize(notes: readonly Note[]): number {
  return Math.max(0, ...onsetGroups(notes).map((group) => group.length));
}

function peakSimultaneity(notes: readonly Note[]): number {
  const events = notes.filter(finiteNote).flatMap((note) => [
    { time: note.start, delta: 1 },
    { time: note.start + note.dur, delta: -1 },
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let sounding = 0;
  let max = 0;
  for (const event of events) {
    sounding += event.delta;
    max = Math.max(max, sounding);
  }
  return max;
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function contourP95(notes: readonly Note[]): number | null {
  const groups = onsetGroups(notes).map((group) => Math.max(...group.map((note) => note.midi)));
  const values = groups.slice(1).map((pitch, index) => Math.abs(pitch - groups[index]!)).sort((a, b) => a - b);
  if (!values.length) return null;
  const position = (values.length - 1) * 0.95;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return Math.round((values[low]! + (values[high]! - values[low]!) * (position - low)) * 1000) / 1000;
}

function maxLeap(notes: readonly Note[], hand: "R" | "L"): number | null {
  const groups = onsetGroups(notes.filter((note) => (note.hand === "L" ? "L" : "R") === hand));
  const pitches = groups.map((group) => hand === "L" ? Math.min(...group.map((note) => note.midi)) : Math.max(...group.map((note) => note.midi)));
  if (pitches.length < 2) return null;
  return Math.max(...pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!)));
}

function canonicalQualityCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, count]) => typeof count === "number" && Number.isFinite(count)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function diagnosticsOf(arrangement: MetalArrangementResult): ShadowItemEvaluationReport["diagnostics"]["guitarHarmony"] {
  const source = arrangement.stats.guitarHarmony;
  return {
    rawSourceNotes: numberOrNull(source?.rawSourceNotes),
    leadNotes: numberOrNull(source?.leadNotes),
    residualNotes: numberOrNull(source?.residualNotes),
    onsetClusterCount: numberOrNull(source?.onsetClusterCount),
    semanticAttackCount: numberOrNull(source?.semanticAttackCount),
    collapsedUnisonOctaveFifth: numberOrNull(source?.collapsedUnisonOctaveFifth),
    rejectedWeakThirds: numberOrNull(source?.rejectedWeakThirds),
    bassSupportedRoots: numberOrNull(source?.bassSupportedRoots),
    stabilizedTransitions: numberOrNull(source?.stabilizedTransitions),
    emittedLeftHandEvents: numberOrNull(source?.emittedLeftHandEvents),
    fallbackWindows: numberOrNull(source?.fallbackWindows),
    qualityCounts: canonicalQualityCounts(source?.qualityCounts),
  };
}

function variantMetric(variant: Variant | undefined, fallback = "missing"): ShadowVariantMetrics {
  if (!variant) return { noteCount: 0, rightHandNoteCount: 0, leftHandNoteCount: 0, onsetCount: 0, difficultyScore: 0, valid: false, failures: [fallback] };
  const notes = Array.isArray(variant.notes) ? variant.notes.filter(finiteNote) : [];
  const failures: string[] = [];
  if (notes.length < 8) failures.push(`${variant.level}: fewer than 8 notes`);
  if (!Number.isFinite(variant.difficultyScore)) failures.push(`${variant.level}: invalid difficulty score`);
  if (!Number.isFinite(variant.tempoBpm) || variant.tempoBpm <= 0) failures.push(`${variant.level}: invalid tempo`);
  return {
    noteCount: notes.length,
    rightHandNoteCount: notes.filter((note) => note.hand !== "L").length,
    leftHandNoteCount: notes.filter((note) => note.hand === "L").length,
    onsetCount: onsetGroups(notes).length,
    difficultyScore: Number.isFinite(variant.difficultyScore) ? variant.difficultyScore : 0,
    valid: failures.length === 0,
    failures,
  };
}

function variantsByRequiredLevel(variants: readonly Variant[]): { advanced?: Variant; medium?: Variant; easy?: Variant } {
  return {
    advanced: variants.find((variant) => variant.level === "advanced"),
    medium: variants.find((variant) => variant.level === "medium"),
    easy: variants.find((variant) => variant.level === "easy"),
  };
}

const PATH_KEY = /(?:^|[_-])(?:absolute|physical|local|source)?path$|(?:^|[_-])(?:file|filename|locator|artifact|source)(?:ref|path|name)?$/i;
const ABSOLUTE_PATH = /(?:file:\/\/|(?:^|[\s("'=,;\[\]])\/(?:Users|private|tmp|var|home|Volumes|opt|etc|System|Applications|root|mnt|workspace|data|srv)(?:[\\/]|$)|(?:^|[\s("'=,;\[\]])[A-Za-z]:[\\/]|(?:^|[\s("'=,;\[\]])\\\\)/i;
const RELATIVE_FILE = /(?:^|[\s("'=,;\[\]])(?:\.\.?[\\/]|(?:[A-Za-z0-9._-]+[\\/]){2,})[^\s"'<>;,)]*\.(?:mid|midi|wav|mp3|json|xml|mxl|txt|csv|log)(?=$|[\s"'<>;,\)])/i;

/**
 * Strings in provenance and failure messages are not assumed to be logical
 * identifiers.  Redact the complete field when it contains a local path so
 * a path with spaces cannot leak a suffix after a token-level replacement.
 * Known relative artifact names are treated the same way; ordinary labels
 * such as `synthetic:shadow` remain intact.
 */
function redactPathText(value: string): string {
  const trimmed = value.trim();
  if (ABSOLUTE_PATH.test(trimmed) || RELATIVE_FILE.test(trimmed)
    || /(?:^|[\\/])(?:Users|private|tmp|var|home|Volumes|workspace)[\\/]/i.test(trimmed)) {
    return "[redacted-path]";
  }
  return value;
}

function stableValue(value: unknown, key = ""): unknown {
  if (PATH_KEY.test(key)) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(6)) : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactPathText(value);
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [];
  for (const objectKey of Object.keys(record).sort()) {
    const normalized = stableValue(record[objectKey], objectKey);
    if (normalized !== undefined) entries.push([objectKey, normalized]);
  }
  return Object.fromEntries(entries);
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

/**
 * Provenance in a shadow report is logical metadata only.  Adapters may pass
 * an object containing local convenience fields, so sanitize it at the
 * evaluator boundary instead of relying on callers to strip those fields.
 */
function safeProvenance(value: unknown, fallback: string): string | Record<string, unknown> {
  const sanitize = (input: unknown, key?: string): unknown => {
    if (key && (PATH_KEY.test(key) || /(?:path|filepath|filename)$/i.test(key))) return undefined;
    if (typeof input === "string") return redactPathText(input);
    if (Array.isArray(input)) return input.map((entry) => sanitize(entry)).filter((entry) => entry !== undefined);
    if (!input || typeof input !== "object") return input;
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(input as Record<string, unknown>)) {
      const sanitized = sanitize(entryValue, entryKey);
      if (sanitized !== undefined) Object.defineProperty(output, entryKey, {
        configurable: true,
        enumerable: true,
        value: sanitized,
        writable: true,
      });
    }
    return output;
  };
  const sanitized = sanitize(value);
  if (typeof sanitized === "string" && sanitized.trim()) return sanitized;
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) return sanitized as Record<string, unknown>;
  return fallback;
}

function manifestMetadata(item: ShadowCorpusItemInput, manifest: ShadowCorpusManifestInput, key: "corpus" | "datasetVersion" | "license" | "sourceRecord", fallback: string): string | Record<string, unknown> {
  const itemValue = (item as Record<string, unknown>)[key];
  const manifestValue = (manifest as Record<string, unknown>)[key];
  return safeProvenance(itemValue ?? manifestValue, fallback);
}

function manifestText(item: ShadowCorpusItemInput, manifest: ShadowCorpusManifestInput, key: "corpus" | "datasetVersion", fallback: string): string {
  const value = (item as Record<string, unknown>)[key] ?? (manifest as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) return redactPathText(value.trim());
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const identityKey of ["id", "name", "version", "dataset"]) {
      const identity = (value as Record<string, unknown>)[identityKey];
      if (typeof identity === "string" && identity.trim()) return redactPathText(identity.trim());
    }
  }
  return redactPathText(fallback);
}

function outputSourceCount(notes: readonly Note[], role: "vocals" | "guitar" | "other"): number {
  return notes.filter((note) => note.identitySource === role).length;
}

function outputRoleOnsetCount(notes: readonly Note[], role: "vocals" | "guitar" | "other"): number {
  return onsetGroups(notes.filter((note) => note.identitySource === role)).length;
}

function roleSourceNotes(notes: readonly Note[], role: "vocals" | "guitar" | "other"): Note[] {
  return notes.filter((note) => note.identitySource === role);
}

function buildVariantsFor(arrangement: MetalArrangementResult, item: ShadowCorpusItemInput): Variant[] {
  return buildVariants(arrangement.parsed, {
    title: item.label ?? item.id,
    artist: "shadow-corpus",
    style: "metal",
    tempo: arrangement.parsed.tempoBpm,
  }, {
    arrangementProfile: "metal",
    audioDerived: false,
    maxDurBeats: null,
  });
}

function validateRoles(roles: RoleNotes, arrangement: MetalArrangementResult, variants: { advanced?: ShadowVariantMetrics; medium?: ShadowVariantMetrics; easy?: ShadowVariantMetrics }, failures: string[]): void {
  const canonical = arrangement.parsed.notes;
  const pitchedDrums = canonical.filter((note) => Boolean((note as Note & { isDrum?: boolean; drum?: boolean }).isDrum || (note as Note & { drum?: boolean }).drum));
  if (pitchedDrums.length) failures.push(`${pitchedDrums.length} drum-derived pitches reached the canonical output`);
  if (roles.vocals.length && outputSourceCount(canonical, "vocals") === 0) failures.push("vocal role did not survive to the right-hand identity");
  if ((roles.guitar.length || roles.piano.length || roles.other.length) && outputSourceCount(canonical, "guitar") + outputSourceCount(canonical, "other") === 0) failures.push("pitched instrumental role did not survive to the canonical output");
  if (roles.bass.length && arrangement.stats.leftHandNotes <= 0) failures.push("bass/harmony input produced no left-hand evidence");
  if (!variants.advanced || !variants.medium || !variants.easy) failures.push("Advanced, Medium, and Easy variants are required");
  if (variants.advanced && variants.medium && variants.advanced.noteCount < variants.medium.noteCount) failures.push("Advanced has fewer notes than Medium");
  if (variants.medium && variants.easy && variants.medium.noteCount < variants.easy.noteCount) failures.push("Medium has fewer notes than Easy");
  if (variants.advanced && variants.medium && variants.advanced.difficultyScore < variants.medium.difficultyScore - EPS) failures.push("Advanced difficulty score is below Medium");
  if (variants.medium && variants.easy && variants.medium.difficultyScore < variants.easy.difficultyScore - EPS) failures.push("Medium difficulty score is below Easy");
  if (peakSimultaneity(canonical) > 8) failures.push(`canonical sounding simultaneity ${peakSimultaneity(canonical)} exceeds 8`);
}

function makeInputMetrics(roles: RoleNotes, reference: ParsedMidi | undefined): ShadowInputMetrics {
  const allPitched = [...roles.vocals, ...roles.bass, ...roles.guitar, ...roles.piano, ...roles.other];
  const duration = Math.max(
    reference && Number.isFinite(reference.durationBeats) ? reference.durationBeats : 0,
    ...allPitched.map((note) => note.start + note.dur),
    1,
  );
  return {
    durationBeats: Number(duration.toFixed(6)),
    roles: {
      vocals: roleMetrics(roles.vocals),
      bass: roleMetrics(roles.bass),
      guitar: roleMetrics(roles.guitar),
      piano: roleMetrics(roles.piano),
      other: roleMetrics(roles.other),
      drums: roleMetrics(roles.drums),
    },
    peakPitchedOnsetSize: peakOnsetSize(allPitched),
    drumTimingEventCount: roles.drums.length,
  };
}

function makeItemReport(
  item: ShadowCorpusItemInput,
  manifest: ShadowCorpusManifestInput,
  arrangement: MetalArrangementResult,
  roles: RoleNotes,
  sourceFailures: string[],
  variants: readonly Variant[],
): ShadowItemEvaluationReport {
  const canonical = arrangement.parsed.notes;
  const required = variantsByRequiredLevel(variants);
  const advanced = variantMetric(required.advanced);
  const medium = variantMetric(required.medium);
  const easy = variantMetric(required.easy);
  const variantMetrics = { advanced, medium, easy };
  const failures = [...sourceFailures];
  const alignmentStatus = item.alignment?.status ?? "missing";
  const symbolicStatus = item.symbolic?.status ?? "available";
  const audioStatus = item.audio?.status ?? "not-provided";
  if (alignmentStatus !== "aligned") failures.push(`alignment status is ${alignmentStatus}; shadow truth must be aligned`);
  if (symbolicStatus !== "available" && symbolicStatus !== "parsed") failures.push(`symbolic evidence status is ${symbolicStatus}`);
  if (Array.isArray(item.tracks) && roles.drums.length === 0) failures.push("required drum timing role is missing");
  validateRoles(roles, arrangement, variantMetrics, failures);
  failures.push(...advanced.failures, ...medium.failures, ...easy.failures);

  const inputMelody = roles.vocals.length ? roles.vocals : [...roles.guitar, ...roles.piano, ...roles.other].filter((note) => note.midi >= 61);
  const outputVocals = roleSourceNotes(canonical, "vocals");
  const outputLead = [...roleSourceNotes(canonical, "guitar"), ...roleSourceNotes(canonical, "other")].filter((note) => note.hand !== "L");
  const inputPitchClasses = new Set(inputMelody.map((note) => pitchClass(note.midi)));
  const outputPitchClasses = new Set(outputVocals.concat(outputLead).map((note) => pitchClass(note.midi)));
  const retainedClasses = [...inputPitchClasses].filter((pc) => outputPitchClasses.has(pc)).length;
  const outputHarmony = arrangement.stats.guitarHarmony;
  const outputInputPeak = peakOnsetSize([...roles.vocals, ...roles.bass, ...roles.guitar, ...roles.piano, ...roles.other]);
  const outputPeak = peakOnsetSize(canonical);
  const repeatedRestrikeReduction = Math.max(0, outputInputPeak - outputPeak);
  const semanticRootCount = outputHarmony?.semanticAttackCount ?? 0;
  const leftHandRootCount = canonical.filter((note) => note.hand === "L" && (note.identitySource === "guitar" || note.identitySource === "other")).length;
  const veryShort = canonical.filter((note) => note.dur <= 0.125).length;
  const allDuration = Math.max(1, canonical.length);
  const melody: ShadowMelodyMetrics = {
    inputNoteCount: inputMelody.length,
    inputOnsetCount: onsetGroups(inputMelody).length,
    vocalNoteCount: outputVocals.length,
    leadNoteCount: outputLead.length,
    vocalOnsetCount: outputRoleOnsetCount(canonical, "vocals"),
    leadOnsetCount: onsetGroups(outputLead).length,
    pitchClassRecall: inputPitchClasses.size ? Number((retainedClasses / inputPitchClasses.size).toFixed(6)) : null,
    contourP95Leap: contourP95(outputVocals.length ? outputVocals : outputLead),
  };
  const harmony: ShadowHarmonyMetrics = {
    inputGuitarNoteCount: roles.guitar.length,
    inputBassNoteCount: roles.bass.length,
    semanticRootCount,
    leftHandRootCount,
    chordEventCount: arrangement.chords.length,
    collapsedStackCount: outputHarmony?.collapsedUnisonOctaveFifth ?? 0,
    repeatedRestrikeReduction,
  };
  const pitchedDrumCount = canonical.filter((note) => note.identitySource === undefined && roles.drums.some((drum) => Math.abs(drum.start - note.start) <= 0.08 && drum.midi === note.midi)).length;
  const drums: ShadowDrumMetrics = {
    inputTimingEventCount: roles.drums.length,
    pitchedNoteCount: pitchedDrumCount,
    outputTimingOnly: pitchedDrumCount === 0,
  };
  if (drums.pitchedNoteCount) failures.push(`${drums.pitchedNoteCount} drum pitches in canonical output`);
  const texture: ShadowTextureMetrics = {
    canonicalNoteCount: canonical.length,
    canonicalOnsetCount: onsetGroups(canonical).length,
    canonicalPeakOnsetSize: outputPeak,
    canonicalPeakSimultaneity: peakSimultaneity(canonical),
    veryShortRate: Number((veryShort / allDuration).toFixed(6)),
    maxRightHandLeap: maxLeap(canonical, "R"),
    maxLeftHandLeap: maxLeap(canonical, "L"),
  };
  const warnings = [...arrangement.warnings];
  if (texture.veryShortRate > 0.8) warnings.push(`canonical very-short note rate ${texture.veryShortRate} is high`);
  if (inputMelody.length && melody.pitchClassRecall !== null && melody.pitchClassRecall < 0.5) warnings.push(`melody pitch-class recall is ${melody.pitchClassRecall}`);
  const explicitlyFullBand = Array.isArray(item.tracks);
  const status: ShadowReadiness = failures.length
    ? (alignmentStatus !== "aligned" || (explicitlyFullBand && roles.drums.length === 0)
      ? "SHADOW_ENGINEERING_BLOCKED"
      : "SHADOW_ENGINEERING_NOT_READY")
    : "SHADOW_ENGINEERING_READY";
  const reportWithoutDeterminism: Omit<ShadowItemEvaluationReport, "determinism"> = {
    schemaVersion: 1,
    status,
    fixture: {
      id: redactPathText(item.id),
      ...(item.label ? { label: redactPathText(item.label) } : {}),
    },
    provenance: {
      corpus: manifestText(item, manifest, "corpus", "synthetic-shadow"),
      datasetVersion: manifestText(item, manifest, "datasetVersion", "local"),
      license: manifestMetadata(item, manifest, "license", "synthetic-test-data"),
      sourceRecord: manifestMetadata(item, manifest, "sourceRecord", "synthetic:shadow"),
      alignment: { status: redactPathText(alignmentStatus), source: typeof item.alignment?.source === "string" ? redactPathText(item.alignment.source) : null },
      symbolicStatus,
      audioStatus,
    },
    input: makeInputMetrics(roles, arrangement.parsed),
    output: { melody, harmony, drums, texture },
    variants: variantMetrics,
    failures: [...new Set(failures)].sort(),
    warnings: [...new Set(warnings)].sort(),
    diagnostics: {
      arrangementWarnings: [...arrangement.warnings].sort(),
      guitarHarmony: diagnosticsOf(arrangement),
    },
  };
  return {
    ...reportWithoutDeterminism,
    determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(stableJson(reportWithoutDeterminism))) },
  };
}

function blockedItem(item: ShadowCorpusItemInput, manifest: ShadowCorpusManifestInput, failures: string[]): ShadowItemEvaluationReport {
  const empty = emptyRoleNotes();
  const emptyArrangement = {
    parsed: parsedFromNotes([]),
    chords: [],
    ir: { version: 1, tempoBpm: 120, timeSig: [4, 4] as [number, number], durationBeats: 1, sections: [], identity: [], harmony: [], rhythmicAccents: [] },
    stats: { identityNotes: 0, leftHandNotes: 0, chordEvents: 0, sourceSections: {}, guitarHarmony: undefined },
    warnings: [],
  } as unknown as MetalArrangementResult;
  const report = makeItemReport(item, manifest, emptyArrangement, empty, failures, []);
  return { ...report, status: "SHADOW_ENGINEERING_BLOCKED", failures: [...new Set([...report.failures, ...failures])].sort() };
}

/** Evaluate one synthetic or adapter-provided full-band shadow item. */
export function evaluateShadowItem(item: ShadowCorpusItemInput, options: ShadowEvaluationOptions = {}, manifestOverride?: Partial<ShadowCorpusManifestInput>): ShadowItemEvaluationReport {
  const itemFailures = shadowItemShapeFailures(item);
  const safe = safeItem(item, "invalid-shadow-item");
  const manifest: ShadowCorpusManifestInput = {
    schemaVersion: 1,
    corpus: "synthetic-shadow",
    datasetVersion: "local",
    license: "synthetic-test-data",
    sourceRecord: "synthetic:shadow",
    items: [safe],
    ...manifestOverride,
  };
  if (itemFailures.length) return blockedItem(safe, manifest, itemFailures);
  let converted: ReturnType<typeof shadowItemToMetalStems>;
  try {
    converted = shadowItemToMetalStems(safe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedItem(safe, manifest, [`shadow item conversion failed: ${message}`]);
  }
  if (!converted.stems.length) return blockedItem(safe, manifest, [...converted.failures, "no role-tagged symbolic stems are available"]);
  try {
    const arrangement = buildMetalArrangement({
      stems: converted.stems,
      title: safe.label ?? safe.id,
      ...(options.sectionBeats !== undefined ? { sectionBeats: options.sectionBeats } : {}),
      ...(options.harmonyBeats !== undefined ? { harmonyBeats: options.harmonyBeats } : {}),
    });
    const variants = buildVariantsFor(arrangement, safe);
    return makeItemReport(safe, manifest, arrangement, converted.input, converted.failures, variants);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedItem(safe, manifest, [...converted.failures, `shadow arrangement failed: ${message}`]);
  }
}

function validManifest(manifest: unknown): manifest is ShadowCorpusManifestInput {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  const value = manifest as Record<string, unknown>;
  return value.schemaVersion === 1
    && Array.isArray(value.items)
    && value.items.every((item) => shadowItemShapeFailures(item).length === 0);
}

/** Evaluate a deterministic subset of a provider-neutral shadow manifest. */
export function evaluateShadowCorpus(manifest: ShadowCorpusManifestInput, options: ShadowEvaluationOptions = {}): ShadowCorpusEvaluationReport {
  const base = {
    schemaVersion: 1 as const,
    status: "SHADOW_ENGINEERING_BLOCKED" as ShadowReadiness,
    corpus: {
      id: typeof manifest?.corpus === "string" && manifest.corpus.trim() ? redactPathText(manifest.corpus) : "synthetic-shadow",
      datasetVersion: typeof manifest?.datasetVersion === "string" && manifest.datasetVersion.trim() ? redactPathText(manifest.datasetVersion) : "local",
      license: safeProvenance(manifest?.license, "synthetic-test-data"),
      sourceRecord: safeProvenance(manifest?.sourceRecord, "synthetic:shadow"),
    },
    selectedItemIds: [],
    items: [] as ShadowItemEvaluationReport[],
    summary: { total: 0, ready: 0, notReady: 0, blocked: 0, drumPitchViolations: 0 },
    failures: [] as string[],
  };
  if (!validManifest(manifest)) {
    const report = { ...base, failures: ["shadow corpus manifest is malformed; expected schemaVersion 1 and valid item objects"] };
    return { ...report, determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(stableJson(report))) } };
  }
  const requestedValues = Array.isArray(options.itemIds)
    ? options.itemIds.filter((itemId): itemId is string => typeof itemId === "string")
    : undefined;
  const requested = requestedValues ? new Set(requestedValues) : undefined;
  const allItems = [...manifest.items].sort((a, b) => compareText(a.id, b.id));
  const duplicateIds = allItems.filter((item, index) => index > 0 && item.id === allItems[index - 1]!.id).map((item) => item.id);
  const selected = requested ? allItems.filter((item) => requested.has(item.id)) : allItems;
  const missingRequested = requested ? [...requested].filter((id) => !allItems.some((item) => item.id === id)).sort(compareText) : [];
  const items = selected.map((item) => evaluateShadowItem(item, options, manifest));
  const failures = [...new Set([
    ...(duplicateIds.length ? [`duplicate shadow item ids: ${[...new Set(duplicateIds)].sort().join(", ")}`] : []),
    ...(missingRequested.length ? [`requested shadow item ids are missing: ${missingRequested.join(", ")}`] : []),
  ])].sort();
  const summary = {
    total: items.length,
    ready: items.filter((item) => item.status === "SHADOW_ENGINEERING_READY").length,
    notReady: items.filter((item) => item.status === "SHADOW_ENGINEERING_NOT_READY").length,
    blocked: items.filter((item) => item.status === "SHADOW_ENGINEERING_BLOCKED").length,
    drumPitchViolations: items.reduce((sum, item) => sum + item.output.drums.pitchedNoteCount, 0),
  };
  if (failures.length) items.forEach((item) => item.failures.push(...failures));
  const status: ShadowReadiness = items.length > 0 && !failures.length && summary.ready === items.length
    ? "SHADOW_ENGINEERING_READY"
    : items.length > 0 ? "SHADOW_ENGINEERING_NOT_READY" : "SHADOW_ENGINEERING_BLOCKED";
  const withoutDeterminism = {
    ...base,
    status,
    selectedItemIds: selected.map((item) => redactPathText(item.id)),
    items,
    summary,
    failures,
  };
  return {
    ...withoutDeterminism,
    determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(stableJson(withoutDeterminism))) },
  };
}

/** Alias useful to callers that use the word `manifest` in their adapter. */
export const evaluateShadowManifest = evaluateShadowCorpus;

/** Stable report serialization used by the local CLI and deterministic tests. */
export function canonicalShadowEvaluationJson(value: ShadowItemEvaluationReport | ShadowCorpusEvaluationReport): string {
  return stableJson(value);
}
