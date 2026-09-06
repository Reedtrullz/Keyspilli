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

  it("parses human ledger and source policy metadata without accepting path-bearing values", () => {
    const parsed = parseMidiCorpusManifest({
      schemaVersion: 1,
      corpusId: "human-ledger",
      sources: [{
        id: "free-bird",
        file: "/tmp/free-bird.mid",
        humanSourceReview: "ACCEPTED",
        humanMusicalSanity: "PASS",
        evaluationPolicy: {
          target: "PIANO_TARGET",
          referenceModes: ["RHYTHM", "MELODY", "MELODY"],
          matching: "ALIGNED_WINDOWS",
          fullSongRequired: false,
          alignedWindowsRequired: true,
          orchestrationLiteral: true,
          warnings: ["shortened arrangement"],
        },
        recordingVersion: {
          id: "free-bird-v1",
          label: "shortened arrangement",
          relation: "SHORTENED_OR_STRUCTURALLY_DIFFERENT",
          correspondence: "ALIGNED_WINDOWS",
        },
      }],
    }, false);
    expect(parsed.sources[0]).toMatchObject({
      humanSourceReview: "ACCEPTED",
      humanMusicalSanity: "PASS",
      evaluationPolicy: {
        target: "PIANO_TARGET",
        referenceModes: ["MELODY", "RHYTHM"],
        matching: "ALIGNED_WINDOWS",
        fullSongRequired: false,
        alignedWindowsRequired: true,
        orchestrationLiteral: true,
        warnings: ["shortened arrangement"],
      },
      recordingVersion: {
        id: "free-bird-v1",
        label: "shortened arrangement",
        relation: "SHORTENED_OR_STRUCTURALLY_DIFFERENT",
        correspondence: "ALIGNED_WINDOWS",
      },
    });
    expect(() => parseMidiCorpusManifest({
      schemaVersion: 1,
      corpusId: "human-ledger",
      sources: [{ id: "unsafe", file: "/tmp/unsafe.mid", evaluationPolicy: { warnings: ["/Users/reidar/private/reference.mid"] } }],
    }, false)).toThrow(/must be a logical path-free value/);
    expect(() => parseMidiCorpusManifest({
      schemaVersion: 1,
      corpusId: "human-ledger",
      sources: [{ id: "unsafe", file: "/tmp/unsafe.mid", recordingVersion: { id: "/Users/reidar/private/reference.mid" } }],
    }, false)).toThrow(/must be a logical path-free value/);
  });

  it("builds a deterministic path-free report outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-midi-corpus-test-"));
    const input = join(root, "source.mid");
    const manifest = join(root, "manifest.json");
    const output = join(root, "out");
    await writeFile(input, fixtureMidi());
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, corpusId: "test-corpus", sources: [{
      id: "song-a",
      artist: "Test",
      title: "Song",
      file: input,
      referenceKind: "direct-piano",
      humanSourceReview: "ACCEPTED",
      humanMusicalSanity: "PASS",
      evaluationPolicy: { matching: "FULL_SONG", referenceModes: ["PIANO_TARGET", "MELODY"] },
      recordingVersion: { id: "song-a-v1", relation: "CANONICAL", correspondence: "FULL_SONG" },
    }] }));
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
      sources: [{
        artifacts: { canonicalJson: "canonical/song-a.json" },
        humanSourceReview: "ACCEPTED",
        humanMusicalSanity: "PASS",
        evaluationPolicy: { matching: "FULL_SONG", referenceModes: ["MELODY", "PIANO_TARGET"] },
        recordingVersion: { id: "song-a-v1", relation: "CANONICAL", correspondence: "FULL_SONG" },
      }],
    });
  });

  it("carries top-level pair identity from an external sidecar into the strict benchmark gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-midi-corpus-pair-"));
    const input = join(root, "source.mid");
    const manifest = join(root, "manifest.json");
    const pairs = join(root, "pairs.json");
    const output = join(root, "out");
    await writeFile(input, fixtureMidi());
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, corpusId: "pair-corpus", sources: [{ id: "song-a", file: input }] }));
    await writeFile(pairs, JSON.stringify({ comparisons: [{
      songId: "song-a",
      status: "aligned",
      comparable: true,
      alignedDurationBeats: 128,
      inputSha256: "a".repeat(64),
      referenceSha256: "b".repeat(64),
      baseline: { revision: "old", coverage: { windows: 3, bars: 32, status: "aligned" } },
      current: { revision: "new", coverage: { windows: 3, bars: 32, status: "aligned" } },
    }] }));

    const result = await buildMidiCorpus({ manifest, out: output, pairs, requireSeven: false });
    const report = JSON.parse(await readFile(result.report, "utf8")) as { benchmark: { comparableSongCount: number } };
    expect(report.benchmark.comparableSongCount).toBe(1);
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
