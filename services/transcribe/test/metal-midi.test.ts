import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi, type Note } from "@keyspilli/midi";
import { metalArrangementTracks } from "../src/metal-midi.js";

describe("metal arrangement MIDI tracks", () => {
  it("keeps the rhythm-guitar lane identifiable after a MIDI roundtrip", () => {
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 1, vel: 96, hand: "R", identitySource: "vocals" },
      { midi: 64, start: 0.5, dur: 0.5, vel: 80, hand: "R", identitySource: "guitar" },
      { midi: 43, start: 0, dur: 1, vel: 68, hand: "L" },
      { midi: 38, start: 0.25, dur: 0.5, vel: 54, hand: "L", identitySource: "guitar" },
      { midi: 40, start: 0.75, dur: 0.5, vel: 52, hand: "L", identitySource: "other" },
    ];
    const tracks = metalArrangementTracks(notes);
    expect(tracks.map((track) => track.name)).toEqual([
      "Right Hand Vocals",
      "Right Hand Guitar",
      "Right Hand Other",
      "Right Hand",
      "Left Hand Rhythm Guitar",
      "Left Hand Rhythm Other",
      "Left Hand Chords",
    ]);

    const parsed = parseMidi(writeMidi(notes, {
      tempoBpm: 120,
      tracks,
    }));
    expect(parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "guitar")).toHaveLength(1);
    expect(parsed.notes.filter((note) => note.hand === "L" && note.identitySource === "other")).toHaveLength(1);
    expect(parsed.notes.filter((note) => note.hand === "L" && !note.identitySource)).toHaveLength(1);
    expect(parsed.notes.filter((note) => note.hand === "R" && note.identitySource === "vocals")).toHaveLength(1);
    expect(parsed.notes.filter((note) => note.hand === "R" && note.identitySource === "guitar")).toHaveLength(1);
  });
});
