import { describe, expect, it } from "vitest";
import {
  compareCanonicalTokens,
  normalizeCanonicalScore,
  rationalBeatFrom,
  rationalBeatKey,
  type CanonicalScore,
} from "../src/omr-canonical.js";
import type { OmrScoreInput } from "../src/omr-consensus.js";

function score(
  partId: string,
  staff: number,
  voice: string,
  events: OmrScoreInput["parts"][number]["measures"][number]["events"],
): OmrScoreInput {
  return {
    parts: [{
      id: partId,
      name: "Piano",
      role: "melody",
      measures: [{
        id: "measure-1",
        number: "1",
        startBeat: 0,
        durationBeats: 4,
        timeSignature: [4, 4],
        staves: [{ number: staff, role: "harmony", voices: [{ id: voice, events: [] }], events: [] }],
        events,
      }],
    }],
  };
}

function canonical(input: OmrScoreInput): CanonicalScore {
  return normalizeCanonicalScore(input);
}

describe("canonical OMR score spine", () => {
  it("represents tuplets and decimal beats as reduced deterministic fractions", () => {
    expect(rationalBeatFrom(1 / 3)).toEqual({ numerator: 1, denominator: 3 });
    expect(rationalBeatFrom(0.125)).toEqual({ numerator: 1, denominator: 8 });
    expect(rationalBeatFrom(0.1 + 0.2)).toEqual({ numerator: 3, denominator: 10 });
  });

  it("normalizes different part, staff, and voice IDs as equivalent musical tokens", () => {
    const left = canonical(score("P1", 1, "voice-1", [{ onset: 0, duration: 1, pitch: 60, staff: 1, voice: "voice-1" }]));
    const right = canonical(score("right-hand", 7, "upper", [{ onset: 0, duration: 1, pitch: 60, staff: 7, voice: "upper" }]));

    expect(compareCanonicalTokens(left.performedTokens, right.performedTokens)).toMatchObject({
      equal: true,
      pitchDistance: 0,
      rhythmDistance: 0,
      distance: 0,
    });
    expect(left.measures[0]!.fingerprint).toBe(right.measures[0]!.fingerprint);
  });

  it("reports enharmonic spelling separately from sounding pitch agreement", () => {
    const left = canonical(score("P1", 1, "1", [{ onset: 0, duration: 1, pitch: 66, accidental: "sharp" }]));
    const right = canonical(score("P2", 2, "2", [{ onset: 0, duration: 1, pitch: 66, accidental: "flat" }]));
    const comparison = compareCanonicalTokens(left.performedTokens, right.performedTokens);

    expect(comparison.pitchDistance).toBe(0);
    expect(comparison.spellingDistance).toBeGreaterThan(0);
    expect(comparison.disagreements).toContain("spelling");
    expect(left.notationEvents[0]!.accidental).toBe("sharp");
    expect(right.notationEvents[0]!.accidental).toBe("flat");
  });

  it("collapses tied segmentation into one performed duration while retaining notation diagnostics", () => {
    const sustained = canonical(score("P1", 1, "1", [{ onset: 0, duration: 2, pitch: 60 }]));
    const tied = canonical({
      parts: [{
        id: "P1",
        measures: [{
          id: "measure-1",
          number: "1",
          startBeat: 0,
          durationBeats: 2,
          events: [
            { onset: 0, duration: 1, pitch: 60, tie: "start" },
            { onset: 1, duration: 1, pitch: 60, tie: "stop" },
          ],
        }],
      }],
    });

    expect(tied.performedTokens).toHaveLength(1);
    expect(tied.performedTokens[0]!.duration).toEqual({ numerator: 2, denominator: 1 });
    expect(tied.performedTokens[0]!.notationSegments).toHaveLength(2);
    expect(tied.notationEvents.map((event) => event.tie)).toEqual([
      { start: true, stop: false, continue: false },
      { start: false, stop: true, continue: false },
    ]);
    expect(compareCanonicalTokens(sustained.performedTokens, tied.performedTokens)).toMatchObject({ equal: true, distance: 0 });
  });

  it("collapses rounded triplet tie adjacency into one exact performed beat", () => {
    const tied = canonical({
      parts: [{
        id: "P1",
        measures: [{
          id: "measure-1",
          number: "1",
          startBeat: 0,
          durationBeats: 1,
          events: [
            { onset: 0, duration: 1 / 3, pitch: 60, tie: "start" },
            { onset: 1 / 3, duration: 1 / 3, pitch: 60, tie: "continue" },
            { onset: 2 / 3, duration: 1 / 3, pitch: 60, tie: "stop" },
          ],
        }],
      }],
    });

    expect(tied.performedTokens).toHaveLength(1);
    expect(tied.performedTokens[0]!.duration).toEqual({ numerator: 1, denominator: 1 });
    expect(tied.performedTokens[0]!.notationSegments).toHaveLength(3);
  });

  it("distinguishes true pitch and rhythm disagreements", () => {
    const reference = canonical(score("P1", 1, "1", [{ onset: 0, duration: 1, pitch: 60 }]));
    const wrong = canonical(score("P2", 8, "other", [{ onset: 0, duration: 2, pitch: 61 }]));
    const comparison = compareCanonicalTokens(reference.performedTokens, wrong.performedTokens);

    expect(comparison.equal).toBe(false);
    expect(comparison.pitchDistance).toBeGreaterThan(0);
    expect(comparison.rhythmDistance).toBeGreaterThan(0);
    expect(comparison.disagreements).toEqual(expect.arrayContaining(["pitch", "rhythm"]));
  });

  it("is deterministic when parts, measures, and events arrive in a different order", () => {
    const first = canonical({
      parts: [
        { id: "B", measures: [{ id: "b1", number: 1, startBeat: 0, durationBeats: 4, events: [{ onset: 2, duration: 1, pitch: 64 }, { onset: 0, duration: 1, pitch: 60 }] }] },
        { id: "A", measures: [{ id: "a1", number: 1, startBeat: 0, durationBeats: 4, events: [{ onset: 1, duration: 1, pitch: 67 }] }] },
      ],
    });
    const second = canonical({
      parts: [
        { id: "A", measures: [{ id: "a1", number: 1, startBeat: 0, durationBeats: 4, events: [{ onset: 1, duration: 1, pitch: 67 }] }] },
        { id: "B", measures: [{ id: "b1", number: 1, startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch: 60 }, { onset: 2, duration: 1, pitch: 64 }] }] },
      ],
    });

    expect(first).toEqual(second);
    expect(rationalBeatKey(first.performedTokens[0]!.onset)).toBe("0/1");
  });
});
