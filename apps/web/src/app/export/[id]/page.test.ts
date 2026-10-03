import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
const getSongDetail = vi.hoisted(() => vi.fn());
const getSongDetailShell = vi.hoisted(() => vi.fn());
const SimplifyScore = vi.hoisted(() => vi.fn(() => null));
const SheetMusicView = vi.hoisted(() => vi.fn(() => null));
const PublicationRevisionConflictError = vi.hoisted(() => class extends Error {});

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, getSongDetailShell, PublicationRevisionConflictError }));
vi.mock("@/components/export/SimplifyScore", () => ({ SimplifyScore }));
vi.mock("@/components/player/SheetMusicView", () => ({ SheetMusicView }));

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
    SheetMusicView.mockClear();
  });

  it("does not downgrade a classic request without MusicXML", async () => {
    getSongDetailShell.mockResolvedValueOnce({ song: detail(0).song, variants: [] });

    await expect(ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "classic" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledOnce();
    expect(getSongDetail).not.toHaveBeenCalled();
    expect(SheetMusicView).not.toHaveBeenCalled();
    expect(SimplifyScore).not.toHaveBeenCalled();
  });

  it("rejects unknown layouts instead of silently selecting simplify", async () => {
    await expect(ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "other" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getSongDetail).not.toHaveBeenCalled();
  });

  it("pins the classic sheet request to the shell publication", async () => {
    getSongDetailShell.mockResolvedValueOnce({ song: detail(1).song, variants: [], publicationRevision: "revision-a" });

    const rendered = await ExportPage({
      params: Promise.resolve({ id: "song-a" }),
      searchParams: Promise.resolve({ layout: "classic" }),
    });
    const sheet = (rendered as any).props.children.props.children.props.children[1];

    expect(sheet.type).toBe(SheetMusicView);
    expect(sheet.props.publicationRevision).toBe("revision-a");
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
