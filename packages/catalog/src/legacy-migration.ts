import { createHash } from "node:crypto";
import {
  validateArtifactFiles,
  validateVariants,
  type DifficultyLevel,
  type Variant,
} from "@keyspilli/midi";
import {
  ARRANGEMENT_MANIFEST_SCHEMA_VERSION,
  parseArrangementManifest,
  temposAgree,
  type ArrangementManifest,
  type TempoSource,
} from "./artifact-manifest.js";

/**
 * Migration is deliberately a separate identity from ingestion. A migrated
 * artifact is still legacy material; this identifier records the exact
 * validation/identity policy that was used to adopt it into the manifest
 * contract without pretending that the original source bytes are available.
 */
export const LEGACY_MIGRATION_PIPELINE_ID = "legacy-artifact-migration-v1";
export const LEGACY_MIGRATION_HASH_ALGORITHM = "sha256";

export const LEGACY_LEVEL_CODES = ["a", "b", "e", "m", "ve", "vb"] as const;
export const LEGACY_REQUIRED_FILES = ["notes.json", "variant.mid", "variant.xml"] as const;

const LEVEL_BY_CODE: Record<string, DifficultyLevel> = {
  a: "advanced",
  b: "beginner",
  e: "easy",
  m: "medium",
  ve: "very-easy",
  vb: "very-beginner",
};

export interface LegacyArtifactFile {
  code: string;
  notesJson: string;
  midi: Uint8Array;
  xml: string;
  /** Undefined means notes.json could not be parsed into a Variant. */
  variant?: Variant;
  parseError?: string;
}

export interface LegacyMigrationDbRow {
  id?: string;
  level: string;
  tempo: unknown;
}

export interface LegacyMigrationInput {
  baseId: string;
  artifacts: readonly LegacyArtifactFile[];
  dbRows: readonly LegacyMigrationDbRow[];
  /** Null means manifest.json is absent; invalid manifests are reported separately. */
  manifest?: ArrangementManifest | null;
  manifestError?: string;
  /** Same source-aware sustain policy used by verify-catalog. */
  maxDurBeats?: number | null;
  now?: string;
}

export type LegacyMigrationPlan =
  | {
      status: "migrate";
      baseId: string;
      manifestAction: "bootstrap-and-migrate" | "migrate-legacy-bootstrap";
      manifest: ArrangementManifest;
      artifacts: LegacyArtifactFile[];
      sourceArtifactHash: string;
      configFingerprint: string;
      issues: [];
    }
  | {
      status: "already-migrated";
      baseId: string;
      identityStatus: "current" | "migrated";
      manifest: ArrangementManifest;
      artifacts: LegacyArtifactFile[];
      issues: [];
    }
  | {
      status: "invalid";
      baseId: string;
      artifacts: LegacyArtifactFile[];
      issues: string[];
    };

function isFiniteBpm(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 20 && value <= 300;
}

function canonicalFileBytes(file: LegacyArtifactFile, name: string): Uint8Array {
  if (name === "notes.json") return new TextEncoder().encode(file.notesJson);
  if (name === "variant.mid") return file.midi;
  return new TextEncoder().encode(file.xml);
}

/**
 * Hash the complete pre-manifest artifact set in a stable order. The manifest
 * itself is excluded intentionally: it is the migration output, not evidence
 * of the legacy source. File names and lengths are included to avoid an
 * ambiguous concatenation hash.
 */
export function hashLegacyArtifactSet(artifacts: readonly LegacyArtifactFile[]): string {
  const digest = createHash(LEGACY_MIGRATION_HASH_ALGORITHM);
  const byCode = [...artifacts].sort((left, right) => left.code.localeCompare(right.code));
  for (const file of byCode) {
    for (const name of LEGACY_REQUIRED_FILES) {
      const path = `${file.code}/${name}`;
      const bytes = canonicalFileBytes(file, name);
      digest.update(path, "utf8");
      digest.update("\0", "utf8");
      digest.update(String(bytes.byteLength), "utf8");
      digest.update("\0", "utf8");
      digest.update(bytes);
      digest.update("\0", "utf8");
    }
  }
  return digest.digest("hex");
}

/**
 * Hash the migration policy, not the artifact content. Keeping this separate
 * from sourceArtifactHash makes a future policy bump auditable without
 * claiming that a legacy artifact has an original transcription fingerprint.
 */
export function legacyMigrationConfigFingerprint(maxDurBeats: number | null | undefined): string {
  return createHash(LEGACY_MIGRATION_HASH_ALGORITHM)
    .update(JSON.stringify({
      pipeline: LEGACY_MIGRATION_PIPELINE_ID,
      schemaVersion: ARRANGEMENT_MANIFEST_SCHEMA_VERSION,
      hashAlgorithm: LEGACY_MIGRATION_HASH_ALGORITHM,
      requiredLevels: LEGACY_LEVEL_CODES,
      requiredFiles: LEGACY_REQUIRED_FILES,
      tempoPolicy: "all-notes-midi-xml-db-mirrors-must-agree",
      maxDurBeats: maxDurBeats ?? null,
    }))
    .digest("hex");
}

function sourceForMigration(manifest: ArrangementManifest | null | undefined): TempoSource {
  // Preserve a trustworthy source label from a bootstrap manifest. A missing
  // manifest has no trustworthy detection provenance, so `legacy` is explicit
  // rather than inventing `midi-meta` or `detected`.
  return manifest?.tempo.playback.source ?? "legacy";
}

function resolvedAtForMigration(manifest: ArrangementManifest | null | undefined, now: string): string {
  return manifest?.tempo.playback.resolvedAt ?? now;
}

/** Build the manifest written by an explicit migration after all checks pass. */
export function buildMigratedManifest(input: {
  baseId: string;
  bpm: number;
  sourceArtifactHash: string;
  configFingerprint: string;
  now: string;
  existingManifest?: ArrangementManifest | null;
}): ArrangementManifest {
  const existing = input.existingManifest ?? undefined;
  const source = sourceForMigration(existing);
  const resolvedAt = resolvedAtForMigration(existing, input.now);
  const manifest: ArrangementManifest = {
    schemaVersion: ARRANGEMENT_MANIFEST_SCHEMA_VERSION,
    baseId: input.baseId,
    identityStatus: "migrated",
    sourceArtifactHash: input.sourceArtifactHash,
    configFingerprint: input.configFingerprint,
    ...(existing?.arrangementProfile ? { arrangementProfile: existing.arrangementProfile } : {}),
    tempo: {
      calibration: { bpm: input.bpm, source, resolvedAt, role: "source-calibration" },
      playback: { bpm: input.bpm, source, resolvedAt, role: "playback" },
    },
    ...(existing?.transcription ? { transcription: existing.transcription } : {}),
    artifactWrittenAt: input.now,
  };
  return parseArrangementManifest(manifest);
}

function pushTempo(tempos: Array<{ label: string; value: unknown }>, label: string, value: unknown): void {
  // Keep invalid mirrors in the set so the preflight reports the exact field
  // instead of accidentally treating a malformed value as an absent mirror.
  tempos.push({ label, value });
}

function assertTempoAgreement(tempos: readonly { label: string; value: unknown }[], issues: string[]): number | undefined {
  if (!tempos.length) return undefined;
  const invalid = tempos.filter((tempo) => !isFiniteBpm(tempo.value));
  for (const tempo of invalid) issues.push(`${tempo.label} tempo must be between 20 and 300 BPM`);
  const first = tempos.find((tempo) => isFiniteBpm(tempo.value));
  if (!first || !isFiniteBpm(first.value)) return undefined;
  for (const tempo of tempos) {
    if (isFiniteBpm(tempo.value) && !temposAgree(first.value, tempo.value)) {
      issues.push(`tempo mirror mismatch: ${first.label}=${first.value}, ${tempo.label}=${tempo.value}`);
    }
  }
  return first.value;
}

function expectedCodeSet(): Set<string> {
  return new Set<string>(LEGACY_LEVEL_CODES);
}

function validateArtifactShape(input: LegacyMigrationInput, issues: string[]): Map<string, LegacyArtifactFile> {
  const byCode = new Map<string, LegacyArtifactFile>();
  for (const file of input.artifacts) {
    if (byCode.has(file.code)) issues.push(`duplicate artifact level ${file.code}`);
    byCode.set(file.code, file);
  }
  const expected = expectedCodeSet();
  for (const code of LEGACY_LEVEL_CODES) {
    const file = byCode.get(code);
    if (!file) {
      issues.push(`missing artifact level ${code}`);
      continue;
    }
    if (file.parseError) issues.push(`${code}: invalid notes.json (${file.parseError})`);
    if (!file.variant) issues.push(`${code}: notes.json did not produce a variant`);
  }
  for (const code of byCode.keys()) {
    if (!expected.has(code)) issues.push(`unexpected artifact level ${code}`);
  }
  return byCode;
}

function validateDbShape(baseId: string, rows: readonly LegacyMigrationDbRow[], issues: string[]): void {
  const expected = expectedCodeSet();
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
    if (row.id !== undefined && row.id !== `${baseId}-${row.level}`) {
      issues.push(`database row ${row.level} has unexpected id ${row.id}`);
    }
  }
  for (const code of LEGACY_LEVEL_CODES) {
    if (!counts.has(code)) issues.push(`database missing level ${code}`);
    else if (counts.get(code) !== 1) issues.push(`database has duplicate level ${code}`);
  }
  for (const code of counts.keys()) {
    if (!expected.has(code)) issues.push(`database has unexpected level ${code}`);
  }
}

/**
 * Pure preflight for one base. No filesystem or database access occurs here.
 * It is intentionally strict: migration is identity adoption, so it must not
 * repair tempo, regenerate files, or silently choose one conflicting mirror.
 */
export function inspectLegacyArtifact(input: LegacyMigrationInput): LegacyMigrationPlan {
  const issues: string[] = [];
  const artifacts = [...input.artifacts];
  const manifest = input.manifest ?? null;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(input.baseId)) issues.push(`invalid base id ${input.baseId}`);
  if (input.manifestError) issues.push(input.manifestError);
  const byCode = validateArtifactShape(input, issues);
  validateDbShape(input.baseId, input.dbRows, issues);

  const variants: Variant[] = [];
  const tempos: Array<{ label: string; value: unknown }> = [];
  for (const code of LEGACY_LEVEL_CODES) {
    const file = byCode.get(code);
    if (!file?.variant) continue;
    const level = LEVEL_BY_CODE[code];
    if (!level) continue;
    const variant = { ...file.variant, level };
    variants.push(variant);
    pushTempo(tempos, `${code}/notes.json`, variant.tempoBpm);
    for (const issue of validateArtifactFiles(variant, { midi: file.midi, xml: file.xml })) {
      issues.push(`${code}: ${issue}`);
    }
  }

  const contentTypeRows = input.dbRows as Array<LegacyMigrationDbRow & { contentType?: unknown }>;
  const contentTypes = new Set(contentTypeRows.map((row) => row.contentType).filter((value) => typeof value === "string"));
  if (contentTypes.size > 1) issues.push("database variants disagree on content type");
  const maxDurBeats = input.maxDurBeats;
  if (variants.length === LEGACY_LEVEL_CODES.length) {
    issues.push(...validateVariants(variants, { maxDurBeats }));
  }
  for (const row of input.dbRows) pushTempo(tempos, `database/${row.level}`, row.tempo);

  let bpm: number | undefined = assertTempoAgreement(tempos, issues);
  if (manifest) {
    pushTempo(tempos, "manifest/calibration", manifest.tempo.calibration.bpm);
    pushTempo(tempos, "manifest/playback", manifest.tempo.playback.bpm);
    // Re-run after adding the manifest mirrors so a valid-looking bootstrap
    // cannot be migrated while disagreeing with the artifact tree.
    bpm = assertTempoAgreement(tempos, issues);
  }
  if (bpm === undefined) issues.push("no agreed BPM available for migration");

  if (issues.length) return { status: "invalid", baseId: input.baseId, artifacts, issues };

  // The issue check above guarantees an agreed finite BPM. Keep this guard
  // explicit so the pure planner remains type-safe if its validation changes.
  if (bpm === undefined) return { status: "invalid", baseId: input.baseId, artifacts, issues: ["no agreed BPM available for migration"] };

  if (manifest && (manifest.identityStatus === "current" || manifest.identityStatus === "migrated")) {
    return {
      status: "already-migrated",
      baseId: input.baseId,
      identityStatus: manifest.identityStatus,
      manifest,
      artifacts,
      issues: [],
    };
  }

  const sourceArtifactHash = hashLegacyArtifactSet(artifacts);
  const configFingerprint = legacyMigrationConfigFingerprint(maxDurBeats);
  const now = input.now ?? new Date().toISOString();
  const migrated = buildMigratedManifest({
    baseId: input.baseId,
    bpm,
    sourceArtifactHash,
    configFingerprint,
    now,
    existingManifest: manifest,
  });
  return {
    status: "migrate",
    baseId: input.baseId,
    manifestAction: manifest ? "migrate-legacy-bootstrap" : "bootstrap-and-migrate",
    manifest: migrated,
    artifacts,
    sourceArtifactHash,
    configFingerprint,
    issues: [],
  };
}
