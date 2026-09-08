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

  it("note letters keeps every transposed audio pitch in a readable hand lane", () => {
    const html = renderToStaticMarkup(createElement(BeginnerView, { data, time: 0, settings, chords: [] }));
    const pitches = [...html.matchAll(/data-midi="(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(pitches).toEqual(timed.map((n) => n.midi).sort((a, b) => a - b));
    expect(html).toContain("Right hand");
    expect(html).toContain("Left hand");
    expect(html).toContain('scope="col"');
    expect(html).toContain("D4");
  });

  it("LeadSheetView maps right-hand audio pitches to melody positions", () => {
    const melody = timed.filter((n) => n.hand === "R");
    const html = renderToStaticMarkup(createElement(LeadSheetView, { data, time: 0, settings, chords: [] }));
    const ys = renderedYPositions(html).sort((a, b) => a - b);
    expect(html).toContain("D4");

    const midis = melody.map((n) => n.midi).sort((a, b) => b - a);
    const lo = Math.min(...midis, 55);
    const hi = Math.max(...midis, 72);
    const expected = midis.map((midi) => 28 + ((hi - midi) / (hi - lo || 1)) * (240 - 80));
    expect(ys).toHaveLength(expected.length);
    expected.forEach((y, i) => expect(ys[i]).toBeCloseTo(y, 5));
  });
});


it("note letters previews the next bar with hand, octave, and transpose", () => {
  const song = { ...data, measures: [...data.measures, { index: 1, startBeat: 4, endBeat: 8 }],
    notes: [...data.notes, { midi: 48, start: 4, dur: 1, vel: 80, hand: "L" as const }] };
  const html = renderToStaticMarkup(createElement(BeginnerView, { data: song, time: 0,
    settings: { ...DEFAULT_SETTINGS, transpose: 2 }, chords: [] }));
  expect(html).toContain("Note letters view");
  expect(html).toContain("Next bar 2:");
  expect(html).toContain("LH D3");
});
