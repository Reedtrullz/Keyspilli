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
