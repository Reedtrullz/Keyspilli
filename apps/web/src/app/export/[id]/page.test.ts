import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
const getSongDetail = vi.hoisted(() => vi.fn());
const getSongDetailShell = vi.hoisted(() => vi.fn());
const SimplifyScore = vi.hoisted(() => vi.fn(() => null));
const ClassicScore = vi.hoisted(() => vi.fn(() => null));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, getSongDetailShell }));
vi.mock("@/components/export/SimplifyScore", () => ({ SimplifyScore }));
vi.mock("@/components/export/ClassicScore", () => ({ ClassicScore }));

import ExportPage from "./page";

const detail = (hasSheetXml: number) => ({
  song: { id: "song-a", title: "Song", artist: "Artist", hasSheetXml },
  data: { key: "C", tempoBpm: 120, notes: [], chords: [], measures: [] },
  variants: [],
  artifact: { status: "valid", errors: [] },
});

describe("export page layout contract", () => {
  beforeEach(() => {
    notFound.mockClear();
    getSongDetail.mockReset();
    getSongDetailShell.mockReset();
    SimplifyScore.mockClear();
    ClassicScore.mockClear();
  });

  it("does not downgrade a classic request without MusicXML", async () => {
    getSongDetailShell.mockResolvedValueOnce({ song: detail(0).song, variants: [] });

    await expect(ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "classic" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(getSongDetail).not.toHaveBeenCalled();
    expect(ClassicScore).not.toHaveBeenCalled();
    expect(SimplifyScore).not.toHaveBeenCalled();
  });

  it("rejects unknown layouts instead of silently selecting simplify", async () => {
    await expect(ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "other" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getSongDetail).not.toHaveBeenCalled();
  });

  it("uses ClassicScore only when MusicXML is available", async () => {
    getSongDetailShell.mockResolvedValueOnce({ song: detail(1).song, variants: [] });

    const rendered = await ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "classic" }),
    });
    const score = (rendered as any).props.children.props.children;

    expect(score.type).toBe(ClassicScore);
    expect(getSongDetail).not.toHaveBeenCalled();
  });

  it("keeps simplified layout available without MusicXML", async () => {
    getSongDetail.mockResolvedValueOnce(detail(0));

    const rendered = await ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "simplify" }),
    });
    const score = (rendered as any).props.children.props.children;

    expect(score.type).toBe(SimplifyScore);
  });
});
