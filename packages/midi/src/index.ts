export * from "./types.js";
export { parseMidi } from "./parse.js";
export { quantize } from "./quantize.js";
export { splitHands, detectKey, keyName, chordName, detectBassPattern, melodyFrom, keySignature } from "./analyze.js";
export { buildVariants, reduceMediumRhythm, padPitches, melodyOnly, normalizeTempoBpm, SAFE_TEMPO_BPM } from "./simplify.js";
export { validateVariants, PLAYABILITY_LIMITS } from "./validate.js";
export type { VariantValidationOptions } from "./validate.js";
export {
  cleanTranscription,
  sanitizeImportedNotes,
  maxDurationBeatsForTempo,
  transcriptionMaxDurationBeats,
  TRANSCRIPTION_CLEANUP_CONFIG,
  DEFAULT_IMPORTED_MAX_DUR_SEC,
  DEFAULT_IMPORTED_MAX_SOUNDING,
} from "./clean.js";
export { writeMidi } from "./writeMidi.js";
export { writeMusicXml } from "./writeXml.js";
export { buildMetalArrangement, rescueGuitarPreSelectorCandidates, selectGuitarLeadPath } from "./metal-arrange.js";
export type {
  GuitarLeadPathDiagnostics,
  GuitarLeadPreSelectorDiagnostics,
  GuitarLeadPreSelectorRejectionReason,
  GuitarLeadPreSelectorReasons,
  GuitarLeadRejectionReason,
  GuitarLeadRejectionReasons,
  GuitarLeadPathOptions,
  GuitarLeadPathResult,
  GuitarHarmonyDiagnostics,
  GuitarLeadPreSelectorRescueDiagnostics,
  GuitarLeadPreSelectorRescueResult,
  MetalArrangementInput,
  MetalArrangementDebugOptions,
  MetalArrangementIR,
  MetalArrangementResult,
  MetalArrangementTraceEvent,
  MetalArrangementTraceOperation,
  MetalArrangementTraceSink,
  MetalArrangementTraceStage,
  MetalStem,
  MetalStemRole,
} from "./metal-arrange.js";
export { PITCH_COLORS, pitchColor } from "./pitchColors.js";
export { parseMusicXmlNotes } from "./parseXml.js";
export { ARTIFACT_TEMPO_TOLERANCE, writeVariantArtifacts, validateArtifactFiles, validateArtifactRoundtrip } from "./roundtrip.js";
export {
  parseChordSymbol,
  tryParseChordSymbol,
  chordIntervals,
  chordPitchClasses,
  chordToNotes,
  generateChordNotes,
  chordToMidi,
  chordToNoteEvents,
  transposeChordSymbol,
  capoChordSymbol,
  applyCapo,
  transposeMidiNotes,
  validateChordLabels,
} from "./chords.js";
export {
  melodyContinuity,
  rhLhBalance,
  soundingDensity,
  arrangementQualityReport,
} from "./arrangement-quality.js";
export type { RhLhBalance, ArrangementQualityReport } from "./arrangement-quality.js";
export { verifyMonotonicity } from "./validate.js";
export {
  splitPianoRoles,
} from "./piano-roles.js";
export type {
  PianoRoleOptions,
  PianoNoteRole,
  ProtectedMelodyNote,
  PianoRoleSplit,
} from "./piano-roles.js";
export {
  groupAttackClusters,
  groupPianoAttackClusters,
  inferPianoHarmony,
  realizePianoAccompaniment,
  simplifyPianoAccompaniment,
  DEFAULT_PIANO_ACCOMPANIMENT_CONFIG,
} from "./piano-accompaniment.js";
export type {
  PianoHarmonyQuality,
  PianoAttackCluster,
  PianoHarmonyEvidence,
  PianoAccompanimentConfig,
  PianoSemanticHarmony,
  PianoAccompanimentDiagnostics,
  PianoAccompanimentOptions,
  PianoAttackInput,
  PianoAttackCollection,
  PianoBassEvidence,
  PianoSemanticQuality,
  PianoHarmony,
} from "./piano-accompaniment.js";
export {
  assessPianoRegionCoverage,
  selectPianoMelodyRegions,
  clipRegionNotes,
  scorePianoRegion,
} from "./piano-region-selector.js";
export type {
  PianoRegionRole,
  CandidateCoverageWindow,
  RoleCoverage,
  PianoRegionCoverageGateOptions,
  CandidateRegion,
  PianoRegionWindow,
  PianoRegionCandidate,
  PianoRegionScoreWeights,
  PianoRegionScore,
  PianoRegionSelectionOptions,
  PianoRegionSelectionDiagnostics,
  PianoRegionSelection,
} from "./piano-region-selector.js";
