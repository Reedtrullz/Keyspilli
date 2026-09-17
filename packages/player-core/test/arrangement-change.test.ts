import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import {
  buildMelodyAccompaniment,
  measureArrangementChanges,
  sourceNoteIds,
  type ArrangementEvent,
} from "../src/accompaniment.js";

function note(midi: number, start: number, dur = 1, vel = 80, hand?: Note["hand"]): Note {
  return { midi, start, dur, vel, ...(hand ? { hand } : {}) };
}

function event(id: string, noteValue: Note, sourceNoteIds: readonly string[] = []): ArrangementEvent {
  return { id, note: noteValue, role: "retained-unclassified", sourceNoteIds };
}

describe("melody arrangement change accounting", () => {
  it("does not count a hand-only reassignment as an audible change", () => {
    const source = [note(60, 0, 1, 70, "R"), note(72, 0, 1, 100, "R")];
    const result = buildMelodyAccompaniment(source, [{ beat: 0, name: "C", notes: [], durationBeats: 1 }], {
      durationBeats: 2,
      sourceFingerprint: "fixture-source-v2",
      selection: "automatic",
    });

    expect(result.changeSummary).toMatchObject({ changedBeats: 0, unchangedBeats: 1, silentBeats: 1 });
    expect(result.notes).toEqual(result.events.map(({ note: output }) => output));
    expect(result.provenance.generatorVersion).toBe("melody-accompaniment.v2");
  });

  it("counts a changed velocity as an altered source event", () => {
    const source = [note(72, 0, 1, 80, "R")];
    const [sourceId] = sourceNoteIds(source);
    const summary = measureArrangementChanges(
      source,
      [event("event:0", note(72, 0, 1, 81, "L"), [sourceId!])],
      1,
    );

    expect(summary).toMatchObject({ changedBeats: 1, unchangedBeats: 0, silentBeats: 0, alteredNotes: 1, addedNotes: 0, removedNotes: 0 });
  });

  it("treats a missing rendered note as changed audio, not retained annotation", () => {
    const summary = measureArrangementChanges([note(60, 0, 1)], [], 2);

    expect(summary).toMatchObject({ changedBeats: 1, unchangedBeats: 0, silentBeats: 1, removedNotes: 1 });
  });

  it("unions adjacent changed intervals without double counting", () => {
    const source = [note(60, 0, 2)];
    const [sourceId] = sourceNoteIds(source);
    const summary = measureArrangementChanges(
      source,
      [
        event("event:0", note(61, 0, 1), [sourceId!]),
        event("event:1", note(62, 1, 1), [sourceId!]),
      ],
      2,
    );

    expect(summary).toMatchObject({ changedBeats: 2, unchangedBeats: 0, silentBeats: 0, alteredNotes: 1 });
    expect(summary.changedBeats + summary.unchangedBeats + summary.silentBeats).toBe(2);
  });

  it("clips and unions overlapping review spans", () => {
    const summary = measureArrangementChanges([], [], 4, [
      { startBeat: -1, endBeat: 1 },
      { startBeat: 0.5, endBeat: 2 },
      { startBeat: 3, endBeat: 6 },
    ]);

    expect(summary.reviewBeats).toBe(3);
    expect(summary.reviewBeats).toBeLessThanOrEqual(summary.durationBeats);
  });

  it("counts one removed member of a duplicate source event group", () => {
    const source = [note(60, 0, 1, 80), note(60, 0, 1, 80)];
    const [firstSourceId] = sourceNoteIds(source);
    const summary = measureArrangementChanges(
      source,
      [event("event:0", note(60, 0, 1, 80), [firstSourceId!])],
      1,
    );

    expect(summary).toMatchObject({ changedBeats: 1, removedNotes: 1, alteredNotes: 0, addedNotes: 0 });
  });
});
