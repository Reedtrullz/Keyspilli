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
    const resolvePages: Array<(page: unknown) => void> = [];
    const latePage = { close: vi.fn().mockResolvedValue(undefined), goto: vi.fn() };
    const browser = { isConnected: () => true, close: vi.fn().mockResolvedValue(undefined), newPage: vi.fn(() => new Promise(resolve => { resolvePages.push(resolve); })) };
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
      for (const resolve of resolvePages) resolve(latePage);
      await vi.advanceTimersByTimeAsync(0);
      expect(latePage.close).toHaveBeenCalledTimes(2);
      expect(latePage.goto).not.toHaveBeenCalled();
      expect(browser.close).not.toHaveBeenCalled();
      browser.newPage.mockResolvedValueOnce({
        close: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({ ready: true, hasContent: true }),
        pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
      });
      expect((await GET(requestFor("type=pdf"), { params })).status).toBe(200);
      expect(launch).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("aborts a pending second page without closing the first export's browser", async () => {
    let finishA!: (bytes: Uint8Array) => void;
    let finishB!: (page: unknown) => void;
    const firstPage = {
      close: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ready: true, hasContent: true }),
      pdf: vi.fn(() => new Promise<Uint8Array>((resolve) => { finishA = resolve; })),
    };
    const latePage = { close: vi.fn().mockResolvedValue(undefined), goto: vi.fn() };
    const browser = {
      isConnected: () => true, close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockImplementationOnce(() => new Promise((resolve) => { finishB = resolve; })),
    };
    launch.mockResolvedValue(browser);
    const first = GET(requestFor("type=pdf"), { params });
    await vi.waitFor(() => expect(firstPage.pdf).toHaveBeenCalledOnce());
    const abortB = new AbortController();
    const second = GET(new NextRequest("http://127.0.0.1/api/song/song-a/export?type=pdf", { signal: abortB.signal }), { params });
    await vi.waitFor(() => expect(browser.newPage).toHaveBeenCalledTimes(2));
    abortB.abort();
    expect((await second).status).toBe(503);
    expect(browser.close).not.toHaveBeenCalled();
    finishA(new Uint8Array([37, 80, 68, 70]));
    expect((await first).status).toBe(200);
    finishB(latePage);
    await vi.waitFor(() => expect(latePage.close).toHaveBeenCalledOnce());
    expect(latePage.goto).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("allows another export after aborting before browser creation", async () => {
    let finishLaunch!: (browser: unknown) => void;
    launch.mockImplementationOnce(() => new Promise((resolve) => { finishLaunch = resolve; }));
    const aborted = new AbortController();
    const first = GET(new NextRequest("http://127.0.0.1/api/song/song-a/export?type=pdf", { signal: aborted.signal }), { params });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    aborted.abort();
    expect((await first).status).toBe(503);
    const page = {
      close: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ready: true, hasContent: true }),
      pdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    };
    const browser = { isConnected: () => true, close: vi.fn(), newPage: vi.fn().mockResolvedValue(page) };
    finishLaunch(browser);
    expect((await GET(requestFor("type=pdf"), { params })).status).toBe(200);
    expect(browser.close).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledOnce();
  });

  it("times out one pending page without cancelling a sibling render", async () => {
    vi.useFakeTimers();
    let finishSlow!: (page: unknown) => void;
    let finishHealthy!: (bytes: Uint8Array) => void;
    const page = {
      close: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ready: true, hasContent: true }),
      pdf: vi.fn(() => new Promise<Uint8Array>(resolve => { finishHealthy = resolve; })),
    };
    const latePage = { close: vi.fn().mockResolvedValue(undefined), goto: vi.fn() };
    const browser = {
      isConnected: () => true, close: vi.fn(),
      newPage: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishSlow = resolve; })).mockResolvedValueOnce(page),
    };
    launch.mockResolvedValue(browser);
    try {
      const slow = GET(requestFor("type=pdf"), { params });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);
      const healthy = GET(requestFor("type=pdf"), { params });
      await vi.advanceTimersByTimeAsync(0);
      expect(page.pdf).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await slow).status).toBe(503);
      expect(browser.close).not.toHaveBeenCalled();
      finishHealthy(new Uint8Array([37, 80, 68, 70]));
      expect((await healthy).status).toBe(200);
      finishSlow(latePage);
      await vi.advanceTimersByTimeAsync(0);
      expect(latePage.close).toHaveBeenCalledOnce();
      expect(browser.close).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

});
