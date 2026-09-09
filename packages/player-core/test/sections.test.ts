import { describe, expect, it } from "vitest";
import { detectSections } from "../src/sections.js";

describe("detectSections", () => {
  it("preserves section boundaries when notes arrive unsorted", () => {
    const measures = Array.from({ length: 8 }, (_, index) => ({
      index,
      startBeat: index * 4,
      endBeat: (index + 1) * 4,
    }));
    const notes = [
      // Reverse order exercises the sorted range-count path.
      ...Array.from({ length: 32 }, (_, index) => ({
        midi: 60 + (index % 12),
        start: 16 + (index % 4) + 0.1,
        dur: 0.125,
        vel: 80,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        midi: 60,
        start: index * 4 + 0.1,
        dur: 0.5,
        vel: 80,
      })),
    ].reverse();

    expect(detectSections(notes, measures)).toEqual([
      {
        id: "section-1",
        label: "Intro 1",
        startBeat: 0,
        endBeat: 12,
        type: "intro",
      },
      {
        id: "section-2",
        label: "Section 2",
        startBeat: 12,
        endBeat: 20,
        type: "custom",
      },
      {
        id: "section-3",
        label: "Outro 3",
        startBeat: 20,
        endBeat: 32,
        type: "outro",
      },
    ]);
  });

  it("collapses adjacent density changes instead of creating one-measure fragments", () => {
    const measures = Array.from({ length: 24 }, (_, index) => ({
      index,
      startBeat: index * 4,
      endBeat: (index + 1) * 4,
    }));
    const densities = [
      ...Array(8).fill(2),
      1,
      12,
      4,
      14,
      ...Array(12).fill(10),
    ] as number[];
    const notes = densities.flatMap((count, measure) => Array.from({ length: count }, (_, index) => ({
      midi: 60 + (index % 12),
      start: measure * 4 + (index + 1) / (count + 1) * 4,
      dur: 0.125,
      vel: 80,
    })));

    const sections = detectSections(notes, measures);
    expect(sections.every((section) => section.endBeat - section.startBeat >= 8)).toBe(true);
    expect(sections.some((section) => section.endBeat - section.startBeat === 4)).toBe(false);
  });
});

it("reports progress using actual pickup and compound-meter boundaries", async () => {
  const { measureProgressAt } = await import("../src/sections.js");
  // Quarter-note spans for 4/4, 3/4, 6/8, and 12/8.
  for (const span of [4, 3, 3, 6]) {
    const measures = [{ startBeat: 0, endBeat: 1 }, { startBeat: 1, endBeat: 1 + span }];
    expect(measureProgressAt(0.5, measures)).toEqual({ index: 0, fraction: 0.5 });
    expect(measureProgressAt(1 + span / 2, measures)).toEqual({ index: 1, fraction: 0.5 });
    expect(measureProgressAt(1, measures)).toEqual({ index: 1, fraction: 0 });
    expect(measureProgressAt(1 + span, measures)).toBeNull();
  }
  expect(measureProgressAt(NaN, [])).toBeNull();
  expect(measureProgressAt(0, [{ startBeat: 0, endBeat: 0 }])).toBeNull();
});


it("keeps bar progress stable when the engine preserves musical position at another speed", async () => {
  const { measureProgressAt } = await import("../src/sections.js");
  const { secPerBeat } = await import("../src/timeline.js");
  const bars = [{ startBeat: 0, endBeat: 1 }, { startBeat: 1, endBeat: 7 }];
  for (const beat of [0.5, 1, 2.5, 6.99, 1]) { // seek and loop wrap
    const expected = measureProgressAt(beat, bars);
    for (const speed of [0.5, 0.75, 1]) {
      const time = beat * secPerBeat(66, speed);
      const result = measureProgressAt(time / secPerBeat(66, speed), bars)!;
      expect(result.index).toBe(expected!.index);
      expect(result.fraction).toBeCloseTo(expected!.fraction, 10);
    }
  }
});
