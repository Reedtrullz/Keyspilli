import { describe, expect, it } from "vitest";
import { ChordGrader } from "../src/chord-practice.js";

describe("ChordGrader", () => {
  const targets = [
    { name: "C", notes: [60, 64, 67] },
    { name: "G/B", notes: [59, 62, 67, 71] },
  ];

  it("accepts chord tones in any order and octave", () => {
    const grader = new ChordGrader(targets);
    expect(grader.play(79)).toMatchObject({ accepted: true, completed: false }); // G5
    expect(grader.play(64)).toMatchObject({ accepted: true, completed: false });
    expect(grader.play(48)).toMatchObject({ accepted: true, completed: true }); // C3
    expect(grader.snapshot()).toMatchObject({ currentIndex: 1, completed: 1, remainingPitchClasses: [2, 7, 11] });
  });

  it("keeps a wrong note audible without advancing the target", () => {
    const grader = new ChordGrader(targets);
    expect(grader.play(61)).toEqual({ accepted: false, completed: false, wrong: true });
    expect(grader.snapshot()).toMatchObject({ currentIndex: 0, wrong: 1, completed: 0 });
  });

  it("reports partial progress and supports skipping", () => {
    const grader = new ChordGrader(targets);
    grader.play(60);
    expect(grader.snapshot().playedPitchClasses).toEqual([0]);
    expect(grader.snapshot().remainingPitchClasses).toEqual([4, 7]);
    grader.skip();
    expect(grader.snapshot()).toMatchObject({ currentIndex: 1, skipped: 1, completed: 0 });
  });

  it("finishes empty practice safely", () => {
    expect(new ChordGrader([]).snapshot()).toMatchObject({ finished: true, total: 0, accuracyPct: 100 });
  });
});
