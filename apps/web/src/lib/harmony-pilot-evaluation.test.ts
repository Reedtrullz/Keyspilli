import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChordLabel, Note } from "@keyspilli/midi";
import { resolveAccompaniment } from "@keyspilli/player-core";
import {
  evaluateHarmonyPilotCase, measureHarmonyRealization, summarizeHarmonyPilot,
  type HarmonyPilotCase, type HarmonyReferenceSpan,
} from "./harmony-pilot-evaluation";

const corpus = JSON.parse(readFileSync(new URL("../../../../packages/midi/test/fixtures/ks09-harmony-pilot-v1.json", import.meta.url), "utf8")) as {
  cases: HarmonyPilotCase[];
};
const development = corpus.cases.filter(item => item.split === "development");
const fixture = (id: string) => development.find(item => item.id === id)!;
const pitches = (values: readonly number[]) => [...new Set(values.map(value => value % 12))].sort((a, b) => a - b);
const played = (id: string) => evaluateHarmonyPilotCase(fixture(id), "conservative-backing-v1");

// These metrics are hand-calculated independently of harmony inference.
describe("harmony pilot duration accounting", () => {
  const reference: HarmonyReferenceSpan[] = [
    { startBeat: 0, endBeat: 2, kind: "supported", allowedPitchClasses: [0, 7], bassPc: 0 },
    { startBeat: 2, endBeat: 4, kind: "unknown", allowedPitchClasses: [] },
    { startBeat: 4, endBeat: 6, kind: "rest", allowedPitchClasses: [] },
    { startBeat: 6, endBeat: 8, kind: "supported", allowedPitchClasses: [2, 9], bassPc: 2 },
  ];
  const labels: ChordLabel[] = [
    { beat: 0, durationBeats: 2, name: "C5", notes: [36, 67] },
    { beat: 2, durationBeats: 4, name: "N.C.", notes: [] },
    { beat: 6, durationBeats: 1, name: "D5", notes: [38, 69] },
    { beat: 7, durationBeats: 1, name: "N.C.", notes: [] },
  ];
  const notes: Note[] = [
    { midi: 36, start: 0, dur: 1, vel: 70 },
    { midi: 67, start: 0, dur: 1, vel: 70 },
    { midi: 64, start: 0.5, dur: 1.5, vel: 70 },
    { midi: 36, start: 2.5, dur: 1, vel: 70 },
    { midi: 38, start: 4.5, dur: 0.5, vel: 70 },
    { midi: 38, start: 6.5, dur: 0.5, vel: 70 },
    { midi: 69, start: 6.5, dur: 0.5, vel: 70 },
  ];

  it("counts union beats, unsupported bass/pitches, unknown playback and rest intrusion separately", () => {
    expect(measureHarmonyRealization(reference, labels, notes, 8)).toEqual({
      durationBeats: 8, supportedReferenceBeats: 4, unknownReferenceBeats: 2, restReferenceBeats: 2,
      wrongHarmonyBeats: 2.5, restViolationBeats: 0.5,
      audibleSupportedBeats: 2.5, supportedCoverage: 0.625,
      audibleReferenceBeats: 3.5, audibleCoverage: 3.5 / 6,
      abstentionBeats: 3, abstentionRate: 0.5,
    });
  });

  it("treats the wrong bass as wrong harmony even when all pitch classes are allowed", () => {
    const result = measureHarmonyRealization(reference, labels, [{ midi: 43, start: 0, dur: 2, vel: 70 }, { midi: 60, start: 0, dur: 2, vel: 70 }], 8);
    expect(result.wrongHarmonyBeats).toBe(2);
    expect(result.audibleSupportedBeats).toBe(2);
  });

  it("does not pretend undefined coverage has a zero or perfect denominator", () => {
    expect(measureHarmonyRealization([{ startBeat: 0, endBeat: 4, kind: "rest", allowedPitchClasses: [] }], [], [], 4))
      .toMatchObject({ supportedCoverage: null, abstentionRate: null, audibleCoverage: null, wrongHarmonyBeats: 0 });
  });

  it("rejects reference gaps and overlaps so omitted spans cannot improve metrics", () => {
    expect(() => measureHarmonyRealization(reference.slice(1), labels, notes, 8)).toThrow(/partition/);
    expect(() => measureHarmonyRealization([...reference, reference[0]!], labels, notes, 8)).toThrow(/partition/);
  });

  it("aggregates durations before computing rates", () => {
    const rows = [played("dev-open-fifth"), played("dev-third-release")];
    expect(summarizeHarmonyPilot(rows)).toMatchObject({ cases: 2, supportedReferenceBeats: 8, audibleSupportedBeats: 5.5, supportedCoverage: 5.5 / 8 });
  });
});

describe("conservative harmony through actual Player replay and player-core resolution", () => {
  it.each(["dev-open-fifth", "dev-sung-thirds", "dev-seventh-hold", "dev-first-inversion", "dev-borrowed-inversion", "dev-suspension-resolution"])("preserves supported pitch classes and bass for %s", id => {
    const result = played(id);
    expect(result.metrics.wrongHarmonyBeats).toBe(0);
    expect(result.metrics.restViolationBeats).toBe(0);
    expect(result.metrics.supportedCoverage).toBe(1);
    expect(result.resolution.notes).toEqual([]);
    const source = fixture(id);
    const direct = resolveAccompaniment(source.notes, result.labels, "bass-chords", {
      durationBeats: source.durationBeats, sourceRhythmMeasures: result.measures,
    });
    expect(direct).toEqual(result.resolution);
  });

  it.each(["dev-semitone", "dev-foreign-pedal", "dev-solo-register"])("leaves %s silent without a source-note fallback", id => {
    const result = played(id);
    expect(result.resolution.chords).toEqual([]);
    expect(result.resolution.guidanceNotes).toEqual([]);
    expect(result.resolution.notes).toEqual([]);
    expect(result.metrics.abstentionRate).toBe(1);
  });

  it("replays the actual repeated fifth-only attacks and their exact release gaps", () => {
    const result = played("dev-repeated-fifths");
    expect(result.resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats, pitches(chord.notes)]))
      .toEqual([[0, "C5", 1.25, [0, 7]], [1.5, "C5", 1.25, [0, 7]], [3, "C5", 1.25, [0, 7]]]);
    expect(result.metrics.restViolationBeats).toBe(0);
  });

  it("does not invent an attack or sustained third after a member release", () => {
    const result = played("dev-third-release");
    expect(result.resolution.chords.map(chord => [chord.beat, chord.name, chord.durationBeats]))
      .toEqual([[0, "C", 1.5]]);
    expect(result.metrics.supportedCoverage).toBe(1.5 / 4);
    expect(result.metrics.wrongHarmonyBeats).toBe(0);
    expect(result.resolution.fallbackSpans).toContainEqual({ startBeat: 1.5, endBeat: 4, reason: "no supported source attack" });
  });

  it("reports a supported arpeggio label with no new bass attack as lost audible coverage", () => {
    const result = played("dev-overlap-arpeggio");
    // Admission starts after the original root attack. The existing Player
    // requires a supported attack inside that label and does not invent one.
    expect(result.labels.filter(chord => chord.notes.length).map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[1, "C", 2]]);
    expect(result.resolution.chords).toEqual([]);
    expect(result.metrics.supportedCoverage).toBe(0);
    expect(result.metrics.abstentionBeats).toBe(1);
  });

  it("keeps the legacy comparison on the same Player playback path", () => {
    const result = evaluateHarmonyPilotCase(fixture("dev-open-fifth"), "legacy-backing");
    expect(result.resolution.chords[0]!.name).toBe("C");
    expect(result.metrics.wrongHarmonyBeats).toBe(4);
    expect(result.metrics.supportedCoverage).toBe(1);
  });
});
