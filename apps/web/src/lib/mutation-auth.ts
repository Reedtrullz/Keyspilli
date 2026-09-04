import { NextResponse } from "next/server";
import { apiAuthorization } from "./api-auth";

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

/** Shared mutation boundary for uploads and user-mediated handoffs. */
export function checkMutationAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  const auth = apiAuthorization(req);
  if (token && auth === `Bearer ${token}`) return null;
  const originResponse = sameOriginGuard(req);
  if (originResponse) return originResponse;
  if (!auth && sameOriginBrowser(req)) return null;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json({ error: "server authentication is not configured" }, { status: 503 });
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
