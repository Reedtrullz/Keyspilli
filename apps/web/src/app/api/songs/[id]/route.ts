import { readJsonObject } from "../../../../lib/bounded-body";
import { NextResponse } from "next/server";
import { getSongDetail, PublicationRevisionConflictError } from "@/lib/catalog-api";
import { checkMutationAuth } from "@/lib/mutation-auth";
import { apiAuthorization } from "../../../../lib/api-auth";
import { applySongMetadata, resolveBaseId, SongUpdateError, type SongPatch } from "@/lib/song-update";
import { parseTempoRequest, TempoRequestError, type TempoRequestPatch } from "@/lib/tempo-request";
import {
  ArtifactReconciliationError,
  dataDir,
  deleteBaseArtifact,
  catalogDeletionSnapshot,
  commitCatalogDeletion,
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
  const auth = apiAuthorization(req);
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const value = new URL(_req.url).searchParams.get("revision");
    const revision = value === null ? undefined : value === "unpinned" ? null : value;
    const detail = await getSongDetail(id, revision);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof PublicationRevisionConflictError) {
      return NextResponse.json({ error: error.message, code: "PUBLICATION_REVISION_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const input = await readJsonObject(req);
  if (input.response) return input.response;
  const body = input.body;
  if (Object.keys(body).some(key => !["title","artist","key","category","style","mood","tempo","playbackTempo","calibrationTempo","expectedRevision"].includes(key))) return NextResponse.json({ error: "unsupported metadata field" }, { status: 400 });
  if (body.expectedRevision !== undefined && body.expectedRevision !== null && (typeof body.expectedRevision !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.expectedRevision))) return NextResponse.json({ error: "invalid expected publication revision" }, { status: 400 });
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
    const rows = await applySongMetadata(id, patch, { expectedRevision: body.expectedRevision as string | null | undefined });
    return NextResponse.json({ baseId: rows[0]!.baseId, songIds: rows.map((r) => r.id), tempoRole });
  } catch (e) {
    if (e instanceof ArtifactReconciliationError) {
      return NextResponse.json({ error: e.message, code: e.code, baseId: e.baseId, reconciliationRequired: true }, { status: 503 });
    }
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
      prepareRecoveryData: () => catalogDeletionSnapshot(baseId),
      afterFilesystemDelete: commitCatalogDeletion,
    });
  } catch (e) {
    const message = (e as Error).message;
    const locked = message.includes("artifact publish already locked");
    return NextResponse.json(
      {
        error: message,
        ...(e instanceof ArtifactReconciliationError ? { code: e.code, baseId: e.baseId } : {}),
        ...(locked ? {} : { reconciliationRequired: true }),
      },
      { status: locked ? 409 : e instanceof ArtifactReconciliationError ? 503 : 500 },
    );
  }
  return NextResponse.json({ deleted: baseId });
}
