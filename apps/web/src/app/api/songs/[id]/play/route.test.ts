import { afterEach, expect, it, vi } from "vitest";
const incrementPlays = vi.hoisted(() => vi.fn());
vi.mock("@keyspilli/catalog", () => ({ incrementPlays, getSong: () => ({ id: "song-e" }) }));
import { POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); incrementPlays.mockClear(); });
it("protects play counters with the private-browser/token contract before writes", async () => {
  vi.stubEnv("KEYSPILLI_API_TOKEN", "counter-test");
  const request = (headers: HeadersInit = {}) => new Request("http://localhost/api/songs/song-e/play", { method: "POST", headers });
  const context = { params: Promise.resolve({ id: "song-e" }) };
  expect((await POST(request(), context)).status).toBe(401);
  expect((await POST(request({ origin: "https://evil.test", "sec-fetch-site": "cross-site" }), context)).status).toBe(403);
  expect(incrementPlays).not.toHaveBeenCalled();
  expect((await POST(request({ authorization: "Bearer counter-test" }), context)).status).toBe(200);
  expect((await POST(request({ origin: "http://localhost", "sec-fetch-site": "same-origin" }), context)).status).toBe(200);
  expect(incrementPlays).toHaveBeenCalledTimes(2);
});
