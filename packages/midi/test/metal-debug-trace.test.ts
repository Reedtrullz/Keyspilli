import { describe, expect, it } from "vitest";
import { buildMetalArrangement, type MetalArrangementDebugOptions, type MetalArrangementInput, type MetalArrangementTraceEvent, type MetalStem } from "../src/metal-arrange.js";
import type { ParsedMidi } from "../src/types.js";

function stem(role: MetalStem["role"], notes: ParsedMidi["notes"]): MetalStem {
  const midi: ParsedMidi = {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 1,
    timeSig: [4, 4],
    notes,
    trackNames: [role],
    durationBeats: 8,
  };
  return { role, midi };
}

describe("metal arrangement debug trace", () => {
  it("reports residual opening lineage without leaking private references", () => {
    const events: MetalArrangementTraceEvent[] = [];
    const notes = [
      { midi: 64, start: 0, dur: 0.75, vel: 100 },
      { midi: 67, start: 1, dur: 0.75, vel: 96 },
      { midi: 69, start: 2, dur: 0.75, vel: 96 },
      { midi: 67, start: 3, dur: 0.75, vel: 96 },
    ];
    const debug: MetalArrangementDebugOptions = {
      traceWindows: [{ id: "opening", startBeat: 0, endBeat: 4 }],
      traceSink: (event) => events.push(event),
    };
    const input: MetalArrangementInput = {
      stems: [stem("other", notes)],
      sectionBeats: 8,
      debug,
    };
    const result = buildMetalArrangement(input);
    const withoutTrace = buildMetalArrangement({ stems: [stem("other", notes)], sectionBeats: 8 });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.stage === "raw" && event.source === "other")).toBe(true);
    expect(events.some((event) => event.stage === "residual" && event.selected)).toBe(true);
    expect(events.some((event) => event.stage === "final" && event.selected && event.source === "other")).toBe(true);
    expect(events.every((event) => event.windowId === "opening")).toBe(true);
    expect(events.every((event) => event.traceRefs.length > 0)).toBe(true);
    expect(result.parsed.notes.every((note) => !("traceRefs" in note) && !("rawMidi" in note))).toBe(true);
    expect(result.ir.identity.every((note) => !("traceRefs" in note) && !("rawMidi" in note))).toBe(true);
    expect(result.parsed).toEqual(withoutTrace.parsed);
    expect(result.ir).toEqual(withoutTrace.ir);
  });

  it("keeps event order and source references deterministic when input notes are reordered", () => {
    const first: MetalArrangementTraceEvent[] = [];
    const second: MetalArrangementTraceEvent[] = [];
    const notes = [
      { midi: 64, start: 0, dur: 0.75, vel: 100 },
      { midi: 67, start: 1, dur: 0.75, vel: 96 },
      { midi: 69, start: 2, dur: 0.75, vel: 96 },
      { midi: 67, start: 3, dur: 0.75, vel: 96 },
    ];
    const options = { sectionBeats: 8, debug: { traceWindows: [{ id: "opening", startBeat: 0, endBeat: 4 }] } };
    buildMetalArrangement({
      ...options,
      stems: [stem("other", notes)],
      debug: { ...options.debug, traceSink: (event) => first.push(event) },
    });
    buildMetalArrangement({
      ...options,
      stems: [stem("other", [...notes].reverse())],
      debug: { ...options.debug, traceSink: (event) => second.push(event) },
    });
    expect(second).toEqual(first);
  });
});
