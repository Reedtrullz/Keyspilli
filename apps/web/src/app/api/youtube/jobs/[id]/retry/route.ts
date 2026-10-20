import { NextResponse } from "next/server";
import { getDb } from "@keyspilli/catalog";
import { checkTokenAuth } from "../../../../../../lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkTokenAuth(_req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const r = getDb()
    .prepare(
      "UPDATE conversion_jobs SET status = 'queued', error = NULL, finished_at = NULL, attempts = 0, started_at = NULL WHERE id = ?",
    )
    .run(id);
  if (!r.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
