import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The public product accepts user-supplied symbolic files, never audio as source authority. */
export async function POST(_request: Request) {
  return NextResponse.json(
    {
      error: "Direct audio conversion is not available. Add a symbolic music file instead.",
      code: "DIRECT_AUDIO_AMT_DISABLED",
      next: "/uploads",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
