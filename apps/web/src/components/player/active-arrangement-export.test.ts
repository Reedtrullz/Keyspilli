import {it,expect} from "vitest";
import {keySignature,parseMidi,parseMusicXmlNotes,validateArtifactFiles,writeMidi,writeMusicXml,type Variant} from "@keyspilli/midi";
import {DEFAULT_SETTINGS,PlaybackEngine,type AudioLike,type SongData} from "@keyspilli/player-core";
import {activeExportDigest,activeExportVariant,resolveActiveExport,validActiveExportSelection,type ActiveExportSelection} from "./active-arrangement-export";
const data:SongData={notes:[{midi:60,start:0,dur:2,vel:80,hand:"R"},{midi:48,start:2,dur:1,vel:90,hand:"L"}],chords:[{beat:0,name:"C/E",notes:[40,48,52,55],durationBeats:2,sourceKind:"authored"},{beat:2,name:"N.C.",notes:[],durationBeats:2,sourceKind:"authored"}],key:"C",tempoBpm:120,timeSig:[4,4],measures:[{index:0,startBeat:0,endBeat:4}],sourceFingerprint:"fixture-source"};
const selection:ActiveExportSelection={backgroundMode:"piano",accompanimentStyle:"bass-chords",hand:"R",audibleSupport:false,speed:.5,transpose:2,renderedExpression:"source",chordSource:"auto",melodySelection:"automatic",sourceBackingMode:"default",phraseOverrides:[]};
function artifacts(v:Variant){const sig=keySignature(v.key);return {midi:writeMidi(v.notes,{tempoBpm:v.tempoBpm,timeSig:v.timeSig,keySig:sig.fifths,keyMode:sig.mode,chordMarkers:v.chords}),xml:writeMusicXml(v,"Private synthetic export","Author",{chordWords:true})};}
it("active symbolic exports preserve selected pitches, endpoints, source choices, key and chord text without changing Original",async()=>{
 const before=JSON.stringify(data),stored=writeMusicXml({...data,level:"advanced",difficultyScore:0,bassPattern:"block"},"Original","Author");
 const v=activeExportVariant(data,resolveActiveExport(data,selection),selection),a=artifacts(v);
 expect(v.notes).toMatchObject([{midi:62,start:0,dur:2,vel:80,hand:"R"}]);expect(v.key).toBe("D");expect(v.tempoBpm).toBe(60);
 expect(validateArtifactFiles(v,a)).toEqual([]);expect(parseMidi(a.midi).notes[0]).toMatchObject({midi:62,start:0,dur:2});expect(parseMusicXmlNotes(a.xml).notes[0]).toMatchObject({midi:62,start:0,dur:2});
 expect(a.xml).toContain("<words>D/F#</words>");expect(a.xml).toContain("<words>N.C.</words>");expect(Buffer.from(a.midi).includes(Buffer.from("D/F#"))).toBe(true);
 expect(JSON.stringify(data)).toBe(before);expect(writeMusicXml({...data,level:"advanced",difficultyScore:0,bassPattern:"block"},"Original","Author")).toBe(stored);
 expect(await activeExportDigest(v)).not.toBe(await activeExportDigest({...v,notes:[{...v.notes[0]!,midi:63}]}));
 const supported={...selection,audibleSupport:true},both=activeExportVariant(data,resolveActiveExport(data,supported),supported);expect(both.notes).toHaveLength(2);
});
it("backing-only symbolic notes match the engine chord schedule and unavailable notation is refused",()=>{
 const selected={...selection,backgroundMode:"chord" as const,hand:"both" as const,speed:1,transpose:0},resolution=resolveActiveExport(data,selected),variant=activeExportVariant(data,resolution,selected);
 const scheduled:number[][]=[];
 const audio:AudioLike={ensure(){},noteOn(){},noteOff(){},cancelAll(){},dispose(){},setGains(){},metronomeClick(){},sustainPedal:false,playChord(notes){scheduled.push(notes);}};
 const engine=new PlaybackEngine(audio,[],2,{tempoBpm:120,timeSig:[4,4]},{...DEFAULT_SETTINGS,backgroundMode:"chord",accompanimentStyle:"bass-chords"},resolution.chords);engine.start();engine.tick(.01);
 expect(variant.notes.filter(n=>n.start===0).map(n=>n.midi)).toEqual(scheduled.flat().sort((a,b)=>a-b));expect(validateArtifactFiles(variant,artifacts(variant))).toEqual([]);
 expect(()=>activeExportVariant(data,{...resolution,chords:[{...resolution.chords[0]!,durationBeats:undefined}]},selected)).toThrow("Legacy chord duration");
 expect(()=>activeExportVariant(data,resolveActiveExport(data,{...selection,transpose:100}),{...selection,transpose:100})).toThrow("MIDI range");
 expect(validActiveExportSelection(selection)).toBe(true);expect(validActiveExportSelection({...selection,notes:data.notes})).toBe(false);expect(validActiveExportSelection({...selection,speed:NaN})).toBe(false);
});
