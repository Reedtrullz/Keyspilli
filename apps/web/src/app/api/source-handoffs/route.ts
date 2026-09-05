import { NextRequest, NextResponse } from "next/server";
import {
  createSourceCandidateHandoff,
  handoffClientView,
  saveSourceCandidateHandoff,
  type GenericSourceCandidate,
} from "@keyspilli/catalog";
import { checkMutationAuth } from "../../../lib/mutation-auth";
import { discoverSourceCandidates, hasSourceCandidateProvider } from "../../../lib/source-candidate-provider";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 64 * 1024;

async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) return null;
  const text = await req.text();
  if (text.length > MAX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function field(body: Record<string, unknown>, key: string, max = 160): string {
  return typeof body[key] === "string"
    ? body[key].replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  if (!hasSourceCandidateProvider()) {
    console.info("[source-handoff]", { event: "provider-not-configured", elapsedMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "source candidate provider is not configured", code: "SOURCE_SEARCH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const body = await jsonBody(req);
  if (!body) return NextResponse.json({ error: "invalid handoff request" }, { status: 400 });
  const target = { id: field(body, "targetId", 120), artist: field(body, "targetArtist"), title: field(body, "targetTitle") };
  const candidateId = field(body, "candidateId", 120);
  if (!target.id || !target.artist || !target.title || !candidateId) {
    return NextResponse.json({ error: "targetId, targetArtist, targetTitle, and candidateId are required" }, { status: 400 });
  }
  let candidate: GenericSourceCandidate | undefined;
  try {
    candidate = (await discoverSourceCandidates(target)).find((item) => item.candidateId === candidateId);
  } catch {
    console.info("[source-handoff]", { event: "provider-unavailable", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "source candidate provider failed", code: "SOURCE_SEARCH_UNAVAILABLE" }, { status: 503 });
  }
  if (!candidate) {
    console.info("[source-handoff]", { event: "candidate-unavailable", elapsedMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "candidate is not available for this target", code: "SOURCE_CANDIDATE_UNAVAILABLE" },
      { status: 404 },
    );
  }
  try {
    const handoff = createSourceCandidateHandoff(candidate, {
      targetSongId: target.id,
      targetArtist: target.artist,
      targetTitle: target.title,
    });
    saveSourceCandidateHandoff(handoff);
    console.info("[source-handoff]", { event: "created", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ handoff: handoffClientView(handoff) }, { status: 201 });
  } catch (error) {
    console.info("[source-handoff]", { event: "rejected", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: error instanceof Error ? error.message : "candidate handoff rejected" }, { status: 422 });
  }
}
