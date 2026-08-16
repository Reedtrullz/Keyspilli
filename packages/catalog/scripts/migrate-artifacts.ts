/**
 * Explicitly adopt legacy artifact trees into the arrangement-manifest
 * contract.
 *
 * This command is intentionally never part of ingest, startup, or repair.
 * It defaults to a read-only preflight. Pass --write after reviewing the
 * complete report, and pass either one or more --base-id values or the
 * explicit --all switch. A missing manifest is accepted only when all six
 * notes/MIDI/XML/database tempo mirrors agree; no tempo or score data is
 * repaired by this command.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DifficultyLevel, type Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { dataDir } from "../src/paths.js";
import {
  readArrangementManifest,
  writeArrangementManifestFile,
} from "../src/artifact-manifest.js";
import {
  LEGACY_LEVEL_CODES,
  inspectLegacyArtifact,
  type LegacyArtifactFile,
  type LegacyMigrationDbRow,
  type LegacyMigrationPlan,
} from "../src/legacy-migration.js";
import { publishBaseArtifact } from "../src/publish.js";
import { MAX_YOUTUBE_IMPORT_DUR_BEATS } from "../src/ingest.js";

const LEVEL_CODE: Record<DifficultyLevel, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

const LEVEL_BY_CODE: Record<string, DifficultyLevel> = Object.fromEntries(
  Object.entries(LEVEL_CODE).map(([level, code]) => [code, level]),
) as Record<string, DifficultyLevel>;
const BASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

interface CliOptions {
  baseIds: string[];
  all: boolean;
  dryRun: boolean;
}

interface LoadedBase {
  artifacts: LegacyArtifactFile[];
  dbRows: Array<LegacyMigrationDbRow & { contentType?: unknown }>;
  manifest: Awaited<ReturnType<typeof readArrangementManifest>>;
  maxDurBeats: number | null;
}

type MigratablePlan = Extract<LegacyMigrationPlan, { status: "migrate" }>;

function usage(): string {
  return [
    "Usage: tsx scripts/migrate-artifacts.ts --base-id <id> [--base-id <id> ...] [--dry-run|--write]",
    "       tsx scripts/migrate-artifacts.ts --all [--dry-run|--write]",
    "",
    "Default is --dry-run. --write is required to publish migrated manifests.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const baseIds: string[] = [];
  let all = false;
  let write = false;
  let dryRun = true;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--base-id") {
      const id = argv[++index];
      if (!id) throw new Error("--base-id requires a value");
      baseIds.push(id);
    } else if (arg.startsWith("--base-id=")) {
      const id = arg.slice("--base-id=".length);
      if (!id) throw new Error("--base-id requires a value");
      baseIds.push(id);
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--write") {
      if (!dryRun && write) throw new Error("--write specified more than once");
      write = true;
      dryRun = false;
    } else if (arg === "--dry-run") {
      if (write) throw new Error("--dry-run cannot be combined with --write");
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (all && baseIds.length) throw new Error("--all cannot be combined with --base-id");
  if (!all && !baseIds.length) throw new Error("migration requires one or more --base-id values or explicit --all");
  return { baseIds: [...new Set(baseIds)], all, dryRun };
}

async function readLegacyArtifactFiles(root: string, baseId: string): Promise<LegacyArtifactFile[]> {
  const files: LegacyArtifactFile[] = [];
  for (const code of LEGACY_LEVEL_CODES) {
    const dir = join(root, baseId, code);
    const missing: string[] = [];
    let notesJson = "";
    let midi = new Uint8Array();
    let xml = "";
    try {
      notesJson = await readFile(join(dir, "notes.json"), "utf8");
    } catch (error) {
      missing.push(`notes.json: ${(error as Error).message}`);
    }
    try {
      midi = new Uint8Array(await readFile(join(dir, "variant.mid")));
    } catch (error) {
      missing.push(`variant.mid: ${(error as Error).message}`);
    }
    try {
      xml = await readFile(join(dir, "variant.xml"), "utf8");
    } catch (error) {
      missing.push(`variant.xml: ${(error as Error).message}`);
    }

    let variant: Variant | undefined;
    let parseError: string | undefined;
    if (!missing.some((issue) => issue.startsWith("notes.json:"))) {
      try {
        const parsed = JSON.parse(notesJson) as Variant;
        const level = LEVEL_BY_CODE[code];
        if (!level) throw new Error(`unknown level code ${code}`);
        variant = { ...parsed, level };
      } catch (error) {
        parseError = (error as Error).message;
      }
    }
    if (missing.length) parseError = [parseError, ...missing].filter(Boolean).join("; ");
    files.push({ code, notesJson, midi, xml, ...(variant ? { variant } : {}), ...(parseError ? { parseError } : {}) });
  }
  return files;
}

async function loadBase(baseId: string, root: string): Promise<LoadedBase> {
  const db = getDb();
  const dbRows = db
    .prepare("SELECT id, level, tempo, content_type AS contentType FROM songs WHERE base_id = ? ORDER BY level, id")
    .all(baseId) as Array<LegacyMigrationDbRow & { contentType?: unknown }>;
  const contentType = typeof dbRows[0]?.contentType === "string" ? dbRows[0].contentType : undefined;
  const maxDurBeats = contentType === "youtube" ? MAX_YOUTUBE_IMPORT_DUR_BEATS : null;
  const manifest = await readArrangementManifest(baseId, root);
  const artifacts = await readLegacyArtifactFiles(join(root, "artifacts"), baseId);
  return { artifacts, dbRows, manifest, maxDurBeats };
}

function manifestInput(loaded: LoadedBase): Pick<Parameters<typeof inspectLegacyArtifact>[0], "manifest" | "manifestError"> {
  if (loaded.manifest.status === "valid") return { manifest: loaded.manifest.manifest };
  if (loaded.manifest.status === "missing") return { manifest: null };
  return { manifest: null, manifestError: `invalid arrangement manifest: ${loaded.manifest.errors.join("; ")}` };
}

function inspectLoadedBase(baseId: string, loaded: LoadedBase, now?: string): LegacyMigrationPlan {
  return inspectLegacyArtifact({
    baseId,
    artifacts: loaded.artifacts,
    dbRows: loaded.dbRows,
    ...manifestInput(loaded),
    maxDurBeats: loaded.maxDurBeats,
    ...(now ? { now } : {}),
  });
}

async function publishMigratedBase(baseId: string, root: string): Promise<MigratablePlan> {
  let published: MigratablePlan | undefined;
  await publishBaseArtifact(baseId, async (stageRoot) => {
    // Re-read and re-validate after the per-base lock is acquired. A dry-run
    // report is advisory; it must not authorize a write after the source set
    // or DB mirrors changed underneath the operator.
    const loaded = await loadBase(baseId, root);
    const plan = inspectLoadedBase(baseId, loaded);
    if (plan.status !== "migrate") {
      throw new Error(plan.status === "invalid" ? plan.issues.join("; ") : `artifact is already ${plan.identityStatus}`);
    }
    published = plan;
    for (const file of plan.artifacts) {
      const dir = join(stageRoot, file.code);
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(join(dir, "notes.json"), file.notesJson, "utf8"),
        writeFile(join(dir, "variant.mid"), file.midi),
        writeFile(join(dir, "variant.xml"), file.xml, "utf8"),
      ]);
    }
    // The manifest is the commit marker and is intentionally written last.
    await writeArrangementManifestFile(join(stageRoot, "manifest.json"), plan.manifest);
  }, {
    artifactsRoot: join(root, "artifacts"),
    semanticValidation: "strict",
  });
  if (!published) throw new Error("migration publisher completed without a plan");
  return published;
}

async function listCatalogBaseIds(): Promise<string[]> {
  const rows = getDb().prepare("SELECT DISTINCT base_id AS baseId FROM songs WHERE base_id IS NOT NULL AND base_id <> ''").all() as { baseId: string }[];
  return rows.map((row) => row.baseId).filter(Boolean).sort();
}

async function migrateOne(baseId: string, root: string, dryRun: boolean): Promise<"checked" | "migrated" | "skipped" | "failed"> {
  if (!BASE_ID_RE.test(baseId)) {
    console.log(`FAIL ${baseId}`);
    console.log("  - invalid base id");
    return "failed";
  }
  const loaded = await loadBase(baseId, root);
  const plan = inspectLoadedBase(baseId, loaded);
  if (plan.status === "invalid") {
    console.log(`FAIL ${baseId}`);
    for (const issue of plan.issues) console.log(`  - ${issue}`);
    return "failed";
  }
  if (plan.status === "already-migrated") {
    console.log(`SKIP ${baseId}: identityStatus=${plan.identityStatus}`);
    return "skipped";
  }
  if (dryRun) {
    console.log(`CHECK ${baseId}: ${plan.manifestAction} -> identityStatus=migrated`);
    console.log(`  - sourceArtifactHash=${plan.sourceArtifactHash}`);
    console.log(`  - configFingerprint=${plan.configFingerprint}`);
    return "checked";
  }
  try {
    const published = await publishMigratedBase(baseId, root);
    console.log(`MIGRATED ${baseId}: ${published.manifestAction} -> identityStatus=migrated`);
    console.log(`  - sourceArtifactHash=${published.sourceArtifactHash}`);
    console.log(`  - configFingerprint=${published.configFingerprint}`);
    return "migrated";
  } catch (error) {
    console.log(`FAIL ${baseId}`);
    console.log(`  - publication failed: ${(error as Error).message}`);
    return "failed";
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`migrate-artifacts: ${(error as Error).message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const root = dataDir();
  const ids = options.all ? await listCatalogBaseIds() : options.baseIds;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const baseId of ids) {
    const result = await migrateOne(baseId, root, options.dryRun);
    if (result === "migrated") migrated++;
    else if (result === "skipped") skipped++;
    else if (result === "failed") failed++;
  }
  console.log(`migrate-artifacts: ${migrated} migrated, ${skipped} already migrated, ${failed} failed, ${ids.length} scanned${options.dryRun ? " (dry run; no writes)" : ""}`);
  if (failed) process.exitCode = 1;
}

await main();
