import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSongDetail = vi.hoisted(() => vi.fn());
const applySongMetadata = vi.hoisted(() => vi.fn());
const PublicationRevisionConflictError = vi.hoisted(() => class extends Error {
  constructor() { super("publication changed; reload and retry"); }
});
vi.mock("@/lib/catalog-api", () => ({ getSongDetail, PublicationRevisionConflictError }));
vi.mock("@/lib/mutation-auth", () => ({ checkMutationAuth: () => null }));
vi.mock("@/lib/song-update", () => ({
  applySongMetadata,
  resolveBaseId: (id: string) => id,
  SongUpdateError: class SongUpdateError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { GET, PATCH } from "./route";

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

describe("song detail metadata patch", () => {
  const patchRequest = (body: unknown) =>
    new NextRequest("https://keys.reidar.tech/api/songs/song-a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => applySongMetadata.mockReset());

  it("passes owner-authored sections through to the update layer", async () => {
    applySongMetadata.mockResolvedValueOnce([{ id: "song-a", baseId: "song-base" }]);
    const sections = [{ id: "owner-1", label: "Intro", startBeat: 0, endBeat: 24 }];

    const response = await PATCH(patchRequest({ sections }), { params });

    expect(response.status).toBe(200);
    expect(applySongMetadata).toHaveBeenCalledWith("song-a", { sections }, { expectedRevision: undefined });
    await expect(response.json()).resolves.toMatchObject({ baseId: "song-base" });
  });

  it("rejects a non-array sections value before writing", async () => {
    const response = await PATCH(patchRequest({ sections: { label: "Intro" } }), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "sections must be an array or null" });
    expect(applySongMetadata).not.toHaveBeenCalled();
  });

  it("still rejects unknown metadata fields", async () => {
    const response = await PATCH(patchRequest({ unexpected: 1 }), { params });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "unsupported metadata field" });
    expect(applySongMetadata).not.toHaveBeenCalled();
  });
});
