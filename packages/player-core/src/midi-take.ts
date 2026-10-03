import type {InputEventMetadata} from './input.js';
import type {PracticeTarget} from './practice-store.js';
import type {TimedNote} from './timeline.js';
export interface MidiTakeContext {target:PracticeTarget;revision:string;startBeat:number;endBeat:number;bpm:number;speed:number;transpose:number;device:string;channel:number;targets:TimedNote[]}
export interface MidiTakeEvent {kind:'on'|'off'|'pedal';sec:number;timestampMs:number;timingSource:'event'|'dispatch';midi:number;value:number;identity:string;order:number}
export interface MidiTake {version:1;kind:'owner-midi-performance';context:MidiTakeContext;startedMs:number;endSec:number;status:'recording'|'stopped'|'interrupted'|'limit';events:MidiTakeEvent[]}
/** Local, explicitly started capture. It never changes target notes or infers a physical hand. */
export class MidiTakeRecorder {
 private take:MidiTake;
 constructor(context:MidiTakeContext,startedMs:number){
  if(!Number.isFinite(startedMs)||startedMs<0||!context.device||context.device.length>256||!Number.isInteger(context.channel)||context.channel<0||context.channel>15||!/^sha256:[a-f0-9]{64}$/.test(context.target.fingerprint)||!context.revision||context.revision.length>128||!Number.isFinite(context.startBeat)||context.startBeat<0||!Number.isFinite(context.endBeat)||context.endBeat<=context.startBeat||context.endBeat-context.startBeat>128||!Number.isFinite(context.bpm)||context.bpm<20||context.bpm>400||!Number.isFinite(context.speed)||context.speed<.25||context.speed>4||!Number.isInteger(context.transpose)||Math.abs(context.transpose)>24||context.targets.length>2048||context.targets.some(n=>!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.startSec)||!Number.isFinite(n.durSec)||n.durSec<=0))throw new Error('Select a bounded, version-bound passage and one MIDI device/channel.');
  this.take={version:1,kind:'owner-midi-performance',context:structuredClone(context),startedMs,endSec:0,status:'recording',events:[]};
 }
 get recording(){return this.take.status==='recording';}
 get startedMs(){return this.take.startedMs;}
 get eventCount(){return this.take.events.length;}
 capture(kind:MidiTakeEvent['kind'],identity:string,midi:number,event?:InputEventMetadata):boolean{
  if(!this.recording)return false;
  if(!event){this.finish(this.take.startedMs+this.take.endSec*1000,'interrupted');return false;}
  if(event.deviceId!==this.take.context.device||event.channel!==this.take.context.channel)return false;
  const sec=(event.timestampMs-this.take.startedMs)/1000;
  if(!Number.isFinite(sec)||sec<0||identity.length>320||!identity.startsWith(`midi:${event.deviceId}:${event.channel}:`)||!Number.isInteger(midi)||midi<0||midi>127||!Number.isInteger(event.velocity)||event.velocity<0||event.velocity>127)return false;
  if(sec>240||this.take.events.length>=8192){this.finish(this.take.startedMs+240000,'limit');return false;}
  this.take.events.push({kind,identity,midi,value:event.velocity,sec,timestampMs:event.timestampMs,timingSource:event.timingSource,order:this.take.events.length});this.take.endSec=Math.max(this.take.endSec,sec);return true;
 }
 finish(nowMs:number,status:Exclude<MidiTake['status'],'recording'>='stopped'):MidiTake{
  if(!Number.isFinite(nowMs))throw new Error('Invalid take end timestamp.');
  if(this.recording){this.take.endSec=Math.max(this.take.endSec,Math.min(240,Math.max(0,(nowMs-this.take.startedMs)/1000)));this.take.status=status;}return this.snapshot();
 }
 snapshot():MidiTake{return structuredClone(this.take);}
}
export interface PerformedNote {midi:number;startSec:number;durSec:number;velocity:number;releaseObserved:boolean;endReason:'observed'|'retrigger'|'take-ended';soundingEndSec:number}
/** Derive key intervals and pedal resonance separately; synthetic closure is explicit. */
export function performedNotes(take:MidiTake):PerformedNote[]{
 const active=new Map<string,PerformedNote>(),released=new Set<PerformedNote>(),notes:PerformedNote[]=[];let pedal=false;
 for(const event of [...take.events].sort((a,b)=>a.sec-b.sec||a.order-b.order)){
  if(event.kind==='pedal'){pedal=event.value>=64;if(!pedal){for(const note of released)note.soundingEndSec=event.sec;released.clear();}continue;}
  if(event.kind==='on'){
   const prior=active.get(event.identity);if(prior){prior.durSec=Math.max(0,event.sec-prior.startSec);prior.soundingEndSec=event.sec;prior.endReason='retrigger';}
   const note:PerformedNote={midi:event.midi,startSec:event.sec,durSec:Math.max(0,take.endSec-event.sec),velocity:event.value,releaseObserved:false,endReason:'take-ended',soundingEndSec:take.endSec};active.set(event.identity,note);notes.push(note);
  }else{const note=active.get(event.identity);if(!note)continue;active.delete(event.identity);note.durSec=Math.max(0,event.sec-note.startSec);note.releaseObserved=true;note.endReason='observed';if(pedal)released.add(note);else note.soundingEndSec=event.sec;}
 }
 return notes.filter(note=>note.durSec>0);
}
/** Audio replay uses sounding spans; MIDI/hold views keep the original key intervals. */
export function replayTakeNotes(take:MidiTake,seekSec=0,speed=1,reference=false):TimedNote[]{
 if(!Number.isFinite(seekSec)||seekSec<0||seekSec>take.endSec||!Number.isFinite(speed)||speed<.5||speed>2)throw new Error('Choose a valid take position and 0.5–2× replay speed.');
 const source=reference?take.context.targets.map(note=>({midi:note.midi,startSec:note.startSec,soundingEndSec:note.startSec+note.durSec,velocity:note.vel})):performedNotes(take);
 if(reference&&source.some(note=>note.soundingEndSec>240))throw new Error("Frozen target replay exceeds 240 seconds. Shorten the passage.");
 const notes=source.filter(note=>note.soundingEndSec>seekSec).map(note=>({midi:note.midi,startSec:Math.max(0,note.startSec-seekSec)/speed,durSec:(note.soundingEndSec-Math.max(seekSec,note.startSec))/speed,vel:note.velocity}));
 if(notes.length>1024)throw new Error('Replay supports at most 1,024 notes. Choose a shorter take or target passage.');
 const boundaries=notes.flatMap(n=>[{sec:n.startSec,change:1},{sec:n.startSec+n.durSec,change:-1}]).sort((a,b)=>a.sec-b.sec||a.change-b.change);let voices=0;
 for(const edge of boundaries){voices+=edge.change;if(voices>64)throw new Error('Replay exceeds 64 sounding voices. Shorten the take or release the pedal.');}
 return notes;
}
