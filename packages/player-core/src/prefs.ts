import type { PlayerSettings } from "./types.js";

const KEY = "keyspilli.prefs.v1";

const VIEW_MODES = ["falling", "beginner", "sheet", "leadsheet"] as const;
const HANDS = ["L", "R", "both"] as const;
const BACKGROUNDS = ["piano", "chord"] as const;

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

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function loadSettings(): PlayerSettings {
  const s = storage();
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? "{}") as Record<string, unknown>;
    return {
      voiceGain: clampNum(raw.voiceGain, 0, 2, DEFAULT_SETTINGS.voiceGain),
      pianoGain: clampNum(raw.pianoGain, 0, 2, DEFAULT_SETTINGS.pianoGain),
      backgroundMode: pickEnum(raw.backgroundMode, BACKGROUNDS, DEFAULT_SETTINGS.backgroundMode),
      metronome: pickBool(raw.metronome, DEFAULT_SETTINGS.metronome),
      chordKeys: pickBool(raw.chordKeys, DEFAULT_SETTINGS.chordKeys),
      sustainPedal: pickBool(raw.sustainPedal, DEFAULT_SETTINGS.sustainPedal),
      hand: pickEnum(raw.hand, HANDS, DEFAULT_SETTINGS.hand),
      speed: clampNum(raw.speed, 0.25, 4, DEFAULT_SETTINGS.speed),
      transpose: clampNum(Math.trunc(Number(raw.transpose)), -24, 24, DEFAULT_SETTINGS.transpose),
      mode: pickEnum(raw.mode, VIEW_MODES, DEFAULT_SETTINGS.mode),
      showAllKeys: pickBool(raw.showAllKeys, DEFAULT_SETTINGS.showAllKeys),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(p: PlayerSettings): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(p));
  } catch {
    // Quota or serialization failures must not break playback.
  }
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
  try {
    storage()?.setItem(key, JSON.stringify(v));
  } catch {
    // Swallow quota errors for auxiliary JSON too.
  }
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
  const s = storage();
  if (!s) return {};
  try {
    const raw = JSON.parse(s.getItem(SONG_KEY_PREFIX + songId) ?? "{}") as Record<string, unknown>;
    const out: SongPrefs = {};
    if (raw.speed !== undefined) {
      const n = Number(raw.speed);
      if (Number.isFinite(n)) out.speed = clampNum(n, 0.25, 4, 1);
    }
    if (raw.transpose !== undefined) {
      const n = Number(raw.transpose);
      if (Number.isFinite(n)) out.transpose = clampNum(Math.trunc(n), -24, 24, 0);
    }
    if (typeof raw.mode === "string") out.mode = raw.mode;
    if (HANDS.includes(raw.hand as (typeof HANDS)[number])) out.hand = raw.hand as SongPrefs["hand"];
    return out;
  } catch {
    return {};
  }
}

export function saveSongPrefs(songId: string, prefs: Partial<SongPrefs>): void {
  const current = loadSongPrefs(songId);
  saveJson(SONG_KEY_PREFIX + songId, { ...current, ...prefs });
}
