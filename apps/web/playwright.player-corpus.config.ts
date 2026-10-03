import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getDb } from "../../packages/catalog/src/db";

const repoRoot = resolve(__dirname, "../..");
const run = resolve(process.env.KEYSPILLI_PLAYER_CORPUS_RUN ?? join(repoRoot, "output/song-prep/player-qualification-20261003"));
process.env.KEYSPILLI_PLAYER_CORPUS_ENABLE = "1";
const bundle = JSON.parse(readFileSync(join(run, "capture-fixtures/bundle.json"), "utf8")) as {
  fixtures: Array<{ id: string; title: string; data: { notes?: Array<{ start: number; midi: number }> } }>;
};
for (const fixture of bundle.fixtures) {
  const notes = fixture.data.notes ?? [];
  for (let index = 1; index < notes.length; index++) {
    const previous = notes[index - 1]!;
    const current = notes[index]!;
    if (previous.start > current.start || (previous.start === current.start && previous.midi > current.midi))
      throw new Error(`Unsorted fixture ${fixture.id}: notes must be ordered by start beat then MIDI pitch before Player handoff`);
  }
}
const scratch = mkdtempSync(join(realpathSync(tmpdir()), "keyspilli-web-e2e-"));
process.env.KEYSPILLI_DATA_DIR = scratch;
process.env.KEYSPILLI_E2E_SCRATCH_DIR = scratch;
const db = getDb();
for (const fixture of bundle.fixtures) {
  for (const [level, suffix, difficulty] of [["m", "m", "medium"], ["a", "a", "advanced"]] as const) {
    const songId = `${fixture.id}-${suffix}`;
    const artifact = join(scratch, "artifacts", fixture.id, level);
    mkdirSync(artifact, { recursive: true });
    writeFileSync(join(artifact, "notes.json"), JSON.stringify(fixture.data));
    db.prepare(`INSERT INTO songs (id,base_id,title,artist,difficulty,difficulty_score,key,tempo,level,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(songId, fixture.id, fixture.title, "Self authored synthetic fixture", difficulty, 2, "C", 120, level, "2026-10-03");
  }
}
db.close();

export default defineConfig({
  testDir: "./e2e", testMatch: "player-audio-corpus.spec.ts", workers: 1, timeout: 90_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: { command: "npm run dev -- --port 3211", url: "http://127.0.0.1:3211", reuseExistingServer: false,
    env: { KEYSPILLI_DATA_DIR: scratch, KEYSPILLI_E2E_SCRATCH_DIR: scratch, NEXT_TELEMETRY_DISABLED: "1" } },
  use: { baseURL: "http://127.0.0.1:3211", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
