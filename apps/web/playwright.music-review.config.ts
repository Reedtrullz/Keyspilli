import { defineConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb } from "../../packages/catalog/src/db";
const run = process.env.KEYSPILLI_MUSIC_REVIEW_RUN;
if (!run)
  throw new Error(
    "Set KEYSPILLI_MUSIC_REVIEW_RUN to the newly generated owned corpus",
  );
const root = resolve(run);
const scratch = join(root, "browser-data");
const bundle = JSON.parse(
  readFileSync(join(root, "capture-fixtures/bundle.json"), "utf8"),
) as { fixtures: Array<{ id: string; title: string; data: { notes: Array<{ start: number }> } }> };
// Player's binary-search scheduler requires time-ordered notes. Reject a bad
// fixture before creating its catalog or recording misleading delayed attacks.
for (const fixture of bundle.fixtures) {
  let previous = -Infinity;
  for (const note of fixture.data.notes) {
    if (!Number.isFinite(note.start) || note.start < previous) {
      throw new Error(`Capture fixture ${fixture.id} notes must be ordered by finite start beat`);
    }
    previous = note.start;
  }
}
mkdirSync(scratch, { recursive: true });
process.env.KEYSPILLI_DATA_DIR = scratch;
const initialized = join(scratch, "initialized.json");
if (!existsSync(initialized)) {
  const db = getDb();
  for (const f of bundle.fixtures)
    for (const level of ["b", "m", "a"]) {
      const dir = join(scratch, "artifacts", f.id, level);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "notes.json"), JSON.stringify(f.data));
      db.prepare(
        "INSERT INTO songs (id,base_id,title,artist,difficulty,difficulty_score,key,tempo,level,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        f.id + "-" + level,
        f.id,
        f.title,
        "Self authored synthetic fixture",
        level === "a" ? "advanced" : level === "b" ? "beginner" : "medium",
        2,
        "C",
        120,
        level,
        "2026-10-05",
      );
    }
  db.close();
  writeFileSync(initialized, JSON.stringify({ run: root }), { flag: "wx" });
}
if (JSON.parse(readFileSync(initialized, "utf8")).run !== root)
  throw new Error("scratch identity mismatch");
const port = Number(process.env.KEYSPILLI_MUSIC_REVIEW_PORT ?? 3229);
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "music-review-0-recorder-clock.spec.ts",
    "music-review-capture.spec.ts",
  ],
  workers: 1,
  timeout: 30 * 60 * 1000,
  outputDir: join(root, "browser-traces"),
  webServer: {
    command: "npm run dev -- --port " + port,
    url: "http://127.0.0.1:" + port,
    reuseExistingServer: false,
    env: { KEYSPILLI_DATA_DIR: scratch, NEXT_TELEMETRY_DISABLED: "1" },
  },
  use: { baseURL: "http://127.0.0.1:" + port, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
