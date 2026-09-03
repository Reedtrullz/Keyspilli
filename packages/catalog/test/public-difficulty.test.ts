import { describe, expect, it } from "vitest";
import {
  LEVEL_ORDER,
  PUBLIC_DIFFICULTY_ORDER,
  isPublicDifficultyLevel,
  type PublicDifficultyLevel,
} from "@keyspilli/midi";
import { groupSongs } from "../src/group.js";
import {
  projectPublicGroupedSongs,
  projectPublicSongRow,
  projectPublicSongRows,
  selectPublicRepresentative,
} from "../src/public-difficulty.js";
import type { SongRow } from "../src/db-types.js";

const LEVEL_DIFFICULTY: Record<string, string> = {
  vb: "very-beginner",
  b: "beginner",
  ve: "very-easy",
  e: "easy",
  m: "medium",
  a: "advanced",
};

function row(id: string, level: string, plays = 0): SongRow {
  return {
    id,
    baseId: "song",
    title: "Song",
    artist: "Artist",
    category: "Classical",
    difficulty: LEVEL_DIFFICULTY[level]!,
    difficultyScore: { vb: 1, b: 1.4, ve: 2, e: 2.6, m: 3.4, a: 4.6 }[level]!,
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
    createdAt: `2026-09-0${level === "ve" ? 1 : 2}T00:00:00Z`,
  };
}

describe("public difficulty projection", () => {
  it("keeps six physical levels and exposes the five-level public order", () => {
    expect(LEVEL_ORDER).toEqual([
      "very-beginner",
      "beginner",
      "very-easy",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(PUBLIC_DIFFICULTY_ORDER).toEqual([
      "very-beginner",
      "beginner",
      "easy",
      "medium",
      "advanced",
    ]);

    const publicLevels: PublicDifficultyLevel[] = [...PUBLIC_DIFFICULTY_ORDER];
    expect(publicLevels).toHaveLength(5);
  });

  it("guards only the five public difficulty values", () => {
    expect(isPublicDifficultyLevel("very-beginner")).toBe(true);
    expect(isPublicDifficultyLevel("advanced")).toBe(true);
    expect(isPublicDifficultyLevel("very-easy")).toBe(false);
    expect(isPublicDifficultyLevel(undefined)).toBe(false);
  });

  it("hides Very Easy without aliasing or mutating the Easy row", () => {
    const rows = [row("song-vb", "vb"), row("song-b", "b"), row("song-ve", "ve"), row("song-e", "e"), row("song-m", "m"), row("song-a", "a")];
    const arbitraryOrder = [...rows].reverse();
    const projected = projectPublicSongRows(arbitraryOrder);

    expect(projected.map((entry) => entry.difficulty)).toEqual([
      "very-beginner",
      "beginner",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(arbitraryOrder.map((entry) => entry.difficulty)).toEqual([
      "advanced",
      "medium",
      "easy",
      "very-easy",
      "beginner",
      "very-beginner",
    ]);
    expect(projectPublicSongRow(rows[2]!)).toBeUndefined();
    expect(projectPublicSongRow(rows[3]!)).toBe(rows[3]);
    expect(projected.map((entry) => entry.id)).not.toContain("song-ve");
    expect(projected.find((entry) => entry.difficulty === "easy")?.id).toBe("song-e");
  });

  it("chooses Easy as the grouped representative and keeps physical VE/E rows distinct", () => {
    const rows = [
      row("song-vb", "vb"),
      row("song-b", "b"),
      row("song-ve", "ve", 99),
      row("song-e", "e"),
      row("song-m", "m", 3),
      row("song-a", "a"),
    ];
    const physical = groupSongs(rows);
    expect(physical[0]!.levels.map((entry) => entry.id)).toContain("song-ve");
    expect(physical[0]!.levels.map((entry) => entry.id)).toContain("song-e");
    expect(selectPublicRepresentative(physical[0]!.levels)?.id).toBe("song-e");

    const projected = projectPublicGroupedSongs(physical);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.representative.id).toBe("song-e");
    expect(projected[0]!.levels.map((entry) => entry.difficulty)).toEqual([
      "very-beginner",
      "beginner",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(projected[0]!.levels.map((entry) => entry.id)).not.toContain("song-ve");
    expect(projected[0]!.totalPlays).toBe(3);
  });
});
