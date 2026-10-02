import type {SourcePitch} from "./types.js";
const NATURAL:Record<string,number>={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
/** Reject stale or malformed spelling after any generated pitch change. */
export function matchingSourcePitch(note:{midi:number;sourcePitch?:SourcePitch}):SourcePitch|undefined {
 const source=note.sourcePitch;
 return source&&Object.hasOwn(NATURAL,source.step)&&Number.isInteger(source.alter)&&Math.abs(source.alter)<=2&&Number.isInteger(source.octave)&&source.octave>=-1&&source.octave<=9&&(source.octave+1)*12+NATURAL[source.step]!+source.alter===note.midi?source:undefined;
}
