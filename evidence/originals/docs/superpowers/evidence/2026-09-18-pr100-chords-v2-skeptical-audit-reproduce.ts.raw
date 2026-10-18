import fs from "node:fs";
import { resolveChordSources } from "../../../apps/web/src/components/player/chord-sources.ts";
import { buildMelodyAccompaniment, sourceNoteIds } from "../../../packages/player-core/src/accompaniment.ts";

type Hand = "L" | "R";
type Note = { midi: number; start: number; dur: number; vel: number; hand?: Hand };
type Fixture = { id: string; path: string };

const fixtures: Fixture[] = [
  {
    id: "the-beatles-blackbird",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/the-beatles-blackbird/a/notes.json",
  },
  {
    id: "britney-spears-oops-i-did-it-again",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/britney-spears-oops-i-did-it-again/a/notes.json",
  },
  {
    id: "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d/a/notes.json",
  },
];

const historicalResults = JSON.parse(fs.readFileSync(
  "docs/superpowers/evidence/2026-09-18-pr100-chords-v2-skeptical-audit-results.json",
  "utf8",
)) as { results: Array<Record<string, unknown>> };

function active(notes: readonly Note[], beat: number): Note[] {
  return notes.filter((note) => note.start <= beat && note.start + note.dur > beat);
}

function minGap(starts: number[]): number | null {
  const unique = [...new Set(starts)].sort((a, b) => a - b);
  if (unique.length < 2) return null;
  return unique.slice(1).reduce((minimum, start, index) => Math.min(minimum, start - unique[index]!), Infinity);
}

function attackLocations(notes: readonly Note[]): number[] {
  return [...new Set(notes.map((note) => note.start))].sort((a, b) => a - b);
}

const results = fixtures.map(({ id, path }) => {
  const data = JSON.parse(fs.readFileSync(path, "utf8")) as {
    notes: Note[];
    measures: Array<{ startBeat: number; endBeat: number }>;
    sourceFingerprint: string;
    tempoBpm: number;
  };
  const arrangementEnd = Math.max(
    data.notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
    data.measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0),
  );
  const auto = resolveChordSources(data as never).auto;
  const result = buildMelodyAccompaniment(data.notes, auto.chords, {
    durationBeats: arrangementEnd,
    sourceFingerprint: data.sourceFingerprint,
    selection: "automatic",
    allowRests: true,
    soundingPolicy: "coherent-phrase",
    harmonicSupport: "authored-only",
  });
  const melody = result.events.filter((event) => event.role === "melody").map((event) => event.note);
  const supportEvents = result.events.filter((event) => event.role === "accompaniment");
  const support = supportEvents.map((event) => event.note);
  const finalBackingEvents = result.events.filter((event) => event.role !== "melody");
  const ids = sourceNoteIds(data.notes);
  const sourceMelodyIds = new Set(result.provenance.melodyNoteIds);
  const sourceBackingStream = data.notes.flatMap((note, index) => sourceMelodyIds.has(ids[index]!) ? [] : [{
    sourceNoteId: ids[index]!,
    note,
  }]);
  const sourceById = new Map(ids.map((sourceId, index) => [sourceId, data.notes[index]!]))
  const candidateKind = (event: (typeof finalBackingEvents)[number]): string => event.sourceNoteIds.length === 0
    ? "sparse-harmonic-generated"
    : event.role === "retained-unclassified"
      ? "retained-source"
      : "source-rhythm-or-protected";
  const identitySources = (event: (typeof finalBackingEvents)[number]): string[] => [...new Set(
    event.sourceNoteIds.map((sourceId) => sourceById.get(sourceId)?.identitySource ?? "unannotated"),
  )];
  const backingAttackProvenance = attackLocations(finalBackingEvents.map((event) => event.note)).map((startBeat) => {
    const events = finalBackingEvents.filter((event) => event.note.start === startBeat);
    return {
      startBeat,
      sourceNoteIds: [...new Set(events.flatMap((event) => event.sourceNoteIds))],
      eventIds: events.map((event) => event.id),
      generatedEventCount: events.filter((event) => event.sourceNoteIds.length === 0).length,
      candidateKinds: [...new Set(events.map(candidateKind))],
      identitySources: [...new Set(events.flatMap(identitySources))],
    };
  });
  const densityAttribution = Object.fromEntries(
    [...new Set(finalBackingEvents.map(candidateKind))].map((kind) => {
      const events = finalBackingEvents.filter((event) => candidateKind(event) === kind);
      return [kind, {
        events: events.length,
        notes: events.length,
        attackLocations: attackLocations(events.map((event) => event.note)).length,
      }];
    }),
  );
  const sourceBackingAttackLocations = attackLocations(sourceBackingStream.map(({ note }) => note));
  const addedBackingAttackLocations = backingAttackProvenance.filter(({ startBeat }) => !sourceBackingAttackLocations.includes(startBeat));
  if (addedBackingAttackLocations.some(({ sourceNoteIds, generatedEventCount }) => sourceNoteIds.length === 0 && generatedEventCount === 0)) {
    throw new Error(`${id}: backing attack has no source or generated lineage`);
  }
  const historical = historicalResults.results.find((item) => item.id === id);
  const highSupport = supportEvents
    .filter((event) => event.note.midi >= 79)
    .sort((a, b) => b.note.midi - a.note.midi || a.note.start - b.note.start)
    .slice(0, 3)
    .map((event) => ({
      beat: event.note.start,
      output: event.note,
      source: event.sourceNoteIds.map((sourceId) => sourceById.get(sourceId)),
      activeMelody: active(melody, event.note.start),
    }));
  const velocityCounterexample = supportEvents
    .filter((event) => event.note.vel === 70)
    .map((event) => ({ event, melody: active(melody, event.note.start).find((note) => note.vel < event.note.vel) }))
    .find(({ melody: localMelody }) => localMelody !== undefined);
  const supportStarts = support.map((note) => note.start);
  const attacksPerMeasure = data.measures.map((measure, index) => ({
    measure: index + 1,
    startBeat: measure.startBeat,
    endBeat: measure.endBeat,
    attacks: new Set(support.filter((note) => note.start >= measure.startBeat && note.start < measure.endBeat).map((note) => note.start)).size,
  }));
  const window = id === "britney-spears-oops-i-did-it-again" ? { startBeat: 64, endBeat: 108 } : null;
  const windowSupport = window ? support.filter((note) => note.start >= window.startBeat && note.start < window.endBeat) : [];
  const reasons: Record<string, number> = {};
  for (const span of result.fallbackSpans) reasons[span.reason] = (reasons[span.reason] ?? 0) + span.endBeat - span.startBeat;
  return {
    id,
    sourceNotes: data.notes.length,
    sourceChords: auto.chords.length,
    outputNotes: result.notes.length,
    melodyNotes: melody.length,
    sourceSupportNotes: result.provenance.sourceSupportNoteCount,
    generatedNotes: result.provenance.generatedNoteCount,
    generatedBeats: result.provenance.generatedBeats,
    fallbackBeats: result.provenance.fallbackBeats,
    fallbackReasons: reasons,
    supportModes: result.provenance.supportModes,
    unresolvedSpans: result.provenance.unresolvedSpans.length,
    unresolvedBeats: result.provenance.unresolvedSpans.reduce((sum, span) => sum + span.endBeat - span.startBeat, 0),
    maxSupportAttacksPerMeasure: Math.max(...attacksPerMeasure.map((measure) => measure.attacks)),
    meanSupportAttacksPerMeasure: attacksPerMeasure.reduce((sum, measure) => sum + measure.attacks, 0) / attacksPerMeasure.length,
    minimumSupportAttackGapBeats: minGap(supportStarts),
    minimumSupportAttackGapSeconds: minGap(supportStarts) === null ? null : minGap(supportStarts)! * 60 / data.tempoBpm,
    highSupportAssignedLeft: highSupport,
    velocityCounterexample: velocityCounterexample
      ? { support: velocityCounterexample.event.note, melody: velocityCounterexample.melody }
      : null,
    ...(window ? {
      window,
      windowSupportNotes: windowSupport.length,
      windowSupportAttacks: new Set(windowSupport.map((note) => note.start)).size,
    } : {}),
    historicalBaseline: historical ?? null,
    finalBackingStream: finalBackingEvents.map((event) => ({
      id: event.id,
      role: event.role,
      sourceNoteIds: event.sourceNoteIds,
      note: event.note,
    })),
    sourceBackingStream,
    finalBackingAttackLocations: attackLocations(finalBackingEvents.map((event) => event.note)),
    sourceBackingAttackLocations,
    addedBackingAttackLocations,
    backingAttackProvenance,
    densityAttribution,
    lineageSummary: {
      sourceLinkedFinalBackingEvents: finalBackingEvents.filter((event) => event.sourceNoteIds.length > 0).length,
      generatedFinalBackingEvents: finalBackingEvents.filter((event) => event.sourceNoteIds.length === 0).length,
      retainedUnclassifiedFinalBackingEvents: finalBackingEvents.filter((event) => event.role === "retained-unclassified").length,
    },
    historicalComparison: historical ? {
      outputNotesDelta: result.notes.length - Number(historical.outputNotes ?? 0),
      sourceSupportNotesDelta: result.provenance.sourceSupportNoteCount - Number(historical.sourceSupportNotes ?? 0),
      maxSupportAttacksPerMeasureDelta: Math.max(...attacksPerMeasure.map((measure) => measure.attacks))
        - Number(historical.maxSupportAttacksPerMeasure ?? 0),
      ...(window ? {
        windowSupportNotesDelta: windowSupport.length - Number(historical.windowSupportNotes ?? 0),
        windowSupportAttacksDelta: new Set(windowSupport.map((note) => note.start)).size
          - Number(historical.windowSupportAttacks ?? 0),
      } : {}),
    } : null,
  };
});

console.log(JSON.stringify({ reviewedHead: "a7087b1e5c3862a31abee66cd536330ac5c4a321", results }, null, 2));
