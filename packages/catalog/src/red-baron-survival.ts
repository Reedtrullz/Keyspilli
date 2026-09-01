/**
 * Local-only, reference-separated diagnostics for symbolic stage survival.
 *
 * This module deliberately accepts already supplied stage arrays.  The
 * reference is used only for window-domain coverage and is never passed to a
 * decoder, worker, arranger, or any generation function.
 */

import { createHash } from "node:crypto";

export const RED_BARON_SURVIVAL_STAGES = ["raw", "decoder", "semantic", "canonical", "easy"] as const;
export type RedBaronSurvivalStage = (typeof RED_BARON_SURVIVAL_STAGES)[number];
export type StageAvailability = "available" | "missing" | "invalid";
export type StageNoteState = "accepted" | "rejected" | "replaced" | "obscured";

export interface StageNoteLike {
  id?: unknown;
  midi?: unknown;
  pitch?: unknown;
  start?: unknown;
  onset?: unknown;
  dur?: unknown;
  duration?: unknown;
  vel?: unknown;
  velocity?: unknown;
  parentIds?: unknown;
  state?: unknown;
  status?: unknown;
  rejected?: unknown;
  replaced?: unknown;
  obscured?: unknown;
  unsupported?: unknown;
  rejectionReason?: unknown;
  provenance?: unknown;
  source?: unknown;
  [key: string]: unknown;
}

export interface StageInput {
  status?: StageAvailability;
  notes?: readonly StageNoteLike[] | readonly unknown[];
  id?: string;
  source?: string;
  provenance?: Record<string, unknown>;
  diagnostics?: readonly string[];
}

export type StageInputValue = StageInput | readonly StageNoteLike[];
export type StageInputs = Partial<Record<RedBaronSurvivalStage, StageInputValue>>;

export interface SurvivalBounds {
  startBeat: number;
  endBeat: number;
}

export interface StageSurvivalWindowInput {
  id: string;
  /** Bounds in the supplied reference score's beat domain. */
  reference?: SurvivalBounds | readonly [number, number];
  /** A common stage-domain bound, accepted as a convenience for CLI callers. */
  stage?: SurvivalBounds | readonly [number, number];
  /** Per-stage stage-domain bounds. This is the canonical form. */
  stages?: Partial<Record<RedBaronSurvivalStage, SurvivalBounds | readonly [number, number]>>;
  /** Alias accepted for callers that use stageWindows terminology. */
  stageWindows?: Partial<Record<RedBaronSurvivalStage, SurvivalBounds | readonly [number, number]>>;
}

export interface NormalizedStageNote {
  id: string;
  midi: number;
  start: number;
  dur: number;
  vel: number;
  parentIds: readonly string[];
  state: StageNoteState;
  unsupported: boolean;
  rejectionReason?: string;
  provenance?: Record<string, unknown>;
}

export interface StageDiagnosticSummary {
  stage: RedBaronSurvivalStage | "reference";
  status: StageAvailability;
  noteCount: number;
  rejectedNoteCount: number;
  invalidNoteCount: number;
  sourceId: string | null;
  rejectionReasons: readonly string[];
  diagnostics: readonly string[];
}

export interface StageNoteMatch {
  sourceId: string;
  targetId: string;
  sourceIndex: number;
  targetIndex: number;
  pitchDelta: number;
  timingDelta: number;
  durationDelta: number;
  classification: StageLossCategory;
  parentIds: readonly string[];
  provenanceKeys: readonly string[];
}

export type StageLossCategory =
  | "retained"
  | "pitchModified"
  | "octaveShifted"
  | "timingShifted"
  | "rejected"
  | "replaced"
  | "obscured"
  | "additions"
  | "unsupportedCanonicalExpansions";

export interface StageLossSummary {
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  unmatchedSourceCount: number;
  unmatchedTargetCount: number;
  retained: number;
  pitchModified: number;
  octaveShifted: number;
  timingShifted: number;
  rejected: number;
  replaced: number;
  obscured: number;
  additions: number;
  unsupportedCanonicalExpansions: number;
  diagnostics: readonly string[];
}

export interface StageTransition {
  from: RedBaronSurvivalStage;
  to: RedBaronSurvivalStage;
  matches: readonly StageNoteMatch[];
  loss: StageLossSummary;
  diagnostics: readonly string[];
  /** Public lineage-only diagnostics; note payloads are intentionally absent. */
  lineage: readonly {
    sourceId: string;
    targetId: string;
    parentIds: readonly string[];
    provenanceKeys: readonly string[];
    provenance?: Record<string, unknown>;
  }[];
  /** Internal normalized notes are non-enumerable and are consumed by classifyStageLoss. */
  sourceNotes?: readonly NormalizedStageNote[];
  targetNotes?: readonly NormalizedStageNote[];
}

export interface DecoderFixEvidence {
  sourceIndependentInvariant: boolean;
  syntheticRegression: boolean;
  crossSongImprovement: boolean;
  noMaterialRegression: boolean;
}

export interface StageSurvivalReport {
  schemaVersion: 1;
  kind: "red-baron-stage-survival";
  status: "ready" | "blocked" | "partial";
  reference: StageDiagnosticSummary;
  stages: Record<RedBaronSurvivalStage, StageDiagnosticSummary>;
  windows: readonly NormalizedSurvivalWindow[];
  transitions: readonly StageTransition[];
  diagnostics: readonly string[];
  evidence?: DecoderFixEvidence;
  /** Alias for integrations that call the gate evidence bundle "gates". */
  gates?: DecoderFixEvidence;
}

export interface NormalizedSurvivalWindow {
  id: string;
  reference: [number, number];
  stages: Record<RedBaronSurvivalStage, [number, number]>;
}

const EPSILON = 1e-9;
const TIMING_MATCH_TOLERANCE = 1.5;
const TIMING_SHIFT_TOLERANCE = 0.08;
const LARGE_PITCH_DELTA = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function redactPath(value: string): string {
  const urls: string[] = [];
  const protectedText = value.replace(/https?:\/\/[^\s"'<>;,)}]+/gi, (url) => {
    const marker = "__SURVIVAL_URL_" + urls.length + "__";
    urls.push(url);
    return marker;
  });
  value = protectedText;
  const physical = /(?:file:\/{1,2}[^\s"'<>;,)}]+|\\\\[^\s"'<>;,)}]+|(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>;,)}]+|~[\\/][^\s"'<>;,)}]+|(?<![A-Za-z0-9:/])\/[^\s"'<>;,)}]+)/gi;
  const relativePath = /(?<![A-Za-z0-9._:/-])(?:\.{1,2}[\\/]|[A-Za-z0-9._-]+[\\/])[^\s"'<>;,)}]+/gi;
  const isAbsolute = (candidate: string): boolean => /^(?:file:\/{1,2}|\\\\|[A-Za-z]:[\\/]|~[\\/]|\/)/i.test(candidate.trim());
  const isRelative = (candidate: string): boolean => /^(?:\.{1,2}[\\/]|[A-Za-z0-9._-]+[\\/])[^\s"'<>;,)}]+$/i.test(candidate.trim());
  const isPhysical = (candidate: string): boolean => isAbsolute(candidate) || isRelative(candidate);
  let result = value.replace(/(["'])(.*?)\1/g, (full, quote: string, inner: string) => isPhysical(inner) ? `${quote}[redacted-path]${quote}` : full);
  result = result.replace(physical, (match) => isPhysical(match) ? "[redacted-path]" : match);
  result = result.replace(relativePath, (match) => /^logical\//i.test(match) ? match : "[redacted-path]");
  return result.replace(/__SURVIVAL_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? "[redacted-url]");
}

/** Path redaction shared by the opt-in CLI and canonical report serializer. */
export const redactStageSurvivalText = redactPath;

function safeDiagnostic(value: unknown): string {
  return redactPath(typeof value === "string" ? value : String(value));
}

function sortedObject(value: unknown, key = ""): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string") return redactPath(value);
  if (Array.isArray(value)) return value.map((item) => sortedObject(item));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const childKey of Object.keys(value).sort(compareText)) {
    if (/^(?:sourceNotes|targetNotes)$/i.test(childKey)) continue;
    if (/(?:^|_)(?:path|file|filename|locator)(?:$|_)/i.test(childKey)) continue;
    const child = sortedObject(value[childKey], childKey);
    if (child !== undefined) result[childKey] = child;
  }
  return result;
}

export function canonicalStageSurvivalJson(report: StageSurvivalReport | unknown): string {
  return JSON.stringify(sortedObject(report));
}

function noteState(note: Record<string, unknown>): StageNoteState {
  const state = text(note.state) ?? text(note.status);
  if (state === "rejected" || note.rejected === true || text(note.rejectionReason)) return "rejected";
  if (state === "replaced" || note.replaced === true) return "replaced";
  if (state === "obscured" || note.obscured === true) return "obscured";
  return "accepted";
}

function normalizeParentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter((item): item is string => Boolean(item)).map(redactPath))].sort(compareText);
}

function safeProvenance(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareText)) {
    if (/(?:path|file|locator|bytes?|notes?|events?)/i.test(key)) continue;
    const item = value[key];
    if (typeof item === "string") result[key] = redactPath(item);
    else if (typeof item === "number" && !Number.isFinite(item)) result[key] = null;
    else if (Array.isArray(item)) result[key] = item.filter((child) => typeof child === "string" || typeof child === "number").map((child) => typeof child === "string" ? redactPath(child) : child);
    else if (item === null || typeof item === "boolean" || typeof item === "number") result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}

function noteFields(note: StageNoteLike): { midi: unknown; start: unknown; dur: unknown; vel: unknown } {
  const value = note as Record<string, unknown>;
  return {
    midi: value.midi ?? value.pitch,
    start: value.start ?? value.onset,
    dur: value.dur ?? value.duration,
    vel: value.vel ?? value.velocity,
  };
}

function validNoteFields(fields: { midi: unknown; start: unknown; dur: unknown; vel: unknown }): boolean {
  return finite(fields.midi) && Number.isInteger(fields.midi) && fields.midi >= 0 && fields.midi <= 127
    && finite(fields.start) && fields.start >= 0
    && finite(fields.dur) && fields.dur > 0
    && finite(fields.vel) && fields.vel >= 0 && fields.vel <= 127;
}

function stableNoteKey(note: StageNoteLike): string {
  const fields = noteFields(note);
  return [text(note.id) ?? "", fields.midi, fields.start, fields.dur, fields.vel, text(note.source) ?? "", text(note.state) ?? text(note.status) ?? "", JSON.stringify(normalizeParentIds(note.parentIds)), JSON.stringify(safeProvenance(note.provenance) ?? {})].join("|");
}

function normalizeNotes(notes: readonly unknown[]): { notes: NormalizedStageNote[]; invalidCount: number; rejectedCount: number } {
  const rows = notes.filter(isRecord).map((row) => ({ row, key: stableNoteKey(row) }));
  rows.sort((left, right) => compareText(left.key, right.key));
  const used = new Map<string, number>();
  const normalized: NormalizedStageNote[] = [];
  let invalidCount = notes.length - rows.length;
  let rejectedCount = 0;
  for (const { row } of rows) {
    const fields = noteFields(row);
    if (!validNoteFields(fields)) {
      invalidCount += 1;
      continue;
    }
    const base = redactPath(text(row.id) ?? `note:${stableNoteKey(row)}`);
    const ordinal = (used.get(base) ?? 0) + 1;
    used.set(base, ordinal);
    const id = ordinal === 1 ? base : `${base}#${ordinal}`;
    const state = noteState(row);
    if (state === "rejected") rejectedCount += 1;
    const normalizedNote: NormalizedStageNote = {
      id,
      midi: fields.midi as number,
      start: fields.start as number,
      dur: fields.dur as number,
      vel: fields.vel as number,
      parentIds: normalizeParentIds(row.parentIds),
      state,
      unsupported: row.unsupported === true,
      ...(text(row.rejectionReason) ? { rejectionReason: safeDiagnostic(row.rejectionReason) } : {}),
      ...(safeProvenance(row.provenance) ? { provenance: safeProvenance(row.provenance) } : {}),
    };
    normalized.push(normalizedNote);
  }
  normalized.sort((left, right) => left.start - right.start || left.midi - right.midi || compareText(left.id, right.id));
  return { notes: normalized, invalidCount, rejectedCount };
}

function asStageInput(value: StageInputValue | undefined): { status: StageAvailability; input: StageInput; diagnostics: string[] } {
  if (value === undefined) return { status: "missing", input: {}, diagnostics: ["stage is missing"] };
  if (Array.isArray(value)) return { status: "available", input: { notes: value }, diagnostics: [] };
  if (!isRecord(value)) return { status: "invalid", input: {}, diagnostics: ["stage must be an object or note array"] };
  const status = value.status === undefined ? "available" : value.status;
  if (status !== "available" && status !== "missing" && status !== "invalid") return { status: "invalid", input: {}, diagnostics: ["stage status is invalid"] };
  if (status !== "available") return { status, input: value, diagnostics: [`stage is ${status}`] };
  if (!Array.isArray(value.notes)) return { status: "invalid", input: value, diagnostics: ["available stage notes must be an array"] };
  return { status, input: value, diagnostics: Array.isArray(value.diagnostics) ? value.diagnostics.map(safeDiagnostic) : [] };
}

interface PreparedStage {
  status: StageAvailability;
  notes: NormalizedStageNote[];
  invalidCount: number;
  rejectedCount: number;
  rejectionReasons: string[];
  summary: StageDiagnosticSummary;
}

function prepareStage(stage: RedBaronSurvivalStage | "reference", value: StageInputValue | undefined): PreparedStage {
  const parsed = asStageInput(value);
  const notesInput = Array.isArray(parsed.input.notes) ? parsed.input.notes : [];
  const normalized = parsed.status === "available" ? normalizeNotes(notesInput) : { notes: [], invalidCount: 0, rejectedCount: 0 };
  const diagnostics = [...parsed.diagnostics];
  const rejectionReasons = [...new Set(normalized.notes.map((note) => note.rejectionReason).filter((reason): reason is string => Boolean(reason)))].sort(compareText);
  if (normalized.invalidCount) diagnostics.push(`${normalized.invalidCount} invalid note row(s) retained as a diagnostic`);
  if (rejectionReasons.length) diagnostics.push(...rejectionReasons.map((reason) => `rejection: ${reason}`));
  return {
    status: parsed.status,
    notes: normalized.notes,
    invalidCount: normalized.invalidCount,
    rejectedCount: normalized.rejectedCount,
    rejectionReasons,
    summary: {
      stage,
      status: parsed.status,
      noteCount: normalized.notes.length,
      rejectedNoteCount: normalized.rejectedCount,
      invalidNoteCount: normalized.invalidCount,
      sourceId: text(parsed.input.id) ? safeDiagnostic(parsed.input.id) : null,
      rejectionReasons,
      diagnostics: [...new Set(diagnostics)].sort(compareText),
    },
  };
}

function parseBounds(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1])) return validateBounds(value[0], value[1]);
  if (isRecord(value) && finite(value.startBeat) && finite(value.endBeat)) return validateBounds(value.startBeat, value.endBeat);
  return null;
}

function validateBounds(start: number, end: number): [number, number] | null {
  return start >= 0 && end > start ? [start, end] : null;
}

function prepareWindows(windows: readonly StageSurvivalWindowInput[] | undefined): { windows: NormalizedSurvivalWindow[]; diagnostics: string[] } {
  if (!Array.isArray(windows) || windows.length === 0) return { windows: [], diagnostics: ["explicit comparison windows are required; global comparison is disabled"] };
  const seen = new Set<string>();
  const normalized: NormalizedSurvivalWindow[] = [];
  for (const window of windows) {
    if (!isRecord(window) || typeof window.id !== "string" || !window.id.trim()) throw new Error("invalid survival window id");
    if (seen.has(redactPath(window.id))) throw new Error(`duplicate survival window id: ${redactPath(window.id)}`);
    seen.add(redactPath(window.id));
  }
  seen.clear();
  for (const window of windows) {
    if (!isRecord(window) || typeof window.id !== "string" || !window.id.trim()) throw new Error("invalid survival window id");
    seen.add(redactPath(window.id));
    const reference = parseBounds(window.reference);
    if (!reference) throw new Error(`invalid survival window reference bounds: ${window.id}`);
    const suppliedStages = isRecord(window.stages) ? window.stages : isRecord(window.stageWindows) ? window.stageWindows : {};
    const common = parseBounds(window.stage);
    const stageBounds = {} as Record<RedBaronSurvivalStage, [number, number]>;
    for (const stage of RED_BARON_SURVIVAL_STAGES) {
      const bounds = parseBounds(suppliedStages[stage]) ?? common;
      if (!bounds) throw new Error(`missing survival window stage bounds for ${window.id}/${stage}`);
      stageBounds[stage] = bounds;
    }
    normalized.push({ id: redactPath(window.id), reference, stages: stageBounds });
  }
  normalized.sort((left, right) => compareText(left.id, right.id));
  return { windows: normalized, diagnostics: [] };
}

function noteInBounds(note: NormalizedStageNote, bounds: [number, number]): boolean {
  return note.start >= bounds[0] - EPSILON && note.start < bounds[1] - EPSILON;
}

function noteInAnyBounds(note: NormalizedStageNote, bounds: readonly [number, number][]): boolean {
  return bounds.some((bound) => noteInBounds(note, bound));
}

function overlapParent(source: NormalizedStageNote, target: NormalizedStageNote): boolean {
  const parent = new Set(source.parentIds);
  return target.parentIds.some((id) => parent.has(id)) || source.parentIds.includes(target.id) || target.parentIds.includes(source.id);
}

function candidateCost(source: NormalizedStageNote, target: NormalizedStageNote, identity: boolean, parent: boolean): number {
  const pitch = Math.abs(source.midi - target.midi);
  const timing = Math.abs(source.start - target.start);
  return (identity ? -100000 : parent ? -10000 : 0) + timing * 100 + pitch + Math.abs(source.dur - target.dur) * 0.01 + target.start * 1e-6;
}

function classifyMatched(from: RedBaronSurvivalStage, source: NormalizedStageNote, target: NormalizedStageNote, pitchDelta: number, timingDelta: number): StageLossCategory {
  if (source.state === "rejected" || target.state === "rejected") return "rejected";
  if (source.state === "replaced" || target.state === "replaced") return "replaced";
  if (source.state === "obscured" || target.state === "obscured") return "obscured";
  if (Math.abs(pitchDelta) >= LARGE_PITCH_DELTA && Math.abs(pitchDelta) % 12 !== 0) return "replaced";
  if (pitchDelta !== 0 && Math.abs(pitchDelta) % 12 === 0) return "octaveShifted";
  if (pitchDelta !== 0) return "pitchModified";
  if (timingDelta > TIMING_SHIFT_TOLERANCE) return "timingShifted";
  return "retained";
}

function buildTransition(from: RedBaronSurvivalStage, to: RedBaronSurvivalStage, source: PreparedStage, target: PreparedStage, sourceBounds?: readonly [number, number][], targetBounds?: readonly [number, number][]): StageTransition {
  const sourceNotes = source.notes.filter((note) => !sourceBounds || noteInAnyBounds(note, sourceBounds));
  const targetNotes = target.notes.filter((note) => !targetBounds || noteInAnyBounds(note, targetBounds));
  const availableTargets = new Set(targetNotes.map((_note, index) => index));
  const matches: StageNoteMatch[] = [];
  for (let sourceIndex = 0; sourceIndex < sourceNotes.length; sourceIndex += 1) {
    const sourceNote = sourceNotes[sourceIndex]!;
    const candidates = [...availableTargets].map((targetIndex) => {
      const targetNote = targetNotes[targetIndex]!;
      const identity = sourceNote.id === targetNote.id;
      const parent = overlapParent(sourceNote, targetNote);
      const timing = Math.abs(sourceNote.start - targetNote.start);
      if (!identity && !parent && timing > TIMING_MATCH_TOLERANCE) return null;
      return { targetIndex, cost: candidateCost(sourceNote, targetNote, identity, parent) };
    }).filter((value): value is { targetIndex: number; cost: number } => value !== null)
      .sort((left, right) => left.cost - right.cost || left.targetIndex - right.targetIndex);
    const chosen = candidates[0];
    if (!chosen) continue;
    availableTargets.delete(chosen.targetIndex);
    const targetNote = targetNotes[chosen.targetIndex]!;
    const pitchDelta = targetNote.midi - sourceNote.midi;
    const timingDelta = targetNote.start - sourceNote.start;
    const provenanceKeys = [...new Set([...Object.keys(sourceNote.provenance ?? {}), ...Object.keys(targetNote.provenance ?? {})])].sort(compareText);
    matches.push({ sourceId: sourceNote.id, targetId: targetNote.id, sourceIndex, targetIndex: chosen.targetIndex, pitchDelta, timingDelta: round(timingDelta), durationDelta: round(targetNote.dur - sourceNote.dur), classification: classifyMatched(from, sourceNote, targetNote, pitchDelta, timingDelta), parentIds: [...new Set([...sourceNote.parentIds, ...targetNote.parentIds])].sort(compareText), provenanceKeys });
  }
  matches.sort((left, right) => left.sourceIndex - right.sourceIndex || left.targetIndex - right.targetIndex);
  const loss = classifyStageLoss({ from, to, matches, sourceNotes, targetNotes });
  const lineage = matches.map((match) => {
    const sourceNote = sourceNotes[match.sourceIndex]!;
    const targetNote = targetNotes[match.targetIndex]!;
    const provenance = { ...(sourceNote.provenance ?? {}), ...(targetNote.provenance ?? {}) };
    return {
      sourceId: match.sourceId,
      targetId: match.targetId,
      parentIds: match.parentIds,
      provenanceKeys: match.provenanceKeys,
      ...(Object.keys(provenance).length ? { provenance } : {}),
    };
  });
  const transition: StageTransition = { from, to, matches, loss, diagnostics: loss.diagnostics, lineage };
  Object.defineProperty(transition, "sourceNotes", { value: sourceNotes, enumerable: false });
  Object.defineProperty(transition, "targetNotes", { value: targetNotes, enumerable: false });
  return transition;
}

export function classifyStageLoss(transition: Pick<StageTransition, "from" | "to" | "matches"> & { sourceNotes?: readonly NormalizedStageNote[] | readonly StageNoteLike[]; targetNotes?: readonly NormalizedStageNote[] | readonly StageNoteLike[] }): StageLossSummary {
  const sourceNotes = (transition.sourceNotes ?? []).map((note) => "state" in note && typeof note.state === "string" && typeof note.id === "string" && typeof note.midi === "number" ? note as NormalizedStageNote : normalizeNotes([note]).notes[0]).filter((note): note is NormalizedStageNote => Boolean(note));
  const targetNotes = (transition.targetNotes ?? []).map((note) => "state" in note && typeof note.state === "string" && typeof note.id === "string" && typeof note.midi === "number" ? note as NormalizedStageNote : normalizeNotes([note]).notes[0]).filter((note): note is NormalizedStageNote => Boolean(note));
  const matchedSource = new Set(transition.matches.map((match) => match.sourceIndex));
  const matchedTarget = new Set(transition.matches.map((match) => match.targetIndex));
  const counts: Record<StageLossCategory, number> = { retained: 0, pitchModified: 0, octaveShifted: 0, timingShifted: 0, rejected: 0, replaced: 0, obscured: 0, additions: 0, unsupportedCanonicalExpansions: 0 };
  for (const match of transition.matches) counts[match.classification] += 1;
  const diagnostics: string[] = [];
  for (let index = 0; index < sourceNotes.length; index += 1) {
    if (matchedSource.has(index)) continue;
    const source = sourceNotes[index]!;
    if (transition.from === "canonical" && source.unsupported) counts.unsupportedCanonicalExpansions += 1;
    else if (source.state === "replaced") counts.replaced += 1;
    else if (source.state === "obscured") counts.obscured += 1;
    else counts.rejected += 1;
  }
  for (let index = 0; index < targetNotes.length; index += 1) {
    if (matchedTarget.has(index)) continue;
    const target = targetNotes[index]!;
    if (transition.to === "canonical" && target.unsupported) counts.unsupportedCanonicalExpansions += 1;
    else counts.additions += 1;
  }
  if (counts.rejected) diagnostics.push(`${counts.rejected} source note(s) rejected or not retained`);
  if (counts.replaced) diagnostics.push(`${counts.replaced} source note(s) replaced`);
  if (counts.obscured) diagnostics.push(`${counts.obscured} source note(s) obscured`);
  if (counts.additions) diagnostics.push(`${counts.additions} target note(s) added without a source match`);
  if (counts.unsupportedCanonicalExpansions) diagnostics.push(`${counts.unsupportedCanonicalExpansions} unsupported canonical expansion(s)`);
  return {
    sourceCount: sourceNotes.length,
    targetCount: targetNotes.length,
    matchedCount: transition.matches.length,
    unmatchedSourceCount: sourceNotes.length - matchedSource.size,
    unmatchedTargetCount: targetNotes.length - matchedTarget.size,
    ...counts,
    diagnostics: [...new Set(diagnostics)].sort(compareText),
  };
}

function stageRecord(value: StageInputValue | undefined): StageInputValue | undefined {
  return value;
}

export function evaluateStageSurvival(stages: StageInputs, reference?: StageInputValue, windows?: readonly StageSurvivalWindowInput[]): StageSurvivalReport {
  const diagnostics: string[] = [];
  const preparedReference = prepareStage("reference", reference);
  const prepared = {} as Record<RedBaronSurvivalStage, PreparedStage>;
  for (const stage of RED_BARON_SURVIVAL_STAGES) prepared[stage] = prepareStage(stage, stageRecord(stages?.[stage]));
  const preparedWindows = prepareWindows(windows);
  diagnostics.push(...preparedWindows.diagnostics);
  if (preparedReference.status !== "available") diagnostics.push("valid supplied reference is required");
  for (const stage of RED_BARON_SURVIVAL_STAGES) if (prepared[stage].status !== "available") diagnostics.push(`${stage} stage is ${prepared[stage].status}`);
  const status: StageSurvivalReport["status"] = diagnostics.length ? "blocked" : "ready";
  const transitions: StageTransition[] = [];
  if (status === "ready") {
    for (let index = 0; index < RED_BARON_SURVIVAL_STAGES.length - 1; index += 1) {
      const from = RED_BARON_SURVIVAL_STAGES[index]!;
      const to = RED_BARON_SURVIVAL_STAGES[index + 1]!;
      const sourceBounds = preparedWindows.windows.map((window) => window.stages[from]);
      const targetBounds = preparedWindows.windows.map((window) => window.stages[to]);
      transitions.push(buildTransition(from, to, prepared[from], prepared[to], sourceBounds, targetBounds));
    }
  }
  const stageSummaries = {} as Record<RedBaronSurvivalStage, StageDiagnosticSummary>;
  for (const stage of RED_BARON_SURVIVAL_STAGES) stageSummaries[stage] = prepared[stage].summary;
  return {
    schemaVersion: 1,
    kind: "red-baron-stage-survival",
    status,
    reference: preparedReference.summary,
    stages: stageSummaries,
    windows: preparedWindows.windows,
    transitions,
    diagnostics: [...new Set([...diagnostics, ...preparedReference.summary.diagnostics, ...RED_BARON_SURVIVAL_STAGES.flatMap((stage) => prepared[stage].summary.diagnostics)])].sort(compareText),
  };
}

export function genericDecoderFixDecision(report: StageSurvivalReport): { decision: "apply" | "defer"; eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!report || report.status !== "ready") blockers.push("report is missing, partial, or blocked");
  if (Array.isArray(report?.diagnostics) && report.diagnostics.some((diagnostic) => /reference[- ]dependent|reference notes? used for decoding/i.test(diagnostic))) blockers.push("reference-dependent evidence is not eligible");
  const evidence = report?.evidence ?? report?.gates;
  if (evidence?.sourceIndependentInvariant !== true) blockers.push("source-independent invariant evidence is required");
  if (evidence?.syntheticRegression !== true) blockers.push("synthetic regression evidence is required");
  if (evidence?.crossSongImprovement !== true) blockers.push("cross-song improvement evidence is required");
  if (evidence?.noMaterialRegression !== true) blockers.push("no material regression must be ruled out");
  return blockers.length ? { decision: "defer", eligible: false, blockers: [...new Set(blockers)].sort(compareText) } : { decision: "apply", eligible: true, blockers: [] };
}

/** Stable digest helper for callers that want an audit identity without notes. */
export function stageSurvivalDigest(report: StageSurvivalReport): string {
  return createHash("sha256").update(canonicalStageSurvivalJson(report)).digest("hex");
}
