import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMidiCorpus, parseBuildMidiCorpusArgs, parseMidiCorpusManifest } from "../scripts/build-midi-corpus.js";

function vlq(value: number): number[] {
  const result = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    result.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return result;
}

function fixtureMidi(): Uint8Array {
  const body = [0, 0xff, 0x03, 5, ...Buffer.from("Piano"), 0, 0x90, 60, 90, ...vlq(480), 0x80, 60, 0, 0, 0xff, 0x2f, 0];
  const track = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body];
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0, ...track]);
}

describe("local MIDI corpus CLI", () => {
  it("parses help and safety-boundary options without touching the filesystem", () => {
    expect(parseBuildMidiCorpusArgs(["--help"])).toMatchObject({ help: true });
    expect(parseBuildMidiCorpusArgs(["--manifest", "/private/tmp/manifest.json", "--out", "/private/tmp/out", "--repository-root", "/private/tmp/repo", "--allow-fewer"])).toMatchObject({
      repositoryRoot: "/private/tmp/repo",
      requireSeven: false,
    });
  });

  it("validates stable seven-source manifests and rejects duplicate ids", () => {
    expect(() => parseMidiCorpusManifest({ schemaVersion: 1, corpusId: "x", sources: [] })).toThrow(/exactly 7/);
    expect(() => parseMidiCorpusManifest({ schemaVersion: 1, corpusId: "x", sources: [{ id: "x", file: "/tmp/x.mid" }, { id: "x", file: "/tmp/y.mid" }] }, false)).toThrow(/duplicate/);
  });

  it("builds a deterministic path-free report outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-midi-corpus-test-"));
    const input = join(root, "source.mid");
    const manifest = join(root, "manifest.json");
    const output = join(root, "out");
    await writeFile(input, fixtureMidi());
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, corpusId: "test-corpus", sources: [{ id: "song-a", artist: "Test", title: "Song", file: input, referenceKind: "direct-piano" }] }));
    const first = await buildMidiCorpus({ manifest, out: output, requireSeven: false });
    const firstText = await readFile(first.report, "utf8");
    const second = await buildMidiCorpus({ manifest, out: output, requireSeven: false });
    const secondText = await readFile(second.report, "utf8");
    expect(first.status).toBe("partial");
    expect(firstText).toBe(secondText);
    expect(firstText).not.toContain(root);
    expect(firstText).not.toContain("source.mid");
    expect(JSON.parse(firstText)).toMatchObject({
      kind: "midi-reference-corpus",
      sourceCount: 1,
      status: "partial",
      benchmark: { status: "insufficient-evidence" },
      sources: [{ artifacts: { canonicalJson: "canonical/song-a.json" } }],
    });
  });

  it("records missing external inputs as a path-free failed source instead of aborting the corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-midi-corpus-missing-"));
    const manifest = join(root, "manifest.json");
    const output = join(root, "out");
    const missing = join(root, "does-not-exist.mid");
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, corpusId: "missing-corpus", sources: [{ id: "missing-song", title: "Missing song", file: missing }] }));
    const result = await buildMidiCorpus({ manifest, out: output, requireSeven: false });
    const reportText = await readFile(result.report, "utf8");
    expect(result).toMatchObject({ status: "failed", sourceCount: 1, failedCount: 1 });
    expect(reportText).not.toContain(root);
    expect(reportText).not.toContain("does-not-exist.mid");
    expect(JSON.parse(reportText)).toMatchObject({ status: "failed", sources: [{ integrity: { status: "invalid" }, diagnostics: expect.arrayContaining([expect.stringContaining("unavailable")]) }] });
  });
});
