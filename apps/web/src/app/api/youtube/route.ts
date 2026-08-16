import { NextRequest, NextResponse } from "next/server";
import { insertJob, getSongsByBase } from "@keyspilli/catalog";
import { applySongMetadata, resolveBaseId, SongUpdateError, type SongPatch } from "@/lib/song-update";
import { parseTempoRequest, TempoRequestError, type TempoRequestPatch } from "@/lib/tempo-request";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return NextResponse.json({ error: "paste a valid YouTube URL" }, { status: 400 });
  }
  if (body.songId !== undefined && typeof body.songId !== "string") {
    return NextResponse.json({ error: "songId must be a string" }, { status: 400 });
  }
  const patch = {} as SongPatch & TempoRequestPatch;
  for (const k of ["title", "artist", "key"] as const) {
    const v = body[k];
    if (v !== undefined) {
      if (typeof v !== "string") return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
      patch[k] = v;
    }
  }
  let tempoRole: ReturnType<typeof parseTempoRequest>["role"];
  try {
    const tempo = parseTempoRequest(body);
    Object.assign(patch, tempo.patch);
    tempoRole = tempo.role;
  } catch (e) {
    if (e instanceof TempoRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const hasMeta = Object.values(patch).some((v) => v !== undefined);
  if (hasMeta && !body.songId) {
    return NextResponse.json({ error: "songId is required with metadata" }, { status: 400 });
  }
  let songId: string | null = null;
  try {
    if (body.songId) {
      const baseId = resolveBaseId(body.songId);
      if (!baseId) return NextResponse.json({ error: "song not found" }, { status: 404 });
      songId = getSongsByBase(baseId)[0]?.id ?? body.songId;
      if (hasMeta) await applySongMetadata(songId, patch);
    }
  } catch (e) {
    if (e instanceof SongUpdateError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
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
  return NextResponse.json({ jobId: id, tempoRole });
}
