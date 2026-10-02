import { afterEach, expect, it, vi } from "vitest";
import { loadPracticeSets, savePracticeSets, type PracticeSetsState } from "../src/practice-sets.js";
import { exportOwnerState, parseOwnerState, restoreOwnerState } from "../src/owner-state.js";
afterEach(() => vi.unstubAllGlobals());
it("retains ordered exact variant/passage references, manual completion and bounded owner backup round-trips", () => {
  const rows = new Map<string,string>();
  vi.stubGlobal("localStorage", { get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string,v: string) => rows.set(k,v), removeItem: (k: string) => rows.delete(k) });
  const state: PracticeSetsState = { version: 1, activeSetId: "daily", sets: [{ id: "daily", name: "Daily practice", items: [
    { id: "first", baseId: "song", variantId: "song-e", completed: false, passageId: "phrase" },
    { id: "second", baseId: "other", variantId: "other-a", completed: true },
  ] }] };
  expect(savePracticeSets(state)).toBe(true); expect(loadPracticeSets()).toEqual(state);
  state.sets[0]!.items.reverse(); expect(savePracticeSets(state)).toBe(true);
  const backup = parseOwnerState(JSON.stringify(exportOwnerState(false))); rows.clear();
  expect(restoreOwnerState(backup,"replace")).toBe(true); expect(loadPracticeSets()).toEqual(state);
  expect(savePracticeSets({ ...state, sets: [state.sets[0]!, state.sets[0]!] })).toBe(false);
  expect(savePracticeSets({ ...state, activeSetId: "removed" })).toBe(false);
  expect(savePracticeSets({ ...state, sets: [{ ...state.sets[0]!, items: Array.from({length:51},(_,i) => ({id:`i${i}`,baseId:"song",variantId:"song-e",completed:false})) }] })).toBe(false);
  const older = { ...backup }; delete older.practiceSets;
  expect(restoreOwnerState(older,"replace")).toBe(true); expect(loadPracticeSets()).toEqual(state);
});
