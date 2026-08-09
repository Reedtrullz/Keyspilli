import { NextRequest, NextResponse } from "next/server";
import { insertJob } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = body.url?.trim();
  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return NextResponse.json({ error: "paste a valid YouTube URL" }, { status: 400 });
  }
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  insertJob({
    id,
    youtubeUrl: url,
    status: "queued",
    songId: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  return NextResponse.json({ jobId: id });
}
