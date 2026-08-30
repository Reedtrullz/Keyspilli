import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import type { MidiAudioRenderer, MidiRenderResult } from "../src/midi-renderer.js";
import {
  parseLocalReferenceListeningArgs,
  runLocalReferenceListeningCli,
} from "../scripts/build-local-reference-listening.js";

const temporaryDirectories: string[] = [];

function wav(): Uint8Array {
  const data = new Uint8Array(8);
  const view = new DataView(data.buffer);
  view.setInt16(0, 0, true);
  view.setInt16(2, 10_000, true);
  view.setInt16(4, -10_000, true);
  view.setInt16(6, 0, true);
  const header = new ArrayBuffer(44);
  const h = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => h.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); h.setUint32(4, 36 + data.length, true); text(8, "WAVE"); text(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, 8_000, true);
  h.setUint32(28, 16_000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); text(36, "data"); h.setUint32(40, data.length, true);
  return new Uint8Array([...new Uint8Array(header), ...data]);
}

function fakeRenderer(): MidiAudioRenderer {
  return {
    id: "fluidsynth",
    version: "pcm16-v1",
    async render(input): Promise<MidiRenderResult> {
      const midi = new Uint8Array(await readFile(input.midiPath));
      const parsed = parseMidi(midi);
      const output = wav();
      await writeFile(input.outputPath, output);
      const expectedSeconds = parsed.durationBeats * 60 / parsed.tempoBpm;
      return {
        renderer: { id: "fluidsynth", version: "pcm16-v1", executable: "/Users/reidar/bin/fluidsynth", sampleRate: 8_000, gain: 1, targetPeak: 0.95 },
        midi: { path: input.midiPath, sha256: createHash("sha256").update(midi).digest("hex"), tempoBpm: parsed.tempoBpm, durationBeats: parsed.durationBeats, expectedSeconds },
        soundfont: { path: "/private/tmp/piano.sf2", bytes: 2, sha256: "b".repeat(64) },
        wav: { path: input.outputPath, bytes: output.length, sampleRate: 8_000, channels: 1, bitsPerSample: 16, frameCount: 4, sampleCount: 4, durationSeconds: 0.0005, peak: 0.3, rms: 0.2, silenceRatio: 0.25, clippingCount: 0, sha256: createHash("sha256").update(output).digest("hex") },
        duration: { expectedSeconds, renderedSeconds: 0.0005, deltaSeconds: expectedSeconds - 0.0005, toleranceSeconds: 2, status: "warning" },
      };
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("build-local-reference-listening CLI", () => {
  it("parses explicit local inputs and renderer settings", () => {
    expect(parseLocalReferenceListeningArgs([
      "--reference-midi", "/Users/reidar/Downloads/reference.mid",
      "--out=/private/tmp/listening",
      "--id", "defence-of-moscow",
      "--title", "Defence Of Moscow",
      "--review-queue", "/private/tmp/review.json",
      "--soundfont", "/Users/reidar/SoundFonts/piano.sf2",
      "--sample-rate", "48000",
      "--gain", "0.8",
      "--target-peak", "0.9",
      "--excerpt-seconds", "12",
      "--timeout-ms", "30000",
    ])).toMatchObject({
      referenceMidi: "/Users/reidar/Downloads/reference.mid",
      out: "/private/tmp/listening",
      id: "defence-of-moscow",
      title: "Defence Of Moscow",
      reviewQueue: "/private/tmp/review.json",
      soundfont: "/Users/reidar/SoundFonts/piano.sf2",
      sampleRate: 48_000,
      gain: 0.8,
      targetPeak: 0.9,
      excerptSeconds: 12,
      timeoutMs: 30_000,
    });
  });

  it("runs an injected local renderer and emits a path-free report", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-cli-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-cli-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "source.mid");
    await writeFile(sourcePath, writeMidi([
      { midi: 72, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 70, hand: "L" },
    ], { tempoBpm: 120, tracks: [
      { name: "Reference right hand", notes: [{ midi: 72, start: 0, dur: 1, vel: 100, hand: "R" }] },
      { name: "Reference left hand", notes: [{ midi: 48, start: 0, dur: 1, vel: 70, hand: "L" }] },
    ] }));
    let stdout = "";
    let stderr = "";
    const code = await runLocalReferenceListeningCli([
      "--reference-midi", sourcePath, "--out", outputRoot, "--id", "cli-reference",
    ], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } }, { renderer: fakeRenderer() });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain(sourceRoot);
    expect(stdout).not.toContain("/Users/reidar");
    expect(JSON.parse(stdout)).toMatchObject({ status: "RENDERED", scoreId: "cli-reference" });
    await expect(stat(join(outputRoot, "scores", "cli-reference", "listening", "reference.mid"))).resolves.toBeTruthy();
  });

  it("returns an unavailable report when the default renderer has no SoundFont", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-cli-unavailable-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-cli-unavailable-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "source.mid");
    await writeFile(sourcePath, writeMidi([{ midi: 72, start: 0, dur: 1, vel: 100 }], { tempoBpm: 120 }));
    let stdout = "";
    let stderr = "";
    const code = await runLocalReferenceListeningCli([
      "--reference-midi", sourcePath, "--out", outputRoot, "--id", "unavailable-reference",
    ], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ status: "UNAVAILABLE", renderer: null });
  });

  it("fails closed for invalid arguments without echoing local paths", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-cli-invalid-"));
    temporaryDirectories.push(sourceRoot);
    let stderr = "";
    const code = await runLocalReferenceListeningCli([
      "--reference-midi", join(sourceRoot, "missing.mid"), "--out", join(sourceRoot, "out"),
    ], { stdout: () => undefined, stderr: (value) => { stderr += value; } });
    expect(code).toBe(2);
    expect(stderr).toMatch(/unavailable|exist|resolve/i);
    expect(stderr).not.toContain(sourceRoot);
  });
});
