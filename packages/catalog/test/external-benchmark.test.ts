import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  EXTERNAL_BENCHMARK_FAILURES,
  SEVEN_SONG_BENCHMARK_IDS,
  buildExternalBenchmarkReport,
  canonicalExternalBenchmarkJson,
  externalBenchmarkInventory,
  type ExternalBenchmarkInput,
} from "../src/external-benchmark.js";
import { runExternalSymbolicCli } from "../scripts/evaluate-external-symbolic.js";

const midi = (pitch = 60, shift = 0) => writeMidi([
  { midi: pitch, start: shift, dur: 1, vel: 90, hand: "R" },
  { midi: pitch + 4, start: shift + 1, dur: 1, vel: 90, hand: "R" },
], { tempoBpm: 120, title: "synthetic" });

const longMidi = (beats: number) => writeMidi(
  Array.from({ length: beats }, (_, index) => ({ midi: 60 + (index % 5), start: index, dur: 0.5, vel: 90, hand: "R" as const })),
  { tempoBpm: 120, title: "synthetic-long" },
);

const windows = [{ id: "main", candidate: [0, 2] as [number, number], reference: [0, 2] as [number, number], role: "melody" as const }];

function song(id: string, input: Partial<ExternalBenchmarkInput["songs"][number]> = {}) {
  return { id, candidateInputs: [{ id: `${id}-candidate`, bytes: midi(), format: "midi", purpose: "GENERATION_CANDIDATE" as const, alignment: { status: "aligned" as const, reason: null } }], referenceInputs: [{ id: `${id}-reference`, bytes: midi(), format: "midi" }], windows, humanRaters: [{ raterId: "r1", decision: "accept" as const }, { raterId: "r2", decision: "accept" as const }], ...input };
}

describe("external symbolic benchmark orchestration", () => {
  it("exposes a metadata-only seven-song inventory projection", () => {
    expect(externalBenchmarkInventory()).toEqual(SEVEN_SONG_BENCHMARK_IDS.map((id, index) => ({ id, position: index + 1, label: id.replace(/-/g, " ") })));
  });

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

  it("does not generate from a candidate without explicit target alignment", async () => {
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        candidateInputs: [{ id: "unaligned", bytes: midi(), format: "midi" }],
      })],
    });
    const row = report.songs[0]!;
    expect(row.freeze.selectedRecordIds).toEqual([]);
    expect(row.generation.status).not.toBe("symbolic");
    expect(row.output.availability).toBe("unavailable");
    expect(row.failures).toContain("ALIGNMENT_UNAVAILABLE");
    expect(row.failures).toContain("NO_USABLE_GENERATION_CANDIDATE");
  });

  it("keeps local-only external evaluation modules out of the production barrel", async () => {
    const catalog = await import("../src/index.js");
    expect("assertGenerationEvidence" in catalog).toBe(false);
    expect("adaptNativeSymbolicBytes" in catalog).toBe(false);
    expect("researchExternalCandidates" in catalog).toBe(false);
    expect("buildExternalSymbolicArrangement" in catalog).toBe(false);
    expect("evaluateStageSurvival" in catalog).toBe(false);
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

  it("does not count agreeing raters as human-ready without the composite evidence gate", async () => {
    const report = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!)] });
    const row = report.songs[0]!;

    expect(row.human).toMatchObject({ status: "ready", raters: 2, agreeing: true, decision: "accept" });
    expect(row.humanReady).toBe(false);
    expect(row.readiness.status).toBe("blocked");
    expect(row.readiness.requirements).toMatchObject({
      humanAccepted: true,
      symbolicOutput: true,
      structuralPass: true,
      referenceAdequate: false,
    });
    expect(row.readiness.failures).toContain("REFERENCE_COVERAGE_INSUFFICIENT");
    expect(report.summary.humanReady).toBe(0);
    expect(report.summary.blocked).toBe(report.songs.filter((song) => song.readiness.status === "blocked").length);
    expect(report.summary.blocked).toBe(7);
  });

  it("requires aligned reference coverage to span at least 32 bars", async () => {
    const candidate = longMidi(96);
    const shortWindows = [0, 32, 64].map((start) => ({
      id: `window-${start}`,
      candidate: [start, start + 32] as [number, number],
      reference: [start, start + 32] as [number, number],
      role: "melody" as const,
    }));
    const short = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        candidateInputs: [{ id: "candidate", bytes: candidate, format: "midi", alignment: { status: "aligned", reason: null } }],
        referenceInputs: [{ id: "reference", bytes: candidate, format: "midi" }],
        windows: shortWindows,
      })],
    });
    expect(short.songs[0]?.reference.alignment.status).toBe("aligned");
    expect(short.songs[0]?.readiness.status).toBe("blocked");
    expect(short.songs[0]?.readiness.failures).toContain("REFERENCE_COVERAGE_INSUFFICIENT");
  });

  it("requires symbolic output and a passing structural gate before human readiness", async () => {
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { candidateInputs: [] })],
    });
    const row = report.songs[0]!;

    expect(row.humanReady).toBe(false);
    expect(row.readiness.requirements).toMatchObject({ symbolicOutput: false, structuralPass: false, humanAccepted: true });
    expect(row.readiness.failures).toEqual(expect.arrayContaining(["OUTPUT_UNAVAILABLE", "STRUCTURAL_GATE_FAILED"]));
  });

  it("requires an accepting human consensus for composite readiness", async () => {
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        humanRaters: [{ raterId: "r1", decision: "reject" }, { raterId: "r2", decision: "reject" }],
      })],
    });
    const row = report.songs[0]!;

    expect(row.human).toMatchObject({ status: "ready", raters: 2, agreeing: true, decision: "reject" });
    expect(row.humanReady).toBe(false);
    expect(row.readiness.requirements.humanAccepted).toBe(false);
    expect(row.readiness.failures).toContain("HUMAN_REVIEW_REJECTED");
  });

  it("has deterministic path-safe reports under reordered input", async () => {
    const first = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[1]), song(SEVEN_SONG_BENCHMARK_IDS[0])] });
    const second = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]), song(SEVEN_SONG_BENCHMARK_IDS[1])] });
    expect(first.reportHash).toBe(second.reportHash);
    expect(canonicalExternalBenchmarkJson(first)).toBe(canonicalExternalBenchmarkJson(second));
    expect(JSON.stringify(first)).not.toMatch(/note|bytes|timestamp|Users|private|tmp/i);
  });

  it("retains scalar event metrics in canonical JSON and hashes while omitting raw payloads", () => {
    const makeReport = (eventCount: number) => ({
      route: {
        output: { eventCount, durationBeats: 4, sha256: "output-hash" },
        coverage: {
          totalEvents: 2,
          totalDurationBeats: 4,
          byEvidenceClass: {
            symbolic: { eventCount: 1, eventPercentage: 50, durationBeats: 2, durationPercentage: 50, confidence: { min: 1, median: 1, max: 1 } },
          },
          attributedEventPercentage: 50,
          attributedDurationPercentage: 50,
        },
        events: [{ midi: 60, start: 0, dur: 1, vel: 90 }],
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90 }],
      },
    });
    const first = makeReport(1);
    const second = makeReport(2);
    const firstJson = canonicalExternalBenchmarkJson(first as any);
    const secondJson = canonicalExternalBenchmarkJson(second as any);
    const hash = (json: string) => createHash("sha256").update(json).digest("hex");

    expect(firstJson).toContain('"eventCount":1');
    expect(firstJson).toContain('"eventPercentage":50');
    expect(firstJson).toContain('"totalEvents":2');
    expect(firstJson).toContain('"attributedEventPercentage":50');
    expect(firstJson).not.toContain('"events"');
    expect(firstJson).not.toContain('"notes"');
    expect(firstJson).not.toBe(secondJson);
    expect(hash(firstJson)).not.toBe(hash(secondJson));
  });

  it("rejects malformed output-note aliases before route evaluation", async () => {
    const validNotes = [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const }];
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        routes: [{ id: "AUDIO_FALLBACK_CONTROL", notes: validNotes, outputNotes: { malformed: true } as never }],
      })],
    });
    expect(report.songs[0]?.failures).toContain("INVALID_INPUT");
  });

  it("does not let a route descriptor forge symbolic output when generation is unavailable", async () => {
    const forgedNotes = [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const }];
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        candidateInputs: [],
        routes: [{ id: "EXTERNAL_SYMBOLIC_FIRST", notes: forgedNotes }],
      })],
    });
    const route = report.songs[0]?.routes.find(({ id }) => id === "EXTERNAL_SYMBOLIC_FIRST");

    expect(route).toMatchObject({
      status: "unavailable",
      descriptor: { supplied: true },
      output: { availability: "unavailable", eventCount: 0, sha256: null },
    });
    expect(route?.failures).toContain("OUTPUT_UNAVAILABLE");
  });

  it("canonicalizes route note fields before hashing", async () => {
    const firstNotes = [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const, identitySource: "vocals" as const, lyrics: "la", ignored: "one" }];
    const secondNotes = [{ ignored: "two", lyrics: "la", identitySource: "vocals" as const, hand: "R" as const, vel: 90, dur: 1, start: 0, midi: 60 }];
    const first = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { routes: [{ id: "AUDIO_FALLBACK_CONTROL", notes: firstNotes as never }] })],
    });
    const second = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { routes: [{ id: "AUDIO_FALLBACK_CONTROL", notes: secondNotes as never }] })],
    });

    expect(first.songs[0]?.routes[0]?.output.sha256).toBe(second.songs[0]?.routes[0]?.output.sha256);
  });

  it("turns malformed route descriptor containers into an invalid-input report", async () => {
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { routes: { malformed: true } as never })],
    });
    expect(report.songs[0]?.failures).toContain("INVALID_INPUT");
  });

  it("rejects URL and directory-like local inputs and exposes a closed taxonomy", async () => {
    await expect(buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0], { candidateInputs: [{ path: "https://example.test/song.mid", format: "midi" }] })] })).rejects.toThrow(/local|url/i);
    expect(EXTERNAL_BENCHMARK_FAILURES).toContain("METADATA_ONLY");
  });

  it("filters role-specific alignment windows instead of comparing every pitched part", async () => {
    const mixed = writeMidi([
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 90, hand: "L" },
    ], { tempoBpm: 120, tracks: [
      { name: "Melody", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      { name: "Harmony", notes: [{ midi: 48, start: 0, dur: 1, vel: 90, hand: "L" }] },
    ] });
    const report = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { candidateInputs: [{ id: "candidate", bytes: mixed, format: "midi", alignment: { status: "aligned", reason: null } }], referenceInputs: [{ id: "reference", bytes: mixed, format: "midi" }] })] });
    expect((report.songs[0]?.reference.alignment as any).roleFilteredWindows).toEqual([{ id: "main", role: "melody", candidatePitchedCount: 1, referencePitchedCount: 1 }]);
  });

  it("uses all pitched events for role alignment when parsed MIDI has no hand metadata", async () => {
    const generic = writeMidi([
      { midi: 60, start: 0, dur: 1, vel: 90 },
      { midi: 62, start: 1, dur: 1, vel: 90 },
    ], { tempoBpm: 120, title: "generic reference" });
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        candidateInputs: [{ id: "candidate", bytes: generic, format: "midi", alignment: { status: "aligned", reason: null } }],
        referenceInputs: [{ id: "reference", bytes: generic, format: "midi" }],
      })],
    });

    expect((report.songs[0]?.reference.alignment as any).roleFilteredWindows).toEqual([
      { id: "main", role: "melody", candidatePitchedCount: 2, referencePitchedCount: 2 },
    ]);
  });

  it("reports independent external/control routes with role metrics and explicit coverage", async () => {
    const controlNotes = [
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const },
      { midi: 62, start: 1, dur: 1, vel: 90, hand: "R" as const },
    ];
    const report = await buildExternalBenchmarkReport({
      songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, {
        routes: [{
          id: "AUDIO_FALLBACK_CONTROL",
          label: "current audio-first control",
          notes: controlNotes,
          attributions: [
            { evidenceClass: "AUDIO_AMT_FALLBACK", noteIndices: [0, 1], confidence: 0.4 },
          ],
        }],
      })],
    });
    const row = report.songs[0]!;
    expect(row.routes.map((route) => route.id)).toEqual(["AUDIO_FALLBACK_CONTROL", "EXTERNAL_SYMBOLIC_FIRST"]);
    expect(row.routes[0]?.status).toBe("available");
    expect(row.routes[0]?.coverage.byEvidenceClass.AUDIO_AMT_FALLBACK).toMatchObject({ eventPercentage: 100, durationPercentage: 100 });
    expect(row.routes[0]?.reference.roleMetrics.melody).toMatchObject({ status: "aligned", confidence: expect.any(Number) });
    expect(row.routes[1]?.status).toBe("available");
    expect(row.routeCoverage).toMatchObject({
      EXTERNAL_SYMBOLIC_FIRST: { attributedEventPercentage: null },
      AUDIO_FALLBACK_CONTROL: { attributedEventPercentage: 100 },
    });
  });

  it("turns malformed manifest rows into an explicit invalid-input report", async () => {
    const malformedRows: ExternalBenchmarkInput[] = [
      { songs: [{ id: SEVEN_SONG_BENCHMARK_IDS[0], candidateInputs: [null as never] }] },
      { songs: [{ id: SEVEN_SONG_BENCHMARK_IDS[0], referenceInputs: [null as never] }] },
      { songs: [{ id: SEVEN_SONG_BENCHMARK_IDS[0], discoveryRecords: [null as never] }] },
      { songs: [{ id: SEVEN_SONG_BENCHMARK_IDS[0], humanRaters: [null as never] }] },
      { songs: [{ id: SEVEN_SONG_BENCHMARK_IDS[0], humanRaters: [{ raterId: "r1", decision: 1 } as never] }] },
    ];
    for (const input of malformedRows) {
      const report = await buildExternalBenchmarkReport(input);
      expect(report.songs[0]?.failures).toContain("INVALID_INPUT");
      expect(report.songs[0]?.freeze.completed).toBe(false);
      expect(report.songs[0]?.generation.status).toBe("unavailable");
    }
  });

  it("does not treat anonymous or duplicate raters as independent agreement", async () => {
    const anonymous = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { humanRaters: [{ decision: "accept" }, { decision: "accept" }] })] });
    expect(anonymous.songs[0]?.human.status).toBe("blocked");
    expect(anonymous.songs[0]?.failures).toContain("HUMAN_REVIEW_CONFLICT");
    const duplicate = await buildExternalBenchmarkReport({ songs: [song(SEVEN_SONG_BENCHMARK_IDS[0]!, { humanRaters: [{ raterId: "same", decision: "accept" }, { raterId: "same", decision: "accept" }] })] });
    expect(duplicate.songs[0]?.human.status).toBe("blocked");
    expect(duplicate.songs[0]?.failures).toContain("HUMAN_REVIEW_CONFLICT");
  });

  it("redacts arbitrary absolute and quoted relative paths while preserving URLs and logical refs", () => {
    const report = { foo: "/foo/bar/baz.mid", discovery: { errors: ["/foo/bar/baz.mid", "\"./private/thing.mid\"", "https://example.test/a/b", "logical/A/B"] } };
    const canonical = canonicalExternalBenchmarkJson(report as any);
    expect(canonical).not.toContain("/foo/bar/baz.mid");
    expect(canonical).not.toContain("./private/thing.mid");
    expect(canonical).toContain("https://example.test/a/b");
    expect(canonical).toContain("logical/A/B");
  });
});

describe("external symbolic benchmark CLI", () => {
  it("returns a usage error when the required manifest is omitted", async () => {
    let output = "";
    let errors = "";
    const code = await runExternalSymbolicCli([], {
      stdout: (value) => { output += value; },
      stderr: (value) => { errors += value; },
    });
    expect(code).toBe(2);
    expect(output).toBe("");
    expect(errors).toMatch(/manifest is required/i);
  });

  it("prints the explicit metadata-only inventory without reading a source", async () => {
    const output: string[] = [];
    const code = await runExternalSymbolicCli(["--inventory"], { stdout: (value) => output.push(value), stderr: () => undefined });
    expect(code).toBe(0);
    const report = JSON.parse(output.join("")) as { kind: string; songs: Array<{ id: string }> };
    expect(report.kind).toBe("external-benchmark-inventory");
    expect(report.songs.map((song) => song.id)).toEqual([...SEVEN_SONG_BENCHMARK_IDS]);
  });

  it("rejects missing manifest and unknown options without touching the network", async () => {
    const errors: string[] = [];
    const code = await runExternalSymbolicCli(["--manifest", "https://example.test/manifest.json"], { stdout: () => undefined, stderr: (value) => errors.push(value) });
    expect(code).toBe(2);
    expect(errors.join(" ")).toMatch(/local|absolute|manifest/i);
  });
});
