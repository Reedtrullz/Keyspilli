import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeMidi } from "@keyspilli/midi";

const scratch: string[] = [];
afterEach(()=>{for(const dir of scratch.splice(0))rmSync(dir,{recursive:true,force:true});});
const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"keyspilli-chart-cli-"));scratch.push(dir);
  const notes=Array.from({length:24},(_,bar)=>({midi:bar<8?48:bar<16?54:55,start:bar*4,dur:4,vel:80}));
  const chart=JSON.stringify({source:"ultimate-guitar",tabId:123,sections:[{label:"Verse",chords:["C"]},{label:"Bridge",chords:["F#"]},{label:"Outro",chords:["G"]}]});
  const data=JSON.stringify({notes,measures:notes.map((_,index)=>({index,startBeat:index*4,endBeat:(index+1)*4})),tempoBpm:120,provenance:{sourceRef:"seed:fixture.mid"}});
  const midi=Buffer.from(writeMidi(notes,{tempoBpm:120,timeSig:[4,4]}));
  for(const [file,bytes] of [["chart.json",chart],["notes.json",data],["fixture.mid",midi]] as const)writeFileSync(join(dir,file),bytes);
  const receipt={baseId:"fixture",sourceArtifactHash:sha(midi),notesSha256:sha(data),chartSha256:sha(chart),chartUrl:"https://tabs.ultimate-guitar.com/tab/fixture/song-chords-123",playbackTempoBpm:120,sourceRef:"seed:fixture.mid",notesOrigin:"local"};
  writeFileSync(join(dir,"identity.json"),JSON.stringify(receipt));
  return {dir,receipt};
}
function run(dir:string) {
  return spawnSync(process.execPath,["--import","tsx",new URL("../scripts/align-chart-sections.ts",import.meta.url).pathname,
    join(dir,"chart.json"),join(dir,"fixture.mid"),join(dir,"notes.json"),"fixture","https://tabs.ultimate-guitar.com/tab/fixture/song-chords-123",join(dir,"identity.json")],{encoding:"utf8"});
}
it("refuses a changed notes file before emitting a source-attributed candidate",()=>{
  const {dir}=fixture();
  const data=JSON.parse(readFileSync(join(dir,"notes.json"),"utf8"));data.notes[0].midi=72;
  writeFileSync(join(dir,"notes.json"),JSON.stringify(data));
  const result=run(dir);
  expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).toMatch(/notes.*identity/i);
});
it("refuses a receipt for a different base or source MIDI",()=>{
  for(const change of [{baseId:"other"},{sourceArtifactHash:"a".repeat(64)}]){
    const {dir,receipt}=fixture();writeFileSync(join(dir,"identity.json"),JSON.stringify({...receipt,...change}));
    const result=run(dir);expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).toMatch(/identity/i);
  }
});
it("refuses a chart payload whose tab id or provider differs from its bound URL",()=>{
  for(const change of [{tabId:999},{source:"other-provider"}]){
    const {dir,receipt}=fixture();const chart={...JSON.parse(readFileSync(join(dir,"chart.json"),"utf8")),...change};
    const bytes=JSON.stringify(chart);writeFileSync(join(dir,"chart.json"),bytes);writeFileSync(join(dir,"identity.json"),JSON.stringify({...receipt,chartSha256:sha(bytes)}));
    const result=run(dir);expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).toMatch(/chart.*identity/i);
  }
});
it("accepts matching inputs and emits no catalog entry without landmarks",()=>{
  const {dir}=fixture();const result=run(dir);expect(result.status).toBe(0);
  const value=JSON.parse(result.stdout);expect(value.candidate.baseId).toBe("fixture");expect(value.candidate.sections).toEqual([]);
  expect(value.publishable).toBe(false);
});
