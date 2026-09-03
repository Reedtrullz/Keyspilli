/**
 * Read-only, path-free diagnostic for the preregistered Beginner RH frontier.
 * It requires the project-owned symbolic fixture data mounted under `data/`;
 * no generated MIDI is written.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildVariants, type MetalArrangementTraceEvent, type Note, type ParsedMidi } from "@keyspilli/midi";
import { canonicalBeginnerOffGridRhFrontierJson, evaluateBeginnerOffGridRhFrontier, type BeginnerOffGridRhFrontierReport } from "../src/beginner-offgrid-rh-frontier.js";
import { evaluateCoverRhIdentityCliff } from "../src/cover-rh-cliff.js";
import { ROOT } from "../src/paths.js";

type Fixture = { id: "classical" | "cover" | "pop"; label: string; logicalRef: string; path: string };
type LegacyCoverAttribution = {
  mission: "CURRENT_COVER_RH_IDENTITY_CLIFF_ATTRIBUTION";
  status: string;
  decision: string;
  classification: string;
  expectedStructurallySignificantLostEvents: 320;
  structurallySignificantLostEvents: number;
  recoverableWithinCurrentEnvelope: number;
  constraintBound: number;
  matchesExpected320: boolean;
};
type FixtureReport = BeginnerOffGridRhFrontierReport & { logicalRef: string; sourceArtifact: { bytes: number; sha256: string }; legacyCoverAttribution?: LegacyCoverAttribution };
const FIXTURES: Fixture[] = [
  { id: "classical", label: "Clair de lune", logicalRef: "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json", path: join(ROOT, "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json") },
  { id: "cover", label: "River Flows in You", logicalRef: "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json", path: join(ROOT, "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json") },
  { id: "pop", label: "Hello", logicalRef: "data/artifacts/adele-hello/a/notes.json", path: join(ROOT, "data/artifacts/adele-hello/a/notes.json") },
];

function numberOr(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

function parsed(value: unknown): ParsedMidi {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const notes = Array.isArray(record.notes) ? record.notes as Note[] : [];
  const timeSig: [number, number] = Array.isArray(record.timeSig) && record.timeSig.length === 2
    ? [numberOr(record.timeSig[0], 4), numberOr(record.timeSig[1], 4)] : [4, 4];
  return { format: Number.isInteger(record.format) ? Number(record.format) : 1, division: Number.isInteger(record.division) ? Number(record.division) : 480, tempoBpm: numberOr(record.tempoBpm, 120), keySig: Number.isInteger(record.keySig) ? Number(record.keySig) : 0, keyMode: record.keyMode === 1 ? 1 : 0, timeSig, notes, trackNames: ["project-owned off-grid RH diagnostic"], durationBeats: Math.max(0, numberOr(record.durationBeats, 0), ...notes.map((note) => note.start + note.dur).filter(Number.isFinite)) };
}

const BEGINNER_OFFGRID_CANDIDATE = Symbol.for("keyspilli.beginner-offgrid-rh-candidate");

function eventTuple(note: Note): string {
  return JSON.stringify([
    note.hand ?? "R",
    note.midi,
    note.start.toFixed(9),
    note.dur.toFixed(9),
    note.vel,
    note.identitySource ?? "unknown",
  ]);
}

function preCandidateABaseline(notes: Note[]): Note[] {
  // The marker is development-only but remains enumerable through the
  // learner variant copy. Strip exactly those events before handing the
  // post-promotion variant to the counterfactual frontier evaluator.
  const promoted = new Set(notes
    .filter((note) => (note as Note & Record<symbol, unknown>)[BEGINNER_OFFGRID_CANDIDATE] === true)
    .map(eventTuple));
  return notes.filter((note) => !promoted.has(eventTuple(note)));
}

async function evaluateFixture(fixture: Fixture, revision: string): Promise<FixtureReport> {
  const bytes = await readFile(fixture.path);
  const source = parsed(JSON.parse(new TextDecoder().decode(bytes)));
  const trace: MetalArrangementTraceEvent[] = [];
  const variants = buildVariants(source, { title: fixture.label, artist: "project-owned diagnostic" }, { arrangementProfile: "learner", maxDurBeats: null, trace: { record: (event) => trace.push(event) } });
  const beginner = variants.find((variant) => variant.level === "beginner");
  const report = evaluateBeginnerOffGridRhFrontier({
    fixture: { id: fixture.id, label: fixture.label },
    sourceNotes: source.notes,
    variants,
    baselineNotes: beginner ? preCandidateABaseline(beginner.notes) : undefined,
    trace,
    revision,
  });
  const sourceArtifact = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  if (fixture.id !== "cover") return { ...report, logicalRef: fixture.logicalRef, sourceArtifact };
  const legacy = evaluateCoverRhIdentityCliff({ fixture: { id: fixture.id, label: fixture.label }, source: source.notes, variants, trace, revision });
  return {
    ...report,
    logicalRef: fixture.logicalRef,
    sourceArtifact,
    legacyCoverAttribution: {
      mission: legacy.mission,
      status: legacy.status,
      decision: legacy.decision,
      classification: legacy.characterization.classification,
      expectedStructurallySignificantLostEvents: 320,
      structurallySignificantLostEvents: legacy.playability.structurallySignificantLostEvents,
      recoverableWithinCurrentEnvelope: legacy.playability.recoverableWithinCurrentEnvelope,
      constraintBound: legacy.playability.constraintBound,
      matchesExpected320: legacy.playability.structurallySignificantLostEvents === 320 && legacy.playability.constraintBound === 320,
    },
  };
}

function identityNotWorse(candidate: BeginnerOffGridRhFrontierReport["candidates"]["candidate-a"], baseline: BeginnerOffGridRhFrontierReport["candidates"]["baseline"]): boolean {
  const keys: Array<keyof typeof candidate.identity> = ["rhEventSurvival", "rhOnsetSurvival", "pitchClassSurvival", "anchorSurvival", "turnSurvival", "localExtremaSurvival", "repeatedAttackSurvival"];
  return keys.every((key) => {
    const before = baseline.identity[key];
    const after = candidate.identity[key];
    return before === null || (after !== null && after + 1e-9 >= before);
  });
}

function noMaterialDensification(report: BeginnerOffGridRhFrontierReport): boolean {
  const baseline = report.candidates.baseline;
  return ["candidate-a", "candidate-b"].every((key) => {
    const candidate = report.candidates[key as "candidate-a" | "candidate-b"];
    return candidate.emitted === 0 && candidate.metrics.notes === baseline.metrics.notes && candidate.metrics.onsets === baseline.metrics.onsets;
  });
}

function frozenPlayability(report: BeginnerOffGridRhFrontierReport): boolean {
  return report.controls.frozenPlayabilityConstraints;
}

async function main(): Promise<void> {
  const outIndex = process.argv.indexOf("--out");
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? (outIndex >= 0 ? process.argv[outIndex + 1] : undefined);
  const revisionIndex = process.argv.indexOf("--revision");
  const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice(11) ?? (revisionIndex >= 0 ? process.argv[revisionIndex + 1] : undefined) ?? "unspecified";
  const reports = await Promise.all(FIXTURES.map((fixture) => evaluateFixture(fixture, revision)));
  const cover = reports.find((report) => report.fixture.id === "cover");
  const classical = reports.find((report) => report.fixture.id === "classical");
  const pop = reports.find((report) => report.fixture.id === "pop");
  const legacyCoverAttribution = cover?.legacyCoverAttribution ?? null;
  const crossFixtureControls = {
    coverLegacy320: Boolean(legacyCoverAttribution?.matchesExpected320),
    classicalNoMaterialDensification: classical ? noMaterialDensification(classical) : false,
    popNoMaterialDensification: pop ? noMaterialDensification(pop) : false,
    classicalNoIdentityRegression: classical ? identityNotWorse(classical.candidates["candidate-a"], classical.candidates.baseline) && identityNotWorse(classical.candidates["candidate-b"], classical.candidates.baseline) : false,
    popNoIdentityRegression: pop ? identityNotWorse(pop.candidates["candidate-a"], pop.candidates.baseline) && identityNotWorse(pop.candidates["candidate-b"], pop.candidates.baseline) : false,
    exactBeginnerLh: reports.every((report) => report.controls.lhUnchanged),
    frozenPlayability: reports.every(frozenPlayability),
    noRetiming: reports.every((report) => report.controls.noRetiming),
    nonBeginnerUnchanged: reports.every((report) => report.controls.nonBeginnerUnchanged),
  };
  const candidateARecoveryRatio = cover && cover.candidates["candidate-b"].recoveredStructural > 0
    ? cover.candidates["candidate-a"].recoveredStructural / cover.candidates["candidate-b"].recoveredStructural
    : null;
  const promotionGateBlockers = [
    ...(candidateARecoveryRatio === null || candidateARecoveryRatio < 0.5 ? ["candidate A recovers less than 50% of candidate B"] : []),
    ...(cover?.publicSeparation.candidateAbelowEasy !== true ? ["candidate A is not below Easy"] : []),
    ...(crossFixtureControls.exactBeginnerLh ? [] : ["Beginner LH changed"]),
    ...(crossFixtureControls.frozenPlayability ? [] : ["frozen playability constraint failed"]),
    ...(crossFixtureControls.classicalNoMaterialDensification && crossFixtureControls.popNoMaterialDensification ? [] : ["Classical/Pop densification changed"]),
    ...(crossFixtureControls.classicalNoIdentityRegression && crossFixtureControls.popNoIdentityRegression ? [] : ["Classical/Pop identity regressed"]),
    ...(crossFixtureControls.coverLegacy320 ? [] : ["Cover legacy 320 attribution did not match"]),
  ];
  const promotionGate = {
    candidateARecoveryRatio,
    candidateARecoveryAtLeastHalfB: candidateARecoveryRatio !== null && candidateARecoveryRatio >= 0.5,
    exactBeginnerLh: crossFixtureControls.exactBeginnerLh,
    frozenPlayability: crossFixtureControls.frozenPlayability,
    candidateABelowEasy: cover?.publicSeparation.candidateAbelowEasy === true,
    classicalPopNoMaterialDensification: crossFixtureControls.classicalNoMaterialDensification && crossFixtureControls.popNoMaterialDensification,
    classicalPopNoIdentityRegression: crossFixtureControls.classicalNoIdentityRegression && crossFixtureControls.popNoIdentityRegression,
    coverLegacy320: crossFixtureControls.coverLegacy320,
    candidateBPromoted: false as const,
    passed: promotionGateBlockers.length === 0,
    blockers: promotionGateBlockers,
  };
  const decision = promotionGate.passed
    ? "BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED"
    : cover?.decision === "BEGINNER_OFFGRID_RH_COLLAPSES_PUBLIC_SEPARATION"
      ? cover.decision
      : promotionGateBlockers.length
        ? "BEGINNER_OFFGRID_RH_BLOCKED_BY_OTHER_CONSTRAINTS"
        : cover?.decision ?? "BEGINNER_OFFGRID_RH_GAIN_TOO_SMALL";
  const fixtureJson = reports.map((report) => {
    const { legacyCoverAttribution: _legacyCoverAttribution, ...fixture } = report;
    return { ...JSON.parse(canonicalBeginnerOffGridRhFrontierJson(fixture)), logicalRef: report.logicalRef };
  });
  const text = JSON.stringify(canonicalAggregate({
    schemaVersion: 1,
    mission: "BEGINNER_OFF_GRID_INTERIOR_RH_BUDGET_FRONTIER",
    revision: redactPath(revision),
    behavior: "NO_MUSICAL_BEHAVIOR_CHANGE",
    decision,
    promotionGate,
    crossFixtureControls,
    legacyCoverAttribution,
    fixtures: fixtureJson,
  }), null, 2) + "\n";
  if (out) { await writeFile(out, text); process.stderr.write(`beginner-offgrid-rh-frontier: wrote ${out}\n`); }
  else process.stdout.write(text);
}

function redactPath(value: string): string {
  return value.replace(/(?:file:\/\/)?(?:\/Users\/|\/private\/tmp\/|[A-Za-z]:[\\/])[^\s"']+/g, "<redacted-path>");
}

function canonicalAggregate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAggregate);
  if (typeof value === "string") return redactPath(value);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalAggregate(item)]));
  }
  return value;
}

await main();
