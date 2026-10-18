import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkPlayerCapture, type RawPlayerCapture } from "../../e2e/player-audio-capture";

it("retains rejected empty-start PCM and diagnostics without converting the failure into a pass", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keyspilli-capture-failure-"));
  const capture: RawPlayerCapture = { wav: Buffer.from([0, 0, 0, 0]), sampleRate: 44100,
    firstSampleContextSeconds: 1, rms: 0, peak: 0, samplerStarts: [], oscillatorStarts: 0 };
  try {
    await expect(checkPlayerCapture(capture, undefined, result => {
      writeFileSync(join(directory, "raw.pcm"), result.wav, { flag: "wx" });
      writeFileSync(join(directory, "result.json"), JSON.stringify({ rms: result.rms, starts: result.samplerStarts }), { flag: "wx" });
    })).rejects.toThrow("No sampled buffer starts were observed");
    expect(readFileSync(join(directory, "raw.pcm"))).toEqual(capture.wav);
    expect(JSON.parse(readFileSync(join(directory, "result.json"), "utf8"))).toEqual({ rms: 0, starts: [] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
