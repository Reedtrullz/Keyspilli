import type {
  MelodyAccompanimentOptions,
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

/** Optional browser instrumentation used by the disposable E2E harness. */
export function traceMelodyArrangement(event: MelodyArrangementTrace): void {
  const hook = (globalThis as unknown as {
    __keyspilliMelodyArrangementTrace?: (event: MelodyArrangementTrace) => void;
  }).__keyspilliMelodyArrangementTrace;
  if (typeof hook === "function") hook(event);
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
