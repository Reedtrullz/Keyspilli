import {it,expect} from "vitest";
import {parseMidi,parseMusicXmlNotes} from "@keyspilli/midi";
import {normalizeChordTimeline} from "@keyspilli/catalog";
import type {SongData} from "@keyspilli/player-core";
import {buildHarmonyCandidate} from "./harmony-candidate";
it("keeps Original unchanged, binds an unreviewed timeline and exports exact candidate chords, rest and unknown spans",()=>{
 const data:SongData={notes:[{midi:60,start:0,dur:4,vel:70}],chords:[],measures:[{index:0,startBeat:0,endBeat:4}],tempoBpm:120,timeSig:[4,4],key:"C",sourceFingerprint:"source-v1"},before=JSON.stringify(data),identity={id:"fixture-a",baseId:"fixture",title:"Fixture",artist:"Owner",revision:"version1"};
 const events=[{kind:"chord",beat:0,durationBeats:1,name:"C/E",notes:[52,60,64,67]},{kind:"rest",beat:1,durationBeats:1},{kind:"unknown",beat:2,durationBeats:1},{kind:"chord",beat:3,durationBeats:1,name:"unsupported-symbol"}];
 const candidate=buildHarmonyCandidate(data,identity,events);expect(JSON.stringify(data)).toBe(before);expect(candidate.admission).toBe("unavailable");expect(candidate.timeline.chords.map(c=>c.name)).toEqual(["C/E","N.C.","?","unsupported-symbol"]);expect(candidate.timeline.chords.every(c=>c.sourceKind==="unknown")).toBe(true);
 expect(normalizeChordTimeline(candidate.timeline)).toEqual(candidate.timeline);expect(candidate.timeline.provenance.sourceRef).toContain('fixture-a:version1:');
 const shape=(notes:typeof data.notes)=>notes.map(n=>[n.midi,n.start,n.dur]).sort((a,b)=>a[0]!-b[0]!);
 expect(shape(parseMidi(Buffer.from(candidate.midi,"base64")).notes)).toEqual(shape(candidate.notes));expect(shape(parseMusicXmlNotes(candidate.xml).notes)).toEqual(shape(candidate.notes));expect(candidate.xml).toContain('N.C.');
 expect(()=>buildHarmonyCandidate(data,identity,[{kind:"rest",beat:0,durationBeats:1,notes:[60]}])).toThrow(/Rest/);
 expect(()=>buildHarmonyCandidate(data,identity,[{kind:"chord",beat:0,durationBeats:1,name:"C/E",notes:[48,60,64,67]}])).toThrow(/slash bass/);
 expect(()=>buildHarmonyCandidate(data,identity,[{kind:"chord",beat:0,durationBeats:3,name:"C"},{kind:"rest",beat:2,durationBeats:1}])).toThrow(/overlap/);
});
