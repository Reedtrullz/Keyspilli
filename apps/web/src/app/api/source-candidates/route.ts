import { NextRequest, NextResponse } from "next/server";
import { sanitizeGenericExternalUrl, type GenericSongTarget } from "@keyspilli/catalog";
import { discoverSourceCandidates, hasSourceCandidateProvider } from "../../../lib/source-candidate-provider";

export const dynamic = "force-dynamic";

function text(value: string | null, max = 160): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function targetFromRequest(req: NextRequest): GenericSongTarget | null {
  const id = text(req.nextUrl.searchParams.get("targetId"), 120);
  const artist = text(req.nextUrl.searchParams.get("artist"));
  const title = text(req.nextUrl.searchParams.get("title"));
  return id && artist && title ? { id, artist, title } : null;
}

function card(candidate: ReturnType<typeof discoverSourceCandidates>[number]) {
  return {
    candidateId: candidate.candidateId,
    targetId: candidate.targetId,
    resultTitle: candidate.resultTitle,
    resultSnippet: candidate.resultSnippet,
    provider: candidate.provider,
    candidateUrl: sanitizeGenericExternalUrl(candidate.sourceRef),
    symbolicFormat: candidate.symbolicFormat,
    identity: candidate.identity,
    version: candidate.version,
    evidenceClass: candidate.evidenceClass,
    timing: candidate.timing,
    rights: candidate.rights,
    eligibility: candidate.eligibility,
    roles: candidate.roles,
    region: candidate.region,
    rankingTier: candidate.rankingTier,
    rankingReasons: candidate.rankingReasons,
  };
}

export async function GET(req: NextRequest) {
  const target = targetFromRequest(req);
  if (!target) return NextResponse.json({ error: "targetId, artist, and title are required" }, { status: 400 });
  if (!hasSourceCandidateProvider()) return NextResponse.json({ status: "provider-missing", candidates: [] });
  try {
    const candidates = discoverSourceCandidates(target)
      .filter((candidate) => candidate.candidateClass === "GENERATION_CANDIDATE" && !["BENCHMARK_REFERENCE", "DIAGNOSTIC_ONLY"].includes(candidate.rights))
      .map(card)
      .filter((candidate) => candidate.candidateUrl !== null);
    return NextResponse.json({ status: "ready", candidates });
  } catch {
    return NextResponse.json({ error: "source candidate provider failed" }, { status: 503 });
  }
}
