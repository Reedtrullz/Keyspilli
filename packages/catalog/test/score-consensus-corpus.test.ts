import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalScoreConsensusCorpusJson,
  createScoreConsensusReport,
  parseMusicXmlScore,
  parseScoreConsensusArgs,
  runScoreConsensusCorpus,
  summarizeScoreConsensus,
  type ScoreConsensusScoreInput,
} from "../src/score-consensus-corpus.js";

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
});
