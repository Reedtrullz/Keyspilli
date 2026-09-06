#!/usr/bin/env node

/**
 * Aggregate the local shadow-corpus evidence into one decision-oriented
 * report.  This is deliberately a report boundary, not a generation or
 * publishing command: it reads JSON diagnostics, emits counts/statuses, and
 * never carries media, note arrays, or physical paths into the result.
 */

import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SHADOW_MISSION_REPORT_SCHEMA_VERSION = 1 as const;
export const SHADOW_MISSION_REPORT_KIND = "shadow-mission-report" as const;

export type ShadowMissionReadiness =
  | "SHADOW_ENGINEERING_READY"
  | "BENCHMARK_READY_FOR_HUMAN_LISTENING"
  | "PRODUCTION_READY"
  | "BLOCKED"
  | "UNAVAILABLE";

export interface ShadowMissionReportInput {
  disk?: unknown;
  diskReport?: unknown;
  corpus?: unknown;
  corpusReport?: unknown;
  shadow?: unknown;
  shadowReport?: unknown;
  alignment?: unknown;
  alignmentReport?: unknown;
  retrieval?: unknown;
  retrievalReport?: unknown;
  benchmark?: unknown;
  benchmarkReport?: unknown;
  redBaron?: unknown;
  redBaronReport?: unknown;
  safety?: unknown;
}

export interface ShadowMissionReport {
  schemaVersion: typeof SHADOW_MISSION_REPORT_SCHEMA_VERSION;
  kind: typeof SHADOW_MISSION_REPORT_KIND;
  provenance: {
    disk: {
      status: "available" | "unavailable" | "below-threshold";
      freeBytes: number | null;
      freeGiB: number | null;
      thresholdGiB: number;
      source: "explicit-report" | null;
    };
    corpus: {
      status: "available" | "metadata-only" | "blocked" | "unavailable";
      id: string | null;
      datasetVersion: string | null;
      itemCount: number | null;
      license: string | Record<string, unknown> | null;
      sourceRecord: string | Record<string, unknown> | null;
      source: "explicit-report" | null;
    };
    safety: {
      noMedia: boolean | null;
      noProtectedPaths: boolean | null;
      candidateFreezeBeforeReference: boolean | null;
      source: "explicit-report" | "derived";
    };
  };
  shadow: {
    status: "available" | "unavailable" | "blocked" | "partial";
    itemCount: number | null;
    readyCount: number | null;
    notReadyCount: number | null;
    blockedCount: number | null;
    failures: string[];
    items: ShadowMissionItemSummary[];
  };
  alignment: {
    status: "available" | "unavailable";
    assessment: string | null;
    reference: {
      bars: number | null;
      durationBeats: number | null;
      tempoBpm: number | null;
      noteCount: number | null;
    };
    cases: {
      evaluated: number | null;
      recovered: number | null;
      falseAligned: number | null;
      meetingWindowMinimum: number | null;
      meetingBarMinimum: number | null;
      meetingBoth: number | null;
      rows: ShadowMissionAlignmentCase[];
    };
    failures: string[];
  };
  sevenSong: {
    status: "available" | "unavailable";
    requiredIds: string[] | null;
    presentIds: string[] | null;
    missingIds: string[] | null;
    /** True only when the supplied inventory arrays were well-formed and unique. */
    inventoryValid: boolean | null;
    songs: ShadowMissionSongSummary[];
  };
  benchmark: {
    status: "available" | "unavailable";
    /** True only when every benchmark song has one unique, non-empty ID. */
    songIdsValid: boolean | null;
    candidateCounts: { discovered: number | null; acquired: number | null; usable: number | null };
    candidateFreezeOrder: ShadowMissionFreezeSummary[];
    songs: ShadowMissionBenchmarkSong[];
    realSongSymbolicOutputs: number | null;
    humanReadyCount: number | null;
    failures: string[];
  };
  redBaron: {
    status: "available" | "unavailable" | "partial" | "blocked";
    firstLoss: ShadowMissionFirstLoss | null;
    stages: ShadowMissionStageSummary[];
    failures: string[];
  };
  readiness: {
    shadowEngineering: ShadowMissionReadiness;
    benchmarkHumanListening: ShadowMissionReadiness;
    production: ShadowMissionReadiness;
    highest: ShadowMissionReadiness | null;
  };
  safety: {
    actions: string[];
    noMedia: boolean | null;
    noProtectedPaths: boolean | null;
    candidateFreezeBeforeReference: boolean | null;
  };
  failures: string[];
  diagnostics: string[];
  determinism: { canonicalSha256: string };
}

export interface ShadowMissionItemSummary {
  id: string;
  status: string;
  label: string | null;
  leadNoteCount: number | null;
  semanticRootCount: number | null;
  variantValid: boolean | null;
  failures: string[];
  warnings: string[];
}

export interface ShadowMissionAlignmentCase {
  id: string;
  corruptionType: string | null;
  status: string | null;
  recovered: boolean | null;
  falseAlignment: boolean | null;
  coverageBars: number | null;
  timingErrorBeatsP90: number | null;
}

export interface ShadowMissionSongSummary {
  id: string;
  title: string | null;
  artist: string | null;
  statuses: string[];
  sourceCount: number | null;
  accessibleSourceCount: number | null;
  metadataOnly: boolean | null;
}

export interface ShadowMissionFreezeSummary {
  songId: string;
  completed: boolean | null;
  beforeReference: boolean | null;
  selectedRecordIds: string[];
  digest: string | null;
}

export interface ShadowMissionBenchmarkSong {
  id: string;
  present: boolean | null;
  generationStatus: string | null;
  outputAvailability: string | null;
  structuralGate: string | null;
  referenceAlignment: string | null;
  validatedReferenceWindows: number | null;
  validatedReferenceBars: number | null;
  /** Shape/bounds/uniqueness validation for the evidence array. */
  referenceWindowsValid: boolean | null;
  humanReady: boolean | null;
  freeze: ShadowMissionFreezeSummary | null;
  failures: string[];
}

export interface ShadowMissionStageSummary {
  stage: string;
  status: string | null;
  noteCount: number | null;
  rejectedNoteCount: number | null;
  invalidNoteCount: number | null;
  failures: string[];
}

export interface ShadowMissionFirstLoss {
  transition: string;
  category: "RAW_EVIDENCE_MISSING" | "DECODER_REJECTION" | "SEMANTIC_CONVERSION_LOSS" | "CANONICAL_NOISE_EXPANSION" | "DIFFICULTY_REDUCTION";
  count: number | null;
  diagnostics: string[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? redactText(clean) : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => textOrNull(item)).filter((item): item is string => Boolean(item)))].sort(compareText);
}

interface IdListAudit {
  ids: string[] | null;
  valid: boolean | null;
}

/**
 * Inventory IDs participate in a readiness gate, so silently filtering bad
 * values (as stringList intentionally does for diagnostics) would be unsafe.
 * Keep the useful normalized values only for a wholly valid, unique array.
 */
function auditIdList(value: unknown): IdListAudit {
  if (value === undefined) return { ids: null, valid: null };
  if (!Array.isArray(value)) return { ids: null, valid: false };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ids: null, valid: false };
    const id = item.trim();
    if (!id || /[\u0000-\u001f\u007f]/.test(id) || ids.includes(id)) return { ids: null, valid: false };
    ids.push(id);
  }
  return { ids: [...ids].sort(compareText), valid: true };
}

/** Preserve an authored sequence such as candidate freeze order. */
function orderedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => textOrNull(item)).filter((item): item is string => Boolean(item)))];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function firstRecord(input: ShadowMissionReportInput, ...keys: string[]): JsonObject | null {
  for (const key of keys) {
    const value = (input as unknown as JsonObject)[key];
    if (isObject(value)) return value;
  }
  return null;
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function finiteCount(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null || number < 0 ? null : Math.round(number);
}

/** Count either the legacy numeric form or an explicit evidence array. */
function evidenceCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : finiteCount(value);
}

function normalizedId(value: unknown, fallback: string): string {
  return textOrNull(value) ?? fallback;
}

function safeDiagnosticList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => redactText(textOrNull(item) ?? "[unserializable diagnostic]")).filter(Boolean))].sort(compareText);
}

function safeMetadata(value: unknown): string | Record<string, unknown> | null {
  if (typeof value === "string") return redactText(value);
  if (isObject(value)) return stableValue(value) as Record<string, unknown>;
  return null;
}

function diskProvenance(value: JsonObject | null): ShadowMissionReport["provenance"]["disk"] {
  const threshold = numberOrNull(value?.thresholdGiB) ?? 30;
  const freeBytes = numberOrNull(value?.freeBytes);
  const freeGiB = numberOrNull(value?.freeGiB) ?? (freeBytes === null ? null : freeBytes / (1024 ** 3));
  const explicitStatus = textOrNull(value?.status);
  const status: "available" | "unavailable" | "below-threshold" = explicitStatus === "below-threshold"
    || (freeGiB !== null && freeGiB < threshold) ? "below-threshold"
    : freeGiB === null ? "unavailable" : "available";
  return {
    status,
    freeBytes,
    freeGiB,
    thresholdGiB: threshold,
    source: value ? "explicit-report" : null,
  };
}

function corpusProvenance(value: JsonObject | null): ShadowMissionReport["provenance"]["corpus"] {
  if (!value) return { status: "unavailable", id: null, datasetVersion: null, itemCount: null, license: null, sourceRecord: null, source: null };
  const statusText = textOrNull(value.status);
  const status: ShadowMissionReport["provenance"]["corpus"]["status"] = statusText === "metadata-only" ? "metadata-only"
    : statusText === "blocked" || statusText === "failed" ? "blocked"
    : statusText === "ready" || statusText === "available" ? "available" : "metadata-only";
  const items = Array.isArray(value.items) ? value.items.length : null;
  return {
    status,
    id: textOrNull(value.id) ?? textOrNull(value.corpus),
    datasetVersion: textOrNull(value.datasetVersion),
    itemCount: finiteCount(value.itemCount) ?? items,
    license: safeMetadata(value.license),
    sourceRecord: safeMetadata(value.sourceRecord),
    source: "explicit-report",
  };
}

function shadowSection(value: JsonObject | null): ShadowMissionReport["shadow"] {
  if (!value) return { status: "unavailable", itemCount: null, readyCount: null, notReadyCount: null, blockedCount: null, failures: [], items: [] };
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: ShadowMissionItemSummary[] = rawItems.map((raw, index) => {
    const item = record(raw);
    const fixture = record(item.fixture);
    const output = record(item.output);
    const variants = record(item.variants);
    const variantValues = Object.values(variants).filter(isObject);
    const variantValid = variantValues.length ? variantValues.every((variant) => variant.valid !== false) : null;
    return {
      id: normalizedId(fixture.id ?? item.id, `item-${index + 1}`),
      status: textOrNull(item.status) ?? "unknown",
      label: textOrNull(fixture.label ?? item.label),
      leadNoteCount: finiteCount(nested(output, "melody", "leadNoteCount")),
      semanticRootCount: finiteCount(nested(output, "harmony", "semanticRootCount")),
      variantValid,
      failures: safeDiagnosticList(item.failures),
      warnings: safeDiagnosticList(item.warnings),
    };
  }).sort((left, right) => compareText(left.id, right.id));
  const summary = record(value.summary);
  const readyCount = finiteCount(summary.ready) ?? (rawItems.length ? items.filter((item) => item.status === "SHADOW_ENGINEERING_READY").length : null);
  const notReadyCount = finiteCount(summary.notReady) ?? (rawItems.length ? items.filter((item) => item.status === "SHADOW_ENGINEERING_NOT_READY").length : null);
  const blockedCount = finiteCount(summary.blocked) ?? (rawItems.length ? items.filter((item) => item.status === "SHADOW_ENGINEERING_BLOCKED").length : null);
  const statusText = textOrNull(value.status);
  const status: ShadowMissionReport["shadow"]["status"] = statusText === "SHADOW_ENGINEERING_READY" ? "available"
    : statusText === "SHADOW_ENGINEERING_NOT_READY" ? "partial"
    : statusText === "SHADOW_ENGINEERING_BLOCKED" ? "blocked" : "unavailable";
  return {
    status,
    itemCount: finiteCount(summary.total) ?? (Array.isArray(value.items) ? rawItems.length : null),
    readyCount,
    notReadyCount,
    blockedCount,
    failures: safeDiagnosticList(value.failures),
    items,
  };
}

function unavailableAlignment(failures: readonly string[] = []): ShadowMissionReport["alignment"] {
  return {
    status: "unavailable", assessment: null,
    reference: { bars: null, durationBeats: null, tempoBpm: null, noteCount: null },
    cases: { evaluated: null, recovered: null, falseAligned: null, meetingWindowMinimum: null, meetingBarMinimum: null, meetingBoth: null, rows: [] },
    failures: [...new Set(failures)].sort(compareText),
  };
}

interface ReferenceWindowAudit {
  count: number | null;
  bars: number | null;
  valid: boolean | null;
}

function validBounds(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= 0
    && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] > value[0];
}

function unionReferenceBars(intervals: readonly [number, number][]): number | null {
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let coveredBeats = 0;
  let [start, end] = sorted[0]!;
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      coveredBeats += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  coveredBeats += end - start;
  return coveredBeats / 4;
}

/**
 * Validate the actual window evidence before exposing a count.  A numeric
 * legacy count is retained as a diagnostic by evidenceCount, but it is not
 * sufficient for strict readiness because it cannot prove bounds or unique
 * window identity.
 */
function auditReferenceWindows(reference: JsonObject): ReferenceWindowAudit {
  const hasValidated = Object.prototype.hasOwnProperty.call(reference, "validatedWindows");
  const hasLegacy = Object.prototype.hasOwnProperty.call(reference, "windows");
  const raw = hasValidated ? reference.validatedWindows : hasLegacy ? reference.windows : undefined;
  if (raw === undefined) return { count: null, bars: null, valid: null };
  if (!Array.isArray(raw)) return { count: null, bars: null, valid: false };

  const ids = new Set<string>();
  const intervals: [number, number][] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.id !== "string") return { count: null, bars: null, valid: false };
    const id = entry.id.trim();
    if (!id || /[\u0000-\u001f\u007f]/.test(id) || ids.has(id)
      || !validBounds(entry.reference) || !validBounds(entry.candidate)) {
      return { count: null, bars: null, valid: false };
    }
    ids.add(id);
    intervals.push(entry.reference);
  }
  return { count: raw.length, bars: unionReferenceBars(intervals), valid: true };
}

/**
 * Read the amount of reference material covered by valid evidence.  Direct
 * legacy bar metadata remains useful for diagnostics, but malformed window
 * arrays never fall back to that metadata for the strict gate.
 */
function referenceBarsFor(reference: JsonObject): number | null {
  const windows = auditReferenceWindows(reference);
  if (windows.valid === true) return windows.bars;
  const direct = [
    reference.validatedReferenceBars,
    reference.referenceBars,
    nested(reference, "alignment", "coverage", "referenceBars"),
    nested(reference, "coverage", "referenceBars"),
    reference.bars,
  ].map(numberOrNull).find((value): value is number => value !== null && value >= 0);
  return direct ?? null;
}

function alignmentSection(value: JsonObject | null): ShadowMissionReport["alignment"] {
  if (!value) return unavailableAlignment();
  const initialFailures = [
    ...safeDiagnosticList(value.failures),
    ...safeDiagnosticList(value.diagnostics),
    ...safeDiagnosticList(nested(value, "gate", "failures")),
  ];
  const explicitStatus = [textOrNull(value.status), textOrNull(nested(value, "gate", "status"))]
    .find((status): status is string => Boolean(status && /^(?:blocked|fail(?:ed)?|failure|unavailable)$/i.test(status)));
  if (explicitStatus) return unavailableAlignment([...initialFailures, `alignment report status: ${explicitStatus}`]);
  const hasEvidence = Array.isArray(value.cases) || isObject(value.reference) || isObject(value.gate);
  if (!hasEvidence) return unavailableAlignment(initialFailures);
  const rawCases = Array.isArray(value.cases) ? value.cases : [];
  const rows = rawCases.map((raw, index) => {
    const item = record(raw);
    return {
      id: normalizedId(item.caseId ?? item.id, `case-${index + 1}`),
      corruptionType: textOrNull(item.corruptionType),
      status: textOrNull(item.status),
      recovered: booleanOrNull(item.recovered),
      falseAlignment: booleanOrNull(item.falseAlignment),
      coverageBars: finiteCount(nested(item, "coverage", "coveredBars") ?? nested(item, "coverage", "referenceBars")),
      timingErrorBeatsP90: numberOrNull(nested(item, "timingErrorBeats", "p90")),
    } satisfies ShadowMissionAlignmentCase;
  }).sort((left, right) => compareText(left.id, right.id));
  const gate = record(value.gate);
  const reference = record(value.reference);
  const failures = [
    ...initialFailures,
    ...rows.filter((row) => row.falseAlignment === true || row.recovered === false).map((row) => `${row.id}: alignment not recovered`),
    ...rows.filter((row) => row.status !== null && /^(?:blocked|fail(?:ed)?|failure|unavailable)$/i.test(row.status)).map((row) => `${row.id}: alignment status ${row.status}`),
  ];
  return {
    status: "available",
    assessment: textOrNull(gate.assessment),
    reference: {
      bars: finiteCount(reference.bars), durationBeats: numberOrNull(reference.durationBeats),
      tempoBpm: numberOrNull(reference.tempoBpm), noteCount: finiteCount(reference.noteCount),
    },
    cases: {
      evaluated: finiteCount(gate.casesEvaluated) ?? (Array.isArray(value.cases) ? rows.length : null),
      recovered: rawCases.length ? rows.filter((row) => row.recovered === true).length : null,
      falseAligned: rawCases.length ? rows.filter((row) => row.falseAlignment === true).length : null,
      meetingWindowMinimum: finiteCount(gate.casesMeetingWindowMinimum),
      meetingBarMinimum: finiteCount(gate.casesMeetingBarMinimum),
      meetingBoth: finiteCount(gate.casesMeetingBoth),
      rows,
    },
    failures: [...new Set(failures)].sort(compareText),
  };
}

function retrievalSection(value: JsonObject | null, benchmark: JsonObject | null): ShadowMissionReport["sevenSong"] {
  const inventory = record(benchmark?.inventory);
  const hasBenchmarkInventory = benchmark !== null;
  const requiredAudit = hasBenchmarkInventory ? auditIdList(inventory.requiredIds) : { ids: null, valid: null } satisfies IdListAudit;
  const presentAudit = hasBenchmarkInventory ? auditIdList(inventory.presentIds) : { ids: null, valid: null } satisfies IdListAudit;
  const missingAudit = hasBenchmarkInventory ? auditIdList(inventory.missingIds) : { ids: null, valid: null } satisfies IdListAudit;
  const requiredIds = requiredAudit.valid !== false && requiredAudit.ids !== null ? requiredAudit.ids
    : !benchmark && value && Array.isArray(value.songs) ? value.songs.map((song) => normalizedId(record(song).id, "unknown-song")).sort(compareText) : null;
  const presentIds = presentAudit.valid !== false && presentAudit.ids !== null ? presentAudit.ids
    : benchmark ? null : value && Array.isArray(value.songs) ? value.songs.map((song) => normalizedId(record(song).id, "unknown-song")).sort(compareText) : null;
  const missingIds = missingAudit.valid === true && missingAudit.ids !== null ? missingAudit.ids
    : requiredIds && presentIds ? requiredIds.filter((id) => !presentIds.includes(id)) : null;
  const inventoryValid = benchmark === null ? null
    : isObject(benchmark.inventory)
      && requiredAudit.valid === true
      && presentAudit.valid === true
      && (missingAudit.valid === true || missingAudit.valid === null);
  if (!value && !benchmark) return { status: "unavailable", requiredIds: null, presentIds: null, missingIds: null, inventoryValid: null, songs: [] };
  const songs = Array.isArray(value?.songs) ? value!.songs.map((raw, index) => {
    const item = record(raw);
    const sources = Array.isArray(item.sources) ? item.sources.map(record) : [];
    const statuses = stringList(item.statuses);
    return {
      id: normalizedId(item.id, `song-${index + 1}`), title: textOrNull(item.title), artist: textOrNull(item.artist), statuses,
      sourceCount: Array.isArray(item.sources) ? sources.length : null,
      accessibleSourceCount: sources.length ? sources.filter((source) => /ACCESSIBLE_SYMBOLIC|USER_EVIDENCE_AVAILABLE/i.test(textOrNull(source.status) ?? "")).length : null,
      metadataOnly: sources.length ? sources.every((source) => source.metadataOnly === true || /METADATA_ONLY/i.test(textOrNull(source.status) ?? "")) : null,
    } satisfies ShadowMissionSongSummary;
  }).sort((left, right) => compareText(left.id, right.id)) : [];
  return { status: "available", requiredIds, presentIds, missingIds, inventoryValid, songs };
}

function freezeSummary(songId: string, value: unknown): ShadowMissionFreezeSummary | null {
  if (!isObject(value)) return null;
  return {
    songId,
    completed: booleanOrNull(value.completed),
    beforeReference: booleanOrNull(value.beforeReference),
    selectedRecordIds: orderedStringList(value.selectedRecordIds),
    digest: textOrNull(value.digest),
  };
}

function benchmarkSection(value: JsonObject | null): ShadowMissionReport["benchmark"] {
  if (!value) return {
    status: "unavailable", songIdsValid: null, candidateCounts: { discovered: null, acquired: null, usable: null }, candidateFreezeOrder: [], songs: [],
    realSongSymbolicOutputs: null, humanReadyCount: null, failures: [],
  };
  const counts = record(value.candidateCounts);
  const hasEvidence = Array.isArray(value.songs) || isObject(value.inventory) || isObject(value.summary) || isObject(value.candidateCounts);
  if (!hasEvidence) return {
    status: "unavailable", songIdsValid: null, candidateCounts: { discovered: null, acquired: null, usable: null }, candidateFreezeOrder: [], songs: [],
    realSongSymbolicOutputs: null, humanReadyCount: null, failures: [],
  };
  const rawSongs = Array.isArray(value.songs) ? value.songs : [];
  const songIdSet = new Set<string>();
  const songIdsValid = Array.isArray(value.songs)
    && rawSongs.length === Object.keys(rawSongs).length
    && rawSongs.every((raw) => {
      const id = record(raw).id;
      if (typeof id !== "string") return false;
      const normalized = id.trim();
      if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized) || songIdSet.has(normalized)) return false;
      songIdSet.add(normalized);
      return true;
    });
  const songSummaries = Array.from(rawSongs, (raw, index) => {
    const item = record(raw);
    const id = normalizedId(item.id, `song-${index + 1}`);
    const freeze = freezeSummary(id, item.freeze);
    const reference = record(item.reference);
    const output = record(item.output);
    const readiness = record(item.readiness ?? item.humanReadiness);
    const windowAudit = auditReferenceWindows(reference);
    return {
      id,
      present: booleanOrNull(item.present),
      generationStatus: textOrNull(item.generationStatus ?? nested(item, "generation", "status")),
      outputAvailability: textOrNull(item.outputAvailability ?? nested(item, "output", "availability")),
      structuralGate: textOrNull(nested(item, "output", "structuralGate")),
      referenceAlignment: textOrNull(nested(reference, "alignment", "status")),
      validatedReferenceWindows: windowAudit.valid === false ? null : windowAudit.count ?? evidenceCount(reference.validatedWindows),
      validatedReferenceBars: windowAudit.valid === false ? null : referenceBarsFor(reference),
      referenceWindowsValid: windowAudit.valid,
      humanReady: booleanOrNull(item.humanReady) ?? (readiness.status === "ready" ? true : readiness.status ? false : null),
      freeze,
      failures: [
        ...safeDiagnosticList(item.failures),
        ...(windowAudit.valid === false ? ["validated reference windows malformed"] : []),
      ],
    } satisfies ShadowMissionBenchmarkSong;
  });
  const songs = [...songSummaries].sort((left, right) => compareText(left.id, right.id));
  // Keep the authored freeze sequence as evidence; sorted summaries above
  // are only for deterministic presentation.  A caller can provide an
  // explicit sequence when its songs array is presentation-sorted already.
  const freezeOrder = (Array.isArray(value.candidateFreezeOrder)
    ? value.candidateFreezeOrder.map((raw, index) => {
      const item = record(raw);
      const id = normalizedId(item.songId ?? item.id, `song-${index + 1}`);
      return freezeSummary(id, isObject(item.freeze) ? item.freeze : item);
    })
    : songSummaries.map((song) => song.freeze))
    .filter((freeze): freeze is ShadowMissionFreezeSummary => Boolean(freeze));
  const summary = record(value.summary);
  const realSongSymbolicOutputs = songs.length ? songs.filter((song) => song.present === true && song.generationStatus === "symbolic" && song.outputAvailability === "available").length : null;
  return {
    status: "available",
    songIdsValid,
    candidateCounts: { discovered: finiteCount(counts.discovered), acquired: finiteCount(counts.acquired), usable: finiteCount(counts.usable) },
    candidateFreezeOrder: freezeOrder,
    songs,
    realSongSymbolicOutputs,
    humanReadyCount: finiteCount(summary.humanReady) ?? (songs.length ? songs.filter((song) => song.humanReady === true).length : null),
    failures: [...new Set([
      ...safeDiagnosticList(value.failures),
      ...(songIdsValid === false ? ["benchmark song IDs malformed or duplicated"] : []),
      ...songs.flatMap((song) => song.failures.map((failure) => `${song.id}: ${failure}`)),
    ])].sort(compareText),
  };
}

function firstLoss(value: JsonObject | null): ShadowMissionFirstLoss | null {
  if (!value) return null;
  const transitions = Array.isArray(value.transitions) ? value.transitions : [];
  const order = ["raw->decoder", "decoder->semantic", "semantic->canonical", "canonical->easy"];
  const sorted = [...transitions].sort((left, right) => {
    const a = record(left); const b = record(right);
    const aKey = `${textOrNull(a.from) ?? "unknown"}->${textOrNull(a.to) ?? "unknown"}`;
    const bKey = `${textOrNull(b.from) ?? "unknown"}->${textOrNull(b.to) ?? "unknown"}`;
    return (order.indexOf(aKey) + 99) - (order.indexOf(bKey) + 99)
      || compareText(aKey, bKey)
      || compareText(canonicalShadowMissionJson(a), canonicalShadowMissionJson(b));
  });
  for (const raw of sorted) {
    const transition = record(raw);
    const from = textOrNull(transition.from) ?? "unknown";
    const to = textOrNull(transition.to) ?? "unknown";
    const loss = record(transition.loss);
    const rejected = finiteCount(loss.rejected);
    const replaced = finiteCount(loss.replaced);
    const obscured = finiteCount(loss.obscured);
    const unmatched = finiteCount(loss.unmatchedSourceCount);
    const additions = finiteCount(loss.additions);
    const unsupported = finiteCount(loss.unsupportedCanonicalExpansions);
    // `unmatchedSourceCount` often includes notes already classified as
    // rejected/replaced/obscured; report the loss once rather than double
    // counting the same source events.
    const directLossParts = [rejected, replaced, obscured];
    const directLoss = directLossParts.every((part) => part !== null)
      ? directLossParts.reduce((sum, part) => sum + (part ?? 0), 0)
      : null;
    let count = unmatched !== null ? Math.max(directLoss ?? 0, unmatched) : directLoss;
    let category: ShadowMissionFirstLoss["category"];
    if (from === "raw" && to === "decoder") category = "DECODER_REJECTION";
    else if (from === "decoder" && to === "semantic") category = "SEMANTIC_CONVERSION_LOSS";
    else if (from === "semantic" && to === "canonical" && (additions === null || unsupported === null ? (additions ?? 0) + (unsupported ?? 0) > 0 : additions + unsupported > 0)) {
      category = "CANONICAL_NOISE_EXPANSION";
      count = additions !== null && unsupported !== null ? additions + unsupported : null;
    } else if (from === "canonical" && to === "easy") category = "DIFFICULTY_REDUCTION";
    else category = "SEMANTIC_CONVERSION_LOSS";
    if (count === null || count <= 0) {
      if (count === null) return { transition: `${from}->${to}`, category, count: null, diagnostics: safeDiagnosticList(transition.diagnostics) };
      continue;
    }
    return { transition: `${from}->${to}`, category, count, diagnostics: safeDiagnosticList(transition.diagnostics) };
  }
  const stages = record(value.stages);
  const raw = record(stages.raw);
  if (textOrNull(raw.status) === "missing" || textOrNull(raw.status) === "invalid") {
    return { transition: "raw", category: "RAW_EVIDENCE_MISSING", count: finiteCount(raw.invalidNoteCount), diagnostics: safeDiagnosticList(raw.diagnostics) };
  }
  return null;
}

function redBaronSection(value: JsonObject | null): ShadowMissionReport["redBaron"] {
  if (!value) return { status: "unavailable", firstLoss: null, stages: [], failures: [] };
  const rawStages = record(value.stages);
  const stages = ["raw", "decoder", "semantic", "canonical", "easy"].map((stage) => {
    const item = record(rawStages[stage]);
    return {
      stage, status: textOrNull(item.status), noteCount: finiteCount(item.noteCount), rejectedNoteCount: finiteCount(item.rejectedNoteCount),
      invalidNoteCount: finiteCount(item.invalidNoteCount), failures: [...safeDiagnosticList(item.rejectionReasons), ...safeDiagnosticList(item.diagnostics)],
    } satisfies ShadowMissionStageSummary;
  });
  return {
    status: textOrNull(value.status) === "ready" ? "available" : textOrNull(value.status) === "partial" ? "partial" : "blocked",
    firstLoss: firstLoss(value), stages,
    failures: [...new Set([...safeDiagnosticList(value.diagnostics), ...stages.flatMap((stage) => stage.failures.map((failure) => `${stage.stage}: ${failure}`))])].sort(compareText),
  };
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return rightIds.size === right.length && left.every((id) => rightIds.has(id));
}

function hasStrictBenchmarkReadiness(benchmark: ShadowMissionReport["benchmark"], inventory: ShadowMissionReport["sevenSong"]): boolean {
  if (benchmark.status !== "available" || benchmark.songs.length === 0) return false;
  // A strict benchmark report is only meaningful when the seven-song
  // inventory itself is present, well-formed, and complete.  Comparing the
  // sets prevents a ready-looking replacement song from satisfying the gate.
  if (inventory.inventoryValid !== true
    || inventory.requiredIds === null
    || inventory.presentIds === null
    || inventory.missingIds === null
    || inventory.missingIds.length > 0
    || !sameIdSet(inventory.requiredIds, inventory.presentIds)
    || benchmark.songIdsValid !== true
    || benchmark.failures.length > 0) return false;
  const benchmarkIds = benchmark.songs.map((song) => song.id);
  if (!sameIdSet(benchmarkIds, inventory.requiredIds) || !sameIdSet(benchmarkIds, inventory.presentIds)) return false;
  return benchmark.songs.every((song) => song.present === true
    && song.generationStatus === "symbolic"
    && song.outputAvailability === "available"
    && song.structuralGate === "pass"
    && song.referenceAlignment === "aligned"
    && song.referenceWindowsValid === true
    && song.validatedReferenceWindows !== null
    && song.validatedReferenceWindows >= 3
    && song.validatedReferenceBars !== null
    && song.validatedReferenceBars >= 32
    && song.freeze?.completed === true
    && song.freeze.beforeReference === true
    && song.humanReady === true);
}

function readinessFor(shadow: ShadowMissionReport["shadow"], benchmark: ShadowMissionReport["benchmark"], inventory: ShadowMissionReport["sevenSong"]): ShadowMissionReport["readiness"] {
  const shadowReady = shadow.status === "available"
    && shadow.itemCount !== null
    && shadow.itemCount > 0
    && shadow.itemCount === shadow.items.length
    && shadow.blockedCount === 0
    && shadow.notReadyCount === 0
    && shadow.items.every((item) => item.status === "SHADOW_ENGINEERING_READY" && item.failures.length === 0 && item.variantValid !== false);
  const benchmarkReady = hasStrictBenchmarkReadiness(benchmark, inventory);
  return {
    shadowEngineering: shadow.itemCount === null ? "UNAVAILABLE" : shadowReady ? "SHADOW_ENGINEERING_READY" : "BLOCKED",
    benchmarkHumanListening: benchmark.status === "unavailable" ? "UNAVAILABLE" : benchmarkReady ? "BENCHMARK_READY_FOR_HUMAN_LISTENING" : "BLOCKED",
    // This command never deploys and cannot attest to production state.
    production: "BLOCKED",
    highest: benchmarkReady ? "BENCHMARK_READY_FOR_HUMAN_LISTENING" : shadowReady ? "SHADOW_ENGINEERING_READY" : null,
  };
}

function safetySection(input: ShadowMissionReportInput, benchmark: ShadowMissionReport["benchmark"]): ShadowMissionReport["safety"] {
  const supplied = record(input.safety);
  const hasEvidence = isObject(input.safety);
  const noMedia = hasEvidence ? booleanOrNull(supplied.noMedia) : null;
  const noProtectedPaths = hasEvidence ? booleanOrNull(supplied.noProtectedPaths) : null;
  const freezeValues = benchmark.candidateFreezeOrder.map((item) => item.beforeReference);
  const candidateFreezeBeforeReference = freezeValues.length === 0 ? null
    : freezeValues.some((value) => value === false) ? false
      : freezeValues.every((value) => value === true) ? true : null;
  const actions = [
    "keep shadow and benchmark media outside the repository and out of generated reports",
    "do not use benchmark/reference evidence for candidate discovery or generation",
    "do not treat shadow engineering readiness as recognizability or production readiness",
    "require independent alignment, structural checks, and at least two human raters before listening acceptance",
    "no production replay, upload, deploy, or catalog mutation is performed by this command",
  ];
  if (candidateFreezeBeforeReference !== true) actions.push("freeze the generation candidate set before opening any benchmark reference");
  if (noMedia === null) actions.push("provide explicit evidence that media payloads are excluded before sharing this report");
  else if (!noMedia) actions.push("remove media payloads before sharing this report");
  if (noProtectedPaths === null) actions.push("provide explicit evidence that protected paths are redacted before sharing this report");
  else if (!noProtectedPaths) actions.push("redact protected paths before sharing this report");
  return { actions: [...new Set(actions)].sort(compareText), noMedia, noProtectedPaths, candidateFreezeBeforeReference };
}

/**
 * Aggregate already-produced JSON diagnostics.  Unknown or malformed report
 * fragments become unavailable/null instead of being interpreted as success.
 */
export function aggregateShadowMissionReport(input: ShadowMissionReportInput): ShadowMissionReport {
  const disk = diskProvenance(firstRecord(input, "disk", "diskReport"));
  const corpus = corpusProvenance(firstRecord(input, "corpus", "corpusReport"));
  const shadow = shadowSection(firstRecord(input, "shadow", "shadowReport"));
  const alignment = alignmentSection(firstRecord(input, "alignment", "alignmentReport"));
  const benchmarkInput = firstRecord(input, "benchmark", "benchmarkReport");
  const sevenSong = retrievalSection(firstRecord(input, "retrieval", "retrievalReport"), benchmarkInput);
  const benchmark = benchmarkSection(benchmarkInput);
  const redBaron = redBaronSection(firstRecord(input, "redBaron", "redBaronReport"));
  const safety = safetySection(input, benchmark);
  const readiness = readinessFor(shadow, benchmark, sevenSong);
  const failures = [
    ...shadow.failures,
    ...alignment.failures,
    ...benchmark.failures,
    ...redBaron.failures,
    ...(disk.status === "below-threshold" ? [`disk free space is below ${disk.thresholdGiB} GiB`] : []),
    ...(sevenSong.missingIds?.map((id) => `benchmark inventory missing: ${id}`) ?? []),
    ...(sevenSong.inventoryValid === false ? ["benchmark inventory IDs malformed or duplicated"] : []),
  ];
  const diagnostics = [
    ...(alignment.assessment ? [`alignment calibration assessment: ${alignment.assessment}`] : []),
    ...(alignment.status === "unavailable" ? ["alignment evidence unavailable; reference readiness is not inferred"] : []),
    ...(benchmark.realSongSymbolicOutputs === null ? ["real-song symbolic output count unavailable"] : [`real-song symbolic outputs: ${benchmark.realSongSymbolicOutputs}`]),
    "automated evidence is diagnostic; human recognizability and playability remain unassessed",
  ];
  const withoutDeterminism = {
    schemaVersion: SHADOW_MISSION_REPORT_SCHEMA_VERSION,
    kind: SHADOW_MISSION_REPORT_KIND,
    provenance: { disk, corpus, safety: { ...safety, source: isObject(input.safety) ? "explicit-report" as const : "derived" as const } },
    shadow, alignment, sevenSong, benchmark, redBaron, readiness, safety,
    failures: [...new Set(failures)].sort(compareText),
    diagnostics: [...new Set(diagnostics)].sort(compareText),
  };
  return {
    ...withoutDeterminism,
    determinism: { canonicalSha256: sha256(canonicalShadowMissionJson(withoutDeterminism)) },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redactText(value: string): string {
  const urls: string[] = [];
  let result = value.replace(/https?:\/\/[^\s"'<>;,)}\]]+/gi, (url) => {
    const marker = `__SHADOW_URL_${urls.length}__`;
    // URLs in diagnostics are logical evidence only.  Preserve the stable
    // origin/path and credential marker, but never carry signed query
    // parameters, fragments, or user secrets into a report/hash.
    urls.push(url
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/i, "$1[redacted-credentials]@")
      .replace(/[?#].*$/, ""));
    return marker;
  });
  result = result
    .replace(/file:\/\/[^\s"'<>;,)}\]]+/gi, "[redacted-path]")
    .replace(/(?:[A-Za-z]:[\\/]|~[\\/]|\\\\|(?<![A-Za-z0-9:/])\/(?:[^\s"'<>;,)}\]]+\/)+)[^\s"'<>;,)}\]]*/g, "[redacted-path]")
    .replace(/(?<![A-Za-z0-9._:/-])(?:\.{0,2}[\\/]|[A-Za-z0-9._-]+[\\/])[^\s"'<>;,)}\]]+/g, (match) => /\.(?:mid|midi|wav|mp3|json|musicxml|mxl)$/i.test(match) ? "[redacted-path]" : match);
  return result.replace(/__SHADOW_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? "[redacted-url]");
}

function stableValue(value: unknown, key = ""): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (!isObject(value)) return value;
  const output: JsonObject = {};
  for (const childKey of Object.keys(value).sort(compareText)) {
    if (value[childKey] === undefined) continue;
    if (/(?:^|_)(?:notes?|events?|payload|bytes?|media|audio|midi|musicxml|raw(?:Notes|Events)?|sourceNotes|targetNotes|data|buffer|blob|base64|content)(?:$|_)/i.test(childKey)) continue;
    if (/(?:^|_)(?:path|file|filename|locator)(?:$|_)/i.test(childKey)) continue;
    output[childKey] = stableValue(value[childKey], childKey);
  }
  return output;
}

/** Stable, path-redacted JSON suitable for hashing or review. */
export function canonicalShadowMissionJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

interface CliOptions {
  input?: string;
  reports: Partial<Record<keyof ShadowMissionReportInput, string>>;
  out?: string;
  help: boolean;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(): string {
  return [
    "Usage: report-shadow-mission.ts [--input FILE] [report options] [--out FILE]",
    "  --input FILE       JSON envelope with disk/corpus/shadow/alignment/retrieval/benchmark/redBaron reports",
    "  --shadow FILE      shadow corpus evaluation JSON",
    "  --alignment FILE   synthetic alignment calibration JSON",
    "  --retrieval FILE   seven-song evidence JSON",
    "  --benchmark FILE   external benchmark JSON",
    "  --red-baron FILE   stage-survival JSON",
    "  --disk FILE        disk/provenance JSON",
    "  --corpus FILE      corpus provenance JSON",
    "  --out FILE         write deterministic report; otherwise stdout",
  ].join("\n");
}

function nextArg(argv: string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function parseArgs(argv: string[]): CliOptions {
  const reports: CliOptions["reports"] = {};
  let input: string | undefined;
  let out: string | undefined;
  let help = false;
  const aliases: Record<string, keyof ShadowMissionReportInput> = {
    "--disk": "diskReport", "--corpus": "corpusReport", "--shadow": "shadowReport", "--alignment": "alignmentReport",
    "--retrieval": "retrievalReport", "--benchmark": "benchmarkReport", "--red-baron": "redBaronReport",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const equal = argument.indexOf("=");
    const option = equal >= 0 ? argument.slice(0, equal) : argument;
    const inline = equal >= 0 ? argument.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const [next, nextIndex] = nextArg(argv, index, option);
      index = nextIndex;
      return next;
    };
    if (option === "--help" || option === "-h") {
      help = true;
      continue;
    }
    if (option === "--input") input = value();
    else if (option === "--out") out = value();
    else if (aliases[option]) reports[aliases[option]] = value();
    else throw new Error(`unknown option: ${argument}\n${usage()}`);
  }
  if (!help) {
    if (input && Object.keys(reports).length) throw new Error("--input cannot be combined with report-specific options");
    if (!input && !Object.keys(reports).length) throw new Error("provide --input or at least one report file\n" + usage());
  }
  return { input, reports, out, help };
}

function rejectRepositoryPath(path: string, label: string): void {
  const repoRelative = relative(REPO_ROOT, path);
  if (repoRelative === "" || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))) {
    throw new Error(`${label} must be outside the repository`);
  }
}

async function regularFile(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute local path`);
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} is not a regular file`);
  rejectRepositoryPath(resolved, label);
  return resolved;
}

async function readJson(path: string, label: string): Promise<JsonObject> {
  const resolved = await regularFile(path, label);
  const parsed: unknown = JSON.parse(await readFile(resolved, "utf8"));
  if (!isObject(parsed)) throw new Error(`${label} must contain a JSON object`);
  return parsed;
}

async function outputPath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("--out must be an absolute local path");
  const resolved = resolve(path);
  rejectRepositoryPath(resolved, "shadow mission report");
  try {
    const existing = await realpath(resolved);
    rejectRepositoryPath(existing, "shadow mission report");
    if (!(await stat(existing)).isFile()) throw new Error("--out must name a regular file");
  } catch (error) {
    if (error instanceof Error && /must (?:be outside|name)/.test(error.message)) throw error;
    let parent = dirname(resolved);
    while (parent !== dirname(parent)) {
      try {
        rejectRepositoryPath(await realpath(parent), "shadow mission report");
        break;
      } catch (parentError) {
        if (parentError instanceof Error && parentError.message.includes("must be outside")) throw parentError;
        parent = dirname(parent);
      }
    }
  }
  return resolved;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message).replace(/[\0\r\n]+/g, " ").slice(0, 500);
}

export interface ShadowMissionCliIo {
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
}

/** Run the report CLI without terminating an embedding process. */
export async function runShadowMissionCli(argv: readonly string[], io: ShadowMissionCliIo = {}): Promise<number> {
  try {
    const options = parseArgs([...argv]);
    if (options.help) {
      (io.stdout ?? ((value: string) => process.stdout.write(value)))(`${usage()}\n`);
      return 0;
    }
    const input: ShadowMissionReportInput = {};
    if (options.input) Object.assign(input, await readJson(options.input, "shadow mission input"));
    for (const [key, path] of Object.entries(options.reports)) {
      if (!path) continue;
      const report = await readJson(path, `${key} report`);
      const canonicalKey = key.replace(/Report$/, "") as keyof ShadowMissionReportInput;
      input[canonicalKey] = report;
    }
    const report = aggregateShadowMissionReport(input);
    const output = `${canonicalShadowMissionJson(report)}\n`;
    if (options.out) await writeFile(await outputPath(options.out), output, "utf8");
    (io.stdout ?? ((value: string) => process.stdout.write(value)))(output);
    return 0;
  } catch (error) {
    const message = safeError(error);
    (io.stderr ?? ((value: string) => process.stderr.write(value)))(`${message}\n`);
    return 2;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  process.exitCode = await runShadowMissionCli(process.argv.slice(2));
}
