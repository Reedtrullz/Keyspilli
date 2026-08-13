import { NextRequest, NextResponse } from "next/server";
import { insertJob, getSongsByBase } from "@keyspilli/catalog";
import { applySongMetadata, resolveBaseId, type SongPatch } from "@/lib/song-update";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    songId?: string;
    title?: string;
    artist?: string;
    key?: string;
    tempo?: number;
  };
  const url = body.url?.trim();
  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return NextResponse.json({ error: "paste a valid YouTube URL" }, { status: 400 });
  }
  const patch: SongPatch = {
    title: body.title,
    artist: body.artist,
    key: body.key,
    tempo: body.tempo,
  };
  const hasMeta = Object.values(patch).some((v) => v !== undefined);
  if (hasMeta && !body.songId) {
    return NextResponse.json({ error: "songId is required with metadata" }, { status: 400 });
  }
  let songId: string | null = null;
  if (body.songId) {
    const baseId = resolveBaseId(body.songId);
    if (!baseId) return NextResponse.json({ error: "song not found" }, { status: 404 });
    songId = getSongsByBase(baseId)[0]?.id ?? body.songId;
    if (hasMeta) await applySongMetadata(songId, patch);
  }
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  insertJob({
    id,
    youtubeUrl: url,
    status: "queued",
    songId,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  return NextResponse.json({ jobId: id });
}
