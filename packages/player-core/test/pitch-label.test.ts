import {expect,it} from "vitest";
import {learnerPitch} from "../src/pitch-label.js";
it("uses matching source spelling only at unchanged pitch and labels derived playback spelling honestly",()=>{
 const flat={midi:70,sourcePitch:{step:"B" as const,alter:-1 as const,octave:4 as const}};
 expect(learnerPitch(flat,0,"C")).toEqual({label:"Bb4",authority:"source"});expect(learnerPitch(flat,1,"C")).toEqual({label:"B4",authority:"derived"});
 expect(learnerPitch({...flat,midi:71},0,"Bb")).toEqual({label:"B4",authority:"derived"});
 expect(learnerPitch({midi:61},0,"Db").label).toBe("Db4");expect(learnerPitch({midi:65},0,"C#").label).toBe("E#4");
 expect(learnerPitch({midi:59},0,"Cb").label).toBe("Cb4");expect(learnerPitch({midi:60,sourcePitch:{step:"B",alter:1,octave:3}},0,"C").label).toBe("B#3");
 expect(learnerPitch({midi:64,sourcePitch:{step:"E",alter:0,octave:4}},0,"Eb")).toEqual({label:"E4",authority:"source"});
 expect(learnerPitch({midi:60},0,"C",false).label).toBe("C4");expect(learnerPitch(flat,0,"C",false).label).toBe("Bb");
});
