import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Process liveness does not imply catalog, media or provider readiness. */
export function GET() {
  return NextResponse.json({ status: "alive", version: process.env.VERSION ?? process.env.APP_VERSION ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
