import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMusicReview, writeMusicReviewPack } from "./music-review.js";
it("escapes text and refuses traversal and overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-music-pack-test-"));
  try {
    const report = buildMusicReview({ clips: [] });
    report.limitations.push("<script>alert(1)</script>");
    const output = join(root, "pack");
    await writeMusicReviewPack(report, output);
    const html = await readFile(join(output, "index.html"), "utf8");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    await expect(writeMusicReviewPack(report, output)).rejects.toThrow();
    const bad = {
      ...report,
      clips: [{ id: "../x" }],
    } as unknown as typeof report;
    await expect(
      writeMusicReviewPack(bad, join(root, "bad")),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { createHash } from "node:crypto";
import { prepareQwenMusicRequest } from "./qwen-music-request.js";
it("pins actual PCM, refuses stale files and prepares audio-free context control", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-pcm-pack-test-"));
  try {
    const bytes = Buffer.alloc(44 + 16000);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24);
    bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(16000, 40);
    const path = join(root, "clip.wav");
    await writeFile(path, bytes);
    const audio = {
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      durationSeconds: 1,
      sampleRate: 8000,
      channels: 1,
      frames: 8000,
      derivativeSha256: null,
    };
    const report = buildMusicReview({
      clips: [{ id: "a", audio, eventsSha256: null, analyzerSha256: null }],
    });
    await writeMusicReviewPack(report, join(root, "pack"));
    expect(await readFile(join(root, "pack/media/a.wav"))).toEqual(bytes);
    const request = await prepareQwenMusicRequest({
      audio,
      clipId: "a",
      condition: "text-context-control",
      objective: "attacks",
      context: { caption: "untrusted" },
    });
    expect(request.providerCalls).toBe(0);
    expect(JSON.stringify(request.body)).not.toContain("input_audio");
    const blind = await prepareQwenMusicRequest({
      audio,
      clipId: "a",
      condition: "blind-audio",
      objective: "secret-task",
      context: { caption: "secret-context" },
    });
    expect(JSON.stringify(blind.body)).toContain("input_audio");
    expect(JSON.stringify(blind.body)).not.toContain("secret");
    bytes[44] = 1;
    await writeFile(path, bytes);
    await expect(
      writeMusicReviewPack(report, join(root, "stale")),
    ).rejects.toThrow("stale audio");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
