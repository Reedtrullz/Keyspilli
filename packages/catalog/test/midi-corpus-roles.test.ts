import { describe, expect, it } from "vitest";
import {
  classifyMidiRoles,
  measureRestrikes,
  selectMidiRoleNotes,
  songIdentitySignature,
  type CanonicalMidiRoleNote,
} from "../src/midi-corpus-roles.js";
import type { CanonicalMidi } from "../src/midi-corpus.js";

function fixture(): CanonicalMidi {
  const note = (
    trackIndex: number,
    channel: number,
    midi: number,
    startTick: number,
    endTick: number,
    percussion = false,
  ) => ({
    trackIndex,
    channel,
    midi,
    velocity: 80,
    startTick,
    endTick,
    startBeats: startTick / 480,
    durationBeats: (endTick - startTick) / 480,
    program: 0,
    percussion,
  });
  return {
    schemaVersion: 1,
    format: 1,
    division: 480,
    title: "Synthetic song",
    tempos: [],
    timeSignatures: [],
    keySignatures: [],
    tracks: [
      { index: 0, name: "Lead", channels: [0], programs: [], percussion: false, endTick: 960, notes: [] },
      { index: 1, name: "Piano harmony", channels: [1], programs: [], percussion: false, endTick: 960, notes: [] },
      { index: 2, name: "Bass", channels: [2], programs: [], percussion: false, endTick: 960, notes: [] },
      { index: 3, name: "Drums", channels: [9], programs: [], percussion: true, endTick: 960, notes: [] },
    ],
    notes: [
      note(0, 0, 72, 0, 480), note(0, 0, 72, 480, 720), note(0, 0, 72, 600, 960), note(0, 0, 74, 960, 1_200),
      note(1, 1, 60, 0, 480), note(1, 1, 64, 0, 480), note(1, 1, 62, 480, 960), note(1, 1, 65, 480, 960),
      note(2, 2, 36, 0, 480), note(2, 2, 40, 480, 960),
      note(3, 9, 36, 0, 120, true), note(3, 9, 36, 480, 600, true),
    ],
  };
}

function singleTrackPianoFixture(order: "forward" | "reverse" = "forward"): CanonicalMidi {
  const note = (midi: number, startBeats: number, durationBeats = 0.5) => ({
    trackIndex: 0,
    channel: 0,
    midi,
    velocity: 80,
    startTick: Math.round(startBeats * 480),
    endTick: Math.round((startBeats + durationBeats) * 480),
    startBeats,
    durationBeats,
    program: 0,
    percussion: false,
  });
  const notes = [
    note(48, 0), note(60, 0), note(64, 0),
    // These two attacks are deliberately jittered but belong to one onset.
    note(50, 1), note(62, 1), note(65, 1.05),
    // The 85 is a high chord tone, but the previous upper voice can continue
    // through 67 without an implausible octave-plus leap.
    note(40, 2), note(67, 2), note(85, 2),
  ];
  return {
    schemaVersion: 1,
    format: 0,
    division: 480,
    title: "Synthetic piano target",
    tempos: [],
    timeSignatures: [],
    keySignatures: [],
    tracks: [{ index: 0, name: "Elec. Piano (Classic)", channels: [0], programs: [], percussion: false, endTick: 1_440, notes: [] }],
    notes: order === "forward" ? notes : [...notes].reverse(),
  };
}

describe("MIDI corpus role layers", () => {
  it("classifies named lanes and preserves deterministic role projections", () => {
    const layers = classifyMidiRoles(fixture());
    expect(Object.fromEntries(layers.lanes.map((lane) => [lane.stats.trackName, lane.role]))).toEqual({
      Lead: "melody",
      "Piano harmony": "harmony",
      Bass: "bass",
      Drums: "rhythm",
    });
    expect(layers.all.map((note) => `${note.startTick}:${note.midi}`)).toEqual([
      "0:36", "0:36", "0:60", "0:64", "0:72", "480:36", "480:40", "480:62", "480:65", "480:72", "600:72", "960:74",
    ]);
    expect(layers.byRole.melody.every((note) => note.role === "melody")).toBe(true);
    expect(layers.semantic.fullSymbolic.every((note) => note.percussion !== true)).toBe(true);
    expect(layers.semantic.fullSymbolic).toHaveLength(layers.all.filter((note) => note.percussion !== true).length);
  });

  it("hashes song identity independently of note ordering", () => {
    const first = fixture();
    const second = { ...first, notes: [...first.notes].reverse() };
    expect(songIdentitySignature(first)).toBe(songIdentitySignature(second));
    expect(songIdentitySignature({ ...first, title: "A different song" })).not.toBe(songIdentitySignature(first));
  });

  it("counts contiguous and overlapping same-pitch attacks without merging them", () => {
    const layers = classifyMidiRoles(fixture());
    const result = measureRestrikes(layers.byRole.melody as readonly CanonicalMidiRoleNote[]);
    expect(result.noteCount).toBe(4);
    expect(result.samePitchPairCount).toBe(2);
    expect(result.restrikeCount).toBe(2);
    expect(result.contiguousSamePitchCount).toBe(1);
    expect(result.overlappingSamePitchCount).toBe(1);
    expect(result.minGapTicks).toBe(-120);
    expect(result.byRole.melody?.samePitchPairCount).toBe(2);
  });

  it("decomposes a single-track piano target into deterministic semantic layers", () => {
    const layers = classifyMidiRoles(singleTrackPianoFixture());

    expect(layers.semantic.pianoTarget).toHaveLength(9);
    expect(layers.semantic.melody.map((value) => `${value.startBeats}:${value.midi}`)).toEqual([
      "0:64", "1.05:65", "2:67",
    ]);
    expect(layers.semantic.bassRoot.map((value) => `${value.startBeats}:${value.midi}`)).toEqual([
      "0:48", "1:50", "2:40",
    ]);
    expect(layers.semantic.rhythmAttacks).toEqual(layers.semantic.bassRoot);
    expect(layers.semantic.harmony.map((value) => `${value.startBeats}:${value.midi}`)).toEqual([
      "0:48", "0:60", "1:50", "1:62", "2:40", "2:85",
    ]);
    expect(layers.semantic.melody.every((value) => value.semanticRole === "PIANO_FULL")).toBe(true);
    expect(layers.semantic.melody.every((value) => layers.semantic.pianoTarget.includes(value))).toBe(true);
  });

  it("keeps piano layer projections stable when input note order changes", () => {
    const first = classifyMidiRoles(singleTrackPianoFixture("forward"));
    const second = classifyMidiRoles(singleTrackPianoFixture("reverse"));
    const signature = (values: readonly CanonicalMidiRoleNote[]) => values.map((value) => [value.startTick, value.midi, value.endTick]);
    expect(signature(second.semantic.melody)).toEqual(signature(first.semantic.melody));
    expect(signature(second.semantic.harmony)).toEqual(signature(first.semantic.harmony));
    expect(signature(second.semantic.bassRoot)).toEqual(signature(first.semantic.bassRoot));
    expect(signature(second.semantic.rhythmAttacks)).toEqual(signature(first.semantic.rhythmAttacks));
  });

  it("selects semantic role projections without mixing percussion into pitched roles", () => {
    const layers = classifyMidiRoles(fixture());
    expect(selectMidiRoleNotes(layers, "melody").map((value) => value.midi)).toEqual([72, 72, 72, 74]);
    expect(selectMidiRoleNotes(layers, "harmony").every((value) => value.percussion !== true)).toBe(true);
    expect(selectMidiRoleNotes(layers, "rhythm").every((value) => value.percussion === true)).toBe(true);
    expect(selectMidiRoleNotes(layers, "full-symbolic").every((value) => value.percussion !== true)).toBe(true);
  });

  it("distinguishes lead and rhythm guitar lanes deterministically", () => {
    const base = fixture();
    const notes = [
      { ...base.notes[0]!, trackIndex: 4, channel: 4, midi: 76, startTick: 0, endTick: 240, startBeats: 0, durationBeats: 0.5 },
      { ...base.notes[1]!, trackIndex: 4, channel: 4, midi: 77, startTick: 480, endTick: 720, startBeats: 1, durationBeats: 0.5 },
      { ...base.notes[0]!, trackIndex: 5, channel: 5, midi: 52, startTick: 0, endTick: 480, startBeats: 0, durationBeats: 1 },
      { ...base.notes[1]!, trackIndex: 5, channel: 5, midi: 55, startTick: 480, endTick: 960, startBeats: 1, durationBeats: 1 },
    ];
    const extended = {
      ...base,
      tracks: [...base.tracks,
        { index: 4, name: "Lead Guitar", channels: [4], programs: [29], percussion: false, endTick: 960, notes: [] },
        { index: 5, name: "Rhythm Guitar", channels: [5], programs: [27], percussion: false, endTick: 960, notes: [] },
      ],
      notes: [...base.notes, ...notes],
    } as unknown as CanonicalMidi;
    const layers = classifyMidiRoles(extended);
    const lead = layers.lanes.find((lane) => lane.stats.trackName === "Lead Guitar");
    const rhythm = layers.lanes.find((lane) => lane.stats.trackName === "Rhythm Guitar");
    expect(lead).toMatchObject({ role: "melody", reason: "track-name:melody" });
    expect(rhythm).toMatchObject({ role: "harmony", reason: "track-name:harmony" });
    expect(selectMidiRoleNotes(layers, "melody").some((value) => value.laneKey === lead?.laneKey)).toBe(true);
  });
});
