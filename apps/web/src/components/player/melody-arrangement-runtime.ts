import type {
  MelodyAccompanimentOptions,
  MelodyAccompanimentResolution,
  MelodyHarmonicSupportPolicy,
  MelodyPhraseOverride,
  MelodySelection,
  SourceBackingMode,
  SparseBackingTiming,
} from "@keyspilli/player-core";

// Node 22 warm medians on the frozen fixtures stay below 50 ms through 256
// notes; larger requests use the worker. Re-measure if the producer changes.
export const MELODY_WORKER_NOTE_THRESHOLD = 256;

export type MelodyArrangementExecution = "source" | "sync" | "worker";

export type MelodyArrangementTrace = {
  phase: "source-view" | "sync-start" | "sync-complete" | "worker-create" | "worker-request" | "worker-ready" | "worker-error";
  execution: MelodyArrangementExecution;
  noteCount: number;
  key?: string;
  resolutionFingerprint?: string;
  error?: string;
};

export function buildMelodyArrangementOptions(input: {
  durationBeats: number;
  sourceFingerprint: string | null;
  selection: MelodySelection;
  phraseOverrides: readonly MelodyPhraseOverride[];
  harmonicSupport: MelodyHarmonicSupportPolicy;
  sourceBackingMode: SourceBackingMode;
  sparseBackingTiming?: SparseBackingTiming;
}): MelodyAccompanimentOptions {
  return {
    durationBeats: input.durationBeats,
    sourceFingerprint: input.sourceFingerprint,
    selection: input.selection,
    allowRests: true,
    soundingPolicy: "coherent-phrase",
    phraseOverrides: input.phraseOverrides,
    harmonicSupport: input.harmonicSupport,
    sourceBackingMode: input.sourceBackingMode,
    ...(input.sparseBackingTiming ? { sparseBackingTiming: input.sparseBackingTiming } : {}),
  };
}

/** Compact deterministic output signature used to compare sync and worker producers. */
export function melodyArrangementResolutionFingerprint(resolution: MelodyAccompanimentResolution): string {
  const serialized = JSON.stringify({
    style: resolution.style,
    notes: resolution.notes,
    chords: resolution.chords,
    displayChords: resolution.displayChords,
    guidanceNotes: resolution.guidanceNotes,
    fallbackSpans: resolution.fallbackSpans,
    melody: resolution.melody,
    protectedMelody: resolution.protectedMelody,
    events: resolution.events,
    phrases: resolution.phrases,
    changeSummary: resolution.changeSummary,
    provenance: resolution.provenance,
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Optional browser instrumentation used by the disposable E2E harness. */
export function traceMelodyArrangement(event: MelodyArrangementTrace | (() => MelodyArrangementTrace)): void {
  const hook = (globalThis as unknown as {
    __keyspilliMelodyArrangementTrace?: (event: MelodyArrangementTrace) => void;
  }).__keyspilliMelodyArrangementTrace;
  if (typeof hook !== "function") return;
  hook(typeof event === "function" ? event() : event);
}

/** Keep the producer off the render path for Original and large arrangements. */
export function melodyArrangementExecution(
  noteCount: number,
  requested: boolean,
  workerAvailable: boolean,
): MelodyArrangementExecution {
  if (!requested) return "source";
  if (noteCount >= MELODY_WORKER_NOTE_THRESHOLD) return workerAvailable ? "worker" : "source";
  return "sync";
}
