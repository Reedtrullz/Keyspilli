import { createHash } from "node:crypto";

/**
 * Stable byte identity used by read-only fixture comparisons.  A metric can
 * stay unchanged while a source file is replaced, so reports should carry
 * the exact candidate hash as well as note statistics.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Small tolerance for comparing the tempo embedded in a fixture candidate. */
export const FIXTURE_TEMPO_TOLERANCE_BPM = 0.01;

export interface FixtureTempoEvidence {
  expectedBpm: number;
  actualBpm: number;
  deltaBpm: number;
  matchesExpected: boolean;
}

/**
 * Compare a candidate's MIDI tempo with the explicit fixture tempo.  This is
 * evidence about source/config drift, not a replacement for musical review.
 */
export function fixtureTempoEvidence(expectedBpm: number, actualBpm: number): FixtureTempoEvidence {
  const deltaBpm = actualBpm - expectedBpm;
  return {
    expectedBpm,
    actualBpm,
    deltaBpm,
    matchesExpected: Math.abs(deltaBpm) <= FIXTURE_TEMPO_TOLERANCE_BPM,
  };
}
