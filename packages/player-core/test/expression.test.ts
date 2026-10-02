import {it,expect} from "vitest";
import {resolveTimedNotes,playbackTiming} from "../src/timeline.js";
import type {SongData} from "../src/types.js";

it("preserves sources by default and bounds explicit accents to proven meter and pickup phase",()=>{
 const fixture=(meter:[number,number],starts:number[],measures:SongData["measures"],phase=0):SongData=>({notes:starts.map(start=>({midi:60,start,dur:.25,vel:80})),chords:[],key:"C",tempoBpm:120,timeSig:meter,measures,sourceTiming:{timeSig:meter,measureStartBeat:phase,provenance:"source-measure-boundary",sourceFingerprint:"authored-fixture"}});
 const triple=fixture([3,4],[0,1,2,3,4],[{index:0,startBeat:0,endBeat:3},{index:1,startBeat:3,endBeat:6}]);
 const velocities=(song:SongData)=>resolveTimedNotes(song,1,0,"meter-accents").map(note=>note.vel);
 expect(resolveTimedNotes(triple,1,0).map(n=>n.vel)).toEqual([80,80,80,80,80]);
 expect(velocities(triple)).toEqual([92,76,76,92,76]);
 expect(velocities(triple)).toEqual(velocities(triple));
 const compound=fixture([6,8],[0,.5,1.5,3],[{index:0,startBeat:0,endBeat:3},{index:1,startBeat:3,endBeat:6}]);
 expect(velocities(compound)).toEqual([92,64,84,92]);
 const pickup=fixture([4,4],[0,1,2,5],[{index:0,startBeat:0,endBeat:1},{index:1,startBeat:1,endBeat:5},{index:2,startBeat:5,endBeat:9}],-3);
 expect(playbackTiming(pickup)).toBeDefined();
 expect(velocities(pickup)).toEqual([76,92,76,92]);
 const changed={...triple,timeSig:[6,8] as [number,number],notes:[0,3,3.5,4.5].map(start=>({midi:60,start,dur:.25,vel:80})),timeSigEvents:[{tick:0,beat:0,timeSig:[3,4] as [number,number]},{tick:1440,beat:3,timeSig:[6,8] as [number,number]}],sourceTiming:{...triple.sourceTiming!,timeSig:[6,8] as const,timeSigEvents:[{beat:0,timeSig:[3,4] as const},{beat:3,timeSig:[6,8] as const}]}};
 expect(velocities(changed)).toEqual([92,92,64,84]);
 expect(velocities({...triple,sourceTiming:undefined})).toEqual([80,80,80,80,80]);
 const dynamic={...triple,notes:triple.notes.map((note,i)=>({...note,vel:i%2?100:40}))};
 expect(velocities(dynamic)).toEqual(dynamic.notes.map(n=>n.vel));
 expect(triple.notes.map(n=>n.vel)).toEqual([80,80,80,80,80]);
});
