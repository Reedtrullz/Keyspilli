import { NextRequest, NextResponse } from "next/server";
import { sanitizeGenericExternalUrl, type GenericSongTarget, type GenericSourceCandidate } from "@keyspilli/catalog";
import { discoverSourceCandidates, hasSourceCandidateProvider, SourceCandidateProviderError } from "../../../lib/source-candidate-provider";

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

function card(candidate: GenericSourceCandidate) {
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
  const startedAt = Date.now();
  const target = targetFromRequest(req);
  if (!target) return NextResponse.json({ error: "targetId, artist, and title are required" }, { status: 400 });
  if (!hasSourceCandidateProvider()) {
    console.info("[source-discovery]", { event: "provider-not-configured", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ status: "provider-not-configured", candidates: [] });
  }
  try {
    const candidates = (await discoverSourceCandidates(target))
      .filter((candidate) => candidate.candidateClass === "GENERATION_CANDIDATE" && !["BENCHMARK_REFERENCE", "DIAGNOSTIC_ONLY"].includes(candidate.rights))
      .map(card)
      .filter((candidate) => candidate.candidateUrl !== null);
    const status = candidates.length ? "candidates-found" : "no-candidates";
    console.info("[source-discovery]", { event: status, candidateCount: candidates.length, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ status, candidates });
  } catch (error) {
    if (error instanceof SourceCandidateProviderError && error.code === "SOURCE_SEARCH_RATE_LIMITED") {
      console.info("[source-discovery]", { event: "rate-limited", elapsedMs: Date.now() - startedAt });
      return NextResponse.json(
        { error: "Source search is temporarily rate limited. Try again shortly.", code: error.code },
        { status: 429 },
      );
    }
    console.info("[source-discovery]", { event: "provider-unavailable", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Source search is temporarily unavailable.", code: "SOURCE_SEARCH_UNAVAILABLE" }, { status: 503 });
  }
}
