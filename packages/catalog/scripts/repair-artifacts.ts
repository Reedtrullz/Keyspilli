/**
 * Re-render stored MIDI/MusicXML artifacts from their canonical notes.json.
 *
 * This repair intentionally does not touch notes.json or database rows: the
 * serializers are the only source of truth being repaired. Each base is
 * staged as a complete six-level set and published through the same lock,
 * manifest-commit, and atomic swap protocol as ingestion and metadata edits.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LEVEL_ORDER, validateArtifactFiles, writeVariantArtifacts, type Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { dataDir } from "../src/paths.js";
import {
  createLegacyBootstrapManifest,
  parseArrangementManifest,
  writeArrangementManifestFile,
  type ArrangementManifest,
} from "../src/artifact-manifest.js";
import { publishBaseArtifact } from "../src/publish.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

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

interface RenderedBase {
  manifest: ArrangementManifest;
  issues: string[];
}

/**
 * Render one complete base into the caller-provided staging root. The caller
 * must publish that root through publishBaseArtifact; this function never
 * mutates the live artifact tree.
 */
async function renderBase(baseId: string, artifactRoot: string, stageRoot: string): Promise<RenderedBase> {
  const titleRow = getDb().prepare("SELECT title, artist FROM songs WHERE base_id = ? LIMIT 1").get(baseId) as
    | { title: string; artist: string }
    | undefined;
  const title = titleRow?.title ?? baseId;
  const artist = titleRow?.artist ?? "Unknown";
  const issues: string[] = [];
  await mkdir(stageRoot, { recursive: true });

  const manifestPath = join(artifactRoot, baseId, "manifest.json");
  let existingManifest: ArrangementManifest | undefined;
  if (existsSync(manifestPath)) {
    try {
      existingManifest = parseArrangementManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      if (existingManifest.baseId !== baseId) {
        issues.push(`manifest baseId ${existingManifest.baseId} does not match ${baseId}`);
      }
    } catch (e) {
      issues.push(`manifest.json is invalid (${(e as Error).message})`);
    }
  }

  const dbRows = getDb().prepare("SELECT tempo FROM songs WHERE base_id = ? ORDER BY difficulty_score").all(baseId) as { tempo: number }[];
  const variants: Array<{ level: string; code: string; dir: string; variant: Variant; notesJson: string }> = [];
  const tempos: number[] = [];
  for (const level of LEVEL_ORDER) {
    const code = LEVEL_CODE[level]!;
    const dir = join(artifactRoot, baseId, code);
    const notesPath = join(dir, "notes.json");
    let notesJson: string;
    let variant: Variant;
    try {
      notesJson = await readFile(notesPath, "utf8");
      variant = { ...(JSON.parse(notesJson) as Variant), level };
    } catch (e) {
      issues.push(`${level}: missing or invalid notes.json (${(e as Error).message})`);
      continue;
    }
    if (!Number.isFinite(variant.tempoBpm) || variant.tempoBpm < 20 || variant.tempoBpm > 300) {
      issues.push(`${level}: invalid tempoBpm ${String(variant.tempoBpm)}`);
    } else {
      tempos.push(variant.tempoBpm);
    }
    variants.push({ level, code, dir, variant, notesJson });
  }

  const allTemposAgree = tempos.length === LEVEL_ORDER.length && tempos.every((tempo) => tempo === tempos[0]);
  if (!allTemposAgree && tempos.length) issues.push("notes.json tempoBpm values disagree across levels");
  if (dbRows.length && tempos.length && dbRows.some((row) => row.tempo !== tempos[0])) {
    issues.push("database tempo disagrees with notes.json tempoBpm");
  }
  if (existingManifest && tempos.length && existingManifest.tempo.playback.bpm !== tempos[0]) {
    issues.push("manifest playback tempo disagrees with notes.json tempoBpm");
  }
  if (existingManifest && dbRows.length && dbRows.some((row) => row.tempo !== existingManifest!.tempo.playback.bpm)) {
    issues.push("database tempo disagrees with manifest playback tempo");
  }

  const bpm = tempos[0];
  const manifest: ArrangementManifest = existingManifest
    ? { ...existingManifest, artifactWrittenAt: new Date().toISOString() }
    : bpm === undefined
      ? createLegacyBootstrapManifest(baseId, 120)
      : createLegacyBootstrapManifest(baseId, bpm);

  if (!issues.length) {
    for (const item of variants) {
      let artifacts;
      try {
        artifacts = writeVariantArtifacts(item.variant, title, artist);
      } catch (e) {
        issues.push(`${item.level}: render failed (${(e as Error).message})`);
        continue;
      }
      const artifactIssues = validateArtifactFiles(item.variant, artifacts);
      if (artifactIssues.length) {
        issues.push(...artifactIssues.map((issue) => `${item.level}: ${issue}`));
        continue;
      }
      const stageDir = join(stageRoot, item.code);
      await mkdir(stageDir, { recursive: true });
      await Promise.all([
        writeFile(join(stageDir, "variant.mid"), artifacts.midi),
        writeFile(join(stageDir, "variant.xml"), artifacts.xml),
        // Repair must stage notes.json too: the base-tree swap is the unit of
        // publication, even though this command does not rewrite its bytes.
        writeFile(join(stageDir, "notes.json"), item.notesJson),
      ]);
    }
  }
  if (!issues.length) {
    // Commit marker is always the final staged file.
    await writeArrangementManifestFile(join(stageRoot, "manifest.json"), manifest);
  }
  return { manifest, issues };
}

async function repairOne(baseId: string, artifactRoot: string, dryRun: boolean): Promise<{ repaired: boolean; issues: string[] }> {
  if (dryRun) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const stageRoot = join(artifactRoot, `.${baseId}.repair-check-${token}`);
    try {
      const rendered = await renderBase(baseId, artifactRoot, stageRoot);
      return { repaired: false, issues: rendered.issues };
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  }
  try {
    await publishBaseArtifact(baseId, async (stageRoot) => {
      const rendered = await renderBase(baseId, artifactRoot, stageRoot);
      if (rendered.issues.length) throw new Error(rendered.issues.join("; "));
    }, { artifactsRoot: artifactRoot, semanticValidation: "strict" });
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
