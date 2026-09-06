import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenericSourceCandidate } from "@keyspilli/catalog";
import { listSourceCandidateHandoffs } from "@keyspilli/catalog";
import { POST } from "./route";
import { POST as confirm } from "./[id]/confirm/route";
import { setSourceCandidateProviderForTests } from "../../../lib/source-candidate-provider";

const dataRoot = mkdtempSync(join(tmpdir(), "keyspilli-web-handoff-"));
const previousDataRoot = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = dataRoot;
process.env.KEYSPILLI_API_TOKEN = "test-token";

const candidate = {
  schemaVersion: 1,
  candidateId: "lead-route",
  targetId: "target-route-song",
  candidateClass: "GENERATION_CANDIDATE",
  sourceKind: "REMOTE_METADATA",
  sourceOrigin: "search",
  sourceRef: "https://example.test/route-song.mid",
  sourceSHA256: null,
  byteLength: null,
  mediaType: "audio/midi",
  symbolicFormat: "midi",
  resultTitle: "Route Band - Route Song MIDI",
  resultSnippet: null,
  provider: "test-provider",
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
  rankingReasons: [],
  rankingTier: 1,
  metadata: { candidateArtist: "Route Band", candidateTitle: "Route Song", query: null, noteCount: null, trackCount: null, durationBeats: null, tempoBpm: null, versionLabel: null },
} as GenericSourceCandidate;

const request = (body: unknown, url = "https://keys.reidar.tech/api/source-handoffs") => new NextRequest(url, {
  method: "POST",
  headers: { authorization: "Bearer test-token", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(() => setSourceCandidateProviderForTests(() => [candidate]));
afterEach(() => setSourceCandidateProviderForTests(() => [candidate]));
afterAll(async () => {
  setSourceCandidateProviderForTests(null);
  if (previousDataRoot === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previousDataRoot;
  await rm(dataRoot, { recursive: true, force: true });
});

describe("source handoff routes", () => {
  it("accepts a handoff through the production reverse-proxy header contract", async () => {
    const response = await POST(new NextRequest("http://internal-web:3000/api/source-handoffs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "keys.reidar.tech",
        origin: "https://keys.reidar.tech",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "keys.reidar.tech",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        targetId: "target-route-song",
        targetArtist: "Route Band",
        targetTitle: "Route Song",
        candidateId: "lead-route",
      }),
    }));

    expect(response.status).toBe(201);
  });

  it("rejects a cross-origin proxied handoff without creating durable state", async () => {
    const before = listSourceCandidateHandoffs().length;
    const response = await POST(new NextRequest("http://internal-web:3000/api/source-handoffs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "keys.reidar.tech",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": "keys.reidar.tech",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        targetId: "target-route-song",
        targetArtist: "Route Band",
        targetTitle: "Route Song",
        candidateId: "lead-route",
      }),
    }));

    expect(response.status).toBe(403);
    expect(listSourceCandidateHandoffs()).toHaveLength(before);
  });

  it("creates a server-owned handoff and requires explicit confirmation", async () => {
    const response = await POST(request({
      targetId: "target-route-song",
      targetArtist: "Route Band",
      targetTitle: "Route Song",
      candidateId: "lead-route",
      candidate: { sourceRef: "https://attacker.example/evil.mid" },
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.handoff).toMatchObject({ candidateId: "lead-route", userAffirmedTarget: false, candidateUrl: "https://example.test/route-song.mid" });
    const id = body.handoff.handoffId as string;

    const missingConfirmation = await confirm(request({ userAffirmedTarget: false }, `https://keys.reidar.tech/api/source-handoffs/${id}/confirm`), { params: Promise.resolve({ id }) });
    expect(missingConfirmation.status).toBe(400);
    await expect(missingConfirmation.json()).resolves.toMatchObject({ code: "SOURCE_HANDOFF_AFFIRMATION_REQUIRED" });
    const confirmed = await confirm(request({ userAffirmedTarget: true }, `https://keys.reidar.tech/api/source-handoffs/${id}/confirm`), { params: Promise.resolve({ id }) });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({ handoff: { handoffId: id, userAffirmedTarget: true, state: "AWAITING_USER_FILE" } });
  });

  it("rejects the route without the mutation authorization contract", async () => {
    const response = await POST(new NextRequest("https://keys.reidar.tech/api/source-handoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: "target-route-song", targetArtist: "Route Band", targetTitle: "Route Song", candidateId: "lead-route" }),
    }));
    expect(response.status).toBe(401);
  });

  it("reports provider configuration failure separately", async () => {
    setSourceCandidateProviderForTests(null);
    const response = await POST(request({
      targetId: "target-route-song",
      targetArtist: "Route Band",
      targetTitle: "Route Song",
      candidateId: "lead-route",
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "source candidate provider is not configured",
      code: "SOURCE_SEARCH_NOT_CONFIGURED",
    });
  });

  it("fails closed when the provider throws", async () => {
    setSourceCandidateProviderForTests(() => { throw new Error("provider unavailable"); });
    const response = await POST(request({
      targetId: "target-route-song",
      targetArtist: "Route Band",
      targetTitle: "Route Song",
      candidateId: "lead-route",
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "source candidate provider failed", code: "SOURCE_SEARCH_UNAVAILABLE" });
  });

  it("distinguishes an unavailable candidate from provider failure", async () => {
    setSourceCandidateProviderForTests(() => []);
    const response = await POST(request({
      targetId: "target-route-song",
      targetArtist: "Route Band",
      targetTitle: "Route Song",
      candidateId: "lead-route",
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "candidate is not available for this target",
      code: "SOURCE_CANDIDATE_UNAVAILABLE",
    });
  });

  it("reports a missing or expired handoff with a stable code", async () => {
    const response = await confirm(request({ userAffirmedTarget: true }, "https://keys.reidar.tech/api/source-handoffs/missing/confirm"), { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "source candidate handoff not found or expired",
      code: "SOURCE_HANDOFF_EXPIRED",
    });
  });
});
