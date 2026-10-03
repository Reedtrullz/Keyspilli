import {it,expect} from "vitest";
import {ArticulationGrader,validArticulationResult} from "../src/articulation.js";
it("distinguishes taps, holds and repeated-pitch releases without treating pedal or safety cleanup as key evidence",()=>{
 const grader=new ArticulationGrader(5,10,150),note={midi:60,startSec:0,durSec:1,vel:80};
 grader.press("key",note,0,0,0);grader.release("key",.02);
 grader.press("key",{...note,startSec:2},1,2.1,100);grader.release("key",3.1);
 grader.press("key",{...note,startSec:4},2,4,0);grader.release("key",5.4);
 grader.press("key",{...note,startSec:6},3,6,0);
 // A sustained sounding voice or forced cleanup provides no timestamped key release.
 grader.press("key",{...note,startSec:8},4,8,0);
 const result=grader.result();
 expect(validArticulationResult(result)).toBe(true);expect(validArticulationResult({...result,privateDevice:"secret"})).toBe(false);
 expect(validArticulationResult({...result,events:result.events.map((event,index)=>index?event:{...event,holdErrorSec:.9})})).toBe(false);
 expect(validArticulationResult({...result,events:result.events.map((event,index)=>index?event:{...event,hold:"matched"})})).toBe(false);
 expect(validArticulationResult({...result,shortHolds:0,matchedHolds:2})).toBe(false);
 expect(result).toMatchObject({observed:3,shortHolds:1,matchedHolds:1,longHolds:1,earlyReleases:1,onTimeReleases:1,lateReleases:1,unobserved:2});
 expect(result.events[1]).toMatchObject({rawPressSec:2.1,rawReleaseSec:3.1,offsetMs:100});
 expect(result.events[1]!.holdErrorSec).toBeCloseTo(0);expect(result.events[1]!.releaseErrorSec).toBeCloseTo(0);
 expect(()=>new ArticulationGrader(1,1,1)).toThrow();
});
