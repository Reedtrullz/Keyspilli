import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import type { GenericSourceCandidate } from "@keyspilli/catalog";
import { GET } from "./route";
import { setSourceCandidateProviderForTests } from "../../../lib/source-candidate-provider";

const candidate = {
  schemaVersion: 1,
  candidateId: "lead-1",
  targetId: "target-open-song",
  candidateClass: "GENERATION_CANDIDATE",
  sourceKind: "REMOTE_METADATA",
  sourceOrigin: "search",
  sourceRef: "https://example.test/open-song.mid?token=removed",
  sourceSHA256: null,
  byteLength: null,
  mediaType: "audio/midi",
  symbolicFormat: "midi",
  resultTitle: "Open Band - Open Song MIDI",
  resultSnippet: "structured lead",
  provider: "metadata-provider",
  candidateVersionQualifiers: [],
  identityConfidence: 1,
  versionConfidence: 0.85,
  formatConfidence: 1,
  roleConfidence: 0.8,
  identity: "IDENTITY_EXACT",
  version: "VERSION_COMPATIBLE",
  evidenceClass: "STRUCTURED_MIDI",
  timing: "UNKNOWN_TIMING",
  rights: "UNKNOWN_RIGHTS",
  access: "PUBLIC_PAGE_NO_DIRECT_FILE",
  roles: ["piano"],
  region: "full",
  parseStatus: "metadata-only",
  userSupplied: false,
  projectOwned: false,
  remoteApproved: false,
  alignmentRequired: true,
  generationReady: false,
  eligibility: "USER_MEDIATED_CANDIDATE",
  searchRank: 1,
  reasons: [],
  rankingReasons: ["identity match"],
  rankingTier: 1,
  metadata: { candidateArtist: "Open Band", candidateTitle: "Open Song", query: null, noteCount: null, trackCount: null, durationBeats: null, tempoBpm: null, versionLabel: null },
} as GenericSourceCandidate;

afterEach(() => setSourceCandidateProviderForTests(null));

describe("source candidate route", () => {
  const url = "https://keys.reidar.tech/api/source-candidates?targetId=target-open-song&artist=Open%20Band&title=Open%20Song";

  it("reports the honest provider-missing state", async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "provider-missing", candidates: [] });
  });

  it("returns at most ranked metadata cards without downloading bytes", async () => {
    setSourceCandidateProviderForTests(() => [candidate]);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ candidateId: "lead-1", candidateUrl: "https://example.test/open-song.mid" });
    expect(body.candidates[0]).not.toHaveProperty("sourceSHA256");
  });

  it("fails closed when the provider throws", async () => {
    setSourceCandidateProviderForTests(() => { throw new Error("provider unavailable"); });
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "source candidate provider failed" });
  });
});
