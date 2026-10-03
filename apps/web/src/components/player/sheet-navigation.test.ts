import {it,expect} from "vitest";
import {writeMusicXml,type Variant} from "@keyspilli/midi";
import {prepareScoreNavigation} from "./sheet-navigation";
it("binds pickups, repeated pitches and meter changes to actual notation IDs and rejects stale/different playback",()=>{
 const variant:Variant={level:"advanced",difficultyScore:0,chords:[],bassPattern:"block",key:"C",tempoBpm:120,timeSig:[4,4],timeSigEvents:[{beat:0,tick:0,timeSig:[4,4]},{beat:1,tick:960,timeSig:[6,8]},{beat:4,tick:3840,timeSig:[3,4]}],measures:[{index:0,startBeat:0,endBeat:1},{index:1,startBeat:1,endBeat:4},{index:2,startBeat:4,endBeat:7}],notes:[{midi:60,start:0,dur:1,vel:80},{midi:60,start:1,dur:.5,vel:80},{midi:60,start:4,dur:1,vel:80}]};
 const xml=writeMusicXml(variant,"Authored","Test"),source={...variant,sourceFingerprint:"exact-source"};
 const prepared=prepareScoreNavigation(xml,source,"revision-a","revision-a");
 expect(prepared.measures).toEqual(variant.measures.map((m,i)=>({...m,elementId:`keyspilli-score-${i}`})));
 expect(prepared.xml).toContain('id="keyspilli-score-2"');expect(xml).not.toContain('keyspilli-score');
 expect(()=>prepareScoreNavigation(xml,source,"revision-a","revision-b")).toThrow(/publication/);
 expect(()=>prepareScoreNavigation(xml,{...source,notes:source.notes.map(n=>({...n,start:n.start+1}))},"revision-a","revision-a")).toThrow(/differ/);
 expect(()=>prepareScoreNavigation(xml,{...source,measures:source.measures.map(m=>({...m,endBeat:m.endBeat+1}))},"revision-a","revision-a")).toThrow(/differ/);
 expect(()=>prepareScoreNavigation(xml,{...source,notes:[{...source.notes[0]!,start:Number.NaN}]} ,"revision-a","revision-a")).toThrow(/subset/);
 expect(()=>prepareScoreNavigation(xml,{...source,measures:source.measures.map(m=>({...m,endBeat:Number.NaN}))},"revision-a","revision-a")).toThrow(/subset/);
 expect(()=>prepareScoreNavigation(xml.replace('</measure>','<barline><repeat direction="backward"/></barline></measure>'),source,"revision-a","revision-a")).toThrow(/repeat/);
});
