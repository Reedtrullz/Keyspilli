import { describe, expect, it } from "vitest";
import { validateSparseBackingTiming } from "../src/accompaniment.js";

describe("validated sparse backing timing", () => {
  const sourceFingerprint = "variant:test:notes:source-v1";

  it("accepts a finite source-boundary phase bound to the loaded source", () => {
    expect(validateSparseBackingTiming({
      timeSig: [6, 8],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: [
        { beat: 0, timeSig: [2, 4] },
        { beat: 12, timeSig: [6, 8] },
      ],
    }, sourceFingerprint)).toEqual({
      timeSig: [6, 8],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: [
        { beat: 0, timeSig: [2, 4] },
        { beat: 12, timeSig: [6, 8] },
      ],
    });
  });

  it.each([
    ["missing metadata", undefined],
    ["unknown provenance", { timeSig: [4, 4], measureStartBeat: 0, provenance: "unknown", sourceFingerprint }],
    ["invalid signature", { timeSig: [0, 4], measureStartBeat: 0, provenance: "source-measure-boundary", sourceFingerprint }],
    ["nonfinite phase", { timeSig: [4, 4], measureStartBeat: Number.NaN, provenance: "source-measure-boundary", sourceFingerprint }],
    ["stale source", { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary", sourceFingerprint: "stale" }],
    ["missing source identity", { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary" }],
  ] as const)("rejects %s", (_label, value) => {
    expect(validateSparseBackingTiming(value, sourceFingerprint)).toBeUndefined();
  });

  it("rejects unbounded phase and meter-event payloads", () => {
    const tooManyEvents = Array.from({ length: 4097 }, (_, index) => ({
      beat: index,
      timeSig: [4, 4] as const,
    }));

    expect(validateSparseBackingTiming({
      timeSig: [4, 4],
      measureStartBeat: 0,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: tooManyEvents,
    }, sourceFingerprint)).toBeUndefined();
    expect(validateSparseBackingTiming({
      timeSig: [4, 4],
      measureStartBeat: 4097,
      provenance: "source-measure-boundary",
      sourceFingerprint,
    }, sourceFingerprint)).toBeUndefined();
    expect(validateSparseBackingTiming({
      timeSig: [4, 4],
      measureStartBeat: 0,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: [{ beat: 4097, timeSig: [4, 4] }],
    }, sourceFingerprint)).toBeUndefined();
  });

  it("rejects scalar metadata that disagrees with the final meter event", () => {
    expect(validateSparseBackingTiming({
      timeSig: [4, 4],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: [{ beat: 0, timeSig: [2, 4] }, { beat: 12, timeSig: [6, 8] }],
    }, sourceFingerprint)).toBeUndefined();
  });

  it("rejects meter events beyond a supplied arrangement duration", () => {
    expect(validateSparseBackingTiming({
      timeSig: [6, 8],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint,
      timeSigEvents: [{ beat: 0, timeSig: [6, 8] }, { beat: 12, timeSig: [6, 8] }],
    }, sourceFingerprint, 8)).toBeUndefined();
  });
});
