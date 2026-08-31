/**
 * Pure, path-free reporting primitives for the local MIDI corpus benchmark.
 *
 * This module deliberately does not read files, render audio, invoke the
 * arranger, or infer an alignment.  Callers provide the canonical result
 * produced by midi-corpus.ts and, when available, role layers and explicit
 * baseline/current comparison evidence.  The resulting objects are safe to
 * serialize and deterministic across machines.
 */

import { createHash } from "node:crypto";
import type {
  CanonicalMidi,
  CanonicalMidiNote,
  MidiCorpusResult,
} from "./midi-corpus.js";
import {
  classifyMidiRoles,
  measureRestrikes,
  songIdentitySignature,
  type MidiCorpusRole,
  type MidiCorpusSemanticRole,
  type MidiRoleReadiness,
  type MidiRoleClassification,
  type MidiRoleLayers,
  type MidiRoleSemanticLayers,
  type RestrikeMetrics,
} from "./midi-corpus-roles.js";

export const MIDI_CORPUS_REPORT_SCHEMA_VERSION = 1 as const;
export const MIDI_CORPUS_REPORT_VERSION = "midi-corpus-report-v1" as const;

/** Values are report contract, not implementation-only tuning knobs. */
export const MIDI_CORPUS_REPORT_CONFIG = {
  schemaVersion: MIDI_CORPUS_REPORT_SCHEMA_VERSION,
  onsetToleranceBeats: 0.08,
  veryShortBeats: 0.125,
  isolatedGapBeats: 1.5,
  isolatedDurationBeats: 0.25,
  restrikeGapBeats: 0.5,
  handSpanViolationSemitones: 12,
  minimumComparableSongs: 5,
  minimumReferenceWindows: 3,
  minimumReferenceBars: 32,
  defectMinimumOccurrences: 3,
  highJumpRate: 0.25,
  excessiveRestrikeRate: 0.4,
  lowRegisterMudRate: 0.45,
  chordWallRate: 0.4,
  rootJitterRate: 0.6,
} as const;

export type MidiCorpusReadiness =
  | "READY"
  | "READY_WITH_WARNINGS"
  | "MANUAL_VALIDATION_REQUIRED"
  | "NOT_AVAILABLE"
  | "FAILED";

export type MidiCorpusReferenceKind =
  | "piano-target"
  | "semantic-full-band"
  | "mixed"
  | "unknown"
  | "direct-piano"
  | "multitrack-piano"
  | "semantic-band";

export type MidiCorpusEvaluationMode =
  | "PIANO_TARGET"
  | "SEMANTIC_MELODY"
  | "SEMANTIC_HARMONY"
  | "BASS_ROOT"
  | "RHYTHM_ONLY";

export interface MidiCorpusParserSummary {
  format: number;
  division: number;
  tempoBpm: number | null;
  durationBeats: number;
  timeSignature: [number, number] | null;
  trackCount: number;
  noteCount: number;
  percussionNoteCount: number;
}

export interface MidiCorpusIntegrityReport {
  status: "valid" | "normalized" | "invalid" | "not-provided";
  strictParse: "passed" | "failed" | "not-run";
  inputBytes: number | null;
  inputSha256: string | null;
  normalizedBytes: number | null;
  normalizedSha256: string | null;
  normalization: MidiCorpusResult["normalization"] | null;
  errors: string[];
  warnings: string[];
}

export interface MidiCorpusTrackSummary {
  index: number;
  name: string | null;
  channels: number[];
  programs: Array<{ tick: number; channel: number; program: number }>;
  percussion: boolean;
  noteCount: number;
  onsetCount: number;
  durationBeats: number;
  pitchMin: number | null;
  pitchMax: number | null;
}

export interface MidiCorpusReadinessReport {
  pianoTarget: MidiCorpusReadiness;
  melody: MidiCorpusReadiness;
  harmony: MidiCorpusReadiness;
  bassRoot: MidiCorpusReadiness;
  rhythm: MidiCorpusReadiness;
  reasons: Record<"pianoTarget" | "melody" | "harmony" | "bassRoot" | "rhythm", string[]>;
}

export interface MidiCorpusRoleReport {
  laneCount: number;
  lanes: Array<{
    laneKey: string;
    role: MidiCorpusRole;
    semanticRole: MidiCorpusSemanticRole;
    readiness: MidiRoleReadiness;
    ambiguity: "low" | "medium" | "high";
    signals: string[];
    trackIndex: number | null;
    trackName: string | null;
    noteCount: number;
    onsetCount: number;
    notesPerOnset: number;
    medianMidi: number | null;
    percussion: boolean;
    reason: string;
  }>;
  counts: Record<MidiCorpusRole, number>;
  onsets: Record<MidiCorpusRole, number>;
  semanticCounts: Record<MidiCorpusSemanticRole, number>;
  /**
   * Counts for the semantic projections.  These are intentionally additive
   * to the coarse role counts above: a single piano lane can project into a
   * melody, harmony, bass, and rhythm layer without changing its PIANO_FULL
   * note tags or coarse role classification.
   */
  layerCounts: MidiCorpusLayerCounts;
  readiness: MidiCorpusReadinessReport;
}

export type MidiCorpusSemanticLayer = keyof MidiRoleSemanticLayers;

export interface MidiCorpusLayerCount {
  notes: number;
  onsets: number;
}

export type MidiCorpusLayerCounts = Record<MidiCorpusSemanticLayer, MidiCorpusLayerCount>;

export interface MidiCorpusGlobalMetrics {
  noteCount: number;
  pitchedNoteCount: number;
  percussionNoteCount: number;
  onsetCount: number;
  notesPerSecond: number | null;
  onsetsPerSecond: number | null;
  durationBeats: number;
  durationSeconds: number | null;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  veryShortCount: number;
  veryShortRate: number;
  isolatedShortCount: number;
  repeatedAttackRate: number;
  closeAttackRate: number;
  simultaneity: {
    max: number;
    p50: number;
    p90: number;
    p99: number;
    basis: "event-boundary";
  };
  lowRegisterRatio: number;
  lowRegisterCloseAttackRate: number;
  /** Composite low-register attack concentration used by defect clustering. */
  lowRegisterMudRate: number;
}

export interface MidiCorpusHandMetrics {
  noteCount: number;
  onsetCount: number;
  attacksPerSecond: number | null;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  interval: { mean: number | null; median: number | null; p95: number | null; max: number | null };
  largeLeap: { count: number; rate: number; thresholdSemitones: 7 };
  octaveBounceCount: number;
  melodyGap: { median: number | null; p90: number | null; p99: number | null; max: number | null };
  monoOnsetRatio: number;
  polyOnsetRatio: number;
  shortRate: number;
  repeatedRate: number;
}

export interface MidiCorpusAccompanimentRestrikeMetrics {
  attackCount: number;
  harmonicChangeCount: number;
  sameHarmonyRepeatedAttackCount: number;
  sameHarmonyRepeatedAttackRate: number;
  equivalentChordIntervalsBeats: { median: number | null; p90: number | null };
  meanChordHoldDurationBeats: number | null;
  attacksWithoutHarmonicChange: number;
  fullChordAttacksPerSecond: number | null;
  rootAttacksPerSecond: number | null;
  twoSecondPulseDistanceSeconds: number | null;
  basis: "onset-pitch-class-sets";
}

export interface MidiCorpusRoleMetrics {
  melody: MidiCorpusHandMetrics;
  harmony: MidiCorpusHandMetrics;
  bass: MidiCorpusHandMetrics;
  rhythm: MidiCorpusHandMetrics;
  other: MidiCorpusHandMetrics;
}

export interface MidiCorpusMetrics {
  global: MidiCorpusGlobalMetrics;
  roles: MidiCorpusRoleMetrics;
  /** Existing same-pitch restrike helper, retained alongside harmony-level metrics. */
  samePitchRestrikes: RestrikeMetrics;
  accompanimentRestrikes: MidiCorpusAccompanimentRestrikeMetrics;
  source: {
    noteCounts: Record<MidiCorpusRole, number>;
    percussionPitchCount: number;
    unknownRoleCount: number;
  };
}

export interface MidiCorpusSourceReportInput {
  id: string;
  label?: string;
  artist?: string;
  title?: string;
  referenceKind?: MidiCorpusReferenceKind;
  evaluationModes?: readonly MidiCorpusEvaluationMode[];
  result?: MidiCorpusResult;
  /** When recovery succeeded, retain the failed strict attempt separately. */
  strictResult?: MidiCorpusResult;
  canonical?: CanonicalMidi | null;
  roles?: MidiRoleLayers;
  /** Relative, path-free artifact labels emitted by a local corpus harness. */
  artifacts?: MidiCorpusSourceArtifacts;
  /** Optional explicit trusted role labels from human review. */
  trustedRoles?: readonly ("piano-target" | "melody" | "harmony" | "bass-root" | "rhythm")[];
}

export interface MidiCorpusSourceArtifacts {
  normalizedMidi?: string;
  canonicalJson?: string;
  fullReferenceWav?: string;
  excerptReferenceWav?: string;
  [key: string]: string | undefined;
}

export interface MidiCorpusSongReport {
  schemaVersion: typeof MIDI_CORPUS_REPORT_SCHEMA_VERSION;
  reportVersion: typeof MIDI_CORPUS_REPORT_VERSION;
  id: string;
  label: string | null;
  artist: string | null;
  title: string | null;
  referenceKind: MidiCorpusReferenceKind;
  evaluationModes: MidiCorpusEvaluationMode[];
  identity: { signature: string | null; basis: "metadata" | "canonical-notes" | "unavailable" };
  integrity: MidiCorpusIntegrityReport;
  parser: MidiCorpusParserSummary | null;
  tracks: MidiCorpusTrackSummary[];
  roles: MidiCorpusRoleReport | null;
  metrics: MidiCorpusMetrics | null;
  readiness: MidiCorpusReadinessReport;
  diagnostics: string[];
  artifacts?: MidiCorpusSourceArtifacts;
}

/** Compatibility name used by local corpus-building scripts. */
export type MidiCorpusSourceReport = MidiCorpusSongReport;

export type MidiCorpusComparisonStatus = "aligned" | "insufficient-evidence" | "not-requested" | "failed";

export interface MidiCorpusComparisonSnapshot {
  revision: string;
  report?: MidiCorpusSongReport;
  metrics?: Partial<MidiCorpusMetrics>;
  coverage?: { windows: number; bars: number; status: "aligned" | "insufficient-evidence" | "not-requested" };
}

export interface MidiCorpusComparisonInput {
  songId: string;
  referenceRoles?: readonly string[];
  baseline?: MidiCorpusComparisonSnapshot;
  current?: MidiCorpusComparisonSnapshot;
  status?: MidiCorpusComparisonStatus;
  alignedDurationBeats?: number;
  comparable?: boolean;
}

export interface MidiCorpusMetricDelta {
  baseline: number | null;
  current: number | null;
  delta: number | null;
  lowerIsBetter: boolean;
}

export interface MidiCorpusComparisonReport {
  songId: string;
  status: MidiCorpusComparisonStatus;
  genuine: boolean;
  referenceRoles: string[];
  alignedDurationBeats: number | null;
  alignedBars: number | null;
  metrics: {
    noteCount: MidiCorpusMetricDelta;
    melodyLargeLeapRate: MidiCorpusMetricDelta;
    accompanimentRestrikeRate: MidiCorpusMetricDelta;
    lowRegisterMudRate: MidiCorpusMetricDelta;
    octaveBounceCount: MidiCorpusMetricDelta;
  };
  winner: "baseline" | "current" | "mixed" | null;
  diagnostics: string[];
}

export interface MidiCorpusBenchmarkReport {
  status: "ready" | "insufficient-evidence";
  minimumComparableSongs: number;
  comparableSongCount: number;
  comparisons: MidiCorpusComparisonReport[];
  trustedRoles: string[];
  alignedDurationBeats: number;
  winner: "baseline" | "current" | "mixed" | null;
  diagnostics: string[];
}

export type MidiCorpusDefectKind =
  | "UNSUPPORTED_HARMONIC_CHANGES"
  | "HIGH_JUMP_RATE"
  | "EXCESSIVE_CHORD_RESTRIKES"
  | "LOW_REGISTER_MUD"
  | "CHORD_WALLS"
  | "ROOT_JITTER"
  | "MISSING_MELODY"
  | "OCTAVE_BOUNCE";

export interface MidiCorpusDefectCluster {
  kind: MidiCorpusDefectKind;
  songIds: string[];
  occurrenceCount: number;
  firstResponsibleStage: "harmonic-inference" | "lead-selection" | "accompaniment-scheduler" | "left-hand-voicing" | "register-stabilization" | "source-separation";
  evidence: string[];
}

export interface MidiCorpusReportInput {
  corpusId: string;
  sources: readonly MidiCorpusSourceReportInput[];
  comparisons?: readonly MidiCorpusComparisonInput[];
  minimumComparableSongs?: number;
}

export interface MidiCorpusReport {
  schemaVersion: typeof MIDI_CORPUS_REPORT_SCHEMA_VERSION;
  reportVersion: typeof MIDI_CORPUS_REPORT_VERSION;
  /** Stable discriminator for consumers that store multiple report families. */
  kind: "midi-reference-corpus";
  corpusId: string;
  status: "ready" | "partial" | "review-required" | "failed";
  sourceCount: number;
  sources: MidiCorpusSongReport[];
  benchmark: MidiCorpusBenchmarkReport;
  defectClusters: MidiCorpusDefectCluster[];
  determinism: { canonicalSha256: string };
}

const ROLE_KEYS: readonly MidiCorpusRole[] = ["melody", "harmony", "bass", "rhythm", "other"];
const SEMANTIC_LAYER_KEYS: readonly MidiCorpusSemanticLayer[] = [
  "fullSymbolic",
  "pianoTarget",
  "melody",
  "harmony",
  "bassRoot",
  "rhythmAttacks",
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

function quantile(values: readonly number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower));
}

function mean(values: readonly number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function notePitch(value: CanonicalMidiNote): number | null {
  return integer(value.midi) && value.midi >= 0 && value.midi <= 127 ? value.midi : null;
}

function pitchedNotes(notes: readonly CanonicalMidiNote[]): CanonicalMidiNote[] {
  return notes.filter((value) => value.percussion !== true && notePitch(value) !== null && finite(value.startBeats) && finite(value.durationBeats) && value.durationBeats > 0);
}

interface OnsetGroup {
  start: number;
  notes: CanonicalMidiNote[];
}

function onsetGroups(notes: readonly CanonicalMidiNote[]): OnsetGroup[] {
  const sorted = [...notes].sort((left, right) => (left.startBeats - right.startBeats)
    || ((notePitch(left) ?? -1) - (notePitch(right) ?? -1))
    || (left.durationBeats - right.durationBeats)
    || (left.trackIndex - right.trackIndex)
    || (left.channel - right.channel));
  const groups: OnsetGroup[] = [];
  for (const value of sorted) {
    const group = groups[groups.length - 1];
    // Group against the first onset, matching the corpus's explicit
    // tolerance and avoiding transitive jitter chains.
    if (!group || value.startBeats - group.start > MIDI_CORPUS_REPORT_CONFIG.onsetToleranceBeats + 1e-9) {
      groups.push({ start: value.startBeats, notes: [value] });
    } else group.notes.push(value);
  }
  return groups;
}

function sourceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || /^file:/i.test(normalized)) return null;
  return normalized.slice(0, 240);
}

function parserSummary(file: CanonicalMidi): MidiCorpusParserSummary {
  const notes = file.notes.filter((value) => finite(value.startBeats) && finite(value.durationBeats));
  const percussion = notes.filter((value) => value.percussion === true).length;
  const tempo = file.tempos.find((value) => value.tick === 0)?.bpm ?? file.tempos[0]?.bpm ?? null;
  const signature = file.timeSignatures.find((value) => value.tick === 0)?.signature ?? file.timeSignatures[0]?.signature ?? null;
  const durationTicks = Math.max(0, ...file.tracks.map((track) => track.endTick), ...notes.map((value) => value.endTick));
  return {
    format: integer(file.format) ? file.format : 0,
    division: integer(file.division) && file.division > 0 ? file.division : 0,
    tempoBpm: finite(tempo) && tempo > 0 ? round(tempo) : null,
    durationBeats: round(durationTicks / Math.max(1, file.division)) ?? 0,
    timeSignature: signature && integer(signature[0]) && integer(signature[1]) ? [signature[0], signature[1]] : null,
    trackCount: Array.isArray(file.tracks) ? file.tracks.length : 0,
    noteCount: notes.length,
    percussionNoteCount: percussion,
  };
}

function trackSummaries(file: CanonicalMidi): MidiCorpusTrackSummary[] {
  return [...file.tracks].sort((left, right) => left.index - right.index).map((track) => {
    const notes = track.notes.filter((value) => finite(value.startBeats) && finite(value.durationBeats));
    const pitches = pitchedNotes(notes).map((value) => value.midi);
    const duration = Math.max(0, ...notes.map((value) => value.endTick)) - Math.min(0, ...notes.map((value) => value.startTick));
    return {
      index: track.index,
      name: sourceText(track.name),
      channels: [...track.channels].sort((a, b) => a - b),
      programs: [...track.programs].sort((a, b) => (a.tick - b.tick) || (a.channel - b.channel) || (a.program - b.program)).map((value) => ({ tick: value.tick, channel: value.channel, program: value.program })),
      percussion: track.percussion === true,
      noteCount: notes.length,
      onsetCount: onsetGroups(notes).length,
      durationBeats: round(duration / Math.max(1, file.division)) ?? 0,
      pitchMin: pitches.length ? Math.min(...pitches) : null,
      pitchMax: pitches.length ? Math.max(...pitches) : null,
    };
  });
}

function sweep(notes: readonly CanonicalMidiNote[]): MidiCorpusGlobalMetrics["simultaneity"] {
  const events = notes.flatMap((value) => [
    { time: value.startBeats, delta: 1 },
    { time: value.startBeats + value.durationBeats, delta: -1 },
  ]).sort((left, right) => (left.time - right.time) || (left.delta - right.delta));
  let level = 0;
  let max = 0;
  const levels: number[] = [];
  for (const event of events) {
    level += event.delta;
    max = Math.max(max, level);
    levels.push(level);
  }
  return { max, p50: quantile(levels, 0.5) ?? 0, p90: quantile(levels, 0.9) ?? 0, p99: quantile(levels, 0.99) ?? 0, basis: "event-boundary" };
}

function handMetrics(notes: readonly CanonicalMidiNote[], tempoBpm: number | null): MidiCorpusHandMetrics {
  const valid = pitchedNotes(notes);
  const groups = onsetGroups(valid);
  const pitches = groups.map((group) => Math.max(...group.notes.map((value) => value.midi)));
  const gaps = groups.slice(1).map((group, index) => group.start - groups[index]!.start);
  const intervals = pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!));
  const large = intervals.filter((value) => value >= 7).length;
  let octaveBounceCount = 0;
  for (let index = 2; index < pitches.length; index += 1) {
    const incoming = pitches[index - 1]! - pitches[index - 2]!;
    const outgoing = pitches[index]! - pitches[index - 1]!;
    if (Math.abs(incoming) >= 11 && Math.abs(outgoing) >= 11 && Math.sign(incoming) !== Math.sign(outgoing)) octaveBounceCount += 1;
  }
  const mono = groups.filter((group) => group.notes.length === 1).length;
  const veryShort = valid.filter((value) => value.durationBeats <= MIDI_CORPUS_REPORT_CONFIG.veryShortBeats).length;
  return {
    noteCount: valid.length,
    onsetCount: groups.length,
    attacksPerSecond: tempoBpm && tempoBpm > 0 ? round(groups.length / (Math.max(0, Math.max(...valid.map((value) => value.startBeats + value.durationBeats), 0)) * 60 / tempoBpm)) : null,
    pitchMin: valid.length ? Math.min(...valid.map((value) => value.midi)) : null,
    pitchMax: valid.length ? Math.max(...valid.map((value) => value.midi)) : null,
    pitchSpan: valid.length ? Math.max(...valid.map((value) => value.midi)) - Math.min(...valid.map((value) => value.midi)) : null,
    interval: { mean: mean(intervals), median: median(intervals), p95: quantile(intervals, 0.95), max: intervals.length ? Math.max(...intervals) : null },
    largeLeap: { count: large, rate: intervals.length ? round(large / intervals.length) ?? 0 : 0, thresholdSemitones: 7 },
    octaveBounceCount,
    melodyGap: { median: median(gaps), p90: quantile(gaps, 0.9), p99: quantile(gaps, 0.99), max: gaps.length ? Math.max(...gaps) : null },
    monoOnsetRatio: groups.length ? round(mono / groups.length) ?? 0 : 0,
    polyOnsetRatio: groups.length ? round((groups.length - mono) / groups.length) ?? 0 : 0,
    shortRate: valid.length ? round(veryShort / valid.length) ?? 0 : 0,
    repeatedRate: intervals.length ? round(intervals.filter((value, index) => value === 0 && pitches[index] === pitches[index + 1]).length / intervals.length) ?? 0 : 0,
  };
}

function pitchClass(value: number): number {
  return ((value % 12) + 12) % 12;
}

function accompanimentRestrikes(notes: readonly CanonicalMidiNote[], tempoBpm: number | null, durationBeats: number): MidiCorpusAccompanimentRestrikeMetrics {
  const groups = onsetGroups(pitchedNotes(notes));
  const attacks = groups.map((group) => {
    const classes = [...new Set(group.notes.map((value) => pitchClass(value.midi)))].sort((a, b) => a - b);
    const root = Math.min(...group.notes.map((value) => pitchClass(value.midi)));
    const hold = Math.max(...group.notes.map((value) => value.durationBeats));
    return { start: group.start, key: classes.join(","), size: classes.length, root, hold };
  });
  let same = 0;
  const intervals: number[] = [];
  let harmonicChanges = 0;
  for (let index = 1; index < attacks.length; index += 1) {
    const previous = attacks[index - 1]!;
    const current = attacks[index]!;
    if (current.key === previous.key) {
      same += 1;
      intervals.push(current.start - previous.start);
    } else harmonicChanges += 1;
  }
  const rootChanges = attacks.slice(1).filter((value, index) => value.root !== attacks[index]!.root).length;
  const seconds = tempoBpm && tempoBpm > 0 ? durationBeats * 60 / tempoBpm : null;
  const medianInterval = median(intervals);
  return {
    attackCount: attacks.length,
    harmonicChangeCount: harmonicChanges,
    sameHarmonyRepeatedAttackCount: same,
    sameHarmonyRepeatedAttackRate: attacks.length > 1 ? round(same / (attacks.length - 1)) ?? 0 : 0,
    equivalentChordIntervalsBeats: { median: medianInterval, p90: quantile(intervals, 0.9) },
    meanChordHoldDurationBeats: mean(attacks.map((value) => value.hold)),
    attacksWithoutHarmonicChange: same,
    fullChordAttacksPerSecond: seconds && seconds > 0 ? round(attacks.filter((value) => value.size >= 3).length / seconds) : null,
    rootAttacksPerSecond: seconds && seconds > 0 ? round(attacks.length / seconds) : null,
    twoSecondPulseDistanceSeconds: medianInterval !== null && tempoBpm && tempoBpm > 0 ? round(Math.abs(medianInterval * 60 / tempoBpm - 2)) : null,
    basis: "onset-pitch-class-sets",
  };
}

function globalMetrics(file: CanonicalMidi, parser: MidiCorpusParserSummary): MidiCorpusGlobalMetrics {
  const all = file.notes.filter((value) => finite(value.startBeats) && finite(value.durationBeats) && value.durationBeats > 0);
  const pitched = pitchedNotes(all);
  const groups = onsetGroups(pitched);
  const durations = parser.durationBeats > 0 && parser.tempoBpm && parser.tempoBpm > 0 ? parser.durationBeats * 60 / parser.tempoBpm : null;
  const close = groups.slice(1).filter((group, index) => group.start - groups[index]!.start <= MIDI_CORPUS_REPORT_CONFIG.restrikeGapBeats + 1e-9).length;
  const repeated = groups.slice(1).filter((group, index) => group.start - groups[index]!.start <= MIDI_CORPUS_REPORT_CONFIG.restrikeGapBeats + 1e-9
    && group.notes.some((current) => groups[index]!.notes.some((previous) => current.midi === previous.midi))).length;
  const short = pitched.filter((value) => value.durationBeats <= MIDI_CORPUS_REPORT_CONFIG.veryShortBeats).length;
  const isolated = pitched.filter((value) => value.durationBeats <= MIDI_CORPUS_REPORT_CONFIG.isolatedDurationBeats
    && !pitched.some((other) => other !== value && Math.abs(other.startBeats - value.startBeats) <= MIDI_CORPUS_REPORT_CONFIG.isolatedGapBeats)).length;
  const low = pitched.filter((value) => value.midi <= 48);
  const lowGroups = onsetGroups(low);
  const lowClose = lowGroups.slice(1).filter((group, index) => group.start - lowGroups[index]!.start <= MIDI_CORPUS_REPORT_CONFIG.restrikeGapBeats + 1e-9).length;
  const pitches = pitched.map((value) => value.midi);
  return {
    noteCount: all.length,
    pitchedNoteCount: pitched.length,
    percussionNoteCount: all.length - pitched.length,
    onsetCount: groups.length,
    notesPerSecond: durations && durations > 0 ? round(all.length / durations) : null,
    onsetsPerSecond: durations && durations > 0 ? round(groups.length / durations) : null,
    durationBeats: round(parser.durationBeats) ?? 0,
    durationSeconds: durations === null ? null : round(durations),
    pitchMin: pitches.length ? Math.min(...pitches) : null,
    pitchMax: pitches.length ? Math.max(...pitches) : null,
    pitchSpan: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : null,
    veryShortCount: short,
    veryShortRate: pitched.length ? round(short / pitched.length) ?? 0 : 0,
    isolatedShortCount: isolated,
    repeatedAttackRate: groups.length > 1 ? round(repeated / (groups.length - 1)) ?? 0 : 0,
    closeAttackRate: groups.length > 1 ? round(close / (groups.length - 1)) ?? 0 : 0,
    simultaneity: sweep(pitched),
    lowRegisterRatio: pitched.length ? round(low.length / pitched.length) ?? 0 : 0,
    lowRegisterCloseAttackRate: lowGroups.length > 1 ? round(lowClose / (lowGroups.length - 1)) ?? 0 : 0,
    lowRegisterMudRate: pitched.length && lowGroups.length > 1
      ? round((low.length / pitched.length) * (lowClose / (lowGroups.length - 1))) ?? 0
      : 0,
  };
}

function roleMetrics(roles: MidiRoleLayers, parser: MidiCorpusParserSummary): MidiCorpusRoleMetrics {
  const byRole = roles.byRole;
  const toNotes = (role: MidiCorpusRole): CanonicalMidiNote[] => (byRole[role] ?? []) as unknown as CanonicalMidiNote[];
  return {
    melody: handMetrics(toNotes("melody"), parser.tempoBpm),
    harmony: handMetrics(toNotes("harmony"), parser.tempoBpm),
    bass: handMetrics(toNotes("bass"), parser.tempoBpm),
    rhythm: handMetrics(toNotes("rhythm"), parser.tempoBpm),
    other: handMetrics(toNotes("other"), parser.tempoBpm),
  };
}

function roleReport(roles: MidiRoleLayers): MidiCorpusRoleReport {
  const counts = Object.fromEntries(ROLE_KEYS.map((role) => [role, roles.byRole[role].length])) as Record<MidiCorpusRole, number>;
  const onsets = Object.fromEntries(ROLE_KEYS.map((role) => [role, onsetGroups(roles.byRole[role] as unknown as CanonicalMidiNote[]).length])) as Record<MidiCorpusRole, number>;
  const semanticKeys: readonly MidiCorpusSemanticRole[] = ["PIANO_FULL", "PIANO_UPPER", "PIANO_LOWER", "MELODY", "COUNTERMELODY", "LEAD", "RIFF", "HARMONY", "BASS", "RHYTHM", "DRUMS", "UNKNOWN"];
  const semanticCounts = Object.fromEntries(semanticKeys.map((role) => [role, roles.all.filter((value) => value.semanticRole === role).length])) as Record<MidiCorpusSemanticRole, number>;
  const layerCounts = Object.fromEntries(SEMANTIC_LAYER_KEYS.map((layer) => {
    const values = roles.semantic[layer];
    return [layer, { notes: values.length, onsets: onsetGroups(values).length }];
  })) as MidiCorpusLayerCounts;
  const laneReports = roles.lanes.map((lane: MidiRoleClassification) => ({
    laneKey: lane.laneKey,
    role: lane.role,
    semanticRole: lane.semanticRole,
    readiness: lane.readiness,
    ambiguity: lane.ambiguity,
    signals: [...lane.signals],
    trackIndex: lane.stats.trackIndex,
    trackName: sourceText(lane.stats.trackName),
    noteCount: lane.stats.noteCount,
    onsetCount: lane.stats.onsetCount,
    notesPerOnset: round(lane.stats.notesPerOnset) ?? 0,
    medianMidi: round(lane.stats.medianMidi),
    percussion: lane.stats.percussion,
    reason: lane.reason,
  })).sort((left, right) => compareText(left.laneKey, right.laneKey));
  const reasons: MidiCorpusReadinessReport["reasons"] = {
    pianoTarget: [], melody: [], harmony: [], bassRoot: [], rhythm: [],
  };
  const pianoLane = laneReports.some((lane) => /(?:piano|keyboard|keys|electric piano|grand piano)/i.test(lane.trackName ?? ""));
  const melodyCount = counts.melody;
  const harmonyCount = counts.harmony;
  const bassCount = counts.bass;
  const rhythmCount = counts.rhythm;
  const readiness: MidiCorpusReadinessReport = {
    pianoTarget: pianoLane ? "READY_WITH_WARNINGS" : "MANUAL_VALIDATION_REQUIRED",
    melody: melodyCount > 0 ? "READY_WITH_WARNINGS" : "NOT_AVAILABLE",
    harmony: harmonyCount > 0 ? "READY_WITH_WARNINGS" : "NOT_AVAILABLE",
    bassRoot: bassCount > 0 ? "READY_WITH_WARNINGS" : "NOT_AVAILABLE",
    rhythm: rhythmCount > 0 ? "READY_WITH_WARNINGS" : "NOT_AVAILABLE",
    reasons,
  };
  if (pianoLane) reasons.pianoTarget.push("track metadata names a piano-like lane; direct target still needs listening review");
  else reasons.pianoTarget.push("no piano-like track metadata; classify as semantic or manually validate");
  if (melodyCount > 0) reasons.melody.push("one or more non-percussion lanes classified as melody");
  else reasons.melody.push("no melody-classified lane");
  if (harmonyCount > 0) reasons.harmony.push("one or more harmony-classified lanes");
  else reasons.harmony.push("no harmony-classified lane");
  if (bassCount > 0) reasons.bassRoot.push("one or more low-register bass lanes");
  else reasons.bassRoot.push("no bass-classified lane");
  if (rhythmCount > 0) reasons.rhythm.push("percussion/rhythm lane present");
  else reasons.rhythm.push("no rhythm-classified lane");
  return { laneCount: laneReports.length, lanes: laneReports, counts, onsets, semanticCounts, layerCounts, readiness };
}

function integrity(result: MidiCorpusResult | undefined, canonical: CanonicalMidi | null, strictResult?: MidiCorpusResult): MidiCorpusIntegrityReport {
  if (!result) return { status: canonical ? "not-provided" : "invalid", strictParse: canonical ? "not-run" : "failed", inputBytes: null, inputSha256: null, normalizedBytes: null, normalizedSha256: null, normalization: null, errors: canonical ? [] : ["no canonical MIDI result was supplied"], warnings: [] };
  const errors = [...(strictResult?.issues ?? []), ...result.issues].filter((value) => value.severity === "error").map((value) => value.message).sort(compareText);
  const warnings = result.issues.filter((value) => value.severity === "warning").map((value) => value.message).sort(compareText);
  return {
    status: result.status,
    strictParse: strictResult?.status === "invalid" || result.status === "invalid" ? "failed" : "passed",
    inputBytes: result.inputBytes,
    inputSha256: result.inputSha256,
    normalizedBytes: result.normalizedBytes?.byteLength ?? result.normalization.afterBytes,
    normalizedSha256: result.normalizedSha256 ?? result.normalization.afterSha256,
    normalization: result.normalization,
    errors,
    warnings,
  };
}

function roleReadinessWithOverrides(
  roles: MidiCorpusRoleReport | null,
  input: MidiCorpusSourceReportInput,
  canonical: CanonicalMidi | null,
): MidiCorpusReadinessReport {
  const reasons: MidiCorpusReadinessReport["reasons"] = {
    pianoTarget: [], melody: [], harmony: [], bassRoot: [], rhythm: [],
  };
  if (!canonical || !roles) {
    for (const role of Object.keys(reasons) as Array<keyof typeof reasons>) {
      reasons[role].push("canonical MIDI/role layers unavailable");
    }
    return { pianoTarget: canonical ? "MANUAL_VALIDATION_REQUIRED" : "FAILED", melody: "NOT_AVAILABLE", harmony: "NOT_AVAILABLE", bassRoot: "NOT_AVAILABLE", rhythm: "NOT_AVAILABLE", reasons };
  }
  const readiness = { ...roles.readiness, reasons };
  for (const role of Object.keys(reasons) as Array<keyof typeof reasons>) {
    reasons[role].push(...(roles.readiness.reasons[role] ?? []));
  }
  const kind = input.referenceKind ?? "unknown";
  if ((kind === "piano-target" || kind === "direct-piano" || kind === "multitrack-piano") && readiness.pianoTarget === "MANUAL_VALIDATION_REQUIRED") {
    readiness.pianoTarget = "READY_WITH_WARNINGS";
    reasons.pianoTarget.push("caller identified this source as a piano target; track semantics remain unverified");
  }
  // A named single-track piano is represented as PIANO_FULL at the note
  // level, so its coarse lane remains harmony-like.  Use the derived
  // semantic projections for readiness in direct-piano reports; otherwise a
  // perfectly usable piano reference is incorrectly reported as having no
  // melody (and becomes a false MISSING_MELODY defect).
  const directPiano = kind === "piano-target" || kind === "direct-piano" || kind === "multitrack-piano"
    || (roles.layerCounts.pianoTarget.notes > 0
      && roles.lanes.length === 1
      && roles.lanes[0]?.semanticRole === "PIANO_FULL");
  if (directPiano) {
    const semanticAvailability: ReadonlyArray<{
      readiness: "melody" | "harmony" | "bassRoot" | "rhythm";
      layer: Exclude<MidiCorpusSemanticLayer, "fullSymbolic" | "pianoTarget">;
      label: string;
    }> = [
      { readiness: "melody", layer: "melody", label: "melody" },
      { readiness: "harmony", layer: "harmony", label: "harmony" },
      { readiness: "bassRoot", layer: "bassRoot", label: "bass-root" },
      { readiness: "rhythm", layer: "rhythmAttacks", label: "rhythm-attack" },
    ];
    for (const value of semanticAvailability) {
      const counts = roles.layerCounts[value.layer];
      if (counts.notes > 0) {
        if (readiness[value.readiness] === "NOT_AVAILABLE" || readiness[value.readiness] === "MANUAL_VALIDATION_REQUIRED") {
          readiness[value.readiness] = "READY_WITH_WARNINGS";
        }
        reasons[value.readiness].push(`direct piano semantic ${value.label} layer: ${counts.notes} notes across ${counts.onsets} attacks`);
      } else {
        reasons[value.readiness].push(`direct piano semantic ${value.label} layer has no notes`);
      }
    }
  }
  for (const trusted of input.trustedRoles ?? []) {
    if (trusted === "piano-target") readiness.pianoTarget = "READY";
    if (trusted === "melody") readiness.melody = "READY";
    if (trusted === "harmony") readiness.harmony = "READY";
    if (trusted === "bass-root") readiness.bassRoot = "READY";
    if (trusted === "rhythm") readiness.rhythm = "READY";
    const key = trusted === "bass-root" ? "bassRoot" : trusted === "piano-target" ? "pianoTarget" : trusted;
    reasons[key].push("explicit caller trust label");
  }
  return readiness;
}

function safeModes(input: MidiCorpusSourceReportInput, kind: MidiCorpusReferenceKind): MidiCorpusEvaluationMode[] {
  const allowed = new Set<MidiCorpusEvaluationMode>(["PIANO_TARGET", "SEMANTIC_MELODY", "SEMANTIC_HARMONY", "BASS_ROOT", "RHYTHM_ONLY"]);
  if (input.evaluationModes?.length) {
    const explicit = [...new Set(input.evaluationModes.filter((mode): mode is MidiCorpusEvaluationMode => allowed.has(mode as MidiCorpusEvaluationMode)))].sort(compareText);
    if (explicit.length) return explicit;
  }
  if (kind === "piano-target" || kind === "direct-piano" || kind === "multitrack-piano") return ["PIANO_TARGET", "SEMANTIC_MELODY", "SEMANTIC_HARMONY", "BASS_ROOT", "RHYTHM_ONLY"];
  if (kind === "semantic-full-band" || kind === "semantic-band" || kind === "mixed") return ["SEMANTIC_MELODY", "SEMANTIC_HARMONY", "BASS_ROOT", "RHYTHM_ONLY"];
  return ["SEMANTIC_MELODY", "SEMANTIC_HARMONY", "BASS_ROOT", "RHYTHM_ONLY"];
}

function safeKind(value: unknown): MidiCorpusReferenceKind {
  return value === "piano-target" || value === "semantic-full-band" || value === "mixed" || value === "direct-piano" || value === "multitrack-piano" || value === "semantic-band" ? value : "unknown";
}

/** Build a report for one source using only canonical in-memory data. */
export function buildMidiCorpusSongReport(input: MidiCorpusSourceReportInput): MidiCorpusSongReport {
  const result = input.result;
  const canonical = input.canonical ?? result?.canonical ?? null;
  const kind = safeKind(input.referenceKind);
  const parsed = canonical ? parserSummary(canonical) : null;
  const layers = canonical ? input.roles ?? classifyMidiRoles(canonical) : null;
  const roleSummary = layers ? roleReport(layers) : null;
  const readiness = roleReadinessWithOverrides(roleSummary, input, canonical);
  const sourceIdentity = canonical ? songIdentitySignature({ ...canonical, title: input.title ?? canonical.title } as CanonicalMidi) : null;
  const identityBasis = sourceIdentity ? ((input.title ?? canonical?.title) ? "metadata" : "canonical-notes") : "unavailable";
  const notes = canonical?.notes ?? [];
  const metrics = canonical && parsed && layers ? {
    global: globalMetrics(canonical, parsed),
    roles: roleMetrics(layers, parsed),
    samePitchRestrikes: measureRestrikes(notes, { division: canonical.division }),
    accompanimentRestrikes: accompanimentRestrikes([
      ...(layers.byRole.harmony as unknown as CanonicalMidiNote[]),
      ...(layers.byRole.bass as unknown as CanonicalMidiNote[]),
      ...(layers.byRole.rhythm as unknown as CanonicalMidiNote[]),
      ...(layers.byRole.other as unknown as CanonicalMidiNote[]),
    ], parsed.tempoBpm, parsed.durationBeats),
    source: {
      noteCounts: roleSummary!.counts,
      percussionPitchCount: notes.filter((value) => value.percussion === true).length,
      // `other` is a real coarse role, not an unknown/provenance bucket.
      // The current role classifier always assigns a coarse label; unknown
      // remains zero until a classifier explicitly exposes that state.
      unknownRoleCount: 0,
    },
  } : null;
  const diagnostics: string[] = [];
  if (!canonical) diagnostics.push("canonical MIDI unavailable; structural and role metrics are unavailable");
  if (result?.status === "normalized") diagnostics.push("source required bounded event normalization; inspect the normalization audit before trusting it");
  if (result?.status === "invalid") diagnostics.push("strict MIDI validation failed; this source is not eligible for comparison");
  if (roleSummary && roleSummary.readiness.pianoTarget === "MANUAL_VALIDATION_REQUIRED") diagnostics.push("piano-target status is not inferred from filename; manual role review is required");
  return {
    schemaVersion: MIDI_CORPUS_REPORT_SCHEMA_VERSION,
    reportVersion: MIDI_CORPUS_REPORT_VERSION,
    id: sourceText(input.id) ?? "invalid-source",
    label: sourceText(input.label),
    artist: sourceText(input.artist),
    title: sourceText(input.title ?? canonical?.title),
    referenceKind: kind,
    evaluationModes: safeModes(input, kind),
    identity: { signature: sourceIdentity, basis: identityBasis },
    integrity: integrity(result, canonical, input.strictResult),
    parser: parsed,
    tracks: canonical ? trackSummaries(canonical) : [],
    roles: roleSummary,
    metrics,
    readiness,
    diagnostics: [...new Set(diagnostics)].sort(compareText),
    ...(input.artifacts ? { artifacts: Object.fromEntries(Object.entries(input.artifacts)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .sort(([left], [right]) => compareText(left, right))) as MidiCorpusSourceArtifacts } : {}),
  };
}

function metricValue(snapshot: MidiCorpusComparisonSnapshot | undefined, getter: (metrics: MidiCorpusMetrics) => number | null): number | null {
  if (!snapshot) return null;
  const metrics = snapshot.report?.metrics ?? snapshot.metrics;
  return metrics ? getter(metrics as MidiCorpusMetrics) : null;
}

function delta(baseline: number | null, current: number | null, lowerIsBetter: boolean): MidiCorpusMetricDelta {
  return { baseline: round(baseline), current: round(current), delta: baseline !== null && current !== null ? round(current - baseline) : null, lowerIsBetter };
}

function comparisonReport(input: MidiCorpusComparisonInput): MidiCorpusComparisonReport {
  const bars = finite(input.alignedDurationBeats) ? round(input.alignedDurationBeats! / 4) : null;
  const baselineWindows = finite(input.baseline?.coverage?.windows) ? Math.max(0, input.baseline!.coverage!.windows) : 0;
  const currentWindows = finite(input.current?.coverage?.windows) ? Math.max(0, input.current!.coverage!.windows) : 0;
  const status = input.status ?? (input.comparable && input.baseline && input.current ? "aligned" : "insufficient-evidence");
  const explicitAlignment = input.comparable === true
    && finite(input.alignedDurationBeats)
    && input.alignedDurationBeats! > 0
    && baselineWindows >= MIDI_CORPUS_REPORT_CONFIG.minimumReferenceWindows
    && currentWindows >= MIDI_CORPUS_REPORT_CONFIG.minimumReferenceWindows
    && (bars ?? 0) >= MIDI_CORPUS_REPORT_CONFIG.minimumReferenceBars
    && input.baseline?.coverage?.status === "aligned"
    && input.current?.coverage?.status === "aligned"
    && Boolean(input.baseline?.revision?.trim() && input.current?.revision?.trim());
  const genuine = status === "aligned" && Boolean(input.baseline && input.current) && explicitAlignment;
  const metrics = {
    noteCount: delta(metricValue(input.baseline, (value) => value.global.noteCount), metricValue(input.current, (value) => value.global.noteCount), false),
    melodyLargeLeapRate: delta(metricValue(input.baseline, (value) => value.roles.melody.largeLeap.rate), metricValue(input.current, (value) => value.roles.melody.largeLeap.rate), true),
    accompanimentRestrikeRate: delta(metricValue(input.baseline, (value) => value.accompanimentRestrikes.sameHarmonyRepeatedAttackRate), metricValue(input.current, (value) => value.accompanimentRestrikes.sameHarmonyRepeatedAttackRate), true),
    lowRegisterMudRate: delta(metricValue(input.baseline, (value) => value.global.lowRegisterMudRate), metricValue(input.current, (value) => value.global.lowRegisterMudRate), true),
    octaveBounceCount: delta(metricValue(input.baseline, (value) => value.roles.melody.octaveBounceCount), metricValue(input.current, (value) => value.roles.melody.octaveBounceCount), true),
  };
  const improvements = Object.values(metrics).filter((value) => value.delta !== null && (value.lowerIsBetter ? value.delta < 0 : value.delta > 0)).length;
  const regressions = Object.values(metrics).filter((value) => value.delta !== null && (value.lowerIsBetter ? value.delta > 0 : value.delta < 0)).length;
  const winner: MidiCorpusComparisonReport["winner"] = !genuine ? null : improvements > 0 && regressions === 0 ? "current" : regressions > 0 && improvements === 0 ? "baseline" : improvements || regressions ? "mixed" : null;
  const diagnostics = genuine ? [] : ["baseline/current comparison is not genuine: both revisions and explicit aligned evidence are required"];
  return { songId: sourceText(input.songId) ?? "invalid-song", status, genuine, referenceRoles: [...new Set(input.referenceRoles ?? [])].map((value) => sourceText(value) ?? "unknown").sort(compareText), alignedDurationBeats: finite(input.alignedDurationBeats) ? round(input.alignedDurationBeats!) : null, alignedBars: bars, metrics, winner, diagnostics };
}

/** Build the fail-closed baseline/current benchmark summary. */
export function buildMidiCorpusBenchmark(
  inputs: readonly MidiCorpusComparisonInput[] = [],
  minimumComparableSongs: number = Number(MIDI_CORPUS_REPORT_CONFIG.minimumComparableSongs),
): MidiCorpusBenchmarkReport {
  const requiredSongs = finite(minimumComparableSongs) && Number.isInteger(minimumComparableSongs) && minimumComparableSongs > 0
    ? minimumComparableSongs
    : MIDI_CORPUS_REPORT_CONFIG.minimumComparableSongs;
  const comparisons = inputs.map(comparisonReport).sort((left, right) => compareText(left.songId, right.songId));
  const genuine = comparisons.filter((value) => value.genuine);
  const winners = new Set(genuine.map((value) => value.winner).filter((value): value is "baseline" | "current" => value === "baseline" || value === "current"));
  const winner: MidiCorpusBenchmarkReport["winner"] = genuine.length === 0 ? null : winners.size === 1 ? [...winners][0]! : winners.size > 1 ? "mixed" : null;
  const roles = [...new Set(genuine.flatMap((value) => value.referenceRoles))].sort(compareText);
  const alignedDurationBeats = round(genuine.reduce((sum, value) => sum + (value.alignedDurationBeats ?? 0), 0)) ?? 0;
  return {
    status: genuine.length >= requiredSongs ? "ready" : "insufficient-evidence",
    minimumComparableSongs: requiredSongs,
    comparableSongCount: genuine.length,
    comparisons,
    trustedRoles: roles,
    alignedDurationBeats,
    winner,
    diagnostics: genuine.length >= requiredSongs ? [] : [`only ${genuine.length} genuine baseline/current comparisons; at least ${requiredSongs} are required`],
  };
}

function defectForSong(song: MidiCorpusSongReport, kind: MidiCorpusDefectKind): string | null {
  const metrics = song.metrics;
  if (!metrics) return null;
  switch (kind) {
    case "HIGH_JUMP_RATE": {
      const value = metrics.roles.melody.largeLeap.rate;
      return value >= MIDI_CORPUS_REPORT_CONFIG.highJumpRate ? `melody large-leap rate ${value}` : null;
    }
    case "EXCESSIVE_CHORD_RESTRIKES": {
      const value = metrics.accompanimentRestrikes.sameHarmonyRepeatedAttackRate;
      return value >= MIDI_CORPUS_REPORT_CONFIG.excessiveRestrikeRate ? `same-harmony repeated-attack rate ${value}` : null;
    }
    case "LOW_REGISTER_MUD": {
      const value = metrics.global.lowRegisterMudRate;
      return value >= MIDI_CORPUS_REPORT_CONFIG.lowRegisterMudRate ? `low-register close-attack rate ${value}` : null;
    }
    case "CHORD_WALLS": {
      const value = metrics.accompanimentRestrikes.sameHarmonyRepeatedAttackRate;
      return value >= MIDI_CORPUS_REPORT_CONFIG.chordWallRate && (metrics.accompanimentRestrikes.attackCount >= 8) ? `repeated equivalent chord attacks ${value}` : null;
    }
    case "ROOT_JITTER": {
      const value = metrics.accompanimentRestrikes.attackCount > 1
        ? metrics.accompanimentRestrikes.harmonicChangeCount / (metrics.accompanimentRestrikes.attackCount - 1)
        : 0;
      return value >= MIDI_CORPUS_REPORT_CONFIG.rootJitterRate ? `root/harmony change instability proxy ${round(value)}` : null;
    }
    case "OCTAVE_BOUNCE": {
      const value = metrics.roles.melody.octaveBounceCount;
      return value > 0 ? `melody octave-bounce count ${value}` : null;
    }
    case "UNSUPPORTED_HARMONIC_CHANGES": {
      const value = metrics.accompanimentRestrikes.harmonicChangeCount;
      return value >= 3 && metrics.accompanimentRestrikes.attackCount > 0 ? `harmonic changes ${value} without semantic support evidence` : null;
    }
    case "MISSING_MELODY":
      return song.readiness.melody === "NOT_AVAILABLE" || song.readiness.melody === "FAILED" ? "no melody-ready role" : null;
  }
}

const DEFECT_STAGES: Record<MidiCorpusDefectKind, MidiCorpusDefectCluster["firstResponsibleStage"]> = {
  UNSUPPORTED_HARMONIC_CHANGES: "harmonic-inference",
  HIGH_JUMP_RATE: "lead-selection",
  EXCESSIVE_CHORD_RESTRIKES: "accompaniment-scheduler",
  LOW_REGISTER_MUD: "left-hand-voicing",
  CHORD_WALLS: "accompaniment-scheduler",
  ROOT_JITTER: "harmonic-inference",
  MISSING_MELODY: "source-separation",
  OCTAVE_BOUNCE: "register-stabilization",
};

/** Cluster only defects evidenced by at least the configured number of songs. */
export function computeMidiCorpusDefectClusters(
  songs: readonly MidiCorpusSongReport[],
  minimumOccurrences: number = Number(MIDI_CORPUS_REPORT_CONFIG.defectMinimumOccurrences),
): MidiCorpusDefectCluster[] {
  const kinds: readonly MidiCorpusDefectKind[] = ["UNSUPPORTED_HARMONIC_CHANGES", "HIGH_JUMP_RATE", "EXCESSIVE_CHORD_RESTRIKES", "LOW_REGISTER_MUD", "CHORD_WALLS", "ROOT_JITTER", "MISSING_MELODY", "OCTAVE_BOUNCE"];
  const clusters: MidiCorpusDefectCluster[] = [];
  for (const kind of kinds) {
    const evidence = songs.map((song) => ({ id: song.id, value: defectForSong(song, kind) })).filter((value): value is { id: string; value: string } => Boolean(value.value));
    if (evidence.length < minimumOccurrences) continue;
    clusters.push({ kind, songIds: evidence.map((value) => value.id).sort(compareText), occurrenceCount: evidence.length, firstResponsibleStage: DEFECT_STAGES[kind], evidence: evidence.map((value) => `${value.id}: ${value.value}`).sort(compareText) });
  }
  return clusters.sort((left, right) => (right.occurrenceCount - left.occurrenceCount) || compareText(left.kind, right.kind));
}

function redactPathLikeText(value: string): string {
  return value
    .replace(/file:\/\/[^\s"'<>;,)]*/gi, "[redacted-path]")
    // Local absolute paths may contain spaces; stop only at a structural
    // delimiter so a path suffix cannot leak into a report or error string.
    .replace(/(^|[\s(=,:;\[\]])\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)(?:[^"'<>;,)\n\r]*)?/gi, "$1[redacted-path]")
    .replace(/(^|[\s(=,:;\[\]])[A-Za-z]:[\\/][^"'<>;,)\n\r]*/g, "$1[redacted-path]")
    .replace(/(^|[\s(=,:;\[\]])(?:\.\.?\/|[A-Za-z0-9._-]+\/)[^\s"'<>;,)]*\.(?:mid|midi|json|wav|mp3|txt|pdf|xml|mxl|csv|log)(?=$|[\s"'<>;,\)])/gi, "$1[redacted-path]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted-credentials]@");
}

function isSafeRelativeArtifactReference(value: string, key: string | undefined): boolean {
  if (key !== "canonicalJson" && key !== "normalizedMidi" && key !== "fullReferenceWav" && key !== "excerptReferenceWav") return false;
  // These labels are generated beneath the caller's external output root.
  // Preserve them so a local reviewer can find derived artifacts, while still
  // rejecting traversal, absolute paths, URI schemes, and shell metacharacters.
  return /^(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value);
}

function stableValue(value: unknown, key?: string): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string") return isSafeRelativeArtifactReference(value, key) ? value : redactPathLikeText(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      if (/^(?:generatedAt|path|absolutePath|filePath|midiPath|wavPath|sourcePath)$/i.test(key) || /(?:path|filename|file)$/i.test(key)) continue;
      const item = stableValue((value as Record<string, unknown>)[key], key);
      if (item !== undefined) Object.defineProperty(result, redactPathLikeText(key), { enumerable: true, configurable: true, writable: true, value: item });
    }
    return result;
  }
  return value;
}

export function canonicalMidiCorpusReportJson(value: MidiCorpusReport | unknown): string {
  return JSON.stringify(stableValue(value));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Build the complete deterministic report. No comparison is inferred. */
export function buildMidiCorpusReport(input: MidiCorpusReportInput): MidiCorpusReport {
  const sources = [...input.sources].map(buildMidiCorpusSongReport).sort((left, right) => compareText(left.id, right.id));
  const benchmark = buildMidiCorpusBenchmark(input.comparisons ?? [], input.minimumComparableSongs ?? MIDI_CORPUS_REPORT_CONFIG.minimumComparableSongs);
  const reportWithoutDeterminism: Omit<MidiCorpusReport, "determinism"> = {
    schemaVersion: MIDI_CORPUS_REPORT_SCHEMA_VERSION,
    reportVersion: MIDI_CORPUS_REPORT_VERSION,
    kind: "midi-reference-corpus",
    corpusId: sourceText(input.corpusId) ?? "invalid-corpus",
    status: sources.length === 0
      ? "failed"
      : sources.some((source) => source.integrity.status === "invalid" || source.integrity.strictParse === "failed" || source.integrity.normalization?.status === "blocked")
        ? "review-required"
        : sources.length < 7 ? "partial" : "ready",
    sourceCount: sources.length,
    sources,
    benchmark,
    defectClusters: computeMidiCorpusDefectClusters(sources),
  };
  return { ...reportWithoutDeterminism, determinism: { canonicalSha256: hashText(canonicalMidiCorpusReportJson(reportWithoutDeterminism)) } };
}

/** Short alias for callers that prefer a report-oriented name. */
export const buildCorpusReport = buildMidiCorpusReport;
export const corpusReportJson = canonicalMidiCorpusReportJson;
export const identifyCrossSongDefects = computeMidiCorpusDefectClusters;
