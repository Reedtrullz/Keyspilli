import { defineConfig } from "@playwright/test";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sourceRoot = "/Users/reidar/Projectos/Keyspilli/data";
const reservedFixtureRoot = "/Users/reidar/.codex/worktrees/musically-useful-chords-mode/docs/superpowers/evidence/2026-09-17-chords-v2-evaluation-fixtures";
const scratchDataDir = mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-"));
const reservedSourceHashes: Record<string, { notes: string; sourceArtifact: string }> = {
  "w-h-doane-near-the-cross": {
    notes: "da39379165b5d13a03ef188a230765f3b08c1cc356d105766246b48a9a88b80e",
    sourceArtifact: "09d4a33ac39f9429f3fdf3a45377a7010b36a1f501194b2dba10e91e45d51a0d",
  },
  "c-v-alkan-prelude": {
    notes: "7fe0f9b6464a1727c74f3f25d1f81777d2e916b6c7e11ebeaf9733cc5043b05d",
    sourceArtifact: "ae68944db2e646e14e0923a79b95b3a6e2658432e384e8741f3ab108dbc5ac80",
  },
  "beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940": {
    notes: "587458f078cc1f1248f9d8ebfe2079ab36e471de4d29a596631ee401e9dab4bf",
    sourceArtifact: "0b034323353ce167cf24664a17bda435c963f58d75c40d75d3860804bb475677",
  },
  "dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo": {
    notes: "0e2b1ba6166434cb23ccf022440f4a9a4caff6f6a60f74b9bc4f84dabf636cde",
    sourceArtifact: "8e4d4b9114800d69904dc4af35376b95ccd1d8c537aac3adbe812c72f0cf482e",
  },
};
for (const [baseId, expected] of Object.entries(reservedSourceHashes)) {
  const notesPath = join(reservedFixtureRoot, baseId, "a", "notes.json");
  const manifestPath = join(reservedFixtureRoot, baseId, "manifest.json");
  const notesHash = createHash("sha256").update(readFileSync(notesPath)).digest("hex");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sourceArtifactHash?: string };
  if (notesHash !== expected.notes || manifest.sourceArtifactHash !== expected.sourceArtifact) {
    throw new Error(`Reserved fixture hash mismatch for ${baseId}`);
  }
}
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
    baseId: "britney-spears-oops-i-did-it-again",
    title: "Oops!... I Did It Again",
    artist: "Britney Spears",
    category: "Scratch full-phrase comparison artifact",
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
  {
    baseId: "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8",
    title: "Your Song",
    artist: "Elton John",
    category: "Scratch UG source-key control",
    contentType: "standard",
    acquiredVia: "midi-file",
  },
  {
    baseId: "w-h-doane-near-the-cross",
    title: "Near the Cross",
    artist: "W. H. Doane",
    category: "Reserved standard evaluation",
    contentType: "standard",
    acquiredVia: "midi-file",
    sourceRoot: reservedFixtureRoot,
  },
  {
    baseId: "c-v-alkan-prelude",
    title: "Prélude",
    artist: "C.-V. Alkan",
    category: "Reserved standard evaluation",
    contentType: "standard",
    acquiredVia: "midi-file",
    sourceRoot: reservedFixtureRoot,
  },
  {
    baseId: "beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940",
    title: "Easy Piano Jumbo Songbook - Pay Me My Money Down",
    artist: "Beginner Piano Tutorial",
    category: "Reserved YouTube evaluation",
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceRoot: reservedFixtureRoot,
  },
  {
    baseId: "dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo",
    title: "Avenged Sevenfold - Dear God - Piano Cover",
    artist: "Dadebrayant",
    category: "Reserved YouTube evaluation",
    contentType: "youtube",
    acquiredVia: "youtube",
    sourceRoot: reservedFixtureRoot,
  },
];

type Source = { key?: string; tempoBpm?: number; notes?: Array<{ start: number; dur: number }> };
const songs = fixtures.map((fixture) => {
  const fixtureRoot = fixture.sourceRoot ?? sourceRoot;
  const sourceVariantDir = fixture.sourceRoot
    ? join(fixtureRoot, fixture.baseId, "a")
    : join(fixtureRoot, "artifacts", fixture.baseId, "a");
  const manifestPath = fixture.sourceRoot
    ? join(fixtureRoot, fixture.baseId, "manifest.json")
    : join(fixtureRoot, "artifacts", fixture.baseId, "manifest.json");
  cpSync(sourceVariantDir, join(scratchDataDir, "artifacts", fixture.baseId, "a"), { recursive: true });
  cpSync(manifestPath, join(scratchDataDir, "artifacts", fixture.baseId, "manifest.json"));
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
