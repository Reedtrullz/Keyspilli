import { createHash } from "node:crypto";
import type { Note, PianoHarmonyQuality } from "@keyspilli/midi";

/** Evidence states are deliberately distinct: absent evidence is not a failed check. */
export type HarmonyAvailability = "available" | "unavailable" | "malformed";
export type HarmonyQuality = PianoHarmonyQuality;

export interface HarmonyChange {
  beat: number;
  rootPc?: number | null;
  bassPc?: number | null;
  quality?: HarmonyQuality | null;
}

export interface HarmonyReferenceEvidence {
  /** A normalized (or unnormalized) 12-bin pitch-class vector. */
  chroma?: readonly number[] | readonly (readonly number[])[];
  rootPc?: number | null;
  bassPc?: number | null;
  quality?: HarmonyQuality | null;
  changes?: readonly HarmonyChange[];
}

export interface HarmonyCandidateEvidence {
  /** Candidate accompaniment only; melody notes are intentionally out of scope. */
  leftHandNotes?: readonly Note[];
  /** Alias accepted for callers that already pass a role-filtered lane. */
  notes?: readonly Note[];
  /** Optional semantic events from the accompaniment inference pass. */
  harmony?: readonly HarmonyChange[];
}

export interface HarmonyEvaluationWindowInput {
  id: string;
  startBeat: number;
  endBeat: number;
  reference?: HarmonyReferenceEvidence;
  candidate?: HarmonyCandidateEvidence;
}

export interface HarmonyGateThresholds {
  minimumChromaAgreement: number;
  minimumRootAgreement: number;
  minimumBassAgreement: number;
  minimumQualityAgreement: number;
  maximumChangeTimingErrorBeats: number;
  maximumUnsupportedChangeRate: number;
  maximumLowRegisterMudRate: number;
  maximumNotesPerAttack: number;
  maximumJumpRate: number;
}

export const DEFAULT_HARMONY_GATE_THRESHOLDS: HarmonyGateThresholds = {
  minimumChromaAgreement: 0.7,
  minimumRootAgreement: 0.75,
  minimumBassAgreement: 0.75,
  minimumQualityAgreement: 0.7,
  maximumChangeTimingErrorBeats: 0.5,
  maximumUnsupportedChangeRate: 0.25,
  maximumLowRegisterMudRate: 0.25,
  maximumNotesPerAttack: 4,
  maximumJumpRate: 0.25,
};

export interface HarmonyGateOptions {
  enabled?: boolean;
  thresholds?: Partial<HarmonyGateThresholds>;
}

export interface HarmonyGateResult {
  enabled: boolean;
  status: "disabled" | "pass" | "fail" | "null";
  failures: string[];
  diagnostics: string[];
  thresholds: HarmonyGateThresholds;
}

export interface HarmonyAvailabilitySummary {
  overall: HarmonyAvailability;
  chroma: HarmonyAvailability;
  rootBass: HarmonyAvailability;
  quality: HarmonyAvailability;
  timing: HarmonyAvailability;
  accompaniment: HarmonyAvailability;
}

export interface HarmonyChangeTimingMetrics {
  expected: number;
  observed: number;
  matched: number;
  unsupported: number;
  medianErrorBeats: number | null;
  p95ErrorBeats: number | null;
}

export interface HarmonyLeftHandMetrics {
  attacks: number;
  noteCount: number;
  averageNotesPerAttack: number | null;
  /** Short alias retained for compact report consumers. */
  notesPerAttack: number | null;
  maxNotesPerAttack: number | null;
  attackRatePerBeat: number | null;
}

export interface HarmonyPlayabilityMetrics {
  lowRegisterBoundary: number;
  lowRegisterMudRate: number | null;
  lowRegisterCloseIntervalCount: number | null;
  lowRegisterCloseIntervalRate: number | null;
  octaveDuplicationCount: number | null;
  fifthDuplicationCount: number | null;
  octaveFifthDuplicationRate: number | null;
  maxSpanSemitones: number | null;
  meanSpanSemitones: number | null;
  maxJumpSemitones: number | null;
  jumpRate: number | null;
  repeatedWallRate: number | null;
}

export interface HarmonyJitterMetrics {
  rootCount: number | null;
  qualityCount: number | null;
  rootRate: number | null;
  qualityRate: number | null;
}

export interface HarmonyUnsupportedChangeMetrics {
  count: number | null;
  rate: number | null;
}

export interface HarmonyWindowMetrics {
  chromaAgreement: number | null;
  rootAgreement: number | null;
  bassAgreement: number | null;
  chordAgreement: number | null;
  qualityAgreement: number | null;
  changeTiming: HarmonyChangeTimingMetrics;
  leftHand: HarmonyLeftHandMetrics;
  playability: HarmonyPlayabilityMetrics;
  jitter: HarmonyJitterMetrics;
  unsupportedChanges: HarmonyUnsupportedChangeMetrics;
  availability: HarmonyAvailabilitySummary;
}

export interface HarmonyWindowEvaluation {
  id: string;
  startBeat: number;
  endBeat: number;
  status: HarmonyAvailability;
  diagnostics: string[];
  metrics: HarmonyWindowMetrics;
}

export interface HarmonyEvaluationInput {
  windows: readonly HarmonyEvaluationWindowInput[];
  /** Optional opt-in gate configuration; omission preserves disabled behavior. */
  gate?: HarmonyGateOptions;
}

export interface HarmonyEvaluationReport {
  schemaVersion: 1;
  status: HarmonyAvailability;
  windows: HarmonyWindowEvaluation[];
  metrics: HarmonyWindowMetrics;
  diagnostics: string[];
  gate: HarmonyGateResult;
  determinism: { canonical: string; canonicalSha256: string };
}

const EPS = 1e-7;
const ONSET_TOLERANCE = 0.08;
const CHANGE_TOLERANCE = 0.5;
const LOW_BOUNDARY = 52;
const MUD_MAX_NOTES = 3;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pc(value: number): number {
  return ((value % 12) + 12) % 12;
}

function sortedNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || (a.hand ?? "").localeCompare(b.hand ?? ""));
}

function validNote(value: unknown): value is Note {
  if (!isRecord(value)) return false;
  const note = value as unknown as Note;
  return Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && finite(note.start) && note.start >= 0 && finite(note.dur) && note.dur > 0
    && finite(note.vel) && note.vel >= 0 && note.vel <= 127;
}

function validPc(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 12;
}

function quality(value: unknown): value is HarmonyQuality {
  return value === "power" || value === "major" || value === "minor" || value === "sus2"
    || value === "sus4" || value === "single" || value === "unknown";
}

function compareHarmonyChanges(left: HarmonyChange, right: HarmonyChange): number {
  return left.beat - right.beat
    || (left.rootPc ?? -1) - (right.rootPc ?? -1)
    || (left.bassPc ?? -1) - (right.bassPc ?? -1)
    || String(left.quality ?? "").localeCompare(String(right.quality ?? ""));
}

function validateChanges(changes: unknown, label: string, diagnostics: string[]): HarmonyChange[] | undefined {
  if (changes === undefined) return undefined;
  if (!Array.isArray(changes)) {
    diagnostics.push(`${label} changes must be an array`);
    return undefined;
  }
  const valid: HarmonyChange[] = [];
  for (const [index, raw] of changes.entries()) {
    if (!isRecord(raw)) {
      diagnostics.push(`${label} changes[${index}] is malformed`);
      continue;
    }
    const item = raw as unknown as HarmonyChange;
    if (!finite(item.beat) || item.beat < 0) diagnostics.push(`${label} changes[${index}].beat is invalid`);
    if (item.rootPc !== undefined && item.rootPc !== null && !validPc(item.rootPc)) diagnostics.push(`${label} changes[${index}].rootPc is invalid`);
    if (item.bassPc !== undefined && item.bassPc !== null && !validPc(item.bassPc)) diagnostics.push(`${label} changes[${index}].bassPc is invalid`);
    if (item.quality !== undefined && item.quality !== null && !quality(item.quality)) diagnostics.push(`${label} changes[${index}].quality is invalid`);
    if (finite(item.beat) && item.beat >= 0 && (item.rootPc === undefined || item.rootPc === null || validPc(item.rootPc))
      && (item.bassPc === undefined || item.bassPc === null || validPc(item.bassPc))
      && (item.quality === undefined || item.quality === null || quality(item.quality))) valid.push({ ...item });
  }
  return valid.sort(compareHarmonyChanges);
}

function validateChroma(value: unknown, label: string, diagnostics: string[]): number[] | undefined {
  if (value === undefined) return undefined;
  const rows = Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);
  const valid = rows
    ? Array.isArray(value) && value.every((row) => Array.isArray(row) && row.length === 12 && row.every((item) => finite(item) && item >= 0))
    : Array.isArray(value) && value.length === 12 && value.every((item) => finite(item) && item >= 0);
  if (!valid) {
    diagnostics.push(`${label} chroma must be 12 finite non-negative weights`);
    return undefined;
  }
  if (!rows) return (value as readonly number[]).map((item) => item as number);
  const values = value as readonly (readonly number[])[];
  return Array.from({ length: 12 }, (_, index) => values.reduce((sum, row) => sum + row[index]!, 0) / values.length);
}

function validateWindow(window: unknown, index: number): { value?: HarmonyEvaluationWindowInput; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!isRecord(window)) return { diagnostics: [`window ${index} is malformed`] };
  const value = window as unknown as HarmonyEvaluationWindowInput;
  let normalized: HarmonyEvaluationWindowInput = { ...value };
  if (typeof value.id !== "string" || !value.id.trim()) diagnostics.push(`window ${index} id is invalid`);
  if (!finite(value.startBeat) || !finite(value.endBeat) || value.startBeat < 0 || value.endBeat <= value.startBeat) diagnostics.push(`window ${index} bounds are invalid`);
  const reference = value.reference;
  if (reference !== undefined) {
    if (!isRecord(reference)) diagnostics.push(`window ${index} reference is malformed`);
    else {
      if (reference.rootPc !== undefined && reference.rootPc !== null && !validPc(reference.rootPc)) diagnostics.push(`window ${index} reference rootPc is invalid`);
      if (reference.bassPc !== undefined && reference.bassPc !== null && !validPc(reference.bassPc)) diagnostics.push(`window ${index} reference bassPc is invalid`);
      if (reference.quality !== undefined && reference.quality !== null && !quality(reference.quality)) diagnostics.push(`window ${index} reference quality is invalid`);
      const chroma = validateChroma(reference.chroma, `window ${index} reference`, diagnostics);
      const changes = validateChanges(reference.changes, `window ${index} reference`, diagnostics);
      if (chroma !== undefined || changes !== undefined) normalized.reference = { ...reference, ...(chroma ? { chroma } : {}), ...(changes ? { changes } : {}) };
    }
  }
  const candidate = value.candidate;
  if (candidate !== undefined) {
    if (!isRecord(candidate)) diagnostics.push(`window ${index} candidate is malformed`);
    else {
      const notes = candidate.leftHandNotes ?? candidate.notes;
      if (notes !== undefined && (!Array.isArray(notes) || notes.some((item) => !validNote(item)))) diagnostics.push(`window ${index} candidate left-hand notes are malformed`);
      const changes = validateChanges(candidate.harmony, `window ${index} candidate`, diagnostics);
      if (changes !== undefined) normalized.candidate = { ...candidate, harmony: changes };
    }
  }
  return { value: diagnostics.length ? undefined : normalized, diagnostics };
}

function groups(notes: readonly Note[]): Note[][] {
  const result: Note[][] = [];
  for (const note of sortedNotes(notes)) {
    const previous = result.at(-1);
    if (previous && note.start - previous[0]!.start <= ONSET_TOLERANCE + EPS) previous.push(note);
    else result.push([note]);
  }
  return result;
}

function vectorFor(notes: readonly Note[]): number[] {
  const values = Array.from({ length: 12 }, () => 0);
  for (const note of notes) values[pc(note.midi)]! += note.dur;
  return values;
}

function chromaVector(value: readonly number[] | readonly (readonly number[])[] | undefined): readonly number[] | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (!Array.isArray(value[0])) return value as readonly number[];
  const rows = value as readonly (readonly number[])[];
  return Array.from({ length: 12 }, (_, index) => rows.reduce((sum, row) => sum + (row[index] ?? 0), 0) / rows.length);
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (leftMagnitude <= EPS || rightMagnitude <= EPS) return null;
  return round(left.reduce((sum, value, index) => sum + value * right[index]!, 0) / (leftMagnitude * rightMagnitude));
}

function inferChanges(notes: readonly Note[], startBeat: number): HarmonyChange[] {
  return groups(notes).map((attack) => {
    const lowest = attack.reduce((low, note) => Math.min(low, note.midi), 127);
    const pitchClasses = new Set(attack.map((note) => pc(note.midi)));
    const root = pc(lowest);
    const intervals = new Set([...pitchClasses].map((item) => pc(item - root)));
    let inferredQuality: HarmonyQuality = "single";
    if (intervals.has(4) && intervals.has(7)) inferredQuality = "major";
    else if (intervals.has(3) && intervals.has(7)) inferredQuality = "minor";
    else if (intervals.has(7)) inferredQuality = "power";
    return { beat: Math.max(startBeat, attack[0]!.start), rootPc: root, bassPc: root, quality: inferredQuality };
  });
}

function agreement(events: readonly HarmonyChange[], expected: number | HarmonyQuality | null | undefined, field: "rootPc" | "bassPc" | "quality"): number | null {
  if (expected === undefined || expected === null) return null;
  if (!events.length) return null;
  const supported = events.filter((event) => event[field] !== undefined && event[field] !== null);
  return supported.length ? round(supported.filter((event) => event[field] === expected).length / supported.length) : null;
}

function changeValueEqual(left: HarmonyChange, right: HarmonyChange): boolean {
  const comparable = ["rootPc", "bassPc", "quality"] as const;
  const fields = comparable.filter((field) => left[field] !== undefined && left[field] !== null && right[field] !== undefined && right[field] !== null);
  return fields.length > 0 && fields.every((field) => left[field] === right[field]);
}

function changeTiming(expected: readonly HarmonyChange[] | undefined, observed: readonly HarmonyChange[]): HarmonyChangeTimingMetrics {
  if (expected === undefined || observed.length === 0 && expected.length === 0) return { expected: expected?.length ?? 0, observed: observed.length, matched: 0, unsupported: observed.length, medianErrorBeats: null, p95ErrorBeats: null };
  const errors: number[] = [];
  const used = new Set<number>();
  let matched = 0;
  for (const source of expected) {
    let best = -1;
    let bestDistance = Infinity;
    observed.forEach((candidate, index) => {
      if (used.has(index)) return;
      const distance = Math.abs(candidate.beat - source.beat);
      // Compatibility is part of the match, rather than a check after
      // nearest-neighbor selection. Otherwise an incompatible event can sit
      // between a source event and the nearest compatible candidate and make
      // a valid pair look unsupported.
      if (distance > CHANGE_TOLERANCE || !changeValueEqual(source, candidate)) return;
      if (distance < bestDistance
        || (Math.abs(distance - bestDistance) <= EPS && best >= 0 && compareHarmonyChanges(candidate, observed[best]!) < 0)) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best >= 0) {
      used.add(best); matched++; errors.push(bestDistance);
    }
  }
  const sorted = [...errors].sort((a, b) => a - b);
  const quantile = (p: number): number | null => sorted.length ? round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!) : null;
  return { expected: expected.length, observed: observed.length, matched, unsupported: observed.length - matched, medianErrorBeats: quantile(0.5), p95ErrorBeats: quantile(0.95) };
}

function jitter(events: readonly HarmonyChange[], field: "rootPc" | "quality"): { count: number; rate: number } | null {
  const values: Array<number | string> = events.map((event) => event[field]).filter((value) => value !== undefined && value !== null && value !== "unknown") as Array<number | string>;
  if (values.length < 3) return null;
  let count = 0;
  for (let index = 2; index < values.length; index++) if (values[index] === values[index - 2] && values[index] !== values[index - 1]) count++;
  return { count, rate: round(count / Math.max(1, values.length - 2)) };
}

function playability(notes: readonly Note[]): HarmonyPlayabilityMetrics {
  if (!notes.length) return { lowRegisterBoundary: LOW_BOUNDARY, lowRegisterMudRate: 0, lowRegisterCloseIntervalCount: 0, lowRegisterCloseIntervalRate: 0, octaveDuplicationCount: 0, fifthDuplicationCount: 0, octaveFifthDuplicationRate: 0, maxSpanSemitones: null, meanSpanSemitones: null, maxJumpSemitones: null, jumpRate: 0, repeatedWallRate: 0 };
  const attackGroups = groups(notes);
  const spans = attackGroups.map((attack) => Math.max(...attack.map((note) => note.midi)) - Math.min(...attack.map((note) => note.midi)));
  let mud = 0;
  let closeIntervals = 0;
  let octave = 0;
  let fifth = 0;
  let duplicatedAttacks = 0;
  for (const attack of attackGroups) {
    const low = attack.filter((note) => note.midi <= LOW_BOUNDARY).map((note) => note.midi).sort((a, b) => a - b);
    if (low.length > MUD_MAX_NOTES) mud++;
    let duplicated = false;
    for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) {
      const interval = Math.abs(low[j]! - low[i]!);
      if (interval <= 3) closeIntervals++;
      if (interval === 12) { octave++; duplicated = true; }
      const firstLow = low[i]!;
      if (interval === 7 && low.filter((pitch) => pitch === firstLow || pitch === firstLow + 7).length > 2) { fifth++; duplicated = true; }
    }
    if (duplicated) duplicatedAttacks++;
  }
  const basses = attackGroups.map((attack) => Math.min(...attack.map((note) => note.midi)));
  // Use the more mobile register of each attack for jump detection.  A bass
  // line can remain fixed while an accidentally high LH tone leaps by an
  // octave; that is still a playability defect worth reporting.
  const tops = attackGroups.map((attack) => Math.max(...attack.map((note) => note.midi)));
  const jumps = tops.slice(1).map((value, index) => Math.max(Math.abs(value - tops[index]!), Math.abs(basses[index + 1]! - basses[index]!)));
  const wallThreshold = 8;
  const counts = new Map<number, number>();
  basses.forEach((bass) => counts.set(bass, (counts.get(bass) ?? 0) + 1));
  const wallCount = [...counts.values()].filter((count) => count >= wallThreshold).reduce((sum, count) => sum + count, 0);
  return {
    lowRegisterBoundary: LOW_BOUNDARY,
    lowRegisterMudRate: round(mud / attackGroups.length),
    lowRegisterCloseIntervalCount: closeIntervals,
    lowRegisterCloseIntervalRate: round(closeIntervals / Math.max(1, attackGroups.length)),
    octaveDuplicationCount: octave,
    fifthDuplicationCount: fifth,
    octaveFifthDuplicationRate: round(duplicatedAttacks / attackGroups.length),
    maxSpanSemitones: Math.max(...spans),
    meanSpanSemitones: round(spans.reduce((sum, value) => sum + value, 0) / spans.length),
    maxJumpSemitones: jumps.length ? Math.max(...jumps) : 0,
    jumpRate: jumps.length ? round(jumps.filter((jump) => jump > 12).length / jumps.length) : 0,
    repeatedWallRate: round(wallCount / attackGroups.length),
  };
}

function unavailableMetrics(status: HarmonyAvailability, diagnostics: string[] = []): HarmonyWindowMetrics {
  return {
    chromaAgreement: null, rootAgreement: null, bassAgreement: null, chordAgreement: null, qualityAgreement: null,
    changeTiming: { expected: 0, observed: 0, matched: 0, unsupported: 0, medianErrorBeats: null, p95ErrorBeats: null },
    leftHand: { attacks: 0, noteCount: 0, averageNotesPerAttack: null, notesPerAttack: null, maxNotesPerAttack: null, attackRatePerBeat: null },
    playability: { lowRegisterBoundary: LOW_BOUNDARY, lowRegisterMudRate: null, lowRegisterCloseIntervalCount: null, lowRegisterCloseIntervalRate: null, octaveDuplicationCount: null, fifthDuplicationCount: null, octaveFifthDuplicationRate: null, maxSpanSemitones: null, meanSpanSemitones: null, maxJumpSemitones: null, jumpRate: null, repeatedWallRate: null },
    jitter: { rootCount: null, qualityCount: null, rootRate: null, qualityRate: null },
    unsupportedChanges: { count: null, rate: null },
    availability: { overall: status, chroma: status, rootBass: status, quality: status, timing: status, accompaniment: status },
  };
}

function hasReferenceEvidence(reference: HarmonyReferenceEvidence | undefined): boolean {
  return reference !== undefined && (
    (reference.chroma !== undefined && reference.chroma.length > 0)
    || (reference.rootPc !== undefined && reference.rootPc !== null)
    || (reference.bassPc !== undefined && reference.bassPc !== null)
    || (reference.quality !== undefined && reference.quality !== null)
    || (reference.changes !== undefined && reference.changes.length > 0)
  );
}

function evaluateWindow(input: HarmonyEvaluationWindowInput): HarmonyWindowEvaluation {
  const diagnostics: string[] = [];
  const reference = input.reference;
  const candidate = input.candidate;
  const notes = candidate?.leftHandNotes ?? candidate?.notes;
  const candidateNotes = notes ? sortedNotes(notes).filter((note) => note.start >= input.startBeat && note.start < input.endBeat) : [];
  const candidateChanges = candidate?.harmony !== undefined
    ? [...candidate.harmony].filter((change) => change.beat >= input.startBeat && change.beat < input.endBeat)
    : (candidateNotes.length ? inferChanges(candidateNotes, input.startBeat) : []);
  const expectedChanges = reference?.changes ?? ((reference?.rootPc !== undefined || reference?.quality !== undefined) ? [{ beat: input.startBeat, rootPc: reference.rootPc, bassPc: reference.bassPc, quality: reference.quality }] : undefined);
  const referenceChroma = chromaVector(reference?.chroma);
  const chromaAgreement = referenceChroma && candidateNotes.length ? cosine(vectorFor(candidateNotes), referenceChroma) : null;
  const rootAgreement = agreement(candidateChanges, reference?.rootPc, "rootPc");
  const bassAgreement = agreement(candidateChanges, reference?.bassPc, "bassPc");
  const qualityAgreement = agreement(candidateChanges, reference?.quality, "quality");
  const chordAgreement = rootAgreement === null && qualityAgreement === null ? null : round(((rootAgreement ?? 0) + (qualityAgreement ?? 0)) / ((rootAgreement === null ? 0 : 1) + (qualityAgreement === null ? 0 : 1)));
  const timing = changeTiming(expectedChanges, candidateChanges);
  const leftHandGroups = groups(candidateNotes);
  const candidateAvailable = candidate !== undefined && notes !== undefined && candidateNotes.length > 0;
  const play = candidateAvailable ? playability(candidateNotes) : unavailableMetrics("unavailable").playability;
  const rootJitter = jitter(candidateChanges, "rootPc");
  const qualityJitter = jitter(candidateChanges, "quality");
  const expectedAvailable = expectedChanges !== undefined && expectedChanges.length > 0;
  const referenceAvailable = hasReferenceEvidence(reference);
  const status: HarmonyAvailability = diagnostics.length ? "malformed" : (referenceAvailable && candidateAvailable ? "available" : "unavailable");
  const chromaStatus: HarmonyAvailability = diagnostics.some((item) => item.includes("chroma")) ? "malformed" : (reference?.chroma !== undefined && chromaAgreement !== null ? "available" : "unavailable");
  const rootStatus: HarmonyAvailability = diagnostics.some((item) => item.includes("rootPc") || item.includes("bassPc")) ? "malformed" : (reference && (reference.rootPc !== undefined && reference.rootPc !== null || reference.bassPc !== undefined && reference.bassPc !== null) && candidateChanges.length ? "available" : "unavailable");
  const qualityStatus: HarmonyAvailability = diagnostics.some((item) => item.includes("quality")) ? "malformed" : (reference?.quality !== undefined && reference.quality !== null && candidateChanges.length ? "available" : "unavailable");
  const timingStatus: HarmonyAvailability = diagnostics.some((item) => item.includes("changes")) ? "malformed" : (expectedAvailable && candidateChanges.length > 0 && candidateAvailable ? "available" : "unavailable");
  const accompanimentStatus: HarmonyAvailability = candidateAvailable ? "available" : "unavailable";
  const availability: HarmonyAvailabilitySummary = { overall: status, chroma: chromaStatus, rootBass: rootStatus, quality: qualityStatus, timing: timingStatus, accompaniment: accompanimentStatus };
  return {
    id: input.id, startBeat: input.startBeat, endBeat: input.endBeat, status, diagnostics,
    metrics: {
      chromaAgreement, rootAgreement, bassAgreement, chordAgreement, qualityAgreement, changeTiming: timing,
      leftHand: candidateAvailable
        ? { attacks: leftHandGroups.length, noteCount: candidateNotes.length, averageNotesPerAttack: leftHandGroups.length ? round(candidateNotes.length / leftHandGroups.length) : null, notesPerAttack: leftHandGroups.length ? round(candidateNotes.length / leftHandGroups.length) : null, maxNotesPerAttack: leftHandGroups.length ? Math.max(...leftHandGroups.map((group) => group.length)) : null, attackRatePerBeat: input.endBeat > input.startBeat ? round(leftHandGroups.length / (input.endBeat - input.startBeat)) : null }
        : { attacks: 0, noteCount: 0, averageNotesPerAttack: null, notesPerAttack: null, maxNotesPerAttack: null, attackRatePerBeat: null },
      playability: play,
      jitter: { rootCount: rootJitter?.count ?? null, qualityCount: qualityJitter?.count ?? null, rootRate: rootJitter?.rate ?? null, qualityRate: qualityJitter?.rate ?? null },
      unsupportedChanges: { count: expectedAvailable ? timing.unsupported : null, rate: expectedAvailable && candidateChanges.length ? round(timing.unsupported / candidateChanges.length) : null },
      availability,
    },
  };
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length ? round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null;
}

function aggregate(windows: readonly HarmonyWindowEvaluation[]): HarmonyWindowMetrics {
  const metrics = windows.map((window) => window.metrics);
  const all = (selector: (metric: HarmonyWindowMetrics) => number | null): number | null => average(metrics.map(selector));
  const sum = (selector: (metric: HarmonyWindowMetrics) => number): number => metrics.reduce((total, metric) => total + selector(metric), 0);
  const statuses = (selector: (availability: HarmonyAvailabilitySummary) => HarmonyAvailability): HarmonyAvailability => {
    const values = metrics.map((metric) => selector(metric.availability));
    return values.includes("malformed") ? "malformed" : values.length > 0 && values.every((value) => value === "available") ? "available" : "unavailable";
  };
  const timingValues = metrics.map((metric) => metric.changeTiming);
  const leftHandNotes = sum((metric) => metric.leftHand.noteCount);
  const attacks = sum((metric) => metric.leftHand.attacks);
  const aggregateTiming: HarmonyChangeTimingMetrics = {
    expected: sum((metric) => metric.changeTiming.expected), observed: sum((metric) => metric.changeTiming.observed), matched: sum((metric) => metric.changeTiming.matched), unsupported: sum((metric) => metric.changeTiming.unsupported),
    medianErrorBeats: average(timingValues.map((timing) => timing.medianErrorBeats)), p95ErrorBeats: average(timingValues.map((timing) => timing.p95ErrorBeats)),
  };
  const status = windows.some((window) => window.status === "malformed") ? "malformed" : windows.length > 0 && windows.every((window) => window.status === "available") ? "available" : "unavailable";
  return {
    chromaAgreement: all((metric) => metric.chromaAgreement), rootAgreement: all((metric) => metric.rootAgreement), bassAgreement: all((metric) => metric.bassAgreement), chordAgreement: all((metric) => metric.chordAgreement), qualityAgreement: all((metric) => metric.qualityAgreement), changeTiming: aggregateTiming,
    leftHand: { attacks, noteCount: leftHandNotes, averageNotesPerAttack: attacks ? round(leftHandNotes / attacks) : null, notesPerAttack: attacks ? round(leftHandNotes / attacks) : null, maxNotesPerAttack: metrics.length ? Math.max(...metrics.map((metric) => metric.leftHand.maxNotesPerAttack ?? 0)) || null : null, attackRatePerBeat: all((metric) => metric.leftHand.attackRatePerBeat) },
    playability: { lowRegisterBoundary: LOW_BOUNDARY, lowRegisterMudRate: all((metric) => metric.playability.lowRegisterMudRate), lowRegisterCloseIntervalCount: metrics.some((metric) => metric.playability.lowRegisterCloseIntervalCount !== null) ? sum((metric) => metric.playability.lowRegisterCloseIntervalCount ?? 0) : null, lowRegisterCloseIntervalRate: all((metric) => metric.playability.lowRegisterCloseIntervalRate), octaveDuplicationCount: metrics.some((metric) => metric.playability.octaveDuplicationCount !== null) ? sum((metric) => metric.playability.octaveDuplicationCount ?? 0) : null, fifthDuplicationCount: metrics.some((metric) => metric.playability.fifthDuplicationCount !== null) ? sum((metric) => metric.playability.fifthDuplicationCount ?? 0) : null, octaveFifthDuplicationRate: all((metric) => metric.playability.octaveFifthDuplicationRate), maxSpanSemitones: all((metric) => metric.playability.maxSpanSemitones), meanSpanSemitones: all((metric) => metric.playability.meanSpanSemitones), maxJumpSemitones: all((metric) => metric.playability.maxJumpSemitones), jumpRate: all((metric) => metric.playability.jumpRate), repeatedWallRate: all((metric) => metric.playability.repeatedWallRate) },
    jitter: { rootCount: metrics.some((metric) => metric.jitter.rootCount !== null) ? sum((metric) => metric.jitter.rootCount ?? 0) : null, qualityCount: metrics.some((metric) => metric.jitter.qualityCount !== null) ? sum((metric) => metric.jitter.qualityCount ?? 0) : null, rootRate: all((metric) => metric.jitter.rootRate), qualityRate: all((metric) => metric.jitter.qualityRate) },
    unsupportedChanges: { count: metrics.some((metric) => metric.unsupportedChanges.count !== null) ? sum((metric) => metric.unsupportedChanges.count ?? 0) : null, rate: all((metric) => metric.unsupportedChanges.rate) },
    availability: { overall: status, chroma: statuses((availability) => availability.chroma), rootBass: statuses((availability) => availability.rootBass), quality: statuses((availability) => availability.quality), timing: statuses((availability) => availability.timing), accompaniment: statuses((availability) => availability.accompaniment) },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

export function harmonyGateThresholds(options: HarmonyGateOptions = {}): HarmonyGateThresholds {
  const values = { ...DEFAULT_HARMONY_GATE_THRESHOLDS, ...(options.thresholds ?? {}) };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, finite(value) && value >= 0 ? value : DEFAULT_HARMONY_GATE_THRESHOLDS[key as keyof HarmonyGateThresholds]])) as unknown as HarmonyGateThresholds;
}

export function evaluateHarmonyGate(report: Pick<HarmonyEvaluationReport, "status" | "metrics" | "diagnostics">, options: HarmonyGateOptions = {}): HarmonyGateResult {
  const thresholds = harmonyGateThresholds(options);
  if (options.enabled !== true) return { enabled: false, status: "disabled", failures: [], diagnostics: [], thresholds };
  const failures = report.status === "malformed" ? ["harmony evidence is malformed"] : [];
  const diagnostics = [...report.diagnostics];
  const metric = report.metrics;
  const availabilityValues = Object.values(metric.availability);
  if (availabilityValues.includes("malformed") && !failures.includes("harmony evidence is malformed")) failures.push("harmony evidence is malformed");
  if (report.status === "unavailable" || metric.availability.overall !== "available") {
    return { enabled: true, status: failures.length ? "fail" : "null", failures, diagnostics, thresholds };
  }
  if (metric.chromaAgreement !== null && metric.chromaAgreement < thresholds.minimumChromaAgreement) failures.push("chroma agreement below threshold");
  if (metric.rootAgreement !== null && metric.rootAgreement < thresholds.minimumRootAgreement) failures.push("root agreement below threshold");
  if (metric.bassAgreement !== null && metric.bassAgreement < thresholds.minimumBassAgreement) failures.push("bass agreement below threshold");
  if (metric.qualityAgreement !== null && metric.qualityAgreement < thresholds.minimumQualityAgreement) failures.push("quality agreement below threshold");
  if (metric.changeTiming.medianErrorBeats !== null && metric.changeTiming.medianErrorBeats > thresholds.maximumChangeTimingErrorBeats) failures.push("change timing error exceeds threshold");
  if (metric.unsupportedChanges.rate !== null && metric.unsupportedChanges.rate > thresholds.maximumUnsupportedChangeRate) failures.push("unsupported harmony changes exceed threshold");
  if (metric.playability.lowRegisterMudRate !== null && metric.playability.lowRegisterMudRate > thresholds.maximumLowRegisterMudRate) failures.push("low-register mud exceeds threshold");
  if (metric.leftHand.maxNotesPerAttack !== null && metric.leftHand.maxNotesPerAttack > thresholds.maximumNotesPerAttack) failures.push("left-hand notes per attack exceed threshold");
  if (metric.playability.jumpRate !== null && metric.playability.jumpRate > thresholds.maximumJumpRate) failures.push("left-hand jumps exceed threshold");
  const unavailableMetric = metric.changeTiming.observed === 0
    || [
      metric.chromaAgreement,
      metric.rootAgreement,
      metric.bassAgreement,
      metric.qualityAgreement,
      metric.changeTiming.medianErrorBeats,
      metric.unsupportedChanges.rate,
      metric.playability.lowRegisterMudRate,
      metric.leftHand.maxNotesPerAttack,
      metric.playability.jumpRate,
    ].some((value) => value === null);
  if (unavailableMetric) return { enabled: true, status: failures.length ? "fail" : "null", failures, diagnostics, thresholds };
  return { enabled: true, status: failures.length ? "fail" : "pass", failures, diagnostics, thresholds };
}

export function evaluateHarmony(input: HarmonyEvaluationInput, gateOptions: HarmonyGateOptions = {}): HarmonyEvaluationReport {
  const inputDiagnostics: string[] = [];
  if (!input || typeof input !== "object" || !Array.isArray(input.windows)) inputDiagnostics.push("harmony windows must be an array");
  const rawWindows = input && typeof input === "object" && Array.isArray(input.windows) ? input.windows : [];
  const windows: HarmonyWindowEvaluation[] = [];
  for (const [index, raw] of rawWindows.entries()) {
    const validated = validateWindow(raw, index);
    inputDiagnostics.push(...validated.diagnostics);
    if (validated.value) windows.push(evaluateWindow(validated.value));
    else windows.push({ id: `window-${index}`, startBeat: 0, endBeat: 0, status: "malformed", diagnostics: validated.diagnostics, metrics: unavailableMetrics("malformed", validated.diagnostics) });
  }
  windows.sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id)
    || a.endBeat - b.endBeat
    || JSON.stringify({ status: a.status, diagnostics: a.diagnostics, metrics: a.metrics }).localeCompare(JSON.stringify({ status: b.status, diagnostics: b.diagnostics, metrics: b.metrics })));
  const status: HarmonyAvailability = inputDiagnostics.length || windows.some((window) => window.status === "malformed")
    ? "malformed"
    : windows.length > 0 && windows.every((window) => window.status === "available") ? "available" : "unavailable";
  const metrics = aggregate(windows);
  const diagnostics = [...inputDiagnostics, ...windows.flatMap((window) => window.diagnostics)].filter((item, index, list) => list.indexOf(item) === index).sort();
  const base = { schemaVersion: 1 as const, status, windows, metrics, diagnostics };
  const requestedGate = gateOptions.enabled === true || gateOptions.thresholds !== undefined
    ? gateOptions
    : input && typeof input === "object" && input.gate ? input.gate : gateOptions;
  const gate = evaluateHarmonyGate(base, requestedGate);
  const canonical = JSON.stringify(canonicalize({ ...base, gate: { ...gate, diagnostics: [...gate.diagnostics].sort() } }));
  const canonicalSha256 = createHash("sha256").update(canonical).digest("hex");
  return { ...base, gate, determinism: { canonical, canonicalSha256 } };
}
