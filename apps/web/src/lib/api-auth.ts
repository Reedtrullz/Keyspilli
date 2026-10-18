import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Caddy consumes the edge Basic Auth Authorization header. Maintainer calls
 * carry the unchanged application bearer value in this internal transport
 * header, while direct callers continue using Authorization.
 */
export function apiAuthorization(req: Request): string {
  return req.headers.get("authorization") ?? req.headers.get("x-keyspilli-api-token") ?? "";
}

/**
 * Constant-time check that the request carries `Bearer <token>`.
 *
 * Both values are copied into zero-padded buffers of the same length so
 * `timingSafeEqual` always runs over the full width, and the length check is
 * folded in afterwards; the comparison time does not depend on where the
 * values first differ. An unset or empty token never matches.
 */
export function verifyBearer(req: Request, token: string | undefined = process.env.KEYSPILLI_API_TOKEN): boolean {
  if (!token) return false;
  const provided = Buffer.from(apiAuthorization(req), "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const width = Math.max(provided.length, expected.length);
  const left = Buffer.alloc(width);
  const right = Buffer.alloc(width);
  provided.copy(left);
  expected.copy(right);
  const sameBytes = timingSafeEqual(left, right);
  return sameBytes && provided.length === expected.length;
}

/**
 * Maintainer-only boundary: require the application bearer token. Returns a
 * 503 when the server has no token configured (fail closed) and a 401 when
 * the request does not carry it; null means the request may proceed.
 */
export function requireBearer(req: Request): Response | null {
  if (!process.env.KEYSPILLI_API_TOKEN) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json({ error: "server authentication is not configured" }, { status: 503 });
  }
  if (!verifyBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
