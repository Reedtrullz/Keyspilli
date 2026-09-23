import { expect, it } from "vitest";
import type { SongData } from "@keyspilli/player-core";
import { reviewedSourceBacking } from "./reviewed-source-backing";

it("retains the source figure and first three left-hand attacks of each bar only for the reviewed source", () => {
  const notes: SongData["notes"] = [0, 1, 2, 3, 4, 5, 6, 7].map((start) => ({ midi: 48, start, dur: 0.5, vel: 80, hand: "L" }));
  notes.push({ midi: 72, start: 3, dur: 0.5, vel: 80, hand: "R" });
  const data = { notes, chords: [], measures: [], key: "F#", tempoBpm: 123, timeSig: [4, 4],
    sourceFingerprint: "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664" } as SongData;
  expect(reviewedSourceBacking(data)?.map((note) => `${note.hand}${note.start}`)).toEqual(["L0", "L1", "L2", "L4", "L5", "L6", "R3"]);
  expect(reviewedSourceBacking({ ...data, sourceFingerprint: "another source" })).toBeNull();
});
