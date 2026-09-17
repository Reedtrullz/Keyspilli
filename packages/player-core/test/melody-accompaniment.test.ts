import { describe, expect, it } from "vitest";
import type { ChordLabel, Note } from "@keyspilli/midi";
import {
  buildMelodyAccompaniment,
  enforceAccompanimentSoundingLimits,
  sourceNoteIds,
  type ArrangementEvent,
  type MelodySelection,
  type SparseBackingTiming,
} from "../src/accompaniment.js";
import { DEFAULT_SETTINGS, PlaybackEngine, type AudioLike, type TimedNote } from "../src/index.js";

function note(midi: number, start: number, dur = 1, vel = 80, hand?: Note["hand"]): Note {
  return { midi, start, dur, vel, ...(hand ? { hand } : {}) };
}

function chord(beat: number, name: string, durationBeats: number): ChordLabel {
  return { beat, name, durationBeats, notes: [] };
}

function build(notes: Note[], chords: ChordLabel[], selection?: MelodySelection, durationBeats = 8, sparseBackingTiming?: SparseBackingTiming) {
  return buildMelodyAccompaniment(notes, chords, {
    selection,
    durationBeats,
    sourceFingerprint: "fixture-source-v1",
    ...(sparseBackingTiming ? { sparseBackingTiming } : {}),
  });
}

class AudioSpy implements AudioLike {
  noteOns: number[] = [];
  playedChords: number[][] = [];
  sustainPedal = true;
  ensure(): unknown { return {}; }
  noteOn(note: TimedNote): void { this.noteOns.push(note.midi); }
  noteOff(): void {}
  metronomeClick(): void {}
  playChord(notes: number[]): void { this.playedChords.push(notes); }
  cancelAll(): void {}
  setGains(): void {}
  dispose(): void {}
}

function renderPhrase(events: readonly ArrangementEvent[], startBeat: number, endBeat: number): Float32Array {
  const sampleRate = 8_000;
  const secondsPerBeat = 0.5;
  const frames = Math.ceil((endBeat - startBeat) * secondsPerBeat * sampleRate);
  const output = new Float32Array(frames);
  for (const event of events) {
    const start = Math.max(0, Math.floor((event.note.start - startBeat) * secondsPerBeat * sampleRate));
    const end = Math.min(frames, Math.ceil((event.note.start + event.note.dur - startBeat) * secondsPerBeat * sampleRate));
    const frequency = 440 * 2 ** ((event.note.midi - 69) / 12);
    for (let frame = start; frame < end; frame++) {
      const elapsed = frame / sampleRate - (event.note.start - startBeat) * secondsPerBeat;
      const remaining = event.note.dur * secondsPerBeat - elapsed;
      const envelope = Math.min(1, elapsed / 0.006) * Math.min(1, Math.max(0, remaining) / 0.08);
      output[frame] = (output[frame] ?? 0) + Math.sin(2 * Math.PI * frequency * elapsed) * envelope * (event.note.vel / 127) * 0.08;
    }
  }
  return output;
}

describe("buildMelodyAccompaniment", () => {
  it("owns the inferred melody and generates support instead of falling back", () => {
    const result = build(
      [note(60, 0, 1, 100, "R"), note(48, 0, 1, 65, "L"), note(62, 1, 1, 100, "R"), note(50, 1, 1, 65, "L")],
      [chord(0, "C", 2)],
      "automatic",
      2,
    );

    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([60, 62]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.midi)).toEqual([48, 50]);
    expect(result.chords).toHaveLength(1);
    expect(result.chords[0]!.notes.map((midi) => midi % 12)).toEqual(expect.arrayContaining([0, 4, 7]));
    expect(result.chords[0]!.suggestedHands.every((hand) => hand === "L")).toBe(true);
    expect(result.fallbackSpans).toEqual([]);
    expect(result.provenance).toMatchObject({
      generatorVersion: "melody-accompaniment.v2",
      selection: "automatic",
      selectionProvenance: "inferred",
      sourceFingerprint: "fixture-source-v1",
      sourceSupportNoteCount: 2,
      generatedNoteCount: 0,
      generatedBeats: 0,
      fallbackBeats: 0,
      supportModes: ["source-rhythm"],
    });
    expect(result.provenance.melodyNoteIds).toHaveLength(2);
  });

  it("retains source accompaniment attacks while reducing dense voicings", () => {
    const source = [
      note(72, 0, 1, 100, "R"), note(74, 1, 1, 100, "R"), note(76, 2, 1, 100, "R"),
      note(36, 0, 0.5, 60, "L"), note(40, 0, 0.5, 60, "L"), note(43, 0, 0.5, 60, "L"), note(48, 0, 0.5, 60, "L"),
      note(38, 0.5, 0.5, 60, "L"), note(45, 0.5, 0.5, 60, "L"),
      note(40, 1.5, 0.5, 60, "L"), note(47, 1.5, 0.5, 60, "L"),
      note(41, 2.5, 0.5, 60, "L"), note(48, 2.5, 0.5, 60, "L"),
    ];
    const result = build(source, [chord(0, "C", 4)], "right-hand", 4);
    const originalSupport = source.filter((item) => item.hand === "L");
    const support = result.notes.filter((item) => item.hand === "L");

    expect([...new Set(support.map((item) => item.start))]).toEqual([0, 0.5, 1.5, 2.5]);
    expect(support.length).toBeLessThan(originalSupport.length);
    expect(support.every((item) => originalSupport.some((sourceItem) => sourceItem.start === item.start))).toBe(true);
    expect(support.some((item) => item.start === 1)).toBe(false);
    expect(support.some((item) => item.start === 0 && item.midi === 36)).toBe(true);
    expect(support.find((item) => item.midi === 36)).toMatchObject({ start: 0, dur: 0.5, vel: 60, hand: "L" });
    expect(result.melody.map((item) => item.midi)).toEqual([72, 74, 76]);
  });

  it("keeps reducible source rhythm even when the chord cannot be voiced", () => {
    const result = build(
      [note(72, 0, 2, 100, "R"), note(36, 0, 0.5, 60, "L"), note(40, 0, 0.5, 60, "L"), note(43, 0, 0.5, 60, "L"), note(48, 0, 0.5, 60, "L")],
      [chord(0, "not-a-chord", 2)],
      "right-hand",
      2,
    );

    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.midi)).toEqual([36, 43, 48]);
    expect(result.chords).toEqual([]);
    expect(result.fallbackSpans).toEqual([{ startBeat: 0, endBeat: 2, reason: "unsupported chord" }]);
  });

  it("continues source accompaniment through a melody rest without inventing melody events", () => {
    const result = build(
      [note(72, 0, 1, 100, "R"), note(74, 2, 1, 100, "R"), note(48, 0, 0.5, 60, "L"), note(48, 1, 0.5, 60, "L"), note(48, 2, 0.5, 60, "L")],
      [chord(0, "C", 3)],
      "right-hand",
      3,
    );
    const support = result.notes.filter((item) => item.hand === "L");
    const guidedMelodyStarts = result.guidanceNotes
      .filter((item) => item.hand === "R")
      .map((item) => item.start);

    expect([...new Set(support.map((item) => item.start))]).toEqual([0, 1, 2]);
    expect(guidedMelodyStarts).toEqual([0, 2]);
    expect(result.guidanceNotes.some((item) => item.hand === "R" && item.start === 1)).toBe(false);
  });

  it("uses the opt-in rest state for a held line and later re-entry", () => {
    const result = buildMelodyAccompaniment(
      [
        note(72, 0, 2, 100),
        note(48, 0, 0.5, 60),
        note(50, 1, 0.5, 60),
        note(74, 2, 1, 100),
        note(52, 2, 0.5, 60),
      ],
      [],
      { durationBeats: 3, sourceFingerprint: "fixture-source-v2", allowRests: true },
    );

    expect(result.melody.map((item) => [item.midi, item.start])).toEqual([[72, 0], [74, 2]]);
  });

  it("allows an explicit phrase rest without deleting accompaniment", () => {
    const source = [note(48, 0), note(50, 1), note(72, 2, 1, 100, "R")];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 3,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{ startBeat: 0, endBeat: 2, sourceNoteIds: [], sourceFingerprint: "fixture-source-v2" }],
    });

    expect(result.melody.filter((item) => item.start < 2)).toHaveLength(0);
    expect(result.notes.some((item) => item.start < 2)).toBe(true);
  });

  it("keeps unresolved ambiguity outside a partially overlapping phrase override", () => {
    const source = [
      note(48, 0, 1, 60), note(60, 0, 1, 80), note(61, 0, 1, 80),
      note(48, 1, 1, 60), note(60, 1, 1, 80), note(61, 1, 1, 80),
      note(72, 2, 1, 80),
    ];
    const ids = sourceNoteIds(source);
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 3,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 1,
        sourceNoteIds: [ids[1]!],
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.provenance.unresolvedSpans).toEqual([
      { startBeat: 1, endBeat: 2, reason: "ambiguous melody" },
    ]);
  });

  it("gives a phrase override precedence over global right-hand selection", () => {
    const source = [
      note(72, 0, 1, 100, "R"), note(48, 0, 0.5, 60, "L"),
      note(74, 2, 1, 100, "R"), note(50, 2, 0.5, 60, "L"),
    ];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 3,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 2,
        sourceNoteIds: [],
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.melody.map((item) => [item.midi, item.start])).toEqual([[74, 2]]);
    expect(result.notes.some((item) => item.midi === 48 && item.start === 0)).toBe(true);
  });

  it("keeps review provenance local to an overridden phrase", () => {
    const source = [note(72, 0, 1, 100), note(74, 2, 1, 100)];
    const result = buildMelodyAccompaniment(source, [chord(0, "C", 3)], {
      durationBeats: 3,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 1,
        sourceNoteIds: [],
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.phrases.map(({ startBeat, endBeat, review }) => [startBeat, endBeat, review])).toEqual([
      [0, 1, "user-selected"],
      [1, 3, "automatic"],
    ]);
  });

  it("splits a long chord event at a short ambiguity instead of withholding the whole interval", () => {
    const result = buildMelodyAccompaniment([
      note(72, 0, 0.3, 80),
      note(72, 0, 0.3, 80),
      note(60, 1, 1, 80),
    ], [chord(0, "C", 16)], {
      durationBeats: 16,
      sourceFingerprint: "fixture-source-v2",
    });

    expect(result.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 0.3, reason: "ambiguous melody" });
    expect(result.fallbackSpans.some((span) => span.startBeat === 0 && span.endBeat === 16)).toBe(false);
    expect(result.chords.some((item) => item.beat >= 0.3 && (item.durationBeats ?? 0) > 15)).toBe(true);
  });

  it("keeps automatic melody and an unavailable-part warning outside a partial RH correction", () => {
    const source = [note(72, 0, 1, 100), note(74, 2, 1, 100)];
    const ids = sourceNoteIds(source);
    const result = buildMelodyAccompaniment(source, [chord(0, "C", 3)], {
      durationBeats: 3,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 1,
        sourceNoteIds: [ids[0]!],
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.melody.map((item) => [item.midi, item.start])).toEqual([[72, 0], [74, 2]]);
    expect(result.provenance.unresolvedSpans).toContainEqual({
      startBeat: 1,
      endBeat: 3,
      reason: "right-hand part unavailable",
    });
  });

  it("computes local strategy and change per phrase", () => {
    const source = [
      note(72, 0, 1, 100, "R"),
      note(74, 2, 1, 100, "R"),
      note(48, 2, 0.5, 60, "L"),
    ];
    const ids = sourceNoteIds(source);
    const result = buildMelodyAccompaniment(source, [
      chord(0, "C", 2),
      chord(2, "F", 2),
    ], {
      durationBeats: 4,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 2,
        sourceNoteIds: [ids[0]!],
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.phrases.map(({ startBeat, endBeat, strategy, change }) => [startBeat, endBeat, strategy, change])).toEqual([
      [0, 2, "harmonic-backing", "changed"],
      [2, 4, "source-reduction", "unchanged"],
    ]);
  });

  it("keeps an invalid overlapping override visible in phrase review", () => {
    const source = [note(72, 0, 1, 100), note(74, 2, 1, 100)];
    const result = buildMelodyAccompaniment(source, [chord(0, "C", 3)], {
      durationBeats: 3,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [
        { startBeat: 0, endBeat: 2, sourceNoteIds: [], sourceFingerprint: "fixture-source-v2" },
        { startBeat: 1, endBeat: 3, sourceNoteIds: [], sourceFingerprint: "fixture-source-v2" },
      ],
    });

    expect(result.phrases.find((phrase) => phrase.startBeat === 1 && phrase.endBeat === 2)).toMatchObject({
      review: "needs-review",
      reasons: ["invalid phrase override"],
    });
  });

  it("fails closed for a stale phrase override instead of changing melody", () => {
    const source = [note(72, 0, 1, 100, "R")];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 1,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 1,
        sourceNoteIds: [sourceNoteIds(source)[0]!],
        sourceFingerprint: "stale-source",
      }],
    });

    expect(result.melody).toEqual([source[0]]);
    expect(result.provenance.unresolvedSpans).toEqual([{ startBeat: 0, endBeat: 1, reason: "invalid phrase override" }]);
  });

  it("uses one sparse quality-aware attack for a power chord without inventing its third", () => {
    const result = build(
      [note(72, 0, 3, 100, "R")],
      [chord(0, "C5", 3)],
      "right-hand",
      3,
    );
    const support = result.notes.filter((item) => item.hand === "L");

    expect([...new Set(support.map((item) => item.start))]).toEqual([0]);
    expect(new Set(support.map((item) => item.midi % 12))).toEqual(new Set([0, 7]));
    expect(support.some((item) => item.midi % 12 === 4)).toBe(false);
    expect(result.provenance).toMatchObject({
      generatedBeats: 0.75,
      generatedNoteCount: 2,
      sourceSupportNoteCount: 0,
      supportModes: ["sparse-harmonic"],
    });
  });

  it("uses a labelled incomplete shell when low-register hand clearance rejects the full extension", () => {
    const result = build(
      [note(44, 0, 3, 100, "R")],
      [chord(0, "Cadd9", 3)],
      "right-hand",
      3,
    );
    const generated = result.chords[0]!;

    expect(generated.omittedPitchClasses).toEqual([7]);
    expect(new Set(generated.notes.map((midi) => midi % 12))).toEqual(new Set([0, 2, 4]));
    expect(generated.notes.every((midi) => midi >= 36 && midi <= 96)).toBe(true);
    expect(Math.max(...generated.notes) - Math.min(...generated.notes)).toBeLessThanOrEqual(12);
  });

  it("keeps adjacent generated voicings within a small deterministic motion", () => {
    const result = build(
      [note(72, 0, 4, 100, "R")],
      [chord(0, "C", 2), chord(2, "G", 2)],
      "right-hand",
      4,
    );
    const first = result.chords[0]!.notes;
    const second = result.chords[1]!.notes;
    const movement = second.reduce((sum, midi, index) => sum + Math.abs(midi - (first[index] ?? midi)), 0);

    expect(movement).toBeLessThanOrEqual(24);
    expect(result.chords.every((item) => Math.max(...item.notes) - Math.min(...item.notes) <= 12)).toBe(true);
  });

  it("keeps a sustained line below short upper decoration", () => {
    const result = build(
      [
        note(60, 0, 1, 84, "R"), note(74, 0, 0.125, 70, "R"),
        note(62, 1, 1, 84, "R"), note(76, 1, 0.125, 70, "R"),
      ],
      [chord(0, "C", 2)],
      "automatic",
      2,
    );

    expect(result.melody.map((item) => item.midi)).toEqual([60, 62]);
    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([60, 62]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.midi)).toEqual([74, 76]);
  });

  it("preserves a melody crossing hands while leaving support owned separately", () => {
    const result = build(
      [
        note(55, 0, 1, 90, "L"), note(72, 0, 1, 90, "R"),
        note(57, 1, 1, 90, "L"), note(69, 1, 1, 90, "R"),
      ],
      [chord(0, "C", 2)],
      "automatic",
      2,
    );

    expect(result.melody.map((item) => item.midi)).toEqual([72, 69]);
    expect(result.melody.map((item) => item.hand)).toEqual(["R", "R"]);
    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([72, 69]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.midi)).toEqual([55, 57]);
    expect(result.provenance.melodyNoteIds).toHaveLength(2);
  });

  it("keeps support below a low melody within the actual left-hand span", () => {
    const result = build(
      [note(50, 0, 1, 100, "R"), note(36, 0, 1, 60, "L")],
      [chord(0, "C", 2)],
      "automatic",
      2,
    );

    const support = result.chords[0]!.notes;
    expect(Math.max(...support) - Math.min(...support)).toBeLessThanOrEqual(12);
    expect(support.every((midi) => midi < 48)).toBe(true);
    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([50]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.midi)).toEqual([36]);
  });

  it("reports no feasible support instead of crossing a low melody silently", () => {
    const result = build(
      [note(36, 0, 2, 100, "R")],
      [chord(0, "Cadd9", 2)],
      "right-hand",
      2,
    );

    expect(result.melody).toMatchObject([note(36, 0, 2, 100, "R")]);
    expect(result.chords).toEqual([]);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 2, reason: "no playable support voicing" });
  });

  it("renders a complete candidate phrase through one same-instrument note stream", () => {
    const result = build(
      [note(72, 0, 8, 100, "R")],
      [chord(0, "C", 8)],
      "right-hand",
      8,
      { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary" },
    );
    const toTimed = (item: Note): TimedNote => ({
      midi: item.midi,
      startSec: item.start * 0.5,
      durSec: item.dur * 0.5,
      vel: item.vel,
      hand: item.hand,
    });
    const audio = new AudioSpy();
    const engine = new PlaybackEngine(
      audio,
      result.notes.map(toTimed),
      4,
      { tempoBpm: 120, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "piano" },
      [],
      result.guidanceNotes.map(toTimed),
    );

    engine.start();
    for (let index = 0; index < 8; index++) engine.tick(0.5);

    expect(audio.playedChords).toEqual([]);
    expect(audio.noteOns).toEqual(result.notes.map((item) => item.midi));
    expect(result.guidanceNotes).toEqual(result.notes);
  });

  it("keeps a held melody while support changes underneath it", () => {
    const held = note(72, 0, 4, 100, "R");
    const result = build(
      [held, note(48, 0, 1, 60, "L"), note(53, 2, 1, 60, "L")],
      [chord(0, "C", 2), chord(2, "F", 2)],
      "right-hand",
      4,
    );

    expect(result.notes).toContainEqual(held);
    expect(result.chords).toHaveLength(2);
    expect(result.chords.map((item) => item.beat)).toEqual([0, 2]);
    expect(result.chords.every((item) => item.durationBeats === 2)).toBe(true);
    expect(result.fallbackSpans).toEqual([]);
  });

  it("reassigns held source support crossing the first chord span to the left hand", () => {
    const heldSupport = note(60, 0, 4, 70, "R");
    const result = build(
      [note(72, 0, 1, 100, "R"), note(74, 2, 1, 100, "R"), heldSupport],
      [chord(2, "C", 2)],
      "automatic",
      4,
    );

    expect(result.melody.map((item) => item.midi)).toEqual([72, 74]);
    expect(result.notes.filter((item) => item.midi === heldSupport.midi)).toEqual([{ ...heldSupport, hand: "L" }]);
  });

  it("preserves extended tones and slash-bass meaning", () => {
    const result = build(
      [note(84, 0, 1, 80, "R"), note(84, 1, 1, 80, "R"), note(84, 2, 1, 80, "R")],
      [chord(0, "Cadd9", 1), chord(1, "C7/E", 1), chord(2, "Cmaj7/G", 1)],
      "right-hand",
      3,
    );

    expect(new Set(result.chords[0]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 2, 4, 7]));
    expect(new Set(result.chords[1]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 4, 7, 10]));
    expect(new Set(result.chords[2]!.notes.map((midi) => midi % 12))).toEqual(new Set([0, 4, 7, 11]));
    expect(Math.min(...result.chords[1]!.notes)).toBe(40);
    expect(Math.min(...result.chords[2]!.notes)).toBe(43);
    expect(result.chords.map((item) => Math.min(...item.notes) % 12)).toEqual([0, 4, 7]);
    expect(result.chords.every((item) => Math.max(...item.notes) - Math.min(...item.notes) <= 12)).toBe(true);
  });

  it("surfaces duplicate-onset ambiguity while realizing the safe remainder", () => {
    const notes = [note(72, 0, 1, 80, "R"), note(72, 0, 1, 80, "R"), note(60, 1, 1, 80, "R")];
    const inferred = build(notes, [chord(0, "C", 2)], "automatic", 2);
    const corrected = build(notes, [chord(0, "C", 2)], "right-hand", 2);

    expect(inferred.provenance.unresolvedSpans.length).toBeGreaterThan(0);
    expect(inferred.chords).toHaveLength(1);
    expect(inferred.chords[0]).toMatchObject({ beat: 1, durationBeats: 1 });
    expect(inferred.notes.filter((item) => item.midi === 72 && item.start === 0)).toHaveLength(2);
    expect(inferred.fallbackSpans[0]!.reason).toBe("ambiguous melody");
    expect(corrected.provenance.selection).toBe("right-hand");
    expect(corrected.provenance.selectionProvenance).toBe("user-confirmed");
    expect(corrected.melody).toHaveLength(3);
  });

  it("reduces dense source support without a chord chart while preserving melody", () => {
    const source = [
      note(72, 0, 1, 100, "R"),
      note(48, 0, 0.5, 60, "L"), note(52, 0, 0.5, 60, "L"), note(55, 0, 0.5, 60, "L"), note(60, 0, 0.5, 60, "L"),
      note(74, 1, 1, 100, "R"),
      note(50, 1, 0.5, 60, "L"), note(53, 1, 0.5, 60, "L"), note(57, 1, 0.5, 60, "L"), note(62, 1, 0.5, 60, "L"),
      note(76, 2, 1, 100, "R"),
      note(52, 2, 0.5, 60, "L"), note(55, 2, 0.5, 60, "L"), note(59, 2, 0.5, 60, "L"), note(64, 2, 0.5, 60, "L"),
    ];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 3,
      sourceFingerprint: "fixture-source-v2",
    });

    expect(result.chords).toEqual([]);
    expect(result.melody.map((item) => item.midi)).toEqual([72, 74, 76]);
    expect(result.notes.length).toBeLessThan(source.length);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.start)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(result.provenance.supportModes).toEqual(["source-rhythm"]);
    expect(result.phrases).toEqual([expect.objectContaining({
      startBeat: 0,
      endBeat: 3,
      strategy: "source-reduction",
      change: "changed",
      review: "needs-review",
      reasons: ["no chord coverage"],
    })]);
  });

  it("does not reuse protected melody as inferred harmony when the chart is absent", () => {
    const result = buildMelodyAccompaniment(
      [note(72, 0, 1, 100, "R"), note(74, 1, 1, 100, "R")],
      [],
      { durationBeats: 2, selection: "right-hand", sourceFingerprint: "fixture-source-v2" },
    );

    expect(result.chords).toEqual([]);
    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([72, 74]);
    expect(result.provenance.supportModes).toEqual(["fallback"]);
    expect(result.fallbackSpans).toEqual([{ startBeat: 0, endBeat: 2, reason: "no chord coverage" }]);
  });

  it("does not call an edge-only phrase silent when its midpoint is empty", () => {
    const result = buildMelodyAccompaniment(
      [note(72, 0, 0.1, 100), note(74, 2.9, 0.1, 100)],
      [],
      {
        durationBeats: 3,
        sourceFingerprint: "fixture-source-v2",
        phraseOverrides: [{ startBeat: 0, endBeat: 1, sourceNoteIds: [], sourceFingerprint: "fixture-source-v2" }],
      },
    );

    expect(result.phrases.find((phrase) => phrase.startBeat === 1 && phrase.endBeat === 3)?.strategy).toBe("original");
  });

  it("preserves syncopated pickup attacks without quantizing source rhythm", () => {
    const source = [
      note(72, 0.25, 0.5, 100, "R"),
      note(48, 0.25, 0.4, 60, "L"), note(52, 0.25, 0.4, 60, "L"), note(55, 0.25, 0.4, 60, "L"), note(60, 0.25, 0.4, 60, "L"),
      note(74, 1.5, 0.5, 100, "R"),
      note(50, 1.5, 0.4, 60, "L"), note(53, 1.5, 0.4, 60, "L"), note(57, 1.5, 0.4, 60, "L"), note(62, 1.5, 0.4, 60, "L"),
      note(76, 2.75, 0.5, 100, "R"),
      note(52, 2.75, 0.4, 60, "L"), note(55, 2.75, 0.4, 60, "L"), note(59, 2.75, 0.4, 60, "L"), note(64, 2.75, 0.4, 60, "L"),
    ];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 4,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
    });

    expect(result.melody.map((item) => [item.midi, item.start])).toEqual([[72, 0.25], [74, 1.5], [76, 2.75]]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.start)).toEqual([
      0.25, 0.25, 0.25, 1.5, 1.5, 1.5, 2.75, 2.75, 2.75,
    ]);
    expect(result.notes.some((item) => item.start === 1 || item.start === 2 || item.start === 3)).toBe(false);
    expect(result.phrases).toEqual([expect.objectContaining({ startBeat: 0, endBeat: 4, strategy: "source-reduction", change: "changed" })]);
  });

  it("keeps a repeated defining hook when its phrase is explicitly protected", () => {
    const source = [
      note(76, 0, 0.5, 100, "R"), note(74, 1, 0.5, 100, "R"), note(76, 2, 0.5, 100, "R"), note(74, 3, 0.5, 100, "R"),
      note(48, 0, 0.5, 60, "L"), note(52, 0, 0.5, 60, "L"), note(55, 0, 0.5, 60, "L"), note(60, 0, 0.5, 60, "L"),
      note(50, 2, 0.5, 60, "L"), note(53, 2, 0.5, 60, "L"), note(57, 2, 0.5, 60, "L"), note(62, 2, 0.5, 60, "L"),
    ];
    const ids = sourceNoteIds(source);
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 4,
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{
        startBeat: 0,
        endBeat: 4,
        sourceNoteIds: ids.slice(0, 4),
        sourceFingerprint: "fixture-source-v2",
      }],
    });

    expect(result.melody.map((item) => item.midi)).toEqual([76, 74, 76, 74]);
    expect(result.notes.filter((item) => item.hand === "R").map((item) => item.midi)).toEqual([76, 74, 76, 74]);
    expect(result.notes.filter((item) => item.hand === "L")).toHaveLength(6);
  });

  it("drops redundant repeated upper support while retaining every bass attack", () => {
    const source = [
      note(72, 0, 0.5, 100, "R"), note(74, 1, 0.5, 100, "R"), note(76, 2, 0.5, 100, "R"),
      note(48, 0, 0.5, 60, "L"), note(52, 0, 0.5, 60, "L"), note(55, 0, 0.5, 60, "L"),
      note(48, 1, 0.5, 60, "L"), note(52, 1, 0.5, 60, "L"), note(55, 1, 0.5, 60, "L"),
      note(48, 2, 0.5, 60, "L"), note(52, 2, 0.5, 60, "L"), note(55, 2, 0.5, 60, "L"),
    ];
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: 3,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
    });
    const support = result.notes.filter((item) => item.hand === "L");

    expect(support.map((item) => [item.midi, item.start])).toEqual([
      [48, 0], [52, 0], [55, 0], [48, 1], [48, 2],
    ]);
    expect(result.melody.map((item) => item.midi)).toEqual([72, 74, 76]);
    expect(result.provenance.supportModes).toEqual(["source-rhythm"]);
  });

  it("uses one sparse attack for repeated harmony and keeps off-grid changes off-grid", () => {
    const result = build(
      [note(72, 0, 4, 100, "R")],
      [chord(0, "C", 1), chord(1, "C", 1), chord(2, "C", 1), chord(3, "C", 1), chord(4.25, "F", 1.5)],
      "right-hand",
      5.75,
    );
    const support = result.notes.filter((item) => item.hand === "L");

    expect([...new Set(support.map((item) => item.start))]).toEqual([0, 4.25]);
    expect(support.every((item) => item.start === 0 || item.start === 4.25)).toBe(true);
    expect(result.provenance.supportModes).toEqual(["sparse-harmonic"]);
    expect(result.provenance.generatedNoteCount).toBe(support.length);
    expect(result.provenance.generatedNoteCount).toBeGreaterThan(0);
    expect(result.provenance.generatedBeats).toBe(1.5);
  });

  it.each([
    ["4/4", { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary" } as const, [0, 2, 4, 6]],
    ["3/4", { timeSig: [3, 4], measureStartBeat: 0, provenance: "source-measure-boundary" } as const, [0, 2, 3, 5, 6]],
    ["6/8", { timeSig: [6, 8], measureStartBeat: 0, provenance: "source-measure-boundary" } as const, [0, 1.5, 3, 4.5, 6, 7.5]],
  ])("uses the validated %s phase for sparse harmonic backing", (_label, sparseBackingTiming, expectedStarts) => {
    const result = build(
      [note(72, 0, 8, 100, "R")],
      [chord(0, "C", 8)],
      "right-hand",
      8,
      sparseBackingTiming,
    );
    expect([...new Set(result.notes.filter((item) => item.hand === "L").map((item) => item.start))]).toEqual(expectedStarts);
    expect(result.provenance.generatedNoteCount).toBe(expectedStarts.length * 3);
  });

  it("uses the supplied source measure phase instead of assuming beat zero", () => {
    const result = build(
      [note(72, 0, 8, 100, "R")],
      [chord(0, "C", 8)],
      "right-hand",
      8,
      { timeSig: [3, 4], measureStartBeat: 1, provenance: "source-measure-boundary" },
    );

    expect([...new Set(result.notes.filter((item) => item.hand === "L").map((item) => item.start))]).toEqual([0, 1, 3, 4, 6, 7]);
  });

  it("does not invent a meter phase when time signature is unavailable", () => {
    const result = build(
      [note(72, 0, 8, 100, "R")],
      [chord(0, "C", 8)],
      "right-hand",
      8,
    );

    expect([...new Set(result.notes.filter((item) => item.hand === "L").map((item) => item.start))]).toEqual([0]);
  });

  it("falls back to the harmonic boundary for unknown phase provenance", () => {
    const result = build(
      [note(72, 0, 8, 100, "R")],
      [chord(0, "C", 8)],
      "right-hand",
      8,
      { timeSig: [4, 4], measureStartBeat: 0, provenance: "unknown" },
    );

    expect([...new Set(result.notes.filter((item) => item.hand === "L").map((item) => item.start))]).toEqual([0]);
  });

  it("is invariant to equivalent adjacent chord segmentation", () => {
    const timing = { timeSig: [4, 4], measureStartBeat: 0, provenance: "source-measure-boundary" } as const;
    const source = [note(72, 0, 8, 100, "R")];
    const merged = build(source, [chord(0, "C", 8)], "right-hand", 8, timing);
    const split = build(source, [chord(0, "C", 4), chord(4, "C", 4)], "right-hand", 8, timing);

    expect(split.notes).toEqual(merged.notes);
    expect(split.provenance.generatedNoteCount).toBe(merged.provenance.generatedNoteCount);
    expect(split.provenance.generatedBeats).toBe(merged.provenance.generatedBeats);
  });

  it("reduces a partial chart gap locally instead of requiring a whole-song no-chart path", () => {
    const result = build(
      [
        note(72, 0, 1, 100, "R"),
        note(48, 2.5, 0.5, 60, "L"), note(52, 2.5, 0.5, 60, "L"), note(55, 2.5, 0.5, 60, "L"), note(60, 2.5, 0.5, 60, "L"),
        note(74, 4, 1, 100, "R"),
      ],
      [chord(0, "C", 2), chord(4, "F", 2)],
      "right-hand",
      6,
    );

    expect(result.notes.filter((item) => item.hand === "L" && item.start === 2.5)).toHaveLength(3);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 2, endBeat: 4, reason: "no chord coverage" });
    expect(result.phrases.find((phrase) => phrase.startBeat === 2 && phrase.endBeat === 4)).toMatchObject({
      strategy: "source-reduction",
      change: "changed",
      review: "needs-review",
      reasons: ["no chord coverage"],
    });
  });

  it("keeps reducing a clear no-chart interval outside one uncertain phrase", () => {
    const result = buildMelodyAccompaniment([
      note(72, 0, 1, 100, "R"),
      note(48, 2, 0.5, 60, "L"), note(52, 2, 0.5, 60, "L"), note(55, 2, 0.5, 60, "L"), note(60, 2, 0.5, 60, "L"),
      note(74, 2, 1, 100, "R"),
    ], [], {
      durationBeats: 3,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
      phraseOverrides: [{ startBeat: 0, endBeat: 1, sourceNoteIds: [], sourceFingerprint: "stale-source" }],
    });

    expect(result.provenance.unresolvedSpans).toEqual([{ startBeat: 0, endBeat: 1, reason: "invalid phrase override" }]);
    expect(result.notes.filter((item) => item.hand === "L").map((item) => item.start)).toEqual([2, 2, 2]);
    expect(result.provenance.supportModes).toEqual(["source-rhythm"]);
  });

  it.each([
    ["3/4-like", [0.5, 1.5, 2.5]],
    ["6/8-like", [0.75, 2.25, 3.75]],
    ["unknown-meter", [0.37, 1.91, 3.14]],
  ])("does not quantize %s source attacks when meter phase is unavailable", (_label, starts) => {
    const source = starts.flatMap((start, index) => [
      note(72 + index, start, 0.4, 100, "R"),
      note(48 + index, start, 0.3, 60, "L"), note(52 + index, start, 0.3, 60, "L"),
      note(55 + index, start, 0.3, 60, "L"), note(60 + index, start, 0.3, 60, "L"),
    ]);
    const result = buildMelodyAccompaniment(source, [], {
      durationBeats: Math.max(...starts) + 1,
      selection: "right-hand",
      sourceFingerprint: "fixture-source-v2",
    });

    expect([...new Set(result.notes.filter((item) => item.hand === "L").map((item) => item.start))]).toEqual(starts);
  });

  it("drops held support before exceeding three sounding notes while preserving melody", () => {
    const result = build(
      [
        note(72, 0, 2, 100, "R"),
        note(48, 0, 2, 60, "L"), note(52, 0, 2, 60, "L"),
        note(55, 1, 1, 60, "L"), note(59, 1, 1, 60, "L"),
      ],
      [chord(0, "C", 2)],
      "right-hand",
      2,
    );
    const support = result.events.filter((event) => event.role === "accompaniment" && event.note.hand === "L");

    for (const beat of [0.5, 1.5]) {
      const active = support.filter((event) => event.note.start <= beat && event.note.start + event.note.dur > beat);
      expect(active.length).toBeLessThanOrEqual(3);
      expect(active.length === 0 ? 0 : Math.max(...active.map((event) => event.note.midi)) - Math.min(...active.map((event) => event.note.midi))).toBeLessThanOrEqual(12);
    }
    expect(result.melody).toHaveLength(1);
    expect(result.melody[0]).toMatchObject(note(72, 0, 2, 100, "R"));
    expect(result.provenance.sourceSupportNoteCount).toBe(3);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 1, endBeat: 2, reason: "sounding limit exceeded" });
  });

  it("trims a held support only after a late collision and preserves its earlier lineage", () => {
    const result = build(
      [
        note(72, 0, 8, 100, "R"),
        note(48, 0, 8, 60, "L"), note(52, 0, 8, 60, "L"), note(55, 0, 8, 60, "L"),
        note(36, 7, 1, 60, "L"),
      ],
      [chord(0, "C", 8)],
      "right-hand",
      8,
    );
    const support = result.events
      .filter((event) => event.role === "accompaniment" && event.note.hand === "L")
      .map((event) => [event.note.midi, event.note.start, event.note.dur, event.sourceNoteIds.length] as const);

    expect(support).toEqual([
      [48, 0, 8, 1], [52, 0, 7, 1], [55, 0, 7, 1], [36, 7, 1, 1],
    ]);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 7, endBeat: 8, reason: "sounding limit exceeded" });
    expect(result.events.some((event) => event.note.midi === 52 && event.note.start === 0 && event.note.dur === 8)).toBe(false);
  });

  it("counts retained-unclassified same-hand sound before accepting support", () => {
    const result = enforceAccompanimentSoundingLimits([
      { id: "melody", note: note(72, 0, 4, 100, "L"), role: "melody", sourceNoteIds: ["melody"] },
      { id: "retained", note: note(60, 0, 4, 70, "L"), role: "retained-unclassified", sourceNoteIds: ["retained"] },
      { id: "support", note: note(48, 0, 4, 50, "L"), role: "accompaniment", sourceNoteIds: ["support"] },
      { id: "generated", note: note(52, 0, 4, 50, "L"), role: "accompaniment", sourceNoteIds: [] },
    ]);

    expect(result.events.map((event) => event.id)).toEqual(["melody", "retained"]);
    expect(result.fallbackSpans).toEqual([{ startBeat: 0, endBeat: 4, reason: "sounding limit exceeded" }]);
  });

  it("counts a reattack created by an interior sounding trim", () => {
    const result = enforceAccompanimentSoundingLimits([
      { id: "melody", note: note(72, 0, 8, 100, "R"), role: "melody", sourceNoteIds: ["melody"] },
      { id: "bass", note: note(48, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["bass"] },
      { id: "mid", note: note(52, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["mid"] },
      { id: "top", note: note(55, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["top"] },
      { id: "retained", note: note(60, 3, 1, 70, "L"), role: "retained-unclassified", sourceNoteIds: ["retained"] },
    ]);

    expect(result.events.filter((event) => event.sourceNoteIds.includes("top")).map((event) => [event.note.start, event.note.dur])).toEqual([[0, 3], [4, 4]]);
    expect(result.reattackCount).toBe(1);
    expect(result.fallbackSpans).toEqual([{ startBeat: 3, endBeat: 4, reason: "sounding limit exceeded" }]);
  });

  it("chooses the coherent complete-phrase candidate and compares rendered audio", () => {
    const events: ArrangementEvent[] = [
      { id: "melody", note: note(72, 0, 8, 100, "R"), role: "melody", sourceNoteIds: ["melody"] },
      { id: "bass", note: note(48, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["bass"] },
      { id: "mid", note: note(52, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["mid"] },
      { id: "top", note: note(55, 0, 8, 50, "L"), role: "accompaniment", sourceNoteIds: ["top"] },
      { id: "retained", note: note(60, 3, 1, 70, "L"), role: "retained-unclassified", sourceNoteIds: ["retained"] },
    ];
    const resume = enforceAccompanimentSoundingLimits(events, { policy: "resume" });
    const coherent = enforceAccompanimentSoundingLimits(events, { policy: "coherent-phrase" });
    const resumeAudio = renderPhrase(resume.events, 0, 8);
    const coherentAudio = renderPhrase(coherent.events, 0, 8);
    const difference = resumeAudio.reduce((sum, value, index) => sum + Math.abs(value - (coherentAudio[index] ?? 0)), 0);

    expect(resume.reattackCount).toBe(1);
    expect(coherent.reattackCount).toBe(0);
    expect(coherent.events.filter((event) => event.sourceNoteIds.includes("top")).map((event) => [event.note.start, event.note.dur])).toEqual([[0, 3]]);
    expect(resumeAudio.some((value) => Math.abs(value) > 0.001)).toBe(true);
    expect(coherentAudio.some((value) => Math.abs(value) > 0.001)).toBe(true);
    expect(difference).toBeGreaterThan(0.1);
  });

  it("drops a same-pitch support collision instead of moving the selected melody", () => {
    const result = build(
      [note(72, 0, 2, 100, "R"), note(72, 0, 2, 60, "L")],
      [chord(0, "C", 2)],
      "right-hand",
      2,
    );

    expect(result.melody).toHaveLength(1);
    expect(result.melody[0]).toMatchObject(note(72, 0, 2, 100, "R"));
    expect(result.notes).toEqual([note(72, 0, 2, 100, "R")]);
    expect(result.provenance.sourceSupportNoteCount).toBe(0);
    expect(result.fallbackSpans).toContainEqual({ startBeat: 0, endBeat: 2, reason: "sounding limit exceeded" });
  });

  it("fails closed when a source arrangement has no notes", () => {
    const result = build([], [chord(0, "C", 2)], "automatic", 2);

    expect(result.chords).toEqual([]);
    expect(result.guidanceNotes).toEqual([]);
    expect(result.fallbackSpans).toEqual([{ startBeat: 0, endBeat: 2, reason: "no source notes" }]);
    expect(result.provenance.generatedBeats).toBe(0);
  });

  it("subtracts a sustained non-melody across a no-chord gap without truncating held melody", () => {
    const heldMelody = note(72, 0, 4, 100, "R");
    const sustainedSupport = note(48, 0, 4, 60, "L");
    const result = build(
      [heldMelody, sustainedSupport],
      [chord(0, "C", 2), chord(2, "N.C.", 1), chord(3, "F", 1)],
      "right-hand",
      4,
    );

    expect(result.chords.map((item) => item.beat)).toEqual([0, 3]);
    expect(result.notes).toContainEqual(heldMelody);
    expect(result.notes.find((item) => item.midi === 72)?.dur).toBe(4);
    expect(result.notes.filter((item) => item.midi === 48)).toEqual([sustainedSupport]);
  });

  it("feeds generated chords to playback while grading the same guidance events", () => {
    const result = build(
      [note(72, 0, 1, 100, "R"), note(48, 0, 1, 60, "L")],
      [chord(0, "C", 2)],
      "automatic",
      2,
    );
    const toTimed = (item: Note): TimedNote => ({
      midi: item.midi,
      startSec: item.start * 0.5,
      durSec: item.dur * 0.5,
      vel: item.vel,
      hand: item.hand,
    });
    const audio = new AudioSpy();
    const engine = new PlaybackEngine(
      audio,
      result.notes.map(toTimed),
      1,
      { tempoBpm: 120, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      result.chords,
      result.guidanceNotes.map(toTimed),
    );

    engine.start();

    expect(audio.noteOns).toEqual([48, 72]);
    expect(audio.playedChords[0]).toEqual(result.chords[0]!.notes);
    expect(engine.gradingNotes.map((item) => item.midi)).toEqual(result.guidanceNotes.map((item) => item.midi));
  });

  it("keeps melody-accompaniment support on the note path when chord audio is disabled", () => {
    const result = build(
      [note(72, 0, 1, 100, "R"), note(48, 0, 1, 60, "L")],
      [chord(0, "C", 2)],
      "right-hand",
      2,
    );
    const toTimed = (item: Note): TimedNote => ({
      midi: item.midi,
      startSec: item.start * 0.5,
      durSec: item.dur * 0.5,
      vel: item.vel,
      hand: item.hand,
    });
    const audio = new AudioSpy();
    const engine = new PlaybackEngine(
      audio,
      result.notes.map(toTimed),
      1,
      { tempoBpm: 120, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      [],
      result.guidanceNotes.map(toTimed),
    );

    engine.start();

    expect(audio.playedChords).toEqual([]);
    expect(audio.noteOns).toEqual(result.notes.map((item) => item.midi));
  });

  it("builds a bounded preview plan with held melody and the active chord remainder", () => {
    const result = build(
      [note(72, 0, 4, 100, "R"), note(48, 0, 4, 60, "L")],
      [chord(0, "C", 4)],
      "right-hand",
      4,
    );
    const toTimed = (item: Note): TimedNote => ({
      midi: item.midi,
      startSec: item.start * 0.5,
      durSec: item.dur * 0.5,
      vel: item.vel,
      hand: item.hand,
    });
    const engine = new PlaybackEngine(
      new AudioSpy(),
      result.melody.map(toTimed),
      2,
      { tempoBpm: 120, timeSig: [4, 4] },
      { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      result.chords,
      result.guidanceNotes.map(toTimed),
    );

    const preview = engine.previewPlan(1, 1.5);

    expect(preview.notes).toHaveLength(1);
    expect(preview.notes[0]).toMatchObject({ when: 0, note: { midi: 72, startSec: 0, durSec: 0.5 } });
    expect(preview.chords).toEqual([{ notes: result.chords[0]!.notes, when: 0, durationSec: 0.5 }]);
  });
});
