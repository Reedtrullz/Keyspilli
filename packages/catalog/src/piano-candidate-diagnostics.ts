import type { Note, ParsedMidi } from "@keyspilli/midi";

export const PIANO_DIAGNOSTIC_STAGES = ["raw", "aligned", "easy", "medium"] as const;
export type PianoDiagnosticStage = typeof PIANO_DIAGNOSTIC_STAGES[number] | (string & {});

export interface PianoDiagnosticWindow {
  id: string;
  startBeat: number;
  endBeat: number;
}

export type PianoDiagnosticStageInput = ParsedMidi | readonly Note[];

export interface PianoCandidateDiagnosticsInput {
  id: string;
  stages: Partial<Record<string, PianoDiagnosticStageInput>>;
  windows?: readonly PianoDiagnosticWindow[];
  onsetToleranceBeats?: number;
  lowerRegisterBoundary?: number;
}

export interface PianoStageDiagnostics {
  stage: string;
  noteCount: number;
  onsetCount: number;
  durationBeats: number;
  durationSeconds: number | null;
  tempoBpm: number | null;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  lowerRegister: {
    noteCount: number;
    onsetCount: number;
    notesPerAttack: number;
    closeIntervalCount: number;
  };
  /** Alias-shaped interval summary used by the baseline report. */
  closeIntervals: {
    pitchCount: number;
  };
  hand: {
    rightNoteCount: number;
    leftNoteCount: number;
    overlapCount: number;
    crossingCount: number;
  };
  melody: {
    noteCount: number;
    onsetCount: number;
    medianIoiBeats: number | null;
    p95Leap: number | null;
    p95LeapSemitones: number | null;
    maxLeap: number | null;
    maxLeapSemitones: number | null;
  };
  windows: Record<string, {
    noteCount: number;
    onsetCount: number;
    durationBeats: number;
    lowerNoteCount: number;
    melodyNoteCount: number;
  }>;
}

export interface PianoCandidateDiagnosticsReport {
  schemaVersion: 1;
  id: string;
  config: {
    onsetToleranceBeats: number;
    lowerRegisterBoundary: number;
  };
  stages: Record<string, PianoStageDiagnostics>;
  windows: PianoDiagnosticWindow[];
}

const EPSILON = 1e-9;
const DEFAULT_ONSET_TOLERANCE = 0.08;
const DEFAULT_LOWER_BOUNDARY = 60;

/** Keep canonical reports useful as shareable diagnostics without leaking a local path. */
function logicalId(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const leaf = normalized.split("/").filter(Boolean).pop() ?? "candidate";
  return leaf.replace(/\.(?:mid|midi)$/i, "") || "candidate";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampTolerance(value: unknown, fallback: number): number {
  return finite(value) && value >= 0 && value <= 4 ? value : fallback;
}

function validNote(note: Note): boolean {
  return finite(note.midi) && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && finite(note.start) && note.start >= 0 && finite(note.dur) && note.dur > 0
    && finite(note.vel) && note.vel >= 0 && note.vel <= 127;
}

function sourceNotes(input: PianoDiagnosticStageInput): { notes: Note[]; tempoBpm: number | null; durationBeats: number } {
  if (Array.isArray(input)) {
    const notes = input.filter(validNote).map((note) => ({ ...note }));
    return { notes, tempoBpm: null, durationBeats: extent(notes) };
  }
  const parsed = input as ParsedMidi;
  const notes = (parsed.notes ?? []).filter(validNote).map((note) => ({ ...note }));
  return {
    notes,
    tempoBpm: finite(parsed.tempoBpm) && parsed.tempoBpm > 0 ? parsed.tempoBpm : null,
    durationBeats: Math.max(finite(parsed.durationBeats) ? parsed.durationBeats : 0, extent(notes)),
  };
}

function extent(notes: readonly Note[]): number {
  return notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
}

function compareNotes(a: Note, b: Note): number {
  return a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || (a.hand ?? "").localeCompare(b.hand ?? "") || (a.identitySource ?? "").localeCompare(b.identitySource ?? "")
    || (a.lyrics ?? "").localeCompare(b.lyrics ?? "");
}

function sorted(notes: readonly Note[]): Note[] {
  return [...notes].sort(compareNotes);
}

function onsetGroups(notes: readonly Note[], tolerance: number): Note[][] {
  const groups: Note[][] = [];
  for (const note of sorted(notes)) {
    const previous = groups[groups.length - 1];
    if (previous && note.start - previous[0]!.start <= tolerance + EPSILON) previous.push(note);
    else groups.push([note]);
  }
  return groups;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sortedValues = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1]! + sortedValues[middle]!) / 2
    : sortedValues[middle]!;
}

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sortedValues = [...values].sort((a, b) => a - b);
  const position = (sortedValues.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sortedValues[low]! + (sortedValues[high]! - sortedValues[low]!) * (position - low);
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function melodyNotes(notes: readonly Note[], tolerance: number): Note[] {
  const right = notes.filter((note) => note.hand !== "L");
  const pool = right.length ? right : notes;
  return onsetGroups(pool, tolerance).map((group) => group
    .slice()
    .sort((a, b) => b.midi - a.midi || b.dur - a.dur || b.vel - a.vel)[0]!)
    .filter(Boolean)
    .sort(compareNotes);
}

function range(notes: readonly Note[]): { min: number | null; max: number | null; span: number | null } {
  if (!notes.length) return { min: null, max: null, span: null };
  const min = Math.min(...notes.map((note) => note.midi));
  const max = Math.max(...notes.map((note) => note.midi));
  return { min, max, span: max - min };
}

function overlapCount(notes: readonly Note[]): number {
  let count = 0;
  for (let i = 0; i < notes.length; i += 1) {
    const left = notes[i]!;
    for (let j = i + 1; j < notes.length; j += 1) {
      const right = notes[j]!;
      if (right.start >= left.start + left.dur - EPSILON) break;
      if (right.start < left.start + left.dur - EPSILON && right.start + right.dur > left.start + EPSILON) count += 1;
    }
  }
  return count;
}

function crossingCount(notes: readonly Note[]): number {
  const left = notes.filter((note) => note.hand === "L");
  const right = notes.filter((note) => note.hand === "R");
  let count = 0;
  for (const low of left) {
    for (const high of right) {
      if (low.start < high.start + high.dur - EPSILON && high.start < low.start + low.dur - EPSILON && low.midi > high.midi) count += 1;
    }
  }
  return count;
}

function stageMetrics(
  stage: string,
  input: PianoDiagnosticStageInput,
  tolerance: number,
  lowerBoundary: number,
  windows: readonly PianoDiagnosticWindow[],
): PianoStageDiagnostics {
  const source = sourceNotes(input);
  const notes = sorted(source.notes);
  const groups = onsetGroups(notes, tolerance);
  const lower = notes.filter((note) => note.midi <= lowerBoundary);
  const lowerGroups = onsetGroups(lower, tolerance);
  const melody = melodyNotes(notes, tolerance);
  const melodyGroups = onsetGroups(melody, tolerance);
  const melodyGaps = melodyGroups.slice(1).map((group, index) => group[0]!.start - melodyGroups[index]![0]!.start);
  const melodyLeaps = melody.slice(1).map((note, index) => Math.abs(note.midi - melody[index]!.midi));
  const pitch = range(notes);
  const closeIntervalCount = lowerGroups.reduce((sum, group) => {
    const sortedGroup = group.slice().sort((a, b) => a.midi - b.midi);
    let close = 0;
    for (let index = 1; index < sortedGroup.length; index += 1) {
      if (sortedGroup[index]!.midi - sortedGroup[index - 1]!.midi <= 4) close += 1;
    }
    return sum + close;
  }, 0);
  const stageWindows: PianoStageDiagnostics["windows"] = {};
  for (const window of windows) {
    const inWindow = notes.filter((note) => note.start >= window.startBeat - EPSILON && note.start < window.endBeat - EPSILON);
    const windowMelody = melody.filter((note) => note.start >= window.startBeat - EPSILON && note.start < window.endBeat - EPSILON);
    stageWindows[window.id] = {
      noteCount: inWindow.length,
      onsetCount: onsetGroups(inWindow, tolerance).length,
      durationBeats: inWindow.reduce((max, note) => Math.max(max, Math.min(window.endBeat, note.start + note.dur) - Math.max(window.startBeat, note.start)), 0),
      lowerNoteCount: inWindow.filter((note) => note.midi <= lowerBoundary).length,
      melodyNoteCount: windowMelody.length,
    };
  }
  return {
    stage,
    noteCount: notes.length,
    onsetCount: groups.length,
    durationBeats: source.durationBeats,
    durationSeconds: source.tempoBpm ? source.durationBeats * 60 / source.tempoBpm : null,
    tempoBpm: source.tempoBpm,
    pitchMin: pitch.min,
    pitchMax: pitch.max,
    pitchSpan: pitch.span,
    lowerRegister: {
      noteCount: lower.length,
      onsetCount: lowerGroups.length,
      notesPerAttack: lowerGroups.length ? lower.length / lowerGroups.length : 0,
      closeIntervalCount,
    },
    closeIntervals: { pitchCount: closeIntervalCount },
    hand: {
      rightNoteCount: notes.filter((note) => note.hand !== "L").length,
      leftNoteCount: notes.filter((note) => note.hand === "L").length,
      overlapCount: overlapCount(notes),
      crossingCount: crossingCount(notes),
    },
    melody: {
      noteCount: melody.length,
      onsetCount: melodyGroups.length,
      medianIoiBeats: rounded(median(melodyGaps)),
      p95Leap: rounded(quantile(melodyLeaps, 0.95)),
      p95LeapSemitones: rounded(quantile(melodyLeaps, 0.95)),
      maxLeap: melodyLeaps.length ? Math.max(...melodyLeaps) : null,
      maxLeapSemitones: melodyLeaps.length ? Math.max(...melodyLeaps) : null,
    },
    windows: stageWindows,
  };
}

/**
 * Validate and deterministically order explicit diagnostic windows.
 *
 * Windows are user-supplied alignment/measurement boundaries. Silently
 * dropping a malformed boundary would make the resulting report look valid
 * while measuring a different set of sections, so this helper fails closed.
 * End points are half-open: adjacent windows may touch, but may not overlap.
 */
export function validatePianoDiagnosticWindows(
  windows: readonly PianoDiagnosticWindow[] | undefined,
): PianoDiagnosticWindow[] {
  if (windows === undefined) return [];
  if (!Array.isArray(windows)) throw new Error("piano diagnostics windows must be an array");

  const normalized = windows.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`invalid piano diagnostic window at index ${index}`);
    }
    const window = candidate as Partial<PianoDiagnosticWindow>;
    if (typeof window.id !== "string" || !window.id.trim()
      || !finite(window.startBeat) || !finite(window.endBeat)
      || window.startBeat < 0 || window.endBeat <= window.startBeat) {
      throw new Error(`invalid piano diagnostic window bounds at index ${index}`);
    }
    return { id: window.id, startBeat: window.startBeat, endBeat: window.endBeat };
  }).sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat || a.id.localeCompare(b.id));

  const ids = new Set<string>();
  for (const window of normalized) {
    if (ids.has(window.id)) throw new Error(`duplicate piano diagnostic window id: ${window.id}`);
    ids.add(window.id);
  }
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    if (current.startBeat < previous.endBeat - EPSILON) {
      throw new Error(`overlapping piano diagnostic windows: ${previous.id} and ${current.id}`);
    }
  }
  return normalized;
}

export function diagnosePianoStage(
  stage: string,
  input: PianoDiagnosticStageInput,
  options: Pick<PianoCandidateDiagnosticsInput, "windows" | "onsetToleranceBeats" | "lowerRegisterBoundary"> = {},
): PianoStageDiagnostics {
  const tolerance = clampTolerance(options.onsetToleranceBeats, DEFAULT_ONSET_TOLERANCE);
  const lowerBoundary = finite(options.lowerRegisterBoundary) ? options.lowerRegisterBoundary! : DEFAULT_LOWER_BOUNDARY;
  return stageMetrics(stage, input, tolerance, lowerBoundary, validatePianoDiagnosticWindows(options.windows));
}

export function diagnosePianoCandidates(input: PianoCandidateDiagnosticsInput): PianoCandidateDiagnosticsReport {
  if (!input || typeof input.id !== "string" || !input.id.trim()) throw new Error("piano diagnostics requires a non-empty id");
  const tolerance = clampTolerance(input.onsetToleranceBeats, DEFAULT_ONSET_TOLERANCE);
  const lowerBoundary = finite(input.lowerRegisterBoundary) ? input.lowerRegisterBoundary! : DEFAULT_LOWER_BOUNDARY;
  const windows = validatePianoDiagnosticWindows(input.windows);
  const stages: Record<string, PianoStageDiagnostics> = {};
  for (const stage of PIANO_DIAGNOSTIC_STAGES) {
    const source = input.stages[stage];
    if (source !== undefined) stages[stage] = stageMetrics(stage, source, tolerance, lowerBoundary, windows);
  }
  for (const stage of Object.keys(input.stages).filter((key) => !PIANO_DIAGNOSTIC_STAGES.includes(key as typeof PIANO_DIAGNOSTIC_STAGES[number])).sort()) {
    const source = input.stages[stage];
    if (source !== undefined) stages[stage] = stageMetrics(stage, source, tolerance, lowerBoundary, windows);
  }
  return {
    schemaVersion: 1,
    id: logicalId(input.id),
    config: { onsetToleranceBeats: tolerance, lowerRegisterBoundary: lowerBoundary },
    stages,
    windows,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalPianoCandidateDiagnosticsJson(report: PianoCandidateDiagnosticsReport): string {
  return JSON.stringify(canonicalize(report));
}
