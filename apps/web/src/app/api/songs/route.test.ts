import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSongs = vi.hoisted(() => vi.fn());
const listSongsGroupedWithTotal = vi.hoisted(() => vi.fn());
const countSongs = vi.hoisted(() => vi.fn());
const projectPublicGroupedSongs = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ listSongs, listSongsGroupedWithTotal, countSongs, projectPublicGroupedSongs }));

import { GET } from "./route";

const requestFor = (query: string) => new NextRequest(`http://127.0.0.1/api/songs?${query}`);

const groupedRow = (id: string, difficulty: string, level: string, difficultyScore: number) => ({
  id,
  baseId: "song",
  title: "Test Song",
  artist: "Test Artist",
  category: "Classical",
  difficulty,
  difficultyScore,
  key: "C",
  tempo: 120,
  style: "classical",
  mood: "peaceful",
  bassPattern: "block",
  duration: 60,
  contentType: "standard",
  acquiredVia: null,
  sourceYoutubeUrl: null,
  hasSheetXml: 1,
  sections: "[]",
  plays: 1,
  level,
  createdAt: "2026-08-25T00:00:00.000Z",
});

describe("grouped songs route", () => {
  beforeEach(() => {
    listSongs.mockReset();
    listSongsGroupedWithTotal.mockReset();
    countSongs.mockReset();
    projectPublicGroupedSongs.mockReset();
  });

  it("projects only the fields consumed by SongBrowser", async () => {
    listSongsGroupedWithTotal.mockReturnValueOnce({
      songs: [
        {
          representative: {
            id: "song-e",
            baseId: "song",
            title: "Test Song",
            artist: "Test Artist",
            category: "Classical",
            difficulty: "easy",
            difficultyScore: 4,
            key: "C",
            tempo: 120,
            style: "classical",
            mood: "peaceful",
            bassPattern: "block",
            duration: 60,
            contentType: "standard",
            acquiredVia: null,
            sourceYoutubeUrl: null,
            hasSheetXml: 1,
            sections: "[]",
            plays: 3,
            level: "e",
            createdAt: "2026-08-25T00:00:00.000Z",
          },
          levels: [
            {
              id: "song-b",
              baseId: "song",
              title: "Test Song",
              artist: "Test Artist",
              category: "Classical",
              difficulty: "beginner",
              difficultyScore: 2,
              key: "C",
              tempo: 120,
              style: "classical",
              mood: "peaceful",
              bassPattern: "block",
              duration: 60,
              contentType: "standard",
              acquiredVia: null,
              sourceYoutubeUrl: null,
              hasSheetXml: 1,
              sections: "[]",
              plays: 1,
              level: "b",
              createdAt: "2026-08-25T00:00:00.000Z",
            },
          ],
          totalPlays: 4,
          lastCreatedAt: "2026-08-25T00:00:00.000Z",
        },
      ],
      total: 1,
    });
    projectPublicGroupedSongs.mockImplementation((groups: unknown[]) => groups);

    const response = await GET(
      requestFor("group=1&difficulty=easy&key=C&style=classical&mood=peaceful&bass=block&category=Classical&q=foo&sort=title&limit=10&offset=2"),
    );

    expect(listSongsGroupedWithTotal).toHaveBeenCalledWith({
      difficulty: "easy",
      key: "C",
      style: "classical",
      mood: "peaceful",
      bassPattern: "block",
      category: "Classical",
      q: "foo",
      sort: "title",
      limit: 10,
      offset: 2,
    });
    await expect(response.json()).resolves.toEqual({
      songs: [
        {
          representative: { id: "song-e", title: "Test Song", artist: "Test Artist", key: "C", tempo: 120 },
          levels: [{ id: "song-b", difficulty: "beginner" }],
          totalPlays: 4,
        },
      ],
      total: 1,
    });
  });

  it("projects the public five-level ladder and chooses the physical Easy representative", async () => {
    const levels = [
      groupedRow("song-vb", "very-beginner", "vb", 1),
      groupedRow("song-b", "beginner", "b", 1.4),
      groupedRow("song-ve", "very-easy", "ve", 2),
      groupedRow("song-e", "easy", "e", 2.6),
      groupedRow("song-m", "medium", "m", 3.4),
      groupedRow("song-a", "advanced", "a", 4.6),
    ];
    const physicalGroup = { representative: levels[2], levels, totalPlays: 6, lastCreatedAt: levels[0]!.createdAt };
    listSongsGroupedWithTotal.mockReturnValueOnce({
      songs: [physicalGroup],
      total: 1,
    });
    projectPublicGroupedSongs.mockReturnValueOnce([{
      representative: levels[3],
      levels: [levels[0], levels[1], levels[3], levels[4], levels[5]],
      totalPlays: 5,
      lastCreatedAt: levels[0]!.createdAt,
    }]);

    const response = await GET(requestFor("group=1"));

    expect(projectPublicGroupedSongs).toHaveBeenCalledWith([physicalGroup]);

    await expect(response.json()).resolves.toEqual({
      songs: [{
        representative: { id: "song-e", title: "Test Song", artist: "Test Artist", key: "C", tempo: 120 },
        levels: [
          { id: "song-vb", difficulty: "very-beginner" },
          { id: "song-b", difficulty: "beginner" },
          { id: "song-e", difficulty: "easy" },
          { id: "song-m", difficulty: "medium" },
          { id: "song-a", difficulty: "advanced" },
        ],
        totalPlays: 5,
      }],
      total: 1,
    });
  });

  it("keeps all six physical levels for an explicit legacy grouped read", async () => {
    const levels = [
      groupedRow("song-vb", "very-beginner", "vb", 1),
      groupedRow("song-b", "beginner", "b", 1.4),
      groupedRow("song-ve", "very-easy", "ve", 2),
      groupedRow("song-e", "easy", "e", 2.6),
      groupedRow("song-m", "medium", "m", 3.4),
      groupedRow("song-a", "advanced", "a", 4.6),
    ];
    listSongsGroupedWithTotal.mockReturnValueOnce({
      songs: [{ representative: levels[2], levels, totalPlays: 6, lastCreatedAt: levels[0]!.createdAt }],
      total: 1,
    });

    const response = await GET(requestFor("group=1&legacy=1"));

    expect(projectPublicGroupedSongs).not.toHaveBeenCalled();

    await expect(response.json()).resolves.toEqual({
      songs: [{
        representative: { id: "song-ve", title: "Test Song", artist: "Test Artist", key: "C", tempo: 120 },
        levels: [
          { id: "song-vb", difficulty: "very-beginner" },
          { id: "song-b", difficulty: "beginner" },
          { id: "song-ve", difficulty: "very-easy" },
          { id: "song-e", difficulty: "easy" },
          { id: "song-m", difficulty: "medium" },
          { id: "song-a", difficulty: "advanced" },
        ],
        totalPlays: 6,
      }],
      total: 1,
    });
  });

  it("treats an explicit very-easy filter as a physical legacy read", async () => {
    const levels = [
      groupedRow("song-vb", "very-beginner", "vb", 1),
      groupedRow("song-b", "beginner", "b", 1.4),
      groupedRow("song-ve", "very-easy", "ve", 2),
      groupedRow("song-e", "easy", "e", 2.6),
      groupedRow("song-m", "medium", "m", 3.4),
      groupedRow("song-a", "advanced", "a", 4.6),
    ];
    listSongsGroupedWithTotal.mockReturnValueOnce({
      songs: [{ representative: levels[2], levels, totalPlays: 6, lastCreatedAt: levels[0]!.createdAt }],
      total: 1,
    });

    const response = await GET(requestFor("group=1&difficulty=very-easy"));
    const body = await response.json();

    expect(projectPublicGroupedSongs).not.toHaveBeenCalled();
    expect(body.songs[0].levels).toContainEqual({ id: "song-ve", difficulty: "very-easy" });
    expect(body.songs[0].levels).toHaveLength(6);
  });
});
