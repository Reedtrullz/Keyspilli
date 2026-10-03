import {NextResponse} from "next/server";
import {catalogRecoveryInventory,recoverCatalogPublication} from "@keyspilli/catalog";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {readJsonObject} from "@/lib/bounded-body";
export const dynamic="force-dynamic";
export async function GET(req:Request){const auth=checkMutationAuth(req);if(auth)return auth;try{return NextResponse.json(await catalogRecoveryInventory(),{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"Recovery inventory is unavailable. No changes were made."},{status:503});}}
export async function POST(req:Request){
 const auth=checkMutationAuth(req);if(auth)return auth;
 const parsed=await readJsonObject(req);if(parsed.response)return parsed.response;
 const b=parsed.body;
 if(Object.keys(b).sort().join(" ")!=="baseId confirmBaseId expectedJournalSha256"||typeof b.baseId!=="string"||! /^[a-z0-9][a-z0-9-]{0,119}$/.test(b.baseId)||b.confirmBaseId!==b.baseId||typeof b.expectedJournalSha256!=="string"||! /^[a-f0-9]{64}$/.test(b.expectedJournalSha256))return NextResponse.json({error:"Confirm the exact base and reviewed journal snapshot."},{status:400});
 try{return NextResponse.json({receipt:await recoverCatalogPublication(b.baseId,b.expectedJournalSha256)},{headers:{"Cache-Control":"no-store"}});}
 catch(error){const text=error instanceof Error?error.message:"",stale=text==="recovery snapshot changed",locked=text.includes("already locked")||text.includes("legacy artifact lock");
  return NextResponse.json({error:stale?"Recovery changed after review. Refresh and review the new snapshot.":locked?"An active or legacy lock prevents recovery. Stop the writer or investigate the legacy lock first.":"Recovery refused. Journal and remaining rollback evidence were retained; operator investigation is required.",code:stale?"RECOVERY_SNAPSHOT_CONFLICT":locked?"RECOVERY_LOCKED":"RECOVERY_REFUSED"},{status:locked?423:409});}
}
