import { describe, expect, it } from "vitest";
import { PlaybackEngine, type AudioLike } from "./engine.js";
import { DEFAULT_SETTINGS } from "./prefs.js";
import type { TimedNote } from "./timeline.js";

/** Minimal chord shape matching the engine's ChordPlaybackLabel. */
interface TestChord {
  beat: number;
  name: string;
  notes: number[];
  sourceKind?: "generated";
  durationBeats?: number;
}

class ChordAudio implements AudioLike {
  chords: number[][] = [];
  clicks: Array<{ beat: number; when: number }> = [];
  cancelled = 0;
  ensure() { return {}; }
  noteOn() {}
  noteOff() {}
  metronomeClick(beat: number, when = 0) { this.clicks.push({ beat, when }); }
  cancelAll() { this.cancelled++; }
  setGains() {}
  dispose() {}
  sustainPedal = false;
  playChord(notes: number[]) { this.chords.push([...notes]); }
}

const META = { tempoBpm: 120, timeSig: [4, 4] as [number, number] };
const BEAT = 0.5; // 60/120

function ch(beat: number, name: string, notes: number[], dur = 2): TestChord {
  return { beat, name, notes, sourceKind: "generated", durationBeats: dur };
}

function makeEngine(audio: ChordAudio, chords: TestChord[], loopEnd: number, dur = 8) {
  return new PlaybackEngine(audio, [], dur * BEAT, META, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, chords);
}

describe("F03: chord cursor resets on loop wrap", () => {
  it("dt>0.5 wraps within loop instead of jumping past it", () => {
    const a = new ChordAudio();
    const e = makeEngine(a, [ch(0, "C", [60])], 1);
    e.setLoop({ startSec: 0, endSec: 1 * BEAT });
    e.start();
    e.tick(0.3);
    e.tick(0.8); // dt>0.5 with 0.5s loop
    expect(e.time).toBeLessThanOrEqual(0.5 + 0.01);
    e.stop();
  });

  it("seek resets chord cursor so active chord resounds", () => {
    const a = new ChordAudio();
    const e = makeEngine(a, [ch(0, "C", [60]), ch(2, "G", [55])], 4);
    e.setLoop({ startSec: 0, endSec: 4 * BEAT });
    e.start();
    e.tick(1.5);
    a.chords.length = 0;
    e.seek(0);
    expect(a.chords.length).toBeGreaterThanOrEqual(1);
    e.stop();
  });

  it("normal loop wrap resets chord cursor (dt <= 0.5)", () => {
    const a = new ChordAudio();
    const e = makeEngine(a, [ch(0, "C", [60], 4)], 1);
    e.setLoop({ startSec: 0, endSec: 1 * BEAT });
    e.start();
    e.tick(0.3);
    const beforeWrap = a.chords.length;
    e.tick(0.3); // 0.6 > 0.5 loop end, wraps to startSec
    expect(a.chords.length).toBeGreaterThan(beforeWrap);
    expect(e.time).toBeLessThanOrEqual(0.01);
    e.stop();
  });
  it("stops at the end after a long frame and rejects zero-length loops", () => {
    const e = makeEngine(new ChordAudio(), [], 1, 2);
    e.start(); e.tick(10);
    expect(e.playing).toBe(false);
    expect(e.time).toBe(0);
    expect(() => e.setLoop({ startSec: 1, endSec: 1 })).toThrow(/loop/);
  });

  it("schedules fractional stored measure starts as downbeats", () => {
    const audio = new ChordAudio();
    const engine = new PlaybackEngine(
      audio,
      [],
      2,
      { tempoBpm: 120, timeSig: [6, 8], measureStarts: [0, 1.5, 4] },
      { ...DEFAULT_SETTINGS, metronome: true, backgroundMode: "piano" },
    );
    engine.start();
    audio.clicks.length = 0;
    engine.seek(0.7);
    expect(audio.clicks).toHaveLength(1);
    expect(audio.clicks[0]?.beat).toBe(0);
    expect(audio.clicks[0]?.when).toBeCloseTo(0.05, 6);
  });

  it("clicks the metronome with playable chord backing", () => {
    const audio = new ChordAudio();
    const engine = new PlaybackEngine(
      audio, [], 2, META,
      { ...DEFAULT_SETTINGS, metronome: true, backgroundMode: "chord" },
      [ch(0, "C", [48, 64, 67], 4)],
    );
    engine.start();
    expect(audio.chords).toHaveLength(1);
    expect(audio.clicks).toEqual([{ beat: 0, when: 0 }]);
  });

  it("waits for every simultaneous chord tone before moving to the next attack", () => {
    const audio = new ChordAudio();
    const targets: TimedNote[] = [60, 64, 67].map((midi) => ({ midi, startSec: 0.5, durSec: 2, vel: 80, hand: "R" }));
    targets.push({ midi: 65, startSec: 2, durSec: 0.5, vel: 80, hand: "R" });
    const engine = new PlaybackEngine(
      audio, [], 4, META, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, [], targets,
    );
    engine.startGrading(true, { startSec: 0, endSec: 3 });

    expect(engine.handleNoteOn(60)).toBe(true);
    expect(engine.time).toBeCloseTo(0.5);
    expect(engine.waitNote?.midi).toBe(64);
    expect(engine.waitNotes.map((note) => note.midi)).toEqual([64, 67]);
    expect(engine.handleNoteOn(64)).toBe(true);
    expect(engine.time).toBeCloseTo(0.5);
    expect(engine.handleNoteOn(67)).toBe(true);
    expect(engine.time).toBeCloseTo(2);
    expect(engine.waitNote?.midi).toBe(65);
    expect(engine.handleNoteOn(65)).toBe(true);
    expect(engine.gradeResult?.hit).toBe(4);
    expect(engine.gradeResult?.missed).toBe(0);
  });

});
