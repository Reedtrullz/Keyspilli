import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateArtifactFiles, type Variant } from "@keyspilli/midi";
import { parseArrangementManifest } from "./artifact-manifest.js";
import type { ArrangementManifest } from "./artifact-manifest.js";

const BASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export interface PublishBaseArtifactOptions {
  artifactsRoot: string;
  /**
   * The complete base-level artifact contract.  Every normal publication is
   * a six-level arrangement, so these defaults are deliberately strict.  The
   * options remain injectable for isolated fixtures or a future artifact
   * schema, but callers must opt into a different contract explicitly.
   */
  requiredLevels?: readonly string[];
  requiredFiles?: readonly string[];
  /**
   * Opt into parsing every staged notes/MIDI/MusicXML triple and checking
   * that the serialized formats agree before the filesystem swap.  The
   * default is intentionally permissive for isolated publication fixtures;
   * all production writers use `strict`.
   */
  semanticValidation?: "strict";
  /** Synchronous ownership/cancellation check after staging validation, before replacement. */
  beforeSwap?: () => void;
  /** Runs after the filesystem swap; a failure leaves the new tree published. */
  afterSwap?: () => Promise<void> | void;
  /** Durable arguments for the operator reconciliation command. */
  recoveryData?: unknown;
}

export interface ArtifactLockOptions {
  artifactsRoot: string;
}

export interface DeleteBaseArtifactOptions extends ArtifactLockOptions {
  /**
   * Runs after the canonical artifact root has been removed, while the
   * per-base lock is still held.  Callers use this for the DB/read-model
   * deletion and best-effort auxiliary cleanup.  A failure is propagated as
   * an explicit filesystem-success/DB-stale reconciliation state; deletion
   * is intentionally not rolled back because the tree is already committed.
   */
  afterFilesystemDelete?: () => Promise<void> | void;
}

export class ArtifactReconciliationError extends Error {
  readonly code = "ARTIFACT_RECONCILIATION_REQUIRED";
  constructor(readonly baseId: string, cause?: unknown) {
    super(`artifact reconciliation required for ${baseId}${cause instanceof Error ? `: ${cause.message}` : ""}`, { cause });
  }
}

export const REQUIRED_ARTIFACT_LEVELS = ["a", "b", "e", "m", "ve", "vb"] as const;
export const REQUIRED_ARTIFACT_FILES = ["notes.json", "variant.mid", "variant.xml"] as const;

/**
 * Serialize every mutation of one base's artifact tree.  Publication and
 * deletion share this lock so a delete cannot race an ingest/metadata swap
 * and later be undone by its post-swap DB update.
 */
export async function withBaseArtifactLock<T>(
  baseId: string,
  options: ArtifactLockOptions,
  operation: () => Promise<T> | T,
): Promise<T> {
  if (!BASE_ID_RE.test(baseId)) throw new Error(`invalid base id: ${baseId}`);
  const root = options.artifactsRoot;
  await mkdir(root, { recursive: true });
  // Legacy writers must be stopped and their directory locks recovered before upgrading.
  if (existsSync(join(root, `.${baseId}.lock`))) throw new Error("legacy artifact lock requires operator recovery");
  // SQLite's OS lock survives arbitrary writer duration and is released on process death.
  // Never unlink this file: another process may already have its inode open.
  const lock = new Database(join(root, `.${baseId}.lock.sqlite`), { timeout: 0 });
  try {
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_BUSY") throw new Error("artifact publish already locked");
      throw error;
    }
    return await operation();
  } finally {
    lock.close();
  }
}

/**
 * Publish a complete base artifact tree with a manifest-last commit marker.
 * Writers must create every level and `manifest.json` inside `stagingDir`.
 * SQLite/read-model updates belong in `afterSwap`, never before the swap.
 */
export async function publishBaseArtifact<T>(
  baseId: string,
  writer: (stagingDir: string) => Promise<T> | T,
  options: PublishBaseArtifactOptions,
): Promise<T> {
  const root = options.artifactsRoot;
  const finalRoot = join(root, baseId);
  const newRoot = join(root, `.${baseId}.new`);
  const oldRoot = join(root, `.${baseId}.old`);
  const requiredLevels = options.requiredLevels ?? REQUIRED_ARTIFACT_LEVELS;
  const requiredFiles = options.requiredFiles ?? REQUIRED_ARTIFACT_FILES;

  return withBaseArtifactLock(baseId, options, async () => {
    const journal = join(root, `.${baseId}.reconciliation.json`);
    if (existsSync(journal)) throw new ArtifactReconciliationError(baseId);
    let journalWritten = false;
    try {
      await recoverInterruptedPublish(finalRoot, newRoot, oldRoot);
      await rm(newRoot, { recursive: true, force: true });
      await mkdir(newRoot, { recursive: true });
      const result = await writer(newRoot);
      const manifestPath = join(newRoot, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new Error("staged artifact set is missing manifest.json commit marker");
      }
      const stagedManifest = parseArrangementManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      if (stagedManifest.baseId !== baseId) {
        throw new Error(`staged artifact manifest baseId ${stagedManifest.baseId} does not match ${baseId}`);
      }
      await assertCompleteArtifactTree(newRoot, requiredLevels, requiredFiles);
      if (options.semanticValidation === "strict") {
        const semanticIssues = await validateStagedArtifactTree(newRoot, stagedManifest, requiredLevels, requiredFiles);
        if (semanticIssues.length) {
          throw new Error(`staged artifact semantic validation failed: ${semanticIssues.join("; ")}`);
        }
      }

      await rm(oldRoot, { recursive: true, force: true });
      options.beforeSwap?.();
      const token = randomUUID();
      await writeFile(join(newRoot, ".publication-id"), token, { flush: true });
      await writeFile(journal, JSON.stringify({ version: 1, operation: "publish", token, requiresCommit: Boolean(options.afterSwap), recoveryData: options.recoveryData }), { flag: "wx", flush: true });
      journalWritten = true;
      if (existsSync(finalRoot)) await rename(finalRoot, oldRoot);
      try {
        await rename(newRoot, finalRoot);
      } catch (error) {
        if (!existsSync(finalRoot) && existsSync(oldRoot)) await rename(oldRoot, finalRoot).catch(() => undefined);
        throw error;
      }
      await options.afterSwap?.();
      await rm(oldRoot, { recursive: true, force: true });
      await rm(journal);
      return result;
    } catch (error) {
      if (journalWritten) throw new ArtifactReconciliationError(baseId, error);
      await rm(newRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}

const VARIANT_LEVEL_BY_CODE: Record<string, Variant["level"]> = {
  vb: "very-beginner",
  b: "beginner",
  ve: "very-easy",
  e: "easy",
  m: "medium",
  a: "advanced",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate the semantic contract of a staged artifact tree.  This is kept
 * deliberately narrower than the catalogue playability audit: publication
 * must reject malformed or cross-format artifacts, but it should not make a
 * subjective musical-quality decision.  The caller supplies the already
 * parsed manifest so this helper can also enforce its tempo mirror.
 */
export async function validateStagedArtifactTree(
  stagedRoot: string,
  manifest: ArrangementManifest,
  requiredLevels: readonly string[] = REQUIRED_ARTIFACT_LEVELS,
  requiredFiles: readonly string[] = REQUIRED_ARTIFACT_FILES,
): Promise<string[]> {
  const issues: string[] = [];
  if (!requiredFiles.includes("notes.json") || !requiredFiles.includes("variant.mid") || !requiredFiles.includes("variant.xml")) {
    return ["semantic validation requires notes.json, variant.mid, and variant.xml"];
  }

  for (const levelCode of requiredLevels) {
    const prefix = `${levelCode}`;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(stagedRoot, levelCode, "notes.json"), "utf8")) as unknown;
    } catch (error) {
      issues.push(`${prefix}: notes.json parse failed: ${(error as Error).message}`);
      continue;
    }

    const variantIssues: string[] = [];
    if (!isRecord(raw)) {
      variantIssues.push("notes.json must contain an object");
    }
    const notes = isRecord(raw) ? raw.notes : undefined;
    if (!Array.isArray(notes)) {
      variantIssues.push("notes.json notes must be an array");
    } else {
      for (let index = 0; index < notes.length; index++) {
        const note = notes[index];
        if (!isRecord(note)) {
          variantIssues.push(`notes[${index}] must be an object`);
          continue;
        }
        for (const field of ["midi", "start", "dur", "vel"] as const) {
          if (!finiteNumber(note[field])) variantIssues.push(`notes[${index}].${field} must be finite`);
        }
        if (finiteNumber(note.midi) && (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127)) {
          variantIssues.push(`notes[${index}].midi must be an integer between 0 and 127`);
        }
        if (finiteNumber(note.start) && note.start < 0) variantIssues.push(`notes[${index}].start must be non-negative`);
        if (finiteNumber(note.dur) && note.dur <= 0) variantIssues.push(`notes[${index}].dur must be positive`);
        if (finiteNumber(note.vel) && (!Number.isInteger(note.vel) || note.vel < 0 || note.vel > 127)) {
          variantIssues.push(`notes[${index}].vel must be an integer between 0 and 127`);
        }
      }
    }
    const tempoBpm = isRecord(raw) ? raw.tempoBpm : undefined;
    if (!finiteNumber(tempoBpm) || tempoBpm < 20 || tempoBpm > 300) {
      variantIssues.push("tempoBpm must be between 20 and 300");
    } else if (Math.abs(tempoBpm - manifest.tempo.playback.bpm) > 1e-6) {
      variantIssues.push(`tempoBpm ${tempoBpm} differs from manifest playback ${manifest.tempo.playback.bpm}`);
    }
    if (isRecord(raw) && raw.chords !== undefined && !Array.isArray(raw.chords)) variantIssues.push("chords must be an array when present");
    if (isRecord(raw) && raw.measures !== undefined && !Array.isArray(raw.measures)) variantIssues.push("measures must be an array when present");
    if (variantIssues.length) {
      issues.push(...variantIssues.map((issue) => `${prefix}: ${issue}`));
      // A malformed notes object cannot safely be compared with the binary
      // formats, but continue with the next level to report all bad levels.
      continue;
    }

    let midi: Uint8Array;
    let xml: string;
    try {
      midi = new Uint8Array(await readFile(join(stagedRoot, levelCode, "variant.mid")));
      xml = await readFile(join(stagedRoot, levelCode, "variant.xml"), "utf8");
    } catch (error) {
      issues.push(`${prefix}: artifact read failed: ${(error as Error).message}`);
      continue;
    }

    const level = VARIANT_LEVEL_BY_CODE[levelCode] ?? (isRecord(raw) && typeof raw.level === "string" ? raw.level : undefined);
    if (!level) {
      issues.push(`${prefix}: notes.json must identify a known difficulty level for semantic validation`);
      continue;
    }
    // validateArtifactFiles only consumes the level, tempo, and note fields;
    // the structural checks above ensure this cast cannot hide malformed
    // note data while avoiding a second, drifting round-trip comparator.
    const variant = { ...(raw as Record<string, unknown>), level } as unknown as Variant;
    issues.push(...validateArtifactFiles(variant, { midi, xml }).map((issue) => `${prefix}: ${issue}`));
  }
  return issues;
}

/**
 * Remove one complete base artifact set under the same lock used by
 * publication.  `.new`/`.old` recovery is performed first so an interrupted
 * publication cannot leave an abandoned tree behind after deletion.  The
 * canonical tree is removed before `afterFilesystemDelete` runs; callers
 * should therefore treat callback failure as an explicit reconciliation
 * condition rather than attempting an unsafe rollback.
 */
export async function deleteBaseArtifact(
  baseId: string,
  options: DeleteBaseArtifactOptions,
): Promise<{ baseId: string; existed: boolean }> {
  const root = options.artifactsRoot;
  const finalRoot = join(root, baseId);
  const newRoot = join(root, `.${baseId}.new`);
  const oldRoot = join(root, `.${baseId}.old`);

  return withBaseArtifactLock(baseId, options, async () => {
    const journal = join(root, `.${baseId}.reconciliation.json`);
    if (existsSync(journal)) throw new ArtifactReconciliationError(baseId);
    await recoverInterruptedPublish(finalRoot, newRoot, oldRoot);
    await writeFile(journal, JSON.stringify({ version: 1, operation: "delete" }), { flag: "wx", flush: true });
    const existed = existsSync(finalRoot);
    await rm(finalRoot, { recursive: true, force: true });
    // A deletion is also a cleanup boundary for abandoned staged/backup
    // roots.  These are safe to remove only while the base lock is held.
    await rm(newRoot, { recursive: true, force: true });
    await rm(oldRoot, { recursive: true, force: true });
    try {
      await options.afterFilesystemDelete?.();
      await rm(journal);
    } catch (error) { throw new ArtifactReconciliationError(baseId, error); }
    return { baseId, existed };
  });
}

async function assertCompleteArtifactTree(
  stagedRoot: string,
  requiredLevels: readonly string[],
  requiredFiles: readonly string[],
): Promise<void> {
  if (!requiredLevels.length) throw new Error("staged artifact contract has no required levels");
  if (!requiredFiles.length) throw new Error("staged artifact contract has no required files");
  for (const level of requiredLevels) {
    const levelDir = join(stagedRoot, level);
    let levelInfo;
    try {
      levelInfo = await stat(levelDir);
    } catch {
      throw new Error(`staged artifact set is missing level directory: ${level}`);
    }
    if (!levelInfo.isDirectory()) throw new Error(`staged artifact level is not a directory: ${level}`);
    for (const file of requiredFiles) {
      const filePath = join(levelDir, file);
      let fileInfo;
      try {
        fileInfo = await stat(filePath);
      } catch {
        throw new Error(`staged artifact set is missing ${level}/${file}`);
      }
      if (!fileInfo.isFile()) throw new Error(`staged artifact is not a file: ${level}/${file}`);
    }
  }
}

async function recoverInterruptedPublish(finalRoot: string, newRoot: string, oldRoot: string): Promise<void> {
  // A complete current root wins over an abandoned backup. If the process
  // crashed after moving current to .old but before installing .new, restore
  // the old complete tree. An abandoned .new is deliberately discarded: the
  // manifest commit marker may not have been written.
  if (!existsSync(finalRoot) && existsSync(oldRoot)) await rename(oldRoot, finalRoot);
  else if (existsSync(finalRoot) && existsSync(oldRoot)) await rm(oldRoot, { recursive: true, force: true });
  if (existsSync(newRoot)) await rm(newRoot, { recursive: true, force: true });
}


/** Explicit recovery only: retries an idempotent DB/source commit under the writer lock. */
export async function reconcileBaseArtifact(
  baseId: string,
  options: ArtifactLockOptions,
  commit: (data: unknown, operation: "publish" | "delete") => Promise<void> | void,
): Promise<void> {
  await withBaseArtifactLock(baseId, options, async () => {
    const root = options.artifactsRoot;
    const journal = join(root, `.${baseId}.reconciliation.json`);
    const entry = JSON.parse(await readFile(journal, "utf8"));
    if (entry.version !== 1 || !["publish", "delete"].includes(entry.operation)) throw new Error("invalid reconciliation journal");
    const final = join(root, baseId);
    const old = join(root, `.${baseId}.old`);
    const stage = join(root, `.${baseId}.new`);
    if (entry.operation === "publish") {
      if (typeof entry.token !== "string" || !entry.token) throw new Error("invalid publication token");
      const installed = await readFile(join(final, ".publication-id"), "utf8").catch(() => null);
      if (installed !== entry.token) {
        const staged = await readFile(join(stage, ".publication-id"), "utf8").catch(() => null);
        if (staged !== entry.token) throw new Error("ambiguous publication state; preserve journal and backups for investigation");
        // The swap never committed; restore the previous tree without touching the DB.
        if (!existsSync(final) && existsSync(old)) await rename(old, final);
        await rm(stage, { recursive: true, force: true });
        await rm(journal);
        return;
      }
    } else {
      await rm(final, { recursive: true, force: true });
    }
    if (entry.requiresCommit !== false) await commit(entry.recoveryData, entry.operation);
    await rm(old, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    await rm(journal);
  });
}
