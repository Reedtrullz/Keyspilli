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
  const startedAt = Date.now();
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  const params = await context.params;
  const handoff = getSourceCandidateHandoff(params.id);
  if (!handoff || handoff.state === "EXPIRED") {
    console.info("[source-handoff]", { event: "confirmation-expired", elapsedMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "source candidate handoff not found or expired", code: "SOURCE_HANDOFF_EXPIRED" },
      { status: 404 },
    );
  }
  let body: unknown = null;
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).userAffirmedTarget !== true) {
    console.info("[source-handoff]", { event: "confirmation-missing", elapsedMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "userAffirmedTarget=true is required", code: "SOURCE_HANDOFF_AFFIRMATION_REQUIRED" },
      { status: 400 },
    );
  }
  try {
    const affirmed = affirmSourceCandidateHandoff(handoff);
    saveSourceCandidateHandoff(affirmed);
    console.info("[source-handoff]", { event: "confirmed", elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ handoff: handoffClientView(affirmed) });
  } catch (error) {
    console.info("[source-handoff]", { event: "confirmation-rejected", elapsedMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "handoff confirmation failed", code: "SOURCE_HANDOFF_CONFIRMATION_REJECTED" },
      { status: 422 },
    );
  }
}
