/** Read-only structural candidate report for visible Advanced song sources. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAccompaniment, type AccompanimentResolution } from "@keyspilli/player-core";
import type { ChordLabel, Note } from "@keyspilli/midi";
import { loadChordTimeline, type ChordTimelineArtifact } from "../src/chord-timeline.js";
import { dataDir } from "../src/paths.js";

type Base = { baseId: string; acquiredVia?: string | null };
type Source = { notes: Note[]; chords: ChordLabel[]; measures: Array<{ startBeat?: number; endBeat?: number }>; timeSig?: unknown; timeSigEvents?: Array<{ beat: number; timeSig: unknown }> };
type TimelineContext = { chords: ChordTimelineArtifact["chords"]; coverage?: string; usedFallback: boolean; provenance: ChordTimelineArtifact["provenance"] } | null;
type Resolver = (source: Source, durationBeats: number, catalogTimeline: TimelineContext) => AccompanimentResolution;
type TimelineLoader = (baseId: string) => Promise<TimelineContext>;

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

type Attack = { midi: number; start: number; dur: number; hand?: "L" | "R" };

function onsetGeometry(attacks: readonly Attack[]) {
  const byHand = { L: new Map<number, number[]>(), R: new Map<number, number[]>() };
  for (const attack of attacks) if (attack.hand) {
    const groups = byHand[attack.hand];
    groups.set(attack.start, [...(groups.get(attack.start) ?? []), attack.midi]);
  }
  return Object.fromEntries((Object.entries(byHand) as Array<["L" | "R", Map<number, number[]>]>).map(([hand, groups]) => {
    const ordered = [...groups].sort(([a], [b]) => a - b).map(([, pitches]) => pitches.sort((a, b) => a - b));
    const representatives = ordered.map((pitches) => pitches[Math.floor((pitches.length - 1) / 2)]!);
    return [hand, ordered.length ? {
      maxSimultaneousSpanSemitones: Math.max(0, ...ordered.map((pitches) => pitches[pitches.length - 1]! - pitches[0]!)),
      maxRepresentativeLeapSemitones: Math.max(0, ...representatives.slice(1).map((pitch, i) => Math.abs(pitch - representatives[i]!))),
    } : null];
  }));
}

export function evaluateAdvancedSource(baseId: string, bytes: Buffer, resolveCandidate: Resolver = currentResolver, catalogTimeline: TimelineContext = null) {
  const source = JSON.parse(bytes.toString("utf8")) as Source;
  if (!Array.isArray(source.notes) || !Array.isArray(source.chords) || !Array.isArray(source.measures)) throw new Error(`${baseId}: malformed Advanced notes.json`);
  const notes = source.notes;
  const durationBeats = Math.max(0, ...source.measures.map((m) => Number(m.endBeat) || 0), ...notes.map((n) => n.start + n.dur), ...source.chords.map((c) => c.beat + (c.durationBeats ?? 0)));
  const resolved = resolveCandidate(source, durationBeats, catalogTimeline);
  const sourceEnd = Math.max(0, ...notes.map((n) => n.start + n.dur));
  const sourceGaps: Array<[number, number]> = [];
  let occupiedEnd = 0;
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    if (note.start > occupiedEnd) sourceGaps.push([occupiedEnd, note.start]);
    occupiedEnd = Math.max(occupiedEnd, note.start + note.dur);
  }
  const sourcePitch = notes.map((n) => n.midi);
  const chordAttacks: Attack[] = resolved.chords.flatMap((chord) => chord.notes.map((midi, i) => ({ midi, start: chord.beat, dur: chord.durationBeats ?? 0, hand: chord.suggestedHands?.[i] })));
  const noteAttacks: Attack[] = resolved.notes.map(({ midi, start, dur, hand }) => ({ midi, start, dur, hand }));
  // Playback schedules both streams, including accidental duplicates.
  const audioAttacks = [...noteAttacks, ...chordAttacks];
  const attackKeys = audioAttacks.map((attack) => `${attack.midi}:${attack.start}:${attack.dur}`);
  const duplicateAudioAttacks = attackKeys.length - new Set(attackKeys).size;
  const audioEnd = Math.max(0, ...audioAttacks.map((n) => n.start + n.dur));
  const firstMeasure = source.measures[0]?.startBeat ?? 0;
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
      onsetGeometryByHand: onsetGeometry(notes),
      unassignedHandAttacks: notes.filter((note) => note.hand !== "L" && note.hand !== "R").length,
      endingGapBeats: Math.max(0, durationBeats - sourceEnd),
    },
    evaluationInput: {
      chordTimeline: "raw-advanced-artifact",
      exactPlayerTimeline: false,
      catalogChordTimeline: catalogTimeline ? {
        chordCount: catalogTimeline.chords.length,
        coverage: catalogTimeline.coverage ?? null,
        usedFallback: catalogTimeline.usedFallback,
        provenance: catalogTimeline.provenance,
      } : null,
    },
    timelineEvaluation: {
      input: resolveCandidate === currentResolver ? "artifactGeneratedTimeline" : "injectedCandidate",
      chordEvents: resolved.chords.length,
      audioNoteStreamAttacks: noteAttacks.length,
      chordVoicingAttacks: chordAttacks.length,
      audioAttacks: audioAttacks.length,
      duplicateAudioAttacks,
      coveredBeats: unionLength(audioAttacks.map((n) => [n.start, n.start + n.dur])),
      chordVoicingCoveredBeats: unionLength(chordAttacks.map((n) => [n.start, n.start + n.dur])),
      coveredFraction: durationBeats ? unionLength(audioAttacks.map((n) => [n.start, n.start + n.dur])) / durationBeats : 0,
      unsupportedSpans: resolved.fallbackSpans.map(({ startBeat, endBeat, reason }) => ({ startBeat, endBeat, reason })),
      minMidi: audioAttacks.length ? Math.min(...audioAttacks.map((n) => n.midi)) : null,
      maxMidi: audioAttacks.length ? Math.max(...audioAttacks.map((n) => n.midi)) : null,
      maximumHeldOverlap: maximumOverlap(audioAttacks),
      onsetGeometryByHand: onsetGeometry(audioAttacks),
      unassignedHandAttacks: audioAttacks.filter((note) => note.hand !== "L" && note.hand !== "R").length,
      endingGapBeats: Math.max(0, durationBeats - audioEnd),
    },
  };
}

export async function evaluateVisibleAdvanced(
  bases: readonly Base[], hidden: ReadonlySet<string>, artifactRoot: string,
  resolveCandidate: Resolver = currentResolver,
  loadTimeline: TimelineLoader = async (baseId) => {
    const timeline = await loadChordTimeline(baseId, { fallbackLevel: "a", runtimeDataDir: dataDir() });
    return timeline ? { chords: timeline.chords, coverage: timeline.coverage, usedFallback: timeline.provenance.fallback === true, provenance: timeline.provenance } : null;
  },
) {
  const known = new Set(bases.map((base) => base.baseId));
  const artifacts = readdirSync(artifactRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(artifactRoot, e.name, "a", "notes.json"))).map((e) => e.name);
  const visible = bases.filter((base) => !hidden.has(base.baseId));
  const rows = await Promise.all(visible.map(async ({ baseId }) => evaluateAdvancedSource(
    baseId,
    readFileSync(join(artifactRoot, baseId, "a", "notes.json")),
    resolveCandidate,
    await loadTimeline(baseId),
  )));
  rows.sort((a, b) => a.baseId.localeCompare(b.baseId));
  return { summary: { visibleBases: rows.length, hiddenBases: bases.filter((b) => hidden.has(b.baseId)).length, orphanAdvancedArtifacts: artifacts.filter((id) => !known.has(id)).length, songsWithUnsupportedSpans: rows.filter((r) => r.timelineEvaluation.unsupportedSpans.length > 0).length }, rows };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [{ default: Database }, { dataDir, dbPath, disabledManifestBases, blockedLearnerBases }] = await Promise.all([import("better-sqlite3"), import("../src/index.js")]);
  const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  const bases = db.prepare("SELECT base_id AS baseId, MAX(acquired_via) AS acquiredVia FROM songs GROUP BY base_id").all() as Base[];
  db.close();
  const hidden = new Set([...disabledManifestBases(), ...blockedLearnerBases()]);
  const report = await evaluateVisibleAdvanced(bases, hidden, join(dataDir(), "artifacts"));
  console.log(JSON.stringify(process.argv.includes("--rows") ? report : report.summary, null, 2));
}
