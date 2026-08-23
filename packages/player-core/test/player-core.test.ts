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
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 0.25, name: "C", notes: [48, 52, 55] },
      { beat: 0.5, name: "C", notes: [48, 52, 55] },
      { beat: 2, name: "Dm", notes: [50, 53, 57] },
      { beat: 2.25, name: "Dm", notes: [50, 53, 57] },
      { beat: 4, name: "C", notes: [48, 52, 55] },
    ]).map((c) => c.name);
    expect(names).toEqual(["C", "Dm", "C"]);
  });

  it("keeps labeled power chords and drops unlabelable dyads", () => {
    const out = dedupeChords([
      { beat: 0, name: "C", notes: [36, 43] }, // C + G: re-labeled "C5"
      { beat: 1, name: "E", notes: [40, 44] }, // E + G#: root+third, no label -> dropped
      { beat: 2, name: "Cm", notes: [48, 51, 55] }, // full chord: kept
    ]);
    expect(out.map((c) => c.name)).toEqual(["C5", "Cm"]);
  });

  it("uses source authority and preserves the winning voicing metadata", () => {
    const out = dedupeChords([
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "generated" as const },
      {
        beat: 0,
        name: "C",
        notes: [48, 60, 64, 67],
        sourceKind: "authored" as const,
        durationBeats: 4,
        inferred: false,
      },
      { beat: 0, name: "C", notes: [60, 64, 67, 72], sourceKind: "inferred" as const, inferenceType: "voicing" as const },
    ]);
    expect(out).toEqual([expect.objectContaining({
      sourceKind: "authored",
      notes: [48, 60, 64, 67],
      durationBeats: 4,
      inferred: false,
    })]);
  });

  it("prefers compact generated voicings but richer authored voicings", () => {
    const generated = dedupeChords([
      { beat: 0, name: "C", notes: [48, 60, 64, 67], sourceKind: "generated" as const },
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "generated" as const },
    ]);
    const authored = dedupeChords([
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "authored" as const },
      { beat: 0, name: "C", notes: [48, 60, 64, 67], sourceKind: "authored" as const },
    ]);
    expect(generated[0]!.notes).toEqual([60, 64, 67]);
    expect(authored[0]!.notes).toEqual([48, 60, 64, 67]);
  });

  it("compacts reordered/octave-doubled runs but keeps inversion changes", () => {
    const out = dedupeChords([
      { beat: 0, name: "C", notes: [67, 60, 64], sourceKind: "generated" as const },
      { beat: 0.25, name: "C", notes: [72, 64, 60, 67], sourceKind: "generated" as const },
      { beat: 1, name: "C/E", notes: [64, 67, 72], sourceKind: "generated" as const },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.notes).toEqual([67, 60, 64]);
    expect(out[1]!.notes).toEqual([64, 67, 72]);
  });

  it("assigns compacted generated chords their next-onset span", () => {
    const out = dedupeChords([
      { beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "generated" as const },
      { beat: 0.25, name: "C", notes: [48, 52, 55], sourceKind: "generated" as const },
      { beat: 0.5, name: "C", notes: [48, 52, 55], sourceKind: "generated" as const },
      // The missing beats are a real gap in the source timeline. The C run
      // should still end at the next harmonic onset, not at a fixed 1 beat.
      { beat: 3.5, name: "G", notes: [43, 47, 50], sourceKind: "generated" as const },
    ]);
    expect(out.map(({ beat, durationBeats }) => ({ beat, durationBeats }))).toEqual([
      { beat: 0, durationBeats: 3.5 },
      { beat: 3.5, durationBeats: 1 },
    ]);
  });

  it("preserves explicit authored and inferred durations", () => {
    const authored = dedupeChords([
      { beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "authored" as const, durationBeats: 0.5 },
      { beat: 4, name: "G", notes: [43, 47, 50], sourceKind: "authored" as const, durationBeats: 2 },
    ]);
    const inferred = dedupeChords([
      { beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "inferred" as const, inferenceType: "voicing" as const, durationBeats: 0.75 },
      { beat: 4, name: "G", notes: [43, 47, 50], sourceKind: "inferred" as const, inferenceType: "voicing" as const, durationBeats: 2 },
    ]);
    expect(authored.map((event) => event.durationBeats)).toEqual([0.5, 2]);
    expect(inferred.map((event) => event.durationBeats)).toEqual([0.75, 2]);
  });

  it("is idempotent when a short middle run is removed", () => {
    const input = [
      { beat: 0.5, name: "F", notes: [41, 45, 48], sourceKind: "unknown" as const, durationBeats: 2 },
      { beat: 1, name: "C", notes: [48, 52, 55] },
      { beat: 1.5, name: "G", notes: [43, 47, 50], sourceKind: "generated" as const, inferred: true },
      { beat: 1.75, name: "F", notes: [41, 45, 48] },
    ];
    const once = dedupeChords(input);
    expect(once).toEqual([
      { beat: 0.5, name: "F", notes: [41, 45, 48], sourceKind: "unknown", durationBeats: 1 },
    ]);
    expect(dedupeChords(once)).toEqual(once);
  });

  it("is permutation-stable and only classifies unknown provenance with context", () => {
    const events = [
      { beat: 0, name: "C", notes: [60, 64, 67], sourceKind: "generated" as const },
      { beat: 0, name: "C", notes: [48, 60, 64, 67], sourceKind: "unknown" as const },
      { beat: 1, name: "G", notes: [55, 59, 62], sourceKind: "generated" as const },
    ];
    const forward = dedupeChords(events);
    const reverse = dedupeChords([...events].reverse());
    expect(reverse).toEqual(forward);
    expect(forward[0]!.sourceKind).toBe("generated");

    const authored = dedupeChords(events, { unknownSourceKind: "authored" });
    expect(authored[0]!.sourceKind).toBe("unknown");
    expect(authored[0]!.notes).toEqual([48, 60, 64, 67]);
  });

  it("accents downbeats with a velocity curve", () => {
    const tn = resolveTimedNotes({ ...song, notes: [{ midi: 60, start: 0, dur: 1, vel: 100, hand: "R" as const }] }, 1, 0);
    expect(tn[0]!.vel).toBe(115);
    const off = resolveTimedNotes({ ...song, notes: [{ midi: 60, start: 0.25, dur: 1, vel: 100, hand: "R" as const }] }, 1, 0);
    expect(off[0]!.vel).toBe(80);
  });

  it("passes real velocities through when source dynamics vary", () => {
    const tn = resolveTimedNotes(
      {
        ...song,
        notes: [
          { midi: 60, start: 0, dur: 1, vel: 40, hand: "R" as const },
          { midi: 62, start: 0.25, dur: 1, vel: 100, hand: "R" as const },
        ],
      },
      1,
      0,
    );
    expect(tn[0]!.vel).toBe(40); // downbeat, but no synthetic accent
    expect(tn[1]!.vel).toBe(100);
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

  it("expands wide measures so edge notes remain visible and keeps the previous range when empty", () => {
    const wide = tn.map((n, i) => ({ ...n, midi: 30 + ((i * 20) % 70) }));
    const r = measureMidiRange(wide, song.measures, 120, 1, 0, { lowMidi: 22, highMidi: 109 });
    expect(r.lowMidi).toBeLessThanOrEqual(30);
    expect(r.highMidi).toBeGreaterThanOrEqual(90);
    expect(r.highMidi - r.lowMidi).toBeLessThanOrEqual(87);
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

  it("accepts the expected note immediately in wait mode (transport paused)", () => {
    const g = new Grader(notes, { waitMode: true });
    expect(g.currentWait?.midi).toBe(60);
    // Wait mode pauses transport, so temporal gating is meaningless here.
    expect(g.play(60, -2)).toBe(true);
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

  it("counts remaining notes when a non-wait run ends early", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    const r = g.result();
    expect(r.hit).toBe(1);
    expect(r.missed).toBe(2);
    expect(r.total).toBe(3);
    expect(r.accuracyPct).toBe(33);
  });

  it("switches wait mode for an existing run", () => {
    const g = new Grader(notes);
    g.play(60, 0.05);
    g.setWaitMode(true);
    expect(g.currentWait?.midi).toBe(62);
    expect(g.play(64, 0.5)).toBe(false);
    expect(g.play(62, 0.5)).toBe(true);
    expect(g.currentWait?.midi).toBe(64);
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
    // The rescan guard checks "onmidimessage" in input, so the mock must
    // declare the property for the handler to attach.
    const input = { onmidimessage: null } as { id?: string; onmidimessage: ((e: unknown) => void) | null };
    input.id = "in";
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

  it("keeps notes at both edges of a wide keyboard range", () => {
    const wide = [
      { midi: 24, startSec: 0, durSec: 0.5, vel: 80 },
      { midi: 96, startSec: 0, durSec: 0.5, vel: 80 },
    ];
    const bars = fallingBars(wide, {
      width: 800,
      height: 400,
      nowSec: 0,
      speed: 1,
      lookaheadSec: 0.6,
      lowMidi: 21,
      highMidi: 108,
    });
    expect(bars.map((bar) => bar.midi)).toEqual([24, 96]);
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
