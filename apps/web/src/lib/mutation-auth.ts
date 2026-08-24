import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function checkMutationAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json(
      { error: "server authentication is not configured" },
      { status: 503 },
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBytes = Buffer.from(token);
  const suppliedBytes = Buffer.from(supplied);
  if (
    suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
