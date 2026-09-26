import { describe, expect, it } from "vitest";
import { buildVariants, parseMidi, parseMusicXmlNotes, quantize, writeMidi } from "../src/index.js";

describe("neutral source identity", () => {
  it("merges co-onset MIDI origins onto one Advanced note through JSON serialization", () => {
    const bytes = writeMidi([], { tempoBpm: 120, tracks: [
      { name: "Vocals RH", notes: [
        { midi: 60, start: 0, dur: 1, vel: 80 },
        { midi: 64, start: 1, dur: 1, vel: 80 },
      ] },
      { name: "Accompaniment LH", notes: [
        { midi: 60, start: 0, dur: 2, vel: 80 },
        { midi: 48, start: 2, dur: 1, vel: 80 },
      ] },
    ] });
    const parsed = parseMidi(bytes);
    expect(parsed.notes.filter((note) => note.midi === 60).map((note) => note.sourceOrigins)
      .flatMap((origins) => origins?.map((origin) => origin.id) ?? []).sort()).toEqual(["midi:0:0", "midi:1:0"]);
    expect(parsed.notes.find((note) => note.sourceOrigins?.[0]?.track === 0)?.identitySource).toBe("vocals");
    expect(parsed.notes.find((note) => note.sourceOrigins?.[0]?.track === 1)?.identitySource).toBeUndefined();

    const advanced = buildVariants(parsed, { title: "Fixture", artist: "Test" }, { arrangementProfile: "source" })
      .find((variant) => variant.level === "advanced")!;
    const roundTripped = JSON.parse(JSON.stringify(advanced));
    // One physical key press: both source origins survive on it, and the
    // conflicting vocal/unlabelled parents leave it without a semantic role.
    const samePitch = roundTripped.notes.filter((note: { midi: number; start: number }) => note.midi === 60 && note.start === 0);
    expect(samePitch).toHaveLength(1);
    expect(samePitch[0].sourceOrigins.map((origin: { id: string }) => origin.id)).toEqual(["midi:0:0", "midi:1:0"]);
    expect(samePitch[0].identitySource).toBeUndefined();

    const reversed = buildVariants({ ...parsed, notes: [...parsed.notes].reverse() },
      { title: "Fixture", artist: "Test" }, { arrangementProfile: "source" })
      .find((variant) => variant.level === "advanced")!;
    expect(reversed.notes.filter((note) => note.midi === 60)
      .flatMap((note) => note.sourceOrigins?.map((origin) => origin.id) ?? []).sort())
      .toEqual(["midi:0:0", "midi:1:0"]);

    const canto = parseMidi(writeMidi([], { tempoBpm: 120, tracks: [
      { name: "CANTO", notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }] },
    ] }));
    expect(canto.notes[0]?.identitySource).toBeUndefined();
  });

  it("keeps MusicXML staff and voice origins for matching co-onset notes", () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff><lyric><text>la</text></lyric></note><forward><duration>3</duration></forward><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><staff>2</staff></note><forward><duration>3</duration></forward></measure></part></score-partwise>`;
    const parsed = parseMusicXmlNotes(xml);
    const notes = parsed.notes.filter((note) => note.midi === 60);
    expect(notes.map((note) => note.sourceOrigins)).toEqual([
      [{ id: "musicxml:1:1:0", staff: "1", voice: "1" }],
      [{ id: "musicxml:2:2:1", staff: "2", voice: "2" }],
    ]);
    expect(notes.every((note) => note.identitySource === undefined)).toBe(true);
    const advanced = buildVariants(parsed, { title: "Two staves", artist: "Test" }, { arrangementProfile: "source" })
      .find((variant) => variant.level === "advanced")!;
    const roundTripped = JSON.parse(JSON.stringify(advanced));
    const merged = roundTripped.notes.filter((note: { midi: number }) => note.midi === 60);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceOrigins.map((origin: { id: string }) => origin.id)).toEqual(["musicxml:1:1:0", "musicxml:2:2:1"]);
  });

  it("unions tied segment origins when reconstructing a MusicXML note", () => {
    const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><staff>1</staff></note></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>`;
    const note = parseMusicXmlNotes(xml).notes[0]!;
    expect(note.dur).toBe(5);
    expect(note.sourceOrigins?.map((origin) => origin.id)).toEqual(["musicxml:1:1:0", "musicxml:1:1:1"]);
  });

  it("keeps quantized collision lineage without promoting conflicting roles", () => {
    const [merged] = quantize([
      { midi: 60, start: 0, dur: 1, vel: 80, identitySource: "vocals", sourceOrigins: [{ id: "vocal", track: 0 }] },
      { midi: 60, start: 0, dur: 1, vel: 80, sourceOrigins: [{ id: "unknown", track: 0 }] },
    ]);
    expect(merged?.sourceOrigins?.map((origin) => origin.id)).toEqual(["unknown", "vocal"]);
    expect(merged?.identitySource).toBeUndefined();
  });

  it("never leaves one key struck twice at once or overlapping itself in a learner level", () => {
    const parsed = parseMidi(writeMidi([], { tempoBpm: 120, tracks: [
      { name: "Piano RH", notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }, { midi: 64, start: 0, dur: 1, vel: 80 }] },
      { name: "Strings", notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }, { midi: 60, start: 0.5, dur: 1, vel: 80 }] },
    ] }));
    const variants = buildVariants(parsed, { title: "Doubled", artist: "Test" }, { arrangementProfile: "source" });
    for (const variant of variants) {
      const attacks = variant.notes.map((note) => `${note.midi}:${note.start}`);
      expect(new Set(attacks).size, variant.level).toBe(attacks.length);
    }
    const advanced = variants.find((variant) => variant.level === "advanced")!;
    expect(advanced.notes.filter((note) => note.midi === 60).flatMap((note) => note.sourceOrigins?.map((origin) => origin.id) ?? []).sort())
      .toEqual(["midi:0:0", "midi:1:0", "midi:1:1"]);
    const medium = variants.find((variant) => variant.level === "medium")!;
    const c4 = medium.notes.filter((note) => note.midi === 60).sort((a, b) => a.start - b.start);
    for (let i = 1; i < c4.length; i++) expect(c4[i - 1]!.start + c4[i - 1]!.dur).toBeLessThanOrEqual(c4[i]!.start + 1e-9);
  });
});
