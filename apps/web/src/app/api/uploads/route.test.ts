import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestSource = vi.hoisted(() => vi.fn());
const getUploadPublicationReceipt = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ ingestSource, getUploadPublicationReceipt }));

import { POST } from "./route";

describe("upload route", () => {
  beforeEach(() => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    ingestSource.mockReset();
    getUploadPublicationReceipt.mockReset().mockImplementation(async (baseId: string, sourceHash: string) => {
      const input = ingestSource.mock.calls.at(-1)?.[0] as { title?: string; artist?: string } | undefined;
      let result: { error?: string } | undefined;
      try { result = await Promise.resolve(ingestSource.mock.results.at(-1)?.value); } catch { return null; }
      if (!result || result.error) return null;
      const songIds = ["vb", "b", "ve", "e", "m", "a"].map((level) => `${baseId}-${level}`);
      return { baseId, sourceHash, publicationRevision: "revision-1", songIds, easySongId: `${baseId}-e`, title: input?.title ?? "Untitled Upload", artist: input?.artist ?? "Unknown" };
    });
  });

  it("returns the committed receipt on a replay even when submitted metadata changed", async () => {
    const sourceHash = createHash("sha256").update(new Uint8Array([4, 5, 6])).digest("hex");
    const receipt = {
      baseId: `upload-${sourceHash}`,
      sourceHash,
      publicationRevision: "revision-1",
      songIds: [`upload-${sourceHash}-vb`, `upload-${sourceHash}-b`, `upload-${sourceHash}-ve`, `upload-${sourceHash}-e`, `upload-${sourceHash}-m`, `upload-${sourceHash}-a`],
      easySongId: `upload-${sourceHash}-e`,
      title: "Saved title",
      artist: "Saved artist",
    };
    getUploadPublicationReceipt.mockResolvedValueOnce(receipt);

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads?title=Changed&artist=Different", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([4, 5, 6]),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...receipt, reused: true });
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("rejects replacement when the submitted publication revision is stale", async () => {
    const sourceHash = createHash("sha256").update(new Uint8Array([7, 8, 9])).digest("hex");
    getUploadPublicationReceipt.mockResolvedValueOnce({
      baseId: `upload-${sourceHash}`, sourceHash, publicationRevision: "current-revision",
      songIds: [], easySongId: `upload-${sourceHash}-e`, title: "Saved", artist: "Artist",
    });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads?mode=replace&expectedRevision=old-revision", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([7, 8, 9]),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "UPLOAD_REVISION_STALE", receipt: { publicationRevision: "current-revision" } });
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("passes the accepted revision only for an explicit replacement", async () => {
    const sourceHash = createHash("sha256").update(new Uint8Array([2, 4, 6])).digest("hex");
    getUploadPublicationReceipt.mockResolvedValueOnce({
      baseId: `upload-${sourceHash}`, sourceHash, publicationRevision: "revision-before",
      songIds: [], easySongId: `upload-${sourceHash}-e`, title: "Saved", artist: "Artist",
    });
    ingestSource.mockResolvedValueOnce({ baseId: `upload-${sourceHash}`, songIds: [] });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads?mode=replace&expectedRevision=revision-before&title=New+title", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([2, 4, 6]),
    }));

    expect(response.status).toBe(200);
    expect(ingestSource).toHaveBeenCalledWith(expect.objectContaining({ title: "New title" }), {
      uploadReplay: { mode: "replace", expectedRevision: "revision-before" },
    });
  });

  it("returns unsupported musical input as an actionable 422", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "", songIds: [], error: "parse failed: unsupported MIDI format 2" });
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: new Uint8Array([1, 2, 3]),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "parse failed: unsupported MIDI format 2" });
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
    }), { uploadReplay: { mode: "reuse" } });
    await expect(response.json()).resolves.toEqual({
      baseId: `upload-${sourceHash}`,
      sourceHash,
      publicationRevision: "revision-1",
      songIds: ["vb", "b", "ve", "e", "m", "a"].map((level) => `upload-${sourceHash}-${level}`),
      easySongId: `upload-${sourceHash}-e`,
      title: "Upload",
      artist: "Artist",
      reused: false,
    });
  });

  it("accepts the existing bearer contract from the authenticated edge transport header", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });

    const response = await POST(new NextRequest("https://keys.reidar.tech/api/uploads", {
      method: "POST",
      headers: { "x-keyspilli-api-token": "Bearer test-token" },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
    expect(ingestSource).toHaveBeenCalledOnce();
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

  it("accepts a browser upload through the production reverse-proxy header contract", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });

    const response = await POST(new NextRequest("http://internal-web:3000/api/uploads", {
      method: "POST",
      headers: {
        host: "keys.reidar.tech",
        origin: "https://keys.reidar.tech",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "keys.reidar.tech",
        "x-forwarded-proto": "https",
      },
      body: new Uint8Array([1, 2, 3]),
    }));

    expect(response.status).toBe(200);
    expect(ingestSource).toHaveBeenCalledOnce();
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
    const response = await POST(new NextRequest("http://internal-web:3000/api/uploads", {
      method: "POST",
      headers: {
        host: "keys.reidar.tech",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": "keys.reidar.tech",
        "x-forwarded-proto": "https",
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

    const first = await POST(request());
    const retry = await POST(request());

    expect(ingestSource).toHaveBeenCalledOnce();
    expect(ingestSource.mock.calls[0]?.[0].baseId).toBe(`upload-${createHash("sha256").update(new Uint8Array([4, 5, 6])).digest("hex")}`);
    expect(first.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ reused: true, publicationRevision: "revision-1" });
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

describe("upload admission and deadline", () => {
  beforeEach(() => { process.env.KEYSPILLI_API_TOKEN = "test-token"; ingestSource.mockReset(); });
  const request = (body: BodyInit = new Uint8Array([1, 2, 3])) => new NextRequest("https://keys.reidar.tech/api/uploads", {
    method: "POST", headers: { authorization: "Bearer test-token" }, body,
  });
  it("holds admission through ingestion and releases it after failure", async () => {
    let reject!: (error: Error) => void;
    ingestSource.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const first = POST(request());
    const caught = first.catch(error => error);
    await vi.waitFor(() => expect(ingestSource).toHaveBeenCalledOnce());
    expect((await POST(request())).status).toBe(503);
    reject(new Error("injected"));
    expect(await caught).toBeInstanceOf(Error);
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: [] });
    expect((await POST(request())).status).toBe(200);
  });
  it("uses one total body deadline, cancels the stream, and releases admission", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    try {
      const pending = POST(request(new ReadableStream({ start(c) { controller = c; }, cancel: cancelled })));
      controller.enqueue(new Uint8Array([1]));
      await vi.advanceTimersByTimeAsync(59_000);
      controller.enqueue(new Uint8Array([2]));
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).status).toBe(408);
      expect(cancelled).toHaveBeenCalledOnce();
      expect(ingestSource).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: [] });
    expect((await POST(request())).status).toBe(200);
  });
  it("reports a durable reconciliation state instead of rejecting the source", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "upload-known", songIds: [], error: "DB failure", code: "ARTIFACT_RECONCILIATION_REQUIRED" });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ baseId: "upload-known", reconciliationRequired: true });
  });
});
