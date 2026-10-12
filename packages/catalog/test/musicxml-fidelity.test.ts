import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { adaptNativeSymbolicBytes } from "../src/native-score-adapter.js";
import { parseSymbolicUploadSource } from "../src/ingest.js";
import { parseOmrMusicXmlBytes } from "../src/omr-musicxml.js";
import { createSymbolicUploadPreflight } from "../src/symbolic-upload.js";

const score = (extra: string) => `<score-partwise><part-list><score-part id="P1"><part-name>Clarinet</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions>${extra}</attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
const transpose = "<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>";
const bytesFor = (xml: string, format: "musicxml" | "mxl") => format === "mxl" ? zipSync({ "score.musicxml": strToU8(xml) }) : strToU8(xml);

describe("MusicXML source and review adapter fidelity", () => {
  it.each(["musicxml", "mxl"] as const)("refuses transposition in %s and retains exact byte provenance", (format) => {
    const bytes = bytesFor(score(transpose), format), original = bytes.slice();
    const result = adaptNativeSymbolicBytes(bytes, format, { sourceRef: `clarinet.${format}` });
    expect(result.status).toBe("unsupported");
    expect(result).toMatchObject({ score: null, canonical: null, reason: expect.stringMatching(/transpose.*concert-pitch/i), provenance: { sha256: createHash("sha256").update(original).digest("hex"), bytes: original.length } });
    expect(bytes).toEqual(original);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/transpose.*concert-pitch/i);
  });

  it("also refuses namespaced transposition through the namespace-tolerant review adapter", () => {
    const xml = score(transpose).replace(/<(\/?)([\w-]+)/g, "<$1m:$2").replace("<m:score-partwise>", '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml">');
    expect(adaptNativeSymbolicBytes(strToU8(xml), "musicxml")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/transpose.*concert-pitch/i) });
  });

  it("reports discarded dynamic directions and preserves ordinary event coordinates", () => {
    const xml = score("").replace("<note>", '<direction><direction-type><dynamics><p/></dynamics><wedge type="crescendo"/></direction-type></direction><note>');
    const result = adaptNativeSymbolicBytes(strToU8(xml), "musicxml");
    expect(result.status).toBe("parsed");
    expect(result.warnings.join(" ")).toMatch(/dynamics.*note velocities/i);
    expect(result.warnings.join(" ")).toMatch(/wedge.*velocity/i);
    if (result.status === "parsed") expect(result.score.parts[0]?.measures[0]?.events?.[0]).toMatchObject({ pitch: 60, onset: 0, duration: 4 });
  });

  it("ignores transposition-like comments and CDATA in the notation adapter", () => {
    const xml = score(`<!-- ${transpose} --><words><![CDATA[${transpose}]]></words>`);
    expect(adaptNativeSymbolicBytes(strToU8(xml), "musicxml")).toMatchObject({ status: "parsed", warnings: [] });
  });

  it.each(["attack", "release"])("keeps unqualified %s offsets distinct from metadata attributes", (attribute) => {
    for (const attributes of [
      `${attribute}="1" xmlns:meta="urn:metadata" meta:${attribute}="0"`,
      `xmlns:meta="urn:metadata" meta:${attribute}="0" ${attribute}="1"`,
    ]) {
      const bytes = strToU8(score("").replace("<note>", `<note ${attributes}>`));
      expect(adaptNativeSymbolicBytes(bytes, "musicxml")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/attack.*release.*timing/i) });
      expect(() => parseSymbolicUploadSource(bytes)).toThrow(/attack.*release.*timing/i);
      expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/attack.*release.*timing/i);
    }
    const zero = strToU8(score("").replace("<note>", `<note ${attribute}="0" xmlns:meta="urn:metadata" meta:${attribute}="1">`));
    expect(adaptNativeSymbolicBytes(zero, "musicxml").status).toBe("parsed");
    expect(parseSymbolicUploadSource(zero).parsed.notes[0]).toMatchObject({ start: 0, dur: 4 });
  });
  it.each(["musicxml", "mxl"] as const)("validates note dynamics but discloses native note-model omission in %s", format=>{
    const xml=score("").replace("<note>",'<note dynamics="30">'), bytes=bytesFor(xml,format);
    expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.vel).toBe(27);
    const native=adaptNativeSymbolicBytes(bytes,format);
    expect(native.status).toBe("parsed");
    expect(native.warnings.join(" ")).toMatch(/note.*velocit.*not represented.*notation/i);
    if(native.status==="parsed") expect(native.score.parts[0]?.measures[0]?.events?.[0]).not.toHaveProperty("vel");
    for(const attrs of ['dynamics="0"','dynamics="bogus" xmlns:meta="urn:meta" meta:dynamics="100"','dynamics="30" dynamics="100"']){
      const invalid=bytesFor(score("").replace("<note>",`<note ${attrs}>`),format);
      expect(adaptNativeSymbolicBytes(invalid,format).status).not.toBe("parsed");
      expect(()=>parseSymbolicUploadSource(invalid)).toThrow(/dynamics|duplicate/i);
    }
  });
  it.each(["musicxml","mxl"] as const)("decodes actual and escaped numeric dynamics once in native %s",format=>{
    for(const value of ["&amp;#51;0","&amp;#x33;0","&amp;#38;#51;0"]){
      const bytes=bytesFor(score("").replace("<note>",`<note dynamics="${value}">`),format);
      expect(adaptNativeSymbolicBytes(bytes,format).status).not.toBe("parsed");
      expect(()=>parseSymbolicUploadSource(bytes)).toThrow(/dynamics.*velocity/i);
    }
    for(const value of ["&#51;0","&#x33;0"]){
      const bytes=bytesFor(score("").replace("<note>",`<note dynamics="${value}">`),format);
      expect(adaptNativeSymbolicBytes(bytes,format).status).toBe("parsed");
      expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.vel).toBe(27);
    }
  });
  it.each(["musicxml","mxl"] as const)("refuses every unmatched attribute token in native %s",format=>{
    for(const attrs of ['dynamics=0','dynamics="30" dynamics=0','dynamics="30" dynamics','dynamics','dynamics="30" garbage','dynamics="30"dynamics="100"','xmlns:meta="urn:meta" meta:dynamics=0 dynamics="30"']){
      const bytes=bytesFor(score("").replace("<note>",`<note ${attrs}>`),format);
      expect(adaptNativeSymbolicBytes(bytes,format).status).not.toBe("parsed");
      expect(()=>parseSymbolicUploadSource(bytes)).toThrow(/attribute/i);
    }
    const valid=bytesFor(score("").replace("<note>",'<note xmlns:meta="urn:meta" meta:dynamics="0" meta:label=" > \'quoted\' " dynamics = \'30\'>'),format);
    expect(adaptNativeSymbolicBytes(valid,format).status).toBe("parsed");
    expect(parseSymbolicUploadSource(valid).parsed.notes[0]?.vel).toBe(27);
  });
  it("uses exact dynamics keys in the namespaced native model",()=>{
    for(const attrs of ['dynamics="30" xmlns:meta="urn:meta" meta:dynamics="0"','xmlns:meta="urn:meta" meta:dynamics="0" dynamics="30"']){
      const xml=score("").replace("<note>",`<note ${attrs}>`).replace(/<(\/?)([\w-]+)/g,"<$1m:$2").replace("<m:score-partwise>",'<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml">');
      const native=adaptNativeSymbolicBytes(strToU8(xml),"musicxml");
      expect(native.status).toBe("parsed"); expect(native.warnings.join(" ")).toMatch(/note.*velocit.*notation/i);
    }
    expect(adaptNativeSymbolicBytes(strToU8(score("").replace("<note>",'<note xmlns:meta="urn:meta" meta:dynamics="0">')),"musicxml")).toMatchObject({status:"parsed",warnings:[]});
  });

});

describe("MXL declared source identity", () => {
  const target = "Scores/main.musicxml";
  const companion = score("").replace("<step>C</step>", "<step>E</step>");
  const container = (attributes: string, prefix = "") => `<container><rootfiles>${prefix}<rootfile ${attributes}/><rootfile full-path="a-companion.musicxml"/></rootfiles></container>`;
  const archive = (xml: string | null, entries: Record<string, string> = { "a-companion.musicxml": companion, [target]: score(transpose) }) => zipSync(Object.fromEntries([
    ...(xml === null ? [] : [["META-INF/container.xml", strToU8(xml)]]),
    ...Object.entries(entries).map(([name, contents]) => [name, strToU8(contents)]),
  ]));

  it.each([
    ["ordinary", container(`full-path="${target}"`)],
    ["single quoted", container(`full-path='${target}'`)],
    ["attribute whitespace", container(`full-path = "${target}"`)],
    ["numeric entity", container('full-path="Scores/main&#46;musicxml"')],
    ["commented root", container(`full-path="${target}"`, '<!-- <rootfile full-path="a-companion.musicxml"/> -->')],
    ["CDATA root", container(`full-path="${target}"`, '<![CDATA[<rootfile full-path="a-companion.musicxml"/>]]>')],
    ["attribute text", container(`full-path="${target}"`).replace('<container>', '<container note=\'<rootfile full-path="a-companion.musicxml"/>\'>')],
    ["namespace", container(`full-path="${target}"`).replace(/<(\/?)(container|rootfiles|rootfile)/g, '<$1m:$2').replace('<m:container>', '<m:container xmlns:m="urn:oasis:names:tc:opendocument:xmlns:container">')],
  ])("checks the actual first root for %s syntax", (_name, xml) => {
    const bytes = archive(xml), hash = createHash("sha256").update(bytes).digest("hex");
    const native = adaptNativeSymbolicBytes(bytes, "mxl");
    expect(native).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/transpose.*concert-pitch/i), provenance: { sha256: hash } });
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/transpose.*concert-pitch/i);
  });

  it.each([
    ["missing declared file", container('full-path="missing.musicxml"')],
    ["missing declaration", '<container><rootfiles/></container>'],
    ["nested fake declaration", '<container><rootfiles><other><rootfile full-path="a-companion.musicxml"/></other></rootfiles></container>'],
    ["unquoted declaration", '<container><rootfiles><rootfile full-path=a-companion.musicxml/></rootfiles></container>'],
  ])("rejects %s instead of substituting a score", (_name, xml) => {
    const bytes = archive(xml);
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/MXL.*rootfile/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/MXL.*rootfile/i);
    expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/MXL.*rootfile/i);
    expect(adaptNativeSymbolicBytes(bytes, "mxl").status).not.toBe("parsed");
  });

  it("accepts the selected plain score without inspecting an unselected transposing companion", () => {
    const bytes = archive(container('full-path="a-companion.musicxml"'));
    expect(parseOmrMusicXmlBytes(bytes)).toMatchObject({ rootFile: "a-companion.musicxml", warnings: [] });
    expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.midi).toBe(64);
    expect(adaptNativeSymbolicBytes(bytes, "mxl")).toMatchObject({ status: "parsed", provenance: { rootFile: "a-companion.musicxml" } });
  });

  it("decodes path entities once", () => {
    const bytes = archive(container('full-path="score&amp;#46;musicxml"'), { "score&#46;musicxml": companion, "score.musicxml": score(transpose) });
    expect(parseOmrMusicXmlBytes(bytes).rootFile).toBe("score&#46;musicxml");
    expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.midi).toBe(64);
  });

  it.each([
    `full-path="${target}" xmlns:full-path="urn:keyspilli:companion.musicxml"`,
    `xmlns:full-path="urn:keyspilli:companion.musicxml" full-path="${target}"`,
    `full-path="${target}" xmlns:other="urn:other" other:full-path="urn:keyspilli:companion.musicxml"`,
  ])("ignores namespace declarations and qualified attribute lookalikes: %s", (attributes) => {
    const bytes = archive(container(attributes), { [target]: score(transpose), "urn:keyspilli:companion.musicxml": companion });
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(adaptNativeSymbolicBytes(bytes, "mxl")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/transpose.*concert-pitch/i) });
  });

  it.each([
    'xmlns:full-path="a-companion.musicxml"',
    'xmlns:other="urn:other" other:full-path="a-companion.musicxml"',
    `full-path="${target}" full-path="a-companion.musicxml"`,
    `full-path="a-companion.musicxml" full-path="${target}"`,
    'Full-Path="a-companion.musicxml"',
  ])("rejects missing, misnamed or duplicate unqualified declarations: %s", (attributes) => {
    const bytes = archive(container(attributes));
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/MXL.*rootfile/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/MXL.*rootfile/i);
    expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/MXL.*rootfile/i);
    expect(adaptNativeSymbolicBytes(bytes, "mxl").status).not.toBe("parsed");
  });

  it("retains unambiguous single-score legacy archives and rejects ambiguous ones", () => {
    const bytes = archive(null, { "score.musicxml": companion, "META-INF/metadata.xml": "<metadata/>" });
    expect(parseOmrMusicXmlBytes(bytes).rootFile).toBe("score.musicxml");
    expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.midi).toBe(64);
    expect(() => parseOmrMusicXmlBytes(archive(null))).toThrow(/MXL.*ambiguous.*rootfile/i);
    expect(() => parseSymbolicUploadSource(archive(null))).toThrow(/MXL.*ambiguous.*rootfile/i);
  });

  it.each([
    ["foreign prefix", `<container xmlns:other="urn:other"><rootfiles><other:rootfile full-path="a-companion.musicxml"/><rootfile full-path="${target}"/></rootfiles></container>`],
    ["foreign default", `<container><rootfiles><rootfile xmlns="urn:other" full-path="a-companion.musicxml"/><rootfile full-path="${target}"/></rootfiles></container>`],
    ["foreign rootfiles", `<container xmlns:other="urn:other"><other:rootfiles><other:rootfile full-path="a-companion.musicxml"/></other:rootfiles><rootfiles><rootfile full-path="${target}"/></rootfiles></container>`],
    ["same URI alias", `<c:container xmlns:c="urn:container" xmlns:alias="urn:container" xmlns:other="urn:other"><c:rootfiles><other:rootfile full-path="a-companion.musicxml"/><alias:rootfile full-path="${target}"/></c:rootfiles></c:container>`],
    ["rebound prefix", `<c:container xmlns:c="urn:container"><c:rootfiles><c:rootfile xmlns:c="urn:other" full-path="a-companion.musicxml"/><c:rootfile full-path="${target}"/></c:rootfiles></c:container>`],
    ["different case", `<container><rootfiles><Rootfile full-path="a-companion.musicxml"/><rootfile full-path="${target}"/></rootfiles></container>`],
  ])("selects the actual declared namespace identity with %s", (_name, xml) => {
    const bytes = archive(xml);
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(() => createSymbolicUploadPreflight(bytes)).toThrow(/transpose.*concert-pitch/i);
    expect(adaptNativeSymbolicBytes(bytes, "mxl")).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/transpose.*concert-pitch/i) });
  });

  it.each([
    '<container xmlns:other="urn:other"><rootfiles><other:rootfile full-path="a-companion.musicxml"/></rootfiles></container>',
    '<container><rootfiles><other:rootfile full-path="a-companion.musicxml"/></rootfiles></container>',
    '<Container><rootfiles><rootfile full-path="a-companion.musicxml"/></rootfiles></Container>',
    '<c:container xmlns:c="urn:container" xmlns:d="urn:container"><c:rootfiles><c:rootfile full-path="a-companion.musicxml"/></d:rootfiles></c:container>',
    '<c:container xmlns:c="urn:container"><c:rootfiles><rootfile xmlns="" full-path="a-companion.musicxml"/></c:rootfiles></c:container>',
  ])("refuses absent or malformed actual root identity: %s", (xml) => {
    const bytes = archive(xml);
    expect(() => parseOmrMusicXmlBytes(bytes)).toThrow(/MXL.*rootfile/i);
    expect(() => parseSymbolicUploadSource(bytes)).toThrow(/MXL.*rootfile/i);
    expect(adaptNativeSymbolicBytes(bytes, "mxl").status).not.toBe("parsed");
  });

  it("retains default namespace and same-URI prefix aliases for the selected plain score", () => {
    const bytes = archive('<container xmlns="urn:container" xmlns:alias="urn:container"><rootfiles><alias:rootfile full-path="a-companion.musicxml"/></rootfiles></container>');
    expect(parseOmrMusicXmlBytes(bytes)).toMatchObject({ rootFile: "a-companion.musicxml", warnings: [] });
    expect(parseSymbolicUploadSource(bytes).parsed.notes[0]?.midi).toBe(64);
  });
});
