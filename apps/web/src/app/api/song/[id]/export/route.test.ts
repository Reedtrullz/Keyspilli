import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.hoisted(() => vi.fn());
const getSongDetailShell = vi.hoisted(() => vi.fn());

vi.mock("playwright", () => ({ chromium: { launch } }));
vi.mock("@/lib/catalog-api", () => ({ getArtifactFile: vi.fn(), getSongDetailShell }));

let GET: typeof import("./route").GET;

const requestFor = (query: string) => new NextRequest(`http://127.0.0.1/api/song/song-a/export?${query}`);
const params = Promise.resolve({ id: "song-a" });

describe("song export route PDF failures", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ GET } = await import("./route"));
    launch.mockReset();
    getSongDetailShell.mockReset().mockResolvedValue({ song: { hasSheetXml: 1 }, variants: [] });
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
    getSongDetailShell.mockResolvedValueOnce({ song: { hasSheetXml: 0 }, variants: [] });

    const response = await GET(requestFor("type=pdf&layout=classic"), { params });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "classic PDF unavailable",
      code: "CLASSIC_PDF_UNAVAILABLE",
    });
    expect(launch).not.toHaveBeenCalled();
  });
  it("preflights missing simplify songs before launching a browser", async () => {
    getSongDetailShell.mockResolvedValueOnce(null);
    expect((await GET(requestFor("type=pdf"), { params })).status).toBe(404);
    expect(launch).not.toHaveBeenCalled();
  });

  it("bounds concurrent renders and closes a page created after the deadline", async () => {
    vi.useFakeTimers();
    let resolvePage!: (page: unknown) => void;
    const latePage = { close: vi.fn().mockResolvedValue(undefined), goto: vi.fn() };
    const browser = { isConnected: () => true, close: vi.fn().mockResolvedValue(undefined), newPage: vi.fn(() => new Promise(resolve => { resolvePage = resolve; })) };
    launch.mockResolvedValue(browser);
    try {
      const first = GET(requestFor("type=pdf"), { params });
      await vi.advanceTimersByTimeAsync(0);
      const second = GET(requestFor("type=pdf"), { params });
      await vi.advanceTimersByTimeAsync(0);
      expect((await GET(requestFor("type=pdf"), { params })).status).toBe(503);
      expect(browser.newPage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(90_000);
      expect((await first).status).toBe(503);
      expect((await second).status).toBe(503);
      resolvePage(latePage);
      await vi.advanceTimersByTimeAsync(0);
      expect(latePage.close).toHaveBeenCalledOnce();
      expect(latePage.goto).not.toHaveBeenCalled();
      launch.mockRejectedValueOnce(new Error("unavailable"));
      expect((await GET(requestFor("type=pdf"), { params })).status).toBe(503);
      expect(launch).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

});
