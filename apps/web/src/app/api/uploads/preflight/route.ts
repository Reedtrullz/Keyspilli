import { NextRequest, NextResponse } from "next/server";
import { createSymbolicUploadPreflight } from "@keyspilli/catalog";
import { checkMutationAuth } from "../../../../lib/mutation-auth";
import { readBoundedBody, BodyTooLargeError, BodyDeadlineError } from "../../../../lib/bounded-body";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResponse = checkMutationAuth(req);
  if (authResponse) return authResponse;
  let bytes: Buffer;
  try {
    bytes = await readBoundedBody(req, MAX_UPLOAD_BYTES, 60_000);
  } catch (error) {
    const status = error instanceof BodyDeadlineError ? 408 : error instanceof BodyTooLargeError ? 400 : 422;
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid symbolic upload body" }, { status });
  }
  try {
    return NextResponse.json(createSymbolicUploadPreflight(bytes));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "symbolic file could not be reviewed" }, { status: 422 });
  }
}
