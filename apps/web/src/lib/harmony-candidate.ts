import {createHash} from "node:crypto";
import {normalizeChordTimeline} from "@keyspilli/catalog";
import {chordToNotes,chordPitchClasses,tryParseChordSymbol,writeMidi,writeMusicXml,type Note,type Variant} from "@keyspilli/midi";
import type {SongData} from "@keyspilli/player-core";
export interface HarmonyDraftEvent {kind:"chord"|"rest"|"unknown";beat:number;durationBeats:number;name?:string;notes?:number[]}
export function buildHarmonyCandidate(data:SongData,identity:{id:string;baseId:string;title:string;artist:string;revision:string},raw:unknown){
 if(!data.sourceFingerprint||data.notes.length>20000||data.measures.length>2048||!Array.isArray(raw)||!raw.length||raw.length>256)throw new Error("Choose 1–256 bounded harmony events for an exact source.");
 const duration=Math.max(...data.measures.map(m=>m.endBeat),...data.notes.map(n=>n.start+n.dur)),warnings:string[]=[];
 const chords=raw.map((value,index)=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid harmony event.");const event=value as HarmonyDraftEvent;
  if(Object.keys(event).some(key=>!["kind","beat","durationBeats","name","notes"].includes(key))||!["chord","rest","unknown"].includes(event.kind)||!Number.isFinite(event.beat)||event.beat<0||!Number.isFinite(event.durationBeats)||event.durationBeats<=0||event.beat+event.durationBeats>duration+1e-6||!Number.isInteger(event.beat*4)||!Number.isInteger(event.durationBeats*4))throw new Error("Events need positive, in-range spans on the quarter-beat grid.");
  if(event.notes!==undefined&&(!Array.isArray(event.notes)||event.notes.length>10||new Set(event.notes).size!==event.notes.length||event.notes.some(n=>!Number.isInteger(n)||n<0||n>127)))throw new Error("Voicings need at most ten distinct MIDI pitches.");
  const name=event.kind==="rest"?"N.C.":event.kind==="unknown"?"?":event.name;
  if(typeof name!=="string"||!name.trim()||name.length>64)throw new Error("Choose a bounded chord symbol.");
  if(event.kind!=="chord"&&event.notes?.length)throw new Error("Rest and unknown events cannot contain a voicing.");
  let notes:number[]=[];
  if(event.kind==="chord"){
   const symbol=tryParseChordSymbol(name);
   if(!symbol)warnings.push(`Event ${index+1}: unsupported symbol is display-only.`);
   else if(event.notes?.length){notes=event.notes.slice().sort((a,b)=>a-b);const pcs=new Set(notes.map(n=>n%12));if(chordPitchClasses(symbol).some(pc=>!pcs.has(pc))||(symbol.bassPc!==undefined&&notes[0]!%12!==symbol.bassPc))throw new Error("Voicing must contain the supported chord tones and its slash bass.");}
   else{notes=chordToNotes(name,{octave:4,bassOctave:3,includeBass:true});warnings.push(`Event ${index+1}: preview voicing is derived and unreviewed.`);}
  }
  return {beat:event.beat,durationBeats:event.durationBeats,name,notes,sourceKind:"unknown" as const};
 });
 const ordered=chords.slice().sort((a,b)=>a.beat-b.beat);if(ordered.some((event,i)=>i>0&&event.beat<ordered[i-1]!.beat+ordered[i-1]!.durationBeats-1e-6))throw new Error("Harmony event spans cannot overlap.");
 const binding=createHash("sha256").update(data.sourceFingerprint).digest("hex");
 const timeline=normalizeChordTimeline({schemaVersion:1,baseId:identity.baseId,title:identity.title,artist:identity.artist||"Owner",key:data.key,tempoBpm:data.tempoBpm,timeSig:data.timeSig,durationBeats:duration,chords:ordered,provenance:{sourceId:"owner-preview",provider:"owner-candidate",kind:"chart",sourceRef:`owner-preview:${identity.id}:${identity.revision}:${binding}:unreviewed`,confidence:"low"}});
 const notes:Note[]=timeline.chords.flatMap(chord=>(chord.notes??[]).map(midi=>({midi,start:chord.beat,dur:chord.durationBeats,vel:80})));
 const variant:Variant={level:"advanced",difficultyScore:0,notes,chords:timeline.chords.map(chord=>({beat:chord.beat,durationBeats:chord.durationBeats,name:chord.name,notes:chord.notes??[],sourceKind:"unknown"})),measures:data.measures,key:data.key,tempoBpm:data.tempoBpm,timeSig:data.timeSig,timeSigEvents:data.timeSigEvents,bassPattern:"block"};
 const midi=writeMidi(notes,{tempoBpm:variant.tempoBpm,timeSig:variant.timeSig,timeSigEvents:variant.timeSigEvents,chordMarkers:timeline.chords.map(c=>({beat:c.beat,name:c.name})),title:`${identity.title} (unreviewed harmony draft)`}),xml=writeMusicXml(variant,`${identity.title} (unreviewed harmony draft)`,identity.artist,{chordWords:true});
 if(xml.length>4*1024*1024||midi.length>1024*1024)throw new Error("Candidate exports exceed the preview budget.");
 return {timeline,notes,warnings,sourceFingerprint:data.sourceFingerprint,publicationRevision:identity.revision,digest:createHash("sha256").update(JSON.stringify(timeline)).digest("hex"),midi:Buffer.from(midi).toString("base64"),xml,admission:"unavailable" as const};
}
