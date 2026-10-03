import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement.js";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cache } from "react";
import {
  artifactPublicationRevision,
  arrangementManifestPath,
  artifactsDir,
  dataDir,
  getSong,
  getSongsByBase,
  loadChordTimeline,
  readArrangementManifest,
  resolveArtifactPlaybackTempo,
  type ArrangementManifest,
  type ChordTimelineArtifact,
  type SourceTimingMetadata,
  type SongRow,
} from "@keyspilli/catalog";
import { chordToNotes, inferHarmonyTimeline, validateArtifactFiles, type ChordLabel, type Variant } from "@keyspilli/midi";
import { arithmeticMeasures, completeChordDurations, detectSections, playbackTiming, validatePlaybackData, validateSparseBackingTiming, type ChordSourceBundle, type ChordSourceTimeline, type SongData } from "@keyspilli/player-core";

type LoadedChordTimeline = NonNullable<Awaited<ReturnType<typeof loadChordTimeline>>>;
type PlayerChord = Omit<ChordLabel, "sourceKind" | "inferred" | "inferenceType" | "durationBeats"> & {
  sourceKind?: "authored" | "inferred" | "generated" | "unknown";
  inferred?: boolean;
  inferenceType?: ChordLabel["inferenceType"];
  duration?: number;
  durationBeats?: number;
};

type PlayerSourceOption = ChordSourceTimeline & { chords: PlayerChord[] };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Copy the event-level fields that are meaningful to the player boundary. */
function preserveChordMetadata(value: unknown): Omit<PlayerChord, "beat" | "name" | "notes"> {
  const obj = record(value);
  if (!obj) return {};
  const metadata: Omit<PlayerChord, "beat" | "name" | "notes"> = {};
  if (typeof obj.sourceKind === "string" && obj.sourceKind.trim()) {
    metadata.sourceKind = obj.sourceKind as NonNullable<PlayerChord["sourceKind"]>;
  }
  if (typeof obj.inferred === "boolean") metadata.inferred = obj.inferred;
  if (typeof obj.inferenceType === "string" && obj.inferenceType.trim()) {
    metadata.inferenceType = obj.inferenceType as NonNullable<PlayerChord["inferenceType"]>;
  }

  if (typeof obj.reviewReason === "string") metadata.reviewReason = obj.reviewReason;
  const durationBeats = finite(obj.durationBeats);
  const duration = finite(obj.duration);
  const strikeSpacingBeats = finite(obj.strikeSpacingBeats);
  if (strikeSpacingBeats !== null && strikeSpacingBeats > 0) metadata.strikeSpacingBeats = strikeSpacingBeats;
  const maxStrikeDurationBeats = finite(obj.maxStrikeDurationBeats);
  if (maxStrikeDurationBeats !== null && maxStrikeDurationBeats > 0) metadata.maxStrikeDurationBeats = maxStrikeDurationBeats;
  if (durationBeats !== null && durationBeats > 0) metadata.durationBeats = durationBeats;
  if (duration !== null && duration > 0) {
    metadata.duration = duration;
    // A few older exports called the beat span `duration`; expose the
    // player-native alias as well while retaining the source field.
    if (metadata.durationBeats === undefined) metadata.durationBeats = duration;
  }
  return metadata;
}

function chordDuration(value: unknown): number {
  const obj = record(value);
  const duration = finite(obj?.durationBeats ?? obj?.duration);
  return duration !== null && duration > 0 ? duration : 0;
}

function hasExplicitNotes(value: unknown): boolean {
  const obj = record(value);
  return obj !== null && ["notes", "midis", "pitches", "midiNotes", "midi", "pitch"]
    .some((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function preserveChord(value: unknown, notes: number[]): PlayerChord | null {
  const obj = record(value);
  if (!obj) return null;
  const beat = finite(obj.beat);
  const name = typeof obj.name === "string" ? obj.name : null;
  if (beat === null || name === null) return null;
  return { beat, name, notes, ...preserveChordMetadata(value) };
}

function arrangementDurationBeats(data: SongData): number {
  const noteEnd = data.notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  const measureEnd = data.measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0);
  return Math.max(noteEnd, measureEnd, 0);
}

function sourceTimingIdentityPayload(value: SourceTimingMetadata): Omit<SourceTimingMetadata, "sourceFingerprint"> {
  return {
    timeSig: [...value.timeSig] as [number, number],
    measureStartBeat: value.measureStartBeat,
    provenance: value.provenance,
    ...(value.timeSigEvents ? {
      timeSigEvents: value.timeSigEvents.map((event) => ({
        beat: event.beat,
        timeSig: [...event.timeSig] as [number, number],
      })),
    } : {}),
  };
}

function sourceTimingIdentityHash(value: SourceTimingMetadata): string {
  return createHash("sha256").update(JSON.stringify(sourceTimingIdentityPayload(value))).digest("hex");
}

function completePlayerChordDurations(chords: PlayerChord[], durationBeats: number): PlayerChord[] {
  return completeChordDurations(chords, durationBeats);
}

function classifyGeneratedChords(chords: ChordLabel[]): PlayerChord[] {
  return chords.map((chord) => chord.sourceKind === undefined
    ? { ...chord, sourceKind: "generated" as const }
    : chord) as PlayerChord[];
}

/**
 * Merge a normalized chart with generated chords without leaving silent gaps.
 * A chart is allowed to omit a voicing for a symbol; those events are filled
 * from the generated timeline (or from the shared symbol voicer above).
 */
export function mergeChartTimeline(
  timeline: LoadedChordTimeline,
  generated: ChordLabel[],
  arrangementDuration?: number,
): { chords: PlayerChord[]; provenance: LoadedChordTimeline["provenance"] } {
  if (timeline.provenance.kind !== "chart") {
    return {
      chords: completePlayerChordDurations(
        timeline.chords.flatMap((chord) => preserveChord(chord, Array.isArray(chord.notes) ? chord.notes : []) ?? []),
        timeline.durationBeats,
      ),
      provenance: timeline.provenance,
    };
  }

  const chartChords: PlayerChord[] = timeline.chords.flatMap((chord) => {
    // An omitted notes field is safe to voice from the supplied symbol. An
    // explicit empty array means the source intentionally has no voicing, so
    // preserve it as a display-only chart event.
    const supplied = Array.isArray(chord.notes)
      ? chord.notes
      : hasExplicitNotes(chord) ? [] : undefined;
    const notes = supplied ?? (() => {
      try {
        return chordToNotes(chord.name, { octave: 3, bassOctave: 2, includeBass: true });
      } catch {
        return null;
      }
    })();
    // Preserve an authored symbol even when voicing is unsupported. An empty
    // notes array is display-only but still suppresses generated fallback for
    // the chart event's declared duration.
    return preserveChord(chord, notes ?? []) ?? [];
  });

  const generatedFallback = generated.filter((chord) => (
    !chartChords.some((chart) => (
      // Chart material has precedence at an authored event position even if
      // an older artifact omitted its duration.
      chord.beat === chart.beat
      || (chord.beat >= chart.beat && chord.beat < chart.beat + chordDuration(chart))
    ))
  )).map((chord) => {
    const preserved = preserveChord(chord, chord.notes);
    if (!preserved) return null;
    // Legacy notes.json files often omit event provenance. Once an event is
    // selected as chart coverage fallback, its origin is unambiguous: it is
    // generated MIDI material, not an authored chart event.
    return preserved.sourceKind === undefined
      ? { ...preserved, sourceKind: "generated" as const }
      : preserved;
  }).filter((chord): chord is PlayerChord => chord !== null);
  const partial = timeline.coverage !== undefined && timeline.coverage !== "full-song";
  const generatedEnd = generated.reduce((max, chord) => {
    const beat = finite(chord.beat) ?? 0;
    const duration = chordDuration(chord);
    return Math.max(max, beat + duration);
  }, 0);
  const mergeDuration = Math.max(
    timeline.durationBeats,
    generatedEnd,
    typeof arrangementDuration === "number" && Number.isFinite(arrangementDuration) ? arrangementDuration : 0,
  );
  const fallback = timeline.provenance.fallback === true || partial || generatedFallback.length > 0;
  const provenance = fallback
    ? {
        ...timeline.provenance,
        fallback: true,
        fallbackReason: partial
          ? `UG chart covers ${timeline.coverage}; generated chords fill uncovered chart events and the remaining song.`
          : "UG chart had unsupported or unvoiced events; generated chords fill the uncovered positions.",
      }
    : timeline.provenance;

  return {
    chords: completePlayerChordDurations([...chartChords, ...generatedFallback].sort((a, b) => a.beat - b.beat), mergeDuration),
    provenance,
  };
}

/** Build the explicit Auto projection without conflating full authored charts with fallback data. */
export function buildAutoChordSource(
  timeline: Pick<LoadedChordTimeline, "coverage" | "provenance">,
  merged: ReturnType<typeof mergeChartTimeline>,
  ugSource: PlayerSourceOption | null,
): PlayerSourceOption {
  const autoFallback = merged.provenance.fallback === true;
  return {
    id: "auto",
    label: timeline.provenance.sourceRef.startsWith("prepared:") ? "Prepared backing"
      : autoFallback ? (ugSource ? "UG + generated fallback" : "Generated fallback") : ugSource ? "UG timeline" : "Generated fallback",
    chords: merged.chords,
    provenance: ugSource?.provenance ?? merged.provenance.sourceRef ?? null,
    provenanceInfo: merged.provenance,
    coverage: "full-song",
    fallback: autoFallback,
    fallbackReason: autoFallback
      ? merged.provenance.fallbackReason
        ?? (ugSource
          ? `UG chart covers ${timeline.coverage ?? "opening-section"}; generated chords fill uncovered chart events and the remaining song.`
          : "UG chart unavailable; generated chords cover the full song.")
      : null,
  };
}

function prepareGeneratedChordData(data: SongData, level: string): SongData {
  const durationBeats = arrangementDurationBeats(data);
  // Chords always plays Advanced. Its stored per-onset labels are replaced by
  // whole-arrangement harmony unless the artifact carries non-generated labels.
  const chords = level === "a" && data.chords.every((chord) => (chord.sourceKind ?? "generated") === "generated")
    ? inferHarmonyTimeline(data.notes, data.measures, { key: data.key, backingOnly: true })
    : data.chords;
  return {
    ...data,
    chords: completePlayerChordDurations(classifyGeneratedChords(chords), durationBeats),
  };
}

/** Project loaded data through the same detail shape used by the player. */
export function projectChordSources(data: SongData, loadedTimeline: ChordTimelineArtifact | null, level = "a"): SongData {
  const prepared = prepareGeneratedChordData(data, level);
  if (!loadedTimeline) return prepared;
  // Prepared arrangements are tied to exact source bytes and timing. Never
  // reuse one after a different upload/re-ingest, or silently regenerate it.
  const preparedFor = loadedTimeline.provenance.sourceRef.startsWith("prepared:")
    ? loadedTimeline.provenance.sourceRef.slice("prepared:".length) : null;
  if (preparedFor !== null && preparedFor !== data.sourceFingerprint) return prepared;
  const durationBeats = arrangementDurationBeats(prepared);
  const generated = prepared.chords;
  // The midi-derived "chart" is this artifact's stored labels read back from
  // disk; it must carry the same harmony as the generated source.
  const timeline: ChordTimelineArtifact = loadedTimeline.provenance.kind === "midi-derived"
    && preparedFor === null
    && generated.some((chord) => chord.inferenceType === "harmony-window")
    ? { ...loadedTimeline, chords: generated.map((chord) => ({ ...chord, durationBeats: chord.durationBeats ?? 0, sourceKind: "generated" as const })) }
    : loadedTimeline;
  const merged = mergeChartTimeline(timeline, generated, durationBeats);
  const strictChart = timeline.provenance.kind === "chart"
    ? completePlayerChordDurations(
        timeline.chords.flatMap((chord) => preserveChord(chord, Array.isArray(chord.notes) ? chord.notes : []) ?? []),
        timeline.durationBeats,
      )
    : null;
  const generatedSource: PlayerSourceOption = {
    id: "generated",
    label: "Generated chords",
    chords: generated,
    provenance: `variant:${level}:notes.json`,
    provenanceInfo: {
      sourceId: "midi-derived",
      provider: "keyspilli",
      kind: "midi-derived",
      sourceRef: `variant:${level}:notes.json`,
      confidence: "generated",
    },
    coverage: "full-song",
    fallback: false,
    fallbackReason: null,
  };
  const compactGeneratedSource = (({ chords: _chords, ...metadata }) => ({
    ...metadata,
    chordsRef: "data.chords" as const,
  }))(generatedSource);
  const ugSource: PlayerSourceOption | null = strictChart
    ? {
        id: "ug",
        label: timeline.coverage === "opening-section" ? "UG opening (partial)" : "UG timeline",
        chords: strictChart,
        provenance: timeline.provenance.sourceRef,
        provenanceInfo: timeline.provenance,
        coverage: timeline.coverage,
        fallback: false,
        fallbackReason: null,
      }
    : null;
  const autoSource = buildAutoChordSource(timeline, merged, ugSource);
  const metadata = {
    ...prepared,
    chords: generated,
    chordProvenance: merged.provenance,
    chordSources: {
      schemaVersion: 1,
      generated: compactGeneratedSource,
      ug: ugSource,
      auto: autoSource,
    } as unknown as ChordSourceBundle,
  } as SongData;
  if (timeline.provenance.kind === "chart") metadata.ugChordTimeline = strictChart ?? [];
  return metadata;
}

export interface SongDetail {
  /** Existing publication identity; null means this is an explicitly unpinned legacy artifact. */
  publicationRevision: string | null;
  sourceArrangement?: SourceArrangement;
  song: SongRow;
  data: SongData | null;
  /** Advanced source on other levels; Advanced already has it in `data`. */
  chordData: SongData | null;
  chordUnavailableReason: string | null;
  variants: SongRow[];
  artifact: SongArtifactStatus;
}

/**
 * Metadata-only player payload used by direct sheet routes.
 *
 * SheetMusicView loads the immutable MusicXML artifact by id and does not need
 * the notes/chords/measures payload that the interactive player uses. Keeping
 * this shape separate makes it difficult to accidentally put the large
 * `SongData` object back into the sheet route's RSC payload.
 */
export interface SongDetailShell {
  publicationRevision: string | null;
  sourceArrangement?: SourceArrangement;
  song: SongRow;
  variants: SongRow[];
}

export type SongArtifactStatus =
  | { status: "legacy"; errors: []; manifest?: undefined }
  | { status: "valid"; errors: []; manifest: ArrangementManifest }
  | { status: "unavailable"; errors: string[]; manifest?: ArrangementManifest };

export class PublicationRevisionConflictError extends Error {
  constructor() {
    super("publication changed; reload and retry");
    this.name = "PublicationRevisionConflictError";
  }
}

async function readPublicationRevision(baseId: string): Promise<string | null> {
  try { return await artifactPublicationRevision(baseId, join(dataDir(), "artifacts")); }
  catch { throw new PublicationRevisionConflictError(); }
}

function hasPublicationJournal(baseId: string): boolean {
  return existsSync(join(dataDir(), "artifacts", `.${baseId}.reconciliation.json`));
}

export async function withStablePublication<T>(
  baseId: string,
  requiredRevision: string | null | undefined,
  read: () => Promise<T>,
): Promise<{ value: T; publicationRevision: string | null }> {
  for (let attempt = 0; attempt < (requiredRevision === undefined ? 2 : 1); attempt += 1) {
    if (hasPublicationJournal(baseId)) throw new PublicationRevisionConflictError();
    const before = await readPublicationRevision(baseId);
    if (requiredRevision !== undefined && before !== requiredRevision) throw new PublicationRevisionConflictError();
    const value = await read();
    const after = await readPublicationRevision(baseId);
    if (!hasPublicationJournal(baseId) && before === after && (requiredRevision === undefined || after === requiredRevision)) {
      return { value, publicationRevision: before };
    }
  }
  throw new PublicationRevisionConflictError();
}

/**
 * Validated exports are immutable until their atomic artifact publication
 * changes one of the files below. Keeping a small LRU here avoids reparsing
 * the same large MIDI/XML pair for every download while retaining a bounded
 * memory footprint and a signature check on every request.
 */
interface ArtifactCacheEntry {
  midi: Buffer;
  xml: Buffer;
}

const ARTIFACT_CACHE_LIMIT = 32;
const ARTIFACT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const artifactCache = new Map<string, ArtifactCacheEntry>();
let artifactCacheBytes = 0;

function artifactFileSignature(path: string): string {
  try {
    const stat = statSync(path, { bigint: true });
    // Artifact publication replaces files atomically. Device/inode catches a
    // same-size replacement while mtime/size also detect in-place edits.
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  } catch {
    // Missing files must be part of the key so a later publish is observable.
    return `${path}:missing`;
  }
}

function artifactCacheKey(song: SongRow): string {
  const dir = artifactsDir(song.baseId, song.level);
  return JSON.stringify({
    // These are the database mirrors used to construct the validation
    // variant. `plays` is intentionally omitted: recording a play should not
    // evict an otherwise immutable export.
    song: [song.id, song.baseId, song.level, song.difficulty, song.difficultyScore, song.bassPattern, song.tempo],
    files: [
      artifactFileSignature(join(dir, "notes.json")),
      artifactFileSignature(join(dir, "variant.mid")),
      artifactFileSignature(join(dir, "variant.xml")),
      artifactFileSignature(arrangementManifestPath(song.baseId)),
      artifactFileSignature(join(dataDir(), "artifacts", song.baseId, ".publication-id")),
      artifactFileSignature(join(dataDir(), "artifacts", `.${song.baseId}.reconciliation.json`)),
    ],
  });
}

function cachedArtifact(entry: ArtifactCacheEntry, name: "variant.mid" | "variant.xml"): Buffer {
  // Return a copy so callers cannot mutate the process-wide cache.
  return Buffer.from(name === "variant.mid" ? entry.midi : entry.xml);
}

function rememberArtifact(key: string, entry: ArtifactCacheEntry): void {
  const previous = artifactCache.get(key);
  if (previous) artifactCacheBytes -= previous.midi.byteLength + previous.xml.byteLength;
  artifactCache.delete(key);
  artifactCache.set(key, entry);
  artifactCacheBytes += entry.midi.byteLength + entry.xml.byteLength;
  while (artifactCache.size > ARTIFACT_CACHE_LIMIT || artifactCacheBytes > ARTIFACT_CACHE_MAX_BYTES) {
    const oldest = artifactCache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = artifactCache.get(oldest);
    if (evicted) artifactCacheBytes -= evicted.midi.byteLength + evicted.xml.byteLength;
    artifactCache.delete(oldest);
  }
}

function unavailableArtifact(errors: string[], manifest?: ArrangementManifest): SongArtifactStatus {
  return { status: "unavailable", errors, ...(manifest ? { manifest } : {}) };
}

export async function loadSongArtifact(song: Pick<SongRow, "id" | "baseId" | "level" | "tempo">): Promise<{ data: SongData | null; artifact: SongArtifactStatus }> {
  if (existsSync(join(dataDir(), "artifacts", `.${song.baseId}.reconciliation.json`))) {
    return { data: null, artifact: unavailableArtifact(["ARTIFACT_RECONCILIATION_REQUIRED"]) };
  }
  const manifestRead = await readArrangementManifest(song.baseId);
  if (manifestRead.status === "invalid") {
    return { data: null, artifact: unavailableArtifact(manifestRead.errors) };
  }
  const manifest = manifestRead.status === "valid" ? manifestRead.manifest : null;
  if (manifest && manifest.baseId !== song.baseId) {
    return {
      data: null,
      artifact: unavailableArtifact([`manifest baseId ${manifest.baseId} does not match ${song.baseId}`], manifest),
    };
  }

  const notesPath = join(artifactsDir(song.baseId, song.level), "notes.json");
  let stored: SongData;
  let notesContent: string;
  try {
    notesContent = await readFile(notesPath, "utf8");
    stored = JSON.parse(notesContent) as SongData;
  } catch {
    return {
      data: null,
      artifact: unavailableArtifact([`missing or corrupt ${song.level}/notes.json`], manifest ?? undefined),
    };
  }
  const playbackErrors = validatePlaybackData(stored);
  if (playbackErrors.length > 0) {
    return { data: null, artifact: unavailableArtifact(playbackErrors, manifest ?? undefined) };
  }

  const tempo = resolveArtifactPlaybackTempo(manifest, stored.tempoBpm, song.tempo);
  if (tempo.status === "invalid") {
    return { data: null, artifact: unavailableArtifact(tempo.errors, manifest ?? undefined) };
  }
  // The manifest is authoritative when present. Assigning the resolved value
  // here keeps downstream playback and seek code on the same runtime value;
  // the equality check above prevents this from masking a stale mirror.
  const notesFingerprint = manifest?.sourceArtifactHash
    ? `variant:${song.baseId}:${song.level}:${song.id}:${manifest.sourceArtifactHash}:notes:${createHash("sha256").update(notesContent).digest("hex")}`
    : stored.sourceFingerprint;
  // Source phase is a sidecar identity, not part of notes.json. Including its
  // canonical payload in the loaded identity makes phase edits invalidate
  // saved melody choices without creating a self-referential hash.
  const manifestTiming = manifest?.sourceArtifactHash && manifest.sourceTiming
    ? manifest.sourceTiming[song.id]
    : undefined;
  const loadedSourceFingerprint = manifestTiming && notesFingerprint
    ? `${notesFingerprint}:timing:${sourceTimingIdentityHash(manifestTiming)}`
    : notesFingerprint;
  const timingCandidate = manifestTiming ?? record(stored.sourceTiming);
  const validatedSourceTiming = validateSparseBackingTiming(
    timingCandidate,
    loadedSourceFingerprint,
    arrangementDurationBeats(stored),
  );
  const sourceTiming = validatedSourceTiming
    ? playbackTiming({ ...stored, sourceTiming: validatedSourceTiming })
    : undefined;
  const { sourceTiming: _storedSourceTiming, ...storedWithoutTiming } = stored;
  const data = {
    ...storedWithoutTiming,
    tempoBpm: tempo.bpm,
    ...(manifest?.sourceArtifactHash ? {
      // The manifest hash identifies the original source bytes and can stay
      // stable when a variant's derived notes are regenerated. Include the
      // loaded notes content so a saved melody choice cannot survive variant
      // drift, while retaining row identity across shared source variants.
      sourceFingerprint: loadedSourceFingerprint,
    } : {}),
    ...(sourceTiming ? { sourceTiming } : {}),
  };
  // Compute heuristic sections at load time so the player can offer practice
  // navigation without requiring every checked-in artifact to carry metadata.
  if (!data.sections && data.measures.length > 0) {
    try {
      data.sections = detectSections(data.notes, data.measures, data.timeSig);
    } catch {
      // Section detection is best-effort; never block song loading on it.
    }
  }
  if (tempo.status === "legacy") {
    return { data, artifact: { status: "legacy", errors: [] } };
  }
  return { data, artifact: { status: "valid", errors: [], manifest: tempo.manifest } };
}

/** Attach the chord sources a Player sees for one loaded level. */
export async function withChordSources(source: SongData, baseId: string, level: string): Promise<SongData> {
  try {
    const timeline = await loadChordTimeline(baseId, { fallbackLevel: level });
    // A chart timed to a different recording cannot label the source player's bars.
    return projectChordSources(source, timeline?.tempoBpm !== undefined && timeline.tempoBpm !== source.tempoBpm ? null : timeline, level);
  } catch {
    // An optional chart must never prevent the arrangement from loading.
    return projectChordSources(source, null, level);
  }
}

/**
 * Load the complete player payload without memoization.
 *
 * The exported wrapper below adds React request memoization. Keeping the
 * implementation separate makes the freshness boundary explicit: this
 * function still reads the current database, policy files, manifest, and
 * artifact on a new request, while repeated calls for the same id during one
 * server render (for example `generateMetadata` followed by the page) share
 * one result.
 */
async function loadSongDetailUncached(id: string, requiredRevision?: string | null, inspectedBaseId?: string): Promise<SongDetail | null> {
  const lookup = () => inspectedBaseId ? getSongsByBase(inspectedBaseId).find(row=>row.id === id) : getSong(id);
  const song = lookup();
  if (!song) return null;
  const stable = await withStablePublication(song.baseId, requiredRevision, async () => {
  const currentSong = lookup();
  if (!currentSong || currentSong.baseId !== song.baseId) return null;
  const loaded = await loadSongArtifact(currentSong);
  let data = loaded.data;
  const variants = getSongsByBase(song.baseId);
  const advanced = variants.find((variant) => variant.level === "a");
  const advancedData = advanced
    ? advanced.id === song.id ? loaded.data : (await loadSongArtifact(advanced)).data
    : null;
  const sharesTimeline = (left: SongData, right: SongData) =>
    left.tempoBpm === right.tempoBpm
    && left.timeSig[0] === right.timeSig[0]
    && left.timeSig[1] === right.timeSig[1]
    && JSON.stringify(left.timeSigEvents ?? []) === JSON.stringify(right.timeSigEvents ?? [])
    && left.measures.slice(0, Math.min(left.measures.length, right.measures.length))
      .every((measure, index) => measure.startBeat === right.measures[index]!.startBeat
        && measure.endBeat === right.measures[index]!.endBeat);
  const chordUnavailableReason = !advancedData
    ? "The Advanced arrangement is unavailable."
    : data && !sharesTimeline(data, advancedData)
      ? "The Advanced arrangement has different timing from this level."
      : null;
  let chordData = chordUnavailableReason || advanced?.id === song.id ? null : advancedData;
  if (data) {
    // Each level retains its own Original chart; Chords always uses Advanced.
    [data, chordData] = await Promise.all([
      withChordSources(data, song.baseId, song.level),
      chordData ? withChordSources(chordData, song.baseId, "a") : Promise.resolve(null),
    ]);
    if (song.baseId === "rousseau-john-legend-all-of-me-piano-cover-mslwrq3x" && !chordUnavailableReason) {
      const chart = await loadChordTimeline(song.baseId, { fallbackLevel: "a" });
      if (chart?.tempoBpm === 126 && chart.timeSig[0] === 4 && chart.timeSig[1] === 4) {
        // The reviewed Chords target is the official recording; Original remains the Rousseau cover.
        chordData = projectChordSources({
          notes: [], chords: [], measures: arithmeticMeasures(chart.durationBeats, chart.timeSig),
          key: chart.key ?? advancedData?.key ?? data.key, tempoBpm: chart.tempoBpm, timeSig: chart.timeSig,
        }, chart, "a");
      }
    }
    if (song.baseId === "the-beatles-help" && !chordUnavailableReason && advancedData?.sourceFingerprint === "variant:the-beatles-help:a:the-beatles-help-a:278f693cc9859cedee170d7709c49b5e7a1c98de632ea3ed34092c7bff05279a:notes:5c8415696a87858a486835db81e4904e7d8ce71d4f4bdc9f29dbe73cad4b5e55") {
      const chart = await loadChordTimeline(song.baseId, { fallbackLevel: "a" });
      if (chart?.tempoBpm === 173 && chart.durationBeats === 436) {
        // The source's beat grid matches the Beatles recording at 190 BPM; keep Original at 173.
        chordData = projectChordSources({ ...advancedData, tempoBpm: 190 }, { ...chart, tempoBpm: 190 }, "a");
      }
    }
    if (song.baseId === "ozzy-osbourne-dreamer" && !chordUnavailableReason) {
      const chart = await loadChordTimeline(song.baseId, { fallbackLevel: "a" });
      if (chart?.tempoBpm === 80 && chart.chords[0]?.beat === 0 && chart.chords[0]?.name === "N.C.") {
        // The tutorial's extracted blue lane contains false adjacent keys; Chords uses the reviewed chart.
        // The official video's performance starts 1.65s later than the tutorial (2.2 beats at 80 BPM).
        const offset = 2.2;
        const officialChart = {
          ...chart,
          durationBeats: chart.durationBeats + offset,
          chords: chart.chords.map((chord, index) => index === 0
            ? { ...chord, durationBeats: chord.durationBeats + offset }
            : { ...chord, beat: chord.beat + offset }),
        };
        chordData = projectChordSources({
          notes: [], chords: [],
          measures: arithmeticMeasures(officialChart.durationBeats, chart.timeSig)
            .map((measure) => ({ ...measure, endBeat: Math.min(measure.endBeat, officialChart.durationBeats) })),
          key: chart.key ?? advancedData?.key ?? data.key, tempoBpm: chart.tempoBpm, timeSig: chart.timeSig,
        }, officialChart, "a");
      }
    }
  }
  const sourceArrangement = loaded.artifact.manifest?.sourceArrangement;
  return { song: currentSong, data, chordData, chordUnavailableReason, variants, artifact: loaded.artifact, ...(sourceArrangement ? { sourceArrangement } : {}) };
  });
  return stable.value ? { ...stable.value, publicationRevision: stable.publicationRevision } : null;
}

/**
 * Request-local detail memoization for RSC/Next metadata + page rendering.
 *
 * React's `cache` scope is the current server request, rather than a process
 * cache, so mutable catalog/policy changes remain visible on the next
 * request. This is intentionally not `unstable_cache`/a persistent cache.
 */
export const getSongDetail = cache((id: string, revision?: string | null) => loadSongDetailUncached(id,revision));

/** Owner-authorized inspection only; never used by public song/player routes. */
export function getOwnerSongDetail(baseId: string, id: string, revision: string) {
  return loadSongDetailUncached(id,revision,baseId);
}

async function loadSongDetailShellUncached(id: string, requiredRevision?: string | null): Promise<SongDetailShell | null> {
  const song = getSong(id);
  if (!song) return null;
  const stable = await withStablePublication(song.baseId, requiredRevision, async () => {
    const currentSong = getSong(id);
    if (!currentSong || currentSong.baseId !== song.baseId) return null;
    const saved = await readArrangementManifest(song.baseId);
    const sourceArrangement = saved.status === "valid" ? saved.manifest.sourceArrangement : undefined;
    return { song: currentSong, variants: getSongsByBase(song.baseId), ...(sourceArrangement ? { sourceArrangement } : {}) };
  });
  return stable.value ? { ...stable.value, publicationRevision: stable.publicationRevision } : null;
}

/** Request-local metadata-only loader for direct sheet pages. */
export const getSongDetailShell = cache(loadSongDetailShellUncached);

export type VersionedArtifactFile = { data: Buffer; publicationRevision: string | null };

export async function getArtifactFileWithRevision(
  id: string,
  name: "variant.mid" | "variant.xml",
  requiredRevision?: string | null,
): Promise<VersionedArtifactFile | null> {
  const rootSong = getSong(id);
  if (!rootSong) return null;
  const stable = await withStablePublication(rootSong.baseId, requiredRevision, async () => {
  const song = getSong(id);
  if (!song || song.baseId !== rootSong.baseId) return null;
  const before = artifactCacheKey(song);
  const cacheKey = before;
  const cached = artifactCache.get(cacheKey);
  if (cached) {
    // Refresh the LRU position without changing the bounded cache size.
    const signature = artifactFileSignature(join(artifactsDir(song.baseId, song.level), name));
    if (artifactCacheKey(song) !== cacheKey) throw new PublicationRevisionConflictError();
    rememberArtifact(cacheKey, cached);
    return { data: cachedArtifact(cached, name), signature };
  }
  // Exports are another runtime boundary: never serve a MIDI/XML artifact
  // whose manifest or denormalized tempo mirrors would make the player reject
  // the same arrangement.
  const loaded = await loadSongArtifact(song);
  if (!loaded.data) return null;
  const dir = artifactsDir(song.baseId, song.level);
  try {
    // Validate both rendered forms against the selected notes.json before
    // serving either one. This closes the gap where a stale export could be
    // downloaded even though the player correctly uses the canonical notes.
    const [midi, xml] = await Promise.all([
      readFile(join(dir, "variant.mid")),
      readFile(join(dir, "variant.xml"), "utf8"),
    ]);
    const variant: Variant = {
      level: song.difficulty as Variant["level"],
      difficultyScore: song.difficultyScore,
      notes: loaded.data.notes,
      chords: loaded.data.chords,
      bassPattern: song.bassPattern,
      key: loaded.data.key,
      tempoBpm: loaded.data.tempoBpm,
      timeSig: loaded.data.timeSig,
      timeSigEvents: loaded.data.timeSigEvents,
      sourcePedal:loaded.data.sourcePedal,
      measures: loaded.data.measures,
    };
    if (validateArtifactFiles(variant, { midi, xml }).length > 0) return null;
    const entry: ArtifactCacheEntry = { midi, xml: Buffer.from(xml, "utf8") };
    // Reject a changed pair even for legacy data, which has no durable revision token.
    const data = cachedArtifact(entry, name);
    const signature = artifactFileSignature(join(dir, name));
    if (artifactCacheKey(song) !== cacheKey) throw new PublicationRevisionConflictError();
    rememberArtifact(cacheKey, entry);
    return { data, signature };
  } catch (error) {
    if (error instanceof PublicationRevisionConflictError) throw error;
    return null;
  }
  });
  if (!stable.value) return null;
  const signature = artifactFileSignature(join(artifactsDir(rootSong.baseId, rootSong.level), name));
  if (signature !== stable.value.signature) throw new PublicationRevisionConflictError();
  return { data: stable.value.data, publicationRevision: stable.publicationRevision };
}

export async function getArtifactFile(
  id: string,
  name: "variant.mid" | "variant.xml",
  requiredRevision?: string | null,
): Promise<Buffer | null> {
  return (await getArtifactFileWithRevision(id, name, requiredRevision))?.data ?? null;
}

export type ArtifactFileMetadata = {
  data: Buffer;
  etag: string;
  lastModified: string;
  publicationRevision: string | null;
};

/**
 * Load an immutable artifact together with validators for HTTP responses.
 *
 * Artifact publication is atomic, so the file signature is a useful stable
 * validator without hashing a multi-megabyte MusicXML document on every
 * request. Retry once if a publication races the read so the body and
 * validators describe the same version.
 */
export async function getArtifactFileWithMetadata(
  id: string,
  name: "variant.mid" | "variant.xml",
  requiredRevision?: string | null,
): Promise<ArtifactFileMetadata | null> {
  const song = getSong(id);
  if (!song) return null;
  const path = join(artifactsDir(song.baseId, song.level), name);
  const stable = await withStablePublication(song.baseId, requiredRevision, async () => {
    const before = artifactFileSignature(path);
    const loaded = await getArtifactFileWithRevision(id, name, requiredRevision);
    if (!loaded) return null;
    try {
      const stat = statSync(path, { bigint: true });
      const after = artifactFileSignature(path);
      if (before !== after) throw new PublicationRevisionConflictError();
      const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
      return {
        data: loaded.data,
        etag: `"${createHash("sha256").update(fingerprint).digest("hex")}"`,
        lastModified: new Date(Number(stat.mtimeMs)).toUTCString(),
      };
    } catch (error) {
      if (error instanceof PublicationRevisionConflictError) throw error;
      return null;
    }
  });
  return stable.value ? { ...stable.value, publicationRevision: stable.publicationRevision } : null;
}
