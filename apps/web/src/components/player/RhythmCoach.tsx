"use client";
import React,{useEffect,useRef,useState} from 'react';
import {AudioEngine,Grader,inputMetadata,rhythmPlan,type RhythmPlan,type RhythmCueMode,type SongData,type GradeResult} from '@keyspilli/player-core';
export function RhythmCoach({data,startBeat,endBeat,speed,disabled,onPrepare,onDone}:{data:SongData;startBeat:number;endBeat:number;speed:number;disabled:boolean;onPrepare():boolean;onDone():void}) {
 const [mode,setMode]=useState<RhythmCueMode>('meter'),[offset,setOffset]=useState(0),[running,setRunning]=useState(false),[notice,setNotice]=useState(''),[result,setResult]=useState<GradeResult|null>(null);
 const generation=useRef(0),frame=useRef(0),audio=useRef<AudioEngine|null>(null),run=useRef<{plan:RhythmPlan;grader:Grader;epoch:number;offset:number;nextCue:number;lastFrame:number;taps:number;context:{sourceFingerprint:string|null;startBeat:number;endBeat:number;bpm:number;speed:number};raw:{timestampMs:number;rawSec:number;adjustedSec:number;timingSource:string}[]} | null>(null);
 const lastRun=useRef<NonNullable<typeof run.current>|null>(null);
 function stop(reason:string,completed=false){generation.current++;cancelAnimationFrame(frame.current);const current=run.current;if(current)lastRun.current=current;run.current=null;audio.current?.dispose();audio.current=null;setRunning(false);onDone();setNotice(reason);if(completed&&current)setResult(current.grader.result());}
 useEffect(()=>{if(running)stop('Rhythm attempt interrupted: passage, tempo or player state changed.');setResult(null);lastRun.current=null;},[data,startBeat,endBeat,speed,disabled]);
 useEffect(()=>{
  const interrupt=()=>{if(run.current||audio.current)stop('Rhythm attempt interrupted. Start again when ready.');};
  const visibility=()=>{if(document.hidden)interrupt();};window.addEventListener('blur',interrupt);document.addEventListener('visibilitychange',visibility);
  return()=>{generation.current++;cancelAnimationFrame(frame.current);audio.current?.dispose();audio.current=null;run.current=null;onDone();window.removeEventListener('blur',interrupt);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 async function start(){
  if(disabled||running)return;setResult(null);lastRun.current=null;
  let plan:RhythmPlan;try{plan=rhythmPlan(data,startBeat,endBeat,speed,mode);if(plan.endSec-plan.startSec>120)throw new Error('Choose a passage lasting at most two minutes.');if(!Number.isFinite(offset)||Math.abs(offset)>250)throw new Error('Manual tap offset must be within ±250 ms.');}catch(error){setNotice(error instanceof Error?error.message:'Rhythm target unavailable.');return;}
  if(!onPrepare())return;
  const token=++generation.current,engine=new AudioEngine();audio.current=engine;setRunning(true);setNotice('Preparing rhythm taps…');
  try{
   const context=engine.ensure();if(context.state==='suspended')await context.resume();if(generation.current!==token){engine.dispose();return;}if(context.state!=='running')throw new Error('Audio is unavailable.');
   const epoch=performance.now()+1000;run.current={plan,grader:new Grader(plan.targets,{bpm:data.tempoBpm,speed}),epoch,offset,nextCue:0,lastFrame:performance.now(),taps:0,context:{sourceFingerprint:data.sourceFingerprint??null,startBeat,endBeat,bpm:data.tempoBpm,speed},raw:[]};
   engine.onStateChange=state=>{if(generation.current===token&&state!=='running')stop('Audio interrupted; rhythm attempt stopped.');};
   const tick=()=>{
    const current=run.current;if(!current||generation.current!==token)return;const now=performance.now(),elapsed=(now-current.epoch)/1000;
    if(now-current.lastFrame>300){stop('Rhythm attempt interrupted by a timing gap.');return;}current.lastFrame=now;
    if(elapsed>=plan.endSec-plan.startSec+.4){current.grader.tick(plan.endSec+.4);stop('Rhythm-only result. Pitch, holds and musical mastery were not assessed.',true);return;}
    while(current.nextCue<plan.cues.length){const cue=plan.cues[current.nextCue]!,when=cue.timeSec-plan.startSec-elapsed;if(when>=.12)break;if(when<-.05){stop('Cue scheduling was interrupted.');return;}engine.metronomeClick(cue.accent?0:1,Math.max(0,when));current.nextCue++;}
    if(elapsed>=0)current.grader.tick(plan.startSec+elapsed);
    setNotice(elapsed<0?'Get ready: one second before the passage.':`${current.taps} taps · ${plan.cueAuthority==='source-meter'?'verified source meter':'owner-selected '+current.plan.cueMode+' cues'} · pitch is ignored`);
    frame.current=requestAnimationFrame(tick);
   };frame.current=requestAnimationFrame(tick);
  }catch(error){if(generation.current===token)stop(error instanceof Error?error.message:'Unable to start rhythm audio.');}
 }
 function tap(event:{timeStamp:number}){
  const current=run.current;if(!current)return;const timing=inputMetadata(event,1),rawSec=current.plan.startSec+(timing.timestampMs-current.epoch)/1000;
  if(timing.timestampMs<current.epoch||rawSec>=current.plan.endSec||current.taps>=512)return;
  const adjustedSec=rawSec-current.offset/1000;current.grader.play(60,adjustedSec,{rawSec,offsetMs:current.offset});current.taps++;current.raw.push({timestampMs:timing.timestampMs,rawSec,adjustedSec,timingSource:timing.timingSource});
 }
 function download(){const current=run.current??lastRun.current;if(!current)return;const text=JSON.stringify({version:1,kind:'rhythm-only-taps',...current.context,cueMode:current.plan.cueMode,targetStartsSec:current.plan.targets.map(target=>target.startSec),cueAuthority:current.plan.cueAuthority,manualOffsetMs:current.offset,events:current.raw},null,2),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='keyspilli-rhythm-taps.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <details className="border rounded p-3 my-3" aria-label="Rhythm-only passage coach" onToggle={event=>{if(!event.currentTarget.open&&running)stop('Rhythm attempt cancelled.');}}><summary className="min-h-11 cursor-pointer">Optional rhythm-only passage</summary>
  <p>Tap once per simultaneous attack in the selected loop, or the current four-bar passage. Pitches and holds are ignored. Wait mode and ordinary practice are unchanged. This manual prototype keeps no practice-history or tempo-ladder score.</p>
  <fieldset disabled={running||disabled}><label>Cues<select aria-label="Rhythm cues" className="border p-2" value={mode} onChange={e=>setMode(e.target.value as RhythmCueMode)}><option value="meter">Verified source meter</option><option value="quarter">I choose quarter-note cues</option><option value="eighth">I choose eighth-note cues</option></select></label>
  <label>Manual tap offset (ms)<input aria-label="Manual tap offset (ms)" type="number" min="-250" max="250" value={offset} onChange={e=>setOffset(Number(e.target.value))}/></label><p>This offset applies only to these button/key taps. It is not a measured device calibration; raw and adjusted timestamps remain separate.</p>
  <button className="min-h-11 underline" type="button" onClick={()=>void start()}>Start rhythm-only attempt</button></fieldset>
  {disabled&&<p>Pause playback and finish other practice before starting.</p>}
  {running&&<div><button className="min-h-11 border px-4" type="button" aria-label="Rhythm tap" onPointerDown={event=>{if(event.button===0){event.preventDefault();event.currentTarget.focus();tap(event);}}} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)tap(event);}}} onClick={event=>{if(event.detail===0)tap(event);}}>Tap (Space or Enter)</button><button className="min-h-11 underline" onClick={()=>stop('Rhythm attempt cancelled; no result saved.')}>Stop rhythm attempt</button></div>}
  {(running||lastRun.current)&&<><button className="min-h-11 underline" onClick={download}>Download raw rhythm taps</button><button className="min-h-11 underline" disabled={running} onClick={()=>{lastRun.current=null;setResult(null);setNotice("Local rhythm take removed.");}}>Remove rhythm take</button></>}
  <p role="status" aria-label="Rhythm status">{notice}</p>{result&&<p aria-label="Rhythm-only result">{result.hit} timed taps · {result.missed} missed · {result.late} late · {result.accuracyPct}% rhythm-only accuracy</p>}
 </details>;
}
