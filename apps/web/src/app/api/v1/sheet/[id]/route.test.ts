import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getArtifactFileWithMetadata = vi.hoisted(() => vi.fn());

vi.mock("@/lib/catalog-api", () => ({ getArtifactFileWithMetadata }));

import { GET } from "./route";

const params = Promise.resolve({ id: "song-a" });
const artifact = {
  data: Buffer.from("<score-partwise version=\"4.0\" />"),
  etag: '"artifact-v1"',
  lastModified: "Tue, 25 Aug 2026 12:00:00 GMT",
};

describe("MusicXML sheet transport", () => {
  beforeEach(() => getArtifactFileWithMetadata.mockReset());

  it("returns validators and revalidation-safe cache headers", async () => {
    getArtifactFileWithMetadata.mockResolvedValueOnce(artifact);

    const response = await GET(new NextRequest("https://keys.reidar.tech/api/v1/sheet/song-a"), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.recordare.musicxml+xml");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("etag")).toBe(artifact.etag);
    expect(response.headers.get("last-modified")).toBe(artifact.lastModified);
    await expect(response.text()).resolves.toBe(artifact.data.toString("utf8"));
  });

  it("answers matching ETags with 304 and no body", async () => {
    getArtifactFileWithMetadata.mockResolvedValueOnce(artifact);

    const response = await GET(
      new NextRequest("https://keys.reidar.tech/api/v1/sheet/song-a", {
        headers: { "if-none-match": '"stale", W/"artifact-v1"' },
      }),
      { params },
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(artifact.etag);
  });

  it("answers a fresh Last-Modified validator with 304", async () => {
    getArtifactFileWithMetadata.mockResolvedValueOnce(artifact);

    const response = await GET(
      new NextRequest("https://keys.reidar.tech/api/v1/sheet/song-a", {
        headers: { "if-modified-since": artifact.lastModified },
      }),
      { params },
    );

    expect(response.status).toBe(304);
  });

  it("fails closed when the validated artifact is unavailable", async () => {
    getArtifactFileWithMetadata.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest("https://keys.reidar.tech/api/v1/sheet/missing"), { params });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not found" });
  });
});
