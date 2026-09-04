import { NextRequest, NextResponse } from "next/server";
import {
  affirmSourceCandidateHandoff,
  getSourceCandidateHandoff,
  handoffClientView,
  saveSourceCandidateHandoff,
} from "@keyspilli/catalog";
import { checkMutationAuth } from "../../../../../lib/mutation-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  const params = await context.params;
  const handoff = getSourceCandidateHandoff(params.id);
  if (!handoff || handoff.state === "EXPIRED") return NextResponse.json({ error: "source candidate handoff not found or expired" }, { status: 404 });
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).userAffirmedTarget !== true) {
    return NextResponse.json({ error: "userAffirmedTarget=true is required" }, { status: 400 });
  }
  try {
    const affirmed = affirmSourceCandidateHandoff(handoff);
    saveSourceCandidateHandoff(affirmed);
    return NextResponse.json({ handoff: handoffClientView(affirmed) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "handoff confirmation failed" }, { status: 422 });
  }
}
