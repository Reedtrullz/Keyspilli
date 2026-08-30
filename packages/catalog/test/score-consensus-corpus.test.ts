import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalScoreConsensusCorpusJson,
  combineHomrPageScores,
  createScoreConsensusReport,
  parseMusicXmlScore,
  parseScoreConsensusArgs,
  renderHomrRecoverySummaryMarkdown,
  runHomrPages,
  runScoreConsensusCorpus,
  summarizeHomrRecovery,
  summarizeScoreConsensus,
  type ScoreConsensusScoreInput,
} from "../src/score-consensus-corpus.js";
import { normalizeOmrScore } from "../src/omr-consensus.js";

const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <movement-title>Fixture</movement-title>
  <part-list>
    <score-part id="P1"><part-name>Lead</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><tie type="start"/></note>
      <forward><duration>12</duration></forward>
    </measure>
  </part>
</score-partwise>`;

function scoreInput(overrides: Partial<ScoreConsensusScoreInput> = {}): ScoreConsensusScoreInput {
  const parsed = parseMusicXmlScore(xml);
  return {
    id: "fixture-score",
    artist: "Fixture Artist",
    title: "Fixture",
    previousStatus: "REVIEW_REQUIRED",
    source: { fileName: "Fixture.pdf", sha256: "a".repeat(64), bytes: 123, pages: 1 },
    audiveris: { id: "audiveris", version: "5.11.0", score: parsed },
    homr: { id: "homr", version: "unavailable", status: "unavailable", error: "optional backend not installed" },
    ...overrides,
  };
}

describe("local score consensus corpus orchestration", () => {
  it("normalizes MusicXML measures, voices, roles, ties, and backups", () => {
    const parsed = parseMusicXmlScore(xml);
    const firstPart = parsed.parts[0]!;
    expect(parsed.parts).toHaveLength(1);
    expect(firstPart.measures).toHaveLength(2);
    expect((firstPart.measures[0]!.events ?? []).map((event) => [event.onset, event.pitch, event.role])).toEqual([
      [0, 60, "melody"], [1, 64, "melody"], [0, 48, "melody"],
    ]);
    expect((firstPart.measures[1]!.events ?? [])[0]!.tie).toEqual({ start: true, stop: false, continue: false });
    expect(firstPart.measures[1]!.startBeat).toBe(4);
    expect(firstPart.measures[0]!.durationBeats).toBe(4);
  });

  it("builds an additive report with single-engine fallback and role eligibility", () => {
    const report = createScoreConsensusReport(scoreInput());
    expect(report.consensus.backends).toMatchObject([
      { id: "audiveris", status: "available" },
      { id: "homr", status: "unavailable" },
    ]);
    expect(report.consensus.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
    expect(report.benchmark.melody.eligible).toBe(true);
    expect(report.benchmark.harmony.eligible).toBe(false);
    expect(report).not.toHaveProperty("absolutePath");
  });

  it("redacts paths from caller metadata before it enters the report", () => {
    const report = createScoreConsensusReport(scoreInput({ metadata: {
      sourcePath: "/Users/reidar/Downloads/score.musicxml",
      nested: { outputDirectory: "/private/tmp/score-output", logical: "fixture" },
    } }));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("/Users/reidar");
    expect(serialized).not.toContain("/private/tmp/score-output");
    expect(serialized).toContain("[redacted-path]");
  });

  it("keeps raster references relative in direct report construction", () => {
    const report = createScoreConsensusReport(scoreInput({
      raster: {
        renderer: { id: "pdftoppm", version: "1", dpi: 300, format: "png", crop: "none", rotation: 0 },
        pages: [{ page: 1, relativePath: "/Users/reidar/page-1.png", width: 100, height: 100, bytes: 10, sha256: "b" }],
      },
    }));
    expect(report.raster?.pages).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
  });

  it("summarizes scores deterministically and preserves the prior baseline", () => {
    const first = summarizeScoreConsensus([createScoreConsensusReport(scoreInput())], { previousReviewRequired: 8, previousFailed: 1 });
    const second = summarizeScoreConsensus([createScoreConsensusReport(scoreInput())], { previousReviewRequired: 8, previousFailed: 1 });
    expect(first.before).toEqual({ reviewRequired: 8, failed: 1 });
    expect(first.totals.scoreCount).toBe(1);
    expect(first.totals.trustedMeasures).toBeGreaterThan(0);
    expect(first.determinismSha256).toBe(second.determinismSha256);
    expect(canonicalScoreConsensusCorpusJson(first)).toBe(canonicalScoreConsensusCorpusJson(second));
  });

  it("keeps missing PDFs, skipped HOMR, and exhausted recovery pages distinct", () => {
    const skipped = createScoreConsensusReport(scoreInput({
      id: "skipped-score",
      metadata: { pdfAvailable: false, xmlAvailable: true },
    }));
    const attempted = createScoreConsensusReport(scoreInput({
      id: "attempted-score",
      metadata: { pdfAvailable: true, xmlAvailable: true },
      homr: {
        id: "homr",
        version: "0.7.0",
        status: "failed",
        metadata: {
          requestedPages: 2,
          availablePages: 1,
          unavailablePages: 0,
          failedPages: 1,
          pages: [
            {
              page: 1,
              status: "available",
              recovery: { attempted: true, recovered: true, attempts: 2 },
              attempts: [
                { attempt: 1, status: "failed", failureClass: "signal", rootCause: "HOMR crashed" },
                { attempt: 2, status: "available", trusted: true },
              ],
            },
            {
              page: 2,
              status: "broken-output",
              recovery: { attempted: true, recovered: false, attempts: 5 },
              attempts: [
                { attempt: 1, status: "failed", failureClass: "process-failed", rootCause: "invalid MusicXML" },
                { attempt: 2, status: "broken-output", failureClass: "broken-output", rootCause: "empty output" },
              ],
            },
          ],
        },
      },
    }));
    const report = summarizeHomrRecovery([attempted, skipped]);
    expect(report.scoreCount).toBe(2);
    expect(report.totals.sourcePdf).toEqual({ available: 1, missing: 1, unknown: 0 });
    expect(report.totals.homrRequestedScores).toBe(1);
    expect(report.totals.recoveredPages).toBe(1);
    expect(report.totals.exhaustedPages).toBe(1);
    expect(report.totals.attempts).toBe(4);
    expect(report.totals.failureClasses).toEqual({ "broken-output": 1, "process-failed": 1, signal: 1 });
    expect(report.scores[0]?.id).toBe("attempted-score");
    expect(report.scores[1]?.homr.status).toBe("not-requested");
    expect(renderHomrRecoverySummaryMarkdown(report)).toContain("Missing source PDFs");
    expect(JSON.stringify(report)).not.toContain("/private/");
  });

  it("redacts local paths and nondeterministic timestamps from canonical corpus JSON", () => {
    const canonical = canonicalScoreConsensusCorpusJson({
      generatedAt: "2026-08-30T00:00:00.000Z",
      sourcePath: "/Users/reidar/private/reference.musicxml",
      nested: { outputDirectory: "/private/tmp/omr", label: "reference" },
    });
    expect(canonical).not.toContain("generatedAt");
    expect(canonical).not.toContain("/Users/reidar");
    expect(canonical).not.toContain("/private/tmp");
    expect(canonical).toContain("[redacted-path]");
  });

  it("accepts only explicit local corpus/output roots and writes path-safe reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-consensus-corpus-"));
    const corpus = join(root, "input");
    const output = join(root, "output");
    const scoreDir = join(corpus, "scores", "fixture-score");
    try {
      await writeFile(join(root, "placeholder"), "ok");
      await import("node:fs/promises").then(({ mkdir }) => mkdir(corpus, { recursive: true }));
      await writeFile(join(corpus, "corpus-summary.json"), JSON.stringify({ scores: [] }));
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(scoreDir, "normalized"), { recursive: true }));
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(scoreDir, "validation"), { recursive: true }));
      await writeFile(join(scoreDir, "normalized", "reference.musicxml"), xml);
      await writeFile(join(scoreDir, "validation", "report.json"), JSON.stringify({ status: "REVIEW_REQUIRED", source: { fileName: "Fixture.pdf", sha256: "a".repeat(64), bytes: 123, pages: 1 }, omr: { backend: "Audiveris", version: "5.11.0", status: "PASS" } }));
      await writeFile(join(scoreDir, "source-metadata.json"), JSON.stringify({ sourcePdf: { fileName: "Fixture.pdf", sha256: "a".repeat(64), bytes: 123, pages: 1 } }));

      const result = await runScoreConsensusCorpus({ corpusRoot: corpus, outputRoot: output });
      expect(result.scores).toHaveLength(1);
      expect(result.scores[0]?.consensus.summary.state).toBe("TRUSTED_SINGLE_ENGINE");
      expect(JSON.stringify(result)).not.toContain(corpus);
      expect(JSON.stringify(result)).not.toContain(output);
      expect(JSON.parse(await readFile(join(output, "consensus-summary.json"), "utf8")).schemaVersion).toBe(1);
      const recovery = JSON.parse(await readFile(join(output, "homr-recovery-summary.json"), "utf8")) as { scoreCount?: number; scores?: Array<{ homr?: { status?: string } }> };
      expect(recovery.scoreCount).toBe(1);
      expect(recovery.scores?.[0]?.homr?.status).toBe("not-requested");
      const events = JSON.parse(await readFile(join(output, "scores", "fixture-score", "consensus", "events.json"), "utf8")) as { events?: unknown[] };
      expect(events.events).toHaveLength(4);
      const review = JSON.parse(await readFile(join(output, "scores", "fixture-score", "review", "items.json"), "utf8")) as { pageRefs?: unknown[] };
      expect(review.pageRefs).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("includes score ids present in the prior corpus summary even when their directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-consensus-missing-score-"));
    const corpus = join(root, "input");
    const output = join(root, "output");
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(corpus, "scores", "present"), { recursive: true }));
      await writeFile(join(corpus, "corpus-summary.json"), JSON.stringify({ scores: [
        { id: "present", artist: "A", title: "Present", status: "REVIEW_REQUIRED" },
        { id: "missing", artist: "B", title: "Missing", status: "FAILED" },
      ] }));
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(corpus, "scores", "present", "normalized"), { recursive: true }));
      await writeFile(join(corpus, "scores", "present", "normalized", "reference.musicxml"), xml);

      const result = await runScoreConsensusCorpus({ corpusRoot: corpus, outputRoot: output });
      expect(result.scores.map((score) => score.id)).toEqual(["missing", "present"]);
      expect(result.scores.find((score) => score.id === "missing")?.consensus.summary.state).toBe("FAILED");
      expect(await readFile(join(output, "scores", "missing", "consensus", "events.json"), "utf8")).toContain('"events": []');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the output root is reused or overlaps the input corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-consensus-output-guard-"));
    const corpus = join(root, "input");
    const output = join(root, "output");
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(corpus, "scores"), { recursive: true }));
      await writeFile(join(output), "occupied");
      await expect(runScoreConsensusCorpus({ corpusRoot: corpus, outputRoot: output })).rejects.toThrow(/fresh|empty/i);
      await rm(output, { force: true });
      await expect(runScoreConsensusCorpus({ corpusRoot: corpus, outputRoot: corpus })).rejects.toThrow(/outside|overlap/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses optional backend flags without making homr a startup dependency", () => {
    expect(parseScoreConsensusArgs(["--corpus", "/private/tmp/corpus", "--out", "/private/tmp/out", "--homr", "/opt/homr", "--rasterize", "--dpi", "400"])).toMatchObject({
      corpusRoot: "/private/tmp/corpus",
      outputRoot: "/private/tmp/out",
      homr: "/opt/homr",
      rasterize: true,
      dpi: 400,
    });
    expect(() => parseScoreConsensusArgs(["--corpus", "/private/tmp/corpus"])).toThrow(/--out/);
  });

  it("treats a bare homr flag as the automatic pinned runner while preserving explicit executables", () => {
    expect(parseScoreConsensusArgs(["--corpus", "/private/tmp/corpus", "--out", "/private/tmp/out", "--homr"]).homr).toBe("auto");
    expect(parseScoreConsensusArgs(["--corpus", "/private/tmp/corpus", "--out", "/private/tmp/out", "--homr", "/opt/homr"]).homr).toBe("/opt/homr");
    expect(parseScoreConsensusArgs(["--corpus", "/private/tmp/corpus", "--out", "/private/tmp/out", "--homr=/opt/homr"]).homr).toBe("/opt/homr");
  });

  it("combines valid HOMR page scores in page order with namespaced IDs and cumulative beat offsets", () => {
    const pageOne = parseMusicXmlScore(xml);
    const pageTwo = parseMusicXmlScore(xml.replace("<movement-title>Fixture</movement-title>", "<movement-title>Page two</movement-title>"));
    const combined = combineHomrPageScores([
      { page: 2, relativePath: "page-2.png", score: pageTwo },
      { page: 1, relativePath: "page-1.png", score: pageOne },
    ]);
    expect(combined).not.toBeNull();
    const normalized = normalizeOmrScore(combined!);
    expect(normalized.parts.map((part) => part.id)).toEqual(["page-1:P1", "page-2:P1"]);
    expect(normalized.measures.map((measure) => [measure.id, measure.page, measure.startBeat])).toEqual([
      ["page-1:P1:m1", 1, 0],
      ["page-1:P1:m2", 1, 4],
      ["page-2:P1:m1", 2, 8],
      ["page-2:P1:m2", 2, 12],
    ]);
    expect(normalized.measures.flatMap((measure) => measure.events).map((event) => event.measureId)).toContain("page-2:P1:m2");
  });

  it("keeps partial HOMR page health and invocation diagnostics in the report while retaining valid score evidence", () => {
    const homrScore = combineHomrPageScores([{ page: 1, relativePath: "page-1.png", score: parseMusicXmlScore(xml) }]);
    const report = createScoreConsensusReport(scoreInput({
      homr: {
        id: "homr",
        version: "0.3.1",
        status: "available",
        score: homrScore,
        error: "page 2: MusicXML output was invalid",
        metadata: {
          health: "partial",
          model: "homr",
          invocation: { strategy: "one-page-per-invocation", count: 2 },
          pages: [
            { page: 1, status: "available", measureCount: 2 },
            { page: 2, status: "failed", errors: ["MusicXML output was invalid"] },
          ],
        },
      },
    }));
    const metadata = report.consensus.metadata as { backendRuns?: Array<{ id: string; metadata?: { health?: string; pages?: unknown[] } }> };
    const homr = metadata.backendRuns?.find((backend) => backend.id === "homr");
    expect(homr?.metadata?.health).toBe("partial");
    expect(homr?.metadata?.pages).toHaveLength(2);
    expect(report.consensus.backends.find((backend) => backend.id === "homr")).toMatchObject({ status: "available", measureCount: 2 });
  });

  it("invokes one grouped HOMR backend call and keeps broken pages closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-homr-pages-"));
    const calls: Array<{ imagePaths: readonly string[]; outputDirectory: string }> = [];
    try {
      const validPageXml = xml.replace("<movement-title>Fixture</movement-title>", "<movement-title>Page one</movement-title>");
      const run = await runHomrPages({
        scoreId: "fixture-score",
        outputRoot: root,
        homr: "/opt/homr",
        raster: {
          renderer: { id: "pdftoppm", version: "1", dpi: 300, format: "png", crop: "none", rotation: 0 },
          pages: [
            { page: 2, relativePath: "page-2.png", width: 100, height: 100, bytes: 10, sha256: "b" },
            { page: 1, relativePath: "page-1.png", width: 100, height: 100, bytes: 10, sha256: "a" },
          ],
        },
        createBackend: () => ({
          id: "homr",
          version: "0.7.0",
          async recognize(input) {
            calls.push(input);
            await mkdir(input.outputDirectory, { recursive: true });
            await mkdir(join(input.outputDirectory, "page-1"), { recursive: true });
            await mkdir(join(input.outputDirectory, "page-2"), { recursive: true });
            await writeFile(join(input.outputDirectory, "page-1", "result.musicxml"), validPageXml, "utf8");
            await writeFile(join(input.outputDirectory, "page-2", "result.musicxml"), "not MusicXML", "utf8");
            return {
              backend: "homr",
              version: "0.7.0",
              status: "pass" as const,
              health: "partially-available" as const,
              artifacts: [
                { relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: 1, sha256: "0".repeat(64) },
                { relativePath: "page-2/result.musicxml", format: "musicxml" as const, bytes: 1, sha256: "1".repeat(64) },
              ],
              pages: [
                { page: 1, relativeInput: "page-1/input.png", status: "available" as const, elapsedMs: 10, exitCode: 0, artifacts: [{ relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: 1, sha256: "0".repeat(64) }], measureCount: 2, noteCount: 4, staffCount: 1, warnings: [], errors: [] },
                { page: 2, relativeInput: "page-2/input.png", status: "broken-output" as const, elapsedMs: 11, exitCode: 0, artifacts: [{ relativePath: "page-2/result.musicxml", format: "musicxml" as const, bytes: 1, sha256: "1".repeat(64) }], measureCount: 0, noteCount: 0, staffCount: 0, warnings: [], errors: ["malformed MusicXML"] },
              ],
              warnings: [],
              errors: ["page 2: malformed MusicXML"],
            };
          },
        }),
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.imagePaths.map((path) => path.split("/").at(-1))).toEqual(["page-1.png", "page-2.png"]);
      expect(calls[0]?.outputDirectory).toBe(join(root, "scores", "fixture-score", "backends", "homr"));
      expect(run.status).toBe("available");
      expect(run.score).toBeDefined();
      expect(normalizeOmrScore(run.score!).measures).toHaveLength(2);
      expect((run.metadata as { health: string; invocationCount: number; availablePages: number; failedPages: number }).health).toBe("partial");
      expect((run.metadata as { invocationCount: number }).invocationCount).toBe(2);
      expect((run.metadata as { availablePages: number }).availablePages).toBe(1);
      expect((run.metadata as { failedPages: number }).failedPages).toBe(1);
      expect(run.error).toMatch(/page 2/i);
      expect(JSON.stringify(run.metadata)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps HOMR pages and aggregate artifacts by invocation index for non-contiguous raster pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-homr-index-map-"));
    try {
      const run = await runHomrPages({
        scoreId: "fixture-score",
        outputRoot: root,
        homr: "/opt/homr",
        raster: {
          renderer: { id: "pdftoppm", version: "1", dpi: 300, format: "png", crop: "none", rotation: 0 },
          pages: [
            { page: 10, relativePath: "page-10.png", width: 100, height: 100, bytes: 10, sha256: "b" },
            { page: 2, relativePath: "page-2.png", width: 100, height: 100, bytes: 10, sha256: "a" },
          ],
        },
        createBackend: () => ({
          id: "homr",
          version: "0.7.0",
          async recognize(input) {
            await mkdir(join(input.outputDirectory, "page-1"), { recursive: true });
            await mkdir(join(input.outputDirectory, "page-2"), { recursive: true });
            await writeFile(join(input.outputDirectory, "page-1", "result.musicxml"), xml, "utf8");
            await writeFile(join(input.outputDirectory, "page-2", "result.musicxml"), xml, "utf8");
            return {
              backend: "homr",
              version: "0.7.0",
              status: "pass" as const,
              health: "available" as const,
              artifacts: [
                { relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: xml.length, sha256: "0".repeat(64) },
                { relativePath: "page-2/result.musicxml", format: "musicxml" as const, bytes: xml.length, sha256: "1".repeat(64) },
              ],
              pages: [
                { page: 1, relativeInput: "page-1/input.png", status: "available" as const, elapsedMs: 10, exitCode: 0, artifacts: undefined as unknown as [], measureCount: 2, noteCount: 4, staffCount: 1, warnings: [], errors: [] },
                { page: 2, relativeInput: "page-2/input.png", status: "available" as const, elapsedMs: 11, exitCode: 0, artifacts: undefined as unknown as [], measureCount: 2, noteCount: 4, staffCount: 1, warnings: [], errors: [] },
              ],
              invocation: { mode: "executable" as const, executable: "homr", packageName: "homr", version: "0.7.0", forceCpu: true, perPage: true as const, args: ["<relative-page-image>"] },
              model: { id: "homr" as const, packageName: "homr", version: "0.7.0", runtime: "executable" as const, forceCpu: true, source: "external-executable" as const, cache: "external" as const },
              warnings: [],
              errors: [],
            };
          },
        }),
      });
      const metadata = run.metadata as { pages: Array<{ page: number; artifactPaths: string[] }>; backendHealth?: string };
      expect(metadata.pages.map((page) => [page.page, page.artifactPaths])).toEqual([
        [2, ["page-1/result.musicxml"]],
        [10, ["page-2/result.musicxml"]],
      ]);
      expect((run.pages as Array<{ page: number }> | undefined)?.map((page) => page.page)).toEqual([1, 2]);
      expect(run.health).toBe("available");
      expect(run.invocation).toMatchObject({ mode: "executable", executable: "homr" });
      expect(run.model).toMatchObject({ id: "homr", version: "0.7.0" });
      expect(normalizeOmrScore(run.score!).measures.map((measure) => measure.page)).toEqual([2, 2, 10, 10]);
      expect(JSON.stringify(run)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks malformed artifacts broken even when HOMR reports an available page and health", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-homr-broken-artifact-"));
    try {
      const run = await runHomrPages({
        scoreId: "fixture-score",
        outputRoot: root,
        homr: "/opt/homr",
        raster: {
          renderer: { id: "pdftoppm", version: "1", dpi: 300, format: "png", crop: "none", rotation: 0 },
          pages: [{ page: 7, relativePath: "page-7.png", width: 100, height: 100, bytes: 10, sha256: "a" }],
        },
        createBackend: () => ({
          id: "homr",
          version: "0.7.0",
          async recognize(input) {
            await mkdir(join(input.outputDirectory, "page-1"), { recursive: true });
            await writeFile(join(input.outputDirectory, "page-1", "result.musicxml"), "", "utf8");
            return {
              backend: "homr",
              version: "0.7.0",
              status: "pass" as const,
              health: "available" as const,
              artifacts: [{ relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: 0, sha256: "0".repeat(64) }],
              pages: [{ page: 1, relativeInput: "page-1/input.png", status: "available" as const, elapsedMs: 10, exitCode: 0, artifacts: [{ relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: 0, sha256: "0".repeat(64) }], measureCount: 2, noteCount: 4, staffCount: 1, warnings: [], errors: [] }],
              invocation: { mode: "executable" as const, executable: "homr", packageName: "homr", version: "0.7.0", forceCpu: true, perPage: true as const, args: [] },
              model: "homr@0.7.0",
              warnings: [],
              errors: [],
            };
          },
        }),
      });
      const metadata = run.metadata as { pages: Array<{ status: string }>; backendHealth?: string; rawBackendHealth?: string };
      expect(metadata.pages[0]?.status).toBe("broken-output");
      expect(metadata.backendHealth).toBe("broken-output");
      expect(metadata.rawBackendHealth).toBe("available");
      expect(run.health).toBe("broken-output");
      expect((run.pages as Array<{ status?: string }> | undefined)?.[0]?.status).toBe("broken-output");
      expect(run.status).toBe("failed");
      expect(run.error).toMatch(/malformed|empty|musicxml/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the resolved executable when automatic uvx probing falls back", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-homr-fallback-metadata-"));
    try {
      const run = await runHomrPages({
        scoreId: "fixture-score",
        outputRoot: root,
        homr: "auto",
        raster: {
          renderer: { id: "pdftoppm", version: "1", dpi: 300, format: "png", crop: "none", rotation: 0 },
          pages: [{ page: 1, relativePath: "page-1.png", width: 100, height: 100, bytes: 10, sha256: "a" }],
        },
        createBackend: () => ({
          id: "homr",
          version: "0.7.0",
          async recognize(input) {
            await mkdir(join(input.outputDirectory, "page-1"), { recursive: true });
            await writeFile(join(input.outputDirectory, "page-1", "result.musicxml"), xml, "utf8");
            return {
              backend: "homr",
              version: "0.7.0",
              status: "pass" as const,
              health: "available" as const,
              artifacts: [{ relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: xml.length, sha256: "0".repeat(64) }],
              pages: [{ page: 1, relativeInput: "page-1/input.png", status: "available" as const, elapsedMs: 1, exitCode: 0, artifacts: [{ relativePath: "page-1/result.musicxml", format: "musicxml" as const, bytes: xml.length, sha256: "0".repeat(64) }], measureCount: 2, noteCount: 4, staffCount: 1, warnings: [], errors: [] }],
              invocation: { mode: "executable" as const, executable: "homr", packageName: "homr", version: "0.7.0", forceCpu: true, perPage: true as const, args: ["--gpu", "no"] },
              model: { id: "homr" as const, packageName: "homr", version: "0.7.0", runtime: "executable" as const, forceCpu: true, source: "external-executable" as const, cache: "external" as const },
              warnings: [],
              errors: [`HOMR uvx resolution failed: package unavailable at ${root}/cache`],
            };
          },
        }),
      });
      const metadata = run.metadata as { mode: string; resolvedMode?: string; executable: string; package: string | null; resolutionError?: string };
      expect(metadata).toMatchObject({ mode: "auto", resolvedMode: "executable", executable: "homr", package: null });
      expect(metadata.resolutionError).toMatch(/resolution failed/);
      expect(run.invocation).toMatchObject({ mode: "executable", executable: "homr" });
      expect(run.model).toMatchObject({ runtime: "executable", source: "external-executable" });
      expect(run.error).toMatch(/resolution failed/);
      expect(run.error).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
