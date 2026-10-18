import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyBootstrapManifest, type SongRow } from "@keyspilli/catalog";
import { loadSongArtifact, projectChordSources } from "../../../../apps/web/src/lib/catalog-api.ts";
import { buildMelodyArrangementOptions, melodyArrangementResolutionFingerprint } from "../../../../apps/web/src/components/player/melody-arrangement-runtime.ts";
import { melodyHarmonicSupportPolicy, resolveChordSources, selectChordSource } from "../../../../apps/web/src/components/player/chord-sources.ts";
import { buildMelodyAccompaniment, sourceNoteIds, validateSparseBackingTiming } from "../../../../packages/player-core/src/accompaniment.ts";
import { playbackTiming } from "../../../../packages/player-core/src/timeline.ts";
import { measurePlayability, parseMidi, type Note, type ParsedMidi, type Variant } from "../../../../packages/midi/src/index.ts";
import { buildVariants } from "../../../../packages/midi/src/simplify.ts";
import type { SongData } from "../../../../packages/player-core/src/types.ts";
import {
  rawTrackMetadata,
  tagParsedSourceNotes,
  type RawTrackNote,
} from "./source-candidate-comparison.ts";

const dataRoot = process.env.KEYSPILLI_CANONICAL_DATA_ROOT ?? "/Users/reidar/Projectos/Keyspilli/data";
const baseId = "queen-somebody-to-love";
const title = "Somebody To Love";
const artist = "Queen";
const tempoBpm = 108;
const midiPath = join(dataRoot, "seed-midi", `${baseId}.mid`);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function durationEndpoints(data: SongData): {
  noteEndBeats: number;
  measureEndBeats: number;
  comparisonDurationBeats: number;
  terminalPaddingBeats: number;
} {
  const noteEndBeats = Math.max(0, ...data.notes.map((note) => note.start + note.dur));
  const measureEndBeats = Math.max(0, ...data.measures.map((measure) => measure.endBeat));
  const comparisonDurationBeats = Math.max(noteEndBeats, measureEndBeats);
  return {
    noteEndBeats,
    measureEndBeats,
    comparisonDurationBeats,
    terminalPaddingBeats: Math.max(0, comparisonDurationBeats - noteEndBeats),
  };
}

function audibleKey(note: Pick<Note, "midi" | "start" | "dur" | "vel">): string {
  return JSON.stringify([note.midi, note.start, note.dur, note.vel]);
}

function multiset(notes: readonly Note[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const note of notes) result.set(audibleKey(note), (result.get(audibleKey(note)) ?? 0) + 1);
  return result;
}

function difference(left: Map<string, number>, right: Map<string, number>): number {
  let total = 0;
  for (const [key, count] of left) total += Math.max(0, count - (right.get(key) ?? 0));
  return total;
}

function identityCounts(notes: readonly Note[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const identity = note.identitySource ?? "unannotated";
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function variantData(variant: Variant, fingerprint: string): SongData {
  return {
    notes: variant.notes,
    chords: variant.chords,
    measures: variant.measures,
    key: variant.key,
    tempoBpm: variant.tempoBpm,
    timeSig: variant.timeSig,
    sourceFingerprint: fingerprint,
    ...(variant.timeSigEvents?.length ? { timeSigEvents: variant.timeSigEvents } : {}),
  };
}

function row(id: string, variant: Variant): SongRow {
  return {
    id,
    baseId: id,
    title,
    artist,
    category: "evidence",
    difficulty: "advanced",
    difficultyScore: variant.difficultyScore,
    key: variant.key,
    tempo: variant.tempoBpm,
    style: "piano",
    mood: "evidence",
    bassPattern: variant.bassPattern,
    duration: Math.max(0, ...variant.notes.map((note) => note.start + note.dur)),
    contentType: "standard",
    acquiredVia: null,
    sourceYoutubeUrl: null,
    hasSheetXml: 0,
    sections: null,
    plays: 0,
    level: "a",
    createdAt: "2026-09-19T00:00:00Z",
  };
}

async function writeDisposableArtifact(root: string, id: string, variant: Variant, fingerprint: string): Promise<SongData> {
  const dir = join(root, "artifacts", id, "a");
  await mkdir(dir, { recursive: true });
  const data = variantData(variant, fingerprint);
  const manifest = createLegacyBootstrapManifest(id, tempoBpm, "2026-09-19T00:00:00.000Z");
  await writeFile(join(root, "artifacts", id, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dir, "notes.json"), `${JSON.stringify(data, null, 2)}\n`);
  const loaded = await loadSongArtifact(row(id, variant));
  if (!loaded.data) throw new Error(`${id}: disposable artifact did not load: ${loaded.artifact.errors.join("; ")}`);
  return loaded.data;
}

function runPlayerProducer(
  data: SongData,
  id: string,
  comparisonDurationBeats: number,
): Record<string, unknown> {
  const durationBeats = comparisonDurationBeats;
  const sourceFingerprint = data.sourceFingerprint ?? null;
  const sparseBackingTiming = validateSparseBackingTiming(data.sourceTiming, sourceFingerprint);
  const timing = playbackTiming({ ...data, sourceTiming: sparseBackingTiming });
  const projected = projectChordSources(data, null, "a");
  const selected = selectChordSource(resolveChordSources(projected), "auto");
  const harmonicSupport = melodyHarmonicSupportPolicy(selected.source);
  const arrangementOptions = buildMelodyArrangementOptions({
      durationBeats,
      sourceFingerprint,
      selection: "automatic",
      phraseOverrides: [],
      harmonicSupport,
      sourceBackingMode: "default",
      sparseBackingTiming: timing,
  });
  const resolution = buildMelodyAccompaniment(
    projected.notes,
    selected.source?.chords ?? [],
    arrangementOptions,
  );
  const outputMetrics = measurePlayability(resolution.notes, tempoBpm, durationBeats);
  const eventMultiset = multiset(resolution.events.map((event) => event.note));
  const sourceIds = sourceNoteIds(projected.notes);
  const sourceById = new Map(sourceIds.map((sourceId, index) => [sourceId, projected.notes[index]!])) as Map<string, Note>;
  const emittedSourceIds = new Set(resolution.events.flatMap((event) => event.sourceNoteIds));
  const melodySourceIds = new Set(resolution.provenance.melodyNoteIds);
  const identityCountsByRole = Object.fromEntries(([
    "melody",
    "accompaniment",
    "retained-unclassified",
  ] as const).map((role) => [role, identityCounts(resolution.events
    .filter((event) => event.role === role)
    .flatMap((event) => event.sourceNoteIds.map((sourceId) => sourceById.get(sourceId)).filter((note): note is Note => note !== undefined)))]));
  return {
    id,
    loaderAndProducer: "loadSongArtifact -> projectChordSources -> resolveChordSources/selectChordSource -> buildMelodyArrangementOptions -> buildMelodyAccompaniment",
    loadedNotes: projected.notes.length,
    durationBeats,
    selectedChordSource: selected.source?.id ?? null,
    selectedChordSourceFallback: selected.fallback,
    harmonicSupport,
    lineage: {
      loadedIdentityCounts: identityCounts(data.notes),
      projectedIdentityCounts: identityCounts(projected.notes),
      selectedMelodyIdentityCounts: identityCounts(projected.notes.filter((_, index) => melodySourceIds.has(sourceIds[index]!))),
      emittedEventIdentityCountsByRole: identityCountsByRole,
      preservedThroughLoader: JSON.stringify(identityCounts(data.notes)) === JSON.stringify(identityCounts(projected.notes)),
      interpretation: "identitySource survives the disposable loader and chord projection; baseline automatic selection is generic and is not semantic vocal ownership.",
    },
    outputEvents: resolution.events.length,
    outputNotes: resolution.notes.length,
    outputAttacks: outputMetrics.global.onsetCount,
    outputEventMultiset: eventMultiset,
    outputEventMultisetSha256: sha256(JSON.stringify([...eventMultiset.entries()].sort(([left], [right]) => left.localeCompare(right)))),
    resolutionFingerprint: melodyArrangementResolutionFingerprint(resolution),
    melodyEvents: resolution.events.filter((event) => event.role === "melody").length,
    supportEvents: resolution.events.filter((event) => event.role !== "melody").length,
    generatedSupportEvents: resolution.events.filter((event) => event.role !== "melody" && event.sourceNoteIds.length === 0).length,
    removedSourceNoteCount: sourceIds.filter((idValue) => !emittedSourceIds.has(idValue)).length,
    generatedNoteCount: resolution.provenance.generatedNoteCount,
    generatedBeats: resolution.provenance.generatedBeats,
    fallbackBeats: resolution.provenance.fallbackBeats,
    unresolvedSpanCount: resolution.provenance.unresolvedSpans.length,
    reviewBeats: resolution.changeSummary.reviewBeats,
    changedBeats: resolution.changeSummary.changedBeats,
    unchangedBeats: resolution.changeSummary.unchangedBeats,
    playabilityAt108Bpm: {
      attacks: outputMetrics.global.onsetCount,
      maxSimultaneous: outputMetrics.global.maxSimultaneous,
      maxSounding: outputMetrics.global.maxSounding,
      simultaneousChordAttacks: outputMetrics.simultaneousChordAttacks,
      samePitchRearticulationOnsets: outputMetrics.samePitchRearticulationOnsets,
      alternatingHandAttacks: outputMetrics.alternatingHandAttacks,
      RH: {
        noteCount: outputMetrics.hands.R.noteCount,
        onsetCount: outputMetrics.hands.R.onsetCount,
        worstTopVoiceLeap: outputMetrics.hands.R.worstTopVoiceLeap,
      },
      LH: {
        noteCount: outputMetrics.hands.L.noteCount,
        onsetCount: outputMetrics.hands.L.onsetCount,
        worstTopVoiceLeap: outputMetrics.hands.L.worstTopVoiceLeap,
      },
    },
  };
}

function candidateSourceNotes(bytes: Uint8Array, parsed: ParsedMidi): RawTrackNote[] {
  const tracks = rawTrackMetadata(bytes, parsed.division);
  const track = tracks.find((item) => Array.isArray(item.texts)
    && (item.texts as Array<{ text?: string }>).some((event) => event.text === "-CANTO-"));
  if (!track) throw new Error("Queen raw MIDI has no -CANTO- track");
  const channels = track.channelNotes && typeof track.channelNotes === "object"
    ? Object.keys(track.channelNotes as Record<string, unknown>).map(Number).filter(Number.isInteger)
    : [];
  const channel = channels[0];
  if (channel === undefined) throw new Error("Queen -CANTO- track has no note channel");
  const withNotes = rawTrackMetadata(bytes, parsed.division, [{ trackIndex: Number(track.trackIndex), channel }]);
  const notes = withNotes.find((item) => Number(item.trackIndex) === Number(track.trackIndex))?.notes;
  if (!Array.isArray(notes) || notes.length !== 278) throw new Error(`expected 278 CANTO notes, got ${Array.isArray(notes) ? notes.length : 0}`);
  return notes as RawTrackNote[];
}

async function main(): Promise<void> {
  const bytes = await readFile(midiPath);
  const canonicalData = JSON.parse(await readFile(join(dataRoot, "artifacts", baseId, "a", "notes.json"), "utf8")) as SongData;
  const canonicalDurationEndpoints = durationEndpoints(canonicalData);
  const parsed = parseMidi(bytes);
  const canto = candidateSourceNotes(bytes, parsed);
  const tagged = tagParsedSourceNotes(parsed, canto);
  if (tagged.matched !== canto.length || tagged.ambiguous !== 0) throw new Error("CANTO source tagging failed");
  const buildOptions = { arrangementProfile: "learner" as const, audioDerived: false, maxDurBeats: null };
  const current = buildVariants(parsed, { title, artist }, buildOptions).find((variant) => variant.level === "advanced");
  const candidate = buildVariants(tagged.parsed, { title, artist }, { ...buildOptions, protectedIdentitySources: ["vocals"] })
    .find((variant) => variant.level === "advanced");
  if (!current || !candidate) throw new Error("current or protected Advanced variant missing");

  const disposableRoot = await mkdtemp(join(tmpdir(), "keyspilli-chords-bridge-"));
  process.env.KEYSPILLI_DATA_DIR = disposableRoot;
  try {
    const currentData = await writeDisposableArtifact(disposableRoot, "queen-current-replay", current, `bridge:current:${sha256(JSON.stringify(current.notes))}`);
    const candidateData = await writeDisposableArtifact(disposableRoot, "queen-protected-candidate", candidate, `bridge:candidate:${sha256(JSON.stringify(candidate.notes))}`);
    const currentResult = runPlayerProducer(currentData, "current-replay", canonicalDurationEndpoints.comparisonDurationBeats);
    const candidateResult = runPlayerProducer(candidateData, "protected-candidate-replay", canonicalDurationEndpoints.comparisonDurationBeats);
    const currentEvents = currentResult.outputEventMultiset as Map<string, number>;
    const candidateEvents = candidateResult.outputEventMultiset as Map<string, number>;
    console.log(JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-09-19",
      source: {
        rawMidiSha256: sha256(bytes),
        rawCantoNotes: canto.length,
        currentImporterAdvancedNotes: current.notes.length,
        protectedImporterAdvancedNotes: candidate.notes.length,
        durationEndpoints: canonicalDurationEndpoints,
      },
      loader: "disposable loadSongArtifact with legacy-bootstrap manifest; no catalog or production data written",
      settings: {
        selection: "automatic",
        allowRests: true,
        soundingPolicy: "coherent-phrase",
        sourceBackingMode: "default",
        comparisonTempoBpm: tempoBpm,
      },
      currentReplay: { ...currentResult, outputEventMultiset: undefined },
      protectedCandidateReplay: { ...candidateResult, outputEventMultiset: undefined },
      wholeSongDelta: {
        loadedNotes: Number(candidateResult.loadedNotes) - Number(currentResult.loadedNotes),
        outputEvents: Number(candidateResult.outputEvents) - Number(currentResult.outputEvents),
        outputNotes: Number(candidateResult.outputNotes) - Number(currentResult.outputNotes),
        outputAttacks: Number(candidateResult.outputAttacks) - Number(currentResult.outputAttacks),
        melodyEvents: Number(candidateResult.melodyEvents) - Number(currentResult.melodyEvents),
        supportEvents: Number(candidateResult.supportEvents) - Number(currentResult.supportEvents),
        generatedSupportEvents: Number(candidateResult.generatedSupportEvents) - Number(currentResult.generatedSupportEvents),
        fallbackBeats: Number(candidateResult.fallbackBeats) - Number(currentResult.fallbackBeats),
        unresolvedSpanCount: Number(candidateResult.unresolvedSpanCount) - Number(currentResult.unresolvedSpanCount),
        eventMembersOnlyInCurrent: difference(currentEvents, candidateEvents),
        eventMembersOnlyInCandidate: difference(candidateEvents, currentEvents),
      },
      nonClaims: [
        "This is a whole-song Chords-mode producer/loader replay, not a semantic melody judgment.",
        "The protected artifact is disposable and was not catalog-published or deployed.",
        "Structural output and playability diagnostics do not establish useful learner arrangement or musical acceptance.",
      ],
    }, null, 2));
  } finally {
    await rm(disposableRoot, { recursive: true, force: true });
  }
}

void main();
