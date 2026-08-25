import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimplifyScore } from "./SimplifyScore";
import type { SongData } from "@keyspilli/player-core";

function song(overrides: Partial<SongData> = {}): SongData {
  return {
    notes: [
      { midi: 64, start: 8, dur: 1, vel: 80, hand: "R", lyrics: "third" },
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R", lyrics: "first" },
      { midi: 62, start: 4, dur: 1, vel: 80, hand: "R", lyrics: "second" },
      { midi: 48, start: 0, dur: 1, vel: 80, hand: "L", lyrics: "bass" },
    ],
    chords: [
      { beat: 8, name: "G", notes: [55, 59, 62] },
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 4, name: "F", notes: [53, 57, 60] },
    ],
    measures: [
      { index: 0, startBeat: 0, endBeat: 4 },
      { index: 1, startBeat: 4, endBeat: 8 },
      { index: 2, startBeat: 8, endBeat: 12 },
    ],
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    ...overrides,
  };
}

describe("SimplifyScore measure indexing", () => {
  it("keeps unsorted note/chord input in the correct measure", () => {
    const html = renderToStaticMarkup(createElement(SimplifyScore, { data: song(), title: "Indexed" }));
    expect(html).toContain("first");
    expect(html).toContain("second");
    expect(html).toContain("third");
    expect(html).not.toContain("bass");
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    expect(html.indexOf("second")).toBeLessThan(html.indexOf("third"));
    expect(html).toContain(">C</span>");
    expect(html).toContain(">F</span>");
    expect(html).toContain(">G</span>");
  });

  it("retains legacy overlapping-measure behavior", () => {
    const html = renderToStaticMarkup(createElement(SimplifyScore, {
      data: song({
        notes: [{ midi: 60, start: 3, dur: 1, vel: 80, hand: "R", lyrics: "overlap" }],
        chords: [],
        measures: [
          { index: 0, startBeat: 0, endBeat: 4 },
          { index: 1, startBeat: 2, endBeat: 6 },
        ],
      }),
      title: "Overlap",
    }));
    expect(html.match(/overlap/g)).toHaveLength(2);
  });
});
