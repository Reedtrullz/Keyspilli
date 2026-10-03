import {playbackTiming,beatToSec,type TimedNote} from './timeline.js';
import type {SongData} from './types.js';
export type RhythmCueMode='meter'|'quarter'|'eighth';
export interface RhythmPlan {targets:TimedNote[];cues:{beat:number;timeSec:number;accent:boolean}[];startSec:number;endSec:number;cueAuthority:'source-meter'|'owner-choice';cueMode:RhythmCueMode}
/** A separate onset exercise; simultaneous pitches are one tap, never an inferred rhythm edit. */
export function rhythmPlan(data:SongData,startBeat:number,endBeat:number,speed:number,mode:RhythmCueMode='meter'):RhythmPlan {
 if(!['meter','quarter','eighth'].includes(mode)||![startBeat,endBeat,speed,data.tempoBpm].every(Number.isFinite)||startBeat<0||endBeat<=startBeat||endBeat-startBeat>64||speed<.25||speed>4||data.tempoBpm<20||data.tempoBpm>400||data.notes.length>20000)throw new Error('Choose a passage of at most 64 beats and a supported tempo.');
 const songEnd=Math.max(0,...data.measures.map(m=>m.endBeat),...data.notes.map(n=>n.start+n.dur));
 if(!Number.isFinite(songEnd)||endBeat>songEnd+1e-6)throw new Error('Passage exceeds the arrangement.');
 const timing=playbackTiming(data);
 if(mode==='meter'&&!timing)throw new Error('Source meter phase is unverified. Explicitly choose quarter or eighth cues.');
 const attacks=[...new Set(data.notes.filter(n=>Number.isFinite(n.start)&&n.start>=startBeat&&n.start<endBeat).map(n=>n.start))].sort((a,b)=>a-b);
 if(!attacks.length||attacks.length>256)throw new Error('Choose a passage with 1–256 distinct attacks.');
 const cues:RhythmPlan['cues']=[];
 const events=timing?.timeSigEvents?.length?timing.timeSigEvents:[{beat:timing?.measureStartBeat??0,timeSig:timing?.timeSig??data.timeSig}];
 const regions=mode==='meter'?events:[{beat:0,timeSig:data.timeSig}];
 for(let i=0;i<regions.length;i++){
  const event=regions[i]!,lower=Math.max(startBeat,i===0?0:event.beat),upper=Math.min(endBeat,regions[i+1]?.beat??endBeat),meter=event.timeSig;
  const unit=4/meter[1],width=meter[0]*unit,pulse=mode==='quarter'?1:mode==='eighth'?.5:meter[1]===8&&meter[0]>=6&&meter[0]%3===0?3*unit:unit;
  if(!Number.isFinite(pulse)||pulse<=0||!Number.isFinite(width)||width<=0)throw new Error('Unsupported meter.');
  for(let beat=event.beat+Math.ceil((lower-event.beat)/pulse-1e-9)*pulse;beat<upper-1e-9;beat+=pulse){
   if(cues.length>=128)throw new Error('Cue count exceeds this exercise limit.');
   cues.push({beat,timeSec:beatToSec(beat,data.tempoBpm,speed),accent:mode==='meter'&&Math.abs((beat-event.beat)/width-Math.round((beat-event.beat)/width))<1e-6});
  }
 }
 return {targets:attacks.map(beat=>({midi:60,startSec:beatToSec(beat,data.tempoBpm,speed),durSec:0,vel:1})),cues,startSec:beatToSec(startBeat,data.tempoBpm,speed),endSec:beatToSec(endBeat,data.tempoBpm,speed),cueAuthority:mode==='meter'?'source-meter':'owner-choice',cueMode:mode};
}
