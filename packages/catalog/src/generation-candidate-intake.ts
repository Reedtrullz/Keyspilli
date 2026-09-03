import {
  adaptNativeSymbolicBytes,
  adaptNativeSymbolicFile,
  type NativeSymbolicAdapterResult,
} from "./native-score-adapter.js";
import {
  retrieveExternalSource,
  type ExternalRetrievalBody,
  type ExternalRetrievalResponseInput,
} from "./external-retrieval.js";
import { assertGenerationEvidence, type EvidenceClass, type EvidenceFirewallOptions, type ExternalEvidenceCandidate } from "./external-evidence.js";
import type { CanonicalScore } from "./omr-canonical.js";
import type { OmrScoreInput } from "./omr-consensus.js";

export type GenerationCandidateClass = "GENERATION_CANDIDATE" | "BENCHMARK_REFERENCE" | "DIAGNOSTIC_ONLY" | "FALLBACK_AMT";
export type GenerationCandidateProvenanceClass = "PROJECT_OWNED" | "OPEN_LICENSE" | "USER_SUPPLIED_PRIVATE" | "REMOTE_APPROVED" | "UNKNOWN";
export type GenerationCandidateTransport = "LOCAL_BYTES" | "LOCAL_FILE" | "REMOTE_RESPONSE";
export type GenerationCandidateReadinessCode = "READY" | "READY_FOR_ALIGNMENT" | "READY_FOR_GENERATION" | "MISSING_INPUT" | "BENCHMARK_PROTECTED" | "METADATA_ONLY" | "INVALID_SYMBOLIC" | "FIREWALL_REJECTED" | "UNSUPPORTED_CLASS" | "PROVENANCE_BLOCKED" | "NO_USABLE_MUSICAL_EVENTS" | "UNSUPPORTED_FORMAT" | "REMOTE_CONTENT_INVALID";
export type GenerationCandidateAlignmentStatus = "aligned" | "partial" | "not-attempted" | "unavailable" | "rejected";

/** Bound every generation-candidate transport, including already supplied bytes. */
export const GENERATION_CANDIDATE_MAX_BYTES = 16 * 1024 * 1024;

export interface GenerationCandidateIntakeInput {
  id: string;
  bytes?: Uint8Array | ArrayBuffer;
  path?: string;
  format?: string;
  sourceRef: string;
  sourcePage?: string;
  version: string;
  candidateClass?: GenerationCandidateClass;
  evidenceClass?: Exclude<EvidenceClass, "BENCHMARK_REFERENCE">;
  provider?: string;
  purpose?: "GENERATION_CANDIDATE" | "BENCHMARK_REFERENCE" | "RESEARCH_LEAD";
  /** A response-shaped seam for callers that already acquired remote bytes. */
  response?: ExternalRetrievalResponseInput;
  url?: string;
  provenanceClass?: GenerationCandidateProvenanceClass;
  /** Network access is opt-in and intended for approved direct symbolic URLs. */
  allowNetwork?: boolean;
  fetch?: typeof globalThis.fetch;
  maxBytes?: number;
  alignment?: { status?: GenerationCandidateAlignmentStatus; reason?: string | null };
  /** Optional protected-reference registry supplied by the caller. */
  firewall?: EvidenceFirewallOptions;
}

export interface GenerationCandidateIntakeResult {
  schemaVersion: 1;
  id: string;
  sourceKind: "local" | "remote";
  sourceOrigin: "path" | "bytes" | "response" | "url";
  userSupplied: boolean;
  projectOwned: boolean;
  remoteApproved: boolean;
  candidateClass: GenerationCandidateClass;
  evidenceClass: EvidenceClass | null;
  provenanceClass: GenerationCandidateProvenanceClass;
  transport: GenerationCandidateTransport;
  format: "midi" | "musicxml" | "mxl" | null;
  parseStatus: "parsed" | "invalid" | "unsupported" | "not-attempted";
  summary: {
    tempoBpm: number | null;
    timeSignature: [number, number] | null;
    durationBeats: number | null;
    noteCount: number | null;
    trackCount: number | null;
    semanticRoleAvailability: string[];
  };
  provenance: { sourceRef: string; sourcePage: string | null; version: string; accessMethod: "local-file" | "local-bytes"; sha256: string | null; bytes: number | null };
  alignmentRequirement: { required: true; status: GenerationCandidateAlignmentStatus };
  readiness: "ready" | "rejected";
  readinessCode: GenerationCandidateReadinessCode;
  generationEligibility: { eligible: boolean; code: GenerationCandidateReadinessCode; reasons: string[] };
  failureReasons: string[];
  candidate: ExternalEvidenceCandidate | null;
  score: NativeSymbolicAdapterResult extends { score: infer S } ? S | null : unknown;
  canonical: NativeSymbolicAdapterResult extends { canonical: infer C } ? C | null : unknown;
}

function bodyBytes(response: ExternalRetrievalResponseInput): Uint8Array | ArrayBuffer | null {
  const body: ExternalRetrievalBody = response.bytes ?? response.body ?? response.payload ?? response.content ?? null;
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  if (typeof body === "string") return new TextEncoder().encode(body);
  return null;
}

function safeSourceRef(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "[redacted-source-ref]";
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.username = ""; url.password = ""; url.search = ""; url.hash = "";
      return url.toString();
    }
    if (/^(?:file|data|javascript|blob):$/i.test(url.protocol)) return "[redacted-source-ref]";
    throw new Error("opaque logical source reference");
  } catch { /* opaque logical refs are handled below */ }
  const trimmed = value.trim();
  return /^(?:[A-Za-z][A-Za-z0-9+.-]*:)[^?#\s]+$/.test(trimmed)
    && !/^(?:file|data|javascript|blob):/i.test(trimmed)
    && !/[\\/]/.test(trimmed)
    ? trimmed
    : "[redacted-source-ref]";
}

function safeId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "[redacted-id]";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean && !/[\\/]|(?:file|data|javascript|blob):/i.test(clean) ? clean : "[redacted-id]";
}

function safeSourcePage(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return null; }
}

function safeVersion(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "[redacted-version]";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean && !/[\\/]|(?:file|data|javascript|blob):/i.test(clean) ? clean : "[redacted-version]";
}

function safeProvider(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!clean || /[\\/]|(?:file|data|javascript|blob):/i.test(clean)) return undefined;
  try {
    const url = new URL(clean);
    if (url.protocol === "http:" || url.protocol === "https:") return safeSourceRef(clean);
  } catch { /* ordinary provider labels are allowed */ }
  return clean;
}

function normalizedProvenanceClass(value: unknown): GenerationCandidateProvenanceClass {
  return value === "PROJECT_OWNED" || value === "OPEN_LICENSE" || value === "USER_SUPPLIED_PRIVATE" || value === "REMOTE_APPROVED"
    ? value
    : "UNKNOWN";
}

function failureResult(input: GenerationCandidateIntakeInput, format: GenerationCandidateIntakeResult["format"], reasons: string[], adapter?: NativeSymbolicAdapterResult, readinessCode: GenerationCandidateReadinessCode = "FIREWALL_REJECTED"): GenerationCandidateIntakeResult {
  const provenanceClass = normalizedProvenanceClass(input.provenanceClass);
  const remote = Boolean(input.response || input.url);
  return {
    schemaVersion: 1,
    id: safeId(input.id),
    sourceKind: remote ? "remote" : "local",
    sourceOrigin: input.path ? "path" : input.url ? "url" : input.response ? "response" : "bytes",
    userSupplied: provenanceClass === "USER_SUPPLIED_PRIVATE",
    projectOwned: provenanceClass === "PROJECT_OWNED",
    remoteApproved: provenanceClass === "REMOTE_APPROVED",
    candidateClass: input.candidateClass ?? "GENERATION_CANDIDATE",
    evidenceClass: input.evidenceClass ?? "VERIFIED_NATIVE_SYMBOLIC",
    provenanceClass,
    transport: input.path ? "LOCAL_FILE" : input.response || input.url ? "REMOTE_RESPONSE" : "LOCAL_BYTES",
    format,
    parseStatus: adapter?.status ?? "not-attempted",
    summary: adapterSummary(adapter),
    provenance: { sourceRef: safeSourceRef(input.sourceRef), sourcePage: safeSourcePage(input.sourcePage), version: safeVersion(input.version), accessMethod: input.path ? "local-file" : "local-bytes", sha256: adapter?.provenance.sha256 ?? null, bytes: adapter?.provenance.bytes ?? null },
    alignmentRequirement: { required: true, status: input.alignment?.status ?? "not-attempted" },
    readiness: "rejected",
    readinessCode,
    generationEligibility: { eligible: false, code: readinessCode, reasons: [...new Set(reasons)].sort() },
    failureReasons: [...new Set(reasons)].sort(),
    candidate: null,
    score: null,
    canonical: null,
  };
}

function rationalNumber(value: unknown): number | null {
  if (!isRecord(value) || !finiteNumber(value.numerator) || !finiteNumber(value.denominator) || value.denominator === 0) return null;
  return value.numerator / value.denominator;
}

function adapterSummary(adapter: NativeSymbolicAdapterResult | undefined): GenerationCandidateIntakeResult["summary"] {
  if (!adapter || adapter.status !== "parsed") {
    return { tempoBpm: null, timeSignature: null, durationBeats: null, noteCount: null, trackCount: null, semanticRoleAvailability: [] };
  }
  const canonical = adapter.canonical;
  const score = adapter.score;
  const notes = canonical.notationEvents.filter((event) => event.type === "note" && event.midi !== null);
  const eventEnds = canonical.notationEvents.flatMap((event) => {
    const start = rationalNumber(event.onset);
    const duration = rationalNumber(event.duration);
    return start !== null && duration !== null ? [start + duration] : [];
  });
  const measureEnds = canonical.measures.flatMap((measure) => {
    const start = rationalNumber(measure.startBeat);
    const duration = rationalNumber(measure.durationBeats);
    return start !== null && duration !== null ? [start + duration] : [];
  });
  const ends = [...eventEnds, ...measureEnds];
  const roles = [...new Set(score.parts.map((part) => part.role).filter((role): role is NonNullable<typeof role> => typeof role === "string"))].sort();
  return {
    tempoBpm: finiteNumber(canonical.tempoBpm) ? canonical.tempoBpm : null,
    timeSignature: canonical.timeSignature && canonical.timeSignature.length === 2 ? [canonical.timeSignature[0], canonical.timeSignature[1]] : null,
    durationBeats: ends.length ? Math.max(...ends) : null,
    noteCount: notes.length,
    trackCount: score.parts.length,
    semanticRoleAvailability: roles,
  };
}

function publicFormat(format: string | null | undefined): GenerationCandidateIntakeResult["format"] {
  return format === "midi" || format === "musicxml" || format === "mxl" ? format : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function effectiveMaxBytes(value: unknown): number | null {
  if (value === undefined) return GENERATION_CANDIDATE_MAX_BYTES;
  if (!finiteNumber(value) || value < 1 || value > GENERATION_CANDIDATE_MAX_BYTES) return null;
  return Math.floor(value);
}

const PATH_KEY = /(?:^|[_-])(?:absolute|physical|local|root)?path$|(?:path|filename|file|locator)(?:ref|path|name)?$/i;
const SOURCE_REF_KEY = /^(?:canonical)?sourceRef$/i;
const SOURCE_PAGE_KEY = /^sourcePage$/i;
const URL_KEY = /^(?:url|uri)$/i;
const PROVIDER_KEY = /^provider$/i;
const ABSOLUTE_PATH_TEXT = /(?:^|[\s(=,:])(?:file:\/\/(?:[A-Za-z]:[\\/]|[\\/]|~[\\/])|[A-Za-z]:[\\/]|~[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|mnt|workspace|data|srv|etc)[\\/])/i;
const MEDIA_PATH_TEXT = /(?:^|[\s(=,:])(?:\.{1,2}[\\/]|[A-Za-z0-9._~-]+[\\/])[^\s,;)}\]]+\.(?:mid|midi|musicxml|xml|mxl|wav|mp3|json)(?:[?#][^\s,;)}\]]*)?(?:$|[\s,;)}\]])/i;

function pathSafeAdapterText(value: string, key: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1_000);
  if (!clean) return clean;
  if (SOURCE_REF_KEY.test(key)) return safeSourceRef(clean);
  if (SOURCE_PAGE_KEY.test(key)) return safeSourcePage(clean) ?? "[redacted-source-page]";
  if (PROVIDER_KEY.test(key)) return safeProvider(clean) ?? "[redacted-provider]";
  if (URL_KEY.test(key)) {
    try {
      const url = new URL(clean);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      }
    } catch { /* ordinary labels are handled by the path checks below */ }
  }
  if (PATH_KEY.test(key) || ABSOLUTE_PATH_TEXT.test(clean) || MEDIA_PATH_TEXT.test(clean) || /^(?:file|data|javascript|blob):/i.test(clean)) return "[redacted-path]";
  return clean;
}

function pathSafeAdapterValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") return pathSafeAdapterText(value, key);
  if (Array.isArray(value)) return value.map((entry) => pathSafeAdapterValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([entryKey, entry]) => [entryKey, pathSafeAdapterValue(entry, entryKey)]));
  }
  return value;
}

/** A parsed container with only measures/rests is not a generation candidate. */
function hasUsableMusicalEvents(adapter: NativeSymbolicAdapterResult): boolean {
  if (adapter.status !== "parsed") return false;
  const canonical = adapter.canonical as unknown;
  if (isRecord(canonical) && Array.isArray(canonical.notationEvents)) {
    const pitchedEvents = canonical.notationEvents.some((event) => {
      if (!isRecord(event) || event.type !== "note") return false;
      return finiteNumber(event.midi);
    });
    if (pitchedEvents) return true;
  }
  const score = adapter.score as unknown;
  if (!isRecord(score) || !Array.isArray(score.parts)) return false;
  return score.parts.some((part) => {
    if (!isRecord(part) || !Array.isArray(part.measures)) return false;
    return part.measures.some((measure) => {
      if (!isRecord(measure) || !Array.isArray(measure.events)) return false;
      return measure.events.some((event) => isRecord(event) && finiteNumber(event.pitch));
    });
  });
}

export async function intakeGenerationCandidate(input: GenerationCandidateIntakeInput): Promise<GenerationCandidateIntakeResult> {
  if (!isRecord(input)) return failureResult({} as GenerationCandidateIntakeInput, null, ["candidate input must be an object"], undefined, "MISSING_INPUT");
  const reasons: string[] = [];
  const provenanceClass = normalizedProvenanceClass(input.provenanceClass);
  const idText = typeof input.id === "string" ? input.id.trim() : "";
  const sourceRefText = typeof input.sourceRef === "string" ? input.sourceRef.trim() : "";
  const versionText = typeof input.version === "string" ? input.version.trim() : "";
  if (!idText) reasons.push("candidate id is required");
  if (!sourceRefText) reasons.push("logical source reference is required");
  if (sourceRefText && safeSourceRef(sourceRefText) === "[redacted-source-ref]") reasons.push("logical source reference is unsafe");
  if (!versionText) reasons.push("candidate version is required");
  const requestedFormat = input.format;
  const invalidFormat = requestedFormat !== undefined
    && (typeof requestedFormat !== "string" || !["midi", "musicxml", "mxl", "mscz"].includes(requestedFormat.toLowerCase()));
  if (invalidFormat) reasons.push("unsupported symbolic format");
  if (input.purpose && input.purpose !== "GENERATION_CANDIDATE") reasons.push("benchmark/research evidence cannot enter generation");
  if (input.candidateClass && input.candidateClass !== "GENERATION_CANDIDATE") reasons.push("candidate class is not generation-safe");
  if ((input.evidenceClass as string | undefined) === "BENCHMARK_REFERENCE") reasons.push("benchmark/reference evidence cannot enter generation");
  if (input.url && provenanceClass !== "REMOTE_APPROVED") reasons.push("remote candidates require REMOTE_APPROVED provenance");
  const maxBytes = effectiveMaxBytes(input.maxBytes);
  if (input.maxBytes !== undefined && maxBytes === null) reasons.push(`candidate maxBytes must be finite, positive, and at most ${GENERATION_CANDIDATE_MAX_BYTES} bytes`);
  if (input.path && (input.bytes !== undefined || input.response || input.url)) reasons.push("candidate must provide one local path, bytes, or response");
  if (input.bytes !== undefined && (input.response || input.url)) reasons.push("candidate must provide one local bytes or response");
  if (reasons.length) return failureResult(input, null, reasons, undefined,
    input.candidateClass === "BENCHMARK_REFERENCE" || input.purpose === "BENCHMARK_REFERENCE" || (input.evidenceClass as string | undefined) === "BENCHMARK_REFERENCE"
      ? "BENCHMARK_PROTECTED"
      : input.candidateClass && input.candidateClass !== "GENERATION_CANDIDATE"
        ? "UNSUPPORTED_CLASS"
        : invalidFormat
          ? "UNSUPPORTED_FORMAT"
        : reasons.some((reason) => /unsafe|firewall|provenance|remote/i.test(reason))
          ? (input.url ? "PROVENANCE_BLOCKED" : "FIREWALL_REJECTED")
          : "MISSING_INPUT");

  let adapter: NativeSymbolicAdapterResult;
  let format = typeof input.format === "string" ? input.format.toLowerCase() : "midi";
  if (input.path) {
    try {
      adapter = await adaptNativeSymbolicFile(input.path, { sourceRef: input.sourceRef, sourcePage: input.sourcePage, version: input.version, maxBytes: maxBytes ?? GENERATION_CANDIDATE_MAX_BYTES });
    } catch (error) {
      return failureResult(input, publicFormat(format), [error instanceof Error ? error.message : "local candidate read failed"]);
    }
    format = adapter.format;
  } else {
    let retrieval: Awaited<ReturnType<typeof retrieveExternalSource>> | null = null;
    if (input.response || input.url) {
      retrieval = await retrieveExternalSource({
        id: safeId(input.id),
        initialUrl: input.url,
        sourceRef: input.sourceRef,
        response: input.response,
      }, {
        allowNetwork: Boolean(input.url && input.allowNetwork === true),
        fetch: input.fetch,
        maxBytes: maxBytes ?? GENERATION_CANDIDATE_MAX_BYTES,
        retainBytes: true,
      });
    }
    const bytes = input.bytes ?? retrieval?.bytes ?? (input.response ? bodyBytes(input.response) : null);
    if (!bytes) return failureResult(input, retrieval?.detectedFormat ?? null, retrieval?.rejectionReasons.length ? retrieval.rejectionReasons : ["candidate bytes are required"], undefined, input.url ? "REMOTE_CONTENT_INVALID" : "MISSING_INPUT");
    if (retrieval && (!retrieval.parserEligible || !retrieval.detectedFormat)) return failureResult(input, retrieval.detectedFormat, [...retrieval.reasons, ...retrieval.rejectionReasons], undefined, retrieval.metadataOnly ? "METADATA_ONLY" : "REMOTE_CONTENT_INVALID");
    format = retrieval?.detectedFormat ?? format;
    if (maxBytes === null || bytes.byteLength > maxBytes) {
      return failureResult(input, publicFormat(format), ["candidate bytes exceed the bounded intake size"], undefined, "REMOTE_CONTENT_INVALID");
    }
    try {
      adapter = adaptNativeSymbolicBytes(bytes, format, { sourceRef: input.sourceRef, sourcePage: input.sourcePage, version: input.version, accessMethod: "local-bytes", maxBytes });
    } catch (error) {
      return failureResult(input, publicFormat(format), [error instanceof Error ? error.message : "symbolic candidate parse failed"], undefined, invalidFormat ? "UNSUPPORTED_FORMAT" : "INVALID_SYMBOLIC");
    }
  }
  if (adapter.status !== "parsed") return failureResult(
    input,
    publicFormat(adapter.format),
    [adapter.status === "invalid" ? adapter.error : adapter.reason],
    adapter,
    adapter.status === "unsupported" ? "UNSUPPORTED_FORMAT" : "INVALID_SYMBOLIC",
  );
  if (!hasUsableMusicalEvents(adapter)) return failureResult(input, publicFormat(adapter.format), ["symbolic candidate contains no usable pitched musical events"], adapter, "NO_USABLE_MUSICAL_EVENTS");
  let candidate: ExternalEvidenceCandidate;
  try {
    candidate = assertGenerationEvidence({
      id: input.id,
      evidenceClass: input.evidenceClass ?? "VERIFIED_NATIVE_SYMBOLIC",
      purpose: "GENERATION_CANDIDATE",
      provenance: { sourceRef: safeSourceRef(input.sourceRef), ...(safeProvider(input.provider) ? { provider: safeProvider(input.provider) } : {}), acquiredVia: adapter.provenance.accessMethod, acquisition: adapter.provenance.accessMethod, canonicalSourceRef: safeSourceRef(input.sourceRef), sourcePage: safeSourcePage(input.sourcePage), provenanceClass },
      content: { sha256: adapter.provenance.sha256, byteLength: adapter.provenance.bytes, mediaType: adapter.format === "midi" ? "audio/midi" : "application/xml" },
      status: "parsed",
    }, input.firewall);
  } catch (error) {
    return failureResult(input, publicFormat(adapter.format), [error instanceof Error ? error.message : "candidate failed generation firewall"], adapter);
  }
  const alignment = input.alignment?.status ?? "not-attempted";
  const eligibilityReasons = [
    ...(provenanceClass === "UNKNOWN" ? ["provenance class is UNKNOWN; explicit provenance is required"] : []),
    ...(alignment !== "aligned" ? [`alignment status is ${alignment}; aligned evidence is required before generation`] : []),
    ...(input.alignment?.reason ? [input.alignment.reason] : []),
  ];
  const generationReady = provenanceClass !== "UNKNOWN" && alignment === "aligned";
  const eligibilityCode: GenerationCandidateReadinessCode = generationReady
    ? "READY_FOR_GENERATION"
    : provenanceClass === "UNKNOWN" ? "PROVENANCE_BLOCKED" : "READY_FOR_ALIGNMENT";
  return {
    schemaVersion: 1,
    id: safeId(input.id),
    sourceKind: input.response || input.url ? "remote" : "local",
    sourceOrigin: input.path ? "path" : input.url ? "url" : input.response ? "response" : "bytes",
    userSupplied: provenanceClass === "USER_SUPPLIED_PRIVATE",
    projectOwned: provenanceClass === "PROJECT_OWNED",
    remoteApproved: provenanceClass === "REMOTE_APPROVED",
    candidateClass: input.candidateClass ?? "GENERATION_CANDIDATE",
    evidenceClass: input.evidenceClass ?? "VERIFIED_NATIVE_SYMBOLIC",
    provenanceClass,
    transport: input.path ? "LOCAL_FILE" : input.response || input.url ? "REMOTE_RESPONSE" : "LOCAL_BYTES",
    format: publicFormat(adapter.format),
    parseStatus: "parsed",
    summary: adapterSummary(adapter),
    provenance: { sourceRef: safeSourceRef(input.sourceRef), sourcePage: safeSourcePage(input.sourcePage), version: safeVersion(input.version), accessMethod: adapter.provenance.accessMethod, sha256: adapter.provenance.sha256, bytes: adapter.provenance.bytes },
    alignmentRequirement: { required: true, status: alignment },
    readiness: "ready", readinessCode: eligibilityCode, generationEligibility: { eligible: generationReady, code: eligibilityCode, reasons: [...new Set(eligibilityReasons)].sort() }, failureReasons: [], candidate, score: pathSafeAdapterValue(adapter.score) as OmrScoreInput | null, canonical: pathSafeAdapterValue(adapter.canonical) as CanonicalScore | null,
  };
}
