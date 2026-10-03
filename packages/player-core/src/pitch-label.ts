import {matchingSourcePitch,keySignature,transposeChordSymbol,type SourcePitch} from "@keyspilli/midi";
const NATURAL:Record<string,number>={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const SHARP=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],FLAT=["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
/** MIDI is authoritative; source spelling is descriptive only while it matches. */
export function learnerPitch(note:{midi:number;sourcePitch?:SourcePitch},transpose=0,key="C",includeOctave=true):{label:string;authority:"source"|"derived"} {
 const midi=note.midi+transpose,source=matchingSourcePitch(note);
 if(transpose===0&&source){
  const name=source.step+(source.alter>0?"#".repeat(source.alter):"b".repeat(-source.alter));return {label:name+(includeOctave||name==="C"?source.octave:""),authority:"source"};
 }
 let playbackKey=key;try{if(transpose)playbackKey=transposeChordSymbol(key,transpose);}catch{playbackKey="C";}
 const fifths=keySignature(playbackKey).fifths,pc=((midi%12)+12)%12,order=fifths<0?["B","E","A","D","G","C","F"]:["F","C","G","D","A","E","B"],altered=new Set(order.slice(0,Math.abs(fifths)));
 let name=(fifths<0?FLAT:SHARP)[pc]!;
 for(const [step,natural] of Object.entries(NATURAL)){const alter=altered.has(step)?Math.sign(fifths):0;if(((natural+alter+12)%12)===pc){name=step+(alter>0?"#":alter<0?"b":"");break;}}
 const alter=name.includes("#")?1:name.includes("b")?-1:0,octave=Math.floor((midi-NATURAL[name[0]!]!-alter)/12)-1;
 return {label:name+(includeOctave||name==="C"?octave:""),authority:"derived"};
}
