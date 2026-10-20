import { describe, expect, it } from "vitest";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

// SheetMusicView injects Verovio output with dangerouslySetInnerHTML, so the
// SVG must never carry executable markup derived from uploaded MusicXML.
const HOSTILE_MUSICXML = `<?xml version="1.0"?><score-partwise version="3.1">
<work><work-title>&lt;script&gt;alert(1)&lt;/script&gt;</work-title></work>
<credit page="1"><credit-words>&lt;img src=x onerror=alert(2)&gt;</credit-words></credit>
<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1"><measure number="1" id="m&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;">
<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<direction placement="above"><direction-type><words>&lt;foreignObject&gt;&lt;iframe src=//evil&gt;</words></direction-type></direction>
<note id="a&quot; onmouseover=&quot;alert(4)&quot; x=&quot;"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type>
<lyric><syllable>single</syllable><text>&lt;script&gt;alert(5)&lt;/script&gt;</text></lyric></note>
</measure></part></score-partwise>`;

const ALLOWED_ELEMENTS = new Set(["svg", "desc", "defs", "symbol", "path", "style", "g", "text", "tspan", "use", "title", "rect", "line", "polyline", "polygon", "circle", "ellipse"]);

describe("Verovio SVG output safety", () => {
  it("keeps hostile MusicXML text and ids inert", async () => {
    const toolkit = new VerovioToolkit(await createVerovioModule());
    expect(toolkit.loadData(HOSTILE_MUSICXML)).toBeTruthy();
    const svg: string = toolkit.renderToSVG(1);

    const elements = [...svg.matchAll(/<([A-Za-z][\w:-]*)/g)].map((m) => m[1]!.toLowerCase());
    expect(elements.filter((name) => !ALLOWED_ELEMENTS.has(name))).toEqual([]);

    // Blank out quoted attribute values; any remaining on*= is a real handler.
    const withoutValues = svg.replace(/"[^"]*"/g, '""');
    expect(withoutValues).not.toMatch(/\son\w+\s*=/i);
    expect(withoutValues).not.toMatch(/javascript:/i);
  });
});
