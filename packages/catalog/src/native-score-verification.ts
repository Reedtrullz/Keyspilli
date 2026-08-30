import { readFile } from "node:fs/promises";
import type { NativeScoreArtifactInput, NativeScoreArtifactType, NativeScoreDiscoveryOptions, NativeScoreDiscoveryReport, NativeScoreEvidence } from "./native-score-discovery.js";
import { discoverNativeScoreArtifacts } from "./native-score-discovery.js";
import { sha256Hex } from "./fixture-evidence.js";
import { parseOmrMusicXmlBytes, type OmrMusicXmlParseResult } from "./omr-musicxml.js";
import { parseSymbolicCandidate, type NormalizedSymbolicScore, type SymbolicScoreInput } from "./symbolic-alignment.js";

export const NATIVE_SCORE_VERIFICATION_SCHEMA_VERSION = 1 as const;

export type NativeScoreVerificationClassification =
  | "EXACT_OR_HIGH_CONFIDENCE_MATCH"
  | "LIKELY_MATCH"
  | "WRONG_ARRANGEMENT"
  | "UNKNOWN";

/** Structural subset accepted from Task 1 without coupling this adapter to it. */
export interface PdfForensicsReportLike {
  schemaVersion?: number;
  status?: string;
  identity?: { bytes?: number | null; pages?: number | null; sha256?: string | null; logicalBasename?: string } | null;
  metadata?: { title?: string | null; author?: string | null; composerHints?: readonly string[]; subject?: string | null; keywords?: readonly string[]; [key: string]: unknown } | null;
  xmp?: { title?: string | null; creator?: string | null; [key: string]: unknown } | null;
  links?: readonly unknown[];
  evidence?: readonly unknown[];
  errors?: readonly unknown[];
}

/** Candidate metadata is intentionally the existing local-only discovery contract. */
export type NativeScoreVerificationCandidate = NativeScoreArtifactInput;

export interface NativeScoreVerificationOmrSummary {
  id?: string | null;
  title?: string | null;
  measureCount?: number | null;
  pageCount?: number | null;
  pages?: number | null;
  staffCount?: number | null;
  partCount?: number | null;
  tempoBpm?: number | null;
  keySignature?: number | null;
  keySig?: number | null;
  keyMode?: 0 | 1 | null;
  timeSignature?: [number, number] | null;
  timeSig?: [number, number] | null;
  durationBeats?: number | null;
  openingContour?: string | null;
  density?: number | null;
  confidence?: number | null;
  status?: string | null;
}

export interface NativeScoreSymbolicStructure {
  format: "midi" | "musicxml" | "mxl";
  measureCount: number | null;
  pageCount: number | null;
  staffCount: number | null;
  partCount: number | null;
  tempoBpm: number | null;
  keySignature: number | null;
  keyMode: 0 | 1 | null;
  timeSignature: [number, number] | null;
  durationBeats: number | null;
  noteCount: number | null;
  onsetCount: number | null;
  openingContour: "ascending" | "descending" | "mixed" | "repeated" | null;
  density: number | null;
  title: string | null;
}

export interface NativeScoreVerificationEvidence {
  signal: "title" | "measure-count" | "staff-count" | "part-count" | "tempo" | "key" | "time-signature" | "duration" | "opening-contour" | "density";
  outcome: "match" | "mismatch" | "unavailable";
  observed: string | number | null;
  expected: string | number | null;
}

export interface NativeScoreVerificationResult {
  schemaVersion: typeof NATIVE_SCORE_VERIFICATION_SCHEMA_VERSION;
  classification: NativeScoreVerificationClassification;
  eligibleAsReference: boolean;
  nativePriority: boolean;
  candidate: { id: string; artifactType: string; bytes: number | null; sha256: string | null; hashStatus: string; provenance: string | null; version: string | null } | null;
  pdf: { title: string | null; pages: number | null; bytes: number | null; sha256: string | null } | null;
  symbolic: NativeScoreSymbolicStructure | null;
  omr: NativeScoreVerificationOmrSummary | null;
  discovery: Pick<NativeScoreDiscoveryReport, "status" | "selectionReason" | "selected" | "rejected" | "errors">;
  evidence: NativeScoreVerificationEvidence[];
  reasons: string[];
  nonClaims: string[];
}

export interface NativeScoreVerificationOptions {
  discovery?: NativeScoreDiscoveryOptions;
}

export interface NativeScoreByteVerificationOptions {
  /** Explicit format for an in-memory local test/input seam. */
  artifactType?: NativeScoreArtifactType | string | null;
}

const SAFE_HASH = /^[a-f0-9]{64}$/i;
const PATHISH_TEXT = /(?:^|[\s"'(:])(?:file:|[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/]|\\)|(?:^|[\s"'(:])[^\s"']+\.(?:mid|midi|musicxml|xml|mxl|mscz|pdf|wav|mp3|flac|json)(?:$|[\s"'),:])/i;

function artifactType(value: NativeScoreArtifactInput, override?: unknown): "midi" | "musicxml" | "mxl" | "mscz" | null {
  const raw = String(override ?? value.artifactType ?? value.type ?? "").trim().toLowerCase();
  if (raw === "midi" || raw === "mid") return "midi";
  if (raw === "musicxml" || raw === "xml") return "musicxml";
  if (raw === "mxl") return "mxl";
  if (raw === "mscz") return "mscz";
  const path = typeof value.path === "string" ? value.path.toLowerCase() : "";
  if (path.endsWith(".mid") || path.endsWith(".midi")) return "midi";
  if (path.endsWith(".musicxml") || path.endsWith(".xml")) return "musicxml";
  if (path.endsWith(".mxl")) return "mxl";
  if (path.endsWith(".mscz")) return "mscz";
  return null;
}

function provenanceText(value: unknown): string | null {
  if (typeof value === "string") return safeMetadataText(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["provenance", "kind", "acquiredVia", "sourceRef"]) {
    const text = safeMetadataText(record[key]);
    if (text) return text;
  }
  return null;
}

function safeMetadataText(value: unknown): string | null {
  const text = cleanText(value);
  return text && !PATHISH_TEXT.test(text) ? text : null;
}

function trustedProvenance(value: string | null): boolean {
  return Boolean(value) && !/(?:unknown|untrusted|unauthorized|fan[- ]?made|pirated|leak|torrent|scrape|random)/i.test(value!);
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeId(value: unknown): string {
  const text = cleanText(value) ?? "native";
  if (PATHISH_TEXT.test(text)) return "native";
  const id = text.replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return id || "native";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return finite(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return text || null;
}

function titleText(value: unknown): string | null {
  const text = cleanText(value);
  if (!text || /[\\/]|(?:\b(?:file|https?):)/i.test(text)) return null;
  return text;
}

function titleKey(value: unknown): string | null {
  const text = titleText(value);
  if (!text) return null;
  return text.toLocaleLowerCase().replace(/\.(?:pdf|mid|midi|musicxml|xml|mxl)$/i, "").replace(/[^a-z0-9]+/g, " ").trim() || null;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function nativeScoreVerificationJson(report: NativeScoreVerificationResult): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

function pdfHints(report: PdfForensicsReportLike): { title: string | null; pages: number | null; bytes: number | null; sha256: string | null } {
  return {
    title: titleText(report.metadata?.title) ?? titleText(report.xmp?.title),
    pages: integer(report.identity?.pages),
    bytes: integer(report.identity?.bytes),
    sha256: typeof report.identity?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(report.identity.sha256) ? report.identity.sha256.toLowerCase() : null,
  };
}

function hasVerifiedPdfIdentity(report: PdfForensicsReportLike, pdf: ReturnType<typeof pdfHints>): boolean {
  return report.status === "ok"
    && pdf.title !== null
    && pdf.pages !== null
    && pdf.pages > 0
    && pdf.bytes !== null
    && pdf.bytes > 0
    && pdf.sha256 !== null;
}

function contour(notes: readonly { midi: number }[]): NativeScoreSymbolicStructure["openingContour"] {
  const sample = notes.slice(0, 8).map((note) => note.midi);
  if (sample.length < 2) return null;
  let up = 0;
  let down = 0;
  let same = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const delta = sample[index]! - sample[index - 1]!;
    if (delta > 0) up += 1;
    else if (delta < 0) down += 1;
    else same += 1;
  }
  if (same === sample.length - 1) return "repeated";
  if (up > 0 && down > 0) return "mixed";
  return up > down ? "ascending" : "descending";
}

function symbolicFromOmr(result: OmrMusicXmlParseResult): SymbolicScoreInput {
  const notes = result.score.parts.flatMap((part) => {
    return part.measures.flatMap((measure) => (measure.events ?? []).map((event) => ({
      midi: event.pitch,
      start: (measure.startBeat ?? 0) + event.onset,
      dur: event.duration,
      vel: 80,
    })));
  });
  const durationBeats = notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  return {
    notes,
    title: result.score.title,
    tempoBpm: result.score.tempoBpm,
    durationBeats,
    timeSig: result.score.timeSignature ?? undefined,
    keySig: result.score.keySignature ?? undefined,
  };
}

function structure(format: "midi" | "musicxml" | "mxl", parsed: NormalizedSymbolicScore, omr: OmrMusicXmlParseResult | null): NativeScoreSymbolicStructure {
  const score = omr?.score;
  const measureCount = score ? Math.max(...score.parts.map((part) => part.measures.length), 0) : parsed.durationBeats > 0 ? Math.max(1, Math.ceil(parsed.durationBeats / ((parsed.timeSig[0] * 4) / parsed.timeSig[1]))) : null;
  const staffNumbers = score?.parts.flatMap((part) => part.measures.flatMap((measure) => measure.staves ?? [])) ?? [];
  const staffCount = score ? new Set(staffNumbers).size || 1 : null;
  const partCount = score ? score.parts.length : null;
  const onsetCount = parsed.onsetCount;
  return {
    format,
    measureCount: measureCount ?? null,
    pageCount: score ? new Set(score.parts.flatMap((part) => part.measures.map((measure) => measure.page).filter((page): page is number => finite(page)))).size || null : null,
    staffCount,
    partCount,
    tempoBpm: positive(parsed.tempoBpm),
    keySignature: finite(parsed.keySig) ? parsed.keySig : null,
    keyMode: parsed.keyMode === 0 || parsed.keyMode === 1 ? parsed.keyMode : null,
    timeSignature: parsed.timeSig?.length === 2 ? [parsed.timeSig[0]!, parsed.timeSig[1]!] : null,
    durationBeats: positive(parsed.durationBeats),
    noteCount: parsed.notes.length,
    onsetCount,
    openingContour: contour(parsed.notes),
    density: parsed.durationBeats > 0 ? round(parsed.notes.length / parsed.durationBeats, 6) : null,
    title: titleText(parsed.title),
  };
}

function omrHints(input: NativeScoreVerificationOmrSummary | readonly NativeScoreVerificationOmrSummary[] | null | undefined): NativeScoreVerificationOmrSummary | null {
  let value: NativeScoreVerificationOmrSummary | null;
  if (Array.isArray(input)) {
    value = [...input].filter((item): item is NativeScoreVerificationOmrSummary => Boolean(item && typeof item === "object"))
      .sort((left, right) => (cleanText(left.id) ?? "").localeCompare(cleanText(right.id) ?? ""))[0] ?? null;
  } else {
    value = (input as NativeScoreVerificationOmrSummary | null | undefined) ?? null;
  }
  if (!value || typeof value !== "object") return null;
  const timeSignature = Array.isArray(value.timeSignature) && value.timeSignature.length === 2 && positive(value.timeSignature[0]) && positive(value.timeSignature[1])
    ? [value.timeSignature[0]!, value.timeSignature[1]!] as [number, number]
    : Array.isArray(value.timeSig) && value.timeSig.length === 2 && positive(value.timeSig[0]) && positive(value.timeSig[1])
      ? [value.timeSig[0]!, value.timeSig[1]!] as [number, number]
      : null;
  return {
    ...(cleanText(value.id) ? { id: cleanText(value.id) } : {}),
    ...(titleText(value.title) ? { title: titleText(value.title) } : {}),
    ...(integer(value.measureCount) !== null ? { measureCount: integer(value.measureCount) } : {}),
    ...(integer(value.pageCount ?? value.pages) !== null ? { pageCount: integer(value.pageCount ?? value.pages) } : {}),
    ...(integer(value.staffCount) !== null ? { staffCount: integer(value.staffCount) } : {}),
    ...(integer(value.partCount) !== null ? { partCount: integer(value.partCount) } : {}),
    ...(positive(value.tempoBpm) !== null ? { tempoBpm: positive(value.tempoBpm) } : {}),
    ...(finite(value.keySignature ?? value.keySig) ? { keySignature: value.keySignature ?? value.keySig } : {}),
    ...(value.keyMode === 0 || value.keyMode === 1 ? { keyMode: value.keyMode } : {}),
    ...(timeSignature ? { timeSignature } : {}),
    ...(positive(value.durationBeats) !== null ? { durationBeats: positive(value.durationBeats) } : {}),
    ...(titleText(value.openingContour) ? { openingContour: titleText(value.openingContour) } : {}),
    ...(finite(value.density) && value.density >= 0 ? { density: round(value.density, 6) } : {}),
    ...(finite(value.confidence) ? { confidence: round(Math.max(0, Math.min(1, value.confidence)), 6) } : {}),
    ...(cleanText(value.status) ? { status: cleanText(value.status) } : {}),
  };
}

function sameTitle(left: string | null, right: string | null): boolean | null {
  const a = titleKey(left);
  const b = titleKey(right);
  if (!a || !b) return null;
  if (a === b) return true;
  const leftWords = new Set(a.split(" "));
  const rightWords = new Set(b.split(" "));
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length / Math.max(leftWords.size, rightWords.size);
  return overlap >= 0.8;
}

function compareEvidence(symbolic: NativeScoreSymbolicStructure, omr: NativeScoreVerificationOmrSummary | null, pdfTitle: string | null): NativeScoreVerificationEvidence[] {
  const evidence: NativeScoreVerificationEvidence[] = [];
  const add = (signal: NativeScoreVerificationEvidence["signal"], observed: string | number | null, expected: string | number | null, outcome: NativeScoreVerificationEvidence["outcome"]): void => { evidence.push({ signal, observed, expected, outcome }); };
  const titleExpected = pdfTitle ?? (omr?.title ?? null);
  const titleResult = sameTitle(symbolic.title, titleExpected);
  add("title", symbolic.title, titleExpected, titleResult === null ? "unavailable" : titleResult ? "match" : "mismatch");
  if (!omr) return evidence;
  const omrTitleResult = sameTitle(omr.title ?? null, pdfTitle);
  // A contradictory OMR title is a different identity and must not veto a
  // verified native candidate. Structural hints are comparable only when the
  // OMR lane identifies the same score.
  if (omr.title && pdfTitle && omrTitleResult === false) return evidence;
  const number = (signal: NativeScoreVerificationEvidence["signal"], observed: number | null, expected: number | null, tolerance = 0): void => {
    if (observed === null || expected === null) add(signal, observed, expected, "unavailable");
    else add(signal, observed, expected, Math.abs(observed - expected) <= tolerance ? "match" : "mismatch");
  };
  number("measure-count", symbolic.measureCount, integer(omr.measureCount), Math.max(1, Math.round((integer(omr.measureCount) ?? 0) * 0.05)));
  number("staff-count", symbolic.staffCount, integer(omr.staffCount));
  number("part-count", symbolic.partCount, integer(omr.partCount));
  number("tempo", symbolic.tempoBpm, positive(omr.tempoBpm), Math.max(2, (positive(omr.tempoBpm) ?? 0) * 0.05));
  number("key", symbolic.keySignature, finite(omr.keySignature ?? omr.keySig) ? (omr.keySignature ?? omr.keySig)! : null);
  const expectedTime = omr.timeSignature ?? omr.timeSig ?? null;
  const time = symbolic.timeSignature && expectedTime ? `${symbolic.timeSignature[0]}/${symbolic.timeSignature[1]}` === `${expectedTime[0]}/${expectedTime[1]}` : null;
  add("time-signature", symbolic.timeSignature ? `${symbolic.timeSignature[0]}/${symbolic.timeSignature[1]}` : null, expectedTime ? `${expectedTime[0]}/${expectedTime[1]}` : null, time === null ? "unavailable" : time ? "match" : "mismatch");
  const expectedDuration = positive(omr.durationBeats);
  const duration = symbolic.durationBeats !== null && expectedDuration !== null ? Math.abs(symbolic.durationBeats - expectedDuration) <= Math.max(1, expectedDuration * 0.1) : null;
  add("duration", symbolic.durationBeats, expectedDuration, duration === null ? "unavailable" : duration ? "match" : "mismatch");
  const expectedContour = titleText(omr.openingContour);
  add("opening-contour", symbolic.openingContour, expectedContour, expectedContour === null || symbolic.openingContour === null ? "unavailable" : symbolic.openingContour === expectedContour ? "match" : "mismatch");
  const expectedDensity = finite(omr.density) && omr.density >= 0 ? omr.density : null;
  const density = symbolic.density !== null && expectedDensity !== null ? Math.abs(symbolic.density - expectedDensity) <= Math.max(0.05, expectedDensity * 0.15) : null;
  add("density", symbolic.density, expectedDensity, density === null ? "unavailable" : density ? "match" : "mismatch");
  return evidence;
}

function classify(
  evidence: readonly NativeScoreVerificationEvidence[],
  parsed: boolean,
  pdfTitle: string | null,
  symbolicTitle: string | null,
  omr: NativeScoreVerificationOmrSummary | null,
  verifiedPdfIdentity: boolean,
): { classification: NativeScoreVerificationClassification; reasons: string[] } {
  const reasons: string[] = [];
  if (!parsed) return { classification: "UNKNOWN", reasons: ["native symbolic candidate could not be parsed"] };
  const title = evidence.find((item) => item.signal === "title");
  if (title?.outcome === "mismatch") reasons.push("symbolic title does not match PDF title");
  if (!pdfTitle && !symbolicTitle) reasons.push("no safe title identity was available");
  const mismatches = evidence.filter((item) => item.outcome === "mismatch" && item.signal !== "title");
  if (mismatches.length >= 2 || mismatches.some((item) => item.signal === "measure-count" && typeof item.expected === "number" && typeof item.observed === "number" && Math.abs(item.observed - item.expected) > 1)) {
    reasons.push("native symbolic structure disagrees with available score hints");
    return { classification: "WRONG_ARRANGEMENT", reasons };
  }
  const matches = evidence.filter((item) => item.outcome === "match");
  if (title?.outcome === "match" && verifiedPdfIdentity && (omr === null || mismatches.length === 0)) {
    reasons.push("verified provenance and symbolic identity agree with the PDF");
    return { classification: "EXACT_OR_HIGH_CONFIDENCE_MATCH", reasons };
  }
  if (matches.length >= 2 && mismatches.length === 0) {
    reasons.push("multiple structural signals agree; human review remains required");
    return { classification: "LIKELY_MATCH", reasons };
  }
  reasons.push("insufficient independent identity evidence for automatic reference use");
  return { classification: "UNKNOWN", reasons };
}

function emptyResult(pdf: ReturnType<typeof pdfHints>, discovery: NativeScoreDiscoveryReport, reasons: string[]): NativeScoreVerificationResult {
  return {
    schemaVersion: NATIVE_SCORE_VERIFICATION_SCHEMA_VERSION,
    classification: "UNKNOWN",
    eligibleAsReference: false,
    nativePriority: false,
    candidate: null,
    pdf,
    symbolic: null,
    omr: null,
    discovery: { status: discovery.status, selectionReason: discovery.selectionReason, selected: discovery.selected, rejected: discovery.rejected, errors: discovery.errors },
    evidence: [],
    reasons,
    nonClaims: ["This report does not prove copyright permission, musical correctness, or listening quality."],
  };
}

function byteDiscovery(
  input: NativeScoreVerificationCandidate,
  bytes: Uint8Array,
  options: NativeScoreByteVerificationOptions = {},
): { discovery: NativeScoreDiscoveryReport; type: "midi" | "musicxml" | "mxl" | "mscz" | null } {
  const id = safeId(input.id ?? input.label);
  const type = artifactType(input, options.artifactType);
  const reject = (reason: "local artifact is not explicitly permitted" | "unsupported artifact type" | "invalid artifact format" | "native artifact requires provenance and version" | "untrusted native candidate" | "invalid artifact metadata"): NativeScoreDiscoveryReport => ({
    schemaVersion: 1,
    status: reason === "local artifact is not explicitly permitted" || reason === "native artifact requires provenance and version" || reason === "untrusted native candidate"
      ? "review-required" : "failed",
    selectionReason: "native byte input could not be trusted automatically",
    pdf: null,
    selected: null,
    candidates: [],
    rejected: [{ id, reason }],
    omr: [],
    errors: [],
  });
  if (!type) return { discovery: reject("unsupported artifact type"), type };
  if (type === "mscz") return { discovery: reject("invalid artifact format"), type };
  if (input.permitted !== true) return { discovery: reject("local artifact is not explicitly permitted"), type };
  const provenance = provenanceText(input.provenance);
  const version = safeMetadataText(input.version ?? input.versionIdentity);
  if (!provenance || !version) return { discovery: reject("native artifact requires provenance and version"), type };
  if (!trustedProvenance(provenance)) return { discovery: reject("untrusted native candidate"), type };
  const suppliedHash = input.sha256 === undefined || input.sha256 === null
    ? null
    : typeof input.sha256 === "string" && SAFE_HASH.test(input.sha256) ? input.sha256.toLowerCase() : null;
  if (input.sha256 !== undefined && input.sha256 !== null && suppliedHash === null) {
    return { discovery: reject("invalid artifact metadata"), type };
  }
  if (finite(input.bytes) && input.bytes !== bytes.byteLength) return { discovery: reject("invalid artifact metadata"), type };
  const hash = sha256Hex(bytes);
  if (suppliedHash !== null && suppliedHash !== hash) return { discovery: reject("invalid artifact metadata"), type };
  const evidence: NativeScoreEvidence = {
    id,
    artifactType: type,
    provenance,
    version,
    access: "local-file",
    accessMethod: "local-file",
    sourcePage: safeUrl(input.sourcePage ?? input.sourceUrl ?? input.url),
    page: null,
    bytes: bytes.byteLength,
    sha256: hash,
    hashStatus: "verified",
    confidence: finite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null,
    trusted: true,
    discoveredFrom: "native-artifact",
  };
  return {
    type,
    discovery: {
      schemaVersion: 1,
      status: "native-symbolic",
      selectionReason: "explicitly supplied local native bytes",
      pdf: null,
      selected: evidence,
      candidates: [evidence],
      rejected: [],
      omr: [],
      errors: [],
    },
  };
}

function parseNativeBytes(bytes: Uint8Array, type: "midi" | "musicxml" | "mxl"): { parsed: NormalizedSymbolicScore; omrParse: OmrMusicXmlParseResult | null } | null {
  try {
    if (type === "midi") return { parsed: parseSymbolicCandidate(bytes, "midi"), omrParse: null };
    if (type === "musicxml" || type === "mxl") {
      const omrParse = parseOmrMusicXmlBytes(bytes);
      return { parsed: parseSymbolicCandidate(symbolicFromOmr(omrParse)), omrParse };
    }
  } catch {
    return null;
  }
  return null;
}

function resultFromNativeBytes(
  report: PdfForensicsReportLike,
  input: NativeScoreVerificationCandidate,
  bytes: Uint8Array,
  discovery: NativeScoreDiscoveryReport,
  type: "midi" | "musicxml" | "mxl",
  omr: NativeScoreVerificationOmrSummary | null,
): NativeScoreVerificationResult {
  const pdf = pdfHints(report);
  if (!discovery.selected) return { ...emptyResult(pdf, discovery, ["native candidate failed local provenance, format, or access validation"]), omr };
  const parsedResult = parseNativeBytes(bytes, type);
  if (!parsedResult) return { ...emptyResult(pdf, discovery, ["native symbolic candidate could not be parsed"]), omr };
  const symbolic = structure(type, parsedResult.parsed, parsedResult.omrParse);
  if (!symbolic.title) {
    const labelled = input as NativeScoreArtifactInput & { title?: unknown };
    symbolic.title = titleText(labelled.title) ?? titleText(input.label);
  }
  const evidence = compareEvidence(symbolic, omr, pdf.title);
  const decision = classify(evidence, true, pdf.title, symbolic.title, omr, hasVerifiedPdfIdentity(report, pdf));
  if (report.status && report.status !== "ok") {
    decision.classification = "UNKNOWN";
    decision.reasons.unshift("PDF forensics report is not valid");
  }
  const candidate = {
    id: discovery.selected.id,
    artifactType: discovery.selected.artifactType,
    bytes: discovery.selected.bytes,
    sha256: discovery.selected.sha256,
    hashStatus: discovery.selected.hashStatus,
    provenance: discovery.selected.provenance,
    version: discovery.selected.version,
  };
  return {
    schemaVersion: NATIVE_SCORE_VERIFICATION_SCHEMA_VERSION,
    classification: decision.classification,
    eligibleAsReference: decision.classification === "EXACT_OR_HIGH_CONFIDENCE_MATCH",
    nativePriority: decision.classification === "EXACT_OR_HIGH_CONFIDENCE_MATCH",
    candidate,
    pdf,
    symbolic,
    omr,
    discovery: { status: discovery.status, selectionReason: discovery.selectionReason, selected: discovery.selected, rejected: discovery.rejected, errors: discovery.errors },
    evidence,
    reasons: decision.reasons,
    nonClaims: ["This report does not prove copyright permission, musical correctness, or listening quality."],
  };
}

/** Verify an explicitly supplied in-memory native artifact using the same
 * parser and identity rules as path-backed verification.  This is a local
 * builder/test seam; bytes are never serialized into the report. */
export function verifyNativeScoreBytes(
  report: PdfForensicsReportLike,
  input: NativeScoreVerificationCandidate,
  bytes: Uint8Array,
  options: NativeScoreByteVerificationOptions = {},
): NativeScoreVerificationResult {
  const omr = omrHints(null);
  const { discovery, type } = byteDiscovery(input, bytes, options);
  if (!type || type === "mscz" || !discovery.selected) return { ...emptyResult(pdfHints(report), discovery, discovery.rejected.length ? ["native candidate failed local provenance, format, or access validation"] : ["no verified native symbolic candidate was selected"]), omr };
  return resultFromNativeBytes(report, input, bytes, discovery, type, omr);
}

/** Verify one permitted local native symbolic candidate against PDF forensics. */
export async function verifyNativeScoreIdentity(
  report: PdfForensicsReportLike,
  input: NativeScoreVerificationCandidate,
  omrInput?: NativeScoreVerificationOmrSummary | readonly NativeScoreVerificationOmrSummary[] | null,
  options: NativeScoreVerificationOptions = {},
): Promise<NativeScoreVerificationResult> {
  const pdf = pdfHints(report);
  const omr = omrHints(omrInput);
  const discovery = await discoverNativeScoreArtifacts({
    pdfMetadata: { title: pdf.title, pages: pdf.pages },
    nativeArtifacts: [input],
    ...options.discovery,
  });
  if (!discovery.selected) return { ...emptyResult(pdf, discovery, discovery.rejected.length ? ["native candidate failed local provenance, format, or access validation"] : ["no verified native symbolic candidate was selected"]), omr };
  if (typeof input.path !== "string" || !input.path.trim()) return { ...emptyResult(pdf, discovery, ["selected native candidate has no local path"]), omr };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(input.path));
  } catch {
    return { ...emptyResult(pdf, discovery, ["selected native candidate could not be read"]), omr };
  }
  const format = discovery.selected.artifactType;
  if (format === "mscz") return { ...emptyResult(pdf, discovery, ["MuseScore MSCZ candidates are not parsable by the native verifier"]), omr };
  return resultFromNativeBytes(report, input, bytes, discovery, format, omr);
}

export const verifyNativeScoreArtifact = verifyNativeScoreIdentity;
export const verifyNativeScore = verifyNativeScoreIdentity;
