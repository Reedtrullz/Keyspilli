import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import { runScoreReferenceCorpusCli } from "../scripts/build-score-reference-corpus.js";
import {
  localScoreReferenceCorpusJson,
  runLocalScoreReferenceCorpus,
  type ScoreReferenceCorpusInput,
} from "../src/score-reference-corpus.js";

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
}

function score(): NonNullable<ScoreReferenceCorpusInput["scores"][number]["omr"]>[number]["score"] {
  return {
    title: "Synthetic score",
    tempoBpm: 110,
    timeSignature: [4, 4],
    keySignature: 0,
    parts: [{
      id: "P1",
      name: "Melody",
      role: "melody",
      measures: [{
        id: "m1",
        number: "1",
        page: 1,
        startBeat: 0,
        durationBeats: 4,
        timeSignature: [4, 4],
        events: [
          { onset: 0, duration: 1, pitch: 60, role: "melody" },
          { onset: 1, duration: 1, pitch: 62, role: "melody" },
          { onset: 2, duration: 2, pitch: 64, role: "melody" },
        ],
      }],
    }],
  };
}

function corpusScore(id: string, overrides: Record<string, unknown> = {}): ScoreReferenceCorpusInput["scores"][number] {
  return {
    id,
    artist: "Synthetic artist",
    title: `Synthetic ${id}`,
    ...overrides,
  } as ScoreReferenceCorpusInput["scores"][number];
}

function roleScore(role: "melody" | "harmony", pitches: readonly number[]) {
  const result = score()!;
  const part = result.parts[0]!;
  part.name = role;
  part.role = role;
  const measure = part.measures[0]!;
  measure.events = pitches.map((pitch, index) => ({ onset: index, duration: 1, pitch, role }));
  return result;
}

describe("local score reference corpus runner", () => {
  it("keeps every missing PDF as a structured unavailable score", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-corpus-"));
    const output = join(root, "output");
    try {
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [
          corpusScore("zeta", { pdfPath: join(root, "missing-zeta.pdf") }),
          corpusScore("alpha", { pdfPath: join(root, "missing-alpha.pdf") }),
        ],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });

      expect(result.scores.map((item) => item.id)).toEqual(["alpha", "zeta"]);
      expect(result.scores.every((item) => item.source.pdf.status === "missing")).toBe(true);
      expect(result.scores.every((item) => item.maturity === "FAILED")).toBe(true);
      expect(result.summary).toMatchObject({ scoreCount: 2, failed: 2, melodyReady: 0, harmonyReady: 0 });
      expect(result.humanWorkload.totalDecisions).toBe(2);
      expect(JSON.stringify(result)).not.toContain(root);
      await expect(stat(join(output, "corpus-report.json"))).resolves.toBeTruthy();
      await expect(stat(join(output, "human-workload.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is deterministic across reordered manifest entries and reruns", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-determinism-"));
    const output = join(root, "output");
    try {
      const firstInput: ScoreReferenceCorpusInput = {
        schemaVersion: 1,
        scores: [
          corpusScore("b", { omr: [{ id: "audiveris", version: "1", score: score() }] }),
          corpusScore("a", { omr: [{ id: "audiveris", version: "1", score: score() }] }),
        ],
      };
      const secondInput: ScoreReferenceCorpusInput = { schemaVersion: 1, scores: [...firstInput.scores].reverse() };
      const first = await runLocalScoreReferenceCorpus(firstInput, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const second = await runLocalScoreReferenceCorpus(secondInput, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });

      expect(localScoreReferenceCorpusJson(first)).toBe(localScoreReferenceCorpusJson(second));
      expect(await readFile(join(output, "corpus-report.json"), "utf8")).toBe(localScoreReferenceCorpusJson(second));
      expect(first.scores.every((item) => item.maturity === "MELODY_READY")).toBe(true);
      expect(first.summary.melodyReady).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports role-level readiness independently of the overall score", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-roles-"));
    try {
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-score", { omr: [{ id: "audiveris", score: score() }] })],
      }, { outputRoot: join(root, "output"), repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      expect(item.roles.melody).toMatchObject({ state: "READY", trustedMeasures: 1, eligibleMeasures: 1, coverage: 1 });
      expect(item.roles.harmony).toMatchObject({ state: "UNAVAILABLE", coverage: null });
      expect(item.roles.rhythm).toMatchObject({ state: "UNAVAILABLE", coverage: null });
      expect(item.maturity).toBe("MELODY_READY");
      expect(result.summary).toMatchObject({ melodyReady: 1, harmonyReady: 0, fullReferenceReady: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records independent OMR source preferences for each role", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-sources-"));
    try {
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-sources", {
          omr: [
            { id: "melody-engine", version: "1", score: roleScore("melody", [60, 62, 64]) },
            { id: "harmony-engine", version: "1", score: roleScore("harmony", [48, 52, 55]) },
          ],
        })],
      }, { outputRoot: join(root, "output"), repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const omr = result.scores[0]!.omr;
      expect(omr.roleQuality?.selectionPolicy).toBe("independent-backend-role-selection");
      expect(omr.preferredBackendByRole).toEqual({
        melody: { id: "melody-engine", version: "1" },
        harmony: { id: "harmony-engine", version: "1" },
        rhythm: null,
      });
      expect(omr.roleQuality?.backendSummaries.some((row) => row.backendId === "melody-engine" && row.role === "melody")).toBe(true);
      expect(omr.roleQuality?.backendSummaries.some((row) => row.backendId === "harmony-engine" && row.role === "harmony")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps OMR role-quality diagnostics when a native candidate is selected", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-native-omr-quality-"));
    try {
      const nativePath = join(root, "native.mid");
      await writeFile(nativePath, writeMidi([
        { midi: 60, start: 0, dur: 1, vel: 100, hand: "R" },
        { midi: 64, start: 1, dur: 1, vel: 100, hand: "R" },
      ], { tempoBpm: 120, title: "Native score" }));
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("native-with-omr", {
          nativeArtifacts: [{
            id: "native-midi",
            path: nativePath,
            artifactType: "midi",
            permitted: true,
            provenance: "publisher export",
            version: "1",
          }],
          omr: [{ id: "omr-engine", version: "1", score: score() }],
        })],
      }, { outputRoot: join(root, "output"), repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      expect(item.selected.kind).toBe("native");
      expect(item.quality.measures).toBeGreaterThan(0);
      expect(item.omr.roleQuality?.selectionPolicy).toBe("independent-backend-role-selection");
      expect(item.omr.preferredBackendByRole.melody).toEqual({ id: "omr-engine", version: "1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects repository-contained sources and output paths before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-safety-"));
    try {
      await expect(runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("unsafe", { pdfPath: resolve(process.cwd(), "package.json") })],
      }, { outputRoot: join(root, "output"), repositoryRoot: process.cwd() })).rejects.toThrow(/outside the repository/i);
      await expect(runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("unsafe", { omr: [{ id: "x", score: score() }] })],
      }, { outputRoot: resolve(process.cwd(), ".score-reference-test-output"), repositoryRoot: process.cwd() })).rejects.toThrow(/outside the repository/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not add the local-only runner to the production catalog barrel", async () => {
    const barrel = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts"), "utf8");
    expect(barrel).not.toContain("score-reference-corpus");
  });

  it("preserves a valid local PDF as forensics evidence without copying it", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-pdf-"));
    try {
      const pdf = join(root, "score.pdf");
      await writeFile(pdf, pdfBytes());
      const output = join(root, "output");
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("pdf-score", { pdfPath: pdf })],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      expect(result.scores[0]?.source.pdf.status).toBe("available");
      expect(result.scores[0]?.source.pdf.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(result)).not.toContain(pdf);
      await expect(stat(join(output, "scores", "pdf-score", "reference-manifest.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs the CLI in no-PDF mode and emits a path-free report", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-cli-"));
    try {
      const manifest = join(root, "manifest.json");
      const output = join(root, "output");
      await writeFile(manifest, JSON.stringify({ scores: [corpusScore("cli-missing", { pdfPath: join(root, "not-found.pdf") })] }));
      let stdout = "";
      let stderr = "";
      const code = await runScoreReferenceCorpusCli([
        "--manifest", manifest,
        "--out", output,
      ], {
        stdout: (value) => { stdout += value; },
        stderr: (value) => { stderr += value; },
      });
      expect(code).toBe(1);
      expect(stderr).toBe("");
      expect(stdout).toContain('"scoreCount": 1');
      expect(stdout).toContain('"status": "missing"');
      expect(stdout).not.toContain(root);
      await expect(stat(join(output, "corpus-report.json"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
