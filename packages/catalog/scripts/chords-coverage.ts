/** Read-only inventory for the Advanced source behind every visible Chords song. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Base = { baseId: string; acquiredVia: string | null };

type CoverageRow = {
  baseId: string;
  acquiredVia: string | null;
  notesSha256: string;
  noteCount: number;
  chordCount: number;
  chordSourceKinds: string[];
  timeSig: unknown;
  roleNoteCount: number;
  laneNoteCount: number;
  measureCount: number;
  meterEventCount: number;
  generatedOnly: boolean;
};

export function scanBackingCoverage(bases: readonly Base[], hidden: ReadonlySet<string>, artifactRoot: string) {
  const ids = new Set(bases.map((base) => base.baseId));
  const artifactIds = readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(artifactRoot, entry.name, "a", "notes.json")))
    .map((entry) => entry.name);
  const rows: CoverageRow[] = bases.filter((base) => !hidden.has(base.baseId)).map(({ baseId, acquiredVia }) => {
    const path = join(artifactRoot, baseId, "a", "notes.json");
    const bytes = readFileSync(path);
    const data = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (!Array.isArray(data.notes) || !Array.isArray(data.chords) || !Array.isArray(data.measures)) {
      throw new Error(`${baseId}: Advanced notes.json is missing notes, chords or measures`);
    }
    const notes = data.notes as Array<Record<string, unknown>>;
    const chords = data.chords as Array<Record<string, unknown>>;
    return {
      baseId, acquiredVia,
      notesSha256: createHash("sha256").update(bytes).digest("hex"),
      noteCount: notes.length,
      chordCount: chords.length,
      chordSourceKinds: [...new Set(chords.map((chord) => typeof chord.sourceKind === "string" ? chord.sourceKind : "legacy"))].sort(),
      timeSig: data.timeSig,
      roleNoteCount: notes.filter((note) => note.identitySource !== undefined).length,
      laneNoteCount: notes.filter((note) => note.sourceLane !== undefined).length,
      measureCount: data.measures.length,
      meterEventCount: Array.isArray(data.timeSigEvents) ? data.timeSigEvents.length : 0,
      generatedOnly: chords.length > 0 && chords.every((chord) => chord.sourceKind === undefined || chord.sourceKind === "generated"),
    };
  }).sort((a, b) => a.baseId.localeCompare(b.baseId));
  return {
    summary: {
      visibleBases: rows.length,
      hiddenBases: bases.filter((base) => hidden.has(base.baseId)).length,
      orphanAdvancedArtifacts: artifactIds.filter((id) => !ids.has(id)).length,
      noteCount: rows.reduce((sum, row) => sum + row.noteCount, 0),
      chordCount: rows.reduce((sum, row) => sum + row.chordCount, 0),
      generatedOnlyBases: rows.filter((row) => row.generatedOnly).length,
      noChordBases: rows.filter((row) => row.chordCount === 0).length,
      roleLabeledBases: rows.filter((row) => row.roleNoteCount > 0).length,
      fullyRoleLabeledBases: rows.filter((row) => row.noteCount > 0 && row.roleNoteCount === row.noteCount).length,
      laneLabeledBases: rows.filter((row) => row.laneNoteCount > 0).length,
      fullyLaneLabeledBases: rows.filter((row) => row.noteCount > 0 && row.laneNoteCount === row.noteCount).length,
    },
    rows,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [{ default: Database }, { dataDir, dbPath, disabledManifestBases, blockedLearnerBases }] = await Promise.all([
    import("better-sqlite3"), import("../src/index.js"),
  ]);
  const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  const bases = db.prepare("SELECT base_id AS baseId, MAX(acquired_via) AS acquiredVia FROM songs GROUP BY base_id")
    .all() as Base[];
  db.close();
  const hidden = new Set([...disabledManifestBases(), ...blockedLearnerBases()]);
  const result = scanBackingCoverage(bases, hidden, join(dataDir(), "artifacts"));
  console.log(JSON.stringify(process.argv.includes("--rows") ? result : result.summary, null, 2));
}
