import { describe, expect, it } from "vitest";
import { alignChartSections, analyzeArrangement } from "../scripts/align-chart-sections";
import type { Note } from "@keyspilli/midi";
import queen from "./fixtures/queen-section-harmony.json";
import help from "./fixtures/help-section-harmony.json";
import bonnie from "./fixtures/bonnie-section-harmony.json";

function passage(roots: number[]) {
  const notes: Note[] = roots.flatMap((root, bar) => [0, 4, 7].map(interval => ({
    midi: root + interval, start: bar * 4, dur: 4, vel: 80,
  })));
  const measures = roots.map((_, index) => ({ index, startBeat: index * 4, endBeat: (index + 1) * 4 }));
  return analyzeArrangement(notes, measures);
}

describe("chart phrase alignment", () => {
  it("retains Bonnie's independently checked short Intro while dropping its ambiguous interior", () => {
    const result=alignChartSections({...bonnie.chart,source:"ultimate-guitar"},bonnie.measures,{phraseBars:4,transpose:1,landmarks:[
      {label:"Intro",startBar:0,endBar:4,basis:"Separately inspected raw piano-only opening and independent cue-track entry at beat 16"},
    ]});
    expect(result.publishableSections).toEqual([{id:"chart-section-1",label:"Intro",type:"intro",startBeat:0,endBeat:16,evidence:"chart"}]);
    expect(result.boundaryGaps[1]).toBeCloseTo(.16458333333333375);
    expect(result.ambiguityGap).toBeLessThan(.01);
    expect(result.confidenceScore).toBeCloseTo(.6);
  });
  it.each([
    {chord:"D7sus4",pitches:[50,55,57,60]},
    {chord:"D#(b5)",pitches:[51,55,57]},
    {chord:"D#dim7",pitches:[51,54,57,60]},
    {chord:"Bm7b5",pitches:[47,50,53,57]},
    {chord:"D7sus4/C",pitches:[48,50,55,57]},
  ])("scores the explicit $chord pitch classes without dropping its alteration",({chord,pitches})=>{
    const notes:Note[]=Array.from({length:8},(_,bar)=>pitches.map(midi=>({midi,start:bar*4,dur:4,vel:80}))).flat();
    const bars=analyzeArrangement(notes,Array.from({length:8},(_,index)=>({index,startBeat:index*4,endBeat:(index+1)*4})));
    const result=alignChartSections({source:"ultimate-guitar",tabId:1,sections:[{label:"Verse",chords:[chord]}]},bars);
    expect(result.totalCost).toBeCloseTo(0);
  });
  it("transposes altered chart tones and slash bass together", () => {
    const notes:Note[]=Array.from({length:8},(_,bar)=>[49,51,56,58].map(midi=>({midi,start:bar*4,dur:4,vel:80}))).flat();
    const bars=analyzeArrangement(notes,Array.from({length:8},(_,index)=>({index,startBeat:index*4,endBeat:(index+1)*4})));
    expect(alignChartSections({source:"ultimate-guitar",tabId:1,sections:[{label:"Verse",chords:["D7sus4/C"]}]},bars,{transpose:1}).totalCost).toBeCloseTo(0);
  });
  it("locates a checked four-bar Intro instead of forcing it onto the eight-bar grid", () => {
    const result = alignChartSections({ source: "ultimate-guitar", tabId: 1, sections: [
      {label:"Intro",chords:["C"]},{label:"Bridge",chords:["F#"]},{label:"Outro",chords:["G"]},
    ] }, passage([...Array(4).fill(48), ...Array(8).fill(54), ...Array(12).fill(55)]), {
      phraseBars: 4,
      landmarks:[{label:"Intro",startBar:0,endBar:4,basis:"Independent four-bar C passage before F#"}],
    });
    expect(result.publishableSections).toEqual([
      {id:"chart-section-1",label:"Intro",type:"intro",startBeat:0,endBeat:16,evidence:"chart"},
    ]);
    expect(result.boundaryGaps[1]).toBeGreaterThanOrEqual(.15);
  });

  it("keeps finer-grid cost gaps in eight-bar-equivalent units", () => {
    const chart = {source:"ultimate-guitar" as const,tabId:1,sections:[
      {label:"Verse",chords:["C"]},{label:"Outro",chords:["G"]},
    ]};
    const bars = passage([...Array(8).fill(48), ...Array(8).fill(54), ...Array(8).fill(55)]);
    // Eight F# bars match neither chord set: 8 * capped cost 1 / 8 = 1.
    for (const phraseBars of [4,8] as const) {
      const result = alignChartSections(chart,bars,{phraseBars});
      expect(result.totalCost).toBeCloseTo(1);
      expect(result.ambiguityGap).toBe(0);
      expect(result.publishable).toBe(false);
    }
  });

  it("bounds the finer grid instead of multiplying the offline search without limit", () => {
    expect(() => alignChartSections({source:"ultimate-guitar",tabId:1,sections:[
      {label:"Verse",chords:["C"]},{label:"Outro",chords:["G"]},
    ]},passage(Array(272).fill(48)),{phraseBars:4})).toThrow(/64 phrases/);
  });

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
