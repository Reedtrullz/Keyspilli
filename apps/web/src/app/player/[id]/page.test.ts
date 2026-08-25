import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
const underlyingDetail = vi.hoisted(() => vi.fn());
const detailCache = vi.hoisted(() => new Map<string, unknown>());
const getSongDetail = vi.hoisted(() => vi.fn((id: string) => {
  if (!detailCache.has(id)) detailCache.set(id, underlyingDetail(id));
  return detailCache.get(id);
}));
const Player = vi.hoisted(() => vi.fn(() => null));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/catalog-api", () => ({ getSongDetail }));
vi.mock("@/components/player/Player", () => ({ Player }));

import PlayerPage, { generateMetadata } from "./page";

const detail = {
  song: { id: "song-a", title: "Song", artist: "Artist", difficulty: "standard" },
  data: { key: "C", tempoBpm: 120, notes: [], chords: [], measures: [] },
  variants: [],
  artifact: { status: "legacy", errors: [] },
};

describe("player metadata/page detail loading", () => {
  beforeEach(() => {
    notFound.mockClear();
    underlyingDetail.mockReset();
    getSongDetail.mockClear();
    detailCache.clear();
    Player.mockClear();
  });

  it("shares one request-scoped detail result between metadata and page", async () => {
    underlyingDetail.mockResolvedValue(detail);

    await expect(generateMetadata({ params: Promise.resolve({ id: "song-a" }) }))
      .resolves.toEqual({ title: "Song by Artist (standard)" });
    const rendered = await PlayerPage({ params: Promise.resolve({ id: "song-a" }) });

    expect(getSongDetail).toHaveBeenCalledTimes(2);
    expect(underlyingDetail).toHaveBeenCalledOnce();
    expect((rendered as { type: unknown }).type).toBe(Player);
  });
});
