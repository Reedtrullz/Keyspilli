import {
  rankGenericSourceCandidates,
  sanitizeGenericExternalUrl,
  sha256Hex,
  type GenericSourceCandidate,
  type GenericSourceCandidateInput,
  type GenericSongTarget,
} from "@keyspilli/catalog";

export const BRAVE_SOURCE_PROVIDER = "brave-search-api" as const;
export const BRAVE_SOURCE_QUERY_COUNT = 4 as const;
export const BRAVE_SOURCE_RESULTS_PER_QUERY = 10 as const;
export const BRAVE_SOURCE_MAX_UNIQUE_RESULTS = 40 as const;
export const BRAVE_SOURCE_MAX_DISPLAY_RESULTS = 3 as const;
export const BRAVE_SOURCE_TIMEOUT_MS = 5_000 as const;

type MaybePromise<T> = T | Promise<T>;
export type SourceCandidateProvider = (target: GenericSongTarget) => MaybePromise<readonly GenericSourceCandidate[]>;

export interface BraveSourceCandidateProviderOptions {
  apiKey: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  snippet?: unknown;
}

interface BraveResponse {
  web?: { results?: unknown };
}

const RETRIES = 1 as const;
const QUERY_SUFFIXES = ["MIDI", "MusicXML", "Guitar Pro", "piano MIDI"] as const;

let testProvider: SourceCandidateProvider | null | undefined;

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function queryPart(value: string): string {
  return cleanText(value, 120).replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

function querySet(target: GenericSongTarget): string[] {
  const artist = queryPart(target.artist);
  const title = queryPart(target.title);
  if (!artist || !title) throw new Error("source target identity is required");
  return QUERY_SUFFIXES.map((suffix) => `"${artist}" "${title}" ${suffix}`);
}

function formatHint(query: string): string {
  if (query.endsWith("MusicXML")) return "musicxml";
  if (query.endsWith("Guitar Pro")) return "guitar-pro";
  return "midi";
}

function transientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function candidateInput(
  result: BraveWebResult,
  query: string,
  rank: number,
): GenericSourceCandidateInput | null {
  const sourceRef = sanitizeGenericExternalUrl(result.url);
  const resultTitle = cleanText(result.title, 500);
  if (!sourceRef || !resultTitle) return null;
  const resultSnippet = cleanText(result.description ?? result.snippet, 500) || null;
  const id = sha256Hex(new TextEncoder().encode(sourceRef)).slice(0, 24);
  return {
    candidateId: `brave-${id}`,
    sourceRef,
    resultTitle,
    resultSnippet,
    provider: BRAVE_SOURCE_PROVIDER,
    apparentFormat: formatHint(query),
    access: "SEARCH_RESULT_ONLY",
    rights: "UNKNOWN_RIGHTS",
    timing: "UNKNOWN_TIMING",
    candidateClass: "GENERATION_CANDIDATE",
    sourceKind: "REMOTE_METADATA",
    sourceOrigin: "search",
    parseStatus: "metadata-only",
    remoteApproved: false,
    userSupplied: false,
    projectOwned: false,
    searchRank: rank,
    query,
  };
}

function responseResults(value: unknown): BraveWebResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Brave response is malformed");
  const results = (value as BraveResponse).web?.results;
  if (!Array.isArray(results)) throw new Error("Brave response has no web results");
  return results.filter((result): result is BraveWebResult => Boolean(result && typeof result === "object" && !Array.isArray(result)));
}

async function braveQuery(
  query: string,
  options: Required<Pick<BraveSourceCandidateProviderOptions, "apiKey" | "fetchImpl" | "timeoutMs" | "retryDelayMs" | "sleep">>,
): Promise<BraveWebResult[]> {
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(BRAVE_SOURCE_RESULTS_PER_QUERY));
  endpoint.searchParams.set("safesearch", "strict");
  endpoint.searchParams.set("search_lang", "en");

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        response = await options.fetchImpl(endpoint, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": options.apiKey,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (attempt < RETRIES) {
        await options.sleep(options.retryDelayMs * (attempt + 1));
        continue;
      }
      throw new Error(`Brave request failed: ${error instanceof Error ? error.name : "network error"}`);
    }
    if (transientStatus(response.status) && attempt < RETRIES) {
      await options.sleep(options.retryDelayMs * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`Brave request failed with status ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("Brave response JSON is malformed");
    }
    return responseResults(body);
  }
  throw new Error("Brave request failed");
}

export function createBraveSourceCandidateProvider(options: BraveSourceCandidateProviderOptions): SourceCandidateProvider {
  const apiKey = cleanText(options.apiKey, 256);
  if (!apiKey) throw new Error("Brave API key is required");
  const timeoutMs = options.timeoutMs ?? BRAVE_SOURCE_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 100;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error("Brave timeout is invalid");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1_000) throw new Error("Brave retry delay is invalid");
  const configured = {
    apiKey,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs,
    retryDelayMs,
    sleep: options.sleep ?? waitFor,
  };
  return async (target) => {
    const inputs = new Map<string, GenericSourceCandidateInput>();
    for (const [queryIndex, query] of querySet(target).entries()) {
      const results = await braveQuery(query, configured);
      for (const [resultIndex, result] of results.slice(0, BRAVE_SOURCE_RESULTS_PER_QUERY).entries()) {
        const input = candidateInput(result, query, queryIndex * BRAVE_SOURCE_RESULTS_PER_QUERY + resultIndex + 1);
        if (input && !inputs.has(input.sourceRef)) inputs.set(input.sourceRef, input);
        if (inputs.size >= BRAVE_SOURCE_MAX_UNIQUE_RESULTS) break;
      }
      if (inputs.size >= BRAVE_SOURCE_MAX_UNIQUE_RESULTS) break;
    }
    return rankGenericSourceCandidates(target, [...inputs.values()]).candidates;
  };
}

function configuredProductionProvider(): SourceCandidateProvider | null {
  if (process.env.KEYSPILLI_SOURCE_SEARCH_PROVIDER?.trim().toLowerCase() !== "brave") return null;
  const apiKey = process.env.KEYSPILLI_SOURCE_SEARCH_API_KEY;
  return apiKey?.trim() ? createBraveSourceCandidateProvider({ apiKey }) : null;
}

export function setSourceCandidateProviderForTests(next: SourceCandidateProvider | null): void {
  testProvider = next;
}

export function hasSourceCandidateProvider(): boolean {
  return (testProvider === undefined ? configuredProductionProvider() : testProvider) !== null;
}

export async function discoverSourceCandidates(target: GenericSongTarget): Promise<GenericSourceCandidate[]> {
  const selected = testProvider === undefined ? configuredProductionProvider() : testProvider;
  if (!selected) return [];
  const candidates = await selected(target);
  return [...candidates]
    .filter((candidate) => candidate.targetId === target.id)
    .sort((left, right) =>
      (left.searchRank - right.searchRank) ||
      (left.rankingTier - right.rankingTier) ||
      (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0),
    )
    .slice(0, BRAVE_SOURCE_MAX_DISPLAY_RESULTS);
}
