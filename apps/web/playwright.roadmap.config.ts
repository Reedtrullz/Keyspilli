import { defineConfig } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, upsertSong, type SongRow } from "../../packages/catalog/src/db";

const configured = process.env.KEYSPILLI_E2E_SCRATCH_DIR;
const directory = configured ?? mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-"));
process.env.KEYSPILLI_DATA_DIR = directory;
process.env.KEYSPILLI_E2E_SCRATCH_DIR = directory;
if (!configured) {
writeFileSync(join(directory, "manifest.json"), JSON.stringify({ songs: [] }));
getDb().transaction(() => {
  for (let index = 0; index < 250; index++) {
    const baseId = `roadmap-${String(index).padStart(3, "0")}`;
    for (const difficulty of ["beginner", "easy"]) {
      upsertSong({ id: `${baseId}-${difficulty}`, baseId, title: baseId, artist: "Roadmap Fixture", category: "Test",
        difficulty, difficultyScore: 2, key: "C", tempo: 120, style: "classical", mood: "peaceful", bassPattern: "block",
        duration: 10, contentType: "standard", acquiredVia: null, sourceYoutubeUrl: null, hasSheetXml: 0,
        sections: null, plays: 0, level: difficulty, createdAt: "2026-10-02T00:00:00Z" } satisfies SongRow);
    }
  }
})();
getDb().close();
}

export default defineConfig({
  testDir: "./e2e", testMatch: process.env.KEYSPILLI_PERF_BASELINE === "1" ? ["performance-baseline.spec.ts"] : ["library-roadmap.spec.ts", "jobs-roadmap.spec.ts", "practice-roadmap.spec.ts", "audio-graph.spec.ts", "upload-replay.spec.ts", "keyboard-range.spec.ts", "diagnostics.spec.ts", "symbolic-intake.spec.ts", "learning-inspection.spec.ts", "key-holds.spec.ts", "active-export.spec.ts", "catalog-recovery.spec.ts", "accessibility-roadmap.spec.ts", "owner-metadata.spec.ts", "sheet-navigation.spec.ts", "owner-review.spec.ts", "owner-deletion.spec.ts", "owner-harmony.spec.ts", "learner-exercises.spec.ts", "sheet-retention.spec.ts", "rhythm.spec.ts", "midi-take.spec.ts", "source-pedal.spec.ts", "passage-recall.spec.ts", "offline-pack.spec.ts"], workers: 1, timeout: 60_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3128", url: "http://127.0.0.1:3128", reuseExistingServer: false,
    env: { KEYSPILLI_DATA_DIR: directory, KEYSPILLI_API_TOKEN: "test-token-for-e2e", KEYSPILLI_ORIGIN: "http://127.0.0.1:3128", KEYSPILLI_TUTORIAL_BETA: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
  use: { baseURL: "http://127.0.0.1:3128", browserName: "chromium", trace: "retain-on-failure" },
});
