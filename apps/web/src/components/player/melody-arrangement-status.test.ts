import { describe, expect, it } from "vitest";
import type { MelodyAccompanimentResolution } from "@keyspilli/player-core";
import { melodyArrangementOutcome } from "./melody-arrangement-status";

function arrangement(overrides: {
  changeSummary?: Partial<MelodyAccompanimentResolutionLike["changeSummary"]>;
  provenance?: Partial<MelodyAccompanimentResolutionLike["provenance"]>;
} = {}): Pick<MelodyAccompanimentResolution, "changeSummary" | "provenance"> {
  return {
    changeSummary: {
      changedBeats: 0,
      addedNotes: 0,
      removedNotes: 0,
      alteredNotes: 0,
      ...overrides.changeSummary,
    },
    provenance: {
      fallbackBeats: 0,
      generatedNoteCount: 0,
      sourceSupportNoteCount: 0,
      ...overrides.provenance,
    },
  } as Pick<MelodyAccompanimentResolution, "changeSummary" | "provenance">;
}

type MelodyAccompanimentResolutionLike = {
  changeSummary: { changedBeats: number; addedNotes: number; removedNotes: number; alteredNotes: number };
  provenance: { fallbackBeats: number; generatedNoteCount: number; sourceSupportNoteCount: number };
};

describe("melody arrangement outcome", () => {
  it("distinguishes unavailable and pending states", () => {
    const value = arrangement();
    expect(melodyArrangementOutcome("failed", value)).toBe("Original retained · arrangement unavailable");
    expect(melodyArrangementOutcome("pending", value)).toBe("Preparing arrangement · Original retained");
  });

  it("does not call unchanged source playback backing reduction", () => {
    expect(melodyArrangementOutcome("ready", arrangement({
      provenance: { sourceSupportNoteCount: 3, fallbackBeats: 1.5 },
    }))).toBe("Original retained · no backing change");
  });

  it("reports reduction only when notes were actually removed", () => {
    expect(melodyArrangementOutcome("ready", arrangement({
      changeSummary: { changedBeats: 4, addedNotes: 2, removedNotes: 1, alteredNotes: 0 },
      provenance: { generatedNoteCount: 2 },
    }))).toBe("Backing reduced");
    expect(melodyArrangementOutcome("ready", arrangement({
      changeSummary: { changedBeats: 4, addedNotes: 0, removedNotes: 0, alteredNotes: 1 },
      provenance: { sourceSupportNoteCount: 3, fallbackBeats: 1.5 },
    }))).toBe("Arrangement adjusted · Original retained in some passages");
  });

  it("keeps balance-only adjustments distinct from added support", () => {
    expect(melodyArrangementOutcome("ready", arrangement({
      changeSummary: { changedBeats: 2, addedNotes: 0, removedNotes: 0, alteredNotes: 0 },
      provenance: { sourceSupportNoteCount: 2 },
    }))).toBe("Balance adjusted");
  });
});
