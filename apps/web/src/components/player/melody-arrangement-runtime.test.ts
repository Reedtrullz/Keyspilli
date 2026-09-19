import { describe, expect, it } from "vitest";
import type { SparseBackingTiming } from "@keyspilli/player-core";
import { buildMelodyArrangementOptions, melodyArrangementExecution } from "./melody-arrangement-runtime";

describe("melody arrangement execution", () => {
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
});
