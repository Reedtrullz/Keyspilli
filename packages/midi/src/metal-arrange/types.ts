import type { ChordLabel, Note, ParsedMidi } from "../types.js";

export type MetalStemRole = "vocals" | "bass" | "guitar" | "other" | "drums";

export interface MetalStem {
  role: MetalStemRole;
  /** Original separated stem when a routing-compatible role was remapped. */
  sourceStem?: MetalStemRole;
  midi: ParsedMidi;
  /** Optional separator/transcriber confidence in [0, 1]. */
  confidence?: number;
}

export interface MetalArrangementInput {
  stems: MetalStem[];
  sectionBeats?: number;
  harmonyBeats?: number;
  title?: string;
}

/** Stages exposed by the optional development provenance sidecar. */
export type MetalArrangementTraceStage =
  | "raw"
  | "cleaned"
  | "learner-arranged"
  | "advanced-candidates"
  | "advanced-playable"
  | "medium-candidates"
  | "medium-playable"
  | "easy-rh-input"
  | "easy-lh-input"
  | "easy-voice-selection"
  | "easy-assembled"
  | "easy-playable"
  | "easy-ladder"
  | "very-easy-rh-input"
  | "very-easy-playable"
  | "beginner-rh-input"
  | "beginner-rh-selected"
  | "beginner-assembled"
  | "beginner-playable"
  | "beginner-ladder"
  | "beginner-final"
  | "eligibility"
  | "selector-input"
  | "onset-group"
  | "lead"
  | "residual"
  | "cluster"
  | "semantic"
  | "decision"
  | "chord"
  | "left-hand"
  | "difficulty"
  | "final";

/** Deterministic operation recorded by an opt-in development trace. */
export type MetalArrangementTraceOperation =
  | "RETAINED"
  | "REJECTED"
  | "MERGED"
  | "COLLAPSED"
  | "REPLACED"
  | "PITCH_CHANGED"
  | "OCTAVE_SHIFTED"
  | "TIMING_CHANGED"
  | "DURATION_CHANGED"
  | "ROLE_CHANGED"
  | "HAND_CHANGED"
  | "GENERATED";

/**
 * A path-free, numeric provenance event.  This type is deliberately separate
 * from `Note`: trace references never enter serialized MIDI, IR, manifests, or
 * the public player payload.
 */
export interface MetalArrangementTraceEvent {
  key: string;
  stage: MetalArrangementTraceStage;
  parentKeys: string[];
  source?: MetalStemRole | null;
  sourceStem?: MetalStemRole | null;
  note?: { midi: number; rawMidi?: number; start: number; dur: number; vel: number; hand?: "R" | "L" };
  selected?: boolean;
  selectionReason?: string;
  operation?: MetalArrangementTraceOperation;
  confidence?: number;
  semantic?: {
    rootPc: number;
    quality: GuitarHarmonicQuality;
    bassSupported: boolean;
    memberCount: number;
  };
}

/** Development-only collector used by the local evaluator. */
export interface MetalArrangementTraceSink {
  record(event: MetalArrangementTraceEvent): void;
}

export interface MetalArrangementDebugOptions {
  trace?: MetalArrangementTraceSink;
  /** Opt-in development experiment; production callers leave this unset. */
  preSelectorRescue?: boolean;
}

export interface MetalIdentitySection {
  startBeat: number;
  endBeat: number;
  source: "vocals" | "guitar" | "other" | "mixed" | "rest";
  confidence: number;
}

export interface MetalArrangementIR {
  version: 1;
  tempoBpm: number;
  timeSig: [number, number];
  durationBeats: number;
  sections: MetalIdentitySection[];
  identity: Note[];
  harmony: ChordLabel[];
  rhythmicAccents: number[];
}

export interface MetalArrangementResult {
  parsed: ParsedMidi;
  chords: ChordLabel[];
  ir: MetalArrangementIR;
  stats: {
    identityNotes: number;
    leftHandNotes: number;
    chordEvents: number;
    sourceSections: Record<string, number>;
    guitarLead?: GuitarLeadPathDiagnostics;
    guitarPreSelector?: GuitarLeadPreSelectorDiagnostics;
    guitarHarmony?: GuitarHarmonyDiagnostics;
  };
  warnings: string[];
}

export interface MonophonicPathOptions {
  /** Prefer a plausible upper lead tone over lower rhythm/accompaniment bleed. */
  preferUpperLead?: boolean;
  /** Maximum beat distance for treating an exact octave as detector flicker. */
  exactOctaveWindow?: number;
  /** Use a phrase-local contour DP instead of selecting each onset greedily. */
  coherent?: boolean;
}

/** Internal source pitch retained until boundary cleanup is complete. */
export type IdentityNote = Note & {
  rawMidi?: number;
  /** Internal source-event references; stripped before any public result. */
  traceRefs?: readonly string[];
  /** Original separated stem role, useful when a routing alias is used. */
  traceSourceStem?: MetalStemRole;
};

export type MonophonicCandidate = IdentityNote & { rawMidi: number };

/**
 * Configuration for the source-locked guitar lead selector.  The selector is
 * deliberately small and deterministic: it only chooses notes already
 * present in a guitar stem and never infers a pitch or a new attack.
 */
export interface GuitarLeadPathOptions {
  /** Minimum attack spacing used by the path. Defaults to a playable .5 beat. */
  minimumSpacingBeats?: number;
  /** Jitter tolerance for grouping one detector attack's harmonic stack. */
  groupToleranceBeats?: number;
  /** Rest that starts a new phrase and resets continuity. */
  phraseBreakBeats?: number;
  /** Maximum candidates retained from one harmonic group. */
  maxCandidatesPerGroup?: number;
  /** Beam width for the bounded second-order path search. */
  beamWidth?: number;
  /** Whether a supported existing note may bridge a suspicious gap. */
  allowGapRecovery?: boolean;
  /** Integration-only tuning for how expensive skipping a detector group is. */
  skipPenalty?: number;
  /** Preserve short phrases for the legacy monophonic register chooser. */
  minimumPhraseGroups?: number;
}

export interface GuitarLeadPathDiagnostics {
  rawCandidateCount: number;
  harmonicGroupCount: number;
  selectedCount: number;
  recoveredCount: number;
  rejectedCount: number;
  harmonicRejectedCount: number;
  largeJumpRejectedCount: number;
  /**
   * Optional outcome accounting for the source-locked selector.  The labels
   * describe the first selector stage that explains each raw guitar
   * candidate; counts partition rawCandidateCount.  Register/cleanup remain
   * zero here because those stages belong to downstream arrangement passes.
   */
  rejectionReasons?: GuitarLeadRejectionReasons;
}

export type GuitarLeadPreSelectorRejectionReason =
  | "selector-input"
  | "invalid-raw"
  | "rhythm-only"
  | "register-rejected"
  | "confidence-rejected"
  | "source-not-melodic"
  | "other";

export type GuitarLeadPreSelectorReasons = Record<GuitarLeadPreSelectorRejectionReason, number>;

export interface GuitarLeadPreSelectorDiagnostics {
  rawSourceCount: number;
  validRawCount: number;
  selectorInputCount: number;
  removedCount: number;
  reasons: GuitarLeadPreSelectorReasons;
  rescue?: GuitarLeadPreSelectorRescueDiagnostics;
}

export interface GuitarLeadPreSelectorRescueDiagnostics {
  consideredCount: number;
  qualifyingGroupCount: number;
  rescuedCount: number;
  maxRescuedEvents: number;
}

export interface GuitarLeadPreSelectorRescueResult {
  notes: Note[];
  diagnostics: GuitarLeadPreSelectorRescueDiagnostics;
}

export type GuitarLeadRejectionReason =
  | "selected-primary"
  | "harmonic-stack-suppressed"
  | "duplicate-onset"
  | "register-rejected"
  | "leap-rejected"
  | "density-rejected"
  | "spacing-rejected"
  | "continuity-rejected"
  | "confidence-rejected"
  | "cleanup-rejected"
  | "other";

export type GuitarLeadRejectionReasons = Record<GuitarLeadRejectionReason, number>;

export interface GuitarLeadPathResult {
  notes: Note[];
  diagnostics: GuitarLeadPathDiagnostics;
}

export type GuitarHarmonicQuality = "power" | "major" | "minor" | "sus2" | "sus4" | "single" | "unknown";

/** Private semantic event retained only while constructing metal harmony. */
export interface GuitarHarmonicAttack {
  start: number;
  dur: number;
  rootPc: number;
  rootMidi: number;
  quality: GuitarHarmonicQuality;
  confidence: number;
  source: "guitar" | "other";
  evidence: number[];
  bassSupported: boolean;
  memberCount: number;
  lowMemberCount: number;
  /** Internal raw-source lineage for the optional debug trace. */
  traceRefs?: readonly string[];
}

export interface GuitarHarmonyDiagnostics {
  /** Source lane analyzed by the private semantic pass. */
  source?: "guitar" | "other";
  /** Raw notes from that analyzed source lane. */
  rawSourceNotes?: number;
  rawGuitarNotes: number;
  leadNotes: number;
  residualNotes: number;
  onsetClusterCount: number;
  semanticAttackCount: number;
  collapsedUnisonOctaveFifth: number;
  rejectedWeakThirds: number;
  bassSupportedRoots: number;
  stabilizedTransitions: number;
  emittedLeftHandEvents: number;
  /** Accepted residual phrase gates plus harmony windows using raw fallback. */
  fallbackWindows: number;
  qualityCounts: Record<GuitarHarmonicQuality, number>;
}
