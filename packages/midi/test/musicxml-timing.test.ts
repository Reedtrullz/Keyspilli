import { expect, it } from "vitest";
import { parseMusicXmlNotes } from "../src/parseXml.js";
const note = (duration: number) => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration></note>`;
const attr = `<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>`;
const score = (body: string) => `<score-partwise><part id="P1">${body}</part></score-partwise>`;
it("advances rests and honors pickup extent before the next full measure", () => {
  const parsed = parseMusicXmlNotes(score(`<measure implicit="yes" number="0">${attr}<note><rest/><duration>2</duration></note>${note(2)}</measure><measure number="1">${note(4)}</measure><measure number="2">${note(4)}</measure>`));
  expect(parsed.notes.map(n => n.start)).toEqual([0.5, 1, 5]);
});
it("uses the longest voice, including forward/rest and chord durations", () => {
  const parsed = parseMusicXmlNotes(score(`<measure implicit="yes">${attr}${note(4)}<forward><duration>4</duration></forward><backup><duration>8</duration></backup>${note(2)}</measure><measure>${note(4)}</measure>`));
  expect(parsed.notes.map(n => n.start)).toEqual([0, 0, 2]);
});
it("changes divisions in stream order without changing beat timing", () => {
  const parsed = parseMusicXmlNotes(score(`<measure>${attr}${note(4)}<attributes><divisions>8</divisions></attributes>${note(8)}</measure><measure>${note(8)}</measure>`));
  expect(parsed.notes.map(n => [n.start, n.dur])).toEqual([[0, 1], [1, 1], [4, 1]]);
});
it("recognizes sound tempo regardless of attribute order and keeps metadata presence", () => {
  const parsed = parseMusicXmlNotes(score(`<measure>${attr}<direction><sound dynamics="80" tempo="96.5"/></direction>${note(4)}</measure>`));
  expect(parsed.tempoBpm).toBe(96.5);
  expect(parsed.tempoMetaPresent).toBe(true);
});
it("rejects unrepresentable tempo and meter changes, including formatted XML", () => {
  expect(() => parseMusicXmlNotes(score(`<measure>${attr}<sound tempo="90"/>${note(4)}</measure><measure><sound tempo="120"/>${note(4)}</measure>`))).toThrow(/tempo/i);
  expect(() => parseMusicXmlNotes(score(`<measure>${attr}${note(4)}</measure><measure><attributes><time>\n<beats>3</beats>\n<beat-type>4</beat-type>\n</time></attributes>${note(4)}</measure>`))).toThrow(/time signature/i);
});

it("accepts multiline measure tags and fractional division durations", () => {
  const parsed = parseMusicXmlNotes(score(`<measure\n number="1">${attr}<note><rest/><duration> 0.5 </duration></note>${note(0.5)}</measure>`));
  expect(parsed.notes[0]).toMatchObject({ start: 0.125, dur: 0.125 });
});
