import type { Note } from "@keyspilli/midi";

/** The two worker-level route labels. The legacy route remains the safe default. */
export type TranscriptionRoute = "EXTERNAL_SYMBOLIC_FIRST" | "AUDIO_AMT_FALLBACK";

type EvidenceClass =
  | "VERIFIED_NATIVE_SYMBOLIC"
  | "VERIFIED_STRUCTURED_BAND_SYMBOLIC"
  | "PIANO_COVER_SYMBOLIC"
  | "PIANO_COVER_AUDIO"
  | "TAB_OR_CHORD_EVIDENCE"
  | "AUDIO_AMT_FALLBACK"
  | "BENCHMARK_REFERENCE";

type EvidencePurpose = "GENERATION_CANDIDATE" | "RESEARCH_LEAD" | "BENCHMARK_REFERENCE";

interface FrozenCandidate {
  recordId: string;
  candidate: {
    evidenceClass: EvidenceClass;
    purpose: EvidencePurpose;
    status: "parsed";
    provenance: { sourceRef: string; acquisition?: string; acquiredVia?: string };
    content: { sha256: string };
  };
}

/** Structural view of catalog's frozen set; intentionally does not import its local-only module. */
export interface ExternalSymbolicFrozenCandidateSet {
  schemaVersion: 1;
  digest: string;
  selected: readonly FrozenCandidate[];
}

export interface ExternalSymbolicSourceLineage {
  recordId: string;
  role: "melody" | "harmony" | "bass-root" | "rhythm" | "timing-only";
  startBeat: number;
  endBeat: number;
}

/** Output produced by a caller that has already realized a local frozen set. */
export interface ExternalSymbolicRouteOutput {
  notes: readonly Note[];
  sourceLineage: readonly ExternalSymbolicSourceLineage[];
}

export interface ExternalSymbolicRouteInput {
  /** `false` is an explicit opt-out; omitted means try external evidence when supplied. */
  enabled?: boolean;
  mode?: "auto" | "external-symbolic-first" | "audio-fallback";
  candidateSet?: ExternalSymbolicFrozenCandidateSet;
  output?: ExternalSymbolicRouteOutput;
}

export interface TranscriptionRouteDecision {
  route: TranscriptionRoute;
  status: "selected" | "fallback";
  selectedRecordIds: string[];
  notes?: readonly Note[];
  provenance?: {
    schemaVersion: 1;
    route: "EXTERNAL_SYMBOLIC_FIRST";
    candidateSetDigest: string;
    selectedRecordIds: string[];
    sourceLineage: readonly ExternalSymbolicSourceLineage[];
  };
  fallbackReason?: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const LOGICAL_SOURCE = /^(?:[a-z][a-z0-9+.-]*:)[^/\\\s]+(?:[/#?].*)?$|^[a-z0-9][a-z0-9._-]*:[^/\\\s]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function deeplyFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.getOwnPropertyNames(value).every((key) => deeplyFrozen((value as Record<string, unknown>)[key], seen));
}

function validNote(value: unknown): value is Note {
  if (!isRecord(value)) return false;
  const midi = value.midi;
  const start = value.start;
  const dur = value.dur;
  const vel = value.vel;
  if (typeof midi !== "number" || !Number.isInteger(midi) || midi < 0 || midi > 127
    || typeof start !== "number" || !Number.isFinite(start) || start < 0
    || typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0
    || typeof vel !== "number" || !Number.isInteger(vel) || vel < 1 || vel > 127) return false;
  return value.hand === undefined || value.hand === "L" || value.hand === "R";
}

function validSourceRef(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const source = value.trim();
  if (/^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]|~[\\/])/.test(source)) return false;
  if (/(?:^|[\\/])[^\\/]+\.(?:mid|midi|musicxml|xml|mxl|wav|mp3|json)(?:[?#].*)?$/i.test(source)) return false;
  return LOGICAL_SOURCE.test(source);
}

function fallback(reason: string): TranscriptionRouteDecision {
  return { route: "AUDIO_AMT_FALLBACK", status: "fallback", selectedRecordIds: [], fallbackReason: reason };
}

function validateCandidateSet(value: unknown): { set?: ExternalSymbolicFrozenCandidateSet; reason?: string } {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.digest !== "string" || !SHA256.test(value.digest)
    || !Array.isArray(value.selected) || !deeplyFrozen(value)) return { reason: "external candidate set is not an immutable frozen set" };
  const selected: FrozenCandidate[] = [];
  const ids = new Set<string>();
  for (const raw of value.selected) {
    if (!isRecord(raw) || typeof raw.recordId !== "string" || !raw.recordId.trim() || ids.has(raw.recordId)
      || !isRecord(raw.candidate)) return { reason: "external candidate set contains malformed or duplicate records" };
    const candidate = raw.candidate;
    if (candidate.evidenceClass === "BENCHMARK_REFERENCE" || candidate.purpose === "BENCHMARK_REFERENCE") return { reason: "benchmark/reference evidence cannot enter generation" };
    if (!["VERIFIED_NATIVE_SYMBOLIC", "VERIFIED_STRUCTURED_BAND_SYMBOLIC", "PIANO_COVER_SYMBOLIC", "PIANO_COVER_AUDIO", "TAB_OR_CHORD_EVIDENCE", "AUDIO_AMT_FALLBACK"].includes(String(candidate.evidenceClass))) return { reason: "external candidate has an unsupported evidence class" };
    if (candidate.purpose !== "GENERATION_CANDIDATE" || candidate.status !== "parsed" || !isRecord(candidate.provenance) || !validSourceRef(candidate.provenance.sourceRef)) return { reason: "external candidate provenance is not generation-safe" };
    const acquisition = candidate.provenance.acquisition ?? candidate.provenance.acquiredVia;
    if (typeof acquisition !== "string" || !/^local-(?:analysis|import|file|bytes)$/i.test(acquisition)) return { reason: "external candidate acquisition is not local" };
    if (!isRecord(candidate.content) || typeof candidate.content.sha256 !== "string" || !SHA256.test(candidate.content.sha256)) return { reason: "external candidate is missing a valid content hash" };
    ids.add(raw.recordId);
    selected.push(raw as unknown as FrozenCandidate);
  }
  if (!selected.length) return { reason: "external candidate set is empty" };
  return { set: { schemaVersion: 1, digest: value.digest.toLowerCase(), selected } };
}

function validateOutput(output: unknown, ids: ReadonlySet<string>): { output?: ExternalSymbolicRouteOutput; lineage?: ExternalSymbolicSourceLineage[]; reason?: string } {
  if (!isRecord(output) || !Array.isArray(output.notes) || output.notes.length === 0 || !Array.isArray(output.sourceLineage) || output.sourceLineage.length === 0) return { reason: "external symbolic output requires notes and source lineage" };
  if (output.notes.some((note) => !validNote(note))) return { reason: "external symbolic output contains malformed notes" };
  const lineage: ExternalSymbolicSourceLineage[] = [];
  for (const raw of output.sourceLineage) {
    if (!isRecord(raw) || typeof raw.recordId !== "string" || !ids.has(raw.recordId)
      || !["melody", "harmony", "bass-root", "rhythm", "timing-only"].includes(String(raw.role))
      || typeof raw.startBeat !== "number" || !Number.isFinite(raw.startBeat) || raw.startBeat < 0
      || typeof raw.endBeat !== "number" || !Number.isFinite(raw.endBeat) || raw.endBeat <= raw.startBeat) return { reason: "external symbolic output lineage is malformed or unfrozen" };
    lineage.push({ recordId: raw.recordId, role: raw.role as ExternalSymbolicSourceLineage["role"], startBeat: raw.startBeat, endBeat: raw.endBeat });
  }
  return { output: { notes: output.notes as Note[], sourceLineage: lineage }, lineage };
}

/**
 * Select an already-realized local symbolic result, otherwise preserve the
 * existing audio AMT/metal route. This adapter performs no I/O and never
 * invokes a downloader, parser, or catalog mutation.
 */
export function selectTranscriptionRoute(input?: ExternalSymbolicRouteInput): TranscriptionRouteDecision {
  if (!input || input.enabled === false || input.mode === "audio-fallback") return fallback("external symbolic route was not requested");
  const candidateResult = validateCandidateSet(input.candidateSet);
  if (!candidateResult.set) return fallback(candidateResult.reason ?? "external candidate set is unavailable");
  const ids = new Set(candidateResult.set.selected.map((entry) => entry.recordId));
  const outputResult = validateOutput(input.output, ids);
  if (!outputResult.output || !outputResult.lineage) return fallback(outputResult.reason ?? "external symbolic output is unavailable");
  const selectedRecordIds = [...new Set(outputResult.lineage.map((line) => line.recordId))].sort();
  const notes = outputResult.output.notes.map((note) => Object.freeze({ ...note }));
  const sourceLineage = outputResult.lineage.map((line) => Object.freeze({ ...line }));
  return {
    route: "EXTERNAL_SYMBOLIC_FIRST",
    status: "selected",
    selectedRecordIds,
    notes: Object.freeze(notes),
    provenance: Object.freeze({
      schemaVersion: 1,
      route: "EXTERNAL_SYMBOLIC_FIRST",
      candidateSetDigest: candidateResult.set.digest,
      selectedRecordIds,
      sourceLineage: Object.freeze(sourceLineage),
    }),
  };
}
