import { NextResponse } from "next/server";
import { incrementPlays, getSong } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSong(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  incrementPlays(id);
  return NextResponse.json({ ok: true });
}
