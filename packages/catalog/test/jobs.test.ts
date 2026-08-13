import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimJob, getDb, getJob, getQueuedJobs, insertJob, requeueOrphaned, updateJob } from "../src/db.js";
import type { JobRow } from "../src/db.js";

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
  it("migrates an existing db by adding the attempts column", () => {
    const cols = getDb().prepare("PRAGMA table_info(conversion_jobs)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "attempts")).toBe(true);
    // Idempotent: a second open must not fail.
    getDb();
  });

  it("claimJob claims a queued job exactly once", () => {
    insertJob(job("claim-1", "queued"));
    expect(claimJob("claim-1")).toBe(true);
    expect(claimJob("claim-1")).toBe(false);
    expect(getJob("claim-1")!.status).toBe("processing");
    expect(getQueuedJobs().map((j) => j.id)).not.toContain("claim-1");
    // Leave clean state so later tests see exactly the rows they insert.
    requeueOrphaned();
  });

  it("requeueOrphaned requeues processing rows", () => {
    insertJob(job("orphan-1", "processing", 1));
    insertJob(job("orphan-2", "processing", 1));
    expect(requeueOrphaned()).toBe(2);
    expect(getJob("orphan-1")!.status).toBe("queued");
    expect(getJob("orphan-2")!.status).toBe("queued");
    expect(requeueOrphaned()).toBe(0);
  });

  it("updateJob persists attempts", () => {
    insertJob(job("attempts-1", "queued"));
    updateJob("attempts-1", { attempts: 1 });
    expect(getJob("attempts-1")!.attempts).toBe(1);
  });
});
