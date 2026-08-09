import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./paths.js";

export interface SongRow {
  id: string;
  baseId: string;
  title: string;
  artist: string;
  category: string;
  difficulty: string;
  difficultyScore: number;
  key: string;
  tempo: number;
  style: string;
  mood: string;
  bassPattern: string;
  duration: number;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
  hasSheetXml: number;
  sections: string | null;
  plays: number;
  level: string;
  createdAt: string;
}

export interface SongFilters {
  difficulty?: string;
  key?: string;
  style?: string;
  mood?: string;
  bassPattern?: string;
  category?: string;
  q?: string;
  sort?: "popular" | "title" | "artist" | "difficulty";
  limit?: number;
  offset?: number;
}

export interface JobRow {
  id: string;
  youtubeUrl: string;
  status: "queued" | "processing" | "done" | "error";
  songId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(dirname(dbPath()), { recursive: true });
  db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      base_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Classical',
      difficulty TEXT NOT NULL,
      difficulty_score REAL NOT NULL,
      key TEXT NOT NULL,
      tempo INTEGER NOT NULL,
      style TEXT NOT NULL DEFAULT 'classical',
      mood TEXT NOT NULL DEFAULT 'peaceful',
      bass_pattern TEXT NOT NULL DEFAULT 'block',
      duration INTEGER NOT NULL DEFAULT 0,
      content_type TEXT NOT NULL DEFAULT 'standard',
      acquired_via TEXT,
      source_youtube_url TEXT,
      has_sheet_xml INTEGER NOT NULL DEFAULT 1,
      sections TEXT,
      plays INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_songs_base ON songs(base_id);
    CREATE INDEX IF NOT EXISTS idx_songs_difficulty ON songs(difficulty);
    CREATE INDEX IF NOT EXISTS idx_songs_key ON songs(key);
    CREATE TABLE IF NOT EXISTS conversion_jobs (
      id TEXT PRIMARY KEY,
      youtube_url TEXT NOT NULL,
      status TEXT NOT NULL,
      song_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);
  return db;
}

export function upsertSong(s: SongRow): void {
  getDb()
    .prepare(
      `INSERT INTO songs (id, base_id, title, artist, category, difficulty, difficulty_score, key, tempo, style, mood, bass_pattern, duration, content_type, acquired_via, source_youtube_url, has_sheet_xml, sections, plays, level, created_at)
       VALUES (@id, @baseId, @title, @artist, @category, @difficulty, @difficultyScore, @key, @tempo, @style, @mood, @bassPattern, @duration, @contentType, @acquiredVia, @sourceYoutubeUrl, @hasSheetXml, @sections, @plays, @level, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         difficulty_score=@difficultyScore, key=@key, tempo=@tempo, bass_pattern=@bassPattern,
         duration=@duration, has_sheet_xml=@hasSheetXml, sections=@sections, plays=plays`,
    )
    .run(s);
}

export function getSong(id: string): SongRow | undefined {
  return getDb().prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | undefined;
}

export function getSongsByBase(baseId: string): SongRow[] {
  return getDb().prepare("SELECT * FROM songs WHERE base_id = ? ORDER BY difficulty_score").all(baseId) as SongRow[];
}

export function listSongs(f: SongFilters = {}): SongRow[] {
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  const map: Record<string, string> = {
    difficulty: "difficulty",
    key: "key",
    style: "style",
    mood: "mood",
    bassPattern: "bass_pattern",
    category: "category",
  };
  for (const [k, v] of Object.entries(map)) {
    const val = (f as Record<string, unknown>)[k];
    if (typeof val === "string" && val) {
      conds.push(`${v} = @${k}`);
      params[k] = val;
    }
  }
  if (f.q) {
    conds.push("(title LIKE @q OR artist LIKE @q)");
    params.q = `%${f.q}%`;
  }
  const order =
    f.sort === "title"
      ? "title COLLATE NOCASE"
      : f.sort === "artist"
        ? "artist COLLATE NOCASE"
        : f.sort === "difficulty"
          ? "difficulty_score"
          : "plays DESC";
  const limit = Math.min(200, f.limit ?? 60);
  const offset = f.offset ?? 0;
  return getDb()
    .prepare(
      `SELECT * FROM songs ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as SongRow[];
}

export function countSongs(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM songs").get() as { c: number }).c;
}

export function incrementPlays(id: string): void {
  getDb().prepare("UPDATE songs SET plays = plays + 1 WHERE id = ?").run(id);
}

export function insertJob(j: JobRow): void {
  getDb()
    .prepare(
      `INSERT INTO conversion_jobs (id, youtube_url, status, song_id, error, created_at, finished_at)
       VALUES (@id, @youtubeUrl, @status, @songId, @error, @createdAt, @finishedAt)`,
    )
    .run(j);
}

export function updateJob(id: string, patch: Partial<Pick<JobRow, "status" | "songId" | "error" | "finishedAt">>): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = patch.status;
  }
  if (patch.songId !== undefined) {
    sets.push("song_id = @songId");
    params.songId = patch.songId;
  }
  if (patch.error !== undefined) {
    sets.push("error = @error");
    params.error = patch.error;
  }
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = @finishedAt");
    params.finishedAt = patch.finishedAt;
  }
  if (sets.length) getDb().prepare(`UPDATE conversion_jobs SET ${sets.join(", ")} WHERE id = ?`).run(params);
}

export function getQueuedJobs(): JobRow[] {
  return getDb()
    .prepare("SELECT * FROM conversion_jobs WHERE status IN ('queued','processing') ORDER BY created_at LIMIT 5")
    .all() as JobRow[];
}

export function getJob(id: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM conversion_jobs WHERE id = ?").get(id) as JobRow | undefined;
}
