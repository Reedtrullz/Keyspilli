import { parseMidi, parseMusicXmlNotes, type Note, type ParsedMidi } from "@keyspilli/midi";

/**
 * A small, pure representation used by the local source-research tools.  It
 * intentionally mirrors the useful part of ParsedMidi without carrying a
 * filesystem path or a catalog/artifact handle.
 */
export interface SymbolicScoreInput {
  notes: Note[];
  tempoBpm?: number;
  durationBeats?: number;
  timeSig?: [number, number];
  keySig?: number;
  keyMode?: 0 | 1;
  title?: string;
  metadata?: unknown;
  trackNames?: string[];
  format?: number;
  division?: number;
}

export interface SymbolicNormalizeOptions {
  /** Explicit sounding pitch shift. No shift is applied by default. */
  transposeSemitones?: number;
  /** Explicit beat stretch. No stretch is applied by default. */
  beatScale?: number;
  /** Invalid note filtering is the safe default. */
  dropInvalid?: boolean;
}

export interface NormalizedSymbolicScore extends SymbolicScoreInput {
  notes: Note[];
  tempoBpm: number;
  durationBeats: number;
  timeSig: [number, number];
  keySig: number;
  keyMode: 0 | 1;
  format: number;
  division: number;
  originalNoteCount: number;
  droppedNoteCount: number;
  onsetCount: number;
  appliedTranspose: number;
  appliedBeatScale: number;
  warnings: string[];
}

export interface SymbolicAlignmentWindow {
  id: string;
  /** Reference and candidate bounds are in their respective beat domains. */
  reference: [number, number];
  candidate: [number, number];
  anchorId?: string;
}

export interface SymbolicAlignmentOptions {
  onsetToleranceBeats?: number;
  /** Explicit hypotheses are useful for annotated local comparisons. */
  offsetsBeats?: number[];
  transpositions?: number[];
  beatScales?: number[];
  /** Bounded automatic search controls. */
  allowOffset?: boolean;
  allowTranspose?: boolean;
  allowTempoStretch?: boolean;
  maxOffsetBeats?: number;
  windows?: SymbolicAlignmentWindow[];
  minMatchedOnsets?: number;
}

export interface SymbolicMatch {
  referenceIndex: number;
  candidateIndex: number;
  referenceStart: number;
  candidateStart: number;
  onsetErrorBeats: number;
  referenceMidi: number;
  candidateMidi: number;
  transposedCandidateMidi: number;
  exactPitch: boolean;
  pitchClass: boolean;
}

export interface SymbolicMetricF1 {
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface SymbolicAlignmentMetrics {
  matchedNotes: number;
  matchedReferenceNotes: number;
  matchedCandidateNotes: number;
  exactPitch: SymbolicMetricF1;
  pitchClass: SymbolicMetricF1;
  onset: SymbolicMetricF1 & { matched: number };
  score: number;
  chroma: { cosine: number | null };
  contour: { directionAgreement: number | null; matchedIntervals: number };
  density: { referenceOnsets: number; candidateOnsets: number; ratio: number | null };
}

export interface SymbolicAlignmentWindowResult {
  id: string;
  reference: [number, number];
  candidate: [number, number];
  matchedOnsets: number;
  candidateOnsets: number;
  referenceOnsets: number;
  onsetErrorBeats: { median: number | null; p90: number | null };
  exactPitch: SymbolicMetricF1;
  pitchClass: SymbolicMetricF1;
}

export type SymbolicAlignmentConfidenceLevel = "high" | "medium" | "low" | "unknown";

/**
 * Confidence is expressed in the reference/recording beat domain.  Candidate
 * beats are included only as a diagnostic mapping; they must not become the
 * target timeline authority.
 */
export interface SymbolicAlignmentConfidenceRegion {
  reference: [number, number];
  candidate: [number, number] | null;
  confidence: number;
  level: SymbolicAlignmentConfidenceLevel;
  matchedOnsets: number;
}

export interface SymbolicAlignmentResult {
  status: "aligned" | "partial" | "mismatch" | "insufficient-evidence" | "alignment-required";
  alignmentRequired: boolean;
  partialCoverage: boolean;
  offsetBeats: number;
  beatScale: number;
  transpositionSemitones: number;
  confidence: number;
  coverage: {
    referenceRatio: number;
    candidateRatio: number;
    referenceBeats: number;
    candidateBeats: number;
  };
  metrics: SymbolicAlignmentMetrics;
  matches: SymbolicMatch[];
  windows: SymbolicAlignmentWindowResult[];
  confidenceMap: SymbolicAlignmentConfidenceRegion[];
  diagnostics: string[];
}

const EPS = 1e-9;
const DEFAULT_TOLERANCE = 0.08;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asScoreInput(input: SymbolicScoreInput | ParsedMidi): SymbolicScoreInput {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as SymbolicScoreInput
    : { notes: [] };
}

function noteSort(a: Note, b: Note): number {
  return a.start - b.start
    || a.midi - b.midi
    || a.dur - b.dur
    || a.vel - b.vel
    || (a.hand ?? "").localeCompare(b.hand ?? "")
    || (a.identitySource ?? "").localeCompare(b.identitySource ?? "")
    || (a.lyrics ?? "").localeCompare(b.lyrics ?? "");
}

function normalizeNumber(value: unknown, fallback: number): number {
  return finite(value) ? value : fallback;
}

function validNote(note: unknown): note is Note {
  if (!note || typeof note !== "object") return false;
  const candidate = note as Partial<Note>;
  return finite(candidate.midi) && Number.isInteger(candidate.midi) && candidate.midi >= 0 && candidate.midi <= 127
    && finite(candidate.start) && candidate.start >= 0
    && finite(candidate.dur) && candidate.dur > 0
    && finite(candidate.vel) && candidate.vel >= 0 && candidate.vel <= 127;
}

function onsetGroups(notes: readonly Note[], tolerance: number): Note[][] {
  const groups: Note[][] = [];
  for (const note of [...notes].sort(noteSort)) {
    const last = groups.at(-1);
    if (last && note.start - last[0]!.start <= tolerance + EPS) last.push(note);
    else groups.push([note]);
  }
  return groups;
}

/** Normalize a parsed symbolic source without quantizing or publishing it. */
export function normalizeSymbolicScore(
  input: SymbolicScoreInput | ParsedMidi,
  options: SymbolicNormalizeOptions = {},
): NormalizedSymbolicScore {
  const source = asScoreInput(input);
  const original: unknown[] = Array.isArray(source.notes) ? source.notes : [];
  const dropInvalid = options.dropInvalid !== false;
  const requestedTranspose = options.transposeSemitones;
  const transpose = finite(requestedTranspose) && Number.isInteger(requestedTranspose) && requestedTranspose >= -127 && requestedTranspose <= 127
    ? requestedTranspose : 0;
  const beatScale = finite(options.beatScale) && options.beatScale! > 0 && options.beatScale! <= 16 ? options.beatScale! : 1;
  const warnings: string[] = [];
  const valid = original.filter(validNote);
  if (requestedTranspose !== undefined && transpose === 0 && requestedTranspose !== 0) warnings.push("ignored invalid symbolic transpose");
  if (options.beatScale !== undefined && beatScale === 1 && options.beatScale !== 1) warnings.push("ignored invalid symbolic beat scale");
  const droppedInvalid = original.length - valid.length;
  if (droppedInvalid) warnings.push("dropped " + droppedInvalid + " invalid symbolic note" + (droppedInvalid === 1 ? "" : "s"));
  // Normalized scores never expose malformed Note values. Keep the
  // compatibility option, but omit and report invalid entries safely.
  void dropInvalid;
  const transformed = valid.map((note) => ({
    ...note,
    midi: note.midi + transpose,
    start: note.start * beatScale,
    dur: note.dur * beatScale,
  })).filter((note) => note.midi >= 0 && note.midi <= 127 && Number.isInteger(note.midi) && finite(note.start) && finite(note.dur) && note.dur > 0).sort(noteSort);
  const notes = transformed;
  const dropped = original.length - notes.length;
  if (dropped > droppedInvalid) {
    const extra = dropped - droppedInvalid;
    warnings.push("dropped " + extra + " out-of-range transformed symbolic note" + (extra === 1 ? "" : "s"));
  }
  const originalExtent = valid.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  const declaredDuration = finite(source.durationBeats) && source.durationBeats! >= 0 ? source.durationBeats! : originalExtent;
  const normalizedDuration = Math.max(declaredDuration, originalExtent) * beatScale;
  return {
    ...source,
    notes,
    tempoBpm: finite(source.tempoBpm) && source.tempoBpm! > 0 ? source.tempoBpm! : 120,
    durationBeats: normalizedDuration,
    timeSig: source.timeSig && source.timeSig.length === 2 && finite(source.timeSig[0]) && finite(source.timeSig[1]) && source.timeSig[0]! > 0 && source.timeSig[1]! > 0
      ? [source.timeSig[0]!, source.timeSig[1]!] : [4, 4],
    keySig: finite(source.keySig) ? source.keySig! : 0,
    keyMode: source.keyMode === 1 ? 1 : 0,
    format: finite(source.format) && Number.isInteger(source.format) ? source.format! : 1,
    division: finite(source.division) && source.division! > 0 ? source.division! : 480,
    originalNoteCount: original.length,
    droppedNoteCount: dropped,
    onsetCount: onsetGroups(notes, DEFAULT_TOLERANCE).length,
    appliedTranspose: transpose,
    appliedBeatScale: beatScale,
    warnings,
  };
}

/** Parse a MIDI byte buffer, MusicXML string, or already parsed score. */
export function parseSymbolicCandidate(
  input: Uint8Array | string | SymbolicScoreInput | ParsedMidi,
  formatHint?: "midi" | "musicxml" | "mxl",
): NormalizedSymbolicScore {
  let parsed: SymbolicScoreInput | ParsedMidi;
  if (typeof input === "string") {
    parsed = parseMusicXmlNotes(input);
  } else if (input instanceof Uint8Array) {
    parsed = parseMidi(input);
  } else {
    parsed = input;
  }
  // `formatHint` is intentionally diagnostic only: the pure adapter does not
  // fetch or unpack files. MXL dispatch belongs to the caller's byte parser.
  const normalized = normalizeSymbolicScore(parsed);
  if (formatHint === "mxl") normalized.warnings.push("MXL container must be unpacked before symbolic parsing");
  return normalized;
}

interface IndexedGroup {
  start: number;
  notes: Note[];
  /** Stable indexes in the normalized, sorted score (duplicates included). */
  noteIndices: number[];
  /** Original reference-domain starts when a group is transformed for matching. */
  matchStarts?: number[];
  index: number;
}

function indexedGroups(notes: readonly Note[], tolerance: number, bounds?: [number, number]): IndexedGroup[] {
  const indexed = notes
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => !bounds || (note.start >= bounds[0]! - EPS && note.start < bounds[1]! - EPS))
    .sort((a, b) => noteSort(a.note, b.note) || a.index - b.index);
  const groups: IndexedGroup[] = [];
  for (const entry of indexed) {
    const last = groups.at(-1);
    if (last && entry.note.start - last.start <= tolerance + EPS) {
      last.notes.push(entry.note);
      last.noteIndices.push(entry.index);
    } else {
      groups.push({ start: entry.note.start, notes: [entry.note], noteIndices: [entry.index], index: groups.length });
    }
  }
  return groups;
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall <= EPS) return null;
  return (2 * precision * recall) / (precision + recall);
}

function metric(tp: number, predicted: number, actual: number): SymbolicMetricF1 {
  const precision = predicted ? tp / predicted : null;
  const recall = actual ? tp / actual : null;
  return { precision: precision === null ? null : round(precision), recall: recall === null ? null : round(recall), f1: f1(precision, recall) === null ? null : round(f1(precision, recall)!) };
}

function cosine(a: number[], b: number[]): number | null {
  const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  if (normA <= EPS || normB <= EPS) return null;
  return round(a.reduce((sum, value, index) => sum + value * b[index]!, 0) / (normA * normB));
}

function chromaVector(notes: readonly Note[], transpose: number): number[] {
  const vector = Array.from({ length: 12 }, () => 0);
  for (const note of notes) {
    const index = ((note.midi + transpose) % 12 + 12) % 12;
    vector[index] = (vector[index] ?? 0) + 1;
  }
  return vector;
}

function sortedUnique(values: readonly number[], fallback: number[]): number[] {
  const result = [...new Set(values.filter((value) => finite(value)))].sort((a, b) => a - b);
  return result.length ? result : fallback;
}

function defaultOffsets(reference: NormalizedSymbolicScore, candidate: NormalizedSymbolicScore, maxOffset: number): number[] {
  const refGroups = indexedGroups(reference.notes, DEFAULT_TOLERANCE);
  const candGroups = indexedGroups(candidate.notes, DEFAULT_TOLERANCE);
  const offsets = new Set<number>([0]);
  for (const referenceGroup of refGroups.slice(0, 8)) {
    for (const candidateGroup of candGroups.slice(0, 24)) {
      const difference = candidateGroup.start - referenceGroup.start;
      if (Math.abs(difference) <= maxOffset + EPS) offsets.add(round(difference, 3));
    }
  }
  // Keep automatic search bounded. Explicit offsets/windows are the escape
  // hatch for long intros or annotated excerpts with a larger displacement.
  return [...offsets]
    .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
    .slice(0, 32)
    .sort((a, b) => a - b);
}

function defaultScales(options: SymbolicAlignmentOptions): number[] {
  if (options.allowTempoStretch === false) return [1];
  // Keep the automatic search narrow. Wider experiments must be explicit in
  // the report/options so a duration mismatch is never silently normalized.
  return [0.9, 0.95, 1, 1.05, 1.1];
}

function defaultTranspositions(options: SymbolicAlignmentOptions): number[] {
  if (options.allowTranspose === false) return [0];
  return Array.from({ length: 25 }, (_, index) => index - 12);
}

const MAX_AUTOMATIC_HYPOTHESES = 1024;
const AUTOMATIC_SAMPLE_GROUPS = 192;

interface HypothesisParameters {
  offset: number;
  scale: number;
  transpose: number;
}

interface BoundedHypothesisSearch {
  parameters: HypothesisParameters[];
  considered: number;
  capped: boolean;
}

function pairGroupNotes(
  reference: IndexedGroup,
  candidate: IndexedGroup,
  transpose: number,
): SymbolicMatch[] {
  const pairs: Array<{ referenceIndex: number; candidateIndex: number; cost: number; exact: boolean; pitchClass: boolean }> = [];
  for (let ri = 0; ri < reference.notes.length; ri += 1) {
    for (let ci = 0; ci < candidate.notes.length; ci += 1) {
      const ref = reference.notes[ri]!;
      const cand = candidate.notes[ci]!;
      const shifted = cand.midi + transpose;
      const pitchDistance = Math.abs(shifted - ref.midi);
      const exact = pitchDistance <= EPS;
      const pitchClass = ((shifted - ref.midi) % 12 + 12) % 12 === 0;
      const cost = pitchDistance * 10 + Math.abs(cand.start - ref.start) + Math.abs(cand.dur - ref.dur) * 0.1 + ci * 1e-6 + ri * 1e-7;
      pairs.push({ referenceIndex: ri, candidateIndex: ci, cost, exact, pitchClass });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost || a.referenceIndex - b.referenceIndex || a.candidateIndex - b.candidateIndex);
  const usedReference = new Set<number>();
  const usedCandidate = new Set<number>();
  const matches: SymbolicMatch[] = [];
  for (const pair of pairs) {
    if (usedReference.has(pair.referenceIndex) || usedCandidate.has(pair.candidateIndex)) continue;
    usedReference.add(pair.referenceIndex);
    usedCandidate.add(pair.candidateIndex);
    const ref = reference.notes[pair.referenceIndex]!;
    const cand = candidate.notes[pair.candidateIndex]!;
    const referenceStart = reference.matchStarts?.[pair.referenceIndex] ?? ref.start;
    matches.push({
      referenceIndex: reference.noteIndices[pair.referenceIndex]!,
      candidateIndex: candidate.noteIndices[pair.candidateIndex]!,
      referenceStart,
      candidateStart: cand.start,
      onsetErrorBeats: round(Math.abs(cand.start - ref.start)),
      referenceMidi: ref.midi,
      candidateMidi: cand.midi,
      transposedCandidateMidi: cand.midi + transpose,
      exactPitch: pair.exact,
      pitchClass: pair.pitchClass,
    });
  }
  return matches;
}

interface Hypothesis {
  offset: number;
  scale: number;
  transpose: number;
  matches: SymbolicMatch[];
  matchedOnsets: number;
  referenceGroups: IndexedGroup[];
  candidateGroups: IndexedGroup[];
  referenceNoteCount: number;
  candidateNoteCount: number;
  score: number;
  onsetErrors: number[];
}

function inBounds(value: number, bounds: [number, number]): boolean {
  return value >= bounds[0]! - EPS && value < bounds[1]! - EPS;
}

function groupNoteCount(groups: readonly IndexedGroup[]): number {
  return groups.reduce((sum, group) => sum + group.notes.length, 0);
}

function nearestAvailableGroup(
  groups: readonly IndexedGroup[],
  target: number,
  tolerance: number,
  used: ReadonlySet<number>,
  eligible?: (group: IndexedGroup) => boolean,
): { group: IndexedGroup; error: number } | undefined {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (groups[middle]!.start < target - tolerance - EPS) low = middle + 1;
    else high = middle;
  }
  let best: { group: IndexedGroup; error: number } | undefined;
  for (let index = low; index < groups.length; index += 1) {
    const group = groups[index]!;
    const error = Math.abs(group.start - target);
    if (error > tolerance + EPS) break;
    if (used.has(group.index) || (eligible && !eligible(group))) continue;
    if (!best || error < best.error - EPS || (Math.abs(error - best.error) <= EPS && group.index < best.group.index)) {
      best = { group, error };
    }
  }
  // A group immediately before the lower bound can still be the closest one.
  for (let index = low - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const error = Math.abs(group.start - target);
    if (error > tolerance + EPS) break;
    if (used.has(group.index) || (eligible && !eligible(group))) continue;
    if (!best || error < best.error - EPS || (Math.abs(error - best.error) <= EPS && group.index < best.group.index)) {
      best = { group, error };
    }
  }
  return best;
}

function quickHypothesisScore(
  referenceGroups: readonly IndexedGroup[],
  candidateGroups: readonly IndexedGroup[],
  parameters: HypothesisParameters,
  tolerance: number,
): number {
  if (!referenceGroups.length || !candidateGroups.length) return 0;
  const stride = Math.max(1, Math.ceil(referenceGroups.length / AUTOMATIC_SAMPLE_GROUPS));
  const sampledReferenceGroups = referenceGroups.filter((_, index) => index % stride === 0);
  const usedCandidate = new Set<number>();
  let matchedOnsets = 0;
  let referenceNotes = 0;
  let exactNotes = 0;
  let pitchClassNotes = 0;
  for (const referenceGroup of sampledReferenceGroups) {
    referenceNotes += referenceGroup.notes.length;
    const selected = nearestAvailableGroup(
      candidateGroups,
      referenceGroup.start * parameters.scale + parameters.offset,
      tolerance,
      usedCandidate,
    );
    if (!selected) continue;
    usedCandidate.add(selected.group.index);
    matchedOnsets += 1;
    const transformedReference = {
      ...referenceGroup,
      notes: referenceGroup.notes.map((note) => ({
        ...note,
        start: note.start * parameters.scale + parameters.offset,
      })),
    };
    const matches = pairGroupNotes(transformedReference, selected.group, parameters.transpose);
    exactNotes += matches.filter((match) => match.exactPitch).length;
    pitchClassNotes += matches.filter((match) => match.pitchClass).length;
  }
  if (!referenceNotes) return 0;
  const onsetRatio = matchedOnsets / sampledReferenceGroups.length;
  const exactRatio = exactNotes / referenceNotes;
  const pitchClassRatio = pitchClassNotes / referenceNotes;
  return onsetRatio * 0.45 + exactRatio * 0.4 + pitchClassRatio * 0.15;
}

function parameterOrder(a: HypothesisParameters, b: HypothesisParameters): number {
  return Math.abs(a.offset) - Math.abs(b.offset)
    || Math.abs(a.transpose) - Math.abs(b.transpose)
    || Math.abs(a.scale - 1) - Math.abs(b.scale - 1)
    || a.offset - b.offset
    || a.scale - b.scale
    || a.transpose - b.transpose;
}

function boundedAutomaticHypotheses(
  offsets: readonly number[],
  scales: readonly number[],
  transpositions: readonly number[],
  referenceGroups: readonly IndexedGroup[],
  candidateGroups: readonly IndexedGroup[],
  tolerance: number,
): BoundedHypothesisSearch {
  const parameters = scales.flatMap((scale) => offsets.flatMap((offset) => transpositions.map((transpose) => ({ offset, scale, transpose }))));
  if (parameters.length <= MAX_AUTOMATIC_HYPOTHESES) return { parameters, considered: parameters.length, capped: false };

  const scored = parameters.map((parameter, ordinal) => ({
    parameter,
    ordinal,
    score: quickHypothesisScore(referenceGroups, candidateGroups, parameter, tolerance),
  }));
  const compare = (a: typeof scored[number], b: typeof scored[number]): number => b.score - a.score
    || parameterOrder(a.parameter, b.parameter)
    || a.ordinal - b.ordinal;
  const perTranspose = Math.max(1, Math.floor(MAX_AUTOMATIC_HYPOTHESES / Math.max(1, transpositions.length)));
  const selected = new Set<number>();
  for (const transpose of transpositions) {
    scored
      .filter((entry) => entry.parameter.transpose === transpose)
      .sort(compare)
      .slice(0, perTranspose)
      .forEach((entry) => selected.add(entry.ordinal));
  }
  for (const entry of [...scored].sort(compare)) {
    if (selected.size >= MAX_AUTOMATIC_HYPOTHESES) break;
    selected.add(entry.ordinal);
  }
  return {
    parameters: [...selected].sort((a, b) => a - b).slice(0, MAX_AUTOMATIC_HYPOTHESES).map((ordinal) => parameters[ordinal]!),
    considered: parameters.length,
    capped: true,
  };
}

function evaluateHypothesis(
  reference: NormalizedSymbolicScore,
  candidate: NormalizedSymbolicScore,
  offset: number,
  scale: number,
  transpose: number,
  tolerance: number,
  windows?: SymbolicAlignmentWindow[],
  allReferenceGroups: IndexedGroup[] = indexedGroups(reference.notes, tolerance),
  allCandidateGroups: IndexedGroup[] = indexedGroups(candidate.notes, tolerance),
): Hypothesis {
  const referenceGroups = windows?.length
    ? allReferenceGroups.filter((group) => windows.some((window) => inBounds(group.start, window.reference)))
    : allReferenceGroups;
  const candidateGroups = windows?.length
    ? allCandidateGroups.filter((group) => windows.some((window) => inBounds(group.start, window.candidate)))
    : allCandidateGroups;
  const usedCandidate = new Set<number>();
  const matches: SymbolicMatch[] = [];
  const onsetErrors: number[] = [];
  let matchedOnsets = 0;
  for (const referenceGroup of referenceGroups) {
    const transformed = referenceGroup.start * scale + offset;
    const referenceWindowIds = windows?.length
      ? new Set(windows.filter((window) => inBounds(referenceGroup.start, window.reference)).map((window) => window.id))
      : undefined;
    const eligibleCandidate = referenceWindowIds
      ? (group: IndexedGroup) => windows!.some((window) => referenceWindowIds.has(window.id) && inBounds(group.start, window.candidate))
      : undefined;
    const selected = nearestAvailableGroup(candidateGroups, transformed, tolerance, usedCandidate, eligibleCandidate);
    if (!selected) continue;
    usedCandidate.add(selected.group.index);
    matchedOnsets += 1;
    onsetErrors.push(selected.error);
    const refAtTransformed = {
      ...referenceGroup,
      notes: referenceGroup.notes.map((note) => ({ ...note, start: note.start * scale + offset })),
      matchStarts: referenceGroup.notes.map((note) => note.start),
    };
    matches.push(...pairGroupNotes(refAtTransformed, selected.group, transpose));
  }
  const exact = matches.filter((match) => match.exactPitch).length;
  const pitchClass = matches.filter((match) => match.pitchClass).length;
  const totalReference = groupNoteCount(referenceGroups);
  const totalCandidate = groupNoteCount(candidateGroups);
  const onsetRecall = referenceGroups.length ? matchedOnsets / referenceGroups.length : 0;
  const onsetPrecision = candidateGroups.length ? matchedOnsets / candidateGroups.length : 0;
  const exactRecall = totalReference ? exact / totalReference : 0;
  const exactPrecision = totalCandidate ? exact / totalCandidate : 0;
  const pcRecall = totalReference ? pitchClass / totalReference : 0;
  const pcPrecision = totalCandidate ? pitchClass / totalCandidate : 0;
  const score = onsetRecall * 0.3 + onsetPrecision * 0.15 + exactRecall * 0.3 + exactPrecision * 0.15 + pcRecall * 0.05 + pcPrecision * 0.05;
  return {
    offset,
    scale,
    transpose,
    matches,
    matchedOnsets,
    referenceGroups,
    candidateGroups,
    referenceNoteCount: totalReference,
    candidateNoteCount: totalCandidate,
    score,
    onsetErrors,
  };
}

function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]!);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function buildMetrics(
  reference: NormalizedSymbolicScore,
  candidate: NormalizedSymbolicScore,
  hypothesis: Hypothesis,
  tolerance: number,
): SymbolicAlignmentMetrics {
  const exact = hypothesis.matches.filter((match) => match.exactPitch).length;
  const pitchClass = hypothesis.matches.filter((match) => match.pitchClass).length;
  const onset = metric(hypothesis.matchedOnsets, hypothesis.candidateGroups.length, hypothesis.referenceGroups.length);
  const exactMetric = metric(exact, hypothesis.candidateNoteCount, hypothesis.referenceNoteCount);
  const pitchClassMetric = metric(pitchClass, hypothesis.candidateNoteCount, hypothesis.referenceNoteCount);
  const contourByReference = new Map<number, { referenceMidi: number; candidateMidi: number }>();
  for (const match of hypothesis.matches) {
    const existing = contourByReference.get(match.referenceStart);
    if (!existing || match.referenceMidi > existing.referenceMidi || (match.referenceMidi === existing.referenceMidi && match.candidateMidi > existing.candidateMidi)) {
      contourByReference.set(match.referenceStart, { referenceMidi: match.referenceMidi, candidateMidi: match.transposedCandidateMidi });
    }
  }
  const contour = [...contourByReference.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  const directionPairs = contour.length - 1;
  let directionAgreement = 0;
  for (let index = 1; index <= directionPairs; index += 1) {
    const refDirection = Math.sign(contour[index]!.referenceMidi - contour[index - 1]!.referenceMidi);
    const candDirection = Math.sign(contour[index]!.candidateMidi - contour[index - 1]!.candidateMidi);
    if (refDirection === candDirection) directionAgreement += 1;
  }
  const referenceNotes = hypothesis.referenceGroups.flatMap((group) => group.notes);
  const candidateNotes = hypothesis.candidateGroups.flatMap((group) => group.notes);
  const refChroma = chromaVector(referenceNotes.length ? referenceNotes : reference.notes, 0);
  const candChroma = chromaVector(candidateNotes.length ? candidateNotes : candidate.notes, hypothesis.transpose);
  const candidateSpan = Math.max(0, hypothesis.candidateGroups.length ? Math.max(...hypothesis.candidateGroups.flatMap((group) => group.notes.map((note) => note.start + note.dur))) : candidate.durationBeats);
  const referenceSpan = Math.max(0, hypothesis.referenceGroups.length ? Math.max(...hypothesis.referenceGroups.flatMap((group) => group.notes.map((note) => note.start + note.dur))) : reference.durationBeats);
  return {
    matchedNotes: hypothesis.matches.length,
    matchedReferenceNotes: new Set(hypothesis.matches.map((match) => match.referenceIndex)).size,
    matchedCandidateNotes: new Set(hypothesis.matches.map((match) => match.candidateIndex)).size,
    exactPitch: exactMetric,
    pitchClass: pitchClassMetric,
    onset: { ...onset, matched: hypothesis.matchedOnsets },
    score: round(hypothesis.score),
    chroma: { cosine: cosine(refChroma, candChroma) },
    contour: { directionAgreement: directionPairs > 0 ? round(directionAgreement / directionPairs) : null, matchedIntervals: Math.max(0, directionPairs) },
    density: { referenceOnsets: hypothesis.referenceGroups.length, candidateOnsets: hypothesis.candidateGroups.length, ratio: referenceSpan > EPS && candidateSpan > EPS ? round((hypothesis.candidateGroups.length / candidateSpan) / (hypothesis.referenceGroups.length / referenceSpan)) : null },
  };
}

function windowResults(
  reference: NormalizedSymbolicScore,
  candidate: NormalizedSymbolicScore,
  hypothesis: Hypothesis,
  tolerance: number,
  windows: SymbolicAlignmentWindow[] | undefined,
): SymbolicAlignmentWindowResult[] {
  if (!windows?.length) return [];
  return windows.map((window) => {
    const refGroups = indexedGroups(reference.notes, tolerance, window.reference);
    const candGroups = indexedGroups(candidate.notes, tolerance, window.candidate);
    const matches = hypothesis.matches.filter((match) => match.referenceStart >= window.reference[0]! - EPS && match.referenceStart < window.reference[1]! - EPS && match.candidateStart >= window.candidate[0]! - EPS && match.candidateStart < window.candidate[1]! - EPS);
    const referenceGroupByNote = new Map<number, number>();
    for (let groupIndex = 0; groupIndex < refGroups.length; groupIndex += 1) {
      for (const noteIndex of refGroups[groupIndex]!.noteIndices) referenceGroupByNote.set(noteIndex, groupIndex);
    }
    const matchedReferenceGroups = new Set<number>();
    for (const match of matches) {
      const groupIndex = referenceGroupByNote.get(match.referenceIndex);
      if (groupIndex !== undefined) matchedReferenceGroups.add(groupIndex);
    }
    const exact = matches.filter((match) => match.exactPitch).length;
    const pc = matches.filter((match) => match.pitchClass).length;
    const errors = matches.map((match) => match.onsetErrorBeats);
    return {
      id: window.id,
      reference: window.reference,
      candidate: window.candidate,
      matchedOnsets: matchedReferenceGroups.size,
      candidateOnsets: candGroups.length,
      referenceOnsets: refGroups.length,
      onsetErrorBeats: { median: quantile(errors, 0.5), p90: quantile(errors, 0.9) },
      exactPitch: metric(exact, candGroups.reduce((sum, group) => sum + group.notes.length, 0), refGroups.reduce((sum, group) => sum + group.notes.length, 0)),
      pitchClass: metric(pc, candGroups.reduce((sum, group) => sum + group.notes.length, 0), refGroups.reduce((sum, group) => sum + group.notes.length, 0)),
    };
  });
}

function normalizedWindows(input: SymbolicAlignmentWindow[] | undefined): { windows: SymbolicAlignmentWindow[]; invalid: number } {
  if (input === undefined) return { windows: [], invalid: 0 };
  if (!Array.isArray(input)) return { windows: [], invalid: 1 };
  if (!input.length) return { windows: [], invalid: 0 };
  const valid: SymbolicAlignmentWindow[] = [];
  let invalid = 0;
  const seenIds = new Set<string>();
  for (const window of input) {
    const reference = window?.reference;
    const candidate = window?.candidate;
    if (typeof window?.id !== "string" || !window.id || !reference || !candidate
      || reference.length !== 2 || candidate.length !== 2
      || !reference.every(finite) || !candidate.every(finite)
      || reference[1]! <= reference[0]! || candidate[1]! <= candidate[0]!
      || reference[0]! < 0 || candidate[0]! < 0) {
      invalid += 1;
      continue;
    }
    if (seenIds.has(window.id)) {
      invalid += 1;
      continue;
    }
    seenIds.add(window.id);
    valid.push({
      id: window.id,
      reference: [reference[0]!, reference[1]!] as [number, number],
      candidate: [candidate[0]!, candidate[1]!] as [number, number],
      ...(window.anchorId ? { anchorId: window.anchorId } : {}),
    });
  }
  const nonOverlapping: SymbolicAlignmentWindow[] = [];
  for (const window of [...valid].sort((a, b) => a.reference[0]! - b.reference[0]!
    || a.reference[1]! - b.reference[1]!
    || a.candidate[0]! - b.candidate[0]!
    || a.candidate[1]! - b.candidate[1]!
    || a.id.localeCompare(b.id))) {
    const overlaps = nonOverlapping.some((previous) =>
      (window.reference[0]! < previous.reference[1]! - EPS && previous.reference[0]! < window.reference[1]! - EPS)
      || (window.candidate[0]! < previous.candidate[1]! - EPS && previous.candidate[0]! < window.candidate[1]! - EPS));
    if (overlaps) {
      invalid += 1;
      continue;
    }
    nonOverlapping.push(window);
  }
  nonOverlapping.sort((a, b) => a.id.localeCompare(b.id)
    || a.reference[0]! - b.reference[0]!
    || a.reference[1]! - b.reference[1]!
    || a.candidate[0]! - b.candidate[0]!
    || a.candidate[1]! - b.candidate[1]!);
  return { windows: nonOverlapping, invalid };
}

function windowHypotheses(windows: readonly SymbolicAlignmentWindow[]): { offsets: number[]; scales: number[] } {
  const offsets = new Set<number>();
  const scales = new Set<number>();
  for (const window of windows) {
    const referenceSpan = window.reference[1]! - window.reference[0]!;
    const candidateSpan = window.candidate[1]! - window.candidate[0]!;
    const scale = referenceSpan > EPS && candidateSpan > EPS ? candidateSpan / referenceSpan : 1;
    if (finite(scale) && scale > 0) {
      scales.add(round(scale, 6));
      offsets.add(round(window.candidate[0]! - window.reference[0]! * scale, 6));
    }
  }
  return { offsets: [...offsets].sort((a, b) => a - b), scales: [...scales].sort((a, b) => a - b) };
}

function confidenceLevel(confidence: number, matchedOnsets: number): SymbolicAlignmentConfidenceLevel {
  if (matchedOnsets <= 0 || confidence <= EPS) return "unknown";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function confidenceRegion(
  reference: [number, number],
  candidate: [number, number] | null,
  confidence: number,
  matchedOnsets: number,
): SymbolicAlignmentConfidenceRegion {
  const bounded = round(clamp(confidence, 0, 1));
  return {
    reference: [round(reference[0]), round(reference[1])] as [number, number],
    candidate: candidate ? [round(candidate[0]), round(candidate[1])] as [number, number] : null,
    confidence: bounded,
    level: confidenceLevel(bounded, matchedOnsets),
    matchedOnsets,
  };
}

/**
 * Build an additive, conservative timeline map.  Unmatched reference spans
 * are explicitly UNKNOWN, even when a different span aligned strongly.
 */
function buildConfidenceMap(
  reference: NormalizedSymbolicScore,
  hypothesis: Hypothesis,
  windows: readonly SymbolicAlignmentWindow[],
  tolerance: number,
): SymbolicAlignmentConfidenceRegion[] {
  if (windows.length) {
    const mapped = windows.map((window) => {
      const matches = hypothesis.matches.filter((match) =>
        match.referenceStart >= window.reference[0]! - EPS
        && match.referenceStart < window.reference[1]! - EPS
        && match.candidateStart >= window.candidate[0]! - EPS
        && match.candidateStart < window.candidate[1]! - EPS);
      const matchedOnsets = new Set(matches.map((match) => match.referenceStart)).size;
      const confidence = matches.length
        ? matches.reduce((sum, match) => sum + (match.exactPitch ? 1 : match.pitchClass ? 0.75 : 0.5)
          * Math.max(0, 1 - match.onsetErrorBeats / Math.max(tolerance * 4, 0.25)), 0) / matches.length
        : 0;
      return confidenceRegion(window.reference, matches.length
        ? [Math.min(...matches.map((match) => match.candidateStart)), Math.max(...matches.map((match) => match.candidateStart)) + tolerance]
        : null, confidence, matchedOnsets);
    });
    const gaps: SymbolicAlignmentConfidenceRegion[] = [];
    let cursor = 0;
    for (const region of [...mapped].sort((a, b) => a.reference[0] - b.reference[0])) {
      if (region.reference[0] > cursor + EPS) gaps.push(confidenceRegion([cursor, region.reference[0]], null, 0, 0));
      cursor = Math.max(cursor, region.reference[1]);
    }
    if (cursor < reference.durationBeats - EPS) gaps.push(confidenceRegion([cursor, reference.durationBeats], null, 0, 0));
    return [...mapped, ...gaps].sort((a, b) => a.reference[0] - b.reference[0] || a.reference[1] - b.reference[1]);
  }

  const matches = [...hypothesis.matches].sort((a, b) => a.referenceStart - b.referenceStart || a.candidateStart - b.candidateStart);
  if (!matches.length) return reference.durationBeats > EPS
    ? [confidenceRegion([0, reference.durationBeats], null, 0, 0)] : [];
  const starts = [...new Set(hypothesis.referenceGroups.map((group) => group.start))].sort((a, b) => a - b);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const cadence = gaps.length ? Math.max(0.25, Math.min(...gaps)) : 0.5;
  const result: SymbolicAlignmentConfidenceRegion[] = [];
  let cursor = 0;
  let index = 0;
  while (index < matches.length) {
    const first = matches[index]!;
    let last = first;
    const run: SymbolicMatch[] = [first];
    while (index + 1 < matches.length) {
      const next = matches[index + 1]!;
      if (next.referenceStart - last.referenceStart > cadence * 1.75 + tolerance) break;
      run.push(next);
      last = next;
      index += 1;
    }
    const end = Math.min(reference.durationBeats, last.referenceStart + cadence);
    if (first.referenceStart > cursor + EPS) result.push(confidenceRegion([cursor, first.referenceStart], null, 0, 0));
    const quality = run.reduce((sum, match) => sum + (match.exactPitch ? 1 : match.pitchClass ? 0.75 : 0.5)
      * Math.max(0, 1 - match.onsetErrorBeats / Math.max(tolerance * 4, 0.25)), 0) / run.length;
    result.push(confidenceRegion([first.referenceStart, end], [first.candidateStart, last.candidateStart + cadence * hypothesis.scale], quality, new Set(run.map((match) => match.referenceStart)).size));
    cursor = end;
    index += 1;
  }
  if (cursor < reference.durationBeats - EPS) result.push(confidenceRegion([cursor, reference.durationBeats], null, 0, 0));
  return result;
}

/**
 * Align a reference score (first argument) to a candidate score (second
 * argument). `offsetBeats` is the candidate's leading offset: candidate beat
 * = reference beat * beatScale + offsetBeats.
 */
export function alignSymbolicScores(
  referenceInput: SymbolicScoreInput | ParsedMidi,
  candidateInput: SymbolicScoreInput | ParsedMidi,
  options: SymbolicAlignmentOptions = {},
): SymbolicAlignmentResult {
  options = options && typeof options === "object" ? options : {};
  const reference = normalizeSymbolicScore(referenceInput);
  const candidate = normalizeSymbolicScore(candidateInput);
  const tolerance = clamp(normalizeNumber(options.onsetToleranceBeats, DEFAULT_TOLERANCE), 0.001, 1);
  const normalizedWindowResult = normalizedWindows(options.windows);
  const windows = normalizedWindowResult.windows;
  const invalidOnlyWindows = options.windows !== undefined && normalizedWindowResult.invalid > 0 && windows.length === 0;
  const durationRatio = reference.durationBeats > EPS && candidate.durationBeats > EPS
    ? candidate.durationBeats / reference.durationBeats : 1;
  const explicitOffsetLimit = normalizeNumber(options.maxOffsetBeats, 16);
  const hasExplicitHypothesis = windows.length > 0
    || (options.beatScales?.some((scale) => finite(scale) && Math.abs(scale - 1) > EPS) ?? false)
    || (options.offsetsBeats?.some((offset) => finite(offset) && Math.abs(offset) > explicitOffsetLimit) ?? false);
  const unannotatedExtremeMismatch = !hasExplicitHypothesis && (durationRatio < 0.25 || durationRatio > 4);
  if (invalidOnlyWindows || unannotatedExtremeMismatch) {
    const emptyMetric: SymbolicAlignmentMetrics = {
      matchedNotes: 0, matchedReferenceNotes: 0, matchedCandidateNotes: 0,
      exactPitch: metric(0, candidate.notes.length, reference.notes.length),
      pitchClass: metric(0, candidate.notes.length, reference.notes.length),
      onset: { ...metric(0, indexedGroups(candidate.notes, tolerance).length, indexedGroups(reference.notes, tolerance).length), matched: 0 },
      score: 0,
      chroma: { cosine: null }, contour: { directionAgreement: null, matchedIntervals: 0 },
      density: { referenceOnsets: 0, candidateOnsets: 0, ratio: null },
    };
    return {
      status: "alignment-required",
      alignmentRequired: true,
      partialCoverage: false,
      offsetBeats: 0,
      beatScale: 1,
      transpositionSemitones: 0,
      confidence: 0,
      coverage: { referenceRatio: 0, candidateRatio: 0, referenceBeats: reference.durationBeats, candidateBeats: candidate.durationBeats },
      metrics: emptyMetric,
      matches: [],
      windows: [],
      confidenceMap: reference.durationBeats > EPS ? [confidenceRegion([0, reference.durationBeats], null, 0, 0)] : [],
      diagnostics: [invalidOnlyWindows ? "all supplied alignment windows are invalid" : "candidate/reference duration mismatch requires explicit alignment windows or anchors"],
    };
  }

  const maxOffset = clamp(normalizeNumber(options.maxOffsetBeats, 16), 0, 128);
  const windowCandidates = windowHypotheses(windows);
  const allReferenceGroups = indexedGroups(reference.notes, tolerance);
  const allCandidateGroups = indexedGroups(candidate.notes, tolerance);
  const explicitOffsets = options.offsetsBeats !== undefined;
  const offsets = sortedUnique(options.offsetsBeats ?? (windows.length ? [...windowCandidates.offsets, 0] : (options.allowOffset === false ? [0] : defaultOffsets(reference, candidate, maxOffset))), [0]);
  const scales = sortedUnique(options.beatScales ?? (windows.length ? [...windowCandidates.scales, 1] : defaultScales(options)), [1]).filter((scale) => scale > 0 && scale >= 0.25 && scale <= 4);
  const transpositions = sortedUnique(options.transpositions ?? defaultTranspositions(options), [0]).filter((transpose) => transpose >= -24 && transpose <= 24);
  const automaticSearch = !windows.length
    && options.offsetsBeats === undefined
    && options.beatScales === undefined
    && options.transpositions === undefined;
  const boundedSearch = automaticSearch
    ? boundedAutomaticHypotheses(offsets, scales, transpositions, allReferenceGroups, allCandidateGroups, tolerance)
    : {
      parameters: scales.flatMap((scale) => offsets.flatMap((offset) => transpositions.map((transpose) => ({ offset, scale, transpose })))),
      considered: scales.length * offsets.length * transpositions.length,
      capped: false,
    };
  const hypotheses: Hypothesis[] = [];
  for (const parameters of boundedSearch.parameters) {
    if (!explicitOffsets && !windows.length && Math.abs(parameters.offset) > maxOffset + EPS) continue;
    hypotheses.push(evaluateHypothesis(reference, candidate, parameters.offset, parameters.scale, parameters.transpose, tolerance, windows, allReferenceGroups, allCandidateGroups));
  }
  hypotheses.sort((a, b) => b.score - a.score
    || b.matchedOnsets - a.matchedOnsets
    || Math.abs(a.transpose) - Math.abs(b.transpose)
    || Math.abs(a.offset) - Math.abs(b.offset)
    || a.scale - b.scale
    || a.offset - b.offset
    || a.transpose - b.transpose);
  const best = hypotheses[0] ?? evaluateHypothesis(reference, candidate, 0, 1, 0, tolerance, windows, allReferenceGroups, allCandidateGroups);
  const metrics = buildMetrics(reference, candidate, best, tolerance);
  const referenceRatio = best.referenceNoteCount ? metrics.matchedReferenceNotes / best.referenceNoteCount : 0;
  const candidateRatio = best.candidateNoteCount ? metrics.matchedCandidateNotes / best.candidateNoteCount : 0;
  const partialCoverage = referenceRatio < 0.98 || candidateRatio < 0.98;
  const minMatched = Math.max(1, Math.floor(options.minMatchedOnsets ?? 1));
  const diagnostics: string[] = [];
  if (boundedSearch.capped) diagnostics.push(`bounded automatic hypothesis search (${boundedSearch.parameters.length}/${boundedSearch.considered})`);
  if (normalizedWindowResult.invalid) diagnostics.push("ignored " + normalizedWindowResult.invalid + " invalid alignment window" + (normalizedWindowResult.invalid === 1 ? "" : "s"));
  if (best.matchedOnsets < minMatched) diagnostics.push("insufficient onset evidence for a stable alignment");
  if (options.allowTempoStretch !== false && !options.beatScales?.length && Math.abs(best.scale - 1) > EPS) diagnostics.push(`bounded beat stretch selected (${round(best.scale)})`);
  if (windows?.length) diagnostics.push(`evaluated ${windows.length} explicit alignment window${windows.length === 1 ? "" : "s"}`);
  const confidence = round(clamp(metrics.score * (partialCoverage ? 0.9 : 1), 0, 1));
  let status: SymbolicAlignmentResult["status"];
  if (best.matchedOnsets < minMatched || metrics.score < 0.2) status = "insufficient-evidence";
  else if (metrics.exactPitch.f1 !== null && metrics.exactPitch.f1 < 0.3 && metrics.pitchClass.f1 !== null && metrics.pitchClass.f1 < 0.5) status = "mismatch";
  else if (partialCoverage) status = "partial";
  else status = "aligned";
  const referenceSpan = Math.max(reference.durationBeats, EPS);
  const candidateSpan = Math.max(candidate.durationBeats, EPS);
  return {
    status,
    alignmentRequired: false,
    partialCoverage,
    offsetBeats: round(best.offset),
    beatScale: round(best.scale),
    transpositionSemitones: best.transpose,
    confidence,
    coverage: { referenceRatio: round(referenceRatio), candidateRatio: round(candidateRatio), referenceBeats: round(referenceSpan), candidateBeats: round(candidateSpan) },
    metrics,
    matches: best.matches.sort((a, b) => a.referenceStart - b.referenceStart || a.candidateStart - b.candidateStart || a.referenceMidi - b.referenceMidi || a.candidateMidi - b.candidateMidi),
    windows: windowResults(reference, candidate, best, tolerance, windows),
    confidenceMap: buildConfidenceMap(reference, best, windows, tolerance),
    diagnostics,
  };
}

/** Alias used by local evaluators that want an explicitly coarse comparison. */
export function coarseAlignScores(
  reference: SymbolicScoreInput | ParsedMidi,
  candidate: SymbolicScoreInput | ParsedMidi,
  options: SymbolicAlignmentOptions = {},
): SymbolicAlignmentResult {
  return alignSymbolicScores(reference, candidate, options);
}
