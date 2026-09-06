import type { Note } from "@keyspilli/midi";

/**
 * Versioned contract for local evidence that relates an independently
 * measured audio onset stream to symbolic beat positions.  This module is
 * deliberately an evidence adapter: it does not decode audio, run a model,
 * or make a generation decision.
 */
export const AUDIO_SYMBOLIC_ALIGNMENT_SCHEMA_VERSION = 1 as const;

export type AudioSymbolicAlignmentStatus = "aligned" | "insufficient-evidence" | "invalid";

/** Native symbolic tempo evidence, retained separately from audio timing. */
export interface AudioNativeTempoEvent {
  beat: number;
  bpm: number;
}

export interface AudioBeatAnchor {
  /** Time measured from the independent recording/onset extractor. */
  audioSeconds: number;
  /** Beat position in the symbolic candidate's domain. */
  beat: number;
  id?: string;
}

export interface AudioSymbolicAlignmentInput {
  /** Symbolic candidate events. `notes` is accepted as a compatibility alias. */
  symbolicNotes?: readonly Note[];
  notes?: readonly Note[];
  /** Onset times supplied by an external audio/onset measurement process. */
  audioOnsetSeconds?: readonly number[];
  onsetSeconds?: readonly number[];
  /** At least two anchors are required to establish an independent affine map. */
  anchors?: readonly AudioBeatAnchor[];
  /** Optional independent timing evidence, expressed directly in seconds/beat. */
  secondsPerBeat?: number;
  /** Audio time corresponding to symbolic beat zero for secondsPerBeat evidence. */
  beatZeroAudioSeconds?: number;
  /** Explicit tempo-map evidence from the symbolic source. It does not imply
   * an audio/sample-zero latency; callers must provide beatZeroAudioSeconds
   * when that offset is known. */
  nativeTempoEvents?: readonly AudioNativeTempoEvent[];
  /** Candidate metadata is used only for the naïve global-tempo comparison. */
  tempoBpm?: number;
  onsetToleranceBeats?: number;
  onsetDedupToleranceSeconds?: number;
}

export interface AudioTimingQuantiles {
  median: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
}

export interface AudioSymbolicF1 {
  precision: number;
  recall: number;
  f1: number;
}

export interface AudioSymbolicCoverage {
  audioRatio: number;
  symbolicRatio: number;
  beatRatio: number;
}

export interface AudioSymbolicOnsetMatch {
  audioIndex: number;
  audioSeconds: number;
  symbolicOnsetIndex: number;
  symbolicBeat: number;
  errorBeats: number;
  errorSeconds: number;
}

export interface AudioSymbolicOnsetMetrics {
  audioOnsetCount: number;
  symbolicOnsetCount: number;
  matchedOnsets: number;
  f1: number;
  precision: number;
  recall: number;
  errorBeats: AudioTimingQuantiles;
  errorSeconds: AudioTimingQuantiles;
  coverage: AudioSymbolicCoverage;
}

export interface AudioTimingMappingSegment {
  audioStartSeconds: number;
  audioEndSeconds: number;
  beatStart: number;
  beatEnd: number;
  beatsPerSecond: number;
  secondsPerBeat: number;
}

export interface AudioTimingDrift {
  segmentCount: number;
  minBeatsPerSecond: number;
  maxBeatsPerSecond: number;
  maxRelativeChange: number;
  maxPpm: number;
}

export interface AudioTimingMapping {
  method: "anchors" | "seconds-per-beat" | "global-tempo" | "native-tempo-map";
  beatZeroAudioSeconds: number;
  segments: AudioTimingMappingSegment[];
  drift: AudioTimingDrift;
}

export interface AudioSymbolicComparison {
  mapping: AudioTimingMapping;
  metrics: AudioSymbolicOnsetMetrics;
  matches: AudioSymbolicOnsetMatch[];
  confidence: number;
}

export interface AudioSymbolicAlignmentResult {
  schemaVersion: typeof AUDIO_SYMBOLIC_ALIGNMENT_SCHEMA_VERSION;
  status: AudioSymbolicAlignmentStatus;
  confidence: number;
  production: AudioSymbolicComparison | null;
  /** Global-tempo baseline; null when candidate tempo was not supplied. */
  naive: AudioSymbolicComparison | null;
  diagnostics: string[];
  config: {
    onsetToleranceBeats: number;
    onsetDedupToleranceSeconds: number;
  };
}

const EPS = 1e-9;
const DEFAULT_ONSET_TOLERANCE_BEATS = 0.125;
const DEFAULT_ONSET_DEDUP_SECONDS = 0.02;
const MIN_SECONDS_PER_BEAT = 0.001;

interface ValidatedInput {
  notes: Note[];
  audioOnsets: number[];
  anchors: AudioBeatAnchor[];
  secondsPerBeat: number | null;
  beatZeroAudioSeconds: number;
  beatZeroAudioSecondsExplicit: boolean;
  nativeTempoEvents: AudioNativeTempoEvent[];
  tempoBpm: number | null;
  onsetToleranceBeats: number;
  onsetDedupToleranceSeconds: number;
  diagnostics: string[];
}

interface OnsetGroup {
  start: number;
  noteCount: number;
}

interface NormalizedOnset {
  seconds: number;
  originalIndex: number;
}

interface InternalMapping extends AudioTimingMapping {
  mapAudioToBeat(seconds: number): number;
  mapBeatToAudio(beat: number): number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function noteSort(left: Note, right: Note): number {
  return left.start - right.start
    || left.midi - right.midi
    || left.dur - right.dur
    || left.vel - right.vel
    || compareText(left.hand ?? "", right.hand ?? "")
    || compareText(left.identitySource ?? "", right.identitySource ?? "")
    || compareText(left.lyrics ?? "", right.lyrics ?? "");
}

function validNote(value: unknown): value is Note {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const note = value as Partial<Note>;
  return finite(note.midi) && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && finite(note.start) && note.start >= 0
    && finite(note.dur) && note.dur > 0
    && finite(note.vel) && note.vel >= 0 && note.vel <= 127;
}

function onsetGroups(notes: readonly Note[], tolerance: number): OnsetGroup[] {
  const groups: OnsetGroup[] = [];
  for (const note of notes) {
    const last = groups.at(-1);
    if (last && note.start - last.start <= tolerance + EPS) last.noteCount += 1;
    else groups.push({ start: note.start, noteCount: 1 });
  }
  return groups;
}

function quantile(values: readonly number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]!);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function timingQuantiles(values: readonly number[]): AudioTimingQuantiles {
  return {
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    max: values.length ? round(Math.max(...values)) : null,
  };
}

function f1(precision: number, recall: number): number {
  return precision + recall > 0 ? round((2 * precision * recall) / (precision + recall)) : 0;
}

function validateAndNormalize(input: AudioSymbolicAlignmentInput | null | undefined): ValidatedInput {
  const diagnostics: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      notes: [], audioOnsets: [], anchors: [], secondsPerBeat: null, beatZeroAudioSeconds: 0,
      beatZeroAudioSecondsExplicit: false,
      nativeTempoEvents: [],
      tempoBpm: null, onsetToleranceBeats: DEFAULT_ONSET_TOLERANCE_BEATS,
      onsetDedupToleranceSeconds: DEFAULT_ONSET_DEDUP_SECONDS,
      diagnostics: ["alignment input must be an object"],
    };
  }

  const rawNotes = input.symbolicNotes ?? input.notes;
  const rawAudio = input.audioOnsetSeconds ?? input.onsetSeconds;
  const notes: Note[] = [];
  if (!Array.isArray(rawNotes)) diagnostics.push("symbolic notes must be an array");
  else {
    for (const note of rawNotes) if (validNote(note)) notes.push(note);
    if (notes.length !== rawNotes.length) diagnostics.push(`dropped ${rawNotes.length - notes.length} invalid symbolic note${rawNotes.length - notes.length === 1 ? "" : "s"}`);
  }
  notes.sort(noteSort);

  const onsetDedupToleranceSeconds = input.onsetDedupToleranceSeconds === undefined
    ? DEFAULT_ONSET_DEDUP_SECONDS
    : input.onsetDedupToleranceSeconds;
  const onsetToleranceBeats = input.onsetToleranceBeats === undefined
    ? DEFAULT_ONSET_TOLERANCE_BEATS
    : input.onsetToleranceBeats;
  if (!finite(onsetDedupToleranceSeconds) || onsetDedupToleranceSeconds < 0 || onsetDedupToleranceSeconds > 1) {
    diagnostics.push("onset deduplication tolerance must be finite and between 0 and 1 second");
  }
  if (!finite(onsetToleranceBeats) || onsetToleranceBeats <= 0 || onsetToleranceBeats > 4) {
    diagnostics.push("onset tolerance must be finite and between 0 and 4 beats");
  }

  const audioOnsets: number[] = [];
  if (!Array.isArray(rawAudio)) diagnostics.push("audio onsets must be an array");
  else {
    const normalized: NormalizedOnset[] = [];
    rawAudio.forEach((value, originalIndex) => {
      if (finite(value) && value >= 0) normalized.push({ seconds: value, originalIndex });
      else diagnostics.push(`invalid audio onset at index ${originalIndex}`);
    });
    normalized.sort((left, right) => left.seconds - right.seconds || left.originalIndex - right.originalIndex);
    const dedup = finite(onsetDedupToleranceSeconds) && onsetDedupToleranceSeconds >= 0 ? onsetDedupToleranceSeconds : DEFAULT_ONSET_DEDUP_SECONDS;
    for (const onset of normalized) {
      const last = audioOnsets.at(-1);
      if (last !== undefined && onset.seconds - last <= dedup + EPS) continue;
      audioOnsets.push(onset.seconds);
    }
    if (audioOnsets.length !== normalized.length) diagnostics.push(`coalesced ${normalized.length - audioOnsets.length} audio onset${normalized.length - audioOnsets.length === 1 ? "" : "s"}`);
  }

  const anchors: AudioBeatAnchor[] = [];
  if (input.anchors !== undefined) {
    if (!Array.isArray(input.anchors)) diagnostics.push("timing anchors must be an array");
    else {
      const seenIds = new Set<string>();
      for (const value of input.anchors) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          diagnostics.push("invalid timing anchor");
          continue;
        }
        const anchor = value as Partial<AudioBeatAnchor>;
        if (!finite(anchor.audioSeconds) || anchor.audioSeconds < 0 || !finite(anchor.beat) || anchor.beat < 0) {
          diagnostics.push("timing anchors require finite non-negative audioSeconds and beat");
          continue;
        }
        if (anchor.id !== undefined && (typeof anchor.id !== "string" || !anchor.id.trim())) {
          diagnostics.push("timing anchor ids must be non-empty strings");
          continue;
        }
        const id = anchor.id?.trim();
        if (id && seenIds.has(id)) {
          diagnostics.push(`duplicate timing anchor id: ${id}`);
          continue;
        }
        if (id) seenIds.add(id);
        anchors.push({ audioSeconds: anchor.audioSeconds, beat: anchor.beat, ...(id ? { id } : {}) });
      }
      anchors.sort((left, right) => left.audioSeconds - right.audioSeconds || left.beat - right.beat || compareText(left.id ?? "", right.id ?? ""));
      for (let index = 1; index < anchors.length; index += 1) {
        const previous = anchors[index - 1]!;
        const current = anchors[index]!;
        if (current.audioSeconds - previous.audioSeconds <= EPS) diagnostics.push("timing anchors must have distinct audio times");
        if (current.beat - previous.beat <= EPS) diagnostics.push("timing anchors must increase in beat order");
      }
    }
  }

  const rawSecondsPerBeat = input.secondsPerBeat;
  const secondsPerBeat = rawSecondsPerBeat === undefined
    ? null
    : finite(rawSecondsPerBeat) && rawSecondsPerBeat >= MIN_SECONDS_PER_BEAT && rawSecondsPerBeat <= 60
      ? rawSecondsPerBeat
      : null;
  if (rawSecondsPerBeat !== undefined && secondsPerBeat === null) diagnostics.push("secondsPerBeat must be finite, at least 0.001, and at most 60");

  const rawBeatZero = input.beatZeroAudioSeconds;
  const beatZeroAudioSeconds = rawBeatZero === undefined ? 0 : rawBeatZero;
  if (!finite(beatZeroAudioSeconds) || beatZeroAudioSeconds < 0) diagnostics.push("beatZeroAudioSeconds must be finite and non-negative");

  const nativeTempoEvents: AudioNativeTempoEvent[] = [];
  if (input.nativeTempoEvents !== undefined) {
    if (!Array.isArray(input.nativeTempoEvents)) diagnostics.push("native tempo events must be an array");
    else {
      for (const value of input.nativeTempoEvents) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          diagnostics.push("invalid native tempo event");
          continue;
        }
        const event = value as Partial<AudioNativeTempoEvent>;
        if (!finite(event.beat) || event.beat < 0 || !finite(event.bpm) || event.bpm <= 0 || event.bpm > 1000) {
          diagnostics.push("native tempo events require finite non-negative beat and positive BPM");
          continue;
        }
        nativeTempoEvents.push({ beat: event.beat, bpm: event.bpm });
      }
      nativeTempoEvents.sort((left, right) => left.beat - right.beat || left.bpm - right.bpm);
      for (let index = 1; index < nativeTempoEvents.length; index += 1) {
        if (nativeTempoEvents[index]!.beat < nativeTempoEvents[index - 1]!.beat) diagnostics.push("native tempo events must be monotonic");
      }
    }
  }

  const rawTempo = input.tempoBpm;
  const tempoBpm = rawTempo === undefined
    ? null
    : finite(rawTempo) && rawTempo > 0 && rawTempo <= 1000 ? rawTempo : null;
  if (rawTempo !== undefined && tempoBpm === null) diagnostics.push("tempoBpm must be finite and positive");

  return {
    notes,
    audioOnsets,
    anchors,
    secondsPerBeat,
    beatZeroAudioSeconds: finite(beatZeroAudioSeconds) && beatZeroAudioSeconds >= 0 ? beatZeroAudioSeconds : 0,
    beatZeroAudioSecondsExplicit: rawBeatZero !== undefined,
    nativeTempoEvents,
    tempoBpm,
    onsetToleranceBeats: finite(onsetToleranceBeats) && onsetToleranceBeats > 0 && onsetToleranceBeats <= 4 ? onsetToleranceBeats : DEFAULT_ONSET_TOLERANCE_BEATS,
    onsetDedupToleranceSeconds: finite(onsetDedupToleranceSeconds) && onsetDedupToleranceSeconds >= 0 && onsetDedupToleranceSeconds <= 1 ? onsetDedupToleranceSeconds : DEFAULT_ONSET_DEDUP_SECONDS,
    diagnostics,
  };
}

function driftForSegments(segments: readonly AudioTimingMappingSegment[]): AudioTimingDrift {
  const slopes = segments.map((segment) => segment.beatsPerSecond);
  if (!slopes.length) return { segmentCount: 0, minBeatsPerSecond: 0, maxBeatsPerSecond: 0, maxRelativeChange: 0, maxPpm: 0 };
  let maxRelativeChange = 0;
  for (let index = 1; index < slopes.length; index += 1) {
    const previous = slopes[index - 1]!;
    const current = slopes[index]!;
    maxRelativeChange = Math.max(maxRelativeChange, Math.abs(current - previous) / previous);
  }
  return {
    segmentCount: segments.length,
    minBeatsPerSecond: round(Math.min(...slopes)),
    maxBeatsPerSecond: round(Math.max(...slopes)),
    maxRelativeChange: round(maxRelativeChange),
    maxPpm: round(maxRelativeChange * 1_000_000),
  };
}

function mappingFromSegments(
  method: AudioTimingMapping["method"],
  segments: AudioTimingMappingSegment[],
  beatZeroAudioSeconds: number,
): InternalMapping {
  const sorted = segments.map((segment) => ({
    ...segment,
    audioStartSeconds: round(segment.audioStartSeconds),
    audioEndSeconds: round(segment.audioEndSeconds),
    beatStart: round(segment.beatStart),
    beatEnd: round(segment.beatEnd),
    beatsPerSecond: round(segment.beatsPerSecond),
    secondsPerBeat: round(segment.secondsPerBeat),
  }));
  const mapAudioToBeat = (seconds: number): number => {
    if (!sorted.length) return 0;
    let segment = sorted[0]!;
    if (seconds >= sorted.at(-1)!.audioEndSeconds) segment = sorted.at(-1)!;
    else {
      for (const candidate of sorted) {
        if (seconds <= candidate.audioEndSeconds + EPS) {
          segment = candidate;
          break;
        }
      }
    }
    return segment.beatStart + (seconds - segment.audioStartSeconds) * segment.beatsPerSecond;
  };
  const mapBeatToAudio = (beat: number): number => {
    if (!sorted.length) return beatZeroAudioSeconds;
    let segment = sorted[0]!;
    if (beat >= sorted.at(-1)!.beatEnd) segment = sorted.at(-1)!;
    else {
      for (const candidate of sorted) {
        if (beat <= candidate.beatEnd + EPS) {
          segment = candidate;
          break;
        }
      }
    }
    return segment.audioStartSeconds + (beat - segment.beatStart) * segment.secondsPerBeat;
  };
  return {
    method,
    beatZeroAudioSeconds: round(beatZeroAudioSeconds),
    segments: sorted,
    drift: driftForSegments(sorted),
    mapAudioToBeat,
    mapBeatToAudio,
  };
}

function mappingFromAnchors(anchors: readonly AudioBeatAnchor[]): InternalMapping | null {
  if (anchors.length < 2) return null;
  const segments: AudioTimingMappingSegment[] = [];
  for (let index = 1; index < anchors.length; index += 1) {
    const start = anchors[index - 1]!;
    const end = anchors[index]!;
    const audioDelta = end.audioSeconds - start.audioSeconds;
    const beatDelta = end.beat - start.beat;
    if (audioDelta <= EPS || beatDelta <= EPS) return null;
    const secondsPerBeat = audioDelta / beatDelta;
    if (!finite(secondsPerBeat) || secondsPerBeat < MIN_SECONDS_PER_BEAT || secondsPerBeat > 60) return null;
    const beatsPerSecond = 1 / secondsPerBeat;
    segments.push({
      audioStartSeconds: start.audioSeconds,
      audioEndSeconds: end.audioSeconds,
      beatStart: start.beat,
      beatEnd: end.beat,
      beatsPerSecond,
      secondsPerBeat,
    });
  }
  const first = anchors[0]!;
  const firstSlope = segments[0]!.beatsPerSecond;
  return mappingFromSegments("anchors", segments, first.audioSeconds - first.beat / firstSlope);
}

function mappingFromSecondsPerBeat(
  secondsPerBeat: number,
  beatZeroAudioSeconds: number,
  audioOnsets: readonly number[],
): InternalMapping {
  const maxAudio = Math.max(beatZeroAudioSeconds, ...(audioOnsets.length ? audioOnsets : [beatZeroAudioSeconds + secondsPerBeat]));
  const beatsPerSecond = 1 / secondsPerBeat;
  return mappingFromSegments("seconds-per-beat", [{
    audioStartSeconds: 0,
    audioEndSeconds: Math.max(secondsPerBeat, maxAudio),
    beatStart: -beatZeroAudioSeconds * beatsPerSecond,
    beatEnd: (Math.max(secondsPerBeat, maxAudio) - beatZeroAudioSeconds) * beatsPerSecond,
    beatsPerSecond,
    secondsPerBeat,
  }], beatZeroAudioSeconds);
}

function mappingFromTempo(
  tempoBpm: number,
  beatZeroAudioSeconds: number,
  audioOnsets: readonly number[],
  firstAnchor?: AudioBeatAnchor,
): InternalMapping {
  const secondsPerBeat = 60 / tempoBpm;
  const phase = firstAnchor
    ? firstAnchor.audioSeconds - firstAnchor.beat * secondsPerBeat
    : beatZeroAudioSeconds;
  return mappingFromSegments("global-tempo", [{
    audioStartSeconds: 0,
    audioEndSeconds: Math.max(secondsPerBeat, ...audioOnsets, phase + secondsPerBeat),
    beatStart: -phase / secondsPerBeat,
    beatEnd: (Math.max(secondsPerBeat, ...audioOnsets, phase + secondsPerBeat) - phase) / secondsPerBeat,
    beatsPerSecond: 1 / secondsPerBeat,
    secondsPerBeat,
  }], phase);
}

function mappingFromNativeTempo(
  events: readonly AudioNativeTempoEvent[],
  beatZeroAudioSeconds: number,
  maxBeat: number,
): InternalMapping | null {
  if (!events.length || !finite(beatZeroAudioSeconds) || beatZeroAudioSeconds < 0) return null;
  const ordered = events.filter((event) => finite(event.beat) && event.beat >= 0 && finite(event.bpm) && event.bpm > 0).slice()
    .sort((left, right) => left.beat - right.beat || left.bpm - right.bpm);
  if (!ordered.length) return null;
  const endBeat = Math.max(1, maxBeat, ordered.at(-1)!.beat + 1);
  const segments: AudioTimingMappingSegment[] = [];
  let currentBeat = 0;
  let currentAudio = beatZeroAudioSeconds;
  let currentBpm = ordered[0]!.beat > EPS ? 120 : ordered[0]!.bpm;
  for (const event of ordered) {
    if (event.beat > currentBeat + EPS) {
      const secondsPerBeat = 60 / currentBpm;
      const beatEnd = Math.min(event.beat, endBeat);
      const audioEnd = currentAudio + (beatEnd - currentBeat) * secondsPerBeat;
      segments.push({
        audioStartSeconds: currentAudio,
        audioEndSeconds: audioEnd,
        beatStart: currentBeat,
        beatEnd,
        beatsPerSecond: 1 / secondsPerBeat,
        secondsPerBeat,
      });
      currentAudio = audioEnd;
      currentBeat = beatEnd;
    }
    if (event.beat <= endBeat + EPS) currentBpm = event.bpm;
    if (currentBeat >= endBeat - EPS) break;
  }
  if (currentBeat < endBeat - EPS) {
    const secondsPerBeat = 60 / currentBpm;
    segments.push({
      audioStartSeconds: currentAudio,
      audioEndSeconds: currentAudio + (endBeat - currentBeat) * secondsPerBeat,
      beatStart: currentBeat,
      beatEnd: endBeat,
      beatsPerSecond: 1 / secondsPerBeat,
      secondsPerBeat,
    });
  }
  return mappingFromSegments("native-tempo-map", segments, beatZeroAudioSeconds);
}

function mappingFromGlobalAnchors(anchors: readonly AudioBeatAnchor[]): InternalMapping | null {
  if (anchors.length < 2) return null;
  const first = anchors[0]!;
  const last = anchors.at(-1)!;
  const audioSpan = last.audioSeconds - first.audioSeconds;
  const beatSpan = last.beat - first.beat;
  if (audioSpan <= EPS || beatSpan <= EPS) return null;
  const secondsPerBeat = audioSpan / beatSpan;
  if (!finite(secondsPerBeat) || secondsPerBeat < MIN_SECONDS_PER_BEAT || secondsPerBeat > 60) return null;
  return mappingFromTempo(60 / secondsPerBeat, 0, [], first);
}

function publicMapping(mapping: InternalMapping): AudioTimingMapping {
  return {
    method: mapping.method,
    beatZeroAudioSeconds: mapping.beatZeroAudioSeconds,
    segments: mapping.segments,
    drift: mapping.drift,
  };
}

function matchOnsets(
  mapping: InternalMapping,
  audioOnsets: readonly number[],
  symbolic: readonly OnsetGroup[],
  toleranceBeats: number,
): AudioSymbolicOnsetMatch[] {
  const matches: AudioSymbolicOnsetMatch[] = [];
  let audioIndex = 0;
  let symbolicIndex = 0;
  while (audioIndex < audioOnsets.length && symbolicIndex < symbolic.length) {
    const audioSeconds = audioOnsets[audioIndex]!;
    const mappedBeat = mapping.mapAudioToBeat(audioSeconds);
    while (symbolicIndex < symbolic.length && symbolic[symbolicIndex]!.start < mappedBeat - toleranceBeats - EPS) symbolicIndex += 1;
    if (symbolicIndex >= symbolic.length) break;
    const selectedBeat = symbolic[symbolicIndex]!.start;
    if (selectedBeat <= mappedBeat + toleranceBeats + EPS) {
      const errorBeats = Math.abs(mappedBeat - selectedBeat);
      const expectedAudio = mapping.mapBeatToAudio(selectedBeat);
      matches.push({
        audioIndex,
        audioSeconds: round(audioSeconds),
        symbolicOnsetIndex: symbolicIndex,
        symbolicBeat: round(selectedBeat),
        errorBeats: round(errorBeats),
        errorSeconds: round(Math.abs(audioSeconds - expectedAudio)),
      });
      symbolicIndex += 1;
      audioIndex += 1;
    } else audioIndex += 1;
  }
  return matches;
}

function comparisonMetrics(
  mapping: InternalMapping,
  audioOnsets: readonly number[],
  symbolic: readonly OnsetGroup[],
  toleranceBeats: number,
): { metrics: AudioSymbolicOnsetMetrics; matches: AudioSymbolicOnsetMatch[] } {
  const matches = matchOnsets(mapping, audioOnsets, symbolic, toleranceBeats);
  const audioCount = audioOnsets.length;
  const symbolicCount = symbolic.length;
  const precision = audioCount ? round(matches.length / audioCount) : 0;
  const recall = symbolicCount ? round(matches.length / symbolicCount) : 0;
  const mappedAudio = audioOnsets.map(mapping.mapAudioToBeat);
  const symbolicStarts = symbolic.map((group) => group.start);
  const audioMin = mappedAudio.length ? Math.min(...mappedAudio) : 0;
  const audioMax = mappedAudio.length ? Math.max(...mappedAudio) : 0;
  const symbolicMin = symbolicStarts.length ? Math.min(...symbolicStarts) : 0;
  const symbolicMax = symbolicStarts.length ? Math.max(...symbolicStarts) : 0;
  const symbolicSpan = Math.max(0, symbolicMax - symbolicMin);
  const overlap = symbolicSpan > EPS
    ? Math.max(0, Math.min(audioMax, symbolicMax) - Math.max(audioMin, symbolicMin)) / symbolicSpan
    : matches.length > 0 ? 1 : 0;
  return {
    matches,
    metrics: {
      audioOnsetCount: audioCount,
      symbolicOnsetCount: symbolicCount,
      matchedOnsets: matches.length,
      f1: f1(precision, recall),
      precision,
      recall,
      errorBeats: timingQuantiles(matches.map((match) => match.errorBeats)),
      errorSeconds: timingQuantiles(matches.map((match) => match.errorSeconds)),
      coverage: {
        audioRatio: precision,
        symbolicRatio: recall,
        beatRatio: round(clamp(overlap, 0, 1)),
      },
    },
  };
}

function comparisonConfidence(metrics: AudioSymbolicOnsetMetrics, mapping: AudioTimingMapping): number {
  const error = metrics.errorBeats.p95;
  const errorScore = error === null ? 0 : Math.exp(-error / 0.25);
  const evidenceScore = mapping.method === "anchors"
    ? clamp(mapping.segments.length / 3, 0, 1)
    : mapping.method === "seconds-per-beat" ? 0.7 : mapping.method === "native-tempo-map" ? 0.8 : 0.3;
  return round(clamp(0.35 * metrics.coverage.audioRatio + 0.35 * metrics.coverage.symbolicRatio + 0.2 * errorScore + 0.1 * evidenceScore, 0, 1));
}

function emptyResult(input: ValidatedInput, status: AudioSymbolicAlignmentStatus, diagnostics: string[]): AudioSymbolicAlignmentResult {
  return {
    schemaVersion: AUDIO_SYMBOLIC_ALIGNMENT_SCHEMA_VERSION,
    status,
    confidence: 0,
    production: null,
    naive: null,
    diagnostics: [...input.diagnostics, ...diagnostics],
    config: {
      onsetToleranceBeats: round(input.onsetToleranceBeats),
      onsetDedupToleranceSeconds: round(input.onsetDedupToleranceSeconds),
    },
  };
}

/**
 * Evaluate timing evidence supplied by an independent audio/onset process.
 *
 * `anchors` (two or more) are the preferred production mapping.  An explicit
 * `secondsPerBeat` is also accepted as independently measured evidence.  The
 * candidate `tempoBpm` is intentionally used only for the `naive` baseline;
 * it never upgrades a result to `aligned` by itself.
 */
export function evaluateAudioSymbolicAlignment(
  input: AudioSymbolicAlignmentInput | null | undefined,
): AudioSymbolicAlignmentResult {
  const normalized = validateAndNormalize(input);
  const invalidEvidence = normalized.diagnostics.some((diagnostic) => /invalid|must be|require|between|object|array|duplicate|increase|distinct|positive/i.test(diagnostic));
  if (invalidEvidence) return emptyResult(normalized, "invalid", ["timing evidence failed validation"]);
  if (!normalized.notes.length || !normalized.audioOnsets.length) return emptyResult(normalized, "insufficient-evidence", ["symbolic notes and audio onsets are both required"]);

  const symbolic = onsetGroups(normalized.notes, normalized.onsetToleranceBeats);
  if (!symbolic.length) return emptyResult(normalized, "insufficient-evidence", ["no symbolic onset groups available"]);

  const productionMapping = mappingFromAnchors(normalized.anchors)
    ?? (normalized.nativeTempoEvents.length
      ? mappingFromNativeTempo(
        normalized.nativeTempoEvents,
        normalized.beatZeroAudioSeconds,
        Math.max(1, ...symbolic.map((group) => group.start)),
      )
      : null)
    ?? (normalized.secondsPerBeat !== null
      ? mappingFromSecondsPerBeat(
        normalized.secondsPerBeat,
        normalized.anchors.length === 1 && !normalized.beatZeroAudioSecondsExplicit
          ? normalized.anchors[0]!.audioSeconds - normalized.anchors[0]!.beat * normalized.secondsPerBeat
          : normalized.beatZeroAudioSeconds,
        normalized.audioOnsets,
      )
      : null);
  const naiveMapping = normalized.tempoBpm !== null
    ? mappingFromTempo(normalized.tempoBpm, normalized.beatZeroAudioSeconds, normalized.audioOnsets, normalized.anchors[0])
    : mappingFromGlobalAnchors(normalized.anchors);
  const naive = naiveMapping ? (() => {
    const measured = comparisonMetrics(naiveMapping, normalized.audioOnsets, symbolic, normalized.onsetToleranceBeats);
    return {
      mapping: publicMapping(naiveMapping),
      metrics: measured.metrics,
      matches: measured.matches,
      confidence: comparisonConfidence(measured.metrics, naiveMapping),
    } satisfies AudioSymbolicComparison;
  })() : null;
  if (!productionMapping) {
    return {
      ...emptyResult(normalized, "insufficient-evidence", ["at least two increasing audio↔beat anchors or explicit secondsPerBeat evidence are required"]),
      naive,
    };
  }
  const measured = comparisonMetrics(productionMapping, normalized.audioOnsets, symbolic, normalized.onsetToleranceBeats);
  const production: AudioSymbolicComparison = {
    mapping: publicMapping(productionMapping),
    metrics: measured.metrics,
    matches: measured.matches,
    confidence: comparisonConfidence(measured.metrics, productionMapping),
  };
  const status: AudioSymbolicAlignmentStatus = measured.matches.length >= 2 ? "aligned" : "insufficient-evidence";
  const diagnostics = [
    ...normalized.diagnostics,
    `production mapping derived from ${productionMapping.method === "anchors"
      ? `${normalized.anchors.length} anchor${normalized.anchors.length === 1 ? "" : "s"}`
      : productionMapping.method === "native-tempo-map" ? "native MIDI tempo events" : "explicit secondsPerBeat"}`,
    `matched ${measured.matches.length} of ${normalized.audioOnsets.length} measured audio onset${normalized.audioOnsets.length === 1 ? "" : "s"} to ${symbolic.length} symbolic onset group${symbolic.length === 1 ? "" : "s"}`,
  ];
  return {
    schemaVersion: AUDIO_SYMBOLIC_ALIGNMENT_SCHEMA_VERSION,
    status,
    confidence: production.confidence,
    production,
    naive,
    diagnostics,
    config: {
      onsetToleranceBeats: round(normalized.onsetToleranceBeats),
      onsetDedupToleranceSeconds: round(normalized.onsetDedupToleranceSeconds),
    },
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "generatedAt")
    .sort(([left], [right]) => compareText(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

/** Canonical, path-free JSON for hashing or comparing local reports. */
export function canonicalAudioSymbolicAlignmentJson(report: AudioSymbolicAlignmentResult): string {
  return stableJson(report);
}
