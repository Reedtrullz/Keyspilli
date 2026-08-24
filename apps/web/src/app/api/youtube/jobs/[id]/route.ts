import { NextResponse } from "next/server";
import { getDb } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

function checkAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) return null; // no auth configured, allow
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkAuth(_req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const r = getDb().prepare("DELETE FROM conversion_jobs WHERE id = ?").run(id);
  if (!r.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
