"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
export default function TutorialImport(){
 const submitting=useRef(false);
 const [ready,setReady]=useState(false),[cancelling,setCancelling]=useState(false),[refresh,setRefresh]=useState(0);
 const [stage,setStage]=useState("");
 const [url,setUrl]=useState(""),[jobId,setJobId]=useState(""),[status,setStatus]=useState(""),[songId,setSongId]=useState(""),[error,setError]=useState("");
 useEffect(()=>{
  const saved=new URL(window.location.href).searchParams.get("job");
  if(saved && /^[a-zA-Z0-9_-]{1,100}$/.test(saved)){submitting.current=true;setJobId(saved);setStatus("Checking saved preview");}
  setReady(true);
 },[]);
 useEffect(()=>{
  if(!jobId)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{
    const response=await fetch("/api/youtube/status/"+encodeURIComponent(jobId),{signal:controller.signal,cache:"no-store"});
    const job=await response.json();if(controller.signal.aborted)return;
    if(response.status===404){submitting.current=false;setStatus("error");setError("Saved preview was not found. You can submit a new link.");return;}
    if(!response.ok)throw Error(job.error??"Status unavailable");
    setError("");setStatus(job.status);setStage(typeof job.stage==="string" ? job.stage : "");
    if(job.status==="done"||job.status==="error")submitting.current=false;
    if(job.status==="done"){setSongId(job.songId);return;}
    if(job.status==="error"){setError(job.error??"No supported arrangement found");return;}
   }catch{if(controller.signal.aborted)return;setError("Status unavailable; checking again shortly.");}
   timer=setTimeout(poll,2000);
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[jobId,refresh]);
 return <div className="page-shell max-w-2xl mx-auto px-4 py-10">
  <h1 className="text-2xl font-bold">YouTube piano · Private beta</h1>
  <p className="my-4">Paste a recording link. Keyspilli will look for a matching piano tutorial and follow that arrangement. Results are experimental and pending listening review; source rights and melody inclusion are unverified.</p>
  <form onSubmit={async e=>{
   e.preventDefault();if(!ready||submitting.current)return;submitting.current=true;setError("");setSongId("");setStage("");setStatus("Submitting");setJobId("");
   try{
    const response=await fetch("/api/youtube/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const result=await response.json();if(!response.ok)throw Error(result.error??"Import failed");
    const location=new URL(window.location.href);location.searchParams.set("job",result.jobId);window.history.replaceState(window.history.state,"",location);
    setJobId(result.jobId);
   }catch(e){submitting.current=false;setError(String(e));setStatus("");}
  }}>
   <label htmlFor="tutorial-url">YouTube link</label>
   <input id="tutorial-url" type="url" required value={url} onChange={e=>setUrl(e.target.value)} className="border rounded p-2 w-full my-2"/>
   <button disabled={!ready||submitting.current} className="border rounded px-4 py-2">Create piano preview</button>
  </form>
  {jobId&&submitting.current&&<button type="button" disabled={cancelling} className="border rounded px-4 py-2 mt-3" onClick={async()=>{
   if(cancelling)return;setCancelling(true);
   try{
    const response=await fetch("/api/youtube/jobs/"+encodeURIComponent(jobId),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel"})});
    if(!response.ok&&response.status!==409)throw Error("Cancellation unavailable; checking job status.");
   }catch(e){setError(String(e));}
   finally{setCancelling(false);setRefresh(value=>value+1);}
  }}>{cancelling ? "Cancelling…" : "Cancel preview"}</button>}
  <p role="status" className="my-4">{status}{stage ? " · "+stage : ""}</p>
  {error&&<p role="alert">{error}</p>}
  {songId&&<Link className="underline" href={"/player/"+encodeURIComponent(songId)}>Open piano lesson</Link>}
 </div>;
}
