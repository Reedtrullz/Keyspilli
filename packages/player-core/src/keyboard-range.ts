import type {LoopRegion,TimedNote} from "./timeline.js";
export interface KeyboardRange {lowMidi:number;highMidi:number}
export const KEYBOARD_RANGES:Record<61|76|88,KeyboardRange>={61:{lowMidi:36,highMidi:96},76:{lowMidi:28,highMidi:103},88:{lowMidi:21,highMidi:108}};
export function validKeyboardRange(value:unknown):value is KeyboardRange|null {
 if(value===null)return true;
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 return Object.keys(row).length===2 && Number.isInteger(row.lowMidi)&&Number.isInteger(row.highMidi)&&Number(row.lowMidi)>=0&&Number(row.highMidi)<=127&&Number(row.lowMidi)<=Number(row.highMidi);
}
/** The onset-target contract shared with transport grading; ornaments are decoration. */
export function gradeableNotes(notes:readonly TimedNote[],range:LoopRegion|null|undefined,minDurSec:number):TimedNote[] {
 return notes.filter(note=>note.durSec>=minDurSec&&(!range||note.startSec>=range.startSec&&note.startSec<range.endSec));
}
export function keyboardReachability(notes:readonly TimedNote[],range:LoopRegion,minDurSec:number,view:KeyboardRange,physical:KeyboardRange|null) {
 const targets=gradeableNotes(notes,range,minDurSec),outside=targets.filter(note=>note.midi<view.lowMidi||note.midi>view.highMidi);
 return {total:targets.length,visible:targets.length-outside.length,overflow:outside.length,overflowPitches:[...new Set(outside.map(note=>note.midi))].sort((a,b)=>a-b),physicalUnavailable:physical?targets.filter(note=>note.midi<physical.lowMidi||note.midi>physical.highMidi).length:0};
}
