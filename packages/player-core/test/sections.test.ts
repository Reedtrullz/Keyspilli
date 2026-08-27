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
