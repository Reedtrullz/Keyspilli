import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildMelodyAccompaniment } from "../../../packages/player-core/src/accompaniment.ts";
import type { ChordLabel, Note } from "../../../packages/midi/src/types.ts";

const DATA_ROOT = process.env.KEYSPILLI_MELODY_DATA_ROOT ?? "/Users/reidar/Projectos/Keyspilli/data";
const DB_PATH = process.env.KEYSPILLI_MELODY_DB ?? join(DATA_ROOT, "db.sqlite");
const SAMPLE_PER_STRATUM = 6;
const PILOT_IDS = new Set([
  "the-beatles-blackbird",
  "ed-sheeran-perfect",
  "massive-attack-teardrop",
  "dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo",
  "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d",
  "beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940",
  "piano-cover-by-pianella-piano-hozier-too-sweet-mslzwyl8",
  "dorelia-bast-sabaton-en-livstid-i-krig-a-lifetime-of-war-piano-cover-mslzy9fm",
]);

type CatalogRow = { baseId: string; title: string; artist: string; contentType: string; acquiredVia: string | null };
type Source = { notes?: Note[]; chords?: ChordLabel[] };

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const overlap = (start: number, end: number, rangeStart: number, rangeEnd: number) => Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
const artifactPaths = (baseId: string) => ({
  notes: join(DATA_ROOT, "artifacts", baseId, "a", "notes.json"),
  manifest: join(DATA_ROOT, "artifacts", baseId, "manifest.json"),
});

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const rows = db.prepare(`SELECT base_id AS baseId, title, artist, content_type AS contentType, acquired_via AS acquiredVia
  FROM songs WHERE level = 'a' AND content_type IN ('standard', 'youtube', 'upload')
  ORDER BY content_type, base_id`).all() as CatalogRow[];
db.close();

const selected = ["standard", "youtube", "upload"].flatMap((contentType) => rows
  .filter((row) => row.contentType === contentType && !PILOT_IDS.has(row.baseId) && !row.baseId.startsWith("keyspilli-upload-test-"))
  .filter((row, index, candidates) => candidates.findIndex((candidate) => candidate.baseId === row.baseId) === index)
  .filter((row) => {
    const paths = artifactPaths(row.baseId);
    return existsSync(paths.notes) && existsSync(paths.manifest);
  })
  .slice(0, SAMPLE_PER_STRATUM));

const resultRows = selected.map((row) => {
  const paths = artifactPaths(row.baseId);
  const data = JSON.parse(readFileSync(paths.notes, "utf8")) as Source;
  const notes = data.notes ?? [];
  const chords = data.chords ?? [];
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as { sourceArtifactHash?: string };
  const durationBeats = Math.max(0, ...notes.map((note) => note.start + note.dur));
  const sourceFingerprint = manifest.sourceArtifactHash
    ? `variant:${row.baseId}:a:${manifest.sourceArtifactHash}`
    : `legacy:${row.baseId}:${hash(paths.notes)}`;
  const result = buildMelodyAccompaniment(notes, chords, { durationBeats, sourceFingerprint });
  const generatedBeats = result.chords.reduce((sum, chord) => sum + Math.max(0, Math.min(durationBeats, chord.beat + (chord.durationBeats ?? 0)) - chord.beat), 0);
  const fallbackBeats = result.fallbackSpans.reduce((sum, span) => sum + overlap(span.startBeat, span.endBeat, 0, durationBeats), 0);
  const status = result.provenance.unresolvedSpans.length > 0 ? "ambiguous" : generatedBeats > 0 ? "success" : "failure";
  return {
    baseId: row.baseId,
    title: row.title,
    artist: row.artist,
    stratum: row.contentType,
    acquiredVia: row.acquiredVia,
    variant: "a",
    generatorVersion: result.provenance.generatorVersion,
    sourceFingerprint,
    manifestSourceArtifactHash: manifest.sourceArtifactHash ?? null,
    notesJsonSha256: hash(paths.notes),
    sourceNotes: notes.length,
    selectedMelodyNotes: result.melody.length,
    generatedSupportBeats: Number(generatedBeats.toFixed(3)),
    retainedFallbackBeats: Number(fallbackBeats.toFixed(3)),
    generatedChordEvents: result.chords.length,
    unresolvedSpanCount: result.provenance.unresolvedSpans.length,
    fallbackReasons: [...new Set(result.fallbackSpans.map((span) => span.reason))],
    status,
    changedPaths: [],
  };
});

for (const row of resultRows) console.log(JSON.stringify(row));
const byStratum = Object.fromEntries(["standard", "youtube", "upload"].map((stratum) => {
  const scoped = resultRows.filter((row) => row.stratum === stratum);
  return [stratum, {
    sampled: scoped.length,
    success: scoped.filter((row) => row.status === "success").length,
    ambiguous: scoped.filter((row) => row.status === "ambiguous").length,
    failure: scoped.filter((row) => row.status === "failure").length,
  }];
}));
console.log(JSON.stringify({ kind: "summary", generatorVersion: "melody-accompaniment.v1", dataRoot: DATA_ROOT, sampled: resultRows.length, byStratum, changedPaths: [] }));
