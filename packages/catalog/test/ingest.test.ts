import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ingestSource } from "../src/ingest.js";

const tmp = mkdtempSync(join(tmpdir(), "keyspilli-catalog-"));
const OLD_DATA_DIR = process.env.KEYSPILLI_DATA_DIR;

function scoreXml(notes: number[]): string {
  const noteXmls = notes
    .map((midi) => {
      const step = ["C", "D", "E", "F", "G", "A", "B"][midi % 7]!;
      return `<note><pitch><step>${step}</step><octave>${Math.floor(midi / 12)}</octave></pitch>` +
        `<duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${noteXmls}</measure></part></score-partwise>`;
}

describe("ingestSource .mxl", () => {
  beforeAll(() => {
    process.env.KEYSPILLI_DATA_DIR = tmp;
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (OLD_DATA_DIR === undefined) delete process.env.KEYSPILLI_DATA_DIR;
    else process.env.KEYSPILLI_DATA_DIR = OLD_DATA_DIR;
  });

  it("unzips a compressed MusicXML score and ingests it", async () => {
    const xml = scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
    const mxl = zipSync({
      "META-INF/container.xml": new TextEncoder().encode(
        `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`,
      ),
      "score.xml": new TextEncoder().encode(xml),
    });
    const res = await ingestSource({
      buf: new Uint8Array(mxl),
      title: "MXL Song",
      artist: "Tester",
      category: "Upload",
      contentType: "upload",
      acquiredVia: "upload",
    });
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
  });
});
