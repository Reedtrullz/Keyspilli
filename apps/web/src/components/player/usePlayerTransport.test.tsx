import React, { createElement, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loopBarRange, loopRegionSeconds, useLoopRegion, usePlayerTransport, type TransportSource } from "./usePlayerTransport";

vi.stubGlobal("React", React);

const measures = [
  { startBeat: 0, endBeat: 4 },
  { startBeat: 4, endBeat: 8 },
  { startBeat: 8, endBeat: 12 },
  { startBeat: 12, endBeat: 16 },
  { startBeat: 16, endBeat: 20 },
];

describe("player transport helpers", () => {
  it("derives loop seconds from beats, tempo and speed", () => {
    expect(loopRegionSeconds(null, 120, 1)).toBeNull();
    expect(loopRegionSeconds({ startBeat: 4, endBeat: 8 }, 120, 1)).toEqual({ startSec: 2, endSec: 4 });
    // Half speed doubles the seconds; the beats are unchanged.
    expect(loopRegionSeconds({ startBeat: 4, endBeat: 8 }, 120, 0.5)).toEqual({ startSec: 4, endSec: 8 });
  });

  it("shows the bars a loop covers, or the current bar plus three", () => {
    expect(loopBarRange({ startBeat: 4, endBeat: 12 }, measures, 0)).toEqual({ startBar: 2, endBar: 3 });
    expect(loopBarRange(null, measures, 1)).toEqual({ startBar: 2, endBar: 5 });
    expect(loopBarRange(null, measures, 3)).toEqual({ startBar: 4, endBar: 5 });
    // Beats past the last bar fall back to bar 1, as before the extraction.
    expect(loopBarRange({ startBeat: 40, endBeat: 44 }, measures, 0)).toEqual({ startBar: 1, endBar: 1 });
  });

  it("starts stopped at zero with no loop", () => {
    let snapshot: Record<string, unknown> = {};
    function Probe() {
      const engineRef = useRef<TransportSource | null>(null);
      const transport = usePlayerTransport(engineRef);
      const loop = useLoopRegion(120, 1);
      transport.syncTransportState(); // no engine yet: must be a no-op
      snapshot = { time: transport.timeStore.get(), playing: transport.playing, seekVersion: transport.seekVersion, timeRef: transport.timeRef.current, loop: loop.loop, loopBeats: loop.loopBeats, loopDraft: loop.loopDraft };
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(snapshot).toEqual({ time: 0, playing: false, seekVersion: 0, timeRef: 0, loop: null, loopBeats: null, loopDraft: null });
  });
});
