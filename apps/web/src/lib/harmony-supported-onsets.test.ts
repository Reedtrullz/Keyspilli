import { describe, expect, it } from "vitest";
import { inferHarmonyTimeline, type Note } from "@keyspilli/midi";
import { DEFAULT_SETTINGS, PlaybackEngine, resolveAccompaniment, type AudioLike, type SongData } from "@keyspilli/player-core";
import { replayChordsBacking } from "../components/player/chords-backing";
import { activeExportVariant, type ActiveExportSelection } from "../components/player/active-arrangement-export";
import { evaluateHarmonyPilotCase, replayHarmonyPolicy, type HarmonyPilotCase } from "./harmony-pilot-evaluation";

const note = (midi: number, start: number, end = 4, extra: Partial<Note> = {}): Note => ({ midi, start, dur: end - start, vel: 80, hand: "L", ...extra });
const song = (notes: Note[], end = 4): SongData => ({ notes, chords: [], key: "C", tempoBpm: 60, timeSig: [4, 4], measures: [{ index: 0, startBeat: 0, endBeat: end }] });
const play = (notes: Note[], end = 4) => replayHarmonyPolicy(song(notes, end), "conservative-backing-v1");
const events = (notes: Note[], end = 4) => play(notes, end).resolution.chords;
const classes = (notes: number[]) => [...new Set(notes.map(midi => midi % 12))].sort((a, b) => a - b);
const exactStack = [note(48, 0), note(52, .02), note(55, .04)];
const known: HarmonyPilotCase = {
  id: "known-staggered-c-major", compositionId: "known-staggered-c-major", split: "development", category: "exposed-delivery-gap", key: "C", durationBeats: 4,
  notes: exactStack,
  reference: [
    { startBeat: 0, endBeat: .04, kind: "unknown", allowedPitchClasses: [] },
    { startBeat: .04, endBeat: 4, kind: "supported", allowedPitchClasses: [0, 4, 7], bassPc: 0 },
  ],
};

describe("conservative delivery revision 3 source onset contract", () => {
  it("restores the known 3.96 supported beats without moving any note into the incomplete prefix", () => {
    const result = evaluateHarmonyPilotCase(known, "conservative-backing-v1");
    expect(result.metrics.supportedReferenceBeats).toBe(3.96);
    expect(result.metrics.audibleSupportedBeats).toBeCloseTo(3.96, 10);
    expect(result.metrics.wrongHarmonyBeats).toBe(0);
    expect(result.metrics.restViolationBeats).toBe(0);
    expect(result.realizedEvents).toHaveLength(1);
    expect(result.realizedEvents[0]).toMatchObject({ beat: .04, durationBeats: 3.96, name: "C", pitchClasses: [0, 4, 7], bassPc: 0 });
  });

  it.each([[48, 52, 55], [48, 55, 52], [52, 48, 55], [52, 55, 48], [55, 48, 52], [55, 52, 48]])("waits for the actual complete member onset with pitch order %j", (...pitches) => {
    const actual = events(pitches.map((midi, i) => note(midi, i * .02)));
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({ beat: .04, durationBeats: 3.96, name: "C" });
    expect(classes(actual[0]!.notes)).toEqual([0, 4, 7]);
    expect(Math.min(...actual[0]!.notes) % 12).toBe(0);
  });

  it("consumes one staggered power-to-triad group once and retains a later separate attack", () => {
    const input = [note(48, 0, 1), note(55, .02, 1), note(52, .04, 1), note(48, 2, 3), note(55, 2.02, 3), note(52, 2.04, 3)];
    const actual = events(input);
    expect(actual.map(chord => chord.beat)).toEqual([.04, 2.04]);
    expect(actual.map(chord => chord.beat + chord.durationBeats!)).toEqual([1, 3]);
    expect(actual.every(chord => classes(chord.notes).join() === "0,4,7")).toBe(true);
    expect(input.every(n => n.vel === 80)).toBe(true);
  });

  it("ends the complete voicing when its defining third releases, without a release-only reattack", () => {
    const actual = events([note(48, 0), note(52, .02, 1), note(55, .04)]);
    expect(actual).toHaveLength(1);
    expect(actual[0]!.beat).toBe(.04);
    expect(actual[0]!.beat + actual[0]!.durationBeats!).toBe(1);
  });

  it("does not let an upper octave keep the actual released inversion bass sounding", () => {
    const actual = events([note(40, 0, .5), note(55, .02), note(60, .04), note(52, .04)]);
    expect(actual).toHaveLength(1);
    expect(actual[0]!.beat).toBe(.04);
    expect(actual[0]!.beat + actual[0]!.durationBeats!).toBe(.5);
    expect(Math.min(...actual[0]!.notes) % 12).toBe(4);
  });

  it("cannot use an already released member to complete a staggered stack", () => {
    expect(events([note(48, 0, .01), note(52, .02), note(55, .04)])).toEqual([]);
  });

  it("excludes lyric/vocal tones from support and preserves fifth-only neutrality", () => {
    for (const tag of [{ lyrics: "sung" }, { identitySource: "vocals" as const }]) {
      const actual = events([note(48, 0), note(55, .02), note(52, .04, 4, tag)]);
      expect(actual).toHaveLength(1);
      expect(actual[0]!.beat).toBe(.02);
      expect(classes(actual[0]!.notes)).toEqual([0, 7]);
    }
  });

  it("refuses a foreign sounding bass and never fills real source rests", () => {
    expect(events([note(37, 0), ...exactStack])).toEqual([]);
    const result = evaluateHarmonyPilotCase({ ...known, id: "rest-boundary", compositionId: "rest-boundary", notes: exactStack.map(n => ({ ...n, dur: 1 - n.start })), reference: [
      { startBeat: 0, endBeat: .04, kind: "unknown", allowedPitchClasses: [] },
      { startBeat: .04, endBeat: 1, kind: "supported", allowedPitchClasses: [0, 4, 7], bassPc: 0 },
      { startBeat: 1, endBeat: 4, kind: "rest", allowedPitchClasses: [] },
    ] }, "conservative-backing-v1");
    expect(result.metrics.audibleSupportedBeats).toBeCloseTo(.96, 10);
    expect(result.metrics.restViolationBeats).toBe(0);
    expect(result.resolution.guidanceNotes.every(n => n.start + n.dur <= 1)).toBe(true);
  });

  it("does not transitively move an unrelated late third to the start of a long onset chain", () => {
    const input = [note(48, 0), note(55, 0), ...Array.from({ length: 14 }, (_, i) => note(i % 2 ? 48 : 55, (i + 1) * .07)), note(64, 1.05)];
    const actual = events(input);
    expect(actual.length).toBeGreaterThan(0);
    for (const chord of actual) {
      if (chord.beat < 1.05) expect(classes(chord.notes)).not.toContain(4);
    }
    expect(actual.every(chord => input.some(n => n.start === chord.beat))).toBe(true);
  });

  it("keeps the ordinary Player producer and unselected core delivery unchanged", () => {
    const source = song(exactStack);
    const labels = inferHarmonyTimeline(source.notes, source.measures, { key: source.key, policy: "conservative-backing-v1" });
    expect(resolveAccompaniment(source.notes, labels, "bass-chords", { durationBeats: 4, sourceRhythmMeasures: source.measures }).chords).toEqual([]);
    expect(replayChordsBacking({ ...source, chords: labels }, "generated").resolution.chords).toEqual([]);
    expect(play(exactStack).resolution.chords).toHaveLength(1);
  });

  it("delivers the same corrected event to engine and active symbolic export with speed and transpose", () => {
    const source = song(exactStack), replay = play(exactStack), before = JSON.stringify(source);
    const scheduled: Array<{ notes: number[]; when: number; duration: number }> = [];
    const audio: AudioLike = { ensure() {}, noteOn() {}, noteOff() {}, metronomeClick() {}, cancelAll() {}, setGains() {}, dispose() {}, sustainPedal: false,
      playChord(notes, when, duration) { scheduled.push({ notes, when, duration }); } };
    const settings = { ...DEFAULT_SETTINGS, backgroundMode: "chord" as const, accompanimentStyle: "bass-chords" as const, speed: 2, transpose: 3, metronome: false };
    const engine = new PlaybackEngine(audio, [], 2, { tempoBpm: 60, timeSig: [4, 4] }, settings, replay.resolution.chords);
    engine.start();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.when).toBeCloseTo(.02, 12);
    expect(scheduled[0]!.duration).toBeCloseTo(1.98, 12);
    const selection: ActiveExportSelection = { ...settings, audibleSupport: false, renderedExpression: "source", chordSource: "generated", melodySelection: "automatic", sourceBackingMode: "default", phraseOverrides: [] };
    const exported = activeExportVariant(source, replay.resolution, selection);
    expect(exported.notes.map(n => n.midi)).toEqual(scheduled[0]!.notes);
    expect(exported.notes.every(n => n.start === .04 && n.dur === 3.96)).toBe(true);
    expect(exported.tempoBpm).toBe(120);
    expect(JSON.stringify(source)).toBe(before);
  });
});
