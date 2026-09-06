import { describe, expect, it } from "vitest";
import {
  buildTextureRoutingPlan,
  canonicalTextureRouting,
  evaluateTextureRouting,
  hashCanonicalTextureRouting,
  type TextureRoutingPlanInput,
} from "../src/texture-amt-routing.js";
import type { ColdTransferNoteInput, ColdTransferRoute } from "../src/cold-metal-transfer.js";

const note = (midi: number, start: number, dur = 0.5, sourceIndex?: number): ColdTransferNoteInput => ({
  midi,
  start,
  dur,
  ...(sourceIndex === undefined ? {} : { sourceIndex }),
});

const song = (overrides: Partial<TextureRoutingPlanInput["songs"][number]> = {}): TextureRoutingPlanInput["songs"][number] => ({
  id: "synthetic-texture",
  duration: 8,
  basic: [note(60, 0)],
  gaps: [note(60, 0)],
  ...overrides,
});

describe("texture AMT routing evidence", () => {
  it("builds fixed half-open windows and a stable canonical hash", () => {
    const input: TextureRoutingPlanInput = {
      timebase: "beats",
      windowSize: 4,
      songs: [
        song({ id: "z-song", duration: 9.5, basic: [note(60, 0, 0.5, 0), note(62, 8.5, 0.5, 1)], gaps: [note(60, 0, 0.5, 0)] }),
        song({ id: "a-song", duration: 9.5, basic: [note(64, 4)], gaps: [note(64, 4)] }),
      ],
    };
    const first = buildTextureRoutingPlan(input);
    const second = buildTextureRoutingPlan({
      ...input,
      songs: input.songs.slice().reverse().map((item) => ({
        ...item,
        basic: Array.isArray(item.basic) ? item.basic.slice().reverse() : item.basic,
        gaps: Array.isArray(item.gaps) ? item.gaps.slice().reverse() : item.gaps,
      })),
    });

    expect(first).toEqual(second);
    expect(first.songs[0]!.id).toBe("a-song");
    expect(first.songs[0]!.windows.map(({ window }) => window)).toEqual([
      { id: "w0000", start: 0, end: 4 },
      { id: "w0001", start: 4, end: 8 },
      { id: "w0002", start: 8, end: 9.5 },
    ]);
    expect(hashCanonicalTextureRouting(first)).toBe(hashCanonicalTextureRouting(second));
    expect(canonicalTextureRouting(first)).toBe(canonicalTextureRouting(second));
  });

  it("selects different backend winners per window and aggregates the oracle", () => {
    const plan = buildTextureRoutingPlan({
      timebase: "beats",
      windowSize: 4,
      songs: [song({ basic: [note(60, 0)], gaps: [note(64, 4)] })],
    });
    const report = evaluateTextureRouting({ plan, truth: [{ id: "synthetic-texture", notes: [note(60, 0), note(64, 4)] }] });
    const result = report.songs[0]!;

    expect(result.windows.map(({ winners }) => winners.exact)).toEqual(["basic", "gaps"]);
    expect(result.windows.map(({ ties }) => ties.exact)).toEqual([false, false]);
    expect(result.backendSelectionOracle.winnerCounts.exact).toEqual({ basic: 1, gaps: 1 });
    expect(result.backendSelectionOracle.tieCounts.exact).toBe(0);
    expect(result.backendSelectionOracle.metrics.exact).toMatchObject({ matches: 2, predictedCount: 2, truthCount: 2, f1: 1 });
    expect(result.backendSelectionOracle.gainOverBestSingle.exact).toBeCloseTo(1 / 3, 6);
    expect(report.decision.routingCeiling).toBe("ROUTING_CEILING_LOW");
  });

  it("keeps the note-union oracle finite and de-duplicates equivalent predictions", () => {
    const plan = buildTextureRoutingPlan({
      timebase: "beats",
      windows: [{ id: "whole", start: 0, end: 2 }],
      songs: [song({ duration: 2, basic: [note(60, 0), note(60, 0)], gaps: [note(60, 0), note(62, 1)] })],
    });
    const result = evaluateTextureRouting({ plan, truth: [{ id: "synthetic-texture", notes: [note(60, 0), note(62, 1)] }] }).songs[0]!;
    const union = result.noteUnionOracle.exact;

    expect(union).toMatchObject({ matches: 2, predictedCount: 2, truthCount: 2, precision: 1, recall: 1, f1: 1 });
    expect(union.matches).toBeLessThanOrEqual(union.truthCount);
    expect(result.bestSingle.basic.exact.predictedCount).toBe(2);
  });

  it("classifies exact, pitch-class, timing-only, and duplicate agreement one-to-one", () => {
    const plan = buildTextureRoutingPlan({
      timebase: "beats",
      onsetTolerance: 0.08,
      windows: [{ id: "whole", start: 0, end: 3 }],
      songs: [song({
        duration: 3,
        basic: [note(60, 0), note(60, 0), note(62, 1), note(64, 2)],
        gaps: [note(60, 0.01), note(74, 1.01), note(67, 2.01)],
      })],
    });
    const generation = plan.songs[0]!.windows[0]!.generation;
    const result = evaluateTextureRouting({ plan, truth: [{ id: "synthetic-texture", notes: [note(60, 0), note(62, 1), note(64, 2)] }] }).songs[0]!;

    expect(generation.agreement).toEqual({ matched: 3, bothExact: 1, bothPitchClassOnly: 1, bothTimingOnly: 1, basicOnly: 1, gapsOnly: 0 });
    expect(result.agreement.exact.shared.candidateCount).toBe(1);
    expect(result.agreement.exact.basicOnly.candidateCount).toBe(3);
    expect(result.agreement.pitchClass.shared.candidateCount).toBe(2);
    expect(result.agreement.octaveDisagreement).toEqual({
      pairs: 1,
      basicExactMatches: 1,
      gapsExactMatches: 0,
      basicPitchClassMatches: 1,
      gapsPitchClassMatches: 1,
    });
  });

  it("keeps planning independent of truth and uses source duration for windows", () => {
    const plan = buildTextureRoutingPlan({
      timebase: "seconds",
      windowSize: 4,
      songs: [song({ duration: 8, basic: [note(60, 99)], gaps: [note(62, 99)] })],
    });
    const before = canonicalTextureRouting(plan);
    const report = evaluateTextureRouting({ plan, truth: [{ id: "synthetic-texture", notes: [note(64, 1), note(65, 7)] }] });

    expect(plan.songs[0]!.windows.map(({ window }) => window)).toEqual([
      { id: "w0000", start: 0, end: 4 },
      { id: "w0001", start: 4, end: 8 },
    ]);
    expect(report.songs[0]!.windows.map(({ truthNoteCount }) => truthNoteCount)).toEqual([1, 1]);
    expect(canonicalTextureRouting(plan)).toBe(before);
    expect(plan.routing.referenceLabelsInFeatures).toBe(false);
    expect(plan.routing.rawNoteUnion).toBe(false);
  });

  it("clips fixed-backend and oracle truth to the candidate duration", () => {
    const plan = buildTextureRoutingPlan({
      timebase: "beats",
      windowSize: 2,
      songs: [song({ duration: 2, basic: [note(60, 0), note(62, 1)], gaps: [note(60, 0), note(62, 1)] })],
    });
    const result = evaluateTextureRouting({
      plan,
      truth: [{ id: "synthetic-texture", notes: [note(60, 0), note(62, 1), note(64, 2), note(65, 99)] }],
    }).songs[0]!;

    expect(result.bestSingle.basic.exact).toMatchObject({ matches: 2, predictedCount: 2, truthCount: 2, f1: 1 });
    expect(result.backendSelectionOracle.metrics.exact).toMatchObject({ matches: 2, predictedCount: 2, truthCount: 2, f1: 1 });
    expect(result.noteUnionOracle.exact).toMatchObject({ matches: 2, predictedCount: 2, truthCount: 2, f1: 1 });
    expect(result.agreement.exact.shared.exact.truthCount).toBe(2);
  });

  it("fails closed for malformed routes and invalid windows", () => {
    const malformedRoute: ColdTransferRoute = { notes: "not-notes" as unknown as readonly ColdTransferNoteInput[] };
    const invalidStatusRoute: ColdTransferRoute = { status: "unexpected" as never, notes: [] };
    const plan = buildTextureRoutingPlan({
      timebase: "beats",
      windows: [{ id: "whole", start: 0, end: 2 }],
      songs: [song({ duration: 2, basic: { status: "unavailable" }, gaps: malformedRoute })],
    });
    const unavailable = plan.songs[0]!;
    expect(unavailable.candidates.basic.status).toBe("unavailable");
    expect(unavailable.candidates.gaps.status).toBe("malformed");
    expect(evaluateTextureRouting({ plan, truth: [{ id: "synthetic-texture", notes: [note(60, 0)] }] }).songs[0]!.bestSingle.basic.exact.f1).toBeNull();

    const invalidStatusPlan = buildTextureRoutingPlan({ timebase: "beats", songs: [song({ basic: invalidStatusRoute })] });
    expect(invalidStatusPlan.songs[0]!.candidates.basic.status).toBe("malformed");
    expect(() => buildTextureRoutingPlan({ timebase: "beats", windows: [{ id: "bad", start: 2, end: 1 }], songs: [song()] })).toThrow(/invalid texture window/i);
    expect(() => buildTextureRoutingPlan({ timebase: "beats", windows: [
      { id: "dup", start: 0, end: 1 },
      { id: "dup", start: 1, end: 2 },
    ], songs: [song()] })).toThrow(/unique/i);
    expect(() => buildTextureRoutingPlan({ timebase: "beats", windows: [
      { id: "a", start: 0, end: 1.5 },
      { id: "b", start: 1, end: 2 },
    ], songs: [song()] })).toThrow(/overlapping/i);
  });
});
