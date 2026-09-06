import { describe, expect, it } from "vitest";
import {
  buildResearchCacheKey,
  normalizeDiscoveryRecord,
  serializeResearchCache,
  type ProviderNeutralDiscoveryRecord,
} from "../src/research-cache.js";

const record: ProviderNeutralDiscoveryRecord = {
  url: "https://example.test/score.mid?utm_source=ignored",
  provider: "example",
  title: "Demo score",
  author: "Composer",
  apparentFormat: "midi",
  accessibility: "accessible",
  acquisitionEligibility: "eligible",
  confidence: 0.8,
};

describe("provider-neutral local research cache", () => {
  it("normalizes legal/access state and strips tracking without losing provenance", () => {
    expect(normalizeDiscoveryRecord(record)).toMatchObject({
      url: "https://example.test/score.mid",
      provider: "example",
      accessibility: "accessible",
      acquisitionEligibility: "eligible",
      confidence: 0.8,
    });
  });

  it("produces an order-independent deterministic key", () => {
    const a = buildResearchCacheKey({
      targetIdentity: { artist: "Sabaton", title: "The Red Baron" },
      query: "Sabaton The Red Baron midi",
      provider: "example",
      artifactUrl: record.url,
      artifactHash: "abc",
      parserVersion: "parser-1",
      alignmentVersion: "align-1",
    });
    const b = buildResearchCacheKey({
      alignmentVersion: "align-1", parserVersion: "parser-1", artifactHash: "abc",
      artifactUrl: record.url, provider: "example", query: "Sabaton The Red Baron midi",
      targetIdentity: { title: "The Red Baron", artist: "Sabaton" },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^research-cache:[a-f0-9]{64}$/);
  });

  it("serializes records deterministically and refuses path-like cache content", () => {
    const left = serializeResearchCache({ key: "research-cache:test", records: [record], parserVersion: "1" });
    const right = serializeResearchCache({ key: "research-cache:test", parserVersion: "1", records: [{ ...record, description: "/Users/reidar/private.mid" }, record] });
    expect(left).toBe(right);
    expect(left).not.toMatch(/Users\/reidar|private\.mid/);
  });

  it("rejects file URLs so a local artifact cannot enter provider metadata", () => {
    expect(() => normalizeDiscoveryRecord({ ...record, url: "file:///Users/reidar/private.mid" })).toThrow(/valid non-file URL/);
  });

  it("removes credential-bearing query parameters from public cache URLs", () => {
    expect(normalizeDiscoveryRecord({
      ...record,
      url: "https://example.test/score.mid?token=secret&signature=abc&auth=bad&keep=ok",
    }).url).toBe("https://example.test/score.mid?keep=ok");
  });
});
