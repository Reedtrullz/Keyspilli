import {transposeChordSymbol,type Variant,type Note} from "@keyspilli/midi";
import {buildMelodyAccompaniment,filterAccompanimentChords,playbackTiming,resolveTimedNotes,selectHandNotes,validateSparseBackingTiming,type AccompanimentResolution,type MelodyPhraseOverride,type PlayerSettings,type SongData} from "@keyspilli/player-core";
import {bassChordsBackground,playerArrangementEnd,playerChordSources} from "./chords-backing";
import {selectChordSource,melodyHarmonicSupportPolicy,type ChordSourceId} from "./chord-sources";
import {reviewedSourceBacking} from "./reviewed-source-backing";
import {buildMelodyArrangementOptions} from "./melody-arrangement-runtime";
export class ActiveExportUnsupportedError extends Error {}
export interface ActiveExportSelection {
 backgroundMode:PlayerSettings["backgroundMode"];accompanimentStyle:PlayerSettings["accompanimentStyle"];hand:PlayerSettings["hand"];
 audibleSupport:boolean;speed:number;transpose:number;renderedExpression:"source"|"meter-accents";chordSource:ChordSourceId;
 melodySelection:"automatic"|"right-hand";sourceBackingMode:"default"|"conservative";phraseOverrides:MelodyPhraseOverride[];
}
const fields="backgroundMode accompanimentStyle hand audibleSupport speed transpose renderedExpression chordSource melodySelection sourceBackingMode phraseOverrides".split(" ");
export function validActiveExportSelection(value:unknown):value is ActiveExportSelection {
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const v=value as ActiveExportSelection;
 return Object.keys(v).length===fields.length&&Object.keys(v).every(key=>fields.includes(key))
  &&["piano","chord"].includes(v.backgroundMode)&&["bass-chords","melody-accompaniment"].includes(v.accompanimentStyle)
  &&["L","R","both"].includes(v.hand)&&typeof v.audibleSupport==="boolean"&&Number.isFinite(v.speed)&&v.speed>=.25&&v.speed<=4
  &&Number.isInteger(v.transpose)&&Math.abs(v.transpose)<=24&&["source","meter-accents"].includes(v.renderedExpression)
  &&["auto","ug","generated"].includes(v.chordSource)&&["automatic","right-hand"].includes(v.melodySelection)&&["default","conservative"].includes(v.sourceBackingMode)
  &&Array.isArray(v.phraseOverrides)&&v.phraseOverrides.length<=32&&v.phraseOverrides.every(p=>p&&typeof p==="object"&&!Array.isArray(p)
   &&Object.keys(p).every(key=>["startBeat","endBeat","sourceNoteIds","sourceFingerprint"].includes(key))
   &&Number.isFinite(p.startBeat)&&p.startBeat>=0&&Number.isFinite(p.endBeat)&&p.endBeat>p.startBeat&&p.endBeat<=100000
   &&(p.sourceFingerprint===null||p.sourceFingerprint===undefined||typeof p.sourceFingerprint==="string"&&p.sourceFingerprint.length<=4096)
   &&Array.isArray(p.sourceNoteIds)&&p.sourceNoteIds.length<=512&&p.sourceNoteIds.every(id=>typeof id==="string"&&id.length<=256));
}
/** Uses the same producers as Player; request data selects canonical source events, never supplies notes. */
export function resolveActiveExport(data:SongData,selection:ActiveExportSelection):AccompanimentResolution {
 if(data.notes.length>20000||data.chords.length>10000)throw new ActiveExportUnsupportedError("Active export exceeds the bounded symbolic size; use Stored Original.");
 const end=playerArrangementEnd(data),selected=selectChordSource(playerChordSources(data,end),selection.chordSource),chords=selected.source?.chords??[];
 if(selection.backgroundMode==="piano")return {style:selection.accompanimentStyle,notes:data.notes,guidanceNotes:data.notes,chords:[],displayChords:chords,fallbackSpans:[]};
 const backing=reviewedSourceBacking(data);
 if(backing&&selection.accompanimentStyle!=="bass-chords")throw new ActiveExportUnsupportedError("Prepared source backing supports backing-only export.");
 if(selection.accompanimentStyle==="bass-chords")return bassChordsBackground(data,chords,end,backing);
 return buildMelodyAccompaniment(data.notes,chords,buildMelodyArrangementOptions({durationBeats:end,sourceFingerprint:data.sourceFingerprint??null,
  selection:selection.melodySelection,phraseOverrides:selection.phraseOverrides,harmonicSupport:melodyHarmonicSupportPolicy(selected.source),sourceBackingMode:selection.sourceBackingMode,
  sparseBackingTiming:playbackTiming({...data,sourceTiming:validateSparseBackingTiming(data.sourceTiming,data.sourceFingerprint??null)})}));
}
/** Materializes symbolic note endpoints, independent of timbre, pedal tails and mix volume. */
export function activeExportVariant(data:SongData,resolution:AccompanimentResolution,selection:ActiveExportSelection):Variant {
 const end=playerArrangementEnd(data),timed=resolveTimedNotes({...data,notes:resolution.notes},selection.speed,selection.transpose,selection.renderedExpression);
 const selected=selectHandNotes(resolution.notes.map((n,index)=>({...n,midi:timed[index]!.midi,vel:timed[index]!.vel})),selection.hand,selection.audibleSupport);
 const chords=selection.backgroundMode==="chord"&&selection.accompanimentStyle==="bass-chords"
  ? selection.audibleSupport?resolution.chords:filterAccompanimentChords(resolution.chords,selection.hand):[];
 const notes:Note[]=[...selected,...chords.flatMap(chord=>{
  if(chord.durationBeats===undefined)throw new ActiveExportUnsupportedError("Legacy chord duration is unavailable for symbolic export.");
  const duration=Math.min(chord.durationBeats,end-chord.beat);
  return duration>0?[...new Set(chord.notes)].sort((a,b)=>a-b).map(midi=>({midi:midi+selection.transpose,start:chord.beat,dur:duration,vel:100,hand:"L" as const})):[];
 })].sort((a,b)=>a.start-b.start||a.midi-b.midi||a.dur-b.dur);
 if(!notes.length||notes.length>100000||notes.some(n=>!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.dur)||n.dur<=0))throw new ActiveExportUnsupportedError("Active notes are empty or outside the supported MIDI range.");
 const key=selection.transpose?transposeChordSymbol(data.key.replace(/\s+major$/i,"").replace(/\s+minor$/i,"m"),selection.transpose):data.key;
 const labels=resolution.displayChords.map(chord=>({...chord,name:selection.transpose&&chord.name!=="N.C."?transposeChordSymbol(chord.name,selection.transpose):chord.name,notes:chord.notes.map(midi=>midi+selection.transpose)}));
 return {level:"advanced",difficultyScore:0,bassPattern:"active-selection",notes,chords:labels,key,tempoBpm:data.tempoBpm*selection.speed,timeSig:data.timeSig,timeSigEvents:data.timeSigEvents,measures:data.measures};
}
export async function activeExportDigest(variant:Variant):Promise<string> {
 const shape={notes:variant.notes.map(n=>[n.midi,n.start,n.dur,n.vel,n.hand??null]),chords:variant.chords.map(c=>[c.beat,c.name,c.notes,c.durationBeats??null]),key:variant.key,tempoBpm:variant.tempoBpm,timeSig:variant.timeSig,timeSigEvents:variant.timeSigEvents??[],measures:variant.measures};
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(shape))))).map(n=>n.toString(16).padStart(2,"0")).join("");
}
