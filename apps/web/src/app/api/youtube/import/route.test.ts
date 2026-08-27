import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canonicalYoutubeUrl = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const getJob = vi.hoisted(() => vi.fn());
const insertJob = vi.hoisted(() => vi.fn());
const dbGet = vi.hoisted(() => vi.fn());
const dbPrepare = vi.hoisted(() => vi.fn(() => ({ get: dbGet })));

vi.mock("@keyspilli/catalog", () => ({ canonicalYoutubeUrl, getDb, getJob, insertJob }));

import { POST } from "./route";

const videoUrl = "https://www.youtube.com/watch?v=9TjXanLjpTU";
const canonicalUrl = videoUrl;

function requestFor(body: unknown, ip: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://keys.reidar.tech/api/youtube/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "keys.reidar.tech",
      origin: "https://keys.reidar.tech",
      "x-real-ip": ip,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("public YouTube import route", () => {
  beforeEach(() => {
    process.env.KEYSPILLI_API_TOKEN = "test-token-for-public-route-which-is-long-enough";
    canonicalYoutubeUrl.mockReset();
    canonicalYoutubeUrl.mockReturnValue(canonicalUrl);
    getJob.mockReset();
    getJob.mockReturnValue(undefined);
    insertJob.mockReset();
    dbGet.mockReset();
    dbGet.mockReturnValueOnce({ count: 0 }).mockReturnValueOnce(undefined);
    dbPrepare.mockClear();
    getDb.mockReset();
    getDb.mockReturnValue({ prepare: dbPrepare });
  });

  it("queues a URL-only import without a browser bearer token", async () => {
    const response = await POST(requestFor({ url: videoUrl }, "203.0.113.10"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ jobId: expect.stringMatching(/^job-/) });
    expect(insertJob).toHaveBeenCalledWith(expect.objectContaining({
      youtubeUrl: canonicalUrl,
      status: "queued",
      songId: null,
    }));
  });

  it("rejects metadata and unknown fields instead of widening the public surface", async () => {
    const response = await POST(requestFor({ url: videoUrl, songId: "existing-song" }, "203.0.113.11"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "public import accepts only url; use the protected maintainer route for overrides",
    });
    expect(insertJob).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser requests", async () => {
    const response = await POST(requestFor({ url: videoUrl }, "203.0.113.12", {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "cross-origin request rejected" });
    expect(insertJob).not.toHaveBeenCalled();
  });

  it("limits one active public job per source IP", async () => {
    await POST(requestFor({ url: videoUrl }, "203.0.113.13"));
    getJob.mockReturnValue({ status: "queued" });

    const response = await POST(requestFor({ url: "https://youtu.be/Um5R_PH7Jek" }, "203.0.113.13"));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "an import from this browser is already running" });
    expect(insertJob).toHaveBeenCalledTimes(1);
  });

  it("rejects when the shared worker queue is at capacity", async () => {
    dbGet.mockReset();
    dbGet.mockReturnValueOnce({ count: 2 });

    const response = await POST(requestFor({ url: videoUrl }, "203.0.113.14"));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: "the importer is busy; try again when the current jobs finish" });
    expect(insertJob).not.toHaveBeenCalled();
  });
});
