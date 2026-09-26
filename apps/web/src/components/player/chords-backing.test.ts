import { expect, it } from "vitest";
import { normalizeChordTimeline, resolveChordTimeline } from "@keyspilli/catalog";
import type { SongData } from "@keyspilli/player-core";
import { projectChordSources } from "../../lib/catalog-api";
import { bassChordsBackground, replayChordsBacking } from "./chords-backing";

const clocksFingerprint = "variant:coldplay-clocks:a:coldplay-clocks-a:6f318e8fcf70028535ded2b2509a0f4db10fa0b56a3987b469f760df582448fc:notes:053b40ebcf93fad16c80e470042cc1fa69b716c77a31f64a7cbb49ab77e90a51";
const journeyFingerprint = "variant:journey-dont-stop-believin:a:journey-dont-stop-believin-a:08a07ee27a19467cc7257f18cc0b67311bebc02a135c7b814b2ef798585ec717:notes:d4fe2e2e14bb77889a37f6fe37a040df8c470897270c128c09675ab21a04b354";
const winnerFingerprint = "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664";

it("plays Winner as authored chord strikes with the dense source chord passage, not its Advanced notes", async () => {
  const source = {
    key: "F#", tempoBpm: 123, timeSig: [4, 4] as [number, number], sourceFingerprint: winnerFingerprint,
    notes: [
      { midi: 42, start: 292, dur: 1, vel: 80, hand: "L" as const },
      { midi: 70, start: 292, dur: 1, vel: 80, hand: "R" as const },
      { midi: 73, start: 292, dur: 1, vel: 80, hand: "R" as const },
      { midi: 78, start: 292, dur: 1, vel: 80, hand: "R" as const },
      { midi: 82, start: 294, dur: 1, vel: 80, hand: "R" as const },
      { midi: 85, start: 294, dur: 1, vel: 80, hand: "R" as const },
      { midi: 94, start: 294, dur: 1, vel: 80, hand: "R" as const },
    ],
    chords: [], measures: Array.from({ length: 148 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
  } as SongData;
  const timeline = (await resolveChordTimeline("abba-the-winner-takes-it-all"))!.timeline;
  const replay = replayChordsBacking(projectChordSources(source, timeline));
  expect(replay.selected.source?.id).toBe("ug");
  expect(replay.reviewedSourceBacking).toBe(false);
  expect(replay.resolution.notes).toEqual([]);
  expect(replay.resolution.displayChords.length).toBeGreaterThan(0);
  expect(replay.resolution.chords.filter(({ beat }) => 292 <= beat && beat < 300).map(({ beat, name }) => [beat, name]))
    .toEqual([[292, "F#"], [294, "F#"], [296, "F#"], [298, "F#"]]);
});

it("mirrors Journey's piano sections and keeps Those Were the Days refrains chord-only", async () => {
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
      { midi: 42, start: 308, dur: 1, vel: 80, hand: "L" as const },
      { midi: 63, start: 308, dur: 1, vel: 80, hand: "R" as const },
      { midi: 66, start: 308, dur: 1, vel: 80, hand: "R" as const },
      { midi: 70, start: 308, dur: 1, vel: 80, hand: "R" as const },
      { midi: 42, start: 324, dur: 1, vel: 80, hand: "L" as const },
      { midi: 63, start: 324, dur: 1, vel: 80, hand: "R" as const },
      { midi: 66, start: 324, dur: 1, vel: 80, hand: "R" as const },
      { midi: 70, start: 324, dur: 1, vel: 80, hand: "R" as const },
      { midi: 37, start: 372, dur: 1, vel: 80, hand: "L" as const },
      { midi: 61, start: 372, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 65, start: 372, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 66, start: 372, dur: 1, vel: 80, hand: "R" as const },
      { midi: 37, start: 388, dur: 1, vel: 80, hand: "L" as const },
      { midi: 80, start: 388, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 85, start: 388, dur: 0.5, vel: 80, hand: "R" as const },
      { midi: 89, start: 388, dur: 0.5, vel: 80, hand: "R" as const },
    ],
    measures: Array.from({ length: 98 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
    sourceFingerprint: journeyFingerprint,
  } as SongData;
  const journeyChords = [
    { beat: 4, durationBeats: 160, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 164, durationBeats: 64, name: "F#", notes: [], sourceKind: "authored" as const },
    { beat: 228, durationBeats: 80, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 308, durationBeats: 16, name: "F#", notes: [], sourceKind: "authored" as const },
    { beat: 324, durationBeats: 48, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 372, durationBeats: 20, name: "F#", notes: [], sourceKind: "authored" as const },
  ];
  const journeyBacking = bassChordsBackground(journey, journeyChords, 392, null);
  expect(journeyBacking.notes.map((note) => [note.start, note.midi])).toEqual([
    [4, 37], [164, 37], [164, 68], [228, 37],
    [308, 42], [308, 63], [308, 66], [308, 70],
    [324, 42], [324, 63], [324, 66], [324, 70], [372, 25], [372, 37], [388, 25], [388, 37],
  ]);
  expect(journeyBacking.chords).toEqual([]);
  expect(journeyBacking.guidanceNotes).toEqual(journeyBacking.notes);
  expect(bassChordsBackground({ ...journey, sourceFingerprint: "other" }, journeyChords, 392, null).notes).toEqual([]);

  const days = { ...journey,
    sourceFingerprint: "variant:mary-hopkin-those-were-the-days:a:mary-hopkin-those-were-the-days-a:28ad9166ff01da3b2b50ce23654ed7517154b0492af5d5d7931149fc5fc93945:notes:5b76fc45646effb0b6dd9382fe7481c8505647dffdb29be6be36215ba02c1545",
    key: "Am", tempoBpm: 90, timeSig: [2, 4] as [number, number], chords: [],
    measures: Array.from({ length: 172 }, (_, index) => ({ index, startBeat: index * 2, endBeat: index * 2 + 2 })),
    notes: [
      { midi: 40, start: 36, dur: 1, vel: 80, hand: "L" as const },
      { midi: 62, start: 40, dur: 1, vel: 80, hand: "R" as const },
      { midi: 68, start: 40, dur: 1, vel: 80, hand: "R" as const },
      { midi: 71, start: 41, dur: 1, vel: 80, hand: "R" as const },
      { midi: 38, start: 48, dur: 1, vel: 80, hand: "L" as const },
    ],
  } as SongData;
  const timeline = (await resolveChordTimeline("mary-hopkin-those-were-the-days"))!.timeline;
  const daysBacking = replayChordsBacking(projectChordSources(days, timeline)).resolution;
  expect(daysBacking.notes).toEqual([]);
  expect(daysBacking.chords.filter(({ beat }) => beat >= 36 && beat < 48).map(({ beat, name }) => [beat, name])).toEqual([
    [36, "E"], [40, "E7"], [41, "E7"], [42, "E7"], [44, "A7"], [46, "A7"],
  ]);
  expect(daysBacking.chords.filter(({ beat }) => beat >= 118 && beat < 130).map(({ beat, name }) => [beat, name])).toEqual([
    [118, "E"], [122, "E7"], [124, "E7"], [125, "E7"], [126, "A7"], [128, "A7"],
  ]);
  expect(daysBacking.chords.find(({ beat }) => beat === 36)?.notes).toEqual([40, 64, 68, 71]);
  expect(daysBacking.chords.find(({ beat }) => beat === 40)?.notes).toEqual([40, 62, 68, 71]);
  expect(daysBacking.chords.find(({ beat }) => beat === 44)?.notes).toEqual([45, 61, 64, 67]);
});

it("keeps Journey's later verse in the opening piano register without upper runs or held pedals", () => {
  const note = (midi: number, start: number, dur: number, hand: "L" | "R" = "L") =>
    ({ midi, start, dur, vel: 80, hand });
  const data = {
    sourceFingerprint: journeyFingerprint,
    notes: [
      note(37, 243, 0.5), note(49, 243, 12),
      note(37, 244, 2.625), note(44, 247.5, 3), note(56, 247.5, 0.625), note(56, 248.5, 0.5),
      note(37, 260, 1.875), note(44, 263.5, 3.125), note(41, 267.5, 2.5),
      note(49, 307, 76), note(42, 308, 1), note(63, 308, 1, "R"),
      note(37, 388, 1.875), note(56, 388, 0.5),
    ],
    measures: Array.from({ length: 100 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
  } as SongData;
  const chords = [
    { beat: 244, durationBeats: 2.5, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 246.5, durationBeats: 4, name: "G#", notes: [], sourceKind: "authored" as const },
    { beat: 250.5, durationBeats: 9.5, name: "A#m", notes: [], sourceKind: "authored" as const },
    { beat: 260, durationBeats: 3.5, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 263.5, durationBeats: 2, name: "G#", notes: [], sourceKind: "authored" as const },
    { beat: 265.5, durationBeats: 5, name: "Fm", notes: [], sourceKind: "authored" as const },
    { beat: 270.5, durationBeats: 37.5, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 308, durationBeats: 80, name: "F#", notes: [], sourceKind: "authored" as const },
    { beat: 388, durationBeats: 4, name: "C#", notes: [], sourceKind: "authored" as const },
    { beat: 392, durationBeats: 8, name: "G#", notes: [], sourceKind: "authored" as const },
  ];
  const backing = bassChordsBackground(data, chords, 400, null);
  const at = (beat: number) => backing.notes.filter((played) => played.start === beat)
    .map(({ midi, dur }) => [midi, dur]).sort(([a], [b]) => a! - b!);
  expect(at(243)).toEqual([[37, 0.5], [49, 1]]);
  expect(at(244)).toEqual([[25, 2.5], [37, 2.5]]);
  expect(at(247.5)).toEqual([[32, 3], [44, 3]]);
  expect(at(248.5)).toEqual([]);
  expect(at(267.5)).toEqual([[29, 2.5], [41, 2.5]]);
  expect(at(307)).toEqual([[37, 1], [49, 1]]);
  expect(at(308)).toEqual([[42, 1], [63, 1]]);
  expect(at(388)).toEqual([[25, 1.875], [37, 1.875]]);
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
