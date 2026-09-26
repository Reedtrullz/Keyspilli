import { expect, it } from "vitest";
import type { SongData } from "@keyspilli/player-core";
import { reviewedSourceBacking } from "./reviewed-source-backing";

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
