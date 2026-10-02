import {NextResponse} from "next/server";
import {previewQuarantine,quarantineBase,operateTombstone,tombstoneInventory} from "@keyspilli/catalog";
import {checkMutationAuth} from "@/lib/mutation-auth";
import {readJsonObject} from "@/lib/bounded-body";
export const dynamic="force-dynamic";
const BASE=/^[a-z0-9][a-z0-9-]{0,119}$/;
function refused(error:unknown){const text=error instanceof Error?error.message:"",locked=text.includes("locked"),changed=text.includes("changed");
 const message=locked?"Another writer owns this lesson. Retry after it stops.":changed?"The reviewed lesson or tombstone changed. Refresh and review it again.":text.includes("active job")?"A queued or running import prevents quarantine.":text.includes("expiry")||text.includes("expired")?"This retention deadline does not allow that action.":text.includes("budget")||text.includes("bounds")?"Quarantine exceeds its storage or file budget.":"Action refused or interrupted. Refresh the tombstone inventory to inspect its durable state before retrying. No automatic recovery or purge will run.";
 return NextResponse.json({error:message},{status:locked?423:409,headers:{"Cache-Control":"no-store"}});
}
export async function GET(req:Request){const auth=checkMutationAuth(req);if(auth)return auth;const baseId=new URL(req.url).searchParams.get("baseId");if(baseId!==null&&!BASE.test(baseId))return NextResponse.json({error:"Invalid lesson identity."},{status:400});
 try{return NextResponse.json(baseId?{preview:await previewQuarantine(baseId)}:{entries:tombstoneInventory()},{headers:{"Cache-Control":"no-store"}});}catch(error){return refused(error);}
}
export async function POST(req:Request){
 const auth=checkMutationAuth(req);if(auth)return auth;const input=await readJsonObject(req);if(input.response)return input.response;const body=input.body;
 if(typeof body.baseId!=="string"||!BASE.test(body.baseId)||body.confirmBaseId!==body.baseId)return NextResponse.json({error:"Confirm the exact lesson base ID."},{status:400});
 if(body.action==="quarantine"){
  if(Object.keys(body).sort().join(" ")!=="action baseId confirmBaseId expectedRevision policyAccepted retentionDays"||body.policyAccepted!==true||![7,14,30].includes(body.retentionDays as number)||typeof body.expectedRevision!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(body.expectedRevision))return NextResponse.json({error:"Review the version and explicitly choose the quarantine retention policy."},{status:400});
  try{return NextResponse.json({receipt:await quarantineBase(body.baseId,body.expectedRevision,body.retentionDays as number)},{headers:{"Cache-Control":"no-store"}});}catch(error){return refused(error);}
 }
 if(Object.keys(body).sort().join(" ")!=="action baseId confirmBaseId token"||!["finish","undo","purge"].includes(body.action as string)||typeof body.token!=="string"||! /^[a-f0-9-]{36}$/.test(body.token))return NextResponse.json({error:"Review the recorded tombstone and its recovery action."},{status:400});
 try{return NextResponse.json({receipt:await operateTombstone(body.baseId,body.token,body.action as "finish"|"undo"|"purge")},{headers:{"Cache-Control":"no-store"}});}catch(error){return refused(error);}
}
