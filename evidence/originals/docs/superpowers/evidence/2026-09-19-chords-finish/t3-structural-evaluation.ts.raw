import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveChordSources } from "../../../../apps/web/src/components/player/chord-sources.ts";
import {
  buildMelodyAccompaniment,
  sourceNoteIds,
} from "../../../../packages/player-core/src/accompaniment.ts";
import { measurePlayability, type Note } from "../../../../packages/midi/src/index.ts";

type FixtureData = {
  notes: Note[];
  chords: unknown[];
  measures: Array<{ startBeat: number; endBeat: number }>;
  sourceFingerprint?: string;
  tempoBpm?: number;
};

const fixtures = [
  {
    id: "oops",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/britney-spears-oops-i-did-it-again/a/notes.json",
    tempoBpm: 95,
  },
  {
    id: "blackbird",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/the-beatles-blackbird/a/notes.json",
    tempoBpm: 120,
  },
  {
    id: "hell",
    path: "docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d/a/notes.json",
    tempoBpm: 95,
  },
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function duration(notes: readonly Note[], measures: readonly { endBeat: number }[]): number {
  return Math.max(0, ...notes.map((note) => note.start + note.dur), ...measures.map((measure) => measure.endBeat));
}

function spanBeats(spans: readonly { startBeat: number; endBeat: number }[]): number {
  return round(spans.reduce((sum, span) => sum + Math.max(0, span.endBeat - span.startBeat), 0));
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}

function evaluateFixture(spec: (typeof fixtures)[number]): Record<string, unknown> {
  const bytes = readFileSync(spec.path);
  const data = JSON.parse(bytes.toString("utf8")) as FixtureData;
  const durationBeats = duration(data.notes, data.measures);
  const chordSources = resolveChordSources(data as never);
  const result = buildMelodyAccompaniment(data.notes, chordSources.auto.chords, {
    durationBeats,
    sourceFingerprint: data.sourceFingerprint,
    selection: "automatic",
    allowRests: true,
    soundingPolicy: "coherent-phrase",
    harmonicSupport: "authored-only",
  });
  const sourceIds = sourceNoteIds(data.notes);
  const emittedSourceIds = new Set(result.events.flatMap((event) => event.sourceNoteIds));
  const finalGenerated = result.events.filter((event) => event.sourceNoteIds.length === 0);
  const finalMelody = result.events.filter((event) => event.role === "melody");
  const finalSupport = result.events.filter((event) => event.role !== "melody");
  const mandatoryMetrics = measurePlayability(
    result.events
      .filter((event) => event.role === "melody" || event.role === "retained-unclassified")
      .map((event) => event.note),
    spec.tempoBpm,
    durationBeats,
  );
  const outputMetrics = measurePlayability(result.notes, spec.tempoBpm, durationBeats);
  const sourceMetrics = measurePlayability(data.notes, spec.tempoBpm, durationBeats);
  const worstWindows = outputMetrics.bursts.rapidRegions
    .slice()
    .sort((left, right) => right.rapidIoiCount - left.rapidIoiCount || left.startBeat - right.startBeat)
    .slice(0, 5)
    .map((region) => ({
      startBeat: region.startBeat,
      endBeat: region.endBeat,
      rapidIoiCount: region.rapidIoiCount,
      rightHandAttacks: region.rightHandAttacks,
      leftHandAttacks: region.leftHandAttacks,
    }));
  return {
    id: spec.id,
    sourcePath: spec.path,
    sourceSha256: sha256(bytes),
    sourceFingerprint: data.sourceFingerprint ?? null,
    tempoBpm: spec.tempoBpm,
    durationBeats,
    sourceNotes: data.notes.length,
    outputEvents: result.events.length,
    outputAttacks: outputMetrics.global.onsetCount,
    outputEventSha256: sha256(JSON.stringify(result.events.map((event) => ({
      id: event.id,
      role: event.role,
      sourceNoteIds: event.sourceNoteIds,
      note: event.note,
    })))),
    output: {
      melody: finalMelody.length,
      support: finalSupport.length,
      generatedSupport: finalGenerated.length,
      removedSourceNoteCount: sourceIds.filter((id) => !emittedSourceIds.has(id)).length,
      generatedNoteCount: result.provenance.generatedNoteCount,
      generatedBeats: result.provenance.generatedBeats,
      fallbackBeats: result.provenance.fallbackBeats,
      fallbackReasons: countBy(result.fallbackSpans.map((span) => span.reason)),
      supportModes: result.provenance.supportModes,
      strategyCounts: countBy(result.phrases.map((phrase) => phrase.strategy)),
      phraseCount: result.phrases.length,
      mandatoryPerHand: {
        R: {
          maxSimultaneous: mandatoryMetrics.hands.R.maxSimultaneous,
          maxSounding: mandatoryMetrics.hands.R.maxSounding,
        },
        L: {
          maxSimultaneous: mandatoryMetrics.hands.L.maxSimultaneous,
          maxSounding: mandatoryMetrics.hands.L.maxSounding,
        },
      },
    },
    review: {
      unresolvedSpanCount: result.provenance.unresolvedSpans.length,
      unresolvedBeats: spanBeats(result.provenance.unresolvedSpans),
      changedBeats: result.changeSummary.changedBeats,
      unchangedBeats: result.changeSummary.unchangedBeats,
      silentBeats: result.changeSummary.silentBeats,
      reviewBeats: result.changeSummary.reviewBeats,
      topUnresolvedSpans: result.provenance.unresolvedSpans
        .slice()
        .sort((left, right) => (right.endBeat - right.startBeat) - (left.endBeat - left.startBeat))
        .slice(0, 5),
    },
    playabilityDiagnostic: {
      source: {
        attacks: sourceMetrics.global.onsetCount,
        medianIoiSeconds: sourceMetrics.global.medianIoiSeconds,
        maxSimultaneous: sourceMetrics.global.maxSimultaneous,
        maxSounding: sourceMetrics.global.maxSounding,
        perHand: {
          R: {
            maxSimultaneous: sourceMetrics.hands.R.maxSimultaneous,
            maxSounding: sourceMetrics.hands.R.maxSounding,
          },
          L: {
            maxSimultaneous: sourceMetrics.hands.L.maxSimultaneous,
            maxSounding: sourceMetrics.hands.L.maxSounding,
          },
        },
        worstTopVoiceLeap: sourceMetrics.hands.R.worstTopVoiceLeap,
      },
      final: {
        attacks: outputMetrics.global.onsetCount,
        medianIoiSeconds: outputMetrics.global.medianIoiSeconds,
        maxSimultaneous: outputMetrics.global.maxSimultaneous,
        maxSounding: outputMetrics.global.maxSounding,
        perHand: {
          R: {
            maxSimultaneous: outputMetrics.hands.R.maxSimultaneous,
            maxSounding: outputMetrics.hands.R.maxSounding,
          },
          L: {
            maxSimultaneous: outputMetrics.hands.L.maxSimultaneous,
            maxSounding: outputMetrics.hands.L.maxSounding,
          },
        },
        worstTopVoiceLeap: outputMetrics.hands.R.worstTopVoiceLeap,
        worstAttackWindow: outputMetrics.global.worstAttackWindow,
        worstRapidWindows: worstWindows,
      },
      disclaimer: "Report-only structural diagnostics; no musical or keyboard acceptance claim.",
    },
  };
}

console.log(JSON.stringify({
  schemaVersion: 1,
  revision: "e309c86",
  mode: "automatic-default",
  sourceMode: "authored-only harmonic labels; source-backed final events",
  fixtures: fixtures.map(evaluateFixture),
}, null, 2));
