import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  EXTERNAL_BENCHMARK_FAILURES,
  SEVEN_SONG_BENCHMARK_IDS,
  buildExternalBenchmarkReport,
  canonicalExternalBenchmarkJson,
  type ExternalBenchmarkInput,
} from "../src/external-benchmark.js";
import { runExternalSymbolicCli } from "../scripts/evaluate-external-symbolic.js";

const midi = (pitch = 60, shift = 0) => writeMidi([
  { midi: pitch, start: shift, dur: 1, vel: 90, hand: "R" },
  { midi: pitch + 4, start: shift + 1, dur: 1, vel: 90, hand: "R" },
], { tempoBpm: 120, title: "synthetic" });

const windows = [{ id: "main", candidate: [0, 2] as [number, number], reference: [0, 2] as [number, number], role: "melody" as const }];

function song(id: string, input: Partial<ExternalBenchmarkInput["songs"][number]> = {}) {
  return { id, candidateInputs: [{ id: `${id}-candidate`, bytes: midi(), format: "midi", purpose: "GENERATION_CANDIDATE" as const }], referenceInputs: [{ id: `${id}-reference`, bytes: midi(), format: "midi" }], windows, humanRaters: [{ raterId: "r1", decision: "accept" as const }, { raterId: "r2", decision: "accept" as const }], ...input };
}

describe("external symbolic benchmark orchestration", () => {
  it("keeps the exact seven-song inventory and reports missing evidence", async () => {
    expect(SEVEN_SONG_BENCHMARK_IDS).toEqual([
      "sabaton-the-red-baron", "sabaton-the-final-solution", "sabaton-christmas-truce",
      "lynyrd-skynyrd-free-bird", "sabaton-1916", "sabaton-gott-mit-uns", "sabaton-the-caroleans-prayer",
    ]);
    const report = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { candidateInputs: [], referenceInputs: [] })] });
    expect(report.inventory.requiredIds).toEqual(SEVEN_SONG_BENCHMARK_IDS);
    expect(report.inventory.missingIds).toHaveLength(6);
    expect(report.songs[0]?.failures).toEqual(expect.arrayContaining(["MISSING_DISCOVERY", "NO_USABLE_GENERATION_CANDIDATE", "MISSING_REFERENCE"]));
  });

  it("freezes candidates before reference work and excludes benchmark records", async () => {
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { referenceInputs: [{ id: "reference", bytes: midi(64), format: "midi", purpose: "BENCHMARK_REFERENCE" as const, evidenceClass: "BENCHMARK_REFERENCE" as const }] })],
    });
    const row = report.songs[0]!;
    expect(row.freeze.completed).toBe(true);
    expect(row.freeze.beforeReference).toBe(true);
    expect(row.freeze.selectedRecordIds).toEqual([`${SEVEN_SONG_BENCHMARK_IDS[0]}-candidate`]);
    expect(row.freeze.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(row.generation.selectedRecordIds).not.toContain("reference");
    expect(row.reference.recordIds).toEqual(["reference"]);
    expect(row.generation.status).toBe("symbolic");
    expect(row.output.availability).toBe("available");
  });

  it("validates explicit windows and human readiness fail-closed", async () => {
    await expect(buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { windows: [{ id: "bad", candidate: [1, 1] as [number, number], reference: [0, 1] as [number, number] }] })] })).rejects.toThrow(/window/i);
    const one = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { humanRaters: [{ raterId: "r1", decision: "accept" }] })] });
    expect(one.songs[0]?.human.status).toBe("blocked");
    expect(one.songs[0]?.failures).toContain("HUMAN_REVIEW_INSUFFICIENT_RATERS");
    const conflict = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { humanRaters: [{ raterId: "r1", decision: "accept" }, { raterId: "r2", decision: "reject" }] })] });
    expect(conflict.songs[0]?.human.status).toBe("blocked");
    expect(conflict.songs[0]?.failures).toContain("HUMAN_REVIEW_CONFLICT");
  });

  it("has deterministic path-safe reports under reordered input", async () => {
    const first = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[1]), song(SEVEN_SONG_BENCHMARK_IDS[0])] });
    const second = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]), song(SEVEN_SONG_BENCHMARK_IDS[1])] });
    expect(first.reportHash).toBe(second.reportHash);
    expect(canonicalExternalBenchmarkJson(first)).toBe(canonicalExternalBenchmarkJson(second));
    expect(JSON.stringify(first)).not.toMatch(/note|bytes|timestamp|Users|private|tmp/i);
  });

  it("rejects URL and directory-like local inputs and exposes a closed taxonomy", async () => {
    await expect(buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0], { candidateInputs: [{ path: "https://example.test/song.mid", format: "midi" }] })] })).rejects.toThrow(/local|url/i);
    expect(EXTERNAL_BENCHMARK_FAILURES).toContain("METADATA_ONLY");
  });
});

describe("external symbolic benchmark CLI", () => {
  it("rejects missing manifest and unknown options without touching the network", async () => {
    const errors: string[] = [];
    const code = await runExternalSymbolicCli(["--manifest", "https://example.test/manifest.json"], { stdout: () => undefined, stderr: (value) => errors.push(value) });
    expect(code).toBe(2);
    expect(errors.join(" ")).toMatch(/local|absolute|manifest/i);
  });
});
