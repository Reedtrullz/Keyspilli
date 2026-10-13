import { describe, expect, it } from "vitest";
import { PlaybackEngine, type AudioLike, type EngineSongMeta } from "../src/engine.js";
import { DEFAULT_SETTINGS } from "../src/prefs.js";
import { resolveTimedNotes, type TimedNote } from "../src/timeline.js";
import type { PlayerSettings, SongData } from "../src/types.js";
import type { PracticePulseSettings } from "../src/practice-pulse.js";

type Click = { at: number; accent: "bar" | "group" | "pulse" };
class PulseAudio implements AudioLike {
  clicks: Click[] = [];
  notes: TimedNote[] = [];
  cancelled = 0;
  ensured = 0;
  clock = () => 0;
  ensure() { this.ensured++; }
  noteOn(note: TimedNote) { this.notes.push(note); }
  noteOff() {}
  metronomeClick(beat: number, when = 0, accent?: "group") {
    this.clicks.push({ at: Number((this.clock() + when).toFixed(9)), accent: beat === 0 ? "bar" : accent ?? "pulse" });
  }
  cancelAll() { this.cancelled++; }
  setGains() {}
  dispose() {}
  sustainPedal = false;
}

const fraction = (n: number, d = 8): [number, number] => [n, d];
const groups = (n: number, pattern: number[]) => ({ timeSig: fraction(n), groups: pattern });
const explicit = (pulse: PracticePulseSettings["pulse"], beatGroups?: PracticePulseSettings["beatGroups"]): PracticePulseSettings => ({ pulse, ...(beatGroups ? { beatGroups } : {}) });
const meta = (n: number, measureStarts: number[], rest: Partial<EngineSongMeta> = {}): EngineSongMeta => ({ tempoBpm: 120, timeSig: fraction(n), measureStarts, ...rest });

function make(timing: EngineSongMeta, pulse: PracticePulseSettings | undefined, durationBeats: number, speed = 1, notes: TimedNote[] = []) {
  const audio = new PulseAudio();
  const settings = { ...DEFAULT_SETTINGS, metronome: true, speed, ...(pulse ? { practicePulse: pulse } : {}) } as PlayerSettings;
  const engine = new PlaybackEngine(audio, notes, durationBeats * 60 / timing.tempoBpm / speed, timing, settings);
  audio.clock = () => engine.time;
  return { engine, audio };
}

function run(timing: EngineSongMeta, pulse: PracticePulseSettings | undefined, durationBeats: number, speed = 1) {
  const fixture = make(timing, pulse, durationBeats, speed);
  fixture.engine.start();
  for (let frame = 1; frame * .025 < fixture.engine.duration; frame++) fixture.engine.tick(.025);
  fixture.engine.stop();
  return fixture.audio.clicks;
}

function inBeats(clicks: Click[], speed = 1) {
  return clicks.map(click => [Number((click.at * 2 * speed).toFixed(7)), click.accent]);
}

describe("explicit practice pulse at the actual scheduler boundary", () => {
  it("keeps omitted settings and the existing 6/8 quarter clicks unchanged", () => {
    expect(inBeats(run(meta(6, [0, 3]), undefined, 6))).toEqual([
      [0, "bar"], [1, "pulse"], [2, "pulse"], [3, "bar"], [4, "pulse"], [5, "pulse"],
    ]);
    expect(Object.hasOwn(DEFAULT_SETTINGS, "practicePulse")).toBe(false);
  });

  it("does not change the legacy clock or accents when optional practice timing is refreshed", () => {
    const { engine, audio } = make(meta(6, [0, 3]), undefined, 6);
    engine.setSongTiming(meta(5, [0, 2.5, 5]));
    engine.start(); for (let frame = 1; frame * .025 < engine.duration; frame++) engine.tick(.025);
    expect(inBeats(audio.clicks)).toEqual([[0, "bar"], [1, "pulse"], [2, "pulse"], [3, "bar"], [4, "pulse"], [5, "pulse"]]);
  });

  it.each([6, 9])("uses only an explicit dotted-quarter choice and grouping in %s/8", numerator => {
    const width = numerator / 2;
    const pattern = Array(numerator / 3).fill(3) as number[];
    const clicks = inBeats(run(meta(numerator, [0, width]), explicit("dotted-quarter", [groups(numerator, pattern)]), width * 2));
    expect(clicks).toEqual(Array.from({ length: numerator / 3 * 2 }, (_, index) => [index * 1.5, index % (numerator / 3) === 0 ? "bar" : "group"]));
    const withoutGroups = inBeats(run(meta(numerator, [0, width]), explicit("eighth"), width));
    expect(withoutGroups.filter(([, accent]) => accent === "group")).toEqual([]);
  });

  it.each([
    [5, [2, 3], [0, 1]],
    [7, [2, 2, 3], [0, 1, 2]],
  ] as const)("schedules the declared additive grouping in %s/8", (numerator, pattern, accents) => {
    const width = numerator / 2;
    expect(inBeats(run(meta(numerator, [0, width]), explicit("eighth", [groups(numerator, [...pattern])]), width * 2))).toEqual(
      Array.from({ length: numerator * 2 }, (_, index) => {
        const at = index / 2, position = at % width;
        return [at, position === 0 ? "bar" : (accents as readonly number[]).includes(position) ? "group" : "pulse"];
      }),
    );
  });

  it("sounds declared group boundaries between quarter pulses once, with bar precedence", () => {
    expect(inBeats(run(meta(5, [0, 2.5]), explicit("quarter", [groups(5, [1, 4])]), 5))).toEqual([
      [0, "bar"], [.5, "group"], [1, "pulse"], [2, "pulse"],
      [2.5, "bar"], [3, "group"], [3.5, "pulse"], [4.5, "pulse"],
    ]);
  });

  it("changes meter and explicit grouping at the declared displayed bars", () => {
    const timing = meta(7, [0, 3, 5.5], { timeSigEvents: [
      { beat: 0, timeSig: fraction(6) }, { beat: 3, timeSig: fraction(5) }, { beat: 5.5, timeSig: fraction(7) },
    ] } as Partial<EngineSongMeta>);
    const clicks = inBeats(run(timing, explicit("eighth", [groups(6, [3, 3]), groups(5, [2, 3]), groups(7, [2, 2, 3])]), 9));
    expect(clicks.map(([at]) => at)).toEqual(Array.from({ length: 18 }, (_, index) => index / 2));
    expect(clicks.filter(([, accent]) => accent !== "pulse")).toEqual([
      [0, "bar"], [1.5, "group"], [3, "bar"], [4, "group"], [5.5, "bar"], [6.5, "group"], [7.5, "group"],
    ]);
  });

  it("clips a verified pickup without restarting the group at zero", () => {
    const timing = meta(6, [0, .5, 3.5], { measureStartBeat: -2.5 } as Partial<EngineSongMeta>);
    const clicks = inBeats(run(timing, explicit("eighth", [groups(6, [3, 3])]), 6.5));
    expect(clicks[0]).toEqual([0, "pulse"]);
    expect(clicks.filter(([, accent]) => accent !== "pulse")).toEqual([[.5, "bar"], [2, "group"], [3.5, "bar"], [5, "group"]]);
  });

  it.each([.5, 1, 2])("scales scheduled offsets once at speed %s", speed => {
    const clicks = run(meta(6, [0, 3]), explicit("dotted-quarter", [groups(6, [3, 3])]), 6, speed);
    expect(clicks).toEqual([
      { at: 0, accent: "bar" }, { at: .75 / speed, accent: "group" },
      { at: 1.5 / speed, accent: "bar" }, { at: 2.25 / speed, accent: "group" },
    ]);
  });

  it("seeks onto the source pulse grid and clips every loop end before rescheduling its start", () => {
    const { engine, audio } = make(meta(6, [0, 3]), explicit("dotted-quarter", [groups(6, [3, 3])]), 6);
    engine.seek(.7); engine.start();
    expect(audio.clicks).toEqual([{ at: .75, accent: "group" }]);
    engine.stop(); audio.clicks = [];
    engine.setLoop({ startSec: .75, endSec: 1.5 }); engine.seek(.75); engine.start();
    engine.tick(.5); engine.tick(.25);
    expect(audio.clicks).toEqual([{ at: .75, accent: "group" }, { at: .75, accent: "group" }]);
    expect(audio.cancelled).toBeGreaterThan(0);
  });

  it("cancels an old click horizon when an explicit setting changes during playback", () => {
    const { engine, audio } = make(meta(6, [0, 3]), explicit("eighth"), 6);
    engine.start(); engine.seek(.7);
    const cancelled = audio.cancelled;
    engine.setSettings({ ...engine.settings, practicePulse: explicit("quarter") } as PlayerSettings);
    expect(audio.cancelled).toBe(cancelled + 1);
    audio.clicks = []; engine.tick(0);
    expect(audio.clicks).toEqual([]);
    engine.tick(.2);
    expect(audio.clicks).toEqual([{ at: 1, accent: "pulse" }]);
  });

  it("installs changed meter metadata on the existing engine and rejects an invalid update atomically", () => {
    const { engine, audio } = make(meta(6, [0, 3]), explicit("eighth"), 6);
    engine.seek(1.2); engine.start(); audio.clicks = [];
    engine.setSongTiming(meta(5, [0, 2.5, 5])); engine.tick(0);
    expect(audio.clicks).toEqual([{ at: 1.25, accent: "bar" }]);
    expect(() => engine.setSongTiming(meta(7, [0, 2.5, 5]))).toThrow(/align/);
    audio.clicks = []; engine.seek(1.2);
    expect(audio.clicks).toEqual([{ at: 1.25, accent: "bar" }]);
  });

  it("keeps half-open scheduler windows free of duplicate or lost clicks at a fractional clock", () => {
    const speed = .7, tempoBpm = 137;
    const clicks = run(meta(6, [0, 3], { tempoBpm }), explicit("eighth", [groups(6, [3, 3])]), 6, speed);
    expect(clicks.map(click => Number((click.at * tempoBpm * speed / 60).toFixed(6)))).toEqual(Array.from({ length: 12 }, (_, index) => index / 2));
  });

  it("retains source note timings, velocities and input bytes", () => {
    const source: SongData = { tempoBpm: 120, timeSig: [6, 8], key: "C", chords: [], measures: [{ index: 0, startBeat: 0, endBeat: 3 }], notes: [
      { midi: 60, start: 0, dur: .5, vel: 44 }, { midi: 62, start: 1.5, dur: .5, vel: 103 },
    ] };
    const before = JSON.stringify(source), notes = resolveTimedNotes(source, 1, 0);
    const { engine, audio } = make(meta(6, [0]), explicit("eighth", [groups(6, [3, 3])]), 3, 1, notes);
    engine.start(); for (let frame = 0; frame < 50; frame++) engine.tick(.025);
    expect(audio.notes).toEqual(notes);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("explicit practice boundaries", () => {
  const invalid: unknown[] = [
    { pulse: "automatic" }, { pulse: "eighth", beatGroups: "3+3" },
    { pulse: "eighth", beatGroups: [groups(6, [3, 2])] },
    { pulse: "eighth", beatGroups: [groups(6, [3, 0, 3])] },
    { pulse: "eighth", beatGroups: [groups(6, [1.5, 4.5])] },
    { pulse: "eighth", beatGroups: [groups(6, Object.assign(Array(2), { 1: 6 }))] },
    { pulse: "eighth", beatGroups: [groups(6, [3, 3]), groups(6, [2, 2, 2])] },
    { pulse: "eighth", beatGroups: [groups(6, Array(33).fill(1))] },
    { pulse: "eighth", beatGroups: Array(33).fill(groups(6, [3, 3])) },
    { pulse: "eighth", beatGroups: [{ timeSig: [6, 7], groups: [3, 3] }] },
    { pulse: "eighth", beatGroups: [{ timeSig: [33, 8], groups: [33] }] },
    { pulse: "eighth", guessedSwing: true },
  ];
  it.each(invalid)("rejects malformed explicit settings before audio starts: %j", candidate => {
    const audio = new PulseAudio();
    expect(() => new PlaybackEngine(audio, [], 3, meta(6, [0, 3]), { ...DEFAULT_SETTINGS, practicePulse: candidate } as PlayerSettings)).toThrow(/practice|pulse|group/i);
    expect(audio.ensured).toBe(0);
  });

  it("rejects a setting change atomically, without discarding the active valid choice", () => {
    const { engine, audio } = make(meta(6, [0, 3]), explicit("eighth"), 6);
    const before = engine.settings;
    expect(() => engine.setSettings({ ...before, practicePulse: { pulse: "eighth", beatGroups: [groups(6, [3, 2])] } } as PlayerSettings)).toThrow(/group/i);
    expect(engine.settings).toBe(before); expect(audio.cancelled).toBe(0);
  });

  it.each([NaN, Infinity, -1, 0, 10_000])("rejects invalid explicit duration %s before scheduling", duration => {
    const audio = new PulseAudio();
    expect(() => new PlaybackEngine(audio, [], duration, meta(6, [0]), { ...DEFAULT_SETTINGS, practicePulse: explicit("eighth") } as PlayerSettings)).toThrow(/duration|timing/i);
    expect(audio.ensured).toBe(0);
  });

  it("rejects meter events between displayed bar starts and gives a useful boundary error", () => {
    const timing = meta(5, [0, 2.5, 5], { timeSigEvents: [
      { beat: 0, timeSig: fraction(6) }, { beat: 3, timeSig: fraction(5) },
    ] } as Partial<EngineSongMeta>);
    expect(() => make(timing, explicit("eighth", [groups(6, [3, 3])]), 7.5)).toThrow(/bar|align/i);
    expect(() => make(timing, undefined, 7.5)).not.toThrow();
  });
});
