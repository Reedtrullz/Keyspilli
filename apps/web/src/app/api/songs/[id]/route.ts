import { NextResponse } from "next/server";
import { getSongDetail } from "@/lib/catalog-api";
import { applySongMetadata, resolveBaseId, SongUpdateError, type SongPatch } from "@/lib/song-update";
import { parseTempoRequest, TempoRequestError, type TempoRequestPatch } from "@/lib/tempo-request";
import { readdir, rm } from "node:fs/promises";
import {
  dataDir,
  deleteBaseArtifact,
  deleteBaseRows,
  uploadsDir,
  transcribedDir,
} from "@keyspilli/catalog";
import { join } from "node:path";

export const dynamic = "force-dynamic";

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getSongDetail(id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkAuth(req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch = {} as SongPatch & TempoRequestPatch;
  for (const k of ["title", "artist", "key", "category", "style", "mood"] as const) {
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
  try {
    const rows = await applySongMetadata(id, patch);
    return NextResponse.json({ baseId: rows[0]!.baseId, songIds: rows.map((r) => r.id), tempoRole });
  } catch (e) {
    if (e instanceof SongUpdateError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkAuth(_req);
  if (authResponse) return authResponse;
  const { id } = await params;
  // Variant ids and base ids both work; resolve before deleting so jobs
  // pointing at any variant of this base are cleaned up too.
  const baseId = resolveBaseId(id);
  if (!baseId) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await deleteBaseArtifact(baseId, {
      artifactsRoot: join(dataDir(), "artifacts"),
      // Keep DB/read-model and auxiliary-source cleanup inside the same
      // per-base lock. Filesystem deletion is the commit point; a DB failure
      // is surfaced as reconciliationRequired rather than being hidden.
      afterFilesystemDelete: async () => {
        const { jobIds } = deleteBaseRows(baseId);

        // Source sidecars are not part of the atomic artifact tree. Cleanup
        // is best effort after the DB transaction so retained source data can
        // support explicit reconciliation if a cleanup fails.
        const uploads = await readdir(uploadsDir()).catch(() => [] as string[]);
        await Promise.all(
          uploads
            .filter((f) => f.startsWith(`${baseId}.`))
            .map((f) => rm(join(uploadsDir(), f), { force: true }).catch(() => undefined)),
        );
        const transcribed = await readdir(transcribedDir()).catch(() => [] as string[]);
        await Promise.all(
          transcribed
            .filter((f) => jobIds.includes(f) || jobIds.some((j) => f.startsWith(`${j}-`)))
            .map((f) => rm(join(transcribedDir(), f), { recursive: true, force: true }).catch(() => undefined)),
        );
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    const locked = message.includes("artifact publish already locked");
    return NextResponse.json(
      {
        error: message,
        ...(locked ? {} : { reconciliationRequired: true }),
      },
      { status: locked ? 409 : 500 },
    );
  }
  return NextResponse.json({ deleted: baseId });
}
