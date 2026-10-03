import { describe, expect, it } from "vitest";
import { parseMidi, parseMusicXmlNotes, buildVariants } from "../src/index.js";
import { sectionsFromMarkers } from "../src/source-sections.js";

function midi() {
  const text=(delta:number,label:string)=>[delta,255,6,label.length,...Buffer.from(label)];
  const events=[...text(0,"Verse 1"),0,255,81,3,7,161,32,0,144,60,80,96,128,60,0,...text(0,"Chorus"),0,255,81,3,15,66,64,0,144,64,80,96,128,64,0,0,255,47,0];
  const length=Buffer.alloc(4);length.writeUInt32BE(events.length);
  return new Uint8Array(Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96]),Buffer.from('MTrk'),length,Buffer.from(events)]));
}

describe("source section markers",()=>{
  it("ignores commentary and conflicts, while keeping genuine section labels",()=>{
    expect(sectionsFromMarkers([{beat:0,label:"Choir singing chorus"},{beat:4,label:"Verse 1:"},{beat:12,label:"Chorus"},{beat:12,label:"Bridge"},{beat:20,label:"Outro"}],24).map(s=>s.label)).toEqual(["Verse 1","Outro"]);
  });
  it("ends a known span at a conflicting marker instead of extending source certainty",()=>{
    const markers=[{beat:0,label:"Verse 1"},{beat:16,label:"Chorus"},{beat:16,label:"Bridge"}];
    expect(sectionsFromMarkers(markers,32).map(s=>[s.label,s.startBeat,s.endBeat])).toEqual([["Verse 1",0,16]]);
  });
  it("retains ambiguous boundaries when combining MusicXML parts",()=>{
    const direction=(label:string)=>`<direction><direction-type><words>${label}</words></direction-type></direction>`;
    const note='<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>';
    const part=(id:string,labels:string)=>`<part id="${id}"><measure><attributes><divisions>1</divisions></attributes>${direction("Verse 1")}${note}${labels}${note}</measure></part>`;
    const xml=`<score-partwise>${part("P1",direction("Chorus")+direction("Bridge"))}${part("P2","")}</score-partwise>`;
    expect(parseMusicXmlNotes(xml).sections?.map(s=>[s.label,s.startBeat,s.endBeat])).toEqual([["Verse 1",0,4]]);
  });
  it("retains MusicXML rehearsal labels at their actual cursor and offset",()=>{
    const xml='<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><rehearsal>Verse 1</rehearsal></direction-type></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note><direction><direction-type><words>Chorus</words></direction-type><offset>2</offset></direction><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
    expect(parseMusicXmlNotes(xml).sections?.map(s=>[s.label,s.startBeat,s.endBeat])).toEqual([["Verse 1",0,3],["Chorus",3,4]]);
  });
  it("retains timed MIDI role markers and carries them through variable-tempo normalization",()=>{
    const parsed=parseMidi(midi());
    expect(parsed.sections?.map(s=>[s.label,s.startBeat,s.endBeat,s.evidence])).toEqual([["Verse 1",0,1,"source"],["Chorus",1,2,"source"]]);
    const variants=buildVariants(parsed,{title:"Fixture",artist:"Test"});
    expect(variants).toHaveLength(6);
    for(const v of variants)expect(v.sections?.map(s=>[s.label,s.startBeat,s.endBeat])).toEqual([["Verse 1",0,1],["Chorus",1,3]]);
  });
});
