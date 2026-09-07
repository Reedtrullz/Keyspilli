"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
export default function TutorialImport(){
 const [url,setUrl]=useState(""),[jobId,setJobId]=useState(""),[status,setStatus]=useState(""),[songId,setSongId]=useState(""),[error,setError]=useState("");
 useEffect(()=>{
  if(!jobId)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{
    const response=await fetch("/api/youtube/status/"+encodeURIComponent(jobId),{signal:controller.signal});
    const job=await response.json();if(!response.ok)throw Error(job.error??"Status unavailable");
    setStatus(job.status);
    if(job.status==="done"){setSongId(job.songId);return;}
    if(job.status==="error"){setError(job.error??"No supported arrangement found");return;}
    timer=setTimeout(poll,2000);
   }catch(e){if(!controller.signal.aborted)setError(String(e));}
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[jobId]);
 return <div className="page-shell max-w-2xl mx-auto px-4 py-10">
  <h1 className="text-2xl font-bold">YouTube piano preview</h1>
  <p className="my-4">Paste a recording link. Keyspilli will look for a matching piano tutorial and follow that arrangement. Results are experimental; source rights and melody inclusion are unverified.</p>
  <form onSubmit={async e=>{
   e.preventDefault();setError("");setSongId("");setStatus("Submitting");setJobId("");
   try{
    const response=await fetch("/api/youtube/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url})});
    const result=await response.json();if(!response.ok)throw Error(result.error??"Import failed");
    setJobId(result.jobId);
   }catch(e){setError(String(e));setStatus("");}
  }}>
   <label htmlFor="tutorial-url">YouTube link</label>
   <input id="tutorial-url" type="url" required value={url} onChange={e=>setUrl(e.target.value)} className="border rounded p-2 w-full my-2"/>
   <button disabled={!!status&&!["done","error"].includes(status)&&!error} className="border rounded px-4 py-2">Create piano preview</button>
  </form>
  <p role="status" className="my-4">{status}</p>
  {error&&<p role="alert">{error}</p>}
  {songId&&<Link className="underline" href={"/player/"+encodeURIComponent(songId)}>Open piano lesson</Link>}
 </div>;
}
