import { NextResponse } from "next/server";
import { getDb, getJob } from "@keyspilli/catalog";
import { requireBearer } from "../../../../../../lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = requireBearer(_req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const r = getDb()
    .prepare(
      `UPDATE conversion_jobs SET status = 'queued', error = NULL, finished_at = NULL, attempts = 0,
       started_at = NULL, lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ? AND status = 'error' AND song_id IS NULL AND error IS NOT NULL
       AND error NOT LIKE '%SOURCE_REVIEW_REQUIRED:%'
       AND error NOT LIKE '%ARTIFACT_RECONCILIATION_REQUIRED%'
       AND error != 'TUTORIAL_PREVIEW_CANCELLED'`,
    )
    .run(id);
  if (!r.changes) return NextResponse.json({ error: getJob(id) ? "Job is not retryable" : "not found" }, { status: getJob(id) ? 409 : 404 });
  return NextResponse.json({ ok: true });
}
