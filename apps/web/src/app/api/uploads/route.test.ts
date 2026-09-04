import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
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
    const sourceHash = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
    expect(ingestSource).toHaveBeenCalledWith(expect.objectContaining({
      baseId: `upload-${sourceHash}`,
      sourceRef: `upload:${sourceHash}`,
    }));
    await expect(response.json()).resolves.toEqual({
      baseId: "upload",
      songIds: ["upload-vb", "upload-b", "upload-ve", "upload-e", "upload-m", "upload-a"],
      easySongId: "upload-e",
    });
  });

  it("accepts a same-origin browser upload without exposing the bearer token", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {
        origin: "https://keys.reidar.tech",
        "sec-fetch-site": "same-origin",
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
  });

  it("still accepts a same-origin browser upload when no server token is configured", async () => {
    delete process.env.KEYSPILLI_API_TOKEN;
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {
        origin: "https://keys.reidar.tech",
        "sec-fetch-site": "same-origin",
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
  });

  it("rejects a cross-origin browser upload before ingest", async () => {
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(403);
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("rejects contradictory browser origin metadata", async () => {
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "same-origin",
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(403);
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("rejects same-host uploads when the origin uses another port or scheme", async () => {
    for (const origin of ["https://keys.reidar.tech:444", "http://keys.reidar.tech"]) {
      const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
        method: "POST",
        headers: { origin, "sec-fetch-site": "same-origin" },
        body: new Uint8Array([1, 2, 3]),
      }));
      expect(response.status).toBe(403);
    }
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading or ingesting it", async () => {
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-length": String(10 * 1024 * 1024 + 1),
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "file too large (max 10 MB)" });
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("keeps metadata-free requests bearer-protected", async () => {
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: {},
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(401);
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("uses the same source-derived base id when an upload is retried", async () => {
    ingestSource
      .mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] })
      .mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });
    const request = () => new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([4, 5, 6]),
    });

    await POST(request());
    await POST(request());

    expect(ingestSource.mock.calls[0]?.[0].baseId).toBe(ingestSource.mock.calls[1]?.[0].baseId);
  });

  it("logs bounded upload lifecycle events without credentials or user metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });
      const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        body: new Uint8Array([1, 2, 3]),
      }));

      expect(response.status).toBe(200);
      const events = info.mock.calls.map(([label, payload]) => ({ label, payload }));
      expect(events.map((entry) => (entry.payload as { event?: string })?.event)).toEqual([
        "start",
        "received",
        "ingest-start",
        "complete",
      ]);
      expect(JSON.stringify(events)).toContain("sourceHash");
      expect(JSON.stringify(events)).not.toContain("test-token");
      expect(JSON.stringify(events)).not.toContain("Untitled Upload");
    } finally {
      info.mockRestore();
    }
  });
});
