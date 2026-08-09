import { describe, expect, it } from "vitest";
import { groupSongs } from "../src/group.js";
import type { SongRow } from "../src/db.js";

const LEVEL_DIFFICULTY: Record<string, string> = {
  vb: "very-beginner",
  b: "beginner",
  ve: "very-easy",
  e: "easy",
  m: "medium",
  a: "advanced",
};

function row(id: string, baseId: string, level: string, score: number, plays = 0): SongRow {
  return {
    id,
    baseId,
    title: "Song",
    artist: "Artist",
    category: "Classical",
    difficulty: LEVEL_DIFFICULTY[level]!,
    difficultyScore: score,
    key: "C",
    tempo: 100,
    style: "classical",
    mood: "peaceful",
    bassPattern: "block",
    duration: 60,
    contentType: "standard",
    acquiredVia: null,
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays,
    level,
    createdAt: "2026-08-09T00:00:00Z",
  };
}

describe("groupSongs", () => {
  it("produces one entry per song with sorted levels and summed plays", () => {
    const rows = [
    row("a-vb", "a", "vb", 1),
    row("a-b", "a", "b", 1.4),
    row("a-m", "a", "m", 3.4, 7),
    row("a-e", "a", "e", 2.6, 3),
    row("a-a", "a", "a", 4.6),
    row("a-ve", "a", "ve", 2),
    row("b-vb", "b", "vb", 1, 5),
    ];
    const g = groupSongs(rows);
    expect(g).toHaveLength(2);
    const a = g.find((x) => x.representative.baseId === "a")!;
    expect(a.levels.map((l) => l.difficulty)).toEqual([
      "very-beginner",
      "beginner",
      "very-easy",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(a.totalPlays).toBe(10);
    // most-played level is the representative
    expect(a.representative.id).toBe("a-m");
    const b = g.find((x) => x.representative.baseId === "b")!;
    expect(b.totalPlays).toBe(5);
    expect(b.representative.id).toBe("b-vb");
  });

  it("falls back to the easy level when nothing is played", () => {
    const rows = [row("c-vb", "c", "vb", 1), row("c-e", "c", "e", 2.6)];
    const g = groupSongs(rows);
    expect(g[0]!.representative.id).toBe("c-e");
  });
});
