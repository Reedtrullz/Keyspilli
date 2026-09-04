import { PLAYABILITY_LIMITS } from "./validate.js";
import type { DifficultyLevel, Note } from "./types.js";

/**
 * Diagnostic definitions used to explain the playability gate.  The
 * production validator remains the authority; these measurements do not
 * change acceptance or note selection.
 */
export const PLAYABILITY_AUDIT_CONFIG = {
  onsetKeyDecimals: 3,
  onsetToleranceBeats: 0.08,
  rapidIoiSeconds: 0.08,
  shortWindowSeconds: 0.5,
} as const;

export interface PlayabilityIoiSummary {
  count: number;
  minSeconds: number | null;
  p01Seconds: number | null;
  p05Seconds: number | null;
  p10Seconds: number | null;
  p25Seconds: number | null;
  medianIoiSeconds: number | null;
  p75Seconds: number | null;
  p90Seconds: number | null;
  p95Seconds: number | null;
  meanSeconds: number | null;
  rapidIoiCount: number;
  rapidIoiFraction: number;
  attacksPerSecond: number;
  maxShortWindowAttacksPerSecond: number;
}

export interface PlayabilityHandMetrics extends PlayabilityIoiSummary {
  noteCount: number;
  onsetCount: number;
  maxSimultaneous: number;
  maxSounding: number;
}

export interface PlayabilityRapidRegion {
  startBeat: number;
  endBeat: number;
  durationSeconds: number;
  rapidIoiCount: number;
  rightHandAttacks: number;
  leftHandAttacks: number;
  sources: string[];
}

export interface PlayabilityAuditMetrics {
  noteCount: number;
  validNoteCount: number;
  invalidNoteCount: number;
  durationBeats: number;
  durationSeconds: number;
  /** Exact three-decimal onset keys used by validateVariants(). */
  global: PlayabilityHandMetrics;
  hands: { R: PlayabilityHandMetrics; L: PlayabilityHandMetrics };
  /** A separate jitter diagnostic; it is not the production gate key. */
  toleranceOnsetCount: number;
  simultaneousChordAttacks: number;
  samePitchRearticulationOnsets: number;
  alternatingHandAttacks: number;
  bursts: {
    rapidIoiCount: number;
    rapidIoiFraction: number;
    longestRapidRun: number;
    longestRapidRegionSeconds: number;
    rapidRegions: PlayabilityRapidRegion[];
  };
  rapidSourceEdges: Record<string, number>;
}

export interface PlayabilityAssessment {
  level: DifficultyLevel;
  status: "pass" | "fail";
  limits: { maxSim: number; maxDensity: number; minMedianIoi: number };
  passes: { maxSim: boolean; maxDensity: boolean; medianIoi: boolean };
  failures: string[];
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function validNotes(notes: readonly Note[]): Note[] {
  return notes.filter((note) => Number.isFinite(note.start) && note.start >= 0
    && Number.isFinite(note.dur) && note.dur > 0);
}

function exactOnsetStarts(notes: readonly Note[]): number[] {
  return [...new Set(notes.map((note) => note.start.toFixed(PLAYABILITY_AUDIT_CONFIG.onsetKeyDecimals)))]
    .map(Number)
    .sort((a, b) => a - b);
}

function toleranceOnsetStarts(notes: readonly Note[]): number[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const starts: number[] = [];
  for (const note of sorted) {
    const previous = starts.at(-1);
    if (previous === undefined || note.start - previous > PLAYABILITY_AUDIT_CONFIG.onsetToleranceBeats + 1e-9) {
      starts.push(note.start);
    }
  }
  return starts;
}

function notesByExactStart(notes: readonly Note[]): Note[][] {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = note.start.toFixed(PLAYABILITY_AUDIT_CONFIG.onsetKeyDecimals);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, group]) => group);
}

function maxSounding(notes: readonly Note[]): number {
  const events = notes
    .flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let sounding = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    sounding += delta;
    maximum = Math.max(maximum, sounding);
  }
  return maximum;
}

function maxShortWindowAttacksPerSecond(starts: readonly number[], tempoBpm: number): number {
  if (!starts.length || !Number.isFinite(tempoBpm) || tempoBpm <= 0) return 0;
  const seconds = starts.map((start) => start * 60 / tempoBpm);
  const window = PLAYABILITY_AUDIT_CONFIG.shortWindowSeconds;
  let right = 0;
  let maximum = 0;
  for (let left = 0; left < seconds.length; left++) {
    while (right < seconds.length && seconds[right]! - seconds[left]! < window - 1e-9) right++;
    maximum = Math.max(maximum, right - left);
  }
  return round(maximum / window);
}

function ioiSummary(notes: readonly Note[], tempoBpm: number, durationSeconds: number): PlayabilityIoiSummary {
  const starts = exactOnsetStarts(notes);
  const gapsSeconds = starts.slice(1).map((start, index) => (start - starts[index]!) * 60 / tempoBpm);
  const rapidIoiCount = gapsSeconds.filter((gap) => gap < PLAYABILITY_AUDIT_CONFIG.rapidIoiSeconds).length;
  const count = gapsSeconds.length;
  return {
    count,
    minSeconds: quantile(gapsSeconds, 0),
    p01Seconds: quantile(gapsSeconds, 0.01),
    p05Seconds: quantile(gapsSeconds, 0.05),
    p10Seconds: quantile(gapsSeconds, 0.1),
    p25Seconds: quantile(gapsSeconds, 0.25),
    medianIoiSeconds: quantile(gapsSeconds, 0.5),
    p75Seconds: quantile(gapsSeconds, 0.75),
    p90Seconds: quantile(gapsSeconds, 0.9),
    p95Seconds: quantile(gapsSeconds, 0.95),
    meanSeconds: count ? round(gapsSeconds.reduce((sum, gap) => sum + gap, 0) / count) : null,
    rapidIoiCount,
    rapidIoiFraction: count ? round(rapidIoiCount / count) : 0,
    attacksPerSecond: durationSeconds > 0 ? round(starts.length / durationSeconds) : 0,
    maxShortWindowAttacksPerSecond: maxShortWindowAttacksPerSecond(starts, tempoBpm),
  };
}

function handMetrics(notes: readonly Note[], tempoBpm: number, durationSeconds: number): PlayabilityHandMetrics {
  const groups = notesByExactStart(notes);
  const summary = ioiSummary(notes, tempoBpm, durationSeconds);
  return {
    ...summary,
    noteCount: notes.length,
    onsetCount: groups.length,
    maxSimultaneous: Math.max(0, ...groups.map((group) => group.length)),
    maxSounding: maxSounding(notes),
  };
}

function sourceName(note: Note): string {
  return note.identitySource ?? "unknown";
}

function burstMetrics(notes: readonly Note[], tempoBpm: number): Pick<PlayabilityAuditMetrics, "bursts" | "rapidSourceEdges"> {
  const groups = notesByExactStart(notes);
  const starts = groups.map((group) => group[0]!.start);
  const gapSeconds = starts.slice(1).map((start, index) => (start - starts[index]!) * 60 / tempoBpm);
  const rapid = gapSeconds.map((gap) => gap < PLAYABILITY_AUDIT_CONFIG.rapidIoiSeconds);
  const rapidIoiCount = rapid.filter(Boolean).length;
  const regions: PlayabilityRapidRegion[] = [];
  const rapidSourceEdges: Record<string, number> = {};
  let longestRapidRun = 0;
  let runStart: number | undefined;
  let runLength = 0;
  const finishRun = (endGapIndex: number) => {
    if (runStart === undefined) return;
    const endGroup = endGapIndex;
    const regionGroups = groups.slice(runStart, endGroup + 1);
    const sources = [...new Set(regionGroups.flatMap((group) => group.map(sourceName)))].sort();
    regions.push({
      startBeat: starts[runStart]!,
      endBeat: starts[endGroup]!,
      durationSeconds: round((starts[endGroup]! - starts[runStart]!) * 60 / tempoBpm),
      rapidIoiCount: endGapIndex - runStart,
      rightHandAttacks: regionGroups.filter((group) => group.some((note) => note.hand !== "L")).length,
      leftHandAttacks: regionGroups.filter((group) => group.some((note) => note.hand === "L")).length,
      sources,
    });
    longestRapidRun = Math.max(longestRapidRun, runLength);
    runStart = undefined;
    runLength = 0;
  };
  for (let index = 0; index < rapid.length; index++) {
    if (rapid[index]) {
      if (runStart === undefined) runStart = index;
      runLength++;
      const left = groups[index]!;
      const right = groups[index + 1]!;
      for (const source of new Set([...left, ...right].map(sourceName))) {
        rapidSourceEdges[source] = (rapidSourceEdges[source] ?? 0) + 1;
      }
    } else {
      finishRun(index);
    }
  }
  finishRun(rapid.length);
  const longestRapidRegionSeconds = Math.max(0, ...regions.map((region) => region.durationSeconds));
  return {
    bursts: {
      rapidIoiCount,
      rapidIoiFraction: gapSeconds.length ? round(rapidIoiCount / gapSeconds.length) : 0,
      longestRapidRun,
      longestRapidRegionSeconds,
      rapidRegions: regions,
    },
    rapidSourceEdges: Object.fromEntries(Object.entries(rapidSourceEdges).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
  };
}

function samePitchRearticulationOnsets(groups: readonly Note[][]): number {
  let count = 0;
  for (let index = 1; index < groups.length; index++) {
    const previous = new Set(groups[index - 1]!.map((note) => note.midi));
    if (groups[index]!.some((note) => previous.has(note.midi))) count++;
  }
  return count;
}

function alternatingHandAttacks(groups: readonly Note[][]): number {
  const state = (group: Note[]): "R" | "L" | "B" => {
    const right = group.some((note) => note.hand !== "L");
    const left = group.some((note) => note.hand === "L");
    return right && left ? "B" : left ? "L" : "R";
  };
  const states = groups.map(state);
  return states.slice(1).filter((current, index) => current !== "B" && states[index] !== "B" && current !== states[index]).length;
}

/** Measure the existing validator's attack semantics plus non-gating diagnostics. */
export function measurePlayability(notes: readonly Note[], tempoBpm: number, durationBeats?: number): PlayabilityAuditMetrics {
  const safeTempo = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120;
  const valid = validNotes(notes);
  const duration = Number.isFinite(durationBeats) && durationBeats! > 0
    ? durationBeats!
    : Math.max(0, ...valid.map((note) => note.start + note.dur));
  const durationSeconds = duration * 60 / safeTempo;
  const groups = notesByExactStart(valid);
  const right = valid.filter((note) => note.hand !== "L");
  const left = valid.filter((note) => note.hand === "L");
  const global = handMetrics(valid, safeTempo, durationSeconds);
  const bursts = burstMetrics(valid, safeTempo);
  return {
    noteCount: notes.length,
    validNoteCount: valid.length,
    invalidNoteCount: notes.length - valid.length,
    durationBeats: round(duration),
    durationSeconds: round(durationSeconds),
    global,
    hands: {
      R: handMetrics(right, safeTempo, durationSeconds),
      L: handMetrics(left, safeTempo, durationSeconds),
    },
    toleranceOnsetCount: toleranceOnsetStarts(valid).length,
    simultaneousChordAttacks: groups.filter((group) => group.length > 1).length,
    samePitchRearticulationOnsets: samePitchRearticulationOnsets(groups),
    alternatingHandAttacks: alternatingHandAttacks(groups),
    bursts: bursts.bursts,
    rapidSourceEdges: bursts.rapidSourceEdges,
  };
}

/** Report-only view of the current validator's three density/IOI checks. */
export function assessPlayability(metrics: PlayabilityAuditMetrics, level: DifficultyLevel): PlayabilityAssessment {
  const limits = PLAYABILITY_LIMITS[level]!;
  const passes = {
    maxSim: metrics.global.maxSimultaneous <= limits.maxSim && metrics.global.maxSounding <= limits.maxSim,
    maxDensity: metrics.global.attacksPerSecond <= limits.maxDensity,
    medianIoi: metrics.global.medianIoiSeconds === null || metrics.global.medianIoiSeconds >= limits.minMedianIoi,
  };
  const failures: string[] = [];
  if (!passes.maxSim) failures.push(`${level}: simultaneous/sounding notes exceed limit ${limits.maxSim}`);
  if (!passes.maxDensity) failures.push(`${level}: attacks/sec exceed limit ${limits.maxDensity}`);
  if (!passes.medianIoi) failures.push(`${level}: median inter-onset below floor ${limits.minMedianIoi}s`);
  return { level, status: Object.values(passes).every(Boolean) ? "pass" : "fail", limits, passes, failures };
}
