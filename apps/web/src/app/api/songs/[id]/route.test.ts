import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSongDetail = vi.hoisted(() => vi.fn());
const PublicationRevisionConflictError = vi.hoisted(() => class extends Error {
  constructor() { super("publication changed; reload and retry"); }
});
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, PublicationRevisionConflictError }));

import { GET } from "./route";

const params = Promise.resolve({ id: "song-a" });

describe("song detail publication revision", () => {
  beforeEach(() => getSongDetail.mockReset());

  it("returns the detail revision and forwards a required revision", async () => {
    getSongDetail.mockResolvedValueOnce({ song: { id: "song-a" }, publicationRevision: "revision-a" });

    const response = await GET(new NextRequest("https://keys.reidar.tech/api/songs/song-a?revision=revision-a"), { params });

    expect(response.status).toBe(200);
    expect(getSongDetail).toHaveBeenCalledWith("song-a", "revision-a");
    await expect(response.json()).resolves.toMatchObject({ publicationRevision: "revision-a" });
  });

  it("returns a recoverable conflict for a stale revision", async () => {
    getSongDetail.mockRejectedValueOnce(new PublicationRevisionConflictError());

    const response = await GET(new NextRequest("https://keys.reidar.tech/api/songs/song-a?revision=revision-old"), { params });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PUBLICATION_REVISION_CONFLICT" });
  });

  it("leaves legacy detail explicitly unpinned", async () => {
    getSongDetail.mockResolvedValueOnce({ song: { id: "song-a" }, publicationRevision: null });

    const response = await GET(new NextRequest("https://keys.reidar.tech/api/songs/song-a"), { params });

    await expect(response.json()).resolves.toMatchObject({ publicationRevision: null });
  });

  it("maps the unpinned sentinel to a required legacy revision", async () => {
    getSongDetail.mockResolvedValueOnce({ song: { id: "song-a" }, publicationRevision: null });

    await GET(new NextRequest("https://keys.reidar.tech/api/songs/song-a?revision=unpinned"), { params });

    expect(getSongDetail).toHaveBeenCalledWith("song-a", null);
  });
});
