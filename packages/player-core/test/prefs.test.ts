import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};

vi.stubGlobal("localStorage", ls);

const { DEFAULT_SETTINGS, loadSettings, saveJson, saveSettings, loadSongPrefs } = await import(
  "../src/prefs.js"
);

const KEY = "keyspilli.prefs.v1";

beforeEach(() => {
  store.clear();
  // Re-stub each test: afterEach unstubs, so later tests would otherwise
  // see no localStorage at all and silently fall back to defaults.
  vi.stubGlobal("localStorage", ls);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it("returns defaults for malformed JSON", () => {
    store.set(KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back invalid fields while preserving valid ones", () => {
    store.set(KEY, JSON.stringify({ speed: "fast", voiceGain: 0.5, metronome: true }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, speed: 1, voiceGain: 0.5, metronome: true });
  });

  it("clamps numbers into range", () => {
    store.set(KEY, JSON.stringify({ voiceGain: 99, transpose: -100 }));
    const s = loadSettings();
    expect(s.voiceGain).toBe(2);
    expect(s.transpose).toBe(-24);
  });

  it("uses defaults for NaN-like values", () => {
    store.set(KEY, JSON.stringify({ voiceGain: null, speed: 1e999, transpose: "abc" }));
    const s = loadSettings();
    expect(s.voiceGain).toBe(DEFAULT_SETTINGS.voiceGain);
    expect(s.speed).toBe(DEFAULT_SETTINGS.speed);
    expect(s.transpose).toBe(DEFAULT_SETTINGS.transpose);
  });

  it("rejects unknown enum values", () => {
    store.set(KEY, JSON.stringify({ mode: "bogus", hand: "X", backgroundMode: "flute", soundSource: "flute", organRotary: "warp" }));
    const s = loadSettings();
    expect(s.mode).toBe("falling");
    expect(s.hand).toBe("both");
    expect(s.backgroundMode).toBe("piano");
    expect(s.soundSource).toBe(DEFAULT_SETTINGS.soundSource);
    expect(s.organRotary).toBe("slow");
  });

  it("truncates fractional transpose", () => {
    store.set(KEY, JSON.stringify({ transpose: 2.9 }));
    expect(loadSettings().transpose).toBe(2);
  });

  it("preserves organ sound and controls", () => {
    store.set(KEY, JSON.stringify({ soundSource: "organ", organRotary: "fast", organDrive: 0.73 }));
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      soundSource: "organ",
      organRotary: "fast",
      organDrive: 0.73,
    });
  });

  it("clamps persisted organ drive", () => {
    store.set(KEY, JSON.stringify({ organDrive: 4 }));
    expect(loadSettings().organDrive).toBe(1);
  });
});

describe("saveSettings/saveJson", () => {
  it("swallows setItem failures", () => {
    const original = ls.setItem;
    ls.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
      expect(() => saveJson("some-key", { a: 1 })).not.toThrow();
    } finally {
      ls.setItem = original;
    }
  });
});

describe("loadSongPrefs", () => {
  it("returns an empty object for corrupt JSON", () => {
    store.set("keyspilli.song-prefs.v1:song-1", "]]]");
    expect(loadSongPrefs("song-1")).toEqual({});
  });

  it("clamps partials and drops invalid entries", () => {
    store.set(
      "keyspilli.song-prefs.v1:song-1",
      JSON.stringify({ speed: 99, transpose: -100, hand: "Q", extra: true }),
    );
    expect(loadSongPrefs("song-1")).toEqual({ speed: 4, transpose: -24 });
  });

  it("keeps valid partials untouched", () => {
    store.set(
      "keyspilli.song-prefs.v1:song-1",
      JSON.stringify({ speed: 0.5, transpose: 3, hand: "L", mode: "sheet" }),
    );
    expect(loadSongPrefs("song-1")).toEqual({ speed: 0.5, transpose: 3, hand: "L", mode: "sheet" });
  });
});
