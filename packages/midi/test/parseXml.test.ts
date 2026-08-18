import { describe, expect, it } from "vitest";
import { parseMusicXmlNotes, parseMidi, buildVariants, writeMusicXml, Variant } from "../src/index.js";

const HEX = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
const SCALE_MIDI = HEX(`
  4d 54 68 64 00 00 00 06 00 00 00 01 01 e0
  4d 54 72 6b 00 00 00 64
  00 ff 51 03 07 a1 20 00 ff 58 04 04 02 18 08
  00 ff 59 02 00 00 00 c0 00 00 90 3c 64 83 60 80 3c 40
  00 90 3e 64 83 60 80 3e 40 00 90 40 64 83 60 80 40 40
  00 90 41 64 83 60 80 41 40 00 90 43 64 83 60 80 43 40
  00 90 45 64 83 60 80 45 40 00 90 47 64 83 60 80 47 40
  00 90 48 64 83 60 80 48 40 00 ff 2f 00
`);

describe("parseMusicXmlNotes", () => {
  it("round-trips interleaved grand-staff note starts", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
        { midi: 48, start: 0.5, dur: 1, vel: 80, hand: "L" },
        { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const parsed = parseMusicXmlNotes(writeMusicXml(variant, "Interleaved", "Test"));
    expect(parsed.notes.map((n) => [n.midi, n.start])).toEqual([
      [60, 0],
      [48, 0.5],
      [64, 1],
    ]);
  });

  it("keeps following attacks after a chord whose members have different durations", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
        { midi: 64, start: 0, dur: 2, vel: 80, hand: "R" },
        { midi: 67, start: 1, dur: 1, vel: 80, hand: "R" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const parsed = parseMusicXmlNotes(writeMusicXml(variant, "Different durations", "Test"));
    expect(parsed.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 1],
      [64, 0, 2],
      [67, 1, 1],
    ]);
  });

  it("splits cross-measure sustains into ties and merges them on parse", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 3, dur: 2, vel: 80, hand: "R" },
        { midi: 48, start: 4, dur: 1, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ],
    };
    const xml = writeMusicXml(variant, "Tie", "Test");
    expect(xml).toContain("<tie type=\"start\"/>");
    expect(xml).toContain("<tie type=\"stop\"/>");
    const parsed = parseMusicXmlNotes(xml);
    expect(parsed.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 3, 2],
      [48, 4, 1],
    ]);
  });

  it("pads both grand-staff streams to the measure boundary", () => {
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
        { midi: 48, start: 2.5, dur: 0.5, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const xml = writeMusicXml(variant, "Padded staff", "Test");
    const measure = xml.match(/<measure(?:[ >])[^>]*>[\s\S]*?<\/measure>/)?.[0] ?? "";
    // The RH stream is followed by a full-measure backup before the LH stream;
    // the LH stream itself ends with a forward to the same boundary.
    expect(measure).toContain('<backup><duration>3840</duration></backup>');
    expect(measure).toMatch(/<staff>2<\/staff>[\s\S]*?<forward><duration>960<\/duration><\/forward><\/measure>$/);
    expect(parseMusicXmlNotes(xml).notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [60, 0, 1],
      [48, 2.5, 0.5],
    ]);
  });

  it("keeps overlapping same-pitch tie chains on their original voices", () => {
    // Both notes cross the same barline and therefore have continuations at
    // one onset. Matching by pitch/start alone would swap their durations.
    const variant: Variant = {
      level: "advanced",
      difficultyScore: 0,
      notes: [
        { midi: 50, start: 3, dur: 1.25, vel: 80, hand: "L" },
        { midi: 50, start: 3.5, dur: 2.75, vel: 80, hand: "L" },
      ],
      chords: [],
      bassPattern: "block",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 8 },
      ],
    };
    const parsed = parseMusicXmlNotes(writeMusicXml(variant, "Overlapping ties", "Test"));
    expect(parsed.notes.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [50, 3, 1.25],
      [50, 3.5, 2.75],
    ]);
  });

  it("merges external MusicXML tie and tied notation elements", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><tie type="start"/><voice>1</voice></note></measure>
<measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><tie type="stop"/><voice>1</voice><notations><tied type="stop"/></notations></note></measure></part></score-partwise>`;
    const parsed = parseMusicXmlNotes(xml);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]).toMatchObject({ midi: 60, start: 0, dur: 8 });
  });

  it("round-trips our MusicXML writer output", () => {
    const src = parseMidi(SCALE_MIDI);
    const variant = buildVariants(src, { title: "Scale", artist: "Test" })[2]!;
    const xml = writeMusicXml(variant, "Scale", "Test");
    const parsed = parseMusicXmlNotes(xml);
    expect(parsed.tempoBpm).toBe(variant.tempoBpm);
    expect(parsed.tempoMetaPresent).toBe(true);
    expect(parsed.timeSig).toEqual(variant.timeSig);
    expect(parsed.notes.length).toBe(variant.notes.length);
    const a = parsed.notes.map((n) => `${n.midi}@${n.start.toFixed(2)}:${n.hand}`);
    const b = variant.notes.map((n) => `${n.midi}@${n.start.toFixed(2)}:${n.hand ?? "R"}`);
    for (const x of b) expect(a).toContain(x);
  });

  it("parses chord elements", () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>960</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>960</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
</measure></part></score-partwise>`;
    const parsed = parseMusicXmlNotes(xml);
    expect(parsed.notes).toHaveLength(3);
    expect(parsed.notes[0]!.start).toBe(0);
    expect(parsed.notes[1]!.start).toBe(0);
    expect(parsed.notes[2]!.start).toBe(0);
    expect(parsed.notes[0]!.dur).toBe(1);
  });

  it("keeps chord members on one beat and honors <backup>", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>
<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
<backup><duration>5</duration></backup>
<note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    // parseMusicXmlNotes sorts by start then midi, so the backup-targeted A3
    // (57@0) sorts before the chord members instead of keeping document order.
    expect(m.notes.map((n) => `${n.midi}@${n.start}`)).toEqual(["57@0", "60@0", "64@0", "67@0", "62@0.5", "65@0.5"]);
  });

  it("skips notes without a valid octave or duration", () => {
    const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step></pitch><duration>2</duration></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>0</duration></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    expect(m.notes.map((n) => n.midi)).toEqual([64]);
  });

  it("parses only the first part of a multi-part score", () => {
    const xml = `<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure></part><part id="P2"><measure number="1"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration></note>
</measure></part></score-partwise>`;
    const m = parseMusicXmlNotes(xml);
    expect(m.notes).toHaveLength(1);
    expect(m.notes[0]!.midi).toBe(60);
  });
});
