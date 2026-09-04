/**
 * Deterministic, report-only playability audit.
 *
 * Lane A is supplied explicitly because its media is private.  The report
 * contains hashes and logical fixture ids, never physical paths or note
 * arrays.  This command does not change learner policy, publish data, or use
 * benchmark material.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assessPlayability,
  buildVariants,
  LEVEL_ORDER,
  measurePlayability,
  parseMidi,
  PLAYABILITY_AUDIT_CONFIG,
  validateVariants,
  verifyMonotonicity,
  type DifficultyLevel,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import { buildRegionClaims } from "../src/region-shadow-rehearsal.js";
import { researchExternalCandidates } from "../src/external-research.js";
import { buildExternalSymbolicArrangement, freezeGenerationCandidateSet } from "../src/external-symbolic-pipeline.js";
import { sha256Hex } from "../src/fixture-evidence.js";
import { ROOT } from "../src/paths.js";

const TEMPOS = [60, 90, 120, 150, 180] as const;
const TRUSTED_FIXTURES = [
  ["classical", "Clair de lune", "Claude Debussy", "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"],
  ["cover", "River Flows in You", "Yiruma", "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"],
  ["pop", "Hello", "Adele", "data/artifacts/adele-hello/a/notes.json"],
] as const;

interface CliOptions {
  laneA: string;
  out?: string;
  revision: string;
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digestNotes(notes: readonly Note[]): string {
  const rows = [...notes]
    .map((note) => [
      note.midi,
      round(note.start),
      round(note.dur),
      note.vel,
      note.hand ?? "",
      note.identitySource ?? "",
    ])
    .sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return sha256Hex(new TextEncoder().encode(JSON.stringify(rows)));
}

function maxEnd(notes: readonly Note[]): number {
  return Math.max(0, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
}

function parsedArtifact(raw: Record<string, unknown>): ParsedMidi {
  const notes = Array.isArray(raw.notes) ? raw.notes as Note[] : [];
  const tempoBpm = typeof raw.tempoBpm === "number" && Number.isFinite(raw.tempoBpm) && raw.tempoBpm > 0
    ? raw.tempoBpm : 120;
  const timeSig: [number, number] = Array.isArray(raw.timeSig) && raw.timeSig.length === 2
    ? [Number(raw.timeSig[0]), Number(raw.timeSig[1])] : [4, 4];
  return {
    format: 1,
    division: 480,
    tempoBpm,
    tempoMetaPresent: true,
    keySig: typeof raw.keySig === "number" && Number.isFinite(raw.keySig) ? raw.keySig : 0,
    keyMode: raw.keyMode === 1 ? 1 : 0,
    timeSig,
    notes,
    trackNames: ["project-owned playability audit fixture"],
    durationBeats: typeof raw.durationBeats === "number" && Number.isFinite(raw.durationBeats) && raw.durationBeats > 0
      ? raw.durationBeats : maxEnd(notes),
    title: typeof raw.title === "string" ? raw.title : undefined,
  };
}

function stage(name: string, notes: readonly Note[], tempoBpm: number, durationBeats: number, level?: DifficultyLevel) {
  const metrics = measurePlayability(notes, tempoBpm, durationBeats);
  return {
    ...(level ? { level } : {}),
    noteCount: notes.length,
    eventHash: digestNotes(notes),
    handLabelsAvailable: notes.some((note) => note.hand !== undefined),
    tempoBpm: round(tempoBpm),
    durationBeats: round(durationBeats),
    metrics: compactMetrics(metrics),
    ...(level ? { assessment: assessPlayability(metrics, level) } : {}),
    name,
  };
}

function compactMetrics(metrics: ReturnType<typeof measurePlayability>) {
  const hand = (value: typeof metrics.global) => ({
    noteCount: value.noteCount,
    onsetCount: value.onsetCount,
    medianIoiSeconds: value.medianIoiSeconds,
    p01Seconds: value.p01Seconds,
    p05Seconds: value.p05Seconds,
    p10Seconds: value.p10Seconds,
    p25Seconds: value.p25Seconds,
    p75Seconds: value.p75Seconds,
    p90Seconds: value.p90Seconds,
    p95Seconds: value.p95Seconds,
    minSeconds: value.minSeconds,
    meanSeconds: value.meanSeconds,
    attacksPerSecond: value.attacksPerSecond,
    maxShortWindowAttacksPerSecond: value.maxShortWindowAttacksPerSecond,
    rapidIoiCount: value.rapidIoiCount,
    rapidIoiFraction: value.rapidIoiFraction,
    maxSimultaneous: value.maxSimultaneous,
    maxSounding: value.maxSounding,
  });
  const rapidRegions = [...metrics.bursts.rapidRegions]
    .sort((left, right) => right.durationSeconds - left.durationSeconds || left.startBeat - right.startBeat)
    .slice(0, 3);
  return {
    noteCount: metrics.noteCount,
    validNoteCount: metrics.validNoteCount,
    invalidNoteCount: metrics.invalidNoteCount,
    durationBeats: metrics.durationBeats,
    durationSeconds: metrics.durationSeconds,
    global: hand(metrics.global),
    rightHand: hand(metrics.hands.R),
    leftHand: hand(metrics.hands.L),
    toleranceOnsetCount: metrics.toleranceOnsetCount,
    simultaneousChordAttacks: metrics.simultaneousChordAttacks,
    samePitchRearticulationOnsets: metrics.samePitchRearticulationOnsets,
    alternatingHandAttacks: metrics.alternatingHandAttacks,
    bursts: {
      rapidIoiCount: metrics.bursts.rapidIoiCount,
      rapidIoiFraction: metrics.bursts.rapidIoiFraction,
      longestRapidRun: metrics.bursts.longestRapidRun,
      longestRapidRegionSeconds: metrics.bursts.longestRapidRegionSeconds,
      rapidRegionCount: metrics.bursts.rapidRegions.length,
      worstRegions: rapidRegions,
    },
    rapidSourceEdges: metrics.rapidSourceEdges,
  };
}

function sourceCounts(notes: readonly Note[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const note of notes) {
    const source = note.identitySource ?? "unknown";
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(counts).sort(compareText).map((key) => [key, counts[key]!]));
}

function interaction(metrics: ReturnType<typeof measurePlayability>, level: DifficultyLevel) {
  const assessment = assessPlayability(metrics, level);
  const density = assessment.passes.maxDensity;
  const ioi = assessment.passes.medianIoi;
  return {
    level,
    status: assessment.status,
    densityPass: density,
    medianIoiPass: ioi,
    maxSimPass: assessment.passes.maxSim,
    class: !density && !ioi ? "both-density-and-ioi" : !density ? "density-only" : !ioi ? "ioi-only" : "neither",
  };
}

function chordHeavy(): Note[] {
  return [0, 1, 2, 3].flatMap((start) => [60, 64, 67, 72].map((midi) => ({ midi, start, dur: 0.125, vel: 90, hand: "R" as const })));
}

function rapidMonophonic(): Note[] {
  return Array.from({ length: 10 }, (_, index) => ({ midi: 60 + (index % 5), start: index * 0.125, dur: 0.125, vel: 90, hand: "R" as const }));
}

function alternatingHands(): Note[] {
  return Array.from({ length: 10 }, (_, index) => ({ midi: 60 + (index % 5), start: index * 0.125, dur: 0.125, vel: 90, hand: index % 2 ? "L" as const : "R" as const }));
}

function denseArpeggio(): Note[] {
  return Array.from({ length: 32 }, (_, index) => ({ midi: 48 + (index % 12), start: index * 0.125, dur: 0.2, vel: 88, hand: "R" as const }));
}

function fastMelodySparseLeftHand(): Note[] {
  return [
    ...Array.from({ length: 16 }, (_, index) => ({ midi: 64 + (index % 7), start: index * 0.125, dur: 0.1, vel: 92, hand: "R" as const })),
    ...[0, 4, 8, 12].map((start) => ({ midi: 36, start, dur: 1.5, vel: 82, hand: "L" as const })),
  ];
}

function sparseMelodyDenseAccompaniment(): Note[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({ midi: 72 + index, start: index * 8, dur: 1, vel: 90, hand: "R" as const })),
    ...Array.from({ length: 10 }, (_, index) => ({ midi: 36 + (index % 3), start: index * 0.125, dur: 0.1, vel: 86, hand: "L" as const })),
  ];
}

function repeatedArticulation(): Note[] {
  return Array.from({ length: 16 }, (_, index) => ({ midi: 64, start: index * 0.125, dur: 0.08, vel: 94, hand: "R" as const }));
}

function syntheticControls(): Record<string, unknown> {
  const controls: Array<[string, string, Note[]]> = [
    ["A-chord-heavy", "large simultaneous chords with slow distinct attacks", chordHeavy()],
    ["B-rapid-monophonic", "one-hand rapid distinct attacks", rapidMonophonic()],
    ["C-alternating-hands", "RH/LH alternation at rapid global spacing", alternatingHands()],
    ["D-dense-arpeggio", "one-hand rapid moving arpeggio", denseArpeggio()],
    ["E-fast-melody-sparse-lh", "fast RH melody with sparse LH", fastMelodySparseLeftHand()],
    ["F-sparse-melody-dense-accompaniment", "long sparse melody with localized LH burst", sparseMelodyDenseAccompaniment()],
    ["G-repeated-articulation", "same-pitch repeated attacks", repeatedArticulation()],
  ];
  return Object.fromEntries(controls.map(([id, mechanism, notes]) => {
    const metrics = measurePlayability(notes, 120);
    return [id, {
      mechanism,
      eventHash: digestNotes(notes),
      metrics,
      assessments: Object.fromEntries(LEVEL_ORDER.map((level) => [level, assessPlayability(metrics, level)])),
      handAware: {
        globalMedianSeconds: metrics.global.medianIoiSeconds,
        rightMedianSeconds: metrics.hands.R.medianIoiSeconds,
        leftMedianSeconds: metrics.hands.L.medianIoiSeconds,
        interpretation: metrics.global.medianIoiSeconds !== null
          && metrics.hands.R.medianIoiSeconds !== null
          && metrics.hands.L.medianIoiSeconds !== null
          && metrics.global.medianIoiSeconds < Math.min(metrics.hands.R.medianIoiSeconds, metrics.hands.L.medianIoiSeconds)
          ? "global alternation is faster than either hand" : "no inter-hand-only speedup detected",
      },
    }];
  }));
}

function tempoSensitivity(): Record<string, unknown> {
  const notes = rapidMonophonic();
  return Object.fromEntries(TEMPOS.map((tempo) => {
    const metrics = measurePlayability(notes, tempo);
    return [String(tempo), {
      tempoBpm: tempo,
      globalMedianSeconds: metrics.global.medianIoiSeconds,
      rightMedianSeconds: metrics.hands.R.medianIoiSeconds,
      attacksPerSecond: metrics.global.attacksPerSecond,
      easy: interaction(metrics, "easy"),
      medium: interaction(metrics, "medium"),
    }];
  }));
}

async function readTrustedFixture(path: string): Promise<{ bytes: Uint8Array; parsed: ParsedMidi }> {
  const bytes = new Uint8Array(await readFile(path));
  return { bytes, parsed: parsedArtifact(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>) };
}

async function laneAStages(path: string): Promise<Record<string, unknown>> {
  const bytes = new Uint8Array(await readFile(path));
  const source = parseMidi(bytes);
  const inventory = await researchExternalCandidates({ title: "Local real performance shadow", artist: "Keyspilli" }, {
    localInputs: [{
      id: "lane-a-native-performance",
      path,
      format: "midi",
      sourceRef: "user:local-performance-symbolic",
      purpose: "GENERATION_CANDIDATE",
      evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
      alignment: { status: "aligned", reason: "native performance-symbolic timing is authoritative" },
    }],
  });
  const frozen = freezeGenerationCandidateSet(inventory.records, { requireAlignment: true });
  const selected = frozen.selected[0];
  if (!selected) throw new Error("Lane A did not produce a frozen generation candidate");
  const record = inventory.records[0];
  if (!record) throw new Error("Lane A inventory is empty");
  const duration = source.durationBeats;
  const output = buildExternalSymbolicArrangement({
    candidateSet: frozen,
    mode: "direct-piano",
    windows: [{ id: "full", startBeat: 0, endBeat: duration, candidateId: selected.recordId }],
    regionClaims: buildRegionClaims(record, duration),
    fallbackEnabled: false,
  });
  if (output.status !== "symbolic" || !output.canonical) throw new Error(output.fallbackReason ?? "Lane A arrangement unavailable");
  const canonical = output.canonical;
  const variants = buildVariants(canonical, {
    title: canonical.title ?? "Lane A",
    artist: "Keyspilli playability audit",
    tempo: canonical.tempoBpm,
  }, { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null });
  const byLevel = Object.fromEntries(variants.map((variant) => [
    variant.level,
    stage(variant.level, variant.notes, variant.tempoBpm, Math.max(canonical.durationBeats, maxEnd(variant.notes)), variant.level),
  ]));
  const failingLevels = variants
    .filter((variant) => !assessPlayability(
      measurePlayability(variant.notes, variant.tempoBpm, Math.max(canonical.durationBeats, maxEnd(variant.notes))),
      variant.level,
    ).passes.medianIoi)
    .map((variant) => variant.level);
  const stages = [
    ["source", stage("source", source.notes, source.tempoBpm, source.durationBeats)],
    ["owned", stage("owned", source.notes, source.tempoBpm, source.durationBeats)],
    ["canonical", stage("canonical", canonical.notes, canonical.tempoBpm, canonical.durationBeats)],
    ...(["advanced", "medium", "easy", "very-easy", "beginner", "very-beginner"] as const).map((level) => [level, byLevel[level]]),
  ];
  const stageMap = Object.fromEntries(stages);
  const validationErrors = [...validateVariants(variants, { maxDurBeats: null }), ...verifyMonotonicity(variants)];
  return {
    source: {
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      noteCount: source.notes.length,
      durationBeats: round(source.durationBeats),
      tempoBpm: round(source.tempoBpm),
      timeSig: source.timeSig,
      handLabelsAvailable: source.notes.some((note) => note.hand !== undefined),
      sourceCounts: sourceCounts(source.notes),
    },
    stages: stageMap,
    arrangementStats: {
      identityNotes: output.canonical.notes.filter((note) => note.hand !== "L").length,
      leftHandNotes: output.canonical.notes.filter((note) => note.hand === "L").length,
    },
    validationErrors,
    interactions: Object.fromEntries(variants.map((variant) => [variant.level, interaction(
      measurePlayability(variant.notes, variant.tempoBpm, Math.max(canonical.durationBeats, maxEnd(variant.notes))),
      variant.level,
    )])),
    sourceToCanonical: {
      sourceEventHash: digestNotes(source.notes),
      ownedEventHash: digestNotes(source.notes),
      canonicalEventHash: digestNotes(canonical.notes),
      sourceNotes: source.notes.length,
      canonicalNotes: canonical.notes.length,
    },
    densityConclusion: {
      firstFailingLearnerLevel: failingLevels[0] ?? null,
      failingLevels,
      failureKind: "median-ioi-only",
      maxDensityPassesAtFailingLevels: failingLevels.every((level) =>
        (byLevel[level] as { assessment?: { passes: { maxDensity: boolean } } }).assessment?.passes.maxDensity === true,
      ),
      sameHandMediansRemainAboveFloor: failingLevels.every((level) => {
        const metrics = (byLevel[level] as { metrics: { rightHand: { medianIoiSeconds: number | null }; leftHand: { medianIoiSeconds: number | null } } }).metrics;
        return (metrics.rightHand.medianIoiSeconds ?? Infinity) >= 0.08
          && (metrics.leftHand.medianIoiSeconds ?? Infinity) >= 0.08;
      }),
      interpretation: "canonical selection remains dense; learner levels preserve rapid global attacks while average density and max simultaneity stay within configured limits",
    },
  };
}

async function trustedControls(): Promise<Record<string, unknown>> {
  const reports: Record<string, unknown> = {};
  for (const [id, title, _artist, logicalRef] of TRUSTED_FIXTURES) {
    const loaded = await readTrustedFixture(resolve(ROOT, logicalRef));
    const variants = buildVariants(loaded.parsed, { title, artist: _artist }, { arrangementProfile: "learner", maxDurBeats: null });
    reports[id] = {
      title,
      logicalRef,
      source: {
        bytes: loaded.bytes.byteLength,
        sha256: sha256Hex(loaded.bytes),
        noteCount: loaded.parsed.notes.length,
        durationBeats: round(loaded.parsed.durationBeats),
        tempoBpm: round(loaded.parsed.tempoBpm),
        handLabelsAvailable: loaded.parsed.notes.some((note) => note.hand !== undefined),
      },
      levels: Object.fromEntries(variants.map((variant) => [variant.level, stage(variant.level, variant.notes, variant.tempoBpm, Math.max(loaded.parsed.durationBeats, maxEnd(variant.notes)), variant.level)])),
    };
  }
  const synthetic = syntheticFullBandNotes();
  const parsed: ParsedMidi = {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes: synthetic,
    trackNames: ["synthetic full-band"],
    durationBeats: 8,
  };
  const variants = buildVariants(parsed, { title: "Synthetic full-band", artist: "Keyspilli" }, { arrangementProfile: "learner", maxDurBeats: null });
  reports["synthetic-full-band"] = {
    title: "Synthetic full-band",
    logicalRef: "synthetic:full-band",
    source: { bytes: 0, sha256: digestNotes(synthetic), noteCount: synthetic.length, durationBeats: 8, tempoBpm: 120, handLabelsAvailable: true },
    levels: Object.fromEntries(variants.map((variant) => [variant.level, stage(variant.level, variant.notes, variant.tempoBpm, Math.max(8, maxEnd(variant.notes)), variant.level)])),
  };
  return reports;
}

function syntheticFullBandNotes(): Note[] {
  const vocals: Note[] = [
    { midi: 64, start: 0, dur: 1.5, vel: 105, hand: "R", identitySource: "vocals" },
    { midi: 65, start: 2, dur: 1.5, vel: 102, hand: "R", identitySource: "vocals" },
    { midi: 67, start: 4, dur: 1.5, vel: 100, hand: "R", identitySource: "vocals" },
    { midi: 69, start: 6, dur: 1.5, vel: 104, hand: "R", identitySource: "vocals" },
  ];
  const guitar: Note[] = [
    ...[[52, 59, 64], [55, 62, 67], [57, 64, 69], [52, 59, 64]].flatMap((stack, index) => stack.map((midi) => ({ midi, start: index * 2, dur: 0.75, vel: 90, hand: "R" as const, identitySource: "guitar" as const }))),
    ...[40, 43, 45, 40].map((midi, index) => ({ midi, start: index * 2, dur: 1.5, vel: 88, hand: "L" as const, identitySource: "guitar" as const })),
  ];
  return [...vocals, ...guitar];
}

function parseArgs(argv: readonly string[]): CliOptions {
  let laneA = "";
  let out: string | undefined;
  let revision = "current";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const [option, inline] = token.split("=", 2);
    const value = inline ?? argv[++index];
    if (option === "--lane-a-midi") laneA = value ?? "";
    else if (option === "--out") out = value;
    else if (option === "--revision") revision = value ?? revision;
    else if (option === "--help" || option === "-h") throw new Error("Usage: audit-playability.ts --lane-a-midi FILE [--out FILE] [--revision LABEL]");
    else throw new Error(`unknown option: ${token}`);
  }
  if (!laneA) throw new Error("--lane-a-midi is required");
  return { laneA, out, revision };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const info = await stat(options.laneA);
  if (!info.isFile()) throw new Error("--lane-a-midi must be a regular file");
  const laneA = await laneAStages(options.laneA);
  const reportWithoutDigest = {
    schemaVersion: 1,
    kind: "authoritative-symbolic-playability-gate-audit",
    mission: "AUTHORITATIVE_SYMBOLIC_PLAYABILITY_GATE_AUDIT",
    revision: options.revision,
    scope: {
      onsetToleranceBeats: PLAYABILITY_AUDIT_CONFIG.onsetToleranceBeats,
      rapidIoiSeconds: PLAYABILITY_AUDIT_CONFIG.rapidIoiSeconds,
      shortWindowSeconds: PLAYABILITY_AUDIT_CONFIG.shortWindowSeconds,
      benchmarkMaterialUsed: false,
      humanListening: "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT",
      deployment: "NOT_DEPLOYED",
      musicalPolicyChanged: false,
    },
    laneA,
    trustedControls: await trustedControls(),
    syntheticControls: syntheticControls(),
    tempoSensitivity: tempoSensitivity(),
    diagnosis: "AUTHORITATIVE_SOURCE_DENSITY_REQUIRES_TRANSFORM",
    implementation: {
      behaviorChange: false,
      change: "report-only playability metrics; validator limits and note selection unchanged",
      laneASpecificLogic: false,
    },
    decisions: {
      primary: "AUTHORITATIVE_SOURCE_DENSITY_REQUIRES_TRANSFORM",
      timedSymbolicMvp: "TIMED_SYMBOLIC_MVP_CONDITIONAL",
      realSymbolicAlignment: "REAL_SYMBOLIC_ALIGNMENT_PARTIAL",
      musicalQuality: "MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED",
    },
  };
  const canonicalSha256 = sha256Hex(new TextEncoder().encode(stableJson(reportWithoutDigest)));
  const report = { ...reportWithoutDigest, determinism: { canonicalSha256 } };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outputPath = resolve(ROOT, options.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, text, "utf8");
  }
  else process.stdout.write(text);
}

if (process.argv[1]?.endsWith("audit-playability.ts")) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`audit-playability: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
