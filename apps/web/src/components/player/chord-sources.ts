import { chordToNotes, type ChordLabel } from "@keyspilli/midi";
import type { SongData } from "@keyspilli/player-core";

/**
 * The player can receive an optional source timeline without making the
 * catalogue format a hard dependency of the UI.  Keep this shape deliberately
 * small: a beat position, a display name, and the MIDI notes used to voice the
 * chord.  The normalizer below accepts the current artifact shape as well as
 * the source-oriented aliases used by older/newer exports.
 */
export type ChordSourceId = "auto" | "ug" | "generated";

/**
 * Chord metadata is optional because older notes.json artifacts only contain
 * beat/name/notes. Keep the web boundary permissive so newer catalog events
 * do not lose provenance while they are normalized for playback.
 */
export interface PlayerChordMetadata {
  sourceKind?: "authored" | "inferred" | "generated" | "unknown";
  inferred?: boolean;
  inferenceType?: "dyad-completion" | "carry-forward-root" | "nearest-symbol" | "subbeat-extension" | "voicing";
  duration?: number;
  durationBeats?: number;
}

export type PlayerChordLabel = Omit<ChordLabel, keyof PlayerChordMetadata> & PlayerChordMetadata;

export interface ChordSourceOption {
  id: Exclude<ChordSourceId, "auto">;
  label: string;
  chords: PlayerChordLabel[];
  provenance: string | null;
  fallback: boolean;
  fallbackReason: string | null;
}

export interface ChordSourceResolution {
  generated: ChordSourceOption;
  ug: ChordSourceOption | null;
}

export interface SelectedChordSource {
  source: ChordSourceOption | null;
  requested: ChordSourceId;
  fallback: boolean;
  fallbackReason: string | null;
}

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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUgText(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const haystack = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /(?:ultimate\s*guitar|ultimateguitar|ug[-_ ]?tabs|\bug\b)/i.test(haystack);
}

function describeProvenance(value: unknown): string | null {
  const direct = text(value);
  if (direct) return direct;
  const obj = record(value);
  if (!obj) return null;
  for (const key of ["label", "source", "sourceRef", "sourceUrl", "sourceYoutubeUrl", "acquiredVia", "kind", "provider"]) {
    const found = text(obj[key]);
    if (found) return found;
  }
  return null;
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "number") return item;
      if (typeof item === "string") return finite(item);
      const obj = record(item);
      return obj ? finite(obj.midi ?? obj.pitch ?? obj.note) : null;
    })
    .filter((item): item is number => item !== null && Number.isInteger(item) && item >= 0 && item <= 127);
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Keep event-level provenance and duration aliases when crossing into UI data. */
function preservedMetadata(obj: UnknownRecord): PlayerChordMetadata {
  const metadata: PlayerChordMetadata = {};
  if (typeof obj.sourceKind === "string" && obj.sourceKind.trim()) {
    metadata.sourceKind = obj.sourceKind as NonNullable<PlayerChordMetadata["sourceKind"]>;
  }
  if (typeof obj.inferred === "boolean") metadata.inferred = obj.inferred;
  if (typeof obj.inferenceType === "string" && obj.inferenceType.trim()) {
    metadata.inferenceType = obj.inferenceType as NonNullable<PlayerChordMetadata["inferenceType"]>;
  }

  const durationBeats = finite(obj.durationBeats);
  const duration = finite(obj.duration);
  if (durationBeats !== null && durationBeats > 0) metadata.durationBeats = durationBeats;
  if (duration !== null && duration > 0) {
    metadata.duration = duration;
    // Some source exports call the beat span `duration`; keep the source key
    // and also expose the player-native alias used by PlaybackEngine.
    if (metadata.durationBeats === undefined) metadata.durationBeats = duration;
  }
  return metadata;
}

function metadataKey(chord: PlayerChordLabel): string {
  return JSON.stringify([
    chord.sourceKind ?? null,
    chord.inferred ?? null,
    chord.inferenceType ?? null,
    chord.duration ?? null,
    chord.durationBeats ?? null,
  ]);
}

function sourceRank(chord: PlayerChordLabel): number {
  if (chord.sourceKind === "authored") return 3;
  if (chord.sourceKind === "inferred") return 2;
  if (chord.sourceKind === "generated") return 1;
  return 0;
}

function chordFingerprint(chord: PlayerChordLabel): string {
  return JSON.stringify([
    chord.beat,
    chord.durationBeats ?? chord.duration ?? 0,
    chord.sourceKind ?? "unknown",
    chord.name,
    [...chord.notes].sort((a, b) => a - b),
    chord.inferred ?? false,
    chord.inferenceType ?? "",
  ]);
}

function preferSameBeat(previous: PlayerChordLabel, candidate: PlayerChordLabel): PlayerChordLabel {
  const previousRank = sourceRank(previous);
  const candidateRank = sourceRank(candidate);
  if (candidateRank !== previousRank) return candidateRank > previousRank ? candidate : previous;

  // Authority comes before voicing richness: an authored display-only symbol
  // still suppresses generated material at the same onset.
  const previousPlayable = previous.notes.length > 0;
  const candidatePlayable = candidate.notes.length > 0;
  if (candidatePlayable !== previousPlayable) return candidatePlayable ? candidate : previous;

  // Preserve more authored/inferred detail, while keeping generated learner
  // voicings compact when the source rank is otherwise tied.
  if (candidateRank >= 2 && candidate.notes.length !== previous.notes.length) {
    return candidate.notes.length > previous.notes.length ? candidate : previous;
  }
  if (candidateRank === 1 && candidate.notes.length !== previous.notes.length) {
    return candidate.notes.length < previous.notes.length ? candidate : previous;
  }

  const previousDuration = previous.durationBeats ?? previous.duration ?? 0;
  const candidateDuration = candidate.durationBeats ?? candidate.duration ?? 0;
  if (candidateDuration !== previousDuration) return candidateDuration > previousDuration ? candidate : previous;
  return chordFingerprint(candidate) < chordFingerprint(previous) ? candidate : previous;
}

function chordArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const obj = record(value);
  if (!obj) return [];
  for (const key of ["chords", "timeline", "entries", "events", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return [];
}

/** Normalize source events while preserving explicitly supplied chord names. */
export function normalizeChordTimeline(
  value: unknown,
  legacySourceKind?: PlayerChordMetadata["sourceKind"],
): PlayerChordLabel[] {
  const out: PlayerChordLabel[] = [];
  for (const item of chordArray(value)) {
    const obj = record(item);
    if (!obj) continue;
    const beat = finite(obj.beat ?? obj.startBeat ?? obj.start ?? obj.time);
    if (beat === null || beat < 0) continue;
    const explicitNotesKey = ["notes", "midis", "pitches", "midiNotes"].find((key) => hasOwn(obj, key));
    const hasExplicitNotes = explicitNotesKey !== undefined || hasOwn(obj, "midi") || hasOwn(obj, "pitch");
    let notes = numberList(explicitNotesKey === undefined ? undefined : obj[explicitNotesKey]);
    if (!notes.length && (hasOwn(obj, "midi") || hasOwn(obj, "pitch"))) {
      const single = finite(obj.midi ?? obj.pitch);
      if (single !== null && Number.isInteger(single) && single >= 0 && single <= 127) notes.push(single);
    }
    // Chart timelines may intentionally omit a voicing and provide only a
    // validated symbol. Use the shared MIDI chord helper for a stable learner
    // voicing instead of dropping an otherwise usable source event.
    if (!notes.length && !hasExplicitNotes) {
      const symbol = text(obj.name ?? obj.label ?? obj.chord ?? obj.symbol);
      if (symbol) {
        try {
          notes = chordToNotes(symbol, { octave: 3, bassOctave: 2, includeBass: true });
        } catch {
          // An unsupported source symbol remains visible only when it has a
          // playable voicing; silently ignoring it is safer than bad audio.
        }
      }
    }
    const name = text(obj.name ?? obj.label ?? obj.chord ?? obj.symbol) ?? "Chord";
    const metadata = preservedMetadata(obj);
    if (metadata.sourceKind === undefined && legacySourceKind !== undefined) {
      metadata.sourceKind = legacySourceKind;
    }
    out.push({ beat, name, notes, ...metadata });
  }

  out.sort((a, b) => a.beat - b.beat);
  // Resolve same-onset conflicts before compaction. Source authority must not
  // depend on array arrival order (especially for authored-vs-generated data).
  const byBeat: PlayerChordLabel[] = [];
  for (const chord of out) {
    const previous = byBeat.at(-1);
    if (previous && previous.beat === chord.beat) byBeat[byBeat.length - 1] = preferSameBeat(previous, chord);
    else byBeat.push(chord);
  }

  // Source exports can repeat the same symbol at every subdivision. Keep the
  // first event only when the voicing and provenance are also unchanged; an
  // inversion, octave change, or source decision is musically meaningful.
  const deduped: PlayerChordLabel[] = [];
  for (const chord of byBeat) {
    const previous = deduped.at(-1);
    if (
      previous
      && previous.name === chord.name
      && JSON.stringify(previous.notes) === JSON.stringify(chord.notes)
      && metadataKey(previous) === metadataKey(chord)
    ) continue;
    deduped.push(chord);
  }
  return deduped;
}

function provenanceCandidates(data: UnknownRecord): unknown[] {
  const out: unknown[] = [
    data.chordProvenance,
    data.chordsProvenance,
    data.provenance,
    data.source,
    data.sourceRef,
  ];
  const provenance = record(data.provenance);
  if (provenance) {
    out.push(provenance.chords, provenance.chordSource, provenance.source);
  }
  return out.filter((value) => value !== undefined && value !== null);
}

function findUgTimeline(data: UnknownRecord): { value: unknown; provenance: string | null; fallback: boolean; fallbackReason: string | null } | null {
  const provenanceObject = record(data.chordProvenance);
  const fallback = provenanceObject?.fallback === true;
  const fallbackReason = text(provenanceObject?.fallbackReason);
  const directKeys = [
    "ugChordTimeline",
    "ugChords",
    "ultimateGuitarChordTimeline",
    "ultimateGuitarChords",
    "ugTabsChords",
  ];
  for (const key of directKeys) {
    if (data[key] !== undefined) {
      const chords = normalizeChordTimeline(data[key], "authored");
      const provenance = provenanceCandidates(data).find(isUgText);
      if (chords.length) return { value: chords, provenance: describeProvenance(provenance) ?? "ug-tabs", fallback, fallbackReason };
    }
  }

  // Source maps are useful when an artifact carries both inferred and source
  // timelines.  Accept either an object keyed by source or an array of named
  // source entries.
  for (const key of ["chordSources", "chordsBySource", "chordTimelinesBySource"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const obj = record(item);
        if (!obj || !isUgText(obj.id ?? obj.source ?? obj.label ?? obj.provenance)) continue;
        const chords = normalizeChordTimeline(obj.timeline ?? obj.chords ?? obj.events ?? obj, "authored");
        if (chords.length) return { value: chords, provenance: describeProvenance(obj.provenance ?? obj.source ?? obj.label) ?? "ug-tabs", fallback: obj.fallback === true, fallbackReason: text(obj.fallbackReason) };
      }
    } else if (record(value)) {
      for (const [sourceId, sourceValue] of Object.entries(value as UnknownRecord)) {
        if (!isUgText(sourceId) && !isUgText(describeProvenance(sourceValue))) continue;
        const sourceObj = record(sourceValue);
        const chords = normalizeChordTimeline(sourceObj?.timeline ?? sourceObj?.chords ?? sourceValue, "authored");
        if (chords.length) return { value: chords, provenance: describeProvenance(sourceObj?.provenance ?? sourceObj?.source ?? sourceId) ?? "ug-tabs", fallback: sourceObj?.fallback === true, fallbackReason: text(sourceObj?.fallbackReason) };
      }
    }
  }

  // A generic chord timeline is considered UG-owned only when its explicit
  // source/provenance says so.  This avoids silently relabeling inferred
  // chords as source material.
  if (data.chordTimeline !== undefined) {
    const provenance = provenanceCandidates(data).find(isUgText);
    const timelineObj = record(data.chordTimeline);
    const timelineSource = timelineObj?.source ?? timelineObj?.provenance ?? timelineObj?.provider;
    if (isUgText(timelineSource) || provenance !== undefined) {
      const chords = normalizeChordTimeline(data.chordTimeline, "authored");
      if (chords.length) return { value: chords, provenance: describeProvenance(timelineSource ?? provenance) ?? "ug-tabs", fallback, fallbackReason };
    }
  }
  return null;
}

export function resolveChordSources(data: SongData): ChordSourceResolution {
  const raw = data as unknown as UnknownRecord;
  const generated = normalizeChordTimeline(raw.chords, "generated");
  const ug = findUgTimeline(raw);
  return {
    generated: {
      id: "generated",
      label: "Generated chords",
      chords: generated,
      provenance: null,
      fallback: false,
      fallbackReason: null,
    },
    ug: ug
      ? {
          id: "ug",
          label: ug.fallback ? "UG + generated fallback" : "UG timeline",
          chords: ug.value as PlayerChordLabel[],
          provenance: ug.provenance,
          fallback: ug.fallback,
          fallbackReason: ug.fallbackReason,
        }
      : null,
  };
}

export function selectChordSource(
  resolution: ChordSourceResolution,
  requested: ChordSourceId,
): SelectedChordSource {
  if (requested === "ug") {
    if (resolution.ug?.chords.length) {
      return { source: resolution.ug, requested, fallback: resolution.ug.fallback, fallbackReason: resolution.ug.fallbackReason };
    }
    if (resolution.generated.chords.length) {
      return {
        source: resolution.generated,
        requested,
        fallback: true,
        fallbackReason: "UG timeline is unavailable for this arrangement; using generated chords.",
      };
    }
    return { source: null, requested, fallback: true, fallbackReason: "No chord timeline is available; using piano background." };
  }
  if (requested === "generated") {
    if (resolution.generated.chords.length) {
      return { source: resolution.generated, requested, fallback: false, fallbackReason: null };
    }
    return { source: null, requested, fallback: true, fallbackReason: "No generated chord timeline is available; using piano background." };
  }
  if (resolution.ug?.chords.length) {
    return { source: resolution.ug, requested, fallback: resolution.ug.fallback, fallbackReason: resolution.ug.fallbackReason };
  }
  if (resolution.generated.chords.length) {
    return { source: resolution.generated, requested, fallback: false, fallbackReason: null };
  }
  return { source: null, requested, fallback: true, fallbackReason: "No chord timeline is available; using piano background." };
}
