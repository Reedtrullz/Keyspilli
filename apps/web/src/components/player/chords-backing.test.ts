import { expect, it } from "vitest";
import { normalizeChordTimeline } from "@keyspilli/catalog";
import type { SongData } from "@keyspilli/player-core";
import { projectChordSources } from "../../lib/catalog-api";
import { bassChordsBackground, replayChordsBacking } from "./chords-backing";

const clocksFingerprint = "variant:coldplay-clocks:a:coldplay-clocks-a:6f318e8fcf70028535ded2b2509a0f4db10fa0b56a3987b469f760df582448fc:notes:053b40ebcf93fad16c80e470042cc1fa69b716c77a31f64a7cbb49ab77e90a51";

it("mirrors Journey's piano sections and the repeated Those Were the Days phrase only for pinned sources", () => {
  const journey = {
    notes: [
      { midi: 37, start: 4, dur: 1, vel: 80, hand: "L" as const },
      { midi: 73, start: 4, dur: 1, vel: 80, hand: "R" as const },
      { midi: 37, start: 164, dur: 1, vel: 80, hand: "L" as const },
      { midi: 68, start: 164, dur: 1, vel: 80, hand: "R" as const },
      { midi: 37, start: 228, dur: 1, vel: 80, hand: "L" as const },
      { midi: 61, start: 228, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 65, start: 228, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 80, start: 229, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 85, start: 229, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 89, start: 229, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 63, start: 232, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 42, start: 324, dur: 1, vel: 80, hand: "L" as const },
      { midi: 63, start: 324, dur: 1, vel: 80, hand: "R" as const },
      { midi: 66, start: 324, dur: 1, vel: 80, hand: "R" as const },
      { midi: 70, start: 324, dur: 1, vel: 80, hand: "R" as const },
    ],
    measures: Array.from({ length: 82 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
    sourceFingerprint: "variant:journey-dont-stop-believin:a:journey-dont-stop-believin-a:08a07ee27a19467cc7257f18cc0b67311bebc02a135c7b814b2ef798585ec717:notes:d4fe2e2e14bb77889a37f6fe37a040df8c470897270c128c09675ab21a04b354",
  } as SongData;
  const journeyChords = [
    { beat: 4, durationBeats: 160, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 164, durationBeats: 64, name: "F#", notes: [], sourceKind: "authored" as const },
    { beat: 228, durationBeats: 96, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 324, durationBeats: 4, name: "F#", notes: [], sourceKind: "authored" as const },
  ];
  const journeyBacking = bassChordsBackground(journey, journeyChords, 328, null);
  expect(journeyBacking.notes.map((note) => [note.start, note.midi])).toEqual([
    [4, 37], [164, 37], [164, 68], [228, 37], [228, 61], [228, 65],
    [229, 80], [229, 85], [229, 89], [324, 42], [324, 63], [324, 66], [324, 70],
  ]);
  expect(journeyBacking.chords).toEqual([]);
  expect(journeyBacking.guidanceNotes).toEqual(journeyBacking.notes);
  expect(bassChordsBackground({ ...journey, sourceFingerprint: "other" }, journeyChords, 328, null).notes).toEqual([]);

  const days = { ...journey,
    sourceFingerprint: "variant:mary-hopkin-those-were-the-days:a:mary-hopkin-those-were-the-days-a:28ad9166ff01da3b2b50ce23654ed7517154b0492af5d5d7931149fc5fc93945:notes:5b76fc45646effb0b6dd9382fe7481c8505647dffdb29be6be36215ba02c1545",
    notes: [
      { midi: 40, start: 36, dur: 1, vel: 80, hand: "L" as const },
      { midi: 62, start: 40, dur: 1, vel: 80, hand: "R" as const },
      { midi: 68, start: 40, dur: 1, vel: 80, hand: "R" as const },
      { midi: 71, start: 41, dur: 1, vel: 80, hand: "R" as const },
      { midi: 38, start: 48, dur: 1, vel: 80, hand: "L" as const },
    ],
  } as SongData;
  const daysBacking = bassChordsBackground(days, [
    { beat: 36, durationBeats: 12, name: "E7", notes: [], sourceKind: "authored" },
    { beat: 48, durationBeats: 4, name: "Dm", notes: [], sourceKind: "authored" },
  ], 52, null);
  expect(daysBacking.notes.map((note) => note.midi)).toEqual([40, 62, 68]);
  expect(daysBacking.chords.every((chord) => chord.beat >= 48)).toBe(true);
});

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

it("plays All of Me as authored chord attacks instead of its near-original source notes", () => {
  const source: SongData = {
    key: "Fm", tempoBpm: 129, timeSig: [4, 4],
    sourceFingerprint: "variant:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x:a:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x-a:504cf2504309905c76338b1e0bd0d4b5b09fd45f3029ba5ebdd1881274ae0d76:notes:2d8212fa850c7dfcbc3dbf0029f4b22a2ee93385fe686214b48b20db28865cfb",
    notes: [
      { midi: 41, start: 0, dur: 1, vel: 80, hand: "L" },
      { midi: 65, start: 1, dur: 1, vel: 80, hand: "R" },
      { midi: 72, start: 1, dur: 1, vel: 80, hand: "R" },
      { midi: 37, start: 4, dur: 1, vel: 80, hand: "L" },
    ],
    chords: [], measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }],
  };
  const timeline = normalizeChordTimeline({
    schemaVersion: 1, baseId: "rousseau-john-legend-all-of-me-piano-cover-mslwrq3x", title: "All of Me", artist: "John Legend",
    timeSig: [4, 4], durationBeats: 8, coverage: "full-song",
    chords: [{ beat: 0, durationBeats: 4, name: "Fm" }, { beat: 4, durationBeats: 4, name: "Db" }],
    provenance: { sourceId: "ug-all-of-me", provider: "ultimate-guitar", kind: "chart", sourceRef: "test:all-of-me" },
  });

  const replay = replayChordsBacking(projectChordSources(source, timeline));
  expect(replay.selected.source?.id).toBe("ug");
  expect(replay.resolution.notes).toEqual([]);
  expect(replay.resolution.chords.map(({ beat, name }) => [beat, name])).toEqual([[0, "Fm"], [4, "Db"]]);
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

it("keeps the authored chord's full display span when its played stack re-strikes", () => {
  const source: SongData = {
    key: "Bbm", tempoBpm: 130, timeSig: [4, 4], sourceFingerprint: clocksFingerprint,
    notes: [0, 1.5, 3].flatMap((start) => [
      { midi: 51, start, dur: 0.75, vel: 68, hand: "L" as const },
      { midi: 58, start, dur: 0.75, vel: 68, hand: "L" as const },
      { midi: 63, start, dur: 0.75, vel: 68, hand: "R" as const },
    ]),
    chords: [], measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  };
  const timeline = normalizeChordTimeline({
    schemaVersion: 1, baseId: "coldplay-clocks", title: "Clocks", artist: "Coldplay",
    timeSig: [4, 4], durationBeats: 4, coverage: "full-song",
    chords: [{ beat: 0, durationBeats: 4, name: "Eb" }],
    provenance: { sourceId: "ug-clocks", provider: "ultimate-guitar", kind: "chart", sourceRef: "test:clocks" },
  });
  const replay = replayChordsBacking(projectChordSources(source, timeline));
  expect(replay.resolution.chords.map((chord) => chord.beat)).toEqual([0, 1.5, 3]);
  expect(replay.resolution.displayChords[0]).toMatchObject({ beat: 0, durationBeats: 4, notes: [51, 58, 63] });
});
