import {expect,it} from "vitest";
import {measureNoteIntervals,intervalSilences} from "../src/intervals.js";
it("keeps carry distinct from attacks and derives silence from all overlapping intervals",()=>{
 const notes=[{midi:60,start:0,dur:6,vel:80,hand:"R" as const},{midi:64,start:4,dur:1,vel:80,hand:"R" as const},{midi:48,start:4.5,dur:.5,vel:80,hand:"L" as const},{midi:67,start:6,dur:1,vel:80,hand:"R" as const}];
 const intervals=measureNoteIntervals(notes,4,8);
 expect(intervals.map(item=>[item.note.midi,item.startBeat,item.endBeat,item.carry,item.continues])).toEqual([[60,4,6,true,false],[64,4,5,false,false],[48,4.5,5,false,false],[67,6,7,false,false]]);
 expect(intervalSilences(intervals,4,8,"R")).toEqual([{startBeat:7,endBeat:8}]);expect(intervalSilences(intervals,4,8,"L")).toEqual([{startBeat:4,endBeat:4.5},{startBeat:5,endBeat:8}]);
 expect(measureNoteIntervals(notes,0,1)[0]).toMatchObject({startBeat:0,endBeat:1,carry:false,continues:true});
 expect(measureNoteIntervals(notes,7,10)).toEqual([]);expect(intervalSilences([],7,10,"R")).toEqual([{startBeat:7,endBeat:10}]);
});
