import { NextResponse } from "next/server";
import { dataDir, getDb, getSongsByBase, tutorialImportsEnabled, withBaseArtifactLock } from "@keyspilli/catalog";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apiAuthorization } from "../../../../../lib/api-auth";

export const dynamic = "force-dynamic";

function checkAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json(
      { error: "server authentication is not configured" },
      { status: 503 },
    );
  }
  const auth = apiAuthorization(req);
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authResponse = checkAuth(_req);
  if (authResponse) return authResponse;
  const { id } = await params;
  const db = getDb();
  const r = db.prepare("DELETE FROM conversion_jobs WHERE id = ? AND status = 'queued' AND song_id IS NULL").run(id);
  if (!r.changes) {
    const exists = db.prepare("SELECT 1 FROM conversion_jobs WHERE id = ?").get(id);
    return NextResponse.json({ error: exists ? "Job is no longer cancellable" : "not found" }, { status: exists ? 409 : 404 });
  }
  return NextResponse.json({ ok: true });
}

/** Tutorial beta cancellation retains the row and all source evidence. */
export async function PATCH(req: Request, {params}: {params: Promise<{id:string}>}) {
  if(!tutorialImportsEnabled())
    return NextResponse.json({error:"Tutorial preview cancellation is unavailable"},{status:410});
  const {checkMutationAuth}=await import("../../../../../lib/mutation-auth");
  const denied=checkMutationAuth(req);if(denied)return denied;
  const body=await req.json().catch(()=>null);
  if(!body || body.action!=="cancel" || Object.keys(body).length!==1)
    return NextResponse.json({error:"Supply only action: cancel"},{status:400});
  const {id}=await params;
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return NextResponse.json({error:"not found"},{status:404});
  const db=getDb();
  const baseId=`preview-${id}`;
  const root=join(dataDir(),"artifacts");
  try {
    const cancelled=await withBaseArtifactLock(baseId,{artifactsRoot:root},()=>{
      if(existsSync(join(root,`.${baseId}.reconciliation.json`)) || getSongsByBase(baseId).length) return false;
      return db.prepare("UPDATE conversion_jobs SET status = 'error', error = 'TUTORIAL_PREVIEW_CANCELLED', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status IN ('queued','processing') AND song_id IS NULL").run(new Date().toISOString(),id).changes===1;
    });
    if(cancelled)return NextResponse.json({cancelled:true});
  } catch(error) {
    if((error as Error).message === "artifact publish already locked") return NextResponse.json({error:"Job publication is already in progress"},{status:409});
    throw error;
  }
  const job=db.prepare("SELECT status FROM conversion_jobs WHERE id = ?").get(id) as {status:string}|undefined;
  return NextResponse.json({error:job ? "Job is no longer cancellable" : "not found"},{status:job ? 409 : 404});
}
