import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  alignSymbolicScores,
  type SymbolicAlignmentResult,
} from "./symbolic-alignment.js";
import {
  evaluateArrangementNotes,
  type EvaluationWindow,
} from "./arrangement-evaluation.js";
import {
  researchExternalCandidates,
  type ExternalResearchDiscoveryRecord,
  type ExternalResearchLocalInput,
  type ExternalResearchRecord,
  type ExternalResearchParserStatus,
} from "./external-research.js";
import {
  buildExternalSymbolicArrangement,
  freezeGenerationCandidateSet,
} from "./external-symbolic-pipeline.js";
import type { Note } from "@keyspilli/midi";

/** Inventory labels only. They are deliberately not used by evidence guards. */
export const SEVEN_SONG_BENCHMARK_IDS = [
  "sabaton-the-red-baron",
  "sabaton-the-final-solution",
  "sabaton-christmas-truce",
  "lynyrd-skynyrd-free-bird",
  "sabaton-1916",
  "sabaton-gott-mit-uns",
  "sabaton-the-caroleans-prayer",
] as const;

export type ExternalBenchmarkSongId = (typeof SEVEN_SONG_BENCHMARK_IDS)[number];

/** Closed taxonomy for automated reports. */
export const EXTERNAL_BENCHMARK_FAILURES = [
  "MISSING_INVENTORY_ID", "MISSING_DISCOVERY", "METADATA_ONLY", "LOCAL_ACQUISITION_MISSING",
  "UNSUPPORTED_FORMAT", "PARSE_FAILED", "MISSING_CONTENT_HASH", "IDENTITY_MISMATCH",
  "ALIGNMENT_UNAVAILABLE", "ALIGNMENT_PARTIAL", "ALIGNMENT_AMBIGUOUS", "NO_USABLE_GENERATION_CANDIDATE",
  "GENERATION_FAILED", "OUTPUT_UNAVAILABLE", "MISSING_REFERENCE", "INVALID_INPUT", "HUMAN_REVIEW_MISSING",
  "HUMAN_REVIEW_INSUFFICIENT_RATERS", "HUMAN_REVIEW_CONFLICT",
] as const;
export type ExternalBenchmarkFailure = (typeof EXTERNAL_BENCHMARK_FAILURES)[number];

export type ExternalBenchmarkRole = "melody" | "harmony" | "bass-root" | "rhythm" | "timing-only";

export interface ExternalBenchmarkWindow {
  id: string;
  candidate: [number, number];
  reference: [number, number];
  role?: ExternalBenchmarkRole;
}

export interface ExternalBenchmarkHumanRater {
  raterId?: string;
  id?: string;
  decision?: string;
  verdict?: string;
  status?: string;
}

export interface ExternalBenchmarkSongInput {
  id: string;
  discoveryRecords?: readonly ExternalResearchDiscoveryRecord[];
  /** Aliases are accepted to keep the seam provider-neutral. */
  discovery?: readonly ExternalResearchDiscoveryRecord[];
  candidateInputs?: readonly ExternalResearchLocalInput[];
  candidateInput?: ExternalResearchLocalInput;
  candidate?: ExternalResearchLocalInput | readonly ExternalResearchLocalInput[];
  candidates?: readonly ExternalResearchLocalInput[];
  localCandidates?: readonly ExternalResearchLocalInput[];
  referenceInputs?: readonly ExternalResearchLocalInput[];
  references?: readonly ExternalResearchLocalInput[];
  referenceInput?: ExternalResearchLocalInput;
  reference?: ExternalResearchLocalInput | readonly ExternalResearchLocalInput[];
  referenceDiscoveryRecords?: readonly ExternalResearchDiscoveryRecord[];
  windows?: readonly ExternalBenchmarkWindow[];
  humanRaters?: readonly ExternalBenchmarkHumanRater[];
  raters?: readonly ExternalBenchmarkHumanRater[];
  /** Any callback would make the evaluation non-local and is rejected. */
  discover?: unknown;
  acquire?: unknown;
}

export interface ExternalBenchmarkInput {
  songs: readonly ExternalBenchmarkSongInput[];
}

export interface ExternalBenchmarkReferenceReport {
  availability: "available" | "metadata-only" | "unavailable";
  recordIds: string[];
  parsedCount: number;
  validatedWindows: ExternalBenchmarkWindow[];
  windows: ExternalBenchmarkWindow[];
  alignment: {
    status: "not-requested" | "aligned" | "partial" | "ambiguous" | "unavailable";
    confidence: number | null;
    coverage: { reference: number | null; candidate: number | null };
    diagnostics: string[];
    roleFilteredWindows: Array<{ id: string; role: ExternalBenchmarkRole | null; candidatePitchedCount: number; referencePitchedCount: number }>;
  };
}

export interface ExternalBenchmarkHumanReport {
  status: "ready" | "blocked";
  raters: number;
  agreeing: boolean;
  decision: "accept" | "reject" | null;
}

export interface ExternalBenchmarkSongReport {
  id: ExternalBenchmarkSongId;
  present: boolean;
  discovery: { status: "supplied" | "missing"; count: number; metadataOnly: number; errors: string[] };
  candidates: { discovered: number; acquired: number; usable: number; parsed: number; recordIds: string[] };
  candidateCounts: { discovered: number; acquired: number; usable: number };
  counts: { discovered: number; acquired: number; usable: number };
  freeze: { completed: boolean; beforeReference: boolean; digest: string | null; selectedRecordIds: string[]; rejectedRecordIds: string[] };
  frozenGenerationCandidateSetDigest: string | null;
  generation: { status: "symbolic" | "fallback" | "unavailable"; selectedRecordIds: string[]; diagnostics: string[] };
  generationStatus: "symbolic" | "fallback" | "unavailable";
  output: { availability: "available" | "unavailable"; status: "symbolic" | "fallback" | "unavailable"; structuralGate: "pass" | "fail" | "unavailable" };
  outputAvailability: "available" | "unavailable";
  reference: ExternalBenchmarkReferenceReport;
  referenceAvailability: "available" | "metadata-only" | "unavailable";
  human: ExternalBenchmarkHumanReport;
  /** Alias retained for callers that use the hand-off vocabulary. */
  humanReadiness: ExternalBenchmarkHumanReport;
  failures: ExternalBenchmarkFailure[];
}

export interface ExternalBenchmarkReport {
  schemaVersion: 1;
  inventory: { requiredIds: ExternalBenchmarkSongId[]; presentIds: ExternalBenchmarkSongId[]; missingIds: ExternalBenchmarkSongId[] };
  songs: ExternalBenchmarkSongReport[];
  candidateCounts: { discovered: number; acquired: number; usable: number };
  summary: { songs: number; present: number; symbolic: number; fallback: number; unavailable: number; humanReady: number; blocked: number };
  reportHash: string;
  determinism: { canonicalSha256: string };
}

interface ScoreLike {
  parts?: Array<{ role?: string; measures?: Array<{ startBeat?: number; durationBeats?: number; events?: Array<{ onset?: number; duration?: number; pitch?: number; role?: string }>; staves?: Array<{ events?: Array<{ onset?: number; duration?: number; pitch?: number; role?: string }>; voices?: Array<{ events?: Array<{ onset?: number; duration?: number; pitch?: number; role?: string }> }> }>; voices?: Array<{ events?: Array<{ onset?: number; duration?: number; pitch?: number; role?: string }> }> }> }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean || null;
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const urls: string[] = [];
  const protectedText = text.replace(/https?:\/\/[^\s,;)}\]]+/gi, (url) => {
    const marker = `__EXTERNAL_URL_${urls.length}__`;
    urls.push(url);
    return marker;
  });
  const redacted = protectedText
    .replace(/file:\/\/[^\s,;)}\]]+/gi, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$)|~[\\/])[^\s,;)}\]]*/gi, "[redacted-path]")
    // Unknown-root absolute POSIX paths are still physical locators.
    .replace(/(?<![A-Za-z0-9_])\/(?:[^\s"'<>;,)}\]]+\/)+[^\s"'<>;,)}\]]+/g, "[redacted-path]")
    // Relative/quoted symbolic files are locators; logical refs such as A/B remain.
    .replace(/(?<![A-Za-z0-9_])(?:\.{0,2}[\\/]|[^\s"'<>;,)}\]]+[\\/])[^\s"'<>;,)}\]]+\.(?:mid|midi|musicxml|mxl|json|wav|mp3)(?=$|[\s"'<>;,)}\]])/gi, "[redacted-path]");
  return redacted.replace(/__EXTERNAL_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? "[redacted-url]")
    .replace(/[\u0000\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Path-safe diagnostic redaction shared by the local CLI and canonicalizer. */
export function redactExternalBenchmarkText(value: string): string {
  return safeError(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameId(id: string): id is ExternalBenchmarkSongId {
  return (SEVEN_SONG_BENCHMARK_IDS as readonly string[]).includes(id);
}

function validateLocalInput(input: ExternalResearchLocalInput, label: string): void {
  if (!isObject(input)) throw new Error(`${label} must be an object`);
  const path = input.filePath ?? input.localFilePath ?? input.path;
  if (path !== undefined && path !== null) {
    if (typeof path !== "string" || !path.trim()) throw new Error(`${label} local path is invalid`);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) || /^https?:/i.test(path)) throw new Error(`${label} must be an explicit local path`);
    if (!/^\//.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error(`${label} must be an absolute local path`);
  }
  if (input.bytes !== undefined && !(input.bytes instanceof Uint8Array || input.bytes instanceof ArrayBuffer)) throw new Error(`${label} bytes must be Uint8Array or ArrayBuffer`);
  if (input.bytes !== undefined && (input.bytes instanceof Uint8Array ? input.bytes.byteLength : input.bytes.byteLength) === 0) throw new Error(`${label} bytes are empty`);
  if (path !== undefined && path !== null && input.bytes !== undefined) throw new Error(`${label} must provide bytes or a local file, not both`);
}

function validateUniqueInputIds(inputs: readonly ExternalResearchLocalInput[], label: string): void {
  const seen = new Set<string>();
  for (const [index, input] of inputs.entries()) {
    const id = cleanText(input.id);
    if (id && seen.has(id)) throw new Error(`duplicate ${label} id: ${id}`);
    if (id) seen.add(id);
    if (input.id !== undefined && typeof input.id !== "string") throw new Error(`${label} ${index + 1} id must be a string`);
  }
}

async function validateLocalFileInput(input: ExternalResearchLocalInput, label: string): Promise<void> {
  const path = input.filePath ?? input.localFilePath ?? input.path;
  if (path === undefined || path === null) return;
  let resolved: string;
  try { resolved = await realpath(path); } catch { throw new Error(`${label} file does not exist or could not be resolved`); }
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} path is not a regular file`);
}

function validateWindows(windows: readonly ExternalBenchmarkWindow[] | undefined): ExternalBenchmarkWindow[] {
  if (windows === undefined) return [];
  if (!Array.isArray(windows)) throw new Error("benchmark windows must be an array");
  const seen = new Set<string>();
  const result: ExternalBenchmarkWindow[] = [];
  const validRole = new Set<ExternalBenchmarkRole>(["melody", "harmony", "bass-root", "rhythm", "timing-only"]);
  for (const window of windows) {
    if (!isObject(window) || typeof window.id !== "string" || !window.id.trim() || seen.has(window.id)) throw new Error("benchmark windows require unique non-empty ids");
    const candidate = window.candidate;
    const reference = window.reference;
    const validBounds = (bounds: unknown): bounds is [number, number] => Array.isArray(bounds) && bounds.length === 2 && finite(bounds[0]) && finite(bounds[1]) && bounds[0] >= 0 && bounds[1] > bounds[0];
    if (!validBounds(candidate) || !validBounds(reference)) throw new Error(`invalid benchmark window bounds: ${window.id}`);
    const role = window.role as ExternalBenchmarkRole | undefined;
    if (role !== undefined && !validRole.has(role)) throw new Error(`invalid benchmark window role: ${window.id}`);
    seen.add(window.id);
    result.push({ id: window.id, candidate: [candidate[0], candidate[1]], reference: [reference[0], reference[1]], ...(role ? { role } : {}) });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  const overlaps = (key: "candidate" | "reference") => result.some((left, i) => result.slice(i + 1).some((right) => left[key][0] < right[key][1] && right[key][0] < left[key][1]));
  if (overlaps("candidate") || overlaps("reference")) throw new Error("benchmark windows must not overlap");
  return result;
}

function identity(id: string) {
  return { id, title: id, artist: "external-benchmark", normalizedTitle: id, normalizedArtist: "external-benchmark", sourceYoutubeUrl: null, youtubeVideoId: null, durationSeconds: null, version: null };
}

function candidateInputsFor(song: ExternalBenchmarkSongInput): ExternalResearchLocalInput[] {
  const singular = song.candidateInput ? [song.candidateInput] : song.candidate === undefined ? [] : Array.isArray(song.candidate) ? song.candidate : [song.candidate];
  const supplied = song.candidateInputs ?? song.candidates ?? song.localCandidates ?? singular;
  if (!Array.isArray(supplied)) throw new Error("candidate inputs must be an array");
  return supplied.map((input, index) => {
    if (!isObject(input)) throw new Error(`candidate ${index + 1} input must be an object`);
    const local = input as unknown as ExternalResearchLocalInput;
    return { ...local, purpose: local.purpose ?? "GENERATION_CANDIDATE" };
  });
}

function referenceInputsFor(song: ExternalBenchmarkSongInput): ExternalResearchLocalInput[] {
  const supplied: unknown = song.referenceInputs ?? song.references ?? (song.referenceInput ? [song.referenceInput] : song.reference === undefined ? [] : Array.isArray(song.reference) ? song.reference : [song.reference]);
  if (!Array.isArray(supplied)) throw new Error("reference inputs must be an array");
  return supplied.map((input, index) => {
    if (!isObject(input)) throw new Error(`reference ${index + 1} input must be an object`);
    const local = input as unknown as ExternalResearchLocalInput;
    return { ...local, purpose: "BENCHMARK_REFERENCE" as const, evidenceClass: "BENCHMARK_REFERENCE" as const };
  });
}

function scoreNotes(score: ScoreLike | null | undefined): Note[] {
  const out: Note[] = [];
  for (const part of score?.parts ?? []) {
    let cursor = 0;
    for (const measure of part.measures ?? []) {
      const start = finite(measure.startBeat) ? measure.startBeat : cursor;
      const eventGroups = [
        ...(measure.events ?? []),
        ...(measure.staves ?? []).flatMap((staff) => [...(staff.events ?? []), ...(staff.voices ?? []).flatMap((voice) => voice.events ?? [])]),
        ...(measure.voices ?? []).flatMap((voice) => voice.events ?? []),
      ];
      for (const event of eventGroups) {
        if (!finite(event.pitch) || !finite(event.onset) || !finite(event.duration) || event.duration <= 0) continue;
        const role = event.role ?? part.role;
        out.push({ midi: Math.max(0, Math.min(127, Math.round(event.pitch))), start: Math.max(0, start + event.onset), dur: event.duration, vel: 96, ...(role === "melody" ? { hand: "R" as const } : role === "harmony" ? { hand: "L" as const } : {}) });
      }
      cursor = Math.max(cursor, start + (finite(measure.durationBeats) ? measure.durationBeats : 0));
    }
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
}

function recordStatus(record: ExternalResearchRecord): ExternalResearchParserStatus {
  return record.parser.status;
}

function alignmentSummary(result: SymbolicAlignmentResult): ExternalBenchmarkReferenceReport["alignment"] {
  const status = result.status === "aligned" ? "aligned" : result.status === "partial" ? "partial" : result.status === "mismatch" ? "ambiguous" : "unavailable";
  return {
    status,
    confidence: finite(result.confidence) ? result.confidence : null,
    coverage: { reference: finite(result.coverage.referenceRatio) ? result.coverage.referenceRatio : null, candidate: finite(result.coverage.candidateRatio) ? result.coverage.candidateRatio : null },
    diagnostics: [...new Set(result.diagnostics.map(safeError))].sort(),
    roleFilteredWindows: [],
  };
}

function notesForRole(notes: readonly Note[], role: ExternalBenchmarkRole | undefined): Note[] {
  if (!role) return [...notes];
  if (role === "timing-only") return [];
  if (role === "melody") return notes.filter((note) => note.hand === "R");
  return notes.filter((note) => note.hand === "L");
}

function roleAwareAlignment(
  referenceNotes: readonly Note[],
  candidateNotes: readonly Note[],
  windows: readonly ExternalBenchmarkWindow[],
): ExternalBenchmarkReferenceReport["alignment"] {
  const roleFilteredWindows = windows.map((window) => {
    const reference = notesForRole(referenceNotes, window.role);
    const candidate = notesForRole(candidateNotes, window.role);
    return { id: window.id, role: window.role ?? null, candidatePitchedCount: candidate.filter((note) => note.start >= window.candidate[0] && note.start < window.candidate[1]).length, referencePitchedCount: reference.filter((note) => note.start >= window.reference[0] && note.start < window.reference[1]).length };
  });
  const alignments = windows.map((window) => alignSymbolicScores(
    { notes: notesForRole(referenceNotes, window.role) },
    { notes: notesForRole(candidateNotes, window.role) },
    { windows: [{ id: window.id, candidate: window.candidate, reference: window.reference }] },
  ));
  if (!alignments.length) return { status: "unavailable", confidence: null, coverage: { reference: null, candidate: null }, diagnostics: [], roleFilteredWindows };
  const priority: Record<ExternalBenchmarkReferenceReport["alignment"]["status"], number> = { "not-requested": 0, aligned: 1, partial: 2, unavailable: 3, ambiguous: 4 };
  const summaries = alignments.map(alignmentSummary);
  const worst = summaries.reduce((left, right) => priority[right.status] > priority[left.status] ? right : left);
  const confidenceValues = summaries.map((summary) => summary.confidence).filter((value): value is number => value !== null);
  const referenceCoverage = summaries.map((summary) => summary.coverage.reference).filter((value): value is number => value !== null);
  const candidateCoverage = summaries.map((summary) => summary.coverage.candidate).filter((value): value is number => value !== null);
  const average = (values: number[]) => values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1_000_000) / 1_000_000 : null;
  return {
    status: worst.status,
    confidence: average(confidenceValues),
    coverage: { reference: average(referenceCoverage), candidate: average(candidateCoverage) },
    diagnostics: [...new Set(summaries.flatMap((summary) => summary.diagnostics))].sort(),
    roleFilteredWindows,
  };
}

function emptySong(id: ExternalBenchmarkSongId): ExternalBenchmarkSongReport {
  const human: ExternalBenchmarkHumanReport = { status: "blocked", raters: 0, agreeing: false, decision: null };
  return {
    id, present: false,
    discovery: { status: "missing", count: 0, metadataOnly: 0, errors: [] },
    candidates: { discovered: 0, acquired: 0, usable: 0, parsed: 0, recordIds: [] },
    candidateCounts: { discovered: 0, acquired: 0, usable: 0 },
    counts: { discovered: 0, acquired: 0, usable: 0 },
    freeze: { completed: true, beforeReference: true, digest: null, selectedRecordIds: [], rejectedRecordIds: [] },
    frozenGenerationCandidateSetDigest: null,
    generation: { status: "unavailable", selectedRecordIds: [], diagnostics: [] },
    generationStatus: "unavailable",
    output: { availability: "unavailable", status: "unavailable", structuralGate: "unavailable" },
    outputAvailability: "unavailable",
    reference: { availability: "unavailable", recordIds: [], parsedCount: 0, validatedWindows: [], windows: [], alignment: { status: "unavailable", confidence: null, coverage: { reference: null, candidate: null }, diagnostics: [], roleFilteredWindows: [] } },
    referenceAvailability: "unavailable",
    human, humanReadiness: human,
    failures: ["MISSING_INVENTORY_ID", "MISSING_DISCOVERY", "NO_USABLE_GENERATION_CANDIDATE", "OUTPUT_UNAVAILABLE", "MISSING_REFERENCE", "HUMAN_REVIEW_MISSING"],
  };
}

function humanResult(raters: readonly ExternalBenchmarkHumanRater[] | undefined): { report: ExternalBenchmarkHumanReport; failures: ExternalBenchmarkFailure[] } {
  if (raters === undefined || !raters.length) return { report: { status: "blocked", raters: 0, agreeing: false, decision: null }, failures: ["HUMAN_REVIEW_MISSING"] };
  const raterIds = raters.map((rater) => cleanText(rater.raterId ?? rater.id)).filter((id): id is string => Boolean(id));
  if (raterIds.length !== raters.length || new Set(raterIds).size !== raterIds.length) return { report: { status: "blocked", raters: raters.length, agreeing: false, decision: null }, failures: ["HUMAN_REVIEW_CONFLICT"] };
  const decisions = raters.map((rater) => {
    const value = (rater.decision ?? rater.verdict ?? rater.status ?? "").trim().toLowerCase();
    if (["accept", "accepted", "approve", "approved", "pass", "yes", "ready"].includes(value)) return "accept" as const;
    if (["reject", "rejected", "fail", "no", "blocked"].includes(value)) return "reject" as const;
    return null;
  });
  const unique = new Set(decisions.filter((item): item is "accept" | "reject" => item !== null));
  if (raters.length < 2) return { report: { status: "blocked", raters: raters.length, agreeing: false, decision: decisions[0] ?? null }, failures: ["HUMAN_REVIEW_INSUFFICIENT_RATERS"] };
  if (decisions.some((item) => item === null) || unique.size !== 1) return { report: { status: "blocked", raters: raters.length, agreeing: false, decision: unique.size === 1 ? [...unique][0]! : null }, failures: ["HUMAN_REVIEW_CONFLICT"] };
  return { report: { status: "ready", raters: raters.length, agreeing: true, decision: [...unique][0]! }, failures: [] };
}

function addFailure(failures: ExternalBenchmarkFailure[], failure: ExternalBenchmarkFailure): void {
  if (!failures.includes(failure)) failures.push(failure);
}

function invalidSong(id: ExternalBenchmarkSongId, error: unknown): ExternalBenchmarkSongReport {
  const row = emptySong(id);
  row.present = true;
  row.discovery = { status: "supplied", count: 0, metadataOnly: 0, errors: [safeError(error)] };
  row.freeze = { completed: false, beforeReference: false, digest: null, selectedRecordIds: [], rejectedRecordIds: [] };
  row.failures = ["INVALID_INPUT"];
  return row;
}

function isMalformedRuntimeInput(error: unknown): boolean {
  const message = safeError(error).toLowerCase();
  return /must be an object|must contain objects|inputs must be an array|raters must be an array|decisions must be strings|callbacks are not allowed|duplicate (?:candidate|reference) id/.test(message);
}

async function evaluateSong(song: ExternalBenchmarkSongInput, windows: ExternalBenchmarkWindow[]): Promise<ExternalBenchmarkSongReport> {
  if (song.discover !== undefined || song.acquire !== undefined) throw new Error("external benchmark discovery/acquisition callbacks are not allowed");
  const candidates = candidateInputsFor(song);
  const references = referenceInputsFor(song);
  validateUniqueInputIds(candidates, "candidate");
  validateUniqueInputIds(references, "reference");
  candidates.forEach((input, index) => validateLocalInput(input, `candidate ${index + 1}`));
  references.forEach((input, index) => validateLocalInput(input, `reference ${index + 1}`));
  await Promise.all(candidates.map((input, index) => validateLocalFileInput(input, `candidate ${index + 1}`)));
  await Promise.all(references.map((input, index) => validateLocalFileInput(input, `reference ${index + 1}`)));
  const discoveryRecords = song.discoveryRecords ?? song.discovery ?? [];
  if (!Array.isArray(discoveryRecords)) throw new Error("discovery records must be an array");
  if (discoveryRecords.some((record) => !isObject(record))) throw new Error("discovery records must contain objects");
  const raters = song.humanRaters ?? song.raters;
  if (song.humanRaters !== undefined && !Array.isArray(song.humanRaters)) throw new Error("human raters must be an array");
  if (song.raters !== undefined && !Array.isArray(song.raters)) throw new Error("raters must be an array");
  if (raters?.some((rater) => !isObject(rater))) throw new Error("human raters must contain objects");
  if (raters?.some((rater) => [rater.decision, rater.verdict, rater.status].some((value) => value !== undefined && typeof value !== "string"))) throw new Error("human rater decisions must be strings");

  // This is intentionally two calls: no reference bytes or score can exist
  // until the immutable generation freeze has completed.
  const candidateInventory = await researchExternalCandidates(identity(song.id), { discoveryRecords, localInputs: candidates });
  const frozen = freezeGenerationCandidateSet(candidateInventory.records, { requireAlignment: false });
  const candidateRecords = candidateInventory.records;
  const selected = frozen.selected;
  const failures: ExternalBenchmarkFailure[] = [];
  if (!discoveryRecords.length && !candidates.length) addFailure(failures, "MISSING_DISCOVERY");
  if (discoveryRecords.length && discoveryRecords.every((record) => !candidates.some((input) => input.id && input.id === record.id))) addFailure(failures, "METADATA_ONLY");
  if (candidateRecords.some((record) => record.acquisition.status === "not-supplied")) addFailure(failures, "LOCAL_ACQUISITION_MISSING");
  if (candidateRecords.some((record) => record.parser.status === "unsupported")) addFailure(failures, "UNSUPPORTED_FORMAT");
  if (candidateRecords.some((record) => record.parser.status === "invalid")) addFailure(failures, "PARSE_FAILED");
  if (candidateRecords.some((record) => !record.content.sha256)) addFailure(failures, "MISSING_CONTENT_HASH");
  if (candidateRecords.some((record) => record.rejectionReasons.some((reason) => /identity|hash|source/i.test(reason)))) addFailure(failures, "IDENTITY_MISMATCH");
  if (!selected.length) addFailure(failures, "NO_USABLE_GENERATION_CANDIDATE");

  const generation = buildExternalSymbolicArrangement({ candidateSet: frozen, windows: windows.map((window) => ({ id: window.id, startBeat: window.candidate[0], endBeat: window.candidate[1] })) });
  if (generation.status === "fallback") addFailure(failures, "GENERATION_FAILED");
  if (generation.status === "unavailable") addFailure(failures, "OUTPUT_UNAVAILABLE");
  if (generation.status !== "symbolic") addFailure(failures, "OUTPUT_UNAVAILABLE");

  // Reference ingestion starts only after the candidate freeze above.
  const referenceInventory = await researchExternalCandidates(identity(song.id), { discoveryRecords: song.referenceDiscoveryRecords ?? [], localInputs: references });
  const referenceRecords = referenceInventory.records;
  const parsedReferences = referenceRecords.filter((record) => record.parser.status === "parsed" && record.score);
  const primaryReference = parsedReferences[0];
  if (!references.length) addFailure(failures, "MISSING_REFERENCE");
  if (referenceRecords.some((record) => record.parser.status === "unsupported")) addFailure(failures, "UNSUPPORTED_FORMAT");
  if (referenceRecords.some((record) => record.parser.status === "invalid")) addFailure(failures, "PARSE_FAILED");
  const validatedWindows = windows;
  let alignment: ExternalBenchmarkReferenceReport["alignment"] = { status: "unavailable", confidence: null, coverage: { reference: null, candidate: null }, diagnostics: [], roleFilteredWindows: [] };
  const outputNotes = generation.notes ? [...generation.notes] : [];
  if (primaryReference?.score && outputNotes.length && windows.length) {
    alignment = roleAwareAlignment(scoreNotes(primaryReference.score as ScoreLike), outputNotes, windows);
    if (alignment.status === "partial") addFailure(failures, "ALIGNMENT_PARTIAL");
    if (alignment.status === "ambiguous") addFailure(failures, "ALIGNMENT_AMBIGUOUS");
    if (alignment.status === "unavailable") addFailure(failures, "ALIGNMENT_UNAVAILABLE");
  } else if (!primaryReference || !outputNotes.length || !windows.length) addFailure(failures, "ALIGNMENT_UNAVAILABLE");
  const human = humanResult(raters);
  human.failures.forEach((failure) => addFailure(failures, failure));
  const structuralGate = generation.notes?.length ? (() => {
    const evaluation = evaluateArrangementNotes([...generation.notes!], { fixture: { id: song.id }, windows: windows.map((window): EvaluationWindow => ({ id: window.id, candidate: window.candidate, reference: window.reference })) });
    return evaluation.gate.status === "pass" ? "pass" as const : "fail" as const;
  })() : "unavailable" as const;
  const candidateIds = candidateRecords.map((record) => record.id).sort();
  const referenceAvailability = parsedReferences.length ? "available" as const : referenceRecords.length ? "metadata-only" as const : "unavailable" as const;
  const outputAvailability = generation.status === "symbolic" && outputNotes.length ? "available" as const : "unavailable" as const;
  const report: ExternalBenchmarkSongReport = {
    id: song.id as ExternalBenchmarkSongId,
    present: true,
    discovery: { status: discoveryRecords.length || candidates.length ? "supplied" : "missing", count: candidateRecords.length, metadataOnly: candidateRecords.filter((record) => record.discovery.status === "metadata-only").length, errors: candidateInventory.discoveryErrors.map(safeError).sort() },
    candidates: { discovered: candidateRecords.length, acquired: candidateRecords.filter((record) => record.acquisition.status === "local-bytes" || record.acquisition.status === "local-file").length, usable: selected.length, parsed: candidateRecords.filter((record) => recordStatus(record) === "parsed").length, recordIds: candidateIds },
    candidateCounts: { discovered: candidateRecords.length, acquired: candidateRecords.filter((record) => record.acquisition.status === "local-bytes" || record.acquisition.status === "local-file").length, usable: selected.length },
    counts: { discovered: candidateRecords.length, acquired: candidateRecords.filter((record) => record.acquisition.status === "local-bytes" || record.acquisition.status === "local-file").length, usable: selected.length },
    freeze: { completed: true, beforeReference: true, digest: frozen.digest, selectedRecordIds: selected.map((entry) => entry.recordId).sort(), rejectedRecordIds: frozen.rejected.map((entry) => entry.recordId).sort() },
    frozenGenerationCandidateSetDigest: frozen.digest,
    generation: { status: generation.status, selectedRecordIds: generation.selectedRecordIds.sort(), diagnostics: Object.values(generation.diagnostics).flatMap((value) => typeof value === "string" ? [safeError(value)] : []).sort() },
    generationStatus: generation.status,
    output: { availability: outputAvailability, status: generation.status, structuralGate },
    outputAvailability,
    reference: { availability: referenceAvailability, recordIds: referenceRecords.map((record) => record.id).sort(), parsedCount: parsedReferences.length, validatedWindows, windows: validatedWindows, alignment },
    referenceAvailability,
    human: human.report, humanReadiness: human.report,
    failures: failures.sort(),
  };
  return report;
}

function stable(value: unknown, key = "", omitHashes = false): unknown {
  if (omitHashes && /^(?:reportHash|canonicalSha256)$/i.test(key)) return undefined;
  if (/(?:bytes?|notes?|events?|timestamp|path|file|locator|executable)/i.test(key)) return undefined;
  if (typeof value === "string") return safeError(value);
  if (Array.isArray(value)) return value.map((item) => stable(item, key, omitHashes)).filter((item) => item !== undefined);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((childKey) => [childKey, stable(value[childKey], childKey, omitHashes)] as const).filter(([, child]) => child !== undefined));
  return value;
}

/** Deterministic report JSON. Physical paths, bytes and event/note payloads are omitted. */
export function canonicalExternalBenchmarkJson(report: ExternalBenchmarkReport): string {
  return JSON.stringify(stable(report));
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value, "", true))).digest("hex");
}

function validateInput(input: ExternalBenchmarkInput): ExternalBenchmarkSongInput[] {
  if (!isObject(input) || !Array.isArray(input.songs)) throw new Error("external benchmark input requires a songs array");
  const seen = new Set<string>();
  for (const song of input.songs) {
    if (!isObject(song) || typeof song.id !== "string" || !song.id.trim()) throw new Error("benchmark song id is required");
    if (!sameId(song.id)) throw new Error(`unknown benchmark inventory id: ${song.id}`);
    if (seen.has(song.id)) throw new Error(`duplicate benchmark inventory id: ${song.id}`);
    seen.add(song.id);
    validateWindows((song as unknown as ExternalBenchmarkSongInput).windows);
  }
  return [...input.songs] as ExternalBenchmarkSongInput[];
}

/** Build an evaluation-only report from explicitly injected local inputs. */
export async function buildExternalBenchmarkReport(input: ExternalBenchmarkInput): Promise<ExternalBenchmarkReport> {
  const supplied = validateInput(input);
  const byId = new Map(supplied.map((song) => [song.id, song]));
  const rows: ExternalBenchmarkSongReport[] = [];
  for (const id of SEVEN_SONG_BENCHMARK_IDS) {
    const song = byId.get(id);
    if (!song) rows.push(emptySong(id));
    else {
      try { rows.push(await evaluateSong(song, validateWindows(song.windows))); }
      catch (error) {
        if (!isMalformedRuntimeInput(error)) throw error;
        rows.push(invalidSong(id, error));
      }
    }
  }
  const presentIds = rows.filter((row) => row.present).map((row) => row.id);
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    inventory: { requiredIds: [...SEVEN_SONG_BENCHMARK_IDS], presentIds, missingIds: SEVEN_SONG_BENCHMARK_IDS.filter((id) => !presentIds.includes(id)) },
    songs: rows,
    candidateCounts: {
      discovered: rows.reduce((sum, row) => sum + row.candidates.discovered, 0),
      acquired: rows.reduce((sum, row) => sum + row.candidates.acquired, 0),
      usable: rows.reduce((sum, row) => sum + row.candidates.usable, 0),
    },
    summary: {
      songs: rows.length,
      present: rows.filter((row) => row.present).length,
      symbolic: rows.filter((row) => row.generation.status === "symbolic").length,
      fallback: rows.filter((row) => row.generation.status === "fallback").length,
      unavailable: rows.filter((row) => row.generation.status === "unavailable").length,
      humanReady: rows.filter((row) => row.human.status === "ready").length,
      blocked: rows.filter((row) => row.human.status === "blocked").length,
    },
  };
  const reportHash = hashCanonical(reportWithoutHash);
  return { ...reportWithoutHash, reportHash, determinism: { canonicalSha256: reportHash } };
}
