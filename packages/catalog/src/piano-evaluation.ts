import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  buildVariants,
  parseMidi,
  writeMidi,
  type Note,
  type ParsedMidi,
  type SongMeta,
} from "@keyspilli/midi";
import {
  normalizeSymbolicScore,
  type NormalizedSymbolicScore,
  type SymbolicAlignmentOptions,
  type SymbolicScoreInput,
} from "./symbolic-alignment.js";
import { alignPianoCandidates as alignPianoCandidatesWithDrift } from "./piano-alignment.js";

const EPS = 1e-9;
const ONSET_TOLERANCE = 0.08;
const SHORT_NOTE_BEATS = 0.25;
const ISOLATED_GAP_BEATS = 1.5;

export type PianoPurityClassification = "piano" | "piano-overlay" | "non-piano" | "unknown";
export type PianoRisk = "low" | "medium" | "high" | "unavailable";

export interface PianoCandidateInput extends Partial<SymbolicScoreInput> {
  id?: string;
  label?: string;
  selector?: string;
  parsed?: ParsedMidi;
  bytes?: Uint8Array;
  /** Explicit role lanes are optional and never required for evaluation. */
  roleNotes?: Record<string, Note[]>;
  mediaAvailable?: boolean;
  backendAvailable?: boolean;
  unavailableReason?: string;
}

export interface PianoEvaluationInput {
  candidates: PianoCandidateInput[];
  reference?: PianoCandidateInput;
  alignment?: SymbolicAlignmentOptions;
}

export interface PianoPurityReport {
  classification: PianoPurityClassification;
  overlayRisk: PianoRisk;
  pianoNoteRatio: number | null;
  nonPianoNoteRatio: number | null;
  signals: string[];
}

export interface PianoCoverageMetrics {
  firstBeat: number | null;
  lastBeat: number | null;
  activeBeats: number;
  ratio: number;
}

export interface PianoChromaMetrics {
  cosine: number | null;
  pitchClassJaccard: number | null;
  distinctPitchClasses: number;
}

export interface PianoContourMetrics {
  directionAgreement: number | null;
  matchedIntervals: number;
  p95LeapSemitones: number | null;
  maxLeapSemitones: number | null;
}

export interface PianoAttackMetrics {
  noteCount: number;
  onsetCount: number;
  onsetsPerSecond: number;
  medianIoiBeats: number | null;
  p90IoiBeats: number | null;
  repeatedAttackRate: number;
}

export interface PianoDensityMetrics {
  notesPerSecond: number;
  onsetsPerSecond: number;
  notesPerOnset: number;
  medianNotesPerOnset: number | null;
}

export interface PianoPolyphonyMetrics {
  max: number;
  p50: number;
  p90: number;
  p99: number;
  meanOnsetPolyphony: number;
  polyphonicOnsetRatio: number;
}

export interface PianoIsolatedNoteMetrics {
  count: number;
  rate: number;
  shortCount: number;
  shortRate: number;
}

export interface PianoStructuralMetrics {
  durationBeats: number;
  durationSeconds: number;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  coverage: PianoCoverageMetrics;
  chroma: PianoChromaMetrics;
  contour: PianoContourMetrics;
  attack: PianoAttackMetrics;
  density: PianoDensityMetrics;
  polyphony: PianoPolyphonyMetrics;
  isolatedNote: PianoIsolatedNoteMetrics;
}

export interface PianoReferenceMetrics {
  status: "not-requested" | "aligned" | "partial" | "mismatch" | "insufficient-evidence" | "alignment-required";
  offsetBeats: number | null;
  beatScale: number | null;
  transpositionSemitones: number | null;
  confidence: number | null;
  coverage: { referenceRatio: number | null; candidateRatio: number | null };
  metrics: {
    exactPitch: { precision: number | null; recall: number | null; f1: number | null };
    pitchClass: { precision: number | null; recall: number | null; f1: number | null };
    onset: { precision: number | null; recall: number | null; f1: number | null; matched: number };
    chroma: { cosine: number | null };
    contour: { directionAgreement: number | null; matchedIntervals: number };
    density: { referenceOnsets: number; candidateOnsets: number; ratio: number | null };
  };
  diagnostics: string[];
}

export interface PianoCandidateEvaluation {
  id: string;
  label?: string;
  status: "available" | "unavailable";
  purity: PianoPurityReport;
  metrics: PianoStructuralMetrics | null;
  reference: PianoReferenceMetrics | null;
  rankScore: number | null;
  diagnostics: string[];
  /** Internal preview source, omitted by canonical JSON. */
  readonly notes?: Note[];
  readonly tempoBpm?: number;
  readonly timeSig?: [number, number];
  readonly durationBeats?: number;
}

export interface PianoRankingEntry {
  id: string;
  rank: number;
  score: number | null;
  reasons: string[];
}

export interface PianoEvaluationReport {
  schemaVersion: 1;
  candidates: PianoCandidateEvaluation[];
  ranking: PianoRankingEntry[];
  /** Explicitly distinguishes omitted reference evidence from a failed read. */
  referenceStatus?: "not-requested" | "available" | "missing" | "invalid";
  referenceDiagnostics?: string[];
  disclaimer: string;
  determinism: { canonicalSha256: string };
}

export interface PianoPreviewWriteResult {
  files: { raw: string; aligned: string; easy: string; medium: string };
  /** JSON serialization intentionally never reveals local paths. */
  toJSON(): { files: { raw: string; aligned: string; easy: string; medium: string } };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Number.isFinite(value) ? Math.round(value * factor) / factor : 0;
}

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

function extent(notes: readonly Note[]): number {
  return notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
}

function validNotes(notes: readonly Note[]): Note[] {
  return notes.filter((note) => note && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && finite(note.start) && note.start >= 0 && finite(note.dur) && note.dur > 0
    && finite(note.vel) && note.vel >= 0 && note.vel <= 127).map((note) => ({ ...note }));
}

function sortedNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || (a.hand ?? "").localeCompare(b.hand ?? ""));
}

function onsetGroups(notes: readonly Note[]): Note[][] {
  const groups: Note[][] = [];
  for (const note of sortedNotes(notes)) {
    const previous = groups.at(-1);
    if (previous && note.start - previous[0]!.start <= ONSET_TOLERANCE + EPS) previous.push(note);
    else groups.push([note]);
  }
  return groups;
}

function activeCoverage(notes: readonly Note[], durationBeats: number): PianoCoverageMetrics {
  if (!notes.length || durationBeats <= 0) return { firstBeat: null, lastBeat: null, activeBeats: 0, ratio: 0 };
  const events = notes.flatMap((note) => [[Math.max(0, note.start), 1], [Math.min(durationBeats, note.start + note.dur), -1]] as [number, number][])
    .filter(([time]) => time >= 0 && time <= durationBeats)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let previous = 0;
  let activeBeats = 0;
  for (const [time, delta] of events) {
    if (current > 0) activeBeats += Math.max(0, time - previous);
    current += delta;
    previous = time;
  }
  return {
    firstBeat: round(Math.min(...notes.map((note) => Math.max(0, note.start)))),
    lastBeat: round(Math.min(durationBeats, Math.max(...notes.map((note) => note.start + note.dur)))),
    activeBeats: round(activeBeats),
    ratio: round(Math.max(0, Math.min(1, activeBeats / durationBeats))),
  };
}

function chroma(notes: readonly Note[]): PianoChromaMetrics {
  const pcs = new Set(notes.map((note) => ((note.midi % 12) + 12) % 12));
  if (!notes.length) return { cosine: null, pitchClassJaccard: null, distinctPitchClasses: 0 };
  // A candidate-only chroma has no comparison vector; cosine is populated by
  // the reference alignment. The distinct count remains useful standalone.
  return { cosine: null, pitchClassJaccard: null, distinctPitchClasses: pcs.size };
}

function contour(notes: readonly Note[]): PianoContourMetrics {
  const pitches = onsetGroups(notes).map((group) => Math.max(...group.map((note) => note.midi)));
  const leaps = pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!));
  return {
    directionAgreement: null,
    matchedIntervals: 0,
    p95LeapSemitones: quantile(leaps, 0.95),
    maxLeapSemitones: leaps.length ? Math.max(...leaps) : null,
  };
}

function polyphony(notes: readonly Note[]): PianoPolyphonyMetrics {
  if (!notes.length) return { max: 0, p50: 0, p90: 0, p99: 0, meanOnsetPolyphony: 0, polyphonicOnsetRatio: 0 };
  const events = notes.flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let level = 0;
  let max = 0;
  const sounding: number[] = [];
  for (const [, delta] of events) { level += delta; max = Math.max(max, level); sounding.push(level); }
  const groups = onsetGroups(notes);
  const atAttack = groups.map((group) => group.length);
  return {
    max,
    p50: quantile(sounding, 0.5) ?? 0,
    p90: quantile(sounding, 0.9) ?? 0,
    p99: quantile(sounding, 0.99) ?? 0,
    meanOnsetPolyphony: round(atAttack.reduce((sum, count) => sum + count, 0) / atAttack.length),
    polyphonicOnsetRatio: round(atAttack.filter((count) => count > 1).length / atAttack.length),
  };
}

function structuralMetrics(notes: readonly Note[], tempoBpm: number, durationBeats: number): PianoStructuralMetrics {
  const valid = sortedNotes(notes);
  const safeTempo = finite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120;
  const safeDuration = Math.max(durationBeats, extent(valid));
  const groups = onsetGroups(valid);
  const starts = groups.map((group) => group[0]!.start);
  const iois = starts.slice(1).map((start, index) => start - starts[index]!);
  const repeated = groups.slice(1).filter((group, index) => group.some((note) => groups[index]!.some((previous) => previous.midi === note.midi))).length;
  const isolated = valid.filter((note) => note.dur <= SHORT_NOTE_BEATS
    && !valid.some((other) => other !== note && Math.abs(other.start - note.start) <= ISOLATED_GAP_BEATS)).length;
  const span = valid.length ? Math.max(...valid.map((note) => note.midi)) - Math.min(...valid.map((note) => note.midi)) : null;
  const seconds = safeDuration * 60 / safeTempo;
  return {
    durationBeats: round(safeDuration),
    durationSeconds: round(seconds),
    pitchMin: valid.length ? Math.min(...valid.map((note) => note.midi)) : null,
    pitchMax: valid.length ? Math.max(...valid.map((note) => note.midi)) : null,
    pitchSpan: span,
    coverage: activeCoverage(valid, safeDuration),
    chroma: chroma(valid),
    contour: contour(valid),
    attack: {
      noteCount: valid.length,
      onsetCount: groups.length,
      onsetsPerSecond: seconds > 0 ? round(groups.length / seconds) : 0,
      medianIoiBeats: median(iois),
      p90IoiBeats: quantile(iois, 0.9),
      repeatedAttackRate: groups.length > 1 ? round(repeated / (groups.length - 1)) : 0,
    },
    density: {
      notesPerSecond: seconds > 0 ? round(valid.length / seconds) : 0,
      onsetsPerSecond: seconds > 0 ? round(groups.length / seconds) : 0,
      notesPerOnset: groups.length ? round(valid.length / groups.length) : 0,
      medianNotesPerOnset: median(groups.map((group) => group.length)),
    },
    polyphony: polyphony(valid),
    isolatedNote: {
      count: isolated,
      rate: valid.length ? round(isolated / valid.length) : 0,
      shortCount: valid.filter((note) => note.dur <= SHORT_NOTE_BEATS).length,
      shortRate: valid.length ? round(valid.filter((note) => note.dur <= SHORT_NOTE_BEATS).length / valid.length) : 0,
    },
  };
}

function sourceText(input: PianoCandidateInput): string {
  const values: string[] = [];
  const metadata = input.metadata;
  const visit = (value: unknown): void => {
    if (typeof value === "string") values.push(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(metadata);
  visit(input.trackNames);
  visit(input.title);
  visit(input.label);
  return values.join(" ");
}

function purity(input: PianoCandidateInput, notes: readonly Note[]): PianoPurityReport {
  const text = sourceText(input);
  const pianoSignal = /\b(piano|keyboard|grand|upright)\b/.test(text);
  const nonPianoSignal = /\b(vocal|vocals|voice|guitar|bass|drum|strings?|orchestra|synth|backing|karaoke|mixed|overlay)\b/.test(text);
  const roleNotes = Object.entries(input.roleNotes ?? {}).flatMap(([role, roleNotes]) => roleNotes.map((note) => ({ role: role.toLowerCase(), note })));
  const allRoleNotes = [...notes.map((note) => ({ role: note.identitySource?.toLowerCase() ?? "", note })), ...roleNotes];
  // `Note.identitySource` describes the source lane of an arrangement, not
  // necessarily an audible overlay. When metadata explicitly says piano,
  // only separately supplied role lanes (or contradictory metadata) count as
  // overlay evidence. This avoids treating a piano arrangement's vocal-derived
  // melody and `other` bass shell as non-piano instruments.
  const explicitRoleNotes = roleNotes.filter(({ role }) => /vocal|voice|guitar|bass|drum|strings?|orchestra|synth|backing/.test(role));
  const noteRoleEvidence = !pianoSignal || nonPianoSignal
    ? allRoleNotes.filter(({ role }) => /vocal|voice|guitar|bass|drum|strings?|orchestra|synth|backing/.test(role))
    : [];
  const nonPianoNotes = [...explicitRoleNotes, ...noteRoleEvidence];
  const ratio = allRoleNotes.length ? nonPianoNotes.length / allRoleNotes.length : null;
  const signals = new Set<string>();
  if (pianoSignal) signals.add("piano metadata signal");
  if (nonPianoSignal) signals.add("non-piano metadata signal");
  if (nonPianoNotes.length) signals.add("non-piano role notes present");
  if (input.backendAvailable === false) signals.add("backend unavailable");
  if (input.mediaAvailable === false) signals.add("media unavailable");
  let classification: PianoPurityClassification = "unknown";
  if (pianoSignal && (nonPianoSignal || nonPianoNotes.length)) classification = "piano-overlay";
  else if (pianoSignal) classification = "piano";
  else if (nonPianoSignal || nonPianoNotes.length) classification = "non-piano";
  else if (notes.length) classification = "unknown";
  const overlayRisk: PianoRisk = input.mediaAvailable === false || input.backendAvailable === false
    ? "unavailable"
    : ratio !== null && ratio >= 0.2 || /\b(mixed|overlay|backing)\b/.test(text)
      ? "high"
      : ratio !== null && ratio > 0 ? "medium" : classification === "unknown" ? "medium" : "low";
  return {
    classification,
    overlayRisk,
    pianoNoteRatio: allRoleNotes.length ? round((allRoleNotes.length - nonPianoNotes.length) / allRoleNotes.length) : null,
    nonPianoNoteRatio: ratio === null ? null : round(ratio),
    signals: [...signals].sort(),
  };
}

function candidateScore(evaluation: PianoCandidateEvaluation): { score: number | null; reasons: string[] } {
  if (!evaluation.metrics) return { score: null, reasons: ["candidate metrics unavailable"] };
  const reasons: string[] = [];
  let score = 50;
  if (evaluation.purity.classification === "piano") { score += 25; reasons.push("piano purity signal"); }
  if (evaluation.purity.classification === "piano-overlay") { score += 5; reasons.push("piano signal with overlay risk"); }
  if (evaluation.purity.classification === "non-piano") { score -= 25; reasons.push("non-piano signal"); }
  if (evaluation.reference?.metrics.exactPitch.f1 !== null && evaluation.reference?.metrics.exactPitch.f1 !== undefined) {
    score += 20 * evaluation.reference.metrics.exactPitch.f1;
    reasons.push("reference pitch evidence");
  }
  score -= Math.min(15, evaluation.metrics.isolatedNote.rate * 15);
  if (evaluation.metrics.isolatedNote.count) reasons.push("isolated-note penalty");
  score -= Math.min(10, Math.max(0, evaluation.metrics.density.onsetsPerSecond - 12));
  return { score: round(Math.max(0, Math.min(100, score))), reasons };
}

function inputScore(input: PianoCandidateInput, subject = "candidate"): { score: NormalizedSymbolicScore | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  try {
    let score: NormalizedSymbolicScore | null = null;
    if (input.bytes) score = normalizeSymbolicScore(parseMidi(input.bytes));
    else if (input.parsed) score = normalizeSymbolicScore(input.parsed);
    else if (input.notes) score = normalizeSymbolicScore({ ...input, notes: input.notes });
    if (score) {
      diagnostics.push(...score.warnings);
      if (!score.notes.length) return { score: null, diagnostics: [...diagnostics, `${subject} contains no valid symbolic notes`] };
      return { score, diagnostics };
    }
  } catch (error) {
    diagnostics.push(`symbolic parse unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!diagnostics.length) diagnostics.push(`${subject} symbolic notes unavailable`);
  return { score: null, diagnostics };
}

function baseCandidateId(input: PianoCandidateInput, index: number): string {
  const raw = input.id ?? input.label ?? input.selector ?? "candidate";
  const clean = basename(raw).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || `candidate-${index + 1}`;
}

function candidateSortKey(input: PianoCandidateInput, score: NormalizedSymbolicScore | null): string {
  if (input.bytes) return hashText(Buffer.from(input.bytes).toString("base64"));
  const notes = score?.notes ?? input.notes ?? [];
  return hashText(JSON.stringify({
    notes: sortedNotes(notes).map((note) => ({
      midi: note.midi, start: note.start, dur: note.dur, vel: note.vel,
      hand: note.hand ?? null, identitySource: note.identitySource ?? null,
    })),
    tempoBpm: score?.tempoBpm ?? input.tempoBpm ?? null,
    durationBeats: score?.durationBeats ?? input.durationBeats ?? null,
  }));
}

function uniqueCandidateId(base: string, used: Set<string>, counts: Map<string, number>): string {
  let next = counts.get(base) ?? 0;
  let id = next === 0 ? base : `${base}-${next + 1}`;
  while (used.has(id)) {
    next += 1;
    id = `${base}-${next + 1}`;
  }
  counts.set(base, next + 1);
  used.add(id);
  return id;
}

function referenceMetrics(reference: NormalizedSymbolicScore | null, candidate: NormalizedSymbolicScore, options?: SymbolicAlignmentOptions): PianoReferenceMetrics | null {
  if (!reference) return null;
  const aligned = alignPianoCandidatesWithDrift(reference, candidate, options ? {
    onsetToleranceBeats: options.onsetToleranceBeats,
    beatScales: options.beatScales,
    transpositions: options.transpositions,
    offsetBeats: options.offsetsBeats,
    maxOffsetBeats: options.maxOffsetBeats,
    windows: options.windows?.map((window) => ({ id: window.id, reference: window.reference, candidate: window.candidate })),
    minMatchedOnsets: options.minMatchedOnsets,
  } : undefined);
  const referenceGroups = onsetGroups(reference.notes);
  const candidateGroups = onsetGroups(candidate.notes);
  const matched = aligned.matches;
  const exactCount = matched.filter((match) => match.exactPitch).length;
  const pitchClassCount = matched.filter((match) => {
    const referenceGroup = referenceGroups.find((group) => Math.abs(group[0]!.start - match.referenceBeat) <= ONSET_TOLERANCE + EPS);
    const referenceClasses = new Set(referenceGroup?.map((note) => ((note.midi % 12) + 12) % 12));
    return match.transposedCandidateMidis.some((midi) => referenceClasses.has(((midi % 12) + 12) % 12));
  }).length;
  const f1 = (count: number, predicted: number, actual: number): { precision: number | null; recall: number | null; f1: number | null } => {
    const precision = predicted ? count / predicted : null;
    const recall = actual ? count / actual : null;
    return { precision, recall, f1: precision !== null && recall !== null && precision + recall > EPS ? (2 * precision * recall) / (precision + recall) : null };
  };
  const exact = f1(exactCount, candidateGroups.length, referenceGroups.length);
  const pitchClass = f1(pitchClassCount, candidateGroups.length, referenceGroups.length);
  const onset = f1(matched.length, candidateGroups.length, referenceGroups.length);
  const errors = matched.map((match) => match.onsetErrorBeats).sort((a, b) => a - b);
  const referencePitches = referenceGroups.map((group) => Math.max(...group.map((note) => note.midi)));
  const candidatePitches = candidateGroups.map((group) => Math.max(...group.map((note) => note.midi + aligned.transpositionSemitones)));
  const intervals = matched.slice(1).map((_match, index) => ({
    reference: Math.sign(referencePitches[index + 1]! - referencePitches[index]!),
    candidate: Math.sign(candidatePitches[index + 1]! - candidatePitches[index]!),
  }));
  const directionAgreement = intervals.length ? intervals.filter((pair) => pair.reference === pair.candidate).length / intervals.length : null;
  const status = aligned.status === "rejected" ? "mismatch" : aligned.status;
  return {
    status,
    offsetBeats: aligned.offsetBeats,
    beatScale: aligned.beatScale,
    transpositionSemitones: aligned.transpositionSemitones,
    confidence: aligned.confidence,
    coverage: {
      referenceRatio: aligned.coverage.referenceRatio,
      candidateRatio: aligned.coverage.candidateRatio,
    },
    metrics: {
      exactPitch: { precision: exact.precision === null ? null : round(exact.precision), recall: exact.recall === null ? null : round(exact.recall), f1: exact.f1 === null ? null : round(exact.f1) },
      pitchClass: { precision: pitchClass.precision === null ? null : round(pitchClass.precision), recall: pitchClass.recall === null ? null : round(pitchClass.recall), f1: pitchClass.f1 === null ? null : round(pitchClass.f1) },
      onset: { precision: onset.precision === null ? null : round(onset.precision), recall: onset.recall === null ? null : round(onset.recall), f1: onset.f1 === null ? null : round(onset.f1), matched: matched.length },
      chroma: { cosine: null },
      contour: { directionAgreement: directionAgreement === null ? null : round(directionAgreement), matchedIntervals: intervals.length },
      density: { referenceOnsets: referenceGroups.length, candidateOnsets: candidateGroups.length, ratio: referenceGroups.length ? round(candidateGroups.length / referenceGroups.length) : null },
    },
    diagnostics: aligned.diagnostics,
  };
}

function emptyUnavailable(input: PianoCandidateInput, id: string, diagnostics: string[]): PianoCandidateEvaluation {
  const reasons = [...diagnostics];
  if (input.mediaAvailable === false) reasons.push("media unavailable");
  if (input.backendAvailable === false) reasons.push("backend unavailable");
  if (input.unavailableReason) reasons.push(input.unavailableReason);
  if (!reasons.length) reasons.push("symbolic notes unavailable");
  return {
    id,
    ...(input.label ? { label: input.label } : {}),
    status: "unavailable",
    purity: purity(input, []),
    metrics: null,
    reference: null,
    rankScore: null,
    diagnostics: [...new Set(reasons)].sort(),
  };
}

export function evaluatePianoCandidates(input: PianoEvaluationInput): PianoEvaluationReport {
  const referenceParsedResult = input.reference ? inputScore(input.reference, "reference") : null;
  const referenceParsed = referenceParsedResult?.score ?? null;
  const referenceStatus: PianoEvaluationReport["referenceStatus"] = !input.reference
    ? "not-requested"
    : input.reference.mediaAvailable === false
      ? "missing"
      : referenceParsed
        ? "available"
        : "invalid";
  const referenceDiagnostics = referenceParsedResult?.diagnostics.length ? [...new Set(referenceParsedResult.diagnostics)].sort() : undefined;
  const records = input.candidates.map((candidate, index) => {
    const parsed = inputScore(candidate);
    const baseId = baseCandidateId(candidate, index);
    const notes = parsed.score?.notes ?? [];
    let evaluation: PianoCandidateEvaluation;
    if (!parsed.score || candidate.mediaAvailable === false || candidate.backendAvailable === false) {
      evaluation = emptyUnavailable(candidate, baseId, parsed.diagnostics);
    } else {
      const metrics = structuralMetrics(notes, parsed.score.tempoBpm, parsed.score.durationBeats);
      evaluation = {
        id: baseId,
        ...(candidate.label ? { label: candidate.label } : {}),
        status: "available",
        purity: purity(candidate, notes),
        metrics,
        reference: referenceMetrics(referenceParsed, parsed.score, input.alignment),
        rankScore: null,
        diagnostics: [...parsed.score.warnings, ...parsed.diagnostics].sort(),
        notes,
        tempoBpm: parsed.score.tempoBpm,
        timeSig: parsed.score.timeSig,
        durationBeats: parsed.score.durationBeats,
      };
      const score = candidateScore(evaluation);
      evaluation.rankScore = score.score;
    }
    return { evaluation, baseId, sortKey: candidateSortKey(candidate, parsed.score) };
  }).sort((a, b) => a.baseId.localeCompare(b.baseId) || a.sortKey.localeCompare(b.sortKey));
  const usedIds = new Set<string>();
  const idCounts = new Map<string, number>();
  const results = records.map(({ evaluation, baseId }) => ({ ...evaluation, id: uniqueCandidateId(baseId, usedIds, idCounts) }));
  const ranking = results.map((result) => {
    const score = candidateScore(result);
    return { id: result.id, score: score.score, reasons: score.reasons };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id)).map((entry, index) => ({ ...entry, rank: index + 1 }));
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    candidates: results,
    ranking,
    referenceStatus,
    ...(referenceDiagnostics ? { referenceDiagnostics } : {}),
    disclaimer: "Ranking summarizes symbolic and metadata evidence only; it does not claim recognizability or musical correctness.",
  };
  const canonical = canonicalPianoEvaluationJson(reportWithoutHash as PianoEvaluationReport);
  return { ...reportWithoutHash, determinism: { canonicalSha256: hashText(canonical) } };
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redact(value: unknown, key?: string): unknown {
  if (key && /(?:^|)(?:path|dir|file)$/i.test(key)) return undefined;
  if (key === "notes" || key === "bytes") return undefined;
  if (typeof value === "string") {
    return redactEmbeddedPaths(value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort()) {
      const item = redact((value as Record<string, unknown>)[objectKey], objectKey);
      if (item !== undefined) result[objectKey] = item;
    }
    return result;
  }
  return value;
}

/** Redact paths wherever they occur, including inside parser/IO diagnostics. */
function redactEmbeddedPaths(value: string): string {
  return value
    .replace(/file:\/\/(?:Users|private|tmp|var|home)\/[^\s"']+/gi, "[redacted-path]")
    .replace(/(?:\/(?:Users|private|tmp|var|home)\/|[A-Za-z]:[\\/])[^\s"']+/g, "[redacted-path]")
    .replace(/(^|\s)(\.\.?\/|[^\s/]+\/)[^\s"']+\.(?:mid|midi|json|wav|mp3)(?=$|[\s"'])/gi, "$1[redacted-path]");
}

export function canonicalPianoEvaluationJson(report: PianoEvaluationReport | object): string {
  return JSON.stringify(redact(report));
}

function alignedPreviewNotes(evaluation: PianoCandidateEvaluation): Note[] {
  const notes = evaluation.notes ?? [];
  const reference = evaluation.reference;
  if (!reference || reference.offsetBeats === null || reference.beatScale === null) return notes.map((note) => ({ ...note }));
  const scale = reference.beatScale || 1;
  return notes.map((note) => ({
    ...note,
    start: Math.max(0, (note.start - reference.offsetBeats!) / scale),
    dur: note.dur / scale,
    midi: Math.max(0, Math.min(127, note.midi + (reference.transpositionSemitones ?? 0))),
  }));
}

function parsedForPreview(evaluation: PianoCandidateEvaluation, notes: Note[]): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: evaluation.tempoBpm ?? 120,
    keySig: 0,
    keyMode: 0,
    timeSig: evaluation.timeSig ?? [4, 4],
    notes,
    trackNames: ["Piano"],
    durationBeats: evaluation.durationBeats ?? extent(notes),
  };
}

function previewMidi(notes: Note[], evaluation: PianoCandidateEvaluation, title: string): Uint8Array {
  return writeMidi(notes, {
    tempoBpm: evaluation.tempoBpm ?? 120,
    timeSig: evaluation.timeSig ?? [4, 4],
    title,
    tracks: [
      { name: "Right Hand", notes: notes.filter((note) => note.hand !== "L") },
      { name: "Left Hand", notes: notes.filter((note) => note.hand === "L") },
    ],
  });
}

/** Write local-only previews. This function has no database or publish path. */
export async function writePianoPreviews(evaluation: PianoCandidateEvaluation, outputDir: string): Promise<PianoPreviewWriteResult> {
  if (evaluation.status !== "available" || !evaluation.notes?.length) throw new Error("cannot preview unavailable piano candidate");
  const folder = join(outputDir, baseCandidateId({ id: evaluation.id }, 0));
  await mkdir(folder, { recursive: true });
  const raw = evaluation.notes.map((note) => ({ ...note }));
  const aligned = alignedPreviewNotes(evaluation);
  let easy = aligned;
  let medium = aligned;
  try {
    const variants = buildVariants(parsedForPreview(evaluation, aligned), { title: evaluation.label ?? evaluation.id, artist: "preview", tempo: evaluation.tempoBpm }, { arrangementProfile: "learner", maxDurBeats: null });
    easy = variants.find((variant) => variant.level === "easy")?.notes ?? easy;
    medium = variants.find((variant) => variant.level === "medium")?.notes ?? medium;
  } catch {
    // Preview generation is best-effort; raw and aligned remain available.
  }
  const files = {
    raw: join(folder, "raw.mid"),
    aligned: join(folder, "aligned.mid"),
    easy: join(folder, "Easy.mid"),
    medium: join(folder, "Medium.mid"),
  };
  await Promise.all([
    writeFile(files.raw, previewMidi(raw, evaluation, `${evaluation.id} (raw)`)),
    writeFile(files.aligned, previewMidi(aligned, evaluation, `${evaluation.id} (aligned)`)),
    writeFile(files.easy, previewMidi(easy, evaluation, `${evaluation.id} (Easy)`)),
    writeFile(files.medium, previewMidi(medium, evaluation, `${evaluation.id} (Medium)`)),
  ]);
  return {
    files,
    toJSON: () => ({ files: { raw: "[local]", aligned: "[local]", easy: "[local]", medium: "[local]" } }),
  };
}
