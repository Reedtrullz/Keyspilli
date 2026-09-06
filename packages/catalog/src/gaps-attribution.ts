import { createHash } from "node:crypto";
import {
  compareUpstreamRoutes,
  normalizeUpstreamTruth,
  type UpstreamCandidateNoteInput,
  type UpstreamEvaluationOptions,
  type UpstreamRouteCandidate,
  type UpstreamRouteMetrics,
  type UpstreamTechniqueMetrics,
  type UpstreamTruth,
} from "./upstream-attribution.js";

export const GAPS_ATTRIBUTION_SCHEMA_VERSION = 1 as const;
export const GAPS_ROUTE = "gaps" as const;
export const CURRENT_GUITAR_AMT_ROUTE = "current-guitar-amt" as const;

export type GapsDecision =
  | "GUITAR_SPECIFIC_AMT_VALIDATED"
  | "GUITAR_SPECIFIC_AMT_MIXED"
  | "CURRENT_GUITAR_AMT_INSUFFICIENT"
  | "GAPS_BACKEND_NOT_EVALUATED";

export interface GapsCheckpointProvenance {
  id: string;
  sha256: string;
  sizeBytes: number;
}

export interface GapsBackendConfig {
  id: "gaps";
  version: string;
  checkpoint: GapsCheckpointProvenance;
  config: Record<string, string | number | boolean | null>;
}

export type GapsBackendProvenance = GapsBackendConfig;

export interface GapsPreRegistration {
  dataset: string;
  itemIds: string[];
  techniques: string[];
}

export interface GapsProvenance {
  schemaVersion: typeof GAPS_ATTRIBUTION_SCHEMA_VERSION;
  backend: GapsBackendConfig;
  preRegistration: GapsPreRegistration;
}

export interface GapsDecisionThresholds {
  /** Minimum number of independently scored items. */
  minItems: number;
  /** Both aggregate F1 gains must meet this threshold for validation. */
  materialExactGain: number;
  materialPcGain: number;
  /** A technique counts as a gain only when both exact and PC improve. */
  techniqueExactGain: number;
  techniquePcGain: number;
  requiredTechniqueGains: number;
  maxUnsupportedRateIncrease: number;
  maxUnsupportedRateMultiplier: number;
  minCurrentExactF1: number;
  minCurrentPcF1: number;
}

export const DEFAULT_GAPS_THRESHOLDS: Readonly<GapsDecisionThresholds> = Object.freeze({
  minItems: 3,
  materialExactGain: 0.03,
  materialPcGain: 0.03,
  techniqueExactGain: 0.05,
  techniquePcGain: 0.05,
  requiredTechniqueGains: 3,
  maxUnsupportedRateIncrease: 0.1,
  maxUnsupportedRateMultiplier: 1.25,
  minCurrentExactF1: 0.2,
  minCurrentPcF1: 0.2,
});

export const GAPS_DECISION_THRESHOLDS = DEFAULT_GAPS_THRESHOLDS;
export const DEFAULT_GAPS_DECISION_THRESHOLDS = DEFAULT_GAPS_THRESHOLDS;

export interface GapsParsedMidiNote extends UpstreamCandidateNoteInput {
  vel?: unknown;
}

export interface GapsRouteMetadata {
  status?: UpstreamRouteCandidate["status"];
  durationBeats?: number;
  durationSeconds?: number;
  tempoBpm?: number;
  sourceHash?: string;
  configHash?: string;
}

export interface GapsRawTruth {
  notes: readonly UpstreamCandidateNoteInput[];
  metadata?: {
    performanceId?: string;
    technique?: string;
    durationBeats?: number;
    tempoBpm?: number;
    sourceHash?: string;
  };
}

export type GapsTruthInput = UpstreamTruth | GapsRawTruth | readonly UpstreamCandidateNoteInput[];
export type GapsRouteInput = UpstreamRouteCandidate | readonly GapsParsedMidiNote[];

export interface GapsAttributionItemInput {
  id: string;
  truth: GapsTruthInput;
  current: GapsRouteInput;
  gaps: GapsRouteInput;
}

export interface GapsTechniqueAggregate {
  truthCount: number;
  current: UpstreamTechniqueMetrics | null;
  gaps: UpstreamTechniqueMetrics | null;
  exactGain: number | null;
  pcGain: number | null;
}

export interface GapsAggregate {
  routes: Record<typeof CURRENT_GUITAR_AMT_ROUTE | typeof GAPS_ROUTE, UpstreamRouteMetrics>;
  techniques: Record<string, GapsTechniqueAggregate>;
  exactGain: number | null;
  pcGain: number | null;
  unsupportedRateIncrease: number | null;
  unsupportedRateMultiplier: number | null;
}

export interface GapsItemEvaluation {
  id: string;
  techniques: string[];
  current: UpstreamRouteMetrics;
  gaps: UpstreamRouteMetrics;
  exactGain: number | null;
  pcGain: number | null;
}

export interface GapsAttributionInput {
  provenance: GapsProvenance;
  items: readonly GapsAttributionItemInput[];
  thresholds?: Partial<GapsDecisionThresholds>;
  evaluation?: UpstreamEvaluationOptions;
}

export interface GapsAttributionReport {
  schemaVersion: typeof GAPS_ATTRIBUTION_SCHEMA_VERSION;
  provenance: GapsProvenance;
  thresholds: GapsDecisionThresholds;
  items: GapsItemEvaluation[];
  aggregate: GapsAggregate;
  decision: GapsDecision;
  decisions: [GapsDecision];
}

/** Precomputed pair used when the baseline route is a frozen report. */
export interface GapsMetricItemInput {
  id: string;
  techniques: string[];
  current: UpstreamRouteMetrics;
  gaps: UpstreamRouteMetrics;
}

export interface GapsMetricAttributionInput {
  provenance: GapsProvenance;
  items: readonly GapsMetricItemInput[];
  aggregate: { current: UpstreamRouteMetrics; gaps: UpstreamRouteMetrics };
  thresholds?: Partial<GapsDecisionThresholds>;
}

/**
 * Convert the fixed-tempo MIDI timeline written by GAPS to the truth beat
 * timeline used by the shared evaluator. GAPS writes at 120 BPM; Guitar-TECHS
 * truth files carry their own tempo. The operation is deterministic and does
 * not alter pitch or note metadata.
 */
export function normalizeGapsBeatTimeline(
  notes: readonly GapsParsedMidiNote[],
  truthTempoBpm: number,
  writerTempoBpm = 120,
): GapsParsedMidiNote[] {
  if (!Array.isArray(notes)) throw new Error("GAPS notes must be an array");
  if (typeof truthTempoBpm !== "number" || !Number.isFinite(truthTempoBpm) || truthTempoBpm <= 0) throw new Error("truth tempo must be positive");
  if (typeof writerTempoBpm !== "number" || !Number.isFinite(writerTempoBpm) || writerTempoBpm <= 0) throw new Error("GAPS writer tempo must be positive");
  const scale = truthTempoBpm / writerTempoBpm;
  return notes.map((note) => {
    if (!note || typeof note !== "object" || Array.isArray(note)) throw new Error("GAPS MIDI note must be an object");
    const start = note.start ?? note.onset;
    const dur = note.dur ?? note.duration;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) throw new Error("GAPS MIDI note start must be finite and non-negative");
    if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0) throw new Error("GAPS MIDI note duration must be positive");
    return { ...note, start: start * scale, dur: dur * scale };
  });
}

const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_TEXT = /^[^\0\r\n]+$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || !SAFE_TEXT.test(value)) throw new Error(`${name} must be a non-empty safe string`);
  return value.trim();
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

function sortedUnique(values: unknown, name: string): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name} must be non-empty`);
  const result = values.map((value, index) => text(value, `${name}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${name} must be unique`);
  return result.sort(compareText);
}

function validateCheckpoint(value: unknown): GapsCheckpointProvenance {
  const row = object(value, "checkpoint");
  const sha256 = text(row.sha256, "checkpoint.sha256").toLowerCase();
  if (!SHA256.test(sha256)) throw new Error("checkpoint.sha256 must be a SHA256 hash");
  return { id: text(row.id, "checkpoint.id"), sha256, sizeBytes: integer(row.sizeBytes, "checkpoint.sizeBytes", 1) };
}

export const validateGapsCheckpoint = validateCheckpoint;

/** Validate the pinned GAPS backend identity, checkpoint, and scalar config. */
export function validateGapsBackendConfig(value: unknown): GapsBackendConfig {
  const backend = object(value, "backend");
  if (backend.id !== "gaps") throw new Error("backend.id must be gaps");
  const config = object(backend.config, "backend.config");
  for (const [key, configValue] of Object.entries(config)) {
    if (!SAFE_TEXT.test(key) || (typeof configValue !== "string" && typeof configValue !== "number" && typeof configValue !== "boolean" && configValue !== null) || (typeof configValue === "number" && !Number.isFinite(configValue))) {
      throw new Error("backend.config contains an unsupported value");
    }
  }
  return {
    id: "gaps",
    version: text(backend.version, "backend.version"),
    checkpoint: validateCheckpoint(backend.checkpoint),
    config: { ...config } as GapsBackendConfig["config"],
  };
}

/** Validate pinned GAPS backend/checkpoint provenance and pre-registration. */
export function validateGapsProvenance(value: unknown): GapsProvenance {
  const row = object(value, "provenance");
  if (row.schemaVersion !== GAPS_ATTRIBUTION_SCHEMA_VERSION) throw new Error("provenance.schemaVersion must be 1");
  const backend = validateGapsBackendConfig(row.backend);
  const registration = object(row.preRegistration, "provenance.preRegistration");
  const itemIds = sortedUnique(registration.itemIds, "preRegistration.itemIds");
  const techniques = sortedUnique(registration.techniques, "preRegistration.techniques");
  return {
    schemaVersion: GAPS_ATTRIBUTION_SCHEMA_VERSION,
    backend,
    preRegistration: { dataset: text(registration.dataset, "preRegistration.dataset"), itemIds, techniques },
  };
}

/** Convert parsed MIDI notes to the route candidate accepted by the shared evaluator. */
export function normalizeGapsRouteCandidate(
  route: string,
  notes: readonly GapsParsedMidiNote[],
  metadata: GapsRouteMetadata = {},
): UpstreamRouteCandidate {
  const routeName = text(route, "route");
  if (!Array.isArray(notes)) throw new Error("GAPS notes must be an array");
  return {
    route: routeName,
    ...metadata,
    notes: notes.map((note) => {
      if (!note || typeof note !== "object" || Array.isArray(note)) throw new Error("GAPS MIDI note must be an object");
      const input = note as GapsParsedMidiNote;
      return {
        ...(input.midi !== undefined ? { midi: input.midi } : {}),
        ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
        ...(input.start !== undefined ? { start: input.start } : {}),
        ...(input.onset !== undefined ? { onset: input.onset } : {}),
        ...(input.dur !== undefined ? { dur: input.dur } : {}),
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.technique !== undefined ? { technique: input.technique } : {}),
        ...(input.unsupported !== undefined ? { unsupported: input.unsupported } : {}),
      };
    }),
  };
}

function truthInput(value: GapsTruthInput): UpstreamTruth {
  if (Array.isArray(value)) return normalizeUpstreamTruth(value);
  const row = object(value, "truth");
  if (!Array.isArray(row.notes)) throw new Error("truth.notes must be an array");
  const metadata = row.schemaVersion === 1
    ? {
      performanceId: typeof row.performanceId === "string" ? row.performanceId : undefined,
      technique: typeof row.technique === "string" ? row.technique : undefined,
      durationBeats: typeof row.durationBeats === "number" ? row.durationBeats : undefined,
      tempoBpm: typeof row.tempoBpm === "number" ? row.tempoBpm : undefined,
      sourceHash: typeof row.sourceHash === "string" ? row.sourceHash : undefined,
    }
    : (row.metadata ?? {}) as GapsRawTruth["metadata"];
  return normalizeUpstreamTruth(row.notes as UpstreamCandidateNoteInput[], metadata);
}

function routeInput(route: string, input: GapsRouteInput): UpstreamRouteCandidate {
  if (Array.isArray(input)) return normalizeGapsRouteCandidate(route, input);
  if (!input || typeof input !== "object") throw new Error(`${route} route must be an object or note array`);
  const candidate = input as UpstreamRouteCandidate;
  if (candidate.status === undefined && !Array.isArray(candidate.notes)) throw new Error(`${route} route notes must be an array`);
  if (candidate.status !== undefined && candidate.status !== null && !["available", "unavailable", "malformed", "failed", "timeout"].includes(candidate.status)) throw new Error(`${route} route status is invalid`);
  return { ...candidate, route: candidate.route ?? route };
}

function routeResult(report: ReturnType<typeof compareUpstreamRoutes>, route: string): UpstreamRouteMetrics {
  const result = report.routes.find((candidate) => candidate.route === route);
  if (!result) throw new Error(`missing evaluated route: ${route}`);
  return result;
}

function gain(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Math.round((left - right) * 1e9) / 1e9;
}

function offsetNote(note: UpstreamCandidateNoteInput, offset: number): UpstreamCandidateNoteInput {
  const start = note.start ?? note.onset;
  if (typeof start !== "number" || !Number.isFinite(start)) return { ...note };
  return { ...note, start: start + offset, onset: undefined };
}

function techniqueAggregate(current: UpstreamRouteMetrics, gaps: UpstreamRouteMetrics): Record<string, GapsTechniqueAggregate> {
  const names = [...new Set([...Object.keys(current.techniques), ...Object.keys(gaps.techniques)])].sort(compareText);
  return Object.fromEntries(names.map((name) => {
    const baseline = current.techniques[name];
    const candidate = gaps.techniques[name];
    return [name, {
      truthCount: candidate?.truthCount ?? baseline?.truthCount ?? 0,
      current: baseline ?? null,
      gaps: candidate ?? null,
      exactGain: gain(candidate?.exactPitch.f1 ?? null, baseline?.exactPitch.f1 ?? null),
      pcGain: gain(candidate?.pitchClass.f1 ?? null, baseline?.pitchClass.f1 ?? null),
    } satisfies GapsTechniqueAggregate];
  }));
}

function thresholdsFor(value: Partial<GapsDecisionThresholds> | undefined): GapsDecisionThresholds {
  const thresholds = { ...DEFAULT_GAPS_THRESHOLDS, ...value };
  for (const [name, threshold] of Object.entries(thresholds)) {
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) throw new Error(`invalid GAPS threshold: ${name}`);
  }
  if (!Number.isSafeInteger(thresholds.minItems) || !Number.isSafeInteger(thresholds.requiredTechniqueGains) || thresholds.minItems < 1 || thresholds.requiredTechniqueGains < 1) throw new Error("GAPS evidence count thresholds must be positive integers");
  for (const name of ["materialExactGain", "materialPcGain", "techniqueExactGain", "techniquePcGain", "maxUnsupportedRateIncrease", "minCurrentExactF1", "minCurrentPcF1"] as const) {
    if (thresholds[name] > 1) throw new Error(`invalid GAPS threshold: ${name}`);
  }
  return thresholds;
}

function unsupportedSafety(aggregate: GapsAggregate, thresholds: GapsDecisionThresholds): boolean {
  const current = aggregate.routes[CURRENT_GUITAR_AMT_ROUTE].unsupported.rate;
  const gaps = aggregate.routes[GAPS_ROUTE].unsupported.rate;
  if (current === null || gaps === null) return false;
  const increase = gaps - current;
  if (increase > thresholds.maxUnsupportedRateIncrease) return false;
  return current === 0 ? gaps <= thresholds.maxUnsupportedRateIncrease : gaps / current <= thresholds.maxUnsupportedRateMultiplier;
}

function hasAvailable(metrics: UpstreamRouteMetrics): boolean {
  return metrics.status === "available" && metrics.exactPitch.f1 !== null && metrics.pitchClass.f1 !== null;
}

function metricItem(item: GapsMetricItemInput): GapsItemEvaluation {
  return {
    id: item.id,
    techniques: [...new Set(item.techniques)].sort(compareText),
    current: item.current,
    gaps: item.gaps,
    exactGain: gain(item.gaps.exactPitch.f1, item.current.exactPitch.f1),
    pcGain: gain(item.gaps.pitchClass.f1, item.current.pitchClass.f1),
  };
}

/** Assemble a deterministic report from a frozen baseline and fresh GAPS metrics. */
export function assembleGapsAttributionReport(input: GapsMetricAttributionInput): GapsAttributionReport {
  const provenance = validateGapsProvenance(input.provenance);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("GAPS items must be non-empty");
  const thresholds = thresholdsFor(input.thresholds);
  const sortedItems = [...input.items].sort((left, right) => compareText(left.id, right.id));
  if (new Set(sortedItems.map((item) => item.id)).size !== sortedItems.length) throw new Error("GAPS item IDs must be unique");
  if (sortedItems.length !== provenance.preRegistration.itemIds.length || sortedItems.some((item, index) => item.id !== provenance.preRegistration.itemIds[index])) throw new Error("GAPS items do not match pre-registration");
  const current = { ...input.aggregate.current, route: CURRENT_GUITAR_AMT_ROUTE };
  const gaps = { ...input.aggregate.gaps, route: GAPS_ROUTE };
  const aggregate: GapsAggregate = {
    routes: { [CURRENT_GUITAR_AMT_ROUTE]: current, [GAPS_ROUTE]: gaps },
    techniques: techniqueAggregate(current, gaps),
    exactGain: gain(gaps.exactPitch.f1, current.exactPitch.f1),
    pcGain: gain(gaps.pitchClass.f1, current.pitchClass.f1),
    unsupportedRateIncrease: gain(gaps.unsupported.rate, current.unsupported.rate),
    unsupportedRateMultiplier: current.unsupported.rate && current.unsupported.rate > 0 && gaps.unsupported.rate !== null ? gaps.unsupported.rate / current.unsupported.rate : null,
  };
  const report: GapsAttributionReport = {
    schemaVersion: GAPS_ATTRIBUTION_SCHEMA_VERSION,
    provenance,
    thresholds,
    items: sortedItems.map(metricItem),
    aggregate,
    decision: "CURRENT_GUITAR_AMT_INSUFFICIENT",
    decisions: ["CURRENT_GUITAR_AMT_INSUFFICIENT"],
  };
  const decision = classifyGapsDecision(report);
  return { ...report, decision, decisions: [decision] };
}

/** Classify a report with one conservative, mutually-exclusive decision. */
export function classifyGapsDecision(report: Pick<GapsAttributionReport, "items" | "aggregate" | "thresholds">): GapsDecision {
  const routeNames = Object.keys(report.aggregate.routes).sort();
  if (routeNames.length !== 2 || routeNames[0] !== CURRENT_GUITAR_AMT_ROUTE || routeNames[1] !== GAPS_ROUTE) throw new Error("GAPS evaluation may contain only current-guitar-amt and gaps routes");
  const current = report.aggregate.routes[CURRENT_GUITAR_AMT_ROUTE];
  const gaps = report.aggregate.routes[GAPS_ROUTE];
  if (!hasAvailable(gaps)) return "GAPS_BACKEND_NOT_EVALUATED";
  if (!hasAvailable(current) || report.items.length < report.thresholds.minItems) return "CURRENT_GUITAR_AMT_INSUFFICIENT";
  const currentExact = current.exactPitch.f1 ?? 0;
  const currentPc = current.pitchClass.f1 ?? 0;
  if (currentExact < report.thresholds.minCurrentExactF1 && currentPc < report.thresholds.minCurrentPcF1) return "CURRENT_GUITAR_AMT_INSUFFICIENT";
  const exactMaterial = (report.aggregate.exactGain ?? -Infinity) >= report.thresholds.materialExactGain;
  const pcMaterial = (report.aggregate.pcGain ?? -Infinity) >= report.thresholds.materialPcGain;
  const techniqueGains = Object.values(report.aggregate.techniques).filter((technique) =>
    (technique.exactGain ?? -Infinity) >= report.thresholds.techniqueExactGain
    && (technique.pcGain ?? -Infinity) >= report.thresholds.techniquePcGain,
  ).length;
  if (exactMaterial && pcMaterial && techniqueGains >= report.thresholds.requiredTechniqueGains && unsupportedSafety(report.aggregate, report.thresholds)) return "GUITAR_SPECIFIC_AMT_VALIDATED";
  if (exactMaterial || pcMaterial || techniqueGains > 0) return "GUITAR_SPECIFIC_AMT_MIXED";
  return "CURRENT_GUITAR_AMT_INSUFFICIENT";
}

/** Evaluate each item and one aggregate through compareUpstreamRoutes. */
export function evaluateGapsAttribution(input: GapsAttributionInput): GapsAttributionReport {
  const provenance = validateGapsProvenance(input.provenance);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("GAPS items must be non-empty");
  const thresholds = thresholdsFor(input.thresholds);
  const sortedItems = [...input.items].sort((left, right) => compareText(left.id, right.id));
  if (new Set(sortedItems.map((item) => item.id)).size !== sortedItems.length) throw new Error("GAPS item IDs must be unique");
  if (sortedItems.length !== provenance.preRegistration.itemIds.length || sortedItems.some((item, index) => item.id !== provenance.preRegistration.itemIds[index])) throw new Error("GAPS items do not match pre-registration");
  for (const item of sortedItems) {
    const routes = (item as GapsAttributionItemInput & { routes?: unknown }).routes;
    if (routes !== undefined) {
      const names = Object.keys(object(routes, "item.routes")).sort(compareText);
      if (names.length !== 2 || names[0] !== CURRENT_GUITAR_AMT_ROUTE || names[1] !== GAPS_ROUTE) throw new Error("GAPS evaluation may contain only current-guitar-amt and gaps routes");
    }
  }
  const itemReports = sortedItems.map((item): GapsItemEvaluation => {
    const truth = truthInput(item.truth);
    const report = compareUpstreamRoutes(truth, {
      [CURRENT_GUITAR_AMT_ROUTE]: routeInput(CURRENT_GUITAR_AMT_ROUTE, item.current),
      [GAPS_ROUTE]: routeInput(GAPS_ROUTE, item.gaps),
    }, input.evaluation);
    const current = routeResult(report, CURRENT_GUITAR_AMT_ROUTE);
    const gaps = routeResult(report, GAPS_ROUTE);
    return {
      id: item.id,
      techniques: Object.keys(gaps.techniques).sort(compareText),
      current,
      gaps,
      exactGain: gain(gaps.exactPitch.f1, current.exactPitch.f1),
      pcGain: gain(gaps.pitchClass.f1, current.pitchClass.f1),
    };
  });
  const aggregateTruthNotes: UpstreamCandidateNoteInput[] = [];
  const aggregateRouteNotes: Record<string, UpstreamCandidateNoteInput[]> = { [CURRENT_GUITAR_AMT_ROUTE]: [], [GAPS_ROUTE]: [] };
  let offset = 0;
  for (const item of sortedItems) {
    const truth = truthInput(item.truth);
    aggregateTruthNotes.push(...truth.notes.map((note) => offsetNote(note, offset)));
    for (const route of [CURRENT_GUITAR_AMT_ROUTE, GAPS_ROUTE] as const) {
      const candidate = routeInput(route, item[route === CURRENT_GUITAR_AMT_ROUTE ? "current" : "gaps"]);
      if (candidate.status === undefined || candidate.status === "available") {
        for (const note of candidate.notes ?? []) aggregateRouteNotes[route]!.push(offsetNote(note, offset));
      }
    }
    offset += Math.max(truth.durationBeats, 1) + 1;
  }
  const aggregateTruth = normalizeUpstreamTruth(aggregateTruthNotes, { durationBeats: offset });
  const aggregateReport = compareUpstreamRoutes(aggregateTruth, {
    [CURRENT_GUITAR_AMT_ROUTE]: { route: CURRENT_GUITAR_AMT_ROUTE, notes: aggregateRouteNotes[CURRENT_GUITAR_AMT_ROUTE], durationBeats: offset },
    [GAPS_ROUTE]: { route: GAPS_ROUTE, notes: aggregateRouteNotes[GAPS_ROUTE], durationBeats: offset },
  }, input.evaluation);
  const current = routeResult(aggregateReport, CURRENT_GUITAR_AMT_ROUTE);
  const gaps = routeResult(aggregateReport, GAPS_ROUTE);
  const aggregateCurrent = itemReports.every((item) => item.current.status === "available") ? current : { ...current, status: "unavailable" as const };
  const aggregateGaps = itemReports.every((item) => item.gaps.status === "available") ? gaps : { ...gaps, status: "unavailable" as const };
  return assembleGapsAttributionReport({ provenance, thresholds, items: itemReports, aggregate: { current: aggregateCurrent, gaps: aggregateGaps } });
}

const PATH_KEY = /path|file|filename|directory|dir|root|cwd|runtime|command|executable/i;

function redactString(value: string): string {
  if (/^(?:file:\/\/)?\//i.test(value)) return "[redacted-path]";
  return value.replace(/(^|[\s("'=,;\[])(?:file:\/\/)?\/(?!\/)[^\s"'<>;,)]*/gi, (_match, prefix: string) => `${prefix}[redacted-path]`);
}

function stable(value: unknown, key?: string): string {
  if (key && PATH_KEY.test(key)) return "undefined";
  if (value === undefined) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  if (typeof value === "string") return JSON.stringify(redactString(value));
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((name) => {
      const serialized = stable((value as Record<string, unknown>)[name], name);
      return serialized === "undefined" ? "" : `${JSON.stringify(name)}:${serialized}`;
    }).filter(Boolean).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic JSON for compact reports; item and technique maps are already sorted by evaluation. */
export function canonicalGapsEvaluation(value: GapsAttributionReport | object): string {
  return `${stable(value)}\n`;
}

export function hashCanonicalGapsEvaluation(value: GapsAttributionReport | object): string {
  return createHash("sha256").update(canonicalGapsEvaluation(value), "utf8").digest("hex");
}

export const normalizeGapsBackendProvenance = validateGapsProvenance;
export const normalizeGapsCandidate = normalizeGapsRouteCandidate;
export const evaluateGapsExperiment = evaluateGapsAttribution;
export const evaluateGaps = evaluateGapsAttribution;
export const aggregateGapsAttribution = evaluateGapsAttribution;
export const canonicalGapsReport = canonicalGapsEvaluation;
export const hashCanonicalGapsReport = hashCanonicalGapsEvaluation;
export const canonicalGapsAttribution = canonicalGapsEvaluation;
export const hashCanonicalGapsAttribution = hashCanonicalGapsEvaluation;
export const hashGapsAttribution = hashCanonicalGapsEvaluation;
