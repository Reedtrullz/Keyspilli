"use client";
import {useEffect,useRef,useState} from "react";
import type {RecoveryEntry,RecoveryReceipt} from "@keyspilli/catalog";
export function CatalogRecovery(){
 const [entries,setEntries]=useState<RecoveryEntry[]|null>(null),[truncated,setTruncated]=useState(false),[confirmation,setConfirmation]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[receipt,setReceipt]=useState<RecoveryReceipt|null>(null);
 const controllerRef=useRef<AbortController|null>(null);useEffect(()=>()=>{controllerRef.current?.abort();controllerRef.current=null;},[]);
 async function run(body?:{baseId:string;confirmBaseId:string;expectedJournalSha256:string}){
  if(busy)return;const controller=new AbortController();controllerRef.current=controller;setBusy(true);setNotice("");const timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch("/api/catalog/recovery",{method:body?"POST":"GET",signal:controller.signal,...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Recovery unavailable.");if(controller.signal.aborted)return;
   if(body){setReceipt(data.receipt);setEntries(null);setConfirmation({});setNotice("Recovery completed. Refresh the inventory before another action.");}
   else{setEntries(data.entries);setTruncated(data.truncated);setConfirmation({});setNotice("Read-only inventory. No changes made.");}
  }catch(error){if(controllerRef.current===controller)setNotice(controller.signal.aborted?"Recovery request timed out. Refresh to check its recorded state before retrying.":error instanceof Error?error.message:"Recovery unavailable.");}
  finally{clearTimeout(timer);if(controllerRef.current===controller)setBusy(false);}
 }
 return <section className="space-y-4" aria-label="Catalog recovery">
  <p>This private owner tool handles recorded publication failures. It checks the reviewed journal under the existing writer lock. Malformed or ambiguous states remain blocked. A recorded deletion can remove that base’s artifacts; this is separate from retrying a conversion.</p>
  <button disabled={busy} className="min-h-11 border rounded px-3" onClick={()=>void run()}>Refresh recovery inventory</button>
  {notice&&<p role="status">{notice}</p>}{truncated&&<p>Inventory reached its bound. Ask the operator to inspect remaining journals.</p>}
  {entries?.length===0&&<p>No recorded publication recovery is pending.</p>}
  {entries?.map(entry=><article key={entry.baseId} className="border rounded-xl p-4 space-y-2" aria-label={`Recovery for ${entry.baseId}`}><h2 className="font-semibold break-all">{entry.baseId}</h2><p>{entry.operation} · {entry.state} · installed {entry.installed?"present":"absent"} · rollback {entry.rollback?"present":"absent"} · staged {entry.staged?"present":"absent"}</p><p>{entry.reason}</p>
   {entry.state==="reviewable"&&entry.journalSha256&&<><p className="text-xs break-all">Reviewed journal SHA-256: {entry.journalSha256}</p><label className="block">Confirm base ID<input disabled={busy} className="block border rounded px-2 min-h-11 w-full" value={confirmation[entry.baseId]??""} onChange={event=>setConfirmation(current=>({...current,[entry.baseId]:event.target.value}))}/></label><button disabled={busy||confirmation[entry.baseId]!==entry.baseId} className="min-h-11 border rounded px-3" onClick={()=>void run({baseId:entry.baseId,confirmBaseId:confirmation[entry.baseId]!,expectedJournalSha256:entry.journalSha256!})}>Reconcile reviewed {entry.operation}</button></>}
  </article>)}
  {receipt&&<div className="border rounded p-3" aria-label="Recovery receipt"><p>{receipt.baseId} · {receipt.disposition} · {receipt.finishedAt}</p><button className="min-h-11 underline" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(receipt)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="keyspilli-recovery-receipt.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download recovery receipt</button></div>}
 </section>;
}
