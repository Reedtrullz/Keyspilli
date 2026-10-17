import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Caddy consumes the edge Basic Auth Authorization header. Maintainer calls
 * carry the unchanged application bearer value in this internal transport
 * header, while direct callers continue using Authorization.
 */
export function apiAuthorization(req: Request): string {
  return req.headers.get("authorization") ?? req.headers.get("x-keyspilli-api-token") ?? "";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time check that the request carries `Bearer <token>`.
 *
 * Both sides are hashed first so the comparison takes the same time
 * regardless of where the values differ and does not reveal the configured
 * token's length. An unset or empty token never matches.
 */
export function verifyBearer(req: Request, token: string | undefined = process.env.KEYSPILLI_API_TOKEN): boolean {
  if (!token) return false;
  return timingSafeEqual(digest(apiAuthorization(req)), digest(`Bearer ${token}`));
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
