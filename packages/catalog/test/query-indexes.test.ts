import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb } from "../src/db.js";

// Select an isolated database before the first getDb() call in this module.
// The catalog connection is intentionally process-local, so this keeps the
// schema assertions independent from a developer's checked-in data volume.
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-query-indexes-"));
const previousDataDir = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = dataDir;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataDir;
});

describe("catalog ordering indexes", () => {
  it("creates indexes that satisfy the API's ordered first-page queries", () => {
    const db = getDb();
    const indexNames = (db.prepare("PRAGMA index_list(songs)").all() as { name: string }[]).map((index) => index.name);
    expect(indexNames).toEqual(expect.arrayContaining([
      "idx_songs_plays",
      "idx_songs_title_nocase",
      "idx_songs_difficulty_plays",
    ]));

    const plan = (sql: string, ...params: unknown[]) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((row) => row.detail);
    expect(plan("SELECT * FROM songs ORDER BY plays DESC LIMIT ?", 60).join(" "))
      .toContain("USING INDEX idx_songs_plays");
    expect(plan("SELECT * FROM songs ORDER BY title COLLATE NOCASE LIMIT ?", 60).join(" "))
      .toContain("USING INDEX idx_songs_title_nocase");
    expect(plan("SELECT * FROM songs WHERE difficulty = ? ORDER BY plays DESC LIMIT ?", "easy", 60).join(" "))
      .toContain("USING INDEX idx_songs_difficulty_plays");
  });
});
