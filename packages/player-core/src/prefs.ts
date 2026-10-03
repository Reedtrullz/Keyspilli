import { validKeyboardRange } from "./keyboard-range.js";
import type { PlayerSettings } from "./types.js";
import type { AccompanimentStyle } from "./accompaniment.js";

const KEY = "keyspilli.prefs.v1";
const ACCOMPANIMENT_STYLE_INTENT_KEY = "keyspilli.accompaniment-style-intent.v1";

const VIEW_MODES = ["falling", "beginner", "sheet", "leadsheet"] as const;
const HANDS = ["L", "R", "both"] as const;
const BACKGROUNDS = ["piano", "chord"] as const;
const ACCOMPANIMENT_STYLES = ["melody-accompaniment", "bass-chords"] as const satisfies readonly AccompanimentStyle[];
const SOUND_SOURCES = ["synth", "sampled", "organ"] as const;
const ORGAN_ROTARY_SPEEDS = ["slow", "fast"] as const;
const ORGAN_STYLES = ["rock", "cathedral"] as const;
const ORGAN_REGISTRATIONS = ["warm", "clear", "full"] as const;
export const TRANSPOSE_MIN = -24;
export const TRANSPOSE_MAX = 24;

export const DEFAULT_SETTINGS: PlayerSettings = {
  voiceGain: 1,
  pianoGain: 0.4,
  backgroundMode: "piano",
  accompanimentStyle: "bass-chords",
  soundSource: "sampled",
  organStyle: "rock",
  organRegistration: "clear",
  organRotary: "slow",
  organDrive: 0.2,
  organSpace: 0.65,
  metronome: false,
  chordKeys: true,
  sustainPedal: true,
  hand: "both",
  speed: 1,
  transpose: 0,
  mode: "falling",
  showAllKeys: true,
  physicalKeyboard: null,
  audibleSupport: false,
  renderedExpression: "source",
  keyboardLabels: "notes",
  showKeyBindings: false,
  stageTheme: "light",
};

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
export { storage as preferenceStorage };

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

function loadAccompanimentStyleIntent(s: Storage | null): AccompanimentStyle | null {
  if (!s) return null;
  try {
    const raw = JSON.parse(s.getItem(ACCOMPANIMENT_STYLE_INTENT_KEY) ?? "null") as { style?: unknown } | null;
    return ACCOMPANIMENT_STYLES.includes(raw?.style as AccompanimentStyle)
      ? raw!.style as AccompanimentStyle
      : null;
  } catch {
    return null;
  }
}

/** Record only an explicit style-button choice; ordinary settings saves do not imply intent. */
export function saveAccompanimentStyleIntent(style: AccompanimentStyle): void {
  try {
    storage()?.setItem(ACCOMPANIMENT_STYLE_INTENT_KEY, JSON.stringify({ style }));
  } catch {
    // Preference intent is advisory and must not break playback.
  }
}

export function loadSettings(): PlayerSettings {
  const s = storage();
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const explicitAccompanimentStyle = loadAccompanimentStyleIntent(s);
    return {
      voiceGain: clampNum(raw.voiceGain, 0, 2, DEFAULT_SETTINGS.voiceGain),
      pianoGain: clampNum(raw.pianoGain, 0, 2, DEFAULT_SETTINGS.pianoGain),
      backgroundMode: pickEnum(raw.backgroundMode, BACKGROUNDS, DEFAULT_SETTINGS.backgroundMode),
      accompanimentStyle: explicitAccompanimentStyle
        ?? (raw.accompanimentStyle === "bass-chords" ? "bass-chords" : DEFAULT_SETTINGS.accompanimentStyle),
      soundSource: pickEnum(raw.soundSource, SOUND_SOURCES, DEFAULT_SETTINGS.soundSource),
      organStyle: pickEnum(raw.organStyle, ORGAN_STYLES, DEFAULT_SETTINGS.organStyle),
      organRegistration: pickEnum(raw.organRegistration, ORGAN_REGISTRATIONS, DEFAULT_SETTINGS.organRegistration),
      organRotary: pickEnum(raw.organRotary, ORGAN_ROTARY_SPEEDS, DEFAULT_SETTINGS.organRotary),
      organDrive: clampNum(raw.organDrive, 0, 1, DEFAULT_SETTINGS.organDrive),
      organSpace: clampNum(raw.organSpace, 0, 1, DEFAULT_SETTINGS.organSpace),
      metronome: pickBool(raw.metronome, DEFAULT_SETTINGS.metronome),
      chordKeys: pickBool(raw.chordKeys, DEFAULT_SETTINGS.chordKeys),
      sustainPedal: pickBool(raw.sustainPedal, DEFAULT_SETTINGS.sustainPedal),
      hand: pickEnum(raw.hand, HANDS, DEFAULT_SETTINGS.hand),
      speed: clampNum(raw.speed, 0.25, 4, DEFAULT_SETTINGS.speed),
      transpose: clampNum(Math.trunc(Number(raw.transpose)), TRANSPOSE_MIN, TRANSPOSE_MAX, DEFAULT_SETTINGS.transpose),
      mode: pickEnum(raw.mode, VIEW_MODES, DEFAULT_SETTINGS.mode),
      showAllKeys: pickBool(raw.showAllKeys, DEFAULT_SETTINGS.showAllKeys),
      audibleSupport: pickBool(raw.audibleSupport, false),
      renderedExpression: pickEnum(raw.renderedExpression,["source","meter-accents"] as const,"source"),
      physicalKeyboard: validKeyboardRange(raw.physicalKeyboard) ? raw.physicalKeyboard : null,
      keyboardLabels: pickEnum(raw.keyboardLabels, ["notes", "octaves", "off"] as const, DEFAULT_SETTINGS.keyboardLabels),
      showKeyBindings: pickBool(raw.showKeyBindings, DEFAULT_SETTINGS.showKeyBindings),
      stageTheme: pickEnum(raw.stageTheme, ["light", "charcoal"] as const, DEFAULT_SETTINGS.stageTheme),
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

export function loadStringList(key: string): string[] {
  const value = loadJson<unknown>(key, []);
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
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
  mode?: PlayerSettings["mode"];
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
      if (Number.isFinite(n)) out.transpose = clampNum(Math.trunc(n), TRANSPOSE_MIN, TRANSPOSE_MAX, 0);
    }
    if (VIEW_MODES.includes(raw.mode as (typeof VIEW_MODES)[number])) out.mode = raw.mode as PlayerSettings["mode"];
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

export const TIMING_CALIBRATION_KEY = "keyspilli.timing.v1";
/** Owner-entered offset, not a measurement of device latency. Unknown remains null. */
export function loadTimingCalibration(binding: string): number | null {
  const state = loadJson<unknown>(TIMING_CALIBRATION_KEY, {});
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length > 20) return null;
  const value = (state as Record<string, unknown>)[binding];
  return typeof value === "number" && Number.isFinite(value) && value >= -250 && value <= 250 ? value : null;
}
export function saveTimingCalibration(binding: string, offset: number | null): boolean {
  if (!binding || binding.length > 256 || offset !== null && (!Number.isFinite(offset) || Math.abs(offset) > 250)) return false;
  try {
    const raw = loadJson<unknown>(TIMING_CALIBRATION_KEY, {});
    const entries = raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];
    const next = Object.fromEntries(entries.filter(([key, value]) => key !== binding && key.length <= 256 && typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 250).slice(-19));
    if (offset !== null) Object.defineProperty(next, binding, { value: offset, enumerable: true, configurable: true });
    const s = storage(); if (!s) return false;
    s.setItem(TIMING_CALIBRATION_KEY, JSON.stringify(next)); return true;
  } catch { return false; }
}
export function clearTimingCalibrations(): void { try { storage()?.removeItem(TIMING_CALIBRATION_KEY); } catch { /* playback remains available */ } }
