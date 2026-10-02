import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/prefs.js";
import { exportOwnerState, parseOwnerState, restoreOwnerState, restoredMelodyChoice } from "../src/owner-state.js";

afterEach(() => vi.unstubAllGlobals());
it("previews bounded owner state, restores supported fields atomically and withholds stale musical choices", () => {
  const rows = new Map<string, string>([["keyspilli.favorites", '["old-e"]'], ["unrelated", "keep"]]);
  vi.stubGlobal("localStorage", { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, removeItem: (key: string) => rows.delete(key),
    setItem: (key: string, value: string) => { rows.set(key, value); } });
  const snapshot = exportOwnerState(false);
  expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
  snapshot.favorites = ["new-e"];
  rows.set("keyspilli.song-prefs.v1:new-e", JSON.stringify({ speed: .5, hand: "L" }));
  snapshot.songPrefs = { "new-e": { hand: "R" } };
  snapshot.musicalChoices = { "new-e": { sourceFingerprint: "fixture-v1", selection: "right-hand", sourceBackingMode: "default", phraseOverrides: [] } };
  const imported = parseOwnerState(JSON.stringify(snapshot));
  expect(rows.get("keyspilli.favorites")).toBe('["old-e"]');
  expect(restoreOwnerState(imported, "merge")).toBe(true);
  expect(JSON.parse(rows.get("keyspilli.favorites")!)).toEqual(["old-e", "new-e"]);
  expect(JSON.parse(rows.get("keyspilli.song-prefs.v1:new-e")!)).toEqual({ speed: .5, hand: "R" });
  expect(restoredMelodyChoice("new-e", "fixture-v2")).toBeNull();
  expect(restoredMelodyChoice("new-e", "fixture-v1")?.selection).toBe("right-hand");
  expect(rows.get("unrelated")).toBe("keep");
  const melodyKey = "keyspilli.melody-accompaniment.v2:shadow-e";
  rows.set(melodyKey, JSON.stringify({ schemaVersion: 2, generatorVersion: "melody-accompaniment.v2", sourceFingerprint: "fixture-v1", selection: "invalid" }));
  expect(restoreOwnerState({ ...imported, musicalChoices: { "shadow-e": imported.musicalChoices["new-e"]! } }, "replace")).toBe(true);
  expect(rows.has(melodyKey)).toBe(false);
  for (const invalid of [{ ...snapshot, version: 99 }, { ...snapshot, favorites: ["new-e", "new-e"] }, { ...snapshot, settings: { ...snapshot.settings, speed: "1" } }, { ...snapshot, token: "never accepted" }]) {
    expect(() => parseOwnerState(JSON.stringify(invalid))).toThrow();
  }
  expect(() => parseOwnerState("x".repeat(2_097_153))).toThrow();
  const before = new Map(rows); let failed = false;
  vi.stubGlobal("localStorage", { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, removeItem: (key: string) => rows.delete(key),
    setItem: (key: string, value: string) => { if (key === "keyspilli.learned" && !failed) { failed = true; throw Error("quota"); } rows.set(key, value); } });
  expect(restoreOwnerState(imported, "replace")).toBe(false); expect(rows).toEqual(before);
});

it("merges older passage backups without erasing a compatible newer tempo plan", async () => {
  const {savePracticeState,loadPracticeState}=await import("../src/practice-store.js");
  const rows=new Map<string,string>();
  vi.stubGlobal("localStorage",{get length(){return rows.size;},key:(i:number)=>[...rows.keys()][i]??null,getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>rows.set(k,v),removeItem:(k:string)=>rows.delete(k)});
  const passage={id:"phrase",name:"Opening",sectionId:"full",target:{baseId:"song",variantId:"song-e",fingerprint:"sha256:"+"a".repeat(64)},startBeat:0,endBeat:4,createdAt:"2026-10-02T00:00:00Z"};
  expect(savePracticeState({version:1,passages:[passage],attempts:[],resume:null})).toBe(true);
  const older=exportOwnerState(false);
  const newer={...passage,targetTempo:60,repeatTarget:2,tempoPlan:{policyId:"plan1",startBpm:50,currentBpm:55,stepBpm:5,completedAtTempo:1,thresholdPct:90,paused:false,status:"active" as const}};
  expect(savePracticeState({version:1,passages:[newer],attempts:[],resume:null})).toBe(true);
  expect(restoreOwnerState(older,"merge")).toBe(true);expect(loadPracticeState().passages[0]).toEqual(newer);
  const changed=structuredClone(older);changed.practice.passages[0]!.endBeat=8;
  expect(restoreOwnerState(changed,"merge")).toBe(true);expect(loadPracticeState().passages[0]?.tempoPlan).toBeUndefined();
});
