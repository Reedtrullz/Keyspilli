import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type SongData } from "@keyspilli/player-core";
import { BeginnerView } from "./BeginnerView";
import { LeadSheetView } from "./LeadSheetView";
import { PracticeSetupDialog } from "./PracticeSetupDialog";
import { SoundControls } from "./SoundControls";
import { loopFromBars, practiceContext, resolvePracticeRange } from "./player-ui-context";
afterEach(() => vi.unstubAllGlobals());

it("resolves pickup, meter-change and final-bar ranges without committing invalid loop drafts", () => {
  const measures = [{ startBeat: 0, endBeat: 1 }, { startBeat: 1, endBeat: 4 }, { startBeat: 4, endBeat: 10 }];
  expect(loopFromBars(2, 3, measures)).toEqual({ startBeat: 1, endBeat: 10 });
  for (const [start, end] of [[0, 2], [3, 2], [1, 4], [1.5, 2]]) expect(loopFromBars(start!, end!, measures)).toBeNull();
  expect(resolvePracticeRange("bars", measures, 2, 0, 10, 120, 0.5, null)).toEqual({ startSec: 4, endSec: 10 });
  const loop = { startSec: 1, endSec: 4 };
  expect(resolvePracticeRange("loop", measures, 0, 0, 10, 120, 1, loop)).toBe(loop);
  expect(practiceContext("C", 120, { transpose: 2, speed: 0.5 }, true)).toContain("Tempo provisional");
});

const data: SongData = {
  key: "C", tempoBpm: 120, timeSig: [4, 4], chords: [],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  notes: [
    { midi: 60, start: 0, dur: 1, vel: 80, hand: "R", lyrics: "Simultaneous" },
    { midi: 61, start: 0, dur: 1, vel: 80, hand: "R", lyrics: "Long lyrics remain readable" },
    { midi: 64, start: 0.125, dur: 1, vel: 80, hand: "R" },
  ],
};

it("gives dense lead-sheet attacks separate intrinsic-size annotation columns", () => {
  const html = renderToStaticMarkup(createElement(LeadSheetView, { data, time: 0, settings: DEFAULT_SETTINGS, chords: [] }));
  expect(html).toContain('aria-label="Lead sheet events"');
  expect(html).toContain('data-midi="60"');
  expect(html).toContain('data-midi="61"');
  expect(html).toContain("Long lyrics remain readable");
  expect(html.match(/<svg[\s\S]*?<\/svg>/)?.[0]).not.toContain("Long lyrics");
});

it("names source and effective key and tempo in note letters", () => {
  const html = renderToStaticMarkup(createElement(BeginnerView, { data, time: 0, settings: { ...DEFAULT_SETTINGS, transpose: 2, speed: 0.5 }, chords: [] }));
  expect(html).toContain("Source C");
  expect(html).toContain("Playback D");
  expect(html).toContain("60 practice BPM");
  expect(html).toContain("Pause following");
});

it("shows the resolved setup context and input readiness before Start", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(createElement(PracticeSetupDialog, {
    keyboardTarget: () => ({total:8,visible:8,overflow:0,physicalUnavailable:0,overflowPitches:[]}), microphoneTarget: () => ({ eligible: false, reason: "Overlapping pitches" }), micSignal: "Unknown signal quality",
    initialSetup: { input: "midi", wait: true, scope: "bars", countInBeats: 0 },
    hasLoop: false, midiConnected: false, micReady: false, micPending: false, micError: "", error: "",
    describeSetup: () => "Bars 2–5 · Both hands · Playback D · 50% · 60 practice BPM",
    onEnableMic: () => {}, onInputChange: () => {}, onStart: () => {}, onCancel: () => {},
  }));
  expect(html).toContain("Bars 2–5");
  expect(html).toContain("Connect a MIDI keyboard");
});

it("divides arrangement from instrument and mix without changing settings", () => {
  const html = renderToStaticMarkup(createElement(SoundControls, { settings: DEFAULT_SETTINGS, onChange: () => {} }));
  expect(html).toContain('aria-label="Arrangement settings"');
  expect(html).toContain('aria-label="Instrument and mix settings"');
});

it("withholds microphone practice for a polyphonic target even after permission is ready", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(createElement(PracticeSetupDialog, {
    keyboardTarget: () => ({total:8,visible:8,overflow:0,physicalUnavailable:0,overflowPitches:[]}), microphoneTarget: () => ({ eligible: false, reason: "Overlapping pitches exceed the monophonic detector" }), micSignal: "Unknown signal quality",
    initialSetup: { input: "microphone", wait: false, scope: "bars", countInBeats: 0 },
    hasLoop: false, midiConnected: false, micReady: true, micPending: false, micError: "", error: "",
    onEnableMic: () => {}, onInputChange: () => {}, onStart: () => {}, onCancel: () => {},
  }));
  expect(html).toContain("Overlapping pitches"); expect(html).toContain("Unknown signal quality");
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Start practice/);
});

it("keeps a cross-bar hold visible without another attack and derives silence after its interval",()=>{
 const held:SongData={...data,notes:[{midi:60,start:0,dur:5,vel:80,hand:"R"}],measures:[{index:0,startBeat:0,endBeat:4},{index:1,startBeat:4,endBeat:8}]};
 for(const component of [BeginnerView,LeadSheetView]) {
  const html=renderToStaticMarkup(createElement(component,{data:held,time:2.25,settings:DEFAULT_SETTINGS,chords:[]}));
  expect(html).toContain("Carry, not a new attack");expect(html).toContain("hold to beat 2");expect(html).toContain("Silence to beat 5");
  expect(html).toContain('data-midi="60"');
 }
 const beginning=renderToStaticMarkup(createElement(BeginnerView,{data:held,time:0,settings:DEFAULT_SETTINGS,chords:[]}));
 expect(beginning).toContain("continues into next bar");expect(beginning).toContain("Carry RH C4");
});

it("shows matching authored spelling and marks transposed spelling as derived",()=>{
 const spelled:SongData={...data,notes:[{midi:70,start:0,dur:1,vel:80,hand:"R",sourcePitch:{step:"B",alter:-1,octave:4}}]};
 for(const component of [BeginnerView,LeadSheetView]) {
  const source=renderToStaticMarkup(createElement(component,{data:spelled,time:0,settings:DEFAULT_SETTINGS,chords:[]}));expect(source).toContain("Bb4");expect(source).toContain("source spelling");
  const changed=renderToStaticMarkup(createElement(component,{data:spelled,time:0,settings:{...DEFAULT_SETTINGS,transpose:1},chords:[]}));expect(changed).toContain("B4");expect(changed).toContain("derived spelling");expect(changed).not.toContain("Bb4");
 }
});
