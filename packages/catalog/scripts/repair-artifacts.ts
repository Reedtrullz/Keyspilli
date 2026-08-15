/**
 * Re-render stored MIDI/MusicXML artifacts from their canonical notes.json.
 *
 * This repair intentionally does not touch notes.json or database rows: the
 * serializers are the only source of truth being repaired. Each base is
 * staged as a complete six-level set and then swapped file-by-file with a
 * rollback journal, so a failed render or rename cannot leave half a song
 * updated.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { LEVEL_ORDER, validateArtifactFiles, writeVariantArtifacts, type Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { dataDir } from "../src/paths.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

interface Replacement {
  finalPath: string;
  stagePath: string;
  backupPath: string;
  hadOriginal: boolean;
  movedOriginal: boolean;
  installed: boolean;
}

interface StagedBase {
  stageRoot: string;
  backupRoot: string;
  replacements: Replacement[];
  issues: string[];
}

function parseArgs(argv: string[]): { baseIds: string[]; dryRun: boolean; includeOrphans: boolean } {
  const baseIds: string[] = [];
  let dryRun = false;
  let includeOrphans = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--include-orphans") {
      includeOrphans = true;
    } else if (arg === "--base-id") {
      const id = argv[++i];
      if (!id) throw new Error("--base-id requires a value");
      baseIds.push(id);
    } else if (arg.startsWith("--base-id=")) {
      baseIds.push(arg.slice(10));
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx repair-artifacts.ts [--dry-run] [--include-orphans] [--base-id <id>]...");
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { baseIds, dryRun, includeOrphans };
}

async function catalogBaseIds(root: string, includeOrphans: boolean): Promise<string[]> {
  const ids = new Set<string>();
  const rows = getDb().prepare("SELECT DISTINCT base_id AS baseId FROM songs").all() as { baseId: string }[];
  for (const row of rows) ids.add(row.baseId);
  if (includeOrphans && existsSync(root)) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) ids.add(entry.name);
    }
  }
  return [...ids].sort();
}

async function renderBase(baseId: string, artifactRoot: string): Promise<StagedBase> {
  const titleRow = getDb().prepare("SELECT title, artist FROM songs WHERE base_id = ? LIMIT 1").get(baseId) as
    | { title: string; artist: string }
    | undefined;
  const title = titleRow?.title ?? baseId;
  const artist = titleRow?.artist ?? "Unknown";
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const stageRoot = join(artifactRoot, `.${baseId}.repair-staging-${token}`);
  const backupRoot = join(artifactRoot, `.${baseId}.repair-backup-${token}`);
  const replacements: Replacement[] = [];
  const issues: string[] = [];
  try {
    await mkdir(stageRoot, { recursive: true });
    for (const level of LEVEL_ORDER) {
      const code = LEVEL_CODE[level]!;
      const dir = join(artifactRoot, baseId, code);
      const notesPath = join(dir, "notes.json");
      let variant: Variant;
      try {
        variant = { ...(JSON.parse(await readFile(notesPath, "utf8")) as Variant), level };
      } catch (e) {
        issues.push(`${level}: missing or invalid notes.json (${(e as Error).message})`);
        continue;
      }
      let artifacts;
      try {
        artifacts = writeVariantArtifacts(variant, title, artist);
      } catch (e) {
        issues.push(`${level}: render failed (${(e as Error).message})`);
        continue;
      }
      const artifactIssues = validateArtifactFiles(variant, artifacts);
      if (artifactIssues.length) {
        issues.push(...artifactIssues.map((issue) => `${level}: ${issue}`));
        continue;
      }
      const stageDir = join(stageRoot, code);
      await mkdir(stageDir, { recursive: true });
      await Promise.all([
        writeFile(join(stageDir, "variant.mid"), artifacts.midi),
        writeFile(join(stageDir, "variant.xml"), artifacts.xml),
      ]);
      for (const file of ["variant.mid", "variant.xml"]) {
        const finalPath = join(dir, file);
        const stagePath = join(stageDir, file);
        const backupPath = join(backupRoot, code, file);
        replacements.push({ finalPath, stagePath, backupPath, hadOriginal: existsSync(finalPath), movedOriginal: false, installed: false });
      }
    }
    if (issues.length) return { stageRoot, backupRoot, replacements, issues };
    if (replacements.length !== LEVEL_ORDER.length * 2) {
      issues.push(`expected ${LEVEL_ORDER.length * 2} artifacts, prepared ${replacements.length}`);
      return { stageRoot, backupRoot, replacements, issues };
    }
    return { stageRoot, backupRoot, replacements, issues };
  } finally {
    // The caller owns stage/backup cleanup after a successful swap or rollback.
  }
}

async function replaceBase(baseId: string, artifactRoot: string, replacements: Replacement[], stageRoot: string, backupRoot: string): Promise<void> {
  const baseRoot = join(artifactRoot, baseId);
  await mkdir(backupRoot, { recursive: true });
  try {
    for (const item of replacements) {
      if (item.hadOriginal) {
        const rel = relative(baseRoot, item.finalPath);
        await mkdir(dirname(join(backupRoot, rel)), { recursive: true });
        await rename(item.finalPath, item.backupPath);
        item.movedOriginal = true;
    }
      await mkdir(dirname(item.finalPath), { recursive: true });
      await rename(item.stagePath, item.finalPath);
      item.installed = true;
    }
    await rm(stageRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  } catch (e) {
    for (const item of replacements.slice().reverse()) {
      if (item.installed) await rm(item.finalPath, { force: true }).catch(() => undefined);
      if (item.movedOriginal) await rename(item.backupPath, item.finalPath).catch(() => undefined);
    }
    await rm(stageRoot, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
    throw e;
  }
}

async function repairOne(baseId: string, artifactRoot: string, dryRun: boolean): Promise<{ repaired: boolean; issues: string[] }> {
  const rendered = await renderBase(baseId, artifactRoot);
  if (rendered.issues.length) {
    await rm(rendered.stageRoot, { recursive: true, force: true });
    await rm(rendered.backupRoot, { recursive: true, force: true });
    return { repaired: false, issues: rendered.issues };
  }
  if (dryRun) {
    await rm(rendered.stageRoot, { recursive: true, force: true });
    await rm(rendered.backupRoot, { recursive: true, force: true });
    return { repaired: false, issues: [] };
  }
  try {
    await replaceBase(baseId, artifactRoot, rendered.replacements, rendered.stageRoot, rendered.backupRoot);
    return { repaired: true, issues: [] };
  } catch (e) {
    return { repaired: false, issues: [`publication failed: ${(e as Error).message}`] };
  }
}

const { baseIds: requested, dryRun, includeOrphans } = parseArgs(process.argv.slice(2));
const root = join(dataDir(), "artifacts");
const ids = requested.length ? requested : await catalogBaseIds(root, includeOrphans);
let repaired = 0;
let failed = 0;
for (const baseId of ids) {
  const result = await repairOne(baseId, root, dryRun);
  if (result.issues.length) {
    failed++;
    console.log(`FAIL ${baseId}`);
    for (const issue of result.issues) console.log(`  - ${issue}`);
  } else if (result.repaired) {
    repaired++;
    console.log(`OK ${baseId}`);
  } else if (dryRun) {
    console.log(`CHECK ${baseId}`);
  }
}
console.log(`repair-artifacts: ${repaired} repaired, ${failed} failed, ${ids.length} scanned${dryRun ? " (dry run)" : ""}`);
if (failed) process.exitCode = 1;
