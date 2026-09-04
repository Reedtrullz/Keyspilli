import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestSource } from "@keyspilli/catalog";
import { apiAuthorization } from "../../../lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

class UploadTooLargeError extends Error {}

async function readBoundedBody(req: Request): Promise<Buffer> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isInteger(declared) || declared < 0) throw new Error("invalid content length");
    if (declared > MAX_UPLOAD_BYTES) throw new UploadTooLargeError("file too large (max 10 MB)");
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new UploadTooLargeError("file too large (max 10 MB)");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function sameOriginBrowser(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(req.url);
  } catch {
    return false;
  }
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const requestHost = forwardedHost ?? req.headers.get("host");
  if (forwardedProto) requestUrl.protocol = forwardedProto.endsWith(":") ? forwardedProto : `${forwardedProto}:`;
  if (requestHost) requestUrl.host = requestHost;
  return originUrl.origin === requestUrl.origin;
}

function sameOriginGuard(req: Request): Response | null {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin && !sameOriginBrowser(req)) {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }
  return null;
}

function checkAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  const auth = apiAuthorization(req);
  if (token && auth === `Bearer ${token}`) return null;

  const originResponse = sameOriginGuard(req);
  if (originResponse) return originResponse;
  if (!auth && sameOriginBrowser(req)) return null;

  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json(
      { error: "server authentication is not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const authResponse = checkAuth(req);
  if (authResponse) return authResponse;
  const startedAt = Date.now();
  const logUpload = (event: string, fields: Record<string, unknown> = {}) => {
    console.info("[upload]", { event, elapsedMs: Date.now() - startedAt, ...fields });
  };
  logUpload("start");
  let buf: Buffer;
  try {
    buf = await readBoundedBody(req);
  } catch (error) {
    const status = error instanceof UploadTooLargeError ? 400 : 422;
    logUpload("failed", { category: error instanceof UploadTooLargeError ? "too-large" : "invalid-body" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid upload body" }, { status });
  }
  const title = req.nextUrl.searchParams.get("title") ?? "Untitled Upload";
  const artist = req.nextUrl.searchParams.get("artist") ?? "Unknown";
  const sourceHash = createHash("sha256").update(buf).digest("hex");
  const baseId = `upload-${sourceHash}`;
  logUpload("received", { sourceHash, bytes: buf.byteLength, baseId });
  let result: Awaited<ReturnType<typeof ingestSource>>;
  try {
    logUpload("ingest-start", { sourceHash, baseId });
    result = await ingestSource({
      buf,
      baseId,
      title,
      artist,
      category: "Upload",
      contentType: "upload",
      acquiredVia: "upload",
      sourceRef: `upload:${sourceHash}`,
    });
  } catch (error) {
    logUpload("failed", { sourceHash, baseId, category: "ingest-error" });
    throw error;
  }
  if (result.error) {
    logUpload("failed", { sourceHash, baseId, category: "ingest-rejected" });
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  const easySongId = result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0] ?? null;
  logUpload("complete", { sourceHash, baseId: result.baseId, songCount: result.songIds.length, easySongId });
  return NextResponse.json({ baseId: result.baseId, songIds: result.songIds, easySongId });
}
