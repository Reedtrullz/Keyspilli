import { tutorialImportsEnabled } from "@keyspilli/catalog";
import { NextRequest, NextResponse } from "next/server";
import {canonicalYoutubeUrl,getDb} from "@keyspilli/catalog";

// Coalesce only in-flight enqueue requests; completed extraction is never cached here.
let queueModule: Promise<typeof import("../route")> | undefined;
const submitting = new Map<string, Promise<Response>>();

export const dynamic = "force-dynamic";

/** The public product accepts user-supplied symbolic files, never audio as source authority. */
export async function POST(_request: Request) {
  if (tutorialImportsEnabled()) {
    const {checkMutationAuth}=await import("../../../../lib/mutation-auth");
    const denied=checkMutationAuth(_request);if(denied)return denied;
    const body=await _request.json().catch(()=>null);
    if(!body || typeof body.url!=="string" || Object.keys(body).some(key=>key!=="url"))
      return NextResponse.json({error:"Supply only a YouTube URL"},{status:400});
    const {POST:queue}=await (queueModule ??= import("../route"));
    const key=canonicalYoutubeUrl(body.url);
    if(!key)return NextResponse.json({error:"paste a valid YouTube URL"},{status:400});
    const active=getDb().prepare("SELECT id FROM conversion_jobs WHERE youtube_url = ? AND song_id IS NULL AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1").get(key) as {id:string}|undefined;
    if(active)return NextResponse.json({jobId:active.id});
    const existing=submitting.get(key);if(existing)return (await existing).clone();
    const pending=queue(new NextRequest(_request.url,{method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+process.env.KEYSPILLI_API_TOKEN},
      body:JSON.stringify({url:body.url})}));
    submitting.set(key,pending);
    try{return (await pending).clone();}finally{submitting.delete(key);}
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
