import { describe, expect, it } from "vitest";
import {
  aggregateShadowMissionReport,
  canonicalShadowMissionJson,
  runShadowMissionCli,
  type ShadowMissionReportInput,
} from "../scripts/report-shadow-mission.js";

const shadow = {
  schemaVersion: 1,
  status: "SHADOW_ENGINEERING_READY",
  corpus: {
    id: "synthetic-shadow",
    datasetVersion: "2026-09-01",
    license: "CC0",
    sourceRecord: { provider: "local", path: "/Users/reidar/private/shadow.mid" },
  },
  selectedItemIds: ["item-b", "item-a"],
  items: [
    {
      status: "SHADOW_ENGINEERING_NOT_READY",
      fixture: { id: "item-b", label: "B" },
      output: { melody: { leadNoteCount: 2 }, harmony: { semanticRootCount: 1 } },
      failures: ["alignment unavailable"],
      notes: [{ midi: 64, start: 0 }],
    },
    {
      status: "SHADOW_ENGINEERING_READY",
      fixture: { id: "item-a", label: "A" },
      output: { melody: { leadNoteCount: 4 }, harmony: { semanticRootCount: 2 } },
      failures: [],
      warnings: ["/private/tmp/shadow.mid"],
    },
  ],
  summary: { total: 2, ready: 1, notReady: 1, blocked: 0, drumPitchViolations: 0 },
};

const alignment = {
  schemaVersion: 1,
  corpus: "synthetic-shadow",
  reference: { bars: 8, durationBeats: 32, tempoBpm: 120, noteCount: 16 },
  cases: [
    { caseId: "offset", corruptionType: "offset", status: "aligned", recovered: true, falseAlignment: false, coverage: { referenceBars: 8 } },
    { caseId: "transpose", corruptionType: "transpose", status: "partial", recovered: false, falseAlignment: false, coverage: { referenceBars: 4 } },
  ],
  gate: { windowMinimum: 3, barMinimum: 32, thresholdsChanged: false, casesEvaluated: 2, casesMeetingWindowMinimum: 1, casesMeetingBarMinimum: 0, casesMeetingBoth: 0, assessment: "insufficient-independent-32-bar-evidence", note: "synthetic only" },
};

const benchmark = {
  schemaVersion: 1,
  inventory: { requiredIds: ["song-a", "song-b"], presentIds: ["song-a"], missingIds: ["song-b"] },
  songs: [
    {
      id: "song-a", present: true,
      discovery: { status: "supplied", count: 1, metadataOnly: 0, errors: [] },
      candidates: { discovered: 1, acquired: 1, usable: 1, parsed: 1, recordIds: ["candidate-a"] },
      candidateCounts: { discovered: 1, acquired: 1, usable: 1 }, counts: { discovered: 1, acquired: 1, usable: 1 },
      freeze: { completed: true, beforeReference: true, digest: "freeze-a", selectedRecordIds: ["candidate-a"], rejectedRecordIds: ["candidate-b"] },
      generation: { status: "symbolic", selectedRecordIds: ["candidate-a"], diagnostics: [] }, generationStatus: "symbolic",
      output: { availability: "available", status: "symbolic", structuralGate: "pass" }, outputAvailability: "available",
      reference: { availability: "available", recordIds: ["ref-a"], parsedCount: 1, validatedWindows: 3, windows: [], alignment: { status: "aligned", confidence: 0.9, coverage: { reference: 1, candidate: 1 } } }, referenceAvailability: "available",
      human: { status: "pending", raters: 0 }, humanReadiness: { status: "pending", raters: 0 }, readiness: { status: "blocked", failures: ["human review missing"] }, humanReady: false,
      routes: [], routeCoverage: {}, failures: [],
    },
  ],
  candidateCounts: { discovered: 1, acquired: 1, usable: 1 },
  summary: { songs: 1, present: 1, symbolic: 1, fallback: 0, unavailable: 0, humanReady: 0, blocked: 1 },
  reportHash: "benchmark-hash",
  determinism: { canonicalSha256: "benchmark-canonical" },
};

const retrieval = {
  schemaVersion: 1,
  network: false,
  songs: [
    { id: "song-b", title: "Song B", artist: "Artist", statuses: ["FOUND_METADATA_ONLY"], sources: [{ sourceRef: "/Users/reidar/Downloads/song-b.mid", metadataOnly: true }] },
    { id: "song-a", title: "Song A", artist: "Artist", statuses: ["FOUND_ACCESSIBLE_SYMBOLIC"], sources: [] },
  ],
  summary: { FOUND_ACCESSIBLE_SYMBOLIC: 1, FOUND_METADATA_ONLY: 1 },
};

const redBaron = {
  schemaVersion: 1,
  kind: "red-baron-stage-survival",
  status: "partial",
  reference: { stage: "reference", status: "available", noteCount: 3, rejectedNoteCount: 0, invalidNoteCount: 0, sourceId: "reference", rejectionReasons: [], diagnostics: [] },
  stages: {
    raw: { stage: "raw", status: "available", noteCount: 3, rejectedNoteCount: 0, invalidNoteCount: 0, sourceId: "raw", rejectionReasons: [], diagnostics: [] },
    decoder: { stage: "decoder", status: "available", noteCount: 1, rejectedNoteCount: 2, invalidNoteCount: 0, sourceId: "decoder", rejectionReasons: ["weak"], diagnostics: [] },
    semantic: { stage: "semantic", status: "missing", noteCount: 0, rejectedNoteCount: 0, invalidNoteCount: 0, sourceId: null, rejectionReasons: [], diagnostics: [] },
    canonical: { stage: "canonical", status: "missing", noteCount: 0, rejectedNoteCount: 0, invalidNoteCount: 0, sourceId: null, rejectionReasons: [], diagnostics: [] },
    easy: { stage: "easy", status: "missing", noteCount: 0, rejectedNoteCount: 0, invalidNoteCount: 0, sourceId: null, rejectionReasons: [], diagnostics: [] },
  },
  windows: [],
  transitions: [
    { from: "raw", to: "decoder", matches: [], loss: { sourceCount: 3, targetCount: 1, matchedCount: 1, unmatchedSourceCount: 2, unmatchedTargetCount: 0, rejected: 2, replaced: 0, obscured: 0, additions: 0, unsupportedCanonicalExpansions: 0 }, diagnostics: ["/Users/reidar/private/raw.mid"], lineage: [] },
  ],
  diagnostics: [],
};

const baseInput: ShadowMissionReportInput = {
  disk: { freeGiB: 42, thresholdGiB: 30, path: "/private/tmp/disk.json" },
  corpus: { id: "synthetic-shadow", datasetVersion: "2026-09-01", itemCount: 2, status: "ready", sourceRecord: { path: "/Users/reidar/private/corpus" } },
  shadow,
  alignment,
  retrieval,
  benchmark,
  redBaron,
};

describe("shadow mission report", () => {
  it("aggregates readiness evidence without turning missing evidence into success", () => {
    const report = aggregateShadowMissionReport(baseInput);

    expect(report.kind).toBe("shadow-mission-report");
    expect(report.provenance.disk.freeGiB).toBe(42);
    expect(report.shadow.items.map((item) => item.id)).toEqual(["item-a", "item-b"]);
    expect(report.alignment.cases.recovered).toBe(1);
    expect(report.sevenSong.missingIds).toEqual(["song-b"]);
    expect(report.benchmark.candidateFreezeOrder).toEqual([{ songId: "song-a", beforeReference: true, completed: true, selectedRecordIds: ["candidate-a"], digest: "freeze-a" }]);
    expect(report.redBaron.firstLoss).toMatchObject({ transition: "raw->decoder", category: "DECODER_REJECTION", count: 2 });
    expect(report.readiness.shadowEngineering).toBe("BLOCKED");
    expect(report.readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(report.readiness.production).toBe("BLOCKED");
    expect(report.safety.actions.length).toBeGreaterThan(0);

    const engineeringReady = aggregateShadowMissionReport({
      ...baseInput,
      shadow: { ...shadow, items: [shadow.items[1]], summary: { total: 1, ready: 1, notReady: 0, blocked: 0, drumPitchViolations: 0 } },
    });
    expect(engineeringReady.readiness.shadowEngineering).toBe("SHADOW_ENGINEERING_READY");
  });

  it("is deterministic under input ordering and omits paths, notes, and media payloads", () => {
    const first = aggregateShadowMissionReport(baseInput);
    const second = aggregateShadowMissionReport({
      ...baseInput,
      shadow: { ...shadow, items: [...shadow.items].reverse(), selectedItemIds: [...shadow.selectedItemIds].reverse() },
      retrieval: { ...retrieval, songs: [...retrieval.songs].reverse() },
    });
    const json = canonicalShadowMissionJson(first);
    expect(json).toBe(canonicalShadowMissionJson(second));
    expect(json).not.toContain("/Users/reidar");
    expect(json).not.toContain("/private/tmp");
    expect(json).not.toContain('"notes"');
    expect(json).not.toContain('"payload"');
    expect(json).not.toContain("midi");
    expect(first.determinism.canonicalSha256).toBe(second.determinism.canonicalSha256);
  });

  it("keeps tri-state sections when reports are absent", () => {
    const report = aggregateShadowMissionReport({});
    expect(report.provenance.disk.status).toBe("unavailable");
    expect(report.shadow.itemCount).toBeNull();
    expect(report.alignment.status).toBe("unavailable");
    expect(report.benchmark.realSongSymbolicOutputs).toBeNull();
    expect(report.redBaron.firstLoss).toBeNull();
    expect(report.readiness.highest).toBeNull();
    expect(report.readiness.production).toBe("BLOCKED");
    expect(report.safety.noMedia).toBeNull();
    expect(report.safety.noProtectedPaths).toBeNull();
  });

  it("requires a completed pre-reference freeze and broad validated reference coverage", () => {
    const validatedWindows = [
      { id: "intro", reference: [0, 64], candidate: [0, 64] },
      { id: "body", reference: [64, 128], candidate: [64, 128] },
      { id: "solo", reference: [128, 192], candidate: [128, 192] },
    ];
    const song = {
      id: "song-a", present: true, generationStatus: "symbolic", outputAvailability: "available",
      output: { structuralGate: "pass" },
      reference: { validatedWindows, alignment: { status: "aligned" } },
      freeze: { completed: true, beforeReference: true, selectedRecordIds: ["candidate-a"] },
      humanReady: true,
    };
    const input = {
      benchmark: {
        inventory: { requiredIds: ["song-a"], presentIds: ["song-a"], missingIds: [] },
        songs: [song],
      },
    };
    const ready = aggregateShadowMissionReport(input);
    expect(ready.benchmark.songs[0]).toMatchObject({ validatedReferenceWindows: 3, validatedReferenceBars: 48 });
    expect(ready.readiness.benchmarkHumanListening).toBe("BENCHMARK_READY_FOR_HUMAN_LISTENING");

    expect(aggregateShadowMissionReport({
      ...input,
      benchmark: { ...input.benchmark, songs: [{ ...song, freeze: { ...song.freeze, completed: false } }] },
    }).readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(aggregateShadowMissionReport({
      ...input,
      benchmark: { ...input.benchmark, songs: [{ ...song, freeze: { ...song.freeze, beforeReference: false } }] },
    }).readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(aggregateShadowMissionReport({
      ...input,
      benchmark: { ...input.benchmark, songs: [{ ...song, reference: { validatedWindows: validatedWindows.map((window) => ({ ...window, reference: [window.reference[0]!, window.reference[1]! / 2] as [number, number] })), alignment: { status: "aligned" } } }] },
    }).readiness.benchmarkHumanListening).toBe("BLOCKED");
  });

  it("requires benchmark song IDs to exactly match the complete inventory", () => {
    const validatedWindows = [
      { id: "intro", reference: [0, 64], candidate: [0, 64] },
      { id: "body", reference: [64, 128], candidate: [64, 128] },
      { id: "solo", reference: [128, 192], candidate: [128, 192] },
    ];
    const song = {
      id: "song-a", present: true, generationStatus: "symbolic", outputAvailability: "available",
      output: { structuralGate: "pass" },
      reference: { validatedWindows, alignment: { status: "aligned" } },
      freeze: { completed: true, beforeReference: true, selectedRecordIds: ["candidate-a"] },
      humanReady: true,
    };
    const input = {
      benchmark: {
        inventory: { requiredIds: ["song-a"], presentIds: ["song-a"], missingIds: [] },
        songs: [song],
      },
    };
    expect(aggregateShadowMissionReport(input).readiness.benchmarkHumanListening)
      .toBe("BENCHMARK_READY_FOR_HUMAN_LISTENING");

    const wrongSong = aggregateShadowMissionReport({
      benchmark: { ...input.benchmark, songs: [{ ...song, id: "song-not-in-inventory" }] },
    });
    expect(wrongSong.readiness.benchmarkHumanListening).toBe("BLOCKED");

    const extraInventoryId = aggregateShadowMissionReport({
      benchmark: {
        ...input.benchmark,
        inventory: { requiredIds: ["song-a"], presentIds: ["song-a", "song-extra"], missingIds: [] },
      },
    });
    expect(extraInventoryId.readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(extraInventoryId.sevenSong.inventoryValid).toBe(true);

    const duplicateBenchmarkId = aggregateShadowMissionReport({
      benchmark: { ...input.benchmark, songs: [song, { ...song, id: "song-a" }] },
    });
    expect(duplicateBenchmarkId.readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(duplicateBenchmarkId.benchmark.songIdsValid).toBe(false);

    const duplicateInventoryId = aggregateShadowMissionReport({
      benchmark: {
        ...input.benchmark,
        inventory: { requiredIds: ["song-a", "song-a"], presentIds: ["song-a"], missingIds: [] },
      },
    });
    expect(duplicateInventoryId.readiness.benchmarkHumanListening).toBe("BLOCKED");
    expect(duplicateInventoryId.sevenSong.inventoryValid).toBe(false);
  });

  it("fails closed before counting malformed validated reference windows", () => {
    const validWindows = [
      { id: "intro", reference: [0, 64], candidate: [0, 64] },
      { id: "body", reference: [64, 128], candidate: [64, 128] },
      { id: "solo", reference: [128, 192], candidate: [128, 192] },
    ];
    const song = {
      id: "song-a", present: true, generationStatus: "symbolic", outputAvailability: "available",
      output: { structuralGate: "pass" },
      reference: { validatedWindows: validWindows, alignment: { status: "aligned" } },
      freeze: { completed: true, beforeReference: true, selectedRecordIds: ["candidate-a"] },
      humanReady: true,
    };
    const base = {
      benchmark: {
        inventory: { requiredIds: ["song-a"], presentIds: ["song-a"], missingIds: [] },
        songs: [song],
      },
    };
    const malformedWindows: unknown[] = [
      null,
      [{ id: "intro", reference: [0, 64], candidate: [0, 64] }, { id: "intro", reference: [64, 128], candidate: [64, 128] }, { id: "solo", reference: [128, 192], candidate: [128, 192] }],
      [{ id: "intro", reference: [-1, 64], candidate: [0, 64] }, ...validWindows.slice(1)],
      [{ id: "intro", reference: [0, 64], candidate: [0] }, ...validWindows.slice(1)],
      [{ id: "intro", reference: [0, Number.NaN], candidate: [0, 64] }, ...validWindows.slice(1)],
    ];
    for (const windows of malformedWindows) {
      const report = aggregateShadowMissionReport({
        benchmark: {
          ...base.benchmark,
          songs: [{ ...song, reference: { validatedWindows: windows, alignment: { status: "aligned" } } }],
        },
      });
      expect(report.readiness.benchmarkHumanListening).toBe("BLOCKED");
      expect(report.benchmark.songs[0]?.referenceWindowsValid).toBe(false);
      expect(report.benchmark.songs[0]?.validatedReferenceWindows).toBeNull();
      expect(report.benchmark.failures.join(" ")).toMatch(/validated reference windows malformed/);
    }
  });

  it("preserves authored candidate freeze order separately from sorted song summaries", () => {
    const report = aggregateShadowMissionReport({
      benchmark: {
        inventory: { requiredIds: ["song-z", "song-a"], presentIds: ["song-z", "song-a"], missingIds: [] },
        songs: [
          { id: "song-z", freeze: { completed: true, beforeReference: true, selectedRecordIds: ["z"] } },
          { id: "song-a", freeze: { completed: true, beforeReference: true, selectedRecordIds: ["a"] } },
        ],
      },
    });
    expect(report.benchmark.songs.map((song) => song.id)).toEqual(["song-a", "song-z"]);
    expect(report.benchmark.candidateFreezeOrder.map((freeze) => freeze.songId)).toEqual(["song-z", "song-a"]);
  });

  it("fails closed for blocked alignment and propagates its diagnostics", () => {
    const report = aggregateShadowMissionReport({
      alignment: { status: "failed", diagnostics: ["/Users/reidar/private/alignment.json"] },
    });
    expect(report.alignment.status).toBe("unavailable");
    expect(report.alignment.failures).toContain("alignment report status: failed");
    expect(report.failures).toContain("alignment report status: failed");
    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
  });

  it("fails closed for incomplete evidence and preserves unknown loss counts", () => {
    const report = aggregateShadowMissionReport({
      shadow: { status: "SHADOW_ENGINEERING_READY", summary: { total: 1, ready: 1, notReady: 0, blocked: 0 }, items: [] },
      alignment: {},
      benchmark: {},
      redBaron: {
        transitions: [{ from: "raw", to: "decoder", loss: { rejected: 1 }, diagnostics: ["/Users/reidar/private/raw.mid"] }],
      },
    });

    expect(report.readiness.shadowEngineering).toBe("BLOCKED");
    expect(report.alignment.status).toBe("unavailable");
    expect(report.benchmark.status).toBe("unavailable");
    expect(report.redBaron.firstLoss).toMatchObject({ transition: "raw->decoder", count: null });
    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
  });

  it("redacts credentials and binary-like payload keys in canonical output", () => {
    const json = canonicalShadowMissionJson({
      diagnostic: "https://user:secret@example.test/source.mid",
      payload: "binary",
      data: "base64",
      nested: { midi: [1, 2, 3], path: "/private/tmp/source.mid" },
    });

    expect(json).toContain("[redacted-credentials]");
    expect(json).not.toContain("secret");
    expect(json).not.toContain('"payload"');
    expect(json).not.toContain('"data"');
    expect(json).not.toContain('"midi"');
    expect(json).not.toContain("/private/tmp");
  });

  it("redacts query strings and path-like trace/source fields", () => {
    const json = canonicalShadowMissionJson({
      trace: {
        source: "https://user:secret@example.test/score.mid?token=private#fragment",
        sourcePath: "/Users/reidar/private/score.mid",
        sourceStem: "/private/tmp/vocals.mid",
      },
    });
    expect(json).toContain("https://[redacted-credentials]@example.test/score.mid");
    expect(json).not.toContain("token=private");
    expect(json).not.toContain("fragment");
    expect(json).not.toContain("/Users/reidar");
    expect(json).not.toContain("/private/tmp");
  });

  it("keeps freeze ordering unknown when a freeze report omits the reference boundary", () => {
    const report = aggregateShadowMissionReport({
      benchmark: { inventory: { requiredIds: ["song-a"], presentIds: ["song-a"], missingIds: [] }, songs: [{ id: "song-a", freeze: { completed: true, selectedRecordIds: ["candidate-a"] } }] },
    });

    expect(report.safety.candidateFreezeBeforeReference).toBeNull();
  });

  it("handles CLI help as a successful, side-effect-free invocation", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runShadowMissionCli(["--help"], {
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
    });
    expect(exitCode).toBe(0);
    expect(output.join(" ")).toMatch(/Usage: report-shadow-mission/);
    expect(errors).toEqual([]);
  });
});
