import { describe, expect, it } from "vitest";
import {
  buildControlledMixture,
  runBasicPitchRoute,
  runDemucsRoute,
  runExistingBsRoformerRoute,
  type RunnerCommand,
} from "../src/upstream-attribution-runner.js";

describe("upstream attribution route runner", () => {
  it("hashes a controlled mixture recipe independently of input order", async () => {
    const calls: RunnerCommand[] = [];
    const execFile = async (file: string, args: readonly string[], options: { shell: false }) => {
      calls.push({ file, args: [...args] });
      expect(options.shell).toBe(false);
      return { stdout: "", stderr: "" };
    };
    const recipe = { outputPath: "/tmp/keyspilli/mix.wav", sampleRate: 22_050, channels: 1 as const };
    const inputs = [
      { id: "guitar", path: "/tmp/guitar.wav", sha256: "a".repeat(64), gainDb: 0 },
      { id: "drums", path: "/tmp/drums.wav", sha256: "d".repeat(64), gainDb: -6 },
    ];
    const first = await buildControlledMixture(inputs, recipe, { execFile });
    const second = await buildControlledMixture([...inputs].reverse(), recipe, { execFile });
    expect(first.recipeHash).toBe(second.recipeHash);
    expect(first.inputHashes).toEqual({ drums: "d".repeat(64), guitar: "a".repeat(64) });
    expect(calls[0]!.file).toBe("ffmpeg");
    expect(calls[0]!.args).toContain("-filter_complex");
    expect(calls[0]!.args.at(-1)).toBe(recipe.outputPath);
  });

  it("runs Basic Pitch with the current thresholds and rejects remote input", async () => {
    const calls: RunnerCommand[] = [];
    const execFile = async (file: string, args: readonly string[]) => {
      calls.push({ file, args: [...args] });
      return { stdout: "", stderr: "" };
    };
    const result = await runBasicPitchRoute("/tmp/guitar.wav", {
      executable: "/opt/basic-pitch",
      outputDir: "/tmp/keyspilli/bp",
      midiPath: "/tmp/keyspilli/bp/guitar_basic_pitch.mid",
    }, { execFile });
    expect(result.status).toBe("available");
    expect(calls[0]).toMatchObject({ file: "/opt/basic-pitch" });
    expect(calls[0]!.args).toEqual([
      "/tmp/keyspilli/bp", "/tmp/guitar.wav", "--save-midi",
      "--onset-threshold", "0.45", "--frame-threshold", "0.3",
    ]);
    await expect(runBasicPitchRoute("https://example.invalid/audio.wav", {
      executable: "basic-pitch", outputDir: "/tmp/out",
    }, { execFile })).rejects.toThrow(/local path/);
  });

  it("runs the existing Demucs command without a shell", async () => {
    const calls: RunnerCommand[] = [];
    const execFile = async (file: string, args: readonly string[]) => {
      calls.push({ file, args: [...args] });
      return { stdout: "KEYSPILLI_STEMS_JSON:{\"version\":\"x\",\"stems\":{\"guitar\":\"/tmp/guitar.wav\"}}", stderr: "" };
    };
    const result = await runDemucsRoute({ path: "/tmp/mix.wav", recipeHash: "a".repeat(64) }, {
      python: "/opt/python",
      separatorScript: "/opt/separate_stems.py",
      outputDir: "/tmp/keyspilli/demucs",
    }, { execFile });
    expect(result.status).toBe("available");
    expect(result.stems).toEqual({ guitar: "/tmp/guitar.wav" });
    expect(calls[0]).toMatchObject({ file: "/opt/python" });
    expect(calls[0]!.args).toEqual([
      "/opt/separate_stems.py", "--input", "/tmp/mix.wav", "--output", "/tmp/keyspilli/demucs",
      "--model", "htdemucs_6s", "--device", "cpu",
    ]);
  });

  it("reports BS-RoFormer unavailable without invoking a fallback or network", async () => {
    const calls: RunnerCommand[] = [];
    const result = await runExistingBsRoformerRoute("/tmp/mix.wav", undefined, {
      execFile: async (file, args) => {
        calls.push({ file, args: [...args] });
        return { stdout: "", stderr: "" };
      },
    });
    expect(result).toMatchObject({ status: "unavailable", route: "bs-roformer" });
    expect(calls).toHaveLength(0);
  });
});
