import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  OMR_MUSICXML_ADAPTER_VERSION,
  parseOmrMusicXml,
  parseOmrMusicXmlBytes,
  type OmrMusicXmlParseOptions,
} from "../src/omr-musicxml.js";

const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Fixture &amp; Test</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Lead Voice</part-name></score-part>
    <score-part id="P2"><part-name>Rhythm Guitar</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="0" implicit="yes" page="1">
      <attributes>
        <divisions>4</divisions><key><fifths>-2</fifths><mode>minor</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      </attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>110</per-minute></metronome></direction-type></direction>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff>
        <tie type="start"/><notations><tied type="start"/><tuplet type="start" number="1"/></notations><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      </note>
      <backup><duration>4</duration></backup>
      <note><rest/><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="1" page="1" system="2">
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <tie type="stop"/><notations><tied type="stop"/></notations></note>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <forward><duration>2</duration></forward>
      <note><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff><notations><tuplet type="stop"/></notations></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="0" implicit="yes" page="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="1" page="1" system="2"><note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note></measure>
  </part>
</score-partwise>`;

function eventList(score: ReturnType<typeof parseOmrMusicXml>["score"]): NonNullable<NonNullable<typeof score.parts[number]["measures"][number]["events"]>> {
  return score.parts.flatMap((part) => part.measures.flatMap((measure) => measure.events ?? []));
}

describe("MusicXML to OMR score adapter", () => {
  it("preserves score structure and computes absolute measure starts", () => {
    const result = parseOmrMusicXml(MUSIC_XML);
    expect(result.format).toBe("musicxml");
    expect(result.rootFile).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.score).toMatchObject({ title: "Fixture & Test", tempoBpm: 110, timeSignature: [4, 4], keySignature: -2 });
    expect(result.score.metadata).toMatchObject({ adapter: OMR_MUSICXML_ADAPTER_VERSION, partCount: 2, measureCount: 2 });
    expect(result.score.parts.map((part) => [part.id, part.name, part.role])).toEqual([
      ["P1", "Lead Voice", "melody"],
      ["P2", "Rhythm Guitar", "rhythm"],
    ]);
    expect(result.score.parts[0]!.measures.map((measure) => [measure.number, measure.startBeat, measure.durationBeats, measure.page, measure.system, measure.implicit])).toEqual([
      ["0", 0, 1, 1, undefined, true],
      ["1", 1, 4, 1, 2, false],
    ]);
    expect(result.score.parts[1]!.measures.map((measure) => [measure.startBeat, measure.durationBeats])).toEqual([[0, 1], [1, 4]]);

    const events = eventList(result.score);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ pitch: 57, onset: 0, duration: 1, staff: 1, voice: "1", role: "melody", tuplet: true, tie: { start: true, stop: false, continue: false } }),
      expect.objectContaining({ pitch: 57, onset: 0, duration: 0.5, staff: 1, voice: "1", role: "melody", tie: { start: false, stop: true, continue: false } }),
      expect.objectContaining({ pitch: 60, onset: 0, duration: 0.5, staff: 1, voice: "1", role: "melody" }),
      expect.objectContaining({ pitch: 63, onset: 1, duration: 0.5, staff: 1, voice: "1", role: "melody" }),
    ]));
    expect(result.score.parts[0]!.measures[0]!.rests).toEqual([{ onset: 0, duration: 1 }]);
    expect(result.score.parts[0]!.measures[0]!.tieOut).toBe(true);
    expect(result.score.parts[0]!.measures[1]!.tieIn).toBe(true);
    expect(result.score.parts[0]!.measures[0]!.tupletCount).toBe(1);
    expect(result.score.parts[0]!.measures[1]!.tupletCount).toBe(1);
    expect(result.score.parts[0]!.measures[0]!.staves).toEqual([{ number: 1, role: "melody", voices: [], events: [] }, { number: 2, role: "melody", voices: [], events: [] }]);
  });

  it("supports explicit role overrides and deterministic reordered input", () => {
    const options: OmrMusicXmlParseOptions = { partRoles: { P2: "harmony" }, staffRoles: { "P1:2": "rhythm" } };
    const first = parseOmrMusicXml(MUSIC_XML, options).score;
    const reorderedXml = MUSIC_XML.replace('id="P1"', 'id="P1"');
    const second = parseOmrMusicXml(reorderedXml, options).score;
    expect(first).toEqual(second);
    expect(first.parts[1]!.role).toBe("harmony");
    expect(first.parts[0]!.measures[0]!.events?.find((event) => event.staff === 1)?.role).toBe("melody");
    expect(first.parts[0]!.measures[1]!.events?.find((event) => event.staff === 2)?.role).toBe("rhythm");
  });

  it("infers page transitions from MusicXML print new-page markers", () => {
    const pagedXml = MUSIC_XML.replace(
      '    <measure number="1" page="1" system="2">',
      '    <measure number="1"><print new-page="yes" new-system="yes"></print>',
    );
    const result = parseOmrMusicXml(pagedXml);
    expect(result.score.parts[0]!.measures.map((measure) => measure.page)).toEqual([1, 2]);
    expect(result.score.parts[1]!.measures.map((measure) => measure.page)).toEqual([1, 1]);
  });

  it("reads an MXL container rootfile without writing or exposing local paths", () => {
    const mxl = zipSync({
      "META-INF/container.xml": strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>'),
      "scores/main.musicxml": strToU8(MUSIC_XML),
    });
    const result = parseOmrMusicXmlBytes(mxl);
    expect(result.format).toBe("mxl");
    expect(result.rootFile).toBe("scores/main.musicxml");
    expect(result.score.metadata).toMatchObject({ format: "mxl", rootFile: "scores/main.musicxml" });
    expect(JSON.stringify(result)).not.toContain("/Users/");
  });

  it("fails closed for malformed XML and unsupported score-timewise input", () => {
    expect(() => parseOmrMusicXml("<score-partwise><part></score-partwise>")).toThrow(/mismatched|unclosed/i);
    expect(() => parseOmrMusicXml("<score-timewise></score-timewise>")).toThrow(/score-partwise/i);
  });
});
