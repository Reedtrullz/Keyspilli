import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const insertJob = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ insertJob }));

import { POST } from "./route";

function requestFor(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://keys.reidar.tech/api/youtube/import", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("public YouTube import route", () => {
  it.each([
    ["valid URL", { url: "https://www.youtube.com/watch?v=9TjXanLjpTU" }, {}],
    ["invalid URL", { url: "not-a-url" }, {}],
    ["metadata override", { url: "https://youtu.be/9TjXanLjpTU", songId: "song" }, {}],
    ["cross-origin browser", { url: "https://youtu.be/9TjXanLjpTU" }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }],
    ["empty body", {}, {}],
  ])("fails closed for %s without creating a conversion job", async (_label, body, headers) => {
    const response = await POST(requestFor(body, headers));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Direct audio conversion is not available. Add a symbolic music file instead.",
      code: "DIRECT_AUDIO_AMT_DISABLED",
      next: "/uploads",
    });
    expect(insertJob).not.toHaveBeenCalled();
  });
});
