import { NextRequest, NextResponse } from "next/server";
import { ingestSource } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json(
      { error: "server authentication is not configured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authResponse = checkAuth(req);
  if (authResponse) return authResponse;
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
  const easySongId = result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0] ?? null;
  return NextResponse.json({ baseId: result.baseId, songIds: result.songIds, easySongId });
}
