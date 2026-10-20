import { timingSafeEqual } from "node:crypto";

/**
 * Caddy consumes the edge Basic Auth Authorization header. Maintainer calls
 * carry the unchanged application bearer value in this internal transport
 * header, while direct callers continue using Authorization.
 */
export function apiAuthorization(req: Request): string {
  return req.headers.get("authorization") ?? req.headers.get("x-keyspilli-api-token") ?? "";
}

/** Constant-time check of the supplied header against `Bearer ${token}`. */
export function hasValidBearer(req: Request, token: string): boolean {
  const provided = Buffer.from(apiAuthorization(req));
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Token-only gate for maintainer mutations; returns an error response or null. */
export function checkTokenAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return Response.json({ error: "server authentication is not configured" }, { status: 503 });
  }
  return hasValidBearer(req, token) ? null : Response.json({ error: "unauthorized" }, { status: 401 });
}
