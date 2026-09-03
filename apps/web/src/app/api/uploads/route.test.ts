import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestSource = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ ingestSource }));

import { POST } from "./route";

describe("upload route", () => {
  beforeEach(() => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    ingestSource.mockReset();
  });

  it("returns the physical Easy id for completion links while preserving all generated ids", async () => {
    ingestSource.mockResolvedValueOnce({
      baseId: "upload",
      songIds: ["upload-vb", "upload-b", "upload-ve", "upload-e", "upload-m", "upload-a"],
    });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads?title=Upload&artist=Artist", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseId: "upload",
      songIds: ["upload-vb", "upload-b", "upload-ve", "upload-e", "upload-m", "upload-a"],
      easySongId: "upload-e",
    });
  });
});
