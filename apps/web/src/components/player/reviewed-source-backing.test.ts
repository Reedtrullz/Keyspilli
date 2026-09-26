import { expect, it } from "vitest";
import type { SongData } from "@keyspilli/player-core";
import { reviewedSourceBacking } from "./reviewed-source-backing";

it("retains the source figure and first three left-hand attacks of each bar only for the reviewed source", () => {
  const notes: SongData["notes"] = [0, 1, 2, 3, 4, 5, 6, 7].map((start) => ({ midi: 48, start, dur: 0.5, vel: 80, hand: "L" }));
  notes.push({ midi: 72, start: 3, dur: 0.5, vel: 80, hand: "R" });
  const data = { notes, chords: [], measures: [], key: "F#", tempoBpm: 123, timeSig: [4, 4],
    sourceFingerprint: "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664" } as SongData;
  expect(reviewedSourceBacking(data)?.map((note) => `${note.hand}${note.start}`)).toEqual(["L0", "L1", "L2", "R3", "L4", "L5", "L6"]);
  expect(reviewedSourceBacking({ ...data, sourceFingerprint: "another source" })).toBeNull();
  expect(reviewedSourceBacking({ ...data, sourceFingerprint: `${data.sourceFingerprint}:timing:changed` })).toBeNull();
  expect(reviewedSourceBacking({ ...data, timeSig: [3, 4] })).toBeNull();
  expect(reviewedSourceBacking({ ...data, timeSigEvents: [{ tick: 0, beat: 0, timeSig: [4, 4] }, { tick: 3840, beat: 4, timeSig: [3, 4] }] })).toBeNull();
});

it("uses the earlier accompaniment figure instead of the final vocal overlay", () => {
  const notes: SongData["notes"] = [
    { midi: 61, start: 289.5, dur: 1.5, vel: 80, hand: "R" }, // bar 73 accompaniment
    { midi: 75, start: 319, dur: 0.5, vel: 80, hand: "R" }, // unaffected middle passage
    { midi: 37, start: 516, dur: 0.5, vel: 80, hand: "L" },
    { midi: 73, start: 517.5, dur: 0.5, vel: 80, hand: "R" }, // final vocal octave
    { midi: 85, start: 517.5, dur: 0.5, vel: 80, hand: "R" },
    { midi: 83, start: 576, dur: 1, vel: 80, hand: "R" }, // final vocal tail
    { midi: 95, start: 576, dur: 1, vel: 80, hand: "R" },
    { midi: 56, start: 577, dur: 1.5, vel: 80, hand: "R" },
  ];
  const data = { notes, chords: [], measures: [], key: "F#", tempoBpm: 123, timeSig: [4, 4],
    sourceFingerprint: "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664" } as SongData;

  const backing = reviewedSourceBacking(data)!;
  expect(backing.filter((note) => note.start === 517.5).map((note) => note.midi)).toEqual([61]);
  expect(backing.filter((note) => note.start === 549.5).map((note) => note.midi)).toEqual([61]);
  expect(backing.some((note) => note.start === 576 && note.midi >= 80)).toBe(false);
  expect(backing.some((note) => note.start === 319 && note.midi === 75)).toBe(true);
  expect(backing.some((note) => note.start === 516 && note.midi === 37)).toBe(true);
  expect(backing.some((note) => note.start === 577 && note.midi === 56)).toBe(true);
});

it("separates the user-reviewed tutorial lanes", () => {
  const notes: SongData["notes"] = [
    { midi: 48, start: 0, dur: 1, vel: 70, hand: "L", sourceLane: "blue keys" },
    { midi: 72, start: 0, dur: 1, vel: 70, hand: "R", sourceLane: "green keys" },
  ];
  const dreamer = { notes, tempoBpm: 80,
    sourceFingerprint: "variant:ozzy-osbourne-dreamer:a:ozzy-osbourne-dreamer-a:552ee76720620c3aba739c9442757f9675f99b2994a2f410471a583f250745b5:notes:6be7abe3a7498c1f8beab543dcd62cfac5c23635d42ed82764fa705b607bd020" } as SongData;
  expect(reviewedSourceBacking(dreamer)?.map((note) => note.midi)).toEqual([48]);
  expect(reviewedSourceBacking({ ...dreamer, tempoBpm: 148 })).toBeNull();
  const fix = { ...dreamer, tempoBpm: 68,
    sourceFingerprint: "variant:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0:a:katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0-a:1e867afd1e1a389672199ebef7c355d0674b9995a40d655f7425f86b9967c851:notes:f251038e1ab8bdb0c5b23026d670fa819d5784580cf139db00e81ad1d09b2e9b" } as SongData;
  expect(reviewedSourceBacking(fix)?.map((note) => note.midi)).toEqual([48, 72]);
});
