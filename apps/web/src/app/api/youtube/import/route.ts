import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The public product accepts user-supplied symbolic files, never audio as source authority. */
export async function POST(_request: Request) {
  if (process.env.KEYSPILLI_TUTORIAL_PREVIEW === "1" && process.env.NODE_ENV === "development" && process.env.KEYSPILLI_DATA_DIR) {
    const {checkMutationAuth}=await import("../../../../lib/mutation-auth");
    const denied=checkMutationAuth(_request);if(denied)return denied;
    const body=await _request.json().catch(()=>null);
    if(!body || typeof body.url!=="string" || Object.keys(body).some(key=>key!=="url"))
      return NextResponse.json({error:"Supply only a YouTube URL"},{status:400});
    const {POST:queue}=await import("../route");
    return queue(new NextRequest(_request.url,{method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+process.env.KEYSPILLI_API_TOKEN},
      body:JSON.stringify({url:body.url})}));
  }
  return NextResponse.json(
    {
      error: "Direct audio conversion is not available. Add a symbolic music file instead.",
      code: "DIRECT_AUDIO_AMT_DISABLED",
      next: "/uploads",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
