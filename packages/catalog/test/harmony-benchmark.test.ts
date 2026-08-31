import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi, type Note } from "@keyspilli/midi";
import { HARMONY_BENCHMARK_SCORE_IDS, normalizeHarmonyBenchmarkManifest, type HarmonyBenchmarkManifestInput } from "../src/harmony-benchmark-manifest.js";
import {
  evaluateHarmonyBenchmark,
  runHarmonyBenchmark,
  type HarmonyBenchmarkSidecarInput,
} from "../src/harmony-benchmark.js";
import { runHarmonyBenchmarkCli } from "../scripts/benchmark-harmony.js";

const hash = (char: string) => char.repeat(64);
const note = (midi: number, start: number, dur = 4): Note => ({ midi, start, dur, vel: 80 });

function score(id: string, windows = [{ id: "opening", startBeat: 0, endBeat: 8 }]) {
  return {
    id,
    title: `${id} title`,
    artist: `${id} artist`,
    sourcePdf: { sha256: hash("a"), bytes: 100, pages: 1 },
    reference: {
      selectedOmr: { backendId: "homr", version: "1.0" },
      trustedCoverage: { maskSha256: hash("b"), referenceSha256: hash("c"), windows },
      excludedRegions: [],
    },
    candidate: { status: "unavailable" as const, reason: "local candidate not frozen" },
    recording: { status: "unavailable" as const, reason: "recording not required for symbolic benchmark" },
  };
}

function manifest(): HarmonyBenchmarkManifestInput {
  return { schemaVersion: 1, scores: [...HARMONY_BENCHMARK_SCORE_IDS].map((id) => score(id)) };
}

function midi(notes: Note[]): Uint8Array {
  return writeMidi(notes, { tempoBpm: 120, tracks: [{ name: "LH", notes }] });
}

describe("local harmony benchmark evaluator", () => {
  it("evaluates six manifest rows once per explicit window and keeps missing candidates unavailable", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(manifest());
    const reference = parseMidi(midi([note(36, 0), note(40, 0), note(43, 0)]));
    const current = parseMidi(midi([note(36, 0), note(40, 0), note(43, 0)]));
    const report = evaluateHarmonyBenchmark(normalized, new Map([[HARMONY_BENCHMARK_SCORE_IDS[0], { reference, current }]]));

    expect(report.songs).toHaveLength(6);
    expect(report.songs.map((song) => song.id)).toEqual([...HARMONY_BENCHMARK_SCORE_IDS].sort());
    expect(report.songs[0]?.status).toBe("available");
    expect(report.songs[0]?.current.status).toBe("available");
    expect(report.songs[0]?.windowsEvaluated).toBe(1);
    expect(report.songs.slice(1).every((song) => song.status === "unavailable")).toBe(true);
    expect(report.songs[1]?.current.status).toBe("unavailable");
    expect(report.failureClusters.some((cluster) => cluster.code === "candidate-unavailable")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("/Users/");
    expect(JSON.stringify(report)).not.toContain("36,0,4");
  });

  it("reports alignment-required when evidence exists but trusted windows are absent", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(manifest());
    normalized.scores[0]!.reference.trustedCoverage.windows = [];
    const parsed = parseMidi(midi([note(36, 0), note(40, 0), note(43, 0)]));
    const report = evaluateHarmonyBenchmark(normalized, new Map([[HARMONY_BENCHMARK_SCORE_IDS[0], { reference: parsed, current: parsed }]]));

    expect(report.songs[0]?.status).toBe("alignment-required");
    expect(report.songs[0]?.failureClusters).toContain("alignment-required");
  });

  it("supports baseline/current comparisons with role-filtered left-hand notes", () => {
    const normalized = normalizeHarmonyBenchmarkManifest(manifest());
    const reference = parseMidi(midi([note(36, 0), note(40, 0), note(43, 0)]));
    const baseline = parseMidi(writeMidi([
      { ...note(36, 0), hand: "L" }, { ...note(37, 0), hand: "L" }, { ...note(38, 0), hand: "L" },
      { ...note(72, 0), hand: "R" },
    ], { tempoBpm: 120, tracks: [{ name: "Piano", notes: [{ ...note(36, 0), hand: "L" }, { ...note(37, 0), hand: "L" }, { ...note(38, 0), hand: "L" }, { ...note(72, 0), hand: "R" }] }] }));
    const current = parseMidi(midi([note(36, 0), note(40, 0), note(43, 0)]));
    const report = evaluateHarmonyBenchmark(normalized, new Map([[HARMONY_BENCHMARK_SCORE_IDS[0], { reference, baseline, current }]]));

    expect(report.songs[0]?.baseline.status).toBe("available");
    expect(report.songs[0]?.current.status).toBe("available");
    expect(report.songs[0]?.comparison).toBeDefined();
    expect(report.songs[0]?.comparison?.chromaAgreementDelta).not.toBeNull();
    expect(report.songs[0]?.current.metrics?.leftHand.noteCount).toBe(3);
  });

  it("runs from an explicit sidecar, writes outside the repository, and reruns deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-harmony-benchmark-"));
    try {
      const manifestPath = join(directory, "manifest.json");
      const referencePath = join(directory, "reference.mid");
      const currentPath = join(directory, "current.mid");
      const sidecarPath = join(directory, "inputs.json");
      const out = join(directory, "out");
      await writeFile(manifestPath, JSON.stringify(manifest()), "utf8");
      await writeFile(referencePath, midi([note(36, 0), note(40, 0), note(43, 0)]));
      await writeFile(currentPath, midi([note(36, 0), note(40, 0), note(43, 0)]));
      const sidecar: HarmonyBenchmarkSidecarInput = {
        schemaVersion: 1,
        scores: [{ id: HARMONY_BENCHMARK_SCORE_IDS[0], referencePath, currentPath }],
      };
      await writeFile(sidecarPath, JSON.stringify(sidecar), "utf8");
      const cliResult = await runHarmonyBenchmarkCli(["--manifest", manifestPath, "--sidecar", sidecarPath, "--out", out]);
      expect(cliResult.path).toContain("harmony-benchmark-report.json");
      await rm(out, { recursive: true, force: true });
      const first = await runHarmonyBenchmark({ manifestPath, sidecar, out });
      const firstJson = await readFile(first.path, "utf8");
      await rm(out, { recursive: true, force: true });
      const second = await runHarmonyBenchmark({ manifestPath, sidecar, out });
      expect(second.json).toBe(firstJson);
      expect(second.report.canonicalSha256).toBe(first.report.canonicalSha256);
      expect(firstJson).not.toContain(referencePath);
      expect(firstJson).not.toContain(currentPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects artifact paths resolving into the repository and does not write there", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-harmony-benchmark-path-"));
    try {
      const manifestPath = join(directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest()), "utf8");
      await expect(runHarmonyBenchmark({
        manifestPath,
        sidecar: { schemaVersion: 1, scores: [{ id: HARMONY_BENCHMARK_SCORE_IDS[0], referencePath: join(process.cwd(), "package.json") }] },
        out: join(directory, "out"),
      })).rejects.toThrow(/repository/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
