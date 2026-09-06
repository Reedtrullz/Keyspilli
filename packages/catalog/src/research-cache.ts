import { sha256Hex } from "./fixture-evidence.js";

export type DiscoveryAccessibility = "accessible" | "restricted" | "login-required" | "not-found" | "unknown";
export type AcquisitionEligibility = "eligible" | "metadata-only" | "ineligible" | "unknown";
export type DiscoveryLegalStatus = "unknown" | "permitted" | "metadata-only" | "restricted" | "prohibited";

/** Provider-neutral metadata. It contains no downloaded bytes or local paths. */
export interface ProviderNeutralDiscoveryRecord {
  url: string;
  provider: string;
  title: string;
  author?: string;
  description?: string;
  apparentFormat?: string;
  apparentSong?: string;
  accessibility: DiscoveryAccessibility;
  acquisitionEligibility: AcquisitionEligibility;
  legalStatus?: DiscoveryLegalStatus;
  confidence?: number;
  query?: string;
  artifactHash?: string;
}

export interface ResearchCacheKeyInput {
  targetIdentity: Record<string, unknown>;
  query?: string;
  provider?: string;
  artifactUrl?: string;
  artifactHash?: string;
  parserVersion?: string;
  alignmentVersion?: string;
}

export interface ResearchCache {
  key: string;
  parserVersion?: string;
  alignmentVersion?: string;
  records: readonly ProviderNeutralDiscoveryRecord[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function cleanUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$|token$|secret$|password$|auth(?:orization)?$|signature$|sig$|api[_-]?key$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/(?:^|[\s"'(:])(?:[A-Za-z]:[\\/]|~?[\\/]|\.\.?[\\/])|\.(?:mid|midi|musicxml|xml|mp3|wav|flac)(?:$|[\s"'):,])/i.test(value)) return undefined;
  return value.trim().slice(0, 2000);
}

export function normalizeDiscoveryRecord(input: ProviderNeutralDiscoveryRecord): ProviderNeutralDiscoveryRecord {
  const url = cleanUrl(input.url);
  if (!url) throw new Error("discovery record requires a valid non-file URL");
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence)) : undefined;
  return {
    url,
    provider: input.provider.trim().slice(0, 120),
    title: input.title.trim().slice(0, 500),
    ...(safeText(input.author) ? { author: safeText(input.author) } : {}),
    ...(safeText(input.description) ? { description: safeText(input.description) } : {}),
    ...(safeText(input.apparentFormat) ? { apparentFormat: safeText(input.apparentFormat) } : {}),
    ...(safeText(input.apparentSong) ? { apparentSong: safeText(input.apparentSong) } : {}),
    accessibility: input.accessibility,
    acquisitionEligibility: input.acquisitionEligibility,
    ...(input.legalStatus ? { legalStatus: input.legalStatus } : {}),
    ...(confidence === undefined ? {} : { confidence }),
    ...(safeText(input.query) ? { query: safeText(input.query) } : {}),
    ...(input.artifactHash && /^[a-f0-9]{64}$/i.test(input.artifactHash) ? { artifactHash: input.artifactHash.toLowerCase() } : {}),
  };
}

export function buildResearchCacheKey(input: ResearchCacheKeyInput): string {
  const payload = stable({
    targetIdentity: input.targetIdentity,
    query: input.query ?? null,
    provider: input.provider ?? null,
    artifactUrl: input.artifactUrl ? cleanUrl(input.artifactUrl) : null,
    artifactHash: input.artifactHash ?? null,
    parserVersion: input.parserVersion ?? null,
    alignmentVersion: input.alignmentVersion ?? null,
  });
  return "research-cache:" + sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
}

export function serializeResearchCache(cache: ResearchCache): string {
  const records = cache.records.map(normalizeDiscoveryRecord)
    .sort((a, b) => JSON.stringify(stable(a)).localeCompare(JSON.stringify(stable(b))));
  const unique = records.filter((record, index) => index === 0 || JSON.stringify(stable(record)) !== JSON.stringify(stable(records[index - 1])));
  return JSON.stringify(stable({ schemaVersion: 1, key: cache.key, parserVersion: cache.parserVersion ?? null, alignmentVersion: cache.alignmentVersion ?? null, records: unique }), null, 2) + "\n";
}
