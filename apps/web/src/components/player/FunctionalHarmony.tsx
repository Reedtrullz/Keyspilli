"use client";
import React,{useEffect,useState} from 'react';
import {functionalDegree,validKeyRegions,type ConfirmedKeyRegion,type ChordLabel} from '@keyspilli/player-core';
import {chordProvenance} from './chord-provenance';
export function FunctionalHarmony({chords,sourceFingerprint,startBeat,endBeat,songEnd}:{chords:ChordLabel[];sourceFingerprint?:string;startBeat:number;endBeat:number;songEnd:number}) {
 const [regions,setRegions]=useState<ConfirmedKeyRegion[]>([]),[notice,setNotice]=useState('');
 useEffect(()=>{setRegions([]);setNotice('');},[sourceFingerprint]);
 return <details className="border rounded p-3 mt-3" aria-label="Derived harmony degrees"><summary className="min-h-11 cursor-pointer">Optional harmony degrees</summary>
  <p>Confirm a local key for this overlay. Degrees are derived explanations; they do not establish harmonic function, authorship or musical approval. Your changes leave backing and exports unchanged.</p>
  <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget),next=[...regions,{startBeat:Number(f.get('start')),endBeat:Number(f.get('end')),key:String(f.get('key')).trim()}].sort((a,b)=>a.startBeat-b.startBeat);
   if(!sourceFingerprint||!validKeyRegions(next,songEnd)){setNotice('Choose a supported major/minor key and a non-overlapping range (maximum 16).');return;}setRegions(next);setNotice('Key confirmed for this overlay only.');}}>
   <label>From beat (zero-based)<input className="block border p-2" type="number" name="start" min="0" max={songEnd} step="any" required defaultValue={startBeat}/></label>
   <label>Until beat<input className="block border p-2" type="number" name="end" min="0" max={songEnd} step="any" required defaultValue={endBeat}/></label>
   <label>Key you confirm<input className="block border p-2" name="key" maxLength={32} placeholder="C major or A minor" required/></label>
   <button className="min-h-11 underline" disabled={!sourceFingerprint}>Confirm key region</button>
  </form>
  {!sourceFingerprint&&<p>Exact source identity unavailable; key confirmation is withheld.</p>}
  {notice&&<p role="status">{notice}</p>}
  <ul>{regions.map((r,i)=><li key={i}>Beats {r.startBeat}–{r.endBeat}: {r.key} <button className="min-h-11 underline" onClick={()=>setRegions(regions.filter((_,j)=>j!==i))}>Remove key region {i+1}</button></li>)}</ul>
  <ul>{chords.slice(0,256).map((c,i)=>{const region=regions.find(r=>c.beat>=r.startBeat&&c.beat<r.endBeat),degree=functionalDegree(c.name,region?.key??null);return <li key={i}>{c.name} · {chordProvenance(c).label} · {degree?`Derived ${degree.roman} / ${degree.nashville}${degree.chromatic?' · chromatic or borrowed relationship':''}`:'Unknown degree; no confirmed key or unsupported symbol'}</li>;})}</ul>
  {chords.length>256&&<p>Showing the first 256 events in this bar.</p>}
 </details>;
}
