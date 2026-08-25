import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
const getSongDetail = vi.hoisted(() => vi.fn());
const getSongDetailShell = vi.hoisted(() => vi.fn());
const Player = vi.hoisted(() => vi.fn(() => null));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, getSongDetailShell }));
vi.mock("@/components/player/Player", () => ({ Player }));

import PlayerModePage, { generateMetadata } from "./page";

const shell = {
  song: {
    id: "song-a",
    baseId: "song-a",
    title: "Song",
    artist: "Artist",
    difficulty: "standard",
    key: "C",
    tempo: 120,
    hasSheetXml: 1,
    bassPattern: "block",
  },
  variants: [],
};

const detail = {
  ...shell,
  data: { key: "C", tempoBpm: 120, notes: [], chords: [], measures: [], timeSig: [4, 4] },
  artifact: { status: "legacy", errors: [] },
};

describe("direct sheet player payload boundary", () => {
  beforeEach(() => {
    notFound.mockClear();
    getSongDetail.mockReset();
    getSongDetailShell.mockReset();
    Player.mockClear();
  });

  it("uses metadata-only shell for sheet mode and avoids full server detail", async () => {
    getSongDetailShell.mockResolvedValueOnce(shell);

    const rendered = await PlayerModePage({ params: Promise.resolve({ id: "song-a", mode: "sheet" }) });

    expect(getSongDetailShell).toHaveBeenCalledWith("song-a");
    expect(getSongDetail).not.toHaveBeenCalled();
    expect((rendered as { type: unknown; props: unknown }).type).toBe(Player);
    expect((rendered as { props: unknown }).props).toEqual({ initial: shell, mode: "sheet" });
  });

  it("keeps full detail loading for interactive non-sheet modes", async () => {
    getSongDetail.mockResolvedValueOnce(detail);

    const rendered = await PlayerModePage({ params: Promise.resolve({ id: "song-a", mode: "beginner" }) });

    expect(getSongDetail).toHaveBeenCalledWith("song-a");
    expect((rendered as { type: unknown; props: unknown }).type).toBe(Player);
    expect((rendered as { props: unknown }).props).toEqual({ initial: detail, mode: "beginner" });
  });

  it("uses the lightweight shell for sheet metadata", async () => {
    getSongDetailShell.mockResolvedValueOnce(shell);

    await expect(generateMetadata({ params: Promise.resolve({ id: "song-a", mode: "sheet" }) }))
      .resolves.toEqual({ title: "Song by Artist (standard)" });

    expect(getSongDetailShell).toHaveBeenCalledWith("song-a");
    expect(getSongDetail).not.toHaveBeenCalled();
  });

  it("rejects an invalid mode before reading either payload", async () => {
    await expect(PlayerModePage({ params: Promise.resolve({ id: "song-a", mode: "unknown" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(getSongDetail).not.toHaveBeenCalled();
    expect(getSongDetailShell).not.toHaveBeenCalled();
  });

  it("returns not found when the metadata shell has no song", async () => {
    getSongDetailShell.mockResolvedValueOnce(null);

    await expect(PlayerModePage({ params: Promise.resolve({ id: "missing", mode: "sheet" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(getSongDetail).not.toHaveBeenCalled();
  });
});
