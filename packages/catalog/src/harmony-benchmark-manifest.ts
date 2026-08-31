/** Path-safe, metadata-only inputs for the local harmony benchmark. */
export const HARMONY_BENCHMARK_MANIFEST_SCHEMA_VERSION = 1 as const;
export const HARMONY_BENCHMARK_SCORE_IDS = [
  "sabaton-1916",
  "sabaton-christmas-truce",
  "sabaton-gott-mit-uns",
  "sabaton-the-caroleans-prayer",
  "sleep-token-take-me-back-to-eden",
  "unknown-free-bird",
] as const;

const ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const PATH_KEY = /(?:^|_|-)path$|(?:^|_|-)(?:file|filename|notes?)$/i;
const PATH_VALUE = /^(?:\.\.?[\\/]|[A-Za-z]:[\\/]|\/{1,2}|file:)|(?:^|[\\/])[^\\/\s]+\.(?:pdf|mid|midi|musicxml|xml|wav|mp3|flac|sf2)(?:$|[\s"'(),])/i;

export interface HarmonyBenchmarkHashMetadata {
  sha256: string;
  bytes: number;
  pages: number;
  title?: string;
  author?: string;
  creator?: string;
  producer?: string;
}

export interface HarmonyBenchmarkBackendProvenance {
  backendId: string;
  version: string;
  selectedAt?: string;
}

export interface HarmonyBenchmarkWindow {
  id: string;
  startBeat: number;
  endBeat: number;
}

export interface HarmonyBenchmarkExcludedRegion extends HarmonyBenchmarkWindow {
  reason: string;
}

export interface HarmonyBenchmarkReference {
  selectedOmr: HarmonyBenchmarkBackendProvenance;
  trustedCoverage: {
    maskSha256: string;
    referenceSha256: string;
    windows: HarmonyBenchmarkWindow[];
  };
  excludedRegions: HarmonyBenchmarkExcludedRegion[];
}

export type HarmonyBenchmarkEvidence =
  | { status: "available"; logicalId: string; sha256: string }
  | { status: "unavailable"; reason: string };

export interface HarmonyBenchmarkScoreInput {
  id: string;
  title: string;
  artist: string;
  sourcePdf: HarmonyBenchmarkHashMetadata;
  reference: HarmonyBenchmarkReference;
  candidate: HarmonyBenchmarkEvidence;
  recording: HarmonyBenchmarkEvidence;
}

export interface HarmonyBenchmarkManifestInput {
  schemaVersion: 1;
  scores: HarmonyBenchmarkScoreInput[];
}

export interface HarmonyBenchmarkManifest extends HarmonyBenchmarkManifestInput {
  kind: "harmony-benchmark-manifest";
  eligible: boolean;
  status: "available" | "unavailable";
  diagnostics: string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${name} must be a safe string`);
  const result = value.trim();
  if (PATH_VALUE.test(result) || result.includes("\\")) throw new Error(`${name} must not contain a path`);
  return result;
}

function id(value: unknown, name: string): string {
  const result = text(value, name, 120);
  if (!ID.test(result)) throw new Error(`${name} has invalid id`);
  return result;
}

function hash(value: unknown, name: string): string {
  const result = text(value, name, 64).toLowerCase();
  if (!SHA256.test(result)) throw new Error(`${name} must be a sha256 hash`);
  return result;
}

function safeUnknownKeys(value: unknown, context: string): void {
  if (Array.isArray(value)) return value.forEach((item) => safeUnknownKeys(item, context));
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (PATH_KEY.test(key) || (typeof nested === "string" && (PATH_VALUE.test(nested) || nested.includes("\\")))) {
      throw new Error(`${context} contains path-like field`);
    }
    safeUnknownKeys(nested, context);
  }
}

function windows(value: unknown, context: string): HarmonyBenchmarkWindow[] {
  if (!Array.isArray(value)) throw new Error(`${context} windows are required`);
  const seen = new Set<string>();
  const result = value.map((raw, index) => {
    const row = record(raw);
    const item = { id: id(row.id, `${context}[${index}].id`), startBeat: finite(row.startBeat, `${context}[${index}].startBeat`), endBeat: finite(row.endBeat, `${context}[${index}].endBeat`) };
    if (item.startBeat < 0 || item.endBeat <= item.startBeat) throw new Error(`${context} contains invalid window`);
    if (seen.has(item.id)) throw new Error(`${context} contains duplicate window id: ${item.id}`);
    seen.add(item.id);
    return item;
  }).sort((a, b) => a.startBeat - b.startBeat || compareCodeUnits(a.id, b.id));
  for (let index = 1; index < result.length; index += 1) if (result[index]!.startBeat < result[index - 1]!.endBeat) throw new Error(`${context} windows overlap`);
  return result;
}

function evidence(value: unknown, context: string): HarmonyBenchmarkEvidence {
  const row = record(value);
  if (row.status === "available") return { status: "available", logicalId: id(row.logicalId, `${context}.logicalId`), sha256: hash(row.sha256, `${context}.sha256`) };
  if (row.status === "unavailable") return { status: "unavailable", reason: text(row.reason, `${context}.reason`) };
  throw new Error(`${context}.status must be available or unavailable`);
}

function normalizeScore(raw: unknown): HarmonyBenchmarkScoreInput {
  const row = record(raw);
  const scoreId = id(row.id, "score.id");
  const pdf = record(row.sourcePdf);
  const reference = record(row.reference);
  const coverage = record(reference.trustedCoverage);
  const backend = record(reference.selectedOmr);
  const exclusions = Array.isArray(reference.excludedRegions) ? reference.excludedRegions : [];
  const sourcePdf: HarmonyBenchmarkHashMetadata = {
    sha256: hash(pdf.sha256, `${scoreId}.sourcePdf.sha256`), bytes: finite(pdf.bytes, `${scoreId}.sourcePdf.bytes`), pages: finite(pdf.pages, `${scoreId}.sourcePdf.pages`),
    ...(pdf.title !== undefined ? { title: text(pdf.title, `${scoreId}.sourcePdf.title`) } : {}),
    ...(pdf.author !== undefined ? { author: text(pdf.author, `${scoreId}.sourcePdf.author`) } : {}),
    ...(pdf.creator !== undefined ? { creator: text(pdf.creator, `${scoreId}.sourcePdf.creator`) } : {}),
    ...(pdf.producer !== undefined ? { producer: text(pdf.producer, `${scoreId}.sourcePdf.producer`) } : {}),
  };
  if (sourcePdf.bytes < 1 || sourcePdf.pages < 1 || !Number.isInteger(sourcePdf.bytes) || !Number.isInteger(sourcePdf.pages)) throw new Error(`${scoreId}.sourcePdf metadata invalid`);
  const trustedWindows = windows(coverage.windows, `${scoreId}.trustedCoverage`);
  if (trustedWindows.length === 0) throw new Error(`${scoreId}.trustedCoverage must contain at least one window`);
  const exclusionRows = exclusions.map((item, index) => ({ ...windows([item], `${scoreId}.excludedRegions[${index}]`)[0]!, reason: text(record(item).reason, `${scoreId}.excludedRegions[${index}].reason`) }));
  windows(exclusionRows, `${scoreId}.excludedRegions`);
  const trustedIds = new Set(trustedWindows.map((window) => window.id));
  for (const excluded of exclusionRows) {
    if (trustedIds.has(excluded.id)) throw new Error(`${scoreId} contains duplicate window id across trusted and excluded regions`);
    if (trustedWindows.some((trusted) => trusted.startBeat < excluded.endBeat && excluded.startBeat < trusted.endBeat)) {
      throw new Error(`${scoreId} excluded regions overlap trusted coverage`);
    }
  }
  return {
    id: scoreId, title: text(row.title, `${scoreId}.title`), artist: text(row.artist, `${scoreId}.artist`), sourcePdf,
    reference: { selectedOmr: {
      backendId: text(backend.backendId, `${scoreId}.selectedOmr.backendId`),
      version: text(backend.version, `${scoreId}.selectedOmr.version`),
      ...(backend.selectedAt !== undefined ? { selectedAt: text(backend.selectedAt, `${scoreId}.selectedOmr.selectedAt`) } : {}),
    }, trustedCoverage: { maskSha256: hash(coverage.maskSha256, `${scoreId}.maskSha256`), referenceSha256: hash(coverage.referenceSha256, `${scoreId}.referenceSha256`), windows: trustedWindows }, excludedRegions: exclusionRows.sort((a, b) => a.startBeat - b.startBeat || compareCodeUnits(a.id, b.id)) },
    candidate: evidence(row.candidate, `${scoreId}.candidate`), recording: evidence(row.recording, `${scoreId}.recording`),
  };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, nested]) => [key, stable(nested)]));
  return value;
}

function normalizeHarmonyBenchmarkManifestInternal(input: unknown, rejectPathLikeFields: boolean): HarmonyBenchmarkManifest {
  if (rejectPathLikeFields) safeUnknownKeys(input, "manifest");
  const root = record(input);
  if (root.schemaVersion !== HARMONY_BENCHMARK_MANIFEST_SCHEMA_VERSION || !Array.isArray(root.scores) || root.scores.length !== HARMONY_BENCHMARK_SCORE_IDS.length) {
    throw new Error("manifest must contain exactly six scores");
  }
  const scores = root.scores.map(normalizeScore).sort((a, b) => compareCodeUnits(a.id, b.id));
  const expectedIds = new Set<string>(HARMONY_BENCHMARK_SCORE_IDS);
  if (new Set(scores.map((score) => score.id)).size !== HARMONY_BENCHMARK_SCORE_IDS.length || scores.some((score) => !expectedIds.has(score.id))) {
    throw new Error("manifest must contain exactly the canonical six score identities");
  }
  const diagnostics = scores.flatMap((score) => [ ...(score.candidate.status === "unavailable" ? [`candidate evidence unavailable for ${score.id}`] : []), ...(score.recording.status === "unavailable" ? [`recording evidence unavailable for ${score.id}`] : []) ]);
  const manifest = { schemaVersion: 1 as const, kind: "harmony-benchmark-manifest" as const, scores, eligible: diagnostics.length === 0, status: diagnostics.length === 0 ? "available" as const : "unavailable" as const, diagnostics };
  return JSON.parse(JSON.stringify(stable(manifest))) as HarmonyBenchmarkManifest;
}

export function normalizeHarmonyBenchmarkManifest(input: HarmonyBenchmarkManifestInput): HarmonyBenchmarkManifest {
  return normalizeHarmonyBenchmarkManifestInternal(input, true);
}

export function canonicalHarmonyBenchmarkManifestJson(manifest: HarmonyBenchmarkManifest): string {
  return JSON.stringify(stable(normalizeHarmonyBenchmarkManifestInternal(manifest, false)), null, 2) + "\n";
}
