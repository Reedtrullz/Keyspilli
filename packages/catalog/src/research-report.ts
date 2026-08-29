import {
  alignSymbolicScores,
  parseSymbolicCandidate,
  type NormalizedSymbolicScore,
  type SymbolicAlignmentOptions,
  type SymbolicAlignmentResult,
} from "./symbolic-alignment.js";
import {
  buildResearchQueries,
  classifyArrangementCandidate,
  createSongIdentity,
  rankArrangementCandidates,
  type ArrangementCandidate,
  type ClassifiedCandidate,
  type SongIdentity,
  type SongIdentityInput,
} from "./song-research.js";
import {
  searchYoutubeCandidates,
  type YoutubeDiscoveryCandidate,
} from "./youtube-discovery.js";
import { sha256Hex } from "./fixture-evidence.js";
import type { SourceProvenance } from "./provenance.js";

export interface LocalSymbolicInput {
  bytes: Uint8Array;
  format: "midi" | "musicxml" | "mxl" | "unknown";
  title?: string;
  id?: string;
  sourceType?: ArrangementCandidate["sourceType"];
  durationSeconds?: number | null;
  discoveredBy?: string[];
}

export interface LocalReferenceInput {
  bytes: Uint8Array;
  format?: "midi" | "musicxml" | "mxl" | "unknown";
  id?: string;
}

export interface HumanAcceptanceInput {
  verdict: "accept" | "reject";
  note?: string;
  raterCount?: number;
}

export interface ResearchReportInput {
  song: SongIdentityInput | SongIdentity;
  discoveryCandidates?: readonly YoutubeDiscoveryCandidate[];
  discoveredBy?: Readonly<Record<string, readonly string[]>>;
  discoveryErrors?: readonly string[];
  localCandidates?: readonly LocalSymbolicInput[];
  reference?: LocalReferenceInput;
  humanAcceptance?: HumanAcceptanceInput;
  alignmentOptions?: SymbolicAlignmentOptions;
}

export interface ResearchSymbolicArtifact {
  id: string;
  selector: string;
  bytes: number;
  sha256: string;
  format: string;
  parser?: {
    format: number;
    division: number;
    tempoBpm: number;
    durationBeats: number;
    noteCount: number;
    onsetCount: number;
    timeSig: [number, number];
    title?: string;
  };
  warnings?: string[];
  error?: string;
}

export interface ResearchReport {
  schemaVersion: 1;
  song: SongIdentity;
  queries: string[];
  /** Search queries that produced each discovered YouTube candidate. */
  discoveredBy: Record<string, string[]>;
  candidates: ClassifiedCandidate[];
  discoveryErrors: string[];
  recommended: string[];
  fallback: string | null;
  symbolicArtifacts: ResearchSymbolicArtifact[];
  alignments: Record<string, SymbolicAlignmentResult>;
  humanAcceptance: {
    status: "not-supplied" | "accept" | "reject";
    note?: string;
    raterCount?: number;
  };
}

export interface ResearchSearchOptions {
  limit?: number;
  search?: (query: string, limit: number) => Promise<YoutubeDiscoveryCandidate[]>;
}

export interface ResearchRunOptions extends ResearchReportInput, ResearchSearchOptions {
  noNetwork?: boolean;
}

export interface ResearchRunResult {
  report: ResearchReport;
  json: string;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function identity(value: SongIdentityInput | SongIdentity): SongIdentity {
  return "id" in value && typeof value.id === "string"
    ? value as SongIdentity
    : createSongIdentity(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function serializeResearchReport(report: ResearchReport): string {
  return JSON.stringify(stable(redactReportValue(report)), null, 2) + "\n";
}

function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message || /(?:password|token|secret|cookie|authorization|--proxy|(?:https?|socks5h?):\/\/[^\s/@]+:[^\s/@]+@|\/(?:Users|private|tmp|var|home)\/|[A-Za-z]:[\\/])/i.test(message)) return fallback;
  return message.replace(/[\r\n]+/g, " ").slice(0, 240) || fallback;
}

function formatForCandidate(input: LocalSymbolicInput): string {
  return input.format === "unknown" ? "unknown" : input.format;
}

const REPORT_SENSITIVE_KEY = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|credential|cookie|session)/i;
const REPORT_PATH_KEY = /(?:localPath|absolutePath|fileName|filename|artifactPath|sourcePath)/i;
const REPORT_URL_KEY = /(?:url|uri|href|sourceYoutubeUrl)$/i;

function safeReportUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return null;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|secret|password|credential|auth|signature|api[_-]?key)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function reportPathLike(value: string): boolean {
  return /^(?:file:|[\\/]|[A-Za-z]:[\\/]|~[\\/]|\.\.?[\\/])/.test(value.trim());
}

/** Defensive redaction for the serialized research artifact. */
function redactReportValue(value: unknown, key = ""): unknown {
  if (REPORT_SENSITIVE_KEY.test(key) || REPORT_PATH_KEY.test(key)) return undefined;
  if (typeof value === "string") {
    if (reportPathLike(value)) return undefined;
    if (REPORT_URL_KEY.test(key) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return safeReportUrl(value) ?? undefined;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item, key)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = redactReportValue(childValue, childKey);
      if (sanitized !== undefined) output[childKey] = sanitized;
    }
    return output;
  }
  return value;
}

function localInputSortKey(input: LocalSymbolicInput): string {
  return JSON.stringify(stable({
    id: input.id ?? null,
    format: input.format,
    title: input.title?.trim() ?? null,
    sourceType: input.sourceType ?? null,
    durationSeconds: finite(input.durationSeconds) ? input.durationSeconds : null,
    discoveredBy: [...(input.discoveredBy ?? [])].sort(),
  }));
}

function uniqueLocalInputs(inputs: readonly LocalSymbolicInput[]): { inputs: LocalSymbolicInput[]; collisions: string[] } {
  const groups = new Map<string, LocalSymbolicInput[]>();
  for (const input of inputs) {
    const id = logicalLocalId(input);
    const group = groups.get(id) ?? [];
    group.push(input);
    groups.set(id, group);
  }
  const collisions: string[] = [];
  const unique: LocalSymbolicInput[] = [];
  for (const [id, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const hashes = new Set(group.map((item) => sha256Hex(item.bytes)));
    if (hashes.size > 1 && group.some((item) => Boolean(item.id && /^local:[A-Za-z0-9_-]{16,128}$/.test(item.id)))) {
      collisions.push("local candidate id collision normalized by content hash");
      unique.push(...[...group]
        .sort((a, b) => localInputSortKey(a).localeCompare(localInputSortKey(b)))
        .map((item) => ({ ...item, id: undefined })));
    } else {
      unique.push([...group].sort((a, b) => localInputSortKey(a).localeCompare(localInputSortKey(b)))[0]!);
    }
  }
  return { inputs: unique, collisions };
}

function logicalLocalId(input: LocalSymbolicInput): string {
  return input.id && /^local:[A-Za-z0-9_-]{16,128}$/.test(input.id)
    ? input.id
    : "local:" + sha256Hex(input.bytes);
}

function localCandidate(input: LocalSymbolicInput, song: SongIdentity): ArrangementCandidate {
  const hash = sha256Hex(input.bytes);
  const id = logicalLocalId(input);
  const sourceType = input.sourceType ?? (input.format === "musicxml" ? "musicxml" : "midi");
  const provenance: SourceProvenance = {
    kind: "local",
    acquiredVia: "submitted-local",
    sourceRef: id,
  };
  return {
    id,
    sourceType,
    title: input.title?.trim() && !reportPathLike(input.title.trim()) ? input.title.trim() : song.title + " local symbolic candidate",
    url: null,
    provenance,
    ...(finite(input.durationSeconds) ? { durationSeconds: input.durationSeconds } : {}),
    version: hash.slice(0, 12),
    selection: "preferred",
  };
}

function youtubeCandidate(input: YoutubeDiscoveryCandidate, discoveredBy: readonly string[] | undefined): ArrangementCandidate {
  const url = "https://www.youtube.com/watch?v=" + input.videoId;
  return classifyArrangementCandidate({
    id: "youtube:" + input.videoId,
    sourceType: "piano-cover-video",
    title: input.title,
    url,
    provenance: {
      kind: "youtube",
      acquiredVia: "youtube-search",
      sourceRef: "youtube:" + input.videoId,
      sourceYoutubeUrl: url,
    },
    durationSeconds: input.durationSeconds,
    confidence: input.isLive ? 0 : 0.5,
    selection: "preferred",
    ...(discoveredBy?.length ? { reasons: [...new Set(discoveredBy)].sort() } : {}),
  }, { overrideSourceType: true });
}

function directFallback(song: SongIdentity): ArrangementCandidate {
  return {
    id: "metal-transcription:" + song.id,
    sourceType: "metal-transcription",
    title: song.title + " direct metal transcription",
    provenance: {
      kind: "metal-transcription",
      acquiredVia: "audio-transcription",
      sourceRef: "metal-transcription:" + song.id,
    },
    selection: "fallback",
    fallbackTier: 1,
  };
}

function artifactFromScore(id: string, selector: string, bytes: Uint8Array, format: string, score: NormalizedSymbolicScore): ResearchSymbolicArtifact {
  return {
    id,
    selector,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    format,
    parser: {
      format: score.format,
      division: score.division,
      tempoBpm: score.tempoBpm,
      durationBeats: score.durationBeats,
      noteCount: score.notes.length,
      onsetCount: score.onsetCount,
      timeSig: score.timeSig,
      ...(score.title ? { title: score.title } : {}),
    },
    ...(score.warnings.length ? { warnings: [...score.warnings] } : {}),
  };
}

function artifactError(id: string, selector: string, bytes: Uint8Array, format: string, error: unknown): ResearchSymbolicArtifact {
  return {
    id,
    selector,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    format,
    error: safeError(error, "symbolic candidate could not be parsed"),
  };
}

function parseLocalSymbolicInput(input: LocalSymbolicInput): NormalizedSymbolicScore {
  if (input.format === "midi") return parseSymbolicCandidate(input.bytes, "midi");
  if (input.format === "musicxml") {
    const xml = new TextDecoder().decode(input.bytes);
    return parseSymbolicCandidate(xml, "musicxml");
  }
  if (input.format === "mxl") throw new Error("MXL containers are unsupported; unpack to MusicXML before local evaluation");
  throw new Error("unsupported local symbolic format");
}

function normalizeDiscoveryErrors(errors: readonly string[]): string[] {
  return [...new Set(errors.map((error) => safeError(error, "source discovery failed")))].sort();
}

function humanAcceptance(input: HumanAcceptanceInput | undefined): ResearchReport["humanAcceptance"] {
  if (!input) return { status: "not-supplied" };
  return {
    status: input.verdict,
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
    ...(finite(input.raterCount) && input.raterCount >= 0 ? { raterCount: Math.floor(input.raterCount) } : {}),
  };
}

export function buildResearchReport(input: ResearchReportInput): ResearchReport {
  const song = identity(input.song);
  const localInputResult = uniqueLocalInputs(input.localCandidates ?? []);
  const localInputs = localInputResult.inputs;
  const discovered = (input.discoveryCandidates ?? [])
    .map((candidate) => youtubeCandidate(candidate, input.discoveredBy?.[candidate.videoId]))
    .sort((a, b) => a.id.localeCompare(b.id));
  const local = localInputs.map((candidate) => localCandidate(candidate, song));
  const allCandidates = [...discovered, ...local, directFallback(song)];
  const artifacts: ResearchSymbolicArtifact[] = [];
  const scores = new Map<string, NormalizedSymbolicScore>();
  const failedLocalIds = new Set<string>();
  for (const localInput of localInputs) {
    const id = logicalLocalId(localInput);
    const selector = id;
    try {
      const score = parseLocalSymbolicInput(localInput);
      scores.set(id, score);
      artifacts.push(artifactFromScore(id, selector, localInput.bytes, formatForCandidate(localInput), score));
    } catch (error) {
      failedLocalIds.add(id);
      artifacts.push(artifactError(id, selector, localInput.bytes, formatForCandidate(localInput), error));
    }
  }
  let referenceScore: NormalizedSymbolicScore | undefined;
  if (input.reference) {
    const referenceHash = sha256Hex(input.reference.bytes);
    const referenceId = input.reference.id && /^reference:[A-Za-z0-9_-]{16,128}$/.test(input.reference.id)
      ? input.reference.id
      : "reference:" + referenceHash;
    const referenceSelector = "reference:" + referenceHash;
    try {
      referenceScore = parseLocalSymbolicInput({ bytes: input.reference.bytes, format: input.reference.format ?? "midi" });
      artifacts.push(artifactFromScore(referenceId, referenceSelector, input.reference.bytes, input.reference.format ?? "midi", referenceScore));
    } catch (error) {
      artifacts.push(artifactError(referenceId, referenceSelector, input.reference.bytes, input.reference.format ?? "midi", error));
    }
  }
  const ranked = rankArrangementCandidates(song, allCandidates);
  const preferred = ranked.filter((candidate) => candidate.selection !== "fallback" && !failedLocalIds.has(candidate.id));
  const fallback = ranked.find((candidate) => candidate.sourceType === "metal-transcription")?.id ?? null;
  const alignments: Record<string, SymbolicAlignmentResult> = {};
  if (referenceScore) {
    for (const [id, score] of [...scores.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      alignments[id] = alignSymbolicScores(referenceScore, score, input.alignmentOptions);
    }
  }
  const report: ResearchReport = {
    schemaVersion: 1,
    song,
    queries: buildResearchQueries(song).sort(),
    candidates: ranked,
    discoveryErrors: normalizeDiscoveryErrors([...(input.discoveryErrors ?? []), ...localInputResult.collisions]),
    discoveredBy: Object.fromEntries(
      Object.entries(input.discoveredBy ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([videoId, queries]) => ["youtube:" + videoId, [...new Set(queries)].sort()]),
    ),
    recommended: preferred.map((candidate) => candidate.id),
    fallback,
    symbolicArtifacts: artifacts.sort((a, b) => a.id.localeCompare(b.id)),
    alignments,
    humanAcceptance: humanAcceptance(input.humanAcceptance),
  };
  return report;
}

export async function runResearch(input: ResearchRunOptions): Promise<ResearchRunResult> {
  const song = identity(input.song);
  const discoveryCandidates: YoutubeDiscoveryCandidate[] = [...(input.discoveryCandidates ?? [])];
  const discoveryErrors = [...(input.discoveryErrors ?? [])];
  const discoveredBy = new Map<string, Set<string>>();
  for (const [videoId, queries] of Object.entries(input.discoveredBy ?? {})) {
    discoveredBy.set(videoId, new Set(queries));
  }
  if (!input.noNetwork && !input.discoveryCandidates?.length) {
    const search = input.search ?? searchYoutubeCandidates;
    for (const query of buildResearchQueries(song)) {
      try {
        const found = await search(query, Math.max(1, Math.min(20, Math.floor(input.limit ?? 8))));
        discoveryCandidates.push(...found);
        for (const candidate of found) {
          const queries = discoveredBy.get(candidate.videoId) ?? new Set<string>();
          queries.add(query);
          discoveredBy.set(candidate.videoId, queries);
        }
      } catch (error) {
        discoveryErrors.push("query failed: " + safeError(error, "source discovery failed"));
      }
    }
  }
  const report = buildResearchReport({
    ...input,
    discoveryCandidates,
    discoveryErrors,
    discoveredBy: Object.fromEntries([...discoveredBy.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, queries]) => [id, [...queries].sort()])),
  });
  return { report, json: serializeResearchReport(report) };
}
