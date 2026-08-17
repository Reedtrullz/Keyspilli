import { describe, expect, it } from "vitest";
import { buildChordPracticeTargets, compactPracticeVoicing, selectPracticeChords } from "./chord-practice";

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
});
