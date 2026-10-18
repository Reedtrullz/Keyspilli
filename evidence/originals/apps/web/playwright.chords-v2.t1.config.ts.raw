import { defineConfig } from "@playwright/test";
import Database from "better-sqlite3";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(__dirname, "../..");
const sourceRoot = process.env.KEYSPILLI_T1_FIXTURE_ROOT
  ?? join(repoRoot, "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures");
process.env.KEYSPILLI_T1_MODE = "1";
const t1ManifestPath = join(repoRoot, "apps/web/test-results/oops-phrase-captures.json");
rmSync(t1ManifestPath, { force: true });
process.env.KEYSPILLI_T1_MANIFEST_PATH = t1ManifestPath;
const scratchDataDir = mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-"));
const fixtures = [
  "the-beatles-blackbird",
  "britney-spears-oops-i-did-it-again",
  "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d",
];

const songs = fixtures.map((baseId) => {
  const sourceVariantDir = join(sourceRoot, baseId, "a");
  cpSync(sourceVariantDir, join(scratchDataDir, "artifacts", baseId, "a"), { recursive: true });
  cpSync(join(sourceRoot, baseId, "manifest.json"), join(scratchDataDir, "artifacts", baseId, "manifest.json"));
  const song = JSON.parse(readFileSync(join(sourceRoot, baseId, "song.json"), "utf8")) as Record<string, unknown>;
  return {
    ...song,
    id: `${baseId}-a-scratch`,
    baseId,
    category: "T1 production fixture",
    style: typeof song.style === "string" ? song.style : "pop",
    mood: typeof song.mood === "string" ? song.mood : "reflective",
    bassPattern: typeof song.bassPattern === "string" ? song.bassPattern : "block",
    duration: typeof song.duration === "number" ? song.duration : 0,
    contentType: typeof song.contentType === "string" ? song.contentType : "standard",
    acquiredVia: typeof song.acquiredVia === "string" ? song.acquiredVia : null,
    sourceYoutubeUrl: typeof song.sourceYoutubeUrl === "string" ? song.sourceYoutubeUrl : null,
    hasSheetXml: typeof song.hasSheetXml === "number" ? song.hasSheetXml : 1,
    sections: null,
    plays: 0,
    createdAt: typeof song.createdAt === "string" ? song.createdAt : "2026-09-17T00:00:00.000Z",
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
for (const song of songs) {
  db.prepare(`INSERT INTO songs
    (id, base_id, title, artist, category, difficulty, difficulty_score, key, tempo, style, mood,
     bass_pattern, duration, content_type, acquired_via, source_youtube_url, has_sheet_xml,
     sections, plays, level, created_at)
    VALUES (@id, @baseId, @title, @artist, @category, @difficulty, @difficultyScore, @key, @tempo,
     @style, @mood, @bassPattern, @duration, @contentType, @acquiredVia, @sourceYoutubeUrl,
     @hasSheetXml, @sections, @plays, @level, @createdAt)`).run({
    ...song,
    baseId: song.baseId,
    title: song.title,
    artist: song.artist,
    difficulty: song.difficulty,
    difficultyScore: typeof song.difficultyScore === "number" ? song.difficultyScore : 4,
    key: typeof song.key === "string" ? song.key : "C",
    tempo: typeof song.tempo === "number" ? song.tempo : 120,
    bassPattern: song.bassPattern,
    contentType: song.contentType,
    acquiredVia: song.acquiredVia,
    sourceYoutubeUrl: song.sourceYoutubeUrl,
    hasSheetXml: song.hasSheetXml,
    createdAt: song.createdAt,
  });
}
db.close();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "melody-accompaniment.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: {
    command: "npm run start -- --port 3102",
    url: "http://127.0.0.1:3102",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KEYSPILLI_DATA_DIR: scratchDataDir,
      KEYSPILLI_E2E_SCRATCH_DIR: scratchDataDir,
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
      KEYSPILLI_ORIGIN: "http://127.0.0.1:3102",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3102",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
