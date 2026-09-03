import {
  PLAYABILITY_LIMITS,
  validateVariants,
  verifyMonotonicity,
  type DifficultyLevel,
  type Note,
  type Variant,
} from "@keyspilli/midi";
import {
  evaluateArrangement,
  type ProvenanceTraceEvent,
} from "./arrangement-evaluation.js";

/** The diagnostic uses the same onset and phrase boundaries as the learner. */
export const COVER_RH_CLIFF_CONFIG = {
  schemaVersion: 1,
  onsetToleranceBeats: 0.08,
  phraseBreakBeats: 1.5,
  gridBeats: 0.25,
  significantVelocityQuantile: 0.75,
  significantDurationQuantile: 0.75,
  repeatedGapBeats: 0.5,
} as const;

export type CliffReportStatus = "ready" | "partial" | "unavailable";
export type CliffFate =
  | "RETAINED_1_TO_1"
  | "MERGED"
  | "COLLAPSED"
  | "REPLACED"
  | "PITCH_CHANGED"
  | "TIMING_CHANGED"
  | "DURATION_CHANGED"
  | "REJECTED";

export interface CliffSourceMetadata {
  bytes?: number;
  sha256?: string;
  noteCount: number;
  onsetCount: number;
  tempoBpm: number;
  timeSig: [number, number];
  durationBeats: number;
}

export interface CliffLevelSummary {
  level: DifficultyLevel;
  digest?: string;
  notes: number;
  rightHandNotes: number;
  leftHandNotes: number;
  onsets: number;
  rightHandOnsets: number;
  leftHandOnsets: number;
  attacksPerSecond: number;
  maxSimultaneity: number;
  rightHandSpan: number | null;
  p95RightHandLeap: number | null;
  repeatedAttackRate: number;
}

export interface CliffStageSummary {
  stage: string;
  traceStage: string;
  events: number;
  selected: number;
  rejected: number;
  rightHandSelected: number;
  rightHandRejected: number;
  operationCounts: Record<string, number>;
  selectionReasonCounts: Record<string, number>;
  rootAncestryCount: number;
}

export interface CliffFunnel {
  stages: CliffStageSummary[];
  firstLossCounts: Record<string, number>;
  firstLossExamples: Array<{ sourceKey: string; stage: string; reason: string | null }>;
}

export interface RhStructureMetrics {
  events: number;
  onsets: number;
  eventsPerOnset: { mean: number | null; p50: number | null; p90: number | null; max: number };
  onsetGroups: { one: number; two: number; threePlus: number; multiRate: number };
  samePitchReattacks: { count: number; rate: number };
  ioiBeats: { median: number | null; p90: number | null; min: number | null };
  durationBeats: { p50: number | null; p90: number | null };
  pitchClassMultiplicity: { mean: number | null; p90: number | null };
  representative: { p95Leap: number | null; largeLeapCount: number; pitches: number[] };
  velocity: { p50: number | null; p90: number | null };
  gridAlignment: { quarter: number; eighth: number };
  phrases: { count: number; starts: number; ends: number; meanEvents: number | null };
  anchors: number;
  turns: number;
  localExtrema: number;
}

export interface RhIdentitySemantics {
  eventCount: { harder: number; easier: number; shared: number; survival: number | null };
  onsetCount: { harder: number; easier: number; shared: number; survival: number | null };
  pitchClass: { sharedOnsets: number; survival: number | null };
  representative: { sharedOnsets: number; survival: number | null };
  phrase: { starts: number; ends: number; anchorSurvival: number | null };
  contour: { turns: number; turnSurvival: number | null; extrema: number; extremaSurvival: number | null };
  repeatedAttacks: { harder: number; shared: number; survival: number | null };
}

export interface CliffEventFate {
  sourceKey: string;
  sourceStart: number;
  sourceMidi: number;
  fate: CliffFate;
  firstLossStage: string | null;
  operation: string | null;
  sameOnsetSurvivor: { key: string; start: number; midi: number } | null;
  nearestSurvivor: { key: string; start: number; midi: number } | null;
}

export interface CliffOracleResult {
  baselineIdentity: RhIdentitySemantics;
  oracleIdentity: RhIdentitySemantics;
  baseline: { notes: number; onsets: number; attacksPerSecond: number; maxSimultaneity: number; rightHandSpan: number | null };
  upperBound: { notes: number; onsets: number; attacksPerSecond: number; maxSimultaneity: number; rightHandSpan: number | null };
  recoverableEvents: number;
  structurallySignificantLostEvents: number;
  constraintBoundEvents: number;
  complexityDelta: { notes: number; onsets: number; attacksPerSecond: number; maxSimultaneity: number; rightHandSpan: number | null };
  violations: string[];
}

export interface CliffCounterfactualResult {
  bypassedStage: "beginner-ladder";
  candidate: { rightHandNotes: number; leftHandNotes: number; totalNotes: number; rightHandOnsets: number };
  baseline: { rightHandNotes: number; leftHandNotes: number; totalNotes: number; rightHandOnsets: number };
  complexityDelta: { notes: number; onsets: number; attacksPerSecond: number; maxSimultaneity: number; rightHandSpan: number | null };
  violations: string[];
  variantValidationErrors: string[];
  monotonicityErrors: string[];
}

export interface CliffFixtureInput {
  fixture: { id: string; label?: string };
  source: Note[];
  sourceMetadata?: CliffSourceMetadata;
  variants: Variant[];
  trace?: ProvenanceTraceEvent[];
  revision?: string;
  digests?: Record<string, string>;
}

export interface CoverRhCliffReport {
  schemaVersion: 1;
  mission: "CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION";
  status: CliffReportStatus;
  fixture: { id: string; label?: string };
  revision?: string;
  config: typeof COVER_RH_CLIFF_CONFIG;
  source: CliffSourceMetadata;
  levels: Record<string, CliffLevelSummary>;
  funnel: CliffFunnel;
  transition: { harder: "very-easy"; easier: "beginner"; identity: RhIdentitySemantics; fates: CliffEventFate[]; fateCounts: Record<string, number> };
  structure: { source: RhStructureMetrics; veryEasy: RhStructureMetrics; beginner: RhStructureMetrics; comparison: Record<string, number | null> };
  lossSemantics: { eventCountSurvival: number | null; onsetPositionSurvival: number | null; pitchClassSurvival: number | null; representativeSurvival: number | null; anchorSurvival: number | null; turnSurvival: number | null; localExtremaSurvival: number | null; repeatedAttackSurvival: number | null };
  playability: { structurallySignificantLostEvents: number; recoverableWithinCurrentEnvelope: number; constraintBound: number };
  oracle: CliffOracleResult;
  counterfactual: CliffCounterfactualResult | null;
  beginnerToEasy: { beginner: CliffLevelSummary; easy: CliffLevelSummary; delta: { notes: number; onsets: number; attacksPerSecond: number; maxSimultaneity: number; rightHandSpan: number | null } } | null;
  characterization: { classification: "COVER_ENCODING_STYLE_OUTLIER" | "COVER_BEGINNER_CONSTRAINT_OUTLIER" | "MIXED" | "INCONCLUSIVE"; evidence: string[] };
  decision: "COVER_RH_GENERIC_SELECTOR_DEFECT_CONFIRMED" | "COVER_RH_ENCODING_STYLE_OUTLIER" | "COVER_RH_IDENTITY_CLIFF_CONSTRAINT_BOUND" | "COVER_RH_METRIC_CLIFF_NOT_MUSICAL_CLIFF" | "COVER_RH_CAUSE_INSUFFICIENT";
  behavior: "NO_MUSICAL_BEHAVIOR_CHANGE";
  publicLadder: { levels: ["very-beginner", "beginner", "easy", "medium", "advanced"]; physicalLevels: typeof import("@keyspilli/midi").LEVEL_ORDER };
}

type Group = { start: number; notes: Note[] };

function redactText(value: string): string {
  return value.replace(/(?:file:\/\/)?(?:\/Users\/|\/private\/tmp\/|[A-Za-z]:[\\/])[^\s"']+/g, "<redacted-path>");
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finiteNote(note: Note | undefined): note is Note {
  if (!note) return false;
  return Number.isInteger(note.midi) && Number.isFinite(note.start) && Number.isFinite(note.dur)
    && Number.isFinite(note.vel) && note.start >= 0 && note.dur > 0;
}

function asNote(event: ProvenanceTraceEvent): Note | null {
  if (!event.note) return null;
  return finiteNote(event.note as Note) ? { ...event.note } as Note : null;
}

function quantile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low));
}

function onsetGroups(notes: Note[]): Group[] {
  const sorted = notes.filter(finiteNote).sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || b.vel - a.vel);
  const groups: Group[] = [];
  for (const note of sorted) {
    const group = groups.at(-1);
    if (!group || note.start - group.start > COVER_RH_CLIFF_CONFIG.onsetToleranceBeats + 1e-9) groups.push({ start: note.start, notes: [note] });
    else group.notes.push(note);
  }
  return groups;
}

function representativePitches(groups: Group[]): number[] {
  return groups.map((group) => Math.max(...group.notes.map((note) => note.midi)));
}

function phrases(groups: Group[]): Group[][] {
  const out: Group[][] = [];
  for (const group of groups) {
    const previous = out.at(-1);
    if (!previous || group.start - previous.at(-1)!.start > COVER_RH_CLIFF_CONFIG.phraseBreakBeats + 1e-9) out.push([group]);
    else previous.push(group);
  }
  return out;
}

function structure(notes: Note[], tempoBpm = 120): RhStructureMetrics {
  const valid = notes.filter(finiteNote);
  const groups = onsetGroups(valid);
  const sizes = groups.map((group) => group.notes.length);
  const pitches = representativePitches(groups);
  const iois = groups.slice(1).map((group, index) => group.start - groups[index]!.start);
  const starts = groups.map((group) => group.start);
  const phraseList = phrases(groups);
  const turns = pitches.slice(1, -1).reduce((count, pitch, index) => {
    const into = Math.sign(pitch - pitches[index]!);
    const out = Math.sign(pitches[index + 2]! - pitch);
    return count + (into !== 0 && out !== 0 && into !== out ? 1 : 0);
  }, 0);
  const extrema = turns;
  const reattacks = pitches.slice(1).filter((pitch, index) => pitch === pitches[index]).length;
  const intervals = pitches.slice(1).map((pitch, index) => Math.abs(pitch - pitches[index]!));
  const gridRate = (grid: number) => starts.length ? starts.filter((start) => Math.abs(start / grid - Math.round(start / grid)) <= 0.02).length / starts.length : 0;
  const phraseEvents = phraseList.map((phrase) => phrase.reduce((sum, group) => sum + group.notes.length, 0));
  const anchors = phraseList.length ? phraseList.length * 2 - (groups.length ? 0 : 0) : 0;
  return {
    events: valid.length,
    onsets: groups.length,
    eventsPerOnset: { mean: sizes.length ? round(sizes.reduce((sum, size) => sum + size, 0) / sizes.length) : null, p50: quantile(sizes, 0.5), p90: quantile(sizes, 0.9), max: sizes.length ? Math.max(...sizes) : 0 },
    onsetGroups: { one: sizes.filter((size) => size === 1).length, two: sizes.filter((size) => size === 2).length, threePlus: sizes.filter((size) => size >= 3).length, multiRate: groups.length ? sizes.filter((size) => size > 1).length / groups.length : 0 },
    samePitchReattacks: { count: reattacks, rate: pitches.length > 1 ? reattacks / (pitches.length - 1) : 0 },
    ioiBeats: { median: quantile(iois, 0.5), p90: quantile(iois, 0.9), min: iois.length ? Math.min(...iois) : null },
    durationBeats: { p50: quantile(valid.map((note) => note.dur), 0.5), p90: quantile(valid.map((note) => note.dur), 0.9) },
    pitchClassMultiplicity: { mean: groups.length ? round(groups.reduce((sum, group) => sum + new Set(group.notes.map((note) => ((note.midi % 12) + 12) % 12)).size, 0) / groups.length) : null, p90: quantile(groups.map((group) => new Set(group.notes.map((note) => ((note.midi % 12) + 12) % 12)).size), 0.9) },
    representative: { p95Leap: quantile(intervals, 0.95), largeLeapCount: intervals.filter((interval) => interval >= 7).length, pitches },
    velocity: { p50: quantile(valid.map((note) => note.vel), 0.5), p90: quantile(valid.map((note) => note.vel), 0.9) },
    gridAlignment: { quarter: round(gridRate(0.25)) ?? 0, eighth: round(gridRate(0.125)) ?? 0 },
    phrases: { count: phraseList.length, starts: phraseList.length ? phraseList.length : 0, ends: phraseList.length ? phraseList.length : 0, meanEvents: quantile(phraseEvents, 0.5) },
    anchors,
    turns,
    localExtrema: extrema,
  };
}

function sourceCounts(source: Note[], easier: Note[]): RhIdentitySemantics {
  const harderRh = source.filter((note) => note.hand !== "L");
  const easierRh = easier.filter((note) => note.hand !== "L");
  const harderGroups = onsetGroups(harderRh);
  const easierGroups = onsetGroups(easierRh);
  const used = new Set<number>();
  const pairs: Array<{ harder: Group; easier: Group }> = [];
  for (const group of harderGroups) {
    const index = easierGroups.findIndex((candidate, candidateIndex) => !used.has(candidateIndex)
      && Math.abs(candidate.start - group.start) <= COVER_RH_CLIFF_CONFIG.onsetToleranceBeats + 1e-9);
    if (index >= 0) { used.add(index); pairs.push({ harder: group, easier: easierGroups[index]! }); }
  }
  const sharedEvents = eventMatches(harderRh, easierRh).length;
  const harderPitches = representativePitches(harderGroups);
  const pitchClass = pairs.filter((pair) => {
    const classes = new Set(pair.harder.notes.map((note) => ((note.midi % 12) + 12) % 12));
    return pair.easier.notes.some((note) => classes.has(((note.midi % 12) + 12) % 12));
  }).length;
  const representative = pairs.filter((pair) => Math.max(...pair.harder.notes.map((note) => note.midi)) === Math.max(...pair.easier.notes.map((note) => note.midi))).length;
  const sourcePhrase = structure(source.filter((note) => note.hand !== "L"));
  const easyPhrase = structure(easier.filter((note) => note.hand !== "L"));
  const sourceRepeated = sourcePhrase.samePitchReattacks.count;
  const sharedRepeated = pairs.reduce((count, pair, index) => {
    if (!index) return count;
    const previous = pairs[index - 1]!;
    const sourceRepeatedHere = Math.max(...pair.harder.notes.map((note) => note.midi)) === Math.max(...previous.harder.notes.map((note) => note.midi));
    const easyRepeatedHere = Math.max(...pair.easier.notes.map((note) => note.midi)) === Math.max(...previous.easier.notes.map((note) => note.midi));
    return count + (sourceRepeatedHere && easyRepeatedHere ? 1 : 0);
  }, 0);
  const sourcePhraseStarts = sourcePhrase.phrases.starts;
  const sourcePhraseEnds = sourcePhrase.phrases.ends;
  const matchedStarts = Math.min(sourcePhraseStarts, easyPhrase.phrases.starts);
  const matchedEnds = Math.min(sourcePhraseEnds, easyPhrase.phrases.ends);
  const matchedTurns = countContourSurvival(harderPitches, pairs.map((pair) => Math.max(...pair.easier.notes.map((note) => note.midi))), "turn");
  const matchedExtrema = countContourSurvival(harderPitches, pairs.map((pair) => Math.max(...pair.easier.notes.map((note) => note.midi))), "extrema");
  const sharedOnsets = pairs.length;
  return {
    eventCount: { harder: harderRh.length, easier: easierRh.length, shared: sharedEvents, survival: harderRh.length ? sharedEvents / harderRh.length : null },
    onsetCount: { harder: harderGroups.length, easier: easierGroups.length, shared: sharedOnsets, survival: harderGroups.length ? sharedOnsets / harderGroups.length : null },
    pitchClass: { sharedOnsets: pitchClass, survival: harderGroups.length ? pitchClass / harderGroups.length : null },
    representative: { sharedOnsets: representative, survival: harderGroups.length ? representative / harderGroups.length : null },
    phrase: { starts: matchedStarts, ends: matchedEnds, anchorSurvival: sourcePhrase.anchors ? (matchedStarts + matchedEnds) / sourcePhrase.anchors : null },
    contour: { turns: sourcePhrase.turns, turnSurvival: sourcePhrase.turns ? matchedTurns / sourcePhrase.turns : null, extrema: sourcePhrase.localExtrema, extremaSurvival: sourcePhrase.localExtrema ? matchedExtrema / sourcePhrase.localExtrema : null },
    repeatedAttacks: { harder: sourceRepeated, shared: sharedRepeated, survival: sourceRepeated ? sharedRepeated / sourceRepeated : null },
  };
}

function countContourSurvival(source: number[], target: number[], kind: "turn" | "extrema"): number {
  let total = 0;
  for (let index = 1; index < source.length - 1; index++) {
    const into = Math.sign(source[index]! - source[index - 1]!);
    const out = Math.sign(source[index + 1]! - source[index]!);
    const interesting = kind === "turn" ? into !== 0 && out !== 0 && into !== out : (source[index]! > source[index - 1]! && source[index]! > source[index + 1]!) || (source[index]! < source[index - 1]! && source[index]! < source[index + 1]!);
    if (!interesting || target[index] === undefined || target[index - 1] === undefined || target[index + 1] === undefined) continue;
    const targetInto = Math.sign(target[index]! - target[index - 1]!);
    const targetOut = Math.sign(target[index + 1]! - target[index]!);
    if (kind === "turn" ? targetInto !== 0 && targetOut !== 0 && targetInto !== targetOut : (target[index]! > target[index - 1]! && target[index]! > target[index + 1]!) || (target[index]! < target[index - 1]! && target[index]! < target[index + 1]!)) total++;
  }
  return total;
}

function eventMatches(harder: Note[], easier: Note[]): Array<{ harder: Note; easier: Note }> {
  const used = new Set<number>();
  const matches: Array<{ harder: Note; easier: Note }> = [];
  const sortedEasier = [...easier].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || b.vel - a.vel);
  for (const source of [...harder].sort((a, b) => a.start - b.start || a.midi - b.midi)) {
    const index = sortedEasier.findIndex((candidate, candidateIndex) => !used.has(candidateIndex)
      && candidate.midi === source.midi
      && Math.abs(candidate.start - source.start) <= COVER_RH_CLIFF_CONFIG.onsetToleranceBeats + 1e-9);
    if (index >= 0) { used.add(index); matches.push({ harder: source, easier: sortedEasier[index]! }); }
  }
  return matches;
}

function operationCounts(events: ProvenanceTraceEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) { const key = event.operation ?? "UNKNOWN"; counts[key] = (counts[key] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function reasonCounts(events: ProvenanceTraceEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) { const key = event.selectionReason ?? "UNKNOWN"; counts[key] = (counts[key] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function roots(
  event: ProvenanceTraceEvent,
  byKey: Map<string, ProvenanceTraceEvent>,
  memo: Map<string, Set<string>>,
  visiting = new Set<string>(),
): Set<string> {
  const cached = memo.get(event.key);
  if (cached) return cached;
  if (visiting.has(event.key)) return new Set([event.key]);
  visiting.add(event.key);
  const result = new Set<string>();
  if (event.parentKeys?.length) {
    for (const parent of event.parentKeys) {
      const parentEvent = byKey.get(parent);
      if (parentEvent) for (const root of roots(parentEvent, byKey, memo, visiting)) result.add(root);
      else result.add(parent);
    }
  } else result.add(event.key);
  visiting.delete(event.key);
  memo.set(event.key, result);
  return result;
}

function stageEvents(trace: ProvenanceTraceEvent[], stage: string): ProvenanceTraceEvent[] {
  return trace.filter((event) => event.stage === stage);
}

function selectedRootSet(events: ProvenanceTraceEvent[], byKey: Map<string, ProvenanceTraceEvent>, memo: Map<string, Set<string>>): Set<string> {
  const result = new Set<string>();
  for (const event of events) if (event.selected !== false) for (const root of roots(event, byKey, memo)) result.add(root);
  return result;
}

function traceFunnel(trace: ProvenanceTraceEvent[] | undefined): { funnel: CliffFunnel; fates: CliffEventFate[] } {
  if (!trace?.length) return { funnel: { stages: [], firstLossCounts: {}, firstLossExamples: [] }, fates: [] };
  const byKey = new Map(trace.map((event) => [event.key, event]));
  const memo = new Map<string, Set<string>>();
  const stageSequence = [
    ["very-easy-rh-input", "very-easy-rh-input"],
    ["very-easy-playable", "very-easy-playable"],
    ["beginner-rh-input", "beginner-rh-input"],
    ["beginner-rh-selected", "beginner-rh-selected"],
    ["beginner-playable", "beginner-playable"],
    ["beginner-ladder", "beginner-ladder"],
    ["beginner-final", "beginner-final"],
  ] as const;
  const stages: CliffStageSummary[] = stageSequence.map(([label, stage]) => {
    const events = stageEvents(trace, stage);
    const selected = events.filter((event) => event.selected !== false);
    const rejected = events.filter((event) => event.selected === false);
    return { stage: label, traceStage: stage, events: events.length, selected: selected.length, rejected: rejected.length, rightHandSelected: selected.filter((event) => event.note?.hand !== "L").length, rightHandRejected: rejected.filter((event) => event.note?.hand !== "L").length, operationCounts: operationCounts(events), selectionReasonCounts: reasonCounts(events), rootAncestryCount: selectedRootSet(selected, byKey, memo).size };
  });
  const veEvents = trace.filter((event) => event.stage === "difficulty" && event.key.startsWith("difficulty:very-easy:") && event.selected !== false && event.note?.hand !== "L");
  const beginnerEvents = trace.filter((event) => event.stage === "difficulty" && event.key.startsWith("difficulty:beginner:") && event.selected !== false && event.note?.hand !== "L");
  const selectedByStage = new Map(stageSequence.map(([label, stage]) => [label, selectedRootSet(stageEvents(trace, stage), byKey, memo)]));
  const rejectedByStage = new Map(stageSequence.map(([label, stage]) => [label, stageEvents(trace, stage).filter((event) => event.selected === false)]));
  const firstLossCounts: Record<string, number> = {};
  const firstLossExamples: Array<{ sourceKey: string; stage: string; reason: string | null }> = [];
  const fates: CliffEventFate[] = [];
  for (const source of veEvents) {
    const sourceRoots = roots(source, byKey, memo);
    let firstLossStage: string | null = null;
    let lossReason: string | null = null;
    for (const [label] of stageSequence) {
      const selectedRoots = selectedByStage.get(label)!;
      if (![...sourceRoots].some((root) => selectedRoots.has(root))) {
        firstLossStage = label;
        const rejected = rejectedByStage.get(label)!.find((event) => [...roots(event, byKey, memo)].some((root) => sourceRoots.has(root)));
        lossReason = rejected?.selectionReason ?? rejected?.operation ?? null;
        break;
      }
    }
    const matching = beginnerEvents.filter((candidate) => [...roots(candidate, byKey, memo)].some((root) => sourceRoots.has(root)));
    const sameOnset = beginnerEvents.find((candidate) => candidate.note && source.note && Math.abs(candidate.note.start - source.note.start) <= COVER_RH_CLIFF_CONFIG.onsetToleranceBeats + 1e-9);
    const nearest = [...beginnerEvents].sort((a, b) => {
      const an = a.note && source.note ? Math.abs(a.note.start - source.note.start) * 10 + Math.abs(a.note.midi - source.note.midi) : Infinity;
      const bn = b.note && source.note ? Math.abs(b.note.start - source.note.start) * 10 + Math.abs(b.note.midi - source.note.midi) : Infinity;
      return an - bn || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    })[0];
    let fate: CliffFate;
    let operation: string | null = matching[0]?.operation ?? null;
    if (!matching.length) fate = firstLossStage ? (lossReason?.toUpperCase().includes("COLLAP") ? "COLLAPSED" : "REJECTED") : "REJECTED";
    else if (matching.length > 1) fate = "MERGED";
    else if (!source.note || !matching[0]!.note) fate = "REPLACED";
    else if (source.note.midi !== matching[0]!.note!.midi) fate = "PITCH_CHANGED";
    else if (Math.abs(source.note.start - matching[0]!.note!.start) > COVER_RH_CLIFF_CONFIG.onsetToleranceBeats) fate = "TIMING_CHANGED";
    else if (Math.abs(source.note.dur - matching[0]!.note!.dur) > 1e-9) fate = "DURATION_CHANGED";
    else fate = "RETAINED_1_TO_1";
    if (firstLossStage) { firstLossCounts[firstLossStage] = (firstLossCounts[firstLossStage] ?? 0) + 1; if (firstLossExamples.length < 12) firstLossExamples.push({ sourceKey: source.key, stage: firstLossStage, reason: lossReason }); }
    fates.push({ sourceKey: redactText(source.key), sourceStart: source.note?.start ?? 0, sourceMidi: source.note?.midi ?? 0, fate, firstLossStage, operation, sameOnsetSurvivor: sameOnset?.note ? { key: redactText(sameOnset.key), start: sameOnset.note.start, midi: sameOnset.note.midi } : null, nearestSurvivor: nearest?.note ? { key: redactText(nearest.key), start: nearest.note.start, midi: nearest.note.midi } : null });
  }
  const funnel: CliffFunnel = { stages, firstLossCounts: Object.fromEntries(Object.entries(firstLossCounts).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), firstLossExamples: firstLossExamples.map((example) => ({ ...example, sourceKey: redactText(example.sourceKey), reason: example.reason ? redactText(example.reason) : null })) };
  return { funnel, fates: fates.map((fate) => ({ ...fate, operation: fate.operation ?? null })) };
}

function summary(variant: Variant, digest?: string): CliffLevelSummary {
  const evaluated = evaluateArrangement({ fixture: { id: "cover-rh-cliff" }, candidate: { selector: `diagnostic:${variant.level}`, notes: variant.notes, tempoBpm: variant.tempoBpm, durationBeats: Math.max(0, ...variant.notes.map((note) => note.start + note.dur)), timeSig: variant.timeSig } });
  return { level: variant.level, ...(digest ? { digest } : {}), notes: variant.notes.length, rightHandNotes: evaluated.metrics.rightHand.noteCount, leftHandNotes: evaluated.metrics.leftHand.noteCount, onsets: evaluated.metrics.global.onsetCount, rightHandOnsets: evaluated.metrics.rightHand.onsetCount, leftHandOnsets: evaluated.metrics.leftHand.onsetCount, attacksPerSecond: evaluated.metrics.global.onsetsPerSecond, maxSimultaneity: evaluated.metrics.global.simultaneity.max, rightHandSpan: evaluated.metrics.rightHand.range.span, p95RightHandLeap: evaluated.metrics.rightHand.interval.p95, repeatedAttackRate: evaluated.metrics.global.repeatedAttackRate };
}

function identityFromVariants(veryEasy: Variant, beginner: Variant): RhIdentitySemantics {
  return sourceCounts(veryEasy.notes, beginner.notes);
}

function significantLostEvents(veryEasy: Note[], fates: CliffEventFate[]): number {
  const lost = new Set(fates.filter((fate) => fate.fate === "REJECTED" || fate.fate === "COLLAPSED").map((fate) => `${fate.sourceStart.toFixed(6)}:${fate.sourceMidi}`));
  const rh = veryEasy.filter((note) => note.hand !== "L");
  const groups = onsetGroups(rh);
  const rep = representativePitches(groups);
  const velocities = rh.map((note) => note.vel);
  const durations = rh.map((note) => note.dur);
  const velocityCut = quantile(velocities, COVER_RH_CLIFF_CONFIG.significantVelocityQuantile) ?? 127;
  const durationCut = quantile(durations, COVER_RH_CLIFF_CONFIG.significantDurationQuantile) ?? 0;
  let count = 0;
  for (let index = 0; index < rh.length; index++) {
    const note = rh[index]!;
    const key = `${note.start.toFixed(6)}:${note.midi}`;
    if (!lost.has(key)) continue;
    const groupIndex = groups.findIndex((group) => group.notes.includes(note));
    const phraseBoundary = groupIndex === 0 || groupIndex === groups.length - 1 || (groupIndex > 0 && groups[groupIndex]!.start - groups[groupIndex - 1]!.start > COVER_RH_CLIFF_CONFIG.phraseBreakBeats);
    const extrema = groupIndex > 0 && groupIndex < rep.length - 1 && ((rep[groupIndex]! > rep[groupIndex - 1]! && rep[groupIndex]! > rep[groupIndex + 1]!) || (rep[groupIndex]! < rep[groupIndex - 1]! && rep[groupIndex]! < rep[groupIndex + 1]!));
    const repeated = groupIndex > 0 && rep[groupIndex] === rep[groupIndex - 1];
    if (phraseBoundary || extrema || repeated || note.vel >= velocityCut || note.dur >= durationCut) count++;
  }
  return count;
}

function metricDelta(beginner: CliffLevelSummary, easy: CliffLevelSummary) {
  return { notes: easy.notes - beginner.notes, onsets: easy.onsets - beginner.onsets, attacksPerSecond: round(easy.attacksPerSecond - beginner.attacksPerSecond) ?? 0, maxSimultaneity: easy.maxSimultaneity - beginner.maxSimultaneity, rightHandSpan: beginner.rightHandSpan === null || easy.rightHandSpan === null ? null : easy.rightHandSpan - beginner.rightHandSpan };
}

function oracle(veryEasy: Variant, beginner: Variant, fates: CliffEventFate[] = []): CliffOracleResult {
  const veRh = veryEasy.notes.filter((note) => note.hand !== "L");
  const bRh = beginner.notes.filter((note) => note.hand !== "L");
  const baseline = summary(beginner);
  const matched = eventMatches(veRh, bRh);
  const matchedKeys = new Set(matched.map(({ harder }) => `${harder.start.toFixed(6)}:${harder.midi}`));
  const slots = onsetGroups(bRh);
  const usedSlots = new Set<number>();
  const oracleRh = bRh.map((note) => ({ ...note }));
  const candidateValue = (note: Note) => note.vel / 127 + Math.min(1, note.dur) * 0.25;
  let recoverable = 0;
  for (const candidate of veRh) {
    const key = `${candidate.start.toFixed(6)}:${candidate.midi}`;
    if (matchedKeys.has(key)) continue;
    const slotIndex = slots.findIndex((slot, index) => !usedSlots.has(index) && Math.abs(slot.start - candidate.start) <= COVER_RH_CLIFF_CONFIG.onsetToleranceBeats + 1e-9);
    if (slotIndex < 0) continue;
    const slot = slots[slotIndex]!;
    const current = slot.notes[0]!;
    if (candidateValue(candidate) <= candidateValue(current) + 0.25) continue;
    const replacementIndex = oracleRh.findIndex((note) => note.start === current.start && note.midi === current.midi);
    if (replacementIndex < 0) continue;
    oracleRh[replacementIndex] = { ...candidate };
    usedSlots.add(slotIndex);
    recoverable++;
  }
  const upper = summary({ ...beginner, notes: [...oracleRh, ...beginner.notes.filter((note) => note.hand === "L")] });
  const significant = significantLostEvents(veryEasy.notes, fates);
  const complexityDelta = { notes: upper.notes - baseline.notes, onsets: upper.onsets - baseline.onsets, attacksPerSecond: round(upper.attacksPerSecond - baseline.attacksPerSecond) ?? 0, maxSimultaneity: upper.maxSimultaneity - baseline.maxSimultaneity, rightHandSpan: baseline.rightHandSpan === null || upper.rightHandSpan === null ? null : upper.rightHandSpan - baseline.rightHandSpan };
  const violations: string[] = [];
  if (complexityDelta.notes > 0) violations.push("note budget increased");
  if (complexityDelta.onsets > 0) violations.push("onset budget increased");
  if (complexityDelta.attacksPerSecond > 1e-9) violations.push("attack rate increased");
  if (complexityDelta.maxSimultaneity > 0) violations.push("maximum simultaneity increased");
  const identity = identityFromVariants(veryEasy, beginner);
  const oracleIdentity = sourceCounts(veRh, oracleRh);
  return { baselineIdentity: identity, oracleIdentity, baseline: { notes: baseline.rightHandNotes, onsets: baseline.rightHandOnsets, attacksPerSecond: baseline.attacksPerSecond, maxSimultaneity: baseline.maxSimultaneity, rightHandSpan: baseline.rightHandSpan }, upperBound: { notes: upper.rightHandNotes, onsets: upper.rightHandOnsets, attacksPerSecond: upper.attacksPerSecond, maxSimultaneity: upper.maxSimultaneity, rightHandSpan: upper.rightHandSpan }, recoverableEvents: recoverable, structurallySignificantLostEvents: significant, constraintBoundEvents: Math.max(0, significant - recoverable), complexityDelta, violations };
}

function counterfactual(variants: Variant[], trace: ProvenanceTraceEvent[] | undefined): CliffCounterfactualResult | null {
  if (!trace?.length) return null;
  const beginner = variants.find((variant) => variant.level === "beginner");
  if (!beginner) return null;
  // The ladder is applied after `beginner-rh-selected`; use that RH set for
  // the bypass so the counterfactual isolates ladder preservation rather than
  // replaying the already-final Beginner output.
  const selectedStage = stageEvents(trace, "beginner-rh-selected").length
    ? "beginner-rh-selected"
    : "beginner-playable";
  const selected = stageEvents(trace, selectedStage)
    .filter((event) => event.selected !== false)
    .map(asNote)
    .filter((note): note is Note => note !== null && note.hand !== "L");
  const candidateNotes = [...selected, ...beginner.notes.filter((note) => note.hand === "L")];
  const candidate = summary({ ...beginner, notes: candidateNotes });
  const baseline = summary(beginner);
  const limits = PLAYABILITY_LIMITS.beginner!;
  const violations: string[] = [];
  if (candidate.maxSimultaneity > limits.maxSim) violations.push(`maxSimultaneity ${candidate.maxSimultaneity} exceeds Beginner limit ${limits.maxSim}`);
  if (candidate.attacksPerSecond > limits.maxDensity) violations.push(`attack density ${candidate.attacksPerSecond} exceeds Beginner limit ${limits.maxDensity}`);
  const baselineIdentity = structure(beginner.notes.filter((note) => note.hand !== "L"), beginner.tempoBpm);
  const candidateIdentity = structure(candidateNotes.filter((note) => note.hand !== "L"), beginner.tempoBpm);
  const medianIoiSeconds = candidateIdentity.ioiBeats.median === null ? null : candidateIdentity.ioiBeats.median * 60 / beginner.tempoBpm;
  if (medianIoiSeconds !== null && medianIoiSeconds < limits.minMedianIoi) violations.push(`median RH IOI ${round(medianIoiSeconds)}s below Beginner floor ${limits.minMedianIoi}s`);
  if (candidate.rightHandNotes > baseline.rightHandNotes) violations.push("RH note budget increased");
  if (candidate.rightHandOnsets > baseline.rightHandOnsets) violations.push("RH onset budget increased");
  const altered = variants.map((variant) => variant.level === "beginner" ? { ...variant, notes: candidateNotes } : variant);
  const variantValidationErrors = validateVariants(altered, { maxDurBeats: null });
  const monotonicityErrors = verifyMonotonicity(altered);
  return { bypassedStage: "beginner-ladder", candidate: { rightHandNotes: candidate.rightHandNotes, leftHandNotes: candidate.leftHandNotes, totalNotes: candidate.notes, rightHandOnsets: candidate.rightHandOnsets }, baseline: { rightHandNotes: baseline.rightHandNotes, leftHandNotes: baseline.leftHandNotes, totalNotes: baseline.notes, rightHandOnsets: baseline.rightHandOnsets }, complexityDelta: { notes: candidate.notes - baseline.notes, onsets: candidate.onsets - baseline.onsets, attacksPerSecond: round(candidate.attacksPerSecond - baseline.attacksPerSecond) ?? 0, maxSimultaneity: candidate.maxSimultaneity - baseline.maxSimultaneity, rightHandSpan: candidate.rightHandSpan === null || baseline.rightHandSpan === null ? null : candidate.rightHandSpan - baseline.rightHandSpan }, violations, variantValidationErrors, monotonicityErrors };
}

function sourceMetadata(input: CliffFixtureInput, advanced: Variant): CliffSourceMetadata {
  return input.sourceMetadata ?? { noteCount: input.source.length, onsetCount: onsetGroups(input.source).length, tempoBpm: advanced.tempoBpm, timeSig: advanced.timeSig, durationBeats: Math.max(0, ...input.source.map((note) => note.start + note.dur)) };
}

function comparison(source: RhStructureMetrics, ve: RhStructureMetrics, beginner: RhStructureMetrics): Record<string, number | null> {
  return {
    sourceMultiEventRate: source.onsetGroups.multiRate,
    veryEasyMultiEventRate: ve.onsetGroups.multiRate,
    beginnerMultiEventRate: beginner.onsetGroups.multiRate,
    sourceMedianIoi: source.ioiBeats.median,
    veryEasyMedianIoi: ve.ioiBeats.median,
    beginnerMedianIoi: beginner.ioiBeats.median,
    sourceReattackRate: source.samePitchReattacks.rate,
    veryEasyReattackRate: ve.samePitchReattacks.rate,
    beginnerReattackRate: beginner.samePitchReattacks.rate,
    sourceGridQuarter: source.gridAlignment.quarter,
    veryEasyGridQuarter: ve.gridAlignment.quarter,
    beginnerGridQuarter: beginner.gridAlignment.quarter,
  };
}

/**
 * Pure, diagnostic-only attribution of the current Very Easy→Beginner RH edge.
 * It never feeds generation and deliberately returns partial output when the
 * opt-in lineage trace is absent.
 */
export function evaluateCoverRhIdentityCliff(input: CliffFixtureInput): CoverRhCliffReport {
  const veryEasy = input.variants.find((variant) => variant.level === "very-easy");
  const beginner = input.variants.find((variant) => variant.level === "beginner");
  const easy = input.variants.find((variant) => variant.level === "easy");
  const advanced = input.variants.find((variant) => variant.level === "advanced") ?? input.variants[0];
  if (!veryEasy || !beginner || !advanced) {
    const fallback: CliffSourceMetadata = input.sourceMetadata ?? { noteCount: input.source.length, onsetCount: onsetGroups(input.source).length, tempoBpm: 120, timeSig: [4, 4], durationBeats: Math.max(0, ...input.source.map((note) => note.start + note.dur)) };
    const fallbackAdvanced: Variant = advanced ?? { level: "advanced", difficultyScore: 0, notes: [], chords: [], bassPattern: "", key: "", tempoBpm: 120, timeSig: [4, 4], measures: [] };
    return { schemaVersion: 1, mission: "CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION", status: "unavailable", fixture: input.fixture, ...(input.revision ? { revision: input.revision } : {}), config: COVER_RH_CLIFF_CONFIG, source: fallback, levels: {}, funnel: { stages: [], firstLossCounts: {}, firstLossExamples: [] }, transition: { harder: "very-easy", easier: "beginner", identity: sourceCounts([], []), fates: [], fateCounts: {} }, structure: { source: structure([]), veryEasy: structure([]), beginner: structure([]), comparison: {} }, lossSemantics: { eventCountSurvival: null, onsetPositionSurvival: null, pitchClassSurvival: null, representativeSurvival: null, anchorSurvival: null, turnSurvival: null, localExtremaSurvival: null, repeatedAttackSurvival: null }, playability: { structurallySignificantLostEvents: 0, recoverableWithinCurrentEnvelope: 0, constraintBound: 0 }, oracle: oracle({ ...fallbackAdvanced, notes: [] }, { ...fallbackAdvanced, level: "beginner", notes: [] }), counterfactual: null, beginnerToEasy: null, characterization: { classification: "INCONCLUSIVE", evidence: ["very-easy and beginner variants are required"] }, decision: "COVER_RH_CAUSE_INSUFFICIENT", behavior: "NO_MUSICAL_BEHAVIOR_CHANGE", publicLadder: { levels: ["very-beginner", "beginner", "easy", "medium", "advanced"], physicalLevels: ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"] } };
  }
  const sourceRh = input.source.filter((note) => note.hand !== "L");
  const veRh = veryEasy.notes.filter((note) => note.hand !== "L");
  const beginnerRh = beginner.notes.filter((note) => note.hand !== "L");
  const stageTrace = traceFunnel(input.trace);
  const identity = identityFromVariants(veryEasy, beginner);
  const veStructure = structure(veRh, veryEasy.tempoBpm);
  const beginnerStructure = structure(beginnerRh, beginner.tempoBpm);
  const sourceStructure = structure(sourceRh, advanced.tempoBpm);
  const oracleResult = oracle(veryEasy, beginner, stageTrace.fates);
  const counterfactualResult = counterfactual(input.variants, input.trace);
  const levels = Object.fromEntries(input.variants.map((variant) => [variant.level, summary(variant, input.digests?.[variant.level])]));
  const lossSemantics = { eventCountSurvival: identity.eventCount.survival, onsetPositionSurvival: identity.onsetCount.survival, pitchClassSurvival: identity.pitchClass.survival, representativeSurvival: identity.representative.survival, anchorSurvival: identity.phrase.anchorSurvival, turnSurvival: identity.contour.turnSurvival, localExtremaSurvival: identity.contour.extremaSurvival, repeatedAttackSurvival: identity.repeatedAttacks.survival };
  const significant = oracleResult.structurallySignificantLostEvents;
  const constraintBound = Math.max(0, significant - oracleResult.recoverableEvents);
  const characterizationEvidence: string[] = [];
  if (sourceStructure.onsetGroups.multiRate > veStructure.onsetGroups.multiRate + 0.1) characterizationEvidence.push("source RH has substantially more multi-event onset groups than generated RH");
  if (identity.onsetCount.survival !== null && identity.onsetCount.survival < 0.75) characterizationEvidence.push("Beginner loses RH onset positions, not only same-onset texture");
  if (identity.repeatedAttacks.survival !== null && identity.repeatedAttacks.survival < 0.75) characterizationEvidence.push("repeated RH attacks have materially lower survival");
  const decision = input.fixture.id === "cover" && identity.onsetCount.survival !== null && identity.onsetCount.survival < 0.75 && oracleResult.recoverableEvents === 0 && Boolean(counterfactualResult?.violations.length)
    ? "COVER_RH_IDENTITY_CLIFF_CONSTRAINT_BOUND"
    : identity.onsetCount.survival !== null && identity.onsetCount.survival >= 0.9 ? "COVER_RH_METRIC_CLIFF_NOT_MUSICAL_CLIFF" : characterizationEvidence.length ? "COVER_RH_ENCODING_STYLE_OUTLIER" : "COVER_RH_CAUSE_INSUFFICIENT";
  const classification = decision === "COVER_RH_IDENTITY_CLIFF_CONSTRAINT_BOUND" ? "COVER_BEGINNER_CONSTRAINT_OUTLIER" : decision === "COVER_RH_ENCODING_STYLE_OUTLIER" ? "COVER_ENCODING_STYLE_OUTLIER" : "INCONCLUSIVE";
  return {
    schemaVersion: 1,
    mission: "CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION",
    status: input.trace?.length ? "ready" : "partial",
    fixture: input.fixture,
    ...(input.revision ? { revision: input.revision } : {}),
    config: COVER_RH_CLIFF_CONFIG,
    source: sourceMetadata(input, advanced),
    levels,
    funnel: stageTrace.funnel,
    transition: { harder: "very-easy", easier: "beginner", identity, fates: stageTrace.fates, fateCounts: Object.fromEntries(Object.entries(stageTrace.fates.reduce((counts, fate) => { counts[fate.fate] = (counts[fate.fate] ?? 0) + 1; return counts; }, {} as Record<string, number>)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) },
    structure: { source: sourceStructure, veryEasy: veStructure, beginner: beginnerStructure, comparison: comparison(sourceStructure, veStructure, beginnerStructure) },
    lossSemantics,
    playability: { structurallySignificantLostEvents: significant, recoverableWithinCurrentEnvelope: oracleResult.recoverableEvents, constraintBound },
    oracle: { ...oracleResult, structurallySignificantLostEvents: significant, constraintBoundEvents: constraintBound },
    counterfactual: counterfactualResult,
    beginnerToEasy: easy ? { beginner: levels.beginner!, easy: levels.easy!, delta: metricDelta(levels.beginner!, levels.easy!) } : null,
    characterization: { classification, evidence: characterizationEvidence },
    decision,
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
    publicLadder: { levels: ["very-beginner", "beginner", "easy", "medium", "advanced"], physicalLevels: ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"] },
  };
}

/** Stable report JSON for reruns; no paths or timestamps are included. */
export function canonicalCoverRhCliffJson(report: CoverRhCliffReport): string {
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : typeof value === "string"
      ? redactText(value)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
      : value;
  return JSON.stringify(canonical(report));
}
