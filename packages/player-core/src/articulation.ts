import type {TimedNote} from "./timeline.js";
export interface ArticulationEvent {
 targetIndex:number|null;pitch:number;expectedDurationSec:number;expectedReleaseSec:number;
 rawPressSec:number;rawReleaseSec:number;offsetMs:number;holdErrorSec:number;releaseErrorSec:number;
 hold:"short"|"matched"|"long";release:"early"|"on-time"|"late";
}
export interface ArticulationResult {
 mode:"key-hold";total:number;observed:number;matchedHolds:number;shortHolds:number;longHolds:number;
 onTimeReleases:number;earlyReleases:number;lateReleases:number;unobserved:number;toleranceMs:number;
 events:ArticulationEvent[];omitted:number;
}
export function validArticulationResult(value:unknown):value is ArticulationResult {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const row=value as Record<string,unknown>,fields="mode total observed matchedHolds shortHolds longHolds onTimeReleases earlyReleases lateReleases unobserved toleranceMs events omitted".split(" ");
 if(Object.keys(row).length!==fields.length||Object.keys(row).some(key=>!fields.includes(key))||row.mode!=="key-hold")return false;
 const integer=(v:unknown)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=100000;
 for(const key of fields.filter(key=>!["mode","events","toleranceMs"].includes(key)))if(!integer(row[key]))return false;
 const r=row as unknown as ArticulationResult;
 if(!r.total||r.observed>r.total||r.matchedHolds+r.shortHolds+r.longHolds!==r.observed||r.onTimeReleases+r.earlyReleases+r.lateReleases!==r.observed||r.unobserved!==r.total-r.observed||!Number.isFinite(r.toleranceMs)||r.toleranceMs<50||r.toleranceMs>400||!Array.isArray(r.events)||r.events.length>12||r.omitted!==r.observed-r.events.length)return false;
 const valid=r.events.every(event=>{
  if(!event||typeof event!=="object"||Array.isArray(event)||Object.keys(event).sort().join(" ")!=="expectedDurationSec expectedReleaseSec hold holdErrorSec offsetMs pitch rawPressSec rawReleaseSec release releaseErrorSec targetIndex")return false;
  return (event.targetIndex===null||integer(event.targetIndex))&&Number.isInteger(event.pitch)&&event.pitch>=0&&event.pitch<=127
   &&[event.expectedDurationSec,event.expectedReleaseSec,event.rawPressSec,event.rawReleaseSec,event.offsetMs,event.holdErrorSec,event.releaseErrorSec].every(number=>typeof number==="number"&&Number.isFinite(number)&&Math.abs(number)<=1e7)
   &&event.expectedDurationSec>0&&event.expectedReleaseSec>0&&event.rawReleaseSec>=event.rawPressSec&&Math.abs(event.offsetMs)<=250
   &&event.expectedReleaseSec>=event.expectedDurationSec
   &&(event.targetIndex===null||event.targetIndex<r.total)
   &&Math.abs(event.holdErrorSec-(event.rawReleaseSec-event.rawPressSec-event.expectedDurationSec))<1e-9
   &&Math.abs(event.releaseErrorSec-(event.rawReleaseSec-event.offsetMs/1000-event.expectedReleaseSec))<1e-9
   &&event.hold===(event.holdErrorSec < -r.toleranceMs/1000?"short":event.holdErrorSec > r.toleranceMs/1000?"long":"matched")
   &&event.release===(event.releaseErrorSec < -r.toleranceMs/1000?"early":event.releaseErrorSec > r.toleranceMs/1000?"late":"on-time");
 });
 return valid&&r.events.length===Math.min(12,r.observed)
  &&r.events.filter(e=>e.hold==="short").length<=r.shortHolds&&r.events.filter(e=>e.hold==="matched").length<=r.matchedHolds&&r.events.filter(e=>e.hold==="long").length<=r.longHolds
  &&r.events.filter(e=>e.release==="early").length<=r.earlyReleases&&r.events.filter(e=>e.release==="on-time").length<=r.onTimeReleases&&r.events.filter(e=>e.release==="late").length<=r.lateReleases;
}
/** Timestamped physical keys only. Pedal and generated safety releases never enter here. */
export class ArticulationGrader {
 private down=new Map<string,{target:TimedNote;index:number|null;rawSec:number;offsetMs:number}>();
 private events:ArticulationEvent[]=[];
 private registered=new Set<string>();
 private counts={observed:0,matchedHolds:0,shortHolds:0,longHolds:0,onTimeReleases:0,earlyReleases:0,lateReleases:0};
 constructor(private total:number,private endSec:number,readonly toleranceMs=150){
  if(!Number.isInteger(total)||total<1||total>100000||!Number.isFinite(endSec)||endSec<=0||!Number.isFinite(toleranceMs)||toleranceMs<50||toleranceMs>400)throw new RangeError("Invalid articulation bounds");
 }
 press(identity:string,target:TimedNote,index:number|null,rawSec:number,offsetMs:number):void {
  if(!identity||identity.length>512||this.down.has(identity)||this.down.size>=128||!Number.isFinite(rawSec)||!Number.isFinite(offsetMs)||Math.abs(offsetMs)>250)return;
  const key=JSON.stringify([index,target.midi,target.startSec,target.durSec,target.hand]);
  if(this.registered.has(key)||this.registered.size>=this.total)return;
  this.registered.add(key);this.down.set(identity,{target,index,rawSec,offsetMs});
 }
 release(identity:string,rawSec:number):void {
  const held=this.down.get(identity);
  if(!held||!Number.isFinite(rawSec)||rawSec<held.rawSec)return;
  this.down.delete(identity);
  const expectedReleaseSec=Math.min(this.endSec,held.target.startSec+held.target.durSec),expectedDurationSec=expectedReleaseSec-held.target.startSec;
  const holdErrorSec=rawSec-held.rawSec-expectedDurationSec,releaseErrorSec=rawSec-held.offsetMs/1000-expectedReleaseSec,tolerance=this.toleranceMs/1000;
  const hold:ArticulationEvent["hold"]=holdErrorSec < -tolerance?"short":holdErrorSec > tolerance?"long":"matched";
  const release:ArticulationEvent["release"]=releaseErrorSec < -tolerance?"early":releaseErrorSec > tolerance?"late":"on-time";
  this.counts.observed++;this.counts[hold==="short"?"shortHolds":hold==="long"?"longHolds":"matchedHolds"]++;
  this.counts[release==="early"?"earlyReleases":release==="late"?"lateReleases":"onTimeReleases"]++;
  // ponytail: retain twelve raw pairs per attempt; aggregate counts cover the full bounded target set.
  if(this.events.length<12)this.events.push({targetIndex:held.index,pitch:held.target.midi,expectedDurationSec,expectedReleaseSec,rawPressSec:held.rawSec,rawReleaseSec:rawSec,offsetMs:held.offsetMs,holdErrorSec,releaseErrorSec,hold,release});
 }
 result():ArticulationResult {return {mode:"key-hold",total:this.total,...this.counts,unobserved:Math.max(0,this.total-this.counts.observed),toleranceMs:this.toleranceMs,events:this.events.slice(),omitted:Math.max(0,this.counts.observed-this.events.length)};}
}
