import { createHash } from "node:crypto";

/**
 * Pure, local-only helpers for building a score-reference benchmark.
 *
 * This module deliberately does not read files, invoke an OMR program, or
 * publish artifacts.  A CLI can run Audiveris/MuseScore around these helpers
 * and pass the resulting MusicXML and normalized notes here.  The source PDF
 * and all derived score artifacts therefore remain outside the repository by
 * construction.
 */

export const SCORE_BENCHMARK_SCHEMA_VERSION = 1 as const;
export const SCORE_BENCHMARK_ONSET_TOLERANCE_BEATS = 0.08;

export type ScoreValidationStatus = "PASS" | "PASS_WITH_WARNINGS" | "REVIEW_REQUIRED" | "FAILED";
export type ScoreManualReviewStatus = "not-reviewed" | "pending" | "approved" | "rejected";

const SCORE_VALIDATION_STATUSES: readonly ScoreValidationStatus[] = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "REVIEW_REQUIRED",
  "FAILED",
];
const SCORE_MANUAL_REVIEW_STATUSES: readonly ScoreManualReviewStatus[] = [
  "not-reviewed",
  "pending",
  "approved",
  "rejected",
];

export interface ScoreProvenance {
  sourcePdf: {
    sha256: string;
    bytes?: number;
    pages?: number;
    /** A logical filename only; never an absolute source path. */
    logicalName?: string;
  };
  omr: {
    backend: string;
    version: string;
  };
  conversionTimestamp: string;
  normalizationVersion: string;
  musicXml: { sha256: string; bytes?: number };
  midi: { sha256: string; bytes?: number };
  validationStatus: ScoreValidationStatus;
  manualReviewStatus: ScoreManualReviewStatus;
}

export interface ScoreProvenanceInput {
  sourcePdfSha256: string;
  sourcePdfBytes?: number;
  sourcePdfPages?: number;
  sourcePdfName?: string;
  /** Accepted only to derive a logical basename; it is never emitted. */
  sourcePdfPath?: string;
  omrBackend: string;
  omrVersion: string;
  conversionTimestamp: string;
  normalizationVersion: string;
  musicXmlSha256: string;
  musicXmlBytes?: number;
  midiSha256: string;
  midiBytes?: number;
  validationStatus: ScoreValidationStatus;
  manualReviewStatus?: ScoreManualReviewStatus;
}

export interface MusicXmlPartSummary {
  id: string;
  partName: string | null;
  measureCount: number;
  staffCount: number;
  voiceCount: number;
}

export interface MusicXmlMeasureValidation {
  partId: string;
  number: string;
  index: number;
  implicit: boolean;
  expectedDurationDivisions: number | null;
  voiceDurations: Record<string, number>;
  status: "ok" | "underfull" | "overfull" | "invalid";
  warnings: string[];
  errors: string[];
}

export interface MusicXmlTieDiagnostics {
  starts: number;
  stops: number;
  continues: number;
  orphanStops: number;
  danglingStarts: number;
}

export interface MusicXmlTupletDiagnostics {
  total: number;
  valid: number;
  malformed: number;
}

export interface MusicXmlClef {
  sign: string;
  line: number | null;
  number: number;
}

export interface MusicXmlKeySignature {
  fifths: number;
  mode: string | null;
}

export interface MusicXmlTimeSignature {
  beats: number;
  beatType: number;
}

export interface MusicXmlValidationReport {
  schemaVersion: typeof SCORE_BENCHMARK_SCHEMA_VERSION;
  valid: boolean;
  status: ScoreValidationStatus;
  errors: string[];
  warnings: string[];
  parts: MusicXmlPartSummary[];
  measureCount: number;
  staffCount: number;
  voiceCount: number;
  measures: MusicXmlMeasureValidation[];
  clefs: MusicXmlClef[];
  keySignatures: MusicXmlKeySignature[];
  timeSignatures: MusicXmlTimeSignature[];
  tempos: number[];
  ties: MusicXmlTieDiagnostics;
  tuplets: MusicXmlTupletDiagnostics;
}

/** Canonical normalized score note used by the local benchmark evaluator. */
export interface ScoreNote {
  pitch: number;
  onset: number;
  duration: number;
  velocity?: number;
  part?: string;
  staff?: number;
  voice?: string;
  measure?: number;
  source?: string;
}

export interface ScoreDensityPitchOptions {
  onsetToleranceBeats?: number;
  measureBeats?: number;
  timeSig?: [number, number];
  densityExplosionFactor?: number;
  densityMinimumNotes?: number;
  suspiciousJumpSemitones?: number;
}

export interface ScoreMeasureDensity {
  measure: number;
  noteCount: number;
  onsetCount: number;
  notesPerBeat: number;
  attacksPerBeat: number;
  pitchMin: number | null;
  pitchMax: number | null;
  pitchSpan: number | null;
  pitchClassCount: number;
  maxPolyphony: number;
}

export interface ScoreDensityAnomaly {
  measure: number;
  notesPerBeat: number;
  baselineNotesPerBeat: number | null;
  factor: number;
  reason: "density-explosion" | "polyphony-explosion";
}

export interface ScoreDensityPitchDiagnostics {
  noteCount: number;
  invalidNoteCount: number;
  onsetCount: number;
  durationBeats: number;
  notesPerBeat: number;
  attacksPerBeat: number;
  pitch: {
    min: number | null;
    max: number | null;
    span: number | null;
    pitchClassHistogram: number[];
  };
  maxPolyphony: number;
  suspiciousPitches: number;
  suspiciousPitchJumps: number;
  suspiciousPitchJumpDetails: Array<{ fromPitch: number; toPitch: number; onsetGap: number }>;
  densityAnomalies: ScoreDensityAnomaly[];
  measures: ScoreMeasureDensity[];
  config: {
    onsetToleranceBeats: number;
    measureBeats: number;
    densityExplosionFactor: number;
    suspiciousJumpSemitones: number;
  };
}

export interface ScoreConfidenceInput {
  structural: MusicXmlValidationReport;
  pitch?: Pick<ScoreDensityPitchDiagnostics, "suspiciousPitches" | "suspiciousPitchJumps">;
  density?: Pick<ScoreDensityPitchDiagnostics, "densityAnomalies">;
  manualReviewStatus?: ScoreManualReviewStatus;
  maxSuspiciousPitches?: number;
  maxSuspiciousPitchJumps?: number;
  maxDensityAnomalies?: number;
}

export interface ScoreConfidenceResult {
  status: ScoreValidationStatus;
  trustedReference: boolean;
  reasons: string[];
  warnings: string[];
}

export interface BenchmarkCorpusSong {
  id: string;
  artist: string;
  title: string;
  score: {
    sha256: string;
    bytes?: number;
    pages?: number;
    omrStatus: string;
  };
  references: {
    fullScore?: string;
    piano?: string;
    melody?: string;
    harmony?: string;
    rhythm?: string;
  };
  validation: {
    status: ScoreValidationStatus;
    warnings: string[];
  };
  roles?: Record<string, string>;
  provenance?: ScoreProvenance;
  recording?: {
    selector?: string;
    title?: string;
    durationSeconds?: number;
    versionAmbiguity?: string;
    confidence?: number;
  };
}

export interface BenchmarkCorpusManifest {
  schemaVersion: typeof SCORE_BENCHMARK_SCHEMA_VERSION;
  songs: BenchmarkCorpusSong[];
}

export interface BenchmarkCorpusValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const EPSILON = 1e-9;
const HASH_RE = /^[0-9a-f]{64}$/i;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sortedCodeUnit<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter((key) => object[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !HASH_RE.test(value.trim())) throw new Error(`${field} must be a 64-character SHA-256 hex string`);
  return value.trim().toLowerCase();
}

function normalizeValidationStatus(value: unknown, field: string): ScoreValidationStatus {
  if (!SCORE_VALIDATION_STATUSES.includes(value as ScoreValidationStatus)) {
    throw new Error(`${field} must be one of ${SCORE_VALIDATION_STATUSES.join(", ")}`);
  }
  return value as ScoreValidationStatus;
}

function normalizeManualReviewStatus(value: unknown, field: string): ScoreManualReviewStatus {
  if (!SCORE_MANUAL_REVIEW_STATUSES.includes(value as ScoreManualReviewStatus)) {
    throw new Error(`${field} must be one of ${SCORE_MANUAL_REVIEW_STATUSES.join(", ")}`);
  }
  return value as ScoreManualReviewStatus;
}

function normalizeByteCount(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!integer(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function logicalBasename(value: string): string {
  let normalized = value.trim().replaceAll("\\", "/");
  normalized = normalized.split(/[?#]/, 1)[0] ?? "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) {
    const authorityEnd = normalized.indexOf("/", normalized.indexOf("//") + 2);
    normalized = authorityEnd >= 0 ? normalized.slice(authorityEnd) : "";
  }
  const segments = normalized
    .split("/")
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== ".." && !/[\u0000-\u001f\u007f]/.test(segment));
  return segments.at(-1) ?? "score.pdf";
}

function canonicalTimestamp(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("conversionTimestamp must be a full UTC ISO-8601 timestamp");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("conversionTimestamp is invalid");
  const date = new Date(timestamp);
  if (date.toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    throw new Error("conversionTimestamp contains an invalid calendar date");
  }
  return date.toISOString();
}

function normalizeNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

/** Build deterministic, path-free provenance for one converted score. */
export function createScoreProvenance(input: ScoreProvenanceInput): ScoreProvenance {
  const logicalName = input.sourcePdfName?.trim() || (input.sourcePdfPath ? logicalBasename(input.sourcePdfPath) : undefined);
  return {
    sourcePdf: {
      sha256: normalizeHash(input.sourcePdfSha256, "sourcePdfSha256"),
      bytes: normalizeByteCount(input.sourcePdfBytes, "sourcePdfBytes"),
      pages: input.sourcePdfPages === undefined ? undefined : normalizeByteCount(input.sourcePdfPages, "sourcePdfPages"),
      logicalName: logicalName ? logicalBasename(logicalName) : undefined,
    },
    omr: {
      backend: normalizeNonEmpty(input.omrBackend, "omrBackend"),
      version: normalizeNonEmpty(input.omrVersion, "omrVersion"),
    },
    conversionTimestamp: canonicalTimestamp(input.conversionTimestamp),
    normalizationVersion: normalizeNonEmpty(input.normalizationVersion, "normalizationVersion"),
    musicXml: {
      sha256: normalizeHash(input.musicXmlSha256, "musicXmlSha256"),
      bytes: normalizeByteCount(input.musicXmlBytes, "musicXmlBytes"),
    },
    midi: {
      sha256: normalizeHash(input.midiSha256, "midiSha256"),
      bytes: normalizeByteCount(input.midiBytes, "midiBytes"),
    },
    validationStatus: normalizeValidationStatus(input.validationStatus, "validationStatus"),
    manualReviewStatus: normalizeManualReviewStatus(input.manualReviewStatus ?? "not-reviewed", "manualReviewStatus"),
  };
}

export function canonicalScoreProvenanceJson(provenance: ScoreProvenance): string {
  return stableJson(provenance);
}

interface XmlPart {
  id: string;
  body: string;
}

interface XmlMeasure {
  number: string;
  implicit: boolean;
  body: string;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlAttribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*[\"']([^\"']*)[\"']`, "i"))?.[1] ?? null;
}

function xmlText(body: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1]?.trim() ?? null;
}

function xmlBlocks(body: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`, "gi");
  return [...body.matchAll(regex)].map((match) => match[0]);
}

function xmlElements(body: string, name: "note" | "backup" | "forward"): string[] {
  const regex = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, "gi");
  return [...body.matchAll(regex)].map((match) => match[0]);
}

function parseNumber(value: string | null): number | null {
  if (value === null || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value: string | null): number | null {
  const parsed = parseNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseParts(xml: string): XmlPart[] {
  const regex = /<part\b(?![-\w])[^>]*>[\s\S]*?<\/part>/gi;
  return [...xml.matchAll(regex)].map((match) => {
    const full = match[0];
    const open = full.match(/^<part\b[^>]*>/i)?.[0] ?? "";
    return { id: xmlAttribute(open, "id") ?? "", body: full.replace(/^<part\b[^>]*>/i, "").replace(/<\/part>$/i, "") };
  });
}

function parseMeasures(body: string): XmlMeasure[] {
  const regex = /<measure\b(?![-\w])[^>]*>[\s\S]*?<\/measure>/gi;
  return [...body.matchAll(regex)].map((match) => {
    const full = match[0];
    const open = full.match(/^<measure\b[^>]*>/i)?.[0] ?? "";
    return {
      number: decodeXml(xmlAttribute(open, "number") ?? ""),
      implicit: /(?:^|\s)implicit\s*=\s*["']yes["']/i.test(open),
      body: full.replace(/^<measure\b[^>]*>/i, "").replace(/<\/measure>$/i, ""),
    };
  });
}

function parseMeasureAttributes(
  measureBody: string,
  state: { divisions: number; beats: number; beatType: number; hasTime: boolean },
  report: { clefs: MusicXmlClef[]; keys: MusicXmlKeySignature[]; times: MusicXmlTimeSignature[]; errors: string[]; warnings: string[] },
): void {
  for (const attributes of xmlBlocks(measureBody, "attributes")) {
    const divisionsText = xmlText(attributes, "divisions");
    if (divisionsText !== null) {
      const divisions = parsePositiveInteger(divisionsText);
      if (divisions === null) report.errors.push("invalid divisions value");
      else state.divisions = divisions;
    }
    for (const key of xmlBlocks(attributes, "key")) {
      const fifths = parseNumber(xmlText(key, "fifths"));
      const mode = xmlText(key, "mode");
      if (fifths === null || !Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
        report.errors.push("invalid key signature fifths");
      } else {
        if (mode !== null && !/^(?:major|minor|none)$/i.test(mode)) report.errors.push(`invalid key signature mode: ${mode}`);
        report.keys.push({ fifths, mode: mode ? mode.toLowerCase() : null });
      }
    }
    for (const time of xmlBlocks(attributes, "time")) {
      const beatsText = xmlText(time, "beats");
      const beatType = parsePositiveInteger(xmlText(time, "beat-type"));
      const beatTokens = beatsText?.split("+").map((token) => Number(token.trim())) ?? [];
      const beats = beatTokens.length && beatTokens.every((token) => Number.isFinite(token) && token > 0)
        ? beatTokens.reduce((sum, token) => sum + token, 0)
        : null;
      if (beats === null || beatType === null) report.errors.push("invalid time signature");
      else {
        state.beats = beats;
        state.beatType = beatType;
        state.hasTime = true;
        report.times.push({ beats, beatType });
      }
    }
    for (const clef of xmlBlocks(attributes, "clef")) {
      const sign = xmlText(clef, "sign")?.toUpperCase() ?? "";
      const line = parseNumber(xmlText(clef, "line"));
      const number = parsePositiveInteger(xmlAttribute(clef.match(/^<clef\b[^>]*>/i)?.[0] ?? "", "number")) ?? 1;
      const lineRequired = !/^(?:PERCUSSION|TAB|NONE)$/.test(sign);
      if (!sign || (lineRequired && (line === null || !Number.isInteger(line) || line < 1 || line > 5))) {
        report.errors.push("invalid clef");
      } else {
        report.clefs.push({ sign, line: line === null ? null : line, number });
      }
    }
  }
}

function notePitch(note: string): number | null {
  const step = xmlText(note, "step");
  const octave = parseNumber(xmlText(note, "octave"));
  const alter = parseNumber(xmlText(note, "alter")) ?? 0;
  if (!step || octave === null || !Number.isInteger(octave) || !Number.isInteger(alter)) return null;
  const pcs: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pc = pcs[step.toUpperCase()];
  if (pc === undefined) return null;
  return 12 * (octave + 1) + pc + alter;
}

function tieTypes(note: string): Set<string> {
  const types = new Set<string>();
  for (const match of note.matchAll(/<(?:tie|tied)\b[^>]*\btype\s*=\s*["']([^"']+)["'][^>]*\/?>(?:<\/tied>)?/gi)) {
    types.add(match[1]!.toLowerCase());
  }
  return types;
}

function tupletState(note: string): "none" | "valid" | "malformed" {
  const modifications = xmlBlocks(note, "time-modification");
  if (!modifications.length) return "none";
  if (modifications.length > 1) return "malformed";
  const actual = parsePositiveInteger(xmlText(modifications[0]!, "actual-notes"));
  const normal = parsePositiveInteger(xmlText(modifications[0]!, "normal-notes"));
  return actual !== null && normal !== null ? "valid" : "malformed";
}

function dedupeStructuralEvents(report: MusicXmlValidationReport): void {
  report.clefs = sortedCodeUnit(
    [...new Map(report.clefs.map((clef) => [`${clef.number}:${clef.sign}:${clef.line ?? ""}`, clef])).values()],
    (clef) => `${clef.number}:${clef.sign}:${clef.line ?? ""}`,
  );
  report.keySignatures = [...new Map(report.keySignatures.map((key) => [`${key.fifths}:${key.mode ?? ""}`, key])).values()];
  report.timeSignatures = [...new Map(report.timeSignatures.map((time) => [`${time.beats}:${time.beatType}`, time])).values()];
  report.tempos = [...new Set(report.tempos.map((tempo) => round(tempo, 6)))].sort((a, b) => a - b);
}

/**
 * Validate common score-partwise MusicXML structure.  This is intentionally a
 * conservative validator: it reports ambiguous or incomplete notation rather
 * than guessing a correction or deleting musical events.
 */
export function validateMusicXmlStructure(xml: string): MusicXmlValidationReport {
  const report: MusicXmlValidationReport = {
    schemaVersion: SCORE_BENCHMARK_SCHEMA_VERSION,
    valid: false,
    status: "FAILED",
    errors: [],
    warnings: [],
    parts: [],
    measureCount: 0,
    staffCount: 0,
    voiceCount: 0,
    measures: [],
    clefs: [],
    keySignatures: [],
    timeSignatures: [],
    tempos: [],
    ties: { starts: 0, stops: 0, continues: 0, orphanStops: 0, danglingStarts: 0 },
    tuplets: { total: 0, valid: 0, malformed: 0 },
  };
  if (typeof xml !== "string" || !xml.trim()) {
    report.errors.push("MusicXML input is empty");
    return report;
  }
  if (!/<score-partwise\b/i.test(xml)) report.errors.push("MusicXML root must be score-partwise");
  if (!/<\/score-partwise>\s*$/i.test(xml.trim())) report.errors.push("MusicXML score-partwise root is not closed");
  const partList = xml.match(/<part-list\b[^>]*>[\s\S]*?<\/part-list>/i)?.[0] ?? "";
  const partNames = new Map<string, string>();
  for (const scorePart of xmlBlocks(partList, "score-part")) {
    const open = scorePart.match(/^<score-part\b[^>]*>/i)?.[0] ?? "";
    const id = xmlAttribute(open, "id") ?? "";
    const name = xmlText(scorePart, "part-name");
    if (!id) report.errors.push("score-part is missing id");
    else if (partNames.has(id)) report.errors.push(`duplicate score-part id: ${id}`);
    else partNames.set(id, name ? decodeXml(name) : id);
  }
  const parts = parseParts(xml);
  if (!parts.length) report.errors.push("MusicXML contains no parts");
  const partIds = new Set<string>();
  const globalVoices = new Set<string>();
  const stateByPart = new Map<string, { divisions: number; beats: number; beatType: number; hasTime: boolean }>();
  for (const part of parts) {
    if (!part.id) report.errors.push("part is missing id");
    if (partIds.has(part.id)) report.errors.push(`duplicate part id: ${part.id}`);
    partIds.add(part.id);
    const measures = parseMeasures(part.body);
    const state = stateByPart.get(part.id) ?? { divisions: 1, beats: 4, beatType: 4, hasTime: false };
    stateByPart.set(part.id, state);
    const voices = new Set<string>();
    let previousMeasureNumber: number | null = null;
    const activeTies = new Set<string>();
    let maxStaff = 1;
    for (let index = 0; index < measures.length; index += 1) {
      const measure = measures[index]!;
      const parsedNumber = /^\d+$/.test(measure.number) ? Number(measure.number) : null;
      if (parsedNumber === null) report.warnings.push(`${part.id} measure ${index + 1} has no numeric measure number`);
      if (parsedNumber !== null && previousMeasureNumber !== null && parsedNumber !== previousMeasureNumber + 1) {
        report.warnings.push(`${part.id} measure-number discontinuity: ${previousMeasureNumber} to ${parsedNumber}`);
      }
      if (parsedNumber !== null) previousMeasureNumber = parsedNumber;
      const localErrors: string[] = [];
      const localWarnings: string[] = [];
      const metadata = { clefs: report.clefs, keys: report.keySignatures, times: report.timeSignatures, errors: localErrors, warnings: localWarnings };
      parseMeasureAttributes(measure.body, state, metadata);
      if (!state.hasTime && index === 0) localWarnings.push(`${part.id} measure ${measure.number || index + 1} has no time signature`);
      const expected = state.divisions * state.beats * (4 / state.beatType);
      const voiceDurations = new Map<string, number>();
      let cursor = 0;
      let lastStart = 0;
      const seenEvents = new Set<string>();
      for (const event of xmlElements(measure.body, "note")) {
        const durationValue = parseNumber(xmlText(event, "duration"));
        const isGrace = /<grace\b/i.test(event);
        if (!isGrace && (durationValue === null || durationValue <= 0)) localErrors.push(`${part.id} measure ${measure.number || index + 1} note has invalid duration`);
        const duration = durationValue !== null && durationValue > 0 ? durationValue : 0;
        const voice = decodeXml(xmlText(event, "voice") ?? "1");
        voices.add(voice);
        globalVoices.add(`${part.id}:${voice}`);
        const staff = parsePositiveInteger(xmlText(event, "staff"));
        if (staff !== null) maxStaff = Math.max(maxStaff, staff);
        const chord = /<chord\s*\/?\s*>/i.test(event);
        const start = chord ? lastStart : cursor;
        if (!chord) {
          cursor += duration;
          lastStart = start;
          voiceDurations.set(voice, (voiceDurations.get(voice) ?? 0) + duration);
        }
        const pitch = notePitch(event);
        if (pitch !== null) {
          const eventKey = `${voice}:${start}:${pitch}`;
          if (seenEvents.has(eventKey) && !tieTypes(event).has("continue")) localWarnings.push(`${part.id} measure ${measure.number || index + 1} duplicated notehead ${eventKey}`);
          seenEvents.add(eventKey);
          if (pitch < 0 || pitch > 127) localErrors.push(`${part.id} measure ${measure.number || index + 1} pitch outside MIDI range`);
        }
        const types = tieTypes(event);
        const tieKey = `${voice}:${pitch ?? "rest"}`;
        if (types.has("stop") || types.has("continue")) {
          report.ties.stops += types.has("stop") ? 1 : 0;
          if (types.has("continue")) report.ties.continues += 1;
          if (!activeTies.has(tieKey)) {
            report.ties.orphanStops += 1;
            localErrors.push(`${part.id} measure ${measure.number || index + 1} orphan tie stop`);
          } else activeTies.delete(tieKey);
        }
        if (types.has("start") || types.has("continue")) {
          report.ties.starts += types.has("start") ? 1 : 0;
          activeTies.add(tieKey);
        }
        const tuplets = tupletState(event);
        if (tuplets !== "none") {
          report.tuplets.total += 1;
          if (tuplets === "valid") report.tuplets.valid += 1;
          else {
            report.tuplets.malformed += 1;
            localErrors.push(`${part.id} measure ${measure.number || index + 1} malformed tuplet`);
          }
        }
      }
      for (const event of xmlElements(measure.body, "forward")) {
        const duration = parseNumber(xmlText(event, "duration"));
        const voice = decodeXml(xmlText(event, "voice") ?? "1");
        if (duration === null || duration < 0) localErrors.push(`${part.id} measure ${measure.number || index + 1} forward has invalid duration`);
        else voiceDurations.set(voice, (voiceDurations.get(voice) ?? 0) + duration);
      }
      for (const event of xmlElements(measure.body, "backup")) {
        const duration = parseNumber(xmlText(event, "duration"));
        if (duration === null || duration < 0) localErrors.push(`${part.id} measure ${measure.number || index + 1} backup has invalid duration`);
        else cursor = Math.max(0, cursor - duration);
      }
      const durationObject: Record<string, number> = {};
      for (const [voice, duration] of voiceDurations) durationObject[voice] = round(duration, 6);
      let status: MusicXmlMeasureValidation["status"] = "ok";
      if (!voiceDurations.size && !/<multiple-rest\b/i.test(measure.body)) {
        localErrors.push(`${part.id} measure ${measure.number || index + 1} is empty`);
      }
      for (const [voice, duration] of voiceDurations) {
        if (duration > expected + EPSILON) {
          status = "overfull";
          localErrors.push(`${part.id} measure ${measure.number || index + 1} voice ${voice} overfull (${round(duration, 6)} > ${round(expected, 6)})`);
        } else if (duration < expected - EPSILON && !measure.implicit) {
          status = "underfull";
          localErrors.push(`${part.id} measure ${measure.number || index + 1} voice ${voice} underfull (${round(duration, 6)} < ${round(expected, 6)})`);
        }
      }
      if (localErrors.length) status = status === "ok" ? "invalid" : status;
      report.measures.push({
        partId: part.id,
        number: measure.number || String(index + 1),
        index,
        implicit: measure.implicit,
        expectedDurationDivisions: expected,
        voiceDurations: durationObject,
        status,
        warnings: localWarnings,
        errors: localErrors,
      });
      report.errors.push(...localErrors);
      report.warnings.push(...localWarnings);
    }
    for (const tie of activeTies) {
      void tie;
      report.ties.danglingStarts += 1;
      report.warnings.push(`${part.id} has a dangling tie start`);
    }
    report.parts.push({ id: part.id, partName: partNames.get(part.id) ?? null, measureCount: measures.length, staffCount: maxStaff, voiceCount: voices.size });
    report.measureCount = Math.max(report.measureCount, measures.length);
    report.staffCount = Math.max(report.staffCount, maxStaff);
  }
  report.voiceCount = globalVoices.size;
  if (!report.clefs.length) report.warnings.push("no clef declarations found");
  if (!report.keySignatures.length) report.warnings.push("no key signature declarations found");
  if (!report.timeSignatures.length) report.warnings.push("no time signature declarations found");
  const tempoMatches = [...xml.matchAll(/<per-minute\b[^>]*>([^<]+)<\/per-minute>/gi)];
  for (const match of tempoMatches) {
    const tempo = Number(match[1]!.trim());
    if (!Number.isFinite(tempo) || tempo <= 0) report.errors.push("invalid tempo marking");
    else report.tempos.push(tempo);
  }
  for (const match of xml.matchAll(/<sound\b[^>]*\btempo\s*=\s*["']([^"']+)["'][^>]*\/?>(?:<\/sound>)?/gi)) {
    const tempo = Number(match[1]!.trim());
    if (!Number.isFinite(tempo) || tempo <= 0) report.errors.push("invalid sound tempo");
    else report.tempos.push(tempo);
  }
  if (!report.tempos.length) report.warnings.push("no tempo marking found");
  dedupeStructuralEvents(report);
  report.valid = report.errors.length === 0;
  if (!report.valid) report.status = "FAILED";
  else if (report.warnings.length) {
    const reviewWarning = report.warnings.some((warning) => /(?:missing|no |underfull|discontinuity|dangling|duplicate)/i.test(warning));
    report.status = reviewWarning ? "REVIEW_REQUIRED" : "PASS_WITH_WARNINGS";
  } else report.status = "PASS";
  return report;
}

function validScoreNote(value: unknown): value is ScoreNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<ScoreNote>;
  return integer(note.pitch) && note.pitch >= 0 && note.pitch <= 127
    && finite(note.onset) && note.onset >= 0
    && finite(note.duration) && note.duration > 0
    && (note.velocity === undefined || (finite(note.velocity) && note.velocity >= 0 && note.velocity <= 127))
    && (note.part === undefined || typeof note.part === "string")
    && (note.staff === undefined || (integer(note.staff) && note.staff >= 1))
    && (note.voice === undefined || typeof note.voice === "string")
    && (note.measure === undefined || (integer(note.measure) && note.measure >= 1))
    && (note.source === undefined || typeof note.source === "string");
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left - right;
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function noteSort(a: ScoreNote, b: ScoreNote): number {
  const numeric = a.onset - b.onset
    || a.pitch - b.pitch
    || a.duration - b.duration
    || (a.velocity ?? 80) - (b.velocity ?? 80)
    || compareOptionalNumbers(a.staff, b.staff)
    || compareOptionalNumbers(a.measure, b.measure);
  if (numeric) return numeric;
  return compareOptionalStrings(a.part, b.part)
    || compareOptionalStrings(a.voice, b.voice)
    || compareOptionalStrings(a.source, b.source);
}

function onsetGroups(notes: readonly ScoreNote[], tolerance: number): ScoreNote[][] {
  const groups: ScoreNote[][] = [];
  for (const note of [...notes].sort(noteSort)) {
    const previous = groups.at(-1);
    if (previous && note.onset - previous[0]!.onset <= tolerance + EPSILON) previous.push(note);
    else groups.push([note]);
  }
  return groups;
}

function measureFor(note: ScoreNote, measureBeats: number): number {
  if (integer(note.measure) && note.measure! >= 1) return note.measure!;
  return Math.floor(note.onset / measureBeats + EPSILON) + 1;
}

/** Compute density, pitch-range, polyphony, and conservative OMR anomaly diagnostics. */
export function scoreDensityPitchDiagnostics(notes: readonly ScoreNote[], options: ScoreDensityPitchOptions = {}): ScoreDensityPitchDiagnostics {
  const onsetTolerance = finite(options.onsetToleranceBeats) && options.onsetToleranceBeats >= 0 ? options.onsetToleranceBeats : SCORE_BENCHMARK_ONSET_TOLERANCE_BEATS;
  const measureBeats = finite(options.measureBeats) && options.measureBeats > 0
    ? options.measureBeats
    : options.timeSig && finite(options.timeSig[0]) && finite(options.timeSig[1]) && options.timeSig[1] > 0
      ? options.timeSig[0] * 4 / options.timeSig[1]
      : 4;
  const densityExplosionFactor = finite(options.densityExplosionFactor) && options.densityExplosionFactor > 1 ? options.densityExplosionFactor : 4;
  const densityMinimumNotes = integer(options.densityMinimumNotes) && options.densityMinimumNotes > 0 ? options.densityMinimumNotes : 16;
  const suspiciousJumpSemitones = integer(options.suspiciousJumpSemitones) && options.suspiciousJumpSemitones > 0 ? options.suspiciousJumpSemitones : 24;
  const valid = notes.filter(validScoreNote).map((note) => ({ ...note }));
  const invalidNoteCount = notes.length - valid.length;
  const sorted = [...valid].sort(noteSort);
  const groups = onsetGroups(sorted, onsetTolerance);
  const durationBeats = sorted.reduce((max, note) => Math.max(max, note.onset + note.duration), 0);
  const pitchValues = sorted.map((note) => note.pitch);
  const pitchMin = pitchValues.length ? Math.min(...pitchValues) : null;
  const pitchMax = pitchValues.length ? Math.max(...pitchValues) : null;
  const histogram = Array.from({ length: 12 }, () => 0);
  for (const note of sorted) {
    const pitchClass = ((note.pitch % 12) + 12) % 12;
    histogram[pitchClass] = (histogram[pitchClass] ?? 0) + 1;
  }
  const representatives = groups.map((group) => group.slice().sort((a, b) => b.pitch - a.pitch || b.duration - a.duration)[0]!);
  const suspiciousPitchJumpDetails: ScoreDensityPitchDiagnostics["suspiciousPitchJumpDetails"] = [];
  for (let index = 1; index < representatives.length; index += 1) {
    const previous = representatives[index - 1]!;
    const current = representatives[index]!;
    const jump = Math.abs(current.pitch - previous.pitch);
    if (jump >= suspiciousJumpSemitones) suspiciousPitchJumpDetails.push({ fromPitch: previous.pitch, toPitch: current.pitch, onsetGap: round(current.onset - previous.onset, 3) });
  }
  const suspiciousPitches = sorted.filter((note, index) => {
    if (note.pitch > 108 || note.pitch < 19) {
      const neighboring = sorted[index - 1] ?? sorted[index + 1];
      return !neighboring || Math.abs(neighboring.pitch - note.pitch) >= 12;
    }
    return false;
  }).length;
  const measuresByNumber = new Map<number, ScoreNote[]>();
  for (const note of sorted) {
    const measure = measureFor(note, measureBeats);
    const list = measuresByNumber.get(measure) ?? [];
    list.push(note);
    measuresByNumber.set(measure, list);
  }
  const measures: ScoreMeasureDensity[] = [...measuresByNumber.entries()].sort((a, b) => a[0] - b[0]).map(([measure, measureNotes]) => {
    const measureGroups = onsetGroups(measureNotes, onsetTolerance);
    const measurePitches = measureNotes.map((note) => note.pitch);
    const min = Math.min(...measurePitches);
    const max = Math.max(...measurePitches);
    return {
      measure,
      noteCount: measureNotes.length,
      onsetCount: measureGroups.length,
      notesPerBeat: round(measureNotes.length / measureBeats),
      attacksPerBeat: round(measureGroups.length / measureBeats),
      pitchMin: min,
      pitchMax: max,
      pitchSpan: max - min,
      pitchClassCount: new Set(measurePitches.map((pitch) => ((pitch % 12) + 12) % 12)).size,
      maxPolyphony: Math.max(1, ...measureGroups.map((group) => group.length)),
    };
  });
  const densityAnomalies: ScoreDensityAnomaly[] = [];
  for (let index = 0; index < measures.length; index += 1) {
    const current = measures[index]!;
    const neighboring = [measures[index - 1], measures[index + 1]].filter((value): value is ScoreMeasureDensity => Boolean(value));
    const baseline = neighboring.length ? neighboring.reduce((sum, value) => sum + value.notesPerBeat, 0) / neighboring.length : null;
    if (current.noteCount >= densityMinimumNotes && baseline !== null && current.notesPerBeat > baseline * densityExplosionFactor) {
      densityAnomalies.push({ measure: current.measure, notesPerBeat: current.notesPerBeat, baselineNotesPerBeat: round(baseline), factor: densityExplosionFactor, reason: "density-explosion" });
    }
    const neighboringPolyphony = neighboring.length ? Math.max(...neighboring.map((value) => value.maxPolyphony)) : 0;
    if (current.maxPolyphony >= 8 && current.maxPolyphony > Math.max(4, neighboringPolyphony * 2)) {
      densityAnomalies.push({ measure: current.measure, notesPerBeat: current.notesPerBeat, baselineNotesPerBeat: baseline === null ? null : round(baseline), factor: densityExplosionFactor, reason: "polyphony-explosion" });
    }
  }
  return {
    noteCount: valid.length,
    invalidNoteCount,
    onsetCount: groups.length,
    durationBeats: round(durationBeats),
    notesPerBeat: durationBeats > EPSILON ? round(valid.length / durationBeats) : 0,
    attacksPerBeat: durationBeats > EPSILON ? round(groups.length / durationBeats) : 0,
    pitch: { min: pitchMin, max: pitchMax, span: pitchMin === null || pitchMax === null ? null : pitchMax - pitchMin, pitchClassHistogram: histogram },
    maxPolyphony: Math.max(0, ...groups.map((group) => group.length)),
    suspiciousPitches,
    suspiciousPitchJumps: suspiciousPitchJumpDetails.length,
    suspiciousPitchJumpDetails,
    densityAnomalies,
    measures,
    config: { onsetToleranceBeats: onsetTolerance, measureBeats, densityExplosionFactor, suspiciousJumpSemitones },
  };
}

/** Combine structural and symbolic diagnostics into a fail-closed confidence tier. */
export function assessScoreConfidence(input: ScoreConfidenceInput): ScoreConfidenceResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const maxSuspiciousPitches = integer(input.maxSuspiciousPitches) && input.maxSuspiciousPitches >= 0 ? input.maxSuspiciousPitches : 0;
  const maxSuspiciousPitchJumps = integer(input.maxSuspiciousPitchJumps) && input.maxSuspiciousPitchJumps >= 0 ? input.maxSuspiciousPitchJumps : 0;
  const maxDensityAnomalies = integer(input.maxDensityAnomalies) && input.maxDensityAnomalies >= 0 ? input.maxDensityAnomalies : 0;
  if (input.structural.status === "FAILED") reasons.push("MusicXML structural validation failed");
  else if (input.structural.status === "REVIEW_REQUIRED") reasons.push("MusicXML structural validation requires review");
  else if (input.structural.status === "PASS_WITH_WARNINGS") warnings.push(...input.structural.warnings);
  if (input.pitch && input.pitch.suspiciousPitches > maxSuspiciousPitches) reasons.push(`suspicious isolated pitches: ${input.pitch.suspiciousPitches}`);
  if (input.pitch && input.pitch.suspiciousPitchJumps > maxSuspiciousPitchJumps) reasons.push(`suspicious pitch jumps: ${input.pitch.suspiciousPitchJumps}`);
  if (input.density && input.density.densityAnomalies.length > maxDensityAnomalies) reasons.push(`density anomalies: ${input.density.densityAnomalies.length}`);
  if (input.manualReviewStatus === "rejected") reasons.push("manual notation review rejected this score");
  else if (input.manualReviewStatus === "pending" || input.manualReviewStatus === "not-reviewed") warnings.push("manual notation review is pending");
  let status: ScoreValidationStatus = "PASS";
  if (reasons.some((reason) => /failed|rejected/i.test(reason))) status = "FAILED";
  else if (reasons.length) status = "REVIEW_REQUIRED";
  else if (input.structural.status === "REVIEW_REQUIRED" || warnings.length) status = "PASS_WITH_WARNINGS";
  return { status, trustedReference: status === "PASS", reasons: uniqueSortedStrings(reasons), warnings: uniqueSortedStrings(warnings) };
}

function logicalCorpusPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  let normalized = value.trim().replaceAll("\\", "/");
  normalized = normalized.split(/[?#]/, 1)[0] ?? "";
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) {
    const authorityEnd = normalized.indexOf("/", normalized.indexOf("//") + 2);
    normalized = authorityEnd >= 0 ? normalized.slice(authorityEnd) : "";
  }
  if (/^\/?[a-z]:\//i.test(normalized) || normalized.startsWith("/")) return logicalBasename(normalized);
  const output: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }
  return output.join("/") || undefined;
}

function isSafeLogicalCorpusPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const trimmed = value.trim();
  if (trimmed !== value || /[\u0000-\u001f\u007f?#\\]/.test(value)) return false;
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value) || /^\/?[a-z]:\//i.test(value) || value.startsWith("/")) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWarnings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return uniqueSortedStrings(value);
}

function normalizeRoles(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("song.roles must be an object");
  const roles: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    if (!key.trim() || typeof value[key] !== "string" || !value[key].trim()) throw new Error("song.roles must map non-empty keys to non-empty strings");
    roles[key] = value[key].trim();
  }
  return roles;
}

function normalizeRecording(value: unknown): BenchmarkCorpusSong["recording"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("song.recording must be an object");
  const recording: NonNullable<BenchmarkCorpusSong["recording"]> = {};
  if (value.selector !== undefined) recording.selector = normalizeNonEmpty(value.selector, "song.recording.selector");
  if (value.title !== undefined) recording.title = normalizeNonEmpty(value.title, "song.recording.title");
  if (value.versionAmbiguity !== undefined) recording.versionAmbiguity = normalizeNonEmpty(value.versionAmbiguity, "song.recording.versionAmbiguity");
  if (value.durationSeconds !== undefined) {
    if (!finite(value.durationSeconds) || value.durationSeconds < 0) throw new Error("song.recording.durationSeconds must be a non-negative finite number");
    recording.durationSeconds = value.durationSeconds;
  }
  if (value.confidence !== undefined) {
    if (!finite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("song.recording.confidence must be between 0 and 1");
    recording.confidence = value.confidence;
  }
  return recording;
}

function normalizeScoreProvenance(value: unknown): ScoreProvenance {
  if (!isRecord(value) || !isRecord(value.sourcePdf) || !isRecord(value.omr) || !isRecord(value.musicXml) || !isRecord(value.midi)) {
    throw new Error("song.provenance is malformed");
  }
  return createScoreProvenance({
    sourcePdfSha256: value.sourcePdf.sha256 as string,
    sourcePdfBytes: value.sourcePdf.bytes as number | undefined,
    sourcePdfPages: value.sourcePdf.pages as number | undefined,
    sourcePdfName: value.sourcePdf.logicalName as string | undefined,
    omrBackend: value.omr.backend as string,
    omrVersion: value.omr.version as string,
    conversionTimestamp: value.conversionTimestamp as string,
    normalizationVersion: value.normalizationVersion as string,
    musicXmlSha256: value.musicXml.sha256 as string,
    musicXmlBytes: value.musicXml.bytes as number | undefined,
    midiSha256: value.midi.sha256 as string,
    midiBytes: value.midi.bytes as number | undefined,
    validationStatus: value.validationStatus as ScoreValidationStatus,
    manualReviewStatus: value.manualReviewStatus as ScoreManualReviewStatus | undefined,
  });
}

function normalizeCorpusSong(song: BenchmarkCorpusSong): BenchmarkCorpusSong {
  if (!isRecord(song) || !isRecord(song.score) || !isRecord(song.references) || !isRecord(song.validation)) {
    throw new Error("corpus song is malformed");
  }
  const references = {
    fullScore: logicalCorpusPath(song.references?.fullScore),
    piano: logicalCorpusPath(song.references?.piano),
    melody: logicalCorpusPath(song.references?.melody),
    harmony: logicalCorpusPath(song.references?.harmony),
    rhythm: logicalCorpusPath(song.references?.rhythm),
  };
  if (!Object.values(references).some((reference) => reference !== undefined)) {
    throw new Error("song.references must contain at least one usable path");
  }
  const normalized: BenchmarkCorpusSong = {
    id: normalizeNonEmpty(song.id, "song.id"),
    artist: normalizeNonEmpty(song.artist, "song.artist"),
    title: normalizeNonEmpty(song.title, "song.title"),
    score: {
      sha256: normalizeHash(song.score.sha256, "score.sha256"),
      bytes: normalizeByteCount(song.score.bytes, "score.bytes"),
      pages: normalizeByteCount(song.score.pages, "score.pages"),
      omrStatus: normalizeNonEmpty(song.score.omrStatus, "score.omrStatus"),
    },
    references,
    validation: {
      status: normalizeValidationStatus(song.validation.status, "song.validation.status"),
      warnings: normalizeWarnings(song.validation.warnings, "song.validation.warnings"),
    },
  };
  const roles = normalizeRoles(song.roles);
  if (roles) normalized.roles = roles;
  if (song.provenance !== undefined) normalized.provenance = normalizeScoreProvenance(song.provenance);
  const recording = normalizeRecording(song.recording);
  if (recording) normalized.recording = recording;
  return normalized;
}

/** Create a deterministic corpus manifest with local paths reduced to logical relative names. */
export function createBenchmarkCorpusManifest(input: { songs: readonly BenchmarkCorpusSong[] }): BenchmarkCorpusManifest {
  if (!input || !Array.isArray(input.songs)) throw new Error("corpus manifest songs must be an array");
  const songs = sortedCodeUnit(input.songs.map(normalizeCorpusSong), (song) => song.id);
  const ids = new Set<string>();
  for (const song of songs) {
    if (ids.has(song.id)) throw new Error(`duplicate corpus song id: ${song.id}`);
    ids.add(song.id);
  }
  return { schemaVersion: SCORE_BENCHMARK_SCHEMA_VERSION, songs };
}

function validateCorpusPath(value: unknown, field: string, errors: string[]): void {
  if (!isSafeLogicalCorpusPath(value)) errors.push(`${field} must be a safe relative corpus path`);
}

function validateCorpusSong(value: unknown, index: number, ids: Set<string>, errors: string[], warnings: string[]): void {
  const label = `song[${index}]`;
  if (!isRecord(value)) {
    errors.push("corpus manifest contains a malformed song");
    return;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) errors.push(`${label} id is missing`);
  else if (/[\u0000-\u001f\u007f]/.test(id)) errors.push(`${label} id contains control characters`);
  else if (ids.has(id)) errors.push(`duplicate corpus song id: ${id}`);
  else ids.add(id);
  if (typeof value.artist !== "string" || !value.artist.trim()) errors.push(`${label} artist is missing`);
  if (typeof value.title !== "string" || !value.title.trim()) errors.push(`${label} title is missing`);

  if (!isRecord(value.score)) errors.push(`${label} score is missing`);
  else {
    if (typeof value.score.sha256 !== "string" || !HASH_RE.test(value.score.sha256.trim())) errors.push(`invalid score.sha256 for ${id || label}`);
    for (const field of ["bytes", "pages"] as const) {
      const fieldValue = value.score[field];
      if (fieldValue !== undefined && (!integer(fieldValue) || fieldValue < 0)) errors.push(`invalid score.${field} for ${id || label}`);
    }
    if (typeof value.score.omrStatus !== "string" || !value.score.omrStatus.trim()) errors.push(`invalid score.omrStatus for ${id || label}`);
  }

  if (!isRecord(value.references)) errors.push(`${label} references are missing`);
  else {
    const referenceKeys = ["fullScore", "piano", "melody", "harmony", "rhythm"] as const;
    let referenceCount = 0;
    for (const key of referenceKeys) {
      if (value.references[key] !== undefined) {
        validateCorpusPath(value.references[key], `${id || label}.references.${key}`, errors);
        if (isSafeLogicalCorpusPath(value.references[key])) referenceCount += 1;
      }
    }
    if (referenceCount === 0) errors.push(`${id || label} must contain at least one reference path`);
  }

  if (!isRecord(value.validation)) {
    errors.push(`invalid validation status for ${id || label}`);
    errors.push(`invalid validation warnings for ${id || label}`);
  } else {
    if (!SCORE_VALIDATION_STATUSES.includes(value.validation.status as ScoreValidationStatus)) {
      errors.push(`invalid validation status for ${id || label}`);
    }
    if (!Array.isArray(value.validation.warnings) || !value.validation.warnings.every((entry) => typeof entry === "string")) {
      errors.push(`invalid validation warnings for ${id || label}`);
    }
    if (value.validation.status === "PASS_WITH_WARNINGS") warnings.push(`${id || label} has validation warnings`);
  }

  if (value.roles !== undefined) {
    try {
      normalizeRoles(value.roles);
    } catch (error) {
      errors.push(`${id || label} roles are malformed: ${error instanceof Error ? error.message : "invalid roles"}`);
    }
  }
  if (value.provenance !== undefined) {
    try {
      normalizeScoreProvenance(value.provenance);
    } catch (error) {
      errors.push(`${id || label} provenance is malformed: ${error instanceof Error ? error.message : "invalid provenance"}`);
    }
  }
  if (value.recording !== undefined) {
    try {
      normalizeRecording(value.recording);
    } catch (error) {
      errors.push(`${id || label} recording is malformed: ${error instanceof Error ? error.message : "invalid recording"}`);
    }
  }
}

export function validateBenchmarkCorpusManifest(manifest: unknown): BenchmarkCorpusValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!manifest || typeof manifest !== "object") return { valid: false, errors: ["corpus manifest must be an object"], warnings };
  const candidate = manifest as Partial<BenchmarkCorpusManifest>;
  if (candidate.schemaVersion !== SCORE_BENCHMARK_SCHEMA_VERSION) errors.push("unsupported corpus manifest schemaVersion");
  if (!Array.isArray(candidate.songs)) errors.push("corpus manifest songs must be an array");
  else {
    const ids = new Set<string>();
    for (const [index, song] of candidate.songs.entries()) validateCorpusSong(song, index, ids, errors, warnings);
  }
  return { valid: errors.length === 0, errors: uniqueSortedStrings(errors), warnings: uniqueSortedStrings(warnings) };
}

/** REVIEW_REQUIRED and FAILED entries are never eligible as regression references. */
export function eligibleCorpusSongs(manifest: BenchmarkCorpusManifest): BenchmarkCorpusSong[] {
  return manifest.songs.filter((song) => song.validation.status === "PASS" || song.validation.status === "PASS_WITH_WARNINGS");
}

export function canonicalBenchmarkCorpusJson(manifest: BenchmarkCorpusManifest): string {
  return stableJson(createBenchmarkCorpusManifest({ songs: manifest.songs }));
}

export function scoreCorpusManifestHash(manifest: BenchmarkCorpusManifest): string {
  return sha256Text(canonicalBenchmarkCorpusJson(manifest));
}
