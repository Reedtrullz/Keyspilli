import { NextResponse } from "next/server";
import { getSongDetail } from "@/lib/catalog-api";
import { applySongMetadata, type SongPatch } from "@/lib/song-update";
import { rm, readdir } from "node:fs/promises";
import { getSong, artifactsDir, uploadsDir, deleteSongsByBase } from "@keyspilli/catalog";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getSongDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: SongPatch = {
    title: typeof body.title === "string" ? body.title : undefined,
    artist: typeof body.artist === "string" ? body.artist : undefined,
    key: typeof body.key === "string" ? body.key : undefined,
    tempo: typeof body.tempo === "number" ? body.tempo : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    style: typeof body.style === "string" ? body.style : undefined,
    mood: typeof body.mood === "string" ? body.mood : undefined,
  };
  try {
    const rows = await applySongMetadata(id, patch);
    return NextResponse.json({ baseId: rows[0]!.baseId, songIds: rows.map((r) => r.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = getSong(id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  const baseId = song.baseId;
  deleteSongsByBase(baseId);
  await rm(artifactsDir(baseId, ""), { recursive: true, force: true });
  const uploads = await readdir(uploadsDir()).catch(() => [] as string[]);
  await Promise.all(
    uploads.filter((f) => f.startsWith(`${baseId}.`)).map((f) => rm(join(uploadsDir(), f), { force: true })),
  );
  return NextResponse.json({ deleted: baseId });
}
