import { expect, it } from "vitest";
import { normalizeChordTimeline } from "@keyspilli/catalog";
import type { SongData } from "@keyspilli/player-core";
import { projectChordSources } from "../../lib/catalog-api";
import { replayChordsBacking } from "./chords-backing";

const clocksFingerprint = "variant:coldplay-clocks:a:coldplay-clocks-a:6f318e8fcf70028535ded2b2509a0f4db10fa0b56a3987b469f760df582448fc:notes:053b40ebcf93fad16c80e470042cc1fa69b716c77a31f64a7cbb49ab77e90a51";

it("plays Clocks' struck source stacks instead of revoicing its chart symbols from the arpeggio", () => {
  const source: SongData = {
    key: "Bbm", tempoBpm: 130, timeSig: [4, 4],
    sourceFingerprint: clocksFingerprint,
    notes: [
      { midi: 51, start: 0, dur: 3.75, vel: 68, hand: "L" },
      { midi: 58, start: 0, dur: 3.75, vel: 68, hand: "L" },
      { midi: 63, start: 0, dur: 3.75, vel: 68, hand: "R" },
      { midi: 75, start: 0, dur: 0.5, vel: 95, hand: "R" },
      { midi: 67, start: 1, dur: 0.5, vel: 77, hand: "R" },
      { midi: 53, start: 4, dur: 3.75, vel: 68, hand: "L" },
      { midi: 58, start: 4, dur: 3.75, vel: 68, hand: "L" },
      { midi: 61, start: 4, dur: 3.75, vel: 68, hand: "R" },
      { midi: 73, start: 4, dur: 0.5, vel: 95, hand: "R" },
    ],
    chords: [],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }],
  };
  const timeline = normalizeChordTimeline({
    schemaVersion: 1, baseId: "coldplay-clocks", title: "Clocks", artist: "Coldplay",
    timeSig: [4, 4], durationBeats: 8, coverage: "full-song",
    chords: [{ beat: 0, durationBeats: 4, name: "Eb" }, { beat: 4, durationBeats: 4, name: "Bbm/F" }],
    provenance: { sourceId: "ug-clocks", provider: "ultimate-guitar", kind: "chart", sourceRef: "test:clocks" },
  });

  const replay = replayChordsBacking(projectChordSources(source, timeline));
  expect(replay.selected.source?.id).toBe("ug");
  expect(replay.resolution.chords.map(({ beat, notes, suggestedHands }) => ({ beat, notes, suggestedHands }))).toEqual([
    { beat: 0, notes: [51, 58, 63], suggestedHands: ["L", "L", "R"] },
    { beat: 4, notes: [53, 58, 61], suggestedHands: ["L", "L", "R"] },
  ]);
  expect(replay.resolution.notes).toEqual([]);
});

it("reuses Clocks' played stack in its right-hand-only ending and ignores other source fingerprints", () => {
  const source: SongData = {
    key: "Bbm", tempoBpm: 130, timeSig: [4, 4],
    sourceFingerprint: clocksFingerprint,
    notes: [
      { midi: 51, start: 0, dur: 3.75, vel: 68, hand: "L" },
      { midi: 58, start: 0, dur: 3.75, vel: 68, hand: "L" },
      { midi: 63, start: 0, dur: 3.75, vel: 68, hand: "R" },
      { midi: 75, start: 128, dur: 0.5, vel: 95, hand: "R" },
    ],
    chords: [],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 32, startBeat: 128, endBeat: 132 }],
  };
  const timeline = normalizeChordTimeline({
    schemaVersion: 1, baseId: "coldplay-clocks", title: "Clocks", artist: "Coldplay",
    timeSig: [4, 4], durationBeats: 132, coverage: "opening-section",
    chords: [{ beat: 0, durationBeats: 4, name: "Eb" }, { beat: 128, durationBeats: 4, name: "Eb" }],
    provenance: { sourceId: "ug-clocks", provider: "ultimate-guitar", kind: "chart", sourceRef: "test:clocks" },
  });
  const data = projectChordSources(source, timeline);
  const replay = replayChordsBacking(data, "ug");
  expect(replay.resolution.chords.find((chord) => chord.beat === 128)?.notes).toEqual([51, 58, 63]);
  const changed = replayChordsBacking({ ...data, sourceFingerprint: "another source" }, "ug");
  expect(changed.resolution.chords.find((chord) => chord.beat === 128)?.notes).not.toEqual([51, 58, 63]);
});
