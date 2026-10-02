import {expect,it} from "vitest";
import {matchingSourcePitch,parseMusicXmlNotes,writeMusicXml,type Variant} from "../src/index.js";
it("round-trips authored enharmonic spelling while rejecting stale generated spelling",()=>{
 const variant:Variant={level:"advanced",difficultyScore:1,notes:[{midi:70,start:0,dur:1,vel:80,hand:"R",sourcePitch:{step:"B",alter:-1,octave:4}},{midi:60,start:1,dur:1,vel:80,hand:"R",sourcePitch:{step:"B",alter:1,octave:3}},{midi:59,start:2,dur:1,vel:80,hand:"R",sourcePitch:{step:"C",alter:-1,octave:4}}],chords:[],bassPattern:"block",key:"C",tempoBpm:120,timeSig:[4,4],measures:[{index:0,startBeat:0,endBeat:4}]};
 const parsed=parseMusicXmlNotes(writeMusicXml(variant,"Spelling","Authored Fixture"));
 expect(parsed.notes.map(note=>note.sourcePitch)).toEqual(variant.notes.map(note=>note.sourcePitch));expect(parsed.notes.map(note=>note.midi)).toEqual([70,60,59]);
 const stale={...variant.notes[0]!,midi:71};expect(matchingSourcePitch(stale)).toBeUndefined();
 const changed=parseMusicXmlNotes(writeMusicXml({...variant,notes:[stale]},"Changed","Fixture"));expect(changed.notes[0]?.sourcePitch).toEqual({step:"B",alter:0,octave:4});expect(changed.notes[0]?.midi).toBe(71);
});
