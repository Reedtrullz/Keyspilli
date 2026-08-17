import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChordLabel } from "@keyspilli/midi";
import { createLegacyBootstrapManifest, arrangementManifestPath, upsertSong, writeArrangementManifestFile, type SongRow } from "@keyspilli/catalog";
import { writeMidi, writeMusicXml } from "@keyspilli/midi";
import { getArtifactFile, getSongDetail, loadSongArtifact, mergeChartTimeline } from "./catalog-api";

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
  it("allows an explicit legacy read from the selected notes.json only", async () => {
    const loaded = await loadSongArtifact(song(120));
    expect(loaded.artifact).toEqual({ status: "legacy", errors: [] });
    expect(loaded.data?.tempoBpm).toBe(120);
  });

  it("uses a valid manifest as tempo authority and preserves its provenance", async () => {
    const manifest = createLegacyBootstrapManifest("catalog-api-song", 120, "2026-08-16T17:30:00.000Z");
    await writeArrangementManifestFile(arrangementManifestPath("catalog-api-song"), manifest);
    const loaded = await loadSongArtifact(song(120));
    expect(loaded.artifact).toEqual({ status: "valid", errors: [], manifest });
    expect(loaded.data?.tempoBpm).toBe(120);
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
