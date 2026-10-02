import { preferenceStorage } from "./prefs.js";
export const PRACTICE_SETS_KEY = "keyspilli.practice-sets.v1", PRACTICE_SETS_EVENT = "keyspilli-practice-sets";
export interface PracticeSetItem { id: string; baseId: string; variantId: string; passageId?: string; completed: boolean }
export interface PracticeSet { id: string; name: string; items: PracticeSetItem[] }
export interface PracticeSetsState { version: 1; sets: PracticeSet[]; activeSetId: string | null }
const empty = (): PracticeSetsState => ({ version: 1, sets: [], activeSetId: null });
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const keys = (v: Record<string,unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const unique = (rows: {id:string}[]) => new Set(rows.map(row => row.id)).size === rows.length;
export function validPracticeSets(v: unknown): v is PracticeSetsState {
  return object(v) && keys(v,["version","sets","activeSetId"]) && v.version === 1
    && Array.isArray(v.sets) && v.sets.length <= 20 && v.sets.every(set => object(set) && keys(set,["id","name","items"])
      && id(set.id) && typeof set.name === "string" && set.name.length <= 80 && !!set.name.trim()
      && Array.isArray(set.items) && set.items.length <= 50 && set.items.every(item => object(item) && keys(item,["id","baseId","variantId","passageId","completed"])
        && id(item.id) && id(item.baseId) && id(item.variantId) && (item.passageId === undefined || id(item.passageId)) && typeof item.completed === "boolean") && unique(set.items))
    && unique(v.sets) && (v.activeSetId === null || id(v.activeSetId) && v.sets.some(set => set.id === v.activeSetId))
    && new TextEncoder().encode(JSON.stringify(v)).length <= 262_144;
}
export function loadPracticeSets(): PracticeSetsState {
  try { const raw = preferenceStorage()?.getItem(PRACTICE_SETS_KEY); if (!raw || raw.length > 262_144) return empty();
    const value: unknown = JSON.parse(raw); return validPracticeSets(value) ? value : empty(); } catch { return empty(); }
}
export function savePracticeSets(value: PracticeSetsState): boolean {
  try { const storage = preferenceStorage(); if (!storage || !validPracticeSets(value)) return false;
    storage.setItem(PRACTICE_SETS_KEY,JSON.stringify(value));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PRACTICE_SETS_EVENT)); return true;
  } catch { return false; }
}
