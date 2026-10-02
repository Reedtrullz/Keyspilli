import { afterEach, expect, it, vi } from "vitest";
import { loadPracticeState, savePracticeState, recordAttempt, type PracticeAttempt, type SavedPassage } from "../src/practice-store.js";
afterEach(() => vi.unstubAllGlobals());
it("advances a source-bound tempo plan only once per eligible completed play-along run and stops at target", () => {
  let raw: string | null = null;
  vi.stubGlobal("localStorage", { getItem: () => raw, setItem: (_k: string,v: string) => { raw=v; } });
  const target = { baseId: "song", variantId: "song-e", fingerprint: "sha256:" + "a".repeat(64) };
  const passage: SavedPassage = { id:"phrase",name:"Opening",sectionId:"full",target,startBeat:0,endBeat:4,createdAt:"2026-10-02T00:00:00Z",targetTempo:60,repeatTarget:2,
    tempoPlan:{policyId:"plan1",startBpm:50,currentBpm:50,stepBpm:5,completedAtTempo:0,thresholdPct:90,paused:false,status:"active"} };
  expect(savePracticeState({version:1,passages:[passage],attempts:[],resume:null})).toBe(true);
  const run: PracticeAttempt = { id:"wait",target,startBeat:0,endBeat:4,startedAt:passage.createdAt,finishedAt:passage.createdAt,outcome:"completed",countInCompleted:true,
    context:{mode:"beginner",difficulty:"easy",input:"keyboard",wait:true,speed:.5,transpose:0,hand:"R",soundSource:"synth",backgroundMode:"piano",accompanimentStyle:"bass-chords",bpm:100,tempoPlan:{passageId:"phrase",policyId:"plan1"}},
    result:{total:1,hit:1,missed:0,wrong:0,late:0,accuracyPct:100} };
  const plan = () => loadPracticeState().passages[0]!.tempoPlan!;
  recordAttempt(run); expect(plan().completedAtTempo).toBe(0);
  recordAttempt({...run,id:"cancelled",outcome:"cancelled",countInCompleted:false,result:null}); expect(plan().completedAtTempo).toBe(0);
  const along = {...run,context:{...run.context,wait:false}};
  recordAttempt({...along,id:"a1"}); recordAttempt({...along,id:"a2"}); expect(plan().currentBpm).toBe(55);
  recordAttempt({...along,id:"a2",context:{...along.context,speed:.55}}); expect(plan().completedAtTempo).toBe(0);
  const state=loadPracticeState(); state.passages[0]!.tempoPlan!.paused=true; savePracticeState(state);
  recordAttempt({...along,id:"paused",context:{...along.context,speed:.55}}); expect(plan().completedAtTempo).toBe(0);
  state.passages[0]!.tempoPlan!.paused=false; savePracticeState(state);
  recordAttempt({...along,id:"old-policy",context:{...along.context,speed:.55,tempoPlan:{passageId:"phrase",policyId:"old-plan"}}}); expect(plan().completedAtTempo).toBe(0);
  for (const id of ["a3","a4"]) recordAttempt({...along,id,context:{...along.context,speed:.55}});
  expect(plan().currentBpm).toBe(60);
  for (const id of ["a5","a6"]) recordAttempt({...along,id,context:{...along.context,speed:.6}});
  expect(plan().status).toBe("complete"); expect(plan().currentBpm).toBe(60);
});
