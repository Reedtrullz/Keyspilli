import { DEFAULT_SETTINGS, loadSettings, loadSongPrefs, loadStringList, preferenceStorage, TIMING_CALIBRATION_KEY, type SongPrefs } from "./prefs.js";
import { loadPracticeState, validPracticeState, PRACTICE_STATE_KEY, PRACTICE_STATE_EVENT, PRACTICE_STATE_MAX_BYTES, type PracticeState } from "./practice-store.js";
import type { PlayerSettings } from "./types.js";
import type { MelodySelection, MelodyPhraseOverride, SourceBackingMode } from "./accompaniment.js";

const SONG_PREFIX = "keyspilli.song-prefs.v1:", MELODY_PREFIX = "keyspilli.melody-accompaniment.v2:";
const RESTORED_MELODY = "keyspilli.restored-melody.v1";
export const OWNER_STATE_MAX_BYTES = 2_097_152;
export interface OwnerMelodyChoice { sourceFingerprint: string; selection: MelodySelection; sourceBackingMode: SourceBackingMode; phraseOverrides: MelodyPhraseOverride[] }
export interface OwnerState {
  version: 1; includeHistory: boolean; settings: PlayerSettings; favorites: string[]; learned: string[];
  songPrefs: Record<string, SongPrefs>; practice: PracticeState; musicalChoices: Record<string, OwnerMelodyChoice>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(key => allowed.includes(key));
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !["__proto__", "prototype", "constructor"].includes(v);
const bounded = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const oneOf = (v: unknown, choices: readonly string[]) => typeof v === "string" && choices.includes(v);
const modes = ["falling", "beginner", "sheet", "leadsheet"], hands = ["L", "R", "both"];
function songPrefs(v: unknown): v is SongPrefs {
  return object(v) && keys(v, ["speed", "transpose", "mode", "hand"])
    && (v.speed === undefined || bounded(v.speed, .25, 4))
    && (v.transpose === undefined || bounded(v.transpose, -24, 24) && Number.isInteger(v.transpose))
    && (v.mode === undefined || oneOf(v.mode, modes)) && (v.hand === undefined || oneOf(v.hand, hands));
}
function settings(v: unknown): v is PlayerSettings {
  if (!object(v) || !keys(v, Object.keys(DEFAULT_SETTINGS)) || Object.keys(v).length !== Object.keys(DEFAULT_SETTINGS).length) return false;
  const enums: Record<string, readonly string[]> = { mode: modes, hand: hands, backgroundMode: ["piano", "chord"],
    accompanimentStyle: ["melody-accompaniment", "bass-chords"], soundSource: ["synth", "sampled", "organ"], organStyle: ["rock", "cathedral"],
    organRegistration: ["warm", "clear", "full"], organRotary: ["slow", "fast"], keyboardLabels: ["notes", "octaves", "off"], stageTheme: ["light", "charcoal"] };
  return Object.entries(DEFAULT_SETTINGS).every(([key, fallback]) => enums[key] ? oneOf(v[key], enums[key]!)
    : typeof fallback === "boolean" ? typeof v[key] === "boolean"
    : key === "transpose" ? bounded(v[key], -24, 24) && Number.isInteger(v[key])
    : key === "speed" ? bounded(v[key], .25, 4) : bounded(v[key], 0, key.endsWith("Gain") ? 2 : 1));
}
function musicalChoice(v: unknown): v is OwnerMelodyChoice {
  return object(v) && keys(v, ["sourceFingerprint", "selection", "sourceBackingMode", "phraseOverrides"])
    && typeof v.sourceFingerprint === "string" && v.sourceFingerprint.length > 0 && v.sourceFingerprint.length <= 256
    && oneOf(v.selection, ["automatic", "right-hand"]) && oneOf(v.sourceBackingMode, ["default", "conservative"])
    && Array.isArray(v.phraseOverrides) && v.phraseOverrides.length <= 128 && v.phraseOverrides.every(p => object(p)
      && keys(p, ["startBeat", "endBeat", "sourceNoteIds", "sourceFingerprint"])
      && bounded(p.startBeat, 0, 1e7) && bounded(p.endBeat, 0, 1e7) && (p.endBeat as number) > (p.startBeat as number)
      && p.sourceFingerprint === v.sourceFingerprint && Array.isArray(p.sourceNoteIds) && p.sourceNoteIds.length <= 1000
      && p.sourceNoteIds.every(n => typeof n === "string" && n.length > 0 && n.length <= 256)
      && new Set(p.sourceNoteIds).size === p.sourceNoteIds.length);
}
function map(v: unknown, max: number, valid: (v: unknown) => boolean): boolean {
  return object(v) && Object.keys(v).length <= max && Object.entries(v).every(([key, value]) => id(key) && valid(value));
}
function list(v: unknown): v is string[] { return Array.isArray(v) && v.length <= 5000 && v.every(id) && new Set(v).size === v.length; }
function valid(v: unknown): v is OwnerState {
  return object(v) && keys(v, ["version", "includeHistory", "settings", "favorites", "learned", "songPrefs", "practice", "musicalChoices"])
    && v.version === 1 && typeof v.includeHistory === "boolean" && settings(v.settings) && list(v.favorites) && list(v.learned)
    && map(v.songPrefs, 1000, songPrefs) && validPracticeState(v.practice) && new TextEncoder().encode(JSON.stringify(v.practice)).length <= PRACTICE_STATE_MAX_BYTES && (v.includeHistory || v.practice.attempts.length === 0)
    && map(v.musicalChoices, 1000, musicalChoice);
}
export function parseOwnerState(raw: string): OwnerState {
  if (raw.length > OWNER_STATE_MAX_BYTES || new TextEncoder().encode(raw).length > OWNER_STATE_MAX_BYTES) throw Error("Owner state exceeds 2 MiB.");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw Error("Invalid owner-state JSON."); }
  if (!valid(value)) throw Error("Unsupported or malformed owner state. Nothing was changed.");
  return value;
}
function read(key: string): unknown {
  try { const raw = preferenceStorage()?.getItem(key); return raw && raw.length <= OWNER_STATE_MAX_BYTES ? JSON.parse(raw) : null; } catch { return null; }
}
export function exportOwnerState(includeHistory: boolean): OwnerState {
  const storage = preferenceStorage(), prefs: Record<string, SongPrefs> = {}, choices: Record<string, OwnerMelodyChoice> = {};
  const restored = read(RESTORED_MELODY);
  if (map(restored, 1000, musicalChoice)) Object.assign(choices, restored);
  // ponytail: bounded scan of this browser's keys; a dedicated state row if the owner exceeds 5000 keys.
  for (let i = 0; storage && i < Math.min(storage.length, 5000); i++) {
    const key = storage.key(i); if (!key) continue;
    if (key.startsWith(SONG_PREFIX) && id(key.slice(SONG_PREFIX.length))) prefs[key.slice(SONG_PREFIX.length)] = loadSongPrefs(key.slice(SONG_PREFIX.length));
    if (key.startsWith(MELODY_PREFIX) && id(key.slice(MELODY_PREFIX.length))) {
      const value = read(key);
      if (!object(value) || value.schemaVersion !== 2 || value.generatorVersion !== "melody-accompaniment.v2") continue;
      const normalized = { sourceFingerprint: value.sourceFingerprint, selection: value.selection,
        sourceBackingMode: value.sourceBackingMode ?? "default", phraseOverrides: value.phraseOverrides ?? [] };
      if (musicalChoice(normalized)) choices[key.slice(MELODY_PREFIX.length)] = normalized;
    }
  }
  const practice = loadPracticeState();
  const state: OwnerState = { version: 1, includeHistory, settings: loadSettings(), favorites: loadStringList("keyspilli.favorites"), learned: loadStringList("keyspilli.learned"),
    songPrefs: prefs, musicalChoices: choices, practice: { ...practice, attempts: includeHistory ? practice.attempts : [] } };
  return parseOwnerState(JSON.stringify(state));
}
export function restoredMelodyChoice(songId: string, fingerprint: string | null): OwnerMelodyChoice | null {
  const rows = read(RESTORED_MELODY), value = object(rows) ? rows[songId] : null;
  return musicalChoice(value) && value.sourceFingerprint === fingerprint ? value : null;
}
export function restoreOwnerState(incoming: OwnerState, mode: "merge" | "replace"): boolean {
  try {
    parseOwnerState(JSON.stringify(incoming));
    if (!["merge", "replace"].includes(mode)) return false;
    const storage = preferenceStorage(); if (!storage || storage.length > 5000) return false;
    const current = exportOwnerState(true), merge = mode === "merge";
    const combine = <T extends { id: string }>(a: T[], b: T[]) => [...b, ...a.filter(item => !b.some(next => next.id === item.id))];
    const next: OwnerState = { ...incoming, includeHistory: true,
      favorites: merge ? [...new Set([...current.favorites, ...incoming.favorites])] : incoming.favorites,
      learned: merge ? [...new Set([...current.learned, ...incoming.learned])] : incoming.learned,
      songPrefs: merge ? { ...current.songPrefs, ...Object.fromEntries(Object.entries(incoming.songPrefs).map(([id, prefs]) => [id, { ...current.songPrefs[id], ...prefs }])) } : incoming.songPrefs,
      musicalChoices: merge ? { ...current.musicalChoices, ...incoming.musicalChoices } : incoming.musicalChoices,
      practice: { ...incoming.practice, passages: merge ? combine(current.practice.passages, incoming.practice.passages) : incoming.practice.passages,
        attempts: incoming.includeHistory ? (merge ? combine(current.practice.attempts, incoming.practice.attempts).sort((a,b) => b.startedAt.localeCompare(a.startedAt)).slice(0,200) : incoming.practice.attempts) : current.practice.attempts,
        resume: merge ? incoming.practice.resume ?? current.practice.resume : incoming.practice.resume } };
    if (!valid(next)) return false;
    parseOwnerState(JSON.stringify(next));
    const changes = new Map<string, string | null>([["keyspilli.prefs.v1", JSON.stringify(next.settings)], ["keyspilli.favorites", JSON.stringify(next.favorites)],
      ["keyspilli.learned", JSON.stringify(next.learned)], [PRACTICE_STATE_KEY, JSON.stringify(next.practice)], [RESTORED_MELODY, JSON.stringify(next.musicalChoices)],
      ["keyspilli.accompaniment-style-intent.v1", JSON.stringify({ style: next.settings.accompanimentStyle })], [TIMING_CALIBRATION_KEY, null]]);
    if (!merge) for (const id of Object.keys(current.songPrefs)) changes.set(SONG_PREFIX + id, null);
    if (!merge) for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(MELODY_PREFIX) && id(key.slice(MELODY_PREFIX.length))) changes.set(key, null);
    }
    for (const id of Object.keys(merge ? incoming.musicalChoices : current.musicalChoices)) changes.set(MELODY_PREFIX + id, null);
    for (const [id, value] of Object.entries(next.songPrefs)) changes.set(SONG_PREFIX + id, JSON.stringify(value));
    const before = new Map([...changes.keys()].map(key => [key, storage.getItem(key)]));
    try { for (const [key, value] of changes) value === null ? storage.removeItem(key) : storage.setItem(key, value); }
    catch { for (const [key, value] of before) { try { value === null ? storage.removeItem(key) : storage.setItem(key, value); } catch { /* report failed restore; no atomic localStorage transaction exists */ } } return false; }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PRACTICE_STATE_EVENT));
    return true;
  } catch { return false; }
}
