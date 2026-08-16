import { describe, expect, it } from "vitest";
import { fixtureTempoEvidence, sha256Hex } from "../src/fixture-evidence.js";

describe("fixture evidence", () => {
  it("provides a stable hash for source-byte identity", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("flags candidate tempo drift without treating tiny decimal noise as drift", () => {
    expect(fixtureTempoEvidence(120, 120.005).matchesExpected).toBe(true);
    expect(fixtureTempoEvidence(120, 120.02)).toMatchObject({
      expectedBpm: 120,
      actualBpm: 120.02,
      matchesExpected: false,
    });
    expect(fixtureTempoEvidence(120, 120.02).deltaBpm).toBeCloseTo(0.02, 10);
  });
});
