import {
  alignSymbolicScores,
  normalizeSymbolicScore,
  type SymbolicAlignmentResult,
  type SymbolicScoreInput,
} from "./symbolic-alignment.js";
import type { Note } from "@keyspilli/midi";

/** One four-quarter-note bar in the deterministic shadow score. */
export const SHADOW_ALIGNMENT_BAR_BEATS = 4;
export const SHADOW_ALIGNMENT_BAR_COUNT = 8;
export const SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM = 120;
export const SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS = SHADOW_ALIGNMENT_BAR_BEATS * SHADOW_ALIGNMENT_BAR_COUNT;

const SHADOW_ALIGNMENT_SCHEMA_VERSION = 1;
const EPS = 1e-9;

export type ShadowAlignmentCorruptionType =
  | "offset"
  | "tempo"
  | "transpose"
  | "section-removal"
  | "repeat-removal"
  | "repeat-insertion"
  | "truncation";

export type ShadowAlignmentExpectedStatus = "aligned" | "partial";

export interface ShadowAlignmentWindow {
  id: string;
  /** Reference and candidate bounds are in their respective beat domains. */
  reference: [number, number];
  candidate: [number, number];
  anchorId?: string;
}

export interface ShadowAudioTimingMetadata {
  /** Logical label only; no physical media path is accepted here. */
  sourceRef: string;
  tempoBpm: number;
  durationSeconds: number;
  onsetSeconds: number[];
  windows: ShadowAlignmentWindow[];
}

export interface ShadowAlignmentExpectedMatch {
  referenceIndex: number;
  candidateIndex: number;
  referenceStart: number;
  candidateStart: number;
  sectionId: string;
}

export interface ShadowAlignmentTruth {
  offsetBeats: number;
  /** Candidate beat = reference beat * beatScale + offsetBeats. */
  beatScale: number;
  /** Sounding corruption applied to the candidate (candidate MIDI shift). */
  transposeSemitones: number;
  /** Alignment hypothesis convention: candidate MIDI + this = reference MIDI. */
  alignmentTransposeSemitones: number;
  offsetSeconds: number;
  expectedStatus: ShadowAlignmentExpectedStatus;
  expectedMatches: ShadowAlignmentExpectedMatch[];
  expectedWindows: ShadowAlignmentWindow[];
  /** The score contains a section-level discontinuity for removal cases. */
  mappingKind: "global" | "piecewise";
}

export interface ShadowAlignmentFixture {
  id: string;
  corruptionType: ShadowAlignmentCorruptionType;
  description: string;
  reference: SymbolicScoreInput;
  candidate: SymbolicScoreInput;
  /** Coarse paired timing windows supplied to the blind aligner. */
  windows: ShadowAlignmentWindow[];
  referenceAudio: ShadowAudioTimingMetadata;
  candidateAudio: ShadowAudioTimingMetadata;
  /** Evaluation truth is deliberately never passed to alignSymbolicScores. */
  truth: ShadowAlignmentTruth;
}

export interface ShadowAlignmentRecoveredMapping {
  referenceIndex: number;
  candidateIndex: number;
  referenceBeat: number;
  candidateBeat: number;
  expectedCandidateBeat: number | null;
  timingErrorBeats: number | null;
  timingErrorSeconds: number | null;
  expected: boolean;
}

export interface ShadowAlignmentTimingError {
  median: number | null;
  p90: number | null;
  maximum: number | null;
}

export interface ShadowAlignmentCoverage {
  referenceRatio: number;
  candidateRatio: number;
  referenceNoteRatio: number;
  candidateNoteRatio: number;
  referenceBeats: number;
  candidateBeats: number;
  referenceBars: number;
  candidateBars: number;
  coveredBars: number;
  barCoverage: number;
}

export interface ShadowAlignmentCaseReport {
  caseId: string;
  corruptionType: ShadowAlignmentCorruptionType;
  description: string;
  expectedStatus: ShadowAlignmentExpectedStatus;
  status: SymbolicAlignmentResult["status"];
  recovered: boolean;
  falseAlignment: boolean;
  expectedTransform: {
    offsetBeats: number;
    offsetSeconds: number;
    beatScale: number;
    transposeSemitones: number;
    transpositionSemitones: number;
  };
  recoveredTransform: {
    offsetBeats: number;
    offsetSeconds: number;
    beatScale: number;
    transposeSemitones: number;
    transpositionSemitones: number;
  };
  timingErrorBeats: ShadowAlignmentTimingError;
  timingErrorSeconds: ShadowAlignmentTimingError;
  coverage: ShadowAlignmentCoverage;
  windowPrecision: number | null;
  windowRecall: number | null;
  matchedWindows: number;
  expectedWindows: number;
  falseAlignedDurationBeats: number;
  unalignedDurationBeats: number;
  mapping: ShadowAlignmentRecoveredMapping[];
  diagnostics: string[];
}

export interface ShadowAlignmentGateCalibration {
  /** Existing production readiness gate, reported for calibration only. */
  windowMinimum: 3;
  barMinimum: 32;
  thresholdsChanged: false;
  casesEvaluated: number;
  casesMeetingWindowMinimum: number;
  casesMeetingBarMinimum: number;
  casesMeetingBoth: number;
  assessment: "supported" | "reasonable" | "too-strict" | "insufficient-independent-32-bar-evidence";
  note: string;
}

export interface ShadowAlignmentCalibrationReport {
  schemaVersion: number;
  corpus: "synthetic-shadow";
  reference: {
    bars: number;
    durationBeats: number;
    tempoBpm: number;
    noteCount: number;
  };
  cases: ShadowAlignmentCaseReport[];
  gate: ShadowAlignmentGateCalibration;
}

export interface ShadowAlignmentCalibrationOptions {
  fixtures?: readonly ShadowAlignmentFixture[];
  onsetToleranceBeats?: number;
}

interface SectionDefinition {
  id: string;
  reference: [number, number];
}

interface TaggedNote {
  note: Note;
  referenceIndex: number;
  sectionId: string;
  ordinal: number;
}

interface CandidateTaggedNote {
  note: Note;
  referenceIndex: number | null;
  sectionId: string | null;
  ordinal: number;
}

interface CandidateBuild {
  notes: CandidateTaggedNote[];
  durationBeats: number;
  windows: ShadowAlignmentWindow[];
  truth: Omit<ShadowAlignmentTruth, "expectedMatches">;
}

const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { id: "intro", reference: [0, 8] },
  { id: "verse", reference: [8, 16] },
  { id: "chorus", reference: [16, 24] },
  { id: "outro", reference: [24, 32] },
];

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

function noteOrder(a: Note, b: Note): number {
  return a.start - b.start
    || a.midi - b.midi
    || a.dur - b.dur
    || a.vel - b.vel
    || compareText(a.hand ?? "", b.hand ?? "")
    || compareText(a.identitySource ?? "", b.identitySource ?? "")
    || compareText(a.lyrics ?? "", b.lyrics ?? "");
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter(finite).map((value) => round(value)))].sort((a, b) => a - b);
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

function timingError(values: readonly number[]): ShadowAlignmentTimingError {
  return {
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    maximum: values.length ? round(Math.max(...values)) : null,
  };
}

function validWindow(value: unknown): value is ShadowAlignmentWindow {
  if (!value || typeof value !== "object") return false;
  const window = value as Partial<ShadowAlignmentWindow>;
  return typeof window.id === "string"
    && window.id.length > 0
    && Array.isArray(window.reference)
    && window.reference.length === 2
    && Array.isArray(window.candidate)
    && window.candidate.length === 2
    && window.reference.every(finite)
    && window.candidate.every(finite)
    && window.reference[0]! >= 0
    && window.candidate[0]! >= 0
    && window.reference[1]! > window.reference[0]!
    && window.candidate[1]! > window.candidate[0]!;
}

/**
 * Normalize coarse paired timing windows without allowing duplicate IDs or
 * overlapping domains to influence a calibration run.
 */
export function normalizeShadowAlignmentWindows(
  input: readonly ShadowAlignmentWindow[] | unknown,
): { windows: ShadowAlignmentWindow[]; invalid: number } {
  if (!Array.isArray(input)) return { windows: [], invalid: 1 };
  const valid: ShadowAlignmentWindow[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const candidate of input) {
    if (!validWindow(candidate)) {
      invalid += 1;
      continue;
    }
    if (seen.has(candidate.id)) {
      invalid += 1;
      continue;
    }
    seen.add(candidate.id);
    valid.push({
      id: candidate.id,
      reference: [candidate.reference[0]!, candidate.reference[1]!] as [number, number],
      candidate: [candidate.candidate[0]!, candidate.candidate[1]!] as [number, number],
      ...(candidate.anchorId ? { anchorId: candidate.anchorId } : {}),
    });
  }
  const nonOverlapping: ShadowAlignmentWindow[] = [];
  for (const window of valid.sort((a, b) => a.reference[0]! - b.reference[0]!
    || a.reference[1]! - b.reference[1]!
    || a.candidate[0]! - b.candidate[0]!
    || a.candidate[1]! - b.candidate[1]!
    || compareText(a.id, b.id))) {
    const overlaps = nonOverlapping.some((previous) =>
      (window.reference[0]! < previous.reference[1]! - EPS && previous.reference[0]! < window.reference[1]! - EPS)
      || (window.candidate[0]! < previous.candidate[1]! - EPS && previous.candidate[0]! < window.candidate[1]! - EPS));
    if (overlaps) {
      invalid += 1;
      continue;
    }
    nonOverlapping.push(window);
  }
  nonOverlapping.sort((a, b) => a.reference[0]! - b.reference[0]!
    || a.reference[1]! - b.reference[1]!
    || a.candidate[0]! - b.candidate[0]!
    || a.candidate[1]! - b.candidate[1]!
    || compareText(a.id, b.id));
  return { windows: nonOverlapping, invalid };
}

function sectionForBeat(beat: number): SectionDefinition {
  return SECTION_DEFINITIONS.find((section) => beat >= section.reference[0]! - EPS && beat < section.reference[1]! - EPS)
    ?? SECTION_DEFINITIONS[SECTION_DEFINITIONS.length - 1]!;
}

function baseReferenceRecords(): TaggedNote[] {
  const roots = [0, 5, 7, 9, 2, 7, 0, 9];
  const records: TaggedNote[] = [];
  let ordinal = 0;
  for (let bar = 0; bar < SHADOW_ALIGNMENT_BAR_COUNT; bar += 1) {
    const root = roots[bar]!;
    const section = sectionForBeat(bar * SHADOW_ALIGNMENT_BAR_BEATS);
    for (let beatInBar = 0; beatInBar < SHADOW_ALIGNMENT_BAR_BEATS; beatInBar += 1) {
      const start = bar * SHADOW_ALIGNMENT_BAR_BEATS + beatInBar;
      const melodyPitch = 72 + ((bar * 3 + beatInBar * 2 + (bar % 2)) % 12);
      records.push({
        note: { midi: melodyPitch, start, dur: 0.75, vel: 108, hand: "R", identitySource: "vocals" },
        referenceIndex: -1,
        sectionId: section.id,
        ordinal: ordinal++,
      });
      records.push({
        note: { midi: 36 + root, start, dur: 0.7, vel: 72, hand: "L", identitySource: "other" },
        referenceIndex: -1,
        sectionId: section.id,
        ordinal: ordinal++,
      });
      if (beatInBar === 0 || beatInBar === 2) {
        const chordStart = start;
        for (const interval of [0, 4, 7]) {
          records.push({
            note: { midi: 48 + root + interval, start: chordStart, dur: 1.75, vel: 82, hand: "L", identitySource: "guitar" },
            referenceIndex: -1,
            sectionId: section.id,
            ordinal: ordinal++,
          });
        }
      }
    }
  }
  records.sort((a, b) => noteOrder(a.note, b.note) || a.ordinal - b.ordinal);
  records.forEach((record, index) => { record.referenceIndex = index; });
  return records;
}

function scoreFromNotes(notes: Note[], durationBeats: number): SymbolicScoreInput {
  return {
    notes,
    tempoBpm: SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM,
    durationBeats,
    timeSig: [4, 4],
    keySig: 0,
    keyMode: 0,
    title: "Keyspilli deterministic shadow alignment",
    trackNames: ["Synthetic lead", "Synthetic accompaniment"],
  };
}

function referenceWindows(): ShadowAlignmentWindow[] {
  return SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    reference: [...section.reference] as [number, number],
    candidate: [...section.reference] as [number, number],
    anchorId: `shadow-${section.id}`,
  }));
}

function transformedWindow(
  section: SectionDefinition,
  scale: number,
  offset: number,
  candidateShift = 0,
): ShadowAlignmentWindow {
  return {
    id: section.id,
    reference: [...section.reference] as [number, number],
    candidate: [
      round(section.reference[0]! * scale + offset + candidateShift),
      round(section.reference[1]! * scale + offset + candidateShift),
    ] as [number, number],
    anchorId: `shadow-${section.id}`,
  };
}

function candidateAudio(sourceRef: string, score: SymbolicScoreInput, windows: ShadowAlignmentWindow[]): ShadowAudioTimingMetadata {
  const tempoBpm = finite(score.tempoBpm) && score.tempoBpm > 0 ? score.tempoBpm : SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM;
  const durationBeats = finite(score.durationBeats) && score.durationBeats! >= 0 ? score.durationBeats! : 0;
  const secondsPerBeat = 60 / tempoBpm;
  const starts = uniqueSorted((score.notes ?? []).map((note) => note.start)).map((start) => round(start * secondsPerBeat));
  return {
    sourceRef,
    tempoBpm,
    durationSeconds: round(durationBeats * secondsPerBeat),
    onsetSeconds: starts,
    windows: windows.map((window) => ({
      ...window,
      reference: [round(window.reference[0]! * secondsPerBeat), round(window.reference[1]! * secondsPerBeat)] as [number, number],
      candidate: [round(window.candidate[0]! * secondsPerBeat), round(window.candidate[1]! * secondsPerBeat)] as [number, number],
    })),
  };
}

function buildCandidate(
  records: readonly TaggedNote[],
  options: {
    scale: number;
    offset: number;
    transpose: number;
    excludeSection?: string;
    truncateAt?: number;
    duplicateSection?: string;
    compressRemovedSection?: boolean;
  },
): CandidateBuild {
  const removedSection = options.excludeSection
    ? SECTION_DEFINITIONS.find((section) => section.id === options.excludeSection)
    : undefined;
  const removedDuration = removedSection ? removedSection.reference[1]! - removedSection.reference[0]! : 0;
  const transformStart = (record: TaggedNote, extraShift = 0): number => {
    const sourceStart = record.note.start;
    const compressed = options.compressRemovedSection && removedSection && sourceStart >= removedSection.reference[1]! ? sourceStart - removedDuration : sourceStart;
    return compressed * options.scale + options.offset + extraShift;
  };
  const candidateRecords: CandidateTaggedNote[] = [];
  let ordinal = 0;
  for (const record of records) {
    if (removedSection && record.sectionId === removedSection.id) continue;
    if (options.truncateAt !== undefined && record.note.start >= options.truncateAt - EPS) continue;
    const start = transformStart(record);
    candidateRecords.push({
      note: {
        ...record.note,
        midi: record.note.midi + options.transpose,
        start: round(start),
        dur: round(record.note.dur * options.scale),
      },
      referenceIndex: record.referenceIndex,
      sectionId: record.sectionId,
      ordinal: ordinal++,
    });
  }
  if (options.duplicateSection) {
    const duplicated = SECTION_DEFINITIONS.find((section) => section.id === options.duplicateSection);
    if (duplicated) {
      const duplicateShift = SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS * options.scale;
      for (const record of records) {
        if (record.sectionId !== duplicated.id) continue;
        const localStart = record.note.start - duplicated.reference[0]!;
        candidateRecords.push({
          note: {
            ...record.note,
            midi: record.note.midi + options.transpose,
            start: round((SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS + localStart) * options.scale + options.offset),
            dur: round(record.note.dur * options.scale),
          },
          // The duplicate is intentionally not part of expected truth. It is
          // an inserted candidate-only repeat to be detected by calibration.
          referenceIndex: null,
          sectionId: `${duplicated.id}-repeat`,
          ordinal: ordinal++,
        });
      }
      // Keep this variable visible in the construction above as a reminder
      // that duplicate placement is after the reference extent, not a second
      // in-place match. The resulting position is exactly 32..40 beats.
      void duplicateShift;
    }
  }
  candidateRecords.sort((a, b) => noteOrder(a.note, b.note) || a.ordinal - b.ordinal);
  const candidateDuration = candidateRecords.reduce((end, record) => Math.max(end, record.note.start + record.note.dur), 0);

  const scale = options.scale;
  const offset = options.offset;
  const candidateWindows: ShadowAlignmentWindow[] = [];
  const excludedId = options.excludeSection;
  for (const section of SECTION_DEFINITIONS) {
    if (section.id === excludedId) continue;
    let shift = 0;
    if (options.compressRemovedSection && removedSection && section.reference[0]! >= removedSection.reference[1]!) shift = -removedDuration;
    if (options.truncateAt !== undefined && section.reference[0]! >= options.truncateAt - EPS) continue;
    candidateWindows.push(transformedWindow(section, scale, offset, shift * scale));
  }
  if (options.duplicateSection) {
    // The paired timing metadata intentionally covers only the original song;
    // candidate-only repeat material must remain visible as false duration.
  }
  const expectedWindows = SECTION_DEFINITIONS.map((section) => {
    let shift = 0;
    if (options.compressRemovedSection && removedSection && section.reference[0]! >= removedSection.reference[1]!) shift = -removedDuration;
    return transformedWindow(section, scale, offset, shift * scale);
  });
  return {
    notes: candidateRecords,
    durationBeats: round(candidateDuration),
    windows: candidateWindows,
    truth: {
      offsetBeats: round(offset),
      beatScale: round(scale),
      transposeSemitones: options.transpose,
      alignmentTransposeSemitones: options.transpose === 0 ? 0 : -options.transpose,
      offsetSeconds: round(offset * 60 / SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM),
      expectedStatus: options.excludeSection || options.truncateAt !== undefined || options.duplicateSection ? "partial" : "aligned",
      expectedWindows,
      mappingKind: options.excludeSection ? "piecewise" : "global",
    },
  };
}

function fixtureFromBuild(
  id: string,
  corruptionType: ShadowAlignmentCorruptionType,
  description: string,
  records: readonly TaggedNote[],
  build: CandidateBuild,
): ShadowAlignmentFixture {
  const referenceNotes = records.map((record) => record.note);
  const candidateNotes = build.notes.map((record) => record.note);
  const reference = scoreFromNotes(referenceNotes, SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS);
  const candidate = scoreFromNotes(candidateNotes, build.durationBeats);
  const normalizedCandidate = normalizeSymbolicScore(candidate);
  const candidateIndexByOrdinal = new Map<number, number>();
  build.notes.forEach((record, index) => candidateIndexByOrdinal.set(record.ordinal, index));
  const expectedMatches: ShadowAlignmentExpectedMatch[] = build.notes
    .filter((record): record is CandidateTaggedNote & { referenceIndex: number; sectionId: string } => record.referenceIndex !== null && record.sectionId !== null)
    .map((record) => {
      const candidateIndex = candidateIndexByOrdinal.get(record.ordinal)!;
      const referenceNote = records[record.referenceIndex]!.note;
      return {
        referenceIndex: record.referenceIndex,
        candidateIndex,
        referenceStart: round(referenceNote.start),
        candidateStart: round(normalizedCandidate.notes[candidateIndex]!.start),
        sectionId: record.sectionId,
      };
    })
    .sort((a, b) => a.referenceIndex - b.referenceIndex || a.candidateIndex - b.candidateIndex);
  const truth: ShadowAlignmentTruth = { ...build.truth, expectedMatches };
  return {
    id,
    corruptionType,
    description,
    reference,
    candidate,
    windows: build.windows,
    referenceAudio: candidateAudio(`synthetic-shadow:${id}:reference`, reference, referenceWindows()),
    candidateAudio: candidateAudio(`synthetic-shadow:${id}:candidate`, candidate, build.windows),
    truth,
  };
}

/** Build the fixed eight-bar symbolic score used by every calibration case. */
export function createShadowAlignmentReference(): SymbolicScoreInput {
  const records = baseReferenceRecords();
  return scoreFromNotes(records.map((record) => record.note), SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS);
}

/**
 * Generate blind-evaluation fixtures.  Every candidate is made from the same
 * reference, and the transform is retained only in `truth` for post-alignment
 * scoring.  No fixture data is read from disk or from a benchmark song.
 */
export function createShadowAlignmentFixtures(): ShadowAlignmentFixture[] {
  const records = baseReferenceRecords();
  const cases: ShadowAlignmentFixture[] = [];
  const add = (
    id: string,
    type: ShadowAlignmentCorruptionType,
    description: string,
    options: Parameters<typeof buildCandidate>[1],
  ): void => {
    cases.push(fixtureFromBuild(id, type, description, records, buildCandidate(records, options)));
  };

  add("offset-plus-5s", "offset", "five-second equivalent leading intro offset", { scale: 1, offset: 10, transpose: 0 });
  add("offset-plus-15s", "offset", "fifteen-second equivalent leading intro offset", { scale: 1, offset: 30, transpose: 0 });
  add("tempo-0.8x", "tempo", "candidate timeline compressed to 0.8x reference beats", { scale: 0.8, offset: 0, transpose: 0 });
  add("tempo-1.25x", "tempo", "candidate timeline stretched to 1.25x reference beats", { scale: 1.25, offset: 0, transpose: 0 });
  add("transpose-plus-2", "transpose", "candidate pitches shifted up by two semitones", { scale: 1, offset: 0, transpose: 2 });
  add("transpose-minus-2", "transpose", "candidate pitches shifted down by two semitones", { scale: 1, offset: 0, transpose: -2 });
  add("remove-first-section", "section-removal", "first two-bar section removed and later material compressed", {
    scale: 1, offset: 0, transpose: 0, excludeSection: "intro", compressRemovedSection: true,
  });
  add("remove-repeat", "repeat-removal", "chorus repeat section removed and later material compressed", {
    scale: 1, offset: 0, transpose: 0, excludeSection: "chorus", compressRemovedSection: true,
  });
  add("duplicate-repeat", "repeat-insertion", "chorus section duplicated after the reference ending", {
    scale: 1, offset: 0, transpose: 0, duplicateSection: "chorus",
  });
  add("truncate-ending", "truncation", "candidate ends after the first six bars", {
    scale: 1, offset: 0, transpose: 0, truncateAt: 24,
  });
  return cases;
}

function onsetGroups(notes: readonly Note[], tolerance: number): Array<{ start: number; noteIndices: number[] }> {
  const groups: Array<{ start: number; noteIndices: number[] }> = [];
  notes.forEach((note, index) => {
    const previous = groups.at(-1);
    if (previous && note.start - previous.start <= tolerance + EPS) previous.noteIndices.push(index);
    else groups.push({ start: note.start, noteIndices: [index] });
  });
  return groups;
}

function sectionForReferenceStart(start: number): SectionDefinition | undefined {
  return SECTION_DEFINITIONS.find((section) => start >= section.reference[0]! - EPS && start < section.reference[1]! - EPS);
}

function inWindow(value: number, bounds: [number, number]): boolean {
  return value >= bounds[0]! - EPS && value < bounds[1]! - EPS;
}

function intervalUnionLength(intervals: readonly [number, number][]): number {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let start = sorted[0]![0];
  let end = sorted[0]![1];
  for (const interval of sorted.slice(1)) {
    if (interval[0] <= end + EPS) end = Math.max(end, interval[1]);
    else {
      total += Math.max(0, end - start);
      start = interval[0];
      end = interval[1];
    }
  }
  return total + Math.max(0, end - start);
}

function normalizedCandidateIndexMap(fixture: ShadowAlignmentFixture): { reference: ReturnType<typeof normalizeSymbolicScore>; candidate: ReturnType<typeof normalizeSymbolicScore> } {
  return { reference: normalizeSymbolicScore(fixture.reference), candidate: normalizeSymbolicScore(fixture.candidate) };
}

function transformClose(actual: ShadowAlignmentCaseReport["recoveredTransform"], expected: ShadowAlignmentCaseReport["expectedTransform"]): boolean {
  return Math.abs(actual.offsetBeats - expected.offsetBeats) <= 0.01
    && Math.abs(actual.beatScale - expected.beatScale) <= 0.01
    && actual.transposeSemitones === expected.transposeSemitones;
}

function evaluateShadowAlignmentFixtureInternal(fixture: ShadowAlignmentFixture, onsetTolerance: number): ShadowAlignmentCaseReport {
  const normalizedWindows = normalizeShadowAlignmentWindows(fixture.windows);
  // Only coarse paired windows are passed to the aligner.  The expected
  // transform and expected note pairs stay outside this call.
  const alignment = alignSymbolicScores(fixture.reference, fixture.candidate, {
    onsetToleranceBeats: onsetTolerance,
    // A malformed explicit collection must reach the aligner so its own
    // fail-closed invalid-window behavior remains observable.  Valid windows
    // are otherwise the only timing metadata used by the blind call.
    windows: normalizedWindows.invalid > 0 && Array.isArray(fixture.windows)
      ? fixture.windows
      : normalizedWindows.windows,
  });
  const { reference, candidate } = normalizedCandidateIndexMap(fixture);
  const expectedByReference = new Map(fixture.truth.expectedMatches.map((match) => [match.referenceIndex, match]));
  const expectedCandidateIndices = new Set(fixture.truth.expectedMatches.map((match) => match.candidateIndex));
  const mapping: ShadowAlignmentRecoveredMapping[] = alignment.matches.map((match) => {
    const expected = expectedByReference.get(match.referenceIndex);
    const isExpected = Boolean(expected && expected.candidateIndex === match.candidateIndex);
    const error = isExpected && expected ? Math.abs(match.candidateStart - expected.candidateStart) : null;
    return {
      referenceIndex: match.referenceIndex,
      candidateIndex: match.candidateIndex,
      referenceBeat: round(match.referenceStart),
      candidateBeat: round(match.candidateStart),
      expectedCandidateBeat: expected ? round(expected.candidateStart) : null,
      timingErrorBeats: error === null ? null : round(error),
      timingErrorSeconds: error === null ? null : round(error * 60 / (candidate.tempoBpm || SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM)),
      expected: isExpected,
    };
  });
  const matchedReferenceIndices = new Set(mapping.filter((entry) => entry.expected).map((entry) => entry.referenceIndex));
  const matchedCandidateIndices = new Set(mapping.filter((entry) => entry.expected).map((entry) => entry.candidateIndex));
  const referenceGroups = onsetGroups(reference.notes, onsetTolerance);
  const candidateGroups = onsetGroups(candidate.notes, onsetTolerance);
  const matchedReferenceGroupStarts = new Set<number>();
  const matchedCandidateGroupStarts = new Set<number>();
  const referenceGroupByIndex = new Map<number, number>();
  const candidateGroupByIndex = new Map<number, number>();
  referenceGroups.forEach((group) => group.noteIndices.forEach((index) => referenceGroupByIndex.set(index, group.start)));
  candidateGroups.forEach((group) => group.noteIndices.forEach((index) => candidateGroupByIndex.set(index, group.start)));
  for (const mappingEntry of mapping) {
    if (!mappingEntry.expected) continue;
    const refGroup = referenceGroupByIndex.get(mappingEntry.referenceIndex);
    const candidateGroup = candidateGroupByIndex.get(mappingEntry.candidateIndex);
    if (refGroup !== undefined) matchedReferenceGroupStarts.add(refGroup);
    if (candidateGroup !== undefined) matchedCandidateGroupStarts.add(candidateGroup);
  }
  const coveredBars = new Set<number>();
  for (const start of matchedReferenceGroupStarts) coveredBars.add(Math.floor(start / SHADOW_ALIGNMENT_BAR_BEATS));
  const referenceBars = Math.max(0, Math.ceil((reference.durationBeats || 0) / SHADOW_ALIGNMENT_BAR_BEATS));
  const candidateBars = Math.max(0, Math.ceil((candidate.durationBeats || 0) / SHADOW_ALIGNMENT_BAR_BEATS));
  const coverage: ShadowAlignmentCoverage = {
    referenceRatio: round(referenceGroups.length ? matchedReferenceGroupStarts.size / referenceGroups.length : 0),
    candidateRatio: round(candidateGroups.length ? matchedCandidateGroupStarts.size / candidateGroups.length : 0),
    referenceNoteRatio: round(reference.notes.length ? matchedReferenceIndices.size / reference.notes.length : 0),
    candidateNoteRatio: round(candidate.notes.length ? matchedCandidateIndices.size / candidate.notes.length : 0),
    referenceBeats: round(reference.durationBeats),
    candidateBeats: round(candidate.durationBeats),
    referenceBars,
    candidateBars,
    coveredBars: coveredBars.size,
    barCoverage: round(referenceBars ? coveredBars.size / referenceBars : 0),
  };

  const correctErrorsBeats = mapping.flatMap((entry) => entry.expected && entry.timingErrorBeats !== null ? [entry.timingErrorBeats] : []);
  const correctErrorsSeconds = mapping.flatMap((entry) => entry.expected && entry.timingErrorSeconds !== null ? [entry.timingErrorSeconds] : []);
  const recoveredTransform = {
    offsetBeats: round(alignment.offsetBeats),
    offsetSeconds: round(alignment.offsetBeats * 60 / (candidate.tempoBpm || SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM)),
    beatScale: round(alignment.beatScale),
    transposeSemitones: alignment.transpositionSemitones,
    transpositionSemitones: alignment.transpositionSemitones,
  };
  const expectedTransform = {
    offsetBeats: fixture.truth.offsetBeats,
    offsetSeconds: fixture.truth.offsetSeconds,
    beatScale: fixture.truth.beatScale,
    transposeSemitones: fixture.truth.alignmentTransposeSemitones,
    transpositionSemitones: fixture.truth.alignmentTransposeSemitones,
  };
  const matchedWindows = fixture.truth.expectedWindows.filter((window) => fixture.truth.expectedMatches.some((expected) =>
    expected.sectionId === window.id && matchedReferenceIndices.has(expected.referenceIndex))).length;
  const falseCandidateGroupStarts = candidateGroups
    .filter((group) => !group.noteIndices.some((index) => expectedCandidateIndices.has(index)))
    .map((group) => group.start);
  const falseWindowStarts = falseCandidateGroupStarts.filter((start) => !normalizedWindows.windows.some((window) => inWindow(start, window.candidate)));
  const predictedWindowCount = matchedWindows + (falseWindowStarts.length ? 1 : 0);
  const windowPrecision = predictedWindowCount ? round(matchedWindows / predictedWindowCount) : null;
  const windowRecall = fixture.truth.expectedWindows.length ? round(matchedWindows / fixture.truth.expectedWindows.length) : null;
  const falseAlignedDurationBeats = round(intervalUnionLength(candidateGroups
    .filter((group) => !group.noteIndices.some((index) => expectedCandidateIndices.has(index)))
    .map((group) => [group.start, Math.max(...group.noteIndices.map((index) => candidate.notes[index]!.start + candidate.notes[index]!.dur))] as [number, number]))
    || (mapping.some((entry) => !entry.expected) ? SHADOW_ALIGNMENT_BAR_BEATS : 0));
  const unalignedDurationBeats = round(Math.max(0, reference.durationBeats - coveredBars.size * SHADOW_ALIGNMENT_BAR_BEATS));
  const candidateOnly = mapping.some((entry) => !entry.expected) || falseAlignedDurationBeats > EPS;
  const expectedTransformMatches = transformClose(recoveredTransform, expectedTransform);
  const partialEvidence = matchedWindows >= 1 && matchedReferenceIndices.size > 0;
  const recovered = fixture.truth.mappingKind === "piecewise"
    ? partialEvidence && mapping.every((entry) => entry.expected)
    : expectedTransformMatches && partialEvidence && (fixture.truth.expectedStatus === "partial" || coverage.referenceRatio >= 0.98);
  const falseAlignment = candidateOnly
    || (alignment.status === "aligned" && coverage.candidateRatio < 0.98);
  const reportedStatus = fixture.truth.expectedStatus === "partial" && alignment.status === "aligned"
    ? "partial"
    : alignment.status;
  const diagnostics = [...alignment.diagnostics];
  if (normalizedWindows.invalid) diagnostics.push(`ignored ${normalizedWindows.invalid} invalid shadow alignment window${normalizedWindows.invalid === 1 ? "" : "s"}`);
  if (fixture.truth.expectedStatus === "partial") diagnostics.push("partial shadow truth is expected; coverage is reported without promotion to full alignment");
  if (falseAlignedDurationBeats > EPS) diagnostics.push(`candidate-only timing span ${falseAlignedDurationBeats} beats remains outside expected mapping`);
  if (unalignedDurationBeats > EPS) diagnostics.push(`unaligned reference duration ${unalignedDurationBeats} beats remains unknown`);
  return {
    caseId: fixture.id,
    corruptionType: fixture.corruptionType,
    description: fixture.description,
    expectedStatus: fixture.truth.expectedStatus,
    status: reportedStatus,
    recovered,
    falseAlignment,
    expectedTransform,
    recoveredTransform,
    timingErrorBeats: timingError(correctErrorsBeats),
    timingErrorSeconds: timingError(correctErrorsSeconds),
    coverage,
    windowPrecision,
    windowRecall,
    matchedWindows,
    expectedWindows: fixture.truth.expectedWindows.length,
    falseAlignedDurationBeats,
    unalignedDurationBeats,
    mapping,
    diagnostics,
  };
}

/** Evaluate one fixture without exposing its truth to the alignment call. */
export function evaluateShadowAlignmentCase(
  fixture: ShadowAlignmentFixture,
  options: Pick<ShadowAlignmentCalibrationOptions, "onsetToleranceBeats"> = {},
): ShadowAlignmentCaseReport {
  const onsetTolerance = finite(options.onsetToleranceBeats) ? clamp(options.onsetToleranceBeats!, 0.001, 1) : 0.08;
  return evaluateShadowAlignmentFixtureInternal(fixture, onsetTolerance);
}

/**
 * Run all deterministic corruption/recovery cases.  The report deliberately
 * contains no timestamps, physical paths, random IDs, or benchmark data.
 */
export function calibrateShadowAlignment(
  options: ShadowAlignmentCalibrationOptions | readonly ShadowAlignmentFixture[] = {},
): ShadowAlignmentCalibrationReport {
  const config: ShadowAlignmentCalibrationOptions = Array.isArray(options)
    ? {}
    : options as ShadowAlignmentCalibrationOptions;
  const fixtures = Array.isArray(options) ? [...options] : config.fixtures ? [...config.fixtures] : createShadowAlignmentFixtures();
  const onsetTolerance = finite(config.onsetToleranceBeats) ? clamp(config.onsetToleranceBeats!, 0.001, 1) : 0.08;
  const cases = fixtures.map((fixture) => evaluateShadowAlignmentFixtureInternal(fixture, onsetTolerance));
  const casesMeetingWindowMinimum = cases.filter((entry) => (entry.matchedWindows >= 3)).length;
  const casesMeetingBarMinimum = cases.filter((entry) => (entry.coverage.coveredBars >= 32)).length;
  const casesMeetingBoth = cases.filter((entry) => entry.matchedWindows >= 3 && entry.coverage.coveredBars >= 32).length;
  const assessment: ShadowAlignmentGateCalibration["assessment"] = casesMeetingBarMinimum > 0
    ? casesMeetingBoth > 0 ? "supported" : "too-strict"
    : "insufficient-independent-32-bar-evidence";
  return {
    schemaVersion: SHADOW_ALIGNMENT_SCHEMA_VERSION,
    corpus: "synthetic-shadow",
    reference: {
      bars: SHADOW_ALIGNMENT_BAR_COUNT,
      durationBeats: SHADOW_ALIGNMENT_REFERENCE_DURATION_BEATS,
      tempoBpm: SHADOW_ALIGNMENT_REFERENCE_TEMPO_BPM,
      noteCount: createShadowAlignmentReference().notes.length,
    },
    cases,
    gate: {
      windowMinimum: 3,
      barMinimum: 32,
      thresholdsChanged: false,
      casesEvaluated: cases.length,
      casesMeetingWindowMinimum,
      casesMeetingBarMinimum,
      casesMeetingBoth,
      assessment,
      note: "Synthetic shadow fixtures are eight bars; the 32-bar production gate is observed but not changed or claimed supported by this calibration.",
    },
  };
}

/** Descriptive aliases for callers that use fixture/corpus vocabulary. */
export const buildShadowAlignmentFixtures = createShadowAlignmentFixtures;
export const runShadowAlignmentCalibration = calibrateShadowAlignment;
export const evaluateShadowAlignmentFixture = evaluateShadowAlignmentCase;
