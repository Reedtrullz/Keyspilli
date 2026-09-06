/**
 * Caddy consumes the edge Basic Auth Authorization header. Maintainer calls
 * carry the unchanged application bearer value in this internal transport
 * header, while direct callers continue using Authorization.
 */
export function apiAuthorization(req: Request): string {
  return req.headers.get("authorization") ?? req.headers.get("x-keyspilli-api-token") ?? "";
}
