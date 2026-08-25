import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chordPitchClasses, tryParseChordSymbol } from "@keyspilli/midi";
import {
  type ChordSourceEntry,
  type ChordSourceKind,
  type ChordSourceMap,
  type ChordSourceRef,
  loadChordSourceMap,
  resolveChordSourceArtifact,
  sourcePriority,
} from "./chord-sources.js";
import { ROOT, dataDir } from "./paths.js";

export const CHORD_TIMELINE_SCHEMA_VERSION = 1 as const;
const EPSILON = 1e-7;
const DEFAULT_TIME_SIG: [number, number] = [4, 4];
const FORBIDDEN_PAYLOAD_KEYS = new Set(["lyrics", "lyric", "tab", "tabs", "tablature", "raw", "rawtext", "charttext"]);

/** Event-level origin. This is deliberately separate from chart/midi source metadata. */
export type ChordTimelineEventSourceKind = "authored" | "inferred" | "generated" | "unknown";

/** Known inference labels, while accepting future labels for forward compatibility. */
export type ChordInferenceType =
  | "dyad-completion"
  | "carry-forward-root"
  | "nearest-symbol"
  | "subbeat-extension"
  | "voicing"
  | (string & {});

const EVENT_SOURCE_KINDS = new Set<ChordTimelineEventSourceKind>(["authored", "inferred", "generated", "unknown"]);

export interface ChordTimelineEvent {
  /** Start position in quarter-note beats. */
  beat: number;
  /** Normalized positive span; never crosses the next event. */
  durationBeats: number;
  name: string;
  /** Optional playable voicing supplied by a catalog curator. */
  notes?: number[];
  /** Event-level source classification, independent of the source provider. */
  sourceKind: ChordTimelineEventSourceKind;
  /** Whether this label or voicing was inferred. */
  inferred?: boolean;
  /** Strategy used to infer the label or voicing, when applicable. */
  inferenceType?: ChordInferenceType;
}

export interface ChordTimelineProvenance {
  sourceId: string;
  provider: string;
  kind: ChordSourceKind;
  sourceRef: string;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  confidence?: string;
  fallback?: boolean;
  fallbackReason?: string;
}

export interface ChordTimelineArtifact {
  schemaVersion: typeof CHORD_TIMELINE_SCHEMA_VERSION;
  baseId: string;
  title: string;
  artist: string;
  key?: string;
  tempoBpm?: number;
  timeSig: [number, number];
  durationBeats: number;
  /** Honest coverage marker for partial pilot artifacts. */
  coverage?: "opening-section" | "full-song";
  chords: ChordTimelineEvent[];
  provenance: ChordTimelineProvenance;
}

export interface ChordTimelineResolution {
  timeline: ChordTimelineArtifact;
  source: ChordSourceRef;
  usedFallback: boolean;
  warnings: string[];
}

export interface ChordTimelineLoadOptions {
  mappingPath?: string;
  /** Root used for checked-in artifact paths; defaults to the repository root. */
  catalogRoot?: string;
  /** Runtime data directory used by generated notes.json fallback. */
  runtimeDataDir?: string;
  fallbackLevel?: string;
}

interface TimelineCacheEntry {
  value: ChordTimelineResolution | null;
}

const TIMELINE_CACHE_LIMIT = 32;
const timelineCache = new Map<string, TimelineCacheEntry>();
const timelineInflight = new Map<string, Promise<ChordTimelineResolution | null>>();

function timelineFileSignature(path: string): string {
  try {
    const stat = statSync(path, { bigint: true });
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  } catch {
    return `${path}:missing`;
  }
}

interface TimelineInputEvent {
  beat?: unknown;
  startBeat?: unknown;
  durationBeats?: unknown;
  /** Legacy alias accepted by generated notes exports. */
  duration?: unknown;
  endBeat?: unknown;
  name?: unknown;
  notes?: unknown;
  sourceKind?: unknown;
  inferred?: unknown;
  inferenceType?: unknown;
}

interface TimelineInput {
  schemaVersion?: unknown;
  baseId?: unknown;
  title?: unknown;
  artist?: unknown;
  key?: unknown;
  tempoBpm?: unknown;
  timeSig?: unknown;
  durationBeats?: unknown;
  coverage?: unknown;
  chords?: unknown;
  provenance?: unknown;
}

type ParsedTimelineEvent = ChordTimelineEvent & {
  inputIndex: number;
  explicitDuration?: number;
  explicitEnd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundBeat(value: number): number {
  // Charts are hand-entered in quarter/eighth/sixteenth positions. Keeping a
  // sixteenth grid makes source merges deterministic without changing timing.
  return Math.round(value * 16) / 16;
}

function equalBeat(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

function rejectPayloadKeys(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) errors.push(`${path} must not contain ${key}`);
  }
}

function readNotes(raw: unknown, path: string, errors: string[]): number[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  const notes: number[] = [];
  for (const [i, value] of raw.entries()) {
    if (!finite(value) || !Number.isInteger(value) || value < 0 || value > 127) {
      errors.push(`${path}[${i}] must be an integer MIDI pitch from 0 to 127`);
    } else {
      notes.push(value);
    }
  }
  return [...new Set(notes)].sort((a, b) => a - b);
}

function eventSourceKindForInput(value: unknown, defaults?: { source?: ChordSourceRef }): ChordTimelineEventSourceKind {
  // The caller's source reference is the strongest legacy-origin signal. In
  // particular, a generated notes.json projection must not inherit an
  // unrelated chart source merely because it is being used as a fallback.
  if (defaults?.source?.kind === "chart") return "authored";
  if (defaults?.source?.kind === "midi-derived") return "generated";
  if (isRecord(value)) {
    if (value.kind === "chart") return "authored";
    if (value.kind === "midi-derived") return "generated";
  }
  // A direct normalizer call has no reliable origin context. Preserve that
  // uncertainty instead of promoting a legacy event to generated.
  return "unknown";
}

function readEventSourceKind(raw: unknown, fallback: ChordTimelineEventSourceKind, path: string, errors: string[]): ChordTimelineEventSourceKind {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !EVENT_SOURCE_KINDS.has(raw as ChordTimelineEventSourceKind)) {
    errors.push(`${path}.sourceKind must be authored, inferred, generated, or unknown`);
    return fallback;
  }
  return raw as ChordTimelineEventSourceKind;
}

function readInferred(raw: unknown, path: string, errors: string[]): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    errors.push(`${path}.inferred must be a boolean`);
    return undefined;
  }
  return raw;
}

function readInferenceType(raw: unknown, path: string, errors: string[]): ChordInferenceType | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "" || /[\r\n]/.test(raw)) {
    errors.push(`${path}.inferenceType must be a non-empty single-line string`);
    return undefined;
  }
  return raw.trim();
}

function eventAuthorityRank(sourceKind: ChordTimelineEventSourceKind): number {
  // Unknown is not an authority claim. Explicitly classified generated data
  // therefore wins over an ambiguous event, while every known source remains
  // below authored and inferred material.
  if (sourceKind === "authored") return 3;
  if (sourceKind === "inferred") return 2;
  if (sourceKind === "generated") return 1;
  return 0;
}

function hasPlayableNotes(event: ChordTimelineEvent): boolean {
  return Array.isArray(event.notes) && event.notes.length > 0;
}

function playableNoteCount(event: ChordTimelineEvent): number {
  return new Set(event.notes ?? []).size;
}

function explicitDuration(event: ParsedTimelineEvent): number {
  if (event.explicitDuration !== undefined) return event.explicitDuration;
  if (event.explicitEnd !== undefined) return Math.max(0, event.explicitEnd - event.beat);
  return 0;
}

/**
 * A fixed-field, input-order-independent representation for same-onset
 * conflicts. `inputIndex` is deliberately excluded: source array order is
 * not provenance and must never decide which event survives a rebuild.
 */
function eventFingerprint(event: ParsedTimelineEvent): string {
  return JSON.stringify({
    beat: event.beat,
    durationBeats: event.explicitDuration ?? null,
    endBeat: event.explicitEnd ?? null,
    name: event.name,
    notes: event.notes === undefined ? null : event.notes,
    sourceKind: event.sourceKind,
    inferred: event.inferred ?? null,
    inferenceType: event.inferenceType ?? null,
  });
}

/** Return positive when `candidate` should replace `previous`. */
function compareSameOnsetEvents(candidate: ParsedTimelineEvent, previous: ParsedTimelineEvent): number {
  const candidateRank = eventAuthorityRank(candidate.sourceKind);
  const previousRank = eventAuthorityRank(previous.sourceKind);
  if (candidateRank !== previousRank) return candidateRank - previousRank;

  const candidatePlayable = hasPlayableNotes(candidate);
  const previousPlayable = hasPlayableNotes(previous);
  if (candidatePlayable !== previousPlayable) return candidatePlayable ? 1 : -1;

  // An explicit empty notes array is a meaningful display-only authored
  // event. Preserve it over an omitted notes field when all other precedence
  // criteria tie.
  const candidateHasNotes = candidate.notes !== undefined;
  const previousHasNotes = previous.notes !== undefined;
  if (candidateHasNotes !== previousHasNotes) return candidateHasNotes ? 1 : -1;

  if (candidatePlayable && previousPlayable) {
    const candidateCount = playableNoteCount(candidate);
    const previousCount = playableNoteCount(previous);
    if (candidateCount !== previousCount) {
      // Generated/ambiguous fallbacks prefer the leaner learner-safe voicing;
      // authored and inferred sources retain the richer explicit voicing.
      const leanerWins = candidate.sourceKind === "generated" || candidate.sourceKind === "unknown";
      return leanerWins ? previousCount - candidateCount : candidateCount - previousCount;
    }
  }

  const candidateDuration = explicitDuration(candidate);
  const previousDuration = explicitDuration(previous);
  if (candidateDuration !== previousDuration) return candidateDuration - previousDuration;

  const candidateFingerprint = eventFingerprint(candidate);
  const previousFingerprint = eventFingerprint(previous);
  if (candidateFingerprint === previousFingerprint) return 0;
  return candidateFingerprint < previousFingerprint ? 1 : -1;
}

function validateChartVoicing(name: string, notes: number[] | undefined, path: string, chartLike: boolean, errors: string[]): void {
  if (!chartLike || !notes?.length) return;
  const parsed = tryParseChordSymbol(name);
  // Providers occasionally publish labels outside the compact parser's
  // vocabulary (for example N.C.); those remain valid symbols with their
  // authored voicing. For symbols we understand, every required pitch class
  // must actually be present so a bad checked-in voicing cannot turn a chord
  // into an unrelated dyad.
  if (!parsed) return;
  const actual = new Set(notes.map((midi) => midi % 12));
  const missing = chordPitchClasses(parsed).filter((pitchClass) => !actual.has(pitchClass));
  if (missing.length) errors.push(`${path}.notes is missing chord pitch classes ${missing.join(",")}`);
}

function readTimeSig(raw: unknown, errors: string[]): [number, number] {
  if (raw === undefined) return [...DEFAULT_TIME_SIG] as [number, number];
  if (!Array.isArray(raw) || raw.length !== 2 || !raw.every((n) => finite(n) && Number.isInteger(n) && n > 0)) {
    errors.push("timeSig must be [positive integer numerator, positive integer denominator]");
    return [...DEFAULT_TIME_SIG] as [number, number];
  }
  return [raw[0] as number, raw[1] as number];
}

function sourceFromProvenance(raw: unknown, fallback: ChordSourceRef): ChordTimelineProvenance {
  if (!isRecord(raw)) {
    return {
      sourceId: fallback.id,
      provider: fallback.provider,
      kind: fallback.kind,
      sourceRef: fallback.sourceRef,
      sourceUrl: fallback.sourceUrl ?? null,
      retrievedAt: fallback.retrievedAt ?? null,
      confidence: fallback.confidence,
    };
  }
  return {
    sourceId: typeof raw.sourceId === "string" ? raw.sourceId : fallback.id,
    provider: typeof raw.provider === "string" ? raw.provider : fallback.provider,
    kind: raw.kind === "chart" || raw.kind === "midi-derived" ? raw.kind : fallback.kind,
    sourceRef: typeof raw.sourceRef === "string" ? raw.sourceRef : fallback.sourceRef,
    sourceUrl: typeof raw.sourceUrl === "string" || raw.sourceUrl === null ? raw.sourceUrl : fallback.sourceUrl ?? null,
    retrievedAt: typeof raw.retrievedAt === "string" || raw.retrievedAt === null ? raw.retrievedAt : fallback.retrievedAt ?? null,
    confidence: typeof raw.confidence === "string" ? raw.confidence : fallback.confidence,
    // Do not synthesize `fallback: false` when a canonical timeline omitted
    // the optional flag. Re-normalizing a normalized artifact must be a fixed
    // point, while an explicitly supplied false value remains round-trippable.
    ...(raw.fallback === true || raw.fallback === false ? { fallback: raw.fallback } : {}),
    fallbackReason: typeof raw.fallbackReason === "string" ? raw.fallbackReason : undefined,
  };
}

/**
 * Normalize chart events into a sorted, non-overlapping beat timeline. The
 * input accepts either `beat` or `startBeat`, and either `durationBeats` or
 * `endBeat`; the checked-in representation always emits one canonical shape.
 */
export function normalizeChordTimeline(value: unknown, defaults?: { source?: ChordSourceRef }): ChordTimelineArtifact {
  if (!isRecord(value)) throw new Error("timeline must be an object");
  const input = value as TimelineInput;
  const errors: string[] = [];
  rejectPayloadKeys(input, "timeline", errors);
  rejectPayloadKeys(input.provenance, "timeline.provenance", errors);
  const legacyEventSourceKind = eventSourceKindForInput(input.provenance, defaults);
  const chartLike = defaults?.source?.kind === "chart"
    || (isRecord(input.provenance) && input.provenance.kind === "chart");
  if (input.schemaVersion !== undefined && input.schemaVersion !== CHORD_TIMELINE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CHORD_TIMELINE_SCHEMA_VERSION}`);
  }
  if (typeof input.baseId !== "string" || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(input.baseId)) errors.push("baseId must be a valid catalog base id");
  if (typeof input.title !== "string" || input.title.trim() === "") errors.push("title must be non-empty");
  if (typeof input.artist !== "string" || input.artist.trim() === "") errors.push("artist must be non-empty");
  if (input.key !== undefined && typeof input.key !== "string") errors.push("key must be a string");
  if (input.tempoBpm !== undefined && (!finite(input.tempoBpm) || input.tempoBpm < 20 || input.tempoBpm > 300)) errors.push("tempoBpm must be between 20 and 300");
  if (input.coverage !== undefined && input.coverage !== "opening-section" && input.coverage !== "full-song") {
    errors.push("coverage must be opening-section or full-song");
  }
  const timeSig = readTimeSig(input.timeSig, errors);
  if (!Array.isArray(input.chords)) {
    errors.push("chords must be an array");
  }
  if (errors.length) throw new Error(`invalid chord timeline: ${errors.join("; ")}`);

  const rawEvents = input.chords as unknown[];
  const parsed: ParsedTimelineEvent[] = [];
  for (const [index, rawEvent] of rawEvents.entries()) {
    const path = `chords[${index}]`;
    if (!isRecord(rawEvent)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const event = rawEvent as TimelineInputEvent;
    rejectPayloadKeys(event, path, errors);
    const beatRaw = event.beat ?? event.startBeat;
    if (!finite(beatRaw) || beatRaw < 0) {
      errors.push(`${path}.beat must be a finite non-negative number`);
      continue;
    }
    if (typeof event.name !== "string" || event.name.trim() === "" || /[\r\n]/.test(event.name)) {
      errors.push(`${path}.name must be a non-empty single-line string`);
      continue;
    }
    const duration = event.durationBeats ?? event.duration;
    const end = event.endBeat;
    if (duration !== undefined && (!finite(duration) || duration <= 0)) errors.push(`${path}.durationBeats must be positive`);
    if (end !== undefined && (!finite(end) || end <= (beatRaw as number))) errors.push(`${path}.endBeat must be after beat`);
    const notes = readNotes(event.notes, `${path}.notes`, errors);
    const sourceKind = readEventSourceKind(event.sourceKind, legacyEventSourceKind, path, errors);
    const inferred = readInferred(event.inferred, path, errors);
    const inferenceType = readInferenceType(event.inferenceType, path, errors);
    const parsedDuration = finite(duration) && duration > 0 ? duration : undefined;
    const parsedEnd = finite(end) && end > (beatRaw as number) ? end : undefined;
    validateChartVoicing(event.name.trim(), notes, `${path}`, chartLike, errors);
    parsed.push({
      beat: roundBeat(beatRaw),
      durationBeats: parsedDuration ?? (parsedEnd !== undefined ? parsedEnd - (beatRaw as number) : 0),
      name: event.name.trim(),
      ...(notes === undefined ? {} : { notes }),
      sourceKind,
      ...(inferred === undefined ? {} : { inferred }),
      ...(inferenceType === undefined ? {} : { inferenceType }),
      inputIndex: index,
      ...(parsedDuration === undefined ? {} : { explicitDuration: parsedDuration }),
      ...(parsedEnd === undefined ? {} : { explicitEnd: parsedEnd }),
    });
  }
  if (errors.length) throw new Error(`invalid chord timeline: ${errors.join("; ")}`);

  parsed.sort((a, b) => {
    const beatOrder = a.beat - b.beat;
    if (beatOrder !== 0) return beatOrder;
    const aFingerprint = eventFingerprint(a);
    const bFingerprint = eventFingerprint(b);
    return aFingerprint < bFingerprint ? -1 : aFingerprint > bFingerprint ? 1 : 0;
  });
  // At one beat position explicit source authority wins. The canonical
  // fingerprint is the final tie-break, so shuffling input rows cannot change
  // the normalized artifact.
  const atBeat: typeof parsed = [];
  for (const event of parsed) {
    const previous = atBeat.at(-1);
    if (!previous || !equalBeat(previous.beat, event.beat)) {
      atBeat.push(event);
      continue;
    }

    if (compareSameOnsetEvents(event, previous) > 0) atBeat[atBeat.length - 1] = event;
  }
  const suppliedDuration = input.durationBeats;
  if (suppliedDuration !== undefined && (!finite(suppliedDuration) || suppliedDuration < 0)) {
    throw new Error("invalid chord timeline: durationBeats must be a finite non-negative number");
  }
  const fallbackSpan = timeSig[0] * (4 / timeSig[1]);
  let durationBeats = finite(suppliedDuration) ? roundBeat(suppliedDuration) : 0;
  if (finite(suppliedDuration) && atBeat.length && durationBeats < atBeat.at(-1)!.beat) {
    throw new Error("invalid chord timeline: durationBeats ends before the final chord");
  }
  if (!durationBeats) {
    durationBeats = atBeat.reduce((max, event) => Math.max(max, event.beat + (event.explicitDuration ?? fallbackSpan)), 0);
    durationBeats = roundBeat(durationBeats);
  }
  const projected: ChordTimelineEvent[] = [];
  for (let i = 0; i < atBeat.length; i++) {
    const event = atBeat[i]!;
    const nextBeat = atBeat[i + 1]?.beat ?? durationBeats;
    const requestedEnd = event.explicitEnd ?? (event.explicitDuration !== undefined ? event.beat + event.explicitDuration : nextBeat);
    const endBeat = Math.min(nextBeat, requestedEnd, durationBeats || nextBeat);
    if (endBeat <= event.beat + EPSILON) throw new Error(`invalid chord timeline: chords[${event.inputIndex}] has no positive span`);
    projected.push({
      beat: event.beat,
      durationBeats: roundBeat(endBeat - event.beat),
      name: event.name,
      ...(event.notes === undefined ? {} : { notes: event.notes }),
      sourceKind: event.sourceKind,
      ...(event.inferred === undefined ? {} : { inferred: event.inferred }),
      ...(event.inferenceType === undefined ? {} : { inferenceType: event.inferenceType }),
    });
  }

  // Compact only genuinely contiguous repeats after their spans have been
  // projected. Comparing input-only duration fields made normalization
  // non-idempotent: an omitted duration could become an explicit clipped
  // duration on the first pass and then cause a neighboring event to vanish
  // on the second. The canonical spans are now the compaction authority.
  const chords: ChordTimelineEvent[] = [];
  for (const event of projected) {
    const previous = chords.at(-1);
    const samePayload = previous
      && previous.name === event.name
      && JSON.stringify(previous.notes ?? []) === JSON.stringify(event.notes ?? [])
      && previous.sourceKind === event.sourceKind
      && previous.inferred === event.inferred
      && previous.inferenceType === event.inferenceType;
    if (samePayload && equalBeat(previous.beat + previous.durationBeats, event.beat)) {
      previous.durationBeats = roundBeat(previous.durationBeats + event.durationBeats);
      continue;
    }
    chords.push(event);
  }

  const fallbackSource: ChordSourceRef = defaults?.source ?? {
    id: "unknown",
    provider: "unknown",
    kind: "midi-derived",
    sourceRef: "unknown",
    confidence: "low",
  };
  const provenance = sourceFromProvenance(input.provenance, fallbackSource);
  return {
    schemaVersion: CHORD_TIMELINE_SCHEMA_VERSION,
    baseId: input.baseId as string,
    title: input.title as string,
    artist: input.artist as string,
    ...(input.key === undefined ? {} : { key: input.key as string }),
    ...(input.tempoBpm === undefined ? {} : { tempoBpm: input.tempoBpm as number }),
    timeSig,
    durationBeats,
    ...(input.coverage === undefined ? {} : { coverage: input.coverage as "opening-section" | "full-song" }),
    chords,
    provenance,
  };
}

export function validateChordTimeline(value: unknown): string[] {
  try {
    normalizeChordTimeline(value);
    return [];
  } catch (error) {
    return [(error as Error).message];
  }
}

export function parseChordTimeline(value: unknown, defaults?: { source?: ChordSourceRef }): ChordTimelineArtifact {
  return normalizeChordTimeline(value, defaults);
}

function sourceForEntry(entry: ChordSourceEntry | undefined, sourceId: string | undefined): ChordSourceRef | undefined {
  if (!entry) return undefined;
  if (sourceId) return entry.sources.find((source) => source.id === sourceId);
  return [...entry.sources].sort((a, b) => sourcePriority(a, entry.sources.indexOf(a)) - sourcePriority(b, entry.sources.indexOf(b)))[0];
}

function mergeProvenance(timeline: ChordTimelineArtifact, source: ChordSourceRef): ChordTimelineArtifact {
  return {
    ...timeline,
    provenance: {
      ...timeline.provenance,
      sourceId: source.id,
      provider: source.provider,
      kind: source.kind,
      sourceRef: source.sourceRef,
      sourceUrl: source.sourceUrl ?? timeline.provenance.sourceUrl ?? null,
      retrievedAt: source.retrievedAt ?? timeline.provenance.retrievedAt ?? null,
      confidence: source.confidence ?? timeline.provenance.confidence,
    },
  };
}

interface StoredVariant {
  notes?: unknown;
  chords?: unknown;
  measures?: unknown;
  durationBeats?: unknown;
  key?: unknown;
  tempoBpm?: unknown;
  timeSig?: unknown;
}

function generatedTimeline(value: StoredVariant, baseId: string, entry: ChordSourceEntry | undefined, source: ChordSourceRef, level: string): ChordTimelineArtifact {
  const notes = Array.isArray(value.notes) ? value.notes.filter(isRecord) : [];
  const noteEnd = notes.reduce((max, note) => {
    const start = finite(note.start) ? note.start : 0;
    const dur = finite(note.dur) ? note.dur : 0;
    return Math.max(max, start + dur);
  }, 0);
  const measures = Array.isArray(value.measures) ? value.measures.filter(isRecord) : [];
  const measureEnd = measures.reduce((max, measure) => Math.max(max, finite(measure.endBeat) ? measure.endBeat : 0), 0);
  const chords = Array.isArray(value.chords)
    ? value.chords.map((chord) => {
      if (!isRecord(chord)) return chord;
      // Keep the complete chord event shape when projecting legacy
      // notes.json. Older files omit all optional metadata; the surrounding
      // MIDI-derived source context classifies those events as generated.
      return {
        beat: chord.beat,
        startBeat: chord.startBeat,
        durationBeats: chord.durationBeats ?? chord.duration,
        endBeat: chord.endBeat,
        name: chord.name,
        notes: chord.notes,
        // The surrounding source context is MIDI-derived, so normalization
        // stamps omitted legacy fields as generated. Preserve an explicit
        // event sourceKind instead of guessing from the projection itself.
        ...(chord.sourceKind === undefined ? {} : { sourceKind: chord.sourceKind }),
        inferred: chord.inferred,
        inferenceType: chord.inferenceType,
      };
    })
    : [];
  const storedDuration = finite(value.durationBeats) ? value.durationBeats : 0;
  const durationBeats = Math.max(noteEnd, measureEnd, storedDuration, 0);
  return normalizeChordTimeline({
    schemaVersion: CHORD_TIMELINE_SCHEMA_VERSION,
    baseId,
    title: entry?.canonicalTitle ?? baseId,
    artist: entry?.canonicalArtist ?? "Unknown",
    ...(typeof value.key === "string" ? { key: value.key } : {}),
    ...(finite(value.tempoBpm) ? { tempoBpm: value.tempoBpm } : {}),
    timeSig: Array.isArray(value.timeSig) ? value.timeSig : DEFAULT_TIME_SIG,
    durationBeats,
    coverage: "full-song",
    chords,
    provenance: {
      sourceId: source.id,
      provider: source.provider,
      kind: source.kind,
      sourceRef: source.sourceRef,
      sourceUrl: source.sourceUrl ?? null,
      retrievedAt: source.retrievedAt ?? null,
      confidence: source.confidence ?? "fallback",
      fallback: true,
      fallbackReason: `chart artifact unavailable; derived from ${level}/notes.json`,
    },
  }, { source });
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function timelineMappingPath(options: ChordTimelineLoadOptions): string {
  return resolve(options.mappingPath ?? process.env.KEYSPILLI_CHORD_SOURCE_MAP ?? resolve(ROOT, "catalog/chord-sources.json"));
}

function timelineDependencyPaths(
  baseId: string,
  options: ChordTimelineLoadOptions,
  map?: ChordSourceMap,
): string[] {
  const paths = [timelineMappingPath(options)];
  const entry = map?.entries.find((candidate) => candidate.baseId === baseId);
  for (const source of entry?.sources ?? []) {
    const artifactPath = resolveChordSourceArtifact(source, options.catalogRoot ?? ROOT);
    if (artifactPath) paths.push(artifactPath);
  }
  const level = options.fallbackLevel ?? "a";
  paths.push(join(options.runtimeDataDir ?? dataDir(), "artifacts", baseId, level, "notes.json"));
  return [...new Set(paths.map((path) => resolve(path)))];
}

async function timelineCacheKey(baseId: string, options: ChordTimelineLoadOptions): Promise<string> {
  let map: ChordSourceMap | undefined;
  try {
    map = await loadChordSourceMap(timelineMappingPath(options));
  } catch {
    // The uncached resolver preserves its existing fail-open fallback when
    // the optional source map is absent or invalid.
  }
  const dependencies = timelineDependencyPaths(baseId, options, map);
  return JSON.stringify({
    baseId,
    fallbackLevel: options.fallbackLevel ?? "a",
    catalogRoot: resolve(options.catalogRoot ?? ROOT),
    runtimeDataDir: resolve(options.runtimeDataDir ?? dataDir()),
    dependencies: dependencies.map((path) => timelineFileSignature(path)),
  });
}

function rememberTimeline(key: string, value: ChordTimelineResolution | null): void {
  timelineCache.delete(key);
  timelineCache.set(key, { value });
  while (timelineCache.size > TIMELINE_CACHE_LIMIT) {
    const oldest = timelineCache.keys().next().value;
    if (oldest === undefined) break;
    timelineCache.delete(oldest);
  }
}

/** Resolve the best checked-in chart, then fall back to generated MIDI chords. */
async function resolveChordTimelineUncached(baseId: string, options: ChordTimelineLoadOptions = {}): Promise<ChordTimelineResolution | null> {
  const warnings: string[] = [];
  let map: ChordSourceMap = { schemaVersion: 1, entries: [] };
  try {
    map = await loadChordSourceMap(options.mappingPath);
  } catch (error) {
    // A missing optional chart map must not hide the generated catalog chord
    // fallback. The verifier remains fail-closed for checked-in releases.
    warnings.push(`chord source map: ${(error as Error).message}`);
  }
  const entry = map.entries.find((candidate) => candidate.baseId === baseId);
  const candidates = [...(entry?.sources ?? [])].sort((a, b) => sourcePriority(a, entry!.sources.indexOf(a)) - sourcePriority(b, entry!.sources.indexOf(b)));
  for (const source of candidates) {
    const artifactPath = resolveChordSourceArtifact(source, options.catalogRoot ?? ROOT);
    if (!artifactPath) continue;
    try {
      const parsed = parseChordTimeline(await readJson(artifactPath), { source });
      if (parsed.baseId !== baseId) throw new Error(`artifact baseId ${parsed.baseId} does not match ${baseId}`);
      return { timeline: mergeProvenance(parsed, source), source, usedFallback: false, warnings };
    } catch (error) {
      warnings.push(`${source.id}: ${(error as Error).message}`);
    }
  }

  const fallback = sourceForEntry(entry, entry?.fallbackSourceId) ?? {
    id: "midi-derived",
    provider: "keyspilli",
    kind: "midi-derived" as const,
    sourceRef: `variant:${options.fallbackLevel ?? "a"}:notes.json`,
    confidence: "fallback" as const,
  };
  const level = options.fallbackLevel ?? "a";
  const fallbackPath = join(options.runtimeDataDir ?? dataDir(), "artifacts", baseId, level, "notes.json");
  try {
    const stored = await readJson(fallbackPath) as StoredVariant;
    const timeline = generatedTimeline(stored, baseId, entry, fallback, level);
    return { timeline, source: fallback, usedFallback: true, warnings };
  } catch (error) {
    warnings.push(`midi-derived fallback: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Resolve normalized chord timelines through a bounded dependency-keyed cache.
 *
 * Chord maps and generated notes are published as files, so every lookup
 * includes device/inode/size/mtime signatures for all possible source files.
 * A changed or newly published file therefore gets a new key without a
 * process-wide invalidation hook, while repeated player/detail requests avoid
 * reparsing the same notes.json and chart artifacts. Concurrent misses share
 * one in-flight resolver.
 */
export async function resolveChordTimeline(baseId: string, options: ChordTimelineLoadOptions = {}): Promise<ChordTimelineResolution | null> {
  const key = await timelineCacheKey(baseId, options);
  const cached = timelineCache.get(key);
  if (cached) {
    rememberTimeline(key, cached.value);
    return cached.value;
  }
  const existing = timelineInflight.get(key);
  if (existing) return existing;
  const pending = resolveChordTimelineUncached(baseId, options)
    .then((value) => {
      rememberTimeline(key, value);
      return value;
    })
    .finally(() => {
      timelineInflight.delete(key);
    });
  timelineInflight.set(key, pending);
  return pending;
}

/** Convenience loader for callers that only need the normalized timeline. */
export async function loadChordTimeline(baseId: string, options: ChordTimelineLoadOptions = {}): Promise<ChordTimelineArtifact | null> {
  return (await resolveChordTimeline(baseId, options))?.timeline ?? null;
}

/** Exposed for scripts/tests that need to inspect the parsed source map. */
export async function loadChordSourceMapForTimeline(path?: string): Promise<ChordSourceMap> {
  return loadChordSourceMap(path);
}
