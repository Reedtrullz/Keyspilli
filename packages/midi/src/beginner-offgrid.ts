import type { Note } from "./types.js";

/** The frozen, generic Beginner RH allowance. */
export const BEGINNER_OFFGRID_RH_BUDGET_CONFIG = {
  quarterGridBeats: 0.25,
  gridToleranceBeats: 0.01,
  onsetToleranceBeats: 0.08,
  phraseBreakBeats: 1.5,
  spanCapSemitones: 12,
  largeLeapSemitones: 7,
  budget: 1,
  structuralSignals: [
    "contour-extremum",
    "repeated-articulation",
    "high-velocity",
    "long-duration",
    "phrase-anchor",
    "large-leap-endpoint",
  ],
} as const;

export type BeginnerOffGridStructuralSignal = typeof BEGINNER_OFFGRID_RH_BUDGET_CONFIG.structuralSignals[number];

export interface BeginnerOffGridRejectedCandidate {
  note: Note;
  sourceKey: string;
}

export interface BeginnerOffGridCandidate extends BeginnerOffGridRejectedCandidate {
  signals: BeginnerOffGridStructuralSignal[];
  signalFlags: number;
}

export interface BeginnerOffGridSelectionInput {
  sourceNotes: Note[];
  baselineNotes: Note[];
  rejected: BeginnerOffGridRejectedCandidate[];
  timeSig: [number, number];
  /** Duration used by the existing Beginner density contract, in beats. */
  durationBeats: number;
  /** Return true when the candidate fits the current Beginner envelope. */
  isLegal: (candidate: Note, selected: Note[], baseline: Note[]) => boolean;
  /** Fixed at one in production; two is used only by the diagnostic frontier. */
  budget?: number;
}

export interface BeginnerOffGridSelectionResult {
  selected: Note[];
  eligible: BeginnerOffGridCandidate[];
  emitted: BeginnerOffGridCandidate[];
  discardedByWindowBudget: number;
}

type Group = { start: number; notes: Note[] };

const SIGNAL_ORDER: BeginnerOffGridStructuralSignal[] = [
  "phrase-anchor",
  "contour-extremum",
  "repeated-articulation",
  "large-leap-endpoint",
  "high-velocity",
  "long-duration",
];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNotes(left: Note, right: Note): number {
  return left.start - right.start
    || left.midi - right.midi
    || left.dur - right.dur
    || right.vel - left.vel
    || compareText(left.hand ?? "", right.hand ?? "")
    || compareText(left.identitySource ?? "", right.identitySource ?? "")
    || compareText(left.lyrics ?? "", right.lyrics ?? "");
}

function valid(note: Note): boolean {
  return Boolean(note && typeof note === "object")
    && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127
    && Number.isFinite(note.start) && note.start >= 0
    && Number.isFinite(note.dur) && note.dur > 0
    && Number.isFinite(note.start + note.dur)
    && Number.isFinite(note.vel) && note.vel >= 0 && note.vel <= 127
    && (note.hand === undefined || note.hand === "L" || note.hand === "R");
}

function ordered(notes: Note[]): Note[] {
  return notes.filter(valid).map((note) => ({ ...note })).sort(compareNotes);
}

function groups(notes: Note[]): Group[] {
  const out: Group[] = [];
  for (const note of ordered(notes)) {
    const group = out.at(-1);
    if (!group || note.start - group.start > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.onsetToleranceBeats + 1e-9) {
      out.push({ start: note.start, notes: [note] });
    } else group.notes.push(note);
  }
  return out;
}

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const value = sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function quarterOffset(start: number): number {
  const grid = BEGINNER_OFFGRID_RH_BUDGET_CONFIG.quarterGridBeats;
  return Math.abs(start - Math.round(start / grid) * grid);
}

function isOffGrid(start: number): boolean {
  return quarterOffset(start) > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.gridToleranceBeats;
}

function structuralSignals(sourceGroups: Group[], index: number, velocityCut: number, durationCut: number): BeginnerOffGridStructuralSignal[] {
  const group = sourceGroups[index]!;
  const pitch = Math.max(...group.notes.map((note) => note.midi));
  const previous = sourceGroups[index - 1];
  const next = sourceGroups[index + 1];
  const previousPitch = previous ? Math.max(...previous.notes.map((note) => note.midi)) : null;
  const nextPitch = next ? Math.max(...next.notes.map((note) => note.midi)) : null;
  const signals: BeginnerOffGridStructuralSignal[] = [];
  if (previousPitch !== null && nextPitch !== null
    && ((pitch > previousPitch && pitch > nextPitch) || (pitch < previousPitch && pitch < nextPitch))) {
    signals.push("contour-extremum");
  }
  if (previousPitch === pitch || nextPitch === pitch) signals.push("repeated-articulation");
  if (group.notes.some((note) => note.vel >= velocityCut)) signals.push("high-velocity");
  if (group.notes.some((note) => note.dur >= durationCut)) signals.push("long-duration");
  if (index === 0 || index === sourceGroups.length - 1
    || (previous && group.start - previous.start > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.phraseBreakBeats)
    || (next && next.start - group.start > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.phraseBreakBeats)) {
    signals.push("phrase-anchor");
  }
  if ((previousPitch !== null && Math.abs(pitch - previousPitch) >= BEGINNER_OFFGRID_RH_BUDGET_CONFIG.largeLeapSemitones)
    || (nextPitch !== null && Math.abs(nextPitch - pitch) >= BEGINNER_OFFGRID_RH_BUDGET_CONFIG.largeLeapSemitones)) {
    signals.push("large-leap-endpoint");
  }
  return signals;
}

function sameEvent(left: Note, right: Note): boolean {
  return left.midi === right.midi
    && Math.abs(left.start - right.start) <= BEGINNER_OFFGRID_RH_BUDGET_CONFIG.onsetToleranceBeats + 1e-9;
}

function signalFlags(signals: BeginnerOffGridStructuralSignal[]): number {
  return signals.reduce((flags, signal) => flags | (1 << (SIGNAL_ORDER.length - 1 - SIGNAL_ORDER.indexOf(signal))), 0);
}

/**
 * Select the frozen structural allowance. The callback owns the current
 * product envelope; this primitive only owns eligibility, ordering, windows,
 * and the one-per-window budget.
 */
export function selectBeginnerOffGridRhCandidates(input: BeginnerOffGridSelectionInput): BeginnerOffGridSelectionResult {
  const sourceRh = ordered(input.sourceNotes.filter((note) => note.hand !== "L"));
  const sourceGroups = groups(sourceRh);
  const velocityCut = quantile(sourceRh.map((note) => note.vel), 0.75) ?? 127;
  const durationCut = quantile(sourceRh.map((note) => note.dur), 0.75) ?? 0;
  const baselineRh = ordered(input.baselineNotes.filter((note) => note.hand !== "L"));
  const eligible = [...new Map(input.rejected.map((candidate) => [candidate.sourceKey, candidate])).values()]
    .filter(({ note }) => valid(note) && note.hand !== "L")
    .flatMap(({ note, sourceKey }): BeginnerOffGridCandidate[] => {
      if (!isOffGrid(note.start) || baselineRh.some((current) => sameEvent(note, current))) return [];
      const groupIndex = sourceGroups.findIndex((group) => group.notes.some((member) => member.midi === note.midi && Math.abs(member.start - note.start) <= 1e-9));
      if (groupIndex < 0) return [];
      const group = sourceGroups[groupIndex]!;
      if (group.notes.some((other) => other.midi > note.midi)) return [];
      const signals = structuralSignals(sourceGroups, groupIndex, velocityCut, durationCut);
      return signals.length ? [{ note: { ...note }, sourceKey, signals, signalFlags: signalFlags(signals) }] : [];
    })
    .sort((left, right) => right.signals.length - left.signals.length
      || right.signalFlags - left.signalFlags
      || left.note.start - right.note.start
      || left.note.midi - right.note.midi
      || compareText(left.sourceKey, right.sourceKey));
  const windowBeats = (() => {
    const numerator = Number.isFinite(input.timeSig[0]) && input.timeSig[0] > 0 ? input.timeSig[0] : 4;
    const denominator = Number.isFinite(input.timeSig[1]) && input.timeSig[1] > 0 ? input.timeSig[1] : 4;
    const value = numerator * 4 / denominator;
    return Number.isFinite(value) && value > 0 ? value : 4;
  })();
  const budget = Number.isInteger(input.budget) && (input.budget ?? 0) >= 0 ? input.budget! : BEGINNER_OFFGRID_RH_BUDGET_CONFIG.budget;
  const selected = input.baselineNotes.map((note) => ({ ...note }));
  const selectedStarts = new Map<number, number>();
  const emitted: BeginnerOffGridCandidate[] = [];
  let discardedByWindowBudget = 0;
  for (const candidate of eligible) {
    const window = Math.floor(candidate.note.start / windowBeats) * windowBeats;
    if ((selectedStarts.get(window) ?? 0) >= budget) {
      discardedByWindowBudget++;
      continue;
    }
    if (!input.isLegal(candidate.note, selected, input.baselineNotes)) continue;
    selected.push({ ...candidate.note });
    selectedStarts.set(window, (selectedStarts.get(window) ?? 0) + 1);
    emitted.push({ ...candidate, note: { ...candidate.note } });
  }
  return { selected: selected.sort(compareNotes), eligible, emitted, discardedByWindowBudget };
}

export interface BeginnerOffGridConstraintMetrics {
  maxSimultaneity: number;
  onsetsPerSecond: number;
  medianIoiBeats: number | null;
  rightHandSpan: number | null;
  handSpanViolations: number;
}

export type BeginnerOffGridBlocker = "BLOCKED_BY_MAX_SIM" | "BLOCKED_BY_CURRENT_LH" | "BLOCKED_BY_DENSITY" | "BLOCKED_BY_IOI" | "BLOCKED_BY_SPAN_JUMP";

function maxSimultaneity(notes: Note[]): number {
  const events = notes.filter(valid).flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let level = 0;
  let max = 0;
  for (const [, delta] of events) {
    level += delta;
    max = Math.max(max, level);
  }
  return max;
}

function constraintMetrics(notes: Note[], tempoBpm: number, durationBeats: number): BeginnerOffGridConstraintMetrics {
  const validNotes = notes.filter(valid);
  const allGroups = groups(validNotes);
  const rhGroups = groups(validNotes.filter((note) => note.hand !== "L"));
  const rhPitches = rhGroups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
  const gaps = rhGroups.slice(1).map((group, index) => group.start - rhGroups[index]!.start);
  const rightHandSpan = rhPitches.length ? Math.max(...rhPitches) - Math.min(...rhPitches) : null;
  const handSpanViolations = ["L", "R"].reduce((count, hand) => {
    const pitches = groups(validNotes.filter((note) => hand === "L" ? note.hand === "L" : note.hand !== "L"))
      .map((group) => Math.max(...group.notes.map((note) => note.midi)));
    return count + pitches.slice(1).filter((pitch, index) => Math.abs(pitch - pitches[index]!) > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.spanCapSemitones).length;
  }, 0);
  const durationSeconds = tempoBpm > 0 ? durationBeats * 60 / tempoBpm : 0;
  return {
    maxSimultaneity: maxSimultaneity(validNotes),
    onsetsPerSecond: durationSeconds > 0 ? allGroups.length / durationSeconds : 0,
    medianIoiBeats: quantile(gaps, 0.5),
    rightHandSpan,
    handSpanViolations,
  };
}

export interface BeginnerOffGridConstraintOptions {
  tempoBpm: number;
  durationBeats: number;
  maxSimultaneity?: number;
  maxDensity?: number;
  minMedianIoiSeconds?: number;
}

/** Exact current Beginner envelope used by both production and diagnostics. */
export function assessBeginnerOffGridCandidate(
  candidate: Note,
  selected: Note[],
  baseline: Note[],
  options: BeginnerOffGridConstraintOptions,
): { legal: boolean; blocker?: BeginnerOffGridBlocker; metrics: BeginnerOffGridConstraintMetrics } {
  const maxSim = options.maxSimultaneity ?? 2;
  const maxDensity = options.maxDensity ?? 6;
  const minIoi = options.minMedianIoiSeconds ?? 0.08;
  const baselineMetrics = constraintMetrics(baseline, options.tempoBpm, options.durationBeats);
  const withCandidate = [...selected, { ...candidate }];
  const candidateMetrics = constraintMetrics(withCandidate, options.tempoBpm, options.durationBeats);
  const withoutLh = [...selected.filter((note) => note.hand !== "L"), { ...candidate }];
  const withoutLhMetrics = constraintMetrics(withoutLh, options.tempoBpm, options.durationBeats);
  if (candidateMetrics.maxSimultaneity > maxSim && baselineMetrics.maxSimultaneity <= maxSim
    && withoutLhMetrics.maxSimultaneity <= maxSim) {
    return { legal: false, blocker: "BLOCKED_BY_CURRENT_LH", metrics: candidateMetrics };
  }
  if (candidateMetrics.maxSimultaneity > maxSim && baselineMetrics.maxSimultaneity <= maxSim) {
    return { legal: false, blocker: "BLOCKED_BY_MAX_SIM", metrics: candidateMetrics };
  }
  if (candidateMetrics.onsetsPerSecond > maxDensity && baselineMetrics.onsetsPerSecond <= maxDensity) {
    return { legal: false, blocker: "BLOCKED_BY_DENSITY", metrics: candidateMetrics };
  }
  if (candidateMetrics.medianIoiBeats !== null
    && candidateMetrics.medianIoiBeats * 60 / options.tempoBpm < minIoi
    && (baselineMetrics.medianIoiBeats === null || baselineMetrics.medianIoiBeats * 60 / options.tempoBpm >= minIoi)) {
    return { legal: false, blocker: "BLOCKED_BY_IOI", metrics: candidateMetrics };
  }
  if ((candidateMetrics.rightHandSpan ?? 0) > BEGINNER_OFFGRID_RH_BUDGET_CONFIG.spanCapSemitones
    && (baselineMetrics.rightHandSpan ?? 0) <= BEGINNER_OFFGRID_RH_BUDGET_CONFIG.spanCapSemitones
    || candidateMetrics.handSpanViolations > baselineMetrics.handSpanViolations) {
    return { legal: false, blocker: "BLOCKED_BY_SPAN_JUMP", metrics: candidateMetrics };
  }
  return { legal: true, metrics: candidateMetrics };
}
