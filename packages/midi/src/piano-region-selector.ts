import type { Note } from "./types.js";

/** The musical role whose notes are compared and returned by the selector. */
export type PianoRegionRole = "melody" | "melody-only" | "accompaniment" | "both";

/**
 * A selected, contiguous span of an aligned candidate.
 *
 * `CandidateRegion` is intentionally independent of song names or semantic
 * labels.  Callers can use arbitrary aligned windows (for example, sections
 * discovered from a chart, or fixed beat ranges from an evaluation fixture).
 */
export interface CandidateRegion {
  startBeat: number;
  endBeat: number;
  candidateId: string;
  score: number;
  reason: string[];
  /** IDs of the aligned windows that were coalesced into this region. */
  windowIds?: string[];
  role?: PianoRegionRole;
}

/** An aligned section/window supplied to the pure selector. */
export interface PianoRegionWindow {
  startBeat: number;
  endBeat: number;
  id?: string;
  sectionId?: string;
  /** Optional target notes/chroma used to assess harmonic agreement. */
  referenceNotes?: readonly Note[];
  targetNotes?: readonly Note[];
  chroma?: readonly number[];
  referenceChroma?: readonly number[];
  targetChroma?: readonly number[];
  /** Numeric or symbolic quality evidence, when a caller has it. */
  quality?: number | string | Record<string, unknown>;
  qualityScore?: number;
  confidence?: number;
  candidateScores?: Readonly<Record<string, number>>;
  [key: string]: unknown;
}

/** A symbolic candidate and optional precomputed evidence for its notes. */
export interface PianoRegionCandidate {
  /** `id` is preferred; `candidateId`/`name` are accepted for adapter ease. */
  id?: string;
  candidateId?: string;
  name?: string;
  notes?: readonly Note[];
  /** Explicit role streams prevent accompaniment from being treated as melody. */
  melodyNotes?: readonly Note[];
  leadNotes?: readonly Note[];
  accompanimentNotes?: readonly Note[];
  role?: PianoRegionRole;
  confidence?: number;
  melodyConfidence?: number;
  quality?: number | string | Record<string, unknown>;
  qualityScore?: number;
  melodyQuality?: number;
  melodyScore?: number;
  chromaAgreement?: number;
  coverage?: number;
  gapRate?: number;
  pathology?: number;
  density?: number;
  score?: number;
  chroma?: readonly number[];
  referenceChroma?: readonly number[];
  candidateScores?: Readonly<Record<string, number>>;
  windowScores?: Readonly<Record<string, number>>;
  [key: string]: unknown;
}

/** Weights for the inspectable region quality model. */
export interface PianoRegionScoreWeights {
  continuity: number;
  chroma: number;
  quality: number;
  coverage: number;
  gaps: number;
  confidence: number;
  pathology: number;
  density: number;
}

/** Per-candidate/per-window evidence, useful for diagnostics and calibration. */
export interface PianoRegionScore {
  candidateId: string;
  windowId: string;
  score: number;
  continuity: number;
  chroma: number;
  quality: number;
  coverage: number;
  gapRate: number;
  confidence: number;
  /** Average simultaneously sounding notes in the aligned window. */
  density: number;
  /** Combined [0, 1] penalty for polyphony, leaps, and isolated attacks. */
  pathology: number;
  noteCount: number;
  reasons: string[];
}

/** Options for deterministic scoring and section smoothing. */
export interface PianoRegionSelectionOptions {
  role?: PianoRegionRole;
  /** Alias for `role: "melody"`; useful at call sites that make the intent explicit. */
  melodyOnly?: boolean;
  minRegionBeats?: number;
  minimumRegionBeats?: number;
  minRegionDurationBeats?: number;
  minRegionDuration?: number;
  minimumRegionDurationBeats?: number;
  minimumRegionDuration?: number;
  minDurationBeats?: number;
  minimumDurationBeats?: number;
  switchPenalty?: number;
  /** Score margin required before a source switch is considered worthwhile. */
  hysteresis?: number;
  tieTolerance?: number;
  initialCandidateId?: string;
  previousCandidateId?: string;
  fallbackCandidateId?: string;
  /** Optional global chroma target for windows that do not carry one. */
  referenceChroma?: readonly number[];
  targetChroma?: readonly number[];
  weights?: Partial<PianoRegionScoreWeights>;
  continuityWeight?: number;
  chromaWeight?: number;
  qualityWeight?: number;
  coverageWeight?: number;
  gapWeight?: number;
  confidenceWeight?: number;
  pathologyWeight?: number;
  densityWeight?: number;
  [key: string]: unknown;
}

export interface PianoRegionSelectionDiagnostics {
  windowCount: number;
  candidateCount: number;
  switchCount: number;
  totalScore: number;
  selectedCandidateIds: string[];
  /** Scores in aligned-window order, after deterministic input normalization. */
  windowSelections: Array<{
    windowId: string;
    candidateId: string;
    score: number;
  }>;
}

/** The selected melody stream and its score/provenance diagnostics. */
export interface PianoRegionSelection {
  regions: CandidateRegion[];
  /** Selected notes, always restricted to the requested role. */
  notes: Note[];
  melodyNotes: Note[];
  selectedNotes: Note[];
  selectedCandidateIds: string[];
  scores: PianoRegionScore[];
  role: PianoRegionRole;
  diagnostics: PianoRegionSelectionDiagnostics;
}

interface NormalizedCandidate {
  id: string;
  candidate: PianoRegionCandidate;
  notes: Note[];
}

interface NormalizedWindow {
  id: string;
  source: PianoRegionWindow;
  startBeat: number;
  endBeat: number;
  ordinal: number;
}

interface CandidatePathState {
  candidateIndex: number;
  runBeats: number;
  value: number;
  switches: number;
  path: number[];
}

interface ClippedPiece {
  note: Note;
  candidateId: string;
}

const EPSILON = 1e-9;
const DEFAULT_TIE_TOLERANCE = 1e-7;
const ONSET_TOLERANCE = 0.125;
const DEFAULT_WEIGHTS: PianoRegionScoreWeights = {
  // Continuity/chroma/coverage are deliberately larger than density.
  continuity: 0.34,
  chroma: 0.14,
  quality: 0.1,
  coverage: 0.16,
  gaps: 0.1,
  confidence: 0.08,
  pathology: 0.06,
  density: 0.02,
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  return parsed === undefined ? fallback : Math.max(0, parsed);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function metricFrom(...sources: unknown[]): number | undefined {
  for (const source of sources) {
    const value = finiteNumber(source);
    if (value !== undefined) return value;
  }
  return undefined;
}

function lookupMetric(
  candidate: PianoRegionCandidate,
  window: PianoRegionWindow,
  names: readonly string[],
): number | undefined {
  const candidateRecord = asRecord(candidate);
  const windowRecord = asRecord(window);
  const candidateMetrics = candidateRecord?.metrics;
  const candidateQuality = candidateRecord?.qualityMetrics;
  const windowMetrics = windowRecord?.metrics;
  for (const name of names) {
    const value = metricFrom(
      candidateRecord?.[name],
      asRecord(candidateMetrics)?.[name],
      asRecord(candidateQuality)?.[name],
      windowRecord?.[name],
      asRecord(windowMetrics)?.[name],
    );
    if (value !== undefined) return value;
  }
  return undefined;
}

function stableNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(9) : "nan";
}

function noteIdentity(note: Note): string {
  const candidate = note as Note & { id?: string; noteId?: string; noteKey?: string };
  if (typeof candidate.noteId === "string" && candidate.noteId.length > 0) return `noteId:${candidate.noteId}`;
  if (typeof candidate.id === "string" && candidate.id.length > 0) return `id:${candidate.id}`;
  if (typeof candidate.noteKey === "string" && candidate.noteKey.length > 0) return `key:${candidate.noteKey}`;
  return [
    stableNumber(note.midi),
    stableNumber(note.start),
    stableNumber(note.dur),
    stableNumber(note.vel),
    note.hand ?? "",
    note.identitySource ?? "",
    note.lyrics ?? "",
  ].join("|");
}

function noteAttackKey(note: Note): string {
  return `${stableNumber(note.midi)}|${stableNumber(note.start)}`;
}

function isUsableNote(note: Note): boolean {
  return Number.isFinite(note.midi)
    && Number.isFinite(note.start)
    && Number.isFinite(note.dur)
    && note.dur > EPSILON;
}

function noteSort(a: Note, b: Note): number {
  return a.start - b.start
    || a.midi - b.midi
    || a.dur - b.dur
    || a.vel - b.vel
    || noteIdentity(a).localeCompare(noteIdentity(b));
}

function canonicalNotes(notes: readonly Note[] | undefined): Note[] {
  return [...(notes ?? [])]
    .filter(isUsableNote)
    .sort(noteSort)
    .map((note) => ({ ...note }));
}

function stableSerialize(value: unknown, depth = 0): string {
  if (depth > 6) return "depth-limit";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") return stableNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item, depth + 1)).join(",")}]`;
  const record = asRecord(value);
  if (!record) return typeof value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], depth + 1)}`).join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function candidateFingerprint(candidate: PianoRegionCandidate): string {
  const notes = canonicalNotes(candidate.notes ?? candidate.melodyNotes ?? candidate.leadNotes);
  const record = asRecord(candidate);
  const metadata = record
    ? Object.fromEntries(Object.keys(record)
      .filter((key) => !["id", "candidateId", "name", "notes", "melodyNotes", "leadNotes", "accompanimentNotes"].includes(key))
      .sort()
      .map((key) => [key, record[key]]))
    : {};
  return `${notes.map(noteIdentity).join(";")}|${stableSerialize(metadata)}`;
}

function candidateBaseId(candidate: PianoRegionCandidate, index: number): string {
  const explicit = [candidate.id, candidate.candidateId, candidate.name]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  if (explicit) return explicit.trim();
  const fingerprint = candidateFingerprint(candidate);
  return fingerprint === "|{}" ? "candidate-empty" : `candidate-${stableHash(fingerprint)}`;
}

function normalizeCandidates(candidates: readonly PianoRegionCandidate[], role: PianoRegionRole): NormalizedCandidate[] {
  const preliminary = candidates.map((candidate, index) => ({
    candidate,
    index,
    baseId: candidateBaseId(candidate, index),
  }));

  // Sorting before suffixing makes a caller's input order irrelevant.  IDs
  // remain unchanged for the usual unique-id case.
  preliminary.sort((a, b) => a.baseId.localeCompare(b.baseId)
    || candidateFingerprint(a.candidate).localeCompare(candidateFingerprint(b.candidate))
    || a.index - b.index);

  const counts = new Map<string, number>();
  return preliminary.map(({ candidate, baseId }) => {
    const count = counts.get(baseId) ?? 0;
    counts.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}#${count + 1}`;
    const notes = roleNotes(candidate, role);
    return {
      id,
      candidate,
      notes,
    };
  });
}

function normalizeWindows(windows: readonly PianoRegionWindow[]): NormalizedWindow[] {
  const preliminary = windows.map((window, index) => {
    const raw = asRecord(window) ?? {};
    const start = finiteNumber(raw.startBeat) ?? finiteNumber(raw.start);
    const explicitEnd = finiteNumber(raw.endBeat) ?? finiteNumber(raw.end);
    const duration = finiteNumber(raw.durationBeats) ?? finiteNumber(raw.duration);
    const end = explicitEnd ?? (start !== undefined && duration !== undefined ? start + duration : undefined);
    return { window, index, start, end };
  }).filter((entry): entry is {
    window: PianoRegionWindow;
    index: number;
    start: number;
    end: number;
  } => entry.start !== undefined && entry.end !== undefined && entry.end > entry.start + EPSILON);

  preliminary.sort((a, b) => a.start - b.start || a.end - b.end
    || String(a.window.id ?? a.window.sectionId ?? "").localeCompare(String(b.window.id ?? b.window.sectionId ?? ""))
    || a.index - b.index);

  const counts = new Map<string, number>();
  return preliminary.map(({ window, index, start, end }) => {
    const baseId = String(window.id ?? window.sectionId ?? `${stableNumber(start)}-${stableNumber(end)}`);
    const count = counts.get(baseId) ?? 0;
    counts.set(baseId, count + 1);
    return {
      id: count === 0 ? baseId : `${baseId}#${count + 1}`,
      source: window,
      startBeat: start,
      endBeat: end,
      ordinal: index,
    };
  });
}

function validateSelectionWindows(windows: readonly PianoRegionWindow[]): void {
  if (!Array.isArray(windows)) {
    throw new TypeError("Invalid piano region windows: expected an array");
  }
  for (const [index, window] of windows.entries()) {
    const raw = asRecord(window);
    const start = finiteNumber(raw?.startBeat) ?? finiteNumber(raw?.start);
    const explicitEnd = finiteNumber(raw?.endBeat) ?? finiteNumber(raw?.end);
    const duration = finiteNumber(raw?.durationBeats) ?? finiteNumber(raw?.duration);
    const end = explicitEnd ?? (start !== undefined && duration !== undefined ? start + duration : undefined);
    if (start === undefined || end === undefined || start < 0 || end <= start + EPSILON) {
      throw new RangeError(`Invalid piano region window at index ${index}`);
    }
  }
}

function roleNotes(candidate: PianoRegionCandidate, role: PianoRegionRole): Note[] {
  const canonicalRole = role === "melody-only" ? "melody" : role;
  if (canonicalRole === "accompaniment") {
    return canonicalNotes(candidate.accompanimentNotes ?? candidate.notes);
  }
  if (canonicalRole === "both") {
    return canonicalNotes(candidate.notes ?? candidate.melodyNotes ?? candidate.leadNotes);
  }
  const explicitMelody = candidate.melodyNotes ?? candidate.leadNotes;
  if (explicitMelody) return canonicalNotes(explicitMelody);
  // An explicitly accompaniment-only stream must not silently become a lead.
  if (candidate.role === "accompaniment") return [];
  return extractTopVoice(canonicalNotes(candidate.notes));
}

function extractTopVoice(notes: readonly Note[]): Note[] {
  if (notes.length < 2) return [...notes].map((note) => ({ ...note }));
  const out: Note[] = [];
  let group: Note[] = [];
  let groupStart = Number.NaN;
  const flush = () => {
    if (!group.length) return;
    const top = [...group].sort((a, b) => b.midi - a.midi || b.dur - a.dur || noteIdentity(a).localeCompare(noteIdentity(b)))[0];
    if (top) out.push({ ...top });
    group = [];
    groupStart = Number.NaN;
  };
  for (const note of notes) {
    if (!group.length || Math.abs(note.start - groupStart) <= ONSET_TOLERANCE) {
      if (!group.length) groupStart = note.start;
      group.push(note);
    } else {
      flush();
      groupStart = note.start;
      group.push(note);
    }
  }
  flush();
  return out.sort(noteSort);
}

function clipRawNotes(notes: readonly Note[], startBeat: number, endBeat: number): Note[] {
  const clipped: Note[] = [];
  for (const note of notes) {
    if (!isUsableNote(note)) continue;
    const noteEnd = note.start + note.dur;
    const start = Math.max(startBeat, note.start);
    const end = Math.min(endBeat, noteEnd);
    if (end <= start + EPSILON) continue;
    clipped.push({ ...note, start, dur: end - start });
  }
  return clipped;
}

function uniqueNumberArray(values: readonly number[] | undefined): number[] | undefined {
  if (!values || values.length === 0) return undefined;
  const output = values.slice(0, 12).map((value) => finiteNumber(value) ?? 0);
  const total = output.reduce((sum, value) => sum + Math.max(0, value), 0);
  return total > EPSILON ? output.map((value) => Math.max(0, value) / total) : undefined;
}

function chromaHistogram(notes: readonly Note[]): number[] {
  const histogram = new Array<number>(12).fill(0);
  for (const note of notes) {
    const pitchClass = ((Math.round(note.midi) % 12) + 12) % 12;
    histogram[pitchClass] = (histogram[pitchClass] ?? 0) + Math.max(0, note.dur);
  }
  const total = histogram.reduce((sum, value) => sum + value, 0);
  return total > EPSILON ? histogram.map((value) => value / total) : histogram;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const size = Math.min(12, left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = finiteNumber(left[index]) ?? 0;
    const b = finiteNumber(right[index]) ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= EPSILON || rightNorm <= EPSILON) return 0.5;
  return clamp01(dot / Math.sqrt(leftNorm * rightNorm));
}

function targetChroma(window: PianoRegionWindow, options: PianoRegionSelectionOptions): number[] | undefined {
  const raw = window.referenceChroma ?? window.targetChroma ?? window.chroma
    ?? (asRecord(window)?.referenceChroma as readonly number[] | undefined)
    ?? options.referenceChroma ?? options.targetChroma;
  const fromNotes = window.referenceNotes ?? window.targetNotes;
  return uniqueNumberArray(raw) ?? (fromNotes ? chromaHistogram(canonicalNotes(fromNotes)) : undefined);
}

function qualityAgreement(candidate: PianoRegionCandidate, window: PianoRegionWindow): number {
  const explicit = lookupMetric(candidate, window, ["qualityScore", "harmonyQuality", "harmonicAgreement", "qualityAgreement"]);
  if (explicit !== undefined) return clamp01(explicit);
  const candidateQuality = candidate.quality;
  const windowQuality = window.quality;
  const candidateNumber = finiteNumber(candidateQuality);
  if (candidateNumber !== undefined) return clamp01(candidateNumber);
  const candidateQualityRecord = asRecord(candidateQuality);
  const qualityValue = metricFrom(
    candidateQualityRecord?.score,
    candidateQualityRecord?.confidence,
    candidateQualityRecord?.agreement,
  );
  if (qualityValue !== undefined) return clamp01(qualityValue);
  if (typeof candidateQuality === "string" && typeof windowQuality === "string") {
    return candidateQuality.trim().toLowerCase() === windowQuality.trim().toLowerCase() ? 1 : 0;
  }
  return 0.5;
}

function windowScoreOverride(candidate: PianoRegionCandidate, window: PianoRegionWindow, windowId: string): number | undefined {
  const candidateRecord = asRecord(candidate);
  const windowRecord = asRecord(window);
  const maps = [
    candidate.windowScores,
    candidate.candidateScores,
    asRecord(candidateRecord?.scores) as Readonly<Record<string, number>> | undefined,
    window.candidateScores,
    asRecord(windowRecord?.scores) as Readonly<Record<string, number>> | undefined,
  ];
  const keys = [windowId, window.id, window.sectionId, `${stableNumber(window.startBeat)}-${stableNumber(window.endBeat)}`]
    .filter((key): key is string => typeof key === "string");
  for (const map of maps) {
    if (!map) continue;
    for (const key of keys) {
      const value = finiteNumber(map[key]);
      if (value !== undefined) return clamp01(value);
    }
  }
  return undefined;
}

function unionLength(notes: readonly Note[], startBeat: number, endBeat: number): number {
  if (!notes.length) return 0;
  const intervals = notes
    .map((note) => [Math.max(startBeat, note.start), Math.min(endBeat, note.start + note.dur)] as const)
    .filter(([start, end]) => end > start + EPSILON)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let currentStart = intervals[0]?.[0] ?? startBeat;
  let currentEnd = intervals[0]?.[1] ?? startBeat;
  for (const [start, end] of intervals.slice(1)) {
    if (start <= currentEnd + EPSILON) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return total + Math.max(0, currentEnd - currentStart);
}

function soundingDensity(notes: readonly Note[], startBeat: number, endBeat: number): { average: number; peak: number } {
  const events: Array<[number, number]> = [];
  for (const note of notes) {
    const start = Math.max(startBeat, note.start);
    const end = Math.min(endBeat, note.start + note.dur);
    if (end <= start + EPSILON) continue;
    events.push([start, 1], [end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const duration = endBeat - startBeat;
  if (duration <= EPSILON || !events.length) return { average: 0, peak: 0 };
  let level = 0;
  let peak = 0;
  let weighted = 0;
  let previous = startBeat;
  for (const [time, delta] of events) {
    const boundedTime = Math.max(startBeat, Math.min(endBeat, time));
    if (boundedTime > previous) weighted += level * (boundedTime - previous);
    level += delta;
    peak = Math.max(peak, level);
    previous = boundedTime;
  }
  if (previous < endBeat) weighted += level * (endBeat - previous);
  return { average: Math.max(0, weighted / duration), peak };
}

function continuityScore(notes: readonly Note[], startBeat: number, endBeat: number): { score: number; outlierRate: number } {
  const melodic = extractTopVoice([...notes].sort(noteSort));
  if (!melodic.length) return { score: 0, outlierRate: 1 };
  if (melodic.length === 1) return { score: 0.35, outlierRate: 0 };
  let intervalTotal = 0;
  let outliers = 0;
  let gapTotal = 0;
  let gapLargest = 0;
  for (let index = 1; index < melodic.length; index += 1) {
    const previous = melodic[index - 1]!;
    const current = melodic[index]!;
    const interval = Math.abs(current.midi - previous.midi);
    const quality = interval <= 2 ? 1 : interval <= 5 ? 0.84 : interval <= 7 ? 0.65 : interval <= 12 ? 0.38 : interval <= 19 ? 0.16 : 0.03;
    intervalTotal += quality;
    if (interval > 12) outliers += 1;
    const gap = Math.max(0, current.start - (previous.start + previous.dur));
    gapTotal += gap;
    gapLargest = Math.max(gapLargest, gap);
  }
  const duration = Math.max(EPSILON, endBeat - startBeat);
  const gapPenalty = clamp01(0.65 * (gapTotal / duration) + 0.35 * (gapLargest / duration));
  const countFactor = Math.min(1, melodic.length / 3);
  return {
    score: clamp01((intervalTotal / (melodic.length - 1)) * countFactor * (1 - gapPenalty)),
    outlierRate: outliers / (melodic.length - 1),
  };
}

function isolatedRate(notes: readonly Note[]): number {
  if (notes.length < 2) return notes.length === 1 ? 0.5 : 1;
  const sorted = [...notes].sort(noteSort);
  let isolated = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const nearPrevious = previous !== undefined && sorted[index]!.start - previous.start <= 2.5 + EPSILON;
    const nearNext = next !== undefined && next.start - sorted[index]!.start <= 2.5 + EPSILON;
    if (!nearPrevious && !nearNext) isolated += 1;
  }
  return isolated / sorted.length;
}

function noteConfidence(notes: readonly Note[]): number | undefined {
  const values = notes
    .map((note) => finiteNumber((note as Note & { confidence?: number }).confidence))
    .filter((value): value is number => value !== undefined);
  if (!values.length) return undefined;
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function resolveWeights(options: PianoRegionSelectionOptions): PianoRegionScoreWeights {
  const aliases: Partial<PianoRegionScoreWeights> = {
    continuity: finiteNumber(options.continuityWeight),
    chroma: finiteNumber(options.chromaWeight),
    quality: finiteNumber(options.qualityWeight),
    coverage: finiteNumber(options.coverageWeight),
    gaps: finiteNumber(options.gapWeight),
    confidence: finiteNumber(options.confidenceWeight),
    pathology: finiteNumber(options.pathologyWeight),
    density: finiteNumber(options.densityWeight),
  };
  const merged = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  for (const key of Object.keys(merged) as Array<keyof PianoRegionScoreWeights>) {
    const value = aliases[key] ?? merged[key];
    merged[key] = Math.max(0, finiteNumber(value) ?? DEFAULT_WEIGHTS[key]);
  }
  return merged;
}

function scoreCandidate(
  candidate: NormalizedCandidate,
  window: NormalizedWindow,
  options: PianoRegionSelectionOptions,
  weights: PianoRegionScoreWeights,
): PianoRegionScore {
  const notes = clipRawNotes(candidate.notes, window.startBeat, window.endBeat);
  const duration = window.endBeat - window.startBeat;
  const continuity = continuityScore(notes, window.startBeat, window.endBeat);
  const explicitContinuity = lookupMetric(candidate.candidate, window.source, ["melodyContinuity", "continuity", "melodyScore"]);
  const continuityValue = explicitContinuity === undefined
    ? continuity.score
    : clamp01(continuity.score * 0.65 + clamp01(explicitContinuity) * 0.35);

  const target = targetChroma(window.source, options);
  const explicitChroma = lookupMetric(candidate.candidate, window.source, ["chromaAgreement", "chromaScore", "harmonicAgreement"]);
  const candidateChroma = uniqueNumberArray(candidate.candidate.chroma ?? candidate.candidate.referenceChroma);
  const chroma = explicitChroma !== undefined
    ? clamp01(explicitChroma)
    : target && candidateChroma
      ? cosineSimilarity(candidateChroma, target)
      : target
        ? cosineSimilarity(chromaHistogram(notes), target)
        : 0.5;

  const quality = qualityAgreement(candidate.candidate, window.source);
  const sounding = soundingDensity(notes, window.startBeat, window.endBeat);
  const soundingCoverage = duration > EPSILON ? clamp01(unionLength(notes, window.startBeat, window.endBeat) / duration) : 0;
  const explicitCoverage = lookupMetric(candidate.candidate, window.source, ["coverage", "melodyCoverage"]);
  const coverage = explicitCoverage === undefined
    ? soundingCoverage
    : clamp01(soundingCoverage * 0.65 + clamp01(explicitCoverage) * 0.35);
  const explicitGapRate = lookupMetric(candidate.candidate, window.source, ["gapRate", "melodyGapRate", "gaps"]);
  const gapRate = explicitGapRate === undefined
    ? clamp01(1 - coverage)
    : clamp01((1 - coverage) * 0.65 + clamp01(explicitGapRate) * 0.35);
  const explicitConfidence = lookupMetric(candidate.candidate, window.source, ["melodyConfidence", "confidence", "alignmentConfidence"]);
  const inferredConfidence = noteConfidence(notes);
  const confidence = explicitConfidence === undefined
    ? (inferredConfidence ?? 0.65)
    : clamp01(explicitConfidence * 0.8 + (inferredConfidence ?? explicitConfidence) * 0.2);
  const explicitDensity = lookupMetric(candidate.candidate, window.source, ["density", "soundingDensity"]);
  const density = explicitDensity === undefined ? sounding.average : Math.max(0, explicitDensity);
  const explicitPathology = lookupMetric(candidate.candidate, window.source, ["pathology", "pathologyPenalty"]);
  const densityPathology = clamp01(Math.max(0, density - 1) / 3);
  const peakPathology = clamp01(Math.max(0, sounding.peak - 1) / 5);
  const pathology = explicitPathology === undefined
    ? clamp01(0.38 * densityPathology + 0.2 * peakPathology + 0.27 * continuity.outlierRate + 0.15 * isolatedRate(notes))
    : clamp01(explicitPathology);

  const raw = notes.length === 0
    ? 0
    : weights.continuity * continuityValue
      + weights.chroma * chroma
      + weights.quality * quality
      + weights.coverage * coverage
      + weights.gaps * (1 - gapRate)
      + weights.confidence * confidence
      - weights.pathology * pathology
      - weights.density * densityPathology;
  const override = windowScoreOverride(candidate.candidate, window.source, window.id);
  const score = clamp01(override === undefined ? raw : raw * 0.7 + override * 0.3);
  const reasons: string[] = [];
  if (continuityValue >= 0.7) reasons.push("coherent melody");
  else if (continuityValue < 0.35) reasons.push("discontinuous melody");
  if (chroma > 0.7) reasons.push("chroma agreement");
  if (coverage >= 0.7) reasons.push("covered phrase");
  if (gapRate >= 0.4) reasons.push("melodic gaps");
  if (pathology >= 0.5) reasons.push("pathology penalty");
  if (density >= 2) reasons.push("dense texture penalty");
  if (reasons.length === 0) reasons.push("balanced evidence");
  return {
    candidateId: candidate.id,
    windowId: window.id,
    score,
    continuity: continuityValue,
    chroma,
    quality,
    coverage,
    gapRate,
    confidence,
    density,
    pathology,
    noteCount: notes.length,
    reasons,
  };
}

/** Score one candidate/window pair without mutating either input. */
export function scorePianoRegion(
  candidate: PianoRegionCandidate,
  window: PianoRegionWindow,
  options: PianoRegionSelectionOptions = {},
): PianoRegionScore {
  const role = options.melodyOnly ? "melody" : (options.role ?? "melody");
  const normalizedCandidate = normalizeCandidates([candidate], role)[0]!;
  const normalizedWindow = normalizeWindows([window])[0];
  if (!normalizedWindow) {
    return {
      candidateId: normalizedCandidate.id,
      windowId: String(window.id ?? window.sectionId ?? "window"),
      score: 0,
      continuity: 0,
      chroma: 0.5,
      quality: 0.5,
      coverage: 0,
      gapRate: 1,
      confidence: 0,
      density: 0,
      pathology: 1,
      noteCount: 0,
      reasons: ["invalid window"],
    };
  }
  return scoreCandidate(normalizedCandidate, normalizedWindow, options, resolveWeights(options));
}

function optionMinRegionBeats(options: PianoRegionSelectionOptions): number {
  return nonNegative(
    options.minRegionBeats
      ?? options.minimumRegionBeats
      ?? options.minRegionDurationBeats
      ?? options.minRegionDuration
      ?? options.minimumRegionDurationBeats
      ?? options.minimumRegionDuration
      ?? options.minDurationBeats
      ?? options.minimumDurationBeats,
    0,
  );
}

function optionSwitchPenalty(options: PianoRegionSelectionOptions): number {
  return nonNegative(options.switchPenalty, 0.08);
}

function optionHysteresis(options: PianoRegionSelectionOptions): number {
  return nonNegative(options.hysteresis, 0.015);
}

function stateKey(candidateIndex: number, runBeats: number): string {
  return `${candidateIndex}:${stableNumber(runBeats)}`;
}

function betterState(left: CandidatePathState, right: CandidatePathState, ids: readonly string[], tolerance: number): CandidatePathState {
  if (left.value > right.value + tolerance) return left;
  if (right.value > left.value + tolerance) return right;
  if (left.switches !== right.switches) return left.switches < right.switches ? left : right;
  const leftPath = left.path.map((index) => ids[index] ?? "").join("\u0000");
  const rightPath = right.path.map((index) => ids[index] ?? "").join("\u0000");
  return leftPath.localeCompare(rightPath) <= 0 ? left : right;
}

function bestStateForKey(
  states: Map<string, CandidatePathState>,
  state: CandidatePathState,
  ids: readonly string[],
  tolerance: number,
): void {
  const key = stateKey(state.candidateIndex, state.runBeats);
  const existing = states.get(key);
  states.set(key, existing ? betterState(state, existing, ids, tolerance) : state);
}

function selectPath(
  scoreMatrix: readonly (readonly PianoRegionScore[])[],
  candidates: readonly NormalizedCandidate[],
  windows: readonly NormalizedWindow[],
  options: PianoRegionSelectionOptions,
): number[] {
  if (!windows.length || !candidates.length) return [];
  const ids = candidates.map((candidate) => candidate.id);
  const minRegion = optionMinRegionBeats(options);
  const switchPenalty = optionSwitchPenalty(options);
  const hysteresis = optionHysteresis(options);
  const tolerance = Math.max(EPSILON, finiteNumber(options.tieTolerance) ?? DEFAULT_TIE_TOLERANCE);
  let states = new Map<string, CandidatePathState>();
  const firstDuration = Math.max(EPSILON, windows[0]!.endBeat - windows[0]!.startBeat);
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidateScore = scoreMatrix[0]![candidateIndex]?.score ?? 0;
    bestStateForKey(states, {
      candidateIndex,
      runBeats: Math.min(minRegion, firstDuration),
      value: candidateScore,
      switches: 0,
      path: [candidateIndex],
    }, ids, tolerance);
  }

  for (let windowIndex = 1; windowIndex < windows.length; windowIndex += 1) {
    const duration = Math.max(EPSILON, windows[windowIndex]!.endBeat - windows[windowIndex]!.startBeat);
    const next = new Map<string, CandidatePathState>();
    for (const previous of states.values()) {
      const stayingScore = scoreMatrix[windowIndex]![previous.candidateIndex]?.score ?? 0;
      bestStateForKey(next, {
        candidateIndex: previous.candidateIndex,
        runBeats: Math.min(minRegion, previous.runBeats + duration),
        value: previous.value + stayingScore,
        switches: previous.switches,
        path: [...previous.path, previous.candidateIndex],
      }, ids, tolerance);

      if (minRegion > EPSILON && previous.runBeats < minRegion - tolerance) continue;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (candidateIndex === previous.candidateIndex) continue;
        const score = scoreMatrix[windowIndex]![candidateIndex]?.score ?? 0;
        bestStateForKey(next, {
          candidateIndex,
          runBeats: Math.min(minRegion, duration),
          value: previous.value + score - switchPenalty - hysteresis,
          switches: previous.switches + 1,
          path: [...previous.path, candidateIndex],
        }, ids, tolerance);
      }
    }
    states = next;
  }

  const allStates = [...states.values()];
  const eligible = minRegion > EPSILON
    ? allStates.filter((state) => state.runBeats >= minRegion - tolerance)
    : allStates;
  const pool = eligible.length ? eligible : allStates;
  let best = pool[0];
  for (const state of pool.slice(1)) {
    best = best ? betterState(state, best, ids, tolerance) : state;
  }
  if (!best) return [];

  // An explicitly supplied previous/initial candidate is only a tie anchor;
  // it never overrides evidence strong enough to select a different source.
  const anchor = options.initialCandidateId ?? options.previousCandidateId;
  if (anchor && ids.includes(anchor)) {
    const anchored = pool.filter((state) => state.path[0] === ids.indexOf(anchor));
    for (const state of anchored) {
      if (Math.abs(state.value - best.value) <= tolerance) best = betterState(state, best, ids, tolerance);
    }
  }
  return best.path;
}

function regionReason(scores: readonly PianoRegionScore[]): string[] {
  const seen = new Set<string>();
  for (const score of scores) {
    for (const reason of score.reasons) seen.add(reason);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function coalesceRegions(
  path: readonly number[],
  scores: readonly (readonly PianoRegionScore[])[],
  candidates: readonly NormalizedCandidate[],
  windows: readonly NormalizedWindow[],
  role: PianoRegionRole,
): CandidateRegion[] {
  if (!path.length) return [];
  const regions: CandidateRegion[] = [];
  let startIndex = 0;
  while (startIndex < path.length) {
    const candidateIndex = path[startIndex]!;
    let endIndex = startIndex;
    while (endIndex + 1 < path.length && path[endIndex + 1] === candidateIndex
      && windows[endIndex + 1]!.startBeat <= windows[endIndex]!.endBeat + EPSILON) {
      endIndex += 1;
    }
    const selectedScores = [] as PianoRegionScore[];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const score = scores[index]![candidateIndex];
      if (score) selectedScores.push(score);
    }
    const startBeat = windows[startIndex]!.startBeat;
    const endBeat = Math.max(...windows.slice(startIndex, endIndex + 1).map((window) => window.endBeat));
    const score = selectedScores.length
      ? selectedScores.reduce((sum, item) => sum + item.score, 0) / selectedScores.length
      : 0;
    regions.push({
      startBeat,
      endBeat,
      candidateId: candidates[candidateIndex]!.id,
      score,
      reason: regionReason(selectedScores),
      windowIds: windows.slice(startIndex, endIndex + 1).map((window) => window.id),
      role,
    });
    startIndex = endIndex + 1;
  }
  return regions;
}

function protectedSet(keys: ReadonlySet<string> | readonly string[] | undefined): ReadonlySet<string> {
  if (!keys) return new Set<string>();
  return keys instanceof Set ? keys : new Set(keys);
}

function isProtected(note: Note, keys: ReadonlySet<string>): boolean {
  const identity = noteIdentity(note);
  const explicit = note as Note & { id?: string; noteId?: string; noteKey?: string };
  return keys.has(identity)
    || (typeof explicit.id === "string" && keys.has(explicit.id))
    || (typeof explicit.noteId === "string" && keys.has(explicit.noteId))
    || (typeof explicit.noteKey === "string" && keys.has(explicit.noteKey));
}

function preferNote(left: Note, right: Note, keys: ReadonlySet<string>): Note {
  const leftProtected = isProtected(left, keys);
  const rightProtected = isProtected(right, keys);
  if (leftProtected !== rightProtected) return leftProtected ? left : right;
  if (left.dur !== right.dur) return left.dur > right.dur ? left : right;
  if (left.vel !== right.vel) return left.vel > right.vel ? left : right;
  return noteIdentity(left).localeCompare(noteIdentity(right)) <= 0 ? left : right;
}

/**
 * Clip notes to a selected region and remove duplicate attacks.
 *
 * Notes crossing either boundary are retained with a shortened duration. The
 * optional protected-key set is used as a deterministic tie-breaker when two
 * duplicate source events describe the same attack; it is never mutated.
 */
export function clipRegionNotes(
  notes: readonly Note[],
  region: Pick<CandidateRegion, "startBeat" | "endBeat"> & Partial<CandidateRegion>,
  protectedKeys: ReadonlySet<string> | readonly string[] = [],
): Note[] {
  const startBeat = finiteNumber(region.startBeat);
  const endBeat = finiteNumber(region.endBeat);
  if (startBeat === undefined || endBeat === undefined || endBeat <= startBeat + EPSILON) return [];
  const keys = protectedSet(protectedKeys);
  const byIdentity = new Map<string, Note>();
  for (const note of notes) {
    if (!isUsableNote(note)) continue;
    const noteEnd = note.start + note.dur;
    const clippedStart = Math.max(startBeat, note.start);
    const clippedEnd = Math.min(endBeat, noteEnd);
    if (clippedEnd <= clippedStart + EPSILON) continue;
    const clipped = { ...note, start: clippedStart, dur: clippedEnd - clippedStart };
    const identity = noteIdentity(note);
    const previous = byIdentity.get(identity);
    byIdentity.set(identity, previous ? preferNote(previous, clipped, keys) : clipped);
  }

  // A source can carry duplicate IDs or duplicate attacks with slightly
  // different durations. Keep one attack, preferring protected/longest data.
  const byAttack = new Map<string, Note>();
  for (const note of byIdentity.values()) {
    const attack = noteAttackKey(note);
    const previous = byAttack.get(attack);
    byAttack.set(attack, previous ? preferNote(previous, note, keys) : note);
  }
  return [...byAttack.values()].sort(noteSort).map((note) => ({ ...note }));
}

function mergeSelectedPieces(pieces: readonly ClippedPiece[]): Note[] {
  const sorted = [...pieces].sort((a, b) => noteSort(a.note, b.note) || a.candidateId.localeCompare(b.candidateId));
  const output: Note[] = [];
  for (const piece of sorted) {
    const note = { ...piece.note };
    const previous = output[output.length - 1];
    if (!previous) {
      output.push(note);
      continue;
    }
    const sameAttack = Math.abs(previous.start - note.start) <= EPSILON && previous.midi === note.midi;
    if (sameAttack) continue;
    output.push(note);
  }
  return output.sort(noteSort).map((note) => ({ ...note }));
}

/**
 * Select the best melody source per aligned window, with deterministic
 * minimum-duration/switch-penalty smoothing and boundary-safe note output.
 */
export function selectPianoMelodyRegions(
  candidates: readonly PianoRegionCandidate[],
  windows: readonly PianoRegionWindow[],
  options: PianoRegionSelectionOptions = {},
): PianoRegionSelection {
  validateSelectionWindows(windows);
  const role: PianoRegionRole = options.melodyOnly ? "melody" : (options.role ?? "melody");
  const normalizedCandidates = normalizeCandidates(candidates, role);
  const normalizedWindows = normalizeWindows(windows);
  const weights = resolveWeights(options);
  const scoreMatrix: PianoRegionScore[][] = normalizedWindows.map((window) =>
    normalizedCandidates.map((candidate) => scoreCandidate(candidate, window, options, weights)));
  const path = selectPath(scoreMatrix, normalizedCandidates, normalizedWindows, options);
  const regions = coalesceRegions(path, scoreMatrix, normalizedCandidates, normalizedWindows, role);

  const pieces: ClippedPiece[] = [];
  for (const region of regions) {
    const candidate = normalizedCandidates.find((item) => item.id === region.candidateId);
    if (!candidate) continue;
    const clipped = clipRegionNotes(candidate.notes, region, []);
    pieces.push(...clipped.map((note) => ({ note, candidateId: candidate.id })));
  }
  const notes = mergeSelectedPieces(pieces);
  const flatScores = scoreMatrix.flat();
  const selectedCandidateIds: string[] = [];
  for (const candidateIndex of path) {
    const id = normalizedCandidates[candidateIndex]?.id;
    if (id && !selectedCandidateIds.includes(id)) selectedCandidateIds.push(id);
  }
  const windowSelections = path.map((candidateIndex, windowIndex) => ({
    windowId: normalizedWindows[windowIndex]!.id,
    candidateId: normalizedCandidates[candidateIndex]?.id ?? "",
    score: scoreMatrix[windowIndex]?.[candidateIndex]?.score ?? 0,
  }));
  const totalScore = windowSelections.reduce((sum, item) => sum + item.score, 0)
    - Math.max(0, selectedCandidateIds.length - 1) * optionSwitchPenalty(options);
  const switchCount = path.reduce(
    (count, candidateIndex, index) => count + (index > 0 && candidateIndex !== path[index - 1] ? 1 : 0),
    0,
  );
  return {
    regions,
    notes,
    melodyNotes: notes.map((note) => ({ ...note })),
    selectedNotes: notes.map((note) => ({ ...note })),
    selectedCandidateIds,
    scores: flatScores.map((score) => ({ ...score, reasons: [...score.reasons] })),
    role,
    diagnostics: {
      windowCount: normalizedWindows.length,
      candidateCount: normalizedCandidates.length,
      switchCount,
      totalScore,
      selectedCandidateIds: [...selectedCandidateIds],
      windowSelections,
    },
  };
}
