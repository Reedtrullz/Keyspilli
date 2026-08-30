import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBatchArgs, runScoreCorpusBatch, writeScoreCorpusJson } from "../scripts/build-score-corpus.js";

describe("build-score-corpus CLI arguments", () => {
  it("parses repeatable PDFs and deterministic listening options", () => {
    const options = parseBatchArgs([
      "--out", "/private/tmp/score-corpus",
      "--pdf", "/Users/reidar/Downloads/Free_Bird.pdf",
      "--pdf=/Users/reidar/Downloads/Sabaton - 1916.pdf",
      "--seed", "nightly-1",
      "--target-seconds", "150",
      "--min-seconds", "120",
      "--max-seconds", "180",
      "--exclude-review",
      "--no-notation",
    ]);

    expect(options.pdfs).toEqual([
      "/Users/reidar/Downloads/Free_Bird.pdf",
      "/Users/reidar/Downloads/Sabaton - 1916.pdf",
    ]);
    expect(options.out).toBe("/private/tmp/score-corpus");
    expect(options.seed).toBe("nightly-1");
    expect(options.targetSeconds).toBe(150);
    expect(options.minSeconds).toBe(120);
    expect(options.maxSeconds).toBe(180);
    expect(options.includeReview).toBe(false);
    expect(options.noNotation).toBe(true);
  });

  it("fails closed for a missing output or invalid duration ordering", () => {
    expect(() => parseBatchArgs(["--pdf", "/tmp/score.pdf"])).toThrow(/--out is required/);
    expect(() => parseBatchArgs([
      "--out", "/private/tmp/score-corpus",
      "--pdf", "/tmp/score.pdf",
      "--min-seconds", "20",
      "--target-seconds", "10",
    ])).toThrow(/min-seconds/);
  });

  it("atomically replaces a batch JSON symlink without touching its target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-corpus-atomic-"));
    try {
      const victim = join(directory, "victim.json");
      const output = join(directory, "manifest.json");
      await writeFile(victim, "keep me", "utf8");
      await symlink(victim, output);

      await writeScoreCorpusJson(output, { schemaVersion: 1, status: "ok" });

      expect(await readFile(victim, "utf8")).toBe("keep me");
      expect((await lstat(output)).isSymbolicLink()).toBe(false);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual({ schemaVersion: 1, status: "ok" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps failed conversions in the summary without creating empty corpus entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-corpus-failure-"));
    try {
      const pdf = join(directory, "failed-score.pdf");
      const output = join(directory, "corpus");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");

      const exitCode = await runScoreCorpusBatch([
        "--out", output,
        "--pdf", pdf,
        "--audiveris", join(directory, "missing-audiveris"),
        "--no-audio",
        "--no-notation",
        "--no-research",
      ]);

      expect(exitCode).toBe(1);
      const summary = JSON.parse(await readFile(join(output, "corpus-summary.json"), "utf8")) as {
        scores: Array<{ status: string }>;
      };
      expect(summary.scores).toHaveLength(1);
      expect(summary.scores[0]?.status).toBe("FAILED");
      const corpus = JSON.parse(await readFile(join(output, "benchmark-corpus.json"), "utf8")) as { songs: unknown[] };
      expect(corpus.songs).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when a nested score directory is a symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-corpus-nested-symlink-"));
    try {
      const pdf = join(directory, "score.pdf");
      const output = join(directory, "corpus");
      const victim = join(directory, "victim");
      const songOut = join(output, "scores", "score");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await mkdir(victim, { recursive: true });
      await writeFile(join(victim, "sentinel.txt"), "keep me", "utf8");
      await mkdir(join(output, "scores"), { recursive: true });
      await symlink(victim, songOut, "dir");

      await expect(runScoreCorpusBatch([
        "--out", output,
        "--pdf", pdf,
        "--audiveris", join(directory, "missing-audiveris"),
        "--no-audio",
        "--no-notation",
        "--no-research",
      ])).resolves.toBe(1);
      expect(await readFile(join(victim, "sentinel.txt"), "utf8")).toBe("keep me");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
