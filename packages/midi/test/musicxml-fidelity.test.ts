import { describe, expect, it } from "vitest";
import { buildShortStudyVariants, parseMidi, parseMusicXmlNotes, validateArtifactFiles, writeVariantArtifacts, type Variant } from "../src/index.js";

function score(attributes = "", direction = "", noteAttributes = "", notation = ""): string {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${attributes}</attributes>${direction}<note ${noteAttributes}><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>${notation}</note></measure></part></score-partwise>`;
}

describe("MusicXML semantic fidelity boundary", () => {
  it.each([
    "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>",
    "<transpose><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>",
    "<transpose number=\"2\"><chromatic>2</chromatic></transpose>",
  ])("refuses unimplemented transposing-part semantics: %s", (transpose) => {
    expect(() => parseMusicXmlNotes(score(transpose))).toThrow(/Unsupported MusicXML.*transpose.*concert-pitch/i);
  });

  it("refuses octave-shift playback semantics without inventing sounding pitches", () => {
    expect(() => parseMusicXmlNotes(score("", '<direction><direction-type><octave-shift type="up" size="8"/></direction-type></direction>'))).toThrow(/Unsupported MusicXML.*octave-shift.*concert-pitch/i);
  });

  it("does not treat comments or escaped words as musical declarations", () => {
    const parsed = parseMusicXmlNotes(score("<!-- <transpose><chromatic>-2</chromatic></transpose> -->", "<direction><direction-type><words>&lt;transpose&gt; is a word here</words></direction-type></direction>"));
    expect(parsed.notes.map(n => n.midi)).toEqual([60]);
    expect(parsed.unsupportedControls ?? []).toEqual([]);
  });

  it("refuses unapplied performance timing offsets", () => {
    expect(() => parseMusicXmlNotes(score("", "", 'attack="1" release="-1"'))).toThrow(/attack.*release.*timing/i);
    expect(parseMusicXmlNotes(score("", "", 'attack="0" release="0"')).notes[0]).toMatchObject({ start: 0, dur: 4 });
  });

  it.each(["attack", "release"])("does not let qualified metadata mask the actual %s attribute", (attribute) => {
    for (const attributes of [
      `${attribute}="1" xmlns:meta="urn:metadata" meta:${attribute}="0"`,
      `xmlns:meta="urn:metadata" meta:${attribute}="0" ${attribute}="1"`,
    ]) expect(() => parseMusicXmlNotes(score("", "", attributes))).toThrow(/attack.*release.*timing/i);
    for (const attributes of [
      `${attribute}="0" xmlns:meta="urn:metadata" meta:${attribute}="1"`,
      `xmlns:meta="urn:metadata" meta:${attribute}="1"`,
      `${attribute}="0" xmlns:${attribute}="urn:metadata"`,
    ]) expect(parseMusicXmlNotes(score("", "", attributes)).notes[0]).toMatchObject({ start: 0, dur: 4 });
  });

  it.each(['attack="1" attack="0"', 'release="1" release="0"'])("refuses duplicate semantic attributes: %s", (attributes) => {
    expect(() => parseMusicXmlNotes(score("", "", attributes))).toThrow(/duplicate.*attribute/i);
  });

  it.each([
    ['<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>', "", "", /dynamics.*note velocities/i],
    ['<direction><sound dynamics="30"/></direction>', "", "", /dynamics.*note velocities/i],
    ['<direction><direction-type><wedge type="crescendo"/></direction-type></direction>', "", "", /wedge.*velocity/i],
    ["", "", "<notations><articulations><staccato/></articulations></notations>", /articulations.*playback/i],
    ["", "", "<notations><ornaments><trill-mark/></ornaments></notations>", /ornaments.*playback/i],
    ["", "", '<notations><slur type="start"/><fermata/></notations>', /slur.*playback/i],
  ])("reports omitted expression without changing the symbolic note", (direction, attrs, notation, warning) => {
    const parsed = parseMusicXmlNotes(score("", direction as string, attrs as string, notation as string));
    expect(parsed.notes[0]).toMatchObject({ midi: 60, start: 0, dur: 4, vel: 80 });
    expect(parsed.unsupportedControls?.some(w => (warning as RegExp).test(w))).toBe(true);
    for (const variant of buildShortStudyVariants(parsed, { title: "Fidelity", artist: "Synthetic", key: "C" })) {
      expect(variant.warnings?.join(" ")).toMatch(warning as RegExp);
    }
  });

  it("reports expression from a later part as well as the first part", () => {
    const plain = score();
    const expressive = score("", '<direction><sound dynamics="30"/></direction>').match(/<part id="P1">[\s\S]*<\/part>/)![0].replace('id="P1"', 'id="P2"');
    const parsed = parseMusicXmlNotes(plain.replace("</score-partwise>", `${expressive}</score-partwise>`));
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.unsupportedControls?.join(" ")).toMatch(/dynamics.*note velocities/i);
  });

  it("declares encoded attack velocity independently from expressive preservation", () => {
    const variant: Variant = { level: "advanced", key: "C", tempoBpm: 120, timeSig: [4, 4], difficultyScore: 30, bassPattern: "none", chords: [], measures: [{ index: 0, startBeat: 0, endBeat: 4 }], notes: [
      { midi: 60, start: 0, dur: 1, vel: 20, hand: "R" },
      { midi: 64, start: 2, dur: 1, vel: 100, hand: "R" },
    ] };
    const artifacts = writeVariantArtifacts(variant, "Dynamic contrast", "Synthetic");
    expect(parseMidi(artifacts.midi).notes.map(n => n.vel)).toEqual([20, 100]);
    expect(parseMusicXmlNotes(artifacts.xml).notes.map(n => n.vel)).toEqual([20, 100]);
    expect(validateArtifactFiles(variant, artifacts)).toEqual([]);
    expect(artifacts).toHaveProperty("fidelity", {
      schemaVersion: 2, validationScope: "symbolic-events-and-attack-velocities", expressivePreservation: "not-established",
      midi: { noteVelocities: "encoded" }, musicxml: { noteVelocities: "encoded", dynamics: "omitted" },
    });
  });
});
