import { readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { replaceSongsByBase, type SongRow } from "./db.js";
import { uploadsDir } from "./paths.js";

export interface CatalogPublication {
  baseId: string;
  rows: SongRow[];
  upload?: { staged: string; final: string; backup: string; sha256: string };
}

/** Idempotent across source swap, database commit, and cleanup interruptions. */
export async function commitCatalogPublication(raw: unknown): Promise<void> {
  const data = raw as CatalogPublication;
  if (!data || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(data.baseId)
    || !Array.isArray(data.rows) || data.rows.length !== 6
    || new Set(data.rows.map(row => row.level)).size !== 6
    || data.rows.some(row => !["a", "b", "e", "m", "ve", "vb"].includes(row.level) || row.baseId !== data.baseId || row.id !== `${data.baseId}-${row.level}`)) {
    throw new Error("invalid catalog reconciliation data");
  }
  if (data.upload) {
    const { sha256 } = data.upload;
    if ([data.upload.staged, data.upload.final, data.upload.backup].some(name => typeof name !== "string" || basename(name) !== name)
      || !["mid", "xml", "mxl"].some(ext => data.upload!.final === `${data.baseId}.${ext}`)
      || !data.upload.staged.startsWith(`.${data.baseId}.staging-`)
      || !data.upload.backup.startsWith(`.${data.baseId}.backup-`)
      || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("invalid upload reconciliation paths/hash");
    // Store names, not mount paths: a restore into another data directory can replay safely.
    const staged = join(uploadsDir(), data.upload.staged);
    const final = join(uploadsDir(), data.upload.final);
    const backup = join(uploadsDir(), data.upload.backup);
    if (existsSync(staged)) {
      if (createHash("sha256").update(await readFile(staged)).digest("hex") !== sha256) throw new Error("staged upload hash mismatch");
      if (existsSync(final) && !existsSync(backup)) await rename(final, backup);
      await rename(staged, final);
    }
    if (createHash("sha256").update(await readFile(final)).digest("hex") !== sha256) throw new Error("published upload hash mismatch");
  }
  replaceSongsByBase(data.baseId, data.rows);
  if (data.upload) await rm(join(uploadsDir(), data.upload.backup), { force: true }).catch(() => undefined);
}
