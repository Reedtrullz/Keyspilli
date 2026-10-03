import { describe, expect, it } from "vitest";
import { parseMidi, selectSourceParts, writeMidi, type Note } from "../src/index.js";

const note = (midi: number, start: number, dur = 0.5): Note => ({ midi, start, dur, vel: 84 });

describe("symbolic source part selection", () => {
  it("exposes named and unnamed MIDI parts and keeps overlapping pitch ranges separate", () => {
    const melody = [note(60, 0), note(64, 1)];
    const harmony = [note(60, 0), note(67, 1)];
    const parsed = parseMidi(writeMidi([...melody, ...harmony], {
      tempoBpm: 120,
      tracks: [
        { name: "Lead", notes: melody },
        { name: "", notes: harmony },
      ],
    }));
    expect(parsed.sourceParts?.map(({ id, name, lowMidi, highMidi }) => ({ id, name, lowMidi, highMidi }))).toEqual([
      { id: "midi:0", name: "Lead", lowMidi: 60, highMidi: 64 },
      { id: "midi:1", name: "Track 2", lowMidi: 60, highMidi: 67 },
    ]);
    expect(selectSourceParts(parsed, ["midi:1"]).notes.map(({ midi }) => midi)).toEqual([60, 67]);
  });

  it("reports percussion separately and refuses it as a pitched source", () => {
    const drums = [note(36, 0)];
    const piano = [note(60, 0)];
    const parsed = parseMidi(writeMidi([...piano, ...drums], {
      tempoBpm: 120,
      tracks: [
        { name: "Piano", notes: piano },
        { name: "Drums", notes: drums, percussion: true },
      ],
    }));
    expect(parsed.sourceParts?.map(({ name, percussion }) => [name, percussion === true])).toEqual([
      ["Piano", false], ["Drums", true],
    ]);
    expect(() => selectSourceParts(parsed, ["midi:1"])).toThrow(/percussion/i);
    expect(selectSourceParts(parsed, ["midi:0"]).notes.map(({ midi }) => midi)).toEqual([60]);
  });

  it("rejects empty, duplicate, and unknown source-part selections", () => {
    const parsed = parseMidi(writeMidi([note(60, 0)], { tempoBpm: 120 }));
    expect(() => selectSourceParts(parsed, [])).toThrow(/select at least one/i);
    expect(() => selectSourceParts(parsed, ["midi:0", "midi:0"])).toThrow(/unique/i);
    expect(() => selectSourceParts(parsed, ["missing"])).toThrow(/unknown source part/i);
  });
});
