import { describe, expect, it } from "vitest";
import { buildVariants, parseMidi, parseMusicXmlNotes, validateArtifactFiles, writeMidi, writeMusicXml, writeVariantArtifacts } from "../src/index.js";

function midiWithTrack(payload: number[]): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x01,
    0x00, 0x01,
    0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b,
    (payload.length >>> 24) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 8) & 0xff,
    payload.length & 0xff,
    ...payload,
  ]);
}

const CHANGING_METER_MIDI = midiWithTrack([
  0x00, 0xff, 0x58, 0x04, 0x02, 0x02, 0x18, 0x08,
  0x00, 0x90, 0x3c, 0x64,
  0x83, 0x60, 0x80, 0x3c, 0x40,
  0xa9, 0x20, 0xff, 0x58, 0x04, 0x06, 0x03, 0x18, 0x08,
  0x00, 0x90, 0x40, 0x64,
  0x8f, 0x00, 0x80, 0x40, 0x40,
  0x00, 0xff, 0x2f, 0x00,
]);

describe("MIDI time-signature events", () => {
  it("preserves meter changes instead of exposing only the final tuple", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    expect(parsed.timeSig).toEqual([6, 8]);
    expect(parsed.timeSigEvents).toEqual([
      { tick: 0, beat: 0, timeSig: [2, 4] },
      { tick: 5760, beat: 12, timeSig: [6, 8] },
    ]);
  });

  it("builds measure boundaries from the source meter timeline", () => {
    const variant = buildVariants(parseMidi(CHANGING_METER_MIDI), { title: "Meter", artist: "Test" }).at(-1)!;
    expect(variant.timeSigEvents).toEqual([
      { tick: 0, beat: 0, timeSig: [2, 4] },
      { tick: 5760, beat: 12, timeSig: [6, 8] },
    ]);
    expect(variant.measures.slice(0, 8)).toEqual([
      { index: 0, startBeat: 0, endBeat: 2 },
      { index: 1, startBeat: 2, endBeat: 4 },
      { index: 2, startBeat: 4, endBeat: 6 },
      { index: 3, startBeat: 6, endBeat: 8 },
      { index: 4, startBeat: 8, endBeat: 10 },
      { index: 5, startBeat: 10, endBeat: 12 },
      { index: 6, startBeat: 12, endBeat: 15 },
      { index: 7, startBeat: 15, endBeat: 18 },
    ]);
  });

  it("truncates a mid-measure change without losing the following meter", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const variant = buildVariants({
      ...parsed,
      durationBeats: 9,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 100 }],
      timeSig: [3, 4],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] },
        { tick: 2400, beat: 5, timeSig: [3, 4] },
      ],
    }, { title: "Mid-measure", artist: "Test" }).at(-1)!;
    expect(variant.measures).toEqual([
      { index: 0, startBeat: 0, endBeat: 4 },
      { index: 1, startBeat: 4, endBeat: 5 },
      { index: 2, startBeat: 5, endBeat: 8 },
      { index: 3, startBeat: 8, endBeat: 11 },
    ]);
  });

  it("rejects contradictory same-boundary events and unbounded coordinates", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const base = {
      ...parsed,
      durationBeats: 1,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 100 }],
      timeSig: [4, 4] as [number, number],
    };
    expect(() => buildVariants({
      ...base,
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] },
        { tick: 0, beat: 0, timeSig: [3, 4] },
      ],
    }, { title: "Conflict", artist: "Test" })).toThrow(/contradictory/);
    expect(() => buildVariants({
      ...base,
      timeSigEvents: [{ tick: 1, beat: 4097, timeSig: [4, 4] }],
    }, { title: "Unbounded", artist: "Test" })).toThrow(/invalid time-signature|supported limits/);
  });

  it("ignores a valid meter declaration after the playable source end", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const variant = buildVariants({
      ...parsed,
      durationBeats: 1,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 100 }],
      timeSig: [6, 8],
      timeSigEvents: [{ tick: 480000, beat: 1000, timeSig: [6, 8] }],
    }, { title: "Late meter", artist: "Test" }).at(-1)!;
    expect(variant.measures).toEqual([{ index: 0, startBeat: 0, endBeat: 4 }]);
  });

  it("carries the meter timeline into generated MIDI and MusicXML", () => {
    const variant = buildVariants(parseMidi(CHANGING_METER_MIDI), { title: "Meter", artist: "Test" }).at(-1)!;
    const roundTrip = parseMidi(writeMidi(variant.notes, {
      tempoBpm: variant.tempoBpm,
      timeSig: variant.timeSig,
      timeSigEvents: variant.timeSigEvents,
    }));
    expect(roundTrip.timeSigEvents).toEqual([
      { tick: 0, beat: 0, timeSig: [2, 4] },
      { tick: 5760, beat: 12, timeSig: [6, 8] },
    ]);
    const xml = writeMusicXml(variant, "Meter", "Test");
    expect(xml).toContain("<time><beats>2</beats><beat-type>4</beat-type></time>");
    expect(xml).toContain("<time><beats>6</beats><beat-type>8</beat-type></time>");
  });

  it("round-trips a padded short measure before a meter change", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const variant = buildVariants({
      ...parsed,
      durationBeats: 9,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 100 }],
      timeSig: [3, 4],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] },
        { tick: 2400, beat: 5, timeSig: [3, 4] },
      ],
    }, { title: "Mid-measure", artist: "Test" }).at(-1)!;
    expect(validateArtifactFiles(variant, writeVariantArtifacts(variant, "Mid-measure", "Test"))).toEqual([]);
  });

  it("round-trips an unpadded short measure before a meter change", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const base = buildVariants(parsed, { title: "Short", artist: "Test" }).at(-1)!;
    const variant = {
      ...base,
      notes: [{ midi: 60, start: 4, dur: 0.5, vel: 100, hand: "R" as const }],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] as [number, number] },
        { tick: 4320, beat: 4.5, timeSig: [3, 4] as [number, number] },
      ],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 4.5 },
        { index: 2, startBeat: 4.5, endBeat: 7.5 },
      ],
    };
    expect(validateArtifactFiles(variant, writeVariantArtifacts(variant, "Short", "Test"))).toEqual([]);
  });

  it("does not treat an underfilled ordinary measure as a short bar", () => {
    const xml = `<score-partwise><part id="P1">
      <measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
        <forward><duration>4</duration></forward>
      </measure>
      <measure number="2"><attributes><divisions>4</divisions></attributes>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      </measure>
    </part></score-partwise>`;
    expect(parseMusicXmlNotes(xml).notes.map((note) => note.start)).toEqual([0, 4]);
  });

  it("does not emit a ghost note when a quantized attack straddles a near boundary", () => {
    const parsed = parseMidi(CHANGING_METER_MIDI);
    const base = buildVariants({
      ...parsed,
      durationBeats: 9,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 100 }],
      timeSig: [3, 4],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] },
        { tick: 2400, beat: 5, timeSig: [3, 4] },
      ],
    }, { title: "Near boundary", artist: "Test" }).at(-1)!;
    const variant = {
      ...base,
      notes: [...base.notes, { midi: 64, start: 4.99999, dur: 0.125, vel: 100, hand: "R" as const }],
      timeSigEvents: [
        { tick: 0, beat: 0, timeSig: [4, 4] as [number, number] },
        { tick: 2400, beat: 5.000006, timeSig: [3, 4] as [number, number] },
      ],
      measures: [
        { index: 0, startBeat: 0, endBeat: 4 },
        { index: 1, startBeat: 4, endBeat: 5.000006 },
        { index: 2, startBeat: 5.000006, endBeat: 8.000006 },
        { index: 3, startBeat: 8.000006, endBeat: 11.000006 },
      ],
    };
    expect(validateArtifactFiles(variant, writeVariantArtifacts(variant, "Near boundary", "Test"))).toEqual([]);
  });

  it("rejects stale scalar-only MIDI and MusicXML meter artifacts", () => {
    const variant = buildVariants(parseMidi(CHANGING_METER_MIDI), { title: "Meter", artist: "Test" }).at(-1)!;
    const staleMidi = writeMidi(variant.notes, {
      tempoBpm: variant.tempoBpm,
      timeSig: variant.timeSig,
    });
    const staleXml = writeMusicXml({ ...variant, timeSigEvents: undefined }, "Meter", "Test");
    const issues = validateArtifactFiles(variant, { midi: staleMidi, xml: staleXml });
    expect(issues.filter((issue) => /time signature|meter/i.test(issue))).toHaveLength(2);
  });
});
