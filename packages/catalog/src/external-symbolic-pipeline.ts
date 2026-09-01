import { createHash } from "node:crypto";
import type { Note } from "@keyspilli/midi";
import type { OmrEventInput, OmrScoreInput } from "./omr-consensus.js";
import {
  assertGenerationEvidence,
  canonicalEvidenceCandidateSet,
  type EvidenceRole,
  type EvidenceRoleRecord,
  type ExternalEvidenceCandidate,
} from "./external-evidence.js";
import type { ExternalResearchRecord } from "./external-research.js";
import {
  buildSectionAwarePianoCandidate,
  type PianoSectionBuildInput,
  type PianoSectionBuildResult,
  type PianoSectionSource,
  type PianoSectionWindow,
} from "./piano-section-builder.js";

export interface FrozenGenerationCandidate {
  recordId: string;
  candidate: ExternalEvidenceCandidate;
  score: OmrScoreInput;
  roles: readonly EvidenceRoleRecord[];
  sections?: readonly { id: string; candidate: [number, number]; confidence?: number }[];
}

export interface GenerationSection {
  id: string;
  candidate: [number, number];
  confidence?: number;
}

export interface FreezeGenerationCandidateConfig {
  /** Require the research bridge to have an aligned status. */
  requireAlignment?: boolean;
  /** Alias accepted by callers that use the shorter gate name. */
  requireAligned?: boolean;
  /** Minimum confidence across candidate, role, and section evidence. */
  minimumConfidence?: number;
  minConfidence?: number;
  confidenceThreshold?: number;
  /** Explicit section windows, keyed by record id or supplied as rows. */
  sections?: Readonly<Record<string, readonly GenerationSection[]>> | readonly (GenerationSection & { recordId: string })[];
}

export interface FrozenGenerationCandidateSet {
  schemaVersion: 1;
  selected: readonly FrozenGenerationCandidate[];
  rejected: readonly { recordId: string; reasons: string[] }[];
  digest: string;
}

const ROLES = new Set<EvidenceRole>(["melody", "harmony", "bass-root", "rhythm", "timing-only"]);
const PHYSICAL_KEY = /(?:path|file|locator|artifact)$/i;
const NOTE_DATA_KEY = /(?:notes?|events?|bytes?)(?:[_-]?(?:data|list|array|payload|rows?))?$/i;
const PATH_VALUE = /^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/~])|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeMetadata(value: unknown, key = ""): unknown {
  if (NOTE_DATA_KEY.test(key) || PHYSICAL_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => safeMetadata(item, key)).filter((item) => item !== undefined);
  if (typeof value === "string") return redactPath(value);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .map((childKey) => [childKey, safeMetadata(value[childKey], childKey)] as const)
    .filter(([, child]) => child !== undefined));
}

/** Scores are the normalized realization input, so their event rows remain; only locators are removed. */
function safeScoreMetadata(value: unknown, key = ""): unknown {
  if (PHYSICAL_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => safeScoreMetadata(item, key)).filter((item) => item !== undefined);
  if (typeof value === "string") return redactPath(value);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort()
    .map((childKey) => [childKey, safeScoreMetadata(value[childKey], childKey)] as const)
    .filter(([, child]) => child !== undefined));
}

function redactPath(value: string): string {
  return value.replace(/(?:file:\/\/|[A-Za-z]:[\\/]|~[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$))[^\s,;)}\]]*/gi, "[redacted-path]");
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
  }
  return value;
}

function deeplyFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value as Record<string, unknown>).every((child) => deeplyFrozen(child, seen));
}

function confidenceValues(candidate: ExternalEvidenceCandidate, roles: readonly EvidenceRoleRecord[], sections: readonly GenerationSection[]): number[] {
  const values: number[] = [];
  for (const value of Object.values(candidate.confidence ?? {})) if (finite(value)) values.push(value);
  for (const role of roles) if (role && finite(role.confidence)) values.push(role.confidence);
  for (const section of sections) if (section && finite(section.confidence)) values.push(section.confidence);
  return values;
}

function recordSections(recordId: string, record: ExternalResearchRecord, config: FreezeGenerationCandidateConfig): { sections: GenerationSection[]; invalid: boolean } {
  let configured: unknown[];
  if (Array.isArray(config.sections)) {
    if (config.sections.some((section) => !isRecord(section) || typeof section.recordId !== "string" || !section.recordId.trim())) return { sections: [], invalid: true };
    configured = config.sections.filter((section) => section.recordId === recordId);
  } else if (config.sections && typeof config.sections === "object") {
    configured = (config.sections as Readonly<Record<string, readonly GenerationSection[]>>)[recordId] ? [...(config.sections as Readonly<Record<string, readonly GenerationSection[]>>)[recordId]!] : [];
  } else {
    configured = [];
  }
  const supplied = (configured.length ? configured : (record as unknown as { sections?: unknown }).sections) as unknown;
  if (supplied === undefined) return { sections: [], invalid: false };
  if (!Array.isArray(supplied)) return { sections: [], invalid: true };
  const seen = new Set<string>();
  const sections: GenerationSection[] = [];
  for (const section of supplied) {
    if (!isRecord(section) || typeof section.id !== "string" || !section.id.trim()
      || !Array.isArray(section.candidate) || section.candidate.length !== 2
      || !finite(section.candidate[0]) || !finite(section.candidate[1]) || section.candidate[1] <= section.candidate[0]
      || (section.confidence !== undefined && !finite(section.confidence))) return { sections: [], invalid: true };
    if (seen.has(section.id)) return { sections: [], invalid: true };
    seen.add(section.id);
    sections.push({ id: section.id, candidate: [section.candidate[0], section.candidate[1]], ...(finite(section.confidence) ? { confidence: section.confidence } : {}) });
  }
  sections.sort((a, b) => a.id.localeCompare(b.id) || a.candidate[0] - b.candidate[0] || a.candidate[1] - b.candidate[1]);
  return { sections, invalid: false };
}

function roleRecords(record: ExternalResearchRecord, candidate: ExternalEvidenceCandidate): EvidenceRoleRecord[] {
  const supplied = candidate.roles?.length ? candidate.roles : record.roles;
  return (supplied ?? []).flatMap((role) => {
    if (!role || !ROLES.has(role.role as EvidenceRole)) return [];
    return [safeMetadata(role) as EvidenceRoleRecord];
  }).sort((a, b) => a.role.localeCompare(b.role) || (b.confidence ?? -1) - (a.confidence ?? -1));
}

function rejection(recordId: string, reasons: string[]): { recordId: string; reasons: string[] } {
  return { recordId, reasons: [...new Set(reasons)].sort() };
}

function digest(selected: readonly FrozenGenerationCandidate[]): string {
  const metadata = selected.map((entry) => ({
    recordId: entry.recordId,
    candidate: canonicalEvidenceCandidateSet([entry.candidate])[0],
    roles: entry.roles,
    ...(entry.sections ? { sections: entry.sections } : {}),
  })).sort((a, b) => a.recordId.localeCompare(b.recordId)
    || JSON.stringify(a.roles).localeCompare(JSON.stringify(b.roles))
    || JSON.stringify(a.sections ?? []).localeCompare(JSON.stringify(b.sections ?? []))
    || JSON.stringify(a.candidate).localeCompare(JSON.stringify(b.candidate)));
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}

function hasUnsafeCandidateMetadata(value: unknown, key = ""): boolean {
  if (NOTE_DATA_KEY.test(key) || PHYSICAL_KEY.test(key)) return true;
  if (typeof value === "string") return PATH_VALUE.test(value);
  if (Array.isArray(value)) return value.some((child) => hasUnsafeCandidateMetadata(child, key));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([childKey, child]) => hasUnsafeCandidateMetadata(child, childKey));
}

function isFrozenCandidateSet(value: unknown): value is FrozenGenerationCandidateSet {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.selected) || !Array.isArray(value.rejected)
    || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/i.test(value.digest)
    || !deeplyFrozen(value)) return false;
  if (value.selected.some((entry) => !isRecord(entry) || !Object.isFrozen(entry) || typeof entry.recordId !== "string"
    || !isRecord(entry.candidate) || !Object.isFrozen(entry.candidate) || hasUnsafeCandidateMetadata(entry.candidate)
    || !isRecord(entry.score) || !Object.isFrozen(entry.score) || !Array.isArray(entry.roles) || !Object.isFrozen(entry.roles)
    || entry.roles.some((role) => !isRecord(role) || !Object.isFrozen(role)))) return false;
  try {
    for (const entry of value.selected) assertGenerationEvidence(entry.candidate as ExternalEvidenceCandidate);
    return value.digest.toLowerCase() === digest(value.selected as FrozenGenerationCandidate[]).toLowerCase();
  } catch {
    return false;
  }
}

/** Validate and freeze generation candidates before any reference/benchmark work. */
export function freezeGenerationCandidateSet(
  records: readonly ExternalResearchRecord[],
  config: FreezeGenerationCandidateConfig = {},
): FrozenGenerationCandidateSet {
  const selected: FrozenGenerationCandidate[] = [];
  const rejected: { recordId: string; reasons: string[] }[] = [];
  const threshold = config.minimumConfidence ?? config.minConfidence ?? config.confidenceThreshold;
  for (const record of records ?? []) {
    const recordId = typeof record?.id === "string" && record.id.trim() ? record.id : "[unknown-record]";
    const reasons: string[] = [];
    if (!record || record.purpose === "BENCHMARK_REFERENCE" || record.evidenceClass === "BENCHMARK_REFERENCE") reasons.push("benchmark/reference evidence cannot enter generation");
    if (!record || typeof record.songId !== "string" || !record.songId.trim()) reasons.push("missing song identity");
    if (!record || record.parser?.status !== "parsed") reasons.push("candidate parser status is not parsed");
    if (!record || record.generationUsable !== true) reasons.push("candidate is not marked generation-usable");
    if (!record?.candidate) reasons.push("missing generation candidate");
    if (!record?.score) reasons.push("missing normalized score");
    const candidate = record?.candidate;
    if (candidate) {
      try {
        assertGenerationEvidence(candidate);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : "candidate failed generation evidence validation");
      }
      if (!candidate.provenance?.sourceRef?.trim()) reasons.push("missing logical source identity");
      if (!candidate.content?.sha256) reasons.push("missing content hash");
      const acquisition = candidate.provenance?.acquisition ?? candidate.provenance?.acquiredVia;
      if (typeof acquisition !== "string" || !/^local-/i.test(acquisition)) reasons.push("missing local acquisition evidence");
      if (!record.content?.sha256 || !/^[a-f0-9]{64}$/i.test(record.content.sha256)) reasons.push("record is missing a valid content hash");
      else if (candidate.content?.sha256 && record.content.sha256.toLowerCase() !== candidate.content.sha256.toLowerCase()) reasons.push("candidate content hash does not match record identity");
      if (record.acquisition?.status !== "local-bytes" && record.acquisition?.status !== "local-file") reasons.push("record acquisition is not local");
      if (record.evidenceClass !== candidate.evidenceClass || record.purpose !== candidate.purpose) reasons.push("record and candidate evidence identity disagree");
    }
    if (config.requireAlignment || config.requireAligned) {
      if (record?.alignment?.status !== "aligned") reasons.push(`alignment is ${record?.alignment?.status ?? "unavailable"}; aligned status is required`);
    } else if (["ambiguous", "rejected"].includes(record?.alignment?.status ?? "")) {
      reasons.push(`alignment is ${record.alignment.status}`);
    }
    const sectionResult = record && candidate ? recordSections(recordId, record, config) : { sections: [], invalid: false };
    if (sectionResult.invalid) reasons.push("malformed section window");
    const roles = candidate && record ? roleRecords(record, candidate) : [];
    if (threshold !== undefined && (!finite(threshold) || threshold < 0 || threshold > 1)) reasons.push("invalid confidence threshold");
    const candidateConfidence = confidenceValues(candidate ?? {} as ExternalEvidenceCandidate, roles, sectionResult.sections);
    if (threshold !== undefined && finite(threshold) && (!candidateConfidence.length || candidateConfidence.some((value) => value < threshold))) reasons.push(`confidence is below required threshold ${threshold}`);
    if (reasons.length || !candidate || !record?.score) {
      rejected.push(rejection(recordId, reasons.length ? reasons : ["candidate is unavailable"]));
      continue;
    }
    const safeCandidate = safeMetadata(candidate) as ExternalEvidenceCandidate;
    const frozen: FrozenGenerationCandidate = {
      recordId,
      candidate: safeCandidate,
      score: safeScoreMetadata(record.score) as OmrScoreInput,
      roles,
      ...(sectionResult.sections.length ? { sections: sectionResult.sections } : {}),
    };
    selected.push(frozen);
  }
  selected.sort((a, b) => a.recordId.localeCompare(b.recordId)
    || (a.roles[0]?.role ?? "").localeCompare(b.roles[0]?.role ?? "")
    || (a.sections?.[0]?.id ?? "").localeCompare(b.sections?.[0]?.id ?? "")
    || String(a.candidate.content.sha256 ?? "").localeCompare(String(b.candidate.content.sha256 ?? "")));
  rejected.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const result: FrozenGenerationCandidateSet = { schemaVersion: 1, selected, rejected, digest: digest(selected) };
  return immutable(result);
}

export interface ExternalSymbolicArrangementInput {
  candidateSet?: FrozenGenerationCandidateSet;
  frozen?: FrozenGenerationCandidateSet;
  candidates?: readonly FrozenGenerationCandidate[];
  /** Explicit local builder sources; no source outside the frozen set is used. */
  sources?: readonly PianoSectionSource[];
  primary?: PianoSectionSource;
  alternates?: readonly PianoSectionSource[];
  builderInput?: PianoSectionBuildInput;
  windows?: readonly PianoSectionWindow[];
  primaryRecordId?: string;
  fallbackEnabled?: boolean;
}

export interface ExternalSymbolicArrangementResult {
  status: "symbolic" | "fallback" | "unavailable";
  selectedRecordIds: string[];
  notes?: readonly Note[];
  artifact?: unknown;
  fallbackReason?: string;
  diagnostics: Record<string, unknown>;
}

function scoreNotes(score: OmrScoreInput): Note[] {
  const notes: Note[] = [];
  for (const part of score.parts ?? []) {
    let cursor = 0;
    for (const measure of part.measures ?? []) {
      const start = finite(measure.startBeat) ? measure.startBeat : cursor;
      const events = [
        ...(measure.events ?? []),
        ...(measure.staves ?? []).flatMap((staff) => [
          ...(staff.events ?? []),
          ...(staff.voices ?? []).flatMap((voice) => voice.events ?? []),
        ]),
        ...(measure.voices ?? []).flatMap((voice) => voice.events ?? []),
      ] as OmrEventInput[];
      for (const event of events) {
        if (!finite(event.pitch) || !finite(event.onset) || !finite(event.duration) || event.duration <= 0) continue;
        const role = event.role ?? part.role;
        notes.push({ midi: Math.max(0, Math.min(127, Math.round(event.pitch))), start: Math.max(0, start + event.onset), dur: event.duration, vel: 96, ...(role === "melody" ? { hand: "R" as const } : role === "harmony" ? { hand: "L" as const } : {}) });
      }
      cursor = Math.max(cursor, start + (finite(measure.durationBeats) ? measure.durationBeats : 0));
    }
  }
  return notes;
}

function fallbackResult(input: ExternalSymbolicArrangementInput, reason: string): ExternalSymbolicArrangementResult {
  const fallbackEnabled = input.fallbackEnabled !== false;
  return {
    status: fallbackEnabled ? "fallback" : "unavailable",
    selectedRecordIds: [],
    fallbackReason: reason,
    diagnostics: { schemaVersion: 1, candidateCount: 0, fallbackEnabled, reason },
  };
}

/** Realize only already-frozen candidates; absent explicit windows remain fallback/unavailable. */
export function buildExternalSymbolicArrangement(input: ExternalSymbolicArrangementInput): ExternalSymbolicArrangementResult {
  const set = input.candidateSet ?? input.frozen;
  if (!isFrozenCandidateSet(set)) return fallbackResult(input, "an immutable, digest-consistent frozen candidate set is required");
  const selected = [...set.selected].filter((entry) => entry.candidate.purpose !== "BENCHMARK_REFERENCE" && entry.candidate.evidenceClass !== "BENCHMARK_REFERENCE");
  if (!selected.length) return fallbackResult(input, "no frozen generation candidate is available");
  const selectedIds = new Set(selected.map((entry) => entry.recordId));
  const sourceToRecordId = new Map(selected.flatMap((entry) => [[entry.recordId, entry.recordId], ...(entry.candidate.id ? [[entry.candidate.id, entry.recordId] as const] : [])] as const));
  const supplied = input.sources
    ? input.sources.flatMap((source) => {
      const recordId = sourceToRecordId.get(source.id);
      return recordId ? [{ ...source, id: recordId }] : [];
    })
    : selected.map((entry) => ({ id: entry.recordId, notes: scoreNotes(entry.score), sourceType: "external-symbolic" }));
  if (!supplied.length) return fallbackResult(input, "no source matched the frozen candidate set");
  const primaryEntry = selected.find((entry) => entry.recordId === input.primaryRecordId) ?? selected[0];
  const windows = input.windows ? [...input.windows] : primaryEntry?.sections?.map((section) => ({ id: `${primaryEntry.recordId}:${section.id}`, startBeat: section.candidate[0], endBeat: section.candidate[1], candidateId: primaryEntry.recordId })) ?? [];
  if (!windows.length && !input.builderInput) return fallbackResult(input, "explicit section windows are required for symbolic realization");
  const primary = input.primary && selectedIds.has(input.primary.id)
    ? input.primary
    : supplied.find((source) => source.id === input.primaryRecordId) ?? supplied[0];
  if (!primary || !selectedIds.has(primary.id)) return fallbackResult(input, "frozen primary source is unavailable");
  const alternates = (input.alternates ?? supplied.filter((source) => source.id !== primary.id)).filter((source) => selectedIds.has(source.id));
  const builderInput: PianoSectionBuildInput = input.builderInput
    ? {
      ...input.builderInput,
      primary,
      alternates,
      windows: input.builderInput.windows,
    }
    : { primary, alternates, windows };
  try {
    const built: PianoSectionBuildResult = buildSectionAwarePianoCandidate(builderInput);
    return {
      status: "symbolic",
      selectedRecordIds: [primary.id, ...alternates.map((source) => source.id)].sort(),
      notes: built.cdFusedMedium.notes,
      artifact: built.cdFusedMedium,
      diagnostics: { schemaVersion: 1, candidateSetDigest: set?.digest ?? null, builder: built.diagnostics },
    };
  } catch (error) {
    return fallbackResult(input, error instanceof Error ? error.message : "symbolic realization failed");
  }
}

export interface ExternalRouteCoverageAttribution {
  evidenceClass?: string;
  /** Short aliases accepted for adapters that already use class/index terminology. */
  class?: string;
  noteIndices?: readonly number[];
  indices?: readonly number[];
  noteIndex?: number;
  index?: number;
  noteCount?: number;
  durationBeats?: number;
  duration?: number;
  confidence?: number;
}

export interface ExternalRouteCoverageInput {
  notes?: readonly Note[];
  result?: { notes?: readonly Note[] };
  totalNotes?: number;
  totalDurationBeats?: number;
  attributions?: readonly ExternalRouteCoverageAttribution[];
  attribution?: readonly ExternalRouteCoverageAttribution[];
  noteAttribution?: readonly ExternalRouteCoverageAttribution[];
  evidence?: readonly ExternalRouteCoverageAttribution[];
}

export type RouteCoverageAttribution = ExternalRouteCoverageAttribution;
export type RouteCoverageInput = ExternalRouteCoverageInput;

export interface ExternalRouteCoverageRow {
  noteCount: number | null;
  notePercentage: number | null;
  durationBeats: number | null;
  durationPercentage: number | null;
  confidence: { min: number | null; median: number | null; max: number | null };
}

export interface ExternalRouteCoverageResult {
  totalNotes: number;
  totalDurationBeats: number;
  byEvidenceClass: Record<string, ExternalRouteCoverageRow>;
  attributedNotePercentage: number | null;
  attributedDurationPercentage: number | null;
  diagnostics: string[];
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Report route coverage using explicit class-to-note attribution only. */
export function evaluateRouteCoverage(input: ExternalRouteCoverageInput): ExternalRouteCoverageResult {
  const diagnostics: string[] = [];
  const rawNotes = input.notes ?? input.result?.notes;
  const notes = rawNotes === undefined ? [] : Array.isArray(rawNotes) ? rawNotes : [];
  let invalidData = false;
  if (rawNotes !== undefined && !Array.isArray(rawNotes)) { diagnostics.push("notes must be an array"); invalidData = true; }
  const totalNotes = input.totalNotes === undefined
    ? notes.length
    : finite(input.totalNotes) && Number.isInteger(input.totalNotes) && input.totalNotes >= 0
      ? input.totalNotes : (diagnostics.push("total note count must be a non-negative integer"), invalidData = true, 0);
  const totalDurationBeats = input.totalDurationBeats === undefined
    ? notes.reduce((sum, note) => sum + (finite(note.dur) && note.dur > 0 ? note.dur : 0), 0)
    : finite(input.totalDurationBeats) && input.totalDurationBeats >= 0
      ? input.totalDurationBeats : (diagnostics.push("total duration must be a non-negative finite number"), invalidData = true, 0);
  const sourceAttributions: unknown = [input.attributions, input.attribution, input.noteAttribution, input.evidence].find((value) => value !== undefined);
  const rawAttributions: unknown[] = sourceAttributions === undefined ? [] : Array.isArray(sourceAttributions) ? [...sourceAttributions] : (diagnostics.push("evidence attribution must be an array"), invalidData = true, []);
  const attributions = rawAttributions.sort((a, b) => {
    const left = isRecord(a) ? a : {};
    const right = isRecord(b) ? b : {};
    return String(left.evidenceClass ?? left.class ?? "").localeCompare(String(right.evidenceClass ?? right.class ?? ""))
      || (Number(left.noteIndex ?? left.index ?? (Array.isArray(left.noteIndices) ? left.noteIndices[0] : undefined) ?? (Array.isArray(left.indices) ? left.indices[0] : undefined) ?? -1)
        - Number(right.noteIndex ?? right.index ?? (Array.isArray(right.noteIndices) ? right.noteIndices[0] : undefined) ?? (Array.isArray(right.indices) ? right.indices[0] : undefined) ?? -1));
  });
  const rows = new Map<string, { indices: Set<number>; noteCount: number; duration: number; confidence: number[]; aggregate: boolean }>();
  const owner = new Map<number, string>();
  for (const rawAttribution of attributions) {
    const attribution = isRecord(rawAttribution) ? rawAttribution as ExternalRouteCoverageAttribution : null;
    if (!attribution) { diagnostics.push("invalid explicit evidence attribution"); invalidData = true; continue; }
    const evidenceClass = typeof attribution?.evidenceClass === "string" ? attribution.evidenceClass : typeof attribution?.class === "string" ? attribution.class : "";
    if (!evidenceClass.trim()) { diagnostics.push("invalid explicit evidence attribution"); invalidData = true; continue; }
    const row = rows.get(evidenceClass) ?? { indices: new Set<number>(), noteCount: 0, duration: 0, confidence: [], aggregate: false };
    const rawIndices = attribution.noteIndices ?? attribution.indices;
    if (rawIndices !== undefined && !Array.isArray(rawIndices)) { diagnostics.push(`evidence class ${evidenceClass} has invalid note indices`); invalidData = true; rows.set(evidenceClass, row); continue; }
    const indices = Array.isArray(rawIndices) ? [...rawIndices] : attribution.noteIndex !== undefined ? [attribution.noteIndex] : attribution.index !== undefined ? [attribution.index] : [];
    if (indices.length) {
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= notes.length) { diagnostics.push(`evidence attribution index ${String(index)} is out of range`); invalidData = true; continue; }
        const previous = owner.get(index);
        if (previous && previous !== evidenceClass) { diagnostics.push(`note ${index} has conflicting evidence classes`); invalidData = true; }
        owner.set(index, evidenceClass);
        row.indices.add(index);
      }
      row.noteCount = row.indices.size;
      row.duration = [...row.indices].reduce((sum, index) => sum + (notes[index] && finite(notes[index]!.dur) && notes[index]!.dur > 0 ? notes[index]!.dur : 0), 0);
    } else if (attribution.noteCount !== undefined || attribution.durationBeats !== undefined || attribution.duration !== undefined) {
      const validCount = attribution.noteCount === undefined || (finite(attribution.noteCount) && Number.isInteger(attribution.noteCount) && attribution.noteCount >= 0);
      const validDuration = attribution.durationBeats === undefined && attribution.duration === undefined
        || (attribution.durationBeats !== undefined ? finite(attribution.durationBeats) && attribution.durationBeats >= 0 : finite(attribution.duration) && attribution.duration! >= 0);
      if (!validCount || !validDuration) { diagnostics.push(`evidence class ${evidenceClass} has invalid aggregate coverage`); invalidData = true; rows.set(evidenceClass, row); continue; }
      row.aggregate = true;
      row.noteCount += finite(attribution.noteCount) ? attribution.noteCount : 0;
      row.duration += finite(attribution.durationBeats) ? attribution.durationBeats : finite(attribution.duration) ? attribution.duration : 0;
    } else { diagnostics.push(`evidence class ${evidenceClass} has no note attribution`); invalidData = true; }
    if (attribution.confidence !== undefined) {
      if (finite(attribution.confidence) && attribution.confidence >= 0 && attribution.confidence <= 1) row.confidence.push(attribution.confidence);
      else { diagnostics.push(`evidence class ${evidenceClass} has invalid confidence`); invalidData = true; }
    }
    rows.set(evidenceClass, row);
  }
  const attributedNotes = [...owner.keys()];
  const completeNotes = !invalidData && attributions.length > 0 && attributedNotes.length === totalNotes && owner.size === totalNotes && diagnostics.every((item) => !/conflicting|out of range/i.test(item));
  const aggregateRows = [...rows.values()].some((row) => row.aggregate);
  const summedNotes = [...rows.values()].reduce((sum, row) => sum + row.noteCount, 0);
  const summedDuration = [...rows.values()].reduce((sum, row) => sum + row.duration, 0);
  const completeAggregate = !invalidData && attributions.length > 0 && aggregateRows && summedNotes === totalNotes && Math.abs(summedDuration - totalDurationBeats) < 1e-6;
  const complete = completeNotes || completeAggregate;
  if (!attributions.length) diagnostics.push("explicit evidence-class attribution is unavailable");
  else if (!complete) diagnostics.push("explicit evidence-class attribution is incomplete");
  const byEvidenceClass: Record<string, ExternalRouteCoverageRow> = {};
  for (const className of [...rows.keys()].sort()) {
    const row = rows.get(className)!;
    byEvidenceClass[className] = {
      noteCount: complete ? row.noteCount : null,
      notePercentage: complete && totalNotes > 0 ? rounded((row.noteCount / totalNotes) * 100) : null,
      durationBeats: complete ? rounded(row.duration) : null,
      durationPercentage: complete && totalDurationBeats > 0 ? rounded((row.duration / totalDurationBeats) * 100) : null,
      confidence: { min: row.confidence.length ? rounded(Math.min(...row.confidence)) : null, median: median(row.confidence), max: row.confidence.length ? rounded(Math.max(...row.confidence)) : null },
    };
  }
  return {
    totalNotes,
    totalDurationBeats: rounded(totalDurationBeats),
    byEvidenceClass,
    attributedNotePercentage: complete && totalNotes > 0 ? 100 : null,
    attributedDurationPercentage: complete && totalDurationBeats > 0 ? 100 : null,
    diagnostics: [...new Set(diagnostics)].sort(),
  };
}
