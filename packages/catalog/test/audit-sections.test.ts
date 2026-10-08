import {expect,it} from "vitest";
import {ugCandidateIds} from "../scripts/audit-sections";

it("finds UG candidates by catalog source or artist/title rather than comparing a title to a base id",()=>{
  const ids=ugCandidateIds([
    {id:"abba-the-winner-takes-it-all",artist:"ABBA",title:"The Winner Takes It All"},
    {id:"imported-metadata-id",artist:"Åge Aleksandersen",title:"Levva Livet"},
    {id:"other-artist-levva-livet",artist:"Other Artist",title:"Levva Livet"},
    {id:"custom-ug-row",source:"ug-tabs"},
  ],[{artist:"ABBA",song:"The Winner Takes It All"},{artist:"Åge Aleksandersen",song:"Levva Livet"}]);
  expect(ids.has("abba-the-winner-takes-it-all")).toBe(true);
  expect(ids.has("imported-metadata-id")).toBe(true);
  expect(ids.has("custom-ug-row")).toBe(true);
  expect(ids.has("other-artist-levva-livet")).toBe(false);
});

import { capturedSectionBases, validateCapturedMap } from "../scripts/audit-sections";
const hash="a".repeat(64), notesHash="b".repeat(64);
const capture={schemaVersion:1,capturedAt:"2026-10-08T09:03:00Z",entries:[{baseId:"uploaded-song",sourceArtifactHash:hash,advancedNotesSha256:notesHash,playbackTempoBpm:99,servedAtCapture:true}]};
const map={baseId:"uploaded-song",sourceArtifactHash:hash,advancedNotesSha256:notesHash,playbackTempoBpm:99};

it("recognizes an uploaded base from its frozen production identity",()=>{
 const errors:string[]=[];const identities=capturedSectionBases(capture,errors);
 expect(errors).toEqual([]);expect(identities.get("uploaded-song")?.sourceArtifactHash).toBe(hash);
 validateCapturedMap(map,identities,errors);expect(errors).toEqual([]);
});

it("does not turn an unknown target into a captured base",()=>{
 const errors:string[]=[];const identities=capturedSectionBases(capture,errors);
 expect(identities.has("unknown-song")).toBe(false);
 validateCapturedMap({...map,baseId:"seed-song"},identities,errors);
 expect(errors).toEqual([]); // Seed and learner inventories retain their existing authority.
});

it.each([
 [{...capture,entries:[capture.entries[0],capture.entries[0]]},"duplicate"],
 [{...capture,entries:[{...capture.entries[0],sourceArtifactHash:"short"}]},"sourceArtifactHash"],
 [{...capture,entries:[{...capture.entries[0],advancedNotesSha256:"short"}]},"advancedNotesSha256"],
 [{...capture,entries:[{...capture.entries[0],playbackTempoBpm:0}]},"playbackTempoBpm"],
 [{...capture,entries:[{...capture.entries[0],servedAtCapture:"yes"}]},"servedAtCapture"],
 [{...capture,schemaVersion:2},"schemaVersion"],
 [{...capture,entries:{}},"entries"],
 [{...capture,entries:[null]},"entry"],
])("rejects malformed captured identities (%#)",(input,message)=>{
 const errors:string[]=[];capturedSectionBases(input,errors);expect(errors.join(" ")).toContain(message);
});

it.each([
 [{...map,sourceArtifactHash:"c".repeat(64)},"sourceArtifactHash"],
 [{...map,advancedNotesSha256:"c".repeat(64)},"advancedNotesSha256"],
 [{...map,playbackTempoBpm:100},"playbackTempoBpm"],
])("rejects stale map pins against the captured playback identity (%#)",(input,message)=>{
 const errors:string[]=[];validateCapturedMap(input,capturedSectionBases(capture,errors),errors);expect(errors.join(" ")).toContain(message);
});

it("allows an existing map that intentionally omits an Advanced-note pin",()=>{
 const errors:string[]=[];const {advancedNotesSha256,...withoutNotes}=map;
 validateCapturedMap(withoutNotes,capturedSectionBases(capture,errors),errors);expect(errors).toEqual([]);
});
