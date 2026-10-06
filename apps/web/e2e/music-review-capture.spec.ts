import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { capturePlayerClip, savePlayerCapture } from "./player-audio-capture";
const root = resolve(process.env.KEYSPILLI_MUSIC_REVIEW_RUN!);
test("capture fresh phrases through visible sampled Player and return", async ({
  page,
}) => {
  const bundle = JSON.parse(
    readFileSync(join(root, "capture-fixtures/bundle.json"), "utf8"),
  ) as { captures: Record<string, Parameters<typeof capturePlayerClip>[1]> };
  const limit = Number(process.env.KEYSPILLI_MUSIC_REVIEW_CAPTURE_LIMIT ?? 0);
  const captures = Object.entries(bundle.captures).slice(0, limit || undefined);
  for (const [id, plan] of captures) {
    const capture = await capturePlayerClip(page, plan);
    if ((plan as { capturePreCompressor?: boolean }).capturePreCompressor) {
      expect(capture.beforeCompressor).toBeDefined();
      expect(capture.beforeCompressor!.frames).toBe((capture.wav.length - 44) / 2);
      expect(capture.beforeCompressor!.firstSampleContextSeconds).toBe(capture.firstSampleContextSeconds);
    }
    expect(capture.sampleAssets.length).toBeGreaterThan(0);
    expect(capture.wav.length).toBeLessThan(2 * 1024 * 1024);
    savePlayerCapture(join(root, "media", id + ".wav"), capture);
    if (capture.beforeCompressor) {
      writeFileSync(join(root, "media", id + "-before-compressor.wav"), capture.beforeCompressor.wav, { flag: "wx" });
      writeFileSync(join(root, "media", id + "-forward-compressor.wav"), capture.beforeCompressor.forwardWav, { flag: "wx" });
    }
    writeFileSync(
      join(root, "capture-receipts", id + ".json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "keyspilli-player-capture",
          id,
          audio: {
            sha256: capture.sha256,
            durationSeconds: capture.durationSeconds,
            sampleRate: capture.sampleRate,
            channels: 1,
            frames: (capture.wav.length - 44) / 2,
            derivativeSha256: null,
          },
          capture: { ...capture, wav: undefined, beforeCompressor: capture.beforeCompressor ? { ...capture.beforeCompressor, wav: undefined, forwardWav: undefined } : undefined },
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    await page
      .getByRole("link", { name: "Return to library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
  }
});
