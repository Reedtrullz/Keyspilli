"use client";
import {useEffect,useRef,useState} from "react";
import {diagnosticReceipt,serializeDiagnosticReceipt,loadPracticeState,loadPracticeSets,loadStringList,midiSupported} from "@keyspilli/player-core";
export function DiagnosticTools({publicationRevision=null,disabled=false}:{publicationRevision?:string|null;disabled?:boolean}) {
 const [preview,setPreview]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{const controller=active.current;active.current=null;controller?.abort();},[]);
 async function prepare(){
  active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setPreview(null);setNotice("");
  const deadline=window.setTimeout(()=>controller.abort(),3000);let health:unknown=null;
  try {
   const response=await fetch("/api/health",{signal:controller.signal,cache:"no-store"});const reader=response.body?.getReader();
   if(reader){const chunks:Uint8Array[]=[];let bytes=0;try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>32768)throw Error("Health response exceeds limit");chunks.push(item.value);}const content=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){content.set(chunk,offset);offset+=chunk.length;}health=JSON.parse(new TextDecoder().decode(content));}finally{await reader.cancel().catch(()=>{});}}
  }catch{if(active.current===controller)setNotice("Runtime status unavailable; the receipt marks missing states unknown.");}
  finally{window.clearTimeout(deadline);if(active.current===controller){const practice=loadPracticeState();try{setPreview(serializeDiagnosticReceipt(diagnosticReceipt({health,publicationRevision,counters:{passages:practice.passages.length,attempts:practice.attempts.length,favorites:loadStringList("keyspilli.favorites").length,practiceSets:loadPracticeSets().sets.length},browser:{midi:midiSupported(),microphone:!!navigator.mediaDevices?.getUserMedia,offlineAudio:typeof OfflineAudioContext!=="undefined"}})));}catch{setNotice("Could not prepare a bounded diagnostic receipt.");}setBusy(false);active.current=null;}}
 }
 return <details className="border-t mt-3 pt-3" aria-label="Privacy-safe diagnostics"><summary className="min-h-11 cursor-pointer">Troubleshooting receipt</summary>
  <p className="text-xs text-zinc-600">Revisions, reported readiness and small counters only. Private titles, URLs, paths, source bytes, raw logs, device names and environment configuration are excluded. Nothing is uploaded.</p>
  <button disabled={disabled||busy} className="min-h-11 underline" onClick={()=>void prepare()}>{busy?"Preparing receipt…":"Preview diagnostic receipt"}</button>
  {notice&&<p role="status">{notice}</p>}
  {preview&&<div><pre aria-label="Diagnostic preview" className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{preview}</pre>
   <button disabled={disabled} className="min-h-11 underline" onClick={()=>{const url=URL.createObjectURL(new Blob([preview],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="keyspilli-diagnostic-v1.json";link.click();URL.revokeObjectURL(url);}}>Download diagnostic receipt</button>
   <button className="min-h-11 underline ml-4" onClick={()=>setPreview(null)}>Discard diagnostic preview</button></div>}
 </details>;
}
