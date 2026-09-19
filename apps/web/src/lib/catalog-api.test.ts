import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChordLabel } from "@keyspilli/midi";
import { createLegacyBootstrapManifest, arrangementManifestPath, upsertSong, writeArrangementManifestFile, type SongRow, type SourceTimingMetadata } from "@keyspilli/catalog";
import { writeMidi, writeMusicXml } from "@keyspilli/midi";
import type { SongData } from "@keyspilli/player-core";
import { buildAutoChordSource, getArtifactFile, getSongDetail, getSongDetailShell, loadSongArtifact, mergeChartTimeline, projectChordSources } from "./catalog-api";

const dataRoot = mkdtempSync(join(tmpdir(), "keyspilli-catalog-api-"));
const previousDataRoot = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = dataRoot;

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataRoot;
  await rm(dataRoot, { recursive: true, force: true });
});

const provenance = {
  sourceId: "ug-test",
  provider: "ultimate-guitar",
  kind: "chart" as const,
  sourceRef: "ultimate-guitar:test",
};

const song = (tempo = 120): SongRow => ({
  id: "catalog-api-song-a",
  baseId: "catalog-api-song",
  title: "Catalog API Song",
  artist: "Tester",
  category: "Test",
  difficulty: "standard",
  difficultyScore: 1,
  key: "C",
  tempo,
  style: "test",
  mood: "neutral",
  bassPattern: "block",
  duration: 4,
  contentType: "standard",
  acquiredVia: null,
  sourceYoutubeUrl: null,
  hasSheetXml: 0,
  sections: null,
  plays: 0,
  level: "a",
  createdAt: "2026-08-16T00:00:00.000Z",
});

async function writeNotes(tempoBpm = 120): Promise<void> {
  const dir = join(dataRoot, "artifacts", "catalog-api-song", "a");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "notes.json"), JSON.stringify({
    notes: [],
    chords: [],
    measures: [],
    key: "C",
    tempoBpm,
    timeSig: [4, 4],
  }));
}

async function writeLegacyGeneratedChordNotes(): Promise<void> {
  const dir = join(dataRoot, "artifacts", "catalog-api-song", "a");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "notes.json"), JSON.stringify({
    notes: [{ midi: 60, start: 0, dur: 4, vel: 80, hand: "R" }],
    // This is the pre-provenance shape: sourceKind is intentionally absent.
    chords: [{
      beat: 0,
      durationBeats: 2,
      name: "C",
      notes: [48, 52, 55],
      inferred: true,
      inferenceType: "nearest-symbol",
    }],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
  }));
}

const exportNotes = [{ midi: 60, start: 1, dur: 2, vel: 90, hand: "R" as const }];

const sourceTimingPayload: Omit<SourceTimingMetadata, "sourceFingerprint"> = {
  timeSig: [6, 8],
  measureStartBeat: -3,
  provenance: "source-measure-boundary",
  timeSigEvents: [{ beat: 0, timeSig: [2, 4] }, { beat: 12, timeSig: [6, 8] }],
};

function bindSourceTiming(manifest: { sourceArtifactHash?: string }, notesContent: string): SourceTimingMetadata {
  const notesHash = createHash("sha256").update(notesContent).digest("hex");
  const timingHash = createHash("sha256").update(JSON.stringify(sourceTimingPayload)).digest("hex");
  return {
    ...sourceTimingPayload,
    sourceFingerprint: `variant:${song().baseId}:${song().level}:${song().id}:${manifest.sourceArtifactHash}:notes:${notesHash}:timing:${timingHash}`,
  };
}

async function writeExportFixture(options: {
  midiNotes?: typeof exportNotes;
  xmlNotes?: typeof exportNotes;
  midiTempo?: number;
  xmlTempo?: number;
} = {}): Promise<void> {
  const dir = join(dataRoot, "artifacts", "catalog-api-song", "a");
  const midiNotes = options.midiNotes ?? exportNotes;
  const xmlNotes = options.xmlNotes ?? exportNotes;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "notes.json"), JSON.stringify({
    notes: exportNotes,
    chords: [],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
  }));
  await writeFile(join(dir, "variant.mid"), writeMidi(midiNotes, {
    tempoBpm: options.midiTempo ?? 120,
    timeSig: [4, 4],
  }));
  await writeFile(join(dir, "variant.xml"), writeMusicXml({
    level: "beginner",
    difficultyScore: 1,
    notes: xmlNotes,
    chords: [],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    bassPattern: "block",
    key: "C",
    tempoBpm: options.xmlTempo ?? 120,
    timeSig: [4, 4],
  }, "Catalog API Song", "Tester"));
}

beforeEach(async () => {
  await rm(join(dataRoot, "artifacts", "catalog-api-song"), { recursive: true, force: true });
  await writeNotes();
  upsertSong(song());
});

describe("catalog artifact manifest read boundary", () => {
  it("builds a metadata-only player shell without reading notes.json", async () => {
    await rm(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"));
    const shell = await getSongDetailShell(song().id);
    expect(shell).toEqual({ song: song(), variants: [song()] });
    expect(shell).not.toHaveProperty("data");
    expect(shell).not.toHaveProperty("artifact");
  });

  it("allows an explicit legacy read from the selected notes.json only", async () => {
    const loaded = await loadSongArtifact(song(120));
    expect(loaded.artifact).toEqual({ status: "legacy", errors: [] });
    expect(loaded.data?.tempoBpm).toBe(120);
  });

  it("exposes selected source metadata in both full and sheet-only player payloads", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArrangement = { beta: true, sourceKind: "verified-native-midi", title: "Test", artist: "Fixture", arrangementTitle: "Test Piano", requestedUrl: "https://youtube.com/watch?v=abcdefghijk", actualSourceUrl: "https://scores.example/test.mid", sourceSha256: "a".repeat(64), realizationSha256: "b".repeat(64), candidateSetDigest: "c".repeat(64), timingOwner: "selected-arrangement", containsMelody: false, license: "CC0-1.0", licenseEvidenceUrl: "https://scores.example/license", verificationEvidenceUrl: "https://scores.example/test" };
    upsertSong(song());
    await writeNotes();
    await writeArrangementManifestFile(arrangementManifestPath(song().baseId), manifest);
    expect((await getSongDetail(song().id))?.sourceArrangement).toEqual(manifest.sourceArrangement);
    const shell = await getSongDetailShell(song().id);
    expect(shell?.sourceArrangement).toEqual(manifest.sourceArrangement);
    expect(shell).not.toHaveProperty("data");
  });

  it("uses a valid manifest as tempo authority and preserves its provenance", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120, "2026-08-16T17:30:00.000Z");
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    const loaded = await loadSongArtifact(song(120));
    expect(loaded.artifact).toEqual({ status: "valid", errors: [], manifest });
    expect(loaded.data?.tempoBpm).toBe(120);
  });

  it("binds loaded song data to the manifest and actual notes content", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);

    const notesPath = join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json");
    const firstNotes = {
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const },
        { midi: 62, start: 1, dur: 1, vel: 90, hand: "R" as const },
        { midi: 64, start: 2, dur: 1, vel: 90, hand: "R" as const },
      ],
      chords: [],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4] as [number, number],
    };
    await writeFile(notesPath, JSON.stringify(firstNotes));
    const first = await loadSongArtifact(song(120));
    await writeFile(notesPath, JSON.stringify({
      ...firstNotes,
      notes: firstNotes.notes.map((note, index) => index === 1 ? { ...note, midi: 65 } : note),
    }));
    const second = await loadSongArtifact(song(120));

    const firstNotesHash = createHash("sha256").update(JSON.stringify(firstNotes)).digest("hex");
    expect(first.data?.sourceFingerprint).toBe(`variant:${song().baseId}:${song().level}:${song().id}:${manifest.sourceArtifactHash}:notes:${firstNotesHash}`);
    expect(second.data?.sourceFingerprint).not.toBe(first.data?.sourceFingerprint);
    expect(second.data?.sourceFingerprint).toContain(`variant:${song().baseId}:${song().level}:${song().id}:${manifest.sourceArtifactHash}:notes:`);
  });

  it("binds manifest source timing to the exact notes and timing identity", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    const notes = {
      notes: [{ midi: 60, start: 0, dur: 24, vel: 80, hand: "R" as const }],
      chords: [],
      measures: [
        { index: 0, startBeat: 0, endBeat: 2 },
        { index: 1, startBeat: 2, endBeat: 4 },
        { index: 2, startBeat: 4, endBeat: 6 },
        { index: 3, startBeat: 6, endBeat: 8 },
        { index: 4, startBeat: 8, endBeat: 10 },
        { index: 5, startBeat: 10, endBeat: 12 },
        { index: 6, startBeat: 12, endBeat: 15 },
        { index: 7, startBeat: 15, endBeat: 18 },
        { index: 8, startBeat: 18, endBeat: 21 },
        { index: 9, startBeat: 21, endBeat: 24 },
      ],
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [2, 4] },
        { tick: 5760, beat: 12, timeSig: [6, 8] },
      ],
    };
    const notesContent = JSON.stringify(notes);
    manifest.sourceTiming = { [song().id]: bindSourceTiming(manifest, notesContent) };
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), notesContent);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);

    const loaded = await loadSongArtifact(song(120));
    expect(loaded.data?.sourceTiming).toMatchObject({
      timeSig: [6, 8],
      measureStartBeat: -3,
      provenance: "source-measure-boundary",
      sourceFingerprint: loaded.data?.sourceFingerprint,
      timeSigEvents: [{ beat: 0, timeSig: [2, 4] }, { beat: 12, timeSig: [6, 8] }],
    });

    for (const level of ["b", "e"] as const) {
      const sibling = {
        ...song(120),
        id: `catalog-api-song-${level}`,
        level,
        difficulty: level === "b" ? "beginner" : "easy",
      } as SongRow;
      upsertSong(sibling);
      const siblingDir = join(dataRoot, "artifacts", "catalog-api-song", level);
      await mkdir(siblingDir, { recursive: true });
      await writeFile(join(siblingDir, "notes.json"), notesContent);
      const siblingLoaded = await loadSongArtifact(sibling);
      expect(siblingLoaded.data?.notes).toEqual(notes.notes);
      expect(siblingLoaded.data).not.toHaveProperty("sourceTiming");
    }

    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), JSON.stringify({
      ...notes,
      notes: [{ ...notes.notes[0], midi: 61 }],
    }));
    expect((await loadSongArtifact(song(120))).data).not.toHaveProperty("sourceTiming");

    const changedTiming = {
      ...manifest,
      sourceTiming: {
        [song().id]: { ...manifest.sourceTiming![song().id]!, measureStartBeat: -2 },
      },
    };
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), changedTiming);
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), notesContent);
    expect((await loadSongArtifact(song(120))).data).not.toHaveProperty("sourceTiming");

    const changedSource = { ...manifest, sourceArtifactHash: "b".repeat(64) };
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), changedSource);
    expect((await loadSongArtifact(song(120))).data).not.toHaveProperty("sourceTiming");
  });

  it("does not auto-bind legacy inline timing without an exact source identity", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), JSON.stringify({
      notes: [],
      chords: [],
      measures: [],
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      sourceTiming: { ...sourceTimingPayload },
    }));

    const loaded = await loadSongArtifact(song(120));
    expect(loaded.data).not.toHaveProperty("sourceTiming");
  });

  it("drops source timing that carries a stale source identity", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), JSON.stringify({
      notes: [],
      chords: [],
      measures: [],
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      sourceTiming: { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary", sourceFingerprint: "stale" },
    }));

    const loaded = await loadSongArtifact(song(120));
    expect(loaded.data).not.toHaveProperty("sourceTiming");
  });

  it("drops source timing that conflicts with the canonical meter", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    const timing = {
      timeSig: [4, 4] as [number, number],
      measureStartBeat: 0,
      provenance: "source-measure-boundary" as const,
    };
    const notes = {
      notes: [{ midi: 60, start: 0, dur: 8, vel: 80 }],
      chords: [],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ],
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
    };
    const notesContent = JSON.stringify(notes);
    const notesHash = createHash("sha256").update(notesContent).digest("hex");
    const timingHash = createHash("sha256").update(JSON.stringify(timing)).digest("hex");
    manifest.sourceTiming = {
      [song().id]: {
        ...timing,
        sourceFingerprint: `variant:${song().baseId}:${song().level}:${song().id}:${manifest.sourceArtifactHash}:notes:${notesHash}:timing:${timingHash}`,
      },
    };
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), notesContent);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);

    expect((await loadSongArtifact(song(120))).data).not.toHaveProperty("sourceTiming");
  });

  it("rejects malformed note timing and oversized durations at the loader boundary", async () => {
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), JSON.stringify({
      notes: [{ midi: 60, start: "0", dur: 1_000_000, vel: 80 }],
      chords: [],
      measures: [],
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
    }));
    const loaded = await loadSongArtifact(song(120));
    expect(loaded.data).toBeNull();
    expect(loaded.artifact.status).toBe("unavailable");
  });

  it("preserves meter declarations without promoting phase provenance", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), JSON.stringify({
      notes: [],
      chords: [],
      measures: [],
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [2, 4] },
        { tick: 5760, beat: 12, timeSig: [6, 8] },
      ],
    }));

    const loaded = await loadSongArtifact(song(120));
    expect(loaded.data?.timeSigEvents).toEqual([
      { tick: 0, beat: 0, timeSig: [2, 4] },
      { tick: 5760, beat: 12, timeSig: [6, 8] },
    ]);
    expect(loaded.data).not.toHaveProperty("sourceTiming");
  });

  it("drops segmented sidecar timing when notes.json has no matching canonical events", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120);
    manifest.sourceArtifactHash = "a".repeat(64);
    const notes = {
      notes: [],
      chords: [],
      measures: [
        { index: 0, startBeat: 0, endBeat: 2 },
        { index: 1, startBeat: 2, endBeat: 4 },
        { index: 2, startBeat: 4, endBeat: 6 },
        { index: 3, startBeat: 6, endBeat: 8 },
        { index: 4, startBeat: 8, endBeat: 10 },
        { index: 5, startBeat: 10, endBeat: 12 },
        { index: 6, startBeat: 12, endBeat: 15 },
      ],
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
    };
    const notesContent = JSON.stringify(notes);
    manifest.sourceTiming = { [song().id]: bindSourceTiming(manifest, notesContent) };
    await writeFile(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"), notesContent);
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);

    expect((await loadSongArtifact(song(120))).data).not.toHaveProperty("sourceTiming");
  });

  it("projects legacy MIDI-derived chords with generated provenance and duration metadata", async () => {
    await writeLegacyGeneratedChordNotes();

    const detail = await getSongDetail(song().id);
    expect(detail?.artifact.status).toBe("legacy");
    expect(detail?.data?.chords).toEqual([{
      beat: 0,
      durationBeats: 2,
      name: "C",
      notes: [48, 52, 55],
      sourceKind: "generated",
      inferred: true,
      inferenceType: "nearest-symbol",
    }]);
    expect(detail?.data).not.toHaveProperty("ugChordTimeline");
  });

  it("ships one generated chord timeline copy with an explicit compact reference", async () => {
    await writeLegacyGeneratedChordNotes();

    const detail = await getSongDetail(song().id);
    const bundle = detail?.data?.chordSources;
    expect(bundle?.generated).toMatchObject({ id: "generated", chordsRef: "data.chords" });
    expect(bundle?.generated).not.toHaveProperty("chords");
    // The canonical top-level projection remains available for simplified
    // export and older API consumers.
    expect(detail?.data?.chords).toHaveLength(1);
  });

  it("fails closed for malformed manifests, missing selected levels, and mirror drift", async () => {
    await writeFile(arrangementManifestPath("catalog-api-song"), "{\"schemaVersion\":1}\n");
    await expect(loadSongArtifact(song(120))).resolves.toMatchObject({
      data: null,
      artifact: { status: "unavailable" },
    });

    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120, "2026-08-16T17:30:00.000Z");
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    await writeNotes(118);
    await expect(loadSongArtifact(song(120))).resolves.toMatchObject({
      data: null,
      artifact: { status: "unavailable", errors: ["tempo mismatch: manifest playback=120, notes.json=118"] },
    });

    await rm(join(dataRoot, "artifacts", "catalog-api-song", "a", "notes.json"));
    await expect(loadSongArtifact(song(120))).resolves.toMatchObject({
      data: null,
      artifact: { status: "unavailable" },
    });
  });
});

describe("catalog artifact export validation", () => {
  it("serves MIDI and MusicXML when both round-trip to canonical notes.json", async () => {
    await writeExportFixture();
    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeInstanceOf(Buffer);
    await expect(getArtifactFile(song().id, "variant.xml")).resolves.toBeInstanceOf(Buffer);
  });

  it("rejects exports that lose the canonical meter-event timeline", async () => {
    const dir = join(dataRoot, "artifacts", "catalog-api-song", "a");
    const timeSigEvents = [
      { tick: 0, beat: 0, timeSig: [2, 4] as [number, number] },
      { tick: 1920, beat: 4, timeSig: [6, 8] as [number, number] },
    ];
    const measures = [
      { index: 0, startBeat: 0, endBeat: 4 },
      { index: 1, startBeat: 4, endBeat: 7 },
    ];
    await writeFile(join(dir, "notes.json"), JSON.stringify({
      notes: exportNotes,
      chords: [],
      measures,
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      timeSigEvents,
    }));
    await writeFile(join(dir, "variant.mid"), writeMidi(exportNotes, { tempoBpm: 120, timeSig: [6, 8] }));
    await writeFile(join(dir, "variant.xml"), writeMusicXml({
      level: "beginner",
      difficultyScore: 1,
      notes: exportNotes,
      chords: [],
      measures,
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
    }, "Catalog API Song", "Tester"));

    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeNull();
    await expect(getArtifactFile(song().id, "variant.xml")).resolves.toBeNull();
  });

  it("serves exports when notes.json and rendered artifacts share meter events", async () => {
    const dir = join(dataRoot, "artifacts", "catalog-api-song", "a");
    const timeSigEvents = [
      { tick: 0, beat: 0, timeSig: [2, 4] as [number, number] },
      { tick: 1920, beat: 4, timeSig: [6, 8] as [number, number] },
    ];
    const measures = [
      { index: 0, startBeat: 0, endBeat: 2 },
      { index: 1, startBeat: 2, endBeat: 4 },
      { index: 2, startBeat: 4, endBeat: 7 },
    ];
    await writeFile(join(dir, "notes.json"), JSON.stringify({
      notes: exportNotes,
      chords: [],
      measures,
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      timeSigEvents,
    }));
    await writeFile(join(dir, "variant.mid"), writeMidi(exportNotes, { tempoBpm: 120, timeSig: [6, 8], timeSigEvents }));
    await writeFile(join(dir, "variant.xml"), writeMusicXml({
      level: "beginner",
      difficultyScore: 1,
      notes: exportNotes,
      chords: [],
      measures,
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [6, 8],
      timeSigEvents,
    }, "Catalog API Song", "Tester"));

    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeInstanceOf(Buffer);
    await expect(getArtifactFile(song().id, "variant.xml")).resolves.toBeInstanceOf(Buffer);
  });

  it("blocks playback and cached exports while a publication needs reconciliation", async () => {
    await writeExportFixture();
    expect(await getArtifactFile(song().id, "variant.mid")).toBeInstanceOf(Buffer);
    const journal = join(dataRoot, "artifacts", `.${song().baseId}.reconciliation.json`);
    await writeFile(journal, "{}");
    try {
      expect(await getArtifactFile(song().id, "variant.mid")).toBeNull();
      expect((await loadSongArtifact(song())).artifact.errors).toContain("ARTIFACT_RECONCILIATION_REQUIRED");
    } finally { await rm(journal); }
    expect(await getArtifactFile(song().id, "variant.mid")).toBeInstanceOf(Buffer);
  });

  it("revalidates a cached export after an in-place artifact update", async () => {
    await writeExportFixture();
    const first = await getArtifactFile(song().id, "variant.mid");
    expect(first).toBeInstanceOf(Buffer);

    // Keep the same path and byte shape while changing the rendered note. The
    // signature must notice the write instead of serving the prior validated
    // bytes from the bounded process-local cache.
    await writeExportFixture({
      midiNotes: [{ midi: 62, start: 1, dur: 2, vel: 90, hand: "R" }],
    });
    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeNull();
  });

  it("does not expose mutable cache buffers to callers", async () => {
    await writeExportFixture();
    const first = await getArtifactFile(song().id, "variant.mid");
    if (!(first instanceof Buffer) || first.length === 0) throw new Error("expected cached MIDI bytes");
    const original = first[0];
    if (original === undefined) throw new Error("expected first MIDI byte");
    first![0] = original ^ 0xff;
    const second = await getArtifactFile(song().id, "variant.mid");
    expect(second?.[0]).toBe(original);
  });

  it("fails closed for a stale MIDI note or tempo export", async () => {
    await writeExportFixture({
      midiNotes: [{ midi: 62, start: 1, dur: 2, vel: 90, hand: "R" }],
      midiTempo: 121,
    });
    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeNull();
    await expect(getArtifactFile(song().id, "variant.xml")).resolves.toBeNull();
  });

  it("fails closed for a stale MusicXML note or tempo export", async () => {
    await writeExportFixture({
      xmlNotes: [{ midi: 62, start: 1, dur: 2, vel: 90, hand: "R" }],
      xmlTempo: 121,
    });
    await expect(getArtifactFile(song().id, "variant.mid")).resolves.toBeNull();
    await expect(getArtifactFile(song().id, "variant.xml")).resolves.toBeNull();
  });
});

describe("catalog chart timeline merge", () => {
  it("projects strict chart and auto sources through the shared detail shape", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "projection-song",
      title: "Projection Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "opening-section" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" as const }],
      provenance,
    };
    const data: SongData = {
      notes: [{ midi: 60, start: 0, dur: 4, vel: 80, hand: "R" }],
      chords: [{ beat: 0, durationBeats: 4, name: "G", notes: [43, 47, 50] }],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
    };

    const projected = projectChordSources(data, timeline);

    expect(projected.ugChordTimeline).toEqual(timeline.chords);
    expect(projected.chordSources?.ug).toMatchObject({ id: "ug", coverage: "opening-section" });
    expect(projected.chordSources?.auto).toMatchObject({ id: "auto", fallback: true, coverage: "full-song" });
    expect(projected.chordSources?.generated).toMatchObject({ id: "generated", chordsRef: "data.chords" });
  });

  it("marks only partial or generated-filled merges as fallback", () => {
    const fullTimeline = {
      schemaVersion: 1 as const,
      baseId: "full-song",
      title: "Full Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 8,
      coverage: "full-song" as const,
      chords: [{ beat: 0, durationBeats: 8, name: "C", notes: [48, 52, 55], sourceKind: "authored" as const }],
      provenance,
    };
    const full = mergeChartTimeline(fullTimeline, [], 8);
    const fullAuto = buildAutoChordSource(fullTimeline, full, {
      id: "ug",
      label: "UG timeline",
      chords: full.chords,
      provenance: "ultimate-guitar:test",
      coverage: "full-song",
      fallback: false,
      fallbackReason: null,
    });
    expect(fullAuto.fallback).toBe(false);
    expect(fullAuto.label).toBe("UG timeline");
    expect(fullAuto.provenance).toBe("ultimate-guitar:test");
    expect(fullAuto.provenanceInfo).toMatchObject({ kind: "chart", sourceRef: "ultimate-guitar:test" });

    const partialTimeline = {
      ...fullTimeline,
      baseId: "partial-song",
      durationBeats: 4,
      coverage: "opening-section" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" as const }],
    };
    const partial = mergeChartTimeline(partialTimeline, [
      { beat: 4, durationBeats: 4, name: "G", notes: [43, 47, 50], sourceKind: "generated" },
    ], 8);
    const partialAuto = buildAutoChordSource(partialTimeline, partial, {
      id: "ug",
      label: "UG opening (partial)",
      chords: partial.chords.slice(0, 1),
      provenance: "ultimate-guitar:test",
      coverage: "opening-section",
      fallback: false,
      fallbackReason: null,
    });
    expect(partialAuto.fallback).toBe(true);
    expect(partialAuto.label).toBe("UG + generated fallback");
    expect(partialAuto.fallbackReason).toMatch(/generated|remaining/i);
    expect(partialAuto.provenanceInfo).toMatchObject({ kind: "chart", sourceRef: "ultimate-guitar:test", fallback: true });

    const fallbackOnlyTimeline = {
      ...fullTimeline,
      baseId: "fallback-only-song",
      provenance: { ...provenance, fallback: true, fallbackReason: "UG unavailable" },
    };
    const fallbackOnly = mergeChartTimeline(fallbackOnlyTimeline, [], 8);
    const fallbackOnlyAuto = buildAutoChordSource(fallbackOnlyTimeline, fallbackOnly, null);
    expect(fallbackOnlyAuto.label).toBe("Generated fallback");
  });

  it("fills partial or unvoiced chart positions from generated chords", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 12,
      coverage: "opening-section" as const,
      chords: [
        { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" as const },
        { beat: 4, durationBeats: 4, name: "Unsupported", sourceKind: "authored" as const },
      ],
      provenance,
    };
    const generated: ChordLabel[] = [
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 4, name: "F", notes: [41, 48, 53] },
      { beat: 8, name: "G", notes: [43, 50, 55] },
    ];

    const merged = mergeChartTimeline(timeline, generated);
    // An authored symbol with an explicit empty voicing remains displayable
    // and suppresses generated replacement at the same beat. Fallback still
    // fills the uncovered remainder.
    expect(merged.chords.map((chord) => chord.name)).toEqual(["C", "Unsupported", "G"]);
    expect(merged.chords[1]?.notes).toEqual([]);
    expect(merged.chords[2]?.sourceKind).toBe("generated");
    expect(merged.provenance.fallback).toBe(true);
    expect(merged.provenance.fallbackReason).toMatch(/remaining song|uncovered/i);
  });

  it("derives a voicing for a supported symbol when the chart omits notes", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "full-song" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "G7", sourceKind: "authored" as const }],
      provenance,
    };
    const merged = mergeChartTimeline(timeline, []);
    expect(merged.chords[0]?.notes).toEqual([43, 55, 59, 62, 65]);
    expect(merged.provenance.fallback).not.toBe(true);
  });

  it("does not relabel a generated-only fallback as an Ultimate Guitar chart", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "generated-song",
      title: "Generated Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "full-song" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "generated" as const }],
      provenance: {
        sourceId: "midi-derived",
        provider: "keyspilli",
        kind: "midi-derived" as const,
        sourceRef: "variant:a:notes.json",
        fallback: true,
        fallbackReason: "chart artifact unavailable; derived from a/notes.json",
      },
    };
    const merged = mergeChartTimeline(timeline, []);
    expect(merged.provenance.kind).toBe("midi-derived");
    expect(merged.provenance.fallbackReason).toContain("chart artifact unavailable");
  });

  it("keeps chart metadata and notes ahead of generated material at the same beat", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "metadata-song",
      title: "Metadata Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 8,
      coverage: "full-song" as const,
      chords: [{
        beat: 0,
        durationBeats: 4,
        name: "C/E",
        notes: [52, 55, 60, 64],
        sourceKind: "authored" as const,
        inferred: false,
        inferenceType: "voicing" as const,
      }],
      provenance,
    };
    const merged = mergeChartTimeline(timeline, [
      {
        beat: 0,
        durationBeats: 4,
        name: "C",
        notes: [48, 52, 55],
        sourceKind: "generated",
        inferred: true,
        inferenceType: "nearest-symbol",
      },
      {
        beat: 4,
        durationBeats: 4,
        name: "G",
        notes: [43, 47, 50],
        sourceKind: "generated",
        inferred: true,
        inferenceType: "carry-forward-root",
      },
    ]);

    expect(merged.chords).toEqual([
      {
        beat: 0,
        durationBeats: 4,
        name: "C/E",
        notes: [52, 55, 60, 64],
        sourceKind: "authored",
        inferred: false,
        inferenceType: "voicing",
      },
      {
        beat: 4,
        durationBeats: 4,
        name: "G",
        notes: [43, 47, 50],
        sourceKind: "generated",
        inferred: true,
        inferenceType: "carry-forward-root",
      },
    ]);
  });

  it("keeps an authored display-only event and suppresses generated overlap", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "display-only-song",
      title: "Display Only Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "full-song" as const,
      chords: [{
        beat: 0,
        durationBeats: 4,
        name: "N.C.",
        notes: [],
        sourceKind: "authored" as const,
      }],
      provenance,
    };
    const merged = mergeChartTimeline(timeline, [{
      beat: 0,
      durationBeats: 4,
      name: "C",
      notes: [48, 52, 55],
      sourceKind: "generated",
    }]);
    expect(merged.chords).toEqual([{
      beat: 0,
      durationBeats: 4,
      name: "N.C.",
      notes: [],
      sourceKind: "authored",
    }]);
  });
});
