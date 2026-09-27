import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as youtubePost } from "./youtube/route";
import { PATCH as songPatch } from "./songs/[id]/route";

afterEach(() => vi.unstubAllEnvs());

it.each(["null", "[]", "true", "\"text\"", "{"])('rejects non-object JSON %s after authentication', async (body) => {
  vi.stubEnv("KEYSPILLI_API_TOKEN", "body-test-token");
  const headers = { authorization: "Bearer body-test-token", "content-type": "application/json" };
  const youtube = new NextRequest("http://localhost/api/youtube", { method: "POST", headers, body });
  const song = new Request("http://localhost/api/songs/song-e", { method: "PATCH", headers, body });
  expect((await youtubePost(youtube)).status).toBe(400);
  expect((await songPatch(song, { params: Promise.resolve({ id: "song-e" }) })).status).toBe(400);
});

it("keeps authentication before JSON parsing", async () => {
  vi.stubEnv("KEYSPILLI_API_TOKEN", "body-test-token");
  const youtube = new NextRequest("http://localhost/api/youtube", { method: "POST", body: "null" });
  const song = new Request("http://localhost/api/songs/song-e", { method: "PATCH", body: "null" });
  expect((await youtubePost(youtube)).status).toBe(401);
  expect((await songPatch(song, { params: Promise.resolve({ id: "song-e" }) })).status).toBe(401);
});
