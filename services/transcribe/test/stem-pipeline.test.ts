import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stemPipelineConfigFromEnv,
  transcribePitchedStems,
  type StemCommandRunner,
  type StemPipelineConfig,
} from "../src/stem-pipeline.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(): StemPipelineConfig {
  return {
    mode: "auto",
    python: "/test/python",
    basicPitch: "/test/basic-pitch",
    separatorScript: "/test/separate_stems.py",
    drumOnsetScript: "/test/audio_onsets.py",
    demucsModel: "htdemucs",
    demucsDevice: "cpu",
    separatorTimeoutMs: 20_000,
    basicPitchTimeoutMs: 10_000,
    minFreeBytes: 1024,
    onsetThreshold: 0.65,
    frameThreshold: 0.45,
    modelSerialization: "onnx",
  };
}

describe("stemPipelineConfigFromEnv", () => {
  it("enables automatic stem routing by default", () => {
    const value = stemPipelineConfigFromEnv({}, {
      root: "/app",
      python: "/app/.venv/bin/python",
      basicPitch: "/app/.venv/bin/basic-pitch",
    });
    expect(value.mode).toBe("auto");
    expect(value.demucsModel).toBe("htdemucs_6s");
    expect(value.separatorTimeoutMs).toBe(2_700_000);
    expect(value.minFreeBytes).toBe(6 * 1024 ** 3);
  });

  it("rejects an unknown import mode", () => {
    expect(() => stemPipelineConfigFromEnv({ KEYSPILLI_IMPORT_MODE: "sometimes" }, {
      root: "/app",
      python: "/app/python",
      basicPitch: "/app/basic-pitch",
    })).toThrow("KEYSPILLI_IMPORT_MODE must be auto, legacy, or metal");
  });
});

describe("transcribePitchedStems", () => {
  it("separates four stems, transcribes the three pitched roles, persists only MIDI, and removes WAV scratch", async () => {
    const jobDir = await mkdtemp(join(tmpdir(), "keyspilli-stem-test-"));
    tempDirs.push(jobDir);
    const audioPath = join(jobDir, "audio.mp3");
    await writeFile(audioPath, Buffer.alloc(2048));
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: StemCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (command === "/test/python") {
        if (args[0] === "/test/audio_onsets.py") {
          return { stdout: JSON.stringify([0, 0.5, 1]), stderr: "" };
        }
        const output = args[args.indexOf("--output") + 1]!;
        await mkdir(output, { recursive: true });
        const stems: Record<string, string> = {};
        for (const role of ["vocals", "bass", "drums", "other"] as const) {
          const path = join(output, `${role}.wav`);
          await writeFile(path, Buffer.alloc(2048));
          stems[role] = path;
        }
        return { stdout: `Demucs progress\nKEYSPILLI_STEMS_JSON:${JSON.stringify({ version: "4.0.1", stems })}\n`, stderr: "" };
      }
      const output = args[0]!;
      await writeFile(join(output, `${join("", args[1]!).split("/").pop()}_basic_pitch.mid`), Buffer.from([1, 2, 3]));
      return { stdout: "", stderr: "" };
    };

    const result = await transcribePitchedStems(audioPath, jobDir, config(), { tempo: 128 }, {
      run: runner,
      freeBytes: async () => 10 * 1024 ** 3,
      basicPitchVersion: "0.4.0",
    });

    expect(result.stems.map((stem) => stem.role)).toEqual(["vocals", "bass", "guitar", "drums"]);
    expect(calls).toHaveLength(5);
    expect(calls[0]?.args).toContain("htdemucs");
    for (const call of calls.slice(1, 4)) {
      expect(call.args).toContain("--midi-tempo");
      expect(call.args).toContain("128");
    }
    expect(calls[1]?.args).toEqual(expect.arrayContaining(["--onset-threshold", "0.5", "--frame-threshold", "0.3"]));
    expect(calls[2]?.args).toEqual(expect.arrayContaining(["--onset-threshold", "0.65", "--frame-threshold", "0.45"]));
    expect(calls[3]?.args).toEqual(expect.arrayContaining(["--onset-threshold", "0.45", "--frame-threshold", "0.3"]));
    expect(result.report.transcriber.roleThresholds).toEqual({
      vocals: { onsetThreshold: 0.5, frameThreshold: 0.3 },
      bass: { onsetThreshold: 0.65, frameThreshold: 0.45 },
      guitar: { onsetThreshold: 0.45, frameThreshold: 0.3 },
    });
    expect(result.report.stems.find((stem) => stem.role === "guitar")?.sourceStem).toBe("other");
    expect((await readdir(result.artifactDir)).sort()).toEqual(["bass.mid", "drums.mid", "guitar.mid", "report.json", "vocals.mid"]);
    expect((await readdir(jobDir)).some((name) => name.startsWith(".stems-work-"))).toBe(false);
  });

  it("transcribes dedicated guitar and residual other stems when both are available", async () => {
    const jobDir = await mkdtemp(join(tmpdir(), "keyspilli-stem-guitar-test-"));
    tempDirs.push(jobDir);
    const audioPath = join(jobDir, "audio.mp3");
    await writeFile(audioPath, Buffer.alloc(2048));
    const transcribedAudio: string[] = [];
    const transcriptionArgs: Array<readonly string[]> = [];
    const runner: StemCommandRunner = async (command, args) => {
      if (command === "/test/python") {
        if (args[0] === "/test/audio_onsets.py") return { stdout: "[]", stderr: "" };
        const output = args[args.indexOf("--output") + 1]!;
        await mkdir(output, { recursive: true });
        const stems: Record<string, string> = {};
        for (const role of ["vocals", "bass", "drums", "other", "guitar"] as const) {
          const path = join(output, `${role}.wav`);
          await writeFile(path, Buffer.alloc(2048));
          stems[role] = path;
        }
        return { stdout: `KEYSPILLI_STEMS_JSON:${JSON.stringify({ version: "4.0.1", stems })}`, stderr: "" };
      }
      transcribedAudio.push(args[1]!);
      transcriptionArgs.push(args);
      await writeFile(join(args[0]!, `${args[1]!.split("/").pop()}_basic_pitch.mid`), Buffer.from([1, 2, 3]));
      return { stdout: "", stderr: "" };
    };

    const result = await transcribePitchedStems(audioPath, jobDir, {
      ...config(),
      onsetThreshold: 0.8,
      frameThreshold: 0.6,
    }, {}, {
      run: runner,
      freeBytes: async () => 10 * 1024 ** 3,
    });

    expect(transcribedAudio.some((path) => path.endsWith("/guitar.wav"))).toBe(true);
    expect(transcribedAudio.some((path) => path.endsWith("/other.wav"))).toBe(true);
    expect(result.stems.map((stem) => stem.role)).toEqual(["vocals", "bass", "guitar", "other", "drums"]);
    expect(result.stems.find((stem) => stem.role === "other")?.noteSource).toBe("other");
    expect(transcriptionArgs).toHaveLength(4);
    expect(transcriptionArgs.every((args) => args.includes("0.8") && args.includes("0.6"))).toBe(true);
    expect(result.report.stems.find((stem) => stem.role === "guitar")?.sourceStem).toBe("guitar");
    expect(result.report.stems.find((stem) => stem.role === "other")?.sourceStem).toBe("other");
    expect((await readdir(result.artifactDir)).sort()).toEqual([
      "bass.mid", "drums.mid", "guitar.mid", "other.mid", "report.json", "vocals.mid",
    ]);
  });

  it("fails before spawning Demucs when disk headroom is below the configured floor", async () => {
    const jobDir = await mkdtemp(join(tmpdir(), "keyspilli-stem-disk-"));
    tempDirs.push(jobDir);
    const run = vi.fn<StemCommandRunner>();
    await expect(transcribePitchedStems(join(jobDir, "audio.mp3"), jobDir, config(), {}, {
      run,
      freeBytes: async () => 512,
    })).rejects.toThrow("stem separation requires at least");
    expect(run).not.toHaveBeenCalled();
  });

  it("removes decoded scratch when a stem transcription fails", async () => {
    const jobDir = await mkdtemp(join(tmpdir(), "keyspilli-stem-fail-"));
    tempDirs.push(jobDir);
    const runner: StemCommandRunner = async (command, args) => {
      if (command === "/test/python") {
        if (args[0] === "/test/audio_onsets.py") return { stdout: "[]", stderr: "" };
        const output = args[args.indexOf("--output") + 1]!;
        await mkdir(output, { recursive: true });
        const stems: Record<string, string> = {};
        for (const role of ["vocals", "bass", "drums", "other"] as const) {
          const path = join(output, `${role}.wav`);
          await writeFile(path, Buffer.alloc(2048));
          stems[role] = path;
        }
        return { stdout: `KEYSPILLI_STEMS_JSON:${JSON.stringify({ version: "4.0.1", stems })}`, stderr: "" };
      }
      throw new Error("Basic Pitch exploded");
    };
    await expect(transcribePitchedStems(join(jobDir, "audio.mp3"), jobDir, config(), {}, {
      run: runner,
      freeBytes: async () => 10 * 1024 ** 3,
    })).rejects.toThrow("Basic Pitch exploded");
    expect((await readdir(jobDir)).some((name) => name.startsWith(".stems-work-"))).toBe(false);
  });
});
