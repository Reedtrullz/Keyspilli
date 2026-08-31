import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "@keyspilli/midi";
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
          { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 1, duration: 1, pitch: 62, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 2, duration: 2, pitch: 64, role: "melody", staff: 1, voice: "1", accidental: "natural" },
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
  measure.events = pitches.map((pitch, index) => ({ onset: index, duration: index === pitches.length - 1 ? 2 : 1, pitch, role, staff: 1, voice: "1", accidental: "natural" }));
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
      const output = join(root, "output");
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-score", { omr: [{ id: "audiveris", score: roleScore("melody", [60, 62, 64]) }] })],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      expect(item.roles.melody).toMatchObject({ state: "READY", trustedMeasures: 1, eligibleMeasures: 1, coverage: 1 });
      expect(item.roles.harmony).toMatchObject({ state: "UNAVAILABLE", coverage: null });
      expect(item.roles.rhythm).toMatchObject({ state: "UNAVAILABLE", coverage: null });
      expect(item.maturity).toBe("MELODY_READY");
      expect(result.summary).toMatchObject({ melodyReady: 1, harmonyReady: 0, fullReferenceReady: 0 });
      const melody = item.outputs.roleReferences.melody;
      expect(melody).toMatchObject({
        referenceMidi: "scores/role-score/roles/melody/reference.mid",
        referenceMusicXml: "scores/role-score/roles/melody/reference.musicxml",
        coverageMask: "scores/role-score/roles/melody/coverage-mask.json",
        manifest: "scores/role-score/roles/melody/reference-manifest.json",
      });
      expect(item.outputs.roleReferences.harmony).toBeNull();
      await expect(stat(join(output, melody!.referenceMidi))).resolves.toBeTruthy();
      await expect(stat(join(output, melody!.referenceMusicXml))).resolves.toBeTruthy();
      await expect(stat(join(output, melody!.coverageMask))).resolves.toBeTruthy();
      const roleManifest = JSON.parse(await readFile(join(output, melody!.manifest), "utf8")) as Record<string, unknown>;
      expect(roleManifest).toMatchObject({ role: "melody", selectedBackend: { id: "audiveris" } });
      const parsedRoleMidi = parseMidi(new Uint8Array(await readFile(join(output, melody!.referenceMidi))));
      expect(parsedRoleMidi.notes).toHaveLength(3);
      expect(parsedRoleMidi.notes.every((note) => note.hand !== "L")).toBe(true);
      const roleArtifactBytes = await Promise.all([
        melody!.referenceMidi,
        melody!.referenceMusicXml,
        melody!.coverageMask,
        melody!.manifest,
      ].map(async (path) => [path, await readFile(join(output, path))] as const));
      await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-score", { omr: [{ id: "audiveris", score: roleScore("melody", [60, 62, 64]) }] })],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      for (const [path, bytes] of roleArtifactBytes) expect(await readFile(join(output, path))).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses independent role readiness for gates while retaining selected-global rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-gate-"));
    try {
      const incomplete = roleScore("melody", [60, 62, 64]);
      const first = incomplete.parts[0]!.measures[0]!;
      incomplete.parts[0]!.measures.push({
        ...first,
        id: "m2",
        number: "2",
        startBeat: 4,
        events: [],
      });
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-gate", { omr: [{ id: "audiveris", score: incomplete }] })],
      }, { outputRoot: join(root, "output"), repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      expect(item.roles.melody.state).toBe("REVIEW_REQUIRED");
      expect(item.selectedRoles?.melody.state).toBe("READY");
      expect(item.outputs.roleReferences.melody).toBeNull();
      expect(result.summary.melodyReady).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces preferred independent role review groups as actionable work", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-review-"));
    const output = join(root, "output");
    try {
      const incomplete = roleScore("melody", [60, 62, 64]);
      const first = incomplete.parts[0]!.measures[0]!;
      incomplete.parts[0]!.measures.push({
        ...first,
        id: "m2",
        number: "2",
        startBeat: 4,
        events: [],
      });
      const input: ScoreReferenceCorpusInput = {
        schemaVersion: 1,
        scores: [corpusScore("role-review", { omr: [{ id: "audiveris", score: incomplete }] })],
      };
      const result = await runLocalScoreReferenceCorpus(input, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      const review = item.review as typeof item.review & {
        baseItems: number;
        roleGroupItems: number;
        actionableItems: number;
        roleGroups: Array<{ role: string; measureIds: string[] }>;
      };
      expect(item.omr.roleQuality?.reviewGroups.length).toBe(1);
      expect(review.baseItems).toBe(0);
      expect(review.roleGroups).toHaveLength(1);
      expect(review.roleGroups[0]).toMatchObject({ role: "melody", measureIds: ["P1:m2"] });
      expect(review.roleGroupItems).toBe(1);
      expect(review.actionableItems).toBe(1);
      expect(review.totalItems).toBe(1);
      expect(review.melodyCritical).toBe(1);
      expect(result.humanWorkload).toMatchObject({ totalDecisions: 1, melodyCritical: 1 });
      expect(result.summary).toMatchObject({ unresolvedReviewItems: 1, melodyCriticalReviewItems: 1 });

      const rerun = await runLocalScoreReferenceCorpus(input, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      expect(localScoreReferenceCorpusJson(rerun)).toBe(localScoreReferenceCorpusJson(result));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replaces overlapping base queue items with one role review unit", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-review-dedupe-"));
    try {
      const overlapping = roleScore("melody", [60, 62, 64]);
      const first = overlapping.parts[0]!.measures[0]!;
      overlapping.parts[0]!.measures.push({
        ...first,
        id: "m2",
        number: "2",
        startBeat: 4,
        events: [
          { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1", accidental: "natural" },
          { onset: 2, duration: 2, pitch: 64, role: "melody", staff: 1, voice: "1", accidental: "natural" },
        ],
      });
      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-review-dedupe", { omr: [{ id: "audiveris", score: overlapping }] })],
      }, { outputRoot: join(root, "output"), repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const review = result.scores[0]!.review;
      expect(review.baseItems).toBe(2);
      expect(review.roleGroupItems).toBe(1);
      expect(review.actionableItems).toBe(1);
      expect(review.totalItems).toBe(1);
      expect(review.melodyCritical).toBe(1);
      expect(result.humanWorkload.totalDecisions).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes stale role artifacts when a rerun is no longer role-ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-stale-"));
    const output = join(root, "output");
    const input: ScoreReferenceCorpusInput = {
      schemaVersion: 1,
      scores: [corpusScore("role-score", { omr: [{ id: "audiveris", score: roleScore("melody", [60, 62, 64]) }] })],
    };
    try {
      const first = await runLocalScoreReferenceCorpus(input, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const role = first.scores[0]!.outputs.roleReferences.melody!;
      await expect(stat(join(output, role.manifest))).resolves.toBeTruthy();
      await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("role-score", { omr: [{ id: "audiveris", status: "unavailable" }] })],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      await expect(stat(join(output, role.referenceMidi))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(output, role.referenceMusicXml))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(output, role.coverageMask))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(output, role.manifest))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps successful role artifacts when another role cannot materialize", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-role-partial-"));
    const output = join(root, "output");
    try {
      const melody = roleScore("melody", [60, 62, 64]);
      const measure = melody.parts[0]!.measures[0]!;
      measure.events!.push(
        { onset: 0, duration: 1, pitch: 48, role: "harmony", staff: 2, voice: "2", accidental: "natural" },
        { onset: 1, duration: 1, pitch: 52, role: "harmony", staff: 2, voice: "2", accidental: "natural" },
        { onset: 2, duration: 2, pitch: 55, role: "harmony", staff: 2, voice: "2", accidental: "natural" },
      );
      const melodyRoleDir = join(output, "scores", "partial-role", "roles", "melody");
      await mkdir(dirname(melodyRoleDir), { recursive: true });
      await symlink("/dev/null", melodyRoleDir);

      const result = await runLocalScoreReferenceCorpus({
        schemaVersion: 1,
        scores: [corpusScore("partial-role", { omr: [{ id: "audiveris", score: melody }] })],
      }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = result.scores[0]!;
      expect(item.outputs.roleReferences.melody).toBeNull();
      expect(item.outputs.roleReferences.harmony).not.toBeNull();
      expect(item.errors.some((error) => error.includes("melody role artifact materialization failed"))).toBe(true);
      await expect(stat(join(output, item.outputs.roleReferences.harmony!.manifest))).resolves.toBeTruthy();
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

  it("exposes deterministic per-backend role category diagnostics without events or paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-score-reference-backend-diagnostics-"));
    const output = join(root, "output");
    const input: ScoreReferenceCorpusInput = {
      schemaVersion: 1,
      scores: [corpusScore("backend-diagnostics", {
        omr: [
          { id: "z-melody", version: "1", score: roleScore("melody", [60, 62, 64]) },
          { id: "a-harmony", version: "2", score: roleScore("harmony", [48, 52, 55]) },
        ],
      })],
    };
    try {
      const first = await runLocalScoreReferenceCorpus(input, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      const item = first.scores[0]!;
      const diagnostics = item.omr.roleQuality?.backendDiagnostics ?? [];
      expect(diagnostics).toHaveLength(6);
      const melody = diagnostics.find((row) => row.backendId === "z-melody" && row.role === "melody")!;
      expect(melody).toMatchObject({ backendId: "z-melody", backendVersion: "1", role: "melody", measureCount: 1, availableMeasures: 1, coverage: 1 });
      expect(melody.categories).toMatchObject({
        structuralValidity: expect.objectContaining({ score: 1, available: true, flags: [] }),
        rhythmicValidity: expect.objectContaining({ score: 1, available: true, flags: [] }),
        continuity: expect.objectContaining({ score: 1, available: true, flags: [] }),
        // A single measure has no leave-one-out density baseline, so this
        // diagnostic is intentionally tri-state rather than a false pass.
        densityAnomaly: expect.objectContaining({ score: null, available: false, flags: [] }),
        pitchPlausibility: expect.objectContaining({ score: 1, available: true, flags: [] }),
        notationCompleteness: expect.objectContaining({ score: 1, available: true, flags: [] }),
        keyConsistency: { score: null, available: false, basis: expect.stringContaining("not represented"), flags: [] },
        timeConsistency: { score: null, available: false, basis: expect.stringContaining("not represented"), flags: [] },
      });
      expect(JSON.stringify(melody)).not.toContain("eventIds");
      expect(JSON.stringify(first)).not.toContain(root);

      const second = await runLocalScoreReferenceCorpus({ ...input, scores: [...input.scores].reverse() }, { outputRoot: output, repositoryRoot: resolve(process.cwd(), "not-the-repository") });
      expect(localScoreReferenceCorpusJson(first)).toBe(localScoreReferenceCorpusJson(second));
      expect(await readFile(join(output, "corpus-report.json"), "utf8")).toBe(localScoreReferenceCorpusJson(second));
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
