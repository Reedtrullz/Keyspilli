import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  confirmSymbolicUploadChoice,
  getUploadPublicationReceipt,
  inferIngestFormat,
  ingestSource,
  type SymbolicUploadChoice,
  type SymbolicUploadIntent,
  type UploadPublicationReceipt,
} from "@keyspilli/catalog";
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
  const mode = req.nextUrl.searchParams.get("mode");
  if (mode !== null && mode !== "replace") return NextResponse.json({ error: "invalid upload mode" }, { status: 400 });
  const expectedRevision = req.nextUrl.searchParams.get("expectedRevision");
  if (mode === "replace" && !expectedRevision) return NextResponse.json({ error: "expected publication revision is required" }, { status: 400 });
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
  const preflightId = req.headers.get("x-keyspilli-upload-preflight");
  const choiceHeader = req.headers.get("x-keyspilli-upload-choice");
  if (Boolean(preflightId) !== Boolean(choiceHeader)) {
    return NextResponse.json({ error: "symbolic upload preflight and explicit choice must be sent together" }, { status: 400 });
  }
  let symbolicIntent: SymbolicUploadIntent | undefined;
  if (preflightId && choiceHeader) {
    if (choiceHeader.length > 16_384) return NextResponse.json({ error: "symbolic upload choice is too large" }, { status: 400 });
    let choice: unknown;
    try { choice = JSON.parse(choiceHeader) as unknown; } catch {
      return NextResponse.json({ error: "symbolic upload choice is invalid JSON" }, { status: 400 });
    }
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
      return NextResponse.json({ error: "symbolic upload choice must be an object" }, { status: 400 });
    }
    try {
      symbolicIntent = confirmSymbolicUploadChoice(preflightId, buf, choice as SymbolicUploadChoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : "symbolic upload choice could not be confirmed";
      const status = /expired/i.test(message) ? 410 : /bytes changed/i.test(message) ? 409 : 422;
      return NextResponse.json({ error: message }, { status });
    }
  }
  let existingReceipt: UploadPublicationReceipt | null;
  try {
    existingReceipt = await getUploadPublicationReceipt(baseId, sourceHash);
  } catch (error) {
    const busy = error instanceof Error && error.message === "artifact publish already locked";
    const reconciliation = error instanceof Error && "code" in error && error.code === "ARTIFACT_RECONCILIATION_REQUIRED";
    return NextResponse.json({
      error: busy ? "Another upload is being published. Try again shortly." : reconciliation ? "Upload needs catalog reconciliation" : "Unable to inspect the saved upload",
      code: busy ? "UPLOAD_BUSY" : reconciliation ? "ARTIFACT_RECONCILIATION_REQUIRED" : "UPLOAD_STATE_UNAVAILABLE",
      ...(reconciliation ? { baseId, reconciliationRequired: true } : {}),
    }, { status: 503, headers: busy ? { "Retry-After": "5" } : undefined });
  }
  if (mode !== "replace" && symbolicIntent && existingReceipt
    && JSON.stringify(existingReceipt.symbolicIntent ?? null) !== JSON.stringify(symbolicIntent)) {
    return NextResponse.json({
      error: "This source already has a lesson with different part or arrangement choices. Review it before replacing it.",
      code: "UPLOAD_INTENT_REVIEW_REQUIRED",
      receipt: existingReceipt,
    }, { status: 409 });
  }
  if (mode !== "replace" && existingReceipt) {
    logUpload("reused", { sourceHash, baseId, publicationRevision: existingReceipt.publicationRevision });
    return NextResponse.json({ ...existingReceipt, reused: true });
  }
  if (mode === "replace" && (!existingReceipt || existingReceipt.publicationRevision !== expectedRevision)) {
    return NextResponse.json({
      error: "The accepted upload changed. Review the current lesson before replacing it.",
      code: "UPLOAD_REVISION_STALE",
      ...(existingReceipt ? { receipt: existingReceipt } : {}),
    }, { status: 409 });
  }
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
      ...(symbolicIntent ? { symbolicIntent } : {}),
      ...(handoffLink ? { sourceCandidateHandoff: handoffLink } : {}),
    }, mode === "replace"
      ? { uploadReplay: { mode: "replace", expectedRevision: expectedRevision! } }
      : { uploadReplay: { mode: "reuse" } });
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
  if (result.code === "ARTIFACT_BUSY") {
    return NextResponse.json({ error: "Another upload is being published. Try again shortly.", code: "UPLOAD_BUSY" }, { status: 503, headers: { "Retry-After": "5" } });
  }
  if (result.code === "UPLOAD_REVISION_STALE") {
    let receipt: UploadPublicationReceipt | null = null;
    try { receipt = await getUploadPublicationReceipt(baseId, sourceHash); } catch { /* keep the conflict actionable even if the latest receipt is unavailable */ }
    return NextResponse.json({ error: result.error, code: result.code, ...(receipt ? { receipt } : {}) }, { status: 409 });
  }
  if (result.reused && result.uploadReceipt) {
    logUpload("reused", { sourceHash, baseId, publicationRevision: result.uploadReceipt.publicationRevision });
    return NextResponse.json({ ...result.uploadReceipt, reused: true });
  }
  if (result.error) {
    if (handoff) saveSourceCandidateHandoff(rejectSourceCandidateHandoff(handoff, result.error));
    logUpload("failed", { sourceHash, baseId, category: "ingest-rejected" });
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  const receipt = result.uploadReceipt ?? await getUploadPublicationReceipt(baseId, sourceHash);
  if (!receipt) return NextResponse.json({ error: "Published upload receipt is unavailable", code: "ARTIFACT_RECONCILIATION_REQUIRED", baseId, reconciliationRequired: true }, { status: 503 });
  if (handoff) saveSourceCandidateHandoff(acceptSourceCandidateHandoff(handoff));
  const easySongId = receipt.easySongId;
  logUpload("complete", { sourceHash, baseId: result.baseId, songCount: result.songIds.length, easySongId });
  return NextResponse.json({ ...receipt, reused: false });
}
