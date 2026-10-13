import { describe, expect, it } from "vitest";

import { addRecent, type RecentSong } from "./recent-songs";

const song = (id: string, baseId: string, at: number): RecentSong => ({ id, baseId, title: id, artist: "A", difficulty: "easy", at });

describe("addRecent", () => {
  it("puts the newest song first and keeps one entry per base song", () => {
    const list = addRecent([song("a-easy", "a", 1), song("b-easy", "b", 2)], song("a-medium", "a", 3));
    expect(list.map((r) => r.id)).toEqual(["a-medium", "b-easy"]);
  });

  it("caps the list at four entries", () => {
    let list: RecentSong[] = [];
    for (const [i, id] of ["a", "b", "c", "d", "e"].entries()) list = addRecent(list, song(id, id, i));
    expect(list.map((r) => r.id)).toEqual(["e", "d", "c", "b"]);
  });
});
