import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  countSongsGrouped,
  getDb,
  invalidateSongReadModel,
  listSongsGroupedWithTotal,
  upsertSong,
} from "../src/db.js";
import type { SongRow } from "../src/db.js";

// Keep this suite isolated from the repository catalogue. db.ts owns one
// process-local connection, so the data directory must be selected before the
// first helper call in this module.
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-grouped-cache-"));
const previousDataDir = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = dataDir;

function row(index: number): SongRow {
  const baseId = `grouped-cache-${String(index).padStart(5, "0")}`;
  return {
    id: `${baseId}-e`,
    baseId,
    title: `Cache Song ${index}`,
    artist: "Cache Test",
    category: "Test",
    difficulty: "easy",
    difficultyScore: 2.6,
    key: "C",
    tempo: 100,
    style: "classical",
    mood: "peaceful",
    bassPattern: "block",
    duration: 60,
    contentType: "standard",
    acquiredVia: null,
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays: 0,
    level: "e",
    createdAt: "2026-08-25T00:00:00Z",
  };
}

beforeAll(() => {
  const conn = getDb();
  const stmt = conn.prepare(
    `INSERT INTO songs (id, base_id, title, artist, category, difficulty, difficulty_score, key, tempo, style, mood, bass_pattern, duration, content_type, acquired_via, source_youtube_url, has_sheet_xml, sections, plays, level, created_at)
     VALUES (@id, @baseId, @title, @artist, @category, @difficulty, @difficultyScore, @key, @tempo, @style, @mood, @bassPattern, @duration, @contentType, @acquiredVia, @sourceYoutubeUrl, @hasSheetXml, @sections, @plays, @level, @createdAt)`,
  );
  const insert = conn.transaction(() => {
    for (let index = 0; index < 10_001; index += 1) stmt.run(row(index));
  });
  insert();
  invalidateSongReadModel();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataDir;
});

describe("grouped catalogue read-model cache", () => {
  it("does not truncate grouped totals at the old 10,000-row cap", () => {
    const page = listSongsGroupedWithTotal({ limit: 2_000 });
    expect(page.total).toBe(10_001);
    expect(page.songs).toHaveLength(2_000);
  });

  it("invalidates after catalog writes and explicit raw metadata updates", () => {
    expect(countSongsGrouped({ q: "Cache Song 10001" })).toBe(0);
    upsertSong(row(10_001));
    expect(countSongsGrouped({ q: "Cache Song 10001" })).toBe(1);

    getDb().prepare("UPDATE songs SET title = ? WHERE base_id = ?").run("Renamed Cache Song", row(10_001).baseId);
    // Raw SQL callers (for example song-update.ts) use this exported hook.
    invalidateSongReadModel();
    expect(countSongsGrouped({ q: "Renamed Cache Song" })).toBe(1);
    expect(countSongsGrouped({ q: "Cache Song 10001" })).toBe(0);
  });

  it("refreshes when the visibility policy file is atomically added/removed", () => {
    const manifest = join(dataDir, "manifest.json");
    const baseId = row(0).baseId;
    expect(countSongsGrouped({ artist: "Cache Test" })).toBe(10_002);
    writeFileSync(manifest, JSON.stringify({ songs: [{ id: baseId, disabled: true }] }));
    expect(countSongsGrouped({ artist: "Cache Test" })).toBe(10_001);
    unlinkSync(manifest);
    expect(countSongsGrouped({ artist: "Cache Test" })).toBe(10_002);
  });
});
