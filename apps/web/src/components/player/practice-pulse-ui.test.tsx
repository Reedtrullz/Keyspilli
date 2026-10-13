import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { EngineSongMeta } from "@keyspilli/player-core";
import { PracticeSetupDialog } from "./PracticeSetupDialog";

afterEach(() => vi.unstubAllGlobals());
const timing: EngineSongMeta = {
  tempoBpm: 120, timeSig: [7, 8], endBeat: 6.5, measureStarts: [0, 3],
  timeSigEvents: [{ beat: 0, timeSig: [6, 8] }, { beat: 3, timeSig: [7, 8] }],
};

function render(practiceTiming: EngineSongMeta = timing, practicePulse?: { pulse: "eighth"; beatGroups: { timeSig: [number, number]; groups: number[] }[] }) {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(createElement(PracticeSetupDialog, {
    initialSetup: { input: "keyboard", wait: false, scope: "beginning", countInBeats: 4, metronome: true, practicePulse },
    practiceTiming,
    hasLoop: false, midiConnected: false, micReady: false, micPending: false, micError: "", error: "", micSignal: "Unknown",
    microphoneTarget: () => ({ eligible: false, reason: "Choose keyboard" }),
    keyboardTarget: () => ({ total: 2, visible: 2, overflow: 0, physicalUnavailable: null, overflowPitches: [] }),
    onEnableMic() {}, onInputChange() {}, onStart() {}, onCancel() {},
  } as React.ComponentProps<typeof PracticeSetupDialog>));
}

it("offers explicit pulse choices without selecting a compound grouping by default", () => {
  const html = render();
  expect(html).toContain('aria-label="Metronome during playback"');
  expect(html).toContain('aria-label="Practice pulse"');
  expect(html).toMatch(/<option value="default" selected="">Default quarter-note clicks/);
  expect(html).toContain("Quarter notes"); expect(html).toContain("Eighth notes"); expect(html).toContain("Dotted quarter notes");
  expect(html).toContain("4 quarter-note beats");
  expect(html).toContain("source downbeat phase is unverified");
  expect(html).not.toContain('value="3+3"');
});

it("shows distinct meter-specific grouping controls and preserves an explicit saved choice", () => {
  const html = render(timing, { pulse: "eighth", beatGroups: [{ timeSig: [6, 8], groups: [3, 3] }, { timeSig: [7, 8], groups: [2, 2, 3] }] });
  expect(html).toContain('aria-label="Grouping in 6/8"'); expect(html).toContain('aria-label="Grouping in 7/8"');
  expect(html).toContain('value="3+3"'); expect(html).toContain('value="2+2+3"');
  expect(html).toContain("Group starts add accent clicks");
  expect(render({ ...timing, measureStartBeat: 0 })).toContain("verified source bar phase");
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Start practice/);
});

it("prevents invalid grouping from reaching Start and explains the required total", () => {
  const html = render(timing, { pulse: "eighth", beatGroups: [{ timeSig: [7, 8], groups: [2, 3] }] });
  expect(html).toContain("totaling 7");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start practice/);
});

it("offers default clicks when source meter changes do not align with displayed bars", () => {
  const unsupported = { ...timing, measureStarts: [0, 3.5] };
  const html = render(unsupported, { pulse: "eighth", beatGroups: [] });
  expect(html).toContain("Use default clicks");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start practice/);
  expect(render(unsupported)).not.toMatch(/<button[^>]*disabled=""[^>]*>Start practice/);
});
