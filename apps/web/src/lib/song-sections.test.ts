import { describe, expect, it } from "vitest";
import { resolveSongSections } from "./song-sections";
import type { SongData } from "@keyspilli/player-core";
import sourceMaps from "../../../../catalog/song-sections.json";

const data:SongData={notes:[{midi:60,start:0,dur:1,vel:80}],chords:[],measures:Array.from({length:16},(_,index)=>({index,startBeat:index*4,endBeat:index*4+4})),key:"C",tempoBpm:120,timeSig:[4,4]};
const entry={baseId:"fixture",sourceArtifactHash:"a".repeat(64),playbackTempoBpm:120,sections:[{id:"source-verse",label:"Verse 1",startBeat:0,endBeat:32,type:"verse" as const,evidence:"source" as const},{id:"source-chorus",label:"Chorus",startBeat:32,endBeat:64,type:"chorus" as const,evidence:"source" as const}]};
describe("song sections",()=>{
 it("falls back safely when stored section metadata is malformed",()=>{
  for(const sections of [[null],{},[null,entry.sections[0]]]) {
   const malformed={...data,sections} as unknown as SongData;
   expect(resolveSongSections({baseId:"unmapped"},malformed).every(s=>s.evidence==="estimated")).toBe(true);
  }
 });
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
 it("keeps chart-derived maps distinct from timed source markers",()=>{
  const chart={...entry,sections:entry.sections.map(s=>({...s,evidence:"chart" as const}))};
  const sections=resolveSongSections({baseId:"fixture",category:"Pop"},data,entry.sourceArtifactHash,[chart]);
  expect(sections.map(s=>s.label)).toEqual(["Verse 1","Chorus"]);
  expect(sections.every(s=>s.evidence==="chart")).toBe(true);
 });
 it("names Queen Somebody To Love from its chart map",()=>{
  const queen=sourceMaps.entries.find(map=>map.baseId==="queen-somebody-to-love");
  expect(queen).toBeDefined();
  expect(queen!.sections.map(s=>s.label)).toEqual([
   "Intro","Instrumental","Verse 1","Chorus","Verse 2","Chorus",
   "Bridge","Solo","Chorus","Verse 3","Outro",
  ]);
  expect(queen!.sections.every(s=>s.evidence==="chart")).toBe(true);
  expect(queen!.sections.some(s=>/^Section \d/.test(s.label))).toBe(false);
 });
 it("resolves the Queen map on its real source bytes and playback clock",()=>{
  const queen=sourceMaps.entries.find(map=>map.baseId==="queen-somebody-to-love")!;
  const queenData:SongData={...data,tempoBpm:108,
   measures:Array.from({length:180},(_,index)=>({index,startBeat:index*3,endBeat:index*3+3}))};
  const maps=sourceMaps.entries as unknown as Parameters<typeof resolveSongSections>[3];
  const sections=resolveSongSections({baseId:"queen-somebody-to-love",category:"Rock"},queenData,queen.sourceArtifactHash,maps);
  expect(sections.map(s=>s.label)).toEqual(queen.sections.map(s=>s.label));
  expect(sections.every(s=>s.evidence==="chart")).toBe(true);
  expect(sections.at(-1)?.endBeat).toBe(540);
  expect(resolveSongSections({baseId:"queen-somebody-to-love",category:"Rock"},queenData,"b".repeat(64),maps)
   .every(s=>s.evidence==="estimated")).toBe(true);
 });
 it("keeps every catalog section map well-formed",()=>{
  expect(sourceMaps.entries.length).toBeGreaterThan(0);
  for(const map of sourceMaps.entries){
   expect(map.sourceArtifactHash).toMatch(/^[0-9a-f]{64}$/);
   expect(map.playbackTempoBpm).toBeGreaterThan(0);
   expect(map.sections.length).toBeGreaterThan(0);
   const ids=new Set<string>();
   let previousEnd=0;
   for(const section of map.sections){
    expect(ids.has(section.id)).toBe(false);
    ids.add(section.id);
    expect(section.label.trim()).not.toBe("");
    expect(section.label.length).toBeLessThanOrEqual(160);
    expect(section.startBeat).toBeGreaterThanOrEqual(previousEnd);
    expect(section.endBeat).toBeGreaterThan(section.startBeat);
    expect(["source","chart","estimated"]).toContain(section.evidence);
    previousEnd=section.endBeat;
   }
  }
 });
});
