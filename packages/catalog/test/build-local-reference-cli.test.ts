import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import { parseLocalReferenceArgs, runLocalReferenceCli } from "../scripts/build-local-reference.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("build-local-reference CLI", () => {
  it("parses explicit local sources and repeatable backend inputs", () => {
    const options = parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--id", "Sabaton Defence Of Moscow",
      "--title=Defence Of Moscow",
      "--artist", "Sabaton",
      "--pdf", "/Users/reidar/Downloads/score.pdf",
      "--native", "/Users/reidar/Downloads/score.mid",
      "--native-sidecar", "/Users/reidar/Downloads/score.json",
      "--omr", "audiveris=/Users/reidar/Downloads/audiveris.musicxml",
      "--timeout-ms", "120000",
    ]);

    expect(options).toMatchObject({
      out: "/private/tmp/reference-run",
      id: "sabaton-defence-of-moscow",
      title: "Defence Of Moscow",
      artist: "Sabaton",
      pdf: "/Users/reidar/Downloads/score.pdf",
      native: ["/Users/reidar/Downloads/score.mid"],
      nativeSidecars: ["/Users/reidar/Downloads/score.json"],
      omr: [{ id: "audiveris", path: "/Users/reidar/Downloads/audiveris.musicxml" }],
      timeoutMs: 120000,
      help: false,
    });
  });

  it("fails closed for missing sources, duplicate backends, unsafe labels, and invalid timeouts", () => {
    expect(() => parseLocalReferenceArgs(["--out", "/private/tmp/reference-run"])).toThrow(/symbolic source/i);
    expect(() => parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--omr", "a=/private/tmp/a.musicxml",
      "--omr", "a=/private/tmp/b.musicxml",
    ])).toThrow(/duplicate OMR backend/i);
    expect(() => parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--native", "/private/tmp/a.mid",
      "--id", "/Users/reidar/private/score",
    ])).toThrow(/logical label/i);
    expect(() => parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--native", "/private/tmp/a.mid",
      "--timeout-ms", "0",
    ])).toThrow(/timeout-ms/i);
    expect(() => parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--native", "/private/tmp/a.mid",
      "--id", ".",
    ])).toThrow(/id.*must not be ['"]?\.?['"]?/i);
    expect(() => parseLocalReferenceArgs([
      "--out", "/private/tmp/reference-run",
      "--native", "/private/tmp/a.mid",
      "--id", "..",
    ])).toThrow(/id.*must not be ['"]?\.\.['"]?/i);
  });

  it("offers help without touching the filesystem", async () => {
    let stdout = "";
    let stderr = "";
    const code = await runLocalReferenceCli(["--help"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });
    expect(code).toBe(0);
    expect(stdout).toContain("build-local-reference.ts");
    expect(stderr).toBe("");
  });

  it("rejects repository output and malformed local inputs before invoking the builder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-local-reference-cli-"));
    try {
      const nativePath = join(directory, "score.mid");
      await writeFile(nativePath, "not midi", "utf8");
      let errors = "";
      const repositoryCode = await runLocalReferenceCli([
        "--out", join(repositoryRoot, ".local-reference-cli-test-output"),
        "--native", nativePath,
      ], {
        stdout: () => undefined,
        stderr: (value) => { errors += value; },
      });
      expect(repositoryCode).toBe(2);
      expect(errors).toMatch(/outside the repository/i);
      expect(errors).not.toContain(nativePath);

      errors = "";
      const missingCode = await runLocalReferenceCli([
        "--out", join(directory, "output"),
        "--native", join(directory, "missing.mid"),
      ], {
        stdout: () => undefined,
        stderr: (value) => { errors += value; },
      });
      expect(missingCode).toBe(2);
      expect(errors).toMatch(/does not exist|resolved/i);
      expect(errors).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("builds a local OMR bundle and writes only derived, path-free indexes", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "keyspilli-local-reference-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "keyspilli-local-reference-output-"));
    try {
      const xmlPath = join(sourceDirectory, "score.musicxml");
      await writeFile(xmlPath, `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
  </measure></part>
</score-partwise>`, "utf8");
      let output = "";
      let errors = "";
      const code = await runLocalReferenceCli([
        "--out", outputDirectory,
        "--id", "synthetic-omr",
        "--title", "Synthetic OMR",
        "--artist", "Test artist",
        "--omr", `audiveris=${xmlPath}`,
      ], {
        stdout: (value) => { output += value; },
        stderr: (value) => { errors += value; },
      });
      expect(code).toBe(0);
      expect(errors).toBe("");
      expect(output).not.toContain(sourceDirectory);
      expect(output).toContain("reference.mid");
      const report = JSON.parse(output) as { scores?: Array<{ outputs?: { referenceMidi?: string | null } }> };
      expect(report.scores?.[0]?.outputs?.referenceMidi).toBe("scores/synthetic-omr/reference.mid");
      await expect(readFile(join(outputDirectory, "report.md"), "utf8")).resolves.toContain("- Status: MELODY_READY");
      for (const path of [
        join(outputDirectory, "report.json"),
        join(outputDirectory, "report.md"),
        join(outputDirectory, "native", "discovery.json"),
        join(outputDirectory, "consensus", "report.json"),
        join(outputDirectory, "reference", "partial.json"),
        join(outputDirectory, "reference", "events.json"),
        join(outputDirectory, "reference", "score.json"),
      ]) {
        await expect(stat(path)).resolves.toBeTruthy();
      }
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it("builds an explicitly supplied native MIDI without requiring PDF identity", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "keyspilli-local-native-source-"));
    const outputDirectory = await mkdtemp(join(tmpdir(), "keyspilli-local-native-output-"));
    try {
      const midiPath = join(sourceDirectory, "reference.mid");
      await writeFile(midiPath, writeMidi([
        { midi: 60, start: 0, dur: 1, vel: 100, hand: "R" },
        { midi: 64, start: 1, dur: 1, vel: 100, hand: "R" },
      ], { tempoBpm: 120 }), "binary");
      let output = "";
      let errors = "";
      const code = await runLocalReferenceCli([
        "--out", outputDirectory,
        "--id", "native-midi",
        "--title", "Native MIDI",
        "--artist", "Test artist",
        "--native", midiPath,
      ], {
        stdout: (value) => { output += value; },
        stderr: (value) => { errors += value; },
      });
      expect(code).toBe(0);
      expect(errors).toBe("");
      expect(JSON.parse(output)).toMatchObject({ scores: [{ state: "MELODY_READY", selected: { kind: "native", artifactType: "midi" } }] });
      await expect(stat(join(outputDirectory, "scores", "native-midi", "reference.mid"))).resolves.toBeTruthy();
    } finally {
      await rm(sourceDirectory, { recursive: true, force: true });
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
