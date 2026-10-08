import { describe, expect, it } from "vitest";
import { alignChartSections, analyzeArrangement } from "../scripts/align-chart-sections";
import type { Note } from "@keyspilli/midi";
import queen from "./fixtures/queen-section-harmony.json";
import help from "./fixtures/help-section-harmony.json";

function passage(roots: number[]) {
  const notes: Note[] = roots.flatMap((root, bar) => [0, 4, 7].map(interval => ({
    midi: root + interval, start: bar * 4, dur: 4, vel: 80,
  })));
  const measures = roots.map((_, index) => ({ index, startBeat: index * 4, endBeat: (index + 1) * 4 }));
  return analyzeArrangement(notes, measures);
}

describe("chart phrase alignment", () => {
  it("keeps Help's checked Intro and rejects its near-equal interior assignments", () => {
    const result=alignChartSections({...help.chart,source:"ultimate-guitar"},help.measures,{landmarks:[
      {label:"Intro",startBar:0,endBar:8,basis:"Separately inspected retained seed Bm-G-E-A passage and closing A bar [28,32)"},
    ]});
    expect(result.publishableSections).toEqual([{id:"chart-section-1",label:"Intro",type:"intro",startBeat:0,endBeat:32,evidence:"chart"}]);
    expect(result.boundaryGaps[1]).toBeGreaterThan(.26);
    expect(result.ambiguityGap).toBeLessThan(.15);
    expect(result.confidenceScore).toBeGreaterThan(.58);
  });
  it("reproduces Queen's independently located Bridge at bars 48-63 without forcing its position", () => {
    const result = alignChartSections({ ...queen.chart, source: "ultimate-guitar" }, queen.measures, { landmarks: [
      { label: "Bridge", startBar: 48, endBar: 64, basis: "Independent C-C7-F-Fm-A7-D harmonic landmark" },
    ] });
    expect(result.sections.find(s => s.label === "Bridge")).toMatchObject({ startBeat: 144, endBeat: 192 });
    expect(result.landmarks[0]!.matched).toBe(true);
    expect(result.publishable).toBe(false); // Repeated interior/tail harmony remains ambiguous.
  });
  it("assigns ordered sections complete nonempty phrase runs", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      { label: "Verse", chords: ["C"] }, { label: "Bridge", chords: ["F#"] }, { label: "Outro", chords: ["G"] },
    ] }, passage([...Array(8).fill(48), ...Array(16).fill(54), ...Array(8).fill(55)]));
    expect(result.sections.map(s => [s.label, s.startBeat, s.endBeat, s.evidence])).toEqual([
      ["Verse", 0, 32, "chart"], ["Bridge", 32, 96, "chart"], ["Outro", 96, 128, "chart"],
    ]);
    expect(result.totalCost).toBeLessThan(0.01);
  });

  it("refuses certainty when repeated harmony permits different boundaries", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      { label: "Verse", chords: ["C"] }, { label: "Chorus", chords: ["C"] },
    ] }, passage(Array(24).fill(48)));
    expect(result.ambiguityGap).toBe(0);
    expect(result.publishable).toBe(false);
    expect(result.confidenceScore).toBe(0);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("retains a stable independently checked Bridge while dropping ambiguous verse/chorus spans", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      { label: "Verse", chords: ["C"] }, { label: "Chorus", chords: ["C"] },
      { label: "Bridge", chords: ["F#"] }, { label: "Outro", chords: ["G"] },
    ] }, passage([...Array(24).fill(48), ...Array(8).fill(54), ...Array(8).fill(55)]), { landmarks: [
      { label: "Bridge", startBar: 24, endBar: 32, basis: "Separate retained seed MIDI F# passage" },
    ] });
    expect(result.ambiguityGap).toBe(0);
    expect(result.publishableSections.map(s=>s.label)).toEqual(["Bridge"]);
    expect(result.publishable).toBe(true);
    expect(result.boundaryGaps[2]).toBeGreaterThanOrEqual(.15);
  });

  it("rejects a chart with more sections than eight-bar phrases", () => {
    expect(() => alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      { label: "Verse", chords: ["C"] }, { label: "Chorus", chords: ["G"] },
    ] }, passage(Array(8).fill(48)))).toThrow(/more sections/);
  });

  it("does not call a boundary certain merely because the grid forces it", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      { label: "Verse", chords: ["C"] }, { label: "Chorus", chords: ["C"] },
    ] }, passage(Array(16).fill(48)), {landmarks:[{label:"Verse",startBar:0,endBar:8,basis:"A supplied landmark"}]});
    expect(result.boundaryGaps[1]).toBe(0);
    expect(result.publishable).toBe(false);
  });

  it("validates repeated labels by their exact occurrence rather than sharing a landmark", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      {label:"Verse",chords:["C"]},{label:"Bridge",chords:["F#"]},{label:"Verse",chords:["G"]},
    ] }, passage([...Array(8).fill(48), ...Array(8).fill(54), ...Array(16).fill(55)]), {landmarks:[
      {label:"Verse",startBar:0,endBar:8,basis:"Only the first occurrence was checked"},
    ]});
    expect(result.publishableSections.map(s=>s.startBeat)).toEqual([0]);
  });

  it("does not silently treat unsupported or empty chord sets as evidence", () => {
    for (const chords of [[], ["N.C."], ["Cbanana"]]) {
      expect(() => alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
        { label: "Verse", chords },
      ] }, passage(Array(8).fill(48)))).toThrow(/chord/i);
    }
  });

  it("uses slash bass and distinguishes major from minor harmony", () => {
    const chart = { source: "ultimate-guitar" as const, tabId: 1, sections: [
      { label: "Verse", chords: ["C/E"] }, { label: "Bridge", chords: ["Cm"] },
    ] };
    const roots = [...Array(8).fill(52), ...Array(8).fill(48)];
    const notes: Note[] = roots.flatMap((root, bar) => (bar < 8 ? [52, 60, 64, 67] : [48, 60, 63, 67]).map(midi => ({ midi, start: bar * 4, dur: 4, vel: 80 })));
    const features = analyzeArrangement(notes, roots.map((_, index) => ({index, startBeat:index*4, endBeat:(index+1)*4})));
    const result = alignChartSections(chart, features);
    expect(result.totalCost).toBeLessThan(0.01);
    expect(result.sections[1]!.startBeat).toBe(32);
  });

  it("rejects overlapping measures instead of manufacturing a clock", () => {
    expect(() => analyzeArrangement([], [{index:0,startBeat:0,endBeat:4},{index:1,startBeat:3,endBeat:7}])).toThrow(/measure/i);
  });
});
