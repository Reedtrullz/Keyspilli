import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { runBenchmarkScore, safeError, sanitizeText } from "../scripts/benchmark-score.js";

const minimalMusicXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

const multiPartMusicXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Lead Voice</part-name></score-part>
    <score-part id="P2"><part-name>Guitar</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

describe("benchmark-score CLI", () => {
  it("does not add an invalid PDF to the standalone corpus manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-score-invalid-"));
    try {
      const pdf = join(directory, "not-a-score.pdf");
      const out = join(directory, "result");
      await writeFile(pdf, "not a PDF", "utf8");

      const result = await runBenchmarkScore({ pdf, out, noAudio: true, noNotation: true });

      expect(result.status).toBe("FAILED");
      const corpusPath = join(directory, "benchmark-corpus.json");
      await expect(readFile(corpusPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves a malformed standalone corpus manifest instead of overwriting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-score-manifest-"));
    try {
      const pdf = join(directory, "score.pdf");
      const out = join(directory, "result");
      const corpusPath = join(directory, "benchmark-corpus.json");
      const malformed = '{"schemaVersion":1,"songs":{}}\n';
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await writeFile(corpusPath, malformed, "utf8");

      await expect(runBenchmarkScore({
        pdf,
        out,
        audiveris: join(directory, "missing-audiveris"),
        noAudio: true,
        noNotation: true,
      })).rejects.toThrow(/existing corpus manifest is malformed/);
      expect(await readFile(corpusPath, "utf8")).toBe(malformed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("redacts credentialed URLs and complete absolute paths with spaces", () => {
    const message = sanitizeText(
      `fetch https://user:secret@example.test/score.mid?token=private#page from '/Users/reidar/My Private Scores/Defence Of Moscow.pdf'`,
    );
    expect(message).toContain("https://example.test/score.mid");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("token=private");
    expect(message).not.toContain("/Users/reidar/");
    expect(message).not.toContain("Defence Of Moscow.pdf");

    const unquoted = safeError(new Error("ENOENT /private/tmp/score exports/Defence Of Moscow.mid"));
    expect(unquoted).not.toContain("/private/tmp/");
    expect(unquoted).not.toContain("Defence Of Moscow.mid");
  });

  it("redacts unquoted absolute executable paths without hiding route labels", () => {
    const message = safeError(new Error(
      "spawn /Users/reidar/bin/audiveris ENOENT while requesting /api/v1/scores",
    ));

    expect(message).toContain("[redacted-path]");
    expect(message).not.toContain("/Users/reidar/bin/audiveris");
    expect(message).toContain("/api/v1/scores");
  });

  it("rejects output paths whose existing symlink resolves inside the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-symlink-"));
    try {
      const pdf = join(directory, "score.pdf");
      const repoLink = join(directory, "repo-link");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await symlink(process.cwd(), repoLink, "dir");

      await expect(runBenchmarkScore({
        pdf,
        out: join(repoLink, "score-output"),
        noAudio: true,
        noNotation: true,
        noCorpus: true,
      })).rejects.toThrow(/output directory must be outside the repository/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a nested symlinked output directory before writing artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-nested-symlink-"));
    try {
      const pdf = join(directory, "score.pdf");
      const out = join(directory, "result");
      const victim = join(directory, "victim");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await mkdir(out, { recursive: true });
      await mkdir(victim, { recursive: true });
      await writeFile(join(victim, "sentinel.txt"), "keep me", "utf8");
      await symlink(victim, join(out, "normalized"), "dir");

      await expect(runBenchmarkScore({
        pdf,
        out,
        audiveris: join(directory, "missing-audiveris"),
        noAudio: true,
        noNotation: true,
        noCorpus: true,
      })).rejects.toThrow(/normalized output directory contains a symlinked output component/);
      expect(await readFile(join(victim, "sentinel.txt"), "utf8")).toBe("keep me");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("converts an Audiveris MusicXML export without a matchAll regex error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-score-cli-"));
    try {
      const pdf = join(directory, "score.pdf");
      const audiveris = join(directory, "fake-audiveris");
      const out = join(directory, "result");
      const container = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
      const mxl = zipSync({
        "META-INF/container.xml": new TextEncoder().encode(container),
        "score.musicxml": new TextEncoder().encode(minimalMusicXml),
      });
      const mxlBase64 = Buffer.from(mxl).toString("base64");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await writeFile(audiveris, `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "-batch") {
  const outputDir = args[3];
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "score.mxl"), Buffer.from("${mxlBase64}", "base64"));
} else {
  console.log("Audiveris 5.11.0");
}
`, { encoding: "utf8", mode: 0o755 });
      await chmod(audiveris, 0o755);

      const result = await runBenchmarkScore({
        pdf,
        out,
        audiveris,
        noAudio: true,
        noNotation: true,
      });

      expect(result.report.omr.status).toBe("PASS");
      expect(result.report.errors).not.toContain("String.prototype.matchAll called with a non-global RegExp argument");
      expect(result.report.structure?.parts[0]?.name).toBe("Piano");
      expect(result.report.metrics?.parsedNotes).toBe(1);
      expect(result.report.errors).toEqual([]);
      expect(result.report.artifacts.musicxml).toBe("normalized/reference.musicxml");
      expect(JSON.parse(await readFile(join(out, "validation", "report.json"), "utf8")).omr.status).toBe("PASS");

      const corpus = JSON.parse(await readFile(join(directory, "benchmark-corpus.json"), "utf8")) as {
        songs: Array<{
          references: Record<string, unknown>;
          provenance?: { musicXml?: { sha256?: string }; midi?: { sha256?: string } };
        }>;
      };
      expect(corpus.songs[0]?.references).toEqual({
        fullScore: "result/normalized/reference.musicxml",
        piano: "result/normalized/reference.mid",
        harmony: "result/normalized/notes.json",
      });
      expect(corpus.songs[0]?.references.fullScoreMidi).toBeUndefined();
      expect(corpus.songs[0]?.provenance?.musicXml?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(corpus.songs[0]?.provenance?.midi?.sha256).toMatch(/^[0-9a-f]{64}$/);

      const metadata = JSON.parse(await readFile(join(out, "source-metadata.json"), "utf8")) as {
        derivedArtifacts?: Record<string, { path?: string; bytes?: number; sha256?: string } | null>;
        provenance?: { musicXml?: { sha256?: string }; midi?: { sha256?: string } };
      };
      expect(metadata.derivedArtifacts?.musicxml?.path).toBe("normalized/reference.musicxml");
      expect(metadata.derivedArtifacts?.notes?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(metadata.provenance?.musicXml?.sha256).toBe(corpus.songs[0]?.provenance?.musicXml?.sha256);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the part-list out of multi-part scans and normalized note part names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-score-multipart-"));
    try {
      const pdf = join(directory, "score.pdf");
      const audiveris = join(directory, "fake-audiveris");
      const out = join(directory, "result");
      const container = `<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
      const mxl = zipSync({
        "META-INF/container.xml": new TextEncoder().encode(container),
        "score.musicxml": new TextEncoder().encode(multiPartMusicXml),
      });
      const mxlBase64 = Buffer.from(mxl).toString("base64");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await writeFile(audiveris, `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "-batch") {
  const outputDir = args[3];
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "score.mxl"), Buffer.from("${mxlBase64}", "base64"));
} else {
  console.log("Audiveris 5.11.0");
}
`, { encoding: "utf8", mode: 0o755 });
      await chmod(audiveris, 0o755);

      const result = await runBenchmarkScore({
        pdf,
        out,
        audiveris,
        noAudio: true,
        noNotation: true,
      });

      expect(result.report.structure?.parts.map((part) => part.name)).toEqual(["Lead Voice", "Guitar"]);
      expect(result.report.metrics?.parsedNotes).toBe(2);
      const normalized = JSON.parse(await readFile(join(out, "normalized", "notes.json"), "utf8")) as {
        notes: Array<{ part: string }>;
      };
      expect(normalized.notes.map((note) => note.part)).toEqual(["Guitar", "Lead Voice"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects the lexicographically first MXL when Audiveris emits multiple exports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-benchmark-score-order-"));
    try {
      const pdf = join(directory, "score.pdf");
      const audiveris = join(directory, "fake-audiveris");
      const out = join(directory, "result");
      const makeMxl = (partName: string) => {
        const xml = minimalMusicXml.replace("<part-name>Piano</part-name>", `<part-name>${partName}</part-name>`);
        return Buffer.from(zipSync({
          "META-INF/container.xml": new TextEncoder().encode(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`),
          "score.musicxml": new TextEncoder().encode(xml),
        })).toString("base64");
      };
      const first = makeMxl("Zed");
      const second = makeMxl("Alpha");
      await writeFile(pdf, "%PDF-1.4\n", "utf8");
      await writeFile(audiveris, `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "-batch") {
  const outputDir = args[3];
  await mkdir(join(outputDir, "nested"), { recursive: true });
  await writeFile(join(outputDir, "z-score.mxl"), Buffer.from("${first}", "base64"));
  await writeFile(join(outputDir, "nested", "a-score.mxl"), Buffer.from("${second}", "base64"));
} else {
  console.log("Audiveris 5.11.0");
}
`, { encoding: "utf8", mode: 0o755 });
      await chmod(audiveris, 0o755);

      const result = await runBenchmarkScore({
        pdf,
        out,
        audiveris,
        noAudio: true,
        noNotation: true,
      });

      expect(result.report.omr.status).toBe("PASS");
      expect(result.report.structure?.parts[0]?.name).toBe("Alpha");
      expect(result.report.metrics?.parsedNotes).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
