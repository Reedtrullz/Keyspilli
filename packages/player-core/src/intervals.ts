import type {Note} from "@keyspilli/midi";
export interface NoteInterval {note:Note;startBeat:number;endBeat:number;carry:boolean;continues:boolean}
/** Interval cues assert sounding spans, not written ties or fingering. */
export function measureNoteIntervals(notes:readonly Note[],startBeat:number,endBeat:number):NoteInterval[] {
 return notes.filter(note=>note.dur>0&&note.start<endBeat&&note.start+note.dur>startBeat).map(note=>({note,startBeat:Math.max(startBeat,note.start),endBeat:Math.min(endBeat,note.start+note.dur),carry:note.start<startBeat,continues:note.start+note.dur>endBeat}));
}
/** Silence of the assigned part is derived from the union of its intervals. */
export function intervalSilences(intervals:readonly NoteInterval[],startBeat:number,endBeat:number,hand:"L"|"R"|undefined|"all"):{startBeat:number;endBeat:number}[] {
 const ordered=intervals.filter(item=>hand==="all"||item.note.hand===hand).slice().sort((a,b)=>a.startBeat-b.startBeat),gaps:{startBeat:number;endBeat:number}[]=[];
 let cursor=startBeat;
 for(const item of ordered){if(item.startBeat>cursor)gaps.push({startBeat:cursor,endBeat:item.startBeat});cursor=Math.max(cursor,item.endBeat);}
 if(cursor<endBeat)gaps.push({startBeat:cursor,endBeat});return gaps;
}
export function intervalCue(interval:NoteInterval,measureStart:number, beatUnit=1):string {
 return `${interval.carry?"Carry, not a new attack":"Start"} · hold to beat ${Number(((interval.endBeat-measureStart)*beatUnit+1).toFixed(3))}${interval.continues?" · continues into next bar":" · interval ends"}`;
}
