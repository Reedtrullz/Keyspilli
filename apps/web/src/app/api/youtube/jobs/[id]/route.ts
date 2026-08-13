import { NextResponse } from "next/server";
import { getDb } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getDb().prepare("DELETE FROM conversion_jobs WHERE id = ?").run(id);
  if (!r.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
