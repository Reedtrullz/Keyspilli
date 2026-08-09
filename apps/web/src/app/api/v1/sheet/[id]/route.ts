import { NextResponse } from "next/server";
import { getArtifactFile } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const buf = await getArtifactFile(id, "variant.xml");
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.recordare.musicxml+xml" } });
}
