import { PLAYABILITY_LIMITS } from "./validate.js";
import {
  assessPlayability,
  groupPlayabilityAttacks,
  measurePlayability,
  type PlayabilityAttack,
} from "./playability-audit.js";
import type { DifficultyLevel, Note } from "./types.js";

/**
 * Report-only density experiment configuration.  The production validator is
 * the source of truth for the IOI floor; these values only describe the
 * experiment and are never read by buildVariants.
 */
export const DENSITY_NORMALIZATION_AUDIT_CONFIG = {
  onsetDecimals: 3,
  phraseBreakBeats: 1.5,
  largeLeapSemitones: 7,
  rapidIoiSeconds: 0.08,
  oracleKind: "bounded-greedy-upper-bound",
} as const;

export type DensitySemanticPriority = "p0-melody-or-anchor" | "p1-structure" | "p2-support";

export interface DensityAttackSemantics {
  index: number;
  start: number;
  noteCount: number;
  hands: Array<"L" | "R">;
  hasRightHand: boolean;
  hasLeftHand: boolean;
  representativePitch: number | null;
  bassPitch: number | null;
  maxVelocity: number;
  phraseBoundary: boolean;
  principalMelody: boolean;
  contourExtremum: boolean;
  largeLeapEndpoint: boolean;
  repeatedArticulation: boolean;
  harmonicChange: boolean;
  priority: DensitySemanticPriority;
  removable: boolean;
}

export interface DensityAttackAnalysis {
  attack: PlayabilityAttack;
  semantics: DensityAttackSemantics;
}

export interface DensitySelectionResult {
  notes: Note[];
  removedAttackIndexes: number[];
  analyses: DensityAttackAnalysis[];
  protectedAttackCount: number;
  removableAttackCount: number;
  retimedEvents: number;
  createdEvents: number;
}

export interface DensityOracleResult extends DensitySelectionResult {
  level: DifficultyLevel;
  initialAssessment: ReturnType<typeof assessPlayability>;
  finalAssessment: ReturnType<typeof assessPlayability>;
  exhausted: boolean;
  minimumNotes: number | null;
}

function compareNotes(left: Note, right: Note): number {
  const text = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return left.midi - right.midi
    || left.dur - right.dur
    || right.vel - left.vel
    || text(left.hand ?? "", right.hand ?? "")
    || text(left.identitySource ?? "", right.identitySource ?? "");
}

function sortedAttackMembers(attack: PlayabilityAttack): Note[] {
  return [...attack.notes].sort(compareNotes);
}

function representativePitch(attack: PlayabilityAttack): number | null {
  const right = attack.notes.filter((note) => note.hand !== "L");
  const values = (right.length ? right : attack.notes).map((note) => note.midi).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function melodyPitch(attack: PlayabilityAttack): number | null {
  const values = attack.notes.filter((note) => note.hand !== "L").map((note) => note.midi).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function bassPitch(attack: PlayabilityAttack): number | null {
  const values = attack.notes.filter((note) => note.hand === "L").map((note) => note.midi).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function hands(attack: PlayabilityAttack): Array<"L" | "R"> {
  const result: Array<"L" | "R"> = [];
  if (attack.notes.some((note) => note.hand !== "L")) result.push("R");
  if (attack.notes.some((note) => note.hand === "L")) result.push("L");
  return result;
}

function priorityFor(flags: Pick<DensityAttackSemantics, "principalMelody" | "phraseBoundary" | "contourExtremum" | "largeLeapEndpoint" | "repeatedArticulation" | "harmonicChange">): DensitySemanticPriority {
  if (flags.principalMelody || flags.phraseBoundary) return "p0-melody-or-anchor";
  if (flags.contourExtremum || flags.largeLeapEndpoint || flags.harmonicChange
    || (flags.repeatedArticulation && flags.principalMelody)) return "p1-structure";
  return "p2-support";
}

/** Derive existing-semantic protection flags from one attack stream. */
export function analyzeDensityAttacks(notes: readonly Note[]): DensityAttackAnalysis[] {
  const attacks = groupPlayabilityAttacks(notes).map((attack) => ({
    ...attack,
    notes: sortedAttackMembers(attack),
  }));
  const reps = attacks.map((attack) => melodyPitch(attack) ?? null);
  const basses = attacks.map((attack) => bassPitch(attack) ?? null);
  return attacks.map((attack, index) => {
    const previous = attacks[index - 1];
    const next = attacks[index + 1];
    const previousStart = previous?.start ?? null;
    const nextStart = next?.start ?? null;
    const phraseBoundary = index === 0
      || index === attacks.length - 1
      || (previousStart !== null && attack.start - previousStart > DENSITY_NORMALIZATION_AUDIT_CONFIG.phraseBreakBeats)
      || (nextStart !== null && nextStart - attack.start > DENSITY_NORMALIZATION_AUDIT_CONFIG.phraseBreakBeats);
    const pitch = reps[index] ?? null;
    const previousPitch = reps[index - 1] ?? null;
    const nextPitch = reps[index + 1] ?? null;
    const contourExtremum = pitch !== null
      && previousPitch !== null
      && nextPitch !== null
      && ((pitch > previousPitch && pitch > nextPitch) || (pitch < previousPitch && pitch < nextPitch));
    const largeLeapEndpoint = (previousPitch !== null && pitch !== null
      && Math.abs(pitch - previousPitch) >= DENSITY_NORMALIZATION_AUDIT_CONFIG.largeLeapSemitones)
      || (nextPitch !== null && pitch !== null
        && Math.abs(nextPitch - pitch) >= DENSITY_NORMALIZATION_AUDIT_CONFIG.largeLeapSemitones);
    const repeatedArticulation = (previousPitch !== null && pitch !== null && previousPitch === pitch)
      || (nextPitch !== null && pitch !== null && nextPitch === pitch);
    const bass = basses[index] ?? null;
    const previousBass = basses[index - 1] ?? null;
    const harmonicChange = bass !== null && previousBass !== null && bass % 12 !== previousBass % 12;
    const hasRightHand = attack.notes.some((note) => note.hand !== "L");
    const principalMelody = hasRightHand;
    const flags = { principalMelody, phraseBoundary, contourExtremum, largeLeapEndpoint, repeatedArticulation, harmonicChange };
    const priority = priorityFor(flags);
    return {
      attack,
      semantics: {
        index,
        start: attack.start,
        noteCount: attack.notes.length,
        hands: hands(attack),
        hasRightHand,
        hasLeftHand: attack.notes.some((note) => note.hand === "L"),
        representativePitch: pitch,
        bassPitch: bass,
        maxVelocity: Math.max(...attack.notes.map((note) => note.vel).filter(Number.isFinite), 0),
        phraseBoundary,
        principalMelody,
        contourExtremum,
        largeLeapEndpoint,
        repeatedArticulation,
        harmonicChange,
        priority,
        removable: priority === "p2-support",
      },
    };
  });
}

function priorityRank(priority: DensitySemanticPriority): number {
  return priority === "p2-support" ? 0 : priority === "p1-structure" ? 1 : 2;
}

function gapBeats(left: DensityAttackAnalysis, right: DensityAttackAnalysis): number {
  return right.semantics.start - left.semantics.start;
}

function chooseRemoval(left: DensityAttackAnalysis, right: DensityAttackAnalysis): DensityAttackAnalysis | null {
  const candidates = [left, right].filter((item) => item.semantics.removable);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => priorityRank(a.semantics.priority) - priorityRank(b.semantics.priority)
    || a.semantics.noteCount - b.semantics.noteCount
    || a.semantics.maxVelocity - b.semantics.maxVelocity
    || a.semantics.start - b.semantics.start
    || a.semantics.index - b.semantics.index)[0] ?? null;
}

/**
 * Candidate A diagnostic: one deterministic local thinning pass over rapid
 * attack conflicts.  It preserves P0/P1 attacks, retains original note
 * objects/times, and is never called from buildVariants.
 */
export function selectProtectedSemanticLocalThinning(
  notes: readonly Note[],
  tempoBpm: number,
  level: DifficultyLevel,
): DensitySelectionResult {
  const analyses = analyzeDensityAttacks(notes);
  if (assessPlayability(measurePlayability(notes, tempoBpm), level).status === "pass") {
    return {
      notes: notes.map((note) => ({ ...note })),
      removedAttackIndexes: [],
      analyses,
      protectedAttackCount: analyses.filter(({ semantics }) => !semantics.removable).length,
      removableAttackCount: analyses.filter(({ semantics }) => semantics.removable).length,
      retimedEvents: 0,
      createdEvents: 0,
    };
  }
  const rapidBeats = PLAYABILITY_LIMITS[level]!.minMedianIoi * tempoBpm / 60;
  const removed = new Set<number>();
  for (let index = 1; index < analyses.length; index += 1) {
    const left = analyses[index - 1]!;
    const right = analyses[index]!;
    if (gapBeats(left, right) >= rapidBeats) continue;
    const choice = chooseRemoval(left, right);
    if (choice) removed.add(choice.semantics.index);
  }
  const selected = analyses
    .filter(({ semantics }) => !removed.has(semantics.index))
    .flatMap(({ attack }) => attack.notes.map((note) => ({ ...note })));
  return {
    notes: selected,
    removedAttackIndexes: [...removed].sort((a, b) => a - b),
    analyses,
    protectedAttackCount: analyses.filter(({ semantics }) => !semantics.removable).length,
    removableAttackCount: analyses.filter(({ semantics }) => semantics.removable).length,
    retimedEvents: 0,
    createdEvents: 0,
  };
}

/**
 * Diagnostic greedy upper bound.  The finite removable pool is the edit
 * budget; no production loop is coupled to validator output.
 */
export function boundedDensityDeletionOracle(
  notes: readonly Note[],
  tempoBpm: number,
  level: DifficultyLevel,
  minimumNotes: number | null = null,
): DensityOracleResult {
  const analyses = analyzeDensityAttacks(notes);
  const initialMetrics = measurePlayability(notes, tempoBpm);
  const initialAssessment = assessPlayability(initialMetrics, level);
  const rapidBeats = PLAYABILITY_LIMITS[level]!.minMedianIoi * tempoBpm / 60;
  const candidates = analyses
    .filter(({ semantics }) => semantics.removable)
    .map((analysis) => {
      const rapidNeighbors = analyses.filter((other) => other.semantics.index !== analysis.semantics.index
        && Math.abs(other.semantics.start - analysis.semantics.start) < rapidBeats).length;
      return { analysis, rapidNeighbors };
    })
    .sort((left, right) => right.rapidNeighbors - left.rapidNeighbors
      || priorityRank(left.analysis.semantics.priority) - priorityRank(right.analysis.semantics.priority)
      || left.analysis.semantics.noteCount - right.analysis.semantics.noteCount
      || left.analysis.semantics.start - right.analysis.semantics.start
      || left.analysis.semantics.index - right.analysis.semantics.index);
  const removed = new Set<number>();
  let selected = analyses.flatMap(({ attack }) => attack.notes.map((note) => ({ ...note })));
  let finalAssessment = initialAssessment;
  for (const { analysis } of candidates) {
    if (finalAssessment.status === "pass") break;
    const next = analyses
      .filter(({ semantics }) => !removed.has(semantics.index) && semantics.index !== analysis.semantics.index)
      .flatMap(({ attack }) => attack.notes.map((note) => ({ ...note })));
    if (minimumNotes !== null && next.length < minimumNotes) continue;
    removed.add(analysis.semantics.index);
    selected = next;
    finalAssessment = assessPlayability(measurePlayability(selected, tempoBpm), level);
  }
  return {
    level,
    notes: selected,
    removedAttackIndexes: [...removed].sort((a, b) => a - b),
    analyses,
    protectedAttackCount: analyses.filter(({ semantics }) => !semantics.removable).length,
    removableAttackCount: candidates.length,
    retimedEvents: 0,
    createdEvents: 0,
    initialAssessment,
    finalAssessment,
    exhausted: finalAssessment.status !== "pass",
    minimumNotes,
  };
}

export interface DensityDifferentialRow {
  start: number;
  hand: "L" | "R" | "both";
  noteCount: number;
  representativePitch: number | null;
  maxVelocity: number;
  priority: DensitySemanticPriority;
  phraseBoundary: boolean;
  contourExtremum: boolean;
  largeLeapEndpoint: boolean;
  repeatedArticulation: boolean;
  harmonicChange: boolean;
  beforeGapBeats: number | null;
  afterGapBeats: number | null;
  resolvesRapidGap: boolean;
}

/** Compare the exact attack sets of two already-built levels. */
export function compareDensityAttackSets(
  harderNotes: readonly Note[],
  easierNotes: readonly Note[],
  tempoBpm: number,
  level: DifficultyLevel,
): { harderAttacks: number; easierAttacks: number; removed: DensityDifferentialRow[]; directResolutions: number; addedAttacks: number; removedNotes: number; addedNotes: number } {
  const harder = analyzeDensityAttacks(harderNotes);
  const easier = analyzeDensityAttacks(easierNotes);
  const easierStarts = new Set(easier.map(({ semantics }) => semantics.start.toFixed(DENSITY_NORMALIZATION_AUDIT_CONFIG.onsetDecimals)));
  const floor = PLAYABILITY_LIMITS[level]!.minMedianIoi * tempoBpm / 60;
  const removed = harder.filter(({ semantics }) => !easierStarts.has(semantics.start.toFixed(DENSITY_NORMALIZATION_AUDIT_CONFIG.onsetDecimals)))
    .map(({ semantics }) => {
      const previous = harder[semantics.index - 1];
      const next = harder[semantics.index + 1];
      const previousGapBeats = previous ? semantics.start - previous.semantics.start : null;
      const nextGapBeats = next ? next.semantics.start - semantics.start : null;
      const remaining = easier.filter(({ semantics: candidate }) => candidate.start < semantics.start);
      const nextRemaining = easier.find(({ semantics: candidate }) => candidate.start > semantics.start);
      const afterGapBeats = remaining.length && nextRemaining
        ? nextRemaining.semantics.start - remaining.at(-1)!.semantics.start
        : null;
      const hand: "L" | "R" | "both" = semantics.hasLeftHand && semantics.hasRightHand
        ? "both" : semantics.hasLeftHand ? "L" : "R";
      return {
        start: semantics.start,
        hand,
        noteCount: semantics.noteCount,
        representativePitch: semantics.representativePitch,
        maxVelocity: semantics.maxVelocity,
        priority: semantics.priority,
        phraseBoundary: semantics.phraseBoundary,
        contourExtremum: semantics.contourExtremum,
        largeLeapEndpoint: semantics.largeLeapEndpoint,
        repeatedArticulation: semantics.repeatedArticulation,
        harmonicChange: semantics.harmonicChange,
        beforeGapBeats: previousGapBeats ?? nextGapBeats,
        afterGapBeats,
        resolvesRapidGap: ((previousGapBeats ?? Infinity) < floor || (nextGapBeats ?? Infinity) < floor)
          && (afterGapBeats === null || afterGapBeats >= floor),
      } satisfies DensityDifferentialRow;
    });
  const harderStarts = new Set(harder.map(({ semantics }) => semantics.start.toFixed(DENSITY_NORMALIZATION_AUDIT_CONFIG.onsetDecimals)));
  const added = easier.filter(({ semantics }) => !harderStarts.has(semantics.start.toFixed(DENSITY_NORMALIZATION_AUDIT_CONFIG.onsetDecimals)));
  return {
    harderAttacks: harder.length,
    easierAttacks: easier.length,
    removed,
    directResolutions: removed.filter((row) => row.resolvesRapidGap).length,
    addedAttacks: added.length,
    removedNotes: removed.reduce((sum, row) => sum + row.noteCount, 0),
    addedNotes: added.reduce((sum, row) => sum + row.semantics.noteCount, 0),
  };
}
