/** Read-only structural candidate report for visible Advanced song sources. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAccompaniment, type AccompanimentResolution } from "@keyspilli/player-core";
import type { ChordLabel, Note } from "@keyspilli/midi";

type Base = { baseId: string; acquiredVia?: string | null };
type Source = { notes: Note[]; chords: ChordLabel[]; measures: Array<{ startBeat?: number; endBeat?: number }>; timeSig?: unknown; timeSigEvents?: Array<{ beat: number; timeSig: unknown }> };
type Resolver = (source: Source, durationBeats: number) => AccompanimentResolution;

const currentResolver: Resolver = (source, durationBeats) => resolveAccompaniment(source.notes, source.chords, "bass-chords", { durationBeats });

function unionLength(spans: Array<[number, number]>): number {
  let end = -Infinity, total = 0;
  for (const [start, stop] of spans.sort((a, b) => a[0] - b[0])) {
    if (stop <= end) continue;
    total += stop - Math.max(start, end);
    end = stop;
  }
  return total;
}

function maximumOverlap(notes: readonly Pick<Note, "midi" | "start" | "dur">[]): number {
  const edges = notes.flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as Array<[number, number]>).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, maximum = 0;
  for (const [, delta] of edges) maximum = Math.max(maximum, active += delta);
  return maximum;
}

export function evaluateAdvancedSource(baseId: string, bytes: Buffer, resolveCandidate: Resolver = currentResolver) {
  const source = JSON.parse(bytes.toString("utf8")) as Source;
  if (!Array.isArray(source.notes) || !Array.isArray(source.chords) || !Array.isArray(source.measures)) throw new Error(`${baseId}: malformed Advanced notes.json`);
  const notes = source.notes;
  const durationBeats = Math.max(0, ...source.measures.map((m) => Number(m.endBeat) || 0), ...notes.map((n) => n.start + n.dur), ...source.chords.map((c) => c.beat + (c.durationBeats ?? 0)));
  const resolved = resolveCandidate(source, durationBeats);
  const sourceEnd = Math.max(0, ...notes.map((n) => n.start + n.dur));
  const sourceGaps: Array<[number, number]> = [];
  let occupiedEnd = 0;
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    if (note.start > occupiedEnd) sourceGaps.push([occupiedEnd, note.start]);
    occupiedEnd = Math.max(occupiedEnd, note.start + note.dur);
  }
  const sourcePitch = notes.map((n) => n.midi);
  const sourceAttacks = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const attackLeaps = sourceAttacks.slice(1).map((n, i) => Math.abs(n.midi - sourceAttacks[i]!.midi));
  const backingNotes = resolved.chords.flatMap((chord) => chord.notes.map((midi) => ({ midi, start: chord.beat, dur: chord.durationBeats ?? 0 })));
  const backingAttacks = backingNotes.slice().sort((a, b) => a.start - b.start || a.midi - b.midi);
  const backingEnd = Math.max(0, ...backingNotes.map((n) => n.start + n.dur));
  const firstMeasure = source.measures[0]?.startBeat ?? 0;
  const meters = source.timeSigEvents?.map((e) => JSON.stringify(e.timeSig)) ?? [];
  return {
    baseId,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    source: {
      noteCount: notes.length,
      chordCount: source.chords.length,
      chordProvenance: Object.fromEntries([...new Set(source.chords.map((c) => c.sourceKind ?? "legacy"))].sort().map((kind) => [kind, source.chords.filter((c) => (c.sourceKind ?? "legacy") === kind).length])),
      durationBeats,
      sourceRestBeats: unionLength(sourceGaps.map(([a, b]) => [a, b])) + Math.max(0, durationBeats - occupiedEnd),
      pickupOrOffset: firstMeasure !== 0,
      unusualMeter: source.timeSigEvents?.some((e) => JSON.stringify(e.timeSig) !== JSON.stringify(source.timeSig)) ?? false,
      meterEventCount: source.timeSigEvents?.length ?? 0,
      minMidi: sourcePitch.length ? Math.min(...sourcePitch) : null,
      maxMidi: sourcePitch.length ? Math.max(...sourcePitch) : null,
      maximumHeldOverlap: maximumOverlap(notes),
      maximumAttackLeapSemitones: Math.max(0, ...attackLeaps),
      endingGapBeats: Math.max(0, durationBeats - sourceEnd),
    },
    candidate: {
      chordEvents: resolved.chords.length,
      audioChordNoteAttacks: backingNotes.length,
      coveredBeats: unionLength(resolved.chords.map((c) => [c.beat, c.beat + (c.durationBeats ?? 0)])),
      coveredFraction: durationBeats ? unionLength(resolved.chords.map((c) => [c.beat, c.beat + (c.durationBeats ?? 0)])) / durationBeats : 0,
      unsupportedSpans: resolved.fallbackSpans.map(({ startBeat, endBeat, reason }) => ({ startBeat, endBeat, reason })),
      minMidi: backingNotes.length ? Math.min(...backingNotes.map((n) => n.midi)) : null,
      maxMidi: backingNotes.length ? Math.max(...backingNotes.map((n) => n.midi)) : null,
      maximumHeldOverlap: maximumOverlap(backingNotes),
      maximumAttackLeapSemitones: Math.max(0, ...backingAttacks.slice(1).map((n, i) => Math.abs(n.midi - backingAttacks[i]!.midi))),
      endingGapBeats: Math.max(0, durationBeats - backingEnd),
    },
  };
}

export function evaluateVisibleAdvanced(bases: readonly Base[], hidden: ReadonlySet<string>, artifactRoot: string, resolveCandidate: Resolver = currentResolver) {
  const known = new Set(bases.map((base) => base.baseId));
  const artifacts = readdirSync(artifactRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(artifactRoot, e.name, "a", "notes.json"))).map((e) => e.name);
  const rows = bases.filter((base) => !hidden.has(base.baseId)).map(({ baseId }) => evaluateAdvancedSource(baseId, readFileSync(join(artifactRoot, baseId, "a", "notes.json")), resolveCandidate)).sort((a, b) => a.baseId.localeCompare(b.baseId));
  return { summary: { visibleBases: rows.length, hiddenBases: bases.filter((b) => hidden.has(b.baseId)).length, orphanAdvancedArtifacts: artifacts.filter((id) => !known.has(id)).length, songsWithUnsupportedSpans: rows.filter((r) => r.candidate.unsupportedSpans.length > 0).length }, rows };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [{ default: Database }, { dataDir, dbPath, disabledManifestBases, blockedLearnerBases }] = await Promise.all([import("better-sqlite3"), import("../src/index.js")]);
  const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  const bases = db.prepare("SELECT base_id AS baseId, MAX(acquired_via) AS acquiredVia FROM songs GROUP BY base_id").all() as Base[];
  db.close();
  const hidden = new Set([...disabledManifestBases(), ...blockedLearnerBases()]);
  const report = evaluateVisibleAdvanced(bases, hidden, join(dataDir(), "artifacts"));
  console.log(JSON.stringify(process.argv.includes("--rows") ? report : report.summary, null, 2));
}
