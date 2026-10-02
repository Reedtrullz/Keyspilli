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
