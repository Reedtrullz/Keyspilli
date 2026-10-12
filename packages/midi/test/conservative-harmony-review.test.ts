import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferHarmonyTimeline, CHORDS_TUNING, type Note } from "../src/index.js";

const controls = JSON.parse(readFileSync(new URL("./fixtures/ks09-harmony-review-v2.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; notes: Note[]; durationBeats: number; reference: Array<{ startBeat: number; endBeat: number; kind: string; allowedPitchClasses: number[] }> }>;
};
describe("implementation revision 2 post-review onset support", () => {
  it.each(controls.cases)("does not move future defining pitches or bass earlier in $id", item => {
    const labels = inferHarmonyTimeline(item.notes, [{ startBeat: 0, endBeat: item.durationBeats }], { key: "C", policy: "conservative-backing-v1" });
    expect(labels[0]!.notes.length).toBeGreaterThan(0);
    for (const reference of item.reference) {
      for (const label of labels.filter(label => label.beat < reference.endBeat && label.beat + label.durationBeats! > reference.startBeat)) {
        expect(label.notes.every(midi => reference.allowedPitchClasses.includes(midi % 12))).toBe(true);
      }
    }
  });
  it.each(["5", "sus2"])("does not expand the non-policy vocabulary for custom %s tuning", quality => {
    const pitches = quality === "5" ? [48, 55] : [48, 50, 55];
    const notes = pitches.map(midi => ({ midi, start: 0, dur: 4, vel: 80 }));
    const usual = inferHarmonyTimeline(notes, [{ startBeat: 0, endBeat: 4 }], { key: "C" });
    const custom = inferHarmonyTimeline(notes, [{ startBeat: 0, endBeat: 4 }], { key: "C", tuning: { ...CHORDS_TUNING.harmony, qualityCost: { ...CHORDS_TUNING.harmony.qualityCost, [quality]: -100 } } });
    expect(custom).toEqual(usual);
  });
});
