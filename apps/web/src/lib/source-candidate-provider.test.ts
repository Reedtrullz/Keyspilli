import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBraveSourceCandidateProvider,
  discoverSourceCandidates,
  hasSourceCandidateProvider,
  SourceCandidateProviderError,
  setSourceCandidateProviderForTests,
} from "./source-candidate-provider";

const target = { id: "target-1", artist: "Open Band", title: "Open Song" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  setSourceCandidateProviderForTests(null);
});

describe("Brave source candidate provider", () => {
  it("uses the frozen four-query metadata policy and feeds the deterministic ranker", async () => {
    const calls: string[] = [];
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async (input) => {
        calls.push(String(input));
        return response({
          web: {
            results: [
              {
                title: "Open Band - Open Song MIDI",
                url: "https://example.test/song.mid?token=secret#fragment",
                description: "A structured MIDI source",
              },
            ],
          },
        });
      },
      retryDelayMs: 0,
    });

    const candidates = await provider(target);

    expect(calls).toHaveLength(4);
    expect(calls[0]).toContain("q=%22Open+Band%22+%22Open+Song%22+MIDI");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      candidateId: expect.stringMatching(/^brave-/),
      sourceRef: "https://example.test/song.mid",
      provider: "brave-search-api",
      rights: "UNKNOWN_RIGHTS",
      eligibility: "USER_MEDIATED_CANDIDATE",
      timing: "UNKNOWN_TIMING",
    });
  });

  it("retries one transient response and never exposes the API key in the request URL", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      expect(String(input)).not.toContain("test-secret");
      expect(init?.headers).toMatchObject({ "X-Subscription-Token": "test-secret" });
      return attempts === 1
        ? response({ error: "busy" }, 429)
        : response({ web: { results: [] } });
    });
    const provider = createBraveSourceCandidateProvider({ apiKey: "test-secret", fetchImpl, retryDelayMs: 0 });

    await provider(target);

    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("waits through the free-plan request window between transient queries", async () => {
    let now = 0;
    let lastSuccessfulRequest = -Infinity;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () => {
      if (now - lastSuccessfulRequest < 1_000) return response({ error: "rate limited" }, 429);
      lastSuccessfulRequest = now;
      return response({ web: { results: [] } });
    });
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
    });

    await expect(provider(target)).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(sleeps).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(sleeps.every((milliseconds) => milliseconds >= 1_000)).toBe(true);
  });

  it("treats a valid Brave no-result envelope without web results as empty", async () => {
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => response({
        type: "search",
        query: { original: "no matching source" },
        mixed: { type: "mixed", main: {}, top: [], side: [] },
      }),
      retryDelayMs: 0,
    });

    await expect(provider(target)).resolves.toEqual([]);
  });

  it("bounds and sanitizes provider results before ranking them", async () => {
    let request = 0;
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => {
        request += 1;
        return response({
          web: {
            results: [
              { title: "private", url: "http://127.0.0.1/secret.mid" },
              ...Array.from({ length: 20 }, (_, index) => ({
                title: `Open Band - Open Song MIDI ${request}-${index}`,
                url: `https://example.test/song-${request}-${index}.mid`,
              })),
            ],
          },
        });
      },
      retryDelayMs: 0,
    });

    const candidates = await provider(target);

    expect(candidates).toHaveLength(36);
    expect(candidates.length).toBeLessThanOrEqual(40);
    expect(candidates.every((candidate) => candidate.sourceRef.startsWith("https://"))).toBe(true);
    expect(candidates.every((candidate) => candidate.rights === "UNKNOWN_RIGHTS")).toBe(true);
  });

  it("fails closed on malformed responses and does not retry non-transient status", async () => {
    const malformed = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => response({ web: { results: "not-an-array" } }),
      retryDelayMs: 0,
    });
    await expect(malformed(target)).rejects.toThrow("Brave response has no web results");

    let calls = 0;
    const unauthorized = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => {
        calls += 1;
        return response({ error: "no" }, 401);
      },
      retryDelayMs: 0,
    });
    await expect(unauthorized(target)).rejects.toThrow("status 401");
    expect(calls).toBe(1);
  });

  it("classifies exhausted Brave rate limits without exposing provider details", async () => {
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => response({ error: "limit" }, 429),
      retryDelayMs: 0,
    });

    await expect(provider(target)).rejects.toMatchObject({
      name: "SourceCandidateProviderError",
      code: "SOURCE_SEARCH_RATE_LIMITED",
    } satisfies Partial<SourceCandidateProviderError>);
  });

  it("bounds aborts and rejects an empty search identity before making a request", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const provider = createBraveSourceCandidateProvider({ apiKey: "test-key", fetchImpl, timeoutMs: 100, retryDelayMs: 0 });
    await expect(provider(target)).rejects.toThrow("AbortError");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const empty = createBraveSourceCandidateProvider({ apiKey: "test-key", fetchImpl, retryDelayMs: 0 });
    await expect(empty({ ...target, artist: "   " })).rejects.toThrow("source target identity is required");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("replays a frozen provider response to the same normalized candidates", async () => {
    const provider = createBraveSourceCandidateProvider({
      apiKey: "test-key",
      fetchImpl: async () => response({ web: { results: [{ title: "Open Band - Open Song MIDI", url: "https://example.test/song.mid", description: "structured" }] } }),
      retryDelayMs: 0,
    });
    const first = await provider(target);
    const second = await provider(target);
    expect(second).toEqual(first);
  });

  it("is disabled without explicit production configuration while direct provider injection remains testable", async () => {
    expect(hasSourceCandidateProvider()).toBe(false);
    setSourceCandidateProviderForTests(() => []);
    await expect(discoverSourceCandidates(target)).resolves.toEqual([]);
  });
});
