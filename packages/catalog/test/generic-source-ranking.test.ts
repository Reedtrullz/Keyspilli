import { describe, expect, it } from "vitest";
import {
  canonicalGenericDiscoveryJson,
  classifyGenericSourceCandidate,
  rankGenericSourceCandidates,
  summarizeGenericDiscovery,
  type GenericSourceCandidateInput,
  type GenericSongTarget,
} from "../src/generic-source-ranking.js";

const target: GenericSongTarget = {
  id: "open-song",
  artist: "Open Band",
  title: "Open Song",
};

function draft(overrides: Partial<GenericSourceCandidateInput> = {}): GenericSourceCandidateInput {
  return {
    candidateId: "candidate",
    sourceRef: "https://example.test/open-song.mid",
    resultTitle: "Open Band - Open Song MIDI",
    provider: "web",
    apparentFormat: "mid",
    access: "DIRECT_FILE_PUBLIC",
    rights: "OPEN_LICENSE_EXPLICIT",
    timing: "NATIVE_AUTHORITATIVE",
    parseStatus: "parsed",
    roles: ["melody", "piano"],
    searchRank: 1,
    ...overrides,
  };
}

describe("generic source discovery ranking", () => {
  it("rejects HTML masquerading as a symbolic file", () => {
    const result = classifyGenericSourceCandidate(target, draft({
      candidateId: "html",
      sourceRef: "https://example.test/song.mid",
      mediaType: "text/html",
      bodyPrefix: "<!doctype html><html>login</html>",
    }));
    expect(result.evidenceClass).toBe("UNKNOWN");
    expect(result.eligibility).toBe("REJECTED");
    expect(result.reasons.join(" ")).toMatch(/html|content/i);
  });

  it("keeps automatic eligibility distinct from the best relevant lead", () => {
    const ranked = rankGenericSourceCandidates(target, [
      draft({ candidateId: "open", searchRank: 5 }),
      draft({
        candidateId: "blocked-exact",
        sourceRef: "https://shop.test/open-song.mid",
        access: "PAYWALL_OR_PURCHASE",
        rights: "RESTRICTED_OR_PLATFORM_CONTROLLED",
        searchRank: 1,
      }),
      draft({
        candidateId: "wrong",
        resultTitle: "Other Band - Other Song MIDI",
        searchRank: 0,
      }),
    ]);
    expect(ranked.automatic[0]?.candidateId).toBe("open");
    expect(ranked.bestRelevantCandidateId).toBe("blocked-exact");
    expect(ranked.candidates.map((item) => item.candidateId)).toEqual([
      "open",
      "blocked-exact",
      "wrong",
    ]);
  });

  it("applies the candidate firewall before ranking", () => {
    const benchmark = classifyGenericSourceCandidate(target, draft({
      candidateId: "benchmark",
      candidateClass: "BENCHMARK_REFERENCE",
    }));
    const diagnostic = classifyGenericSourceCandidate(target, draft({
      candidateId: "diagnostic",
      candidateClass: "DIAGNOSTIC_ONLY",
    }));
    expect(benchmark.eligibility).toBe("REJECTED");
    expect(diagnostic.eligibility).toBe("REJECTED");
    expect(benchmark.reasons.join(" ")).toMatch(/benchmark/i);
  });

  it("classifies semantic-only and unsupported evidence without promoting it", () => {
    const tab = classifyGenericSourceCandidate(target, draft({
      candidateId: "tab",
      resultTitle: "Open Band Open Song guitar tab",
      apparentFormat: "tab",
      access: "PUBLIC_PAGE_NO_DIRECT_FILE",
      rights: "UNKNOWN_RIGHTS",
    }));
    const guitarPro = classifyGenericSourceCandidate(target, draft({
      candidateId: "gp",
      resultTitle: "Open Band Open Song Guitar Pro",
      apparentFormat: "gp",
      access: "PUBLIC_PAGE_WITH_DOWNLOAD",
      rights: "OPEN_LICENSE_EXPLICIT",
    }));
    expect(tab.evidenceClass).toBe("TAB");
    expect(tab.eligibility).toBe("SEMANTIC_SUPPORT_ONLY");
    expect(guitarPro.evidenceClass).toBe("STRUCTURED_GUITAR_PRO");
    expect(guitarPro.eligibility).toBe("RESEARCH_LEAD_ONLY");
  });

  it("requires explicit rights and preserves score-timing alignment requirements", () => {
    const unknownRights = classifyGenericSourceCandidate(target, draft({
      candidateId: "unknown-rights",
      rights: "UNKNOWN_RIGHTS",
      timing: "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT",
    }));
    expect(unknownRights.eligibility).toBe("USER_MEDIATED_CANDIDATE");
    expect(unknownRights.generationReady).toBe(false);

    const explicitScore = classifyGenericSourceCandidate(target, draft({
      candidateId: "open-score",
      timing: "SCORE_SYMBOLIC_REQUIRES_ALIGNMENT",
    }));
    expect(explicitScore.eligibility).toBe("SCORE_ALIGNMENT_REQUIRED");
  });

  it("normalizes punctuation and keeps featured-artist metadata from changing identity", () => {
    const result = classifyGenericSourceCandidate(
      { id: "dont", artist: "Journey", title: "Dont Stop Believin" },
      draft({
        candidateId: "featured",
        resultTitle: "Journey — Don't Stop Believin' (feat. Steve Perry) MIDI",
      }),
    );
    expect(result.identity).toBe("IDENTITY_EXACT");
    expect(result.candidateVersionQualifiers).toEqual([]);
  });

  it("is deterministic under input reordering and summarizes per-song coverage", () => {
    const inputs = [
      draft({ candidateId: "a", searchRank: 2 }),
      draft({ candidateId: "b", searchRank: 1, sourceRef: "https://example.test/b.mid" }),
    ];
    const first = rankGenericSourceCandidates(target, inputs);
    const second = rankGenericSourceCandidates(target, [...inputs].reverse());
    expect(second).toEqual(first);
    expect(canonicalGenericDiscoveryJson(first)).toBe(canonicalGenericDiscoveryJson(second));
    const summary = summarizeGenericDiscovery([{ target, result: first }]);
    expect(summary).toMatchObject({ songs: 1, discoveredSongs: 1, automaticSongs: 1, structuredSongs: 1 });
  });

  it("does not leak local paths or URL credentials into canonical metadata", () => {
    const result = classifyGenericSourceCandidate(target, draft({
      candidateId: "unsafe",
      sourceRef: "https://user:password@example.test/open-song.mid?token=secret",
      resultTitle: "/Users/reidar/private/open-song.mid",
    }));
    const json = canonicalGenericDiscoveryJson({ candidates: [result] });
    expect(json).not.toMatch(/password|Users\/reidar|token=secret/);
  });
});
