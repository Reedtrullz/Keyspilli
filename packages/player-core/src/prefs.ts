import type { PlayerSettings } from "./types.js";

const KEY = "keyspilli.prefs.v1";

export const DEFAULT_SETTINGS: PlayerSettings = {
  voiceGain: 1,
  pianoGain: 0.4,
  backgroundMode: "piano",
  metronome: false,
  chordKeys: true,
  sustainPedal: true,
  hand: "both",
  speed: 1,
  transpose: 0,
  mode: "falling",
  showAllKeys: true,
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(): PlayerSettings {
  const s = storage();
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(s.getItem(KEY) ?? "{}") as Partial<PlayerSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(p: PlayerSettings): void {
  storage()?.setItem(KEY, JSON.stringify(p));
}

export function loadJson<T>(key: string, fallback: T): T {
  const s = storage();
  if (!s) return fallback;
  try {
    return (JSON.parse(s.getItem(key) ?? "null") as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, v: unknown): void {
  storage()?.setItem(key, JSON.stringify(v));
}

const SONG_KEY_PREFIX = "keyspilli.song-prefs.v1:";

/** Per-song practice settings that survive reloads and song switches. */
export interface SongPrefs {
  speed?: number;
  transpose?: number;
  mode?: string;
  hand?: "L" | "R" | "both";
}

export function loadSongPrefs(songId: string): SongPrefs {
  return loadJson<SongPrefs>(SONG_KEY_PREFIX + songId, {});
}

export function saveSongPrefs(songId: string, prefs: Partial<SongPrefs>): void {
  const current = loadSongPrefs(songId);
  saveJson(SONG_KEY_PREFIX + songId, { ...current, ...prefs });
}
