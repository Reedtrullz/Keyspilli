import { expect, it, vi } from "vitest";
import { readJsonObject } from "./bounded-body";

it("bounds actual UTF-8 bytes, rejects invalid lengths/shapes, and cancels stalled reads", async () => {
  const request = (body: BodyInit, headers: HeadersInit = {}) => new Request("http://localhost", { method: "POST", body, headers, duplex: "half" } as RequestInit);
  expect((await readJsonObject(request('{"url":"ok"}'))).body).toEqual({ url: "ok" });
  for (const body of ["null", "[]", "true", "{"]) expect((await readJsonObject(request(body))).response?.status).toBe(400);
  expect((await readJsonObject(request("{}", { "content-length": "Infinity" }))).response?.status).toBe(400);
  expect((await readJsonObject(request("{}", { "content-length": "20000" }))).response?.status).toBe(413);
  expect((await readJsonObject(request(JSON.stringify({ value: "ø".repeat(9000) })))).response?.status).toBe(413);
  const cancelled = vi.fn();
  const stalled = request(new ReadableStream({ cancel: cancelled }));
  vi.useFakeTimers();
  try {
    const result = readJsonObject(stalled);
    await vi.advanceTimersByTimeAsync(5001);
    expect((await result).response?.status).toBe(408);
    expect(cancelled).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
  const controller = new AbortController();
  const aborted = new Request("http://localhost", { method: "POST", body: new ReadableStream(), signal: controller.signal, duplex: "half" } as RequestInit);
  controller.abort();
  expect((await readJsonObject(aborted)).response?.status).toBe(408);
});
