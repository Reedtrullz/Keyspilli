/**
 * Playability gate over stored artifacts. Run before shipping data/ to a
 * server, and in CI after the pipeline, so no broken song ever goes live.
 * Exits non-zero if any song fails.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER, validateArtifactFiles, validateVariants, Variant } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { MAX_YOUTUBE_IMPORT_DUR_BEATS } from "../src/ingest.js";
import { disabledManifestBases } from "../src/manifest.js";
import { dataDir } from "../src/paths.js";
import {
  readArrangementManifest,
  temposAgree,
  validateTempoProvenance,
  type IdentityStatus,
  type ArrangementManifest,
} from "../src/artifact-manifest.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};
const LEVEL_DIFFICULTY: Record<string, string> = Object.fromEntries(
  Object.entries(LEVEL_CODE).map(([difficulty, code]) => [code, difficulty]),
);

const cliArgs = process.argv.slice(2);
const repairMode = cliArgs.includes("--repair");
const requested = new Set(cliArgs.filter((arg) => !arg.startsWith("--")));

// Tempo repair is deliberately targeted.  A verifier run without an explicit
// base id remains read-only, and the operator must name every base whose
// denormalized SQLite tempo mirrors may be changed.
if (repairMode && requested.size === 0) {
  console.error("verify-catalog: --repair requires at least one base id");
  process.exitCode = 2;
  process.exit();
}

type ArtifactProvenance = {
  kind?: unknown;
  acquiredVia?: unknown;
  sourceRef?: unknown;
  sourceYoutubeUrl?: unknown;
  tempo?: unknown;
};

// Resolve through the shared data-dir helper so the same gate works both in
// the repository checkout and inside the production worker container, where
// KEYSPILLI_DATA_DIR=/data is mounted separately from the application code.
const artifactsRoot = join(dataDir(), "artifacts");
const db = getDb();
const disabledBases = disabledManifestBases();
// A targeted rebuild can verify only the base it touched; the default remains
// the fail-closed full-catalog gate used by CI and release checks.
const linkedRows = db
  .prepare("SELECT DISTINCT base_id AS baseId FROM songs WHERE base_id IS NOT NULL AND base_id <> ''")
  .all() as { baseId: string }[];
const allLinkedBases = linkedRows.map((row) => row.baseId).filter(Boolean).sort();
const linkedBases = requested.size ? allLinkedBases.filter((baseId) => requested.has(baseId)) : allLinkedBases;
const linkedSet = new Set(allLinkedBases);
const artifactEntries = await readdir(artifactsRoot, { withFileTypes: true }).catch(() => []);
const artifactBases = artifactEntries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && (!requested.size || requested.has(entry.name)))
  .map((entry) => entry.name)
  .sort();
const orphanBases = artifactBases.filter((baseId) => !linkedSet.has(baseId));
let failed = 0;
let warnings = 0;
let repaired = 0;
const manifestCounts: Record<IdentityStatus | "missing" | "invalid", number> = {
  "legacy-bootstrap": 0,
  current: 0,
  migrated: 0,
  missing: 0,
  invalid: 0,
};

// Artifact directories can outlive their database rows after a failed or
// interrupted rebuild. They are useful for cleanup diagnostics, but must not
// fail the release gate: only database-linked bases are public catalog rows.
for (const orphan of orphanBases) {
  console.log(`WARN orphan artifact directory ${orphan} (not linked from songs table)`);
}

for (const song of linkedBases) {
  const issues: string[] = [];
  const warns: string[] = [];
  const tempoMirrorIssues: string[] = [];
  const manifestRead = await readArrangementManifest(song);
  let manifest: ArrangementManifest | undefined;
  if (manifestRead.status === "missing") {
    manifestCounts.missing++;
    warns.push("artifact manifest is missing; legacy mode");
  } else if (manifestRead.status === "invalid") {
    manifestCounts.invalid++;
    issues.push(`invalid arrangement manifest: ${manifestRead.errors.join("; ")}`);
  } else {
    manifest = manifestRead.manifest;
    manifestCounts[manifest.identityStatus]++;
    if (manifest.baseId !== song) issues.push(`manifest base id ${manifest.baseId} differs from directory ${song}`);
  }
  if (disabledBases.has(song)) issues.push("base is disabled in the catalog manifest but still linked in the database");
  const dbRows = db
    .prepare("SELECT id, level, difficulty, tempo, content_type, acquired_via, source_youtube_url FROM songs WHERE base_id = ? ORDER BY level, id")
    .all(song) as Array<{
    id: string;
    level: string;
    difficulty: string;
    tempo: number;
    content_type?: string;
    acquired_via?: string | null;
    source_youtube_url?: string | null;
  }>;
  const expectedLevels = LEVEL_ORDER.map((level) => LEVEL_CODE[level]!);
  const levelCounts = new Map<string, number>();
  for (const dbRow of dbRows) levelCounts.set(dbRow.level, (levelCounts.get(dbRow.level) ?? 0) + 1);
  const missingLevels = expectedLevels.filter((level) => !levelCounts.has(level));
  const duplicateLevels = expectedLevels.filter((level) => (levelCounts.get(level) ?? 0) > 1);
  const unexpectedLevels = [...levelCounts.keys()].filter((level) => !expectedLevels.includes(level));
  // The artifact tree is published alongside a six-row read model. Checking
  // only notes.json lets a partial SQLite replacement (or a duplicate level)
  // pass while the API serves missing or stale difficulty rows. Keep this
  // check here, next to the artifact checks, so CI and production rebuilds
  // share the same fail-closed integrity gate.
  if (dbRows.length !== expectedLevels.length) {
    issues.push(`database has ${dbRows.length} rows; expected ${expectedLevels.length}`);
  }
  if (missingLevels.length) issues.push(`database missing levels: ${missingLevels.join(", ")}`);
  if (duplicateLevels.length) issues.push(`database has duplicate levels: ${duplicateLevels.join(", ")}`);
  if (unexpectedLevels.length) issues.push(`database has unexpected levels: ${unexpectedLevels.join(", ")}`);
  for (const dbRow of dbRows) {
    if (expectedLevels.includes(dbRow.level) && dbRow.id !== `${song}-${dbRow.level}`) {
      issues.push(`database row ${dbRow.level} has unexpected id ${dbRow.id}`);
    }
    if (expectedLevels.includes(dbRow.level) && dbRow.difficulty !== LEVEL_DIFFICULTY[dbRow.level]) {
      issues.push(`database row ${dbRow.level} has unexpected difficulty ${dbRow.difficulty}`);
    }
    if (expectedLevels.includes(dbRow.level)) {
      if (typeof dbRow.content_type !== "string" || dbRow.content_type.trim() === "") {
        issues.push(`database row ${dbRow.level} is missing content_type metadata`);
      }
      const dbTempo = Number(dbRow.tempo);
      if (!Number.isFinite(dbTempo) || dbTempo < 20 || dbTempo > 300) {
        issues.push(`database row ${dbRow.level} has invalid tempo metadata ${String(dbRow.tempo)}`);
      }
    }
  }
  const contentTypes = new Set(dbRows.map((dbRow) => dbRow.content_type ?? null));
  const acquiredVia = new Set(dbRows.map((dbRow) => dbRow.acquired_via ?? null));
  const sourceYoutubeUrls = new Set(dbRows.map((dbRow) => dbRow.source_youtube_url ?? null));
  if (contentTypes.size > 1) issues.push("database variants disagree on content type");
  if (acquiredVia.size > 1) issues.push("database variants disagree on acquired_via provenance");
  if (sourceYoutubeUrls.size > 1) issues.push("database variants disagree on source_youtube_url provenance");
  const row = dbRows[0] as { content_type?: string } | undefined;
  // Match ingestSource's source-aware sustain policy. Human-authored standard
  // and upload arrangements may contain intentional multi-measure holds;
  // YouTube/audio imports must satisfy the explicit tail ceiling.
  const maxDurBeats = row?.content_type === "youtube" ? MAX_YOUTUBE_IMPORT_DUR_BEATS : null;
  const variants: Variant[] = [];
  for (const level of LEVEL_ORDER) {
    const path = join(artifactsRoot, song, LEVEL_CODE[level]!, "notes.json");
    try {
      const v = JSON.parse(await readFile(path, "utf8")) as Variant;
      variants.push({ ...v, level });
    } catch {
      issues.push(`${level}: missing or invalid notes.json`);
    }
  }
  // Validate the complete artifact set independently of database tempo
  // mirrors. In repair mode a stale DB tempo is the one permitted defect; it
  // must never short-circuit MIDI/XML or variant validation.
  if (variants.length === expectedLevels.length) {
    issues.push(...validateVariants(variants, { maxDurBeats }));
    for (const v of variants) {
      const code = LEVEL_CODE[v.level]!;
      const dbRow = dbRows.find((candidate) => candidate.level === code);
      if (dbRow && Math.abs(Number(dbRow.tempo) - Number(v.tempoBpm)) > 1e-6) {
        tempoMirrorIssues.push(`${v.level}: database tempo ${dbRow.tempo} differs from artifact tempo ${v.tempoBpm}`);
      }
      if (manifest && Math.abs(manifest.tempo.playback.bpm - Number(v.tempoBpm)) > 1e-6) {
        issues.push(`${v.level}: manifest playback tempo ${manifest.tempo.playback.bpm} differs from artifact tempo ${v.tempoBpm}`);
      }
      const provenance = (v as Variant & { provenance?: ArtifactProvenance }).provenance;
      if (!provenance || typeof provenance !== "object" || typeof provenance.kind !== "string") {
        issues.push(`${v.level}: artifact provenance is missing or malformed`);
      } else if (dbRow) {
        const dbAcquiredVia = dbRow.acquired_via ?? null;
        const dbSourceYoutubeUrl = dbRow.source_youtube_url ?? null;
        if (provenance.kind !== dbRow.content_type) {
          issues.push(`${v.level}: artifact provenance kind ${String(provenance.kind)} differs from database content type ${dbRow.content_type}`);
        }
        if ((provenance.acquiredVia ?? null) !== dbAcquiredVia) {
          issues.push(`${v.level}: artifact acquiredVia provenance differs from database`);
        }
        if ((provenance.sourceYoutubeUrl ?? null) !== dbSourceYoutubeUrl) {
          issues.push(`${v.level}: artifact sourceYoutubeUrl provenance differs from database`);
        }
        if (provenance.sourceRef !== null && typeof provenance.sourceRef !== "string") {
          issues.push(`${v.level}: artifact sourceRef provenance is malformed`);
        }
      }
      // Legacy notes.json may omit the diagnostic tempo copy. If present,
      // validate it and ensure its playback mirror agrees with the canonical
      // notes tempo; the manifest remains the runtime authority.
      if (provenance && typeof provenance === "object" && provenance.tempo !== undefined) {
        const tempoErrors = validateTempoProvenance(provenance.tempo, `${v.level}.provenance.tempo`);
        issues.push(...tempoErrors);
        if (!tempoErrors.length) {
          const tempo = provenance.tempo as { playback: { bpm: number } };
          if (!temposAgree(tempo.playback.bpm, v.tempoBpm)) {
            issues.push(`${v.level}: artifact provenance playback tempo ${tempo.playback.bpm} differs from notes.json tempo ${v.tempoBpm}`);
          }
        }
      }
      try {
        const midi = new Uint8Array(await readFile(join(artifactsRoot, song, code, "variant.mid")));
        const xml = await readFile(join(artifactsRoot, song, code, "variant.xml"), "utf8");
        for (const issue of validateArtifactFiles(v, { midi, xml })) issues.push(`${v.level}: ${issue}`);
      } catch (e) {
        issues.push(`${v.level}: artifact missing or invalid: ${(e as Error).message}`);
      }
    }
  }

  // A valid manifest is required for repair: notes.json is a mirror, not an
  // authority. The normal verifier still supports legacy read-only mode, but
  // --repair must fail closed rather than bootstrap from an arbitrary level.
  if (repairMode && tempoMirrorIssues.length && manifestRead.status !== "valid") {
    issues.push("tempo repair requires a valid arrangement manifest");
  }

  if (tempoMirrorIssues.length && (!repairMode || issues.length > 0)) {
    issues.push(...tempoMirrorIssues);
  }

  if (repairMode && tempoMirrorIssues.length && issues.length === 0 && manifest) {
    const targetTempo = manifest.tempo.playback.bpm;
    try {
      const updated = db.transaction(() => {
        // Re-check the complete six-row shape inside the write transaction.
        // No rows are synthesized, and a concurrent/partial read-model
        // change aborts the repair instead of updating a subset.
        const currentRows = db
          .prepare("SELECT level, tempo FROM songs WHERE base_id = ? ORDER BY level, id")
          .all(song) as Array<{ level: string; tempo: unknown }>;
        const currentLevels = currentRows.map((row) => row.level);
        const expectedSet = new Set(expectedLevels);
        if (currentRows.length !== expectedLevels.length || currentLevels.some((level) => !expectedSet.has(level)) || new Set(currentLevels).size !== expectedLevels.length) {
          throw new Error("database row set changed during tempo repair; refusing partial update");
        }
        db.prepare("UPDATE songs SET tempo = ? WHERE base_id = ?").run(targetTempo, song);
        const afterRows = db
          .prepare("SELECT level, tempo FROM songs WHERE base_id = ? ORDER BY level, id")
          .all(song) as Array<{ level: string; tempo: unknown }>;
        if (afterRows.length !== expectedLevels.length || afterRows.some((row) => Number(row.tempo) !== targetTempo)) {
          throw new Error("database tempo repair did not produce six matching mirrors");
        }
        return currentRows.some((row) => Number(row.tempo) !== targetTempo);
      })();
      if (updated) {
        repaired++;
        console.log(`REPAIRED ${song}: database tempo mirrors -> ${targetTempo} BPM from manifest`);
      }
    } catch (error) {
      issues.push(`tempo repair failed: ${(error as Error).message}`);
    }
  }
  // Data-level quality checks for AI-transcribed songs: warnings, not gate
  // failures, because they are fixable by re-ingest rather than a code change.
  const dataLevel = row?.content_type === "youtube" || row?.content_type === "upload";
  if (dataLevel && issues.length === 0) {
    const long = variants.filter((v) => v.notes.some((n) => n.dur > 8)).map((v) => v.level);
    if (long.length) warns.push(`note > 8 beats in ${long.join(", ")}`);
    const a = variants.find((v) => v.level === "advanced");
    const m = variants.find((v) => v.level === "medium");
    if (a && m && a.notes.length === m.notes.length) warns.push("advanced and medium note counts equal");
    if (variants.some((v) => v.tempoBpm < 20 || v.tempoBpm > 300)) warns.push("tempo outside 20-300 BPM");
  }
  if (issues.length) {
    failed++;
    console.log(`FAIL ${song}`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }
  if (warns.length) {
    warnings += warns.length;
    console.log(`WARN ${song}`);
    for (const w of warns) console.log(`  - ${w}`);
  }
}

const orphanSuffix = orphanBases.length ? `, ${orphanBases.length} orphan artifact dirs ignored` : "";
const manifestSummary = Object.entries(manifestCounts)
  .filter(([, count]) => count > 0)
  .map(([status, count]) => `${status}=${count}`)
  .join(", ");
console.log(`verify-catalog: ${failed} of ${linkedBases.length} songs failed, ${warnings} data warnings, ${repaired} tempo mirror sets repaired${orphanSuffix}`);
console.log(`verify-catalog manifests: ${manifestSummary || "none"}`);
if (failed) process.exitCode = 1;
