import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import {
  buildRotatingListeningBundle,
  type RotatingListeningSongDescriptor,
} from "../src/rotating-listening-bundle.js";
import type { RecognizabilityPreGateInput } from "../src/recognizability-pre-gate.js";
import { normalizationFromCli, parseArgs } from "../scripts/build-rotating-listening-bundle.js";
import type { MidiAudioRenderer, MidiRenderResult } from "../src/midi-renderer.js";

function wavPcm16(samples: number[], sampleRate = 8_000): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const dataView = new DataView(data.buffer);
  samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + data.length, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, data.length, true);
  return new Uint8Array([...new Uint8Array(header), ...data]);
}

function midiBytes(): Uint8Array {
  const notes: Note[] = [
    { midi: 72, start: 0, dur: 1, vel: 100, hand: "R" },
    { midi: 48, start: 0, dur: 2, vel: 70, hand: "L" },
  ];
  return writeMidi(notes, { tempoBpm: 120, tracks: [{ name: "synthetic", notes }] });
}

function song(id: string, baselineMidiPath: string, currentMidiPath: string): RotatingListeningSongDescriptor {
  return {
    id,
    artist: `${id} artist`,
    title: `${id} title`,
    baselineMidiPath,
    currentMidiPath,
    sections: [
      { id: "opening", label: "Opening", startSeconds: 0, endSeconds: 30 },
      { id: "main", label: "Main", startSeconds: 40, endSeconds: 70 },
      { id: "lead", label: "Lead", startSeconds: 80, endSeconds: 110 },
    ],
  };
}

function failedPreGate(): RecognizabilityPreGateInput {
  const event = (midi: number, start: number) => ({ midi, start, dur: 0.75, vel: 100 });
  return {
    candidateMelody: [event(72, 0), event(71, 1), event(70, 2)],
    referenceMelody: [event(60, 0), event(61, 1), event(62, 2)],
    alignment: { status: "aligned", confidence: 0.99 },
    windows: [
      { id: "intro", candidate: [0, 1], reference: [0, 1] },
      { id: "body", candidate: [1, 2], reference: [1, 2] },
      { id: "ending", candidate: [2, 3], reference: [2, 3] },
    ],
  };
}

function renderer(failing = false): MidiAudioRenderer {
  return {
    id: "fluidsynth",
    version: "pcm16-v1",
    async render(input): Promise<MidiRenderResult> {
      if (failing) throw Object.assign(new Error("renderer unavailable /private/bin/fluidsynth"), { code: "BACKEND_UNAVAILABLE" });
      const midi = new Uint8Array(await readFile(input.midiPath));
      const wav = wavPcm16([0, 12_000, -22_000, 30_000]);
      await mkdir(dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, wav);
      return {
        renderer: { id: "fluidsynth", version: "pcm16-v1", executable: "/private/bin/fluidsynth", sampleRate: 8_000, gain: 1, targetPeak: 0.95 },
        midi: { path: input.midiPath, sha256: createHash("sha256").update(midi).digest("hex"), tempoBpm: 120, durationBeats: 2, expectedSeconds: 1 },
        soundfont: { path: "/Users/reidar/private/piano.sf2", bytes: 10, sha256: "a".repeat(64) },
        wav: { path: input.outputPath, bytes: wav.byteLength, sampleRate: 8_000, channels: 1, bitsPerSample: 16, frameCount: 4, sampleCount: 4, durationSeconds: 4 / 8_000, peak: 0.9, rms: 0.4, silenceRatio: 0.25, clippingCount: 0, sha256: createHash("sha256").update(wav).digest("hex") },
        duration: { expectedSeconds: 1, renderedSeconds: 4 / 8_000, deltaSeconds: 0.9995, toleranceSeconds: 2, status: "warning" },
      };
    },
  };
}

function longRenderer(seen: string[] = [], delayMs = 0, createOutputDirectory = true): MidiAudioRenderer {
  const samples = Array.from({ length: 8_000 * 120 }, (_, index) => [0, 1_000, -2_000, 16_000][index % 4]!);
  const wav = wavPcm16(samples);
  return {
    id: "fluidsynth",
    version: "pcm16-v1",
    async render(input): Promise<MidiRenderResult> {
      seen.push(input.outputPath);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (createOutputDirectory) await mkdir(dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, wav);
      return {
        renderer: { id: "fluidsynth", version: "pcm16-v1", executable: "/private/bin/fluidsynth", sampleRate: 8_000, gain: 1, targetPeak: 0.95 },
        midi: { path: input.midiPath, sha256: "b".repeat(64), tempoBpm: 120, durationBeats: 2, expectedSeconds: 1 },
        soundfont: { path: "/Users/reidar/private/piano.sf2", bytes: 10, sha256: "a".repeat(64) },
        wav: { path: input.outputPath, bytes: wav.byteLength, sampleRate: 8_000, channels: 1, bitsPerSample: 16, frameCount: samples.length, sampleCount: samples.length, durationSeconds: 120, peak: 0.1, rms: 0.1, silenceRatio: 0, clippingCount: 0, sha256: createHash("sha256").update(wav).digest("hex") },
        duration: { expectedSeconds: 1, renderedSeconds: 120, deltaSeconds: 119, toleranceSeconds: 2, status: "fail" },
      };
    },
  };
}

describe("rotating multi-song blind listening bundle", () => {
  it("keeps CLI target-peak and normalization dB metadata in sync", () => {
    const options = parseArgs(["--songs", "/private/tmp/songs.json", "--out", "/private/tmp/listening", "--target-peak", "0.9"]);
    expect(options.targetPeak).toBe(0.9);
    expect(normalizationFromCli(options)?.targetPeakDb).toBeCloseTo(20 * Math.log10(0.9), 10);
  });

  it("is input-order invariant, seed-rotating, diverse, and bounded", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-source-"));
    const outputA = await mkdtemp(join(tmpdir(), "keyspilli-rotating-output-a-"));
    const outputB = await mkdtemp(join(tmpdir(), "keyspilli-rotating-output-b-"));
    try {
      const paths = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
        const path = join(source, `song-${index}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const songs = paths.slice(0, 3).map((path, index) => song(["alpha", "beta", "gamma"][index]!, path, path));
      const first = await buildRotatingListeningBundle({ songs, outputRoot: outputA, repositoryRoot: process.cwd(), seed: "rotation-a" }, { renderer: renderer() });
      const reordered = await buildRotatingListeningBundle({ songs: [...songs].reverse(), outputRoot: outputB, repositoryRoot: process.cwd(), seed: "rotation-a" }, { renderer: renderer() });
      expect(first.manifest).toEqual(reordered.manifest);
      expect(first.manifest.totalSeconds).toBeGreaterThanOrEqual(90);
      expect(first.manifest.totalSeconds).toBeLessThanOrEqual(150);
      expect(new Set(first.manifest.excerpts.map((excerpt) => excerpt.songId)).size).toBeGreaterThanOrEqual(2);
      expect(first.manifest.excerpts.every((excerpt) => excerpt.durationSeconds <= 30)).toBe(true);
      const rotated = await buildRotatingListeningBundle({ songs, outputRoot: outputB, repositoryRoot: process.cwd(), seed: "rotation-b" }, { renderer: renderer() });
      expect(rotated.manifest.excerpts.map((excerpt) => excerpt.id)).not.toEqual(first.manifest.excerpts.map((excerpt) => excerpt.id));
    } finally {
      await Promise.all([source, outputA, outputB].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("writes redacted manifest, separate blind map, and non-melody worksheet", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-redact-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-redact-output-"));
    try {
      const paths = await Promise.all(["a", "b"].map(async (id) => {
        const path = join(source, `${id}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const result = await buildRotatingListeningBundle({ songs: [song("a", paths[0]!, paths[0]!), song("b", paths[1]!, paths[1]!)], outputRoot: output, repositoryRoot: process.cwd(), seed: "redact", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: renderer() });
      const manifestText = await readFile(result.manifestPath, "utf8");
      const blindText = await readFile(result.blindMapPath, "utf8");
      expect(manifestText).not.toContain(source);
      expect(manifestText).not.toContain("/private/bin");
      expect(manifestText).not.toContain("/Users/reidar");
      expect(manifestText).not.toContain("baselineMidiPath");
      expect(blindText).toContain("a.mid");
      expect(blindText).toContain("b.mid");
      expect(result.worksheet).toContain("Accompaniment correctness");
      expect(result.worksheet).toContain("Recognizable? A / B / BOTH / NEITHER");
      expect(result.worksheet).toContain("Anything obviously wrong?");
      expect(result.worksheet).toContain("A / B / SAME");
      expect(result.worksheet.toLowerCase()).not.toContain("melody correctness");
      expect(JSON.stringify(result.manifest)).not.toContain("a.mid");
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("returns structured unavailable states and rejects repository-contained paths without mutating sources", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-unavailable-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-unavailable-output-"));
    try {
      const path = join(source, "source.mid");
      const bytes = midiBytes();
      await writeFile(path, bytes);
      const before = Buffer.from(await readFile(path));
      const result = await buildRotatingListeningBundle({ songs: [song("a", path, join(source, "missing.mid")), song("b", path, path)], outputRoot: output, repositoryRoot: process.cwd(), seed: "unavailable", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: undefined });
      expect(result.manifest.status).toBe("unavailable");
      expect(result.manifest.errors.some((error) => error.code === "RENDERER_UNAVAILABLE")).toBe(true);
      expect(result.manifest.excerpts.some((excerpt) => excerpt.candidates.A.status !== "rendered")).toBe(true);
      expect(Buffer.from(await readFile(path))).toEqual(before);
      await expect(stat(result.manifestPath)).resolves.toBeTruthy();
      const inside = join(process.cwd(), ".tmp-rotating-bundle-test.mid");
      await writeFile(inside, bytes);
      try {
        await expect(buildRotatingListeningBundle({ songs: [song("a", inside, inside), song("b", path, path)], outputRoot: output, repositoryRoot: process.cwd() }, { renderer: renderer() })).rejects.toThrow(/outside the repository/);
      } finally {
        await rm(inside, { force: true });
      }
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("rejects excerpts longer than the rendered WAV and downgrades bundle status", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-short-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-short-output-"));
    try {
      const paths = await Promise.all(["a", "b"].map(async (id) => {
        const path = join(source, `${id}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const result = await buildRotatingListeningBundle({ songs: [song("a", paths[0]!, paths[0]!), song("b", paths[1]!, paths[1]!)], outputRoot: output, repositoryRoot: process.cwd(), seed: "short", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: renderer() });
      expect(result.manifest.status).toBe("unavailable");
      expect(result.manifest.excerpts.some((excerpt) => excerpt.candidates.A.status === "failed" && excerpt.candidates.A.audio === null)).toBe(true);
      expect(result.manifest.errors.some((error) => error.code === "EXCERPT_DURATION_MISMATCH" && /only 0\.001s/.test(error.message))).toBe(true);
      await expect(stat(join(output, "audio"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(output)).some((entry) => entry.startsWith(".staging-"))).toBe(false);
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("derives excerpt metrics from the PCM slice and isolates concurrent staging", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-concurrent-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-concurrent-output-"));
    try {
      const paths = await Promise.all(["a", "b", "c"].map(async (id) => {
        const path = join(source, `${id}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const songs = paths.map((path, index) => song(["a", "b", "c"][index]!, path, path));
      const seen: string[] = [];
      const [first, second] = await Promise.all([
        buildRotatingListeningBundle({ songs, outputRoot: output, repositoryRoot: process.cwd(), seed: "concurrent", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: longRenderer(seen, 5) }),
        buildRotatingListeningBundle({ songs, outputRoot: output, repositoryRoot: process.cwd(), seed: "concurrent", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: longRenderer(seen, 5) }),
      ]);
      expect(new Set(seen).size).toBe(seen.length);
      expect(first.manifest).toEqual(second.manifest);
      const audio = first.manifest.excerpts[0]!.candidates.A.audio!;
      expect(audio.durationSeconds).toBe(30);
      expect(audio.peak).toBe(0.488);
      expect(audio.rms).toBeGreaterThan(0.2);
      expect(audio.rms).toBeLessThan(0.4);
      expect((await readdir(output)).some((entry) => entry.startsWith(".staging-"))).toBe(false);
      expect((await readdir(output)).some((entry) => entry === ".renders")).toBe(false);
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("creates each nested renderer output directory before invoking the renderer", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-render-path-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-render-path-output-"));
    try {
      const paths = await Promise.all(["a", "b"].map(async (id) => {
        const path = join(source, `${id}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const result = await buildRotatingListeningBundle({
        songs: [song("a", paths[0]!, paths[0]!), song("b", paths[1]!, paths[1]!)],
        outputRoot: output,
        repositoryRoot: process.cwd(),
        seed: "nested-render-path",
        targetSeconds: 90,
        minSeconds: 90,
        maxSeconds: 90,
      }, { renderer: longRenderer([], 0, false) });
      expect(result.manifest.status).toBe("ready");
      expect(result.manifest.errors).toEqual([]);
      expect(result.manifest.excerpts.every((excerpt) => excerpt.candidates.A.status === "rendered" && excerpt.candidates.B.status === "rendered")).toBe(true);
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("withholds candidates that fail the recognizability pre-gate before rendering", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-pregate-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-pregate-output-"));
    try {
      const paths = await Promise.all(["a", "b"].map(async (id) => {
        const path = join(source, `${id}.mid`);
        await writeFile(path, midiBytes());
        return path;
      }));
      const songs = [song("a", paths[0]!, paths[0]!), song("b", paths[1]!, paths[1]!)].map((entry) => ({
        ...entry,
        preGate: { baseline: failedPreGate(), current: failedPreGate() },
      }));
      const seen: string[] = [];
      const result = await buildRotatingListeningBundle({ songs, outputRoot: output, repositoryRoot: process.cwd(), seed: "pregate", targetSeconds: 90, minSeconds: 90, maxSeconds: 90 }, { renderer: longRenderer(seen) });
      expect(seen).toEqual([]);
      expect(result.manifest.status).toBe("unavailable");
      expect(result.manifest.errors.filter((error) => error.code === "RECOGNIZABILITY_PRE_GATE_FAILED")).toHaveLength(4);
      expect(result.manifest.excerpts.every((excerpt) => excerpt.candidates.A.status !== "rendered" && excerpt.candidates.B.status !== "rendered")).toBe(true);
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  it("emits an insufficient manifest when pack selection throws", async () => {
    const source = await mkdtemp(join(tmpdir(), "keyspilli-rotating-selector-source-"));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-rotating-selector-output-"));
    try {
      const path = join(source, "song.mid");
      await writeFile(path, midiBytes());
      const malformed = { ...song("bad", path, path), sections: { length: 1 } as never };
      const result = await buildRotatingListeningBundle({ songs: [malformed, song("other", path, path)], outputRoot: output, repositoryRoot: process.cwd(), seed: "selector-error" }, { renderer: renderer() });
      expect(result.manifest.status).toBe("insufficient");
      expect(result.manifest.errors).toContainEqual(expect.objectContaining({ code: "PACK_SELECTION_FAILED" }));
      expect(result.manifest.excerpts).toEqual([]);
      expect((await readdir(output)).some((entry) => entry.startsWith(".staging-"))).toBe(false);
    } finally {
      await Promise.all([source, output].map((path) => rm(path, { recursive: true, force: true })));
    }
  });
});
