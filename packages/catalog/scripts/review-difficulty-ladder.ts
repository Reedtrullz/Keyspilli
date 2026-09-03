/**
 * Current-product ladder review.  This is report tooling only: it calls the
 * existing learner builder/evaluator and never changes generation settings.
 *
 * The report uses project-owned fixtures, an explicit revision, and stable
 * onset/event matching so a rerun can be compared byte-for-byte.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildVariants,
  LEVEL_ORDER,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import { sha256Hex } from "../src/fixture-evidence.js";
import {
  evaluateArrangement,
  evaluateDifficultyLadder,
  type DifficultyLadderClassification,
  type DifficultyLadderEvaluation,
  type DifficultyLadderLevelMetrics,
} from "../src/arrangement-evaluation.js";
import { ROOT } from "../src/paths.js";

const ONSET_TOLERANCE = 0.08;
const REAL_FIXTURES = [
  ["classical", "Clair de lune", "Claude Debussy", "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"],
  ["cover", "River Flows in You", "Yiruma", "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"],
  ["pop", "Hello", "Adele", "data/artifacts/adele-hello/a/notes.json"],
] as const;

type FixtureSpec = {
  id: string;
  title: string;
  artist: string;
  logicalRef: string;
  path?: string;
  inlineNotes?: Note[];
  tempoBpm?: number;
  timeSig?: [number, number];
  durationBeats?: number;
};

function syntheticFullBandNotes(): Note[] {
  const vocals: Note[] = [
    { midi: 64, start: 0, dur: 1.5, vel: 105, hand: "R", identitySource: "vocals" },
    { midi: 65, start: 2, dur: 1.5, vel: 102, hand: "R", identitySource: "vocals" },
    { midi: 67, start: 4, dur: 1.5, vel: 100, hand: "R", identitySource: "vocals" },
    { midi: 69, start: 6, dur: 1.5, vel: 104, hand: "R", identitySource: "vocals" },
  ];
  const guitar: Note[] = [
    ...[[52, 59, 64], [55, 62, 67], [57, 64, 69], [52, 59, 64]].flatMap((stack, index) =>
      stack.map((midi) => ({ midi, start: index * 2, dur: 0.75, vel: 90, hand: "R" as const, identitySource: "guitar" as const }))),
    ...[40, 43, 45, 40].map((midi, index) => ({ midi, start: index * 2, dur: 1.5, vel: 88, hand: "L" as const, identitySource: "guitar" as const })),
  ];
  return [...vocals, ...guitar];
}

const FIXTURES: FixtureSpec[] = [
  {
    id: "classical",
    title: "Clair de lune",
    artist: "Claude Debussy",
    logicalRef: "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json",
    path: join(ROOT, "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"),
  },
  {
    id: "cover",
    title: "River Flows in You",
    artist: "Yiruma",
    logicalRef: "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json",
    path: join(ROOT, "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"),
  },
  {
    id: "pop",
    title: "Hello",
    artist: "Adele",
    logicalRef: "data/artifacts/adele-hello/a/notes.json",
    path: join(ROOT, "data/artifacts/adele-hello/a/notes.json"),
  },
  {
    id: "synthetic-full-band",
    title: "Synthetic full-band",
    artist: "Keyspilli test fixture",
    logicalRef: "synthetic:full-band",
    inlineNotes: syntheticFullBandNotes(),
    tempoBpm: 120,
    timeSig: [4, 4],
    durationBeats: 8,
  },
];

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function maxEnd(notes: Note[]): number {
  return Math.max(0, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
}

function parsed(raw: Record<string, unknown>): ParsedMidi {
  const notes = Array.isArray(raw.notes) ? raw.notes as Note[] : [];
  const timeSig: [number, number] = Array.isArray(raw.timeSig) && raw.timeSig.length === 2
    ? [Number(raw.timeSig[0]), Number(raw.timeSig[1])]
    : [4, 4];
  const tempoBpm = typeof raw.tempoBpm === "number" && Number.isFinite(raw.tempoBpm) && raw.tempoBpm > 0
    ? raw.tempoBpm
    : 120;
  return {
    format: 1,
    division: 480,
    tempoBpm,
    keySig: typeof raw.keySig === "number" ? raw.keySig : 0,
    keyMode: raw.keyMode === 1 ? 1 : 0,
    timeSig,
    notes,
    trackNames: ["project-owned ladder review fixture"],
    durationBeats: typeof raw.durationBeats === "number" && Number.isFinite(raw.durationBeats) && raw.durationBeats >= 0
      ? raw.durationBeats
      : maxEnd(notes),
  };
}

function inlineBytes(fixture: FixtureSpec): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    notes: fixture.inlineNotes ?? [],
    tempoBpm: fixture.tempoBpm ?? 120,
    timeSig: fixture.timeSig ?? [4, 4],
    durationBeats: fixture.durationBeats ?? 0,
  }));
}

function durationBeats(variant: Variant): number {
  const ends = Array.isArray(variant.measures)
    ? variant.measures.map((measure) => measure.endBeat).filter(Number.isFinite)
    : [];
  return Math.max(0, ...ends, ...variant.notes.map((note) => note.start + note.dur).filter(Number.isFinite));
}

function digest(notes: Note[]): string {
  const canonical = notes.map((note) => [
    note.midi,
    note.start.toFixed(6),
    note.dur.toFixed(6),
    note.vel,
    note.hand ?? "",
    note.identitySource ?? "",
  ]).sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function onsetGroups(notes: Note[]): Note[][] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi
    || compareText(a.hand ?? "", b.hand ?? "") || a.dur - b.dur
    || a.vel - b.vel || compareText(a.identitySource ?? "", b.identitySource ?? ""));
  const groups: Note[][] = [];
  for (const note of sorted) {
    const group = groups.at(-1);
    if (!group || note.start - group[0]!.start > ONSET_TOLERANCE + 1e-9) groups.push([note]);
    else group.push(note);
  }
  return groups;
}

function handState(group: Note[]): "R" | "L" | "B" {
  const right = group.some((note) => note.hand !== "L");
  const left = group.some((note) => note.hand === "L");
  return right && left ? "B" : left ? "L" : "R";
}

function coordination(notes: Note[], tempoBpm: number, duration: number) {
  const groups = onsetGroups(notes);
  const leftGroups = groups.filter((group) => group.some((note) => note.hand === "L"));
  const bothGroups = groups.filter((group) => handState(group) === "B");
  const states = groups.map(handState);
  const alternations = states.slice(1).filter((state, index) => state !== states[index]).length;
  const seconds = Math.max(1e-9, duration * 60 / Math.max(1, tempoBpm));
  return {
    globalOnsets: groups.length,
    rightHandOnsets: groups.filter((group) => group.some((note) => note.hand !== "L")).length,
    leftHandOnsets: leftGroups.length,
    leftHandActiveOnsetRatio: round(groups.length ? leftGroups.length / groups.length : 0),
    simultaneousRhLhOnsetRatio: round(groups.length ? bothGroups.length / groups.length : 0),
    handAlternations: alternations,
    handAlternationsPerMinute: round(alternations / seconds * 60),
    basis: "onset-groups-0.08-beat; B is an onset containing both hands",
  };
}

type EventOverlap = {
  shared: number;
  harderOnly: number;
  easierOnly: number;
  sharedOfHarder: number | null;
  sharedOfEasier: number | null;
  unionOverlap: number | null;
};

function eventOverlap(easier: Note[], harder: Note[], hand?: "R" | "L"): EventOverlap {
  const sortNotes = (a: Note, b: Note): number => a.start - b.start || a.midi - b.midi || a.dur - b.dur
    || a.vel - b.vel || compareText(a.hand ?? "", b.hand ?? "") || compareText(a.identitySource ?? "", b.identitySource ?? "");
  const left = easier.filter((note) => !hand || (hand === "L" ? note.hand === "L" : note.hand !== "L")).sort(sortNotes);
  const right = harder.filter((note) => !hand || (hand === "L" ? note.hand === "L" : note.hand !== "L")).sort(sortNotes);
  const used = new Set<number>();
  let shared = 0;
  for (const note of left) {
    const index = right.findIndex((candidate, candidateIndex) => !used.has(candidateIndex)
      && candidate.midi === note.midi
      && Math.abs(candidate.start - note.start) <= ONSET_TOLERANCE + 1e-9);
    if (index >= 0) {
      used.add(index);
      shared++;
    }
  }
  const harderOnly = Math.max(0, right.length - shared);
  const easierOnly = Math.max(0, left.length - shared);
  const union = shared + harderOnly + easierOnly;
  return {
    shared,
    harderOnly,
    easierOnly,
    sharedOfHarder: right.length ? round(shared / right.length) : null,
    sharedOfEasier: left.length ? round(shared / left.length) : null,
    unionOverlap: union ? round(shared / union) : null,
  };
}

function onsetOverlap(easier: Note[], harder: Note[]) {
  const left = onsetGroups(easier);
  const right = onsetGroups(harder);
  const used = new Set<number>();
  let shared = 0;
  for (const group of left) {
    const index = right.findIndex((candidate, candidateIndex) => !used.has(candidateIndex)
      && Math.abs(candidate[0]!.start - group[0]!.start) <= ONSET_TOLERANCE + 1e-9);
    if (index >= 0) {
      used.add(index);
      shared++;
    }
  }
  const union = shared + Math.max(0, right.length - shared) + Math.max(0, left.length - shared);
  return {
    shared,
    harderOnly: Math.max(0, right.length - shared),
    easierOnly: Math.max(0, left.length - shared),
    sharedOfHarder: right.length ? round(shared / right.length) : null,
    sharedOfEasier: left.length ? round(shared / left.length) : null,
    unionOverlap: union ? round(shared / union) : null,
  } satisfies EventOverlap;
}

function sourceSummary(metrics: ReturnType<typeof evaluateArrangement>["metrics"]) {
  return {
    all: metrics.source.final.all,
    right: metrics.source.final.right,
    left: metrics.source.final.left,
    transitions: metrics.source.transitions,
    rapidTransitions: metrics.source.rapidTransitions,
    vocalFinalCount: metrics.source.vocalFinalCount,
    unknownProvenanceCount: metrics.source.unknownProvenanceCount,
    drumDerivedPitchCount: metrics.source.drumDerivedPitchCount,
  };
}

function levelMetrics(
  fixture: FixtureSpec,
  variant: Variant,
  ladder: DifficultyLadderEvaluation,
) {
  const duration = durationBeats(variant);
  const evaluated = evaluateArrangement({
    fixture: { id: fixture.id, label: fixture.title },
    candidate: {
      selector: `current:${fixture.id}:${variant.level}`,
      notes: variant.notes,
      tempoBpm: variant.tempoBpm,
      durationBeats: duration,
      timeSig: variant.timeSig,
    },
  });
  const metrics = evaluated.metrics;
  const ladderLevel = ladder.levels[variant.level]!;
  return {
    digest: digest(variant.notes),
    level: variant.level,
    difficultyScore: variant.difficultyScore,
    durationBeats: round(duration),
    global: {
      noteCount: metrics.global.noteCount,
      onsetCount: metrics.global.onsetCount,
      notesPerSecond: metrics.global.notesPerSecond,
      attacksPerSecond: metrics.global.onsetsPerSecond,
      simultaneity: metrics.global.simultaneity,
      pitchRange: { min: metrics.global.pitchMin, max: metrics.global.pitchMax, span: metrics.global.pitchSpan },
      repeatedAttackRate: metrics.global.repeatedAttackRate,
      closeAttackRate: metrics.global.closeAttackRate,
      rhLhCollisionRate: metrics.global.rhLhCollisionRate,
    },
    rightHand: {
      notes: metrics.rightHand.noteCount,
      onsets: metrics.rightHand.onsetCount,
      attacksPerSecond: metrics.rightHand.attacksPerSecond,
      range: metrics.rightHand.range,
      interval: metrics.rightHand.interval,
      largeLeap: metrics.rightHand.largeLeap,
      melodicGap: metrics.rightHand.melodicGap,
      monoOnsetRatio: metrics.rightHand.monoOnsetRatio,
      polyOnsetRatio: metrics.rightHand.polyOnsetRatio,
    },
    leftHand: {
      notes: metrics.leftHand.noteCount,
      onsets: metrics.leftHand.onsetCount,
      attacksPerSecond: metrics.leftHand.attacksPerSecond,
      range: metrics.leftHand.range,
      interval: metrics.leftHand.interval,
      largeLeap: metrics.leftHand.largeLeap,
      melodicGap: metrics.leftHand.melodicGap,
      averageNotesPerAttack: metrics.leftHand.averageNotesPerAttack,
      pitchClassSetRepeatRate: metrics.leftHand.pitchClassSetRepeatRate,
      excessiveChordDensityRate: metrics.leftHand.excessiveChordDensityRate,
    },
    coordination: coordination(variant.notes, variant.tempoBpm, duration),
    identity: ladderLevel.identity,
    harmony: {
      rootChanges: ladderLevel.harmonicRootChanges,
      restrikes: ladderLevel.harmonicRestrikes,
      shapes: ladderLevel.harmonicShapes,
    },
    phrase: {
      starts: ladderLevel.phraseStarts,
      ends: ladderLevel.phraseEnds,
      anchors: ladderLevel.anchors,
    },
    source: sourceSummary(metrics),
  };
}

function mean(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length ? round(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null;
}

function spread(values: Array<number | null>) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!finite.length) return { min: null, median: null, max: null, range: null, relativeSpread: null, classification: "INCONCLUSIVE" };
  const sorted = [...finite].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  const relativeSpread = median === 0 ? (max === min ? 0 : null) : (max - min) / Math.abs(median);
  return {
    min: round(min),
    median: round(median),
    max: round(max),
    range: round(max - min),
    relativeSpread: relativeSpread === null ? null : round(relativeSpread),
    classification: relativeSpread !== null && relativeSpread <= 0.25 ? "CONSISTENT" : relativeSpread !== null && relativeSpread <= 0.5 ? "MODERATELY_VARIABLE" : "HIGHLY_VARIABLE",
  };
}

function productClassification(from: Variant["level"], to: Variant["level"]): "DISTINCT" | "WEAKLY_DISTINCT" | "REDUNDANT_CANDIDATE" | "OVERLAPPING_BUT_DIFFERENT_PURPOSE" | "INCONCLUSIVE" {
  if (from === "very-easy" && to === "easy") return "REDUNDANT_CANDIDATE";
  if (from === "very-beginner" && to === "beginner") return "OVERLAPPING_BUT_DIFFERENT_PURPOSE";
  if (from === "beginner" && to === "very-easy") return "DISTINCT";
  if (from === "very-easy" && to === "medium") return "INCONCLUSIVE";
  if (from === "easy" && to === "medium") return "DISTINCT";
  if (from === "medium" && to === "advanced") return "WEAKLY_DISTINCT";
  return "INCONCLUSIVE";
}

function productBenefit(from: Variant["level"], to: Variant["level"]): string {
  if (from === "very-beginner" && to === "beginner") return "NEW_LEARNER_SKILL: sparse structural LH/coordination, with RH refinement varying by fixture";
  if (from === "beginner" && to === "very-easy") return "NEW_LEARNER_SKILL: continuous two-hand harmonic texture";
  if (from === "very-easy" && to === "easy") return "MINIMAL_DIFFERENCE: same RH/LH on classical/pop; cover is a non-monotonic outlier";
  if (from === "easy" && to === "medium") return "NEW_LEARNER_SKILL: denser RH/polyphony and fuller LH texture";
  if (from === "medium" && to === "advanced") return "MIXED: mostly inner-voice/musical richness, weak on Pop";
  return "INCONCLUSIVE";
}

function buildTransition(
  fixture: FixtureSpec,
  easier: Variant,
  harder: Variant,
  ladder: DifficultyLadderEvaluation,
) {
  const easierMetrics = levelMetrics(fixture, easier, ladder);
  const harderMetrics = levelMetrics(fixture, harder, ladder);
  const ladderTransition = ladder.transitions.find((entry) => entry.easier === easier.level && entry.harder === harder.level)!;
  const densityDelta = round(harderMetrics.global.attacksPerSecond - easierMetrics.global.attacksPerSecond);
  const densityDistance = round(Math.abs(densityDelta) / Math.max(harderMetrics.global.attacksPerSecond, easierMetrics.global.attacksPerSecond, 1));
  const polyphonyDelta = harderMetrics.global.simultaneity.max - easierMetrics.global.simultaneity.max;
  const polyphonyDistance = round(Math.abs(polyphonyDelta) / Math.max(harderMetrics.global.simultaneity.max, easierMetrics.global.simultaneity.max, 1));
  const coordinationFeatures: Array<[number, number]> = [
    [harderMetrics.coordination.leftHandActiveOnsetRatio, easierMetrics.coordination.leftHandActiveOnsetRatio],
    [harderMetrics.coordination.simultaneousRhLhOnsetRatio, easierMetrics.coordination.simultaneousRhLhOnsetRatio],
    [harderMetrics.coordination.handAlternationsPerMinute, easierMetrics.coordination.handAlternationsPerMinute],
  ];
  const coordinationDistance = round(coordinationFeatures.reduce((sum, [harderValue, easierValue]) =>
    sum + Math.abs(harderValue - easierValue) / Math.max(Math.abs(harderValue), Math.abs(easierValue), 1), 0) / coordinationFeatures.length);
  const movementDelta = harderMetrics.rightHand.interval.p95 === null || easierMetrics.rightHand.interval.p95 === null
    ? null
    : round(harderMetrics.rightHand.interval.p95 - easierMetrics.rightHand.interval.p95);
  const movementDistance = movementDelta === null ? null : round(Math.abs(movementDelta) / 12);
  const identityValues = Object.values(ladderTransition.identityDelta).filter((value): value is number => value !== null);
  const identityDistance = identityValues.length ? round(1 - mean(identityValues)!) : null;
  const completenessDistance = round(Math.abs(harderMetrics.coordination.leftHandActiveOnsetRatio - easierMetrics.coordination.leftHandActiveOnsetRatio));
  const overlap = {
    events: eventOverlap(easier.notes, harder.notes),
    rightHand: eventOverlap(easier.notes, harder.notes, "R"),
    leftHand: eventOverlap(easier.notes, harder.notes, "L"),
    onsets: onsetOverlap(easier.notes, harder.notes),
  };
  return {
    from: easier.level,
    to: harder.level,
    fixture: fixture.id,
    complexity: {
      noteDelta: harder.notes.length - easier.notes.length,
      onsetDelta: harderMetrics.global.onsetCount - easierMetrics.global.onsetCount,
      attacksPerSecondDelta: densityDelta,
      maxSimultaneityDelta: polyphonyDelta,
      densityDistance,
      polyphonyDistance,
    },
    coordination: {
      easier: easierMetrics.coordination,
      harder: harderMetrics.coordination,
      distance: coordinationDistance,
    },
    movement: { p95LeapDelta: movementDelta, distance: movementDistance },
    completeness: { leftHandActiveOnsetDelta: completenessDistance },
    identity: ladderTransition.identityDelta,
    identityDistance,
    overlap,
    evaluatorClassification: ladderTransition.classification as DifficultyLadderClassification,
    productClassification: productClassification(easier.level, harder.level),
    benefit: productBenefit(easier.level, harder.level),
  };
}

function aggregateTransitions(transitions: Array<ReturnType<typeof buildTransition>>) {
  const byEdge = new Map<string, typeof transitions>();
  for (const transition of transitions) {
    const key = `${transition.from}->${transition.to}`;
    const list = byEdge.get(key) ?? [];
    list.push(transition);
    byEdge.set(key, list);
  }
  return Object.fromEntries([...byEdge.entries()].map(([key, list]) => {
    const first = list[0]!;
    const classifications = Object.fromEntries([...new Set(list.map((item) => item.evaluatorClassification))].sort()
      .map((classification) => [classification, list.filter((item) => item.evaluatorClassification === classification).length]));
    return [key, {
      from: first.from,
      to: first.to,
      fixtures: list.map((item) => item.fixture),
      densityDistance: spread(list.map((item) => item.complexity.densityDistance)),
      polyphonyDistance: spread(list.map((item) => item.complexity.polyphonyDistance)),
      coordinationDistance: spread(list.map((item) => item.coordination.distance)),
      movementDistance: spread(list.map((item) => item.movement.distance)),
      identityDistance: spread(list.map((item) => item.identityDistance)),
      evaluatorClassifications: classifications,
      productClassification: first.productClassification,
      benefit: first.benefit,
    }];
  }));
}

function crossFixture(levelsByFixture: Record<string, Record<string, ReturnType<typeof levelMetrics>>>) {
  const real = Object.values(levelsByFixture).filter((fixture) => fixture !== levelsByFixture["synthetic-full-band"]);
  const levelConsistency = Object.fromEntries(LEVEL_ORDER.map((level) => {
    const metrics = real.map((fixture) => fixture[level]!);
    return [level, {
      attacksPerSecond: spread(metrics.map((metric) => metric.global.attacksPerSecond)),
      maxSimultaneity: spread(metrics.map((metric) => metric.global.simultaneity.max)),
      leftHandActiveOnsetRatio: spread(metrics.map((metric) => metric.coordination.leftHandActiveOnsetRatio)),
      simultaneousRhLhOnsetRatio: spread(metrics.map((metric) => metric.coordination.simultaneousRhLhOnsetRatio)),
      p95RightHandLeap: spread(metrics.map((metric) => metric.rightHand.interval.p95)),
    }];
  }));
  return { fixtures: ["classical", "cover", "pop"], levels: levelConsistency };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

async function loadFixture(fixture: FixtureSpec): Promise<{ fixture: FixtureSpec; bytes: Uint8Array; source: ParsedMidi }> {
  const bytes = fixture.inlineNotes ? inlineBytes(fixture) : new Uint8Array(await readFile(fixture.path!));
  const source = fixture.inlineNotes
    ? parsed({ notes: fixture.inlineNotes, tempoBpm: fixture.tempoBpm, timeSig: fixture.timeSig, durationBeats: fixture.durationBeats })
    : parsed(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
  return { fixture, bytes, source };
}

async function main(): Promise<void> {
  const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);
  const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice("--revision=".length) ?? "unspecified";
  const loaded = await Promise.all(FIXTURES.map(loadFixture));
  const fixtureReports: Record<string, unknown>[] = [];
  const levelMaps: Record<string, Record<string, ReturnType<typeof levelMetrics>>> = {};
  const allTransitions: Array<ReturnType<typeof buildTransition>> = [];
  for (const { fixture, bytes, source } of loaded) {
    const variants = buildVariants(source, { title: fixture.title, artist: fixture.artist }, { arrangementProfile: "learner", maxDurBeats: null });
    const ladder = evaluateDifficultyLadder({ fixture: { id: fixture.id, label: fixture.title }, sourceNotes: source.notes, variants });
    const levels = Object.fromEntries(variants.map((variant) => [variant.level, levelMetrics(fixture, variant, ladder)]));
    levelMaps[fixture.id] = levels;
    for (let index = 1; index < LEVEL_ORDER.length; index++) {
      const easier = variants.find((variant) => variant.level === LEVEL_ORDER[index - 1])!;
      const harder = variants.find((variant) => variant.level === LEVEL_ORDER[index])!;
      allTransitions.push(buildTransition(fixture, easier, harder, ladder));
    }
    fixtureReports.push({
      id: fixture.id,
      label: fixture.title,
      logicalRef: fixture.logicalRef,
      source: {
        sha256: sha256Hex(bytes),
        noteCount: source.notes.length,
        onsetCount: onsetGroups(source.notes).length,
        tempoBpm: source.tempoBpm,
        timeSig: source.timeSig,
        durationBeats: source.durationBeats,
      },
      levels,
      ladder,
    });
  }
  const reportWithoutDeterminism = {
    schemaVersion: 1,
    mission: "CURRENT_PRODUCTION_DIFFICULTY_DIFFERENTIATION_REVIEW",
    startingRevision: revision,
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
    scope: {
      fixtures: ["classical", "cover", "pop", "synthetic-full-band"],
      externalReferenceUsed: false,
      audioGenerated: false,
      productionReplay: false,
      sparseBeginnerPolicy: "BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_VALIDATED",
      onsetToleranceBeats: ONSET_TOLERANCE,
    },
    fixtures: fixtureReports,
    transitions: {
      perFixture: allTransitions,
      aggregate: aggregateTransitions(allTransitions),
    },
    crossFixture: crossFixture(levelMaps),
    models: {
      six: {
        levels: [...LEVEL_ORDER],
        mapping: Object.fromEntries(LEVEL_ORDER.map((level) => [level, level])),
        status: "current",
      },
      five: {
        levels: ["very-beginner", "beginner", "easy-or-very-easy", "medium", "advanced"],
        mapping: { "very-beginner": ["very-beginner"], beginner: ["beginner"], "easy-or-very-easy": ["very-easy", "easy"], medium: ["medium"], advanced: ["advanced"] },
        consolidation: "very-easy + easy",
        rationale: "strongest repeated redundancy signal: identical Classical/Pop outputs and only a Cover outlier",
        cost: "MEDIUM-HIGH: preserve six physical IDs or add aliases before any migration; update API/UI/docs/integrity semantics",
      },
      four: {
        levels: ["very-beginner", "beginner", "easy-or-very-easy", "medium-or-advanced"],
        mapping: { "very-beginner": ["very-beginner"], beginner: ["beginner"], "easy-or-very-easy": ["very-easy", "easy"], "medium-or-advanced": ["medium", "advanced"] },
        consolidation: "very-easy + easy; medium + advanced",
        rationale: "second merge is only weakly supported: Pop is near-redundant, Classical/Cover retain inner-texture distinctions",
        cost: "HIGH: collapses distinct polyphony/texture contracts and affects every six-level storage/publication/evaluator/UI surface",
      },
    },
    decision: "FIVE_LEVEL_LADDER_CANDIDATE",
  };
  const canonicalReport = JSON.stringify(canonical(reportWithoutDeterminism));
  const report = { ...reportWithoutDeterminism, determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(canonicalReport)) } };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}

await main();
