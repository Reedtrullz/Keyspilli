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
});
