import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi, splitHands, type Note, type ParsedMidi } from "@keyspilli/midi";
import {
  evaluateHarmony,
  type HarmonyChange,
  type HarmonyGateOptions,
  type HarmonyWindowMetrics,
} from "./harmony-evaluation.js";
import { normalizeHarmonyBenchmarkManifest, type HarmonyBenchmarkManifest, type HarmonyBenchmarkScoreInput } from "./harmony-benchmark-manifest.js";

/** A path-bearing local-only extension. It is never serialized in a report. */
export interface HarmonyBenchmarkSidecarScore {
  id: string;
  referencePath: string;
  baselinePath?: string;
  currentPath?: string;
  /** Alias for currentPath, useful for a single candidate input. */
  candidatePath?: string;
  referenceSha256?: string;
  baselineSha256?: string;
  currentSha256?: string;
  candidateSha256?: string;
  /** The default role is the role-filtered lower/accompaniment lane. */
  role?: "left-hand" | "harmony" | "all";
}

export interface HarmonyBenchmarkSidecarInput {
  schemaVersion: 1;
  scores: HarmonyBenchmarkSidecarScore[];
}

export interface HarmonyBenchmarkParsedSources {
  reference?: ParsedMidi;
  baseline?: ParsedMidi;
  current?: ParsedMidi;
  /** Alias accepted by pure callers that only have one candidate. */
  candidate?: ParsedMidi;
  role?: HarmonyBenchmarkSidecarScore["role"];
  sourceDiagnostics?: string[];
}

export interface HarmonyBenchmarkEvaluationOptions {
  gate?: HarmonyGateOptions;
  role?: HarmonyBenchmarkSidecarScore["role"];
}

export interface HarmonyBenchmarkCandidateResult {
  status: "available" | "unavailable" | "alignment-required";
  metrics: HarmonyWindowMetrics | null;
  gate: "pass" | "fail" | "null";
  windowsEvaluated: number;
  diagnostics: string[];
  canonicalSha256: string | null;
}

export interface HarmonyBenchmarkComparison {
  chromaAgreementDelta: number | null;
  rootAgreementDelta: number | null;
  bassAgreementDelta: number | null;
  qualityAgreementDelta: number | null;
  changeTimingErrorDelta: number | null;
  lowRegisterMudRateDelta: number | null;
  notesPerAttackDelta: number | null;
}

export interface HarmonyBenchmarkSongResult {
  id: string;
  title: string;
  artist: string;
  status: "available" | "unavailable" | "alignment-required";
  baseline: HarmonyBenchmarkCandidateResult;
  current: HarmonyBenchmarkCandidateResult;
  comparison: HarmonyBenchmarkComparison | null;
  windowsEvaluated: number;
  failureClusters: string[];
  diagnostics: string[];
}

export interface HarmonyBenchmarkFailureCluster {
  code: string;
  count: number;
  songIds: string[];
}

export interface HarmonyBenchmarkCoverage {
  manifestScoreCount: number;
  referenceAvailableCount: number;
  baselineAvailableCount: number;
  currentArtifactCount: number;
  currentEvaluableCount: number;
  comparablePairCount: number;
  requiredComparablePairCount: number;
  recordingAvailableCount: number;
  eligible: boolean;
  blockers: string[];
}

export interface HarmonyBenchmarkReport {
  schemaVersion: 1;
  kind: "harmony-benchmark-report";
  manifestStatus: HarmonyBenchmarkManifest["status"];
  songs: HarmonyBenchmarkSongResult[];
  failureClusters: HarmonyBenchmarkFailureCluster[];
  coverage: HarmonyBenchmarkCoverage;
  canonicalSha256: string;
}

export interface HarmonyBenchmarkRunnerOptions {
  manifestPath: string;
  sidecarPath?: string;
  sidecar?: HarmonyBenchmarkSidecarInput;
  out: string;
  gate?: HarmonyGateOptions;
}

export interface HarmonyBenchmarkRunResult {
  path: string;
  json: string;
  report: HarmonyBenchmarkReport;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHA256 = /^[0-9a-f]{64}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const EPS = 1e-9;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, nested]) => [key, stable(nested)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value), null, 2) + "\n";
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeId(value: unknown, context: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${context} has invalid id`);
  return value;
}

function safeHash(value: unknown, context: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${context} must be a sha256 hash`);
  return value.toLowerCase();
}

function safePath(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`${context} must be a local path`);
  }
  if (/^(?:file|https?):/i.test(value.trim())) throw new Error(`${context} must be a local path`);
  return value;
}

function sidecarRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Validate the path-bearing sidecar at the local process boundary. */
export function normalizeHarmonyBenchmarkSidecar(input: HarmonyBenchmarkSidecarInput): HarmonyBenchmarkSidecarInput {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.scores)) throw new Error("harmony sidecar schemaVersion 1 and scores are required");
  const scores = input.scores.map((raw, index) => {
    const row = sidecarRecord(raw);
    const allowed = new Set(["id", "referencePath", "baselinePath", "currentPath", "candidatePath", "referenceSha256", "baselineSha256", "currentSha256", "candidateSha256", "role"]);
    for (const key of Object.keys(row)) if (!allowed.has(key)) throw new Error(`sidecar.scores[${index}] contains unsupported field`);
    const id = safeId(row.id, `sidecar.scores[${index}].id`);
    const referencePath = safePath(row.referencePath, `${id}.referencePath`);
    const result: HarmonyBenchmarkSidecarScore = { id, referencePath };
    for (const key of ["baselinePath", "currentPath", "candidatePath"] as const) {
      if (row[key] !== undefined) result[key] = safePath(row[key], `${id}.${key}`);
    }
    for (const key of ["referenceSha256", "baselineSha256", "currentSha256", "candidateSha256"] as const) {
      if (row[key] !== undefined) result[key] = safeHash(row[key], `${id}.${key}`);
    }
    if (row.role !== undefined && row.role !== "left-hand" && row.role !== "harmony" && row.role !== "all") throw new Error(`${id}.role is invalid`);
    if (row.role !== undefined) result.role = row.role;
    return result;
  }).sort((left, right) => compareCodeUnits(left.id, right.id));
  if (new Set(scores.map((score) => score.id)).size !== scores.length) throw new Error("sidecar score IDs must be unique");
  return { schemaVersion: 1, scores };
}

function pathInsideRepository(candidate: string, repository: string): boolean {
  const relativePath = relative(repository, candidate);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/** Reject existing or future paths that resolve into this checkout. */
export async function assertHarmonyBenchmarkPathOutsideRepository(pathValue: string, context: string): Promise<string> {
  const repository = await realpath(REPO_ROOT);
  const candidate = resolve(pathValue);
  const resolved = await nearestExistingPath(candidate);
  if (pathInsideRepository(resolved, repository) || pathInsideRepository(candidate, repository)) {
    throw new Error(`${context} resolves inside repository`);
  }
  return candidate;
}

function sortedNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((left, right) => left.start - right.start || left.midi - right.midi || left.dur - right.dur || left.vel - right.vel);
}

function roleNotes(notes: readonly Note[], role: HarmonyBenchmarkSidecarScore["role"]): Note[] {
  if (role === "all") return sortedNotes(notes);
  const explicit = notes.filter((note) => note.hand === "L" || (role !== "left-hand" && note.identitySource === "guitar"));
  if (explicit.length) return sortedNotes(explicit);
  return sortedNotes(splitHands([...notes]).lh);
}

function pitchClass(value: number): number {
  return ((value % 12) + 12) % 12;
}

function noteGroups(notes: readonly Note[]): Note[][] {
  const groups: Note[][] = [];
  for (const note of sortedNotes(notes)) {
    const previous = groups.at(-1);
    if (previous && note.start - previous[0]!.start <= 0.08 + EPS) previous.push(note);
    else groups.push([note]);
  }
  return groups;
}

function referenceEvidence(notes: readonly Note[], startBeat: number, endBeat: number): {
  chroma: number[];
  changes: HarmonyChange[];
} {
  const clipped = sortedNotes(notes.filter((note) => note.start >= startBeat && note.start < endBeat));
  const chroma = Array.from({ length: 12 }, () => 0);
  for (const note of clipped) chroma[pitchClass(note.midi)]! += Math.min(note.dur, endBeat - note.start);
  const changes = noteGroups(clipped).map((attack) => {
    const root = pitchClass(Math.min(...attack.map((note) => note.midi)));
    const intervals = new Set(attack.map((note) => pitchClass(note.midi - root)));
    const quality = intervals.has(4) && intervals.has(7) ? "major" as const
      : intervals.has(3) && intervals.has(7) ? "minor" as const
        : intervals.has(7) ? "power" as const : "single" as const;
    return { beat: attack[0]!.start, rootPc: root, bassPc: root, quality };
  });
  return { chroma, changes };
}

function emptyCandidate(status: HarmonyBenchmarkCandidateResult["status"], diagnostics: string[], windowsEvaluated = 0): HarmonyBenchmarkCandidateResult {
  return { status, metrics: null, gate: status === "alignment-required" ? "null" : "null", windowsEvaluated, diagnostics: [...new Set(diagnostics)].sort(), canonicalSha256: null };
}

function delta(left: number | null | undefined, right: number | null | undefined): number | null {
  return finite(left) && finite(right) ? rounded(right - left) : null;
}

function comparison(baseline: HarmonyBenchmarkCandidateResult, current: HarmonyBenchmarkCandidateResult): HarmonyBenchmarkComparison | null {
  if (!baseline.metrics || !current.metrics) return null;
  return {
    chromaAgreementDelta: delta(baseline.metrics.chromaAgreement, current.metrics.chromaAgreement),
    rootAgreementDelta: delta(baseline.metrics.rootAgreement, current.metrics.rootAgreement),
    bassAgreementDelta: delta(baseline.metrics.bassAgreement, current.metrics.bassAgreement),
    qualityAgreementDelta: delta(baseline.metrics.qualityAgreement, current.metrics.qualityAgreement),
    changeTimingErrorDelta: delta(baseline.metrics.changeTiming.medianErrorBeats, current.metrics.changeTiming.medianErrorBeats),
    lowRegisterMudRateDelta: delta(baseline.metrics.playability.lowRegisterMudRate, current.metrics.playability.lowRegisterMudRate),
    notesPerAttackDelta: delta(baseline.metrics.leftHand.notesPerAttack, current.metrics.leftHand.notesPerAttack),
  };
}

function failureClusters(result: HarmonyBenchmarkCandidateResult): string[] {
  if (result.status === "unavailable") return ["candidate-unavailable"];
  if (result.status === "alignment-required") return ["alignment-required"];
  const metrics = result.metrics;
  if (!metrics) return ["candidate-unavailable"];
  const failures: string[] = [];
  if (metrics.chromaAgreement !== null && metrics.chromaAgreement < 0.7) failures.push("chroma-disagreement");
  if (metrics.rootAgreement !== null && metrics.rootAgreement < 0.75) failures.push("root-disagreement");
  if (metrics.bassAgreement !== null && metrics.bassAgreement < 0.75) failures.push("bass-disagreement");
  if (metrics.qualityAgreement !== null && metrics.qualityAgreement < 0.7) failures.push("quality-disagreement");
  if (metrics.changeTiming.medianErrorBeats !== null && metrics.changeTiming.medianErrorBeats > 0.5) failures.push("change-timing");
  if (metrics.unsupportedChanges.rate !== null && metrics.unsupportedChanges.rate > 0.25) failures.push("unsupported-changes");
  if (metrics.playability.lowRegisterMudRate !== null && metrics.playability.lowRegisterMudRate > 0.25) failures.push("low-register-mud");
  if (metrics.leftHand.maxNotesPerAttack !== null && metrics.leftHand.maxNotesPerAttack > 4) failures.push("left-hand-density");
  if (metrics.playability.jumpRate !== null && metrics.playability.jumpRate > 0.25) failures.push("jump-rate");
  return failures.sort();
}

function evaluateCandidate(
  referenceNotes: readonly Note[],
  candidate: ParsedMidi | undefined,
  windows: HarmonyBenchmarkScoreInput["reference"]["trustedCoverage"]["windows"],
  role: HarmonyBenchmarkSidecarScore["role"] | undefined,
  gate: HarmonyGateOptions | undefined,
): HarmonyBenchmarkCandidateResult {
  if (!candidate) return emptyCandidate("unavailable", ["candidate evidence unavailable"]);
  if (!windows.length) return emptyCandidate("alignment-required", ["trusted alignment windows are required"]);
  const orderedWindows = [...windows].sort((left, right) => left.startBeat - right.startBeat || compareCodeUnits(left.id, right.id));
  if (new Set(orderedWindows.map((window) => window.id)).size !== orderedWindows.length
    || orderedWindows.some((window, index) => index > 0 && window.startBeat < orderedWindows[index - 1]!.endBeat)) {
    return emptyCandidate("alignment-required", ["trusted alignment windows must be one-to-one and non-overlapping"]);
  }
  const filteredReference = roleNotes(referenceNotes, role);
  const filteredCandidate = roleNotes(candidate.notes, role);
  const evaluated = windows.map((window) => {
    const evidence = referenceEvidence(filteredReference, window.startBeat, window.endBeat);
    return {
      id: window.id,
      startBeat: window.startBeat,
      endBeat: window.endBeat,
      reference: evidence,
      candidate: { leftHandNotes: filteredCandidate },
    };
  });
  const report = evaluateHarmony({ windows: evaluated }, gate ?? { enabled: true });
  const status: HarmonyBenchmarkCandidateResult["status"] = report.status === "available" ? "available" : "unavailable";
  return {
    status,
    metrics: status === "available" ? report.metrics : null,
    gate: report.gate.status === "pass" || report.gate.status === "fail" ? report.gate.status : "null",
    windowsEvaluated: evaluated.length,
    diagnostics: [...report.diagnostics].sort(),
    canonicalSha256: report.determinism.canonicalSha256,
  };
}

function songResult(score: HarmonyBenchmarkScoreInput, sources: HarmonyBenchmarkParsedSources | undefined, options: HarmonyBenchmarkEvaluationOptions): HarmonyBenchmarkSongResult {
  const diagnostics: string[] = [];
  const role = sources?.role ?? options.role ?? "left-hand";
  if (!sources?.reference) {
    diagnostics.push(...(sources?.sourceDiagnostics ?? []), "reference evidence unavailable");
    const unavailable = emptyCandidate("unavailable", diagnostics);
    return { id: score.id, title: score.title, artist: score.artist, status: "unavailable", baseline: unavailable, current: unavailable, comparison: null, windowsEvaluated: 0, failureClusters: ["candidate-unavailable", "reference-unavailable"], diagnostics };
  }
  const baseline = evaluateCandidate(sources.reference.notes, sources.baseline, score.reference.trustedCoverage.windows, role, options.gate);
  const current = evaluateCandidate(sources.reference.notes, sources.current ?? sources.candidate, score.reference.trustedCoverage.windows, role, options.gate);
  const clusters = failureClusters(current);
  const status = current.status === "alignment-required" ? "alignment-required" : current.status === "available" ? "available" : "unavailable";
  return {
    id: score.id, title: score.title, artist: score.artist, status, baseline, current,
    comparison: comparison(baseline, current), windowsEvaluated: current.windowsEvaluated,
    failureClusters: clusters, diagnostics: [...diagnostics, ...(sources?.sourceDiagnostics ?? []), ...current.diagnostics].sort(),
  };
}

function benchmarkCoverage(manifest: HarmonyBenchmarkManifest, songs: readonly HarmonyBenchmarkSongResult[], sources: ReadonlyMap<string, HarmonyBenchmarkParsedSources>): HarmonyBenchmarkCoverage {
  const manifestScoreCount = manifest.scores.length;
  const referenceAvailableCount = manifest.scores.filter((score) => sources.get(score.id)?.reference !== undefined).length;
  const baselineAvailableCount = songs.filter((song) => song.baseline.status === "available").length;
  const currentArtifactCount = songs.filter((song) => song.current.status === "available").length;
  const currentEvaluableCount = songs.filter((song) => song.current.status === "available" && song.current.metrics !== null).length;
  const comparablePairCount = songs.filter((song) => song.baseline.status === "available" && song.current.status === "available"
    && song.baseline.metrics !== null && song.current.metrics !== null).length;
  const requiredComparablePairCount = 3;
  const recordingAvailableCount = manifest.scores.filter((score) => score.recording.status === "available").length;
  const blockers: string[] = [];
  if (referenceAvailableCount < manifestScoreCount) blockers.push("references-incomplete");
  if (baselineAvailableCount < manifestScoreCount) blockers.push("baseline-artifacts-incomplete");
  if (currentArtifactCount < manifestScoreCount) blockers.push("current-artifacts-incomplete");
  if (currentEvaluableCount < manifestScoreCount) blockers.push("current-evaluable-incomplete");
  if (comparablePairCount < requiredComparablePairCount) blockers.push("comparable-pairs-insufficient");
  if (recordingAvailableCount < manifestScoreCount) blockers.push("recordings-incomplete");
  blockers.sort(compareCodeUnits);
  return {
    manifestScoreCount, referenceAvailableCount, baselineAvailableCount, currentArtifactCount, currentEvaluableCount,
    comparablePairCount, requiredComparablePairCount, recordingAvailableCount, eligible: blockers.length === 0, blockers,
  };
}

/** Evaluate every manifest score without reading files or mutating state. */
export function evaluateHarmonyBenchmark(
  manifest: HarmonyBenchmarkManifest,
  sources: ReadonlyMap<string, HarmonyBenchmarkParsedSources>,
  options: HarmonyBenchmarkEvaluationOptions = {},
): HarmonyBenchmarkReport {
  const songs = [...manifest.scores].sort((left, right) => compareCodeUnits(left.id, right.id)).map((score) => songResult(score, sources.get(score.id), options));
  const clusterMap = new Map<string, string[]>();
  for (const song of songs) for (const cluster of song.failureClusters) (clusterMap.get(cluster) ?? (clusterMap.set(cluster, []), clusterMap.get(cluster)!)).push(song.id);
  const failureClusters = [...clusterMap.entries()].map(([code, songIds]) => ({ code, count: songIds.length, songIds: [...new Set(songIds)].sort(compareCodeUnits) })).sort((left, right) => compareCodeUnits(left.code, right.code));
  const coverage = benchmarkCoverage(manifest, songs, sources);
  const base = { schemaVersion: 1 as const, kind: "harmony-benchmark-report" as const, manifestStatus: manifest.status, songs, failureClusters, coverage };
  const canonicalSha256 = hashBytes(new TextEncoder().encode(canonicalJson(base)));
  return { ...base, canonicalSha256 };
}

export function canonicalHarmonyBenchmarkReportJson(report: HarmonyBenchmarkReport): string {
  const { canonicalSha256: _ignored, ...base } = report;
  void _ignored;
  return canonicalJson(base);
}

async function readJson(pathValue: string): Promise<unknown> {
  return JSON.parse(await readFile(pathValue, "utf8")) as unknown;
}

async function readParsedMidi(pathValue: string, expectedSha256: string | undefined, context: string, diagnostics: string[]): Promise<ParsedMidi | undefined> {
  if (!expectedSha256) {
    diagnostics.push(`${context} sha256 is required`);
    return undefined;
  }
  try {
    const bytes = await readFile(pathValue);
    if (hashBytes(bytes).toLowerCase() !== expectedSha256.toLowerCase()) {
      diagnostics.push(`${context} sha256 mismatch`);
      return undefined;
    }
    let parsed: ParsedMidi;
    try {
      parsed = parseMidi(bytes);
    } catch {
      diagnostics.push(`${context} MIDI is malformed`);
      return undefined;
    }
    if (parsed.notes.length === 0) {
      diagnostics.push(`${context} MIDI contains no notes`);
      return undefined;
    }
    return parsed;
  } catch {
    diagnostics.push(`${context} artifact unavailable`);
    return undefined;
  }
}

async function sidecarSources(manifest: HarmonyBenchmarkManifest, sidecar: HarmonyBenchmarkSidecarInput | undefined, baseDirectory: string): Promise<ReadonlyMap<string, HarmonyBenchmarkParsedSources>> {
  const result = new Map<string, HarmonyBenchmarkParsedSources>();
  if (!sidecar) return result;
  const normalized = normalizeHarmonyBenchmarkSidecar(sidecar);
  for (const entry of normalized.scores) {
    if (!manifest.scores.some((score) => score.id === entry.id)) continue;
    const manifestScore = manifest.scores.find((score) => score.id === entry.id)!;
    const referencePath = await assertHarmonyBenchmarkPathOutsideRepository(resolve(baseDirectory, entry.referencePath), `${entry.id} reference artifact`);
    const baselinePath = entry.baselinePath ? await assertHarmonyBenchmarkPathOutsideRepository(resolve(baseDirectory, entry.baselinePath), `${entry.id} baseline artifact`) : undefined;
    const currentPathValue = entry.currentPath ?? entry.candidatePath;
    const currentPath = currentPathValue ? await assertHarmonyBenchmarkPathOutsideRepository(resolve(baseDirectory, currentPathValue), `${entry.id} current artifact`) : undefined;
    const sourceDiagnostics: string[] = [];
    const referenceExpectedHash = entry.referenceSha256 ?? manifestScore.reference.trustedCoverage.referenceSha256;
    const reference = await readParsedMidi(referencePath, referenceExpectedHash, `${entry.id} reference artifact`, sourceDiagnostics);
    const baseline = baselinePath ? await readParsedMidi(baselinePath, entry.baselineSha256, `${entry.id} baseline artifact`, sourceDiagnostics) : undefined;
    const currentExpectedHash = entry.currentSha256 ?? entry.candidateSha256
      ?? (manifestScore.candidate.status === "available" ? manifestScore.candidate.sha256 : undefined);
    const current = currentPath ? await readParsedMidi(currentPath, currentExpectedHash, `${entry.id} current artifact`, sourceDiagnostics) : undefined;
    result.set(entry.id, { ...(reference ? { reference } : {}), ...(baseline ? { baseline } : {}), ...(current ? { current } : {}), ...(entry.role ? { role: entry.role } : {}), ...(sourceDiagnostics.length ? { sourceDiagnostics } : {}) });
  }
  return result;
}

/** Run the local-only benchmark and write one path-free report outside Git. */
export async function runHarmonyBenchmark(options: HarmonyBenchmarkRunnerOptions): Promise<HarmonyBenchmarkRunResult> {
  const manifestInput = await readJson(resolve(options.manifestPath));
  const manifest = normalizeHarmonyBenchmarkManifest(manifestInput as Parameters<typeof normalizeHarmonyBenchmarkManifest>[0]);
  const sidecar = options.sidecar ?? (options.sidecarPath ? await readJson(resolve(options.sidecarPath)) as HarmonyBenchmarkSidecarInput : undefined);
  const sources = await sidecarSources(manifest, sidecar, options.sidecarPath ? dirname(resolve(options.sidecarPath)) : dirname(resolve(options.manifestPath)));
  const report = evaluateHarmonyBenchmark(manifest, sources, { gate: options.gate });
  const outputDirectory = await assertHarmonyBenchmarkPathOutsideRepository(options.out, "harmony benchmark output directory");
  await mkdir(outputDirectory, { recursive: true });
  const pathValue = join(outputDirectory, "harmony-benchmark-report.json");
  const json = canonicalHarmonyBenchmarkReportJson(report).replace(/\n$/, "") + "\n";
  const outputDirectoryStat = await lstat(outputDirectory);
  if (!outputDirectoryStat.isDirectory() || outputDirectoryStat.isSymbolicLink()) throw new Error("harmony benchmark output directory must not be a symlink");
  try {
    const reportStat = await lstat(pathValue);
    if (reportStat.isSymbolicLink()) throw new Error("harmony benchmark report path must not be a symlink");
    if (!reportStat.isFile()) throw new Error("harmony benchmark report path must be a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = join(outputDirectory, `.harmony-benchmark-report.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporaryPath, json, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, pathValue);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { path: pathValue, json, report };
}
