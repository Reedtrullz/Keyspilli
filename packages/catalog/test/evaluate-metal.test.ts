import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";

const repoRoot = resolveRepoRoot();
const cli = join(repoRoot, "packages/catalog/scripts/evaluate-metal.ts");
const tsx = join(repoRoot, "node_modules/.bin/tsx");

function resolveRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function midiFile(path: string, notes: Note[]): Promise<void> {
  await writeFile(path, writeMidi(notes, {
    tempoBpm: 120,
    timeSig: [4, 4],
    tracks: [
      { name: "Metal Piano RH", notes: notes.filter((note) => note.hand !== "L") },
      { name: "Metal Piano LH", notes: notes.filter((note) => note.hand === "L") },
    ],
  }));
}

function runCli(args: string[]): string {
  return execFileSync(tsx, [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

describe("evaluate-metal CLI", () => {
  it("emits a stable path-redacted structural report for a local candidate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-"));
    try {
      const candidate = join(directory, "candidate.mid");
      await midiFile(candidate, [
        { midi: 64, start: 0, dur: 1, vel: 100, hand: "R", identitySource: "guitar" },
        { midi: 40, start: 0, dur: 1, vel: 70, hand: "L", identitySource: "guitar" },
      ]);
      const first = JSON.parse(runCli(["--candidate", candidate, "--fixture-id", "cli-test"]));
      const second = JSON.parse(runCli(["--candidate", candidate, "--fixture-id", "cli-test"]));
      expect(first.fixture.id).toBe("cli-test");
      expect(first.candidate.selector).toBe("candidate.mid");
      expect(first.candidate.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(first.gate.status).toBe("pass");
      expect(first.trace.status).toBe("unavailable");
      expect(first.determinism.canonicalSha256).toBe(second.determinism.canonicalSha256);
      expect(JSON.stringify(first)).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps reference scoring fail-closed without enough explicit coverage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-ref-"));
    try {
      const candidate = join(directory, "candidate.mid");
      const reference = join(directory, "reference.mid");
      const notes: Note[] = [{ midi: 64, start: 0, dur: 1, vel: 100, hand: "R" }];
      await midiFile(candidate, notes);
      await midiFile(reference, notes);
      const report = JSON.parse(runCli([
        "--candidate", candidate,
        "--reference", reference,
        "--window", "intro=0,4,0,4",
        "--mode", "reference",
      ]));
      expect(report.reference.status).toBe("insufficient-coverage");
      expect(report.reference.windows).toHaveLength(1);
      expect(report.reference.exactPitch.f1).toBe(1);
      expect(report.gate.mode).toBe("reference");
      expect(report.gate.status).toBe("null");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("builds a local stem arrangement and reports variant gates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-stems-"));
    try {
      const note: Note = { midi: 64, start: 0, dur: 1, vel: 100 };
      await midiFile(join(directory, "guitar.mid"), [note]);
      const output = join(directory, "report.json");
      runCli(["--stems", directory, "--fixture-id", "generated-test", "--out", output]);
      const report = JSON.parse(await readFile(output, "utf8"));
      expect(report.candidate.selector).toBe("generated-metal-arrangement.mid");
      expect(report.metrics.guitar.semanticAttackCount).toEqual(expect.any(Number));
      expect(report.metrics.variants.easy?.global.noteCount).toEqual(expect.any(Number));
      expect(report.gate.evaluated).toContain("variant validation");
      expect(report.gate.evaluated).toContain("variant monotonicity");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a deterministic path-free provenance trace for stem-built candidates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-trace-"));
    try {
      const guitar: Note[] = [
        { midi: 48, start: 0, dur: 0.5, vel: 100 },
        { midi: 55, start: 0, dur: 0.5, vel: 95 },
        { midi: 64, start: 0, dur: 0.5, vel: 90 },
        { midi: 48, start: 1, dur: 0.5, vel: 100 },
        { midi: 55, start: 1, dur: 0.5, vel: 95 },
        { midi: 65, start: 1, dur: 0.5, vel: 90 },
        { midi: 50, start: 2, dur: 0.5, vel: 100 },
        { midi: 57, start: 2, dur: 0.5, vel: 95 },
        { midi: 67, start: 2, dur: 0.5, vel: 90 },
        { midi: 52, start: 3, dur: 0.5, vel: 100 },
        { midi: 59, start: 3, dur: 0.5, vel: 95 },
        { midi: 69, start: 3, dur: 0.5, vel: 90 },
      ];
      await midiFile(join(directory, "guitar.mid"), guitar);
      const firstReportPath = join(directory, "first-report.json");
      const firstTracePath = join(directory, "first-trace.json");
      const secondReportPath = join(directory, "second-report.json");
      const secondTracePath = join(directory, "second-trace.json");
      const args = ["--stems", directory, "--fixture-id", "trace-cli", "--revision", "trace-test"];
      runCli([...args, "--out", firstReportPath, "--trace-out", firstTracePath]);
      runCli([...args, "--out", secondReportPath, "--trace-out", secondTracePath]);

      const first = JSON.parse(await readFile(firstReportPath, "utf8"));
      const trace = JSON.parse(await readFile(firstTracePath, "utf8"));
      expect(first.trace.status).toBe("available");
      expect(trace.schemaVersion).toBe(1);
      expect(trace.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "raw", source: "guitar" }),
        expect.objectContaining({ stage: "lead", source: "guitar" }),
        expect.objectContaining({ stage: "final" }),
      ]));
      const orderedKeys = trace.events.map((event: { key: string }) => event.key);
      expect(orderedKeys).toEqual([...orderedKeys].sort());
      expect(first.trace.events).toEqual(trace.events);
      expect(JSON.stringify(first)).not.toContain(directory);
      expect(JSON.stringify(trace)).not.toContain(directory);
      expect(await readFile(firstTracePath, "utf8")).toBe(await readFile(secondTracePath, "utf8"));
      expect(first.determinism.canonicalSha256).toBe(JSON.parse(await readFile(secondReportPath, "utf8")).determinism.canonicalSha256);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a reference path inside the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-guard-"));
    try {
      const candidate = join(directory, "candidate.mid");
      await midiFile(candidate, [{ midi: 64, start: 0, dur: 1, vel: 100, hand: "R" }]);
      expect(() => runCli(["--candidate", candidate, "--reference", join(repoRoot, "package.json")])).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not read a repository reference before rejecting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-evaluate-metal-guard-before-read-"));
    try {
      const candidate = join(directory, "candidate.mid");
      await midiFile(candidate, [{ midi: 64, start: 0, dur: 1, vel: 100, hand: "R" }]);
      expect(() => runCli([
        "--stems", join(directory, "missing-stems"),
        "--reference", join(repoRoot, "package.json"),
      ])).toThrow(/reference must be outside the repository/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
