import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import { collapseUnsupportedSamePitchRetriggers, filterTranscription } from "../src/transcribe.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeMidi(): Uint8Array {
  return writeMidi(
    [
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
    ],
    { tempoBpm: 120, timeSig: [4, 4], keySig: 0, keyMode: 1 },
  );
}

describe("filterTranscription", () => {
  it("skipOnsetFilter bypasses the audio-onset check and keeps all notes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyspilli-skip-onset-"));
    dirs.push(dir);
    // Write a silent/empty audio file: the Python detector would normally fail,
    // proving that skipOnsetFilter never invokes it.
    const audioPath = join(dir, "audio.mp3");
    writeFileSync(audioPath, Buffer.alloc(2048, 0));
    const filtered = await filterTranscription(makeMidi(), audioPath, { skipOnsetFilter: true });
    expect(filtered).toBeInstanceOf(Uint8Array);
    expect(parseMidi(filtered).notes.length).toBe(2);
  });
});

describe("collapseUnsupportedSamePitchRetriggers", () => {
  const fragment = (start: number) => ({ midi: 64, start, dur: 0.2, vel: 80, hand: "R" as const });

  it("merges close continuation fragments without independent audio attacks", () => {
    const notes = [fragment(0), fragment(0.25), fragment(0.5), fragment(0.75), fragment(1)];
    const collapsed = collapseUnsupportedSamePitchRetriggers(notes, [0], 120);

    expect(collapsed).toEqual([{ ...fragment(0), dur: 1.2 }]);
  });

  it("preserves repeated attacks supported by independent audio onsets", () => {
    const notes = [fragment(0), fragment(0.25), fragment(0.5)];
    const collapsed = collapseUnsupportedSamePitchRetriggers(notes, [0, 0.125, 0.25], 120);

    expect(collapsed).toEqual(notes);
  });

  it("bounds reconstructed sustains to the learner transcription ceiling", () => {
    const notes = Array.from({ length: 9 }, (_, index) => fragment(index * 0.25));

    const collapsed = collapseUnsupportedSamePitchRetriggers(notes, [0], 120);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.map((note) => note.start)).toEqual([0, 1.5]);
    expect(collapsed[0]!.dur).toBeCloseTo(1.45);
    expect(collapsed[1]!.dur).toBeCloseTo(0.7);
  });

  it("is deterministic for reordered notes and does not merge different pitches", () => {
    const notes = [
      fragment(0.25),
      { ...fragment(0), midi: 67 },
      fragment(0),
    ];

    expect(collapseUnsupportedSamePitchRetriggers(notes, [0], 120)).toEqual(
      collapseUnsupportedSamePitchRetriggers([...notes].reverse(), [0], 120),
    );
    expect(collapseUnsupportedSamePitchRetriggers(notes, [0], 120)).toEqual([
      { ...fragment(0), dur: 0.45 },
      { ...fragment(0), midi: 67 },
    ]);
  });

  it("does not merge same-pitch events from different source lanes", () => {
    const notes = [
      { ...fragment(0), identitySource: "vocals" as const },
      { ...fragment(0.25), identitySource: "guitar" as const },
    ];

    expect(collapseUnsupportedSamePitchRetriggers(notes, [0], 120)).toEqual(notes);
  });
});
