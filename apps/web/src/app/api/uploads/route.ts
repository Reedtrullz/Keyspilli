import { NextRequest, NextResponse } from "next/server";
import { ingestSource } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 400 });
  }
  const title = req.nextUrl.searchParams.get("title") ?? "Untitled Upload";
  const artist = req.nextUrl.searchParams.get("artist") ?? "Unknown";
  const result = await ingestSource({
    buf,
    title,
    artist,
    category: "Upload",
    contentType: "upload",
    acquiredVia: "upload",
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ baseId: result.baseId, songIds: result.songIds });
}
