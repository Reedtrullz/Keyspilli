import {expect,it} from 'vitest';
import {rhythmPlan} from './rhythm.js';
import {Grader} from './grading.js';
import type {SongData} from './types.js';
it('keeps rhythm taps separate from pitch, rests, pickup and changing compound meter',()=>{
 const data:SongData={key:'C',tempoBpm:120,timeSig:[3,4],chords:[],notes:[{midi:60,start:0,dur:1,vel:80},{midi:64,start:0,dur:1,vel:80},{midi:60,start:2,dur:1,vel:80},{midi:65,start:4,dur:1,vel:80}],measures:[{index:0,startBeat:0,endBeat:1},{index:1,startBeat:1,endBeat:4},{index:2,startBeat:4,endBeat:7}],sourceTiming:{timeSig:[3,4],measureStartBeat:-2,provenance:'source-measure-boundary',sourceFingerprint:'rhythm-fixture'}};
 const before=JSON.stringify(data),plan=rhythmPlan(data,0,7,1);
 expect(plan.targets.map(n=>n.startSec)).toEqual([0,1,2]);expect(plan.cues.map(c=>[c.beat,c.accent])).toEqual([[0,false],[1,true],[2,false],[3,false],[4,true],[5,false],[6,false]]);
 const change={...data,measures:[{index:0,startBeat:0,endBeat:3},{index:1,startBeat:3,endBeat:6}],timeSigEvents:[{tick:0,beat:0,timeSig:[3,4] as [number,number]},{tick:1440,beat:3,timeSig:[6,8] as [number,number]}]};
 const changed={...change,sourceTiming:{...data.sourceTiming!,measureStartBeat:0,timeSigEvents:change.timeSigEvents}};
 expect(rhythmPlan(changed,0,6,1).cues.map(c=>[c.beat,c.accent])).toEqual([[0,true],[1,false],[2,false],[3,true],[4.5,false]]);
 const fast=rhythmPlan(data,2,7,2);expect(fast.targets.map(n=>n.startSec)).toEqual([.5,1]);expect(fast.startSec).toBe(.5);expect(fast.endSec).toBe(1.75);
 const grader=new Grader(plan.targets,{bpm:120});for(const t of plan.targets)grader.play(60,t.startSec,{rawSec:t.startSec+.025,offsetMs:25});expect(grader.result().hit).toBe(3);expect(grader.result().diagnostics!.events[0]).toMatchObject({rawSec:.025,offsetMs:25});
 expect(JSON.stringify(data)).toBe(before);expect(()=>rhythmPlan({...data,sourceTiming:undefined},0,7,1)).toThrow(/unverified/);expect(rhythmPlan({...data,sourceTiming:undefined},0,7,1,'eighth').cueAuthority).toBe('owner-choice');expect(()=>rhythmPlan(data,0,65,1)).toThrow(/64/);
});
