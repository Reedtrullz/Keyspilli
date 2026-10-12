import { describe, expect, it } from "vitest";
import { parseMidi, parseMusicXmlNotes, writeMusicXml, writeMidi, writeVariantArtifacts, validateArtifactFiles, type Variant } from "../src/index.js";

const variant = (notes: Variant["notes"]): Variant => ({ level: "advanced", key: "C", tempoBpm: 120, timeSig: [4,4], difficultyScore: 0, bassPattern: "none", chords: [], measures: [{index:0,startBeat:0,endBeat:4},{index:1,startBeat:4,endBeat:8}], notes });
const contrast = variant([{midi:60,start:0,dur:1,vel:20,hand:"R"},{midi:64,start:2,dur:1,vel:100,hand:"R"}]);
const score = (attrs: string) => `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note ${attrs}><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
const legacy = {schemaVersion:1,validationScope:"symbolic-events",expressivePreservation:"not-established",midi:{noteVelocities:"encoded"},musicxml:{noteVelocities:"omitted",dynamics:"omitted"}};

describe("MusicXML per-note attack velocity", () => {
  it("preserves disclosed 20/100 contrast through the actual writer and parser", () => {
    const xml = writeMusicXml(contrast,"Velocity regression","Synthetic");
    expect(parseMusicXmlNotes(xml).notes.map(n=>n.vel)).toEqual([20,100]);
  });
  it("preserves all MIDI attack integers through both actual artifacts", () => {
    const v=variant(Array.from({length:127},(_,i)=>({midi:60,start:i*0.25,dur:0.25,vel:i+1,hand:"R" as const})));
    v.measures=Array.from({length:8},(_,index)=>({index,startBeat:index*4,endBeat:index*4+4}));
    const before=structuredClone(v), artifacts=writeVariantArtifacts(v,"Complete velocity domain","Synthetic");
    const expected=v.notes.map(n=>n.vel);
    expect(parseMidi(artifacts.midi).notes.map(n=>n.vel)).toEqual(expected);
    expect(parseMusicXmlNotes(artifacts.xml).notes.map(n=>n.vel)).toEqual(expected);
    expect(validateArtifactFiles(v,artifacts)).toEqual([]);
    expect(artifacts.fidelity).toMatchObject({schemaVersion:2,musicxml:{noteVelocities:"encoded",dynamics:"omitted"}});
    expect(v).toEqual(before);
  });
  it.each([["100",90],["30",27],["+100.0",90],[".6",1],["141.111111",127],[" 22.222222 ",20],["99.5",90],["99.4",89]])("reads standard forte percentage %s as velocity %i", (d,vel) => {
    const parsed=parseMusicXmlNotes(score(`dynamics="${d}"`));
    expect(parsed.notes[0]?.vel).toBe(vel);
    expect(parsed.unsupportedControls??[]).toEqual([]);
  });
  it.each(['', 'xmlns:meta="urn:meta" meta:dynamics="100"', 'xmlns:dynamics="urn:meta"', 'Dynamics="100"'])("keeps missing exact dynamics at default: %s", attrs=>{
    expect(parseMusicXmlNotes(score(attrs)).notes[0]?.vel).toBe(80);
  });
  it.each(['dynamics="30" xmlns:meta="urn:meta" meta:dynamics="100"','xmlns:meta="urn:meta" meta:dynamics="100" dynamics="30"','dynamics="30" xmlns:dynamics="urn:meta"','dynamics="&#51;0"','xmlns:meta="urn:meta" meta:label="> dynamics=100" dynamics="30"'])("preserves exact attribute identity: %s",attrs=>{
    expect(parseMusicXmlNotes(score(attrs)).notes[0]?.vel).toBe(27);
  });
  it.each(["", "0", ".1", "-1", "NaN", "Infinity", "1e2", "141.2", "100garbage"])("refuses invalid or unrepresentable percentage %s", d=>{
    for(const attrs of [`dynamics="${d}"`,`dynamics="${d}" xmlns:meta="urn:meta" meta:dynamics="100"`,`xmlns:meta="urn:meta" meta:dynamics="100" dynamics="${d}"`]) expect(()=>parseMusicXmlNotes(score(attrs))).toThrow(/dynamics.*velocity/i);
  });
  it.each(['dynamics="30" dynamics="100"','dynamics="100" dynamics="0"'])("refuses duplicate source attributes %s", attrs=>{
    expect(()=>parseMusicXmlNotes(score(attrs))).toThrow(/duplicate.*attribute/i);
  });
  it.each([0,-1,128,20.1,NaN,Infinity])("refuses invalid source attack velocity %s instead of clamping", vel=>{
    expect(()=>writeMusicXml(variant([{...contrast.notes[0]!,vel}]),"Invalid","Synthetic")).toThrow(/velocity/i);
  });
  it("keeps the initial attack of ties and separate chord/staff velocities with source pedal",()=>{
    const v=variant([{midi:60,start:0,dur:6,vel:20,hand:"R",sourceMidiChannel:2},{midi:64,start:0,dur:2,vel:100,hand:"R",sourceMidiChannel:2},{midi:67,start:0,dur:2,vel:71,hand:"R",sourceMidiChannel:2},{midi:48,start:1,dur:5,vel:127,hand:"L",sourceMidiChannel:3}]);
    v.sourcePedal={version:1,endBeat:8,provenance:"midi-file",changes:[{beat:0,channel:2,value:127,source:"midi:0"},{beat:7,channel:2,value:0,source:"midi:0"}]};
    const before=structuredClone(v), a=writeVariantArtifacts(v,"Tied chord","Synthetic");
    expect(a.xml).toContain('<tie type="start"/>'); expect(a.xml).toContain('<chord/>');
    expect(validateArtifactFiles(v,a)).toEqual([]);
    for(const parsed of [parseMidi(a.midi),parseMusicXmlNotes(a.xml)]) expect(parsed.notes.map(n=>[n.midi,n.start,n.dur,n.vel,n.sourceMidiChannel])).toEqual([[60,0,6,20,2],[64,0,2,100,2],[67,0,2,71,2],[48,1,5,127,3]]);
    expect(v).toEqual(before);
    const continuation=a.xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, note=> note.includes('<tie type="stop"/>') ? note.replace(/dynamics="[^"]*"/,'dynamics="111.111111"') : note);
    expect(parseMusicXmlNotes(continuation).notes[0]?.vel).toBe(20);
  });
  it("detects velocity-only tampering in both artifacts but retains explicit legacy symbolic checks",()=>{
    const a=writeVariantArtifacts(contrast,"Contract","Synthetic"), xml=a.xml.replace(/ dynamics="[^"]*"/g,"");
    expect(validateArtifactFiles(contrast,{...a,xml}).join(" ")).toMatch(/xml.*velocity/i);
    expect(validateArtifactFiles(contrast,{midi:a.midi,xml}).join(" ")).toMatch(/xml.*velocity/i);
    expect(validateArtifactFiles(contrast,{...a,xml,fidelity:legacy})).toEqual([]);
    expect(validateArtifactFiles(contrast,{...a,xml:xml.replace("<step>C</step>","<step>D</step>"),fidelity:legacy}).join(" ")).toMatch(/xml.*note/i);
    const midi=writeMidi(contrast.notes.map(n=>({...n,vel:80})),{tempoBpm:120,timeSig:[4,4]});
    expect(validateArtifactFiles(contrast,{...a,midi}).join(" ")).toMatch(/midi.*velocity/i);
  });
  it.each([{schemaVersion:3}, {schemaVersion:2}, {...legacy,schemaVersion:2}, {...legacy,extra:true}])("refuses malformed or unknown fidelity without downgrading to legacy: %j", fidelity=>{
    const a=writeVariantArtifacts(contrast,"Record","Synthetic");
    expect(validateArtifactFiles(contrast,{...a,fidelity}).join(" ")).toMatch(/fidelity/i);
  });
});
