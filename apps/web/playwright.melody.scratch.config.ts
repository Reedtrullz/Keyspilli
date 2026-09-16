import { defineConfig } from "@playwright/test";
import Database from "better-sqlite3";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sourceRoot = "/Users/reidar/Projectos/Keyspilli/data";
const scratchDataDir = mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-"));
const fixtures = [
  {
    baseId: "the-beatles-blackbird",
    title: "Blackbird",
    artist: "The Beatles",
    category: "Scratch real artifact",
    contentType: "standard",
    acquiredVia: "midi-file",
  },
  {
    baseId: "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d",
    title: "Hell You Call a Dream",
    artist: "The Warning",
    category: "Scratch ambiguous real artifact",
    contentType: "youtube",
    acquiredVia: "youtube-transcription",
  },
];

type Source = { key?: string; tempoBpm?: number; notes?: Array<{ start: number; dur: number }> };
const songs = fixtures.map((fixture) => {
  const sourceVariantDir = join(sourceRoot, "artifacts", fixture.baseId, "a");
  cpSync(sourceVariantDir, join(scratchDataDir, "artifacts", fixture.baseId, "a"), { recursive: true });
  cpSync(join(sourceRoot, "artifacts", fixture.baseId, "manifest.json"), join(scratchDataDir, "artifacts", fixture.baseId, "manifest.json"));
  const source = JSON.parse(readFileSync(join(sourceVariantDir, "notes.json"), "utf8")) as Source;
  const duration = Math.ceil(Math.max(0, ...(source.notes ?? []).map((note) => note.start + note.dur)));
  return {
    id: `${fixture.baseId}-a-scratch`,
    baseId: fixture.baseId,
    title: fixture.title,
    artist: fixture.artist,
    category: fixture.category,
    difficulty: "advanced",
    difficultyScore: 4,
    key: source.key ?? "C",
    tempo: source.tempoBpm ?? 120,
    style: "pop",
    mood: "reflective",
    bassPattern: "block",
    duration,
    contentType: fixture.contentType,
    acquiredVia: fixture.acquiredVia,
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays: 0,
    level: "a",
    createdAt: "2026-09-16T00:00:00.000Z",
  };
});

process.env.KEYSPILLI_DATA_DIR = scratchDataDir;
process.env.KEYSPILLI_E2E_SCRATCH_DIR = scratchDataDir;
mkdirSync(scratchDataDir, { recursive: true });
const db = new Database(join(scratchDataDir, "db.sqlite"));
db.exec(`CREATE TABLE songs (
  id TEXT PRIMARY KEY, base_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
  category TEXT NOT NULL, difficulty TEXT NOT NULL, difficulty_score REAL NOT NULL,
  key TEXT NOT NULL, tempo INTEGER NOT NULL, style TEXT NOT NULL, mood TEXT NOT NULL,
  bass_pattern TEXT NOT NULL, duration INTEGER NOT NULL, content_type TEXT NOT NULL,
  acquired_via TEXT, source_youtube_url TEXT, has_sheet_xml INTEGER NOT NULL,
  sections TEXT, plays INTEGER NOT NULL, level TEXT NOT NULL, created_at TEXT NOT NULL
)`);
for (const song of songs) db.prepare(`INSERT INTO songs
  (id, base_id, title, artist, category, difficulty, difficulty_score, key, tempo, style, mood,
   bass_pattern, duration, content_type, acquired_via, source_youtube_url, has_sheet_xml,
   sections, plays, level, created_at)
  VALUES (@id, @baseId, @title, @artist, @category, @difficulty, @difficultyScore, @key, @tempo,
   @style, @mood, @bassPattern, @duration, @contentType, @acquiredVia, @sourceYoutubeUrl,
   @hasSheetXml, @sections, @plays, @level, @createdAt)`).run({
  ...song,
  baseId: song.baseId,
  difficultyScore: song.difficultyScore,
  bassPattern: song.bassPattern,
  contentType: song.contentType,
  acquiredVia: song.acquiredVia,
  sourceYoutubeUrl: song.sourceYoutubeUrl,
  hasSheetXml: song.hasSheetXml,
  createdAt: song.createdAt,
});
db.close();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "melody-accompaniment.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: {
    command: "npm run start -- --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KEYSPILLI_DATA_DIR: scratchDataDir,
      KEYSPILLI_E2E_SCRATCH_DIR: scratchDataDir,
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
      KEYSPILLI_ORIGIN: "http://127.0.0.1:3101",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
