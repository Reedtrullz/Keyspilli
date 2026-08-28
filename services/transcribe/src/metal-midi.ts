import type { Note } from "@keyspilli/midi";

export interface MetalMidiTrack {
  name: string;
  notes: Note[];
}

/**
 * Keep role-aware metal lanes recoverable when the arranged MIDI crosses the
 * worker/catalog boundary.  MIDI note events do not carry Keyspilli's
 * `identitySource`, so the track names are the provenance channel consumed by
 * `parseMidi`.  In particular, rhythm guitar must not share the generic LH
 * track with harmonic roots or the learner reducer will mistake its wall for
 * a chord texture and retain every attack.
 */
export function metalArrangementTracks(notes: readonly Note[]): MetalMidiTrack[] {
  const by = (predicate: (note: Note) => boolean): Note[] => notes.filter(predicate).map((note) => ({ ...note }));
  const right = (source?: Note["identitySource"]): Note[] => by((note) => note.hand !== "L" && note.identitySource === source);
  const leftRhythm = (source: Note["identitySource"]): Note[] => by((note) => note.hand === "L" && note.identitySource === source);

  return [
    { name: "Right Hand Vocals", notes: right("vocals") },
    { name: "Right Hand Guitar", notes: right("guitar") },
    { name: "Right Hand Other", notes: right("other") },
    { name: "Right Hand", notes: by((note) => note.hand !== "L" && note.identitySource === undefined) },
    { name: "Left Hand Rhythm Guitar", notes: leftRhythm("guitar") },
    { name: "Left Hand Rhythm Other", notes: leftRhythm("other") },
    { name: "Left Hand Chords", notes: by((note) => note.hand === "L" && note.identitySource === undefined) },
  ];
}
