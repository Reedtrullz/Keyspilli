import { readFile, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { getDb, getBaseJobIds, deleteBaseRows, replaceSongsByBase, type SongRow } from "./db.js";
import { readRecoveryDocument } from "./publish.js";
import { uploadsDir, transcribedDir } from "./paths.js";
import { validateSymbolicUploadIntent, type SymbolicUploadIntent } from "./artifact-manifest.js";

export interface CatalogPublication {
  baseId: string;
  rows: SongRow[];
  symbolicIntent?: SymbolicUploadIntent;
  job?: { id: string; owner: string };
  upload?: { final: string; sha256: string; staged?: string; backup?: string };
}

/** Idempotent across source swap, database commit, and cleanup interruptions. */
export async function commitCatalogPublication(raw: unknown): Promise<void> {
  const data = raw as CatalogPublication;
  const levelCode: Record<string, string> = { "very-beginner": "vb", beginner: "b", "very-easy": "ve", easy: "e", medium: "m", advanced: "a" };
  const studyLevels = Array.isArray(data?.symbolicIntent?.study?.availableLevels)
    ? data.symbolicIntent.study.availableLevels
    : [];
  const expectedLevels = data?.symbolicIntent?.study
    ? studyLevels.map((level) => levelCode[level] ?? "")
    : ["a", "b", "e", "m", "ve", "vb"];
  const intentErrors = data?.symbolicIntent ? validateSymbolicUploadIntent(data.symbolicIntent) : [];
  if (!data || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(data.baseId)
    || intentErrors.length > 0
    || !Array.isArray(data.rows) || data.rows.length !== expectedLevels.length
    || new Set(data.rows.map(row => row.level)).size !== expectedLevels.length
    || data.rows.some(row => !expectedLevels.includes(row.level) || row.baseId !== data.baseId || row.id !== `${data.baseId}-${row.level}`)
    || expectedLevels.some((level) => !data.rows.some((row) => row.level === level))
    || (data.symbolicIntent && (!data.upload || data.symbolicIntent.sourceHash !== data.upload.sha256
      || data.baseId !== `upload-${data.upload.sha256}`))) {
    throw new Error("invalid catalog reconciliation data");
  }
  if (data.job && (!/^[a-zA-Z0-9-]{1,120}$/.test(data.job.id) || !/^[a-f0-9-]{36}$/.test(data.job.owner)))
    throw new Error("invalid publication job owner");
  if (data.upload) {
    const { sha256 } = data.upload;
    const movesSource = data.upload.staged !== undefined || data.upload.backup !== undefined;
    if ([data.upload.final, ...(movesSource ? [data.upload.staged, data.upload.backup] : [])].some(name => typeof name !== "string" || basename(name) !== name)
      || !["mid", "xml", "mxl"].some(ext => data.upload!.final === `${data.baseId}.${ext}`)
      || (movesSource && (!data.upload.staged?.startsWith(`.${data.baseId}.staging-`)
        || !data.upload.backup?.startsWith(`.${data.baseId}.backup-`)))
      || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("invalid upload reconciliation paths/hash");
    // Store names, not mount paths: a restore into another data directory can replay safely.
    const staged = data.upload.staged ? join(uploadsDir(), data.upload.staged) : null;
    const final = join(uploadsDir(), data.upload.final);
    const backup = data.upload.backup ? join(uploadsDir(), data.upload.backup) : null;
    if (staged && backup && existsSync(staged)) {
      if (createHash("sha256").update(await readFile(staged)).digest("hex") !== sha256) throw new Error("staged upload hash mismatch");
      if (existsSync(final) && !existsSync(backup)) await rename(final, backup);
      await rename(staged, final);
    }
    if (createHash("sha256").update(await (movesSource ? readFile(final) : readRecoveryDocument(final, 10 * 1024 * 1024))).digest("hex") !== sha256) throw new Error("published upload hash mismatch");
  }
  const db = getDb();
  db.transaction(() => {
    replaceSongsByBase(data.baseId, data.rows);
    if (!data.job) return;
    const songId = data.rows.find((row) => row.level === "e")?.id ?? data.rows[0]!.id;
    const result = db.prepare(`UPDATE conversion_jobs SET status = 'done', song_id = ?, error = NULL,
      finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ? AND
      ((status = 'processing' AND lease_owner = ?) OR
       (status = 'error' AND error LIKE '%ARTIFACT_RECONCILIATION_REQUIRED%'))`)
      .run(songId, new Date().toISOString(), data.job.id, data.job.owner);
    if (!result.changes) {
      const existing = db.prepare("SELECT status, song_id FROM conversion_jobs WHERE id = ?").get(data.job.id) as { status: string; song_id: string | null } | undefined;
      if (existing?.status !== "done" || existing.song_id !== songId) throw new Error("publication job ownership changed");
    }
  }).immediate();
  if (data.upload?.backup) await rm(join(uploadsDir(), data.upload.backup), { force: true }).catch(() => undefined);
}

export interface CatalogDeletion { baseId: string; jobIds: string[] }
/** Capture inside the artifact lock, before deleting rows or source files. */
export function catalogDeletionSnapshot(baseId: string): CatalogDeletion {
  const jobIds = getBaseJobIds(baseId);
  if (jobIds.length > 1000) throw new Error("deletion exceeds bounded job cleanup");
  return { baseId, jobIds };
}

/** Journaled source cleanup survives a crash after the database commit. */
export async function commitCatalogDeletion(raw: unknown): Promise<void> {
  const data = raw as CatalogDeletion;
  if (!data || Object.keys(data).sort().join(" ") !== "baseId jobIds"
    || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(data.baseId) || !Array.isArray(data.jobIds) || data.jobIds.length > 1000
    || data.jobIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)))
    throw new Error("invalid deletion snapshot; legacy source cleanup requires operator investigation");
  deleteBaseRows(data.baseId);
  for (const [directory, owned] of [
    [uploadsDir(), (name: string) => name.startsWith(`${data.baseId}.`)],
    [transcribedDir(), (name: string) => data.jobIds.some(id => name === id || name.startsWith(`${id}-`))],
  ] as const) {
    let names: string[];
    try { names = await readdir(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names.filter(owned)) await rm(join(directory, name), { recursive: true, force: true });
  }
}
