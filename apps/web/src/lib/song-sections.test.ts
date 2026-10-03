import { describe, expect, it } from "vitest";
import { resolveSongSections } from "./song-sections";
import type { SongData } from "@keyspilli/player-core";

const data:SongData={notes:[{midi:60,start:0,dur:1,vel:80}],chords:[],measures:Array.from({length:16},(_,index)=>({index,startBeat:index*4,endBeat:index*4+4})),key:"C",tempoBpm:120,timeSig:[4,4]};
const entry={baseId:"fixture",sourceArtifactHash:"a".repeat(64),playbackTempoBpm:120,sections:[{id:"source-verse",label:"Verse 1",startBeat:0,endBeat:32,type:"verse" as const,evidence:"source" as const},{id:"source-chorus",label:"Chorus",startBeat:32,endBeat:64,type:"chorus" as const,evidence:"source" as const}]};
describe("song sections",()=>{
 it("uses a map only for the exact source and playback clock",()=>{
  expect(resolveSongSections({baseId:"fixture",category:"Pop"},data,entry.sourceArtifactHash,[entry]).map(s=>s.label)).toEqual(["Verse 1","Chorus"]);
  expect(resolveSongSections({baseId:"fixture",category:"Pop"},data,"b".repeat(64),[entry]).every(s=>s.evidence==="estimated")).toBe(true);
  expect(resolveSongSections({baseId:"fixture",category:"Pop"},{...data,tempoBpm:90},entry.sourceArtifactHash,[entry]).every(s=>s.evidence==="estimated")).toBe(true);
 });
 it("prioritises arrangement-authored names over a retained source map",()=>{
  expect(resolveSongSections({baseId:"fixture",category:"Pop"},{...data,sections:[{id:"custom",label:"Piano opening",startBeat:0,endBeat:64}]},entry.sourceArtifactHash,[entry]).map(s=>s.label)).toEqual(["Piano opening"]);
 });
 it("rejects a map after arrangement bytes change even if source and tempo stay the same",()=>{
  const pinned={...entry,advancedNotesSha256:"c".repeat(64)};
  const original={...data,sourceFingerprint:`variant:fixture:a:fixture-a:${entry.sourceArtifactHash}:notes:${pinned.advancedNotesSha256}`};
  expect(resolveSongSections({baseId:"fixture"},original,entry.sourceArtifactHash,[pinned])[0]!.label).toBe("Verse 1");
  const changed={...original,sourceFingerprint:original.sourceFingerprint.replace(/:notes:.*/,`:notes:${"d".repeat(64)}`)};
  expect(resolveSongSections({baseId:"fixture"},changed,entry.sourceArtifactHash,[pinned]).every(s=>s.evidence==="estimated")).toBe(true);
 });
 it("gives legacy unlabelled songs meaningful estimated names without changing notes",()=>{
  const before=JSON.stringify(data);
  const sections=resolveSongSections({baseId:"unmapped",category:"Pop"},data);
  expect(sections.length).toBeGreaterThan(0);
  expect(sections.every(s=>s.label.includes("estimated")&&!/^Section \d/.test(s.label))).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
 });
});
