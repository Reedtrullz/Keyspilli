import { NextResponse } from "next/server";
import { getSongDetail } from "@/lib/catalog-api";
import { applySongMetadata, resolveBaseId, SongUpdateError, type SongPatch } from "@/lib/song-update";
import { rm, readdir } from "node:fs/promises";
import { artifactsDir, uploadsDir, transcribedDir, deleteSongsByBase, deleteJobsByBase } from "@keyspilli/catalog";
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
  const patch: SongPatch = {};
  for (const k of ["title", "artist", "key", "category", "style", "mood"] as const) {
    const v = body[k];
    if (v !== undefined) {
      if (typeof v !== "string") return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
      patch[k] = v;
    }
  }
  if (body.tempo !== undefined) {
    if (typeof body.tempo !== "number" || !Number.isFinite(body.tempo)) {
      return NextResponse.json({ error: "tempo must be a finite number" }, { status: 400 });
    }
    patch.tempo = body.tempo;
  }
  try {
    const rows = await applySongMetadata(id, patch);
    return NextResponse.json({ baseId: rows[0]!.baseId, songIds: rows.map((r) => r.id) });
  } catch (e) {
    if (e instanceof SongUpdateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Variant ids and base ids both work; resolve before deleting so jobs
  // pointing at any variant of this base are cleaned up too.
  const baseId = resolveBaseId(id);
  if (!baseId) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Remove conversion jobs first so retry cannot re-transcribe under a
  // deleted base, then drop their transcribed audio dirs (best effort).
  const jobIds = deleteJobsByBase(baseId);
  deleteSongsByBase(baseId);
  await rm(artifactsDir(baseId, ""), { recursive: true, force: true });
  const uploads = await readdir(uploadsDir()).catch(() => [] as string[]);
  await Promise.all(
    uploads.filter((f) => f.startsWith(`${baseId}.`)).map((f) => rm(join(uploadsDir(), f), { force: true })),
  );
  const transcribed = await readdir(transcribedDir()).catch(() => [] as string[]);
  await Promise.all(
    transcribed
      .filter((f) => jobIds.includes(f) || jobIds.some((j) => f.startsWith(`${j}-`)))
      .map((f) => rm(join(transcribedDir(), f), { recursive: true, force: true }).catch(() => {})),
  );
  return NextResponse.json({ deleted: baseId });
}
