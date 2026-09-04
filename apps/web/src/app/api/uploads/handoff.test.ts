import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestSource = vi.hoisted(() => vi.fn());
const getSourceCandidateHandoff = vi.hoisted(() => vi.fn());
const bindSourceCandidateUpload = vi.hoisted(() => vi.fn());
const saveSourceCandidateHandoff = vi.hoisted(() => vi.fn());
const acceptSourceCandidateHandoff = vi.hoisted(() => vi.fn());
const rejectSourceCandidateHandoff = vi.hoisted(() => vi.fn());
const inferIngestFormat = vi.hoisted(() => vi.fn(() => "midi"));

vi.mock("@keyspilli/catalog", () => ({
  ingestSource,
  getSourceCandidateHandoff,
  bindSourceCandidateUpload,
  saveSourceCandidateHandoff,
  acceptSourceCandidateHandoff,
  rejectSourceCandidateHandoff,
  inferIngestFormat,
}));

import { POST } from "./route";

const handoff = {
  schemaVersion: 1,
  handoffId: "handoff-test",
  targetSongId: "target-song",
  targetArtist: "Artist",
  targetTitle: "Song",
  candidateId: "lead",
  candidateUrl: "https://example.test/song.mid",
  provider: "provider",
  identity: "IDENTITY_EXACT",
  version: "VERSION_COMPATIBLE",
  evidenceClass: "STRUCTURED_MIDI",
  expectedFormat: "midi",
  timing: "UNKNOWN_TIMING",
  roles: ["piano"],
  region: "full",
  rights: "UNKNOWN_RIGHTS",
  eligibility: "USER_MEDIATED_CANDIDATE",
  state: "AWAITING_USER_FILE",
  createdAt: "2026-09-05T12:00:00.000Z",
  expiresAt: "2099-09-05T12:00:00.000Z",
  userAffirmedTarget: true,
  discoverySourceRef: "https://example.test/song.mid",
  reasons: [],
};
const link = {
  schemaVersion: 1,
  handoffId: "handoff-test",
  selectedCandidateId: "lead",
  targetSongId: "target-song",
  userAffirmedTarget: true,
  discoverySourceRef: "https://example.test/song.mid",
  discoveryRights: "UNKNOWN_RIGHTS",
  discoveryTiming: "UNKNOWN_TIMING",
  discoveryEligibility: "USER_MEDIATED_CANDIDATE",
  uploadedSourceSha256: "a".repeat(64),
  uploadedFormat: "midi",
  intakeCandidateId: `upload-${"a".repeat(64)}`,
  uploadedProvenanceClass: "USER_SUPPLIED_PRIVATE",
  uploadedTimingAuthority: "NATIVE_AUTHORITATIVE",
};

function request(affirmed = "true") {
  return new NextRequest(`https://keys.reidar.tech/api/uploads?handoffId=handoff-test&userAffirmedTarget=${affirmed}`, {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: new Uint8Array([1, 2, 3]),
  });
}

describe("upload route source handoff binding", () => {
  beforeEach(() => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    getSourceCandidateHandoff.mockReset().mockReturnValue(handoff);
    bindSourceCandidateUpload.mockReset().mockReturnValue({ handoff: { ...handoff, state: "FILE_RECEIVED" }, link });
    saveSourceCandidateHandoff.mockReset();
    acceptSourceCandidateHandoff.mockReset().mockReturnValue({ ...handoff, state: "GENERATION_ACCEPTED" });
    rejectSourceCandidateHandoff.mockReset().mockReturnValue({ ...handoff, state: "FILE_REJECTED" });
    inferIngestFormat.mockReset().mockReturnValue("midi");
    ingestSource.mockReset();
  });

  it("requires the explicit confirmation query value", async () => {
    const response = await POST(request("false"));
    expect(response.status).toBe(400);
    expect(ingestSource).not.toHaveBeenCalled();
  });

  it("passes the server-created lineage into ingest and accepts it after success", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "upload", songIds: ["upload-e"] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(ingestSource).toHaveBeenCalledWith(expect.objectContaining({ sourceCandidateHandoff: link }));
    expect(acceptSourceCandidateHandoff).toHaveBeenCalledOnce();
    expect(saveSourceCandidateHandoff).toHaveBeenCalled();
  });

  it("records a failed handoff without publishing a result", async () => {
    ingestSource.mockResolvedValueOnce({ baseId: "", songIds: [], error: "too few notes" });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(rejectSourceCandidateHandoff).toHaveBeenCalledWith(expect.anything(), "too few notes");
    expect(acceptSourceCandidateHandoff).not.toHaveBeenCalled();
  });
});
