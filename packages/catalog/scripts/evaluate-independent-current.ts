import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { type ParsedMidi, type Variant } from "@keyspilli/midi";
import { ROOT } from "../src/paths.js";
import {
  CANDIDATE_FINGERPRINT,
  CANDIDATE_ID,
  CANDIDATE_SEMANTICS,
  DECLARED_RELEASE_GATES,
  SYNTHETIC_CONTROL_ID,
  evaluateCurrentFixture,
  evaluateDeclaredGates,
  type CurrentFixture,
} from "../src/independent-current-evaluation.js";

const realFixtures = [
  ["classical", "Clair de lune", "Claude Debussy", "data/artifacts/c-debussy-suite-bergamasque-clair-de-lune/a/notes.json"],
  ["cover", "River Flows in You", "Yiruma", "data/artifacts/paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing/a/notes.json"],
  ["pop", "Hello", "Adele", "data/artifacts/adele-hello/a/notes.json"],
] as const;

const preregistrationPath = join(ROOT, "docs/superpowers/plans/beginner-sparse-lh-independent-current-eval-preregistration.json");

function summary(variant: Variant): Record<string, unknown> {
  const notes = variant.notes;
  const canonical = notes.map((note) => [note.midi, note.start.toFixed(6), note.dur.toFixed(6), note.vel, note.hand ?? "", note.identitySource ?? ""])
    .sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return {
    noteCount: notes.length,
    rightHandCount: notes.filter((note) => note.hand !== "L").length,
    leftHandCount: notes.filter((note) => note.hand === "L").length,
    onsetCount: new Set(notes.map((note) => note.start.toFixed(6))).size,
    eventSha256: awaitDigest(JSON.stringify(canonical)),
  };
}

function awaitDigest(value: string): string {
  // Keep this script synchronous in its hot path while using the platform's
  // deterministic SHA implementation; no report data is read here.
  const bytes = new TextEncoder().encode(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeSource(raw: Record<string, unknown>, logicalRef: string): ParsedMidi {
  if (!Array.isArray(raw.notes)) throw new Error(`${logicalRef}: source notes must be an array`);
  const notes = raw.notes as ParsedMidi["notes"];
  const endBeat = Math.max(0, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
  const timeSig = Array.isArray(raw.timeSig) && raw.timeSig.length === 2
    && Number.isFinite(raw.timeSig[0]) && Number.isFinite(raw.timeSig[1])
    ? [Number(raw.timeSig[0]), Number(raw.timeSig[1])] as [number, number]
    : [4, 4] as [number, number];
  return {
    ...raw,
    format: Number.isFinite(raw.format) ? Number(raw.format) : 1,
    division: Number.isFinite(raw.division) ? Number(raw.division) : 480,
    tempoBpm: Number.isFinite(raw.tempoBpm) ? Number(raw.tempoBpm) : 120,
    keySig: Number.isFinite(raw.keySig) ? Number(raw.keySig) : 0,
    keyMode: raw.keyMode === 1 ? 1 : 0,
    timeSig,
    notes,
    trackNames: Array.isArray(raw.trackNames) ? raw.trackNames.map(String) : [logicalRef],
    durationBeats: Number.isFinite(raw.durationBeats) ? Number(raw.durationBeats) : endBeat,
  } as ParsedMidi;
}

async function loadFixture(id: string, title: string, artist: string, logicalRef: string, expectedHash: string): Promise<CurrentFixture> {
  const path = join(ROOT, logicalRef);
  const first = new Uint8Array(await readFile(path));
  const second = new Uint8Array(await readFile(path));
  if (Buffer.compare(first, second) !== 0) throw new Error(`${id}: fixture changed between hash reads`);
  const hash = createHash("sha256").update(first).digest("hex");
  if (hash !== expectedHash) throw new Error(`${id}: bytes do not match preregistered SHA-256`);
  const raw = JSON.parse(new TextDecoder().decode(first)) as Record<string, unknown>;
  return { id, label: title, logicalRef, bytes: first, source: normalizeSource(raw, logicalRef), title, artist };
}

async function main(): Promise<void> {
  const preregistration = JSON.parse(await readFile(preregistrationPath, "utf8")) as {
    startingRevision?: string;
    candidate?: { id?: string; semanticFingerprint?: string };
    fixtures?: Array<{ id?: string; sha256?: string; bytes?: number; logicalRef?: string }>;
  };
  if (preregistration.candidate?.id !== CANDIDATE_ID || preregistration.candidate.semanticFingerprint !== CANDIDATE_FINGERPRINT) {
    throw new Error("preregistration candidate fingerprint does not match evaluator");
  }
  const fixtureSpecs = new Map((preregistration.fixtures ?? []).map((fixture) => [fixture.id, fixture]));
  const specFor = (id: string, logicalRef: string) => {
    const spec = fixtureSpecs.get(id);
    if (!spec || spec.logicalRef !== logicalRef || typeof spec.sha256 !== "string") throw new Error(`${id}: missing preregistered fixture spec`);
    return spec;
  };
  const loaded = await Promise.all(realFixtures.map(([id, title, artist, logicalRef]) => {
    const spec = specFor(id, logicalRef);
    return loadFixture(id, title, artist, logicalRef, spec.sha256!);
  }));
  const syntheticLogicalRef = "packages/catalog/test/fixtures/beginner-sparse-lh-promotion-control-v2.json";
  const syntheticSpec = specFor(SYNTHETIC_CONTROL_ID, syntheticLogicalRef);
  const syntheticPath = join(ROOT, syntheticLogicalRef);
  const syntheticBytes = new Uint8Array(await readFile(syntheticPath));
  const syntheticBytesSecond = new Uint8Array(await readFile(syntheticPath));
  if (Buffer.compare(syntheticBytes, syntheticBytesSecond) !== 0) throw new Error("synthetic control changed between hash reads");
  if (createHash("sha256").update(syntheticBytes).digest("hex") !== syntheticSpec.sha256) throw new Error("synthetic control does not match preregistered SHA-256");
  const syntheticRaw = JSON.parse(new TextDecoder().decode(syntheticBytes)) as Record<string, unknown>;
  const synthetic = {
    id: SYNTHETIC_CONTROL_ID,
    label: "Synthetic sparse LH V2",
    logicalRef: "packages/catalog/test/fixtures/beginner-sparse-lh-promotion-control-v2.json",
    bytes: syntheticBytes,
    source: normalizeSource(syntheticRaw, syntheticLogicalRef),
    title: "Synthetic sparse LH V2",
    artist: "Keyspilli",
  } satisfies CurrentFixture;
  const fixtures = [...loaded, synthetic].map((fixture) => {
    const result = evaluateCurrentFixture(fixture);
    return {
      fixture: result.fixture,
      baseline: result.baseline.levels.map((variant) => ({ level: variant.level, ...summary(variant) })),
      candidate: { beginner: { ...summary(result.candidate.beginner), level: "beginner" }, ladder: result.candidate.ladder.map((variant) => ({ level: variant.level, ...summary(variant) })) },
      parity: result.parity,
      structuralRecovery: result.structuralRecovery,
      separation: result.separation,
      synthetic: { fillerEnteredPath: result.synthetic.fillerEnteredPath, considered: result.synthetic.considered.length, emitted: result.synthetic.emitted.length, provenance: result.synthetic.provenance, filler: result.synthetic.filler, collision: result.synthetic.collision, trueRestWindows: result.synthetic.trueRestWindows, lhOnlyWindows: result.synthetic.lhOnlyWindows, pitchedDrumOutputs: result.synthetic.pitchedDrumOutputs, control: result.synthetic.control },
      validation: result.candidate.validation,
      ladderTransitions: result.candidate.ladderEvaluation.transitions,
      gateTable: result.gateTable,
    };
  });
  const byGate = Object.fromEntries(DECLARED_RELEASE_GATES.map((id) => [id, id === "synthetic-safety"
    ? fixtures.find((fixture) => fixture.fixture.id === synthetic.id)?.gateTable.find((gate) => gate.id === id)?.observed === true
    : fixtures.every((fixture) => fixture.gateTable.find((gate) => gate.id === id)?.observed === true)]));
  const gateTable = evaluateDeclaredGates(byGate);
  const passed = gateTable.every((gate) => gate.status === "PASS");
  const mechanicalIds = new Set(["candidate-validation", "candidate-ladder-validation", "candidate-adjacent-monotonicity", "beginner-rh-parity", "non-beginner-parity", "lh-provenance"]);
  const failedMechanical = gateTable.some((gate) => gate.status === "FAIL" && mechanicalIds.has(gate.id));
  const decisionCode = passed
    ? "BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_VALIDATED"
    : failedMechanical
      ? "BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_FAILS"
      : "BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_INSUFFICIENT";
  const reportWithoutDeterminism = {
    schemaVersion: 1,
    mission: "INDEPENDENT_CURRENT_FIXTURE_BEGINNER_SPARSE_LH_PROMOTION_EVALUATION",
    startingRevision: preregistration.startingRevision ?? null,
    candidate: { id: CANDIDATE_ID, fingerprint: CANDIDATE_FINGERPRINT, semantics: CANDIDATE_SEMANTICS, source: "test-local current evaluator", productionChanged: false },
    dependencies: { legacyPromotionMetrics: false, historicalReports: false, calibrationArtifacts: false, externalReference: false },
    fixtures,
    gateTable,
    decision: { code: decisionCode, predicateGateIds: [...DECLARED_RELEASE_GATES], pass: passed, production: "NO_PRODUCTION_BEHAVIOR_CHANGE" },
  };
  const canonical = JSON.stringify(reportWithoutDeterminism);
  const report = { ...reportWithoutDeterminism, determinism: { canonicalSha256: createHash("sha256").update(canonical).digest("hex") } };
  const output = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
  const text = JSON.stringify(report, null, 2) + "\n";
  if (output) await writeFile(output, text);
  else process.stdout.write(text);
}

await main();
