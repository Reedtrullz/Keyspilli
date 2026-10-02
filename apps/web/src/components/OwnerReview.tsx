"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import type {OwnerReviewList} from "@/lib/owner-review";
export function OwnerReview(){
 const [data,setData]=useState<OwnerReviewList|null>(null),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const controllerRef=useRef<AbortController|null>(null);useEffect(()=>()=>controllerRef.current?.abort(),[]);
 async function load(after=""){
  if(busy)return;const controller=new AbortController();controllerRef.current=controller;setBusy(true);setNotice("");const timer=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(`/api/catalog/review?after=${encodeURIComponent(after)}`,{signal:controller.signal});const result=await response.json();if(!response.ok)throw new Error(result.error??"Review unavailable.");if(!controller.signal.aborted)setData(result);}
  catch(error){if(controllerRef.current===controller){setData(null);setNotice(controller.signal.aborted?"Review timed out. Try refreshing.":error instanceof Error?error.message:"Review unavailable.");}}
  finally{clearTimeout(timer);if(controllerRef.current===controller)setBusy(false);}
 }
 return <section className="space-y-4" aria-label="Owner musical review"><h2 className="text-xl font-semibold">Musical review inventory</h2>
 <p>Inspect exact versions, including excluded lessons. Notes and manifest checks do not establish listening or keyboard acceptance. The existing version-bound admission importer is unavailable in this checkout; this view cannot approve or re-enable lessons.</p>
 <button className="min-h-11 border rounded px-3" disabled={busy} onClick={()=>void load()}>Refresh musical review</button>{notice&&<p role="status">{notice}</p>}
 {data?.entries.length===0&&<p>No versions on this page.</p>}
 {data?.entries.map(entry=><article key={entry.baseId} className="border rounded p-3 space-y-2" aria-label={`Review ${entry.baseId}`}><h3 className="font-semibold">{entry.title}</h3><p>{entry.artist} · {entry.excluded?"Excluded from learner catalog":"Catalog policy allows visibility"} · {entry.state}</p><p className="break-all text-xs">Version: {entry.publicationRevision??"unavailable or legacy unpinned"}</p>
 {entry.variants.map(variant=><details key={variant.id}><summary className="min-h-11">{variant.tier} · {variant.structural}</summary><p className="break-all text-xs">Source: {variant.sourceHash??"unknown"}<br/>Output: {variant.sourceFingerprint??"unknown"}</p><p>{variant.noteCount??"Unknown"} notes · {variant.profile??"unknown profile"} · {variant.sourceKind??"unknown source"} · rights {variant.rightsAttested?"owner attested":"unknown"}</p>{variant.decisions.map(decision=><p key={decision.mode}>{decision.mode}: admission unavailable · listening unknown · keyboard unknown</p>)}{entry.publicationRevision&&variant.sourceFingerprint&&<Link className="min-h-11 inline-flex items-center underline" href={`/maintenance/harmony?id=${encodeURIComponent(variant.id)}&revision=${encodeURIComponent(entry.publicationRevision)}`}>Preview owner harmony</Link>}</details>)}
 </article>)}
 {data?.next&&<button className="min-h-11 border rounded px-3" disabled={busy} onClick={()=>void load(data.next!)}>Next review page</button>}
 </section>;
}
