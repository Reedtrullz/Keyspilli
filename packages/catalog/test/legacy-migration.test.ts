import { describe, expect, it } from "vitest";
import {
  buildVariants,
  parseMidi,
  writeMidi,
  writeVariantArtifacts,
  type Variant,
} from "@keyspilli/midi";
import { createLegacyBootstrapManifest } from "../src/artifact-manifest.js";
import {
  LEGACY_LEVEL_CODES,
  hashLegacyArtifactSet,
  inspectLegacyArtifact,
  legacyMigrationConfigFingerprint,
  type LegacyArtifactFile,
  type LegacyMigrationDbRow,
} from "../src/legacy-migration.js";

const NOW = "2026-08-16T18:45:00.000Z";

function fixture(): { artifacts: LegacyArtifactFile[]; dbRows: LegacyMigrationDbRow[] } {
  const source = writeMidi(
    Array.from({ length: 12 }, (_, index) => ({ midi: 60 + index, start: index * 0.5, dur: 0.5, vel: 80 })),
    { tempoBpm: 120 },
  );
  const variants = buildVariants(parseMidi(source), { title: "Legacy fixture", artist: "Keyspilli" });
  const byLevel = new Map(variants.map((variant) => [variant.level, variant]));
  const codeByLevel: Record<Variant["level"], string> = {
    advanced: "a",
    beginner: "b",
    easy: "e",
    medium: "m",
    "very-easy": "ve",
    "very-beginner": "vb",
  };
  const artifacts = LEGACY_LEVEL_CODES.map((code) => {
    const level = Object.entries(codeByLevel).find(([, candidate]) => candidate === code)?.[0] as Variant["level"];
    const variant = byLevel.get(level)!;
    const rendered = writeVariantArtifacts(variant, "Legacy fixture", "Keyspilli");
    return {
      code,
      notesJson: `${JSON.stringify({
        notes: variant.notes,
        warnings: variant.warnings,
        chords: variant.chords,
        measures: variant.measures,
        key: variant.key,
        tempoBpm: variant.tempoBpm,
        timeSig: variant.timeSig,
      })}\n`,
      midi: rendered.midi,
      xml: rendered.xml,
      variant,
    } satisfies LegacyArtifactFile;
  });
  const dbRows = LEGACY_LEVEL_CODES.map((level) => ({ id: `legacy-fixture-${level}`, level, tempo: 120 }));
  return { artifacts, dbRows };
}

describe("legacy artifact migration preflight", () => {
  it("bootstraps a missing manifest only after all six mirrors agree", () => {
    const input = fixture();
    const plan = inspectLegacyArtifact({ baseId: "legacy-fixture", ...input, now: NOW, maxDurBeats: null });
    expect(plan.status).toBe("migrate");
    if (plan.status !== "migrate") return;
    expect(plan.manifestAction).toBe("bootstrap-and-migrate");
    expect(plan.manifest.identityStatus).toBe("migrated");
    expect(plan.manifest.tempo.playback.bpm).toBe(120);
    expect(plan.sourceArtifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.configFingerprint).toBe(legacyMigrationConfigFingerprint(null));
  });

  it("produces a permutation-stable source hash", () => {
    const { artifacts } = fixture();
    expect(hashLegacyArtifactSet(artifacts)).toBe(hashLegacyArtifactSet([...artifacts].reverse()));
  });

  it("adopts an existing bootstrap manifest without inventing source provenance", () => {
    const input = fixture();
    const bootstrap = { ...createLegacyBootstrapManifest("legacy-fixture", 120, NOW), arrangementProfile: "learner" };
    const plan = inspectLegacyArtifact({ baseId: "legacy-fixture", ...input, manifest: bootstrap, now: "2026-08-16T19:00:00.000Z", maxDurBeats: null });
    expect(plan.status).toBe("migrate");
    if (plan.status !== "migrate") return;
    expect(plan.manifestAction).toBe("migrate-legacy-bootstrap");
    expect(plan.manifest.identityStatus).toBe("migrated");
    expect(plan.manifest.arrangementProfile).toBe("learner");
    expect(plan.manifest.tempo.playback.source).toBe("legacy");
    expect(plan.manifest.tempo.playback.resolvedAt).toBe(NOW);
  });

  it("fails closed on a tempo disagreement instead of choosing a winner", () => {
    const input = fixture();
    const rows = input.dbRows.map((row, index) => index === 0 ? { ...row, tempo: 121 } : row);
    const plan = inspectLegacyArtifact({ baseId: "legacy-fixture", artifacts: input.artifacts, dbRows: rows, now: NOW, maxDurBeats: null });
    expect(plan.status).toBe("invalid");
    if (plan.status !== "invalid") return;
    expect(plan.issues.some((issue) => issue.includes("tempo mirror mismatch"))).toBe(true);
  });

  it("does not rewrite an already current or migrated artifact", () => {
    const input = fixture();
    const bootstrap = createLegacyBootstrapManifest("legacy-fixture", 120, NOW);
    const current = {
      ...bootstrap,
      identityStatus: "current" as const,
      sourceArtifactHash: "a".repeat(64),
      configFingerprint: "b".repeat(64),
    };
    const plan = inspectLegacyArtifact({ baseId: "legacy-fixture", ...input, manifest: current, now: NOW, maxDurBeats: null });
    expect(plan).toMatchObject({ status: "already-migrated", identityStatus: "current" });
  });

  it("requires the complete six-level artifact and database shapes", () => {
    const input = fixture();
    const plan = inspectLegacyArtifact({
      baseId: "legacy-fixture",
      artifacts: input.artifacts.filter((file) => file.code !== "ve"),
      dbRows: input.dbRows.filter((row) => row.level !== "ve"),
      now: NOW,
      maxDurBeats: null,
    });
    expect(plan.status).toBe("invalid");
    if (plan.status !== "invalid") return;
    expect(plan.issues).toEqual(expect.arrayContaining([
      "missing artifact level ve",
      "database missing level ve",
    ]));
  });
});
