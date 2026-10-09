import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { capturePlayerClip, savePlayerCapture } from "./player-audio-capture";
import { createHash } from "node:crypto";
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
    const pairedManifest = process.env.KEYSPILLI_MUSIC_REVIEW_PAIRED_MANIFEST === "1" && !!capture.beforeCompressor;
    const rendererModule = resolve("../../node_modules/smplr/dist/index.mjs");
    savePlayerCapture(join(root, "media", id + ".wav"), capture, pairedManifest ? {
      id, manifestPath: join(root, "capture-receipts", id + "-paired.json"),
      renderer: { moduleVersion: JSON.parse(readFileSync(resolve("../../node_modules/smplr/package.json"), "utf8")).version,
        moduleSha256: createHash("sha256").update(readFileSync(rendererModule)).digest("hex"),
        browserVersion: page.context().browser()!.version() },
    } : undefined);
    if (capture.beforeCompressor && !pairedManifest) {
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

// These are explicit recorder controls, never ordinary successful music captures.
test("silent and below-level controls retain paired evidence", async ({ page }) => {
 const bundle=JSON.parse(readFileSync(join(root,"capture-fixtures/bundle.json"),"utf8"));
 await expect(capturePlayerClip(page,{...bundle.captures["q-refusal-02"],signalControl:"unknown" as never})).rejects.toThrow("unsupported recorder control");
 for(const [id,signalControl] of [["q-refusal-00","silence"],["q-refusal-02","below-level"]] as const){
  const capture=await capturePlayerClip(page,{...bundle.captures[id],signalControl});
  expect(capture.beforeCompressor).toBeDefined();
  if(signalControl==="silence"){
   expect(capture.samplerStarts).toEqual([]);expect(capture.rms).toBe(0);expect(capture.beforeCompressor!.peak).toBe(0);
  }else{expect(capture.samplerStarts.length).toBeGreaterThan(0);expect(capture.rms).toBeGreaterThan(0);expect(capture.rms).toBeLessThan(.0002);}
 }
});
