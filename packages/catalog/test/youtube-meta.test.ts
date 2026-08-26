import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseYoutubeMetaFile } from "../src/youtube-meta.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseYoutubeMetaFile", () => {
  it("accepts a complete sidecar and rounds the duration to whole seconds", () => {
    const dir = mkdtempSync(join(tmpdir(), "keyspilli-yt-meta-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ title: "Test Song", uploader: "Tester", durationSec: 301.9 }),
    );
    expect(parseYoutubeMetaFile(dir)).toEqual({
      title: "Test Song",
      uploader: "Tester",
      durationSec: 302,
    });
  });

  it.each([
    ["missing file", undefined],
    ["malformed json", "{not json"],
    ["empty title", JSON.stringify({ title: "", uploader: "a", durationSec: 100 })],
    ["negative duration", JSON.stringify({ title: "t", uploader: "u", durationSec: -1 })],
  ])("rejects %s", (_name, content) => {
    const dir = mkdtempSync(join(tmpdir(), "keyspilli-yt-meta-"));
    dirs.push(dir);
    if (content !== undefined) writeFileSync(join(dir, "meta.json"), content);
    expect(parseYoutubeMetaFile(dir)).toBeUndefined();
  });
});
