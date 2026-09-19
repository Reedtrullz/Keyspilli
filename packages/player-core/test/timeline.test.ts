import { describe, expect, it } from "vitest";
import { playbackMeasures, timeSignatureAtBeat } from "../src/timeline.js";

const descriptiveMeasures = [
  { index: 0, startBeat: 0, endBeat: 2 },
  { index: 1, startBeat: 2, endBeat: 4 },
  { index: 2, startBeat: 4, endBeat: 6 },
];

describe("phase-aware playback timeline", () => {
  it("uses arithmetic scalar measures when meter declarations have no phase provenance", () => {
    const measures = playbackMeasures({
      notes: [{ midi: 60, start: 0, dur: 6, vel: 80 }],
      measures: descriptiveMeasures,
      timeSig: [6, 8],
    });
    expect(measures.slice(0, 3)).toEqual([
      { index: 0, startBeat: 0, endBeat: 3 },
      { index: 1, startBeat: 3, endBeat: 6 },
    ]);
  });

  it("uses stored source boundaries only after validated timing reaches the song", () => {
    expect(playbackMeasures({
      notes: [],
      measures: descriptiveMeasures,
      timeSig: [6, 8],
      sourceTiming: {
        timeSig: [6, 8],
        measureStartBeat: -1,
        provenance: "source-measure-boundary",
        sourceFingerprint: "variant:test",
      },
    })).toEqual(descriptiveMeasures);
  });

  it("looks up the active descriptive meter without asserting its phase", () => {
    const events = [
      { beat: 0, timeSig: [2, 4] as [number, number] },
      { beat: 12, timeSig: [6, 8] as [number, number] },
    ];
    expect(timeSignatureAtBeat(3, [6, 8], events)).toEqual([2, 4]);
    expect(timeSignatureAtBeat(12, [6, 8], events)).toEqual([6, 8]);
  });
});
