import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFile as execFileCb } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { writeMidi } from "@keyspilli/midi";

const execFile = promisify(execFileCb);
const root = resolve(process.cwd(), "../..");
const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-verify-catalog-"));
const baseId = "verify-row-integrity";

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("verify-catalog read-model integrity gate", () => {
  it("rejects a complete artifact tree with a missing difficulty row", async () => {
    const sourcePath = join(dataDir, "source.mid");
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
        baseId: "${baseId}",
      });
      if (result.error) throw new Error(result.error);
    `;
    await execFile(process.execPath, ["--import", "tsx", "--input-type=module", "-e", ingestScript], {
      cwd: root,
      env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
      maxBuffer: 2 * 1024 * 1024,
    });

    const db = new Database(join(dataDir, "db.sqlite"));
    db.prepare("DELETE FROM songs WHERE base_id = ? AND level = ?").run(baseId, "m");
    db.close();

    await expect(
      execFile(process.execPath, ["--import", "tsx", "packages/catalog/scripts/verify-catalog.ts", baseId], {
        cwd: root,
        env: { ...process.env, KEYSPILLI_DATA_DIR: dataDir },
        maxBuffer: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("database missing levels: m"),
    });
  });
});
