import { buildMelodyAccompaniment, type MelodyAccompanimentOptions } from "@keyspilli/player-core";
import type { ChordLabel, Note } from "@keyspilli/midi";

type ArrangementRequest = {
  requestId: number;
  sourceNotes: readonly Note[];
  chordTimeline: readonly ChordLabel[];
  options: MelodyAccompanimentOptions;
};

type ArrangementScope = {
  onmessage: ((event: MessageEvent<ArrangementRequest>) => void) | null;
  postMessage(value: unknown): void;
};

const scope = globalThis as unknown as ArrangementScope;

scope.onmessage = (event) => {
  const request = event.data;
  try {
    const resolution = buildMelodyAccompaniment(request.sourceNotes, request.chordTimeline, request.options);
    scope.postMessage({ requestId: request.requestId, resolution });
  } catch (error) {
    scope.postMessage({
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
