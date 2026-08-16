import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFile as execFileCb } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { writeMidi } from "@keyspilli/midi";

const execFile = promisify(execFileCb);
const baseId = "restore-curated-new-seed";
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-restore-curated-"));
const root = resolve(process.cwd(), "../..");
const midiPath = join(dataDir, "seed-midi", `${baseId}.mid`);

mkdirSync(join(dataDir, "seed-midi"), { recursive: true });
writeFileSync(
  midiPath,
  writeMidi(
    Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, start: i * 0.5, dur: 0.5, vel: 80 })),
    { tempoBpm: 120 },
  ),
);
writeFileSync(
  join(dataDir, "manifest.json"),
  JSON.stringify({
    songs: [{
      id: baseId,
      title: "New Curated Seed",
      artist: "Test Artist",
      category: "Pop",
      sourceUrl: "https://www.youtube.com/watch?v=test-seed",
      sourceFile: `${baseId}.mid`,
      contentType: "youtube",
      acquiredVia: "youtube",
      license: "test",
    }],
  }),
);

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("restore-curated new manifest seeds", () => {
  it("publishes a seed even when SQLite has no existing base row", async () => {
    await execFile(process.execPath, ["--import", "tsx", join(root, "packages/catalog/scripts/restore-curated.ts"), baseId], {
      cwd: root,
      env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
      timeout: 30_000,
    });

    const db = new Database(join(dataDir, "db.sqlite"));
    const rows = db.prepare("SELECT title, content_type, source_youtube_url FROM songs WHERE base_id = ?").all(baseId) as {
      title: string;
      content_type: string;
      source_youtube_url: string;
    }[];
    db.close();

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.title === "New Curated Seed")).toBe(true);
    expect(rows.every((row) => row.content_type === "youtube")).toBe(true);
    expect(rows.every((row) => row.source_youtube_url === "https://www.youtube.com/watch?v=test-seed")).toBe(true);
    expect(readFileSync(join(dataDir, "artifacts", baseId, "a", "notes.json"), "utf8")).toContain("youtube");
  });
});
