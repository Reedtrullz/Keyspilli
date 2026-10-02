import { NextResponse } from "next/server";
import { getArtifactFileWithMetadata, PublicationRevisionConflictError } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";

function matchesIfNoneMatch(req: Request, etag: string): boolean {
  const value = req.headers.get("if-none-match");
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed === etag || trimmed === `W/${etag}`;
  });
}

function isNotModified(req: Request, etag: string, lastModified: string): boolean {
  // If-None-Match takes precedence over If-Modified-Since per HTTP caching
  // semantics, including when the client supplied a stale validator.
  if (req.headers.has("if-none-match")) return matchesIfNoneMatch(req, etag);
  const value = req.headers.get("if-modified-since");
  if (!value) return false;
  const since = Date.parse(value);
  const modified = Date.parse(lastModified);
  return Number.isFinite(since) && Number.isFinite(modified) && since >= modified;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let artifact;
  try {
    const value = new URL(req.url).searchParams.get("revision");
    const revision = value === null ? undefined : value === "unpinned" ? null : value;
    artifact = await getArtifactFileWithMetadata(id, "variant.xml", revision);
  } catch (error) {
    if (error instanceof PublicationRevisionConflictError) {
      return NextResponse.json({ error: error.message, code: "PUBLICATION_REVISION_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 });

  const headers = {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Type": "application/vnd.recordare.musicxml+xml",
    ETag: artifact.etag,
    "Last-Modified": artifact.lastModified,
    "X-Publication-Revision": artifact.publicationRevision ?? "unpinned",
  };
  if (isNotModified(req, artifact.etag, artifact.lastModified)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(new Uint8Array(artifact.data), { headers });
}
