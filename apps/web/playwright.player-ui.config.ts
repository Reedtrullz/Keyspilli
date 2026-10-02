import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb } from "../../packages/catalog/src/db";

const scratch = mkdtempSync(join(realpathSync(tmpdir()), "keyspilli-web-e2e-"));
process.env.KEYSPILLI_DATA_DIR = scratch;
process.env.KEYSPILLI_E2E_SCRATCH_DIR = scratch;
const db = getDb();
const measures = Array.from({ length: 16 }, (_, index) => ({ index, startBeat: index * 4, endBeat: (index + 1) * 4 }));
const notes = measures.flatMap(m => [
  { midi: 60, start: m.startBeat, dur: 1, vel: 80, hand: "R", lyrics: "Simultaneous" },
  { midi: 61, start: m.startBeat, dur: 1, vel: 80, hand: "R", lyrics: "Long lyric words stay readable" },
  ...Array.from({ length: 12 }, (_, i) => ({ midi: 62 + i % 8, start: m.startBeat + 0.125 * (i + 1), dur: 0.125, vel: 80, hand: "R" })),
  { midi: 48, start: m.startBeat, dur: 4, vel: 65, hand: "L" },
]);
const data = { notes, key: "C", tempoBpm: 120, timeSig: [4, 4], measures,
  chords: measures.map(m => ({ beat: m.startBeat, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" })),
  sections: [{ id: "opening", label: "Opening", startBeat: 0, endBeat: 32 }, { id: "ending", label: "Ending", startBeat: 32, endBeat: 64 }],
};
for (const level of ["m", "a"]) {
  const dir = join(scratch, "artifacts", "ui-fixture", level);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "notes.json"), JSON.stringify(data));
  db.prepare(`INSERT INTO songs (id,base_id,title,artist,difficulty,difficulty_score,key,tempo,level,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`ui-fixture-${level}`, "ui-fixture", "Player UI fixture with a long song title", "Synthetic fixture", level === "m" ? "medium" : "advanced", 2, "C", 120, level, "2026-10-01");
}
db.close();

export default defineConfig({
  testDir: "./e2e", testMatch: "player-ui-improvements.spec.ts", workers: 1, timeout: 60_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: { command: "npm run start -- --port 3110", url: "http://127.0.0.1:3110", reuseExistingServer: false,
    env: { KEYSPILLI_DATA_DIR: scratch, KEYSPILLI_E2E_SCRATCH_DIR: scratch, NEXT_TELEMETRY_DISABLED: "1" } },
  use: { baseURL: "http://127.0.0.1:3110", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
