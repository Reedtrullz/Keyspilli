import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSongs = vi.hoisted(() => vi.fn());
const listSongsGroupedWithTotal = vi.hoisted(() => vi.fn());
const countSongs = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ listSongs, listSongsGroupedWithTotal, countSongs }));

import { GET } from "./route";

const requestFor = (query: string) => new NextRequest(`http://127.0.0.1/api/songs?${query}`);

describe("grouped songs route", () => {
  beforeEach(() => {
    listSongs.mockReset();
    listSongsGroupedWithTotal.mockReset();
    countSongs.mockReset();
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
});
