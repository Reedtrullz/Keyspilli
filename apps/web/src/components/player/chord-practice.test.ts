import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChordPracticeSnapshot } from "@keyspilli/player-core";
import { buildChordPracticeTargets, compactPracticeVoicing, selectPracticeChords } from "./chord-practice";
import { ChordPracticePanel } from "./ChordPracticePanel";

describe("chord practice targets", () => {
  it("keeps a compact authored inversion as the reference shape", () => {
    const target = compactPracticeVoicing({
      beat: 0,
      name: "C/E",
      notes: [52, 55, 60],
      sourceKind: "authored",
    });
    expect(target).toEqual({ notes: [52, 55, 60], inferred: false });
  });

  it("derives a compact learner voicing from a large generated cluster", () => {
    const target = compactPracticeVoicing({
      beat: 0,
      name: "C",
      notes: [36, 48, 60, 64, 67, 72],
      sourceKind: "generated",
    });
    expect(target.inferred).toBe(true);
    expect(target.notes).toEqual([60, 64, 67]);
  });

  it("transposes the displayed target and playable notes together", () => {
    const [target] = buildChordPracticeTargets([{ beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "generated" }], 2);
    expect(target).toMatchObject({ name: "D", notes: [50, 54, 57] });
  });

  it("limits the practice set to the current four-measure window", () => {
    const chords = [
      { beat: 0, name: "C", notes: [60, 64, 67] },
      { beat: 3, name: "G", notes: [55, 59, 62] },
      { beat: 8, name: "Am", notes: [57, 60, 64] },
      { beat: 20, name: "F", notes: [53, 57, 60] },
    ];
    const measures = [0, 4, 8, 12, 16, 20].map((startBeat, index) => ({ index, startBeat, endBeat: startBeat + 4 }));
    expect(selectPracticeChords(chords, measures, 1).map((chord) => chord.name)).toEqual(["G", "Am"]);
  });

  it("uses honest labels for tone discovery completion", () => {
    const snapshot: ChordPracticeSnapshot = {
      currentIndex: 1,
      total: 1,
      completed: 1,
      skipped: 0,
      wrong: 1,
      target: null,
      playedPitchClasses: [],
      remainingPitchClasses: [],
      lastWrongPitchClass: null,
      finished: true,
      completionPct: 100,
    };
    const html = renderToStaticMarkup(createElement(ChordPracticePanel, {
      targets: [{ name: "C", notes: [60, 64, 67] }],
      snapshot,
      active: false,
      onStart: () => {},
      onHear: () => {},
      onSkip: () => {},
      onExit: () => {},
    }));
    expect(html).toContain("Find the chord tones");
    expect(html).toContain("100% completed");
    expect(html).not.toContain("shape accuracy");
  });

  it("renders an honest no-target state without a completion score", () => {
    const snapshot: ChordPracticeSnapshot = {
      currentIndex: 0,
      total: 0,
      completed: 0,
      skipped: 0,
      wrong: 0,
      target: null,
      playedPitchClasses: [],
      remainingPitchClasses: [],
      lastWrongPitchClass: null,
      finished: true,
      completionPct: null,
    };
    const html = renderToStaticMarkup(createElement(ChordPracticePanel, {
      targets: [],
      snapshot,
      active: false,
      onStart: () => {},
      onHear: () => {},
      onSkip: () => {},
      onExit: () => {},
    }));
    expect(html).toContain("No usable chords in this practice scope");
    expect(html).not.toContain("Chord practice complete");
    expect(html).not.toContain("% completed");
  });
});
