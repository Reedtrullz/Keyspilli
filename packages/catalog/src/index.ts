export * from "./db.js";
export * from "./paths.js";
export * from "./ingest.js";
export * from "./group.js";
export * from "./public-difficulty.js";
export * from "./transcribe.js";
export * from "./learner-review.js";
export * from "./manifest.js";
export * from "./artifact-manifest.js";
export * from "./provenance.js";
export * from "./publish.js";
export * from "./legacy-migration.js";
export * from "./chord-sources.js";
export * from "./chord-timeline.js";
export * from "./youtube-source.js";
export * from "./youtube-meta.js";
export * from "./youtube-discovery.js";
export * from "./recording-discovery.js";
export * from "./fixture-evidence.js";
export * from "./arrangement-evaluation.js";
export * from "./difficulty-contract-audit.js";
export * from "./cover-rh-cliff.js";
export * from "./beginner-offgrid-rh-frontier.js";
export * from "./song-research.js";
export * from "./symbolic-alignment.js";
export * from "./piano-alignment.js";
export * from "./piano-evaluation.js";
export * from "./midi-renderer.js";
export * from "./research-report.js";
export * from "./research-cache.js";
export * from "./generic-source-ranking.js";
export * from "./source-candidate-handoff.js";
export * from "./listening-manifest.js";
export * from "./piano-candidate-diagnostics.js";
export * from "./piano-section-builder.js";
export * from "./score-benchmark.js";
export * from "./score-listening-pack.js";
export * from "./rotating-listening-bundle.js";
export * from "./omr-canonical.js";
export * from "./omr-hierarchical-alignment.js";
export * from "./omr-role-reference.js";
export * from "./keyspilli-regression.js";
export * from "./native-score-discovery.js";
export * from "./harmony-evaluation.js";
export * from "./harmony-benchmark-manifest.js";
export * from "./harmony-benchmark.js";
export * from "./recognizability-pre-gate.js";
export * from "./midi-corpus-roles.js";
export * from "./midi-corpus.js";
export * from "./midi-corpus-report.js";
export * from "./direct-amt-evaluation.js";
export * from "./dense-metal-amt-evaluation.js";
export * from "./audio-symbolic-alignment.js";
export * from "./score-audio-alignment.js";
export * from "./upstream-attribution-runner.js";
export * from "./external-retrieval.js";
export * from "./generation-candidate-intake.js";
export * from "./region-ownership.js";
export * from "./shadow-corpus.js";
// The local shadow modules intentionally have a few similarly named input
// records.  Keep the public barrel explicit so consumers get one canonical
// corpus manifest type while adapter/evaluator-specific records remain
// available under unambiguous names.  The modules themselves stay directly
// importable for local tooling.
export {
  SHADOW_CORPUS_ADAPTER_SCHEMA_VERSION,
  SHADOW_CORPUS_ADAPTER_VERSION,
  SHADOW_CORPUS_MAX_BYTES,
  SHADOW_INSTRUMENT_ROLES,
  adaptShadowCorpusMidiBytes,
  adaptShadowMidiBytes,
  adaptShadowCorpusMidiFile,
  buildShadowCorpusItem,
  adaptShadowCorpusItem,
  shadowCorpusAdapterJson,
  ShadowCorpusAdapterError,
} from "./shadow-corpus-adapter.js";
export type {
  ShadowInstrumentRole,
  ShadowGenerationEligibility as ShadowAdapterGenerationEligibility,
  ShadowEvaluationEligibility as ShadowAdapterEvaluationEligibility,
  ShadowMediaStatus as ShadowAdapterMediaStatus,
  ShadowCorpusSourceRecord as ShadowAdapterSourceRecord,
  ShadowCorpusMediaRecord as ShadowAdapterMediaRecord,
  ShadowCorpusProgramChange,
  ShadowCorpusTrackSummary as ShadowAdapterTrackSummary,
  ShadowCorpusNote as ShadowAdapterNote,
  ShadowCorpusMidiAdapterResult,
  ShadowCorpusItemInput as ShadowAdapterItemInput,
  ShadowCorpusAdapterPathOptions,
  ShadowCorpusItem as ShadowAdapterItem,
  ShadowCorpusAdapterReport,
  ShadowCorpusAdapterErrorRecord,
} from "./shadow-corpus-adapter.js";
export * from "./shadow-alignment.js";
export * from "./upstream-attribution.js";
export * from "./cold-metal-transfer.js";
export * from "./texture-amt-routing.js";
export * from "./gaps-attribution.js";
export {
  shadowItemToMetalStems,
  evaluateShadowItem,
  evaluateShadowCorpus,
  evaluateShadowManifest,
  canonicalShadowEvaluationJson,
} from "./shadow-evaluation.js";
export type {
  ShadowTrackRole,
  ShadowTrackInput as ShadowEvaluationTrackInput,
  ShadowMediaInput as ShadowEvaluationMediaInput,
  ShadowCorpusItemInput as ShadowEvaluationItemInput,
  ShadowCorpusManifestInput as ShadowEvaluationManifestInput,
  ShadowRoleMetrics,
  ShadowInputMetrics,
  ShadowMelodyMetrics,
  ShadowHarmonyMetrics,
  ShadowDrumMetrics,
  ShadowTextureMetrics,
  ShadowVariantMetrics,
  ShadowReadiness,
  ShadowItemEvaluationReport,
  ShadowCorpusEvaluationReport,
  ShadowEvaluationOptions,
  ShadowRoleNotes,
} from "./shadow-evaluation.js";
