import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn());
const getSongDetail = vi.hoisted(() => vi.fn());

vi.mock("playwright", () => ({ chromium: { launch } }));
vi.mock("@/lib/catalog-api", () => ({ getArtifactFile: vi.fn(), getSongDetail }));

import { GET } from "./route";

const requestFor = (query: string) => new NextRequest(`http://127.0.0.1/api/song/song-a/export?${query}`);
const params = Promise.resolve({ id: "song-a" });

describe("song export route PDF failures", () => {
  beforeEach(() => {
    launch.mockReset();
    getSongDetail.mockReset();
  });

  it("rejects unknown layouts before starting Chromium", async () => {
    const response = await GET(requestFor("type=pdf&layout=unknown"), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "unknown PDF layout" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("returns a stable safe error when Chromium cannot launch", async () => {
    launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /root/.cache/ms-playwright/chromium"));

    const response = await GET(requestFor("type=pdf&layout=simplify"), { params });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "PDF generation is unavailable",
      code: "PDF_GENERATION_UNAVAILABLE",
    });
    expect(JSON.stringify(body)).not.toContain("/root/.cache");
  });

  it("rejects classic PDF when the song has no MusicXML score", async () => {
    getSongDetail.mockResolvedValueOnce({
      song: { hasSheetXml: 0 },
      data: { notes: [], chords: [], measures: [], key: "C", tempoBpm: 120, timeSig: [4, 4] },
      variants: [],
      artifact: { status: "unavailable", errors: [] },
    });

    const response = await GET(requestFor("type=pdf&layout=classic"), { params });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "classic PDF unavailable",
      code: "CLASSIC_PDF_UNAVAILABLE",
    });
    expect(launch).not.toHaveBeenCalled();
  });
});
