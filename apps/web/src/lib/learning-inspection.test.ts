import {it,expect} from "vitest";
import {inspectLearningLevels} from "./learning-inspection";
import type {SongData} from "@keyspilli/player-core";
it("measures actual spans, attacks and rhythms and locates changed bars without assigning suitability",()=>{
 const data:SongData={notes:[{midi:60,start:0,dur:1,vel:80,hand:"R"},{midi:67,start:0,dur:1,vel:80,hand:"R"},{midi:62,start:1,dur:.5,vel:80,hand:"R"}],chords:[],measures:[{index:0,startBeat:0,endBeat:4}],key:"C",tempoBpm:120,timeSig:[4,4]};
 const result=inspectLearningLevels([{difficulty:"beginner",data},{difficulty:"easy",data:{...data,notes:[...data.notes,{midi:48,start:2.5,dur:.25,vel:80,hand:"L"}]}},{difficulty:"medium",data:null}]);
 expect(result[0]).toMatchObject({noteCount:3,hands:{R:{maxChordSpan:7,onsets:2}},rhythm:{distinctDurations:2,distinctOnsetFractions:1},comparison:null});
 expect(result[1]).toMatchObject({hands:{L:{onsets:1}},rhythm:{distinctDurations:3,distinctOnsetFractions:2},comparison:{changedBarCount:1,changedBars:[1],truncated:false}});
 expect(result[2]).toEqual({difficulty:"medium",available:false});
});
