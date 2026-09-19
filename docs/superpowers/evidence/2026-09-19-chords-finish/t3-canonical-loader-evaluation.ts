import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadSongArtifact, projectChordSources } from "../../../../apps/web/src/lib/catalog-api.ts";
import {
  buildMelodyArrangementOptions,
  melodyArrangementResolutionFingerprint,
} from "../../../../apps/web/src/components/player/melody-arrangement-runtime.ts";
import { melodyHarmonicSupportPolicy, resolveChordSources, selectChordSource } from "../../../../apps/web/src/components/player/chord-sources.ts";
import {
  buildMelodyAccompaniment,
  validateSparseBackingTiming,
  sourceNoteIds,
} from "../../../../packages/player-core/src/accompaniment.ts";
import { playbackTiming } from "../../../../packages/player-core/src/timeline.ts";
import { measurePlayability, type Note } from "../../../../packages/midi/src/index.ts";
import { loadChordTimeline } from "../../../../packages/catalog/src/chord-timeline.ts";
import type { SongData } from "../../../../packages/player-core/src/types.ts";
import type { SongRow } from "../../../../packages/catalog/src/db-types.ts";

type Target = {
  id: string;
  baseId: string;
  title: string;
  artist: string;
  tempoBpm: number;
  timeSig: [number, number];
  sourceArtifactHash: string;
  manifestSha256: string;
  notesSha256: string;
  variantMidiSha256: string;
  variantXmlSha256: string;
};

const targets: readonly Target[] = [
  {
    id: "britney-spears-oops-i-did-it-again-a",
    baseId: "britney-spears-oops-i-did-it-again",
    title: "Oops I Did It Again",
    artist: "Britney Spears",
    tempoBpm: 95,
    timeSig: [4, 4],
    sourceArtifactHash: "64d18aa4c23f7625a6eb0a7a234843a7a2278003d75cba9ea04efde7d8225ad4",
    manifestSha256: "de8f40b8cf7fdbdfd38dacf3b0feb1fa8cf24f615eb118c768c8f308f357173d",
    notesSha256: "337834fcd339a67e2aebbae3a8d3c3ae8eb8eb55c8529610e748c40bf80ca60a",
    variantMidiSha256: "001c03ee99636dc6c9f6eda9feeeeec060507c35d5a5431f0d1a586de6ea9d76",
    variantXmlSha256: "6e52b06ee3499f2c51031e1405b0b6def622c0b90349b62050e4c1e007306930",
  },
  {
    id: "the-beatles-blackbird-a",
    baseId: "the-beatles-blackbird",
    title: "Blackbird",
    artist: "The Beatles",
    tempoBpm: 120,
    timeSig: [4, 4],
    sourceArtifactHash: "3fc3fd74d567da56dd10ff05689ef2f57641efbbe200532aabc0ea5fbcea1e75",
    manifestSha256: "bd3c983a1f88134bb276145fa0d3a8f91241107a4525295eb3d96109d0b82c2f",
    notesSha256: "70f29a617731fd982e54592d98fb37c74d964ea6d275c011f04579f14b871256",
    variantMidiSha256: "eaa46a8de0eb088a41c3d17ab1a18dbc06fd3f9f1899cad990e365f1c756ab1c",
    variantXmlSha256: "2deba24d628ea9b80b3770e7984228a4b45c918549ae404f1db5c98822879395",
  },
  {
    id: "queen-somebody-to-love-a",
    baseId: "queen-somebody-to-love",
    title: "Somebody To Love",
    artist: "Queen",
    tempoBpm: 108,
    timeSig: [6, 8],
    sourceArtifactHash: "4505d3a7cb3c24788e51905eb29a40c501a31f7bd07596d489f63f7430c7a74e",
    manifestSha256: "0093613fd0f404fca931090163ab2a9f96272aa82eef729f4da68587929a9135",
    notesSha256: "4faced9af0bc543fd4f054c731a16ed58e977d8623f947ff6925b482f8b3ec7d",
    variantMidiSha256: "83be6c85627d6d861cd209d8b9411053ffe585712f142c8c0a83744ca1068d51",
    variantXmlSha256: "2e5f254a2d88aa4427e47d6d2773c956fd9d4c890a3edb7d54563f7e1fa6d594",
  },
  {
    id: "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a",
    baseId: "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8",
    title: "Elton John - Your Song | The Theorist Piano Cover",
    artist: "The Theorist",
    tempoBpm: 129,
    timeSig: [4, 4],
    sourceArtifactHash: "bcdbb1eef809fbf0bee0824a874e98ad3cea321e44d0d87ed0a9633b72371f0e",
    manifestSha256: "3c995622d4d7cdb2fd6d067e3c51e141fbe919deb93dfc53d8be57ec97f2bd4b",
    notesSha256: "5bc202eecbcff8597163eb9fd154af01e07f4682989bc2e7aa5bd3d573e8fb99",
    variantMidiSha256: "1a67b0e425a4056051759e92f5f3f2bacf5f7f6dbc86ec47772d19b57365d811",
    variantXmlSha256: "985b02c621a1c84a921ad359b92ea41eb5f893be833075c0f119581eedeb1421",
  },
  {
    id: "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d-a",
    baseId: "aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d",
    title: "Hell You Call A Dream",
    artist: "The Warning",
    tempoBpm: 99,
    timeSig: [4, 4],
    sourceArtifactHash: "13e9cd2ed273c7bf9f9a8a14a480ae5b8505e52d85eb3cfacdc51d6cb9f3af0a",
    manifestSha256: "f14790db8b0742a752cf4b6dd571fc56d49a9dfa27dc36263628a3a67fe8900c",
    notesSha256: "6c03998a78c9ba1052feafc87476e6ba38c47f4c824c96855684212cf04fb265",
    variantMidiSha256: "e930e6c3a6c346a9277be23fa5aac01a068fb51efe69bd121b10343da6d4e567",
    variantXmlSha256: "5bbb4de5ad46728d22ede35d8c6a2eb5de120cc6e2f53bb88c22e9b5a7033acb",
  },
];

const pinnedChartResourceHashes = {
  sourceMap: "b81f86719506a72346555615733cdcafbbfe6bc5997059ee024cc3145d9615ac",
  yourSong: "44dfa65604e63d288ba96e231a84de65a8e496459e186ca56fa596f99e6c680b",
} as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function duration(notes: readonly Note[], measures: readonly { endBeat: number }[]): number {
  return round(Math.max(
    0,
    notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
    measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0),
  ));
}

function spanBeats(spans: readonly { startBeat: number; endBeat: number }[]): number {
  return round(spans.reduce((sum, span) => sum + Math.max(0, span.endBeat - span.startBeat), 0));
}

function countBy(values: readonly string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}

function spanBeatsByReason(spans: readonly { startBeat: number; endBeat: number; reason: string }[]): Record<string, number> {
  const totals = new Map<string, number>();
  for (const span of spans) totals.set(span.reason, round((totals.get(span.reason) ?? 0) + Math.max(0, span.endBeat - span.startBeat)));
  return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function sourceFingerprintForPlayer(data: SongData): string | null {
  if (data.sourceFingerprint) return data.sourceFingerprint;
  const ids = sourceNoteIds(data.notes);
  return ids.length ? `legacy:canonical-replay:${JSON.stringify(ids)}` : null;
}

function songRow(target: Target, data: SongData): SongRow {
  return {
    id: target.id,
    baseId: target.baseId,
    title: target.title,
    artist: target.artist,
    category: "evidence",
    difficulty: "advanced",
    difficultyScore: 4.6,
    key: data.key,
    tempo: target.tempoBpm,
    style: "piano",
    mood: "evidence",
    bassPattern: "block",
    duration: duration(data.notes, data.measures),
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

function assertPinnedHash(label: string, actual: string, expected: string | null): void {
  if (expected !== null && actual !== expected) {
    throw new Error(`${label} hash mismatch: expected ${expected}, got ${actual}`);
  }
}

async function copyCanonicalArtifact(root: string, target: Target, tempRoot: string): Promise<{
  notes: Buffer;
  files: Record<string, string>;
  hashes: { manifest: string; notes: string; variantMidi: string | null; variantXml: string | null };
}> {
  const sourceDir = join(root, "artifacts", target.baseId);
  const tempDir = join(tempRoot, "artifacts", target.baseId);
  const tempVariantDir = join(tempDir, "a");
  await mkdir(tempVariantDir, { recursive: true });
  const sourceFiles = {
    manifest: join(sourceDir, "manifest.json"),
    notes: join(sourceDir, "a", "notes.json"),
    variantMidi: join(sourceDir, "a", "variant.mid"),
    variantXml: join(sourceDir, "a", "variant.xml"),
  };
  const files = {
    manifest: join(tempDir, "manifest.json"),
    notes: join(tempVariantDir, "notes.json"),
    variantMidi: join(tempVariantDir, "variant.mid"),
    variantXml: join(tempVariantDir, "variant.xml"),
  };
  await copyFile(sourceFiles.manifest, files.manifest);
  await copyFile(sourceFiles.notes, files.notes);
  for (const name of ["variantMidi", "variantXml"] as const) {
    if (name === "variantMidi" && !target.variantMidiSha256) continue;
    if (name === "variantXml" && !target.variantXmlSha256) continue;
    await copyFile(sourceFiles[name], files[name]);
  }
  const manifest = await readFile(files.manifest);
  const notes = await readFile(files.notes);
  const variantMidi = target.variantMidiSha256 ? await readFile(files.variantMidi) : null;
  const variantXml = target.variantXmlSha256 ? await readFile(files.variantXml) : null;
  const hashes = {
    manifest: sha256(manifest),
    notes: sha256(notes),
    variantMidi: variantMidi ? sha256(variantMidi) : null,
    variantXml: variantXml ? sha256(variantXml) : null,
  };
  assertPinnedHash(`${target.id} manifest`, hashes.manifest, target.manifestSha256);
  assertPinnedHash(`${target.id} notes`, hashes.notes, target.notesSha256);
  assertPinnedHash(`${target.id} variant.mid`, hashes.variantMidi ?? "", target.variantMidiSha256 || null);
  assertPinnedHash(`${target.id} variant.xml`, hashes.variantXml ?? "", target.variantXmlSha256 || null);
  return {
    notes,
    files,
    hashes,
  };
}

async function copyChartResources(tempRoot: string): Promise<{ files: Record<string, string>; hashes: Record<string, string> }> {
  const catalogRoot = resolve(process.cwd(), "catalog");
  const tempCatalogRoot = join(tempRoot, "catalog");
  const tempTimelineRoot = join(tempCatalogRoot, "chord-timelines");
  await mkdir(tempTimelineRoot, { recursive: true });
  const sourceFiles = {
    sourceMap: join(catalogRoot, "chord-sources.json"),
    yourSong: join(catalogRoot, "chord-timelines", "your-song.json"),
  };
  const files = {
    sourceMap: join(tempCatalogRoot, "chord-sources.json"),
    yourSong: join(tempTimelineRoot, "your-song.json"),
  };
  await copyFile(sourceFiles.sourceMap, files.sourceMap);
  await copyFile(sourceFiles.yourSong, files.yourSong);
  const hashes = {
    sourceMap: sha256(await readFile(files.sourceMap)),
    yourSong: sha256(await readFile(files.yourSong)),
  };
  assertPinnedHash("chord source map", hashes.sourceMap, pinnedChartResourceHashes.sourceMap);
  assertPinnedHash("Your Song chart", hashes.yourSong, pinnedChartResourceHashes.yourSong);
  return {
    files,
    hashes,
  };
}

async function evaluateData(target: Target, data: SongData, source: {
  notes: Buffer;
  files: Record<string, string>;
  manifestSha256: string;
  variantMidiSha256: string | null;
  variantXmlSha256: string | null;
}, chart: Record<string, unknown> | null, artifactStatus: string, artifactErrors: readonly string[], sourceBackingMode: "default" | "conservative"): Promise<Record<string, unknown>> {
  const durationBeats = duration(data.notes, data.measures);
  const sourceFingerprint = sourceFingerprintForPlayer(data);
  const sparseBackingTiming = validateSparseBackingTiming(data.sourceTiming, sourceFingerprint);
  const playbackTimingForPlayer = playbackTiming({ ...data, sourceTiming: sparseBackingTiming });
  const chordSources = resolveChordSources(data);
  const selectedChordSource = selectChordSource(chordSources, "auto");
  const harmonicSupport = melodyHarmonicSupportPolicy(selectedChordSource.source);
  const arrangementOptions = buildMelodyArrangementOptions({
    durationBeats,
    sourceFingerprint,
    selection: "automatic",
    phraseOverrides: [],
    harmonicSupport,
    sourceBackingMode,
    sparseBackingTiming: playbackTimingForPlayer,
  });
  const result = buildMelodyAccompaniment(data.notes, selectedChordSource.source?.chords ?? [], arrangementOptions);
  const sourceIds = sourceNoteIds(data.notes);
  const emittedSourceIds = new Set(result.events.flatMap((event) => event.sourceNoteIds));
  const finalGenerated = result.events.filter((event) => event.sourceNoteIds.length === 0);
  const finalMelody = result.events.filter((event) => event.role === "melody");
  const finalSupport = result.events.filter((event) => event.role !== "melody");
  const sourceMetrics = measurePlayability(data.notes, data.tempoBpm, durationBeats);
  const outputMetrics = measurePlayability(result.notes, data.tempoBpm, durationBeats);
  const mandatoryMetrics = measurePlayability(
    result.events.filter((event) => event.role === "melody" || event.role === "retained-unclassified").map((event) => event.note),
    data.tempoBpm,
    durationBeats,
  );
  return {
    id: target.id,
    title: target.title,
    status: "evaluated",
    source: {
      kind: "local-canonical-replay-via-loadSongArtifact",
      files: source.files,
      manifestSha256: source.manifestSha256,
      notesSha256: sha256(source.notes),
      sourceArtifactHash: target.sourceArtifactHash,
      expectedManifestSha256: target.manifestSha256,
      expectedNotesSha256: target.notesSha256,
      expectedVariantMidiSha256: target.variantMidiSha256 || null,
      expectedVariantXmlSha256: target.variantXmlSha256 || null,
      variantMidiSha256: source.variantMidiSha256,
      variantXmlSha256: source.variantXmlSha256,
    },
    loader: {
      artifactStatus,
      artifactErrors,
      runtimeSourceFingerprint: data.sourceFingerprint ?? null,
      runtimeTempoBpm: data.tempoBpm,
      runtimeTimeSig: data.timeSig,
      sourceTimingPresent: Boolean(data.sourceTiming),
      timeSigEventsPresent: Boolean(data.timeSigEvents?.length),
      playbackTimingAccepted: Boolean(playbackTimingForPlayer),
      chart,
    },
    config: {
      selection: "automatic",
      allowRests: true,
      soundingPolicy: "coherent-phrase",
      harmonicSupport,
      sourceBackingMode,
      selectedChordSource: selectedChordSource.source?.id ?? null,
      selectedChordSourceFallback: selectedChordSource.fallback,
      declaredTempoBpm: target.tempoBpm,
      declaredTimeSig: target.timeSig,
    },
    runtime: {
      node: process.version,
      revision: "d4e4006",
      cwd: process.cwd(),
    },
    durationBeats,
    sourceNotes: data.notes.length,
    outputEvents: result.events.length,
    outputAttacks: outputMetrics.global.onsetCount,
    outputEventSha256: sha256(JSON.stringify(result.events.map((event) => ({ id: event.id, role: event.role, sourceNoteIds: event.sourceNoteIds, note: event.note })))),
    resolutionFingerprint: melodyArrangementResolutionFingerprint(result),
    output: {
      melody: finalMelody.length,
      support: finalSupport.length,
      generatedSupport: finalGenerated.length,
      removedSourceNoteCount: sourceIds.filter((id) => !emittedSourceIds.has(id)).length,
      generatedNoteCount: result.provenance.generatedNoteCount,
      generatedBeats: result.provenance.generatedBeats,
      fallbackBeats: result.provenance.fallbackBeats,
      fallbackReasons: countBy(result.fallbackSpans.map((span) => span.reason)),
      fallbackBeatsByReason: spanBeatsByReason(result.fallbackSpans),
      supportModes: result.provenance.supportModes,
      strategyCounts: countBy(result.phrases.map((phrase) => phrase.strategy)),
      phraseCount: result.phrases.length,
      mandatoryPerHand: {
        R: { maxSimultaneous: mandatoryMetrics.hands.R.maxSimultaneous, maxSounding: mandatoryMetrics.hands.R.maxSounding },
        L: { maxSimultaneous: mandatoryMetrics.hands.L.maxSimultaneous, maxSounding: mandatoryMetrics.hands.L.maxSounding },
      },
    },
    review: {
      unresolvedSpanCount: result.provenance.unresolvedSpans.length,
      unresolvedBeats: spanBeats(result.provenance.unresolvedSpans),
      changedBeats: result.changeSummary.changedBeats,
      unchangedBeats: result.changeSummary.unchangedBeats,
      silentBeats: result.changeSummary.silentBeats,
      reviewBeats: result.changeSummary.reviewBeats,
      topUnresolvedSpans: result.provenance.unresolvedSpans.slice().sort((left, right) => (right.endBeat - right.startBeat) - (left.endBeat - left.startBeat)).slice(0, 5),
    },
    playabilityDiagnostic: {
      source: {
        attacks: sourceMetrics.global.onsetCount,
        medianIoiSeconds: sourceMetrics.global.medianIoiSeconds,
        maxSimultaneous: sourceMetrics.global.maxSimultaneous,
        maxSounding: sourceMetrics.global.maxSounding,
        worstTopVoiceLeap: sourceMetrics.hands.R.worstTopVoiceLeap,
      },
      final: {
        attacks: outputMetrics.global.onsetCount,
        medianIoiSeconds: outputMetrics.global.medianIoiSeconds,
        maxSimultaneous: outputMetrics.global.maxSimultaneous,
        maxSounding: outputMetrics.global.maxSounding,
        worstTopVoiceLeap: outputMetrics.hands.R.worstTopVoiceLeap,
        worstAttackWindow: outputMetrics.global.worstAttackWindow,
        worstRapidWindows: outputMetrics.bursts.rapidRegions.slice().sort((left, right) => right.rapidIoiCount - left.rapidIoiCount || left.startBeat - right.startBeat).slice(0, 5),
      },
      disclaimer: "Report-only structural diagnostics; no musical or keyboard acceptance claim.",
    },
  };
}

async function evaluateTarget(root: string, target: Target, tempRoot: string, chartResources: { files: Record<string, string>; hashes: Record<string, string> }): Promise<Record<string, unknown>> {
  const copied = await copyCanonicalArtifact(root, target, tempRoot);
  const notesData = JSON.parse(copied.notes.toString("utf8")) as SongData;
  const loaded = await loadSongArtifact(songRow(target, notesData));
  if (!loaded.data) {
    return {
      id: target.id,
      title: target.title,
      status: "blocked",
      source: { kind: "local-canonical-replay-via-loadSongArtifact", files: copied.files, hashes: copied.hashes, expectedManifestSha256: target.manifestSha256, expectedNotesSha256: target.notesSha256, sourceArtifactHash: target.sourceArtifactHash },
      loader: { artifactStatus: loaded.artifact.status, artifactErrors: loaded.artifact.errors },
    };
  }
  let runtimeData = loaded.data;
  const timeline = await loadChordTimeline(target.baseId, {
    mappingPath: join(tempRoot, "catalog", "chord-sources.json"),
    catalogRoot: tempRoot,
    runtimeDataDir: tempRoot,
    fallbackLevel: "a",
  });
  const chart = timeline?.provenance.kind === "chart"
    ? {
        status: "loaded",
        sourceRef: timeline.provenance.sourceRef,
        coverage: timeline.coverage ?? null,
        durationBeats: timeline.durationBeats,
        timelineSha256: chartResources.hashes.yourSong,
      }
    : null;
  runtimeData = projectChordSources(runtimeData, timeline, target.level);
  const evidence = {
    ...copied,
    files: copied.files,
    manifestSha256: copied.hashes.manifest,
    variantMidiSha256: copied.hashes.variantMidi,
    variantXmlSha256: copied.hashes.variantXml,
  };
  const [defaultLane, conservativeLane] = await Promise.all([
    evaluateData(target, runtimeData, evidence, chart, loaded.artifact.status, loaded.artifact.errors, "default"),
    evaluateData(target, runtimeData, evidence, chart, loaded.artifact.status, loaded.artifact.errors, "conservative"),
  ]);
  const { source, loader, ...defaultResult } = defaultLane;
  const { source: _conservativeSource, loader: _conservativeLoader, ...conservativeResult } = conservativeLane;
  return {
    id: target.id,
    title: target.title,
    status: "evaluated",
    source,
    loader,
    lanes: {
      default: defaultResult,
      conservative: conservativeResult,
    },
  };
}

async function main(): Promise<void> {
  const canonicalRoot = resolve(process.env.KEYSPILLI_CANONICAL_DATA_DIR ?? "/Users/reidar/Projectos/Keyspilli/data");
  const tempRoot = await mkdtemp(join(tmpdir(), "keyspilli-chords-t3-"));
  process.env.KEYSPILLI_DATA_DIR = tempRoot;
  try {
    const chartResources = await copyChartResources(tempRoot);
    const fixtures = [];
    for (const target of targets) {
      try {
        fixtures.push(await evaluateTarget(canonicalRoot, target, tempRoot, chartResources));
      } catch (error) {
        fixtures.push({ id: target.id, title: target.title, status: "blocked", error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(JSON.stringify({
      schemaVersion: 1,
      revision: "d4e4006",
      capturedAt: "2026-09-19",
      sourceMode: "local canonical replay: production artifact bytes copied read-only into a disposable loader root; no deployed runtime claim",
      canonicalRoot,
      chartResources,
      disposableLoaderRoot: tempRoot,
      disposableLoaderRootRemovedAfterRun: true,
      fixtures,
    }, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

void main();
