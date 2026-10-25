import { afterAll, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countSongsGrouped, getDb, getSong, listSongsGroupedWithTotal, replaceSongsByBase, type SongRow } from "../src/db.js";
import { parseSongVersionGroups } from "../src/song-versions.js";
import { projectPublicGroupedSong } from "../src/public-difficulty.js";
import { groupSongs } from "../src/group.js";

const root = mkdtempSync(join(tmpdir(), "keyspilli-song-versions-"));
const previous = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = root;
const groups = [{ primaryBaseId: "studio", versions: [{ baseId: "studio", label: "Studio recording" }, { baseId: "live", label: "Audiotree" }] }];
const configure = () => writeFileSync(join(root, "artifacts", ".song-versions.json"), JSON.stringify({ schemaVersion: 1, groups }));
const row = (baseId: string, level: string, difficulty: string): SongRow => ({
  id: `${baseId}-${level}`, baseId, title: baseId === "studio" ? "Skeleton" : "Skeleton Audiotree", artist: "The Front Bottoms",
  category: "Pop", difficulty, difficultyScore: level === "a" ? 4 : 2, key: baseId === "studio" ? "C" : "G", tempo: 148,
  style: "pop", mood: "neutral", bassPattern: "block", duration: 212, contentType: "youtube", acquiredVia: "youtube",
  sourceYoutubeUrl: `https://youtube.com/watch?v=${baseId}`, hasSheetXml: 1, sections: null,
  plays: baseId === "studio" ? 1 : 20, level, createdAt: "2026-10-25T00:00:00Z",
});
beforeEach(() => {
  mkdirSync(join(root, "artifacts"), { recursive: true });
  getDb().prepare("DELETE FROM songs").run();
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ songs: [] }));
  for (const base of ["studio", "live"]) replaceSongsByBase(base, [row(base, "e", "easy"), row(base, "a", "advanced"), row(base, "ve", "very-easy")]);
  configure();
});
afterAll(() => {
  getDb().close();
  if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR; else process.env.KEYSPILLI_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

it("keeps the chosen studio primary, folds alternatives before pagination and preserves every row/link", () => {
  const page = listSongsGroupedWithTotal({ publicOnly: true, q: "Skeleton", limit: 1 });
  expect(page.total).toBe(1);
  expect(page.songs[0]?.representative.baseId).toBe("studio");
  expect(page.songs[0]?.alternativeVersions?.map(v => [v.label, v.representative.baseId])).toEqual([["Audiotree", "live"]]);
  expect(page.songs[0]?.totalPlays).toBe(42);
  expect(page.songs[0]?.alternativeVersions?.[0]?.levels.map(v => v.level)).toEqual(["e", "a"]);
  expect(getDb().prepare("SELECT COUNT(*) n FROM songs").get()).toEqual({ n: 6 });
  expect(getSong("live-a")?.sourceYoutubeUrl).toContain("live");
  expect(listSongsGroupedWithTotal({ publicOnly: true, limit: 1, offset: 1 }).songs).toEqual([]);
});

it("finds the family through an alternative title, favorite ID or key without extra song cards", () => {
  for (const filter of [{ q: "Audiotree" }, { ids: ["live-a"] }, { key: "G" }]) {
    const page = listSongsGroupedWithTotal({ publicOnly: true, ...filter });
    expect(page.total).toBe(1);
    expect(page.songs[0]?.representative.baseId).toBe("studio");
  }
});

it("does not expose hidden alternatives or a hidden primary", () => {
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ songs: [{ id: "live", disabled: true }] }));
  expect(listSongsGroupedWithTotal().songs[0]?.alternativeVersions).toBeUndefined();
  expect(getSong("live-a")).toBeUndefined();
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ songs: [{ id: "studio", disabled: true }] }));
  const page = listSongsGroupedWithTotal();
  expect(page.songs.map(g => g.representative.baseId)).toEqual(["live"]);
  expect(page.songs[0]?.alternativeVersions).toBeUndefined();
});

it("observes config changes without SQLite writes and refuses to combine different artists", () => {
  expect(countSongsGrouped()).toBe(1);
  rmSync(join(root, "artifacts", ".song-versions.json"));
  expect(countSongsGrouped()).toBe(2);
  configure();
  expect(countSongsGrouped()).toBe(1);
  replaceSongsByBase("live", [{ ...row("live", "a", "advanced"), artist: "Another artist" }]);
  expect(countSongsGrouped()).toBe(2);
});

it("rejects ambiguous membership, repeated labels, unsafe IDs and an unsupported schema", () => {
  expect(parseSongVersionGroups({ schemaVersion: 1, groups })).toEqual(groups);
  for (const value of [
    { schemaVersion: 2, groups },
    { schemaVersion: 1, groups: [groups[0], groups[0]] },
    { schemaVersion: 1, groups: [{ ...groups[0], versions: [{ baseId: "studio", label: "Same" }, { baseId: "live", label: "Same" }] }] },
    { schemaVersion: 1, groups: [{ ...groups[0], primaryBaseId: "../private" }] },
  ]) expect(() => parseSongVersionGroups(value)).toThrow();
});

it("does not retain an alternative made entirely of deprecated levels during public projection", () => {
  const primary = groupSongs([row("studio", "e", "easy")])[0]!;
  const legacy = row("live", "ve", "very-easy");
  const projected = projectPublicGroupedSong({ ...primary, alternativeVersions: [{ label: "Legacy", representative: legacy, levels: [legacy] }] });
  expect(projected?.alternativeVersions).toBeUndefined();
});
