import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { verifyBearer } from "@/lib/api-auth";
import { accessRole, gateDecision } from "@/lib/authz";

/**
 * Whole-app gate: an approved GitHub session or the maintainer bearer.
 * Access is re-checked on every request, so revoking an account takes effect
 * immediately. Signed-in accounts without access reach only /profile.
 */
export const proxy = auth((req) => {
  if (verifyBearer(req)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  const decision = gateDecision(accessRole(req.auth?.user), pathname, req.method);
  if (decision === "allow") return NextResponse.next();
  if (decision === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Auth.js needs an absolute Location; behind Caddy the public scheme and host arrive as forwarded headers.
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const origin = proto === "https" || proto === "http" ? (host ? `${proto}://${host}` : req.nextUrl.origin) : req.nextUrl.origin;
  const target = decision === "profile" ? "/profile" : decision === "home" ? "/" : `/signin?callbackUrl=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(new URL(target, origin));
});

export const config = {
  matcher: ["/((?!_next/|api/auth/|api/health/live$|signin$|favicon\\.ico$|icon\\.svg$|manifest\\.webmanifest$).*)"],
};
