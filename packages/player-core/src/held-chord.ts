import type {ChordPracticeSnapshot,ChordPracticeTarget} from './chord-practice.js';
export type HeldChordExercise='held'|'transition';
export interface HeldChordSnapshot extends ChordPracticeSnapshot {exercise:HeldChordExercise;physicalNotes:number[];heldStatus:string;transitionMetrics:{gapMs:number|null;overlapMs:number|null}[]}
/** Physical identity only: pedal sound and generated safety releases are not observations. */
export class HeldChordGrader {
 private down=new Map<string,{midi:number;at:number}>();private blocked=new Set<string>();private previous:number[]=[];
 private previousOwners=new Map<string,number>();
 private releases=new Map<number,number>();private readyAt:number|null=null;private index=0;private completed=0;private skipped=0;private wrong=0;
 private metrics:HeldChordSnapshot['transitionMetrics']=[];
 constructor(private targets:readonly ChordPracticeTarget[],readonly exercise:HeldChordExercise,readonly windowMs=200,readonly holdMs=500){
  if(!['held','transition'].includes(exercise)||!Number.isFinite(windowMs)||windowMs<50||windowMs>1000||!Number.isFinite(holdMs)||holdMs<250||holdMs>2000
   ||targets.length>256||targets.some(t=>!t.notes.length||t.notes.length>10||new Set(t.notes).size!==t.notes.length||t.notes.some(n=>!Number.isInteger(n)||n<0||n>127)))throw new Error('Invalid bounded held-chord exercise');
 }
 get currentTarget(){return this.targets[this.index]??null;}
 get finished(){return this.index>=this.targets.length;}
 press(midi:number,identity:string,at:number){
  if(this.finished||!Number.isInteger(midi)||midi<0||midi>127||!identity||identity.length>256||!Number.isFinite(at)||at<0||this.down.has(identity))return;
  if(this.down.size>=128){this.clearKeys();return;}
  this.down.set(identity,{midi,at});if(!this.currentTarget!.notes.includes(midi))this.wrong++;
  this.readyAt=null;this.update(at);
 }
 release(identity:string,at:number){
  const key=this.down.get(identity);if(!key||!Number.isFinite(at)||at<key.at)return;
  this.down.delete(identity);this.blocked.delete(identity);this.releases.set(key.midi,at);this.readyAt=null;this.update(at);
 }
 clearKeys(){this.previousOwners.clear();this.down.clear();this.blocked.clear();this.releases.clear();this.readyAt=null;}
 private readiness(){
  const target=this.currentTarget;if(!target)return {ready:false,status:'Exercise complete'};
  if(this.blocked.size)return {ready:false,status:'Release the previous shape before the next attack'};
  const pitches=new Set([...this.down.values()].map(n=>n.midi));
  if(pitches.size!==target.notes.length||target.notes.some(n=>!pitches.has(n)))return {ready:false,status:'Hold every exact target pitch; release other keys'};
  const attacks=[...this.down.entries()].filter(([id,n])=>this.exercise!=='transition'||!this.previous.includes(n.midi)||this.previousOwners.get(id)!==n.at).map(([,n])=>n.at);
  if(attacks.length&&Math.max(...attacks)-Math.min(...attacks)>this.windowMs)return {ready:false,status:'Rolling attack exceeds the chosen window; release and try again'};
  return {ready:true,status:`Exact shape held; keep physical keys down for ${this.holdMs} ms`};
 }
 private update(at:number){const ready=this.readiness().ready;if(!ready)this.readyAt=null;else if(this.readyAt===null)this.readyAt=at;}
 tick(at:number){
  if(!Number.isFinite(at)||at<0)return;this.update(at);
  if(this.readyAt===null||at-this.readyAt<this.holdMs)return;
  const target=this.currentTarget!;
  if(this.exercise==='transition'&&this.previous.length){
   const oldOnly=this.previous.filter(n=>!target.notes.includes(n)),fresh=[...this.down.entries()].filter(([id,n])=>!this.previous.includes(n.midi)||this.previousOwners.get(id)!==n.at).map(([,n])=>n.at),oldReleases=oldOnly.map(n=>this.releases.get(n));
   const delta=fresh.length&&oldOnly.length&&oldReleases.every(n=>n!==undefined)?Math.max(...oldReleases as number[])-Math.min(...fresh):null;
   this.metrics.push({gapMs:delta===null?null:Math.max(0,-delta),overlapMs:delta===null?null:Math.max(0,delta)});
  }
  this.previousOwners=new Map([...this.down].map(([id,n])=>[id,n.at]));this.previous=[...target.notes];this.index++;this.completed++;this.readyAt=null;this.releases.clear();
  const next=this.currentTarget;
  if(this.exercise==='held'||next&&next.notes.length===target.notes.length&&next.notes.every(n=>target.notes.includes(n)))this.blocked=new Set(this.down.keys());
 }
 skip(){if(this.finished)return;this.index++;this.skipped++;this.previous=[];this.clearKeys();}
 snapshot():HeldChordSnapshot {
  const target=this.currentTarget,physicalNotes=[...new Set([...this.down.values()].map(n=>n.midi))].sort((a,b)=>a-b),pc=(n:number)=>(n+120)%12;
  return {exercise:this.exercise,physicalNotes,heldStatus:this.readiness().status,transitionMetrics:[...this.metrics],currentIndex:this.index,total:this.targets.length,completed:this.completed,skipped:this.skipped,wrong:this.wrong,target,
   playedPitchClasses:[...new Set(physicalNotes.map(pc))],remainingPitchClasses:[...new Set((target?.notes??[]).filter(n=>!physicalNotes.includes(n)).map(pc))],lastWrongPitchClass:null,finished:this.finished,completionPct:this.targets.length?Math.round(this.completed/this.targets.length*100):null};
 }
}
