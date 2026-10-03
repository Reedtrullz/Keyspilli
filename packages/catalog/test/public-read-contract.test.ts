import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countSongs, getDb, invalidateSongReadModel, listSongs, listSongsGroupedWithTotal, publicCatalogSummary, upsertSong } from "../src/db.js";
import type { SongRow } from "../src/db-types.js";

const directory = mkdtempSync(join(tmpdir(), "keyspilli-public-read-"));
const previous = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = directory;
function row(baseId: string, difficulty = "easy", plays = 0): SongRow {
  return { id: `${baseId}-${difficulty}`, baseId, difficulty, plays, title: baseId,
    artist: "Read Test", category: "Test", difficultyScore: 2, key: "C", tempo: 120,
    style: "classical", mood: "peaceful", bassPattern: "block", duration: 10,
    contentType: "standard", acquiredVia: null, sourceYoutubeUrl: null,
    hasSheetXml: 1, sections: null, level: difficulty, createdAt: "2026-10-01T00:00:00Z" };
}
beforeAll(() => {
  getDb().transaction(() => {
    for (let index = 0; index < 250; index++) {
      const base = `read-${String(index).padStart(3, "0")}`;
      upsertSong(row(base, "easy", index === 1 ? 10 : 0));
      upsertSong(row(base, "beginner"));
    }
    upsertSong(row("read-000", "very-easy", 1000));
    upsertSong(row("legacy-only", "very-easy", 5000));
    upsertSong({ ...row("disabled"), artist: "Disabled Only" });
  })();
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ songs: [{ id: "disabled", disabled: true }] }));
});
afterAll(() => {
  getDb().close(); rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previous;
});
describe("public catalog before count, order and pagination", () => {
  it("uses all filters in ungrouped counts, independent of the requested page", () => {
    expect(countSongs({ q: "read-249", difficulty: "easy", limit: 1, offset: 99 })).toBe(1);
    expect(countSongs({ artist: "missing" })).toBe(0);
    expect(countSongs({ key: "D" })).toBe(0);
    for (const filter of [{ style: "missing" }, { mood: "missing" }, { bassPattern: "missing" }, { category: "missing" }, { q: "%" }, { q: "_" }]) {
      expect(countSongs(filter)).toBe(listSongs(filter).length);
      expect(countSongs(filter)).toBe(0);
    }
    const compound = { q: "read-249", artist: "Read Test", key: "C", category: "Test", style: "classical", mood: "peaceful", bassPattern: "block", difficulty: "easy" };
    expect(countSongs(compound)).toBe(1);
  });
  it("projects public levels before ranking and counting, including empty later pages", () => {
    const first = listSongsGroupedWithTotal({ publicOnly: true, limit: 1 });
    expect(first.total).toBe(250);
    expect(first.songs[0]?.representative.baseId).toBe("read-001");
    expect(first.songs[0]?.totalPlays).toBe(10);
    expect(listSongsGroupedWithTotal({ publicOnly: true, offset: 249, limit: 1, sort: "title" }).songs[0]?.representative.baseId).toBe("read-249");
    expect(listSongsGroupedWithTotal({ publicOnly: true, offset: 250, limit: 1 }).total).toBe(250);
  });
  it("selects an off-page favorite before pagination and retains all public levels", () => {
    const page = listSongsGroupedWithTotal({ publicOnly: true, ids: ["read-249-easy"], limit: 1 });
    expect(page.total).toBe(1);
    expect(page.songs[0]?.levels.map(row => row.difficulty)).toEqual(["beginner", "easy"]);
    expect(page.songs[0]?.representative.baseId).toBe("read-249");
    expect(listSongsGroupedWithTotal({ publicOnly: true, ids: [] }).total).toBe(0);
    expect(listSongsGroupedWithTotal({ publicOnly: true, ids: ["read-000-very-easy"] }).total).toBe(0);
    expect(countSongs({ publicOnly: true, ids: ["read-000-very-easy"] })).toBe(0);
    expect(listSongsGroupedWithTotal({ ids: ["read-000-very-easy"] }).total).toBe(1);
  });
  it("keeps legacy rows for explicit physical reads and applies public row counts", () => {
    expect(listSongs({ q: "legacy-only" })).toHaveLength(1);
    expect(listSongs({ q: "legacy-only", publicOnly: true })).toHaveLength(0);
    expect(countSongs({ publicOnly: true })).toBe(500);
    expect(publicCatalogSummary()).toEqual({ arrangements: 500, plays: 10, artists: [{ artist: "Read Test", arrangements: 500 }] });
  });
  it("fails closed for a malformed visibility policy instead of listing hidden candidates", () => {
    writeFileSync(join(directory, "manifest.json"), "{broken");
    invalidateSongReadModel();
    expect(() => listSongsGroupedWithTotal({ publicOnly: true })).toThrow();
  });
});
