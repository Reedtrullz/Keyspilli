import type {Note,SourcePedalTimeline} from './types.js';
export const SOURCE_PEDAL='keyspilli-source-pedal-v1';
export function validSourcePedal(value:unknown):value is SourcePedalTimeline {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as SourcePedalTimeline;
 if(Object.keys(v).some(k=>!['version','endBeat','provenance','changes'].includes(k))||v.version!==1||!Number.isFinite(v.endBeat)||v.endBeat<=0||v.endBeat>4096||!['midi-file','declared-export'].includes(v.provenance)||!Array.isArray(v.changes)||!v.changes.length||v.changes.length>4096)return false;
 const previous=new Map<number,{beat:number;value:number;source:string}>();
 for(const event of v.changes){if(!event||typeof event!=='object'||Object.keys(event).some(k=>!['beat','channel','value','source'].includes(k))||!Number.isFinite(event.beat)||event.beat<0||event.beat>v.endBeat||!Number.isInteger(event.channel)||event.channel<0||event.channel>15||!Number.isInteger(event.value)||event.value<0||event.value>127||typeof event.source!=='string'||!/^midi:\d{1,3}$/.test(event.source))return false;
  const prior=previous.get(event.channel);if(prior&&(event.beat<prior.beat||event.beat===prior.beat&&event.source!==prior.source&&event.value!==prior.value))return false;previous.set(event.channel,event);
 }
 return true;
}
/** The only supported source controller is channel-scoped binary CC64 resonance. */
export function sourcePedalErrors(notes:readonly Note[],pedal:SourcePedalTimeline):string[]{
 if(!validSourcePedal(pedal))return ['Invalid or ambiguous source CC64 timeline.'];
 if(notes.length>20000||notes.length*pedal.changes.length>40000000||notes.some(n=>!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.dur)||n.dur<=0||n.start+n.dur>pedal.endBeat+1e-9||!Number.isInteger(n.sourceMidiChannel)||n.sourceMidiChannel!<0||n.sourceMidiChannel!>15||n.sourceMidiChannel===9))return ['Source CC64 requires an explicit piano MIDI channel on every note.'];
 if(pedal.changes.some(e=>e.channel===9))return ['Percussion-channel CC64 is not supported for piano playback.'];
 // Equal-tick cross-track ordering and quantized releases can erase which event came first.
 const lanes=new Map<string,number>();
 for(const note of [...notes].sort((a,b)=>a.start-b.start)){const lane=`${note.sourceMidiChannel}:${note.midi}`;if((lanes.get(lane)??-1)>note.start+1e-9)return ['Overlapping same-pitch keys on one source channel are outside this supported subset.'];lanes.set(lane,note.start+note.dur);}
 const ends=new Set(notes.map(n=>`${n.sourceMidiChannel}:${Math.round((n.start+n.dur)*960)}`));
 if(pedal.changes.some(e=>e.value>=64&&ends.has(`${e.channel}:${Math.round(e.beat*960)}`)))return ['A pedal-down coincides with a key release; controller ordering is outside this supported subset.'];
 const edges=notes.flatMap(n=>[{at:n.start,change:1},{at:sourcePedalEnd(n,pedal),change:-1}]).sort((a,b)=>a.at-b.at||a.change-b.change);let voices=0;
 for(const edge of edges){voices+=edge.change;if(voices>64)return ["Source pedal exceeds 64 sounding voices."];}
 return [];
}
/** Derive resonance without changing key duration; missing pedal-up stops at the declared file end. */
export function sourcePedalEnd(note:Note,pedal:SourcePedalTimeline):number {
 const keyEnd=note.start+note.dur;let down=false;
 for(const event of pedal.changes){if(event.channel!==note.sourceMidiChannel)continue;if(event.beat<=keyEnd+1e-9)down=event.value>=64;else if(down&&event.value<64)return Math.max(keyEnd,event.beat);}
 return down?Math.max(keyEnd,pedal.endBeat):keyEnd;
}
export function writeSourcePedal(notes:readonly Note[],pedal:SourcePedalTimeline|undefined):string|undefined {
 if(!pedal)return;const errors=sourcePedalErrors(notes,pedal);if(errors.length)throw new Error(errors.join(' '));
 const text=JSON.stringify({pedal:{...pedal,provenance:'declared-export'},channels:notes.map(n=>[n.midi,Math.round(n.start*960),Math.round((n.start+n.dur)*960),n.hand??"R",n.sourceMidiChannel])});
 if(new TextEncoder().encode(text).length>1024*1024)throw new Error('Source pedal metadata exceeds 1 MiB.');return text;
}
export function readSourcePedal(text:string,notes:Note[]):SourcePedalTimeline {
 if(new TextEncoder().encode(text).length>1024*1024)throw new Error('Source pedal metadata exceeds 1 MiB.');const value=JSON.parse(text);
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['pedal','channels'].includes(k))||!validSourcePedal(value.pedal)||value.pedal.provenance!=='declared-export'||!Array.isArray(value.channels)||value.channels.length!==notes.length||value.channels.length>20000)throw new Error('Invalid source pedal metadata.');
 const channels=new Map<string,number[]>();
 for(const row of value.channels){if(!Array.isArray(row)||row.length!==5||!Number.isInteger(row[0])||row[0]<0||row[0]>127||!Number.isInteger(row[1])||row[1]<0||!Number.isInteger(row[2])||row[2]<=row[1]||row[2]>4096*960||(row[3]!==null&&row[3]!=='L'&&row[3]!=='R')||!Number.isInteger(row[4])||row[4]<0||row[4]>15)throw new Error('Invalid source pedal note channel.');const key=JSON.stringify(row.slice(0,4)),list=channels.get(key)??[];list.push(row[4]);channels.set(key,list);}
 for(const note of notes){const key=JSON.stringify([note.midi,Math.round(note.start*960),Math.round((note.start+note.dur)*960),note.hand??"R"]),list=channels.get(key);if(!list?.length)throw new Error('Source pedal note map differs from notation.');note.sourceMidiChannel=list.shift()!;}
 const errors=sourcePedalErrors(notes,value.pedal);if(errors.length)throw new Error(errors.join(' '));return value.pedal;
}
