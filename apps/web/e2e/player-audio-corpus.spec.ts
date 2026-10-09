import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { capturePlayerClip, savePlayerCapture } from "./player-audio-capture";

const repoRoot = resolve(__dirname, "../../..");
const run = resolve(process.env.KEYSPILLI_PLAYER_CORPUS_RUN ?? join(repoRoot, "output/song-prep/player-qualification-20261003"));

test("capture the frozen sampled Player corpus", async ({ page }) => {
  test.skip(process.env.KEYSPILLI_PLAYER_CORPUS_ENABLE !== "1", "opt in with playwright.player-corpus.config.ts and its generated fixtures");
  test.setTimeout(20 * 60 * 1000);
  const plan = JSON.parse(readFileSync(join(run, "model-facing/cases.plan.json"), "utf8")) as {
    captures: Record<string, { clipId: string; songId: string; mode: "original" | "chords"; durationMs: number; expectedAttackSeconds: number[];
      renderedEventAudit?: Record<string, unknown>;
      expectedAttackSecondsByBus?: { voice: number[]; backing: number[] } }>;
  };
  const bundle = JSON.parse(readFileSync(join(run, "capture-fixtures/bundle.json"), "utf8")) as { provenance: Record<string, unknown> };
  const resultsDir = join(run, "capture-receipts");
  const mediaDir = join(run, "model-facing/media");
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });
  const limit = Number(process.env.KEYSPILLI_PLAYER_CORPUS_LIMIT ?? 0);
  const start = Math.max(0, Number(process.env.KEYSPILLI_PLAYER_CORPUS_START ?? 1) - 1);
  const selected = Object.entries(plan.captures).slice(start, limit > 0 ? start + limit : undefined);
  for (const [label, capturePlan] of selected) {
    const capture = await capturePlayerClip(page, capturePlan);
    expect(capture.wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(capture.wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(capture.durationSeconds).toBeLessThan(30);
    expect(capture.wav.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(capture.sampleAssets.length).toBeGreaterThan(0);
    const asset = `${capture.sha256}.wav`;
    const wavPath = join(mediaDir, asset);
    try { savePlayerCapture(wavPath, capture); }
    catch (error) {
      const existing = readFileSync(wavPath);
      if (createHash("sha256").update(existing).digest("hex") !== capture.sha256) throw error;
    }
    const receipt = {
      schemaVersion: 1, clipId: capturePlan.clipId, label, mode: capturePlan.mode,
      audio: { path: `media/${asset}`, sha256: capture.sha256, bytes: capture.wav.length,
        durationSeconds: capture.durationSeconds, sampleRate: capture.sampleRate,
        channels: 1, encoding: "PCM16 little-endian", rms: capture.rms, peak: capture.peak },
      player: { sampler: "smplr SplendidGrandPiano", oscillatorFallbackStarts: 0,
        sourceCommit: bundle.provenance.playerSourceCommit,
        mainSampleFixCommit: bundle.provenance.mainSampleFixCommit,
        sourceFilePins: bundle.provenance.playerSourceFiles,
        samplerBufferSourceStarts: capture.samplerStarts, sampleAssets: capture.sampleAssets,
        expectedAttackSeconds: capturePlan.expectedAttackSeconds,
        expectedAttackSecondsByBus: capturePlan.expectedAttackSecondsByBus,
        renderedEventAudit: capturePlan.renderedEventAudit,
        sourceClockOffsetSeconds: capture.sourceClockOffsetSeconds,
        sourceClockOffsetsSeconds: capture.sourceClockOffsetsSeconds,
        bufferSourcesWithin25msCountedAsVelocityLayers: true,
        settings: { soundSource: "sampled", speed: 1, transpose: 0, voiceGain: 1, pianoGain: 0.4,
          sustainPedal: true, metronome: false,
          compressor: { thresholdDb: -24, kneeDb: 12, ratio: 3, attackSeconds: 0.005, releaseSeconds: 0.15 } },
        clockBasis: "AudioBufferSourceNode.start scheduled time minus capture AudioContext.currentTime at recorder start" },
    };
    writeFileSync(join(resultsDir, `${capturePlan.clipId}.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "w" });
  }
});
