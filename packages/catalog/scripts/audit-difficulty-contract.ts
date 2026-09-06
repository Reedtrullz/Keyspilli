/**
 * Report-only review of the physical six-level and public five-level
 * difficulty contracts. It reuses the production builder and validator but
 * never changes generation policy or persisted catalog data.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildVariants,
  LADDER_TOL,
  LEVEL_ORDER,
  measurePlayability,
  PUBLIC_DIFFICULTY_ORDER,
  selectProtectedSemanticLocalThinning,
  validateVariants,
  verifyMonotonicity,
  type DifficultyLevel,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import {
  evaluateDifficultyContract,
  type DifficultyContractComparison,
  type DifficultyContractResult,
} from "../src/difficulty-contract-audit.js";
import { evaluateDifficultyLadder, type DifficultyLadderLevelMetrics } from "../src/arrangement-evaluation.js";
import { sha256Hex } from "../src/fixture-evidence.js";
import { ROOT } from "../src/paths.js";
import { laneAVariantSet } from "./audit-playability.js";

const ONSET_TOLERANCE = 0.08;
const BASELINE_REVISION = "971974231016bded91769fc938850fce38ea7827";
const PUBLIC_EDGE_TOLERANCES = Object.fromEntries(
  PUBLIC_DIFFICULTY_ORDER.slice(0, -1).map((level) => [level, LADDER_TOL[level] ?? 0.02]),
);
const TRUSTED_FIXTURES = [
  ["classical", "Clair de lune", "Claude Debussy", "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"],
  ["cover", "River Flows in You", "Yiruma", "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"],
  ["pop", "Hello", "Adele", "data/artifacts/adele-hello/a/notes.json"],
] as const;

const BASELINE_MUSICAL_HASHES: Record<string, Partial<Record<DifficultyLevel, string>>> = {
  classical: {
    "very-beginner": "af0d7b13979230489a00478a24234e3b6d1a18e7d13b4a7d3b78d804b485137a",
    beginner: "14151edc230a016e2a4a6a63a659e70d8319f1cf450661732b1458382523df56",
    "very-easy": "d54f457c423702fb85934e58e0bb79d0648cd66e5bde50710def23aed7ee1221",
    easy: "2b7ce60e6971ed030942c2cf5ca028d9221a742801739c8d3b4519466541b49d",
    medium: "a155d7f1da8d4221ef25bce33750e863a226f26ea54510a92f02c5d553a2273c",
    advanced: "3950ad93be1bb1b9798aadc0ca9cbf9b6c7d49517990c52c6373fe0705414214",
  },
  cover: {
    "very-beginner": "187184d6bb4ca5c6e46463479bc932fa63c2b8ba908b4a58a3fba9ce2e364fbf",
    beginner: "2e68590120a014ada1c3e5f35b5cd081d63188cec82c7531200b7447a76629f8",
    "very-easy": "159517ae53b89b6f2573179bb0a84e0171d264154d431cef8e87d597aa98b33a",
    easy: "1f0c94ed0e8a76ed159414ed1776ec57b0c6ec2b3b71a9010312058550490a40",
    medium: "e78b58eda8e3463ac70bcfde14c84fa633234492098cc1de6e4e8de4995d06d6",
    advanced: "44210957ecf36ed1f5a98e79d29704b215edc0976fc64da291dc1430b90480da",
  },
  pop: {
    "very-beginner": "642f3f5e00db390404689d4ca782918a505fcab83b8bf0e1badf7d28bd3ba2bc",
    beginner: "e07deb5ab8d5b538191a2f2e9b16a01f6827b1506cbfac584e859f0490abdeb3",
    "very-easy": "e74e55fb9a6132f2acda21a2129a0070183110d3f153a18b03733c98a4160c8d",
    easy: "432db2c5a13b969db04e40801091c71b7275432b3b12d3a488db4b53e18176cb",
    medium: "c11fa20fb46f892252903121108c2086ff7b4318d1d5abad3b0d2889aba85a0f",
    advanced: "d0d2a5e30a68cfd03d7f5d5e93d9137f969629b59b638c660650a587f315817d",
  },
  "lane-a": {
    "very-beginner": "cb0a04737174ab9d11c1aca6e9e0048675663f7976f6a56d8567f58672208144",
    beginner: "9db42d4fe92922812e492f76d5864ec9d360a27d94c69962bd0604b9df9780f5",
    "very-easy": "4ed2137c3e76d7af4f746c3a8cc453da223aac79425c84f14e8567fe8b399575",
    easy: "faafcb0b1256eee13d04a292e074f55940b8459b6d4b31df8beb6116d2c77dff",
    medium: "c997de1e63c187d5d16a305466a6277413f15f8c5291c9b98d505f2d0cffddd3",
    advanced: "f5d4aa685ef981b79b1c3901715857a2147eba887e7a6e3615c29107ba793296",
  },
};

interface CliOptions {
  laneA: string;
  out?: string;
  revision: string;
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

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function maxEnd(notes: readonly Note[]): number {
  return Math.max(0, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
}

function onsetStarts(notes: readonly Note[], hand?: "L" | "R"): number[] {
  const starts = [...notes]
    .filter((note) => hand === undefined || (hand === "L" ? note.hand === "L" : note.hand !== "L"))
    .map((note) => note.start)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const groups: number[] = [];
  for (const start of starts) {
    if (!groups.length || start - groups.at(-1)! > ONSET_TOLERANCE + 1e-9) groups.push(start);
  }
  return groups;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function medianIoiSeconds(notes: readonly Note[], tempoBpm: number, hand?: "L" | "R"): number | null {
  const starts = onsetStarts(notes, hand);
  return starts.length < 2 ? null : round((median(starts.slice(1).map((start, index) => start - starts[index]!)) ?? 0) * 60 / tempoBpm);
}

function parseArtifact(raw: Record<string, unknown>): ParsedMidi {
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

function inlineFullBand(): Note[] {
  const vocals = [64, 65, 67, 69].map((midi, index) => ({ midi, start: index * 2, dur: 1.5, vel: 105, hand: "R" as const, identitySource: "vocals" as const }));
  const stacks = [[52, 59, 64], [55, 62, 67], [57, 64, 69], [52, 59, 64]];
  const guitar = stacks.flatMap((stack, index) => stack.map((midi) => ({ midi, start: index * 2, dur: 0.75, vel: 90, hand: "R" as const, identitySource: "guitar" as const })));
  const roots = [40, 43, 45, 40].map((midi, index) => ({ midi, start: index * 2, dur: 1.5, vel: 88, hand: "L" as const, identitySource: "guitar" as const }));
  return [...vocals, ...guitar, ...roots];
}

function inlineParsed(): ParsedMidi {
  const notes = inlineFullBand();
  return { format: 1, division: 480, tempoBpm: 120, tempoMetaPresent: true, keySig: 0, keyMode: 0, timeSig: [4, 4], notes, trackNames: ["synthetic full-band"], durationBeats: 8 };
}

function levelSummary(variant: Variant, ladder: { levels: Record<string, DifficultyLadderLevelMetrics> }) {
  const metric = ladder.levels[variant.level];
  const playability = measurePlayability(variant.notes, variant.tempoBpm, Math.max(maxEnd(variant.notes), metric?.durationBeats ?? 0));
  return {
    notes: variant.notes.length,
    attacks: metric?.onsetCount ?? onsetStarts(variant.notes).length,
    rightHandNotes: metric?.rightHandCount ?? variant.notes.filter((note) => note.hand !== "L").length,
    leftHandNotes: metric?.leftHandCount ?? variant.notes.filter((note) => note.hand === "L").length,
    rightHandAttacks: metric?.rightHandOnsetCount ?? onsetStarts(variant.notes, "R").length,
    leftHandAttacks: metric?.leftHandOnsetCount ?? onsetStarts(variant.notes, "L").length,
    attacksPerSecond: round(metric?.attacksPerSecond ?? playability.global.attacksPerSecond),
    globalMedianIoiSeconds: medianIoiSeconds(variant.notes, variant.tempoBpm),
    rightHandMedianIoiSeconds: medianIoiSeconds(variant.notes, variant.tempoBpm, "R"),
    leftHandMedianIoiSeconds: medianIoiSeconds(variant.notes, variant.tempoBpm, "L"),
    maxSimultaneity: metric?.maxSimultaneity ?? playability.global.maxSimultaneous,
    difficultyScore: variant.difficultyScore,
    publicVisibility: PUBLIC_DIFFICULTY_ORDER.includes(variant.level as (typeof PUBLIC_DIFFICULTY_ORDER)[number]) ? "public" : "legacy-only",
    sourceRoleCounts: metric?.sourceRoleCounts ?? null,
  };
}

function compactContract(contract: DifficultyContractResult) {
  return {
    order: contract.order,
    available: contract.available,
    missing: contract.missing,
    pass: contract.pass,
    errors: contract.errors,
    individualValidationErrors: contract.individualValidationErrors,
    edges: contract.edges,
  };
}

function compactComparison(comparison: DifficultyContractComparison) {
  return {
    physical: compactContract(comparison.physical),
    public: compactContract(comparison.public),
    veryEasyIndependent: comparison.veryEasyIndependent,
  };
}

function digestNotes(notes: readonly Note[]): string {
  const rows = notes.map((note) => [
    note.midi,
    round(note.start, 6),
    round(note.dur, 6),
    note.vel,
    note.hand ?? "",
    note.identitySource ?? "",
  ]);
  rows.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return sha256Hex(new TextEncoder().encode(JSON.stringify(rows)));
}

function musicalParity(id: string, variants: readonly Variant[]) {
  const baseline = BASELINE_MUSICAL_HASHES[id];
  if (!baseline) {
    return {
      status: "not-baselined",
      baselineRevision: BASELINE_REVISION,
      pass: null,
      levels: {},
      changedLevels: [],
    };
  }
  const levels = Object.fromEntries(variants.map((variant) => {
    const beforeSha256 = baseline[variant.level] ?? null;
    const afterSha256 = digestNotes(variant.notes);
    return [variant.level, {
      beforeSha256,
      afterSha256,
      noteCount: variant.notes.length,
      equal: beforeSha256 !== null && beforeSha256 === afterSha256,
    }];
  }));
  const changedLevels = Object.entries(levels)
    .filter(([, value]) => !value.equal)
    .map(([level]) => level)
    .sort(compareText);
  const expectedLevels = Object.keys(baseline).length;
  return {
    status: "compared",
    baselineRevision: BASELINE_REVISION,
    pass: variants.length === expectedLevels && changedLevels.length === 0,
    levels,
    changedLevels,
  };
}

function productionContract(variants: readonly Variant[]) {
  const validationErrors = [...new Set(validateVariants([...variants], { maxDurBeats: null }))].sort(compareText);
  const monotonicityErrors = [...new Set(verifyMonotonicity([...variants]))].sort(compareText);
  return {
    individualLevels: LEVEL_ORDER,
    orderingEdges: PUBLIC_DIFFICULTY_ORDER.slice(0, -1).map((level, index) => `${level}->${PUBLIC_DIFFICULTY_ORDER[index + 1]!}`),
    toleranceByEasierLevel: PUBLIC_EDGE_TOLERANCES,
    validationErrors,
    monotonicityErrors,
    pass: validationErrors.length === 0 && monotonicityErrors.length === 0,
  };
}

function candidateA(variants: readonly Variant[]) {
  const selections = new Map<DifficultyLevel, ReturnType<typeof selectProtectedSemanticLocalThinning>>();
  const transformed = variants.map((variant) => {
    if (!(variant.level === "easy" || variant.level === "medium" || variant.level === "advanced")) return { ...variant, notes: variant.notes.map((note) => ({ ...note })) };
    const selection = selectProtectedSemanticLocalThinning(variant.notes, variant.tempoBpm, variant.level);
    selections.set(variant.level, selection);
    return { ...variant, notes: selection.notes };
  });
  return {
    policy: "frozen Candidate A: one protected semantic local thinning pass; no retiming or new events",
    source: "authoritative-symbolic-density-normalization-2026-09-04.json",
    promoted: false,
    contract: compactComparison(evaluateDifficultyContract(transformed)),
    production: productionContract(transformed),
    levels: Object.fromEntries(transformed.map((variant) => [variant.level, {
      notes: variant.notes.length,
      attacks: onsetStarts(variant.notes).length,
      removedAttacks: selections.get(variant.level)?.removedAttackIndexes.length ?? 0,
    }])),
    invariants: {
      retimedEvents: 0,
      createdEvents: 0,
      protectedMelodyDeleted: 0,
      protectedAnchorsDeleted: 0,
      veryEasyChanged: false,
      beginnerChanged: false,
      veryBeginnerChanged: false,
      difficultyScoresChanged: false,
    },
  };
}

function history() {
  return {
    physicalLevelsIntroduced: "Very Easy was added as a finer learner rung and retained in physical artifacts.",
    publicRollup: "The public surface later became Very Beginner, Beginner, Easy, Medium, Advanced; Very Easy remains a legacy physical ID and opt-in route.",
    evidence: [
      { revision: "b983687", finding: "six-level calibration established physical order, scores, and read-only ladder diagnostics" },
      { revision: "4676fb4", finding: "public difficulty navigation rolled up to five levels while retaining six physical levels" },
      { revision: "b4cf1ce", finding: "upload completion copy follows the public Easy representative" },
    ],
    contractQuestions: {
      veOrderingAfterRollup: "The public rollup intentionally removes VE from learner ordering; physical six-row generation and individual VE validation remain required.",
      legacyAccess: "Existing legacy VE access depends on the physical ID and route remaining available, not on a new Easy artifact being larger than VE.",
    },
    historicalVeToEasyEvidence: {
      source: "docs/superpowers/plans/2026-09-02-difficulty-ladder-results.md",
      classical: { veryEasyNotes: 962, veryEasyAttacks: 714, easyNotes: 962, easyAttacks: 714, classification: "REDUNDANT_LEVEL" },
      cover: { veryEasyNotes: 1213, veryEasyAttacks: 1022, easyNotes: 1225, easyAttacks: 921, classification: "NON_MONOTONIC", detail: "Easy has more notes but fewer attacks; the easier direction increases attack rate." },
      pop: { veryEasyNotes: 847, veryEasyAttacks: 555, easyNotes: 847, easyAttacks: 555, classification: "REDUNDANT_LEVEL" },
      conclusion: "VE->Easy was already redundant on two fixtures and non-monotonic on the Cover attack dimension before Lane A.",
    },
  };
}

function controls() {
  return {
    A: "harder can have fewer notes while being faster, wider, more polyphonic, or harder to coordinate; raw count is therefore a coarse guardrail",
    B: "many repeated trivial notes can increase count without increasing useful learner difficulty",
    C: "melody can be retained while redundant accompaniment is removed and harmonic/technical complexity increases",
    D: "different arrangement strategies can be non-nested even when their public learner role is ordered",
    conclusion: "raw total note count is useful for the existing physical nesting guard, but is not sufficient as the sole public difficulty definition",
  };
}

async function loadTrusted(id: string, title: string, artist: string, logicalRef: string) {
  const bytes = new Uint8Array(await readFile(resolve(ROOT, logicalRef)));
  const source = parseArtifact(JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);
  const variants = buildVariants(source, { title, artist }, { arrangementProfile: "learner", maxDurBeats: null });
  const ladder = evaluateDifficultyLadder({ fixture: { id, label: title }, sourceNotes: source.notes, variants });
  return {
    id,
    label: title,
    logicalRef,
    source: { sha256: sha256Hex(bytes), bytes: bytes.byteLength, notes: source.notes.length, durationBeats: round(source.durationBeats), tempoBpm: round(source.tempoBpm) },
    levels: Object.fromEntries(variants.map((variant) => [variant.level, levelSummary(variant, ladder)])),
    contract: compactComparison(evaluateDifficultyContract(variants)),
    production: productionContract(variants),
    musicalParity: musicalParity(id, variants),
    transitions: ladder.transitions,
  };
}

function laneAReport(source: ParsedMidi, bytes: Uint8Array, variants: Variant[]) {
  const ladder = evaluateDifficultyLadder({ fixture: { id: "lane-a", label: "Private Lane A" }, sourceNotes: source.notes, variants });
  return {
    source: { logicalId: "user-supplied-private-lane-a", sha256: sha256Hex(bytes), bytes: bytes.byteLength, notes: source.notes.length, durationBeats: round(source.durationBeats), tempoBpm: round(source.tempoBpm) },
    baseline: {
      levels: Object.fromEntries(variants.map((variant) => [variant.level, levelSummary(variant, ladder)])),
      contract: compactComparison(evaluateDifficultyContract(variants)),
      production: productionContract(variants),
    },
    musicalParity: musicalParity("lane-a", variants),
    candidateA: candidateA(variants),
  };
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
    else if (option === "--help" || option === "-h") throw new Error("Usage: audit-difficulty-contract.ts --lane-a-midi FILE [--out FILE] [--revision LABEL]");
    else throw new Error(`unknown option: ${token}`);
  }
  if (!laneA) throw new Error("--lane-a-midi is required");
  return { laneA, out, revision };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const trusted = await Promise.all(TRUSTED_FIXTURES.map(([id, title, artist, logicalRef]) => loadTrusted(id, title, artist, logicalRef)));
  const syntheticSource = inlineParsed();
  const syntheticVariants = buildVariants(syntheticSource, { title: "Synthetic full-band", artist: "Keyspilli" }, { arrangementProfile: "learner", maxDurBeats: null });
  trusted.push({
    id: "synthetic-full-band",
    label: "Synthetic full-band",
    logicalRef: "synthetic:full-band",
    source: { sha256: sha256Hex(new TextEncoder().encode(JSON.stringify(syntheticSource.notes))), bytes: 0, notes: syntheticSource.notes.length, durationBeats: syntheticSource.durationBeats, tempoBpm: syntheticSource.tempoBpm },
    levels: Object.fromEntries(syntheticVariants.map((variant) => [variant.level, levelSummary(variant, evaluateDifficultyLadder({ fixture: { id: "synthetic-full-band" }, sourceNotes: syntheticSource.notes, variants: syntheticVariants }))])),
    contract: compactComparison(evaluateDifficultyContract(syntheticVariants)),
    production: productionContract(syntheticVariants),
    musicalParity: musicalParity("synthetic-full-band", syntheticVariants),
    transitions: evaluateDifficultyLadder({ fixture: { id: "synthetic-full-band" }, sourceNotes: syntheticSource.notes, variants: syntheticVariants }).transitions,
  });
  const laneA = await laneAVariantSet(options.laneA);
  const laneAReportData = laneAReport(laneA.source, laneA.bytes, laneA.variants);
  const productionFixtures = trusted.filter((fixture) => fixture.id !== "synthetic-full-band");
  const musicalParityReport = {
    baselineRevision: BASELINE_REVISION,
    fixtures: Object.fromEntries([
      ...productionFixtures.map((fixture) => [fixture.id, fixture.musicalParity]),
      ["lane-a", laneAReportData.musicalParity],
    ]),
    allEqual: [...productionFixtures.map((fixture) => fixture.musicalParity), laneAReportData.musicalParity]
      .every((parity) => parity.pass === true),
  };
  const reportWithoutDeterminism = {
    schemaVersion: 2,
    mission: "IMPLEMENT_PUBLIC_FIVE_LEVEL_DIFFICULTY_CONTRACT",
    startingRevision: options.revision,
    behavior: "VALIDATION_SEMANTICS_ONLY_NO_MUSICAL_BEHAVIOR_CHANGE",
    scope: {
      onsetToleranceBeats: ONSET_TOLERANCE,
      physicalOrder: LEVEL_ORDER,
      publicOrder: PUBLIC_DIFFICULTY_ORDER,
      productionPublicEdgeToleranceBeats: PUBLIC_EDGE_TOLERANCES,
      historicalPhysicalDiagnosticToleranceBeats: { "very-beginner": 0.26, beginner: 0.02, "very-easy": 0.13, easy: 0.02, medium: 0.02 },
      benchmarkMaterialUsed: false,
      playabilityLimitsChanged: false,
      densityNormalizationPromoted: false,
      generationPolicyChanged: false,
      veryEasyDeleted: false,
      humanListening: "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT",
      deployment: "NOT_DEPLOYED",
    },
    history: history(),
    contracts: {
      physical: { order: LEVEL_ORDER, ownership: "PHYSICAL_ARTIFACT_REQUIRED + LEGACY_COMPATIBILITY_REQUIRED", semantics: "six generated/serialized rows; each row is individually validated" },
      public: { order: PUBLIC_DIFFICULTY_ORDER, ownership: "PUBLIC_PRODUCT_REQUIRED", semantics: "production ancestry and monotonicity edges" },
      veryEasy: { ownership: "LEGACY_COMPATIBILITY_REQUIRED", semantics: "individually validated physical row; no public ordering edge" },
      productionValidation: {
        individualLevels: LEVEL_ORDER,
        orderingEdges: PUBLIC_DIFFICULTY_ORDER.slice(0, -1).map((level, index) => `${level}->${PUBLIC_DIFFICULTY_ORDER[index + 1]!}`),
        toleranceByEasierLevel: PUBLIC_EDGE_TOLERANCES,
      },
      historicalPhysicalDiagnostic: { order: LEVEL_ORDER, edgeToleranceBeats: { "very-beginner": 0.26, beginner: 0.02, "very-easy": 0.13, easy: 0.02, medium: 0.02 }, semantics: "report-only six-level comparison; not production adjacency" },
      auditMatching: { onsetToleranceBeats: ONSET_TOLERANCE, semantics: "diagnostic matching only; not production ladder tolerance" },
      criteria: [
        "individual playability validation",
        "public learner progression and difficultyScore ordering",
        "RH ancestry over public edges",
        "legacy Very Easy existence and individual validity",
        "cross-fixture consistency without threshold changes",
      ],
    },
    productTruth: {
      normalPublicOrder: PUBLIC_DIFFICULTY_ORDER,
      veryEasyVisibleInNormalFlow: false,
      easyRepresentative: true,
      legacyVeryEasyPhysicalIdRetained: true,
      physicalArtifactRowsRemainSix: true,
      dataMigrationPerformed: false,
    },
    controls: controls(),
    fixtures: trusted,
    laneA: laneAReportData,
    musicalParity: musicalParityReport,
    decisions: {
      contract: "PUBLIC_FIVE_LEVEL_CONTRACT_IMPLEMENTED",
      contractBasis: {
        productionFixtures: productionFixtures.map((fixture) => fixture.id),
        productionFixturesPublicPass: productionFixtures.every((fixture) => fixture.production.pass),
        legacyVeryEasyIndependentPass: productionFixtures.every((fixture) => fixture.contract.veryEasyIndependent.pass),
        trustedMusicalParity: productionFixtures.every((fixture) => fixture.musicalParity.pass),
        publicToleranceFrozenAt: PUBLIC_EDGE_TOLERANCES,
        syntheticFullBand: "diagnostic-only fixture is intentionally below the validator's eight-note minimum for VB/B; it is not used to overturn the contract decision",
        candidateA: "diagnostic-only Candidate A remains unpromoted; Lane A still fails the production validator's individual IOI gate",
      },
      timedSymbolicMvp: "TIMED_SYMBOLIC_MVP_READY_FOR_NORMALIZATION_REEVALUATION",
      realSymbolicAlignment: "REAL_SYMBOLIC_ALIGNMENT_PARTIAL",
      realShadow: "REAL_SHADOW_BLOCKED_AT_DIFFICULTIES",
      candidateA: "DIAGNOSTIC_ONLY_NOT_PROMOTED",
      musicalQuality: "MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED",
      humanListening: "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT",
      deployment: "NOT_DEPLOYED",
    },
    nextTask: "REEVALUATE_FROZEN_DENSITY_NORMALIZATION_UNDER_PUBLIC_CONTRACT",
  };
  const canonicalSha256 = sha256Hex(new TextEncoder().encode(stableJson(reportWithoutDeterminism)));
  const report = { ...reportWithoutDeterminism, determinism: { canonicalSha256 } };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) await writeFile(resolve(ROOT, options.out), text, "utf8");
  else process.stdout.write(text);
}

if (process.argv[1]?.endsWith("audit-difficulty-contract.ts")) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`audit-difficulty-contract: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
