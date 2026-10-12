import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeMidi, writeMusicXml, type Variant } from "@keyspilli/midi";
import {
  DEFAULT_SETTINGS, PlaybackEngine, loadSettings, loadSongPrefs, playbackTiming, resolveTimedNotes,
  type AudioLike, type EngineSongMeta, type PlayerSettings, type SongData, type TimedNote,
} from "@keyspilli/player-core";
import { playerPracticeTiming, practicePulseDraft, resolvePlayerPracticePulse, startPracticeWithPulse } from "./player-practice-pulse";
import type { PracticeSetup } from "./PracticeSetupDialog";

const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

class BoundaryAudio implements AudioLike {
  clicks: Array<{ at: number; accent: string }> = [];
  ensured = 0;
  clock = () => 0;
  ensure() { this.ensured++; }
  noteOn() {}
  noteOff() {}
  metronomeClick(beat: number, when = 0, accent?: "group") { this.clicks.push({ at: Number((this.clock() + when).toFixed(8)), accent: beat === 0 ? "bar" : accent ?? "pulse" }); }
  cancelAll() {}
  setGains() {}
  dispose() {}
  sustainPedal = false;
}

const song: SongData = {
  tempoBpm: 120, timeSig: [5, 8], key: "C", chords: [],
  notes: [{ midi: 60, start: 0, dur: .5, vel: 44 }, { midi: 64, start: 3, dur: .5, vel: 103 }],
  measures: [{ index: 0, startBeat: 0, endBeat: 3 }, { index: 1, startBeat: 3, endBeat: 5.5 }],
  timeSigEvents: [{ beat: 0, tick: 0, timeSig: [6, 8] }, { beat: 3, tick: 1440, timeSig: [5, 8] }],
  sourceTiming: { timeSig: [5, 8], measureStartBeat: 0, provenance: "source-measure-boundary", sourceFingerprint: "authored-fixture", timeSigEvents: [{ beat: 0, timeSig: [6, 8] }, { beat: 3, timeSig: [5, 8] }] },
};
const timing = playerPracticeTiming(song, song.measures, playbackTiming(song));
const selectedPulse = practicePulseDraft("eighth", [{ timeSig: [6, 8], text: "3 + 3" }, { timeSig: [5, 8], text: "2+3" }]).settings!;
const setup: PracticeSetup = { input: "keyboard", wait: false, scope: "beginning", countInBeats: 0, metronome: true, practicePulse: selectedPulse };

function make(settings: PlayerSettings = DEFAULT_SETTINGS, meta = timing, notes: TimedNote[] = resolveTimedNotes(song, 1, 0)) {
  const audio = new BoundaryAudio();
  const engine = new PlaybackEngine(audio, notes, 8, meta, settings);
  audio.clock = () => engine.time;
  return { engine, audio };
}
function play(engine: PlaybackEngine) {
  engine.start(); for (let frame = 1; frame * .025 < engine.duration; frame++) engine.tick(.025); engine.stop();
}

describe("Player practice startup and reload use the actual engine", () => {
  it("propagates meter events, source extent and verified pickup phase without changing navigation", () => {
    expect(timing.timeSigEvents).toEqual([{ beat: 0, timeSig: [6, 8] }, { beat: 3, timeSig: [5, 8] }]);
    expect(timing.endBeat).toBe(5.5);
    const pickup: SongData = { ...song, timeSig: [6, 8], timeSigEvents: undefined, measures: [{ index: 0, startBeat: 0, endBeat: .5 }, { index: 1, startBeat: .5, endBeat: 3.5 }],
      sourceTiming: { timeSig: [6, 8], measureStartBeat: -2.5, provenance: "source-measure-boundary", sourceFingerprint: "authored-pickup" } };
    const validated = playbackTiming(pickup);
    expect(validated).toBeDefined();
    const pickupTiming = playerPracticeTiming(pickup, pickup.measures, validated);
    expect(pickupTiming.measureStarts).toEqual([0, .5]); expect(pickupTiming.measureStartBeat).toBe(-2.5);
    expect(playerPracticeTiming(pickup, pickup.measures, undefined).measureStartBeat).toBeUndefined();
  });

  it("installs the selected clicks before practice, preserves export bytes, and reloads only this song's choice", () => {
    const variant: Variant = { ...song, level: "advanced", difficultyScore: 0, bassPattern: "source" };
    const midiBefore = writeMidi(song.notes, { tempoBpm: song.tempoBpm, timeSig: song.timeSig, timeSigEvents: song.timeSigEvents });
    const xmlBefore = writeMusicXml(variant, "Synthetic practice", "Keyspilli");
    const sourceBefore = JSON.stringify(song);
    const { engine, audio } = make();
    const next = startPracticeWithPulse(engine, DEFAULT_SETTINGS, "meter-song", timing, setup, { startSec: 0, endSec: 2.75 });
    expect(engine.settings.practicePulse).toEqual(selectedPulse); expect(engine.grader).not.toBeNull();
    engine.start(); expect(audio.clicks[0]).toEqual({ at: 0, accent: "bar" });
    engine.finishGrading(); engine.seek(0); audio.clicks = []; play(engine);
    expect(audio.clicks).toHaveLength(11);
    expect(audio.clicks.filter(click => click.accent !== "pulse")).toEqual([
      { at: 0, accent: "bar" }, { at: .75, accent: "group" }, { at: 1.5, accent: "bar" }, { at: 2, accent: "group" },
    ]);
    expect(audio.clicks.every(click => click.at < 2.75)).toBe(true); // no eight-second transport padding clicks
    const restored = { ...loadSettings(), ...loadSongPrefs("meter-song") };
    expect(restored.practicePulse).toEqual(next.practicePulse);
    const reload = make(restored); play(reload.engine); expect(reload.audio.clicks).toEqual(audio.clicks);
    expect(loadSongPrefs("different-song").practicePulse).toBeUndefined(); expect(loadSettings().practicePulse).toBeUndefined();
    expect(JSON.stringify(song)).toBe(sourceBefore);
    expect(writeMidi(song.notes, { tempoBpm: song.tempoBpm, timeSig: song.timeSig, timeSigEvents: song.timeSigEvents })).toEqual(midiBefore);
    expect(writeMusicXml(variant, "Synthetic practice", "Keyspilli")).toBe(xmlBefore);
  });

  it("recovers visibly to ordinary clicks when saved grouping no longer fits the current source", () => {
    const stale = { ...DEFAULT_SETTINGS, metronome: true, practicePulse: { pulse: "eighth" as const, beatGroups: [{ timeSig: [7, 8] as const, groups: [2, 2, 3] }] } };
    const recovered = resolvePlayerPracticePulse(stale, timing);
    expect(recovered.settings.practicePulse).toBeUndefined();
    expect(recovered.notice).toMatch(/Default quarter-note clicks.*7\/8.*Set up practice/);
    const fixture = make(recovered.settings); expect(() => play(fixture.engine)).not.toThrow();
    expect(fixture.audio.clicks.some(click => click.accent === "group")).toBe(false);
  });

  it("uses the Player's incoming timeline clock while speed changes preserve musical position", () => {
    const { engine, audio } = make({ ...DEFAULT_SETTINGS, metronome: true, practicePulse: selectedPulse });
    engine.seek(.6); engine.start();
    const changeSpeed = (speed: number) => {
      const position = engine.time * engine.settings.speed / speed;
      engine.stop();
      const duration = Math.max(8, timing.endBeat! * 60 / timing.tempoBpm / speed);
      engine.setSettings({ ...engine.settings, speed }, timing, duration);
      engine.setTimeline(resolveTimedNotes(song, speed, 0), duration, []);
      engine.seek(position); audio.clicks = []; engine.start();
    };
    changeSpeed(.5); expect(engine.time).toBeCloseTo(1.2);
    engine.tick(.2); expect(audio.clicks).toEqual([{ at: 1.5, accent: "group" }]);
    changeSpeed(2); expect(engine.time).toBeCloseTo(.35);
    expect(audio.clicks).toEqual([{ at: .375, accent: "group" }]);
  });

  it("rejects unsupported source alignment without changing engine settings or saving a choice", () => {
    const unsupported: EngineSongMeta = { ...timing, measureStarts: [0, 2.5, 5] };
    const { engine, audio } = make(DEFAULT_SETTINGS, unsupported);
    expect(() => startPracticeWithPulse(engine, DEFAULT_SETTINGS, "unsupported", unsupported, setup, { startSec: 0, endSec: 2 })).toThrow(/align/);
    expect(engine.settings).toBe(DEFAULT_SETTINGS); expect(audio.ensured).toBe(0); expect(stored.size).toBe(0);
  });

  it("restores the previous setting if grading cannot start and does not persist the attempted choice", () => {
    const { engine, audio } = make(DEFAULT_SETTINGS, timing, []);
    expect(() => startPracticeWithPulse(engine, DEFAULT_SETTINGS, "no-targets", timing, setup, { startSec: 0, endSec: 2 })).toThrow(/No playable notes/);
    expect(engine.settings).toBe(DEFAULT_SETTINGS); expect(audio.ensured).toBe(0); expect(stored.size).toBe(0);
  });

  it("keeps default preference bytes unchanged when the user starts without a pulse choice", () => {
    stored.set("keyspilli.prefs.v1", JSON.stringify(DEFAULT_SETTINGS));
    const before = [...stored.entries()];
    const { engine } = make();
    const next = startPracticeWithPulse(engine, DEFAULT_SETTINGS, "ordinary", timing,
      { input: "keyboard", wait: false, scope: "beginning", countInBeats: 0 }, { startSec: 0, endSec: 2 });
    expect(JSON.stringify(next)).toBe(JSON.stringify(DEFAULT_SETTINGS));
    expect([...stored.entries()]).toEqual(before);
  });
});

describe("practice grouping form boundary", () => {
  it.each(["2++3", "2.5+2.5", "-1+6", "2e0+3", "2+3+", "1+".repeat(81)])("rejects a malformed grouping draft: %s", text => {
    const result = practicePulseDraft("eighth", [{ timeSig: [5, 8], text }]);
    expect(result.settings).toBeUndefined(); expect(result.error).toMatch(/whole numbers/);
  });
  it("allows a blank grouping and explicitly returning to unchanged default clicks", () => {
    expect(practicePulseDraft("dotted-quarter", [{ timeSig: [6, 8], text: "" }])).toEqual({ settings: { pulse: "dotted-quarter" }, error: null });
    expect(practicePulseDraft("default", [{ timeSig: [5, 8], text: "2++3" }])).toEqual({ settings: undefined, error: null });
  });
});
