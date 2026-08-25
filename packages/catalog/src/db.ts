import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, dataDir, dbPath } from "./paths.js";
import type { JobRow, SongFilters, SongRow } from "./db-types.js";
import { groupSongs, type GroupedSong } from "./group.js";
import { disabledManifestBases } from "./manifest.js";
import { blockedLearnerBases } from "./learner-review.js";

export type { SongRow, JobRow, SongFilters };

let db: Database.Database | null = null;

/**
 * Raw visible-song snapshot used by the grouped catalogue read model.
 *
 * Grouped pages used to issue a full SELECT (and map every row) for each
 * endpoint call.  Keeping only the raw rows here lets all filtering/grouping
 * remain request-local while avoiding repeated SQLite scans.  The cache is
 * deliberately invalidated by every write helper below and also carries
 * filesystem/SQLite signatures so a write made by another process cannot
 * leave the read model stale.
 */
interface SongReadModelCache {
  generation: number;
  dataSignature: string;
  policySignature: string;
  rows: SongRow[];
}

let songReadModelGeneration = 0;
let songReadModelCache: SongReadModelCache | undefined;
let learnerReviewCachePath: string | undefined;
let learnerReviewCacheSignature: string | undefined;
let learnerReviewCache = new Set<string>();

/** Invalidate the grouped catalogue raw-row snapshot after an out-of-band update. */
export function invalidateSongReadModel(): void {
  songReadModelGeneration += 1;
  songReadModelCache = undefined;
}

function fileSignature(path: string): string {
  try {
    const stat = statSync(path);
    // inode + device catches atomic replacement at the same path; size and
    // mtime catch in-place edits.  A missing marker is part of the signature
    // so creating/removing a policy or WAL file forces a refresh as well.
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${path}:missing`;
  }
}

function songDataSignature(conn: Database.Database): string {
  // `data_version` changes when another connection commits.  The file
  // markers additionally cover WAL/checkpoint/atomic-replace changes that a
  // long-lived process may otherwise not observe through its own connection.
  const dataVersion = conn.pragma("data_version", { simple: true }) as number;
  return [dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`].map(fileSignature).concat(`data_version:${dataVersion}`).join("|");
}

function policySignature(): string {
  return [
    join(dataDir(), "manifest.json"),
    join(ROOT, "catalog", "manifest.json"),
    join(dataDir(), "learner-review.json"),
    join(ROOT, "catalog", "learner-review.json"),
  ]
    .map(fileSignature)
    .join("|");
}

function policyBasesFromFile(path: string): ReadonlySet<string> {
  if (!existsSync(path)) return new Set<string>();
  const signature = fileSignature(path);
  if (path === learnerReviewCachePath && signature === learnerReviewCacheSignature) {
    return learnerReviewCache;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      verdicts?: Record<string, { blocked?: boolean }>;
    };
    learnerReviewCachePath = path;
    learnerReviewCacheSignature = signature;
    learnerReviewCache = new Set(
      Object.entries(parsed.verdicts ?? {}).filter(([, entry]) => entry?.blocked === true).map(([baseId]) => baseId),
    );
    return learnerReviewCache;
  } catch {
    // The existing learner-review gate fails open on malformed data.  The
    // manifest loader itself still throws (and therefore fails closed) when
    // it is used by hiddenBaseIds below.
    learnerReviewCachePath = path;
    learnerReviewCacheSignature = signature;
    learnerReviewCache = new Set<string>();
    return learnerReviewCache;
  }
}

function learnerReviewBases(): ReadonlySet<string> {
  const path = [join(dataDir(), "learner-review.json"), join(ROOT, "catalog", "learner-review.json")].find((candidate) => existsSync(candidate));
  if (!path) {
    learnerReviewCachePath = undefined;
    learnerReviewCacheSignature = undefined;
    learnerReviewCache = new Set<string>();
    return blockedLearnerBases();
  }
  return policyBasesFromFile(path);
}

function mapSong(r: Record<string, unknown>): SongRow {
  return {
    id: r.id as string,
    baseId: r.base_id as string,
    title: r.title as string,
    artist: r.artist as string,
    category: r.category as string,
    difficulty: r.difficulty as string,
    difficultyScore: r.difficulty_score as number,
    key: r.key as string,
    tempo: r.tempo as number,
    style: r.style as string,
    mood: r.mood as string,
    bassPattern: r.bass_pattern as string,
    duration: r.duration as number,
    contentType: r.content_type as string,
    acquiredVia: r.acquired_via as string | null,
    sourceYoutubeUrl: r.source_youtube_url as string | null,
    hasSheetXml: r.has_sheet_xml as number,
    sections: r.sections as string | null,
    plays: r.plays as number,
    level: r.level as string,
    createdAt: r.created_at as string,
  };
}

function mapJob(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    youtubeUrl: r.youtube_url as string,
    status: r.status as JobRow["status"],
    songId: r.song_id as string | null,
    error: r.error as string | null,
    attempts: (r.attempts as number | undefined) ?? 0,
    startedAt: (r.started_at as string | null | undefined) ?? null,
    createdAt: r.created_at as string,
    finishedAt: r.finished_at as string | null,
  };
}

function migrateColumn(conn: Database.Database, table: string, col: string, def: string): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === col)) return;
  try {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch (e) {
    // Web + worker boot together; a check-then-ALTER race makes one process
    // see "duplicate column name". The other process already migrated.
    if (!(e as Error).message.includes("duplicate column name")) throw e;
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(dirname(dbPath()), { recursive: true });
  const conn = new Database(dbPath());
  conn.pragma("journal_mode = WAL");
  conn.pragma("busy_timeout = 5000");
  conn.exec(`
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
  migrateColumn(conn, "conversion_jobs", "attempts", "INTEGER NOT NULL DEFAULT 0");
  migrateColumn(conn, "conversion_jobs", "started_at", "TEXT");
  db = conn;
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
  invalidateSongReadModel();
}

/** Replace a complete six-level song set in one SQLite transaction. */
export function replaceSongsByBase(baseId: string, rows: SongRow[]): void {
  const conn = getDb();
  const tx = conn.transaction((items: SongRow[]) => {
    conn.prepare("DELETE FROM songs WHERE base_id = ?").run(baseId);
    const stmt = conn.prepare(
      `INSERT INTO songs (id, base_id, title, artist, category, difficulty, difficulty_score, key, tempo, style, mood, bass_pattern, duration, content_type, acquired_via, source_youtube_url, has_sheet_xml, sections, plays, level, created_at)
       VALUES (@id, @baseId, @title, @artist, @category, @difficulty, @difficultyScore, @key, @tempo, @style, @mood, @bassPattern, @duration, @contentType, @acquiredVia, @sourceYoutubeUrl, @hasSheetXml, @sections, @plays, @level, @createdAt)`,
    );
    for (const row of items) stmt.run(row);
  });
  tx(rows);
  invalidateSongReadModel();
}

/** Remove a complete base from the read model without touching its artifacts. */
export function removeSongsByBase(baseId: string): number {
  const result = getDb().prepare("DELETE FROM songs WHERE base_id = ?").run(baseId);
  invalidateSongReadModel();
  return result.changes;
}

function hiddenBaseIds(refreshLearnerReview = false): ReadonlySet<string> {
  // Re-read the learner-review policy when the grouped snapshot is rebuilt.
  // learner-review.ts intentionally keeps a path-only cache for its other
  // callers; reading the selected file here prevents an atomic replacement
  // from leaving this read model stale.  Malformed review data remains the
  // documented fail-open behaviour, while manifest parsing stays fail-closed.
  const blocked = refreshLearnerReview ? learnerReviewBases() : blockedLearnerBases();
  return new Set([...blocked, ...disabledManifestBases()]);
}

function visibleSongRowsSnapshot(): SongRow[] {
  const conn = getDb();
  const dataBefore = songDataSignature(conn);
  const policyBefore = policySignature();
  const cached = songReadModelCache;
  if (
    cached &&
    cached.generation === songReadModelGeneration &&
    cached.dataSignature === dataBefore &&
    cached.policySignature === policyBefore
  ) {
    return cached.rows;
  }

  const hidden = hiddenBaseIds(true);
  const rows = (conn.prepare("SELECT * FROM songs").all() as Record<string, unknown>[])
    .filter((row) => !hidden.has(row.base_id as string))
    .map(mapSong);

  // A concurrent writer can commit between the pre-query signature and the
  // SELECT.  Store the post-query signature so the next call will rebuild;
  // retry once immediately when the change is observable, avoiding a stale
  // response for the current request as well.
  const dataAfter = songDataSignature(conn);
  const policyAfter = policySignature();
  if (dataAfter !== dataBefore || policyAfter !== policyBefore) {
    const hiddenAfter = hiddenBaseIds(true);
    const freshRows = (conn.prepare("SELECT * FROM songs").all() as Record<string, unknown>[])
      .filter((row) => !hiddenAfter.has(row.base_id as string))
      .map(mapSong);
    const freshData = songDataSignature(conn);
    const freshPolicy = policySignature();
    songReadModelCache = {
      generation: songReadModelGeneration,
      dataSignature: freshData,
      policySignature: freshPolicy,
      rows: freshRows,
    };
    return freshRows;
  }

  songReadModelCache = {
    generation: songReadModelGeneration,
    dataSignature: dataAfter,
    policySignature: policyAfter,
    rows,
  };
  return rows;
}

export function getSong(id: string): SongRow | undefined {
  const r = getDb().prepare("SELECT * FROM songs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!r || hiddenBaseIds().has(r.base_id as string)) return undefined;
  return mapSong(r);
}

export function getSongsByBase(baseId: string): SongRow[] {
  return (getDb().prepare("SELECT * FROM songs WHERE base_id = ? ORDER BY difficulty_score").all(baseId) as Record<string, unknown>[]).map(mapSong);
}

export function listSongs(f: SongFilters = {}, limitCap = 200): SongRow[] {
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  const hidden = [...hiddenBaseIds()];
  if (hidden.length) {
    const placeholders = hidden.map((_, index) => `hidden${index}`);
    conds.push(`base_id NOT IN (${placeholders.map((name) => `@${name}`).join(", ")})`);
    for (const [index, baseId] of hidden.entries()) params[`hidden${index}`] = baseId;
  }
  const map: Record<string, string> = {
    difficulty: "difficulty",
    key: "key",
    style: "style",
    mood: "mood",
    bassPattern: "bass_pattern",
    category: "category",
    artist: "artist",
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
  const limit = Math.min(limitCap, f.limit ?? 60);
  const offset = f.offset ?? 0;
  return (
    getDb()
      .prepare(
        `SELECT * FROM songs ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as Record<string, unknown>[]
  ).map(mapSong);
}

/**
 * Grouped view of the catalog: one entry per song with all difficulty
 * levels attached. Filters match any variant of a song.
 */
export function listSongsGrouped(f: SongFilters = {}): GroupedSong[] {
  let grouped = groupedSongsForFilters(f);
  const order = groupedOrder(f);
  grouped.sort(order);
  const limit = Math.min(2000, f.limit ?? 60);
  return grouped.slice(f.offset ?? 0, (f.offset ?? 0) + limit);
}

export interface GroupedSongsPage {
  songs: GroupedSong[];
  total: number;
}

/**
 * Grouped listing and total count from a single catalogue scan.
 * Previously the API route called listSongsGrouped and countSongsGrouped
 * separately, causing two full table loads per grouped page view.
 */
export function listSongsGroupedWithTotal(f: SongFilters = {}): GroupedSongsPage {
  const grouped = groupedSongsForFilters(f);
  const order = groupedOrder(f);
  grouped.sort(order);
  const offset = f.offset ?? 0;
  const limit = Math.min(2000, f.limit ?? 60);
  return {
    songs: grouped.slice(offset, offset + limit),
    total: grouped.length,
  };
}

function groupedSongsForFilters(f: SongFilters): GroupedSong[] {
  // Apply pagination after grouping; using the raw row offset here can drop
  // partial six-level sets and makes the reported total depend on page size.
  // Read the complete visible snapshot: the previous listSongs(limit=10_000)
  // path silently truncated catalogues larger than 10,000 rows.
  const all = visibleSongRowsSnapshot().filter((row) => matchesSongFilters(row, f));
  // Grouping currently returns references to input rows.  Clone the cached
  // snapshot for request isolation so a caller cannot mutate future results.
  let grouped = groupSongs(all.map((row) => ({ ...row })));
  if (f.difficulty) grouped = grouped.filter((g) => g.levels.some((l) => l.difficulty === f.difficulty));
  if (f.key) grouped = grouped.filter((g) => g.levels.some((l) => l.key === f.key));
  if (f.style) grouped = grouped.filter((g) => g.levels.some((l) => l.style === f.style));
  if (f.mood) grouped = grouped.filter((g) => g.levels.some((l) => l.mood === f.mood));
  if (f.bassPattern) grouped = grouped.filter((g) => g.levels.some((l) => l.bassPattern === f.bassPattern));
  if (f.category) grouped = grouped.filter((g) => g.levels.some((l) => l.category === f.category));
  if (f.artist) grouped = grouped.filter((g) => g.levels.some((l) => l.artist === f.artist));
  if (f.q) {
    const q = f.q.toLowerCase();
    grouped = grouped.filter((g) => g.representative.title.toLowerCase().includes(q) || g.representative.artist.toLowerCase().includes(q));
  }
  return grouped;
}

function matchesSongFilters(row: SongRow, f: SongFilters): boolean {
  for (const [key, value] of [
    ["difficulty", row.difficulty],
    ["key", row.key],
    ["style", row.style],
    ["mood", row.mood],
    ["bassPattern", row.bassPattern],
    ["category", row.category],
    ["artist", row.artist],
  ] as const) {
    const requested = f[key];
    // Match listSongs' SQL builder: empty strings are ignored.
    if (typeof requested === "string" && requested && value !== requested) return false;
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!row.title.toLowerCase().includes(q) && !row.artist.toLowerCase().includes(q)) return false;
  }
  return true;
}

function groupedOrder(f: SongFilters): (a: GroupedSong, b: GroupedSong) => number {
  const order =
    f.sort === "title"
      ? (a: GroupedSong, b: GroupedSong) => a.representative.title.localeCompare(b.representative.title)
      : f.sort === "artist"
        ? (a: GroupedSong, b: GroupedSong) => a.representative.artist.localeCompare(b.representative.artist)
        : f.sort === "difficulty"
        ? (a: GroupedSong, b: GroupedSong) => a.representative.difficultyScore - b.representative.difficultyScore
        : (a: GroupedSong, b: GroupedSong) => b.totalPlays - a.totalPlays;
  return order;
}

/** Count the full filtered grouped catalogue, independent of page size. */
export function countSongsGrouped(f: SongFilters = {}): number {
  return groupedSongsForFilters(f).length;
}

export function countSongs(): number {
  const hidden = [...hiddenBaseIds()];
  if (!hidden.length) return (getDb().prepare("SELECT COUNT(*) AS c FROM songs").get() as { c: number }).c;
  const placeholders = hidden.map(() => "?").join(", ");
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM songs WHERE base_id NOT IN (${placeholders})`).get(...hidden) as { c: number }).c;
}

export function incrementPlays(id: string): void {
  getDb().prepare("UPDATE songs SET plays = plays + 1 WHERE id = ?").run(id);
  invalidateSongReadModel();
}

export function insertJob(j: JobRow): void {
  getDb()
    .prepare(
      `INSERT INTO conversion_jobs (id, youtube_url, status, song_id, error, attempts, created_at, finished_at)
       VALUES (@id, @youtubeUrl, @status, @songId, @error, @attempts, @createdAt, @finishedAt)`,
    )
    .run({ ...j, attempts: j.attempts ?? 0 });
}

export function updateJob(id: string, patch: Partial<Pick<JobRow, "status" | "songId" | "error" | "attempts" | "finishedAt">>): void {
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
  if (patch.attempts !== undefined) {
    sets.push("attempts = @attempts");
    params.attempts = patch.attempts;
  }
  if (sets.length) getDb().prepare(`UPDATE conversion_jobs SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function claimJob(id: string): boolean {
  const r = getDb()
    .prepare("UPDATE conversion_jobs SET status = 'processing', started_at = datetime('now') WHERE id = ? AND status = 'queued'")
    .run(id);
  return r.changes === 1;
}

export function requeueOrphaned(): number {
  // Only reclaim jobs a worker has been stuck on for 15+ minutes; a fresh
  // started_at means another worker is legitimately running it.
  return getDb()
    .prepare(
      "UPDATE conversion_jobs SET status = 'queued' WHERE status = 'processing' AND (started_at IS NULL OR started_at < datetime('now', '-15 minutes'))",
    )
    .run().changes;
}

export function deleteSongsByBase(baseId: string): number {
  const result = getDb().prepare("DELETE FROM songs WHERE base_id = ?").run(baseId);
  invalidateSongReadModel();
  return result.changes;
}

export interface DeletedBaseRows {
  jobIds: string[];
  songCount: number;
}

/**
 * Remove the read-model rows for one base as one SQLite transaction.
 * Callers should invoke this only after the artifact filesystem commit has
 * succeeded; a thrown transaction leaves the database intact so the stale
 * read model can be reconciled explicitly.
 */
export function deleteBaseRows(baseId: string): DeletedBaseRows {
  const conn = getDb();
  const remove = conn.transaction((id: string): DeletedBaseRows => {
    const jobs = conn
      .prepare("SELECT id FROM conversion_jobs WHERE song_id IN (SELECT id FROM songs WHERE base_id = ?)")
      .all(id) as { id: string }[];
    if (jobs.length) {
      conn
        .prepare("DELETE FROM conversion_jobs WHERE song_id IN (SELECT id FROM songs WHERE base_id = ?)")
        .run(id);
    }
    const songCount = conn.prepare("DELETE FROM songs WHERE base_id = ?").run(id).changes;
    return { jobIds: jobs.map((row) => row.id), songCount };
  });
  const result = remove(baseId);
  invalidateSongReadModel();
  return result;
}

export function deleteJobsByBase(baseId: string): string[] {
  const rows = getDb()
    .prepare("SELECT id FROM conversion_jobs WHERE song_id IN (SELECT id FROM songs WHERE base_id = ?)")
    .all(baseId) as { id: string }[];
  if (rows.length) {
    getDb()
      .prepare("DELETE FROM conversion_jobs WHERE song_id IN (SELECT id FROM songs WHERE base_id = ?)")
      .run(baseId);
  }
  return rows.map((r) => r.id);
}

export function getQueuedJobs(): JobRow[] {
  return (
    getDb()
      .prepare("SELECT * FROM conversion_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 5")
      .all() as Record<string, unknown>[]
  ).map(mapJob);
}

export function getJob(id: string): JobRow | undefined {
  const r = getDb().prepare("SELECT * FROM conversion_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? mapJob(r) : undefined;
}
