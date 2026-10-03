import {expect,it} from "vitest";
import {keyboardReachability,KEYBOARD_RANGES,validKeyboardRange} from "../src/keyboard-range.js";
it("reconciles displayed and unreachable graded targets across ranges, transpose, hand filtering and seek",()=>{
 const notes=[12,35,36,60,96,97,120].map((midi,i)=>({midi,startSec:i,durSec:.5,vel:80,hand:i%2?"L" as const:"R" as const}));
 const view={lowMidi:21,highMidi:108};
 for(const physical of Object.values(KEYBOARD_RANGES)) {
  const result=keyboardReachability(notes,{startSec:0,endSec:7},.125,view,physical);
  expect(result.visible+result.overflow).toBe(result.total);expect(result.total).toBe(7);
  expect(result.physicalUnavailable).toBe(notes.filter(n=>n.midi<physical.lowMidi||n.midi>physical.highMidi).length);
 }
 expect(keyboardReachability(notes,{startSec:0,endSec:7},.125,view,KEYBOARD_RANGES[61])).toMatchObject({total:7,visible:5,overflow:2,physicalUnavailable:4,overflowPitches:[12,120]});
 const shifted=notes.filter(n=>n.hand==="R").map(n=>({...n,midi:n.midi+12}));
 expect(keyboardReachability(shifted,{startSec:3,endSec:7},.125,view,null)).toMatchObject({total:2,visible:1,overflow:1,physicalUnavailable:0,overflowPitches:[132]});
 expect(keyboardReachability([{...notes[0]!,durSec:.01}],{startSec:0,endSec:1},.125,view,null).total).toBe(0);
});

it("validates only bounded owner-confirmed physical ranges",()=>{
 expect(validKeyboardRange(null)).toBe(true);expect(validKeyboardRange(KEYBOARD_RANGES[61])).toBe(true);
 for(const value of [{lowMidi:96,highMidi:36},{lowMidi:0,highMidi:128},{lowMidi:21.5,highMidi:108},{lowMidi:21,highMidi:108,device:"guess"}])expect(validKeyboardRange(value)).toBe(false);
});
