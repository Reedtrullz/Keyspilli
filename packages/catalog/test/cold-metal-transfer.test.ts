import { describe, expect, it } from "vitest";
import {
  canonicalColdMetalTransfer,
  evaluateColdMetalTransfer,
  hashCanonicalColdMetalTransfer,
  type ColdMetalTransferInput,
} from "../src/cold-metal-transfer.js";

const note = (midi: number, start: number, dur = 1) => ({ midi, start, dur });

describe("cold metal AMT transfer evaluation", () => {
  it("uses deterministic one-to-one onset/exact/PC matches", () => {
    const input: ColdMetalTransferInput = {
      onsetToleranceBeats: 0.1,
      songs: [{
        id: "song",
        truth: [note(60, 0), note(64, 1)],
        basic: [note(60, 0.02), note(60, 0.04), note(76, 1.02)],
        gaps: [note(72, 0.02), note(64, 1.02)],
      }],
    };
    const report = evaluateColdMetalTransfer(input);
    const song = report.songs[0]!;
    expect(song.basic.exact.matches).toBe(1);
    expect(song.basic.pitchClass.matches).toBe(2);
    expect(song.basic.onset.matches).toBe(2);
    expect(song.complementarity.exact).toMatchObject({ both: 0, basicOnly: 1, gapsOnly: 1, neither: 0 });
    expect(song.predictionOverlap.exact.matches).toBe(0);
  });

  it("reports union oracle and intersection agreement separately", () => {
    const input: ColdMetalTransferInput = {
      songs: [{
        id: "song",
        truth: [note(60, 0), note(64, 1), note(67, 2)],
        basic: [note(60, 0), note(64, 1)],
        gaps: [note(60, 0), note(67, 2)],
      }],
    };
    const song = evaluateColdMetalTransfer(input).songs[0]!;
    expect(song.union.exact.matches).toBe(3);
    expect(song.intersection.exact.matches).toBe(1);
    expect(song.intersectionAgreement.exact.matches).toBe(1);
    expect(song.predictionOverlap.exact).toMatchObject({ matches: 1, basicCount: 2, gapsCount: 2 });
  });

  it("counts direct A/B prediction overlap even when both miss the truth", () => {
    const song = evaluateColdMetalTransfer({
      songs: [{ id: "song", truth: [note(60, 0)], basic: [note(61, 0)], gaps: [note(61, 0)] }],
    }).songs[0]!;
    expect(song.predictionOverlap.exact.matches).toBe(1);
    expect(song.complementarity.exact).toMatchObject({ both: 0, basicOnly: 0, gapsOnly: 0, neither: 1 });
  });

  it("returns per-song deltas and global case/architecture labels", () => {
    const input: ColdMetalTransferInput = {
      songs: [
        { id: "gaps", truth: [note(60, 0)], basic: [note(61, 0)], gaps: [note(60, 0)] },
        { id: "both", truth: [note(64, 0)], basic: [note(64, 0)], gaps: [note(64, 0)] },
      ],
    };
    const report = evaluateColdMetalTransfer(input);
    const gaps = report.songs.find((song) => song.id === "gaps")!;
    expect(gaps.deltas.exact).toBe(1);
    expect(gaps.classification).toBe("gaps-wins");
    expect(report.global.caseClassification).toBe("gaps-wins");
    expect(report.global.architectureClassification).toBe("gaps-transfer");
  });

  it("keeps unavailable routes out of false positive transfer claims", () => {
    const report = evaluateColdMetalTransfer({
      songs: [{ id: "song", truth: [note(60, 0)], basic: { status: "unavailable" }, gaps: { status: "unavailable" } }],
    });
    expect(report.songs[0]!.basic.status).toBe("unavailable");
    expect(report.global.architectureClassification).toBe("insufficient-evidence");
  });

  it("marks malformed route note containers unavailable instead of treating them as empty", () => {
    const report = evaluateColdMetalTransfer({
      songs: [{ id: "song", truth: [note(60, 0)], basic: { notes: {} as any }, gaps: [note(60, 0)] }],
    });
    expect(report.songs[0]!.basic.status).toBe("malformed");
    expect(report.songs[0]!.status).toBe("unavailable");
    expect(report.global.caseClassification).toBe("GAPS_COLD_TRANSFER_UNAVAILABLE");
  });

  it("keeps simultaneous pitches in the onset union and counts invalid candidates", () => {
    const report = evaluateColdMetalTransfer({
      songs: [{
        id: "song",
        truth: [note(60, 0), note(64, 0)],
        basic: { notes: [note(60, 0), { midi: 200, start: 0, dur: 1 } as any] },
        gaps: [note(64, 0)],
      }],
    });
    const song = report.songs[0]!;
    expect(song.basic.candidateCount).toBe(2);
    expect(song.basic.invalidCount).toBe(1);
    expect(song.union.onset.predictedCount).toBe(2);
    expect(song.union.onset.matches).toBe(2);
  });

  it("only deduplicates identical-duration predictions in the union", () => {
    const song = evaluateColdMetalTransfer({
      songs: [{
        id: "song",
        truth: [note(60, 0, 1)],
        basic: [note(60, 0, 1)],
        gaps: [note(60, 0.02, 2)],
      }],
    }).songs[0]!;
    expect(song.union.exact.predictedCount).toBe(2);
  });

  it("uses the frozen song duration for comparable route density", () => {
    const song = evaluateColdMetalTransfer({
      songs: [{ id: "song", duration: 10, truth: [note(60, 0)], basic: [note(60, 0)], gaps: [note(60, 0)] }],
    }).songs[0]!;
    expect(song.basic.duration).toBe(10);
    expect(song.gaps.duration).toBe(10);
    expect(song.basic.densityPerUnit).toBe(0.1);
  });

  it("canonicalizes reordered input and excludes runtime paths", () => {
    const first = evaluateColdMetalTransfer({
      timebase: "seconds",
      songs: [{ id: "z", truth: [note(60, 0)], basic: [note(60, 0)], gaps: [note(60, 0)] }, { id: "a", truth: [note(64, 0)], basic: [note(64, 0)], gaps: [note(64, 0)] }],
    });
    const second = evaluateColdMetalTransfer({
      timebase: "seconds",
      songs: [{ id: "a", truth: [note(64, 0)], basic: [note(64, 0)], gaps: [note(64, 0)] }, { id: "z", truth: [note(60, 0)], basic: [note(60, 0)], gaps: [note(60, 0)] }],
    });
    expect(canonicalColdMetalTransfer(first)).toBe(canonicalColdMetalTransfer(second));
    expect(hashCanonicalColdMetalTransfer(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalColdMetalTransfer(first)).not.toMatch(/Users|private|generatedAt|runtime/);
  });
});
