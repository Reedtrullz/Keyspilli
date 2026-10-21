import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { verifyBearer } from "@/lib/api-auth";
import { isAllowedUser } from "@/lib/authz";

/**
 * Whole-app gate: an allowlisted GitHub session or the maintainer bearer.
 * The allowlist is re-checked on every request, so removing an id revokes
 * an existing session immediately.
 */
export const proxy = auth((req) => {
  if (verifyBearer(req) || isAllowedUser(req.auth?.user)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Auth.js needs an absolute Location; behind Caddy the public scheme and host arrive as forwarded headers.
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const origin = proto === "https" || proto === "http" ? (host ? `${proto}://${host}` : req.nextUrl.origin) : req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/signin?callbackUrl=${encodeURIComponent(pathname + search)}`, origin));
});

export const config = {
  matcher: ["/((?!_next/|api/auth/|api/health/live$|signin$|favicon\\.ico$|icon\\.svg$|manifest\\.webmanifest$).*)"],
};
