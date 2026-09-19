import { describe, expect, it } from "vitest";
import type { MelodyAccompanimentResolution, SparseBackingTiming } from "@keyspilli/player-core";
import {
  auditionNotesForRole,
  buildMelodyArrangementOptions,
  melodyArrangementExecution,
  melodyArrangementResolutionFingerprint,
  traceMelodyArrangement,
} from "./melody-arrangement-runtime";

describe("melody arrangement execution", () => {
  it("does not audition melody events as Bass + chords backing", () => {
    const melody = { midi: 72, start: 0, dur: 1, vel: 90 } as const;
    const backing = { midi: 48, start: 0, dur: 1, vel: 60 } as const;
    const events = [
      { id: "melody", note: melody, role: "melody" as const, sourceNoteIds: ["m"] },
      { id: "backing", note: backing, role: "accompaniment" as const, sourceNoteIds: ["b"] },
    ];

    expect(auditionNotesForRole("bass-chords", events, [])).toEqual([]);
    expect(auditionNotesForRole("melody-accompaniment", events, [])).toEqual([backing]);
  });

  it("does not run the producer for Original or disabled paths", () => {
    expect(melodyArrangementExecution(1_891, false, true)).toBe("source");
    expect(melodyArrangementExecution(1_891, true, false)).toBe("source");
  });

  it("uses the worker for large requested arrangements", () => {
    expect(melodyArrangementExecution(256, true, true)).toBe("worker");
  });

  it("keeps only bounded small arrangements synchronous", () => {
    expect(melodyArrangementExecution(255, true, true)).toBe("sync");
  });

  it("builds one immutable option shape for sync and worker callers", () => {
    const sparseBackingTiming: SparseBackingTiming = {
      timeSig: [6, 8],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint: "source-v1",
    };
    expect(buildMelodyArrangementOptions({
      durationBeats: 12,
      sourceFingerprint: "source-v1",
      selection: "automatic",
      phraseOverrides: [],
      harmonicSupport: "authored-only",
      sourceBackingMode: "default",
      sparseBackingTiming,
    })).toEqual({
      durationBeats: 12,
      sourceFingerprint: "source-v1",
      selection: "automatic",
      allowRests: true,
      soundingPolicy: "coherent-phrase",
      phraseOverrides: [],
      harmonicSupport: "authored-only",
      sourceBackingMode: "default",
      sparseBackingTiming,
    });
  });

  it("fingerprints the complete resolution for browser-worker parity", () => {
    const resolution = {
      style: "melody-accompaniment",
      notes: [],
      chords: [],
      displayChords: [],
      guidanceNotes: [],
      fallbackSpans: [],
      melody: [],
      protectedMelody: [],
      events: [],
      phrases: [],
      changeSummary: {
        durationBeats: 8,
        changedBeats: 2,
        unchangedBeats: 6,
        silentBeats: 0,
        reviewBeats: 0,
        addedNotes: 1,
        removedNotes: 0,
        alteredNotes: 0,
      },
      provenance: {
        schemaVersion: 1,
        generatorVersion: "melody-accompaniment.v2",
        sourceFingerprint: "source-v1",
        selection: "automatic",
        selectionProvenance: "inferred",
        sourceNoteCount: 0,
        melodyNoteIds: [],
        unresolvedSpans: [],
        sourceSupportNoteCount: 0,
        generatedNoteCount: 1,
        generatedBeats: 2,
        soundingReattackCount: 0,
        fallbackBeats: 0,
        supportModes: ["sparse-harmonic"],
      },
    } satisfies MelodyAccompanimentResolution;
    const fingerprint = melodyArrangementResolutionFingerprint(resolution);
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint).toBe(melodyArrangementResolutionFingerprint(resolution));
  });

  it("does not build lazy trace payloads without an installed hook", () => {
    const target = globalThis as typeof globalThis & {
      __keyspilliMelodyArrangementTrace?: (event: unknown) => void;
    };
    const previous = target.__keyspilliMelodyArrangementTrace;
    let built = 0;
    try {
      delete target.__keyspilliMelodyArrangementTrace;
      traceMelodyArrangement(() => {
        built += 1;
        return { phase: "sync-complete", execution: "sync", noteCount: 0 };
      });
      expect(built).toBe(0);

      target.__keyspilliMelodyArrangementTrace = () => {};
      traceMelodyArrangement(() => {
        built += 1;
        return { phase: "sync-complete", execution: "sync", noteCount: 0 };
      });
      expect(built).toBe(1);
    } finally {
      if (previous) target.__keyspilliMelodyArrangementTrace = previous;
      else delete target.__keyspilliMelodyArrangementTrace;
    }
  });
});
