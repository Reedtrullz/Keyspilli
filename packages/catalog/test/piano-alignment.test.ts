import { describe, expect, it } from "vitest";
import {
  alignPianoCandidates,
  type PianoAlignmentRegionInput,
  type PianoScoreInput,
} from "../src/piano-alignment.js";

function score(starts: number[], pitches: number[], duration?: number): PianoScoreInput {
  return {
    notes: starts.map((start, index) => ({ midi: pitches[index]!, start, dur: 0.6, vel: 90 })),
    durationBeats: duration ?? Math.max(...starts, 0) + 1,
    tempoBpm: 120,
  };
}

describe("constrained piano timing alignment", () => {
  it("recovers a global intro offset, tempo relationship, and transposition metadata", () => {
    const reference = score([0, 1, 2, 3], [60, 62, 64, 65]);
    const candidate = score([2, 3.25, 4.5, 5.75], [63, 65, 67, 68]);

    const result = alignPianoCandidates(reference, candidate, {
      transpositionSemitones: [-3, 0, 3],
    });

    expect(result.status).toBe("aligned");
    expect(result.offsetBeats).toBe(2);
    expect(result.tempoScale).toBe(1.25);
    expect(result.transpositionSemitones).toBe(-3);
    expect(result.matches).toHaveLength(4);
    expect(result.coverage.referenceRatio).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("follows bounded monotonic piecewise timing drift", () => {
    const reference = score([0, 1, 2, 3, 4, 5], [60, 62, 64, 65, 67, 69], 6.5);
    const candidate = score([1, 2.05, 3.2, 4.45, 5.8, 7.25], [60, 62, 64, 65, 67, 69], 8);

    const result = alignPianoCandidates(reference, candidate, {
      maxSegments: 4,
      maxLocalTempoScale: 1.5,
      maxWarpBeats: 1.5,
    });

    expect(result.status).toBe("aligned");
    expect(result.matches).toHaveLength(6);
    expect(result.mapping.every((point, index) => index === 0 || point.candidateBeat >= result.mapping[index - 1]!.candidateBeat)).toBe(true);
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments.every((segment) => segment.tempoScale > 0 && segment.tempoScale <= 1.5)).toBe(true);
  });

  it("reports coverage and confidence independently for annotated regions", () => {
    const reference = score([0, 1, 2, 3, 4, 5], [60, 62, 64, 65, 67, 69], 6.5);
    const candidate = score([2, 3, 4, 6, 7], [60, 62, 64, 67, 69], 8);
    const regions: PianoAlignmentRegionInput[] = [
      { id: "intro", reference: [0, 3], candidate: [2, 5] },
      { id: "ending", reference: [3, 6], candidate: [5, 8] },
    ];

    const result = alignPianoCandidates(reference, candidate, { regions });
    const intro = result.regions.find((region) => region.id === "intro")!;
    const ending = result.regions.find((region) => region.id === "ending")!;

    expect(result.status).toBe("partial");
    expect(result.regions).toHaveLength(2);
    expect(intro.coverage.referenceRatio).toBe(1);
    expect(ending.coverage.referenceRatio).toBeLessThan(1);
    expect(ending.confidence).toBeLessThan(intro.confidence);
  });

  it("rejects a pathological warp instead of fabricating alignment", () => {
    const reference = score([0, 1, 2, 3], [60, 62, 64, 65], 4.5);
    const candidate = score([0, 1, 9, 10], [60, 62, 64, 65], 11);

    const result = alignPianoCandidates(reference, candidate, {
      maxLocalTempoScale: 2,
      maxWarpBeats: 0.75,
    });

    expect(result.status).toBe("rejected");
    expect(result.matches).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.includes("pathological"))).toBe(true);
  });

  it("is deterministic for reordered notes and preserves the mapping contract", () => {
    const reference = score([0, 1, 2], [60, 64, 67]);
    const candidate = score([1, 2, 3], [60, 64, 67]);
    const options = { transpositionSemitones: [0], maxSegments: 3 };
    const first = alignPianoCandidates(reference, candidate, options);
    const second = alignPianoCandidates(
      { ...reference, notes: [...reference.notes].reverse() },
      { ...candidate, notes: [...candidate.notes].reverse() },
      options,
    );

    expect(second).toEqual(first);
    expect(first.mapping).toEqual([
      { referenceBeat: 0, candidateBeat: 1 },
      { referenceBeat: 1, candidateBeat: 2 },
      { referenceBeat: 2, candidateBeat: 3 },
    ]);
  });

  it("uses explicit regions as alignment anchors instead of post-hoc decoration", () => {
    const reference = score([0, 1, 100, 101], [60, 62, 64, 65], 102);
    const candidate = score([2, 3, 102, 103], [60, 62, 64, 65], 104);
    const result = alignPianoCandidates(reference, candidate, {
      tempoScales: [1],
      transpositionSemitones: [0],
      offsetBeats: [2],
      regions: [{ id: "intro", reference: [0, 2], candidate: [2, 4] }],
    });

    expect(result.mapping).toEqual([
      { referenceBeat: 0, candidateBeat: 2 },
      { referenceBeat: 1, candidateBeat: 3 },
    ]);
    expect(result.regions[0]?.matchedOnsets).toBe(2);
    expect(result.regions[0]?.coverage.referenceRatio).toBe(1);
  });

  it("keeps the default search bounded on a realistic long score", () => {
    const count = 500;
    const reference: PianoScoreInput = {
      notes: Array.from({ length: count }, (_value, index) => ({ midi: 60 + (index % 7), start: index * 0.5, dur: 0.25, vel: 90 })),
      durationBeats: count * 0.5 + 1,
      tempoBpm: 120,
    };
    const candidate: PianoScoreInput = {
      notes: reference.notes.map((note) => ({ ...note, start: note.start * 1.02 + 2, midi: note.midi + 2 })),
      durationBeats: count * 0.5 * 1.02 + 3,
      tempoBpm: 118,
    };
    const result = alignPianoCandidates(reference, candidate, {
      tempoScales: [1, 1.02],
      transpositionSemitones: [-2, 0, 2],
      maxIntroOffsetBeats: 8,
    });

    expect(result.matches.length).toBeGreaterThan(450);
  }, 10_000);
});
