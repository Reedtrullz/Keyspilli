import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalReferenceReadiness,
  localReferenceReadinessJson,
  localReferenceReadinessMarkdown,
  type LocalReferenceReadinessInput,
} from "../src/local-reference-readiness.js";
import {
  parseLocalReferenceReadinessArgs,
  runLocalReferenceReadinessCli,
} from "../scripts/report-local-reference-readiness.js";

function quality(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = (id: string, state: string, role = "melody") => ({
    backendId: "audiveris",
    backendVersion: "5.11.0",
    available: true,
    page: 1,
    measureId: id,
    measureNumber: id.slice(1),
    measureIndex: Number(id.slice(1)) - 1,
    startBeat: (Number(id.slice(1)) - 1) * 4,
    durationBeats: 4,
    events: [{ onset: 0, duration: 4, pitch: 60, role }],
    state,
    score: state === "BROKEN" ? 0.1 : 0.98,
    diagnostics: state === "BROKEN" ? ["overfull-measure"] : [],
    categories: {
      structuralValidity: { score: state === "BROKEN" ? 0 : 1, flags: state === "BROKEN" ? ["overfull-measure"] : [] },
    },
  });
  return {
    schemaVersion: 1,
    consensusClaim: false,
    nativePriority: false,
    thresholds: {},
    backends: [{ id: "audiveris", version: "5.11.0", status: "available", sourceLabel: "audiveris", priority: "omr", measureCount: 3, availableMeasures: 3, pages: [1], error: null }],
    backendSummaries: [{ id: "audiveris", version: "5.11.0", status: "available", sourceLabel: "audiveris", priority: "omr", measureCount: 3, availableMeasures: 3, pages: [1], error: null, autoAcceptMeasures: 2, likelyOkMeasures: 0, reviewMeasures: 1, brokenMeasures: 0 }],
    measures: [row("m1", "AUTO_ACCEPT"), row("m2", "AUTO_ACCEPT"), row("m3", "REVIEW", "harmony")],
    regionSummaries: [],
    pageSummaries: [],
    ...overrides,
  };
}

function nativeVerification(): Record<string, unknown> {
  return {
    classification: "EXACT_OR_HIGH_CONFIDENCE_MATCH",
    eligibleAsReference: true,
    candidate: {
      id: "publisher-midi",
      artifactType: "midi",
      bytes: 123,
      sha256: "a".repeat(64),
      hashStatus: "verified",
      provenance: "publisher export",
      version: "2024.1",
    },
  };
}

describe("local reference readiness report", () => {
  it("summarizes native match, preferred OMR coverage, role readiness, review regions, and listening artifacts", () => {
    const input: LocalReferenceReadinessInput = {
      scores: [{
        id: "fixture-score",
        artist: "Fixture Artist",
        title: "Fixture",
        state: "MELODY_READY",
        source: { pdf: { status: "ok", identity: { bytes: 321, pages: 1, sha256: "b".repeat(64) } } },
        nativeVerification: nativeVerification(),
        quality: quality(),
        reviewQueue: {
          items: [{ id: "fixture-score:m3:harmony:timing", measureId: "m3", measureNumber: "3", page: 1, system: 1, role: "harmony", reasonCategory: "timing", state: "REVIEW", priorityClass: "medium", evidence: ["duration mismatch"], recommendedAction: "Review measure 3." }],
          unresolvedRegions: ["m3"],
        },
        outputs: { referenceMidi: "scores/fixture/reference.mid", referenceMusicXml: "scores/fixture/reference.musicxml", coverageMask: "scores/fixture/coverage-mask.json", manifest: "scores/fixture/reference-manifest.json", reviewQueue: "scores/fixture/review-queue.json" },
        listening: {
          status: "RENDERED",
          outputs: { fullWav: "full.wav", melodyWav: "melody.wav", accompanimentWav: "accompaniment.wav", openingExcerptWav: "opening.wav", manifest: "manifest.json" },
          renderer: { id: "fluidsynth", version: "2", sampleRate: 44100, channels: 2, gain: 1, targetPeak: 0.95, soundfont: { identifier: "piano.sf2", bytes: 12, sha256: "c".repeat(64) } },
        },
      }],
    };

    const report = buildLocalReferenceReadiness(input);
    const score = report.scores[0]!;
    expect(score.nativeMatch).toMatchObject({ status: "verified-match", classification: "EXACT_OR_HIGH_CONFIDENCE_MATCH", eligible: true });
    expect(score.omr.preferredBackend).toMatchObject({ id: "audiveris", version: "5.11.0" });
    expect(score.omr.preferredCoverage).toMatchObject({ totalMeasures: 3, acceptedMeasures: 2 });
    expect(score.readiness.melody.state).toBe("MELODY_READY");
    expect(score.readiness.harmony.state).toBe("MANUAL_REVIEW_REQUIRED");
    expect(score.review.regions).toHaveLength(1);
    expect(score.review.actualHumanDecisions).toBe(0);
    expect(score.listening.status).toBe("RENDERED");
    expect(score.listening.artifacts.openingExcerptWav).toBe("opening.wav");
    expect(report.humanWorkload.actualHumanDecisions).toBe(0);
  });

  it("does not promote malformed native metadata to a verified match", () => {
    const report = buildLocalReferenceReadiness({
      scores: [{
        id: "malformed-native",
        artist: "Artist",
        title: "Malformed",
        selected: {
          kind: "native",
          id: "publisher-midi",
          classification: "EXACT_OR_HIGH_CONFIDENCE_MATCH",
          sha256: "not-a-sha256",
        },
        native: { selected: true },
      }],
    });
    expect(report.scores[0]?.nativeMatch.eligible).toBe(false);
    expect(report.scores[0]?.nativeMatch.status).toBe("candidate-found");
  });

  it("counts supplied human decisions separately from pending review regions and applies the corpus gate", () => {
    const report = buildLocalReferenceReadiness({
      scores: [
        { id: "a", title: "A", artist: "Artist", state: "MELODY_READY", quality: quality({ measures: [] }), reviewQueue: { items: [{ id: "a:m1:melody:pitch", measureId: "m1", measureNumber: "1", role: "melody", reasonCategory: "pitch", state: "REVIEW", evidence: ["pitch"] }] } },
        { id: "b", title: "B", artist: "Artist", state: "MELODY_READY", quality: quality({ measures: [] }) },
      ],
      humanDecisions: [{ scoreId: "a", itemId: "a:m1:melody:pitch", decision: "accept" }],
    });
    expect(report.scores[0]?.review.actualHumanDecisions).toBe(1);
    expect(report.scores[0]?.review.pendingRegions).toBe(0);
    expect(report.humanWorkload.actualHumanDecisions).toBe(1);
    expect(report.benchmarkGate).toMatchObject({ status: "PROVISIONAL", melodyReadyScores: 2, decision: "build-provisional-benchmark" });
  });

  it("uses independent OMR role-quality readiness and backend preferences", () => {
    const report = buildLocalReferenceReadiness({
      scores: [{
        id: "role-quality",
        artist: "Artist",
        title: "Role quality",
        state: "VALIDATED_DRAFT",
        omr: {
          preferredBackend: "audiveris",
          preferredBackendByRole: {
            melody: { id: "audiveris", version: "5.11.0" },
            harmony: { id: "homr", version: "0.3.0" },
            rhythm: null,
          },
          roleQuality: {
            roleReadiness: {
              melody: {
                readiness: "READY",
                coverage: 1,
                eligibleMeasures: 12,
                availableMeasures: 12,
                trustedMeasures: 12,
                reviewMeasures: 0,
                brokenMeasures: 0,
                preferredBackendId: "audiveris",
                preferredBackendVersion: "5.11.0",
              },
              harmony: {
                readiness: "READY",
                coverage: 0.9,
                eligibleMeasures: 10,
                availableMeasures: 9,
                trustedMeasures: 9,
                reviewMeasures: 0,
                brokenMeasures: 0,
                preferredBackendId: "homr",
                preferredBackendVersion: "0.3.0",
              },
              rhythm: {
                readiness: "UNAVAILABLE",
                coverage: null,
                eligibleMeasures: 0,
                availableMeasures: 0,
                trustedMeasures: 0,
                reviewMeasures: 0,
                brokenMeasures: 0,
                preferredBackendId: null,
                preferredBackendVersion: null,
              },
            },
          },
        },
        // The global selected artifact may still contain a review row for
        // harmony; role-quality readiness must use the independent HOMR lane.
        quality: quality(),
      }],
    });

    const score = report.scores[0]!;
    expect(score.readiness.melody.state).toBe("MELODY_READY");
    expect(score.readiness.harmony.state).toBe("HARMONY_READY");
    expect(score.readiness.harmony).toMatchObject({
      eligible: true,
      trustedPercent: 90,
      trustedMeasures: 9,
      availableMeasures: 9,
      reviewRegions: 1,
      preferredBackend: { id: "homr", version: "0.3.0" },
      readiness: "READY",
      eligibleMeasures: 10,
      reviewMeasures: 0,
      brokenMeasures: 0,
    });
    expect(score.omr.preferredBackend).toMatchObject({ id: "audiveris" });
    expect(report.summary.harmonyReadyAutomatically).toBe(1);
    expect(report.benchmarkGate.harmonyReadyScores).toBe(1);
  });

  it("surfaces corpus role groups as stable actionable regions and accepts group decisions", () => {
    const group = {
      id: "homr:melody:P1:m2-P1:m4",
      backendId: "homr",
      backendVersion: "0.7.0",
      role: "melody",
      measureIds: ["P1:m4", "P1:m2", "P1:m3"],
      firstMeasureIndex: 1,
      lastMeasureIndex: 3,
      startBeat: 4,
      endBeat: 16,
      pageSystems: [{ page: 2, system: 1 }, { page: 3, system: 1 }],
      rootCauses: ["impossible-leap", "continuity-overlap"],
      priorityClass: "high",
      memberCount: 3,
      estimatedEventCount: 7,
      confidence: { min: 0.2, median: 0.5, max: 0.8 },
    };
    const input: LocalReferenceReadinessInput = {
      scores: [{
        id: "grouped-score",
        artist: "Artist",
        title: "Grouped",
        state: "VALIDATED_DRAFT",
        quality: quality({ measures: [] }),
        review: {
          actionableItems: 1,
          totalItems: 3,
          melodyCritical: 1,
          roleGroups: [group],
        },
        reviewQueue: {
          items: [{
            id: "legacy-m2",
            measureId: "P1:m2",
            measureNumber: "2",
            role: "melody",
            reasonCategory: "pitch",
            state: "REVIEW",
            evidence: ["legacy queue item should be covered by group"],
          }],
        },
      }],
      humanDecisions: [{ scoreId: "grouped-score", itemId: group.id, decision: "accept" }],
    };
    const report = buildLocalReferenceReadiness(input);
    const score = report.scores[0]!;
    expect(score.review.regions).toHaveLength(1);
    expect(score.review.regions[0]).toMatchObject({
      id: group.id,
      measureId: "P1:m2",
      measureIds: ["P1:m2", "P1:m3", "P1:m4"],
      page: 2,
      system: 1,
      role: "melody",
      reasonCategory: "articulation",
      state: "REVIEW",
      priority: "high",
      backendId: "homr",
      backendVersion: "0.7.0",
      firstMeasureIndex: 1,
      lastMeasureIndex: 3,
      startBeat: 4,
      endBeat: 16,
      memberCount: 3,
      estimatedEventCount: 7,
      confidence: { min: 0.2, median: 0.5, max: 0.8 },
    });
    expect(score.review.regions[0]?.evidence).toEqual([
      "continuity-overlap",
      "estimated 7 events",
      "grouped 3 measures",
      "impossible-leap",
    ]);
    expect(score.review.regions[0]?.decision).toBe("accepted");
    expect(score.review.totalRegions).toBe(1);
    expect(score.review.pendingRegions).toBe(0);
    expect(score.review.actualHumanDecisions).toBe(1);
    expect(report.humanWorkload).toMatchObject({ totalReviewRegions: 1, pendingRegions: 0, actualHumanDecisions: 1 });
    expect(JSON.stringify(report)).not.toContain("legacy queue item should be covered by group");
    expect(localReferenceReadinessJson(report)).toBe(localReferenceReadinessJson(buildLocalReferenceReadiness(input)));
  });

  it("fails closed for missing evidence, groups raw quality rows, and stays path-free/deterministic", () => {
    const input: LocalReferenceReadinessInput = {
      scores: [{ id: "missing", title: "Missing", artist: "Artist", quality: quality({ measures: [
        { backendId: "audiveris", backendVersion: "5.11.0", available: true, page: 1, measureId: "m1", measureNumber: "1", measureIndex: 0, startBeat: 0, durationBeats: 4, events: [], state: "BROKEN", diagnostics: ["invalid-measure-duration", "impossible-leap"] },
        { backendId: "homr", backendVersion: "1", available: true, page: 1, measureId: "m1", measureNumber: "1", measureIndex: 0, startBeat: 0, durationBeats: 4, events: [], state: "BROKEN", diagnostics: ["invalid-measure-duration"] },
      ] }), metadata: { sourcePath: "/Users/reidar/private/score.pdf", outputDirectory: "/private/tmp/out" } }],
    };
    const first = buildLocalReferenceReadiness(input);
    const second = buildLocalReferenceReadiness(input);
    expect(first.scores[0]?.nativeMatch.status).toBe("not-found");
    expect(first.scores[0]?.readiness.melody.state).toBe("FAILED");
    expect(first.scores[0]?.review.regions.length).toBe(2);
    expect(JSON.stringify(first)).not.toContain("/Users/reidar");
    expect(JSON.stringify(first)).not.toContain("/private/tmp");
    expect(localReferenceReadinessJson(first)).toBe(localReferenceReadinessJson(second));
  });

  it("renders a compact final-report table without inventing human decisions", () => {
    const report = buildLocalReferenceReadiness({ scores: [{ id: "a", artist: "Artist", title: "A", state: "FAILED" }] });
    const markdown = localReferenceReadinessMarkdown(report);
    expect(markdown).toContain("| Score | Native match | Preferred backend | Melody | Harmony | Review regions | Human decisions | Listening |");
    expect(markdown).toContain("- Rhythm-critical review regions: 0");
    expect(markdown).toContain("No actual human decisions supplied.");
  });
});

describe("local reference readiness CLI contract", () => {
  it("parses local-only input/output and format flags", () => {
    const options = parseLocalReferenceReadinessArgs([
      "--input", "/private/tmp/readiness-input.json",
      "--out=/private/tmp/readiness.md",
      "--format", "markdown",
      "--listening", "/private/tmp/listening.json",
      "--human-decisions=/private/tmp/decisions.json",
    ]);
    expect(options).toMatchObject({
      input: "/private/tmp/readiness-input.json",
      out: "/private/tmp/readiness.md",
      format: "markdown",
      listening: "/private/tmp/listening.json",
      humanDecisions: "/private/tmp/decisions.json",
      help: false,
    });
    expect(parseLocalReferenceReadinessArgs(["--help"]).help).toBe(true);
    expect(() => parseLocalReferenceReadinessArgs(["--input", "/private/tmp/a.json", "--format", "yaml"]))
      .toThrow("--format must be json or markdown");
  });

  it("is exercised by the CLI test through a local JSON report and output file", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-readiness-cli-"));
    try {
      const input = join(root, "input.json");
      const output = join(root, "readiness.md");
      await writeFile(input, JSON.stringify({ scores: [{ id: "fixture", artist: "Artist", title: "Fixture", state: "FAILED" }] }));
      await expect(readFile(input, "utf8")).resolves.toContain("fixture");
      await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const stdout: string[] = [];
      const stderr: string[] = [];
      await expect(runLocalReferenceReadinessCli([
        "--input", input,
        "--out", output,
        "--format", "markdown",
      ], { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) })).resolves.toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("written (markdown)");
      const report = await readFile(output, "utf8");
      expect(report).toContain("# Local reference readiness");
      expect(report).toContain("FAILED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
