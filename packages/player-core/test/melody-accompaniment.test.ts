import { describe, expect, it } from "vitest";
import type { ChordLabel, Note } from "@keyspilli/midi";
import {
  buildMelodyAccompaniment,
  type MelodySelection,
} from "../src/accompaniment.js";
import { DEFAULT_SETTINGS, PlaybackEngine, type AudioLike, type TimedNote } from "../src/index.js";

function note(midi: number, start: number, dur = 1, vel = 80, hand?: Note["hand"]): Note {
  return { midi, start, dur, vel, ...(hand ? { hand } : {}) };
}

function chord(beat: number, name: string, durationBeats: number): ChordLabel {
  return { beat, name, durationBeats, notes: [] };
}

function build(notes: Note[], chords: ChordLabel[], selection?: MelodySelection, durationBeats = 8) {
  return buildMelodyAccompaniment(notes, chords, { selection, durationBeats, sourceFingerprint: "fixture-source-v1" });
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
      generatorVersion: "melody-accompaniment.v1",
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

  it("uses a quality-aware pulse for a power chord without inventing its third", () => {
    const result = build(
      [note(72, 0, 3, 100, "R")],
      [chord(0, "C5", 3)],
      "right-hand",
      3,
    );
    const support = result.notes.filter((item) => item.hand === "L");

    expect([...new Set(support.map((item) => item.start))]).toEqual([0, 1, 2]);
    expect(new Set(support.map((item) => item.midi % 12))).toEqual(new Set([0, 7]));
    expect(support.some((item) => item.midi % 12 === 4)).toBe(false);
    expect(result.provenance).toMatchObject({
      generatedBeats: 3,
      generatedNoteCount: 6,
      sourceSupportNoteCount: 0,
      supportModes: ["quarter-note-pulse"],
    });
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

  it("keeps a held melody while support changes underneath it", () => {
    const held = note(72, 0, 4, 100, "R");
    const result = build(
      [held, note(48, 0, 1, 60, "L"), note(53, 2, 1, 60, "L")],
      [chord(0, "C", 2), chord(2, "F", 2)],
      "automatic",
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
    expect(result.notes).toContainEqual({ ...heldSupport, hand: "L" });
    expect(result.notes.find((item) => item.midi === heldSupport.midi)?.hand).toBe("L");
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

  it("surfaces duplicate-onset ambiguity and offers a right-hand correction", () => {
    const notes = [note(72, 0, 1, 80, "R"), note(72, 0, 1, 80, "R"), note(60, 1, 1, 80, "R")];
    const inferred = build(notes, [chord(0, "C", 2)], "automatic", 2);
    const corrected = build(notes, [chord(0, "C", 2)], "right-hand", 2);

    expect(inferred.provenance.unresolvedSpans.length).toBeGreaterThan(0);
    expect(inferred.chords).toEqual([]);
    expect(inferred.notes).toEqual(notes);
    expect(inferred.fallbackSpans[0]!.reason).toBe("ambiguous melody");
    expect(corrected.provenance.selection).toBe("right-hand");
    expect(corrected.provenance.selectionProvenance).toBe("user-confirmed");
    expect(corrected.melody).toHaveLength(3);
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
