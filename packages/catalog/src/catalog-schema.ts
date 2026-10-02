import type Database from "better-sqlite3";

/** Epoch 2 adds reversible deletion; older images must refuse the hidden-base contract. */
export const CATALOG_SCHEMA_VERSION = 2;

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

const migrations: Array<(conn: Database.Database) => void> = [conn => {
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
    -- The catalogue API always orders its first page by one of these columns.
    -- Keep the sort key in the index so SQLite can stop after LIMIT rows
    -- instead of scanning the full table and materializing a temp B-tree.
    CREATE INDEX IF NOT EXISTS idx_songs_plays ON songs(plays DESC);
    CREATE INDEX IF NOT EXISTS idx_songs_title_nocase ON songs(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_songs_difficulty_plays ON songs(difficulty, plays DESC);
    CREATE TABLE IF NOT EXISTS conversion_jobs (
      id TEXT PRIMARY KEY,
      youtube_url TEXT NOT NULL,
      status TEXT NOT NULL,
      song_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS source_candidate_handoffs (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_candidate_handoffs_expiry ON source_candidate_handoffs(expires_at);
  `);
  migrateColumn(conn, "conversion_jobs", "attempts", "INTEGER NOT NULL DEFAULT 0");
  migrateColumn(conn, "conversion_jobs", "started_at", "TEXT");
  migrateColumn(conn, "conversion_jobs", "lease_owner", "TEXT");
  migrateColumn(conn, "conversion_jobs", "lease_expires_at", "INTEGER");
}, conn => {
  conn.exec(`CREATE TABLE IF NOT EXISTS catalog_tombstones (
    base_id TEXT PRIMARY KEY, token TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS tombstone_song_insert BEFORE INSERT ON songs
    WHEN EXISTS(SELECT 1 FROM catalog_tombstones WHERE base_id=NEW.base_id AND state NOT IN ('restored','purged'))
    BEGIN SELECT RAISE(ABORT,'base is quarantined'); END;
  CREATE TRIGGER IF NOT EXISTS tombstone_song_delete BEFORE DELETE ON songs
    WHEN EXISTS(SELECT 1 FROM catalog_tombstones WHERE base_id=OLD.base_id AND state NOT IN ('restored','purged'))
    BEGIN SELECT RAISE(ABORT,'base is quarantined'); END;
  CREATE TRIGGER IF NOT EXISTS tombstone_song_update BEFORE UPDATE OF id,base_id,title,artist,category,difficulty,difficulty_score,key,tempo,style,mood,bass_pattern,duration,content_type,acquired_via,source_youtube_url,has_sheet_xml,sections,level,created_at ON songs
    WHEN EXISTS(SELECT 1 FROM catalog_tombstones WHERE base_id IN (OLD.base_id,NEW.base_id) AND state NOT IN ('restored','purged'))
    BEGIN SELECT RAISE(ABORT,'base is quarantined'); END;`);
}];

export function initializeCatalogSchema(conn: Database.Database): void {
  const validate = (version: number) => {
    if (!Number.isInteger(version) || version < 0 || version > CATALOG_SCHEMA_VERSION) {
      throw new Error(`Newer or unsupported catalog schema (${version}); use a compatible image or restore a coherent backup. This image supports epochs 0–${CATALOG_SCHEMA_VERSION}.`);
    }
  };
  validate(conn.pragma("user_version", { simple: true }) as number);
  conn.pragma("busy_timeout = 5000");
  conn.transaction(() => {
    let version = conn.pragma("user_version", { simple: true }) as number;
    validate(version);
    while (version < CATALOG_SCHEMA_VERSION) {
      migrations[version]!(conn);
      version++;
      conn.pragma(`user_version = ${version}`);
    }
  }).immediate();
}
