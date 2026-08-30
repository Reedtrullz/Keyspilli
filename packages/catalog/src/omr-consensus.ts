/**
 * Pure score comparison primitives for optional, local OMR backends.
 *
 * This module intentionally knows nothing about PDFs, subprocesses, network
 * access, or the catalog database.  Callers adapt Audiveris/homr/native
 * MusicXML into OmrScoreInput and use the deterministic functions below to
 * compare and select evidence.  Keeping the common representation here makes
 * it possible for an optional second engine to improve confidence without
 * making the normal Keyspilli runtime depend on it.
 */

export const OMR_CONSENSUS_SCHEMA_VERSION = 1 as const;
export const OMR_ONSET_TOLERANCE_BEATS = 0.08;
export const OMR_PHRASE_BREAK_BEATS = 1.5;

export type OmrRole = "melody" | "harmony" | "rhythm";
export type OmrTrustState =
  | "TRUSTED_NATIVE"
  | "TRUSTED_CONSENSUS"
  | "TRUSTED_SINGLE_ENGINE"
  | "REVIEW_REQUIRED"
  | "FAILED";
export type OmrAggregateTrustState = OmrTrustState | "PARTIALLY_TRUSTED";
export type OmrBackendStatus = "available" | "unavailable" | "failed";
/** Runtime health is additive to execution status: a backend may complete
 * some pages, produce unusable output, or be unavailable before recognition. */
export type OmrBackendHealth = "available" | "partially-available" | "unavailable" | "broken-output";
export type OmrBackendPageStatus = OmrBackendHealth | OmrBackendStatus | "pass" | "success";

/** Per-page diagnostics emitted by an image-based OMR adapter such as HOMR. */
export interface OmrBackendPageMetadata {
  page: number;
  status?: OmrBackendPageStatus;
  health?: OmrBackendHealth;
  elapsedMs?: number | null;
  musicXmlGenerated?: boolean;
  measureCount?: number | null;
  noteCount?: number | null;
  staffCount?: number | null;
  warnings?: string[];
  stderrSummary?: string | null;
  /** Permit adapter-specific, non-path diagnostic fields without widening the core. */
  [key: string]: unknown;
}

/** Aggregate page counters are useful when detailed page rows are omitted. */
export interface OmrBackendPageSummary {
  attempted: number;
  successful: number;
  failed: number;
  pages?: OmrBackendPageMetadata[];
  [key: string]: unknown;
}

export type OmrBackendPages = OmrBackendPageMetadata[] | OmrBackendPageSummary;

export interface OmrBackendInvocationMetadata {
  command?: string;
  args?: string[];
  executable?: string;
  pinned?: boolean;
  [key: string]: unknown;
}

export type OmrBackendInvocation = string | OmrBackendInvocationMetadata;

export interface OmrBackendModelMetadata {
  id?: string;
  name?: string;
  version?: string;
  sha256?: string;
  weightsHash?: string;
  cache?: string;
  [key: string]: unknown;
}

export type OmrBackendModel = string | OmrBackendModelMetadata;
export type OmrDisagreementKind =
  | "structure"
  | "rhythm"
  | "melody-pitch"
  | "harmony-pitch"
  | "rhythm-pitch"
  | "continuity"
  | "unmatched-measure";

export interface OmrTieInput {
  start?: boolean;
  stop?: boolean;
  continue?: boolean;
}

export interface OmrEventInput {
  /** Beat offset within its measure. */
  onset: number;
  duration: number;
  pitch: number;
  accidental?: string | null;
  tie?: OmrTieInput | "start" | "stop" | "continue" | null;
  staff?: number;
  voice?: string | number;
  role?: OmrRole;
  tuplet?: boolean;
}

export interface OmrVoiceInput {
  id: string | number;
  role?: OmrRole;
  events?: OmrEventInput[];
}

export interface OmrStaffInput {
  number: number;
  role?: OmrRole;
  voices?: OmrVoiceInput[];
  events?: OmrEventInput[];
}

export interface OmrMeasureInput {
  id?: string;
  number?: string | number;
  page?: number;
  system?: number;
  /** Absolute score beat, when the adapter has one. */
  startBeat?: number;
  durationBeats?: number;
  timeSignature?: [number, number] | null;
  keySignature?: number | null;
  implicit?: boolean;
  staves?: OmrStaffInput[];
  voices?: OmrVoiceInput[];
  events?: OmrEventInput[];
  rests?: Array<{ onset: number; duration: number }>;
  tieIn?: boolean;
  tieOut?: boolean;
  tupletCount?: number;
}

export interface OmrPartInput {
  id: string;
  name?: string | null;
  role?: OmrRole;
  staves?: OmrStaffInput[];
  measures: OmrMeasureInput[];
}

export interface OmrScoreInput {
  title?: string;
  tempoBpm?: number;
  timeSignature?: [number, number] | null;
  keySignature?: number | null;
  parts: OmrPartInput[];
  metadata?: unknown;
}

export interface OmrNormalizedEvent {
  id: string;
  partId: string;
  measureId: string;
  measureIndex: number;
  onset: number;
  duration: number;
  pitch: number;
  accidental: string | null;
  tie: { start: boolean; stop: boolean; continue: boolean };
  staff: number | null;
  voice: string | null;
  role: OmrRole | null;
  tuplet: boolean;
}

export interface OmrNormalizedMeasure {
  id: string;
  partId: string;
  partIndex: number;
  index: number;
  number: string;
  page: number | null;
  system: number | null;
  startBeat: number;
  durationBeats: number;
  timeSignature: [number, number] | null;
  keySignature: number | null;
  implicit: boolean;
  staves: number[];
  voices: string[];
  events: OmrNormalizedEvent[];
  rests: Array<{ onset: number; duration: number }>;
  tieIn: boolean;
  tieOut: boolean;
  tupletCount: number;
}

/** Short aliases for adapters that want the plan's Score/Measure/Event names. */
export type OmrScore = NormalizedOmrScore;
export type OmrMeasure = OmrNormalizedMeasure;
export type OmrEvent = OmrNormalizedEvent;

export interface NormalizedOmrScore {
  title: string | null;
  tempoBpm: number | null;
  timeSignature: [number, number] | null;
  keySignature: number | null;
  parts: Array<{ id: string; name: string | null; role: OmrRole | null; measureIds: string[] }>;
  measures: OmrNormalizedMeasure[];
  warnings: string[];
}

export interface OmrBackendRun {
  id: string;
  version: string;
  /** Optional provenance grouping; runs in one group are not independent evidence. */
  independenceGroup?: string;
  /** Optional operational diagnostics; these never alter consensus scoring. */
  health?: OmrBackendHealth;
  pages?: OmrBackendPages | null;
  page?: number | null;
  pageCount?: number | null;
  pagesAttempted?: number | null;
  pagesSuccessful?: number | null;
  pagesFailed?: number | null;
  pageReports?: OmrBackendPageMetadata[] | null;
  invocation?: OmrBackendInvocation | null;
  model?: OmrBackendModel | null;
  score?: OmrScoreInput | null;
  status?: OmrBackendStatus;
  error?: string;
  metadata?: unknown;
}

export interface OmrNativeRun {
  id: string;
  version: string;
  score: OmrScoreInput;
  provenance: {
    sourcePage?: string;
    artifactType: "musicxml" | "mxl" | "midi" | "other";
    versionIdentity?: string;
    accessMethod?: string;
    sha256?: string;
    [key: string]: unknown;
  };
}

export interface OmrBackendAdapterInput {
  imagePaths: string[];
  outputDirectory: string;
}

/** Optional subprocess adapters can implement this without being imported by the app. */
export interface OmrBackend {
  id: string;
  version: string;
  recognize(input: OmrBackendAdapterInput): Promise<OmrBackendRun>;
}

export interface OmrRasterizationConfigInput {
  dpi?: number;
  format?: string;
  renderer?: { id?: string; version?: string };
  crop?: { left: number; top: number; right: number; bottom: number } | null;
  rotation?: number;
  pages?: [number, number] | null;
  /** Accepted by adapters but deliberately omitted from normalized output. */
  outputDirectory?: string;
}

export interface OmrRasterizationConfig {
  dpi: number;
  format: "png";
  renderer: { id: string; version: string };
  crop: { left: number; top: number; right: number; bottom: number } | null;
  rotation: 0 | 90 | 180 | 270;
  pages: [number, number] | null;
}

export interface OmrConsensus {
  structural: number;
  rhythm: number;
  pitch: number;
  overall: number;
}

export interface OmrMeasureAgreement extends OmrConsensus {
  continuity: number;
  roles: Record<OmrRole, OmrRoleAgreement>;
  disagreements: OmrDisagreement[];
}

export interface OmrRoleAgreement {
  score: number | null;
  structural: number | null;
  rhythm: number | null;
  pitch: number | null;
  referenceEvents: number;
  candidateEvents: number;
}

export interface OmrDisagreement {
  kind: OmrDisagreementKind;
  role: OmrRole | null;
  severity: number;
  detail: string;
}

export interface OmrMeasureAlignment {
  referenceIndex: number;
  candidateIndex: number;
  referenceMeasureId: string;
  candidateMeasureId: string;
  confidence: number;
  agreement: OmrMeasureAgreement;
}

export interface OmrScoreAlignment {
  matches: OmrMeasureAlignment[];
  unmatchedReference: number[];
  unmatchedCandidate: number[];
  score: number;
  diagnostics: string[];
}

export interface OmrRoleMeasureState {
  state: OmrTrustState | null;
  confidence: number | null;
}

export interface OmrConsensusMeasure {
  id: string;
  index: number;
  number: string;
  source: string;
  page: number | null;
  system: number | null;
  startBeat: number;
  durationBeats: number;
  state: OmrTrustState;
  confidence: number;
  agreement: OmrMeasureAgreement | null;
  roles: Record<OmrRole, OmrRoleMeasureState>;
  events: OmrNormalizedEvent[];
  reviewReasons: string[];
}

export interface OmrBackendReport {
  id: string;
  version: string;
  independenceGroup: string;
  status: OmrBackendStatus;
  measureCount: number;
  warnings: string[];
  error?: string;
  health?: OmrBackendHealth;
  pages?: OmrBackendPages | null;
  page?: number | null;
  pageCount?: number | null;
  pagesAttempted?: number | null;
  pagesSuccessful?: number | null;
  pagesFailed?: number | null;
  pageReports?: OmrBackendPageMetadata[] | null;
  invocation?: OmrBackendInvocation | null;
  model?: OmrBackendModel | null;
}

export interface OmrCoverage {
  all: number | null;
  melody: number | null;
  harmony: number | null;
  rhythm: number | null;
}

export interface OmrConsensusSummary {
  state: OmrAggregateTrustState;
  totalMeasures: number;
  trustedMeasures: number;
  reviewRequiredMeasures: number;
  failedMeasures: number;
  fallbackWindows: number;
  coverage: OmrCoverage;
}

export interface OmrRoleEligibility {
  eligible: boolean;
  coverage: number | null;
  trustedMeasures: number;
  availableMeasures: number;
}

export interface OmrEligibility {
  melody: OmrRoleEligibility;
  harmony: OmrRoleEligibility;
  rhythm: OmrRoleEligibility;
}

export interface OmrReviewItem {
  measureId: string;
  measureIndex: number;
  number: string;
  priority: number;
  priorityClass: "high" | "medium" | "low";
  reasons: string[];
  roles: OmrRole[];
}

export interface OmrConsensusReport {
  schemaVersion: typeof OMR_CONSENSUS_SCHEMA_VERSION;
  nativePriority: boolean;
  thresholds: {
    consensusTrust: number;
    reviewRequired: number;
    eligibleCoverage: number;
    onsetToleranceBeats: number;
  };
  backends: OmrBackendReport[];
  measures: OmrConsensusMeasure[];
  alignments: Array<{ left: string; right: string; alignment: OmrScoreAlignment }>;
  reviewItems: OmrReviewItem[];
  summary: OmrConsensusSummary;
  eligibility: OmrEligibility;
  native?: { id: string; version: string; provenance: Record<string, unknown>; measureCount: number };
  metadata?: unknown;
}

export interface OmrConsensusOptions {
  onsetToleranceBeats?: number;
  consensusTrust?: number;
  reviewRequired?: number;
  eligibleCoverage?: number;
}

export const DEFAULT_OMR_CONSENSUS_THRESHOLDS = {
  consensusTrust: 0.82,
  reviewRequired: 0.4,
  eligibleCoverage: 0.8,
} as const;

const EPS = 1e-9;
const ROLES: readonly OmrRole[] = ["melody", "harmony", "rhythm"];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveFinite(value: unknown): value is number {
  return finite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumbers(a: number, b: number): number {
  return a - b;
}

function timeSignatureDuration(signature: [number, number] | null | undefined): number {
  if (!signature || !positiveFinite(signature[0]) || !positiveFinite(signature[1])) return 4;
  return (signature[0] * 4) / signature[1];
}

function normalizeTimeSignature(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2 || !positiveFinite(value[0]) || !positiveFinite(value[1])) return null;
  return [value[0], value[1]];
}

function normalizeRole(value: unknown): OmrRole | null {
  return value === "melody" || value === "harmony" || value === "rhythm" ? value : null;
}

function normalizeTie(value: OmrEventInput["tie"]): { start: boolean; stop: boolean; continue: boolean } {
  if (value === "start") return { start: true, stop: false, continue: false };
  if (value === "stop") return { start: false, stop: true, continue: false };
  if (value === "continue") return { start: false, stop: false, continue: true };
  return {
    start: Boolean(value && typeof value === "object" && value.start),
    stop: Boolean(value && typeof value === "object" && value.stop),
    continue: Boolean(value && typeof value === "object" && value.continue),
  };
}

function eventSort(a: OmrNormalizedEvent, b: OmrNormalizedEvent): number {
  return compareNumbers(a.onset, b.onset)
    || compareNumbers(a.pitch, b.pitch)
    || compareNumbers(a.duration, b.duration)
    || compareNumbers(a.staff ?? Number.MAX_SAFE_INTEGER, b.staff ?? Number.MAX_SAFE_INTEGER)
    || stableCompare(a.voice ?? "", b.voice ?? "")
    || stableCompare(a.id, b.id);
}

function eventInputSort(a: OmrEventInput, b: OmrEventInput): number {
  return compareNumbers(a.onset, b.onset)
    || compareNumbers(a.pitch, b.pitch)
    || compareNumbers(a.duration, b.duration)
    || compareNumbers(a.staff ?? Number.MAX_SAFE_INTEGER, b.staff ?? Number.MAX_SAFE_INTEGER)
    || stableCompare(String(a.voice ?? ""), String(b.voice ?? ""));
}

function normalizeVoiceId(value: string | number | undefined): string | null {
  return value === undefined || value === null ? null : String(value);
}

function collectMeasureEvents(
  measure: OmrMeasureInput,
  part: OmrPartInput,
): Array<{ event: OmrEventInput; staff: number | null; voice: string | null; role: OmrRole | null }> {
  const collected: Array<{ event: OmrEventInput; staff: number | null; voice: string | null; role: OmrRole | null }> = [];
  const add = (event: OmrEventInput, staff: number | null, voice: string | null, role: OmrRole | null): void => {
    collected.push({
      event,
      staff: finite(event.staff) && Number.isInteger(event.staff) ? event.staff : staff,
      voice: event.voice === undefined ? voice : normalizeVoiceId(event.voice),
      role: normalizeRole(event.role) ?? normalizeRole(role) ?? normalizeRole(part.role),
    });
  };
  const measureEvents = Array.isArray(measure.events) ? measure.events : [];
  const measureVoices = Array.isArray(measure.voices) ? measure.voices : [];
  const measureStaves = Array.isArray(measure.staves) ? measure.staves : [];
  for (const event of measureEvents) if (event && typeof event === "object") add(event, null, null, null);
  for (const voice of measureVoices) {
    if (!voice || typeof voice !== "object") continue;
    for (const event of (Array.isArray(voice.events) ? voice.events : [])) if (event && typeof event === "object") add(event, null, normalizeVoiceId(voice.id), voice.role ?? null);
  }
  for (const staff of measureStaves) {
    if (!staff || typeof staff !== "object") continue;
    const staffEvents = Array.isArray(staff.events) ? staff.events : [];
    const staffVoices = Array.isArray(staff.voices) ? staff.voices : [];
    for (const event of staffEvents) if (event && typeof event === "object") add(event, staff.number, null, staff.role ?? null);
    for (const voice of staffVoices) {
      if (!voice || typeof voice !== "object") continue;
      for (const event of (Array.isArray(voice.events) ? voice.events : [])) if (event && typeof event === "object") add(event, staff.number, normalizeVoiceId(voice.id), voice.role ?? staff.role ?? null);
    }
  }
  return collected;
}

/** Normalize either engine's adapter output into one stable symbolic shape. */
export function normalizeOmrScore(input: OmrScoreInput): NormalizedOmrScore {
  const warnings: string[] = [];
  const source = input && typeof input === "object" ? input : { parts: [] } as OmrScoreInput;
  const parts = Array.isArray(source.parts)
    ? [...source.parts].sort((left, right) => stableCompare(String(left && typeof left === "object" ? left.id : ""), String(right && typeof right === "object" ? right.id : ""))
      || stableCompare(String(left && typeof left === "object" ? left.name ?? "" : ""), String(right && typeof right === "object" ? right.name ?? "" : "")))
    : [];
  if (!Array.isArray(source.parts)) warnings.push("score has no part array");
  const normalizedParts: NormalizedOmrScore["parts"] = [];
  const measures: OmrNormalizedMeasure[] = [];
  let globalMeasureIndex = 0;
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const partValue = parts[partIndex]!;
    if (!partValue || typeof partValue !== "object" || Array.isArray(partValue)) {
      warnings.push(`dropped invalid part at index ${partIndex}`);
      continue;
    }
    const part = partValue as OmrPartInput;
    const partId = String(part.id);
    const partMeasures = Array.isArray(part.measures) ? part.measures : [];
    if (!Array.isArray(part.measures)) warnings.push(`part ${partId} has no measure array`);
    let cursor = 0;
    const measureIds: string[] = [];
    for (let localIndex = 0; localIndex < partMeasures.length; localIndex += 1) {
      const measureValue = partMeasures[localIndex]!;
      if (!measureValue || typeof measureValue !== "object" || Array.isArray(measureValue)) {
        warnings.push(`dropped invalid measure in ${partId}`);
        continue;
      }
      const measureInput = measureValue as OmrMeasureInput;
      const timeSignature = normalizeTimeSignature(measureInput.timeSignature) ?? normalizeTimeSignature(source.timeSignature);
      const durationBeats = positiveFinite(measureInput.durationBeats) ? measureInput.durationBeats : timeSignatureDuration(timeSignature);
      const startBeat = finite(measureInput.startBeat) && measureInput.startBeat >= 0 ? measureInput.startBeat : cursor;
      const sourceId = measureInput.id === undefined ? String(measureInput.number ?? localIndex + 1) : String(measureInput.id);
      const id = `${partId}:${sourceId}`;
      const events: OmrNormalizedEvent[] = [];
      const eventInputs = collectMeasureEvents(measureInput, part).sort((a, b) => eventInputSort(a.event, b.event));
      for (let eventIndex = 0; eventIndex < eventInputs.length; eventIndex += 1) {
        const entry = eventInputs[eventIndex]!;
        const event = entry.event;
        if (!finite(event.onset) || event.onset < 0 || !positiveFinite(event.duration) || !finite(event.pitch)
          || !Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127) {
          warnings.push(`dropped invalid event in ${id}`);
          continue;
        }
        events.push({
          id: `${id}:e${eventIndex}`,
          partId,
          measureId: id,
          measureIndex: globalMeasureIndex,
          onset: rounded(event.onset),
          duration: rounded(event.duration),
          pitch: event.pitch,
          accidental: typeof event.accidental === "string" ? event.accidental : null,
          tie: normalizeTie(event.tie),
          staff: entry.staff,
          voice: entry.voice,
          role: entry.role,
          tuplet: Boolean(event.tuplet),
        });
      }
      events.sort(eventSort);
      const staffNumbers = new Set<number>();
      const voiceIds = new Set<string>();
      for (const event of events) {
        if (event.staff !== null) staffNumbers.add(event.staff);
        if (event.voice !== null) voiceIds.add(event.voice);
      }
      const sourceStaves = Array.isArray(measureInput.staves) ? measureInput.staves : [];
      const sourceVoices = Array.isArray(measureInput.voices) ? measureInput.voices : [];
      for (const staff of sourceStaves) if (staff && Number.isInteger(staff.number) && staff.number > 0) staffNumbers.add(staff.number);
      for (const voice of sourceVoices) if (voice && typeof voice === "object") voiceIds.add(String(voice.id));
      for (const staff of sourceStaves) if (staff && typeof staff === "object") for (const voice of (Array.isArray(staff.voices) ? staff.voices : [])) if (voice && typeof voice === "object") voiceIds.add(String(voice.id));
      const rests = (Array.isArray(measureInput.rests) ? measureInput.rests : [])
        .filter((rest) => Boolean(rest && typeof rest === "object") && finite((rest as { onset?: unknown }).onset) && (rest as { onset: number }).onset >= 0 && positiveFinite((rest as { duration?: unknown }).duration))
        .map((rest) => ({ onset: rounded(rest.onset), duration: rounded(rest.duration) }))
        .sort((a, b) => a.onset - b.onset || a.duration - b.duration);
      const measure: OmrNormalizedMeasure = {
        id,
        partId,
        partIndex,
        index: globalMeasureIndex,
        number: String(measureInput.number ?? localIndex + 1),
        page: finite(measureInput.page) && measureInput.page >= 0 ? measureInput.page : null,
        system: finite(measureInput.system) && measureInput.system >= 0 ? measureInput.system : null,
        startBeat: rounded(startBeat),
        durationBeats: rounded(durationBeats),
        timeSignature,
        keySignature: finite(measureInput.keySignature) ? measureInput.keySignature : (finite(source.keySignature) ? source.keySignature! : null),
        implicit: Boolean(measureInput.implicit),
        staves: [...staffNumbers].sort(compareNumbers),
        voices: [...voiceIds].sort(stableCompare),
        events,
        rests,
        tieIn: Boolean(measureInput.tieIn) || events.some((event) => event.tie.stop || event.tie.continue),
        tieOut: Boolean(measureInput.tieOut) || events.some((event) => event.tie.start || event.tie.continue),
        tupletCount: finite(measureInput.tupletCount) && measureInput.tupletCount >= 0 ? Math.floor(measureInput.tupletCount) : events.filter((event) => event.tuplet).length,
      };
      measures.push(measure);
      measureIds.push(id);
      globalMeasureIndex += 1;
      cursor = startBeat + durationBeats;
    }
    normalizedParts.push({ id: partId, name: typeof part.name === "string" ? part.name : null, role: normalizeRole(part.role), measureIds });
  }
  const timeSignature = normalizeTimeSignature(source.timeSignature);
  return {
    title: typeof source.title === "string" ? source.title : null,
    tempoBpm: positiveFinite(source.tempoBpm) ? source.tempoBpm! : null,
    timeSignature,
    keySignature: finite(source.keySignature) ? source.keySignature! : null,
    parts: normalizedParts,
    measures,
    warnings,
  };
}

function eventOnsetGroups(events: readonly OmrNormalizedEvent[], tolerance: number): OmrNormalizedEvent[][] {
  const groups: OmrNormalizedEvent[][] = [];
  for (const event of [...events].sort(eventSort)) {
    const last = groups.at(-1);
    if (last && event.onset - last[0]!.onset <= tolerance + EPS) last.push(event);
    else groups.push([event]);
  }
  return groups;
}

function eventCountByRole(measure: OmrNormalizedMeasure, role: OmrRole): OmrNormalizedEvent[] {
  return measure.events.filter((event) => event.role === role);
}

function pitchRange(measure: OmrNormalizedMeasure): [number, number] | null {
  if (!measure.events.length) return null;
  return [Math.min(...measure.events.map((event) => event.pitch)), Math.max(...measure.events.map((event) => event.pitch))];
}

function pitchClassHistogram(events: readonly OmrNormalizedEvent[]): number[] {
  const result = Array.from({ length: 12 }, () => 0);
  for (const event of events) result[event.pitch % 12] = (result[event.pitch % 12] ?? 0) + 1;
  return result;
}

function ratioSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  if (a === 0 || b === 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function arraySimilarity(a: readonly number[], b: readonly number[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const count = Math.min(a.length, b.length);
  let distance = 0;
  for (let index = 0; index < count; index += 1) distance += Math.abs(a[index]! - b[index]!);
  const maxDistance = count * Math.max(1, ...a, ...b);
  return clamp(1 - distance / maxDistance, 0, 1) * ratioSimilarity(a.length, b.length);
}

function measureSimilarity(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure): number {
  const refRange = pitchRange(reference);
  const candRange = pitchRange(candidate);
  const refGroups = eventOnsetGroups(reference.events, OMR_ONSET_TOLERANCE_BEATS);
  const candGroups = eventOnsetGroups(candidate.events, OMR_ONSET_TOLERANCE_BEATS);
  const refHist = pitchClassHistogram(reference.events);
  const candHist = pitchClassHistogram(candidate.events);
  const histTotal = Math.max(1, reference.events.length + candidate.events.length);
  const histDistance = refHist.reduce((sum, value, index) => sum + Math.abs(value - candHist[index]!), 0);
  const rangeScore = refRange && candRange
    ? 1 - clamp((Math.abs(refRange[0] - candRange[0]) + Math.abs(refRange[1] - candRange[1])) / 48, 0, 1)
    : refRange === candRange ? 1 : 0;
  const signatureScore = reference.timeSignature === null && candidate.timeSignature === null
    ? 1
    : reference.timeSignature && candidate.timeSignature && reference.timeSignature[0] === candidate.timeSignature[0] && reference.timeSignature[1] === candidate.timeSignature[1] ? 1 : 0;
  const durationScore = ratioSimilarity(reference.durationBeats, candidate.durationBeats);
  const countScore = ratioSimilarity(reference.events.length, candidate.events.length);
  const onsetScore = ratioSimilarity(refGroups.length, candGroups.length);
  const histScore = 1 - clamp(histDistance / histTotal, 0, 1);
  const staffScore = ratioSimilarity(reference.staves.length, candidate.staves.length);
  const voiceScore = ratioSimilarity(reference.voices.length, candidate.voices.length);
  return rounded(
    signatureScore * 0.16
      + durationScore * 0.14
      + countScore * 0.18
      + onsetScore * 0.14
      + histScore * 0.14
      + rangeScore * 0.1
      + staffScore * 0.07
      + voiceScore * 0.07,
  );
}

function eventMatchPairs(
  reference: readonly OmrNormalizedEvent[],
  candidate: readonly OmrNormalizedEvent[],
  tolerance: number,
  pitchAware: boolean,
): Array<{ reference: OmrNormalizedEvent; candidate: OmrNormalizedEvent; onsetError: number }> {
  const pairs: Array<{ reference: OmrNormalizedEvent; candidate: OmrNormalizedEvent; onsetError: number; pitchDistance: number }> = [];
  for (const ref of reference) {
    for (const cand of candidate) {
      const onsetError = Math.abs(ref.onset - cand.onset);
      if (onsetError > tolerance + EPS) continue;
      pairs.push({ reference: ref, candidate: cand, onsetError, pitchDistance: Math.abs(ref.pitch - cand.pitch) });
    }
  }
  pairs.sort((a, b) => (pitchAware ? a.pitchDistance - b.pitchDistance : 0)
    || a.onsetError - b.onsetError
    || a.reference.onset - b.reference.onset
    || a.reference.pitch - b.reference.pitch
    || a.candidate.pitch - b.candidate.pitch
    || stableCompare(a.reference.id, b.reference.id)
    || stableCompare(a.candidate.id, b.candidate.id));
  const usedReference = new Set<string>();
  const usedCandidate = new Set<string>();
  const result: Array<{ reference: OmrNormalizedEvent; candidate: OmrNormalizedEvent; onsetError: number }> = [];
  for (const pair of pairs) {
    if (usedReference.has(pair.reference.id) || usedCandidate.has(pair.candidate.id)) continue;
    usedReference.add(pair.reference.id);
    usedCandidate.add(pair.candidate.id);
    result.push({ reference: pair.reference, candidate: pair.candidate, onsetError: pair.onsetError });
  }
  return result.sort((a, b) => a.reference.onset - b.reference.onset || a.reference.pitch - b.reference.pitch || stableCompare(a.reference.id, b.reference.id));
}

function f1(matched: number, referenceCount: number, candidateCount: number): number {
  if (!referenceCount && !candidateCount) return 1;
  if (!referenceCount || !candidateCount || !matched) return 0;
  const precision = matched / candidateCount;
  const recall = matched / referenceCount;
  return (2 * precision * recall) / (precision + recall);
}

function roleAgreement(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure, role: OmrRole, tolerance: number): OmrRoleAgreement {
  const refEvents = eventCountByRole(reference, role);
  const candEvents = eventCountByRole(candidate, role);
  if (!refEvents.length && !candEvents.length) return { score: null, structural: null, rhythm: null, pitch: null, referenceEvents: 0, candidateEvents: 0 };
  if (!refEvents.length || !candEvents.length) return { score: 0, structural: 0, rhythm: 0, pitch: 0, referenceEvents: refEvents.length, candidateEvents: candEvents.length };
  const rhythmPairs = eventMatchPairs(refEvents, candEvents, tolerance, false);
  const pitchPairs = eventMatchPairs(refEvents, candEvents, tolerance, true);
  const pitchMatches = pitchPairs.filter((pair) => pair.reference.pitch === pair.candidate.pitch).length;
  const rhythm = f1(rhythmPairs.length, refEvents.length, candEvents.length);
  const pitch = f1(pitchMatches, refEvents.length, candEvents.length);
  const structural = ratioSimilarity(eventOnsetGroups(refEvents, tolerance).length, eventOnsetGroups(candEvents, tolerance).length);
  const score = rounded(structural * 0.2 + rhythm * 0.35 + pitch * 0.45);
  return { score, structural: rounded(structural), rhythm: rounded(rhythm), pitch: rounded(pitch), referenceEvents: refEvents.length, candidateEvents: candEvents.length };
}

function measureStructuralAgreement(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure): number {
  const signature = reference.timeSignature === null && candidate.timeSignature === null
    ? 1
    : reference.timeSignature && candidate.timeSignature && reference.timeSignature[0] === candidate.timeSignature[0] && reference.timeSignature[1] === candidate.timeSignature[1] ? 1 : 0;
  const key = reference.keySignature === null && candidate.keySignature === null ? 1 : reference.keySignature === candidate.keySignature ? 1 : 0;
  const duration = ratioSimilarity(reference.durationBeats, candidate.durationBeats);
  const staves = ratioSimilarity(reference.staves.length, candidate.staves.length);
  const voices = ratioSimilarity(reference.voices.length, candidate.voices.length);
  const tuplets = ratioSimilarity(reference.tupletCount, candidate.tupletCount);
  return rounded(signature * 0.2 + key * 0.1 + duration * 0.2 + staves * 0.2 + voices * 0.2 + tuplets * 0.1);
}

function measureRhythmAgreement(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure, tolerance: number): number {
  const refGroups = eventOnsetGroups(reference.events, tolerance);
  const candGroups = eventOnsetGroups(candidate.events, tolerance);
  const refOnsets = refGroups.map((group) => group[0]!.onset);
  const candOnsets = candGroups.map((group) => group[0]!.onset);
  const onsetPairs = eventMatchPairs(
    refOnsets.map((onset, index) => ({ id: `r${index}`, onset, duration: 0, pitch: 0 } as OmrNormalizedEvent)),
    candOnsets.map((onset, index) => ({ id: `c${index}`, onset, duration: 0, pitch: 0 } as OmrNormalizedEvent)),
    tolerance,
    false,
  );
  const onsetScore = f1(onsetPairs.length, refGroups.length, candGroups.length);
  const refDurations = reference.events.map((event) => event.duration).sort(compareNumbers);
  const candDurations = candidate.events.map((event) => event.duration).sort(compareNumbers);
  const durationScore = arraySimilarity(refDurations, candDurations);
  return rounded(onsetScore * 0.72 + durationScore * 0.28);
}

function measurePitchAgreement(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure, tolerance: number): number {
  const pairs = eventMatchPairs(reference.events, candidate.events, tolerance, true);
  return rounded(f1(pairs.filter((pair) => pair.reference.pitch === pair.candidate.pitch).length, reference.events.length, candidate.events.length));
}

function measureContinuityAgreement(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure): number {
  const referenceSignature = [reference.tieIn, reference.tieOut, ...reference.events.filter((event) => event.tie.start || event.tie.stop || event.tie.continue).map((event) => `${event.onset}:${event.pitch}:${event.tie.start ? "s" : ""}${event.tie.stop ? "e" : ""}${event.tie.continue ? "c" : ""}`)];
  const candidateSignature = [candidate.tieIn, candidate.tieOut, ...candidate.events.filter((event) => event.tie.start || event.tie.stop || event.tie.continue).map((event) => `${event.onset}:${event.pitch}:${event.tie.start ? "s" : ""}${event.tie.stop ? "e" : ""}${event.tie.continue ? "c" : ""}`)];
  if (referenceSignature.length === candidateSignature.length && referenceSignature.every((value, index) => value === candidateSignature[index])) return 1;
  return reference.tieIn === candidate.tieIn && reference.tieOut === candidate.tieOut ? 0.6 : 0;
}

/** Compare one aligned measure, keeping melody/harmony/rhythm confidence separate. */
export function compareOmrMeasures(
  reference: OmrNormalizedMeasure,
  candidate: OmrNormalizedMeasure,
  options: { onsetToleranceBeats?: number } = {},
): OmrMeasureAgreement {
  const tolerance = clamp(options.onsetToleranceBeats ?? OMR_ONSET_TOLERANCE_BEATS, 0.001, 1);
  const structural = measureStructuralAgreement(reference, candidate);
  const rhythm = measureRhythmAgreement(reference, candidate, tolerance);
  const pitch = measurePitchAgreement(reference, candidate, tolerance);
  const continuity = measureContinuityAgreement(reference, candidate);
  const roles = {
    melody: roleAgreement(reference, candidate, "melody", tolerance),
    harmony: roleAgreement(reference, candidate, "harmony", tolerance),
    rhythm: roleAgreement(reference, candidate, "rhythm", tolerance),
  } satisfies Record<OmrRole, OmrRoleAgreement>;
  const disagreements: OmrDisagreement[] = [];
  if (structural < 0.8) disagreements.push({ kind: "structure", role: null, severity: rounded(1 - structural), detail: "measure structure differs" });
  if (rhythm < 0.8) disagreements.push({ kind: "rhythm", role: "rhythm", severity: rounded(1 - rhythm), detail: "attack positions or durations differ" });
  for (const role of ROLES) {
    const agreement = roles[role];
    if (agreement.pitch !== null && agreement.pitch < 0.8) {
      disagreements.push({
        kind: role === "melody" ? "melody-pitch" : role === "harmony" ? "harmony-pitch" : "rhythm-pitch",
        role,
        severity: rounded(1 - agreement.pitch),
        detail: `${role} pitch differs`,
      });
    }
    if (agreement.rhythm !== null && agreement.rhythm < 0.8 && role !== "rhythm") disagreements.push({ kind: "rhythm", role, severity: rounded(1 - agreement.rhythm), detail: `${role} rhythm differs` });
  }
  if (continuity < 0.8) disagreements.push({ kind: "continuity", role: null, severity: rounded(1 - continuity), detail: "tie or phrase continuity differs" });
  const overall = rounded(structural * 0.3 + rhythm * 0.3 + pitch * 0.3 + continuity * 0.1);
  return { structural, rhythm, pitch, continuity, overall, roles, disagreements };
}

function alignmentMatchScore(reference: OmrNormalizedMeasure, candidate: OmrNormalizedMeasure): number {
  return measureSimilarity(reference, candidate);
}

/** Deterministically align measure sequences with a bounded Needleman-Wunsch pass. */
export function alignOmrScores(
  reference: NormalizedOmrScore,
  candidate: NormalizedOmrScore,
  options: { onsetToleranceBeats?: number } = {},
): OmrScoreAlignment {
  const refs = reference.measures;
  const cands = candidate.measures;
  const rows = refs.length + 1;
  const cols = cands.length + 1;
  const scores = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Number.NEGATIVE_INFINITY));
  const choices = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
  scores[0]![0] = 0;
  for (let row = 1; row < rows; row += 1) {
    scores[row]![0] = scores[row - 1]![0]! - 0.62;
    choices[row]![0] = "up";
  }
  for (let col = 1; col < cols; col += 1) {
    scores[0]![col] = scores[0]![col - 1]! - 0.62;
    choices[0]![col] = "left";
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const similarity = alignmentMatchScore(refs[row - 1]!, cands[col - 1]!);
      const diagonal = scores[row - 1]![col - 1]! + similarity * 2 - 0.35;
      const up = scores[row - 1]![col]! - 0.62;
      const left = scores[row]![col - 1]! - 0.62;
      if (diagonal >= up - EPS && diagonal >= left - EPS) {
        scores[row]![col] = diagonal;
        choices[row]![col] = "diag";
      } else if (up >= left - EPS) {
        scores[row]![col] = up;
        choices[row]![col] = "up";
      } else {
        scores[row]![col] = left;
        choices[row]![col] = "left";
      }
    }
  }
  const matches: OmrMeasureAlignment[] = [];
  const unmatchedReference: number[] = [];
  const unmatchedCandidate: number[] = [];
  let row = refs.length;
  let col = cands.length;
  while (row > 0 || col > 0) {
    const choice = row > 0 && col > 0 ? choices[row]![col] : row > 0 ? "up" : "left";
    if (choice === "diag") {
      const referenceMeasure = refs[row - 1]!;
      const candidateMeasure = cands[col - 1]!;
      const confidence = alignmentMatchScore(referenceMeasure, candidateMeasure);
      matches.push({
        referenceIndex: row - 1,
        candidateIndex: col - 1,
        referenceMeasureId: referenceMeasure.id,
        candidateMeasureId: candidateMeasure.id,
        confidence,
        agreement: compareOmrMeasures(referenceMeasure, candidateMeasure, options),
      });
      row -= 1;
      col -= 1;
    } else if (choice === "up") {
      unmatchedReference.push(row - 1);
      row -= 1;
    } else {
      unmatchedCandidate.push(col - 1);
      col -= 1;
    }
  }
  matches.reverse();
  unmatchedReference.sort(compareNumbers);
  unmatchedCandidate.sort(compareNumbers);
  return {
    matches,
    unmatchedReference,
    unmatchedCandidate,
    score: rounded(scores[refs.length]![cands.length]!),
    diagnostics: [
      ...(unmatchedReference.length ? [`${unmatchedReference.length} unmatched reference measure${unmatchedReference.length === 1 ? "" : "s"}`] : []),
      ...(unmatchedCandidate.length ? [`${unmatchedCandidate.length} unmatched candidate measure${unmatchedCandidate.length === 1 ? "" : "s"}`] : []),
    ],
  };
}

function backendStatus(run: OmrBackendRun): OmrBackendStatus {
  if (run.status === "unavailable" || run.status === "failed") return run.status;
  return run.score ? "available" : "failed";
}

const BACKEND_HEALTH_VALUES = new Set<OmrBackendHealth>([
  "available",
  "partially-available",
  "unavailable",
  "broken-output",
]);

function normalizeBackendHealth(value: unknown): OmrBackendHealth | undefined {
  return typeof value === "string" && BACKEND_HEALTH_VALUES.has(value as OmrBackendHealth)
    ? value as OmrBackendHealth
    : undefined;
}

function pageSortNumber(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Number.MAX_SAFE_INTEGER;
  const page = (value as { page?: unknown }).page;
  return finite(page) && Number.isInteger(page) && page > 0 ? page : Number.MAX_SAFE_INTEGER;
}

function pageSortTieBreak(value: unknown): string {
  // stableValue is intentionally used only as a deterministic tie-breaker;
  // page arrays retain their semantic order when page numbers differ.
  return JSON.stringify(stableValue(value));
}

function sortBackendPageRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeOmrMetadata(entry))
    .sort((left, right) => pageSortNumber(left) - pageSortNumber(right) || stableCompare(pageSortTieBreak(left), pageSortTieBreak(right)));
}

function normalizeBackendPages(value: unknown): OmrBackendPages | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return sortBackendPageRows(value) as OmrBackendPageMetadata[];
  if (!value || typeof value !== "object") return undefined;
  const sanitized = sanitizeOmrMetadata(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return undefined;
  const output = { ...(sanitized as Record<string, unknown>) };
  // Accept common aggregate shapes while keeping unknown adapter fields. Any
  // nested page rows are sorted by page so report serialization is stable.
  for (const key of ["pages", "pageReports", "results", "details"] as const) {
    if (Array.isArray(output[key])) output[key] = sortBackendPageRows(output[key]);
  }
  return output as OmrBackendPageSummary;
}

function normalizeBackendPageReports(value: unknown): OmrBackendPageMetadata[] | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return Array.isArray(value) ? sortBackendPageRows(value) as OmrBackendPageMetadata[] : undefined;
}

function optionalDiagnosticCount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return finite(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

function safeBackendRun(value: unknown, index: number): OmrBackendRun {
  if (!value || typeof value !== "object") {
    return { id: `invalid-${index}`, version: "unknown", status: "failed", error: "invalid backend run" };
  }
  const run = value as Partial<OmrBackendRun>;
  const pages = normalizeBackendPages(run.pages);
  const pageReports = normalizeBackendPageReports(run.pageReports);
  const health = normalizeBackendHealth(run.health);
  return {
    id: typeof run.id === "string" && run.id.trim() ? run.id : `backend-${index}`,
    version: typeof run.version === "string" && run.version.trim() ? run.version : "unknown",
    ...(typeof run.independenceGroup === "string" && run.independenceGroup.trim() ? { independenceGroup: run.independenceGroup } : {}),
    ...(health ? { health } : {}),
    ...(run.pages !== undefined && pages !== undefined ? { pages } : {}),
    ...(run.page !== undefined ? { page: optionalDiagnosticCount(run.page) } : {}),
    ...(run.pageCount !== undefined ? { pageCount: optionalDiagnosticCount(run.pageCount) } : {}),
    ...(run.pagesAttempted !== undefined ? { pagesAttempted: optionalDiagnosticCount(run.pagesAttempted) } : {}),
    ...(run.pagesSuccessful !== undefined ? { pagesSuccessful: optionalDiagnosticCount(run.pagesSuccessful) } : {}),
    ...(run.pagesFailed !== undefined ? { pagesFailed: optionalDiagnosticCount(run.pagesFailed) } : {}),
    ...(run.pageReports !== undefined && pageReports !== undefined ? { pageReports } : {}),
    ...(run.invocation !== undefined ? { invocation: sanitizeOmrMetadata(run.invocation) as OmrBackendInvocation | null } : {}),
    ...(run.model !== undefined ? { model: sanitizeOmrMetadata(run.model) as OmrBackendModel | null } : {}),
    ...(run.score && typeof run.score === "object" ? { score: run.score as OmrScoreInput } : {}),
    ...(run.status === "available" || run.status === "unavailable" || run.status === "failed" ? { status: run.status } : {}),
    ...(typeof run.error === "string" ? { error: run.error } : {}),
    ...(run.metadata === undefined ? {} : { metadata: sanitizeOmrMetadata(run.metadata) }),
  };
}

function safeNativeRun(value: unknown): OmrNativeRun | null {
  if (!value || typeof value !== "object") return null;
  const native = value as Partial<OmrNativeRun>;
  if (!native.score || typeof native.score !== "object") return null;
  if (!native.provenance || typeof native.provenance !== "object" || Array.isArray(native.provenance)) return null;
  const artifactType = (native.provenance as { artifactType?: unknown }).artifactType;
  if (artifactType !== "musicxml" && artifactType !== "mxl" && artifactType !== "midi" && artifactType !== "other") return null;
  const version = typeof native.version === "string" && native.version.trim() ? native.version.trim() : null;
  if (!version || version.toLowerCase() === "unknown") return null;
  return {
    id: typeof native.id === "string" && native.id.trim() ? native.id : "native",
    version,
    score: native.score as OmrScoreInput,
    provenance: native.provenance as OmrNativeRun["provenance"],
  };
}

function independenceKey(run: OmrBackendRun): string {
  return typeof run.independenceGroup === "string" && run.independenceGroup.trim()
    ? `group:${run.independenceGroup.trim()}`
    : `backend:${run.id}`;
}

function validConsensusThreshold(value: unknown, fallback: number): number {
  return finite(value) ? clamp(value, 0, 1) : fallback;
}

function stateForAgreement(agreement: OmrMeasureAgreement, thresholds: { consensusTrust: number; reviewRequired: number }): OmrTrustState {
  if (agreement.overall >= thresholds.consensusTrust) return "TRUSTED_CONSENSUS";
  if (agreement.overall >= thresholds.reviewRequired) return "REVIEW_REQUIRED";
  return "FAILED";
}

function roleStateForAgreement(agreement: OmrRoleAgreement, thresholds: { consensusTrust: number; reviewRequired: number }): OmrRoleMeasureState {
  if (agreement.score === null) return { state: null, confidence: null };
  if (agreement.score >= thresholds.consensusTrust) return { state: "TRUSTED_CONSENSUS", confidence: agreement.score };
  if (agreement.score >= thresholds.reviewRequired) return { state: "REVIEW_REQUIRED", confidence: agreement.score };
  return { state: "FAILED", confidence: agreement.score };
}

function aggregateState(measures: readonly OmrConsensusMeasure[], native: boolean, availableEngines: number): OmrAggregateTrustState {
  if (native && measures.length && measures.every((measure) => measure.state === "TRUSTED_NATIVE")) return "TRUSTED_NATIVE";
  if (!measures.length) return "FAILED";
  const trusted = measures.filter((measure) => measure.state === "TRUSTED_CONSENSUS" || measure.state === "TRUSTED_SINGLE_ENGINE").length;
  const review = measures.filter((measure) => measure.state === "REVIEW_REQUIRED").length;
  const failed = measures.filter((measure) => measure.state === "FAILED").length;
  if (trusted === measures.length) return availableEngines > 1 ? "TRUSTED_CONSENSUS" : "TRUSTED_SINGLE_ENGINE";
  if (trusted > 0) return "PARTIALLY_TRUSTED";
  if (review > 0) return "REVIEW_REQUIRED";
  return failed ? "FAILED" : "REVIEW_REQUIRED";
}

function roleCoverage(measures: readonly OmrConsensusMeasure[], role: OmrRole): OmrRoleEligibility {
  const withRole = measures.filter((measure) => measure.events.some((event) => event.role === role));
  if (!withRole.length) return { eligible: false, coverage: null, trustedMeasures: 0, availableMeasures: 0 };
  const trusted = withRole.filter((measure) => {
    const state = measure.roles[role].state;
    return state === "TRUSTED_NATIVE" || state === "TRUSTED_CONSENSUS" || state === "TRUSTED_SINGLE_ENGINE";
  });
  const coverage = rounded(trusted.length / withRole.length);
  return { eligible: coverage >= DEFAULT_OMR_CONSENSUS_THRESHOLDS.eligibleCoverage, coverage, trustedMeasures: trusted.length, availableMeasures: withRole.length };
}

function reviewPriority(measure: OmrConsensusMeasure): OmrReviewItem {
  const reasons = [...measure.reviewReasons];
  const roles = ROLES.filter((role) => measure.roles[role].state === "REVIEW_REQUIRED" || measure.roles[role].state === "FAILED");
  let priority = 1;
  if (reasons.some((reason) => reason.includes("melody pitch"))) priority += 5;
  if (reasons.some((reason) => reason.includes("structure"))) priority += 3;
  if (reasons.some((reason) => reason.includes("rhythm"))) priority += 2;
  if (roles.includes("melody")) priority += 2;
  const priorityClass: OmrReviewItem["priorityClass"] = priority >= 6 ? "high" : priority >= 3 ? "medium" : "low";
  return { measureId: measure.id, measureIndex: measure.index, number: measure.number, priority, priorityClass, reasons, roles };
}

/**
 * Combine optional OMR runs and a permitted native score into regional trust
 * states. Native evidence is always selected first; OMR is never allowed to
 * overrule it. For dual OMR, the first deterministic engine supplies the
 * event payload for trusted regions while the second engine supplies
 * agreement evidence. Uncertain regions deliberately contribute no events to
 * selectOmrConsensusEvents().
 */
export function buildOmrConsensus(input: {
  engines: OmrBackendRun[];
  native?: OmrNativeRun;
  metadata?: unknown;
  options?: OmrConsensusOptions;
}): OmrConsensusReport {
  const sourceInput = input && typeof input === "object" ? input : { engines: [] as OmrBackendRun[] };
  const options = sourceInput.options && typeof sourceInput.options === "object" ? sourceInput.options : {};
  const thresholds = {
    consensusTrust: validConsensusThreshold(options.consensusTrust, DEFAULT_OMR_CONSENSUS_THRESHOLDS.consensusTrust),
    reviewRequired: validConsensusThreshold(options.reviewRequired, DEFAULT_OMR_CONSENSUS_THRESHOLDS.reviewRequired),
  };
  if (thresholds.reviewRequired > thresholds.consensusTrust) thresholds.reviewRequired = thresholds.consensusTrust;
  const onsetToleranceBeats = finite(options.onsetToleranceBeats)
    ? clamp(options.onsetToleranceBeats, 0.001, 1)
    : OMR_ONSET_TOLERANCE_BEATS;
  const eligibleCoverage = validConsensusThreshold(options.eligibleCoverage, DEFAULT_OMR_CONSENSUS_THRESHOLDS.eligibleCoverage);
  const runs = (Array.isArray(sourceInput.engines) ? sourceInput.engines : []).map(safeBackendRun).sort((a, b) => stableCompare(a.id, b.id) || stableCompare(a.version, b.version));
  const normalizedRuns = runs.map((run) => ({ run, status: backendStatus(run), score: run.score && backendStatus(run) === "available" ? normalizeOmrScore(run.score) : null }));
  // An empty normalized score is not usable evidence. Keep it in the backend
  // diagnostics, but never let it become the primary lane or manufacture an
  // apparent dual-engine alignment with a later usable run.
  const available = normalizedRuns.filter((entry) => entry.score !== null && entry.score.measures.length > 0);
  // A backend can return a syntactically valid but empty score. Keep that
  // backend row for diagnostics, but never let it become the primary lane or
  // consume one of the independent evidence slots.
  const usableAvailable = available.filter((entry) => entry.score!.measures.length > 0);
  const independentAvailable = [...new Map(usableAvailable.map((entry) => [independenceKey(entry.run), entry])).values()];
  const backends: OmrBackendReport[] = normalizedRuns.map(({ run, status, score }) => ({
    id: run.id,
    version: run.version,
    independenceGroup: run.independenceGroup?.trim() || run.id,
    status,
    measureCount: score?.measures.length ?? 0,
    warnings: score?.warnings ?? [],
    ...(run.error ? { error: sanitizeError(run.error) } : {}),
    ...(run.health ? { health: run.health } : {}),
    ...(run.pages !== undefined ? { pages: run.pages } : {}),
    ...(run.page !== undefined ? { page: run.page } : {}),
    ...(run.pageCount !== undefined ? { pageCount: run.pageCount } : {}),
    ...(run.pagesAttempted !== undefined ? { pagesAttempted: run.pagesAttempted } : {}),
    ...(run.pagesSuccessful !== undefined ? { pagesSuccessful: run.pagesSuccessful } : {}),
    ...(run.pagesFailed !== undefined ? { pagesFailed: run.pagesFailed } : {}),
    ...(run.pageReports !== undefined ? { pageReports: run.pageReports } : {}),
    ...(run.invocation !== undefined ? { invocation: run.invocation } : {}),
    ...(run.model !== undefined ? { model: run.model } : {}),
  }));
  const nativeInput = safeNativeRun(sourceInput.native);
  const normalizedNative = nativeInput ? normalizeOmrScore(nativeInput.score) : null;
  // A native artifact is preferred only after its own normalized structure is
  // usable. Malformed native input must not suppress a clean OMR fallback.
  const nativeScore = normalizedNative && normalizedNative.measures.length > 0 && normalizedNative.warnings.length === 0 ? normalizedNative : null;
  const alignments: OmrConsensusReport["alignments"] = [];
  if (nativeScore) {
    for (const entry of usableAvailable) alignments.push({ left: nativeInput!.id, right: entry.run.id, alignment: alignOmrScores(nativeScore, entry.score!, { onsetToleranceBeats }) });
  } else if (independentAvailable.length >= 2) {
    for (let index = 1; index < independentAvailable.length; index += 1) {
      const left = independentAvailable[0]!;
      const right = independentAvailable[index]!;
      alignments.push({ left: left.run.id, right: right.run.id, alignment: alignOmrScores(left.score!, right.score!, { onsetToleranceBeats }) });
    }
  }
  const primary = nativeScore ?? independentAvailable[0]?.score ?? null;
  const primarySource = nativeScore ? nativeInput!.id : independentAvailable[0]?.run.id ?? "none";
  const measures: OmrConsensusMeasure[] = [];
  const primaryToSecondary = new Map<number, { agreement: OmrMeasureAgreement; candidate: OmrNormalizedMeasure }>();
  if (!nativeScore && independentAvailable.length >= 2) {
    const firstAlignment = alignments[0]?.alignment;
    if (firstAlignment) for (const match of firstAlignment.matches) primaryToSecondary.set(match.referenceIndex, { agreement: match.agreement, candidate: independentAvailable[1]!.score!.measures[match.candidateIndex]! });
  }
  if (primary) {
    for (const measure of primary.measures) {
      const pairing = primaryToSecondary.get(measure.index);
      let state: OmrTrustState;
      let agreement: OmrMeasureAgreement | null = null;
      let confidence = 1;
      let events: OmrNormalizedEvent[] = measure.events;
      let reviewReasons: string[] = [];
      if (nativeScore) {
        state = "TRUSTED_NATIVE";
        confidence = 1;
      } else if (pairing) {
        agreement = pairing.agreement;
        state = stateForAgreement(agreement, thresholds);
        confidence = agreement.overall;
        reviewReasons = agreement.disagreements.map((disagreement) => disagreement.detail);
      } else if (independentAvailable.length === 1) {
        const internallyValidated = measure.events.length > 0 && primary.warnings.length === 0;
        state = internallyValidated ? "TRUSTED_SINGLE_ENGINE" : "REVIEW_REQUIRED";
        confidence = internallyValidated ? 1 : 0;
        reviewReasons = internallyValidated ? [] : [measure.events.length ? "single engine output has normalization warnings" : "single engine produced an empty measure"];
      } else {
        state = "FAILED";
        confidence = 0;
        events = [];
        reviewReasons = ["no aligned evidence for measure"];
      }
      const roles: Record<OmrRole, OmrRoleMeasureState> = {
        melody: nativeScore ? { state: measure.events.some((event) => event.role === "melody") ? "TRUSTED_NATIVE" : null, confidence: measure.events.some((event) => event.role === "melody") ? 1 : null } : pairing ? roleStateForAgreement(pairing.agreement.roles.melody, thresholds) : independentAvailable.length === 1 && primary.warnings.length === 0 && measure.events.some((event) => event.role === "melody") ? { state: "TRUSTED_SINGLE_ENGINE", confidence: 1 } : { state: null, confidence: null },
        harmony: nativeScore ? { state: measure.events.some((event) => event.role === "harmony") ? "TRUSTED_NATIVE" : null, confidence: measure.events.some((event) => event.role === "harmony") ? 1 : null } : pairing ? roleStateForAgreement(pairing.agreement.roles.harmony, thresholds) : independentAvailable.length === 1 && primary.warnings.length === 0 && measure.events.some((event) => event.role === "harmony") ? { state: "TRUSTED_SINGLE_ENGINE", confidence: 1 } : { state: null, confidence: null },
        rhythm: nativeScore ? { state: measure.events.some((event) => event.role === "rhythm") ? "TRUSTED_NATIVE" : null, confidence: measure.events.some((event) => event.role === "rhythm") ? 1 : null } : pairing ? roleStateForAgreement(pairing.agreement.roles.rhythm, thresholds) : independentAvailable.length === 1 && primary.warnings.length === 0 && measure.events.some((event) => event.role === "rhythm") ? { state: "TRUSTED_SINGLE_ENGINE", confidence: 1 } : { state: null, confidence: null },
      };
      measures.push({ id: measure.id, index: measure.index, number: measure.number, source: primarySource, page: measure.page, system: measure.system, startBeat: measure.startBeat, durationBeats: measure.durationBeats, state, confidence: rounded(confidence), agreement, roles, events, reviewReasons });
    }
  }
  const reviewItems = measures.filter((measure) => measure.state === "REVIEW_REQUIRED" || measure.state === "FAILED").map(reviewPriority)
    .sort((a, b) => b.priority - a.priority || a.measureIndex - b.measureIndex || stableCompare(a.measureId, b.measureId));
  const summaryState = aggregateState(measures, Boolean(nativeScore), independentAvailable.length);
  const trustedMeasures = measures.filter((measure) => measure.state === "TRUSTED_NATIVE" || measure.state === "TRUSTED_CONSENSUS" || measure.state === "TRUSTED_SINGLE_ENGINE").length;
  const reviewRequiredMeasures = measures.filter((measure) => measure.state === "REVIEW_REQUIRED").length;
  const failedMeasures = measures.filter((measure) => measure.state === "FAILED").length;
  const coverageFor = (role: OmrRole): number | null => {
    const roleMeasures = measures.filter((measure) => measure.roles[role].state !== null);
    if (!roleMeasures.length) return null;
    const trusted = roleMeasures.filter((measure) => measure.roles[role].state === "TRUSTED_NATIVE" || measure.roles[role].state === "TRUSTED_CONSENSUS" || measure.roles[role].state === "TRUSTED_SINGLE_ENGINE");
    return rounded(trusted.length / roleMeasures.length);
  };
  const eligibility = {
    melody: roleCoverage(measures, "melody"),
    harmony: roleCoverage(measures, "harmony"),
    rhythm: roleCoverage(measures, "rhythm"),
  } satisfies OmrEligibility;
  for (const role of ROLES) eligibility[role].eligible = eligibility[role].coverage !== null && eligibility[role].coverage! >= eligibleCoverage;
  return {
    schemaVersion: OMR_CONSENSUS_SCHEMA_VERSION,
    nativePriority: Boolean(nativeScore),
    thresholds: { consensusTrust: thresholds.consensusTrust, reviewRequired: thresholds.reviewRequired, eligibleCoverage, onsetToleranceBeats },
    backends,
    measures,
    alignments,
    reviewItems,
    summary: {
      state: summaryState,
      totalMeasures: measures.length,
      trustedMeasures,
      reviewRequiredMeasures,
      failedMeasures,
      fallbackWindows: nativeScore ? 0 : independentAvailable.length === 1 ? measures.length : reviewRequiredMeasures + failedMeasures,
      coverage: { all: measures.length ? rounded(trustedMeasures / measures.length) : null, melody: coverageFor("melody"), harmony: coverageFor("harmony"), rhythm: coverageFor("rhythm") },
    },
    eligibility,
    ...(nativeInput ? { native: { id: nativeInput.id, version: nativeInput.version, provenance: sanitizeOmrMetadata(nativeInput.provenance) as Record<string, unknown>, measureCount: nativeScore?.measures.length ?? 0 } } : {}),
    ...(sourceInput.metadata === undefined ? {} : { metadata: sanitizeOmrMetadata(sourceInput.metadata) }),
  };
}

/** Return only events from trusted regions; review/failed measures stay empty. */
export function selectOmrConsensusEvents(report: OmrConsensusReport, role?: OmrRole): OmrNormalizedEvent[] {
  const trustedRoleStates = new Set<OmrTrustState>([
    "TRUSTED_NATIVE",
    "TRUSTED_CONSENSUS",
    "TRUSTED_SINGLE_ENGINE",
  ]);
  const eventIsTrusted = (measure: OmrConsensusMeasure, event: OmrNormalizedEvent): boolean => {
    if (role && event.role !== role) return false;
    if (!event.role) return measure.state !== "REVIEW_REQUIRED" && measure.state !== "FAILED";
    const roleState = measure.roles[event.role]?.state;
    return roleState !== null && roleState !== undefined && trustedRoleStates.has(roleState);
  };
  return [...report.measures]
    .flatMap((measure) => {
      return measure.events.filter((event) => eventIsTrusted(measure, event));
    })
    .sort(eventSort);
}

function sanitizeError(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function pathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://") || value.includes("/Users/") || value.includes("/private/tmp/");
}

function redactUrlCredentials(value: string): string {
  // Keep the logical URL while ensuring user-info cannot enter a report hash
  // or a review artifact.  The fallback also handles non-standard schemes
  // which the URL constructor would reject.
  return value.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s\/@:]+)(?::[^\s\/@]*)?@/g, "$1[redacted]@");
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const redactedUrl = redactUrlCredentials(value);
    return pathLike(redactedUrl) || /(^|\/)(?:Users|private|tmp)(\/|$)/.test(redactedUrl) ? "[redacted-path]" : redactedUrl;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const objectKey of Object.keys(value as Record<string, unknown>).sort(stableCompare)) {
    if (objectKey === "generatedAt" || objectKey === "runtime" || objectKey === "outputDirectory") continue;
    const child = (value as Record<string, unknown>)[objectKey];
    if (/^(?:path|filePath|sourcePath|absolutePath|imagePath|sourcePdfPath)$/i.test(objectKey)) {
      output[objectKey] = "[redacted-path]";
    } else {
      output[objectKey] = sanitizeValue(child, objectKey);
    }
  }
  void key;
  return output;
}

/** Recursively redact path-like metadata and omit nondeterministic fields. */
export function sanitizeOmrMetadata(value: unknown): unknown {
  return sanitizeValue(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(stableCompare).map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
}

/** Stable, path-safe JSON for report hashes and determinism checks. */
export function canonicalOmrConsensusJson(value: unknown): string {
  return JSON.stringify(stableValue(sanitizeOmrMetadata(value)));
}

function validCrop(value: unknown): OmrRasterizationConfig["crop"] {
  if (!value || typeof value !== "object") return null;
  const crop = value as Partial<NonNullable<OmrRasterizationConfig["crop"]>>;
  if (![crop.left, crop.top, crop.right, crop.bottom].every(finite)) return null;
  if (crop.right! < crop.left! || crop.bottom! < crop.top!) return null;
  return { left: crop.left!, top: crop.top!, right: crop.right!, bottom: crop.bottom! };
}

/** Normalize raster settings while deliberately dropping local output paths. */
export function normalizeOmrRasterizationConfig(input: OmrRasterizationConfigInput = {}): OmrRasterizationConfig {
  const config = input && typeof input === "object" ? input : {};
  const supportedRotations = [0, 90, 180, 270] as const;
  const rotation = supportedRotations.includes(config.rotation as (typeof supportedRotations)[number]) ? config.rotation as OmrRasterizationConfig["rotation"] : 0;
  const pages = Array.isArray(config.pages) && config.pages.length === 2 && config.pages.every((page) => finite(page) && Number.isInteger(page) && page > 0) && config.pages[1]! >= config.pages[0]! ? [config.pages[0]!, config.pages[1]!] as [number, number] : null;
  return {
    dpi: finite(config.dpi) && config.dpi >= 72 && config.dpi <= 1200 ? Math.round(config.dpi) : 300,
    format: config.format === "png" ? "png" : "png",
    renderer: {
      id: typeof config.renderer?.id === "string" && config.renderer.id ? config.renderer.id : "pdftoppm",
      version: typeof config.renderer?.version === "string" && config.renderer.version ? config.renderer.version : "unknown",
    },
    crop: validCrop(config.crop),
    rotation,
    pages,
  };
}

export function canonicalOmrRasterizationConfigJson(input: OmrRasterizationConfigInput | OmrRasterizationConfig = {}): string {
  return canonicalOmrConsensusJson(normalizeOmrRasterizationConfig(input));
}

/** Compact pure review sheet text; callers may add cropped images around it. */
export function renderOmrReviewMarkdown(report: OmrConsensusReport): string {
  const lines = ["# OMR targeted review", "", `Overall: ${report.summary.state}`, ""];
  if (!report.reviewItems.length) lines.push("No regional disagreements require review.");
  else {
    lines.push("| Priority | Measure | Reasons |", "| --- | --- | --- |");
    for (const item of report.reviewItems) lines.push(`| ${item.priorityClass} | ${item.number} | ${item.reasons.join("; ") || "unmatched evidence"} |`);
  }
  return lines.join("\n") + "\n";
}
