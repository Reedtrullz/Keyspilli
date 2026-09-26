import { expect, it } from "vitest";
import type { SongData } from "@keyspilli/player-core";
import { reviewedRhythmNotes, reviewedSourceBacking } from "./reviewed-source-backing";

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

it("keeps only chord-tone short key bursts for the two pinned sources", () => {
  const chord = { beat: 0, durationBeats: 4, name: "Am", notes: [], sourceKind: "authored" as const };
  const attack = { ...chord, notes: [45, 60, 64, 69] };
  const notes: SongData["notes"] = [
    { midi: 60, start: 1, dur: 0.125, vel: 100, hand: "R" },
    { midi: 64, start: 1, dur: 0.125, vel: 90, hand: "R" },
    { midi: 62, start: 1, dur: 0.125, vel: 90, hand: "R" },
    { midi: 60, start: 2, dur: 1, vel: 90, hand: "R" },
  ];
  const sourceFingerprint = "variant:gloria-gaynor-i-will-survive:a:gloria-gaynor-i-will-survive-a:df59b0eb90e4c2ecf9c8b9cf13cba3bcdd8c9ea9942bdb09ee54b7664538784a:notes:448373fe2bb4a5c8e510b26dd6a226b5ab3366cb37808bc9029af965564dc8e1";
  const data = { notes, sourceFingerprint } as SongData;
  expect(reviewedRhythmNotes(data, [chord], [attack]).map((note) => [note.midi, note.start, note.vel])).toEqual([
    [60, 1, 64], [64, 1, 64],
  ]);
  expect(reviewedRhythmNotes({ ...data, sourceFingerprint: `${sourceFingerprint}:changed` }, [chord], [attack])).toEqual([]);

  const army = { ...data, sourceFingerprint: "variant:status-quo-in-the-army-now:a:status-quo-in-the-army-now-a:0cccaa9f5ad91707327ab6c1f311e30e3de6fb3c91d1695f862c646b8772ab65:notes:f61af5ba58446fd7cafc71ae95569a75d1dc16ca584d787d40ec317c359656ad",
    notes: [{ midi: 50, start: 0.5, dur: 0.125, vel: 78, hand: "L" as const },
      { midi: 57, start: 0.5, dur: 0.125, vel: 78, hand: "L" as const },
      { midi: 38, start: 0.5, dur: 0.125, vel: 78, hand: "L" as const }] };
  const dm = { ...chord, name: "Dm" };
  expect(reviewedRhythmNotes(army, [dm], [{ ...attack, name: "Dm", notes: [50, 53, 57] }]).map((note) => note.midi)).toEqual([50, 57]);
});

it("separates the user-reviewed tutorial lanes and the All of Me accompaniment", () => {
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

  const cover = { ...dreamer, notes: [
    { midi: 41, start: 0, dur: 1, vel: 80, hand: "L" as const },
    { midi: 65, start: 1, dur: 1, vel: 80, hand: "R" as const },
    { midi: 72, start: 1, dur: 1, vel: 80, hand: "R" as const },
    { midi: 89, start: 2, dur: 1, vel: 80, hand: "R" as const },
  ], sourceFingerprint: "variant:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x:a:rousseau-john-legend-all-of-me-piano-cover-mslwrq3x-a:504cf2504309905c76338b1e0bd0d4b5b09fd45f3029ba5ebdd1881274ae0d76:notes:2d8212fa850c7dfcbc3dbf0029f4b22a2ee93385fe686214b48b20db28865cfb" } as SongData;
  expect(reviewedSourceBacking(cover)?.map((note) => note.midi)).toEqual([41, 65, 72]);
});
