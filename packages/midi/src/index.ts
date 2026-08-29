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
export { buildMetalArrangement, selectGuitarLeadPath } from "./metal-arrange.js";
export type {
  GuitarLeadPathDiagnostics,
  GuitarLeadPathOptions,
  GuitarLeadPathResult,
  GuitarHarmonyDiagnostics,
  MetalArrangementInput,
  MetalArrangementIR,
  MetalArrangementResult,
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
