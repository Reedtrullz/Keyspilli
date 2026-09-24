import { describe, expect, it } from "vitest";
import { Grader } from "./grading.js";

describe("wait-mode results", () => {
  it("accepts simultaneous chord tones in any input order", () => {
    const notes = [60, 64, 67].map((midi) => ({ midi, startSec: 1, durSec: 2, vel: 80 }));
    const grader = new Grader(notes, { waitMode: true, bpm: 120 });
    expect(grader.currentWait?.midi).toBe(60);
    expect(grader.currentWaitGroup.map((note) => note.midi)).toEqual([60, 64, 67]);
    expect(grader.play(67, 0)).toBe(true);
    expect(grader.currentWaitGroup.map((note) => note.midi)).toEqual([60, 64]);
    expect(grader.play(60, 0)).toBe(true);
    expect(grader.play(64, 0)).toBe(true);
    expect(grader.result()).toMatchObject({ hit: 3, missed: 0, wrong: 0 });
  });

  it("describes pitch completion without claiming timing was graded", () => {
    const grader = new Grader([{ midi: 60, startSec: 0, durSec: 1, vel: 80 }], { waitMode: true, bpm: 120 });
    expect(grader.currentWait?.midi).toBe(60);
    expect(grader.play(60, 0)).toBe(true);
    expect(grader.result().summary).toBe("Great run — all notes found.");
  });
});
