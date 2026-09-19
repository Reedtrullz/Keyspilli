import type { MelodyAccompanimentResolution } from "@keyspilli/player-core";

type ArrangementState = "ready" | "pending" | "failed";

const EPSILON = 1e-6;

export function melodyArrangementOutcome(
  state: ArrangementState,
  arrangement: Pick<MelodyAccompanimentResolution, "changeSummary" | "provenance">,
): string {
  if (state === "failed") return "Original retained · arrangement unavailable";
  if (state === "pending") return "Preparing arrangement · Original retained";

  const changed = arrangement.changeSummary.changedBeats > EPSILON;
  const fallback = arrangement.provenance.fallbackBeats > EPSILON;
  const backingReduced = arrangement.changeSummary.removedNotes > 0;
  if (!changed) return "Original retained · no backing change";
  if (arrangement.changeSummary.addedNotes === 0
    && arrangement.changeSummary.removedNotes === 0
    && arrangement.changeSummary.alteredNotes === 0) {
    return fallback ? "Balance adjusted · Original retained in some passages" : "Balance adjusted";
  }
  if (fallback && backingReduced) return "Backing reduced · Original retained in some passages";
  if (backingReduced) return "Backing reduced";
  return fallback ? "Arrangement adjusted · Original retained in some passages" : "Arrangement adjusted";
}
