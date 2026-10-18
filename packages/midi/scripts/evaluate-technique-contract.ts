/** Authored development evidence only. This program never writes an acceptance receipt. */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LEVEL_ORDER, buildVariants, parseMidi, parseMusicXmlNotes, validateArtifactFiles, validateVariants,
  writeVariantArtifacts, type Note, type ParsedMidi, type PhrasePlanV1 } from "../src/index.js";
import { analyzeTechnique, type TechniqueInput, type TechniqueInstant, type TechniqueInterval, type TechniqueResult } from "../src/technique-diagnostics.js";
import { checkSourceProtection, correspondPhysicalNotes, originKey, type ContractCase, type TierPolicy } from "./technique-contract-support.js";

export const TECHNIQUE_CORPUS_MANIFEST_SHA256 = "7114d50aabd64d706739e1083ca9f9f36e8de7149a307c47739904cfed5bff65";
const packet = fileURLToPath(new URL("../test/fixtures/technique-contract-v1/", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const sameSet = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
type FilePin = { path: string; bytes: number; sha256: string };
type Check = { path: string; expected: unknown; actual: unknown; pass: boolean };
type Quantity = { rational: string; number: number };
type RefInstant = { sourceBeat: Quantity; nativeSeconds: Quantity | null };
type RefInterval = { sourceBeats: Quantity; nativeSeconds: Quantity | null };
interface ReferenceCase {
  clockStatus: "known" | "unknown" | "invalid";
  events?: Array<{ eventId: string; midi: number; sourceHand: "L" | "R" | null; attack: RefInstant; physicalRelease: RefInstant; physicalDuration: RefInterval }>;
  heldAtAttack?: Array<{ id: string; hand: "L" | "R" | null; atAttack: RefInstant; newAttackEventIds: string[];
    expectedCarriedPhysicalEventIds: string[]; expectedReleasedExactlyAtAttackEventIds: string[]; unknownHandRelevantEventIds: string[] }>;
  registerTransitions?: Array<{ id: string; hand: "L" | "R"; priorGroupEventIds: string[]; nextGroupEventIds: string[];
    priorPitchRange: [number, number]; nextPitchRange: [number, number]; priorAnchorMidi: number; nextAnchorMidi: number;
    signedSemitoneDisplacement: number; onsetInterval: RefInterval; priorGroupLatestPhysicalRelease: RefInstant; releaseToNextAttack: RefInterval }>;
  sameKeyRecurrences?: Array<{ id: string; hand: "L" | "R"; midi: number; priorEventId: string; nextEventId: string;
    onsetInterval: RefInterval; priorPhysicalRelease: RefInstant; releaseToNextAttack: RefInterval }>;
}

/** Verify exact frozen raw bytes before any parsing or generation. */
export function readFrozenTechniquePacket(directory = packet) {
  const manifestBytes = readFileSync(join(directory, "proposed-freeze-manifest.json"));
  if (sha(manifestBytes) !== TECHNIQUE_CORPUS_MANIFEST_SHA256) throw new Error("Frozen technique manifest hash differs");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { files: FilePin[]; fileCount: number; payloadBytes: number };
  if (manifest.fileCount !== 24 || manifest.payloadBytes !== 2_412_784 || manifest.files.length !== 24) throw new Error("Frozen technique inventory differs");
  const files = new Map<string, Buffer>();
  for (const pin of manifest.files) {
    if (isAbsolute(pin.path) || pin.path.split("/").includes("..") || files.has(pin.path)) throw new Error("Invalid frozen path");
    const path = join(directory, pin.path), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.bytes) throw new Error(`Frozen file shape differs: ${pin.path}`);
    const bytes = readFileSync(path);
    if (sha(bytes) !== pin.sha256) throw new Error(`Frozen file hash differs: ${pin.path}`);
    files.set(pin.path, bytes);
  }
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error("Frozen packet contains a symbolic link");
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [relative(directory, child).split("\\").join("/")];
  });
  if (!sameSet(walk(directory), [...files.keys(), "proposed-freeze-manifest.json"])) throw new Error("Frozen packet has missing or extra files");
  const parse = <T>(path: string): T => {
    const bytes = files.get(path); if (!bytes) throw new Error(`Unpinned input ${path}`);
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  const corpus = parse<{ cases: ContractCase[]; physicalTierOrder: string[] }>("technique-contract-corpus-v1.json");
  const policy = parse<{ caseTierPolicies: Array<{ caseId: string; sourceSha256: string; tiers: TierPolicy[] }>; nonclaims: unknown }>("technique-contract-policy-v1.json");
  const references = parse<{ cases: Record<string, ReferenceCase> }>("technique-contract-reference-v1.json");
  if (corpus.cases.length !== 11 || policy.caseTierPolicies.length !== 11 || JSON.stringify(corpus.physicalTierOrder) !== JSON.stringify(LEVEL_ORDER)) throw new Error("Frozen case/tier inventory differs");
  for (const item of corpus.cases) {
    const tiers = policy.caseTierPolicies.find(row => row.caseId === item.caseId);
    if (!tiers || tiers.sourceSha256 !== item.sourceFile.sha256 || JSON.stringify(tiers.tiers.map(t => t.tier)) !== JSON.stringify(LEVEL_ORDER)) throw new Error(`Incomplete six-tier policy: ${item.caseId}`);
    if (sha(files.get(item.sourceFile.path)!) !== item.sourceFile.sha256) throw new Error(`Source binding differs: ${item.caseId}`);
  }
  return { manifest, files, parse, corpus, policy, references };
}

function sourceEvents(item: ContractCase, source: ParsedMidi): TechniqueInput["events"] {
  const used = new Set<Note>();
  const events = item.eventDeclarations.map(event => {
    const expected = event.sourceOccurrences.map(originKey).sort();
    const candidates = source.notes.filter(note => sameSet((note.sourceOrigins ?? []).map(originKey), expected));
    if (candidates.length !== 1 || used.has(candidates[0]!)) throw new Error(`Source declaration is not one unique physical event: ${event.eventId}`);
    used.add(candidates[0]!);
    return { eventId: event.eventId, note: candidates[0]! };
  });
  if (used.size !== source.notes.length) throw new Error("Source contains undeclared physical events");
  return events;
}

function sourceInput(item: ContractCase, source: ParsedMidi): TechniqueInput {
  return { events: sourceEvents(item, source), clock: { data: source, authority: item.sourceClock.status === "unknown" ? "unknown" : "declared", timebase: "source-quarter-beats" },
    handAuthority: "source-declared", pedal: source.sourcePedal ? { authority: "declared", timeline: source.sourcePedal }
      : { authority: item.pedalDeclaration.completeNoPedal ? "none" : "unknown" } };
}

function localInput(notes: Note[], id: string, clock: TechniqueInput["clock"]["data"], pedal?: ParsedMidi["sourcePedal"]): TechniqueInput {
  // These IDs name positions in the retained, hashed physical inventory. They
  // are local observation handles, never invented source provenance.
  return { events: notes.map((note, index) => ({ eventId: `${id}:physical-${index + 1}`, note })),
    clock: { data: clock, authority: "declared", timebase: "arrangement-quarter-beats" }, handAuthority: "arrangement-assumption",
    pedal: pedal ? { authority: "declared", timeline: pedal } : { authority: "none" } };
}

function compareSelectedReferences(reference: ReferenceCase, result: TechniqueResult): { status: "pass" | "fail"; checks: Check[] } {
  const checks: Check[] = [];
  const check = (path: string, actual: unknown, expected: unknown) => {
    const pass = typeof expected === "number" ? typeof actual === "number" && Number.isFinite(actual) && Math.abs(expected - actual) <= 1e-9
      : JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ path, expected, actual: actual === undefined ? null : actual, pass });
  };
  const instant = (path: string, actual: TechniqueInstant | undefined, expected: RefInstant) => {
    check(`${path}.beat`, actual?.beat, expected.sourceBeat.number);
    check(`${path}.nativeSeconds`, actual?.nativeSeconds, expected.nativeSeconds?.number ?? null);
  };
  const interval = (path: string, actual: TechniqueInterval | undefined, expected: RefInterval) => {
    check(`${path}.beats`, actual?.beats, expected.sourceBeats.number);
    check(`${path}.nativeSeconds`, actual?.nativeSeconds, expected.nativeSeconds?.number ?? null);
  };
  if (reference.clockStatus === "invalid") {
    check("status", result.status, "refused");
    check("code", result.status === "refused" ? result.code : null, "invalid-clock");
  } else {
    check("status", result.status, "reported");
    if (result.status === "reported") {
      check("clock.status", result.clock.status, reference.clockStatus);
      for (const expected of reference.events ?? []) {
        const actual = result.events.find(event => event.eventId === expected.eventId), path = `events/${expected.eventId}`;
        check(`${path}.midi`, actual?.midi, expected.midi); check(`${path}.hand`, actual?.hand, expected.sourceHand);
        instant(`${path}.attack`, actual?.attack, expected.attack); instant(`${path}.physicalRelease`, actual?.physicalRelease, expected.physicalRelease);
        interval(`${path}.physicalDuration`, actual?.physicalDuration, expected.physicalDuration);
      }
      for (const expected of reference.heldAtAttack ?? []) {
        const actual = result.heldAtAttack.find(row => row.hand === expected.hand && sameSet(row.newEventIds, expected.newAttackEventIds));
        const path = `heldAtAttack/${expected.id}`;
        instant(`${path}.attack`, actual?.attack, expected.atAttack);
        check(`${path}.carried`, actual && [...actual.carriedEventIds].sort(), [...expected.expectedCarriedPhysicalEventIds].sort());
        check(`${path}.releasedAtAttack`, actual && [...actual.releasedAtAttackEventIds].sort(), [...expected.expectedReleasedExactlyAtAttackEventIds].sort());
        check(`${path}.unknownHandCarry`, actual && [...actual.unknownHandCarriedEventIds].sort(), [...expected.unknownHandRelevantEventIds].sort());
      }
      for (const expected of reference.registerTransitions ?? []) {
        const actual = result.registerTransitions.find(row => row.hand === expected.hand && sameSet(row.priorEventIds, expected.priorGroupEventIds) && sameSet(row.nextEventIds, expected.nextGroupEventIds));
        const path = `registerTransitions/${expected.id}`;
        for (const key of ["priorPitchRange", "nextPitchRange", "priorAnchorMidi", "nextAnchorMidi", "signedSemitoneDisplacement"] as const) check(`${path}.${key}`, actual?.[key], expected[key]);
        interval(`${path}.onsetInterval`, actual?.onsetInterval, expected.onsetInterval);
        instant(`${path}.priorGroupLatestPhysicalRelease`, actual?.priorGroupLatestPhysicalRelease, expected.priorGroupLatestPhysicalRelease);
        interval(`${path}.releaseToNextAttack`, actual?.releaseToNextAttack, expected.releaseToNextAttack);
      }
      for (const expected of reference.sameKeyRecurrences ?? []) {
        const actual = result.sameKeyRecurrences.find(row => row.hand === expected.hand && row.midi === expected.midi && row.priorEventId === expected.priorEventId && row.nextEventId === expected.nextEventId);
        const path = `sameKeyRecurrences/${expected.id}`;
        check(`${path}.sameHand`, actual?.sameHand, "declared");
        interval(`${path}.onsetInterval`, actual?.onsetInterval, expected.onsetInterval);
        instant(`${path}.priorPhysicalRelease`, actual?.priorPhysicalRelease, expected.priorPhysicalRelease);
        interval(`${path}.releaseToNextAttack`, actual?.releaseToNextAttack, expected.releaseToNextAttack);
      }
    }
  }
  return { status: checks.every(c => c.pass) ? "pass" : "fail", checks };
}

function checkHalfSpeed(native: TechniqueResult, half: TechniqueResult) {
  if (native.status !== "reported" || half.status !== "reported") return { status: "not-applicable" as const, reason: "One or both diagnostic scenarios were refused" };
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "playbackSeconds" && key !== "speedMultiplier").map(([key, child]) => [key, normalize(child)]));
    return value;
  };
  const sameArrangementAndNativeFacts = JSON.stringify(normalize(native)) === JSON.stringify(normalize(half));
  const values = (value: unknown): Array<number | null> => {
    if (Array.isArray(value)) return value.flatMap(values);
    if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => key === "playbackSeconds" ? [child as number | null] : values(child));
    return [];
  };
  const a = values(native), b = values(half);
  const elapsedTimesDoubled = a.length === b.length && a.every((value, index) => value === null ? b[index] === null : typeof b[index] === "number" && Math.abs(b[index]! - 2 * value) <= 1e-9);
  return { status: sameArrangementAndNativeFacts && elapsedTimesDoubled ? "pass" as const : "fail" as const, sameArrangementAndNativeFacts, elapsedTimesDoubled, comparedElapsedFields: a.length };
}

function observe(input: TechniqueInput) {
  const native = analyzeTechnique({ ...input, speedMultiplier: 1 });
  const half = analyzeTechnique({ ...input, speedMultiplier: 0.5 });
  return { native, half, halfSpeedCheck: checkHalfSpeed(native, half) };
}

function implementationIdentity() {
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const paths = ["scripts/evaluate-technique-contract.ts", "scripts/technique-contract-support.ts", "src/technique-diagnostics.ts", "src/index.ts", "src/simplify.ts", "src/simplify/shared.ts", "src/simplify/source-workload.ts", "src/simplify/learner-trace.ts", "src/simplify/texture.ts", "src/simplify/metal-rh.ts", "src/simplify/playability.ts", "src/phrase-plan.ts", "src/parse.ts", "src/parseXml.ts", "src/writeMidi.ts", "src/writeXml.ts", "src/roundtrip.ts", "src/validate.ts", "src/source-pedal.ts"];
  return { head: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), status: git("status", "--porcelain", "--untracked-files=normal"), node: process.versions.node,
    implementationFiles: paths.map(path => { const bytes = readFileSync(join(repo, "packages/midi", path)); return { path: `packages/midi/${path}`, bytes: bytes.length, sha256: sha(bytes) }; }) };
}

interface TierRow {
  caseId: string;
  tier: TierPolicy["tier"];
  status: "artifacts" | "refused";
  stage: string;
  refusal: { name: string; reason: string; stack?: string } | null;
  sourceSha256: string;
  policy: TierPolicy;
  plan?: { wrapper: FilePin; jsonPointer: string; extracted: FilePin };
  canonical?: FilePin;
  generatedLadder?: FilePin;
  generationValidation?: string[];
  sourceProtection?: ReturnType<typeof checkSourceProtection>;
  artifacts?: { midi: FilePin; musicxml: FilePin; fidelity: unknown; validation: string[] };
  reparses?: Partial<Record<"midi" | "musicxml", FilePin>>;
  correspondence?: Partial<Record<"midi" | "musicxml", ReturnType<typeof correspondPhysicalNotes>>>;
  observations?: Partial<Record<"canonical" | "midi" | "musicxml", FilePin>>;
  observationStatus?: Partial<Record<"canonical" | "midi" | "musicxml", string>>;
  contractChecks?: Array<{ stage: string; issues: string[] }>;
}

export function evaluateTechniqueContract(outputDirectory: string) {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major !== 22 || minor! < 22 || minor === 22 && patch! < 3) throw new Error("Use the repository-supported Node >=22.22.3 <23 runtime");
  const frozen = readFrozenTechniquePacket();
  const output = resolve(outputDirectory);
  mkdirSync(output, { recursive: false });
  const emitted: FilePin[] = [];
  const emit = (path: string, value: Uint8Array | string): FilePin => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const target = join(output, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: "wx" });
    const reread = readFileSync(target); if (!bytes.equals(reread)) throw new Error(`Written evidence differs: ${path}`);
    const pin = { path, bytes: bytes.length, sha256: sha(bytes) }; emitted.push(pin); return pin;
  };
  const before = implementationIdentity();
  emit("implementation-before.json", json(before));
  emit("frozen-input-bindings.json", json({ manifestSha256: TECHNIQUE_CORPUS_MANIFEST_SHA256, payload: frozen.manifest.files }));
  const rows: TierRow[] = [];
  const sources: Array<{ caseId: string; sourceSha256: string; sourceDiagnostics: FilePin; selectedReferenceChecks: ReturnType<typeof compareSelectedReferences>; halfSpeedCheck: ReturnType<typeof checkHalfSpeed> }> = [];
  const errors: string[] = [];
  const options = { arrangementProfile: "source" as const, normalizeRange: false, maxDurBeats: null };
  for (const item of frozen.corpus.cases) {
    const source = frozen.parse<ParsedMidi>(item.sourceFile.path), input = sourceInput(item, source);
    const observation = observe(input);
    const selectedReferenceChecks = compareSelectedReferences(frozen.references.cases[item.caseId]!, observation.native);
    const sourceDiagnostics = emit(`${item.caseId}/source-diagnostics.json`, json(observation));
    sources.push({ caseId: item.caseId, sourceSha256: item.sourceFile.sha256, sourceDiagnostics, selectedReferenceChecks, halfSpeedCheck: observation.halfSpeedCheck });
    if (selectedReferenceChecks.status !== "pass" || observation.halfSpeedCheck.status === "fail") errors.push(`Source diagnostic reference/scenario disagreement: ${item.caseId}`);
    const policies = frozen.policy.caseTierPolicies.find(row => row.caseId === item.caseId)!.tiers;
    for (const policy of policies) {
      const prefix = `${item.caseId}/${policy.tier}`;
      const row: TierRow = { caseId: item.caseId, tier: policy.tier, sourceSha256: item.sourceFile.sha256, policy,
        status: "refused", stage: "source-clock-qualification", refusal: null };
      rows.push(row);
      try {
        if (observation.native.status === "refused") {
          row.refusal = { name: observation.native.code, reason: observation.native.reason };
        } else if (observation.native.clock.status !== "known") {
          row.refusal = { name: "unknown-native-clock", reason: "Declared native timing is unknown; a numeric tempo placeholder does not qualify generation or elapsed-time claims." };
        } else {
          if (!policy.phrasePlanLocation) throw new Error("Known-clock policy has no frozen source-bound plan");
          const { path, jsonPointer } = policy.phrasePlanLocation;
          if (jsonPointer !== `/plans/${policy.tier}`) throw new Error("Frozen plan pointer differs from tier");
          const wrapperBytes = frozen.files.get(path)!;
          const wrapper = frozen.parse<{ plans: Record<string, PhrasePlanV1> }>(path);
          const extractedBytes = json(wrapper.plans[policy.tier]);
          const extracted = emit(`${prefix}/phrase-plan.json`, extractedBytes);
          row.plan = { wrapper: { path, bytes: wrapperBytes.length, sha256: sha(wrapperBytes) }, jsonPointer, extracted };
          // The retained exact serialized plan is reparsed and supplied to the
          // maintained API. The entire returned ladder is also retained.
          const phrasePlan = JSON.parse(extractedBytes) as PhrasePlanV1;
          row.stage = "generation-and-maintained-phrase-gates";
          const meta = { title: item.title, artist: "Keyspilli original authored controls" };
          const generated = buildVariants(structuredClone(source), meta, { ...options, phrasePlan, sourceSha256: item.sourceFile.sha256 });
          row.generatedLadder = emit(`${prefix}/generated-ladder.json`, json(generated));
          row.generationValidation = validateVariants(generated, { maxDurBeats: null });
          const variants = generated.filter(v => v.level === policy.tier);
          if (variants.length !== 1) throw new Error("Maintained generation did not return one requested tier");
          const canonical = variants[0]!;
          row.canonical = emit(`${prefix}/canonical.json`, json(canonical));
          row.sourceProtection = checkSourceProtection(item, policy, source, canonical);
          row.stage = "artifact-writing";
          const artifacts = writeVariantArtifacts(canonical, meta.title, meta.artist);
          row.artifacts = { midi: emit(`${prefix}/artifact.mid`, artifacts.midi), musicxml: emit(`${prefix}/artifact.musicxml`, artifacts.xml), fidelity: artifacts.fidelity,
            validation: validateArtifactFiles(canonical, artifacts) };
          row.reparses = {}; row.correspondence = {}; row.observations = {}; row.observationStatus = {};
          const canonicalInput = localInput(canonical.notes, `${prefix}:canonical`, { division: 960, tempoBpm: canonical.tempoBpm, tempoMetaPresent: true }, canonical.sourcePedal);
          const canonicalObserved = observe(canonicalInput);
          row.observations.canonical = emit(`${prefix}/canonical-diagnostics.json`, json(canonicalObserved));
          row.observationStatus.canonical = canonicalObserved.native.status === "reported" && canonicalObserved.halfSpeedCheck.status === "pass" ? "reported" : "refused";
          row.stage = "artifact-reparse-and-correspondence";
          const formats = [{ format: "midi" as const, parse: () => parseMidi(artifacts.midi) }, { format: "musicxml" as const, parse: () => parseMusicXmlNotes(artifacts.xml) }];
          for (const { format, parse } of formats) {
            try {
              const parsed = parse();
              row.reparses[format] = emit(`${prefix}/${format}-reparse.json`, json(parsed));
              row.correspondence[format] = correspondPhysicalNotes(canonical.notes, parsed.notes, format, !!canonical.sourcePedal);
              const observed = observe(localInput(parsed.notes, `${prefix}:${format}`, parsed, parsed.sourcePedal));
              row.observations[format] = emit(`${prefix}/${format}-diagnostics.json`, json(observed));
              row.observationStatus[format] = observed.native.status === "reported" && observed.halfSpeedCheck.status === "pass" ? "reported" : "refused";
            } catch (error) {
              const e = error as Error;
              row.refusal ??= { name: e.name, reason: `${format} reparse: ${e.message}`, stack: e.stack };
              if (e.name !== "Error") errors.push(`Unexpected ${format} evaluator failure ${item.caseId}/${policy.tier}: ${e.name}: ${e.message}`);
            }
          }
          row.contractChecks = [
            { stage: "maintained-variant-validation", issues: row.generationValidation ?? [] },
            { stage: "source-protection", issues: row.sourceProtection.status === "preserved" ? [] : row.sourceProtection.issues },
            { stage: "maintained-artifact-validation", issues: row.artifacts.validation },
            { stage: "physical-correspondence", issues: formats.flatMap(({ format }) => row.correspondence?.[format]?.status === "unambiguous" ? [] : row.correspondence?.[format]?.issues ?? [`${format}: reparse unavailable`]) },
            { stage: "localized-observations", issues: ["canonical", "midi", "musicxml"].filter(format => row.observationStatus?.[format as "canonical" | "midi" | "musicxml"] !== "reported").map(format => `${format}: diagnostic/scenario report refused`) },
          ];
          const failures = row.contractChecks.flatMap(check => check.issues);
          if (failures.length) row.refusal ??= { name: "retained-contract-refusal", reason: failures.join("; ") };
          if (!row.refusal) { row.status = "artifacts"; row.stage = "complete"; }
          else row.stage = row.contractChecks.find(check => check.issues.length)?.stage ?? row.stage;
        }
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        row.refusal = { name: e.name, reason: e.message, stack: e.stack };
        if (e.name !== "Error") errors.push(`Unexpected evaluator failure ${item.caseId}/${policy.tier}: ${e.name}: ${e.message}`);
      }
      if (row.status === "refused" && !row.refusal?.reason) errors.push(`Unexplained refusal: ${item.caseId}/${policy.tier}`);
      if (policy.expectedDisposition === "retained-refusal-required" && row.status !== "refused") errors.push(`Frozen explicit refusal control was unexpectedly accepted: ${item.caseId}/${policy.tier}`);
      emit(`${prefix}/outcome.json`, json(row));
    }
  }
  const after = implementationIdentity();
  emit("implementation-after.json", json(after));
  const implementationUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!implementationUnchanged) errors.push("Implementation files or Git state changed during evaluation");
  if (rows.length !== 66 || sources.length !== 11) errors.push("Incomplete frozen source/tier coverage");
  const summary = { cases: sources.length, tiers: rows.length, actualArtifactRows: rows.filter(row => row.status === "artifacts").length,
    refusedRows: rows.filter(row => row.status === "refused").length, canonicalInventoriesRetained: rows.filter(row => row.canonical).length,
    actualArtifactPairsRetained: rows.filter(row => row.artifacts).length, selectedSourceReferenceChecks: sources.reduce((n, source) => n + source.selectedReferenceChecks.checks.length, 0),
    selectedSourceReferenceFailures: sources.reduce((n, source) => n + source.selectedReferenceChecks.checks.filter(check => !check.pass).length, 0),
    byCase: sources.map(source => ({ caseId: source.caseId, tiers: rows.filter(row => row.caseId === source.caseId).map(row => ({ tier: row.tier, status: row.status, stage: row.stage, reason: row.refusal?.reason ?? null })) })) };
  const report = { schemaVersion: 1, kind: "keyspilli-technique-contract-evaluation", evidenceStatus: errors.length ? "incomplete" : "complete",
    manifestSha256: TECHNIQUE_CORPUS_MANIFEST_SHA256, options, implementation: before, implementationUnchanged,
    cleanCommitQualification: !before.status && implementationUnchanged,
    boundary: "Observed generator outputs after independently reviewed source/reference freeze. Author-visible engineering controls; no desired complete tier outputs, holdout generalization, fingering or keyboard/musical acceptance.",
    sourceReferenceScope: "Only explicitly selected frozen event, held-key, register-transition and same-key witnesses are compared. Complete generated context is an observation, not a replacement oracle.",
    artifactCorrespondence: { sourceIdsEncoded: false, method: "Exact pitch, attack velocity, declared output hand, and retained channel; exact independently rounded onset/release tick descriptors (MIDI 480, MusicXML 960) after maintained reparse/tie normalization. Any duplicate descriptor is ambiguous; no nearest-note selection or reuse.",
      tolerance: "1e-9 beat floating representation only; the maintained 0.01-beat artifact validation also runs separately.",
      parserBoundary: "General parser success is not a blanket tie-validity claim. Selected barline-tie multiplicity and a broken-tie control are covered by the evaluator contracts." },
    sourceHandBoundary: "Source unknown hands remain unknown. Canonical and physical artifact hand labels are arrangement assumptions, independently of source identity protection.",
    scenarioBoundary: "Native and half-speed share the same exact arrangement and native facts; only elapsed playback seconds change. Canonical/artifact clocks are constant and never reapply source tempo events.",
    nonclaims: frozen.policy.nonclaims, sources, rows, summary, errors };
  emit("report.json", json(report));
  emit("MANIFEST.json", json({ schemaVersion: 1, hashRecipe: "SHA-256 over exact retained bytes; this manifest excludes itself", files: emitted }));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output-dir") throw new Error("Usage: node --import tsx packages/midi/scripts/evaluate-technique-contract.ts --output-dir NEW_DIRECTORY");
  const report = evaluateTechniqueContract(process.argv[3]!);
  console.log(json({ evidenceStatus: report.evidenceStatus, cleanCommitQualification: report.cleanCommitQualification, manifestSha256: report.manifestSha256,
    summary: report.summary, errors: report.errors, report: join(resolve(process.argv[3]!), "report.json") }));
  if (report.evidenceStatus !== "complete") process.exitCode = 2;
}
