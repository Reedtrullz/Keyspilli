/** Bounded state machine around maintained local preparation. No catalog/DB imports. */
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  absolutePath, admitRequest, captureImplementation, capturePayload, captureRuntime, compact, CONFIG, digestFile, equal,
  gitProvenance, IntegrityError, KIND, noSymlinks, object, parseJson, pathInside, readJson, readRegular, requireThat, sha256, validHash,
  type ImplementationPin, type InputPin, type PayloadInventory, type PreparationRequest, type RuntimePin,
} from "./prepare-workflow-pins.js";
import { runPreparationStage, type StageReceipt, type StageRunner } from "./prepare-workflow-process.js";

const RECORD_BYTES = 4 * 1024 * 1024;
const STATE_BYTES = 64 * 1024;
const PHASES = ["admitted", "preparing", "failed", "prepared", "sealed", "invalid"] as const;
type Phase = typeof PHASES[number];
interface Attempt { number: number; status: "running" | "failed" | "succeeded"; receiptSha256: string | null; payloadSha256: string | null }
export interface PreparationState {
  schemaVersion: 1; admissionSha256: string; phase: Phase; attempts: Attempt[];
  checkpointSha256: string | null; sealSha256: string | null; invalidReason: string | null;
}
interface Admission {
  schemaVersion: 1; kind: typeof KIND; root: string; run: string; createdAt: string;
  request: PreparationRequest; files: InputPin[]; sourceSha256: string; canonicalPhrasePlanSha256: string | null;
  config: typeof CONFIG; implementation: ImplementationPin; runtime: RuntimePin; provenance: { head: string; tree: string };
}
interface PreparedCheckpoint {
  schemaVersion: 1; admissionSha256: string; attempt: number; payload: PayloadInventory;
}
const ASSESSMENTS = Object.freeze({
  sourceIdentity: "unknown", listening: "unknown", keyboardAssessment: "unknown", musicalAcceptance: "not-established",
  offlineScoreReview: { status: "unavailable", reason: "A real audio manifest is required; this request supplies MIDI and instructions only." },
});
interface Seal {
  schemaVersion: 1; admissionSha256: string; preparedSha256: string; payloadSha256: string;
  status: "provisional"; completion: "structural-artifacts"; providerCalls: 0; productionAdmission: false; assessments: typeof ASSESSMENTS;
}
export interface WorkflowReport {
  schemaVersion: 1; run: string; phase: Phase; status: "incomplete" | "prepared" | "complete" | "invalid";
  provisional: true; attempts: number; retryAllowed: boolean; providerCalls: 0; productionAdmission: false;
  assessments: typeof ASSESSMENTS; payloadSha256?: string;
}
export interface WorkflowOptions { until?: "prepared"; signal?: AbortSignal; runner?: StageRunner }
const attemptName = (number: number) => `prepare-${String(number).padStart(3, "0")}`;
const attemptRelative = (number: number) => `attempts/${attemptName(number)}`;
const workPath = (run: string, number: number) => join(run, attemptRelative(number), "work");
const present = (path: string) => { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };
const bytesFor = (value: unknown, max = RECORD_BYTES) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n"); requireThat(bytes.length <= max, "owned record exceeds byte limit"); return bytes;
};

function syncDirectory(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function exclusiveFile(path: string, bytes: Uint8Array, mode = 0o400): void {
  noSymlinks(dirname(path));
  const fd = openSync(path, "wx", mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}
function privateDirectory(path: string): void {
  noSymlinks(path, true);
  if (present(path)) { requireThat(lstatSync(path).isDirectory(), `not a directory: ${path}`); return; }
  privateDirectory(dirname(path));
  try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  noSymlinks(path); requireThat(lstatSync(path).isDirectory(), `not a directory: ${path}`);
  syncDirectory(dirname(path));
}
function writeState(run: string, state: PreparationState): void {
  const temp = join(run, `.state-${randomUUID()}.tmp`);
  exclusiveFile(temp, bytesFor(state, STATE_BYTES), 0o600);
  renameSync(temp, join(run, "state.json")); syncDirectory(run);
}
function hashOrNull(value: unknown, label: string): asserts value is string | null { if (value !== null) validHash(value, label); }
export function parseState(value: unknown): PreparationState {
  const v = object(value, ["schemaVersion", "admissionSha256", "phase", "attempts", "checkpointSha256", "sealSha256", "invalidReason"], "state");
  requireThat(v.schemaVersion === 1 && PHASES.includes(v.phase as Phase), "unsupported owned state"); validHash(v.admissionSha256, "state admission hash");
  hashOrNull(v.checkpointSha256, "checkpoint hash"); hashOrNull(v.sealSha256, "seal hash");
  requireThat(v.invalidReason === null || typeof v.invalidReason === "string" && v.invalidReason.length <= 512, "invalid state reason");
  requireThat(Array.isArray(v.attempts) && v.attempts.length <= CONFIG.maxPreparationAttempts, "invalid preparation attempt count");
  const attempts = v.attempts.map((entry, index) => {
    const attempt = object(entry, ["number", "status", "receiptSha256", "payloadSha256"], "attempt");
    requireThat(attempt.number === index + 1 && ["running", "failed", "succeeded"].includes(attempt.status as string), "invalid attempt sequence/status");
    hashOrNull(attempt.receiptSha256, "attempt receipt hash");
    hashOrNull(attempt.payloadSha256, "attempt payload hash");
    requireThat((attempt.status === "running") === (attempt.receiptSha256 === null) && (attempt.status === "running") === (attempt.payloadSha256 === null), "invalid running/receipt/payload state");
    requireThat(index === (v.attempts as unknown[]).length - 1 || attempt.status === "failed", "only the last attempt may run or succeed");
    return attempt as unknown as Attempt;
  });
  const phase = v.phase as Phase, last = attempts.at(-1);
  if (phase !== "invalid") {
    requireThat(v.invalidReason === null, "unexpected invalid state reason");
    requireThat(phase === "admitted" ? attempts.length === 0 : attempts.length > 0, "phase/attempt mismatch");
    if (phase === "preparing") requireThat(last?.status === "running", "preparing state lacks its running attempt");
    if (phase === "failed") requireThat(last?.status === "failed", "failed state lacks a closed failure receipt");
    if (phase === "prepared" || phase === "sealed") requireThat(last?.status === "succeeded" && v.checkpointSha256 !== null, "completed state lacks a prepared checkpoint");
    else requireThat(v.checkpointSha256 === null, "unexpected prepared checkpoint");
    requireThat((phase === "sealed") === (v.sealSha256 !== null), "phase/seal mismatch");
  } else requireThat(v.invalidReason !== null, "invalid state needs a reason");
  return { schemaVersion: 1, admissionSha256: v.admissionSha256, phase, attempts, checkpointSha256: v.checkpointSha256, sealSha256: v.sealSha256, invalidReason: v.invalidReason as string | null };
}
const readState = (run: string) => parseState(readJson(join(run, "state.json"), STATE_BYTES));

export function resolveRun(root: string, argument: string): string {
  absolutePath(root, "checkout root");
  requireThat(typeof argument === "string" && argument.length > 0 && !argument.split(/[\\/]/).some(part => part === "." || part === ".."), "run path must not contain traversal");
  const run = resolve(root, argument); absolutePath(run, "run path");
  requireThat(pathInside(join(root, "output", "song-prep"), run), "run must be a new private directory below output/song-prep in this checkout");
  noSymlinks(run, true); return run;
}
function checkOwnedRun(root: string, argument: string): string {
  const run = resolveRun(root, argument); noSymlinks(run);
  const info = lstatSync(run);
  requireThat(info.isDirectory() && (info.mode & 0o777) === 0o700 && (process.getuid === undefined || info.uid === process.getuid()), "run must be an owned private 0700 directory");
  return run;
}
/** Synchronous admission is separate so durable admitted-state verification is testable. */
export function admitPreparation(root: string, requestPath: string, argument: string): string {
  const run = resolveRun(root, argument);
  requireThat(!present(run), "run already exists; preserve it and use an explicit resume or a new run");
  const input = admitRequest(root, absolutePath(requestPath, "request path"));
  const implementation = captureImplementation(root), runtime = captureRuntime(root), provenance = gitProvenance(root);
  const admission: Admission = { schemaVersion: 1, kind: KIND, root, run, createdAt: new Date().toISOString(),
    request: input.request, files: input.files.map(({ bytes: _bytes, ...pin }) => pin), sourceSha256: input.sourceSha256,
    canonicalPhrasePlanSha256: input.canonicalPhrasePlanSha256, config: CONFIG, implementation, runtime, provenance };
  const bytes = bytesFor(admission);
  privateDirectory(dirname(run)); mkdirSync(run, { mode: 0o700 }); syncDirectory(dirname(run));
  privateDirectory(join(run, "inputs", "instructions")); privateDirectory(join(run, "attempts"));
  for (const file of input.files) exclusiveFile(join(run, file.snapshot), file.bytes);
  exclusiveFile(join(run, "admission.json"), bytes);
  writeState(run, { schemaVersion: 1, admissionSha256: sha256(bytes), phase: "admitted", attempts: [], checkpointSha256: null, sealSha256: null, invalidReason: null });
  return run;
}

function readAdmission(root: string, run: string, state: PreparationState): Admission {
  const bytes = readRegular(join(run, "admission.json"), RECORD_BYTES);
  requireThat(sha256(bytes) === state.admissionSha256, "admission/pin record changed; create a new run");
  const v = object(parseJson(bytes, "admission"), ["schemaVersion", "kind", "root", "run", "createdAt", "request", "files", "sourceSha256", "canonicalPhrasePlanSha256", "config", "implementation", "runtime", "provenance"], "admission");
  requireThat(v.schemaVersion === 1 && v.kind === KIND && v.root === root && v.run === run, "admission belongs to another contract, checkout or run");
  requireThat(typeof v.createdAt === "string" && v.createdAt.length <= 64 && Number.isFinite(Date.parse(v.createdAt)), "invalid admission timestamp");
  validHash(v.sourceSha256, "source hash"); hashOrNull(v.canonicalPhrasePlanSha256, "canonical phrase plan hash");
  equal(v.config, CONFIG, "normalized configuration or fixed limits changed; create a new run");
  const provenance = object(v.provenance, ["head", "tree"], "Git provenance");
  requireThat([provenance.head, provenance.tree].every(value => typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value)), "invalid Git provenance");
  // Provenance records the original HEAD/tree; working bytes determine compatibility.
  requireThat(Array.isArray(v.files) && v.files.length >= 3 && v.files.length <= 11, "invalid input pin count");
  for (const file of v.files) object(file, ["original", "snapshot", "size", "sha256"], "input pin");
  const first = v.files[0] as InputPin;
  absolutePath(first.original, "original request path"); requireThat(first.snapshot === "inputs/request.json", "invalid raw request snapshot");
  return v as unknown as Admission;
}
function validatePins(root: string, run: string, admission: Admission): void {
  const input = admitRequest(root, admission.files[0]!.original);
  equal(input.request, admission.request, "normalized request changed; create a new run");
  equal(input.files.map(({ bytes: _bytes, ...pin }) => pin), admission.files, "original inputs/instructions changed; create a new run");
  equal(input.canonicalPhrasePlanSha256, admission.canonicalPhrasePlanSha256, "canonical phrase plan changed; create a new run");
  requireThat(input.sourceSha256 === admission.sourceSha256, "source hash changed; create a new run");
  for (const file of input.files) equal(readRegular(join(run, file.snapshot), file.size), file.bytes, `snapshot changed: ${file.snapshot}`);
  const snapshotInventory = capturePayload(run, "inputs");
  equal(snapshotInventory.files.map(file => file.path), input.files.map(file => file.snapshot).sort(), "missing or extra snapshot files");
  equal(snapshotInventory.directories, ["inputs", "inputs/instructions"], "missing or extra snapshot directories");
  equal(captureImplementation(root), admission.implementation, "working implementation/catalog/package bytes changed; create a new run");
  equal(captureRuntime(root), admission.runtime, "selected runtime/TSX loader/lockfile changed; create a new run");
}

function validateReceipt(value: unknown): StageReceipt {
  const v = object(value, ["schemaVersion", "outcome", "closed", "commands", "logs", "integrityError"], "stage receipt");
  requireThat(v.schemaVersion === 1 && ["succeeded", "failed", "interrupted", "timed-out", "ambiguous", "invalid"].includes(v.outcome as string) && typeof v.closed === "boolean", "invalid stage outcome");
  requireThat(v.integrityError === null || typeof v.integrityError === "string" && v.integrityError.length <= 512, "invalid stage integrity reason");
  requireThat(Array.isArray(v.commands) && v.commands.length <= 2, "invalid stage command count");
  v.commands.forEach((entry, index) => {
    const command = object(entry, ["command", "exitCode", "signal", "termination", "groupClosed"], "stage command");
    requireThat(command.command === ["prepare-song", "song-bundle-verify"][index], "unexpected stage command");
    requireThat(command.exitCode === null || Number.isInteger(command.exitCode) && Number(command.exitCode) >= 0 && Number(command.exitCode) <= 255, "invalid child exit code");
    requireThat(command.signal === null || typeof command.signal === "string" && /^SIG[A-Z0-9]+$/.test(command.signal), "invalid child signal");
    requireThat(["exit", "timeout", "interrupt", "spawn-error", "descendants"].includes(command.termination as string) && typeof command.groupClosed === "boolean", "invalid child closure receipt");
  });
  const logs = object(v.logs, ["stdout", "stderr"], "logs");
  for (const name of ["stdout", "stderr"]) {
    const log = object(logs[name], ["bytes", "capturedBytes", "truncated"], "log statistics");
    requireThat(Number.isSafeInteger(log.bytes) && Number(log.bytes) >= 0 && Number.isSafeInteger(log.capturedBytes) && Number(log.capturedBytes) >= 0 && Number(log.capturedBytes) <= CONFIG.logBytes
      && Number(log.capturedBytes) <= Number(log.bytes) && log.truncated === (Number(log.bytes) > Number(log.capturedBytes)), "invalid bounded log statistics");
  }
  const receipt = v as unknown as StageReceipt;
  requireThat(receipt.closed === receipt.commands.every(command => command.groupClosed), "inconsistent child-group receipt");
  if (receipt.outcome === "succeeded") requireThat(receipt.closed && receipt.integrityError === null && receipt.commands.length === 2 && receipt.commands.every(command => command.exitCode === 0 && command.signal === null && command.termination === "exit"), "success lacks actual preparation and bundle-verification receipts");
  requireThat(receipt.outcome === "ambiguous" ? !receipt.closed : receipt.closed, "outcome has uncertain cleanup");
  return receipt;
}
function validateLayout(run: string, state: PreparationState, locked: boolean): void {
  const allowed = ["admission.json", "inputs", "attempts", "state.json", ...(locked ? [".mutation.lock"] : []),
    ...(state.checkpointSha256 ? ["prepared.json"] : []), ...(state.sealSha256 ? ["seal.json"] : [])].sort();
  equal(readdirSync(run).sort(), allowed, "unexpected/missing owned run files; arbitrary partial output is not adopted");
  equal(readdirSync(join(run, "attempts")).sort(), state.attempts.map(attempt => attemptName(attempt.number)).sort(), "unexpected/missing preparation attempt directories");
  for (const attempt of state.attempts) {
    requireThat(attempt.receiptSha256 !== null, "ambiguous running attempt; create a new run");
    const dir = join(run, attemptRelative(attempt.number)); noSymlinks(dir);
    const bytes = readRegular(join(dir, "stage-receipt.json"), STATE_BYTES);
    requireThat(sha256(bytes) === attempt.receiptSha256, "closed attempt receipt changed");
    const receipt = validateReceipt(parseJson(bytes, "stage receipt"));
    requireThat(receipt.closed && (attempt.status === "succeeded") === (receipt.outcome === "succeeded"), "attempt status/receipt mismatch");
    requireThat(capturePayload(run, attemptRelative(attempt.number)).sha256 === attempt.payloadSha256, "closed attempt payload changed");
    for (const name of ["stdout", "stderr"] as const) requireThat(digestFile(join(dir, `${name}.log`), CONFIG.logBytes).size === receipt.logs[name].capturedBytes, "closed attempt log size changed");
  }
  // Failed attempts are retained too; each individually small directory must not
  // multiply the documented run-wide file/byte limits across retries.
  capturePayload(run);
}

/** Fixed output paths and real bundle evidence supplement the runner exit receipt. */
function validatePreparedOutputs(run: string, admission: Admission, number: number): void {
  const work = workPath(run, number), baseId = `upload-${admission.sourceSha256}`;
  const result = readJson(join(work, "result.json"), STATE_BYTES) as Record<string, unknown>;
  requireThat(result?.baseId === baseId && result.sourceSha256 === admission.sourceSha256 && result.bundle === join(work, "bundle") && result.installed === join(work, "installed") && result.status === "provisional", "preparation result does not identify the expected owned payload");
  equal(result.checks, { freshImport: true, musicalIdempotence: true }, "maintained preparation did not complete both installation checks");
  const artifactFiles = ["manifest.json", ...CONFIG.levels.flatMap(level => ["notes.json", "variant.mid", "variant.xml"].map(name => `${level}/${name}`))];
  const required = [...artifactFiles.map(path => `artifacts/${path}`), "rows.json", "timeline.json", "playback.json", "chords.mid", "chords.musicxml"].sort();
  const bundle = join(work, "bundle"), bundleBytes = readRegular(join(bundle, "bundle.json"), STATE_BYTES);
  const manifest = object(parseJson(bundleBytes, "bundle manifest"), ["schemaVersion", "baseId", "status", "assessment", "requiredCapability", "files"], "bundle manifest");
  requireThat(manifest.schemaVersion === 1 && manifest.baseId === baseId && manifest.requiredCapability === "prepared-source-fingerprint-and-phrase-rests-v1", "incompatible prepared bundle manifest");
  const hashes = object(manifest.files, required, "bundle files");
  for (const file of required) {
    validHash(hashes[file], `bundle file ${file}`);
    requireThat(digestFile(join(bundle, file), CONFIG.payloadBytes).sha256 === hashes[file], `bundle payload changed: ${file}`);
  }
  const installed = join(work, "installed"), marker = object(readJson(join(installed, "bundle-install.json"), STATE_BYTES), ["bundleHash", "baseId", "status"], "installation marker");
  requireThat(marker.baseId === baseId && marker.bundleHash === sha256(bundleBytes) && marker.status === "verified", "fresh isolated installation is not verified");
  const rows = readJson(join(bundle, "rows.json"), CONFIG.implementationFileBytes);
  requireThat(Array.isArray(rows) && rows.length === 6, "bundle must contain six catalog rows");
  equal(rows.map(row => row.level).sort(), [...CONFIG.levels].sort(), "bundle does not contain all six tiers");
  requireThat(rows.every(row => row.baseId === baseId && row.id === `${baseId}-${row.level}` && row.title === admission.request.title && row.artist === admission.request.artist), "bundle rows do not match the admitted source/title/artist");
  for (const file of artifactFiles) requireThat(digestFile(join(installed, "artifacts", baseId, file), CONFIG.payloadBytes).sha256 === hashes[`artifacts/${file}`], `installed artifact differs: ${file}`);
  const original = readJson(join(bundle, "artifacts/manifest.json"), STATE_BYTES) as Record<string, unknown>;
  requireThat(original?.baseId === baseId && original.sourceArtifactHash === admission.sourceSha256 && original.arrangementProfile === "source", "Original manifest is not bound to the admitted source profile");
  if (admission.canonicalPhrasePlanSha256 !== null) {
    equal(original.phrasePlan, { schemaVersion: 1, sha256: admission.canonicalPhrasePlanSha256, sourceSha256: admission.sourceSha256 }, "Original phrase plan pin differs");
    equal(result.phrasePlan, { schemaVersion: 1, path: join(work, "phrase-plan.json"), sha256: admission.canonicalPhrasePlanSha256, fileSha256: admission.request.phrasePlan!.sha256, sourceSha256: admission.sourceSha256 }, "prepared phrase plan pin differs");
  } else requireThat(original.phrasePlan === undefined && result.phrasePlan === undefined, "unexpected prepared phrase plan");
  requireThat(digestFile(join(installed, "db.sqlite"), CONFIG.payloadBytes).size > 0 && digestFile(join(work, "data/db.sqlite"), CONFIG.payloadBytes).size > 0, "source and installed SQLite payloads are required");
}

function readPrepared(run: string, state: PreparationState): PreparedCheckpoint {
  const bytes = readRegular(join(run, "prepared.json"), RECORD_BYTES);
  requireThat(sha256(bytes) === state.checkpointSha256, "prepared checkpoint changed");
  const v = object(parseJson(bytes, "prepared checkpoint"), ["schemaVersion", "admissionSha256", "attempt", "payload"], "prepared checkpoint");
  requireThat(v.schemaVersion === 1 && v.admissionSha256 === state.admissionSha256 && v.attempt === state.attempts.length, "prepared checkpoint ownership mismatch");
  object(v.payload, ["files", "directories", "sha256"], "prepared payload");
  equal(v.payload, capturePayload(run), "prepared payload inventory changed (missing, extra, linked or modified files)");
  return v as unknown as PreparedCheckpoint;
}
function readSeal(run: string, state: PreparationState, prepared: PreparedCheckpoint): Seal {
  const bytes = readRegular(join(run, "seal.json"), STATE_BYTES); requireThat(sha256(bytes) === state.sealSha256, "seal changed");
  const expected: Seal = { schemaVersion: 1, admissionSha256: state.admissionSha256, preparedSha256: state.checkpointSha256!, payloadSha256: prepared.payload.sha256,
    status: "provisional", completion: "structural-artifacts", providerCalls: 0, productionAdmission: false, assessments: ASSESSMENTS };
  equal(parseJson(bytes, "seal"), expected, "invalid provisional seal"); return expected;
}
function report(run: string, state: PreparationState, payload?: PayloadInventory): WorkflowReport {
  return { schemaVersion: 1, run, phase: state.phase, status: state.phase === "sealed" ? "complete" : state.phase === "prepared" ? "prepared" : state.phase === "invalid" ? "invalid" : "incomplete",
    provisional: true, attempts: state.attempts.length, retryAllowed: ["admitted", "failed"].includes(state.phase) && state.attempts.length < CONFIG.maxPreparationAttempts,
    providerCalls: 0, productionAdmission: false, assessments: ASSESSMENTS, ...(payload ? { payloadSha256: payload.sha256 } : {}) };
}

/** No lock/writes/stage commands/DB calls. Git enumerates source paths read-only. */
export function verifyPreparation(root: string, argument: string): WorkflowReport {
  const run = checkOwnedRun(root, argument);
  requireThat(!present(join(run, ".mutation.lock")), "run has an active or abandoned mutation lock; no lock stealing is supported");
  const state = readState(run);
  requireThat(state.phase !== "preparing", "ambiguous running attempt; create a new run");
  requireThat(state.phase !== "invalid", `run integrity is invalid: ${state.invalidReason}`);
  const admission = readAdmission(root, run, state); validatePins(root, run, admission); validateLayout(run, state, false);
  if (state.phase === "prepared" || state.phase === "sealed") {
    const prepared = readPrepared(run, state); if (state.phase === "sealed") readSeal(run, state, prepared);
    return report(run, state, prepared.payload);
  }
  return report(run, state);
}

export async function resumePreparation(root: string, argument: string, options: WorkflowOptions = {}): Promise<WorkflowReport> {
  const run = checkOwnedRun(root, argument), lock = join(run, ".mutation.lock"), lockBytes = bytesFor({ schemaVersion: 1, pid: process.pid, nonce: randomUUID() }, STATE_BYTES);
  // `wx` is the whole lock protocol. There is deliberately no PID-age cleanup.
  try { exclusiveFile(lock, lockBytes, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new IntegrityError("run has an active or abandoned mutation lock; no lock stealing is supported"); throw error; }
  const previousUmask = process.umask(0o077);
  let release = true, state: PreparationState | undefined, ownedChildClosed = true;
  try {
    state = readState(run);
    if (state.phase === "preparing") { release = false; throw new IntegrityError("ambiguous persisted running attempt; create a new run"); }
    requireThat(state.phase !== "invalid", `run integrity is invalid: ${state.invalidReason}`);
    const admission = readAdmission(root, run, state); validatePins(root, run, admission); validateLayout(run, state, true);
    if (state.phase === "sealed") { const prepared = readPrepared(run, state); readSeal(run, state, prepared); return report(run, state, prepared.payload); }
    if (state.phase === "admitted" || state.phase === "failed") {
      if (state.attempts.length >= CONFIG.maxPreparationAttempts) return report(run, state);
      if (options.signal?.aborted) return report(run, state);
      const number = state.attempts.length + 1, attempt = join(run, attemptRelative(number));
      mkdirSync(attempt, { mode: 0o700 }); privateDirectory(join(attempt, "tmp"));
      state = { ...state, phase: "preparing", attempts: [...state.attempts, { number, status: "running", receiptSha256: null, payloadSha256: null }] };
      writeState(run, state); // durable attempt count and running state precede any spawn
      ownedChildClosed = false;
      const receipt = validateReceipt(await (options.runner ?? runPreparationStage)({ root, attempt, work: workPath(run, number),
        source: join(run, "inputs/source.mid"), ...(admission.request.phrasePlan ? { phrasePlan: join(run, "inputs/phrase-plan.json") } : {}),
        title: admission.request.title, artist: admission.request.artist, runtime: admission.runtime, signal: options.signal }));
      ownedChildClosed = receipt.closed;
      const receiptBytes = bytesFor(receipt, STATE_BYTES); exclusiveFile(join(attempt, "stage-receipt.json"), receiptBytes);
      if (!receipt.closed) { release = false; throw new IntegrityError("child process group cleanup is ambiguous; create a new run"); }
      validatePins(root, run, admission); // inputs/code/config/runtime must still match after the stage
      requireThat(receipt.outcome !== "invalid", receipt.integrityError ?? "preparation output integrity failure");
      if (receipt.outcome !== "succeeded") {
        capturePayload(run);
        const payloadSha256 = capturePayload(run, attemptRelative(number)).sha256;
        state = { ...state, phase: "failed", attempts: [...state.attempts.slice(0, -1), { number, status: "failed", receiptSha256: sha256(receiptBytes), payloadSha256 }] };
        writeState(run, state); return report(run, state);
      }
      validatePreparedOutputs(run, admission, number);
      const payload = capturePayload(run), prepared: PreparedCheckpoint = { schemaVersion: 1, admissionSha256: state.admissionSha256, attempt: number, payload };
      const preparedBytes = bytesFor(prepared); exclusiveFile(join(run, "prepared.json"), preparedBytes);
      state = { ...state, phase: "prepared", attempts: [...state.attempts.slice(0, -1), { number, status: "succeeded", receiptSha256: sha256(receiptBytes), payloadSha256: capturePayload(run, attemptRelative(number)).sha256 }], checkpointSha256: sha256(preparedBytes) };
      writeState(run, state);
    }
    const prepared = readPrepared(run, state);
    if (options.until === "prepared") return report(run, state, prepared.payload);
    validatePins(root, run, admission); // final sealing is a distinct stage with fresh pins
    const seal: Seal = { schemaVersion: 1, admissionSha256: state.admissionSha256, preparedSha256: state.checkpointSha256!, payloadSha256: prepared.payload.sha256,
      status: "provisional", completion: "structural-artifacts", providerCalls: 0, productionAdmission: false, assessments: ASSESSMENTS };
    const sealBytes = bytesFor(seal, STATE_BYTES); exclusiveFile(join(run, "seal.json"), sealBytes);
    state = { ...state, phase: "sealed", sealSha256: sha256(sealBytes) }; writeState(run, state);
    validatePins(root, run, admission); equal(capturePayload(run), prepared.payload, "payload changed during sealing");
    return report(run, state, prepared.payload);
  } catch (error) {
    if (!ownedChildClosed) release = false;
    if (state && release && state.phase !== "invalid") {
      state = { ...state, phase: "invalid", invalidReason: (error as Error).message.slice(0, 512) };
      writeState(run, state);
    }
    throw error;
  } finally {
    process.umask(previousUmask);
    if (release) {
      equal(readRegular(lock, STATE_BYTES), lockBytes, "mutation lock ownership changed; preserve run for inspection");
      unlinkSync(lock); syncDirectory(run);
    }
  }
}
export async function prepareWorkflow(root: string, requestPath: string, argument: string, options: WorkflowOptions = {}): Promise<WorkflowReport> {
  const run = admitPreparation(root, requestPath, argument); return resumePreparation(root, run, options);
}
export function preparationCapabilities(root: string) {
  return { schemaVersion: 1, deterministicPreparationContractVersions: [1], sourceFormats: ["midi"], resume: true, readOnlyVerify: true,
    maxPreparationAttempts: CONFIG.maxPreparationAttempts, automaticRetries: false, providerCalls: 0, productionAdmission: false,
    implementationSha256: captureImplementation(root).sha256 };
}
