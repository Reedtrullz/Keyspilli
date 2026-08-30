import type { Note } from "./types.js";

/** Semantic qualities intentionally kept small so uncertain harmony stays playable. */
export type PianoHarmonyQuality =
  | "power"
  | "major"
  | "minor"
  | "sus2"
  | "sus4"
  | "single"
  | "unknown";

/** One detector attack after nearby note-on times have been collapsed. */
export interface PianoAttackCluster {
  start: number;
  dur: number;
  duration?: number;
  end: number;
  notes: Note[];
}

/** Optional aligned evidence for one attack or for a whole note stream. */
export interface PianoHarmonyEvidence {
  /** Sustained bass notes, or pitch classes when a numeric list is supplied. */
  bass?: readonly Note[] | readonly number[];
  /** Explicit alias useful to callers that keep bass and harmony in separate lanes. */
  bassNotes?: readonly Note[];
  /** Explicit alias retained for integrations that call this lane bass evidence. */
  bassEvidence?: readonly Note[];
  /** Chroma weights in pitch-class order, or a list of supported pitch classes. */
  chroma?: readonly number[] | readonly (readonly number[])[];
  /** Optional aligned chroma rows; equivalent to nested chroma. */
  chromaByAttack?: readonly (readonly number[])[];
  /** Optional reliability multiplier for this evidence. */
  weight?: number;
  confidence?: number;
}

/** Centralized conservative voicing and inference thresholds. */
export interface PianoAccompanimentConfig {
  /** Detector onset jitter accepted into one attack cluster. */
  groupToleranceBeats?: number;
  /** Aliases for callers that use detector/onset terminology. */
  attackToleranceBeats?: number;
  clusterToleranceBeats?: number;
  onsetToleranceBeats?: number;
  /** Pitches at or below this boundary receive open low-register treatment. */
  lowRegisterBoundary?: number;
  /** Maximum low-register notes before the realization is considered dense. */
  maxLowRegisterNotes?: number;
  /** Maximum notes emitted for any one left-hand attack. */
  maxLeftHandNotesPerAttack?: number;
  /** Maximum MIDI span for one realized left-hand attack. */
  maxLeftHandSpan?: number;
  /** Below this pitch, favor root/fifth structures over close chord tones. */
  preferOpenFifthsBelow?: number;
  /** Minimum source pitch at which a confident triad may remain closed. */
  allowTriadsAbove?: number;
  /** Alias for allowTriadsAbove used by some consumers. */
  highRegisterTriadThreshold?: number;
  /** Confidence required before a high-register triad is retained. */
  highRegisterTriadConfidence?: number;
  /** Short bass events below this duration are treated as passing evidence. */
  minimumBassDurationBeats?: number;
  /** A quality tone below this normalized weight is not trusted as a third. */
  weakThirdWeight?: number;
  /** Number of consecutive attacks needed for an ordinary root change. */
  rootChangePersistence?: number;
  /** A very strong one-attack root may bypass persistence stabilization. */
  strongRootConfidence?: number;
  /** Compatibility alias for note caps. */
  maxNotesPerAttack?: number;
  /** Compatibility alias for the low-register note cap. */
  maxLowNotes?: number;
  /** Compatibility alias for span caps. */
  maxSpanSemitones?: number;
  /** Compatibility alias for span caps. */
  maxLeftHandSpanSemitones?: number;
  /** Compatibility alias for low-register note caps. */
  lowRegisterMaxNotes?: number;
  /** Compatibility alias for the open-fifth boundary. */
  openFifthThreshold?: number;
  /** Compatibility alias for high-triad confidence. */
  triadConfidenceThreshold?: number;
  /** Compatibility alias for bass duration. */
  bassMinDurationBeats?: number;
  /** Compatibility alias for root persistence. */
  rootPersistenceAttacks?: number;
}

/** A semantic harmony event retaining its source attack for realization. */
export interface PianoSemanticHarmony {
  start: number;
  dur: number;
  durationBeats: number;
  /** Alias of durationBeats for callers that use a generic duration field. */
  duration?: number;
  rootPc: number;
  /** Absolute source/anchor pitch used to place the realized root. */
  rootMidi: number;
  bassPc?: number;
  quality: PianoHarmonyQuality;
  confidence: number;
  rootConfidence: number;
  /** 0..1 estimate that this root is supported by neighboring attacks. */
  rootStability: number;
  rootStable: boolean;
  /** True when this event was held to neighboring-root evidence. */
  rootStabilized?: boolean;
  memberCount: number;
  notes: Note[];
  attack: PianoAttackCluster;
  evidence?: PianoHarmonyEvidence;
  /** Strong bass notes are kept so a missing source root can be realized safely. */
  bassNotes?: Note[];
}

/** Diagnostics for an accompaniment simplification pass. */
export interface PianoAccompanimentDiagnostics {
  inputNoteCount: number;
  outputNoteCount: number;
  attackClusterCount: number;
  harmonyEventCount: number;
  lowRegisterAttacks: number;
  lowRegisterDenseAttacks: number;
  lowRegisterCloseIntervalCount: number;
  duplicatePitchCount: number;
  duplicateNotesRemoved: number;
  chromaticConflictCount: number;
  reducedNotes: number;
  maxLeftHandNotesPerAttack: number;
  maxLeftHandSpan: number;
  maxNotesPerAttack: number;
  maxSpanSemitones: number;
  stabilizedTransitions: number;
  rootChanges: number;
  qualityCounts: Record<PianoHarmonyQuality, number>;
}

export interface PianoAccompanimentOptions extends PianoAccompanimentConfig {
  /** Optional bass stream or aligned per-attack evidence. */
  bassEvidence?: readonly Note[] | PianoHarmonyEvidence | readonly PianoHarmonyEvidence[] | readonly (readonly Note[])[];
  /** Optional chroma stream used in addition to bassEvidence. */
  chroma?: readonly number[] | readonly (readonly number[])[];
  /** Alternate spelling for a caller's evidence object. */
  harmonyEvidence?: PianoHarmonyEvidence | readonly PianoHarmonyEvidence[];
  /** Optional notes that a caller has already marked as protected melody. */
  protectedNotes?: readonly Note[];
  /** Permit a nested config without forcing callers to flatten options. */
  config?: PianoAccompanimentConfig;
}

export type PianoAttackInput =
  | readonly Note[]
  | PianoAttackCluster;

/** Fully resolved defaults, useful for logging a reproducible realization. */
export const DEFAULT_PIANO_ACCOMPANIMENT_CONFIG: Required<Pick<
  PianoAccompanimentConfig,
  "groupToleranceBeats"
  | "lowRegisterBoundary"
  | "maxLowRegisterNotes"
  | "maxLeftHandNotesPerAttack"
  | "maxLeftHandSpan"
  | "preferOpenFifthsBelow"
  | "allowTriadsAbove"
  | "highRegisterTriadConfidence"
  | "minimumBassDurationBeats"
  | "weakThirdWeight"
  | "rootChangePersistence"
  | "strongRootConfidence"
>> = {
  groupToleranceBeats: 0.08,
  lowRegisterBoundary: 52,
  maxLowRegisterNotes: 2,
  maxLeftHandNotesPerAttack: 3,
  maxLeftHandSpan: 24,
  preferOpenFifthsBelow: 52,
  allowTriadsAbove: 60,
  highRegisterTriadConfidence: 0.68,
  minimumBassDurationBeats: 0.5,
  weakThirdWeight: 0.42,
  rootChangePersistence: 2,
  strongRootConfidence: 0.9,
};

/** Compatibility names for consumers that use semantic-quality terminology. */
export type PianoSemanticQuality = PianoHarmonyQuality;
export type PianoHarmony = PianoSemanticHarmony;

type NormalizedConfig = {
  groupToleranceBeats: number;
  lowRegisterBoundary: number;
  maxLowRegisterNotes: number;
  maxLeftHandNotesPerAttack: number;
  maxLeftHandSpan: number;
  preferOpenFifthsBelow: number;
  allowTriadsAbove: number;
  highRegisterTriadConfidence: number;
  minimumBassDurationBeats: number;
  weakThirdWeight: number;
  rootChangePersistence: number;
  strongRootConfidence: number;
};

type BassInput =
  | readonly Note[]
  | readonly number[]
  | PianoHarmonyEvidence
  | readonly PianoHarmonyEvidence[]
  | readonly (readonly Note[])[]
  | undefined;

export type PianoBassEvidence = Exclude<BassInput, undefined>;

export type PianoAttackCollection =
  | PianoAttackCluster
  | readonly PianoAttackCluster[]
  | readonly Note[]
  | readonly (readonly Note[])[];

interface ToneSupport {
  maxWeight: number;
  sumWeight: number;
  notes: Note[];
}

interface RootCandidate {
  rootPc: number;
  score: number;
  rootSupport: number;
  fifthSupport: number;
  qualitySupport: number;
  bassSupport: number;
  majorSupport: number;
  minorSupport: number;
  sus2Support: number;
  sus4Support: number;
  majorEvidenceCount: number;
  minorEvidenceCount: number;
  sus2EvidenceCount: number;
  sus4EvidenceCount: number;
  majorMaxWeight: number;
  minorMaxWeight: number;
  sus2MaxWeight: number;
  sus4MaxWeight: number;
  conflictingThird: boolean;
  hasFifth: boolean;
  missingRoot: boolean;
  chromaSupport: number;
  distinctPitchClasses: number;
}

interface RawHarmonyDecision {
  start: number;
  dur: number;
  candidate: RootCandidate;
  quality: PianoHarmonyQuality;
  confidence: number;
  rootMidi: number;
  bassPc?: number;
  bassNotes: Note[];
  evidence?: PianoHarmonyEvidence;
  stabilized?: boolean;
}

const EPS = 1e-7;
const PITCH_CLASSES = 12;

function mod12(value: number): number {
  return ((value % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validNote(note: Note): boolean {
  return finiteNumber(note.midi)
    && Number.isInteger(note.midi)
    && note.midi >= 0
    && note.midi <= 127
    && finiteNumber(note.start)
    && finiteNumber(note.dur)
    && note.dur > 0
    && finiteNumber(note.vel)
    && note.vel >= 0
    && note.vel <= 127;
}

function sourceSortKey(note: Note): string {
  return `${note.hand ?? ""}\u0000${note.identitySource ?? ""}\u0000${note.lyrics ?? ""}`;
}

function compareNotes(a: Note, b: Note): number {
  return a.start - b.start
    || a.midi - b.midi
    || a.dur - b.dur
    || a.vel - b.vel
    || sourceSortKey(a).localeCompare(sourceSortKey(b));
}

function compareMidiNotes(a: Note, b: Note): number {
  return a.midi - b.midi
    || a.start - b.start
    || a.dur - b.dur
    || b.vel - a.vel
    || sourceSortKey(a).localeCompare(sourceSortKey(b));
}

function validSortedNotes(notes: readonly Note[]): Note[] {
  return notes.filter(validNote).map((note) => ({ ...note })).sort(compareNotes);
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number): number {
  return finiteNumber(value) && value >= minimum ? Math.max(minimum, Math.floor(value)) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number, minimum: number): number {
  return finiteNumber(value) && value >= minimum ? value : fallback;
}

function normalizeConfig(config: PianoAccompanimentConfig = {}): NormalizedConfig {
  const maxNotes = positiveInteger(
    config.maxLeftHandNotesPerAttack ?? config.maxNotesPerAttack,
    3,
    1,
  );
  const maxLowNotes = positiveInteger(
    config.maxLowRegisterNotes ?? config.lowRegisterMaxNotes ?? config.maxLowNotes,
    Math.min(2, maxNotes),
    1,
  );
  return {
    groupToleranceBeats: positiveNumber(
      config.groupToleranceBeats
      ?? config.attackToleranceBeats
      ?? config.clusterToleranceBeats
      ?? config.onsetToleranceBeats,
      DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.groupToleranceBeats,
      0,
    ),
    lowRegisterBoundary: positiveNumber(config.lowRegisterBoundary, 52, 0),
    maxLowRegisterNotes: Math.min(maxLowNotes, maxNotes),
    maxLeftHandNotesPerAttack: maxNotes,
    maxLeftHandSpan: positiveNumber(
      config.maxLeftHandSpan ?? config.maxLeftHandSpanSemitones ?? config.maxSpanSemitones,
      DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.maxLeftHandSpan,
      0,
    ),
    preferOpenFifthsBelow: positiveNumber(
      config.preferOpenFifthsBelow ?? config.openFifthThreshold,
      DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.preferOpenFifthsBelow,
      0,
    ),
    allowTriadsAbove: positiveNumber(
      config.allowTriadsAbove ?? config.highRegisterTriadThreshold,
      DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.allowTriadsAbove,
      0,
    ),
    highRegisterTriadConfidence: clamp(config.highRegisterTriadConfidence ?? config.triadConfidenceThreshold ?? DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.highRegisterTriadConfidence),
    minimumBassDurationBeats: positiveNumber(config.minimumBassDurationBeats ?? config.bassMinDurationBeats, DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.minimumBassDurationBeats, 0),
    weakThirdWeight: clamp(config.weakThirdWeight ?? DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.weakThirdWeight),
    rootChangePersistence: positiveInteger(config.rootChangePersistence ?? config.rootPersistenceAttacks, DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.rootChangePersistence, 1),
    strongRootConfidence: clamp(config.strongRootConfidence ?? DEFAULT_PIANO_ACCOMPANIMENT_CONFIG.strongRootConfidence),
  };
}

function clusterFromNotes(notes: readonly Note[], config: NormalizedConfig): PianoAttackCluster | undefined {
  const sorted = validSortedNotes(notes);
  const first = sorted[0];
  if (!first) return undefined;
  const start = first.start;
  const dur = sorted.reduce((max, note) => Math.max(max, note.dur), 0);
  const end = sorted.reduce((max, note) => Math.max(max, note.start + note.dur), start + dur);
  return {
    start,
    dur,
    duration: dur,
    end,
    notes: sorted.sort(compareMidiNotes),
  };
}

/**
 * Group notes whose attacks belong to one detector event. The source notes
 * are copied, sorted, and never mutated; their tags and individual durations
 * remain available to the realization stage.
 */
export function groupAttackClusters(
  notes: readonly Note[],
  config: PianoAccompanimentConfig = {},
): PianoAttackCluster[] {
  const normalized = normalizeConfig(config);
  const sorted = validSortedNotes(notes);
  const clusters: PianoAttackCluster[] = [];
  for (const note of sorted) {
    const previous = clusters[clusters.length - 1];
    if (!previous || note.start - previous.start > normalized.groupToleranceBeats + EPS) {
      clusters.push({ start: note.start, dur: note.dur, duration: note.dur, end: note.start + note.dur, notes: [{ ...note }] });
      continue;
    }
    previous.notes.push({ ...note });
    previous.dur = Math.max(previous.dur, note.dur);
    previous.duration = previous.dur;
    previous.end = Math.max(previous.end, note.start + note.dur);
    previous.notes.sort(compareMidiNotes);
  }
  return clusters;
}

/** Descriptive alias for callers that prefer an explicit piano prefix. */
export const groupPianoAttackClusters = groupAttackClusters;

function isCluster(value: PianoAttackInput): value is PianoAttackCluster {
  return !Array.isArray(value)
    && typeof value === "object"
    && value !== null
    && Array.isArray((value as PianoAttackCluster).notes)
    && finiteNumber((value as PianoAttackCluster).start);
}

function normalizeAttacks(
  attacks: PianoAttackCollection,
  config: NormalizedConfig,
): PianoAttackCluster[] {
  if (!Array.isArray(attacks)) {
    const cluster = attacks as PianoAttackCluster;
    const normalizedNotes = validSortedNotes(cluster.notes).sort(compareMidiNotes);
    const fallback = clusterFromNotes(normalizedNotes, config);
    if (!fallback) return [];
    const start = finiteNumber(cluster.start) ? cluster.start : fallback.start;
    const dur = finiteNumber(cluster.dur) && cluster.dur > 0 ? cluster.dur : fallback.dur;
    const end = Math.max(start + dur, normalizedNotes.reduce((max, note) => Math.max(max, note.start + note.dur), start + dur));
    return [{ start, dur, duration: dur, end, notes: normalizedNotes }];
  }
  if (!attacks.length) return [];
  const first = attacks[0];
  if (isCluster(first as PianoAttackInput)) {
    return (attacks as readonly PianoAttackCluster[])
      .map((cluster): PianoAttackCluster | undefined => {
        const normalizedNotes = validSortedNotes(cluster.notes).sort(compareMidiNotes);
        const fallback = clusterFromNotes(normalizedNotes, config);
        if (!fallback) return undefined;
        const start = finiteNumber(cluster.start) ? cluster.start : fallback.start;
        const dur = finiteNumber(cluster.dur) && cluster.dur > 0 ? cluster.dur : fallback.dur;
        const end = Math.max(start + dur, normalizedNotes.reduce((max, note) => Math.max(max, note.start + note.dur), start + dur));
        return { start, dur, duration: dur, end, notes: normalizedNotes };
      })
      .filter((cluster): cluster is PianoAttackCluster => Boolean(cluster))
      .sort((a, b) => a.start - b.start || a.notes.length - b.notes.length || a.notes.map((note) => note.midi).join(",").localeCompare(b.notes.map((note) => note.midi).join(",")));
  }
  if (Array.isArray(first)) {
    return (attacks as readonly (readonly Note[])[])
      .map((group) => clusterFromNotes(group, config))
      .filter((cluster): cluster is PianoAttackCluster => Boolean(cluster))
      .sort((a, b) => a.start - b.start);
  }
  return groupAttackClusters(attacks as readonly Note[], config);
}

function noteWeight(note: Note, maxDur: number, maxVel: number): number {
  const durationWeight = clamp(note.dur / Math.max(maxDur, EPS));
  const velocityWeight = clamp(note.vel / Math.max(maxVel, 1));
  return clamp(durationWeight * 0.58 + velocityWeight * 0.42);
}

function toneSupports(notes: readonly Note[]): Map<number, ToneSupport> {
  const maxDur = notes.reduce((max, note) => Math.max(max, note.dur), 0);
  const maxVel = notes.reduce((max, note) => Math.max(max, note.vel), 0);
  const supports = new Map<number, ToneSupport>();
  for (const note of notes) {
    const pc = mod12(note.midi);
    const weight = noteWeight(note, maxDur, maxVel);
    const support = supports.get(pc) ?? { maxWeight: 0, sumWeight: 0, notes: [] };
    support.maxWeight = Math.max(support.maxWeight, weight);
    support.sumWeight = Math.min(1.5, support.sumWeight + weight * 0.35);
    support.notes.push(note);
    supports.set(pc, support);
  }
  return supports;
}

function supportFor(supports: Map<number, ToneSupport>, pc: number): number {
  const support = supports.get(mod12(pc));
  if (!support) return 0;
  return clamp(support.maxWeight * 0.78 + support.sumWeight * 0.22);
}

function isNoteArray(value: unknown): value is readonly Note[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "midi" in item);
}

function evidenceObject(value: unknown): value is PianoHarmonyEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return "bass" in candidate
    || "bassNotes" in candidate
    || "bassEvidence" in candidate
    || "chroma" in candidate
    || "weight" in candidate
    || "confidence" in candidate;
}

function configObject(value: unknown): value is PianoAccompanimentConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value) || evidenceObject(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).some((key) => key !== "notes" && key !== "midi" && key !== "start" && key !== "dur" && key !== "vel");
}

function evidenceBassNotes(value: PianoHarmonyEvidence | undefined): Note[] {
  if (!value) return [];
  const candidates = value.bassNotes ?? value.bassEvidence;
  if (candidates) return validSortedNotes(candidates);
  if (isNoteArray(value.bass)) return validSortedNotes(value.bass);
  if (Array.isArray(value.bass)) {
    return value.bass
      .filter((midi): midi is number => finiteNumber(midi) && Number.isInteger(midi))
      .map((midi) => ({
        midi: midi >= 0 && midi <= 11 ? 36 + midi : midi,
        start: 0,
        dur: 1,
        vel: 100,
      }))
      .filter(validNote);
  }
  return [];
}

function evidenceChroma(value: PianoHarmonyEvidence | undefined): readonly number[] | undefined {
  const chroma = value?.chroma ?? value?.chromaByAttack;
  if (!chroma || !Array.isArray(chroma)) return undefined;
  const first = chroma[0];
  return Array.isArray(first) ? undefined : chroma as readonly number[];
}

function evidenceForAttack(input: BassInput, index: number): PianoHarmonyEvidence | undefined {
  if (!input) return undefined;
  if (evidenceObject(input)) return input;
  if (!Array.isArray(input) || !input.length) return undefined;
  const first = input[0];
  if (evidenceObject(first)) return (input as readonly PianoHarmonyEvidence[])[index] ?? first as PianoHarmonyEvidence;
  if (Array.isArray(first)) {
    const group = (input as readonly (readonly Note[])[])[index];
    return group ? { bass: group } : undefined;
  }
  if (typeof first === "number") {
    return { bass: input as readonly number[] };
  }
  return { bass: input as readonly Note[] };
}

function chromaForAttack(
  input: BassInput,
  index: number,
): readonly number[] | undefined {
  const evidence = evidenceForAttack(input, index);
  const local = evidenceChroma(evidence);
  if (local) return local;
  const rows = evidence?.chromaByAttack
    ?? (evidence?.chroma && Array.isArray(evidence.chroma) && Array.isArray(evidence.chroma[0])
      ? evidence.chroma as readonly (readonly number[])[]
      : undefined);
  if (rows) {
    return rows[index] ?? rows[0];
  }
  return undefined;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function sustainedBassForAttack(
  cluster: PianoAttackCluster,
  input: BassInput,
  index: number,
  config: NormalizedConfig,
): Note[] {
  const evidence = evidenceForAttack(input, index);
  const source = evidenceBassNotes(evidence);
  if (!source.length) return [];
  const minEnd = Math.max(cluster.end, cluster.start + cluster.dur);
  const selected = source.filter((bass) => {
    const overlapBeats = overlap(cluster.start, minEnd, bass.start, bass.start + bass.dur);
    const ratio = overlapBeats / Math.max(cluster.dur, EPS);
    // A short attack can still carry a sustained bass starting just after it;
    // the absolute duration gate keeps detector passing notes out of harmony.
    return bass.dur + EPS >= config.minimumBassDurationBeats
      && overlapBeats > EPS
      && (ratio >= 0.35 || bass.dur >= cluster.dur * 0.8);
  });
  return selected.sort((a, b) => b.dur - a.dur || b.vel - a.vel || a.midi - b.midi);
}

function normalizedChroma(chroma: readonly number[] | undefined): Map<number, number> {
  const result = new Map<number, number>();
  if (!chroma?.length) return result;
  if (chroma.length === PITCH_CLASSES) {
    const max = chroma.reduce((current, value) => Math.max(current, finiteNumber(value) ? value : 0), 0);
    for (let pc = 0; pc < PITCH_CLASSES; pc += 1) {
      const value = chroma[pc] ?? 0;
      result.set(pc, max > 0 ? clamp(value / max) : 0);
    }
    return result;
  }
  for (const value of chroma) {
    if (finiteNumber(value) && Number.isInteger(value)) result.set(mod12(value), 1);
  }
  return result;
}

function chromaSupportFor(
  candidate: number,
  chroma: Map<number, number>,
  qualityPcs: readonly number[],
): number {
  if (!chroma.size) return 0;
  const expected = [candidate, ...qualityPcs].map(mod12);
  const expectedScore = expected.reduce((sum, pc) => sum + (chroma.get(pc) ?? 0), 0) / expected.length;
  return clamp(expectedScore);
}

function candidateRoots(
  notes: readonly Note[],
  bassNotes: readonly Note[],
  chroma: Map<number, number>,
): number[] {
  const roots = new Set<number>();
  notes.forEach((note) => roots.add(mod12(note.midi)));
  bassNotes.forEach((note) => roots.add(mod12(note.midi)));
  // A supported bass/root omission can still be completed from a fifth pair.
  // Only add inferred roots when both tones are actually present, avoiding
  // arbitrary chromatic roots for a one-note melody fragment.
  const pcs = [...new Set(notes.map((note) => mod12(note.midi)))];
  for (const first of pcs) {
    for (const second of pcs) {
      if (first !== second && mod12(first + 7) === second) roots.add(first);
    }
  }
  // Chroma can supply an otherwise omitted root, but only when its normalized
  // support is substantial; zero-valued entries in a 12-bin vector never
  // create arbitrary candidates.
  for (const [pc, weight] of chroma) {
    if (weight >= 0.45) roots.add(pc);
  }
  return [...roots].sort((a, b) => a - b);
}

function bassSupportFor(
  rootPc: number,
  bassNotes: readonly Note[],
): number {
  const matching = bassNotes.filter((note) => mod12(note.midi) === rootPc);
  if (!matching.length) return 0;
  const maxDur = matching.reduce((max, note) => Math.max(max, note.dur), 0);
  const maxVel = matching.reduce((max, note) => Math.max(max, note.vel), 0);
  return matching.reduce((max, note) => Math.max(max, noteWeight(note, maxDur, maxVel)), 0);
}

function evaluateRoot(
  rootPc: number,
  notes: readonly Note[],
  bassNotes: readonly Note[],
  chroma: Map<number, number>,
): RootCandidate {
  const supports = toneSupports(notes);
  const rootSupport = supportFor(supports, rootPc);
  const fifthSupport = supportFor(supports, rootPc + 7);
  const majorSupport = supportFor(supports, rootPc + 4);
  const minorSupport = supportFor(supports, rootPc + 3);
  const sus2Support = supportFor(supports, rootPc + 2);
  const sus4Support = supportFor(supports, rootPc + 5);
  const majorTone = supports.get(mod12(rootPc + 4));
  const minorTone = supports.get(mod12(rootPc + 3));
  const sus2Tone = supports.get(mod12(rootPc + 2));
  const sus4Tone = supports.get(mod12(rootPc + 5));
  const qualitySupport = Math.max(majorSupport, minorSupport, sus2Support, sus4Support);
  const bassSupport = bassSupportFor(rootPc, bassNotes);
  const conflictingThird = majorSupport >= 0.42 && minorSupport >= 0.42;
  const hasFifth = fifthSupport >= 0.32;
  const missingRoot = rootSupport < 0.32;
  const chromaValue = chromaSupportFor(rootPc, chroma, [
    rootPc + 7,
    rootPc + (majorSupport >= minorSupport ? 4 : 3),
  ]);
  const expected = new Set([
    rootPc,
    rootPc + 2,
    rootPc + 3,
    rootPc + 4,
    rootPc + 5,
    rootPc + 7,
  ].map(mod12));
  let unmatched = 0;
  for (const [pc, support] of supports) {
    if (!expected.has(pc)) unmatched += supportFor(supports, pc);
  }
  let score = rootSupport * 0.4
    + fifthSupport * 0.3
    + qualitySupport * 0.16
    + bassSupport * 0.23
    + chromaValue * 0.08
    - unmatched * 0.1;
  if (!hasFifth) score -= 0.1;
  if (missingRoot && bassSupport < 0.32) score -= 0.12;
  if (conflictingThird) score -= 0.12;
  return {
    rootPc,
    score,
    rootSupport,
    fifthSupport,
    qualitySupport,
    bassSupport,
    majorSupport,
    minorSupport,
    sus2Support,
    sus4Support,
    majorEvidenceCount: majorTone?.notes.length ?? 0,
    minorEvidenceCount: minorTone?.notes.length ?? 0,
    sus2EvidenceCount: sus2Tone?.notes.length ?? 0,
    sus4EvidenceCount: sus4Tone?.notes.length ?? 0,
    majorMaxWeight: majorTone?.maxWeight ?? 0,
    minorMaxWeight: minorTone?.maxWeight ?? 0,
    sus2MaxWeight: sus2Tone?.maxWeight ?? 0,
    sus4MaxWeight: sus4Tone?.maxWeight ?? 0,
    conflictingThird,
    hasFifth,
    missingRoot,
    chromaSupport: chromaValue,
    distinctPitchClasses: supports.size,
  };
}

function qualityFor(candidate: RootCandidate, config: NormalizedConfig): PianoHarmonyQuality {
  if (candidate.distinctPitchClasses === 1 && candidate.rootSupport >= 0.32) {
    return "single";
  }
  if (candidate.conflictingThird) return "unknown";
  if (!candidate.hasFifth) return "unknown";
  const trustedThird = (support: number, count: number, maxWeight: number): boolean =>
    count >= 2 || (support >= 0.62 && maxWeight >= 0.85);
  const choices: Array<[PianoHarmonyQuality, number]> = [
    ...(trustedThird(candidate.majorSupport, candidate.majorEvidenceCount, candidate.majorMaxWeight)
      ? [["major", candidate.majorSupport] as [PianoHarmonyQuality, number]] : []),
    ...(trustedThird(candidate.minorSupport, candidate.minorEvidenceCount, candidate.minorMaxWeight)
      ? [["minor", candidate.minorSupport] as [PianoHarmonyQuality, number]] : []),
    ...(trustedThird(candidate.sus2Support, candidate.sus2EvidenceCount, candidate.sus2MaxWeight)
      ? [["sus2", candidate.sus2Support] as [PianoHarmonyQuality, number]] : []),
    ...(trustedThird(candidate.sus4Support, candidate.sus4EvidenceCount, candidate.sus4MaxWeight)
      ? [["sus4", candidate.sus4Support] as [PianoHarmonyQuality, number]] : []),
  ];
  choices.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const strongest = choices[0];
  if (strongest && strongest[1] >= 0.42) return strongest[0];
  if (candidate.hasFifth) {
    // A weak third is useful as a reason to omit the third, never as a reason
    // to guess a major/minor color.
    if (candidate.qualitySupport > 0 && candidate.qualitySupport < config.weakThirdWeight) return "power";
    return "power";
  }
  return "unknown";
}

function confidenceFor(candidate: RootCandidate, quality: PianoHarmonyQuality, config: NormalizedConfig): number {
  let confidence = 0.28 + candidate.score * 0.66;
  if (quality === "unknown") confidence -= 0.14;
  if (quality === "power" && candidate.qualitySupport > 0) confidence -= 0.09;
  if (quality === "single") confidence = Math.max(confidence, 0.55);
  if (candidate.missingRoot && candidate.bassSupport >= 0.32) confidence -= 0.03;
  return clamp(confidence);
}

function pickBestCandidate(
  notes: readonly Note[],
  bassNotes: readonly Note[],
  chroma: Map<number, number>,
): RootCandidate {
  const roots = candidateRoots(notes, bassNotes, chroma);
  const fallbackRoot = mod12(notes[0]?.midi ?? bassNotes[0]?.midi ?? 0);
  const candidates = (roots.length ? roots : [fallbackRoot]).map((rootPc) => evaluateRoot(rootPc, notes, bassNotes, chroma));
  candidates.sort((a, b) => b.score - a.score
    || b.rootSupport - a.rootSupport
    || b.fifthSupport - a.fifthSupport
    || b.bassSupport - a.bassSupport
    || a.rootPc - b.rootPc);
  return candidates[0] ?? evaluateRoot(fallbackRoot, notes, bassNotes, chroma);
}

function rootMidiFor(
  rootPc: number,
  cluster: PianoAttackCluster,
  bassNotes: readonly Note[],
): number {
  const sourceRoot = cluster.notes
    .filter((note) => mod12(note.midi) === rootPc)
    .sort((a, b) => a.midi - b.midi || a.start - b.start)[0];
  if (sourceRoot) return sourceRoot.midi;
  const bassRoot = bassNotes
    .filter((note) => mod12(note.midi) === rootPc)
    .sort((a, b) => a.midi - b.midi || a.start - b.start)[0];
  if (bassRoot) return bassRoot.midi;
  const anchor = cluster.notes[0]?.midi ?? 60;
  let result = anchor + mod12(rootPc - mod12(anchor));
  while (result > 127) result -= 12;
  while (result < 0) result += 12;
  return result;
}

function qualityRunKey(event: RawHarmonyDecision): string {
  return `${event.candidate.rootPc}:${event.quality}`;
}

function connectedAttacks(previous: RawHarmonyDecision | undefined, current: RawHarmonyDecision | undefined, config: NormalizedConfig): boolean {
  if (!previous || !current) return false;
  return current.start - previous.start <= 1.5 + EPS;
}

function stabilizeDecisions(
  decisions: RawHarmonyDecision[],
  config: NormalizedConfig,
): { decisions: RawHarmonyDecision[]; stability: number[]; stabilizedTransitions: number } {
  if (decisions.length < 2) {
    return { decisions: decisions.slice(), stability: decisions.map(() => 0.55), stabilizedTransitions: 0 };
  }
  const result = decisions.map((decision) => ({ ...decision }));
  let stabilizedTransitions = 0;
  const persistence = config.rootChangePersistence;
  for (let index = 0; index < decisions.length; index += 1) {
    const current = decisions[index];
    if (!current) continue;
    const previous = decisions[index - 1];
    const next = decisions[index + 1];
    if (previous && next
      && connectedAttacks(previous, current, config)
      && connectedAttacks(current, next, config)
      && previous.candidate.rootPc === next.candidate.rootPc
      && current.candidate.rootPc !== previous.candidate.rootPc
      && current.confidence < config.strongRootConfidence) {
      result[index] = { ...current, candidate: previous.candidate, quality: previous.quality, rootMidi: previous.rootMidi, bassPc: previous.bassPc, bassNotes: previous.bassNotes, evidence: previous.evidence, stabilized: true };
      stabilizedTransitions += 1;
    }
  }
  // Collapse an interior one-attack root run when both neighboring runs agree.
  // Boundary runs are left alone: a real phrase can legitimately begin or end
  // on a chord that differs from the next/previous sustained chord.
  let runStart = 0;
  while (runStart < result.length) {
    const runRoot = result[runStart]!.candidate.rootPc;
    let runEnd = runStart + 1;
    while (runEnd < result.length && result[runEnd]!.candidate.rootPc === runRoot) runEnd += 1;
    const runLength = runEnd - runStart;
    if (runLength < persistence && runLength === 1) {
      const before = result[runStart - 1];
      const after = result[runEnd];
      const source = decisions[runStart];
      const replacement = before && after
        && connectedAttacks(before, source, config)
        && connectedAttacks(source, after, config)
        && before.candidate.rootPc === after.candidate.rootPc
        ? before
        : undefined;
      if (replacement && source && source.confidence < config.strongRootConfidence) {
        result[runStart] = { ...source, candidate: replacement.candidate, quality: replacement.quality, rootMidi: replacement.rootMidi, bassPc: replacement.bassPc, bassNotes: replacement.bassNotes, evidence: replacement.evidence, stabilized: true };
        stabilizedTransitions += 1;
      }
    }
    runStart = runEnd;
  }
  // A one-off quality color is held to the surrounding semantic color. This
  // is intentionally separate from root stabilization: a repeated root can
  // carry a genuinely repeated minor/major change.
  for (let index = 1; index < result.length - 1; index += 1) {
    const previous = result[index - 1]!;
    const current = result[index]!;
    const next = result[index + 1]!;
    if (connectedAttacks(previous, current, config)
      && connectedAttacks(current, next, config)
      && previous.candidate.rootPc === current.candidate.rootPc
      && current.candidate.rootPc === next.candidate.rootPc
      && qualityRunKey(previous) === qualityRunKey(next)
      && current.quality !== previous.quality
      && current.confidence < config.strongRootConfidence) {
      result[index] = { ...current, quality: previous.quality, stabilized: true };
      stabilizedTransitions += 1;
    }
  }
  const stability = result.map((event, index) => {
    const before = result[index - 1]?.candidate.rootPc === event.candidate.rootPc;
    const after = result[index + 1]?.candidate.rootPc === event.candidate.rootPc;
    const neighbors = Number(before) + Number(after);
    if (neighbors === 2) return 1;
    if (neighbors === 1) return 0.78;
    return event.candidate.rootPc === decisions[index]?.candidate.rootPc ? 0.58 : 0.32;
  });
  return { decisions: result, stability, stabilizedTransitions };
}

function semanticEvidence(
  input: BassInput,
  index: number,
  bassNotes: Note[],
  chroma: readonly number[] | undefined,
): PianoHarmonyEvidence | undefined {
  const base = evidenceForAttack(input, index);
  if (!base && !bassNotes.length && !chroma) return undefined;
  return {
    ...(base ?? {}),
    ...(bassNotes.length ? { bass: bassNotes } : {}),
    ...(chroma ? { chroma } : {}),
  };
}

/**
 * Infer conservative semantic harmony from grouped attacks. Harmony is
 * deliberately evidence-based: root/fifth agreement wins, weak thirds are
 * omitted, and an isolated root change is held to its neighbors.
 */
export function inferPianoHarmony(
  attacks: PianoAttackCollection,
  bassEvidence?: BassInput | PianoAccompanimentConfig,
  config: PianoAccompanimentConfig = {},
): PianoSemanticHarmony[] {
  const effectiveConfig = configObject(bassEvidence) ? bassEvidence : config;
  const effectiveBass = configObject(bassEvidence) ? undefined : bassEvidence;
  const normalized = normalizeConfig(effectiveConfig);
  const clusters = normalizeAttacks(attacks, normalized);
  const raw: RawHarmonyDecision[] = clusters.map((cluster, index) => {
    const bassNotes = sustainedBassForAttack(cluster, effectiveBass, index, normalized);
    const chroma = normalizedChroma(chromaForAttack(effectiveBass, index));
    const candidate = pickBestCandidate(cluster.notes, bassNotes, chroma);
    const quality = qualityFor(candidate, normalized);
    const confidence = confidenceFor(candidate, quality, normalized);
    const bassPc = bassNotes[0] ? mod12(bassNotes[0].midi) : undefined;
    return {
      start: cluster.start,
      dur: cluster.dur,
      candidate,
      quality,
      confidence,
      rootMidi: rootMidiFor(candidate.rootPc, cluster, bassNotes),
      bassPc,
      bassNotes,
      evidence: semanticEvidence(effectiveBass, index, bassNotes, chromaForAttack(effectiveBass, index)),
    };
  });
  const stabilized = stabilizeDecisions(raw, normalized);
  return clusters.map((cluster, index) => {
    const decision = stabilized.decisions[index]!;
    const stability = stabilized.stability[index] ?? 0.55;
    return {
      start: cluster.start,
      dur: cluster.dur,
      durationBeats: cluster.dur,
      duration: cluster.dur,
      rootPc: decision.candidate.rootPc,
      rootMidi: decision.rootMidi,
      ...(decision.bassPc === undefined ? {} : { bassPc: decision.bassPc }),
      quality: decision.quality,
      confidence: decision.confidence,
      rootConfidence: clamp(0.52 * decision.candidate.rootSupport
        + 0.28 * decision.candidate.fifthSupport
        + 0.2 * decision.candidate.bassSupport),
      rootStability: stability,
      rootStable: stability >= 0.6,
      ...(decision.stabilized || decision.candidate.rootPc !== raw[index]?.candidate.rootPc || decision.quality !== raw[index]?.quality ? { rootStabilized: true } : {}),
      memberCount: cluster.notes.length,
      notes: cluster.notes.map((note) => ({ ...note })),
      attack: {
        start: cluster.start,
        dur: cluster.dur,
        duration: cluster.dur,
        end: cluster.end,
        notes: cluster.notes.map((note) => ({ ...note })),
      },
      ...(decision.evidence ? { evidence: decision.evidence } : {}),
      ...(decision.bassNotes.length ? { bassNotes: decision.bassNotes.map((note) => ({ ...note })) } : {}),
    };
  });
}

function expectedQualityPcs(harmony: PianoSemanticHarmony): number[] {
  const intervals: Record<PianoHarmonyQuality, readonly number[]> = {
    power: [0, 7],
    major: [0, 4, 7],
    minor: [0, 3, 7],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    single: [0],
    unknown: [0, 7],
  };
  return intervals[harmony.quality]!.map((interval) => mod12(harmony.rootPc + interval));
}

function chooseSourceNote(harmony: PianoSemanticHarmony, pc: number): Note | undefined {
  const matching = harmony.notes
    .filter((note) => mod12(note.midi) === mod12(pc))
    .sort((a, b) => a.midi - b.midi || a.start - b.start || b.vel - a.vel);
  if (matching[0]) return matching[0];
  if (mod12(pc) === mod12(harmony.rootPc)) {
    const bass = (harmony.bassNotes ?? [])
      .filter((note) => mod12(note.midi) === mod12(pc))
      .sort((a, b) => a.midi - b.midi || a.start - b.start || b.vel - a.vel);
    return bass[0];
  }
  return harmony.notes[0];
}

function cloneTone(source: Note | undefined, midi: number, harmony: PianoSemanticHarmony, retime: boolean): Note {
  const basis = source ?? harmony.notes[0] ?? {
    midi,
    start: harmony.start,
    dur: harmony.dur,
    vel: 80,
  };
  return {
    ...basis,
    midi,
    ...(retime ? { start: harmony.start } : {}),
  };
}

function fitRootToLowRegister(rootMidi: number, config: NormalizedConfig): number {
  let result = Math.round(rootMidi);
  while (result > config.lowRegisterBoundary && result - 12 >= 21) result -= 12;
  while (result < 21 && result + 12 <= 108) result += 12;
  return clamp(result, 21, 108);
}

function capSpan(notes: Note[], maxSpan: number): Note[] {
  if (notes.length < 2) return notes;
  const sorted = notes.slice().sort((a, b) => a.midi - b.midi);
  const kept: Note[] = [];
  for (const note of sorted) {
    const min = kept[0]?.midi;
    if (min === undefined || note.midi - min <= maxSpan + EPS) kept.push(note);
  }
  return kept;
}

function dedupeNotes(notes: readonly Note[]): Note[] {
  const seen = new Set<string>();
  const result: Note[] = [];
  for (const note of notes) {
    const key = `${note.midi}:${note.start.toFixed(9)}:${note.dur.toFixed(9)}:${note.vel}:${note.hand ?? ""}:${note.identitySource ?? ""}:${note.lyrics ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(note);
  }
  return result.sort(compareNotes);
}

function noteIdentityKey(note: Note): string {
  return `${note.midi}:${note.start.toFixed(9)}:${note.dur.toFixed(9)}:${note.vel}:${note.hand ?? ""}:${note.identitySource ?? ""}:${note.lyrics ?? ""}`;
}

function realizeOne(
  harmony: PianoSemanticHarmony,
  config: NormalizedConfig,
): Note[] {
  const source = harmony.notes.filter(validNote).sort(compareMidiNotes);
  if (!source.length) return [];
  const minimumMidi = source[0]!.midi;
  const expectedPcs = expectedQualityPcs(harmony);
  const isTriad = harmony.quality === "major"
    || harmony.quality === "minor"
    || harmony.quality === "sus2"
    || harmony.quality === "sus4";
  const canKeepHighTriad = isTriad
    && minimumMidi >= config.allowTriadsAbove
    && harmony.confidence >= config.highRegisterTriadConfidence;

  if (canKeepHighTriad) {
    const retained: Note[] = [];
    for (const pc of expectedPcs) {
      const candidate = source.find((note) => mod12(note.midi) === pc);
      if (candidate) retained.push({ ...candidate });
    }
    const capped = capSpan(retained, config.maxLeftHandSpan).slice(0, config.maxLeftHandNotesPerAttack);
    if (capped.length) return dedupeNotes(capped);
  }

  const rootMidi = fitRootToLowRegister(harmony.rootMidi, config);
  const rootSource = chooseSourceNote(harmony, harmony.rootPc);
  const fifthPc = mod12(harmony.rootPc + 7);
  const fifthSource = chooseSourceNote(harmony, fifthPc);
  const fifthSupported = source.some((note) => mod12(note.midi) === fifthPc)
    || harmony.quality === "power"
    || harmony.quality === "major"
    || harmony.quality === "minor"
    || harmony.quality === "sus2"
    || harmony.quality === "sus4";
  const targetPitches: number[] = [rootMidi];
  const isLow = rootMidi <= config.preferOpenFifthsBelow || minimumMidi <= config.preferOpenFifthsBelow;
  if (fifthSupported && harmony.quality !== "single") targetPitches.push(rootMidi + 7);
  // An octave is an optional third anchor only when the caller explicitly
  // allows three low notes and the source itself carried octave support.
  const hasOctaveSupport = source.some((note) => mod12(note.midi) === harmony.rootPc && Math.abs(note.midi - harmony.rootMidi) >= 10);
  if (isLow && hasOctaveSupport && harmony.confidence >= config.highRegisterTriadConfidence && config.maxLowRegisterNotes >= 3) {
    targetPitches.push(rootMidi + 12);
  }
  const maxNotes = isLow ? config.maxLowRegisterNotes : config.maxLeftHandNotesPerAttack;
  const selectedPitches = targetPitches
    .filter((midi) => midi >= 21 && midi <= 108)
    .slice(0, maxNotes);
  const realized = selectedPitches.map((midi, index) => {
    const sourceNote = index === 0 ? rootSource : index === 1 ? fifthSource : rootSource;
    return cloneTone(sourceNote, midi, harmony, true);
  });
  return dedupeNotes(capSpan(realized, config.maxLeftHandSpan).slice(0, config.maxLeftHandNotesPerAttack));
}

/** Realize semantic harmony as deterministic, low-register-friendly Note events. */
export function realizePianoAccompaniment(
  harmony: readonly PianoSemanticHarmony[] | PianoSemanticHarmony,
  config: PianoAccompanimentConfig = {},
): Note[] {
  const normalized = normalizeConfig(config);
  const events = Array.isArray(harmony) ? harmony : [harmony];
  return dedupeNotes(events.flatMap((event) => realizeOne(event, normalized)));
}

function pitchClassCount(notes: readonly Note[]): number {
  return new Set(notes.map((note) => mod12(note.midi))).size;
}

function lowCloseIntervals(notes: readonly Note[], boundary: number): number {
  const low = notes.filter((note) => note.midi <= boundary).sort((a, b) => a.midi - b.midi);
  let count = 0;
  for (let index = 1; index < low.length; index += 1) {
    const previous = low[index - 1];
    const current = low[index];
    if (previous && current && current.midi - previous.midi <= 4) count += 1;
  }
  return count;
}

function qualityCounts(harmony: readonly PianoSemanticHarmony[]): Record<PianoHarmonyQuality, number> {
  const counts: Record<PianoHarmonyQuality, number> = {
    power: 0,
    major: 0,
    minor: 0,
    sus2: 0,
    sus4: 0,
    single: 0,
    unknown: 0,
  };
  for (const event of harmony) counts[event.quality] += 1;
  return counts;
}

function simplifyEvidence(options: PianoAccompanimentOptions): BassInput {
  const direct = options.bassEvidence ?? options.harmonyEvidence;
  if (options.chroma === undefined) return direct;
  if (evidenceObject(direct)) return { ...direct, chroma: options.chroma };
  if (direct === undefined) return { chroma: options.chroma };
  if (isNoteArray(direct)) return { bass: direct, chroma: options.chroma };
  return direct;
}

/**
 * End-to-end pure helper: cluster source notes, infer semantic harmony, then
 * realize capped accompaniment events. Protected notes are unioned unchanged
 * for callers that already performed a melody split.
 */
export function simplifyPianoAccompaniment(
  notes: readonly Note[],
  options: PianoAccompanimentOptions = {},
): { notes: Note[]; harmony: PianoSemanticHarmony[]; diagnostics: PianoAccompanimentDiagnostics } {
  const mergedConfig: PianoAccompanimentConfig = { ...options, ...(options.config ?? {}) };
  const config = normalizeConfig(mergedConfig);
  const protectedKeys = new Set((options.protectedNotes ?? []).filter(validNote).map(noteIdentityKey));
  // Protected melody is an explicit caller contract: never let its tones
  // become harmony evidence and then reappear in the left hand.
  const harmonyInput = protectedKeys.size
    ? notes.filter((note) => !protectedKeys.has(noteIdentityKey(note)))
    : notes;
  const clusters = groupAttackClusters(harmonyInput, mergedConfig);
  const harmony = inferPianoHarmony(clusters, simplifyEvidence(options), mergedConfig);
  const realized = realizePianoAccompaniment(harmony, mergedConfig);
  const protectedNotes = options.protectedNotes ? validSortedNotes(options.protectedNotes) : [];
  const output = dedupeNotes([...realized, ...protectedNotes]);
  const sourceValid = validSortedNotes(notes);
  const duplicatePitchCount = clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.notes.length - pitchClassCount(cluster.notes)), 0);
  const lowRegisterAttacks = clusters.filter((cluster) => cluster.notes.some((note) => note.midi <= config.lowRegisterBoundary)).length;
  const lowRegisterDenseAttacks = clusters.filter((cluster) => cluster.notes.filter((note) => note.midi <= config.lowRegisterBoundary).length > config.maxLowRegisterNotes).length;
  const lowRegisterCloseIntervalCount = clusters.reduce((sum, cluster) => sum + lowCloseIntervals(cluster.notes, config.lowRegisterBoundary), 0);
  const stabilizedTransitions = harmony.filter((event) => event.rootStabilized).length;
  const rootChanges = harmony.reduce((sum, event, index) => sum + (index > 0 && harmony[index - 1]!.rootPc !== event.rootPc ? 1 : 0), 0);
  const maxOutputPerAttack = clusters.reduce((max, cluster) => {
    const count = output.filter((note) => Math.abs(note.start - cluster.start) <= config.groupToleranceBeats + EPS).length;
    return Math.max(max, count);
  }, 0);
  const maxSpan = clusters.reduce((max, cluster) => {
    const pitches = output.filter((note) => Math.abs(note.start - cluster.start) <= config.groupToleranceBeats + EPS).map((note) => note.midi);
    if (pitches.length < 2) return max;
    return Math.max(max, Math.max(...pitches) - Math.min(...pitches));
  }, 0);
  return {
    notes: output,
    harmony,
    diagnostics: {
      inputNoteCount: sourceValid.length,
      outputNoteCount: output.length,
      attackClusterCount: clusters.length,
      harmonyEventCount: harmony.length,
      lowRegisterAttacks,
      lowRegisterDenseAttacks,
      lowRegisterCloseIntervalCount,
      duplicatePitchCount,
      duplicateNotesRemoved: Math.max(0, sourceValid.length - output.length),
      chromaticConflictCount: harmony.filter((event) => event.quality === "unknown").length,
      reducedNotes: Math.max(0, sourceValid.length - output.length),
      maxLeftHandNotesPerAttack: maxOutputPerAttack,
      maxLeftHandSpan: maxSpan,
      maxNotesPerAttack: maxOutputPerAttack,
      maxSpanSemitones: maxSpan,
      stabilizedTransitions,
      rootChanges,
      qualityCounts: qualityCounts(harmony),
    },
  };
}
