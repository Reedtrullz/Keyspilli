import { NextResponse } from "next/server";
import { apiAuthorization } from "./api-auth";

function firstForwardedValue(value: string): string | null {
  const first = value.split(",", 1)[0]?.trim();
  return first || null;
}

function originFrom(protocol: string, host: string): string | null {
  const scheme = protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  try {
    const url = new URL(`${scheme}://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function effectiveRequestOrigin(req: Request): string | null {
  const forwardedProtoHeader = req.headers.get("x-forwarded-proto");
  const forwardedHostHeader = req.headers.get("x-forwarded-host");
  if ((forwardedProtoHeader === null) !== (forwardedHostHeader === null)) return null;
  if (forwardedProtoHeader !== null && forwardedHostHeader !== null) {
    const protocol = firstForwardedValue(forwardedProtoHeader);
    const host = firstForwardedValue(forwardedHostHeader);
    return protocol && host ? originFrom(protocol, host) : null;
  }
  try {
    const requestUrl = new URL(req.url);
    return originFrom(requestUrl.protocol, req.headers.get("host") ?? requestUrl.host);
  } catch {
    return null;
  }
}

function sameOriginBrowser(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return req.headers.get("sec-fetch-site") === "same-origin" && effectiveRequestOrigin(req) !== null;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (origin !== originUrl.origin) return false;
  return originUrl.origin === effectiveRequestOrigin(req);
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
