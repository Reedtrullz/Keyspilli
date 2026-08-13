import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ingestSource } from "../src/ingest.js";
import { getSongsByBase } from "../src/db.js";

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

// A minimal zip whose central directory claims the given uncompressed sizes,
// used to exercise the pre-inflate guard without actually inflating anything.
function craftZip(entries: Array<{ name: string; uncompressed: number }>): Uint8Array {
  const parts: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); // central directory header signature
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt32LE(e.uncompressed, 24);
    const nameBuf = Buffer.from(e.name);
    h.writeUInt16LE(nameBuf.length, 28);
    parts.push(h, nameBuf);
    cdSize += 46 + nameBuf.length;
  }
  const cd = Buffer.concat(parts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(4, 16); // central directory starts after the 4-byte local-header prefix
  return new Uint8Array(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]));
}

function ingest(buf: Uint8Array, title = "MXL Song"): Promise<{ baseId: string; songIds: string[]; error?: string }> {
  return ingestSource({
    buf,
    title,
    artist: "Tester",
    category: "Upload",
    contentType: "upload",
    acquiredVia: "upload",
  });
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
    const res = await ingest(new Uint8Array(mxl));
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
  });

  it("prefers a .musicxml entry over META-INF files when container has no rootfile", async () => {
    const xml = scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
    const mxl = zipSync({
      "META-INF/signatures.xml": new TextEncoder().encode("<Signature/>"),
      "META-INF/container.xml": new TextEncoder().encode('<?xml version="1.0"?><container><rootfiles/></container>'),
      "score.musicxml": new TextEncoder().encode(xml),
    });
    const res = await ingest(new Uint8Array(mxl));
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
  });

  it("rejects a zip with more than 200 entries before inflating", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i++) entries[`f${i}.xml`] = new TextEncoder().encode("x");
    const res = await ingest(new Uint8Array(zipSync(entries)));
    expect(res.error).toContain("too many entries");
  });

  it("rejects a crafted central directory whose entries exceed the 64MB cap", async () => {
    const res = await ingest(craftZip([{ name: "score.musicxml", uncompressed: 65 * 1024 * 1024 }]));
    expect(res.error).toContain("expands beyond");
  });

  it("uses the variant tempo for duration when a tempo override is forwarded", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])));
    const slow = await ingestSource({ buf: xml, title: "Tempo Slow", artist: "Tester", contentType: "standard", tempo: 120 });
    const fast = await ingestSource({ buf: xml, title: "Tempo Fast", artist: "Tester", contentType: "standard", tempo: 240 });
    expect(slow.error).toBeUndefined();
    expect(fast.error).toBeUndefined();
    const slowDur = getSongsByBase(slow.baseId)[0]!.duration;
    const fastDur = getSongsByBase(fast.baseId)[0]!.duration;
    expect(fastDur).toBeLessThan(slowDur);
    expect(Math.abs(fastDur - slowDur / 2)).toBeLessThanOrEqual(1);
  });
});
