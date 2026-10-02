"use client";
import {useEffect,useRef,useState} from "react";
import type {tombstoneInventory} from "@keyspilli/catalog";
type Entry=ReturnType<typeof tombstoneInventory>[number];
export function TombstoneRecovery(){
 const [entries,setEntries]=useState<Entry[]|null>(null),[confirmation,setConfirmation]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const controllerRef=useRef<AbortController|null>(null);useEffect(()=>()=>controllerRef.current?.abort(),[]);
 async function run(entry?:Entry,action?:"finish"|"undo"|"purge"){
  if(busy)return;const controller=new AbortController();controllerRef.current=controller;setBusy(true);setNotice("");const timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch("/api/catalog/tombstones",{signal:controller.signal,...(entry?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({baseId:entry.baseId,confirmBaseId:confirmation[entry.baseId],token:entry.token,action})}:{})});const result=await response.json();if(!response.ok)throw new Error(result.error??"Quarantine unavailable.");if(controller.signal.aborted)return;if(entry){setEntries(null);setNotice(`${result.receipt.state}. Refresh the inventory before another action.`);setConfirmation({});}else{setEntries(result.entries);setConfirmation({});}}
  catch(error){if(controllerRef.current===controller){setEntries(null);setNotice(controller.signal.aborted?"Request interrupted. Refresh to inspect durable state before retrying.":error instanceof Error?error.message:"Quarantine unavailable.");}}
  finally{clearTimeout(timer);if(controllerRef.current===controller)setBusy(false);}
 }
 return <section className="space-y-3" aria-label="Quarantine maintenance"><h2 className="text-xl font-semibold">Quarantine and undo</h2><p>Retention is chosen when removing each lesson. Undo restores the same version and rows; it does not re-queue jobs or approve excluded lessons. No automatic purge runs.</p><button className="min-h-11 border rounded px-3" disabled={busy} onClick={()=>void run()}>Refresh quarantine inventory</button>{notice&&<p role="status">{notice}</p>}{entries?.length===0&&<p>No recorded tombstones.</p>}
 {entries?.map(entry=><article key={entry.token} className="border rounded p-3 space-y-2" aria-label={`Tombstone ${entry.baseId}`}><h3 className="font-semibold">{entry.title}</h3><p className="break-all">{entry.baseId} · {entry.state} · {(entry.bytes/1048576).toFixed(2)} MiB</p><p>Undo deadline: {new Date(entry.expiresAt).toLocaleString()}</p>{!["restored","purged"].includes(entry.state)&&<><label>Confirm base ID<input disabled={busy} className="min-h-11 block border rounded px-2 w-full" value={confirmation[entry.baseId]??""} onChange={event=>setConfirmation(current=>({...current,[entry.baseId]:event.target.value}))}/></label>
 {entry.state==="quarantining"&&<button className="min-h-11 border rounded px-3" disabled={busy||confirmation[entry.baseId]!==entry.baseId} onClick={()=>void run(entry,"finish")}>Finish recorded quarantine</button>}
 {["quarantined","restoring"].includes(entry.state)&&<button className="min-h-11 border rounded px-3" disabled={busy||confirmation[entry.baseId]!==entry.baseId||(entry.state!=="restoring"&&Date.now()>=Date.parse(entry.expiresAt))} onClick={()=>void run(entry,"undo")}>{entry.state==="restoring"?"Finish recorded undo":"Undo lesson removal"}</button>}
 {["quarantined","purging"].includes(entry.state)&&<button className="min-h-11 border rounded px-3 ml-2" disabled={busy||confirmation[entry.baseId]!==entry.baseId||Date.now()<Date.parse(entry.expiresAt)} onClick={()=>void run(entry,"purge")}>Permanently purge expired owned files</button>}
 </>}</article>)}
 </section>;
}
