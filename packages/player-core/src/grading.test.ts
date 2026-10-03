import { describe, expect, it } from "vitest";
import { Grader, gradeProblemWindows } from "./grading.js";

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

describe("late and missed grading", () => {
  const note = (midi: number, startSec = 0) => ({ midi, startSec, durSec: 1, vel: 80 });

  function gradeInBothOrders(notes: ReturnType<typeof note>[], midi: number[], now: number) {
    const playFirst = new Grader(notes, { bpm: 120 });
    for (const pitch of midi) playFirst.play(pitch, now);
    playFirst.tick(now);

    const tickFirst = new Grader(notes, { bpm: 120 });
    tickFirst.tick(now);
    for (const pitch of midi) tickFirst.play(pitch, now);
    return [playFirst.result(), tickFirst.result()];
  }

  it("preserves the past-window late policy regardless of tick/play order", () => {
    const [playFirst, tickFirst] = gradeInBothOrders([note(60)], [60], 0.6);
    expect(tickFirst).toEqual(playFirst);
    expect(tickFirst).toMatchObject({ hit: 0, late: 1, missed: 0, wrong: 0 });
  });

  it("keeps the timing-window boundary consistent and treats any later press as late", () => {
    const atHitBoundary = gradeInBothOrders([note(60)], [60], 0.2);
    expect(atHitBoundary[1]).toEqual(atHitBoundary[0]);
    expect(atHitBoundary[1]).toMatchObject({ hit: 1, late: 0, missed: 0 });

    const atLateBoundary = gradeInBothOrders([note(60)], [60], 0.4);
    expect(atLateBoundary[1]).toEqual(atLateBoundary[0]);
    expect(atLateBoundary[1]).toMatchObject({ hit: 0, late: 1, missed: 0 });

    const later = gradeInBothOrders([note(60)], [60], 0.6);
    expect(later[1]).toEqual(later[0]);
    expect(later[1]).toMatchObject({ hit: 0, late: 1, missed: 0 });
  });

  it("classifies a delayed callback by its event timestamp", () => {
    const playFirst = new Grader([note(60)], { bpm: 120 });
    playFirst.play(60, 0.1);
    playFirst.tick(0.21);

    const tickFirst = new Grader([note(60)], { bpm: 120 });
    tickFirst.tick(0.21);
    tickFirst.play(60, 0.1);

    expect(tickFirst.result()).toEqual(playFirst.result());
    expect(tickFirst.result()).toMatchObject({ hit: 1, late: 0, missed: 0 });
  });

  it("checks expired and remaining pitches in the same overlapping window", () => {
    const grader = new Grader([note(60), note(64, 0.2)], { bpm: 120 });
    grader.tick(0.31);
    grader.play(60, 0.1);
    expect(grader.result()).toMatchObject({ hit: 1, wrong: 0, missed: 1, late: 0 });
  });

  it("chooses the earliest expired duplicate before a later overlapping duplicate", () => {
    const notes = [note(60), note(60, 0.2)];
    const [playFirst, tickFirst] = gradeInBothOrders(notes, [60, 60], 0.1);
    expect(tickFirst).toEqual(playFirst);

    const delayed = new Grader(notes, { bpm: 120 });
    delayed.tick(0.31);
    delayed.play(60, 0.1);
    delayed.play(60, 0.4);
    expect(delayed.result()).toMatchObject({ hit: 2, late: 0, missed: 0, wrong: 0 });
  });

  it("counts a wrong pitch in an expired target's event-time window", () => {
    const grader = new Grader([note(60)], { bpm: 120 });
    grader.tick(0.31);
    grader.play(61, 0.1);
    expect(grader.result()).toMatchObject({ hit: 0, wrong: 1, missed: 1, late: 0 });
  });

  it("preserves wrong-note priority when a later target has an input-time window", () => {
    const notes = [note(60), note(64, 0.2)];
    const playFirst = new Grader(notes, { bpm: 120 });
    playFirst.play(60, 0.31);
    playFirst.tick(0.31);

    const tickFirst = new Grader(notes, { bpm: 120 });
    tickFirst.tick(0.31);
    tickFirst.play(60, 0.31);

    expect(tickFirst.result()).toEqual(playFirst.result());
    expect(tickFirst.result()).toMatchObject({ hit: 0, late: 0, missed: 2, wrong: 1 });
  });

  it("chooses the oldest late target across expired and remaining notes", () => {
    const notes = [note(60), note(60, 0.5)];
    const playFirst = new Grader(notes, { bpm: 120 });
    playFirst.play(60, 0.8);
    playFirst.play(60, 0.2);
    playFirst.tick(0.31);

    const tickFirst = new Grader(notes, { bpm: 120 });
    tickFirst.tick(0.31);
    tickFirst.play(60, 0.8);
    tickFirst.play(60, 0.2);

    expect(tickFirst.result()).toEqual(playFirst.result());
    expect(tickFirst.result()).toMatchObject({ hit: 0, late: 1, missed: 1, wrong: 0 });
  });

  it("accounts for repeated pitches, chord tones, and duplicate targets once each", () => {
    const notes = [note(60), note(60), note(64), note(67)];
    const [playFirst, tickFirst] = gradeInBothOrders(notes, [62, 60, 60, 64, 67, 60], 0.3);
    expect(tickFirst).toEqual(playFirst);
    expect(tickFirst).toMatchObject({ hit: 0, late: 4, missed: 0, wrong: 0, total: 4 });
  });

  it("retains every expired target for the grading run, including more than 64", () => {
    const notes = Array.from({ length: 66 }, () => note(60));
    const [playFirst, tickFirst] = gradeInBothOrders(notes, notes.map(({ midi }) => midi), 0.3);
    expect(tickFirst).toEqual(playFirst);
    expect(tickFirst).toMatchObject({ hit: 0, late: 66, missed: 0, wrong: 0, total: 66 });
  });
});

it("keeps bounded target diagnostics stable after missed-note reconciliation and wrong/unmatched input", () => {
  const notes = [{ midi: 60, startSec: 1, durSec: 1, vel: 80, hand: "R" as const }, { midi: 60, startSec: 2, durSec: 1, vel: 80, hand: "L" as const }];
  const grader = new Grader(notes, { bpm: 120 });
  grader.tick(1.3);
  grader.play(60, 1.1);
  grader.play(61, 2);
  grader.play(90, 10);
  expect(grader.result().diagnostics?.events).toEqual([
    expect.objectContaining({ targetIndex: 0, expectedPitch: 60, hand: "R", outcome: "hit", playedPitch: 60, playedSec: 1.1, errorSec: expect.closeTo(0.1) }),
    expect.objectContaining({ targetIndex: 1, expectedPitch: 60, hand: "L", outcome: "missed", playedPitch: null }),
    expect.objectContaining({ outcome: "wrong", playedPitch: 61, playedSec: 2 }),
    expect.objectContaining({ outcome: "unmatched", playedPitch: 90, playedSec: 10 }),
  ]);
  expect(gradeProblemWindows(grader.result(), [{ startBeat: 0, endBeat: 4 }, { startBeat: 4, endBeat: 8 }], 120, 1)).toEqual([{ startBeat: 4, endBeat: 8, count: 2 }]);
  const large = new Grader(Array.from({ length: 2200 }, (_, i) => ({ midi: 60, startSec: i, durSec: 1, vel: 80 })));
  expect(large.result().diagnostics).toMatchObject({ omitted: 200, events: expect.any(Array) });
  expect(large.result().diagnostics?.events).toHaveLength(2000);
  expect(large.result().total).toBe(2200);
});

it("rejects monophonic microphone grading for overlapping pitches while allowing one voiced line", async () => {
  const { microphoneEligibility } = await import("./grading.js");
  const note = (midi: number, startSec: number, durSec = 1) => ({ midi, startSec, durSec, vel: 80 });
  expect(microphoneEligibility([note(60, 0), note(64, 0.2)], { startSec: 0, endSec: 2 }).eligible).toBe(false);
  expect(microphoneEligibility([note(60, 0), note(64, 1)], { startSec: 0, endSec: 2 }).eligible).toBe(true);
  expect(microphoneEligibility([note(60, 0, 3), note(64, 2)], { startSec: 1, endSec: 3 }).eligible).toBe(false);
  expect(microphoneEligibility([], { startSec: 0, endSec: 2 }).eligible).toBe(false);
});
