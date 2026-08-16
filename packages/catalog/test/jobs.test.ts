import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimJob, deleteBaseRows, getDb, getJob, getQueuedJobs, insertJob, requeueOrphaned, updateJob, upsertSong } from "../src/db.js";
import type { JobRow, SongRow } from "../src/db.js";

// Fresh data dir per test run; db.ts caches its connection, so this must be
// set before the first getDb() call.
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-jobs-"));
process.env.KEYSPILLI_DATA_DIR = dataDir;

function job(id: string, status: JobRow["status"], attempts = 0): JobRow {
  return {
    id,
    youtubeUrl: "https://youtube.com/watch?v=x",
    status,
    songId: null,
    error: null,
    attempts,
    createdAt: "2026-08-13T00:00:00Z",
    finishedAt: null,
  };
}

beforeAll(() => {
  // Pre-create the pre-attempts schema so the getDb() migration has to act.
  const legacy = new Database(join(dataDir, "db.sqlite"));
  legacy.exec(
    `CREATE TABLE conversion_jobs (
      id TEXT PRIMARY KEY, youtube_url TEXT NOT NULL, status TEXT NOT NULL,
      song_id TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT)`,
  );
  legacy.close();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("conversion jobs", () => {
  it("migrates an existing db by adding the attempts and started_at columns", () => {
    const cols = getDb().prepare("PRAGMA table_info(conversion_jobs)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "attempts")).toBe(true);
    expect(cols.some((c) => c.name === "started_at")).toBe(true);
    // Idempotent: a second open must not fail.
    getDb();
  });

  it("claimJob claims a queued job exactly once and stamps started_at", () => {
    insertJob(job("claim-1", "queued"));
    expect(claimJob("claim-1")).toBe(true);
    expect(claimJob("claim-1")).toBe(false);
    expect(getJob("claim-1")!.status).toBe("processing");
    expect(getJob("claim-1")!.startedAt).toBeTruthy();
    expect(getQueuedJobs().map((j) => j.id)).not.toContain("claim-1");
  });

  it("requeueOrphaned leaves freshly claimed jobs alone", () => {
    insertJob(job("fresh-1", "queued"));
    expect(claimJob("fresh-1")).toBe(true);
    expect(requeueOrphaned()).toBe(0);
    expect(getJob("fresh-1")!.status).toBe("processing");
  });

  it("requeueOrphaned reclaims only unstarted and stale processing rows", () => {
    insertJob(job("unstarted-1", "processing", 1));
    insertJob(job("stale-1", "queued"));
    expect(claimJob("stale-1")).toBe(true);
    getDb().prepare("UPDATE conversion_jobs SET started_at = datetime('now', '-30 minutes') WHERE id = 'stale-1'").run();
    // fresh-1 from the previous test is still running and must not be stolen.
    expect(requeueOrphaned()).toBe(2);
    expect(getJob("unstarted-1")!.status).toBe("queued");
    expect(getJob("stale-1")!.status).toBe("queued");
    expect(getJob("fresh-1")!.status).toBe("processing");
    expect(requeueOrphaned()).toBe(0);
  });

  it("updateJob persists attempts", () => {
    insertJob(job("attempts-1", "queued"));
    updateJob("attempts-1", { attempts: 1 });
    expect(getJob("attempts-1")!.attempts).toBe(1);
  });

  it("deleteBaseRows removes jobs and songs atomically for any variant of the base", () => {
    const song: SongRow = {
      id: "del-base-m",
      baseId: "del-base",
      title: "Del Me",
      artist: "Tester",
      category: "YouTube",
      difficulty: "medium",
      difficultyScore: 3.4,
      key: "C",
      tempo: 120,
      style: "classical",
      mood: "peaceful",
      bassPattern: "block",
      duration: 60,
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: null,
      hasSheetXml: 1,
      sections: null,
      plays: 0,
      level: "m",
      createdAt: "2026-08-13T00:00:00Z",
    };
    upsertSong(song);
    upsertSong({ ...song, id: "del-base-e", difficulty: "easy", difficultyScore: 2.6, level: "e" });
    insertJob({ ...job("job-del-1", "queued"), songId: "del-base-m" });
    insertJob({ ...job("job-del-2", "queued"), songId: "del-base-e" });
    insertJob({ ...job("job-keep-1", "queued"), songId: "other-m" });
    expect(deleteBaseRows("del-base")).toEqual({ jobIds: ["job-del-1", "job-del-2"], songCount: 2 });
    expect(getJob("job-del-1")).toBeUndefined();
    expect(getJob("job-del-2")).toBeUndefined();
    expect(getJob("job-keep-1")).toBeDefined();
    expect(getDb().prepare("SELECT id FROM songs WHERE base_id = ?").all("del-base")).toEqual([]);
  });
});
