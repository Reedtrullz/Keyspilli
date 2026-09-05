import { describe, expect, it } from "vitest";

import { experimentLabelsForSongs } from "./SongBrowser";

describe("song experiment labels", () => {
  it("labels duplicate artist/title runs while leaving unique songs unlabeled", () => {
    const labels = experimentLabelsForSongs([
      {
        representative: {
          id: "defence-first-e",
          baseId: "sabaton-defence-of-moscow-mtdq7vdx",
          title: "Defence of Moscow",
          artist: "Sabaton",
          key: "Am",
          tempo: 120,
        },
        levels: [],
        totalPlays: 0,
        lastCreatedAt: "2026-08-29T07:00:34.000Z",
      },
      {
        representative: {
          id: "defence-second-e",
          baseId: "sabaton-defence-of-moscow-mte172p8",
          title: "DEFENCE OF MOSCOW",
          artist: "SABATON",
          key: "Am",
          tempo: 120,
        },
        levels: [],
        totalPlays: 0,
        lastCreatedAt: "2026-08-30T08:10:00.000Z",
      },
      {
        representative: {
          id: "unique-e",
          baseId: "sabaton-livgardet-dxhpyinsbdw",
          title: "Livgardet",
          artist: "Sabaton",
          key: "Dm",
          tempo: 136,
        },
        levels: [],
        totalPlays: 0,
        lastCreatedAt: "2026-08-26T15:31:07.000Z",
      },
    ]);

    expect(Object.fromEntries(labels)).toEqual({
      "defence-first-e": "Experiment mtdq7vdx · 2026-08-29 07:00 UTC",
      "defence-second-e": "Experiment mte172p8 · 2026-08-30 08:10 UTC",
    });
  });
});
