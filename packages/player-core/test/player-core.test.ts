import { describe, expect, it } from "vitest";
import { beatToSec, resolveTimedNotes, firstNoteAtOrAfter, dedupeChords } from "../src/timeline.js";
import { Grader, detectPitch } from "../src/grading.js";
import { KeyboardInput, KEYMAP, MidiInput } from "../src/input.js";
import { fallingBars, noteLabel, upcomingMidi, measureMidiRange } from "../src/views/falling.js";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "../src/prefs.js";
import type { SongData } from "../src/types.js";

const song: SongData = {
  notes: [
    { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
    { midi: 62, start: 1, dur: 1, vel: 80, hand: "R" },
    { midi: 64, start: 2, dur: 1, vel: 80, hand: "R" },
    { midi: 48, start: 0, dur: 4, vel: 80, hand: "L" },
  ],
  chords: [{ beat: 0, name: "C", notes: [48, 60] }],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  key: "C",
  tempoBpm: 120,
  timeSig: [4, 4],
};

describe("timeline", () => {
  it("converts beats to seconds at speed", () => {
    expect(beatToSec(1, 120, 1)).toBeCloseTo(0.5, 5);
    expect(beatToSec(1, 120, 2)).toBeCloseTo(0.25, 5);
    expect(beatToSec(1, 60, 0.5)).toBeCloseTo(2, 5);
  });

  it("resolves timed notes with transpose", () => {
    const tn = resolveTimedNotes(song, 1, 2);
    expect(tn[0]!.midi).toBe(62);
    expect(tn[0]!.startSec).toBeCloseTo(0, 5);
    expect(tn[2]!.midi).toBe(66);
    expect(tn[2]!.startSec).toBeCloseTo(1, 5);
    expect(tn[3]!.hand).toBe("L");
  });

  it("binary search finds first note at/after time", () => {
    const tn = resolveTimedNotes(song, 1, 0);
    expect(firstNoteAtOrAfter(tn, 0)).toBe(0);
    expect(firstNoteAtOrAfter(tn, 0.6)).toBe(2);
    expect(firstNoteAtOrAfter(tn, 5)).toBe(4);
  });

  it("collapses consecutive same-name chords", () => {
    const names = dedupeChords([
      { beat: 0, name: "C", notes: [48, 60] },
      { beat: 0.25, name: "C", notes: [48, 60] },
      { beat: 0.5, name: "C", notes: [48, 62] },
      { beat: 2, name: "G", notes: [43, 55] },
      { beat: 2.25, name: "G", notes: [43, 55] },
      { beat: 4, name: "C", notes: [48, 60] },
    ]).map((c) => c.name);
    expect(names).toEqual(["C", "G", "C"]);
  });

  it("accents downbeats with a velocity curve", () => {
    const tn = resolveTimedNotes({ ...song, notes: [{ midi: 60, start: 0, dur: 1, vel: 100, hand: "R" as const }] }, 1, 0);
    expect(tn[0]!.vel).toBe(110);
    const off = resolveTimedNotes({ ...song, notes: [{ midi: 60, start: 0.25, dur: 1, vel: 100, hand: "R" as const }] }, 1, 0);
    expect(off[0]!.vel).toBe(85);
  });
});

describe("measureMidiRange", () => {
  const tn = resolveTimedNotes(song, 1, 0); // notes at beats 0 (x2) and 1, tempo 120

  it("covers the measure's notes with a margin", () => {
    const r = measureMidiRange(tn, song.measures, 120, 1, 0, { lowMidi: 45, highMidi: 99 });
    expect(r.lowMidi).toBe(45); // lowest visible midi 48 minus 3
    expect(r.highMidi).toBeGreaterThanOrEqual(67);
  });

  it("is stable for any position within the same measure", () => {
    const a = measureMidiRange(tn, song.measures, 120, 1, 0, { lowMidi: 45, highMidi: 99 });
    const b = measureMidiRange(tn, song.measures, 120, 1, 0, { lowMidi: 45, highMidi: 99 });
    expect(a).toEqual(b);
  });

  it("clamps wide measures and keeps the previous range when empty", () => {
    const wide = tn.map((n, i) => ({ ...n, midi: 30 + ((i * 20) % 70) }));
    const r = measureMidiRange(wide, song.measures, 120, 1, 0, { lowMidi: 22, highMidi: 109 });
    expect(r.highMidi - r.lowMidi).toBeLessThanOrEqual(54);
    expect(measureMidiRange([], song.measures, 120, 1, 0, { lowMidi: 40, highMidi: 80 })).toEqual({
      lowMidi: 40,
      highMidi: 80,
    });
  });
});

describe("grader", () => {
  const notes = [
    { midi: 60, startSec: 0, durSec: 0.5, vel: 80 },
    { midi: 62, startSec: 0.5, durSec: 0.5, vel: 80 },
    { midi: 64, startSec: 1, durSec: 0.5, vel: 80 },
  ];

  it("scores hits, wrongs and misses", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    g.play(63, 0.55); // wrong pitch in window
    g.play(62, 0.6); // slightly late but within tolerance
    g.tick(1.5); // last note passes untouched
    const r = g.result();
    expect(r.hit).toBe(2);
    expect(r.wrong).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.accuracyPct).toBe(50);
  });

  it("wait mode holds until the right note", () => {
    const g = new Grader(notes, { waitMode: true });
    expect(g.currentWait?.midi).toBe(60);
    expect(g.play(64, 0)).toBe(false);
    expect(g.play(60, 0)).toBe(true);
    expect(g.currentWait?.midi).toBe(62);
  });

  it("counts unplayed notes as missed instead of scoring 100%", () => {
    const g = new Grader(notes);
    g.tick(0.5);
    g.tick(1.0);
    g.tick(1.5);
    const r = g.result();
    expect(r.missed).toBe(3);
    expect(r.hit).toBe(0);
    expect(r.accuracyPct).toBe(0);
  });

  it("counts correct-but-late notes once, as late", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    g.play(64, 2.0); // window for the note at 1.0s ended at 1.35s
    g.tick(1.5); // middle note passes untouched
    const r = g.result();
    expect(r.hit).toBe(1);
    expect(r.late).toBe(1);
    expect(r.missed).toBe(1);
    expect(r.accuracyPct).toBe(33);
  });

  it("scales timing tolerance with tempo", () => {
    const fast = new Grader(notes, { bpm: 160 }); // beat 0.375s -> tolerance 0.15s
    fast.play(60, 0.2); // outside the window, pitch matches after it -> late
    expect(fast.result().late).toBe(1);
    const slow = new Grader(notes, { bpm: 60 }); // beat 1s -> tolerance 0.4s
    slow.play(60, 0.35); // inside the window -> hit
    expect(slow.result().hit).toBe(1);
  });

  it("rejects the expected note before its time window in wait mode", () => {
    const g = new Grader(notes, { waitMode: true });
    expect(g.currentWait?.midi).toBe(60);
    expect(g.play(60, -2)).toBe(false);
    expect(g.play(60, 0.05)).toBe(true);
  });

  it("accepts the correct pitch played after its window in wait mode", () => {
    const g = new Grader(notes, { waitMode: true });
    expect(g.currentWait?.midi).toBe(60);
    expect(g.play(60, 2.0)).toBe(true);
  });

  it("counts unplayed notes as missed in wait mode", () => {
    const g = new Grader(notes, { waitMode: true });
    const r = g.result();
    expect(r.missed).toBe(3);
    expect(r.accuracyPct).toBe(0);
  });
});

describe("detectPitch", () => {
  it("detects a 440 Hz sine", () => {
    const sr = 44100;
    const buf = new Float32Array(sr);
    for (let i = 0; i < sr; i++) buf[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    expect(detectPitch(buf, sr)).toBe(69);
  });
  it("returns null for silence", () => {
    expect(detectPitch(new Float32Array(44100), 44100)).toBeNull();
  });
});

describe("keyboard input", () => {
  it("maps keys to midi with octave shift", () => {
    const events: string[] = [];
    const ki = new KeyboardInput({
      onNoteOn: (m) => events.push(`on:${m}`),
      onNoteOff: (m) => events.push(`off:${m}`),
    });
    expect(KEYMAP["a"]).toBe(60);
    const down = { key: "a", type: "keydown", repeat: false, preventDefault: () => {} } as unknown as KeyboardEvent;
    ki.handleKey(down);
    ki.handleKey({ ...down, type: "keyup" } as unknown as KeyboardEvent);
    expect(events).toEqual(["on:60", "off:60"]);
  });
});

describe("midi input", () => {
  it("disconnect removes message handlers from connected inputs", async () => {
    const input = { onmidimessage: null } as { onmidimessage: ((e: unknown) => void) | null };
    const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { requestMIDIAccess: async () => ({ inputs: new Map([["in", input]]) }) },
      configurable: true,
      writable: true,
    });
    try {
      const mi = new MidiInput({ onNoteOn: () => {}, onNoteOff: () => {} });
      await mi.connect();
      expect(mi.connectedCount).toBe(1);
      mi.disconnect();
      expect(input.onmidimessage).toBeNull();
      expect(mi.connectedCount).toBe(0);
    } finally {
      if (real) Object.defineProperty(globalThis, "navigator", real);
    }
  });
});

describe("falling bars", () => {
  it("maps notes to bars within the time window", () => {
    const tn = resolveTimedNotes(song, 1, 0);
    const bars = fallingBars(tn, {
      width: 800,
      height: 400,
      nowSec: 0,
      speed: 1,
      lookaheadSec: 0.6,
      lowMidi: 36,
      highMidi: 84,
    });
    expect(bars.length).toBe(3); // notes at 0s (x2) and 0.5s visible
    expect(bars[0]!.color).toMatch(/^#/);
    expect(bars[0]!.x).toBeGreaterThanOrEqual(0);
  });

  it("falls downward toward the keyboard and carries pitch labels", () => {
    const tn = resolveTimedNotes(song, 1, 0);
    const bars = fallingBars(tn, {
      width: 800,
      height: 400,
      nowSec: 0,
      speed: 1,
      lookaheadSec: 0.6,
      lowMidi: 36,
      highMidi: 84,
    });
    // a future note's bottom edge (the leading edge) sits above the playhead
    const future = bars.find((b) => b.midi === 62)!;
    expect(future.y + future.height).toBeGreaterThan(0);
    expect(future.y + future.height).toBeLessThan(400);
    expect(future.label).toBe("D");
    // at the note's start time, its BOTTOM edge lands exactly on the playhead
    const atStart = fallingBars(tn, {
      width: 800,
      height: 400,
      nowSec: 0.5,
      speed: 1,
      lookaheadSec: 0.6,
      lowMidi: 36,
      highMidi: 84,
    });
    const landing = atStart.find((b) => b.midi === 62)!;
    expect(landing.y + landing.height).toBeCloseTo(400, 5);
    // as time approaches the note, it moves DOWN (y grows toward the keyboard)
    const later = fallingBars(tn, {
      width: 800,
      height: 400,
      nowSec: 0.25,
      speed: 1,
      lookaheadSec: 0.6,
      lowMidi: 36,
      highMidi: 84,
    });
    const laterFuture = later.find((b) => b.midi === 62)!;
    expect(laterFuture.y).toBeGreaterThan(future.y);
  });

  it("labels C keys with octave and sharps by name", () => {
    expect(noteLabel(60)).toBe("C4");
    expect(noteLabel(61)).toBe("C#");
    expect(noteLabel(69)).toBe("A");
  });

  it("flags keys for bars landing within the lookahead window", () => {
    const areaHeight = 400;
    const lookaheadSec = 2;
    const bars = [
      { midi: 60, y: 340, height: 10, x: 0, width: 10, color: "#fff", label: "C4" }, // 0.25s away
      { midi: 62, y: 140, height: 10, x: 0, width: 10, color: "#fff", label: "D" }, // 1.25s away
      { midi: 64, y: 399, height: 10, x: 0, width: 10, color: "#fff", label: "E" }, // already past
    ];
    expect([...upcomingMidi(bars, areaHeight, lookaheadSec)]).toEqual([60]);
  });
});

describe("prefs", () => {
  const mem = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  it("defaults and roundtrip", () => {
    expect(loadSettings().mode).toBe(DEFAULT_SETTINGS.mode);
    const p = { ...DEFAULT_SETTINGS, mode: "sheet" as const, transpose: 3 };
    saveSettings(p);
    expect(loadSettings().transpose).toBe(3);
  });
});
