import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cache } from "react";
import {
  arrangementManifestPath,
  artifactsDir,
  getSong,
  getSongsByBase,
  loadChordTimeline,
  readArrangementManifest,
  resolveArtifactPlaybackTempo,
  type ArrangementManifest,
  type SongRow,
} from "@keyspilli/catalog";
import { chordToNotes, validateArtifactFiles, type ChordLabel, type Variant } from "@keyspilli/midi";
import { completeChordDurations, detectSections, type ChordSourceBundle, type ChordSourceTimeline, type SongData } from "@keyspilli/player-core";

type LoadedChordTimeline = NonNullable<Awaited<ReturnType<typeof loadChordTimeline>>>;
type PlayerChord = Omit<ChordLabel, "sourceKind" | "inferred" | "inferenceType" | "durationBeats"> & {
  sourceKind?: "authored" | "inferred" | "generated" | "unknown";
  inferred?: boolean;
  inferenceType?: "dyad-completion" | "carry-forward-root" | "nearest-symbol" | "subbeat-extension" | "voicing";
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

  const durationBeats = finite(obj.durationBeats);
  const duration = finite(obj.duration);
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
    label: autoFallback ? "UG + generated fallback" : ugSource ? "UG timeline" : "Generated fallback",
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

export interface SongDetail {
  song: SongRow;
  data: SongData | null;
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
  song: SongRow;
  variants: SongRow[];
}

export type SongArtifactStatus =
  | { status: "legacy"; errors: []; manifest?: undefined }
  | { status: "valid"; errors: []; manifest: ArrangementManifest }
  | { status: "unavailable"; errors: string[]; manifest?: ArrangementManifest };

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

export async function loadSongArtifact(song: SongRow): Promise<{ data: SongData | null; artifact: SongArtifactStatus }> {
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
  try {
    stored = JSON.parse(await readFile(notesPath, "utf8")) as SongData;
  } catch {
    return {
      data: null,
      artifact: unavailableArtifact([`missing or corrupt ${song.level}/notes.json`], manifest ?? undefined),
    };
  }

  const tempo = resolveArtifactPlaybackTempo(manifest, stored.tempoBpm, song.tempo);
  if (tempo.status === "invalid") {
    return { data: null, artifact: unavailableArtifact(tempo.errors, manifest ?? undefined) };
  }
  // The manifest is authoritative when present. Assigning the resolved value
  // here keeps downstream playback and seek code on the same runtime value;
  // the equality check above prevents this from masking a stale mirror.
  const data = { ...stored, tempoBpm: tempo.bpm };
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
async function loadSongDetailUncached(id: string): Promise<SongDetail | null> {
  const song = getSong(id);
  if (!song) return null;
  const loaded = await loadSongArtifact(song);
  let data = loaded.data;
  if (data) {
    // The duration is derived from the immutable note/measure arrays and is
    // reused by each chord projection below. Avoid scanning the full
    // arrangement once per projection on large songs.
    const durationBeats = arrangementDurationBeats(data);
    // Newer payloads expose an explicit generated source even when no chart
    // exists. Complete known generated events here; the player keeps a
    // legacy wall-clock fallback only for unclassified old events.
    data = {
      ...data,
      chords: completePlayerChordDurations(classifyGeneratedChords(data.chords), durationBeats),
    };
    // Chord charts live beside the immutable app image rather than in the
    // mutable song database. Keep the existing generated timeline intact and
    // expose a separate source timeline only when a verified chart exists.
    try {
      const timeline = await loadChordTimeline(song.baseId, { fallbackLevel: song.level });
      if (timeline) {
        const generated = completePlayerChordDurations(data.chords, durationBeats);
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
          provenance: `variant:${song.level}:notes.json`,
          provenanceInfo: {
            sourceId: "midi-derived",
            provider: "keyspilli",
            kind: "midi-derived",
            sourceRef: `variant:${song.level}:notes.json`,
            confidence: "generated",
          },
          coverage: "full-song",
          fallback: false,
          fallbackReason: null,
        };
        // `data.chords` is the legacy/generated projection consumed by the
        // player and simplified export. It is byte-for-byte identical to the
        // generated source above, so retain one canonical copy and let the
        // web boundary resolve this explicit reference. The compact marker is
        // intentionally scoped to the generated source; authored/auto
        // timelines remain self-contained and independently parity-testable.
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
          ...data,
          chords: generated,
          chordProvenance: merged.provenance,
          chordSources: {
            schemaVersion: 1,
            generated: compactGeneratedSource,
            ug: ugSource,
            auto: autoSource,
          } as unknown as ChordSourceBundle,
        } as SongData & { chordProvenance?: unknown; ugChordTimeline?: unknown };
        if (timeline.provenance.kind === "chart") {
          // Backward compatibility: this field is now strict chart material;
          // the hybrid projection is available under chordSources.auto.
          metadata.ugChordTimeline = strictChart ?? [];
        } else if (timeline.provenance.kind === "midi-derived") {
          // Legacy notes.json files predate event-level provenance. The
          // normalized MIDI-derived projection is the authoritative shape at
          // this boundary: it stamps those events as generated and preserves
          // their computed durations and optional inference metadata. Keep UG
          // chart material separate in ugChordTimeline above.
          metadata.chords = generated;
        }
        data = metadata;
      }
    } catch {
      // A missing/invalid optional chart must never make a normal song fail to
      // load; the player will use its generated chord fallback.
    }
  }
  const variants = getSongsByBase(song.baseId);
  return { song, data, variants, artifact: loaded.artifact };
}

/**
 * Request-local detail memoization for RSC/Next metadata + page rendering.
 *
 * React's `cache` scope is the current server request, rather than a process
 * cache, so mutable catalog/policy changes remain visible on the next
 * request. This is intentionally not `unstable_cache`/a persistent cache.
 */
export const getSongDetail = cache(loadSongDetailUncached);

async function loadSongDetailShellUncached(id: string): Promise<SongDetailShell | null> {
  const song = getSong(id);
  if (!song) return null;
  return { song, variants: getSongsByBase(song.baseId) };
}

/** Request-local metadata-only loader for direct sheet pages. */
export const getSongDetailShell = cache(loadSongDetailShellUncached);

export async function getArtifactFile(id: string, name: "variant.mid" | "variant.xml"): Promise<Buffer | null> {
  const song = getSong(id);
  if (!song) return null;
  const cacheKey = artifactCacheKey(song);
  const cached = artifactCache.get(cacheKey);
  if (cached) {
    // Refresh the LRU position without changing the bounded cache size.
    rememberArtifact(cacheKey, cached);
    return cachedArtifact(cached, name);
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
      measures: loaded.data.measures,
    };
    if (validateArtifactFiles(variant, { midi, xml }).length > 0) return null;
    const entry: ArtifactCacheEntry = { midi, xml: Buffer.from(xml, "utf8") };
    // Do not cache an entry if publication changed a file while it was being
    // read/validated. The current request may still return the bytes it
    // validated, but the next request must perform a fresh read.
    if (artifactCacheKey(song) === cacheKey) rememberArtifact(cacheKey, entry);
    return cachedArtifact(entry, name);
  } catch {
    return null;
  }
}

export type ArtifactFileMetadata = {
  data: Buffer;
  etag: string;
  lastModified: string;
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
): Promise<ArtifactFileMetadata | null> {
  const song = getSong(id);
  if (!song) return null;
  const path = join(artifactsDir(song.baseId, song.level), name);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = artifactFileSignature(path);
    const data = await getArtifactFile(id, name);
    if (!data) return null;
    const after = artifactFileSignature(path);
    if (before !== after) continue;

    try {
      const stat = statSync(path, { bigint: true });
      const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
      return {
        data,
        etag: `"${createHash("sha256").update(fingerprint).digest("hex")}"`,
        lastModified: new Date(Number(stat.mtimeMs)).toUTCString(),
      };
    } catch {
      return null;
    }
  }

  return null;
}
