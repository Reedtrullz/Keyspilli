import { describe, expect, it } from "vitest";
import { arithmeticMeasures, playbackMeasures, playbackTiming, timeSignatureAtBeat } from "../src/timeline.js";

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
      timeSig: [2, 4],
      sourceTiming: {
        timeSig: [2, 4],
        measureStartBeat: 0,
        provenance: "source-measure-boundary",
        sourceFingerprint: "variant:test",
      },
    })).toEqual(descriptiveMeasures);
  });

  it("falls back when validated timing and stored boundaries disagree", () => {
    expect(playbackMeasures({
      notes: [{ midi: 60, start: 0, dur: 6, vel: 80 }],
      measures: descriptiveMeasures,
      timeSig: [6, 8],
      sourceTiming: {
        timeSig: [6, 8],
        measureStartBeat: 0,
        provenance: "source-measure-boundary",
        sourceFingerprint: "variant:test",
      },
    }).slice(0, 2)).toEqual([
      { index: 0, startBeat: 0, endBeat: 3 },
      { index: 1, startBeat: 3, endBeat: 6 },
    ]);
  });

  it("rejects source timing that conflicts with the canonical scalar meter", () => {
    const data = {
      notes: [{ midi: 60, start: 0, dur: 8, vel: 80 }],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ],
      timeSig: [6, 8] as [number, number],
      sourceTiming: {
        timeSig: [4, 4] as [number, number],
        measureStartBeat: 0,
        provenance: "source-measure-boundary" as const,
        sourceFingerprint: "variant:test",
      },
    };
    expect(playbackTiming(data)).toBeUndefined();
    expect(playbackMeasures(data)).toEqual(arithmeticMeasures(8, [6, 8]));
  });

  it("rejects skipped, gapped, zero-length, and nonfinite stored bars", () => {
    const timing = {
      timeSig: [4, 4] as [number, number],
      measureStartBeat: 0,
      provenance: "source-measure-boundary" as const,
      sourceFingerprint: "variant:test",
    };
    for (const measures of [
      [{ index: 0, startBeat: 0, endBeat: 8 }],
      [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 5, endBeat: 9 }],
    ]) {
      expect(playbackMeasures({
        notes: [{ midi: 60, start: 0, dur: 8, vel: 80 }],
        measures,
        timeSig: [4, 4],
        sourceTiming: timing,
      }).slice(0, 2)).toEqual([
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ]);
    }
    for (const measures of [
      [{ index: 0, startBeat: 0, endBeat: 0 }],
      [{ index: 0, startBeat: 0, endBeat: Number.NaN }],
    ]) {
      expect(playbackMeasures({
        notes: [{ midi: 60, start: 0, dur: 8, vel: 80 }],
        measures,
        timeSig: [4, 4],
        sourceTiming: timing,
      })).toEqual([]);
    }
  });

  it("rejects nonfinite and string note coordinates before coverage arithmetic", () => {
    const timing = {
      timeSig: [4, 4] as [number, number],
      measureStartBeat: 0,
      provenance: "source-measure-boundary" as const,
      sourceFingerprint: "variant:test",
    };
    for (const note of [
      { midi: 60, start: Number.NaN, dur: 4, vel: 80 },
      { midi: 60, start: "0", dur: 4, vel: 80 },
    ]) {
      const data = {
        notes: [note] as never,
        measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
        timeSig: [4, 4] as [number, number],
        sourceTiming: timing,
      };
      expect(playbackTiming(data)).toBeUndefined();
      expect(playbackMeasures(data)).toEqual([]);
    }
  });

  it("does not allocate an unbounded scalar fallback for an oversized duration", () => {
    expect(arithmeticMeasures(1_000_000, [4, 4])).toEqual([]);
    expect(playbackMeasures({
      notes: [{ midi: 60, start: 0, dur: 1_000_000, vel: 80 }],
      measures: [],
      timeSig: [4, 4],
    })).toEqual([]);
  });

  it("accepts explicit meter-event phase resets", () => {
    expect(playbackMeasures({
      notes: [{ midi: 60, start: 0, dur: 15, vel: 80 }],
      measures: [
        { index: 0, startBeat: 0, endBeat: 2 },
        { index: 1, startBeat: 2, endBeat: 4 },
        { index: 2, startBeat: 4, endBeat: 6 },
        { index: 3, startBeat: 6, endBeat: 8 },
        { index: 4, startBeat: 8, endBeat: 10 },
        { index: 5, startBeat: 10, endBeat: 12 },
        { index: 6, startBeat: 12, endBeat: 15 },
      ],
      timeSig: [6, 8],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [2, 4] },
        { tick: 5760, beat: 12, timeSig: [6, 8] },
      ],
      sourceTiming: {
        timeSig: [6, 8],
        measureStartBeat: -3,
        provenance: "source-measure-boundary",
        sourceFingerprint: "variant:test",
        timeSigEvents: [
          { beat: 0, timeSig: [2, 4] },
          { beat: 12, timeSig: [6, 8] },
        ],
      },
    })).toHaveLength(7);
  });

  it("accepts a complete full-width trailing bar beyond the final note", () => {
    const measures = [
      { index: 0, startBeat: 0, endBeat: 4 },
      { index: 1, startBeat: 4, endBeat: 8 },
    ];
    expect(playbackMeasures({
      notes: [{ midi: 60, start: 0, dur: 3, vel: 80 }],
      measures,
      timeSig: [4, 4],
      sourceTiming: {
        timeSig: [4, 4],
        measureStartBeat: 0,
        provenance: "source-measure-boundary",
        sourceFingerprint: "variant:test",
      },
    })).toEqual(measures);
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
