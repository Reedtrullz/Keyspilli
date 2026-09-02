import { createHash } from "node:crypto";
import {
  buildVariants,
  LEVEL_ORDER,
  PLAYABILITY_LIMITS,
  validateVariants,
  verifyMonotonicity,
  type DifficultyLevel,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import { evaluateDifficultyLadder, type DifficultyLadderEvaluation } from "./arrangement-evaluation.js";

/** The only policy identifier used by this evidence-only evaluator. */
export const CANDIDATE_ID = "COLLISION_AWARE_SPARSE_LH" as const;
export const SYNTHETIC_CONTROL_ID = "BEGINNER_SPARSE_LH_PROMOTION_CONTROL_V2" as const;

/** Frozen semantic contract; this evaluator never changes production policy. */
export const CANDIDATE_SEMANTICS = {
  baselineBeginnerRhRetained: "byte-for-byte",
  evidence: "existing Very Easy LH structural/root/bass evidence",
  selection: "at most one lowest structural eligible onset per source-meter window",
  collision: "use a legal later existing onset when the first would exceed sounding maxSim 2; otherwise suppress",
  invariants: [
    "no arbitrary retiming",
    "no RH replacement/deletion/pitch/timing change",
    "no decorative, arpeggio, repeated filler, unknown, or drum-derived LH output",
  ],
} as const;

export const CANDIDATE_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify(CANDIDATE_SEMANTICS))
  .digest("hex");

/** Release gates are data so the outcome predicate cannot silently omit one. */
export const DECLARED_RELEASE_GATES = [
  "fixture-bytes-fresh",
  "candidate-validation",
  "candidate-ladder-validation",
  "candidate-adjacent-monotonicity",
  "beginner-rh-parity",
  "non-beginner-parity",
  "structural-recovery",
  "lh-provenance",
  "synthetic-safety",
  "product-separation",
] as const;

export type DeclaredReleaseGate = typeof DECLARED_RELEASE_GATES[number];
type FixtureNote = Note & { role?: string };

export interface CurrentFixture {
  id: string;
  label?: string;
  logicalRef: string;
  /** Bytes are supplied by the caller; no historical report is ever read. */
  bytes: Uint8Array;
  source: ParsedMidi;
  title: string;
  artist: string;
}

export interface EventSetComparison {
  equal: boolean;
  leftDigest: string;
  rightDigest: string;
  leftCount: number;
  rightCount: number;
}

export interface CandidateApplication {
  variant: Variant;
  emitted: Note[];
  considered: FixtureNote[];
  provenance: Record<string, number>;
  filler: { repeated: number; decorative: number; suppressed: number; emitted: number };
  collision: { oneRhAllowed: boolean; twoRhSuppressedOrDeferred: boolean; deferUsed: boolean; noDeferSuppressed: boolean };
  trueRestWindows: number[];
  lhOnlyWindows: number[];
  pitchedDrumOutputs: number;
}

export interface SyntheticSafetyResult {
  requiredPhenomena: {
    fillerEnteredPath: boolean;
    trueRest: boolean;
    lhOnlyPassage: boolean;
    oneRhCollision: boolean;
    twoRhCollision: boolean;
    deferOpportunity: boolean;
    noDeferOpportunity: boolean;
    drumProvenance: boolean;
    harmonicChange: boolean;
  };
  observed: {
    fillerSuppressed: boolean;
    trueRestSilent: boolean;
    lhOnlyEmitted: boolean;
    oneRhAllowed: boolean;
    twoRhSuppressedOrDeferred: boolean;
    deferUsed: boolean;
    noDeferSuppressed: boolean;
    pitchedDrumOutputs: number;
  };
  deterministic: boolean;
  pass: boolean;
}

export interface ProductSeparationMetrics {
  level: DifficultyLevel;
  notes: number;
  onsets: number;
  attacksPerSecond: number;
  maxSimultaneity: number;
  medianSimultaneity: number;
  lhAttacksPerMinute: number;
  lhActiveOnsetPercent: number;
  simultaneousRhLhPercent: number;
  handAlternationsPerMinute: number;
}

export interface CurrentFixtureEvaluation {
  fixture: { id: string; label?: string; logicalRef: string; bytes: number; sha256: string };
  baseline: { levels: Variant[]; ladder: DifficultyLadderEvaluation };
  candidate: { beginner: Variant; ladder: Variant[]; ladderEvaluation: DifficultyLadderEvaluation; validation: { ladder: string[]; monotonicity: string[] } };
  parity: { rh: EventSetComparison & { eventEqual: boolean; digestEqual: boolean }; nonBeginner: Array<{ level: DifficultyLevel; eventEqual: boolean; digestEqual: boolean; comparison: EventSetComparison }> };
  structuralRecovery: { activeWindows: number[]; baselineErasedWindows: number[]; candidateErasedWindows: number[]; recoveredWindows: number[] };
  separation: ProductSeparationMetrics[];
  synthetic: CandidateApplication & { fillerEnteredPath: boolean; control: SyntheticSafetyResult };
  gateTable: DeclaredGateResult[];
  decision: { predicateGateIds: DeclaredReleaseGate[]; pass: boolean };
}

export interface DeclaredGateResult {
  id: DeclaredReleaseGate;
  description: string;
  scope: "fixture" | "candidate" | "ladder" | "synthetic" | "aggregate";
  observed: boolean;
  threshold: string;
  status: "PASS" | "FAIL";
  includedInDecisionPredicate: boolean;
}

const round = (value: number): number => Number(value.toFixed(6));
const onsetKey = (value: number): string => value.toFixed(6);

function noteTuple(note: Note): string {
  return JSON.stringify([note.midi, round(note.start), round(note.dur), note.vel, note.hand ?? "", note.identitySource ?? ""]);
}

export function compareEventSets(left: Note[], right: Note[]): EventSetComparison {
  const canonical = (notes: Note[]): string[] => notes.map(noteTuple).sort();
  const a = canonical(left);
  const b = canonical(right);
  const digest = (rows: string[]): string => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { equal: JSON.stringify(a) === JSON.stringify(b), leftDigest: digest(a), rightDigest: digest(b), leftCount: a.length, rightCount: b.length };
}

function windowsFor(source: ParsedMidi): number {
  const width = Math.max(1, source.timeSig[0] * (4 / source.timeSig[1]));
  const declaredDuration = Number.isFinite(source.durationBeats)
    ? source.durationBeats
    : Math.max(...source.notes.map((note) => note.start + note.dur), 0);
  return Math.ceil(Math.max(declaredDuration, ...source.notes.map((note) => note.start + note.dur), 0) / width);
}

function windowIndex(start: number, source: ParsedMidi): number {
  const width = Math.max(1, source.timeSig[0] * (4 / source.timeSig[1]));
  return Math.floor((start + 1e-9) / width);
}

function soundingRhAt(notes: Note[], start: number): number {
  return notes.filter((note) => note.hand !== "L" && note.start <= start + 1e-9 && note.start + note.dur > start + 1e-9).length;
}

function roleOf(note: FixtureNote): string {
  return String(note.role ?? "").toLowerCase();
}

function provenanceOf(note: FixtureNote): string {
  const role = roleOf(note);
  if ((note.identitySource as string | undefined) === "drums" || role === "drum" || role === "drums") return "DRUM_DERIVED";
  if (role === "unknown" || role === "unsafe" || note.identitySource === "other") return "UNKNOWN_UNSAFE";
  if (role === "decorative") return "DECORATIVE";
  if (role === "arpeggio" || role === "arpeggio-filler") return "ARPEGGIO_FILLER";
  if (role === "filler" || role === "repeated-filler" || role === "repeated_same_harmony_filler") return "REPEATED_SAME_HARMONY_FILLER";
  if (role === "root" || role === "explicit-root") return "EXPLICIT_ROOT";
  if (role === "bass" || role === "explicit-bass") return "EXPLICIT_BASS";
  if (note.identitySource === "guitar") return "STRUCTURAL_LH";
  if (note.identitySource === undefined) return "TRUSTED_VERY_EASY_LH_EVIDENCE";
  return "PROVENANCE_UNAVAILABLE";
}

function selectEligibleLh(veryEasy: Variant, source: ParsedMidi): { byWindow: Map<number, FixtureNote[]>; all: FixtureNote[] } {
  const all = veryEasy.notes.filter((note): note is FixtureNote => note.hand === "L");
  const byWindow = new Map<number, FixtureNote[]>();
  for (const note of all) {
    const list = byWindow.get(windowIndex(note.start, source)) ?? [];
    list.push(note);
    byWindow.set(windowIndex(note.start, source), list);
  }
  for (const list of byWindow.values()) list.sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  return { byWindow, all };
}

function controlVariant(level: DifficultyLevel, notes: Note[], durationBeats = 4): Variant {
  return {
    level,
    difficultyScore: 0,
    notes,
    chords: [],
    bassPattern: "",
    key: "C major",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: durationBeats }],
  };
}

function controlApplication(rh: Note[], lh: Note[], sourceNotes: Note[], durationBeats = 4): CandidateApplication {
  const source = {
    format: 1,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0 as const,
    timeSig: [4, 4] as [number, number],
    notes: sourceNotes,
    trackNames: ["synthetic-control"],
    durationBeats,
  } satisfies ParsedMidi;
  return applyCollisionAwareSparseLh(
    controlVariant("beginner", rh),
    controlVariant("very-easy", [...rh, ...lh]),
    source,
  );
}

/**
 * Run the frozen policy against independent controls. These probes are kept
 * separate from real-fixture metrics so a real reducer cannot manufacture a
 * passing collision/defer result by removing the source notes first.
 */
export function evaluateSyntheticSafety(fixture: CurrentFixture, application: CandidateApplication): SyntheticSafetyResult {
  const oneRh = controlApplication(
    [{ midi: 64, start: 0, dur: 1, vel: 100, hand: "R" }],
    [{ midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" }],
    [{ midi: 64, start: 0, dur: 1, vel: 100, hand: "R" }],
  );
  const deferred = controlApplication(
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
    [
      { midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 41, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
    ],
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
  );
  const noDefer = controlApplication(
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
    [{ midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" }],
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
  );
  const trueRest = controlApplication([], [], [], 4);
  const lhOnly = controlApplication(
    [],
    [{ midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" }],
    [{ midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" }],
  );
  const drum = controlApplication(
    [],
    [{ midi: 36, start: 0, dur: 1, vel: 100, hand: "L", identitySource: "drums", role: "root" } as unknown as FixtureNote],
    [{ midi: 36, start: 0, dur: 1, vel: 100, hand: "L", identitySource: "drums", role: "root" } as unknown as FixtureNote],
  );
  const chords = (fixture.source as ParsedMidi & { chords?: Array<{ name?: string }> }).chords ?? [];
  const qualityCount = new Set(chords.map((chord) => chord.name).filter((name): name is string => Boolean(name))).size;
  const requiredPhenomena = {
    fillerEnteredPath: application.filler.repeated + application.filler.decorative > 0,
    trueRest: application.trueRestWindows.length > 0,
    lhOnlyPassage: application.lhOnlyWindows.length > 0,
    oneRhCollision: oneRh.considered.length > 0,
    twoRhCollision: deferred.considered.length > 1,
    deferOpportunity: deferred.considered.some((note) => note.start > 0),
    noDeferOpportunity: noDefer.considered.length > 0,
    drumProvenance: drum.considered.some((note) => provenanceOf(note) === "DRUM_DERIVED"),
    harmonicChange: qualityCount >= 2,
  };
  const repeatedApplication = controlApplication(
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
    [
      { midi: 40, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 41, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
    ],
    [
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 65, start: 0, dur: 1, vel: 100, hand: "R" },
    ],
  );
  const deterministic = compareEventSets(deferred.variant.notes, repeatedApplication.variant.notes).equal
    && deferred.emitted.map(noteTuple).join("|") === repeatedApplication.emitted.map(noteTuple).join("|");
  const observed = {
    fillerSuppressed: requiredPhenomena.fillerEnteredPath && application.filler.suppressed >= application.filler.repeated + application.filler.decorative,
    trueRestSilent: requiredPhenomena.trueRest && trueRest.emitted.length === 0,
    lhOnlyEmitted: requiredPhenomena.lhOnlyPassage && lhOnly.emitted.length > 0,
    oneRhAllowed: oneRh.collision.oneRhAllowed,
    twoRhSuppressedOrDeferred: deferred.collision.twoRhSuppressedOrDeferred || noDefer.collision.twoRhSuppressedOrDeferred,
    deferUsed: deferred.collision.deferUsed,
    noDeferSuppressed: noDefer.collision.noDeferSuppressed,
    pitchedDrumOutputs: drum.pitchedDrumOutputs,
  };
  const pass = Object.values(requiredPhenomena).every(Boolean)
    && observed.fillerSuppressed
    && observed.trueRestSilent
    && observed.lhOnlyEmitted
    && observed.oneRhAllowed
    && observed.twoRhSuppressedOrDeferred
    && observed.deferUsed
    && observed.noDeferSuppressed
    && observed.pitchedDrumOutputs === 0
    && deterministic;
  return { requiredPhenomena, observed, deterministic, pass };
}

/** Apply the frozen policy to current generated output; it never calls production mutation code. */
export function applyCollisionAwareSparseLh(
  baselineBeginner: Variant,
  veryEasy: Variant,
  source: ParsedMidi,
): CandidateApplication {
  const { byWindow, all } = selectEligibleLh(veryEasy, source);
  const provenance: Record<string, number> = {};
  const filler = { repeated: 0, decorative: 0, suppressed: 0, emitted: 0 };
  const baselineRh = baselineBeginner.notes.filter((note) => note.hand !== "L");
  const emitted: Note[] = [];
  let oneRhAllowed = false;
  let twoRhSuppressedOrDeferred = false;
  let deferUsed = false;
  let noDeferSuppressed = false;
  for (const [, list] of [...byWindow.entries()].sort(([a], [b]) => a - b)) {
    const eligible = list.filter((note) => {
      const provenanceClass = provenanceOf(note);
      provenance[provenanceClass] = (provenance[provenanceClass] ?? 0) + 1;
      if (provenanceClass === "REPEATED_SAME_HARMONY_FILLER") filler.repeated++;
      if (provenanceClass === "DECORATIVE" || provenanceClass === "ARPEGGIO_FILLER") filler.decorative++;
      return provenanceClass === "STRUCTURAL_LH" || provenanceClass === "EXPLICIT_ROOT" || provenanceClass === "EXPLICIT_BASS" || provenanceClass === "TRUSTED_VERY_EASY_LH_EVIDENCE";
    });
    const firstStart = [...new Set(eligible.map((note) => onsetKey(note.start)))].sort((a, b) => Number(a) - Number(b))[0];
    if (firstStart === undefined) {
      filler.suppressed += list.length;
      continue;
    }
    const ordered = [...new Set(eligible.map((note) => onsetKey(note.start)))].sort((a, b) => Number(a) - Number(b))
      .map((start) => eligible.filter((note) => onsetKey(note.start) === start).sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0]!);
    const first = ordered[0]!;
    const firstRh = soundingRhAt(baselineRh, first.start);
    if (maxSimultaneity([...baselineRh, ...emitted, first]) <= 2) {
      emitted.push(first);
      if (firstRh === 1) oneRhAllowed = true;
      continue;
    }
    twoRhSuppressedOrDeferred = true;
    const deferred = ordered.slice(1).find((note) => maxSimultaneity([...baselineRh, ...emitted, note]) <= 2);
    if (deferred) {
      emitted.push(deferred);
      deferUsed = true;
    } else noDeferSuppressed = true;
  }
  const emittedKeys = new Set(emitted.map(noteTuple));
  filler.emitted = emitted.filter((note) => ["REPEATED_SAME_HARMONY_FILLER", "DECORATIVE", "ARPEGGIO_FILLER"].includes(provenanceOf(note))).length;
  filler.suppressed += all.filter((note) => !emittedKeys.has(noteTuple(note)) && ["REPEATED_SAME_HARMONY_FILLER", "DECORATIVE", "ARPEGGIO_FILLER"].includes(provenanceOf(note))).length;
  const candidateNotes = [...baselineRh, ...emitted].sort((a, b) => a.start - b.start || (a.hand === "L" ? 1 : -1) || a.midi - b.midi);
  const variant: Variant = { ...baselineBeginner, notes: candidateNotes };
  const sourceWindowCount = windowsFor(source);
  const sourceRest = Array.from({ length: sourceWindowCount }, (_, index) => index)
    .filter((index) => !source.notes.some((note) => windowIndex(note.start, source) === index));
  const lhOnly = Array.from({ length: sourceWindowCount }, (_, index) => index)
    .filter((index) => source.notes.some((note) => windowIndex(note.start, source) === index && note.hand === "L")
      && !source.notes.some((note) => windowIndex(note.start, source) === index && note.hand !== "L"));
  const pitchedDrumOutputs = candidateNotes.filter((note) => (note as Note & { identitySource?: string }).identitySource === ("drums" as string)).length;
  return {
    variant,
    emitted,
    considered: all,
    provenance,
    filler,
    collision: { oneRhAllowed, twoRhSuppressedOrDeferred, deferUsed, noDeferSuppressed },
    trueRestWindows: sourceRest,
    lhOnlyWindows: lhOnly,
    pitchedDrumOutputs,
  };
}

export function generateCurrentVariants(fixture: CurrentFixture): Variant[] {
  return buildVariants(fixture.source, { title: fixture.title, artist: fixture.artist }, { arrangementProfile: "learner", maxDurBeats: null });
}

export function buildCandidateLadder(production: Variant[], candidateBeginner: Variant): Variant[] {
  const byLevel = new Map(production.map((variant) => [variant.level, variant]));
  return LEVEL_ORDER.map((level) => level === "beginner" ? candidateBeginner : byLevel.get(level)!).filter(Boolean);
}

function levelsEqual(left: Variant, right: Variant): EventSetComparison {
  return compareEventSets(left.notes, right.notes);
}

function maxSimultaneity(notes: Note[]): number {
  const events = notes.flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let max = 0;
  for (const [, delta] of events) { active += delta; max = Math.max(max, active); }
  return max;
}

function simultaneitySamples(notes: Note[]): number[] {
  const events = notes.flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  const samples: number[] = [];
  for (const [, delta] of events) { active += delta; samples.push(active); }
  return samples;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function productMetrics(variant: Variant): ProductSeparationMetrics {
  const groups = [...new Set(variant.notes.map((note) => onsetKey(note.start)))].sort();
  const tempo = variant.tempoBpm > 0 ? variant.tempoBpm : 120;
  const durationSec = Math.max(1e-9, Math.max(variant.measures.at(-1)?.endBeat ?? 0, ...variant.notes.map((note) => note.start + note.dur)) * 60 / tempo);
  const lhGroups = groups.filter((start) => variant.notes.some((note) => onsetKey(note.start) === start && note.hand === "L"));
  const bothGroups = groups.filter((start) => variant.notes.some((note) => onsetKey(note.start) === start && note.hand === "L") && variant.notes.some((note) => onsetKey(note.start) === start && note.hand !== "L"));
  const handGroups = groups.map((start) => variant.notes.filter((note) => onsetKey(note.start) === start).some((note) => note.hand === "L") ? "L" : "R");
  const alternations = handGroups.slice(1).filter((hand, index) => hand !== handGroups[index]).length;
  const levels = simultaneitySamples(variant.notes);
  return {
    level: variant.level,
    notes: variant.notes.length,
    onsets: groups.length,
    attacksPerSecond: groups.length / durationSec,
    maxSimultaneity: maxSimultaneity(variant.notes),
    medianSimultaneity: median(levels),
    lhAttacksPerMinute: lhGroups.length / durationSec * 60,
    lhActiveOnsetPercent: groups.length ? lhGroups.length / groups.length * 100 : 0,
    simultaneousRhLhPercent: groups.length ? bothGroups.length / groups.length * 100 : 0,
    handAlternationsPerMinute: alternations / durationSec * 60,
  };
}

function productSeparationPass(metrics: ProductSeparationMetrics[]): boolean {
  const byLevel = new Map(metrics.map((metric) => [metric.level, metric]));
  const veryBeginner = byLevel.get("very-beginner");
  const beginner = byLevel.get("beginner");
  const veryEasy = byLevel.get("very-easy");
  if (!veryBeginner || !beginner || !veryEasy) return false;
  return beginner.notes > veryBeginner.notes
    && beginner.notes < veryEasy.notes
    && beginner.onsets > veryBeginner.onsets
    && beginner.onsets < veryEasy.onsets
    && beginner.lhAttacksPerMinute > 0
    && beginner.lhAttacksPerMinute < veryEasy.lhAttacksPerMinute
    && beginner.maxSimultaneity <= PLAYABILITY_LIMITS.beginner!.maxSim;
}

function recovery(source: ParsedMidi, baseline: Variant, candidate: Variant): CurrentFixtureEvaluation["structuralRecovery"] {
  const total = windowsFor(source);
  const activeWindows = Array.from({ length: total }, (_, index) => index).filter((index) => source.notes.some((note) => windowIndex(note.start, source) === index));
  const erased = (variant: Variant): number[] => activeWindows.filter((index) => !variant.notes.some((note) => windowIndex(note.start, source) === index));
  const baselineErasedWindows = erased(baseline);
  const candidateErasedWindows = erased(candidate);
  return { activeWindows, baselineErasedWindows, candidateErasedWindows, recoveredWindows: baselineErasedWindows.filter((index) => !candidateErasedWindows.includes(index)) };
}

const gateDescription: Record<DeclaredReleaseGate, [string, DeclaredGateResult["scope"], string]> = {
  "fixture-bytes-fresh": ["fixture bytes are present and hashed from this run", "fixture", "byte length > 0 and SHA-256 is recorded"],
  "candidate-validation": ["candidate Beginner satisfies product playability limits", "candidate", "validateVariants returns no errors"],
  "candidate-ladder-validation": ["the actual six-level candidate ladder validates", "ladder", "six levels and no validation errors"],
  "candidate-adjacent-monotonicity": ["all adjacent candidate levels are monotonic", "ladder", "verifyMonotonicity returns no errors"],
  "beginner-rh-parity": ["candidate Beginner retains baseline Beginner RH events", "candidate", "actual normalized event sets and digests equal"],
  "non-beginner-parity": ["unaffected levels retain current production events", "ladder", "actual normalized event sets and digests equal"],
  "structural-recovery": ["candidate does not worsen active-window erasure", "candidate", "candidate erased windows <= baseline erased windows"],
  "lh-provenance": ["no unsafe or drum-derived LH output is emitted", "candidate", "unsafe and pitched-drum output counts are zero"],
  "synthetic-safety": ["synthetic control traverses rest, filler, collision, defer, and LH-only cases", "synthetic", "all required control phenomena are observed"],
  "product-separation": ["candidate occupies a meaningful Beginner middle region", "aggregate", "Beginner counts/onsets sit strictly between Very Beginner and Very Easy with sparse LH activity"],
};

export function evaluateDeclaredGates(observed: Partial<Record<DeclaredReleaseGate, boolean>>): DeclaredGateResult[] {
  return DECLARED_RELEASE_GATES.map((id) => {
    const [description, scope, threshold] = gateDescription[id];
    const pass = observed[id] === true;
    return { id, description, scope, observed: pass, threshold, status: pass ? "PASS" : "FAIL", includedInDecisionPredicate: true };
  });
}

export function evaluateCurrentFixture(fixture: CurrentFixture): CurrentFixtureEvaluation {
  const baselineLevels = generateCurrentVariants(fixture);
  const baselineBeginner = baselineLevels.find((variant) => variant.level === "beginner")!;
  const veryEasy = baselineLevels.find((variant) => variant.level === "very-easy")!;
  const application = applyCollisionAwareSparseLh(baselineBeginner, veryEasy, fixture.source);
  const ladder = buildCandidateLadder(baselineLevels, application.variant);
  const baselineLadder = evaluateDifficultyLadder({ fixture: { id: fixture.id, label: fixture.label }, sourceNotes: fixture.source.notes, variants: baselineLevels });
  const candidateLadder = evaluateDifficultyLadder({ fixture: { id: fixture.id, label: fixture.label }, sourceNotes: fixture.source.notes, variants: ladder });
  const validation = validateVariants(ladder, { maxDurBeats: null });
  const monotonicity = verifyMonotonicity(ladder);
  const baselineRh = baselineBeginner.notes.filter((note) => note.hand !== "L");
  const candidateRh = application.variant.notes.filter((note) => note.hand !== "L");
  const nonBeginner = LEVEL_ORDER.filter((level) => level !== "beginner").map((level) => {
    const baseline = baselineLevels.find((variant) => variant.level === level)!;
    const candidate = ladder.find((variant) => variant.level === level)!;
    const comparison = levelsEqual(baseline, candidate);
    return { level, eventEqual: comparison.equal, digestEqual: comparison.leftDigest === comparison.rightDigest, comparison };
  });
  const rhBase = compareEventSets(baselineRh, candidateRh);
  const rh = { ...rhBase, eventEqual: rhBase.equal, digestEqual: rhBase.leftDigest === rhBase.rightDigest };
  const structuralRecovery = recovery(fixture.source, baselineBeginner, application.variant);
  const separation = ["very-beginner", "beginner", "very-easy"].map((level) => productMetrics(ladder.find((variant) => variant.level === level)!));
  const unsafe = application.emitted.filter((note) => ["UNKNOWN_UNSAFE", "PROVENANCE_UNAVAILABLE", "DRUM_DERIVED"].includes(provenanceOf(note))).length;
  const syntheticControl = evaluateSyntheticSafety(fixture, application);
  const syntheticRequired = fixture.id === SYNTHETIC_CONTROL_ID;
  const gateTable = evaluateDeclaredGates({
    "fixture-bytes-fresh": fixture.bytes.byteLength > 0,
    "candidate-validation": validation.length === 0,
    "candidate-ladder-validation": ladder.length === LEVEL_ORDER.length && validation.length === 0,
    "candidate-adjacent-monotonicity": monotonicity.length === 0 && candidateLadder.transitions.length === LEVEL_ORDER.length - 1,
    "beginner-rh-parity": rh.equal && rh.leftDigest === rh.rightDigest,
    "non-beginner-parity": nonBeginner.every((entry) => entry.eventEqual && entry.digestEqual),
    "structural-recovery": structuralRecovery.candidateErasedWindows.length <= structuralRecovery.baselineErasedWindows.length,
    "lh-provenance": unsafe === 0 && application.pitchedDrumOutputs === 0,
    "synthetic-safety": !syntheticRequired || syntheticControl.pass,
    "product-separation": productSeparationPass(separation),
  });
  const predicateGateIds = DECLARED_RELEASE_GATES;
  return {
    fixture: { id: fixture.id, ...(fixture.label ? { label: fixture.label } : {}), logicalRef: fixture.logicalRef, bytes: fixture.bytes.byteLength, sha256: createHash("sha256").update(fixture.bytes).digest("hex") },
    baseline: { levels: baselineLevels, ladder: baselineLadder },
    candidate: { beginner: application.variant, ladder, ladderEvaluation: candidateLadder, validation: { ladder: validation, monotonicity } },
    parity: { rh, nonBeginner },
    structuralRecovery,
    separation,
    synthetic: { ...application, fillerEnteredPath: application.filler.repeated + application.filler.decorative > 0, control: syntheticControl },
    gateTable,
    decision: { predicateGateIds: [...predicateGateIds], pass: gateTable.every((gate) => gate.includedInDecisionPredicate && gate.status === "PASS") },
  };
}

export { PLAYABILITY_LIMITS };
