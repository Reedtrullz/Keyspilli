import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseId = "tempo-split-fixture";
const levels = ["a", "b", "e", "m", "ve", "vb"];
const originalNotes = [{ midi: 60, start: 1, dur: 2, vel: 90, hand: "R" as const }];
const originalChords = [
  { beat: 2, durationBeats: 2, name: "C", notes: [48, 52, 55] },
  // This chord is the only content in the later part of the final measure;
  // note-only measure reconstruction would erase that space.
  { beat: 6, durationBeats: 1, name: "G", notes: [43, 47, 50] },
];
const originalMeasures = [
  { index: 0, startBeat: 0, endBeat: 4 },
  { index: 1, startBeat: 4, endBeat: 8 },
];

let root = "";
let catalog: typeof import("@keyspilli/catalog");
let midi: typeof import("@keyspilli/midi");
let update: typeof import("./song-update");
let previousDataDir: string | undefined;

function row(level: string) {
  return {
    id: `${baseId}-${level}`,
    baseId,
    title: "Tempo fixture",
    artist: "Tester",
    category: "Test",
    difficulty: level,
    difficultyScore: levels.indexOf(level) + 1,
    key: "C",
    tempo: 120,
    style: "classical",
    mood: "calm",
    bassPattern: "block",
    duration: 3,
    contentType: "standard",
    acquiredVia: null,
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays: 0,
    level,
    createdAt: "2026-08-16T00:00:00.000Z",
  };
}

async function writeFixture() {
  const variant = {
    level: "beginner" as const,
    difficultyScore: 1,
    notes: originalNotes,
    chords: originalChords,
    measures: originalMeasures,
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4] as [number, number],
  };
  for (const level of levels) {
    const dir = join(root, "artifacts", baseId, level);
    await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notes.json"), JSON.stringify(variant));
    await writeFile(join(dir, "variant.mid"), midi.writeMidi(variant.notes, { tempoBpm: 120 }));
    await writeFile(join(dir, "variant.xml"), midi.writeMusicXml(variant, "Tempo fixture", "Tester"));
  }
}

async function stored(level = "a") {
  return JSON.parse(await readFile(join(root, "artifacts", baseId, level, "notes.json"), "utf8")) as {
    notes: typeof originalNotes;
    chords: typeof originalChords;
    measures: typeof originalMeasures;
    tempoBpm: number;
    provenance?: {
      tempo?: {
        calibration: { bpm: number; source: string; role: string; resolvedAt: string };
        playback: { bpm: number; source: string; role: string; resolvedAt: string };
      };
    };
  };
}

beforeAll(async () => {
  previousDataDir = process.env.KEYSPILLI_DATA_DIR;
  root = await mkdtemp(join(tmpdir(), "keyspilli-song-update-"));
  process.env.KEYSPILLI_DATA_DIR = root;
  catalog = await import("@keyspilli/catalog");
  midi = await import("@keyspilli/midi");
  update = await import("./song-update");
  for (const level of levels) catalog.upsertSong(row(level));
  await writeFixture();
});

afterAll(async () => {
  if (previousDataDir === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataDir;
  await rm(root, { recursive: true, force: true });
});

describe("applySongMetadata tempo roles", () => {
  it("bootstraps legacy artifacts and keeps beat-space unchanged for tempo alias playback edits", async () => {
    await update.applySongMetadata(`${baseId}-a`, { tempo: 90 });

    const manifest = JSON.parse(await readFile(join(root, "artifacts", baseId, "manifest.json"), "utf8"));
    expect(manifest.identityStatus).toBe("legacy-bootstrap");
    expect(manifest.tempo.calibration).toMatchObject({ bpm: 120, source: "legacy", role: "source-calibration" });
    expect(manifest.tempo.playback).toMatchObject({ bpm: 90, source: "manual", role: "playback" });
    const next = await stored();
    expect(next.tempoBpm).toBe(90);
    expect(next.provenance?.tempo).toMatchObject({
      calibration: { bpm: 120, source: "legacy", role: "source-calibration" },
      playback: { bpm: 90, source: "manual", role: "playback" },
    });
    expect(next.notes).toEqual(originalNotes);
    expect(next.chords).toEqual(originalChords);
    expect(next.measures).toEqual(originalMeasures);
    expect(catalog.getSongsByBase(baseId).every((r) => r.tempo === 90)).toBe(true);
    // SongRow.duration is stored in whole seconds by ingest. A playback-only
    // change keeps beat coordinates but changes the wall-clock duration.
    expect(catalog.getSongsByBase(baseId).every((r) => r.duration === 4)).toBe(true);
    expect(await readdir(join(root, "artifacts", baseId, "a"))).toEqual(expect.arrayContaining(["notes.json", "variant.mid", "variant.xml"]));
  });

  it("rescales beat-space only for an explicit calibration edit", async () => {
    await update.applySongMetadata(baseId, { calibrationTempo: 240 });

    const next = await stored();
    expect(next.tempoBpm).toBe(90);
    expect(next.provenance?.tempo).toMatchObject({
      calibration: { bpm: 240, source: "manual", role: "source-calibration" },
      playback: { bpm: 90, source: "manual", role: "playback" },
    });
    expect(next.notes).toEqual([{ ...originalNotes[0], start: 2, dur: 4 }]);
    expect(next.chords).toEqual([
      { ...originalChords[0], beat: 4, durationBeats: 4 },
      { ...originalChords[1], beat: 12, durationBeats: 2 },
    ]);
    expect(next.measures).toEqual([
      { index: 0, startBeat: 0, endBeat: 8 },
      { index: 1, startBeat: 8, endBeat: 16 },
    ]);
    expect((next as { durationBeats?: number }).durationBeats).toBe(16);
    const manifest = JSON.parse(await readFile(join(root, "artifacts", baseId, "manifest.json"), "utf8"));
    expect(manifest.tempo.calibration).toMatchObject({ bpm: 240, source: "manual", role: "source-calibration" });
    expect(manifest.tempo.playback.bpm).toBe(90);
    // Calibration doubles the canonical beat span; playback remains 90 BPM.
    expect(catalog.getSongsByBase(baseId).every((r) => r.duration === 8)).toBe(true);
  });

  it("fails closed when legacy variant tempos disagree", async () => {
    const bad = join(root, "artifacts", baseId, "vb", "notes.json");
    const value = JSON.parse(await readFile(bad, "utf8"));
    value.tempoBpm = 121;
    await writeFile(bad, JSON.stringify(value));
    try {
      await expect(update.applySongMetadata(baseId, { tempo: 100 })).rejects.toMatchObject({ status: 500 });
      await expect(readFile(join(root, "artifacts", baseId, "manifest.json"), "utf8")).resolves.toBeTruthy();
    } finally {
      // Keep this failure-injection fixture isolated from the later mirror
      // consistency test; a rejected update must not poison the suite.
      value.tempoBpm = 90;
      await writeFile(bad, JSON.stringify(value));
    }
  });

  it("rejects conflicting tempo roles even when called below the HTTP parser", async () => {
    await expect(update.applySongMetadata(baseId, { tempo: 100, playbackTempo: 105 })).rejects.toMatchObject({ status: 400 });
    await expect(update.applySongMetadata(baseId, { playbackTempo: 100, calibrationTempo: 105 })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps fractional playback tempo aligned across mirrors and exports", async () => {
    await update.applySongMetadata(baseId, { playbackTempo: 90.5 });

    const next = await stored();
    const manifest = JSON.parse(await readFile(join(root, "artifacts", baseId, "manifest.json"), "utf8"));
    const rows = catalog.getSongsByBase(baseId);
    const midiTempo = midi.parseMidi(await readFile(join(root, "artifacts", baseId, "a", "variant.mid"))).tempoBpm;
    const xmlTempo = midi.parseMusicXmlNotes(await readFile(join(root, "artifacts", baseId, "a", "variant.xml"), "utf8")).tempoBpm;

    expect(next.tempoBpm).toBe(90.5);
    expect(manifest.tempo.playback.bpm).toBe(90.5);
    expect(rows.every((row) => row.tempo === 90.5)).toBe(true);
    // The duration mirror follows the same seconds-per-beat conversion for a
    // fractional playback tempo, with the DB's established whole-second
    // rounding contract.
    expect(rows.every((row) => row.duration === 8)).toBe(true);
    // MIDI stores integer microseconds per quarter note; XML and JSON retain
    // the decimal exactly, while the MIDI value remains within the artifact
    // round-trip tolerance.
    expect(midiTempo).toBeCloseTo(90.5, 3);
    expect(xmlTempo).toBe(90.5);
  });

  it("updates duration for a playback edit even when levels have different legacy durations", async () => {
    const rowsBefore = catalog.getSongsByBase(baseId);
    const db = catalog.getDb();
    db.prepare("UPDATE songs SET duration = duration + CASE level WHEN 'a' THEN 1 WHEN 'vb' THEN 2 ELSE 0 END WHERE base_id = ?").run(baseId);
    const variedBefore = catalog.getSongsByBase(baseId);

    await update.applySongMetadata(baseId, { playbackTempo: 45 });

    const variedAfter = catalog.getSongsByBase(baseId);
    expect(variedAfter).toHaveLength(rowsBefore.length);
    for (const before of variedBefore) {
      const after = variedAfter.find((row) => row.id === before.id)!;
      expect(after.duration).toBe(Math.round(before.duration * 90.5 / 45));
    }
  });
});
