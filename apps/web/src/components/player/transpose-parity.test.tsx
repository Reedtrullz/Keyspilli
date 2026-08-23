import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveTimedNotes, type SongData } from "@keyspilli/player-core";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";

const TRANSPOSE = 2;

const data: SongData = {
  notes: [
    { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
    { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
    { midi: 48, start: 0, dur: 2, vel: 80, hand: "L" },
  ],
  chords: [],
  ugChordTimeline: [],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  key: "C",
  tempoBpm: 120,
  timeSig: [4, 4] as [number, number],
};

function renderedYPositions(html: string): number[] {
  return [...html.matchAll(/cy="([0-9.]+)"/g)].map((m) => Number(m[1]));
}

describe("transpose visual/audio parity", () => {
  const settings = { ...DEFAULT_SETTINGS, transpose: TRANSPOSE };
  const timed = resolveTimedNotes(data, settings.speed, TRANSPOSE);

  it("BeginnerView maps every transposed audio pitch to its staff position", () => {
    // The beginner view draws both hands inside the current measure.
    const midis = timed.map((n) => n.midi).sort((a, b) => b - a);
    const html = renderToStaticMarkup(createElement(BeginnerView, { data, time: 0, settings, chords: [] }));
    const ys = renderedYPositions(html).sort((a, b) => a - b);

    const lo = Math.min(...midis, 55);
    const hi = Math.max(...midis, 72);
    const spread = Math.max(12, hi - lo);
    const expected = midis.map((midi) => 40 + ((hi - midi) / spread) * 190);
    expect(ys).toHaveLength(expected.length);
    expected.forEach((y, i) => expect(ys[i]).toBeCloseTo(y, 5));
  });

  it("LeadSheetView maps right-hand audio pitches to melody positions", () => {
    const melody = timed.filter((n) => n.hand === "R");
    const html = renderToStaticMarkup(createElement(LeadSheetView, { data, time: 0, settings, chords: [] }));
    const ys = renderedYPositions(html).sort((a, b) => a - b);

    const midis = melody.map((n) => n.midi).sort((a, b) => b - a);
    const lo = Math.min(...midis, 55);
    const hi = Math.max(...midis, 72);
    const expected = midis.map((midi) => 28 + ((hi - midi) / (hi - lo || 1)) * (240 - 80));
    expect(ys).toHaveLength(expected.length);
    expected.forEach((y, i) => expect(ys[i]).toBeCloseTo(y, 5));
  });
});
