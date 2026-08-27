import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFile as execFileCb } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { writeMidi } from "@keyspilli/midi";

const execFile = promisify(execFileCb);
const root = resolve(process.cwd(), "../..");
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-verify-catalog-"));
const baseId = "verify-row-integrity";
const repairBaseId = "verify-tempo-repair";
const mismatchBaseId = "verify-tempo-mismatch";
const metalDurationBaseId = "verify-metal-duration";

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("verify-catalog read-model integrity gate", () => {
  async function ingestFixture(id: string): Promise<void> {
    const sourcePath = join(dataDir, `${id}.mid`);
    writeFileSync(
      sourcePath,
      writeMidi(
        Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, start: i * 0.5, dur: 0.5, vel: 80 })),
        { tempoBpm: 120 },
      ),
    );
    const ingestScript = `
      import { readFile } from "node:fs/promises";
      import { ingestSource } from "${root}/packages/catalog/src/ingest.ts";
      const result = await ingestSource({
        buf: new Uint8Array(await readFile(${JSON.stringify(sourcePath)})),
        title: "Integrity fixture",
        artist: "Keyspilli",
        contentType: "standard",
        baseId: "${id}",
      });
      if (result.error) throw new Error(result.error);
    `;
    await execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", ingestScript], {
      cwd: root,
      env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
      maxBuffer: 2 * 1024 * 1024,
    });
  }

  async function ingestMetalDurationFixture(id: string): Promise<void> {
    const sourcePath = join(dataDir, `${id}.mid`);
    writeFileSync(
      sourcePath,
      writeMidi(
        Array.from({ length: 12 }, (_, index) => ({
          midi: 60 + index,
          start: index,
          dur: 3,
          vel: 84,
          hand: "R" as const,
        })),
        { tempoBpm: 120 },
      ),
    );
    const ingestScript = `
      import { readFile } from "node:fs/promises";
      import { ingestSource } from "${root}/packages/catalog/src/ingest.ts";
      const result = await ingestSource({
        buf: new Uint8Array(await readFile(${JSON.stringify(sourcePath)})),
        title: "Metal duration fixture",
        artist: "Keyspilli",
        contentType: "youtube",
        acquiredVia: "youtube",
        sourceYoutubeUrl: "https://www.youtube.com/watch?v=metalVerify01",
        arrangementProfile: "metal",
        cleanTranscription: false,
        baseId: "${id}",
      });
      if (result.error) throw new Error(result.error);
    `;
    await execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", ingestScript], {
      cwd: root,
      env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
      maxBuffer: 2 * 1024 * 1024,
    });
  }

  it("rejects a complete artifact tree with a missing difficulty row", async () => {
    await ingestFixture(baseId);

    const db = new Database(join(dataDir, "db.sqlite"));
    db.prepare("DELETE FROM songs WHERE base_id = ? AND level = ?").run(baseId, "m");
    db.close();

    await expect(
      execFile(process.execPath, ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", "--repair", baseId], {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("database missing levels: m"),
    });
  });

  it("requires an explicit base id for repair mode", async () => {
    await expect(
      execFile(process.execPath, ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", "--repair"], {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--repair requires at least one base id"),
    });
  });

  it("repairs all six database tempo mirrors from a valid manifest", async () => {
    await ingestFixture(repairBaseId);
    const db = new Database(join(dataDir, "db.sqlite"));
    db.prepare("UPDATE songs SET tempo = ? WHERE base_id = ?").run(99, repairBaseId);
    expect((db.prepare("SELECT tempo FROM songs WHERE base_id = ?").all(repairBaseId) as { tempo: number }[]).every((row) => row.tempo === 99)).toBe(true);
    db.close();

    const result = await execFile(
      process.execPath,
      ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", "--repair", repairBaseId],
      {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    expect(result.stdout).toContain(`REPAIRED ${repairBaseId}: database tempo mirrors -> 120 BPM from manifest`);

    const repairedDb = new Database(join(dataDir, "db.sqlite"));
    expect((repairedDb.prepare("SELECT level, tempo FROM songs WHERE base_id = ?").all(repairBaseId) as { level: string; tempo: number }[])).toHaveLength(6);
    expect((repairedDb.prepare("SELECT tempo FROM songs WHERE base_id = ?").all(repairBaseId) as { tempo: number }[]).every((row) => row.tempo === 120)).toBe(true);
    repairedDb.close();
  });

  it("refuses tempo repair when the manifest disagrees with artifact tempos", async () => {
    await ingestFixture(mismatchBaseId);
    const manifestPath = join(dataDir, "artifacts", mismatchBaseId, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { tempo: { playback: { bpm: number } } };
    manifest.tempo.playback.bpm = 121;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const db = new Database(join(dataDir, "db.sqlite"));
    db.prepare("UPDATE songs SET tempo = ? WHERE base_id = ?").run(99, mismatchBaseId);
    db.close();

    await expect(
      execFile(process.execPath, ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", "--repair", mismatchBaseId], {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("manifest playback tempo 121 differs from artifact tempo 120"),
    });

    const unchangedDb = new Database(join(dataDir, "db.sqlite"));
    expect((unchangedDb.prepare("SELECT tempo FROM songs WHERE base_id = ?").all(mismatchBaseId) as { tempo: number }[]).every((row) => row.tempo === 99)).toBe(true);
    unchangedDb.close();
  });

  it("does not apply the legacy YouTube sustain cap to canonical metal artifacts", async () => {
    await ingestMetalDurationFixture(metalDurationBaseId);
    const result = await execFile(
      process.execPath,
      ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", metalDurationBaseId],
      {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    expect(result.stdout).toContain("verify-catalog: 0 of 1 songs failed");
  });
});
