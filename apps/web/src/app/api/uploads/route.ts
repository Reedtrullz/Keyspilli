import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { inferIngestFormat, ingestSource } from "@keyspilli/catalog";
import {
  acceptSourceCandidateHandoff,
  bindSourceCandidateUpload,
  getSourceCandidateHandoff,
  rejectSourceCandidateHandoff,
  saveSourceCandidateHandoff,
  type SourceCandidateHandoff,
  type SourceCandidateHandoffLink,
} from "@keyspilli/catalog";
import { checkMutationAuth } from "../../../lib/mutation-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

import { readBoundedBody, BodyTooLargeError as UploadTooLargeError, BodyDeadlineError } from "../../../lib/bounded-body";
let uploadActive = false;


export async function POST(req: NextRequest) {
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  // ponytail: one synchronous arrangement per web process; use a worker queue
  // before increasing throughput, so concurrent bodies cannot exhaust memory.
  if (uploadActive) return NextResponse.json({ error: "upload busy", code: "UPLOAD_BUSY" }, { status: 503, headers: { "Retry-After": "5" } });
  uploadActive = true;
  try { return await handleUpload(req); } finally { uploadActive = false; }
}

async function handleUpload(req: NextRequest) {
  const startedAt = Date.now();
  const logUpload = (event: string, fields: Record<string, unknown> = {}) => {
    console.info("[upload]", { event, elapsedMs: Date.now() - startedAt, ...fields });
  };
  logUpload("start");
  let buf: Buffer;
  try {
    buf = await readBoundedBody(req, MAX_UPLOAD_BYTES, 60_000);
  } catch (error) {
    const status = error instanceof BodyDeadlineError ? 408 : error instanceof UploadTooLargeError ? 400 : 422;
    logUpload("failed", { category: error instanceof UploadTooLargeError ? "too-large" : "invalid-body" });
    return NextResponse.json({ error: error instanceof UploadTooLargeError ? "file too large (max 10 MB)" : error instanceof Error ? error.message : "invalid upload body" }, { status });
  }
  const title = req.nextUrl.searchParams.get("title") ?? "Untitled Upload";
  const artist = req.nextUrl.searchParams.get("artist") ?? "Unknown";
  const sourceHash = createHash("sha256").update(buf).digest("hex");
  const baseId = `upload-${sourceHash}`;
  const handoffId = req.nextUrl.searchParams.get("handoffId");
  let handoff: SourceCandidateHandoff | null = null;
  let handoffLink: SourceCandidateHandoffLink | null = null;
  if (handoffId !== null) {
    handoff = getSourceCandidateHandoff(handoffId);
    if (!handoff) return NextResponse.json({ error: "source candidate handoff not found or expired" }, { status: 404 });
    if (handoff.state === "EXPIRED") return NextResponse.json({ error: "source candidate handoff not found or expired" }, { status: 404 });
    const affirmed = req.nextUrl.searchParams.get("userAffirmedTarget");
    if (affirmed !== "true" && affirmed !== "1") {
      return NextResponse.json({ error: "user target confirmation is required" }, { status: 400 });
    }
    if (!handoff.userAffirmedTarget) return NextResponse.json({ error: "source candidate handoff is not affirmed" }, { status: 403 });
    try {
      const binding = bindSourceCandidateUpload(handoff, {
        uploadedSourceSha256: sourceHash,
        uploadedFormat: inferIngestFormat(buf),
        intakeCandidateId: baseId,
      });
      handoff = binding.handoff;
      handoffLink = binding.link;
      saveSourceCandidateHandoff(handoff);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "source handoff binding failed" }, { status: 400 });
    }
  }
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
      ...(handoffLink ? { sourceCandidateHandoff: handoffLink } : {}),
    });
  } catch (error) {
    if (handoff) {
      saveSourceCandidateHandoff(rejectSourceCandidateHandoff(handoff, "ingest failed"));
    }
    logUpload("failed", { sourceHash, baseId, category: "ingest-error" });
    throw error;
  }
  if (result.code === "ARTIFACT_RECONCILIATION_REQUIRED") {
    return NextResponse.json({ error: "Upload needs reconciliation", code: result.code, baseId: result.baseId, reconciliationRequired: true }, { status: 503 });
  }
  if (result.error) {
    if (handoff) saveSourceCandidateHandoff(rejectSourceCandidateHandoff(handoff, result.error));
    logUpload("failed", { sourceHash, baseId, category: "ingest-rejected" });
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  if (handoff) saveSourceCandidateHandoff(acceptSourceCandidateHandoff(handoff));
  const easySongId = result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0] ?? null;
  logUpload("complete", { sourceHash, baseId: result.baseId, songCount: result.songIds.length, easySongId });
  return NextResponse.json({ baseId: result.baseId, songIds: result.songIds, easySongId });
}
