import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type SongData } from "@keyspilli/player-core";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";
import { resolveChordSources, selectChordSource } from "./chord-sources";

const data: SongData = {
  notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
  chords: [{ beat: 0, name: "Generated chord", notes: [48, 52, 55], sourceKind: "generated" }],
  ugChordTimeline: [{ beat: 0, name: "UG authored chord", notes: [50, 53, 57], sourceKind: "authored" }],
  chordProvenance: { provider: "ultimate-guitar", sourceRef: "ug-tabs:test" },
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  key: "C",
  tempoBpm: 120,
  timeSig: [4, 4],
};

const selectedUgChords = selectChordSource(resolveChordSources(data), "ug").source?.chords ?? [];

describe("selected chord source view contract", () => {
  it("renders the selected UG timeline in the beginner view", () => {
    const html = renderToStaticMarkup(createElement(BeginnerView, {
      data,
      time: 0,
      settings: { ...DEFAULT_SETTINGS, mode: "beginner" },
      chords: selectedUgChords,
    }));

    expect(html).toContain("UG authored chord");
    expect(html).toContain("Authored chord");
    expect(html).not.toContain("Generated chord: Generated chord");
  });

  it("renders the selected UG timeline in the lead-sheet view", () => {
    const html = renderToStaticMarkup(createElement(LeadSheetView, {
      data,
      time: 0,
      settings: { ...DEFAULT_SETTINGS, mode: "leadsheet" },
      chords: selectedUgChords,
    }));

    expect(html).toContain("UG authored chord");
    expect(html).toContain("Authored chord");
    expect(html).not.toContain("Generated chord: Generated chord");
  });
});
