"use client";
import {writeMidi} from "@keyspilli/midi";
import React,{useEffect,useRef,useState,type RefObject} from 'react';
import {AudioEngine,MidiTakeRecorder,performedNotes,replayTakeNotes,type MidiTake,type MidiTakeContext,type TimedNote,type InputEventMetadata,type PracticeTarget} from '@keyspilli/player-core';
export interface MidiTakeInput {note(midi:number,on:boolean,source:'keyboard'|'midi',identity:string,event?:InputEventMetadata):boolean;pedal(scope:string,event?:InputEventMetadata):boolean;interrupt():void}
export function MidiTakePanel({inputRef,target,revision,targets,startBeat,endBeat,bpm,speed,transpose,device,channel,disabled,onPrepare,onDone}:{inputRef:RefObject<MidiTakeInput|null>;target:PracticeTarget|null;revision:string|null|undefined;targets:TimedNote[];startBeat:number;endBeat:number;bpm:number;speed:number;transpose:number;device:string|null;channel:number|null;disabled:boolean;onPrepare():boolean;onDone():void}) {
 const [take,setTake]=useState<MidiTake|null>(null),[phase,setPhase]=useState<'idle'|'recording'|'replay'>('idle'),[notice,setNotice]=useState(''),[seek,setSeek]=useState(0),[rate,setRate]=useState(1),[approved,setApproved]=useState(false);
 const recorder=useRef<MidiTakeRecorder|null>(null),phaseRef=useRef(phase),audio=useRef<AudioEngine|null>(null),frame=useRef(0),token=useRef(0);phaseRef.current=phase;
 function stopAudio(){token.current++;cancelAnimationFrame(frame.current);audio.current?.dispose();audio.current=null;}
 function finish(interrupted=false){stopAudio();const current=recorder.current;if(current){setTake(current.finish(performance.now(),interrupted?'interrupted':'stopped'));recorder.current=null;}phaseRef.current='idle';setPhase('idle');onDone();setNotice(interrupted?'Take interrupted. Unobserved releases remain unobserved.':'Take stopped. Target notes are unchanged.');}
 useEffect(()=>{
  inputRef.current={note(midi,on,source,identity,event){if(phaseRef.current==='replay')return true;if(phaseRef.current!=='recording')return false;if(source!=='midi')return true;
    const current=recorder.current;if(!current)return true;current.capture(on?'on':'off',identity,midi,event);if(!current.recording)finish(true);return true;},
   pedal(scope,event){if(phaseRef.current==='replay')return true;if(phaseRef.current!=='recording')return false;recorder.current?.capture('pedal',scope,64,event);if(recorder.current&&!recorder.current.recording)finish(true);return true;},interrupt(){if(phaseRef.current!=='idle')finish(true);}};
  return()=>{inputRef.current=null;recorder.current=null;stopAudio();onDone();};
 },[inputRef]);
 useEffect(()=>{if(phaseRef.current!=='idle')finish(true);setApproved(false);setSeek(0);},[target?.fingerprint,revision,startBeat,endBeat,bpm,speed,transpose,device,channel,disabled]);
 useEffect(()=>{const blur=()=>{if(phaseRef.current!=='idle')finish(true);},hidden=()=>{if(document.hidden)blur();};window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);};},[]);
 const eligible=!!target&&!!revision&&!!device&&channel!==null&&!disabled;
 function record(){
  if(!eligible||!approved||phaseRef.current!=='idle')return;
  const spb=60/bpm/speed,startSec=startBeat*spb,endSec=endBeat*spb;
  const context:MidiTakeContext={target:target!,revision:revision!,startBeat,endBeat,bpm,speed,transpose,device:device!,channel:channel!,targets:targets.filter(n=>n.startSec<endSec&&n.startSec+n.durSec>startSec).map(n=>({...n,startSec:n.startSec-startSec}))};
  try{recorder.current=new MidiTakeRecorder(context,performance.now()+1000);}catch(error){setNotice(error instanceof Error?error.message:'Take is unavailable.');return;}
  if(!onPrepare()){recorder.current=null;return;}
  setTake(null);setSeek(0);phaseRef.current='recording';setPhase('recording');const current=recorder.current;
  const tick=()=>{if(recorder.current!==current)return;const elapsed=(performance.now()-current.startedMs)/1000;
   if(elapsed>=Math.min(240,(endBeat-startBeat)*spb)){finish();return;}setNotice(elapsed<0?'Get ready: recording starts in one second.':`Recording MIDI take · ${current.eventCount} raw events · ${elapsed.toFixed(1)} seconds`);frame.current=requestAnimationFrame(tick);};frame.current=requestAnimationFrame(tick);
 }
 async function replay(reference=false){
  if(!take||phaseRef.current!=='idle'||disabled)return;let notes:TimedNote[];
  try{notes=replayTakeNotes(take,seek,rate,reference);if(!notes.length)throw new Error('No sounding notes at this position.');}catch(error){setNotice(error instanceof Error?error.message:'Replay unavailable.');return;}
  if(!onPrepare())return;
  const engine=new AudioEngine();engine.sustainPedal=false;engine.setGains(1,1);audio.current=engine;const generation=++token.current;phaseRef.current='replay';setPhase('replay');
  try{const ctx=engine.ensure();if(ctx.state==='suspended')await ctx.resume();if(token.current!==generation)return;if(ctx.state!=='running')throw new Error('Audio is unavailable.');
   engine.onStateChange=state=>{if(token.current===generation&&state!=='running')finish(true);};
   let next=0,previous=performance.now();const ordered=notes.sort((a,b)=>a.startSec-b.startSec),began=performance.now(),end=Math.max(...ordered.map(n=>n.startSec+n.durSec));
   setNotice(reference?'Hearing the frozen target; no take or grading input is recorded.':'Replaying the performed take; pedal resonance is separate from physical key duration.');
   const tick=()=>{if(token.current!==generation)return;const now=performance.now(),elapsed=(now-began)/1000;if(now-previous>300){finish(true);return;}previous=now;if(elapsed>end+.2){finish();return;}
    while(next<ordered.length&&ordered[next]!.startSec<elapsed+.12){const n=ordered[next++]!;if(n.startSec<elapsed-.05){finish(true);return;}engine.noteOn(n,Math.max(0,n.startSec-elapsed));}frame.current=requestAnimationFrame(tick);};frame.current=requestAnimationFrame(tick);
  }catch(error){if(token.current===generation){finish(true);setNotice(error instanceof Error?error.message:'Replay interrupted.');}}
 }
 function download(){if(!take)return;const url=URL.createObjectURL(new Blob([JSON.stringify(take,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='keyspilli-performed-midi-take.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function downloadMidi(){if(!take)return;try{
  const performed=performedNotes(take),notes=performed.map(note=>({midi:note.midi,start:note.startSec*2,dur:note.durSec*2,vel:note.velocity}));
  const pedalChanges=take.events.filter(event=>event.kind==='pedal').map(event=>({beat:event.sec*2,channel:0,value:event.value}));
  if(pedalChanges.at(-1)?.value && pedalChanges.at(-1)!.value>=64)pedalChanges.push({beat:take.endSec*2,channel:0,value:0});
  const bytes=writeMidi(notes,{tempoBpm:120,title:"Owner performance - key intervals",tracks:[{name:"Owner performance (temporary take)",notes,channel:0}],pedalChanges}),url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/midi'})),a=document.createElement('a');a.href=url;a.download='keyspilli-performed-take.mid';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Performance MIDI uses piano channel 1 and a seconds-preserving clock. Unobserved endings and any held pedal are closed at the take boundary; raw JSON retains the original evidence.');
 }catch(error){setNotice(error instanceof Error?error.message:'Performance MIDI export unavailable.');}}
 const notes=take?performedNotes(take):[],width=Math.max(1,take?.endSec??1),reference=take?.context.targets??[],shown=notes.slice(0,1024),height=128;
 return <details className="border rounded p-3 my-3" aria-label="Local MIDI practice take" onToggle={event=>{if(!event.currentTarget.open&&phaseRef.current!=='idle')finish();}}><summary className="min-h-11 cursor-pointer">Optional local MIDI take</summary>
  <p>Record one selected device/channel for the current passage, with a one-second lead. The take is local and temporary; download it or remove it here. Internal input echo and grading are muted during capture/replay. MIDI observes notes and pedal, not fingers or physical hands.</p>
  {!eligible&&<p>Select a MIDI device/channel in Input, choose a version-bound passage and pause other playback/practice.</p>}
  <label><input type="checkbox" disabled={phase!=='idle'} checked={approved} onChange={event=>setApproved(event.target.checked)}/>I want to record this private local performance.</label>
  <button className="min-h-11 underline" disabled={!eligible||!approved||phase!=='idle'} onClick={record}>Record MIDI take</button>
  {phase!=='idle'&&<button className="min-h-11 underline" onClick={()=>finish()}>Stop MIDI take</button>}
  <p role="status" aria-label="MIDI take status">{notice}</p>
  {take&&<><p>Frozen passage at {take.context.bpm * take.context.speed} BPM, {take.context.transpose} semitones · {take.events.length} raw events · {notes.length} key intervals · {notes.filter(n=>!n.releaseObserved).length} unobserved key endings · {take.status}. Targets remain byte-identical; this is a performance, not an arrangement or quality receipt.</p>
   <fieldset disabled={phase!=='idle'||disabled}><label>Take seek (seconds)<input aria-label="Take seek (seconds)" type="number" min="0" max={take.endSec} step=".1" value={seek} onChange={e=>setSeek(Number(e.target.value))}/></label><label>Take replay speed<select aria-label="Take replay speed" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[.5,1,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label><button className="min-h-11 underline" onClick={()=>void replay()}>Hear performed take</button><button className="min-h-11 underline" onClick={()=>void replay(true)}>Hear frozen target</button><button className="min-h-11 underline" onClick={download}>Download raw MIDI take</button><button className="min-h-11 underline" onClick={downloadMidi}>Download performance MIDI</button><button className="min-h-11 underline" onClick={()=>{setTake(null);setNotice('Local take removed.');}}>Remove MIDI take</button></fieldset>
   <svg role="img" aria-label="Target and performed MIDI notes. Target is above each performed pitch row; the table gives exact key times." viewBox={`0 0 800 ${height}`} className="w-full border"><title>Frozen target (outline) and performed physical key intervals (filled). Pedal resonance does not lengthen the key bars.</title>{reference.slice(0,1024).map((n,i)=><rect key={'target'+i} x={Math.max(0,n.startSec)/width*800} y={(127-n.midi)} width={Math.max(1,n.durSec/width*800)} height=".8" fill="none" stroke="currentColor" strokeWidth=".3"/>)}{shown.map((n,i)=><rect key={i} x={n.startSec/width*800} y={127-n.midi+.8} width={Math.max(1,n.durSec/width*800)} height=".8" fill="currentColor"/>)}</svg>
   <table><caption>First 20 performed key intervals; raw download retains all events.</caption><thead><tr><th>Pitch (MIDI)</th><th>Attack (s)</th><th>Key release (s)</th><th>Release evidence</th></tr></thead><tbody>{notes.slice(0,20).map((n,i)=><tr key={i}><td>{n.midi}</td><td>{n.startSec.toFixed(3)}</td><td>{(n.startSec+n.durSec).toFixed(3)}</td><td>{n.releaseObserved?'Observed':n.endReason+'; physical release unknown'}</td></tr>)}</tbody></table>
  </>}
 </details>;
}
